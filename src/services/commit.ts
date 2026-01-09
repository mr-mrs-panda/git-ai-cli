import * as p from "@clack/prompts";
import { getStagedChanges, stageAllChanges, getCurrentBranch } from "../utils/git.ts";
import { generateCommitMessageWithBugAnalysis as generateCommitMessage } from "../utils/openai.ts";

export interface CommitOptions {
  /**
   * Whether to show a confirmation prompt before committing
   * @default true
   */
  confirmBeforeCommit?: boolean;

  /**
   * Custom spinner instance to use for progress updates
   */
  spinner?: ReturnType<typeof p.spinner>;
}

/**
 * Generate and create an AI-powered commit with the current changes
 * This function stages changes, generates a commit message using AI, and creates the commit
 *
 * @param options - Configuration options for the commit process
 * @returns The generated commit message, or null if the commit was cancelled
 */
export async function generateAndCommit(options: CommitOptions = {}): Promise<string | null> {
  const { confirmBeforeCommit = true, spinner: externalSpinner } = options;
  const spinner = externalSpinner ?? p.spinner();
  const createdSpinner = !externalSpinner;

  try {
    // Stage all changes
    spinner.start("Staging all changes...");
    await stageAllChanges();
    spinner.stop("All changes staged");

    // Get staged changes
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

    // Generate commit message
    spinner.start("Generating commit message...");
    const commitMessage = await generateCommitMessage(
      includedChanges.map((c) => ({
        path: c.path,
        status: c.status,
        diff: c.diff,
      })),
      currentBranch
    );
    spinner.stop("Analysis complete");

    // Display the generated message
    p.note(commitMessage, "Suggested commit message");

    // Ask for confirmation if required
    if (confirmBeforeCommit) {
      const shouldCommit = await p.confirm({
        message: "Do you want to commit with this message?",
        initialValue: true,
      });

      if (p.isCancel(shouldCommit) || !shouldCommit) {
        p.cancel("Commit cancelled");
        return null;
      }
    }

    // Execute the commit
    // For multi-line messages (with body/footer), use a temporary file
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
    // Only stop the spinner if we created it
    if (createdSpinner && spinner) {
      spinner.stop();
    }
  }
}
