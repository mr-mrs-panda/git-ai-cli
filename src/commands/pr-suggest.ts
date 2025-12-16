import * as p from "@clack/prompts";
import { Octokit } from "octokit";
import { getBranchInfo, isGitRepository, isGitHubRepository, parseGitHubRepo, isBranchPushed, pushToOrigin, getBaseBranch } from "../utils/git.ts";
import { generatePRSuggestion } from "../utils/openai.ts";

export async function prSuggest(): Promise<void> {
  // Check if we're in a git repository
  const isRepo = await isGitRepository();
  if (!isRepo) {
    throw new Error("Not a git repository. Please run this command in a git repository.");
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

  // Generate PR suggestion
  spinner.start("Generating PR title and description with AI...");

  try {
    const { title, description } = await generatePRSuggestion(
      currentBranch,
      commits.map((c) => ({ message: c.message }))
    );

    spinner.stop("PR suggestion generated");

    // Display the generated PR info
    p.note(title, "Suggested PR Title");
    p.note(description, "Suggested PR Description");

    // Check if this is a GitHub repository
    const isGitHub = await isGitHubRepository();

    // Prepare action options
    const options: Array<{ value: string; label: string }> = [];

    if (isGitHub) {
      options.push({ value: "create-pr", label: "Create GitHub Pull Request" });
    }

    options.push(
      { value: "copy-title", label: "Copy title to clipboard" },
      { value: "copy-desc", label: "Copy description to clipboard" },
      { value: "copy-both", label: "Copy both (formatted)" },
      { value: "nothing", label: "Nothing, just show me" }
    );

    // Ask if user wants to copy
    const action = await p.select({
      message: "What would you like to do?",
      options,
    });

    if (p.isCancel(action)) {
      return;
    }

    if (action === "create-pr") {
      await createGitHubPR(title, description, currentBranch);
    } else if (action === "copy-title") {
      await copyToClipboard(title);
      p.note("Title copied to clipboard!", "Success");
    } else if (action === "copy-desc") {
      await copyToClipboard(description);
      p.note("Description copied to clipboard!", "Success");
    } else if (action === "copy-both") {
      const combined = `${title}\n\n${description}`;
      await copyToClipboard(combined);
      p.note("Title and description copied to clipboard!", "Success");
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
async function createGitHubPR(title: string, description: string, currentBranch: string): Promise<void> {
  const spinner = p.spinner();

  // Check if branch is pushed
  spinner.start("Checking if branch is pushed...");
  const isPushed = await isBranchPushed();

  if (!isPushed) {
    spinner.stop("Branch not pushed to origin");

    const shouldPush = await p.confirm({
      message: "Your branch needs to be pushed first. Push now?",
      initialValue: true,
    });

    if (p.isCancel(shouldPush)) {
      p.cancel("PR creation cancelled");
      return;
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
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    p.note(
      "GITHUB_TOKEN environment variable is not set.\n" +
      "Please create a personal access token at:\n" +
      "https://github.com/settings/tokens\n\n" +
      "Required scopes: 'repo' (for private repos) or 'public_repo' (for public repos)\n\n" +
      "Then set it in your environment:\n" +
      "export GITHUB_TOKEN=your_token_here",
      "GitHub Token Required"
    );
    return;
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

  // Create PR
  spinner.start("Creating Pull Request...");

  try {
    const octokit = new Octokit({
      auth: githubToken
    });

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
