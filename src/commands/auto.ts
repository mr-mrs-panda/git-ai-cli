import * as p from "@clack/prompts";
import { isGitRepository, getCurrentBranch, getBaseBranch, hasUnstagedChanges, stageAllChanges, switchToBranch, pullBranch, fetchOrigin } from "../utils/git.ts";
import { generateAndCommit } from "../services/commit.ts";
import { getBranchInfo, pushToOrigin, isBranchPushed, isGitHubRepository, prExistsForBranch } from "../utils/git.ts";
import { generatePRSuggestion } from "../utils/openai.ts";
import { getGitHubToken, updateConfig } from "../utils/config.ts";
import { parseGitHubRepo } from "../utils/git.ts";
import { Octokit } from "octokit";
import { Spinner } from "../utils/ui.ts";

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
  /**
   * Release mode - after merge, switch to main, pull, and create release (implies yolo)
   * @default false
   */
  release?: boolean;
}

/**
 * Helper function to wait for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Helper function to checkout to base branch and pull latest changes
 */
async function checkoutAndPullBase(
  baseBranch: string,
  spinner: Spinner,
  autoYes: boolean
): Promise<void> {
  p.log.step("Final: Preparing for next feature");

  // In auto-yes mode, keep the user on the current branch.
  if (autoYes) {
    p.log.info("Auto-accepting: Staying on current branch (skipping checkout and pull)");
    return;
  }

  let shouldCheckoutAndPull = false;

  const response = await p.confirm({
    message: `Checkout to ${baseBranch} and pull latest changes?`,
    initialValue: true,
  });

  if (p.isCancel(response) || !response) {
    p.note("Staying on current branch.", "Done");
    return;
  }

  shouldCheckoutAndPull = response;

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
  spinner: Spinner
): Promise<void> {
  const githubToken = await getGitHubToken();
  if (!githubToken) {
    throw new Error("GitHub token required to merge PR");
  }

  const octokit = new Octokit({ auth: githubToken });

  // Check if the PR is a draft and convert it to ready-for-review first
  spinner.start(`Checking PR #${prNumber} status...`);
  try {
    const { data: pr } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    if (pr.draft) {
      spinner.stop(`PR #${prNumber} is a draft – converting to ready for review`);
      // GitHub REST API does not support converting draft→ready directly; use GraphQL
      await octokit.graphql(
        `mutation($pullRequestId: ID!) {
          markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
            pullRequest { isDraft }
          }
        }`,
        { pullRequestId: pr.node_id }
      );
      p.log.success(`PR #${prNumber} is now ready for review`);
    } else {
      spinner.stop(`PR #${prNumber} is ready for review`);
    }
  } catch (error: any) {
    spinner.stop("Failed to check/update PR draft status");
    const message = error.response?.data?.message || error.message || String(error);
    throw new Error(`Could not update PR draft status: ${message}`);
  }

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
 * Helper function to perform release after merge
 * Waits for GitHub to process the merge, then switches to base branch, pulls, and creates release
 */
async function performReleaseAfterMerge(
  baseBranch: string,
  spinner: Spinner
): Promise<void> {
  // Import release function
  const { createRelease } = await import("../services/release.ts");

  // Wait for GitHub to process the merge
  p.log.step("Preparing for release...");
  spinner.start("Waiting for GitHub to process merge (5 seconds)...");
  await sleep(5000);
  spinner.stop("Merge processed");

  // Switch to base branch
  spinner.start(`Switching to '${baseBranch}'...`);
  try {
    await switchToBranch(baseBranch);
    spinner.stop(`Switched to '${baseBranch}'`);
  } catch (error) {
    spinner.stop(`Failed to switch to '${baseBranch}'`);
    throw new Error(
      `Could not switch to '${baseBranch}': ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Fetch and pull with retry logic
  spinner.start("Fetching latest changes...");
  try {
    await fetchOrigin();
    spinner.stop("Fetch complete");
  } catch (error) {
    spinner.stop("Fetch failed");
    throw new Error(`Failed to fetch: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Pull with retry - sometimes the merge takes a moment to propagate
  let pullSuccess = false;
  let pullAttempts = 0;
  const maxPullAttempts = 3;

  while (!pullSuccess && pullAttempts < maxPullAttempts) {
    pullAttempts++;
    spinner.start(`Pulling latest changes (attempt ${pullAttempts}/${maxPullAttempts})...`);
    try {
      await pullBranch();
      spinner.stop("Pull complete");
      pullSuccess = true;
    } catch (error) {
      spinner.stop(`Pull attempt ${pullAttempts} failed`);
      if (pullAttempts < maxPullAttempts) {
        p.log.warn("Waiting 3 seconds before retry...");
        await sleep(3000);
      } else {
        throw new Error(`Failed to pull after ${maxPullAttempts} attempts: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Now create the release
  p.log.step("Creating Release");

  try {
    const result = await createRelease({ autoYes: true, includePRs: true });
    if (result) {
      p.note(`Release ${result.version} created successfully!${result.releaseUrl ? `\n${result.releaseUrl}` : ""}`, "Release Created");
    }
  } catch (error) {
    throw new Error(`Failed to create release: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Helper function to create a PR for the current branch
 */
async function createPullRequest(
  workingBranch: string,
  baseBranch: string,
  spinner: Spinner,
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
  const { getBranchDiffsForPR } = await import("../services/pr.ts");
  const { diffs } = await getBranchDiffsForPR(baseBranch, spinner);

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

  // Use GitHub services for PR creation
  const { ensureGitHubToken, getGitHubRepoInfo, createGitHubPullRequest } = await import("../services/github.ts");

  const githubToken = await ensureGitHubToken(autoYes);
  if (!githubToken) {
    return {};
  }

  // Get repo info
  const repoInfo = await getGitHubRepoInfo(spinner);
  if (!repoInfo) {
    throw new Error("Could not parse GitHub repository information");
  }

  const { owner, repo } = repoInfo;

  // Create PR
  const prResult = await createGitHubPullRequest({
    title,
    description,
    currentBranch: workingBranch,
    baseBranch,
    owner,
    repo,
    githubToken,
    autoYes,
  });

  if (!prResult) {
    return {};
  }

  // Return PR info for potential merging (YOLO mode)
  return { prNumber: prResult.number, owner, repo };
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
  const { autoYes = false, yolo = false, release = false } = options;
  // Release mode implies yolo (merge & delete), but NOT autoYes
  const effectiveYolo = release || yolo;
  const effectiveAutoYes = autoYes; // Only explicit --yes flag enables autoYes
  const spinner = new Spinner();

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
        spinner.stop("PR check complete");

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
          const prInfo = await createPullRequest(workingBranch, baseBranch, spinner, effectiveAutoYes, effectiveYolo);

          // If yolo mode, merge the PR and delete the branch
          if (effectiveYolo && prInfo.prNumber && prInfo.owner && prInfo.repo) {
            await mergePRAndDeleteBranch(prInfo.prNumber, prInfo.owner, prInfo.repo, workingBranch, spinner);

            // If release mode, wait and then create release
            if (release) {
              await performReleaseAfterMerge(baseBranch, spinner);
            }
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

    // Use the createBranch command with feedback loop
    const { createBranch } = await import("./create-branch.ts");

    try {
      await createBranch({ autoYes: effectiveAutoYes });
      // Get the new branch name after creation
      workingBranch = await getCurrentBranch();
    } catch (error) {
      p.cancel("Branch creation cancelled");
      return;
    }
  } else {
    p.log.info(`Already on feature branch '${currentBranch}', skipping branch creation`);
  }

  // Step 2: Stage and commit changes
  p.log.step("Step 2: Generating commit with AI");

  const commitMessage = await generateAndCommit({
    confirmBeforeCommit: !effectiveAutoYes,
    autoYes: effectiveAutoYes,
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
  const prInfo = await createPullRequest(workingBranch, baseBranch, spinner, effectiveAutoYes, effectiveYolo);

  // If yolo mode, merge the PR and delete the branch
  if (effectiveYolo && prInfo.prNumber && prInfo.owner && prInfo.repo) {
    await mergePRAndDeleteBranch(prInfo.prNumber, prInfo.owner, prInfo.repo, workingBranch, spinner);

    // If release mode, wait and then create release
    if (release) {
      await performReleaseAfterMerge(baseBranch, spinner);
      return; // Skip checkoutAndPullBase since performReleaseAfterMerge handles it
    }
  }

  // Final step: Checkout to base branch and pull latest changes
  await checkoutAndPullBase(baseBranch, spinner, effectiveAutoYes);
}
