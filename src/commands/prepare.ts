import * as p from "@clack/prompts";
import { $ } from "bun";
import {
    isGitRepository,
    getCurrentBranch,
    getBaseBranch,
    hasUnstagedChanges,
    getStagedChanges,
    stageAllChanges,
} from "../utils/git.ts";
import { generateAndCommit } from "../services/commit.ts";

export interface PrepareOptions {
    autoYes?: boolean;
}

export async function prepare(options: PrepareOptions = {}): Promise<void> {
    const { autoYes = false } = options;

    // Check if we're in a git repository
    const isRepo = await isGitRepository();
    if (!isRepo) {
        throw new Error("Not a git repository. Please run this command in a git repository.");
    }

    const spinner = p.spinner();

    // Get current branch
    const currentBranch = await getCurrentBranch();
    const baseBranch = await getBaseBranch();

    p.note(`Current branch: ${currentBranch}\nBase branch: ${baseBranch}`, "Prepare for Feature");

    // If we're already on main/master, just pull
    if (currentBranch === baseBranch) {
        spinner.start(`Pulling latest from ${baseBranch}...`);
        try {
            await $`git pull origin ${baseBranch}`.quiet();
            spinner.stop(`✓ Updated ${baseBranch}`);
            p.note("You're ready to create a new feature branch!", "Success");
        } catch (error) {
            spinner.stop("Failed to pull");
            throw new Error(`Failed to pull from ${baseBranch}`);
        }
        return;
    }

    // Check for changes (both staged and unstaged)
    const hasUnstaged = await hasUnstagedChanges();
    const stagedChanges = await getStagedChanges();

    const hasChanges = hasUnstaged || stagedChanges.length > 0;
    let performedAction: "commit" | "stash" | "discard" | "none" = "none";

    if (hasChanges) {
        p.note(
            `There are uncommitted changes on branch '${currentBranch}'`,
            "Uncommitted Changes Detected"
        );

        let action: "commit" | "stash" | "discard" | "abort";

        if (autoYes) {
            action = "abort";
            p.log.warn("Auto mode: Aborting due to uncommitted changes");
        } else {
            const response = await p.select({
                message: "What would you like to do?",
                options: [
                    {
                        value: "commit",
                        label: "Commit the changes",
                        hint: "Will commit and create a backup commit on current branch",
                    },
                    {
                        value: "stash",
                        label: "Stash the changes",
                        hint: "Temporarily save changes, prepare main, then reapply",
                    },
                    {
                        value: "discard",
                        label: "Discard the changes",
                        hint: "⚠️  This will reset your branch to HEAD (destructive)",
                    },
                    {
                        value: "abort",
                        label: "Abort the operation",
                        hint: "Keep changes as-is and cancel prepare",
                    },
                ],
            });

            if (p.isCancel(response)) {
                p.cancel("Prepare cancelled");
                return;
            }

            action = response;
        }

        if (action === "abort") {
            p.cancel("Prepare cancelled. Your changes are safe.");
            return;
        }

        if (action === "stash") {
            spinner.start("Stashing changes...");
            try {
                await $`git stash push -u -m "Auto-stashed by git-ai prepare"`.quiet();
                spinner.stop("✓ Changes stashed");
                p.log.success("Your changes have been temporarily saved");
                performedAction = "stash";
            } catch (error) {
                spinner.stop("Failed to stash changes");
                throw error;
            }
        }

        if (action === "commit") {
            spinner.start("Staging all changes...");
            await stageAllChanges();
            spinner.stop("Changes staged");

            try {
                spinner.start("Generating commit message...");
                const commitMessage = await generateAndCommit({
                    confirmBeforeCommit: false, // auto-commit since user already chose to commit
                });

                if (!commitMessage) {
                    spinner.stop("Failed to generate commit");
                    p.cancel("Prepare cancelled");
                    return;
                }

                spinner.stop("✓ Changes committed");
                p.log.success(`Committed on branch '${currentBranch}'`);
                performedAction = "commit";
            } catch (error) {
                spinner.stop("Failed to commit changes");
                throw error;
            }
        }

        if (action === "discard") {
            const confirm = await p.confirm({
                message: `Are you sure? This will discard all changes on '${currentBranch}'. This cannot be undone!`,
                initialValue: false,
            });

            if (p.isCancel(confirm) || !confirm) {
                p.cancel("Discard cancelled. Your changes are safe.");
                return;
            }

            spinner.start("Discarding changes...");
            try {
                // Reset staged changes
                await $`git reset --hard HEAD`.quiet();
                // Clean untracked files
                await $`git clean -fd`.quiet();
                spinner.stop("✓ Changes discarded");
                performedAction = "discard";
                p.log.warn("All uncommitted changes have been discarded");
            } catch (error) {
                spinner.stop("Failed to discard changes");
                throw error;
            }
        }
    }

    // Now switch to base branch and pull
    if (currentBranch !== baseBranch) {
        spinner.start(`Switching to ${baseBranch}...`);
        try {
            await $`git checkout ${baseBranch}`.quiet();
            spinner.stop(`✓ Switched to ${baseBranch}`);
        } catch (error) {
            spinner.stop(`Failed to switch to ${baseBranch}`);
            throw new Error(`Failed to checkout ${baseBranch}`);
        }
    }

    spinner.start(`Pulling latest from ${baseBranch}...`);
    try {
        await $`git pull origin ${baseBranch}`.quiet();
        spinner.stop(`✓ Updated ${baseBranch}`);
    } catch (error) {
        spinner.stop("Failed to pull");
        throw new Error(`Failed to pull from ${baseBranch}`);
    }

    // If we had stashed changes, reapply them on main
    if (performedAction === "stash") {
        spinner.start("Reapplying stashed changes on main...");
        try {
            await $`git stash pop`.quiet();
            spinner.stop("✓ Stashed changes reapplied");
            p.note(
                `You are now on ${baseBranch} with the latest changes.\nYour previous changes have been restored here.\nReady to create a new feature branch!`,
                "✓ Prepare Complete"
            );
        } catch (error) {
            spinner.stop("⚠️  Failed to reapply stashed changes");
            p.log.warn("Your changes are still in the stash. Run 'git stash pop' to restore them.");
            p.note(
                `You are now on ${baseBranch} with the latest changes.\nReady to create a new feature branch!`,
                "✓ Prepare Complete"
            );
        }
    } else {
        p.note(
            `You are now on ${baseBranch} with the latest changes.\nReady to create a new feature branch!`,
            "✓ Prepare Complete"
        );
    }
}
