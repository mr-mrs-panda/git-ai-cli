import * as p from "@clack/prompts";
import { isGitRepository, getCurrentBranch, getBaseBranch, hasUnstagedChanges, stageAllChanges, switchToBranch, pullBranch } from "../utils/git.ts";
import { analyzeBranchName } from "../services/branch.ts";
import { generateAndCommit } from "../services/commit.ts";
import { getBranchInfo, pushToOrigin, isBranchPushed, isGitHubRepository, prExistsForBranch } from "../utils/git.ts";
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
  /**
   * YOLO mode - auto-merge PR and delete branch (implies autoYes)
   * @default false
   */
  yolo?: boolean;
}

/**
 * Helper function to checkout to base branch and pull latest changes
 */
async function checkoutAndPullBase(
  baseBranch: string,
  spinner: ReturnType<typeof p.spinner>,
  autoYes: boolean
): Promise<void> {
  p.log.step("Final: Preparing for next feature");

  let shouldCheckoutAndPull = autoYes;

  if (!autoYes) {
    const response = await p.confirm({
      message: `Checkout to ${baseBranch} and pull latest changes?`,
      initialValue: true,
    });

    if (p.isCancel(response) || !response) {
      p.note("Staying on current branch.", "Done");
      return;
    }

    shouldCheckoutAndPull = response;
  } else {
    p.log.info(`Auto-accepting: Checking out to ${baseBranch} and pulling latest changes`);
  }

  if (shouldCheckoutAndPull) {
    // Checkout to base branch
    spinner.start(`Checking out to ${baseBranch}...`);
    try {
      await switchToBranch(baseBranch);
      spinner.stop(`Switched to ${baseBranch}`);
    } catch (error) {
      spinner.stop("Failed to checkout");
      throw new Error(`Failed to checkout to ${baseBranch}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Pull latest changes
    spinner.start("Pulling latest changes...");
    try {
      await pullBranch();
      spinner.stop("Successfully pulled latest changes");
    } catch (error) {
      spinner.stop("Pull failed");
      throw new Error(`Failed to pull: ${error instanceof Error ? error.message : String(error)}`);
    }

    p.note(`Ready to start working on your next feature!`, "All set");
  }
}

/**
 * Helper function to merge PR and delete source branch
 */
async function mergePRAndDeleteBranch(
  prNumber: number,
  owner: string,
  repo: string,
  branchName: string,
  spinner: ReturnType<typeof p.spinner>
): Promise<void> {
  const githubToken = await getGitHubToken();
  if (!githubToken) {
    throw new Error("GitHub token required to merge PR");
  }

  const octokit = new Octokit({ auth: githubToken });

  // Merge the PR
  spinner.start(`Merging PR #${prNumber}...`);
  try {
    await octokit.rest.pulls.merge({
      owner,
      repo,
      pull_number: prNumber,
      merge_method: "squash",
    });
    spinner.stop(`PR #${prNumber} merged successfully!`);
    p.note(`Pull request #${prNumber} has been merged`, "Merged");
  } catch (error: any) {
    spinner.stop("Failed to merge PR");
    const message = error.response?.data?.message || error.message || String(error);
    throw new Error(`Could not merge PR: ${message}`);
  }

  // Delete the remote branch
  spinner.start(`Deleting remote branch '${branchName}'...`);
  try {
    await octokit.rest.git.deleteRef({
      owner,
      repo,
      ref: `heads/${branchName}`,
    });
    spinner.stop(`Remote branch '${branchName}' deleted`);
  } catch (error: any) {
    spinner.stop("Failed to delete remote branch");
    const message = error.response?.data?.message || error.message || String(error);
    p.note(`Warning: Could not delete remote branch: ${message}`, "Warning");
  }
}

/**
 * Helper function to create a PR for the current branch
 */
async function createPullRequest(
  workingBranch: string,
  baseBranch: string,
  spinner: ReturnType<typeof p.spinner>,
  autoYes: boolean,
  yolo: boolean = false
): Promise<{ prNumber?: number; owner?: string; repo?: string }> {
  // Get branch info for PR
  spinner.start("Analyzing commits for PR...");
  const branchInfo = await getBranchInfo();

  if (branchInfo.commits.length === 0) {
    spinner.stop("No commits found");
    p.note("No commits to create PR from.", "Info");
    return {};
  }

  spinner.stop(`Found ${branchInfo.commits.length} commit(s)`);

  // Get code diffs for better PR description
  let diffs: Array<{ path: string; status: string; diff: string }> = [];
  try {
    spinner.start("Analyzing code changes...");
    const { getBranchDiffs } = await import("../utils/git.ts");
    const allDiffs = await getBranchDiffs(baseBranch);

    // Filter out skipped files
    diffs = allDiffs
      .filter((d) => !d.skipped)
      .map((d) => ({ path: d.path, status: d.status, diff: d.diff }));

    spinner.stop(`Found ${diffs.length} file(s) with changes`);
  } catch (error) {
    // Gracefully degrade if diff retrieval fails
    spinner.stop("Could not analyze diffs, using commits only");
    diffs = [];
  }

  // Generate PR title and description
  spinner.start("Generating PR title and description with AI...");
  const { title, description } = await generatePRSuggestion(
    workingBranch,
    branchInfo.commits.map((c) => ({ message: c.message })),
    diffs.length > 0 ? diffs : undefined
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
      return {};
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
      return {};
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
      return {};
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

      // If yolo mode and PR exists, merge it
      if (yolo) {
        return { prNumber: pr.number, owner, repo };
      }

      return {};
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

    // Return PR info for potential merging
    return { prNumber: data.number, owner, repo };
  } catch (error: any) {
    spinner.stop("Failed to create Pull Request");
    const message = error.response?.data?.message || error.message || String(error);
    throw new Error(`Could not create PR: ${message}`);
  }
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
  const { autoYes = false, yolo = false } = options;
  // YOLO mode implies autoYes
  const effectiveAutoYes = yolo || autoYes;
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

  let workingBranch = currentBranch;

  // Special case: No changes, but branch is pushed and might need a PR
  if (!hasChanges) {
    const branchIsPushed = await isBranchPushed();
    const isGitHub = await isGitHubRepository();

    // Only check for PR creation if:
    // 1. We're not on the base branch
    // 2. Branch is already pushed
    // 3. It's a GitHub repository
    if (currentBranch !== baseBranch && branchIsPushed && isGitHub) {
      p.note(
        `Branch: ${currentBranch}\n` +
        `Base: ${baseBranch}\n` +
        `Status: Already pushed\n` +
        `Has changes: No`,
        "Current State"
      );

      // Check if PR already exists
      const githubToken = await getGitHubToken();
      if (githubToken) {
        spinner.start("Checking for existing PR...");
        const prCheck = await prExistsForBranch(githubToken);
        spinner.stop();

        if (prCheck.exists && prCheck.pr) {
          p.note(
            `A pull request already exists for this branch: #${prCheck.pr.number}\n${prCheck.pr.url}`,
            "PR Already Exists"
          );
          return;
        }

        // Branch is pushed but no PR exists - offer to create one
        p.log.info("Branch is pushed but no PR exists yet.");

        let shouldCreatePR = effectiveAutoYes;

        if (!effectiveAutoYes) {
          const response = await p.confirm({
            message: "Would you like to create a Pull Request now?",
            initialValue: true,
          });

          if (p.isCancel(response) || !response) {
            p.note("PR not created.", "Done");
            return;
          }

          shouldCreatePR = response;
        } else {
          p.log.info("Auto-accepting: Creating GitHub Pull Request");
        }

        if (shouldCreatePR) {
          // Jump directly to PR creation
          p.log.step("Creating Pull Request");
          const prInfo = await createPullRequest(workingBranch, baseBranch, spinner, effectiveAutoYes, yolo);

          // If yolo mode, merge the PR and delete the branch
          if (yolo && prInfo.prNumber && prInfo.owner && prInfo.repo) {
            await mergePRAndDeleteBranch(prInfo.prNumber, prInfo.owner, prInfo.repo, workingBranch, spinner);
          }

          return;
        }
      } else {
        p.note(
          "No changes detected and cannot check for PR without GitHub token.\n" +
          "Configure a token with 'git-ai settings' to enable PR creation.",
          "Nothing to do"
        );
        return;
      }
    } else {
      p.note("No changes detected. Working directory is clean.", "Nothing to do");
      return;
    }
  }

  p.note(
    `Branch: ${currentBranch}\n` +
    `Base: ${baseBranch}\n` +
    `Has changes: Yes`,
    "Current State"
  );

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

    if (!effectiveAutoYes) {
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
    confirmBeforeCommit: !effectiveAutoYes,
  });

  if (!commitMessage) {
    p.cancel("Commit cancelled");
    await checkoutAndPullBase(baseBranch, spinner, effectiveAutoYes);
    return;
  }

  // Step 3: Push to origin
  p.log.step("Step 3: Pushing to origin");

  const isPushed = await isBranchPushed();

  if (!isPushed) {
    let shouldPush = effectiveAutoYes;

    if (!effectiveAutoYes) {
      const response = await p.confirm({
        message: "Push branch to origin?",
        initialValue: true,
      });

      if (p.isCancel(response)) {
        p.note("Branch not pushed. You can push manually later.", "Done");
        await checkoutAndPullBase(baseBranch, spinner, effectiveAutoYes);
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
      await checkoutAndPullBase(baseBranch, spinner, effectiveAutoYes);
      return;
    }
  } else {
    p.log.info("Branch already up to date with origin");
  }

  // Step 4: Create PR (if GitHub repo)
  const isGitHub = await isGitHubRepository();

  if (!isGitHub) {
    p.note("Not a GitHub repository. Skipping PR creation.", "Done");
    await checkoutAndPullBase(baseBranch, spinner, effectiveAutoYes);
    return;
  }

  p.log.step("Step 4: Creating Pull Request");

  let shouldCreatePR = effectiveAutoYes;

  if (!effectiveAutoYes) {
    const response = await p.confirm({
      message: "Create GitHub Pull Request?",
      initialValue: true,
    });

    if (p.isCancel(response) || !response) {
      p.note("PR not created. You can create it manually later.", "Done");
      await checkoutAndPullBase(baseBranch, spinner, effectiveAutoYes);
      return;
    }

    shouldCreatePR = response;
  } else {
    p.log.info("Auto-accepting: Creating GitHub Pull Request");
  }

  if (!shouldCreatePR) {
    p.note("PR not created. You can create it manually later.", "Done");
    await checkoutAndPullBase(baseBranch, spinner, effectiveAutoYes);
    return;
  }

  // Use the helper function to create the PR
  const prInfo = await createPullRequest(workingBranch, baseBranch, spinner, effectiveAutoYes, yolo);

  // If yolo mode, merge the PR and delete the branch
  if (yolo && prInfo.prNumber && prInfo.owner && prInfo.repo) {
    await mergePRAndDeleteBranch(prInfo.prNumber, prInfo.owner, prInfo.repo, workingBranch, spinner);
  }

  // Final step: Checkout to base branch and pull latest changes
  await checkoutAndPullBase(baseBranch, spinner, effectiveAutoYes);
}
