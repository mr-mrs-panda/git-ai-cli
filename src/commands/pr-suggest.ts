import * as p from "@clack/prompts";
import { Octokit } from "octokit";
import { getBranchInfo, isGitRepository, isGitHubRepository, parseGitHubRepo, isBranchPushed, pushToOrigin, getBaseBranch, getCurrentBranch } from "../utils/git.ts";
import { generatePRSuggestion } from "../utils/openai.ts";
import { Spinner } from "../utils/ui.ts";

export interface PrSuggestOptions {
  autoYes?: boolean;
}

export async function prSuggest(options: PrSuggestOptions = {}): Promise<void> {
  const { autoYes = false } = options;

  // Check if we're in a git repository
  const isRepo = await isGitRepository();
  if (!isRepo) {
    throw new Error("Not a git repository. Please run this command in a git repository.");
  }

  // Check if we're on the main/master branch
  {
    const currentBranch = await getCurrentBranch();
    const baseBranch = await getBaseBranch();

    if (currentBranch === baseBranch) {
      p.note(
        `You are currently on the '${baseBranch}' branch.\n` +
        "Pull requests should be created from feature branches, not from the main branch.",
        "On main branch"
      );

      let shouldCreateBranch = autoYes;

      if (!autoYes) {
        const response = await p.confirm({
          message: "Would you like to create a new branch first?",
          initialValue: true,
        });

        if (p.isCancel(response)) {
          p.cancel("PR creation cancelled");
          return;
        }

        shouldCreateBranch = response;
      } else {
        p.log.info("Auto-accepting: Creating a new branch");
      }

      if (!shouldCreateBranch) {
        p.note("Please create a feature branch before creating a PR.", "Info");
        return;
      }

      // Import and use branch creation logic
      const { createBranch } = await import("./create-branch.ts");
      await createBranch();
      // Continue with PR creation flow after branch is created
    }
  }

  // Check for unstaged/uncommitted changes
  const hasUnstaged = await (await import("../utils/git.ts")).hasUnstagedChanges();
  if (hasUnstaged) {
    let shouldCommit = autoYes;

    if (!autoYes) {
      const response = await p.confirm({
        message: "You have unstaged or uncommitted changes. Would you like to commit them with AI?",
        initialValue: true,
      });
      if (p.isCancel(response)) {
        p.cancel("PR suggestion cancelled");
        return;
      }
      shouldCommit = response;
    } else {
      p.log.info("Auto-accepting: Committing changes with AI");
    }

    if (!shouldCommit) {
      p.note("Please commit and push your changes before creating a PR.", "Info");
      return;
    }

    // Use the AI-powered commit service
    const { generateAndCommit } = await import("../services/commit.ts");
    const commitMessage = await generateAndCommit({
      confirmBeforeCommit: !autoYes,
    });

    if (!commitMessage) {
      p.cancel("PR suggestion cancelled");
      return;
    }
  }

  const spinner = new Spinner();

  // Get branch info
  spinner.start("Analyzing branch commits...");

  let branchInfo;
  try {
    branchInfo = await getBranchInfo();
  } catch (error) {
    spinner.stop("Failed to analyze branch");
    throw error;
  }

  const { currentBranch, baseBranch, commits } = branchInfo;

  if (commits.length === 0) {
    spinner.stop("No commits found");
    p.note(
      `Your branch '${currentBranch}' has no commits compared to '${baseBranch}'.\n` +
      "Make some commits first before generating a PR suggestion.",
      "Info"
    );
    return;
  }

  spinner.stop(`Found ${commits.length} commit(s) on '${currentBranch}'`);

  // Get code diffs for better PR description
  const { getBranchDiffsForPR } = await import("../services/pr.ts");
  const { diffs } = await getBranchDiffsForPR(baseBranch, spinner);

  // Show branch summary
  p.note(
    [
      `Branch: ${currentBranch}`,
      `Base: ${baseBranch}`,
      `Commits: ${commits.length}`,
      "",
      "Recent commits:",
      ...commits.slice(0, 5).map((c) => `  • ${c.message}`),
      commits.length > 5 ? `  ... and ${commits.length - 5} more` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    "Branch info"
  );

  // Generate PR suggestion with feedback loop
  spinner.start("Generating PR title and description with AI...");

  let title: string = "";
  let description: string = "";
  let userFeedback: string | undefined;
  let continueLoop = true;

  try {
    while (continueLoop) {
      // Generate PR suggestion
      const result = await generatePRSuggestion(
        currentBranch,
        commits.map((c) => ({ message: c.message })),
        diffs.length > 0 ? diffs : undefined,
        userFeedback
      );

      title = result.title;
      description = result.description;

      spinner.stop("PR suggestion generated");

      // Display the generated PR info
      p.note(title, "Suggested PR Title");
      p.note(description, "Suggested PR Description");

      // Check if this is a GitHub repository
      const isGitHub = await isGitHubRepository();

      // In autoYes mode, create PR if GitHub, otherwise just show
      let action: string;
      if (autoYes) {
        if (isGitHub) {
          p.log.info("Auto-accepting: Creating GitHub Pull Request");
          action = "create-pr";
        } else {
          p.log.info("Not a GitHub repository, displaying suggestion only");
          action = "nothing";
        }
        continueLoop = false;
      } else {
        // Prepare action options
        const options: Array<{ value: string; label: string }> = [];

        if (isGitHub) {
          options.push({ value: "create-pr", label: "Create GitHub Pull Request" });
        }

        options.push(
          { value: "regenerate", label: "Regenerate with feedback" },
          { value: "copy-title", label: "Copy title to clipboard" },
          { value: "copy-desc", label: "Copy description to clipboard" },
          { value: "copy-both", label: "Copy both (formatted)" },
          { value: "nothing", label: "Nothing, just show me" }
        );

        // Ask if user wants to copy
        const selectedAction = await p.select({
          message: "What would you like to do?",
          options,
        });

        if (p.isCancel(selectedAction)) {
          return;
        }

        action = selectedAction as string;
      }

      if (action === "regenerate") {
        // Ask for feedback
        const feedback = await p.text({
          message: "What would you like to change? (e.g., 'The title should mention performance improvements')",
          placeholder: "Provide feedback here...",
          validate: (value) => {
            if (!value || value.trim().length === 0) return "Feedback is required";
          },
        });

        if (p.isCancel(feedback)) {
          return;
        }

        userFeedback = feedback as string;
        spinner.start("Regenerating PR with your feedback...");
        // Continue the loop
      } else if (action === "create-pr") {
        await createGitHubPR(title, description, currentBranch, autoYes);
        continueLoop = false;
      } else if (action === "copy-title") {
        await copyToClipboard(title);
        p.note("Title copied to clipboard!", "Success");
        continueLoop = false;
      } else if (action === "copy-desc") {
        await copyToClipboard(description);
        p.note("Description copied to clipboard!", "Success");
        continueLoop = false;
      } else if (action === "copy-both") {
        const combined = `${title}\n\n${description}`;
        await copyToClipboard(combined);
        p.note("Title and description copied to clipboard!", "Success");
        continueLoop = false;
      } else {
        // "nothing" selected
        continueLoop = false;
      }
    }
  } catch (error) {
    spinner.stop("Failed to generate PR suggestion");
    throw error;
  }
}

/**
 * Copy text to clipboard using platform-specific commands
 */
async function copyToClipboard(text: string): Promise<void> {
  const platform = process.platform;

  let command: string[];

  if (platform === "darwin") {
    // macOS
    command = ["pbcopy"];
  } else if (platform === "linux") {
    // Linux - try xclip first, fall back to xsel
    try {
      const proc = Bun.spawn(["which", "xclip"], { stdout: "pipe" });
      await proc.exited;
      if (proc.exitCode === 0) {
        command = ["xclip", "-selection", "clipboard"];
      } else {
        command = ["xsel", "--clipboard", "--input"];
      }
    } catch {
      command = ["xsel", "--clipboard", "--input"];
    }
  } else if (platform === "win32") {
    // Windows
    command = ["clip"];
  } else {
    throw new Error(`Clipboard not supported on platform: ${platform}`);
  }

  const proc = Bun.spawn(command, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(text);
  proc.stdin.end();

  await proc.exited;

  if (proc.exitCode !== 0) {
    const error = await new Response(proc.stderr).text();
    throw new Error(`Failed to copy to clipboard: ${error}`);
  }
}

/**
 * Create a GitHub Pull Request
 */
async function createGitHubPR(title: string, description: string, currentBranch: string, autoYes: boolean = false): Promise<void> {
  const { ensureBranchPushed, ensureGitHubToken, getGitHubRepoInfo, createGitHubPullRequest } = await import("../services/github.ts");

  // Ensure branch is pushed
  const pushed = await ensureBranchPushed(currentBranch, autoYes);
  if (!pushed) {
    p.cancel("PR creation cancelled");
    return;
  }

  // Ensure GitHub token is available
  const githubToken = await ensureGitHubToken(autoYes);
  if (!githubToken) {
    p.cancel("PR creation cancelled");
    return;
  }

  // Get repository info
  const repoInfo = await getGitHubRepoInfo();
  if (!repoInfo) {
    throw new Error("Could not parse GitHub repository information from origin URL");
  }

  // Get base branch
  const baseBranch = await getBaseBranch();

  // Create the PR
  await createGitHubPullRequest({
    title,
    description,
    currentBranch,
    baseBranch,
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    githubToken,
    autoYes,
  });
}
