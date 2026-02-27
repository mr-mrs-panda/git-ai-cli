import * as p from "@clack/prompts";
import {
  getAllChanges,
  getStagedChanges,
  stageAllChanges,
  stageFiles,
  unstageAll,
  getCurrentBranch,
  getCurrentCommitHash,
  type GitFileChange,
} from "../utils/git.ts";
import {
  generateCommitMessage,
  analyzeAndGroupChanges,
  type CommitGroup,
} from "../utils/openai.ts";
import { Spinner, type ClackSpinner } from "../utils/ui.ts";

export interface CommitOptions {
  /**
   * Whether to show a confirmation prompt before committing
   * @default true
   */
  confirmBeforeCommit?: boolean;

  /**
   * Custom spinner instance to use for progress updates
   */
  spinner?: ClackSpinner;

  /**
   * Create single commit instead of grouping
   * @default true
   */
  singleCommit?: boolean;

  /**
   * Auto-accept all prompts (skip confirmations)
   * @default false
   */
  autoYes?: boolean;

  /**
   * Stage all working tree changes before creating commits.
   * @default false
   */
  alwaysStageAll?: boolean;
}

export interface CommitResult {
  success: boolean;
  commits: Array<{
    message: string;
    hash: string;
    files: string[];
  }>;
  skippedGroups: number[];
}

/**
 * Generate and create AI-powered commits with all changes
 * Default behavior: multi-commit (groups changes logically)
 * Use singleCommit: true for legacy single-commit mode
 *
 * @param options - Configuration options for the commit process
 * @returns The generated commit message(s), or null if cancelled
 */
export async function generateAndCommit(options: CommitOptions = {}): Promise<string | null> {
  const { singleCommit = true } = options;

  if (singleCommit) {
    // Single-commit mode (default)
    return generateAndCommitSingle(options);
  } else {
    // Multi-commit mode (grouped commits)
    const result = await generateAndCommitMultiple(options);
    if (!result) return null;

    // Return summary of created commits
    if (result.commits.length === 0) return null;

    return result.commits
      .map((c, i) => `${i + 1}. ${c.hash.slice(0, 7)} - ${c.message.split('\n')[0]}`)
      .join('\n');
  }
}

/**
 * Multi-commit workflow: analyze, group, and create multiple logical commits
 */
async function generateAndCommitMultiple(options: CommitOptions = {}): Promise<CommitResult | null> {
  const { confirmBeforeCommit = true, spinner: externalSpinner, autoYes = false } = options;
  const spinner = new Spinner(externalSpinner);

  try {
    // Stage all changes
    spinner.start("Staging all changes...");
    await stageAllChanges();
    spinner.stop("All changes staged");

    // Get all changes to analyze
    spinner.start("Analyzing changes...");
    const changes = await getAllChanges();

    if (changes.length === 0) {
      spinner.stop("No changes to commit");
      return null;
    }

    // Filter out skipped files
    const includedChanges = changes.filter((c) => !c.skipped);
    const skippedChanges = changes.filter((c) => c.skipped);

    if (includedChanges.length === 0) {
      spinner.stop("All files were skipped");
      p.note(
        skippedChanges
          .map((c) => `  ${c.path} - ${c.skipReason}`)
          .join("\n"),
        "Skipped files"
      );
      return null;
    }

    spinner.stop(`Found ${includedChanges.length} file(s) with changes`);

    if (skippedChanges.length > 0) {
      p.log.info(`Note: ${skippedChanges.length} large/migration file(s) will be committed without AI analysis`);
    }

    // Get current branch name for context
    const currentBranch = await getCurrentBranch();

    // Analyze and group ALL changes (including large files) with AI
    // Large files are committed but their content is not sent to AI for analysis
    spinner.start("Grouping changes with AI...");
    const groupingResult = await analyzeAndGroupChanges(
      changes.map((c) => ({
        path: c.path,
        status: c.status,
        diff: c.skipped ? `[File skipped: ${c.skipReason}]` : c.diff,
      })),
      currentBranch
    );
    spinner.stop(`Identified ${groupingResult.totalGroups} logical group(s)`);

    // If only 1 group, fall back to single commit mode
    if (groupingResult.totalGroups === 1) {
      p.log.info("All changes belong to a single logical commit");
      const message = await generateAndCommitSingle(options);
      if (!message) return null;

      const hash = await getCurrentCommitHash();
      return {
        success: true,
        commits: [{
          message,
          hash,
          files: includedChanges.map(c => c.path),
        }],
        skippedGroups: [],
      };
    }

    // Sort groups by dependencies
    const sortedGroups = sortGroupsByDependencies(groupingResult.groups);

    // Ensure every changed file is covered by exactly one group.
    // The AI might silently omit files (especially deletions); collect them and
    // append them to the last group so nothing is left behind.
    const allGroupFiles = new Set(sortedGroups.flatMap((g) => g.files));
    const uncoveredFiles = changes.map((c) => c.path).filter((p) => !allGroupFiles.has(p));
    if (uncoveredFiles.length > 0) {
      p.log.warn(
        `${uncoveredFiles.length} file(s) not assigned to any commit group – adding to last group:\n` +
          uncoveredFiles.map((f) => `  • ${f}`).join("\n")
      );
      const lastGroup = sortedGroups[sortedGroups.length - 1];
      if (lastGroup) {
        lastGroup.files.push(...uncoveredFiles);
      }
    }

    // Display all groups
    displayGroups(sortedGroups, skippedChanges);

    // Single confirmation for all groups
    if (!autoYes && confirmBeforeCommit) {
      const response = await p.select({
        message: `Proceed with ${sortedGroups.length} commits in this order?`,
        options: [
          { value: "yes", label: "Yes, create all commits" },
          { value: "regenerate", label: "Regenerate grouping" },
          { value: "single", label: "Switch to single commit mode" },
          { value: "cancel", label: "Cancel" },
        ],
        initialValue: "yes",
      });

      if (p.isCancel(response)) {
        p.cancel("Operation cancelled");
        return null;
      }

      if (response === "cancel") {
        p.cancel("Operation cancelled");
        return null;
      }

      if (response === "single") {
        p.log.info("Switching to single commit mode");
        const message = await generateAndCommitSingle({ ...options, singleCommit: true });
        if (!message) return null;

        const hash = await getCurrentCommitHash();
        return {
          success: true,
          commits: [{
            message,
            hash,
            files: includedChanges.map(c => c.path),
          }],
          skippedGroups: [],
        };
      }

      if (response === "regenerate") {
        p.log.info("Regenerating grouping...");
        // Recursively call to regenerate
        return generateAndCommitMultiple(options);
      }
    } else if (autoYes) {
      p.log.info(`Auto-accepting: Proceeding with ${sortedGroups.length} commits`);
    }

    // Create commits sequentially
    const result: CommitResult = {
      success: true,
      commits: [],
      skippedGroups: [],
    };

    for (let i = 0; i < sortedGroups.length; i++) {
      const group = sortedGroups[i];
      if (!group) continue;

      try {
        const commitInfo = await commitGroup(
          group,
          includedChanges,
          skippedChanges,
          currentBranch,
          i,
          sortedGroups.length,
          spinner,
          autoYes
        );

        if (commitInfo) {
          result.commits.push({
            message: commitInfo.message,
            hash: commitInfo.hash,
            files: group.files,
          });
          p.log.success(`${commitInfo.hash.slice(0, 7)} - ${commitInfo.message.split('\n')[0]}`);
        } else {
          result.skippedGroups.push(group.id);
        }
      } catch (error) {
        spinner.stop("Commit failed");
        p.log.error(`Failed to create commit for group ${group.id}: ${error instanceof Error ? error.message : String(error)}`);
        result.success = false;
        break;
      }
    }

    // Display summary
    if (result.commits.length > 0) {
      p.log.success(`\nSuccessfully created ${result.commits.length} commit(s)!`);
    }

    // Safety-net: stage and commit any changes that slipped through all groups.
    // This can happen when git rm --cached fails silently or the grouping missed a file.
    if (result.success) {
      spinner.start("Checking for uncommitted changes...");
      await stageAllChanges();
      const leftover = await getStagedChanges();
      if (leftover.length > 0) {
        spinner.stop(`Found ${leftover.length} uncommitted file(s) – creating cleanup commit`);
        p.log.warn(
          `The following file(s) were not committed in any group and will be bundled into a cleanup commit:\n` +
            leftover.map((c) => `  • ${c.path} (${c.status})`).join("\n")
        );
        const tmpFile = `/tmp/git-ai-cleanup-${Date.now()}.txt`;
        try {
          await Bun.write(tmpFile, "chore: stage remaining uncommitted changes from grouped commit");
          const proc = Bun.spawn(["git", "commit", "-F", tmpFile], {
            stdout: "pipe",
            stderr: "pipe",
          });
          await proc.exited;
          if (proc.exitCode !== 0) {
            const error = await new Response(proc.stderr).text();
            p.log.error(`Cleanup commit failed: ${error}`);
          } else {
            const hash = await getCurrentCommitHash();
            p.log.success(`${hash.slice(0, 7)} - chore: stage remaining uncommitted changes from grouped commit`);
          }
        } finally {
          try { await Bun.spawn(["rm", "-f", tmpFile]).exited; } catch { /* ignore */ }
        }
      } else {
        spinner.stop("All changes committed");
      }
    }

    return result;
  } catch (error) {
    spinner.stop("Operation failed");
    throw error;
  } finally {
    spinner.stopOnFinally();
  }
}

/**
 * Single-commit workflow with feedback loop
 */
async function generateAndCommitSingle(options: CommitOptions = {}): Promise<string | null> {
  const { confirmBeforeCommit = true, spinner: externalSpinner, autoYes = false, alwaysStageAll = false } = options;
  const spinner = new Spinner(externalSpinner);

  try {
    if (alwaysStageAll) {
      spinner.start("Staging all changes...");
      await stageAllChanges();
      spinner.stop("All changes staged");
    } else {
      // Check if there are already staged changes
      spinner.start("Checking for staged changes...");
      const stagedChanges = await getStagedChanges();

      if (stagedChanges.length === 0) {
        // No staged changes - stage all changes
        spinner.message("No staged changes found, staging all changes...");
        await stageAllChanges();
        spinner.stop("All changes staged");
      } else {
        // Use only staged changes
        spinner.stop(`Found ${stagedChanges.length} staged file(s)`);
      }
    }

    // Get staged changes to analyze
    spinner.start("Analyzing changes...");
    const changes = await getStagedChanges();

    if (changes.length === 0) {
      spinner.stop("No changes to commit");
      return null;
    }

    // Filter out skipped files
    const includedChanges = changes.filter((c) => !c.skipped);
    const skippedChanges = changes.filter((c) => c.skipped);

    if (includedChanges.length === 0) {
      spinner.stop("All files were skipped");
      p.note(
        skippedChanges
          .map((c) => `  ${c.path} - ${c.skipReason}`)
          .join("\n"),
        "Skipped files"
      );
      return null;
    }

    spinner.stop(`Analyzing ${includedChanges.length} file(s)`);

    // Get current branch name for context
    const currentBranch = await getCurrentBranch();

    // Feedback loop for commit message generation
    let commitMessage = "";
    let userFeedback: string | undefined;
    let continueLoop = true;

    while (continueLoop) {
      // Generate commit message
      spinner.start(userFeedback ? "Regenerating commit message with your feedback..." : "Generating commit message...");
      commitMessage = await generateCommitMessage(
        includedChanges.map((c) => ({
          path: c.path,
          status: c.status,
          diff: c.diff,
        })),
        currentBranch,
        userFeedback
      );
      spinner.stop("Message generated");

      // Display the generated message
      p.note(commitMessage, "Suggested commit message");

      // In autoYes mode, accept immediately
      let action: string;
      if (autoYes) {
        p.log.info("Auto-accepting: Creating commit");
        action = "commit";
        continueLoop = false;
      } else if (!confirmBeforeCommit) {
        // If no confirmation required, commit immediately
        action = "commit";
        continueLoop = false;
      } else {
        // Ask what user wants to do
        const selectedAction = await p.select({
          message: "What would you like to do?",
          options: [
            { value: "commit", label: "Commit with this message" },
            { value: "regenerate", label: "Regenerate with feedback" },
            { value: "cancel", label: "Cancel" },
          ],
        });

        if (p.isCancel(selectedAction)) {
          p.cancel("Commit cancelled");
          return null;
        }

        action = selectedAction as string;
      }

      if (action === "regenerate") {
        // Ask for feedback
        const feedback = await p.text({
          message: "What would you like to change? (e.g., 'Use shorter description', 'Should be a fix, not feat')",
          placeholder: "Provide feedback here...",
          validate: (value) => {
            if (!value || value.trim().length === 0) return "Feedback is required";
          },
        });

        if (p.isCancel(feedback)) {
          p.cancel("Commit cancelled");
          return null;
        }

        userFeedback = feedback as string;
        // Continue the loop
      } else if (action === "commit") {
        continueLoop = false;
      } else {
        // cancel
        p.cancel("Commit cancelled");
        return null;
      }
    }

    // Execute the commit
    spinner.start("Creating commit...");

    // Create a temporary file for the commit message
    const tmpDir = "/tmp";
    const tmpFile = `${tmpDir}/git-ai-commit-${Date.now()}.txt`;

    try {
      await Bun.write(tmpFile, commitMessage);

      const proc = Bun.spawn(["git", "commit", "-F", tmpFile], {
        stdout: "pipe",
        stderr: "pipe",
      });

      await proc.exited;

      if (proc.exitCode !== 0) {
        const error = await new Response(proc.stderr).text();
        spinner.stop("Commit failed");
        throw new Error(error || "Failed to create commit");
      }

      spinner.stop("Commit created successfully");

      if (skippedChanges.length > 0) {
        p.note(
          skippedChanges
            .map((c) => `  ${c.path} - ${c.skipReason}`)
            .join("\n"),
          "Skipped files"
        );
      }
    } finally {
      // Clean up temp file
      try {
        await Bun.spawn(["rm", "-f", tmpFile]).exited;
      } catch {
        // Ignore cleanup errors
      }
    }

    return commitMessage;
  } finally {
    spinner.stopOnFinally();
  }
}

/**
 * Display groups to user
 */
function displayGroups(groups: CommitGroup[], skippedChanges: GitFileChange[]): void {
  console.log(""); // Empty line before groups

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (!group) continue;

    const header = `Group ${i + 1} of ${groups.length}: ${group.type}${group.scope ? `(${group.scope})` : ""} - ${group.description}`;

    const filesList = group.files.map((f) => {
      const skippedFile = skippedChanges.find((s) => s.path === f);
      if (skippedFile) {
        return `  • ${f} (${skippedFile.skipReason} - content not analyzed)`;
      }
      return `  • ${f}`;
    }).join("\n");
    const content = `${filesList}\n\nReasoning: ${group.reasoning}`;

    p.note(content, header);
  }

  console.log(""); // Empty line after groups
}

/**
 * Sort groups by dependencies (topological sort)
 */
function sortGroupsByDependencies(groups: CommitGroup[]): CommitGroup[] {
  const sorted: CommitGroup[] = [];
  const visited = new Set<number>();
  const visiting = new Set<number>();

  function visit(groupId: number): void {
    if (visited.has(groupId)) return;
    if (visiting.has(groupId)) {
      // Circular dependency detected - warn but continue
      p.log.warn(`Circular dependency detected involving group ${groupId}`);
      return;
    }

    visiting.add(groupId);

    const group = groups.find((g) => g.id === groupId);
    if (!group) return;

    // Visit dependencies first
    for (const depId of group.dependencies) {
      visit(depId);
    }

    visiting.delete(groupId);
    visited.add(groupId);
    sorted.push(group);
  }

  // Visit all groups
  for (const group of groups) {
    if (!visited.has(group.id)) {
      visit(group.id);
    }
  }

  return sorted;
}

/**
 * Create a commit for a specific group
 */
async function commitGroup(
  group: CommitGroup,
  allChanges: GitFileChange[],
  skippedChanges: GitFileChange[],
  branchName: string,
  groupIndex: number,
  totalGroups: number,
  spinner: Spinner,
  autoYes: boolean
): Promise<{ message: string; hash: string } | null> {
  // Unstage all files
  await unstageAll();

  // Check which files in this group were skipped (too large for AI analysis)
  const groupSkippedFiles = skippedChanges.filter((c) => group.files.includes(c.path));

  // Stage ALL files for this group (including skipped ones - they should be committed)
  await stageFiles(group.files);

  // Filter changes for this group's files (for AI analysis)
  const groupChanges = allChanges.filter((c) => group.files.includes(c.path));

  if (groupChanges.length === 0 && groupSkippedFiles.length === 0) {
    p.log.warn(`No changes found for group ${group.id}`);
    return null;
  }

  // Generate commit message for this group
  spinner.start(`Creating commit ${groupIndex + 1} of ${totalGroups}...`);
  const commitMessage = await generateCommitMessage(
    groupChanges.map((c) => ({
      path: c.path,
      status: c.status,
      diff: c.diff,
    })),
    branchName
  );

  // Create commit
  const tmpFile = `/tmp/git-ai-commit-group-${group.id}-${Date.now()}.txt`;
  try {
    await Bun.write(tmpFile, commitMessage);

    const proc = Bun.spawn(["git", "commit", "-F", tmpFile], {
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.exited;

    if (proc.exitCode !== 0) {
      const error = await new Response(proc.stderr).text();
      throw new Error(error || "Failed to create commit");
    }

    // Get commit hash
    const hash = await getCurrentCommitHash();
    spinner.stop(`Commit ${groupIndex + 1} of ${totalGroups} created`);

    // Show large files that were committed without AI analysis
    if (groupSkippedFiles.length > 0) {
      p.note(
        groupSkippedFiles.map((c) => `  ${c.path} - ${c.skipReason} (committed anyway)`).join("\n"),
        `Files committed without AI analysis`
      );
    }

    return { message: commitMessage, hash };
  } finally {
    // Clean up temp file
    try {
      await Bun.spawn(["rm", "-f", tmpFile]).exited;
    } catch {
      // Ignore cleanup errors
    }
  }
}
