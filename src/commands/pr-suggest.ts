import * as p from "@clack/prompts";
import { Octokit } from "octokit";
import { getBranchInfo, isGitRepository, isGitHubRepository, parseGitHubRepo, isBranchPushed, pushToOrigin, getBaseBranch, getCurrentBranch } from "../utils/git.ts";
import { generatePRSuggestion } from "../utils/openai.ts";

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

  const spinner = p.spinner();

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
  const spinner = p.spinner();

  // Check if branch is pushed
  spinner.start("Checking if branch is pushed...");
  const isPushed = await isBranchPushed();

  if (!isPushed) {
    spinner.stop("Branch not pushed to origin");

    let shouldPush = autoYes;

    if (!autoYes) {
      const response = await p.confirm({
        message: "Your branch needs to be pushed first. Push now?",
        initialValue: true,
      });

      if (p.isCancel(response)) {
        p.cancel("PR creation cancelled");
        return;
      }

      shouldPush = response;
    } else {
      p.log.info("Auto-accepting: Pushing branch to origin");
    }

    if (shouldPush) {
      spinner.start("Pushing branch to origin...");
      try {
        await pushToOrigin(true);
        spinner.stop("Branch pushed successfully");
      } catch (error) {
        spinner.stop("Failed to push branch");
        throw new Error(`Failed to push: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      p.note("Please push your branch first with: git push -u origin " + currentBranch, "Info");
      return;
    }
  } else {
    spinner.stop("Branch is up to date");
  }

  // Check for GitHub token
  let githubToken = await (await import("../utils/config.ts")).getGitHubToken();

  if (!githubToken) {
    if (autoYes) {
      p.note(
        "GitHub personal access token is required to create pull requests.\n" +
        "Please configure your token using 'git-ai settings' or set GITHUB_TOKEN environment variable.",
        "GitHub Token Missing"
      );
      return;
    }

    p.note(
      "GitHub personal access token is required to create pull requests.\n" +
      "You can create one at: https://github.com/settings/tokens\n\n" +
      "Required scopes: 'repo' (for private repos) or 'public_repo' (for public repos)",
      "GitHub Token Required"
    );

    const token = await p.text({
      message: "Enter your GitHub personal access token:",
      placeholder: "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      validate: (value) => {
        if (!value || value.length === 0) return "Token is required";
        if (!value.startsWith("ghp_") && !value.startsWith("github_pat_")) {
          return "Token should start with 'ghp_' or 'github_pat_'";
        }
      },
    });

    if (p.isCancel(token)) {
      p.cancel("PR creation cancelled");
      return;
    }

    // Save token to config
    spinner.start("Saving GitHub token to config...");
    await (await import("../utils/config.ts")).updateConfig({ githubToken: token });
    spinner.stop("GitHub token saved");

    githubToken = token;
  }

  // Parse GitHub repo info
  spinner.start("Getting repository information...");
  const repoInfo = await parseGitHubRepo();

  if (!repoInfo) {
    spinner.stop("Failed to parse repository");
    throw new Error("Could not parse GitHub repository information from origin URL");
  }

  const { owner, repo } = repoInfo;
  spinner.stop(`Repository: ${owner}/${repo}`);

  // Get base branch
  const baseBranch = await getBaseBranch();

  // Check if PR already exists for this branch
  spinner.start("Checking for existing Pull Request...");
  try {
    const octokit = new Octokit({
      auth: githubToken
    });

    // List open PRs with this head branch
    const { data: prs } = await octokit.rest.pulls.list({
      owner,
      repo,
      head: `${owner}:${currentBranch}`,
      state: "open",
    });

    if (prs && prs.length > 0 && prs[0]) {
      spinner.stop("Pull Request already exists!");
      const pr = prs[0];
      p.note(
        `A pull request for this branch already exists: #${pr.number}\n${pr.html_url}`,
        "PR already exists"
      );
      return;
    }

    // Create PR
    spinner.message("Creating Pull Request...");
    const { data } = await octokit.rest.pulls.create({
      owner,
      repo,
      title,
      body: description,
      head: currentBranch,
      base: baseBranch,
    });

    spinner.stop("Pull Request created successfully!");

    p.note(
      `Title: ${data.title}\n` +
      `URL: ${data.html_url}\n` +
      `Number: #${data.number}`,
      "Pull Request Details"
    );
  } catch (error: any) {
    spinner.stop("Failed to create Pull Request");
    const message = error.response?.data?.message || error.message || String(error);
    throw new Error(`Could not create PR: ${message}`);
  }
}
