#!/usr/bin/env bun

import * as p from "@clack/prompts";
import { auto } from "./commands/auto.ts";
import { createBranch } from "./commands/create-branch.ts";
import { commit } from "./commands/commit.ts";
import { stage } from "./commands/stage.ts";
import { prSuggest } from "./commands/pr-suggest.ts";
import { settings } from "./commands/settings.ts";
import { cleanup } from "./commands/cleanup.ts";
import { prepare } from "./commands/prepare.ts";
import { release } from "./commands/release.ts";
import { unwrapped } from "./commands/unwrapped.ts";
import { prCelebrate } from "./commands/pr-celebrate.ts";
import { createWorktreeCommand } from "./commands/worktree.ts";
import { hasApiKey, updateConfig, getConfigLocation } from "./utils/config.ts";
import { discoverProviderModels, getDefaultProviderApiKeyEnv, getDefaultProviderBaseUrl } from "./utils/model-discovery.ts";
import { Spinner } from "./utils/ui.ts";
import { listProviders, providerRequiresApiKey } from "./utils/provider-registry.ts";

function showHelp(): void {
  console.log(`
🤖 Git AI CLI - AI-powered Git commit and PR suggestions

Usage:
  git-ai [command]

Commands:
  auto      Smart workflow: branch → commit → push → PR
  prepare   Prepare for a new feature: handle changes, checkout main, and pull
  branch    Analyze changes and suggest a branch name
  stage     Stage files interactively with a TUI
  commit    Generate AI-powered commit message from staged changes
  pr        Generate PR title and description from branch commits
  release   Create a GitHub release with AI-generated release notes
  unwrapped Your year in code - Spotify Wrapped style summary
  celebrate Celebrate your current PR with fancy stats and AI
  cleanup   Delete local merged branches and their merged worktrees
  worktree  Create a new worktree from main with matching branch name
  settings  Configure LLM profiles, provider keys, and preferences
  help      Show this help message

Options:
  -h, --help            Show this help message
  -v, --version         Show version
  -y, --yes             Auto-accept all prompts (blind mode)
  --grouped             Force grouped commits (commit command only)
  --single              Force a single commit (commit command only)
  --yolo                YOLO mode: auto-merge PR and delete branch
  --release             Release mode: auto workflow + merge + release (implies --yolo)
  --no-prs              Disable fetching PR info for release notes (PRs are included by default)
  --language <lang>     Language for unwrapped report (english or german, default: english)

Examples:
  git-ai              # Interactive mode
  git-ai auto         # Smart workflow
  git-ai auto -y      # Auto mode with all prompts auto-accepted
  git-ai auto --yolo  # YOLO mode: auto-merge PR and delete branch
  git-ai auto --release  # Full release workflow: commit → PR → merge → release
  git-ai prepare      # Prepare for a new feature
  git-ai branch       # Create branch from changes
  git-ai stage        # Stage files interactively
  git-ai commit       # Generate commit(s) based on your settings
  git-ai commit --grouped  # Force multiple logical commits
  git-ai commit --single   # Force a single commit
  git-ai commit -y    # Auto-accept all confirmations
  git-ai pr           # Generate PR suggestion
  git-ai release      # Create a release (includes PRs if GitHub token available)
  git-ai release --no-prs  # Release without PR info
  git-ai unwrapped    # Your year in code - Spotify Wrapped style summary
  git-ai unwrapped --language german  # Year in code in German
  git-ai celebrate    # Celebrate your current PR with stats and AI summary
  git-ai celebrate --language german  # PR celebration in German
  git-ai cleanup      # Local cleanup for merged branches/worktrees
  git-ai worktree social-media-master  # Create ../<project>-social-media-master
  git-ai settings     # Configure settings

Documentation:
  https://github.com/mr-mrs-panda/git-ai-cli
`);
}

/**
 * Check if LLM key is configured, prompt if not
 */
async function ensureApiKey(): Promise<void> {
  if (await hasApiKey()) {
    return;
  }

  console.clear();
  p.intro("🤖 Git AI CLI - First Time Setup");

  p.note(
    "No LLM key found for the active profile.\n" +
    "Choose a provider and model.\n" +
    "Recommended: use environment variables for keys.",
    "Setup Required"
  );

  const provider = await p.select({
    message: "Choose a default provider:",
    options: listProviders().map((meta) => ({
      value: meta.id,
      label: meta.label,
      hint: `Default URL: ${meta.defaultBaseUrl}`,
    })),
    initialValue: "openai",
  });

  if (p.isCancel(provider)) {
    p.cancel("Setup cancelled. LLM configuration is required.");
    process.exit(1);
  }

  const providerValue = provider as "openai" | "gemini" | "anthropic" | "ollama" | "custom-openai-compatible";
  const apiKeyEnv = getDefaultProviderApiKeyEnv(providerValue);
  const needsBaseUrlInput = providerValue === "custom-openai-compatible" || providerValue === "ollama";
  let baseUrl = getDefaultProviderBaseUrl(providerValue);
  if (needsBaseUrlInput) {
    const enteredBaseUrl = await p.text({
      message: "Provider base URL:",
      initialValue: baseUrl,
      validate: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return "Base URL is required";
        try {
          new URL(trimmed);
          return undefined;
        } catch {
          return "Enter a valid URL";
        }
      },
    });
    if (p.isCancel(enteredBaseUrl)) {
      p.cancel("Setup cancelled. LLM configuration is required.");
      process.exit(1);
    }
    baseUrl = String(enteredBaseUrl).trim().replace(/\/$/, "");
  }

  const requiresApiKey = providerRequiresApiKey(providerValue);
  const enteredKey = await p.password({
    message: requiresApiKey
      ? `Enter your ${providerValue} API key:`
      : `Enter your ${providerValue} API key (optional):`,
    mask: "*",
    validate: (value) => {
      if (!requiresApiKey) return undefined;
      return (!value || value.length === 0) ? "API key is required" : undefined;
    },
  });

  if (p.isCancel(enteredKey)) {
    p.cancel("Setup cancelled. LLM configuration is required.");
    process.exit(1);
  }

  const apiKey = String(enteredKey).trim() || undefined;

  const saveKeySpinner = new Spinner();
  saveKeySpinner.start("Saving API key...");
  await updateConfig({
    llm: {
      defaultProfile: "smart-main",
      profiles: {
        "smart-main": {
          provider: providerValue,
          model: undefined,
          temperature: 0.7,
          maxTokens: 4096,
          reasoningEffort: "low",
          baseUrl,
          apiKeyEnv,
          apiKey,
        },
      },
    },
  });
  saveKeySpinner.stop("API key saved");

  const spinner = new Spinner();
  spinner.start(`Loading available ${providerValue} models...`);
  let discoveredModels: Array<{ id: string; label: string; hint?: string }> = [];
  try {
    discoveredModels = await discoverProviderModels(providerValue, apiKey, baseUrl);
    spinner.stop(`Loaded ${discoveredModels.length} model(s)`);
  } catch (error) {
    spinner.stop("Failed to load models");
    p.log.warn(`Could not load models automatically: ${error instanceof Error ? error.message : String(error)}`);
  }

  let modelValue = "";
  if (discoveredModels.length > 0) {
    const model = await p.select({
      message: "Choose a default model:",
      options: [
        ...discoveredModels.map((m) => ({ value: m.id, label: m.label, hint: m.hint })),
        { value: "__manual__", label: "Manual model ID entry", hint: "Type model name yourself" },
      ],
      initialValue: discoveredModels[0]?.id,
    });

    if (p.isCancel(model)) {
      p.cancel("Setup cancelled. LLM configuration is required.");
      process.exit(1);
    }

    if (model === "__manual__") {
      const manualModel = await p.text({
        message: "Enter model ID:",
        validate: (value) => (!value || !value.trim() ? "Model ID is required" : undefined),
      });
      if (p.isCancel(manualModel)) {
        p.cancel("Setup cancelled. LLM configuration is required.");
        process.exit(1);
      }
      modelValue = String(manualModel).trim();
    } else {
      modelValue = String(model);
    }
  } else {
    const manualModel = await p.text({
      message: "No models discovered. Enter model ID manually:",
      validate: (value) => (!value || !value.trim() ? "Model ID is required" : undefined),
    });
    if (p.isCancel(manualModel)) {
      p.cancel("Setup cancelled. LLM configuration is required.");
      process.exit(1);
    }
    modelValue = String(manualModel).trim();
  }

  spinner.start("Saving configuration...");

  await updateConfig({
    llm: {
      defaultProfile: "smart-main",
      profiles: {
        "smart-main": {
          provider: providerValue,
          model: modelValue,
          temperature: 0.7,
          maxTokens: 4096,
          reasoningEffort: "low",
          baseUrl,
          apiKeyEnv,
          apiKey,
        },
      },
    },
  });

  spinner.stop("Configuration saved!");

  p.note(
    `Configuration saved to:\n${getConfigLocation()}\n\n` +
    `Tip: Set ${apiKeyEnv} in your shell for safer secret handling.`,
    "Success"
  );

  console.log(""); // Add spacing
}

async function runInteractive(): Promise<string> {
  console.clear();

  p.intro("🤖 Git AI CLI");

  const action = await p.select({
    message: "What would you like to do?",
    options: [
      {
        value: "auto",
        label: "auto: Smart workflow",
        hint: "branch → commit → push → PR",
      },
      {
        value: "prepare",
        label: "prepare: Prepare for new feature",
        hint: "Handle changes, checkout main, and pull",
      },
      {
        value: "branch",
        label: "branch: Create branch from changes",
        hint: "Analyze changes and suggest a branch name",
      },
      {
        value: "stage",
        label: "stage: Stage files interactively",
        hint: "Select which files to stage with a TUI",
      },
      {
        value: "commit",
        label: "commit: Generate commit message",
        hint: "Analyze staged changes and suggest a commit message",
      },
      {
        value: "pr",
        label: "pr: Generate PR title & description",
        hint: "Based on branch commits and branch name",
      },
      {
        value: "release",
        label: "release: Create a GitHub release",
        hint: "Version bump + AI-generated release notes",
      },
      {
        value: "unwrapped",
        label: "unwrapped: Your Year in Code",
        hint: "Spotify Wrapped style summary of your repository",
      },
      {
        value: "celebrate",
        label: "celebrate: Celebrate your PR",
        hint: "Fancy stats and AI summary for your current PR",
      },
      {
        value: "cleanup",
        label: "cleanup: Local branch/worktree cleanup",
        hint: "Delete local merged branches and merged worktrees",
      },
      {
        value: "worktree",
        label: "worktree: Create isolated worktree",
        hint: "Create ../<project>-<name> from main with new branch",
      },
      {
        value: "settings",
        label: "settings: Configure settings",
        hint: "Change provider/model and other options",
      },
    ],
  });

  if (p.isCancel(action)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }

  return action as string;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle help flags
  if (args.includes("-h") || args.includes("--help") || args.includes("help")) {
    showHelp();
    process.exit(0);
  }

  // Handle version flag
  if (args.includes("-v") || args.includes("--version")) {
    console.log("git-ai version 1.0.0");
    process.exit(0);
  }

  // Check for yes and yolo flags
  const yesFlag = args.includes("-y") || args.includes("--yes");
  const yoloFlag = args.includes("--yolo");
  const releaseFlag = args.includes("--release");
  const noPRsFlag = args.includes("--no-prs");
  const groupedFlag = args.includes("--grouped");
  const singleFlag = args.includes("--single");

  if (groupedFlag && singleFlag) {
    console.error("Error: --grouped and --single cannot be used together");
    process.exit(1);
  }

  // Parse language flag
  let languageValue: "english" | "german" = "english";
  const languageFlagIndex = args.findIndex(arg => arg === "--language" || arg.startsWith("--language="));
  if (languageFlagIndex !== -1) {
    const languageArg = args[languageFlagIndex];
    if (languageArg?.startsWith("--language=")) {
      // Format: --language=german
      const value = languageArg.split("=")[1]?.toLowerCase();
      if (value === "german" || value === "english") {
        languageValue = value;
      }
    } else {
      // Format: --language german
      const nextArg = args[languageFlagIndex + 1]?.toLowerCase();
      if (nextArg === "german" || nextArg === "english") {
        languageValue = nextArg;
      }
    }
  }

  // Filter out flags to get the command
  // Also filter out language value if it follows --language flag
  const commandArgs = args.filter((arg, index) => {
    if (arg.startsWith("-")) return false;
    // Check if previous arg was --language
    const prevArg = args[index - 1];
    if (prevArg === "--language") return false;
    return true;
  });

  let action: string;

  // Direct command mode or interactive mode
  if (commandArgs.length > 0) {
    action = commandArgs[0] as string;

    // Validate command
    if (!["auto", "branch", "stage", "commit", "pr", "release", "unwrapped", "celebrate", "cleanup", "worktree", "prepare", "settings"].includes(action)) {
      console.error(`Error: Unknown command '${action}'`);
      console.error("Run 'git-ai --help' for usage information");
      process.exit(1);
    }
  } else {
    // Interactive mode
    action = await runInteractive();
  }

  // Ensure API key is configured (skip for settings, cleanup, worktree, prepare, stage, unwrapped and celebrate commands)
  if (action !== "settings" && action !== "cleanup" && action !== "worktree" && action !== "prepare" && action !== "stage" && action !== "unwrapped" && action !== "celebrate") {
    await ensureApiKey();
  }

  // Execute the command
  try {
    if (action === "auto") {
      await auto({ autoYes: yesFlag, yolo: yoloFlag, release: releaseFlag });
    } else if (action === "prepare") {
      await prepare({ autoYes: yesFlag });
    } else if (action === "branch") {
      await createBranch({ autoYes: yesFlag });
    } else if (action === "stage") {
      await stage({ autoYes: yesFlag });
    } else if (action === "commit") {
      const singleCommit = groupedFlag ? false : singleFlag ? true : undefined;
      await commit({ autoYes: yesFlag, singleCommit });
    } else if (action === "pr") {
      await prSuggest({ autoYes: yesFlag });
    } else if (action === "release") {
      await release({ autoYes: yesFlag, includePRs: !noPRsFlag });
    } else if (action === "unwrapped") {
      await unwrapped({ autoYes: yesFlag, language: languageValue });
    } else if (action === "celebrate") {
      await prCelebrate({ autoYes: yesFlag, language: languageValue });
    } else if (action === "cleanup") {
      await cleanup({ autoYes: yesFlag });
    } else if (action === "worktree") {
      await createWorktreeCommand({ autoYes: yesFlag, name: commandArgs[1] });
    } else if (action === "settings") {
      await settings();
    }

    p.outro("✨ Done!");
  } catch (error) {
    p.cancel(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
