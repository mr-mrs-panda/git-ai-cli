import * as p from "@clack/prompts";
import {
  isGitRepository,
  getCurrentBranch,
  getBaseBranch,
  switchToBranch,
  fetchOrigin,
  getLocalBranches,
  branchExistsOnRemote,
  isBranchMerged,
  isAncestor,
  deleteLocalBranch,
  hasOriginRemote,
  getWorktrees,
  removeWorktree,
  removeDirectoryRecursive,
} from "../utils/git.ts";
import { Spinner } from "../utils/ui.ts";

export interface CleanupOptions {
  autoYes?: boolean;
}

/**
 * Cleanup merged branches
 * - Optionally switches to main/master if not already there
 * - Fetches from origin
 * - Deletes local branches that are merged in remote base branch
 * - Removes worktrees for those branches before deleting branch refs
 * - Only deletes branches that exist on remote (to preserve local-only branches)
 */
export async function cleanup(options: CleanupOptions = {}): Promise<void> {
  const { autoYes = false } = options;
  const spinner = new Spinner();
  const PROTECTED_BRANCHES = new Set(["main", "master", "develop", "staging"]);

  // Check if we're in a git repository
  const isRepo = await isGitRepository();
  if (!isRepo) {
    throw new Error("Not a git repository. Please run this command in a git repository.");
  }

  const hasOrigin = await hasOriginRemote();
  if (!hasOrigin) {
    throw new Error("No 'origin' remote found. This command requires an 'origin' remote to check merged branches safely.");
  }

  p.intro("🧹 Cleanup - Delete merged branches");

  let currentBranch = await getCurrentBranch();
  const baseBranch = await getBaseBranch();

  p.note(`Current branch: ${currentBranch}\nBase branch: ${baseBranch}`, "Repository State");

  // Step 1: Ask to switch to base branch if not already there
  if (currentBranch !== baseBranch) {
    let switchBranch = autoYes;

    if (!autoYes) {
      const response = await p.confirm({
        message: `Switch to '${baseBranch}' branch before cleanup?`,
        initialValue: true,
      });

      if (p.isCancel(response)) {
        p.cancel("Cleanup cancelled");
        process.exit(0);
      }

      switchBranch = response;
    } else {
      p.log.info(`Auto-accepting: Switching to '${baseBranch}'`);
    }

    if (switchBranch) {
      spinner.start(`Switching to '${baseBranch}'...`);
      try {
        await switchToBranch(baseBranch);
        currentBranch = await getCurrentBranch();
        spinner.stop(`Switched to '${baseBranch}'`);
      } catch (error) {
        spinner.stop("Failed to switch branch");
        throw new Error(
          `Could not switch to '${baseBranch}': ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } else {
      p.log.info(`Staying on '${currentBranch}'`);
    }
  } else {
    p.log.info(`Already on '${baseBranch}'`);
  }

  // Step 2: Fetch from origin
  spinner.start("Fetching from origin...");
  try {
    await fetchOrigin();
    spinner.stop("Fetched from origin");
  } catch (error) {
    spinner.stop("Failed to fetch");
    throw new Error(`Could not fetch from origin: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Step 3: Find branches to delete
  spinner.start("Analyzing branches...");

  const localBranches = await getLocalBranches();
  const branchesToDelete: string[] = [];
  const remoteMissingBranches: string[] = [];
  const remoteMissingMergedBranches: string[] = [];
  const protectedSkippedBranches: string[] = [];

  const protectedBranches = new Set([
    ...Array.from(PROTECTED_BRANCHES),
    baseBranch.toLowerCase(),
    currentBranch.toLowerCase(),
  ]);

  const candidateBranches = localBranches.filter((branch) => {
    const isProtected = protectedBranches.has(branch.toLowerCase());
    if (isProtected) {
      protectedSkippedBranches.push(branch);
      return false;
    }
    return true;
  });

  for (const branch of candidateBranches) {
    // Determine whether the branch still exists on remote.
    const existsOnRemote = await branchExistsOnRemote(branch);

    // Branch can be safely deleted once merged into origin/base,
    // even if origin/<branch> was already deleted.
    const baseRef = `origin/${baseBranch}`;
    const isMerged = (await isAncestor(branch, baseRef)) || (await isBranchMerged(branch, baseRef));

    if (isMerged) {
      branchesToDelete.push(branch);
      if (!existsOnRemote) {
        remoteMissingMergedBranches.push(branch);
      }
      continue;
    }

    if (!existsOnRemote) {
      remoteMissingBranches.push(branch);
    }
  }

  spinner.stop("Analysis complete");

  if (protectedSkippedBranches.length > 0) {
    p.note(
      `Skipped ${protectedSkippedBranches.length} protected/current branch(es):\n\n${protectedSkippedBranches
        .map((b) => `  - ${b}`)
        .join("\n")}`,
      "Protected"
    );
  }

  if (remoteMissingMergedBranches.length > 0) {
    p.note(
      `Found ${remoteMissingMergedBranches.length} merged branch(es) that are already deleted on origin:\n\n${remoteMissingMergedBranches
        .map((b) => `  - ${b}`)
        .join("\n")}`,
      "Remote Already Deleted"
    );
  }

  if (remoteMissingBranches.length > 0) {
    p.note(
      `Skipped ${remoteMissingBranches.length} origin-missing branch(es) because they are not merged into origin/${baseBranch}:\n\n${remoteMissingBranches
        .map((b) => `  - ${b}`)
        .join("\n")}`,
      "Remote Missing"
    );
  }

  if (branchesToDelete.length === 0) {
    p.note("No merged branches found that can be safely deleted.", "Nothing to do");
    return;
  }

  // Step 4: Show branches and ask for confirmation
  p.note(
    `Found ${branchesToDelete.length} merged branch(es):\n\n${branchesToDelete.map((b) => `  - ${b}`).join("\n")}`,
    "Branches to delete"
  );

  let confirmDelete = autoYes;

  if (!autoYes) {
    const response = await p.confirm({
      message: `Delete ${branchesToDelete.length} merged branch(es)?`,
      initialValue: true,
    });

    if (p.isCancel(response) || !response) {
      p.cancel("Cleanup cancelled");
      process.exit(0);
    }

    confirmDelete = response;
  } else {
    p.log.info(`Auto-accepting: Deleting ${branchesToDelete.length} merged branch(es)`);
  }

  if (!confirmDelete) {
    p.cancel("Cleanup cancelled");
    process.exit(0);
  }

  // Step 5: Delete branches
  let localDeletedCount = 0;
  let localFailedCount = 0;
  const skippedCount = remoteMissingBranches.length + protectedSkippedBranches.length;
  let worktreesRemovedCount = 0;
  let worktreesFailedCount = 0;

  for (const branch of branchesToDelete) {
    const worktrees = (await getWorktrees()).filter((wt) => wt.branch === branch && !wt.isMain);

    for (const worktree of worktrees) {
      spinner.start(`Removing worktree '${worktree.path}' for '${branch}'...`);
      try {
        await removeWorktree(worktree.path, true);
      } catch (error) {
        p.log.warn(
          `Worktree remove failed for '${worktree.path}': ${error instanceof Error ? error.message : String(error)}`
        );
      }

      try {
        await removeDirectoryRecursive(worktree.path);
        spinner.stop(`Removed worktree '${worktree.path}'`);
        worktreesRemovedCount++;
      } catch (error) {
        spinner.stop(`Failed to remove worktree '${worktree.path}'`);
        p.log.warn(
          `Could not fully remove worktree '${worktree.path}': ${error instanceof Error ? error.message : String(error)}`
        );
        worktreesFailedCount++;
      }
    }

    spinner.start(`Deleting '${branch}'...`);
    try {
      await deleteLocalBranch(branch);
      spinner.stop(`Deleted '${branch}'`);
      localDeletedCount++;
    } catch (error) {
      try {
        await deleteLocalBranch(branch, true);
        spinner.stop(`Deleted '${branch}' (force)`);
        localDeletedCount++;
      } catch (forcedError) {
        spinner.stop(`Failed to delete '${branch}'`);
        p.log.warn(
          `Could not delete '${branch}': ${error instanceof Error ? error.message : String(error)}`
        );
        p.log.warn(
          `Forced delete failed for '${branch}': ${forcedError instanceof Error ? forcedError.message : String(forcedError)}`
        );
        localFailedCount++;
      }
    }
  }

  // Summary
  if (localDeletedCount > 0 || worktreesRemovedCount > 0 || skippedCount > 0) {
    p.note(
      `Local branches deleted: ${localDeletedCount}\n` +
      `Worktrees removed: ${worktreesRemovedCount}\n` +
      `Skipped branches: ${skippedCount}\n` +
      (localFailedCount > 0 ? `Local branch delete failed: ${localFailedCount}\n` : "") +
      (worktreesFailedCount > 0 ? `Worktree remove failed: ${worktreesFailedCount}` : ""),
      "Cleanup Summary"
    );
  } else {
    p.note("No branches were deleted.", "Cleanup Summary");
  }
}
