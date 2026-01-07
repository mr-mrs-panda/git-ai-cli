import * as p from "@clack/prompts";
import { Octokit } from "octokit";
import { getGitHubToken, updateConfig } from "../utils/config.ts";
import { parseGitHubRepo, pushToOrigin, isBranchPushed } from "../utils/git.ts";

export interface GitHubRepoInfo {
  owner: string;
  repo: string;
}

/**
 * Ensure GitHub token is available, prompt user if not
 *
 * @param autoYes - Whether to skip prompts and fail if token is missing
 * @returns GitHub token or null if user cancelled/autoYes and no token
 */
export async function ensureGitHubToken(autoYes: boolean = false): Promise<string | null> {
  let githubToken = await getGitHubToken();

  if (!githubToken) {
    if (autoYes) {
      p.note(
        "GitHub personal access token is required to create pull requests.\n" +
        "Please configure your token using 'git-ai settings' or set GITHUB_TOKEN environment variable.",
        "GitHub Token Missing"
      );
      return null;
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
      return null;
    }

    // Save token to config
    const spinner = p.spinner();
    spinner.start("Saving GitHub token to config...");
    await updateConfig({ githubToken: token });
    spinner.stop("GitHub token saved");

    githubToken = token;
  }

  return githubToken;
}

/**
 * Get GitHub repository information
 *
 * @param spinner - Optional spinner for progress updates
 * @returns Repository owner and name, or null if not a GitHub repo
 */
export async function getGitHubRepoInfo(
  spinner?: ReturnType<typeof p.spinner>
): Promise<GitHubRepoInfo | null> {
  if (spinner) {
    spinner.start("Getting repository information...");
  }

  const repoInfo = await parseGitHubRepo();

  if (!repoInfo) {
    if (spinner) {
      spinner.stop("Failed to parse repository");
    }
    return null;
  }

  const { owner, repo } = repoInfo;

  if (spinner) {
    spinner.stop(`Repository: ${owner}/${repo}`);
  }

  return { owner, repo };
}

/**
 * Ensure branch is pushed to remote, push if not
 *
 * @param currentBranch - Current branch name
 * @param autoYes - Whether to skip confirmation prompts
 * @param spinner - Optional spinner for progress updates
 * @returns true if branch is pushed or was successfully pushed, false if user cancelled
 */
export async function ensureBranchPushed(
  currentBranch: string,
  autoYes: boolean = false,
  spinner?: ReturnType<typeof p.spinner>
): Promise<boolean> {
  const localSpinner = spinner || p.spinner();
  const createdSpinner = !spinner;

  try {
    localSpinner.start("Checking if branch is pushed...");
    const isPushed = await isBranchPushed();

    if (!isPushed) {
      localSpinner.stop("Branch not pushed to origin");

      let shouldPush = autoYes;

      if (!autoYes) {
        const response = await p.confirm({
          message: "Your branch needs to be pushed first. Push now?",
          initialValue: true,
        });

        if (p.isCancel(response)) {
          return false;
        }

        shouldPush = response;
      } else {
        p.log.info("Auto-accepting: Pushing branch to origin");
      }

      if (shouldPush) {
        localSpinner.start("Pushing branch to origin...");
        try {
          await pushToOrigin(true);
          localSpinner.stop("Branch pushed successfully");
        } catch (error) {
          localSpinner.stop("Failed to push branch");
          throw new Error(`Failed to push: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        p.note("Please push your branch first with: git push -u origin " + currentBranch, "Info");
        return false;
      }
    } else {
      localSpinner.stop("Branch is up to date");
    }

    return true;
  } finally {
    // Only stop the spinner if we created it
    if (createdSpinner) {
      localSpinner.stop();
    }
  }
}

/**
 * Create a GitHub Pull Request
 *
 * @param params - PR creation parameters
 * @returns PR number and URL if successful, null if cancelled or failed
 */
export async function createGitHubPullRequest(params: {
  title: string;
  description: string;
  currentBranch: string;
  baseBranch: string;
  owner: string;
  repo: string;
  githubToken: string;
  autoYes?: boolean;
}): Promise<{ number: number; url: string } | null> {
  const { title, description, currentBranch, baseBranch, owner, repo, githubToken, autoYes = false } = params;

  const spinner = p.spinner();

  try {
    // Check if PR already exists for this branch
    spinner.start("Checking for existing Pull Request...");

    const octokit = new Octokit({ auth: githubToken });

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
      return { number: pr.number, url: pr.html_url };
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

    return { number: data.number, url: data.html_url };
  } catch (error: any) {
    spinner.stop("Failed to create Pull Request");
    const message = error.response?.data?.message || error.message || String(error);
    throw new Error(`Could not create PR: ${message}`);
  }
}
