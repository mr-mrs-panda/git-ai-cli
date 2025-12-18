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
  getRemoteMergedBranches,
  deleteRemoteBranch,
} from "../utils/git.ts";

export interface CleanupOptions {
  autoYes?: boolean;
}

/**
 * Cleanup merged branches
 * - Optionally switches to main/master if not already there
 * - Fetches from origin
 * - Deletes local branches that are merged in remote
 * - Only deletes branches that exist on remote (to preserve local-only branches)
 */
export async function cleanup(options: CleanupOptions = {}): Promise<void> {
  const { autoYes = false } = options;
  const spinner = p.spinner();

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

  // Filter out base branch and current branch
  const candidateBranches = localBranches.filter((branch) => branch !== baseBranch && branch !== currentBranch);

  for (const branch of candidateBranches) {
    // Only consider branches that exist on remote (to preserve local-only branches)
    const existsOnRemote = await branchExistsOnRemote(branch);

    if (!existsOnRemote) {
      remoteMissingBranches.push(branch);
      continue;
    }

    // Check if the branch is merged
    const baseRef = `origin/${baseBranch}`;
    const isMerged = (await isAncestor(branch, baseRef)) || (await isBranchMerged(branch, baseRef));

    if (isMerged) {
      branchesToDelete.push(branch);
    }
  }

  spinner.stop("Analysis complete");

  if (remoteMissingBranches.length > 0) {
    p.note(
      `Skipped ${remoteMissingBranches.length} branch(es) because they don't exist on origin:\n\n${remoteMissingBranches
        .map((b) => `  - ${b}`)
        .join("\n")}`,
      "Remote Missing"
    );
  }

  if (branchesToDelete.length === 0) {
    if (remoteMissingBranches.length === 0) {
      p.note("No merged branches found that can be safely deleted.", "Nothing to do");
      return;
    }

    if (autoYes) {
      p.note("No merged branches found.", "Nothing to do");
      return;
    }

    const confirmDeleteRemoteMissing = await p.confirm({
      message: `No merged branches found. Delete the ${remoteMissingBranches.length} origin-missing branch(es) anyway?`,
      initialValue: false,
    });

    if (p.isCancel(confirmDeleteRemoteMissing) || !confirmDeleteRemoteMissing) {
      p.note("No branches were deleted.", "Nothing to do");
      return;
    }

    branchesToDelete.push(...remoteMissingBranches);
  }

  // Step 4 (optional): Delete remote branches that are already merged
  const baseRef = `origin/${baseBranch}`;
  const remoteMergedCandidates = (await getRemoteMergedBranches(baseRef)).filter(
    (b) => b !== baseBranch
  );

  let remoteDeletedCount = 0;
  let remoteFailedCount = 0;

  if (remoteMergedCandidates.length > 0) {
    p.note(
      `Found ${remoteMergedCandidates.length} remote merged branch(es) on origin:\n\n${remoteMergedCandidates
        .map((b) => `  - origin/${b}`)
        .join("\n")}`,
      "Remote Branches"
    );

    let confirmRemoteDelete = autoYes;

    if (!autoYes) {
      const response = await p.confirm({
        message: `Also delete these remote branch(es) from origin?`,
        initialValue: false,
      });

      if (p.isCancel(response)) {
        p.cancel("Cleanup cancelled");
        process.exit(0);
      }

      confirmRemoteDelete = response;
    }

    if (confirmRemoteDelete) {
      let confirmRemoteDeleteAgain = autoYes;

      if (!autoYes) {
        const response = await p.confirm({
          message: `Really delete ${remoteMergedCandidates.length} remote branch(es) on origin? This affects the shared remote.`,
          initialValue: false,
        });

        if (p.isCancel(response) || !response) {
          p.log.info("Skipping remote branch deletion");
          confirmRemoteDeleteAgain = false;
        } else {
          confirmRemoteDeleteAgain = true;
        }
      } else {
        p.log.info("Auto-accepting: Deleting remote branches");
      }

      if (confirmRemoteDeleteAgain) {
        for (const branch of remoteMergedCandidates) {
          spinner.start(`Deleting remote 'origin/${branch}'...`);
          try {
            await deleteRemoteBranch(branch);
            spinner.stop(`Deleted remote 'origin/${branch}'`);
            remoteDeletedCount++;
          } catch (error) {
            spinner.stop(`Failed to delete remote 'origin/${branch}'`);
            p.log.warn(`Could not delete remote 'origin/${branch}': ${error instanceof Error ? error.message : String(error)}`);
            remoteFailedCount++;
          }
        }
      }
    }
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
  let deletedCount = 0;
  let failedCount = 0;

  for (const branch of branchesToDelete) {
    spinner.start(`Deleting '${branch}'...`);
    try {
      await deleteLocalBranch(branch);
      spinner.stop(`Deleted '${branch}'`);
      deletedCount++;
    } catch (error) {
      spinner.stop(`Failed to delete '${branch}'`);
      p.log.warn(
        `Could not delete '${branch}': ${error instanceof Error ? error.message : String(error)}`
      );
      failedCount++;
    }
  }

  // Summary
  if (deletedCount > 0 || remoteDeletedCount > 0) {
    p.note(
      `Local deleted: ${deletedCount}\n` +
        `Remote deleted: ${remoteDeletedCount}\n` +
        (failedCount > 0 ? `Local failed: ${failedCount}\n` : "") +
        (remoteFailedCount > 0 ? `Remote failed: ${remoteFailedCount}` : ""),
      "Cleanup Summary"
    );
  } else {
    p.note("No branches were deleted.", "Cleanup Summary");
  }
}
