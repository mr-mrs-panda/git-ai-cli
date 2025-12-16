import * as p from "@clack/prompts";
import { isGitRepository, getCurrentBranch, getBaseBranch, hasUnstagedChanges, stageAllChanges } from "../utils/git.ts";
import { analyzeBranchName } from "../services/branch.ts";
import { generateAndCommit } from "../services/commit.ts";
import { getBranchInfo, pushToOrigin, isBranchPushed, isGitHubRepository } from "../utils/git.ts";
import { generatePRSuggestion } from "../utils/openai.ts";
import { getGitHubToken, updateConfig } from "../utils/config.ts";
import { parseGitHubRepo } from "../utils/git.ts";
import { Octokit } from "octokit";

export interface AutoOptions {
  /**
   * Auto-accept all prompts (blind mode)
   * @default false
   */
  autoYes?: boolean;
}

/**
 * Auto mode - Intelligent workflow that determines what needs to be done
 *
 * Workflow:
 * 1. If on main/master with changes -> create branch
 * 2. Stage and commit changes
 * 3. Push to origin
 * 4. Create PR (if GitHub repo)
 */
export async function auto(options: AutoOptions = {}): Promise<void> {
  const { autoYes = false } = options;
  const spinner = p.spinner();

  // Check if we're in a git repository
  const isRepo = await isGitRepository();
  if (!isRepo) {
    throw new Error("Not a git repository. Please run this command in a git repository.");
  }

  p.intro("🤖 Auto Mode - Intelligent Git Workflow");

  // Get current state
  const currentBranch = await getCurrentBranch();
  const baseBranch = await getBaseBranch();
  const hasChanges = await hasUnstagedChanges();

  if (!hasChanges) {
    p.note("No changes detected. Working directory is clean.", "Nothing to do");
    return;
  }

  p.note(
    `Branch: ${currentBranch}\n` +
    `Base: ${baseBranch}\n` +
    `Has changes: Yes`,
    "Current State"
  );

  let workingBranch = currentBranch;

  // Step 1: Create branch if on main/master
  if (currentBranch === baseBranch) {
    p.log.step("Step 1: Creating new branch (currently on base branch)");

    spinner.start("Analyzing changes for branch name...");
    const branchSuggestion = await analyzeBranchName();

    if (!branchSuggestion) {
      spinner.stop("Failed to analyze changes");
      throw new Error("Could not analyze changes for branch name");
    }

    spinner.stop("Branch name generated");

    p.note(
      `Type: ${branchSuggestion.type}\n` +
      `Name: ${branchSuggestion.name}\n` +
      `Description: ${branchSuggestion.description}`,
      "Suggested Branch"
    );

    let shouldCreateBranch = true;

    if (!autoYes) {
      const response = await p.confirm({
        message: `Create branch '${branchSuggestion.name}'?`,
        initialValue: true,
      });

      if (p.isCancel(response) || !response) {
        p.cancel("Auto mode cancelled");
        return;
      }

      shouldCreateBranch = response;
    } else {
      p.log.info(`Auto-accepting: Creating branch '${branchSuggestion.name}'`);
    }

    spinner.start(`Creating branch '${branchSuggestion.name}'...`);
    const proc = Bun.spawn(["git", "checkout", "-b", branchSuggestion.name], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;

    if (proc.exitCode !== 0) {
      const error = await new Response(proc.stderr).text();
      spinner.stop("Failed to create branch");
      throw new Error(error || "Failed to create branch");
    }

    spinner.stop(`Created and switched to '${branchSuggestion.name}'`);
    workingBranch = branchSuggestion.name;
  } else {
    p.log.info(`Already on feature branch '${currentBranch}', skipping branch creation`);
  }

  // Step 2: Stage and commit changes
  p.log.step("Step 2: Generating commit with AI");

  const commitMessage = await generateAndCommit({
    confirmBeforeCommit: !autoYes,
  });

  if (!commitMessage) {
    p.cancel("Commit cancelled");
    return;
  }

  // Step 3: Push to origin
  p.log.step("Step 3: Pushing to origin");

  const isPushed = await isBranchPushed();

  if (!isPushed) {
    let shouldPush = autoYes;

    if (!autoYes) {
      const response = await p.confirm({
        message: "Push branch to origin?",
        initialValue: true,
      });

      if (p.isCancel(response)) {
        p.note("Branch not pushed. You can push manually later.", "Done");
        return;
      }

      shouldPush = response;
    } else {
      p.log.info("Auto-accepting: Pushing branch to origin");
    }

    if (shouldPush) {
      spinner.start("Pushing to origin...");
      try {
        await pushToOrigin(true);
        spinner.stop("Successfully pushed to origin");
      } catch (error) {
        spinner.stop("Push failed");
        throw new Error(`Failed to push: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      p.note("Branch not pushed. You can push manually later.", "Done");
      return;
    }
  } else {
    p.log.info("Branch already up to date with origin");
  }

  // Step 4: Create PR (if GitHub repo)
  const isGitHub = await isGitHubRepository();

  if (!isGitHub) {
    p.note("Not a GitHub repository. Skipping PR creation.", "Done");
    return;
  }

  p.log.step("Step 4: Creating Pull Request");

  let shouldCreatePR = autoYes;

  if (!autoYes) {
    const response = await p.confirm({
      message: "Create GitHub Pull Request?",
      initialValue: true,
    });

    if (p.isCancel(response) || !response) {
      p.note("PR not created. You can create it manually later.", "Done");
      return;
    }

    shouldCreatePR = response;
  } else {
    p.log.info("Auto-accepting: Creating GitHub Pull Request");
  }

  if (!shouldCreatePR) {
    p.note("PR not created. You can create it manually later.", "Done");
    return;
  }

  // Get branch info for PR
  spinner.start("Analyzing commits for PR...");
  const branchInfo = await getBranchInfo();

  if (branchInfo.commits.length === 0) {
    spinner.stop("No commits found");
    p.note("No commits to create PR from.", "Info");
    return;
  }

  spinner.stop(`Found ${branchInfo.commits.length} commit(s)`);

  // Generate PR title and description
  spinner.start("Generating PR title and description with AI...");
  const { title, description } = await generatePRSuggestion(
    workingBranch,
    branchInfo.commits.map((c) => ({ message: c.message }))
  );
  spinner.stop("PR suggestion generated");

  p.note(title, "PR Title");
  p.note(description, "PR Description");

  if (!autoYes) {
    const confirmPR = await p.confirm({
      message: "Create PR with this title and description?",
      initialValue: true,
    });

    if (p.isCancel(confirmPR) || !confirmPR) {
      p.note("PR not created.", "Cancelled");
      return;
    }
  } else {
    p.log.info("Auto-accepting: Creating PR with generated title and description");
  }

  // Check for GitHub token
  let githubToken = await getGitHubToken();

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

    spinner.start("Saving GitHub token...");
    await updateConfig({ githubToken: token });
    spinner.stop("GitHub token saved");

    githubToken = token;
  }

  // Get repo info
  spinner.start("Getting repository information...");
  const repoInfo = await parseGitHubRepo();

  if (!repoInfo) {
    spinner.stop("Failed to parse repository");
    throw new Error("Could not parse GitHub repository information");
  }

  const { owner, repo } = repoInfo;
  spinner.stop(`Repository: ${owner}/${repo}`);

  // Create PR
  spinner.start("Creating Pull Request...");
  try {
    const octokit = new Octokit({ auth: githubToken });

    // Check if PR already exists
    const { data: existingPRs } = await octokit.rest.pulls.list({
      owner,
      repo,
      head: `${owner}:${workingBranch}`,
      state: "open",
    });

    if (existingPRs && existingPRs.length > 0 && existingPRs[0]) {
      spinner.stop("Pull Request already exists");
      const pr = existingPRs[0];
      p.note(
        `A pull request for this branch already exists: #${pr.number}\n${pr.html_url}`,
        "PR Already Exists"
      );
      return;
    }

    // Create new PR
    const { data } = await octokit.rest.pulls.create({
      owner,
      repo,
      title,
      body: description,
      head: workingBranch,
      base: baseBranch,
    });

    spinner.stop("Pull Request created successfully!");

    p.note(
      `Title: ${data.title}\n` +
      `URL: ${data.html_url}\n` +
      `Number: #${data.number}`,
      "Pull Request Created"
    );
  } catch (error: any) {
    spinner.stop("Failed to create Pull Request");
    const message = error.response?.data?.message || error.message || String(error);
    throw new Error(`Could not create PR: ${message}`);
  }
}
