#!/usr/bin/env bun

import * as p from "@clack/prompts";
import { auto } from "./commands/auto.ts";
import { createBranch } from "./commands/create-branch.ts";
import { commit } from "./commands/commit.ts";
import { prSuggest } from "./commands/pr-suggest.ts";
import { settings } from "./commands/settings.ts";
import { cleanup } from "./commands/cleanup.ts";
import { release } from "./commands/release.ts";
import { hasApiKey, updateConfig, getConfigLocation } from "./utils/config.ts";

function showHelp(): void {
  console.log(`
🤖 Git AI CLI - AI-powered Git commit and PR suggestions

Usage:
  git-ai [command]

Commands:
  auto     Smart workflow: branch → commit → push → PR (recommended)
  branch   Analyze changes and suggest a branch name
  commit   Generate AI-powered commit message from staged changes
  pr       Generate PR title and description from branch commits
  release  Create a GitHub release with AI-generated release notes
  cleanup  Delete local branches that are merged in remote
  settings Configure AI model, reasoning effort, and other settings
  help     Show this help message

Options:
  -h, --help     Show this help message
  -v, --version  Show version
  -y, --yes      Auto-accept all prompts (blind mode)
  --yolo         YOLO mode: auto-merge PR and delete branch (implies -y)

Examples:
  git-ai              # Interactive mode
  git-ai auto         # Smart workflow (recommended for quick changes)
  git-ai auto -y      # Auto mode with all prompts auto-accepted
  git-ai auto --yolo  # YOLO mode: auto-merge PR and delete branch
  git-ai branch       # Create branch from changes
  git-ai commit       # Generate commit message
  git-ai pr           # Generate PR suggestion
  git-ai release      # Create a release with version bump
  git-ai cleanup      # Clean up merged branches
  git-ai settings     # Configure settings

Documentation:
  https://github.com/yourusername/git-ai-cli
`);
}

/**
 * Check if API key is configured, prompt if not
 */
async function ensureApiKey(): Promise<void> {
  if (await hasApiKey()) {
    return;
  }

  console.clear();
  p.intro("🤖 Git AI CLI - First Time Setup");

  p.note(
    "OpenAI API key is required to use this tool.\n" +
      "Get your API key from: https://platform.openai.com/api-keys",
    "Setup Required"
  );

  const apiKey = await p.text({
    message: "Enter your OpenAI API key:",
    placeholder: "sk-...",
    validate: (value) => {
      if (!value || value.length === 0) {
        return "API key is required";
      }
      if (!value.startsWith("sk-")) {
        return "API key should start with 'sk-'";
      }
    },
  });

  if (p.isCancel(apiKey)) {
    p.cancel("Setup cancelled. API key is required to use this tool.");
    process.exit(1);
  }

  const spinner = p.spinner();
  spinner.start("Saving configuration...");

  await updateConfig({ openaiApiKey: apiKey as string });

  spinner.stop("Configuration saved!");

  p.note(
    `Your API key has been saved to:\n${getConfigLocation()}\n\n` +
      "You can update it anytime by editing this file or running the setup again.",
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
        label: "auto: Smart workflow (recommended)",
        hint: "branch → commit → push → PR",
      },
      {
        value: "branch",
        label: "branch: Create branch from changes",
        hint: "Analyze changes and suggest a branch name",
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
        value: "cleanup",
        label: "cleanup: Delete merged branches",
        hint: "Clean up local branches that are merged in remote",
      },
      {
        value: "settings",
        label: "settings: Configure settings",
        hint: "Change model, reasoning effort, and other options",
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

  // Filter out flags to get the command
  const commandArgs = args.filter((arg) => !arg.startsWith("-"));

  let action: string;

  // Direct command mode or interactive mode
  if (commandArgs.length > 0) {
    action = commandArgs[0] as string;

    // Validate command
    if (!["auto", "branch", "commit", "pr", "release", "cleanup", "settings"].includes(action)) {
      console.error(`Error: Unknown command '${action}'`);
      console.error("Run 'git-ai --help' for usage information");
      process.exit(1);
    }
  } else {
    // Interactive mode
    action = await runInteractive();
  }

  // Ensure API key is configured (skip for settings and cleanup commands)
  if (action !== "settings" && action !== "cleanup") {
    await ensureApiKey();
  }

  // Execute the command
  try {
    if (action === "auto") {
      await auto({ autoYes: yesFlag, yolo: yoloFlag });
    } else if (action === "branch") {
      await createBranch({ autoYes: yesFlag });
    } else if (action === "commit") {
      await commit({ autoYes: yesFlag });
    } else if (action === "pr") {
      await prSuggest({ autoYes: yesFlag });
    } else if (action === "release") {
      await release({ autoYes: yesFlag });
    } else if (action === "cleanup") {
      await cleanup({ autoYes: yesFlag });
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
