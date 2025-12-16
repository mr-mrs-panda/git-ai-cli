#!/usr/bin/env bun

import * as p from "@clack/prompts";
import { auto } from "./commands/auto.ts";
import { createBranch } from "./commands/create-branch.ts";
import { autoCommit } from "./commands/auto-commit.ts";
import { prSuggest } from "./commands/pr-suggest.ts";
import { settings } from "./commands/settings.ts";
import { hasApiKey, updateConfig, getConfigLocation } from "./utils/config.ts";

function showHelp(): void {
  console.log(`
🤖 Git AI CLI - AI-powered Git commit and PR suggestions

Usage:
  git-ai [command]

Commands:
  auto           Smart workflow: branch → commit → push → PR (recommended)
  create-branch  Analyze changes and suggest a branch name
  auto-commit    Generate AI-powered commit message from staged changes
  pr-suggest     Generate PR title and description from branch commits
  settings       Configure AI model, reasoning effort, and other settings
  help           Show this help message

Options:
  -h, --help     Show this help message
  -v, --version  Show version

Examples:
  git-ai                 # Interactive mode
  git-ai auto            # Smart workflow (recommended for quick changes)
  git-ai create-branch   # Create branch from changes
  git-ai auto-commit     # Generate commit message
  git-ai pr-suggest      # Generate PR suggestion
  git-ai settings        # Configure settings

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
        label: "🚀 Auto Mode (Recommended)",
        hint: "Smart workflow: branch → commit → push → PR",
      },
      {
        value: "create-branch",
        label: "Create branch from changes",
        hint: "Analyze changes and suggest a branch name",
      },
      {
        value: "auto-commit",
        label: "Generate commit message",
        hint: "Analyze staged changes and suggest a commit message",
      },
      {
        value: "pr-suggest",
        label: "Generate PR title & description",
        hint: "Based on branch commits and branch name",
      },
      {
        value: "settings",
        label: "Configure settings",
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

  let action: string;

  // Direct command mode or interactive mode
  if (args.length > 0) {
    action = args[0] as string;

    // Validate command
    if (!["auto", "create-branch", "auto-commit", "pr-suggest", "settings"].includes(action)) {
      console.error(`Error: Unknown command '${action}'`);
      console.error("Run 'git-ai --help' for usage information");
      process.exit(1);
    }
  } else {
    // Interactive mode
    action = await runInteractive();
  }

  // Ensure API key is configured (skip for settings command)
  if (action !== "settings") {
    await ensureApiKey();
  }

  // Execute the command
  try {
    if (action === "auto") {
      await auto();
    } else if (action === "create-branch") {
      await createBranch();
    } else if (action === "auto-commit") {
      await autoCommit();
    } else if (action === "pr-suggest") {
      await prSuggest();
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
