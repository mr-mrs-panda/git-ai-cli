import * as p from "@clack/prompts";
import { getStagedChanges, isGitRepository, hasUnstagedChanges, stageAllChanges } from "../utils/git.ts";
import { generateCommitMessage } from "../utils/openai.ts";

export async function autoCommit(): Promise<void> {
  // Check if we're in a git repository
  const isRepo = await isGitRepository();
  if (!isRepo) {
    throw new Error("Not a git repository. Please run this command in a git repository.");
  }

  const spinner = p.spinner();

  // Get staged changes
  spinner.start("Analyzing staged changes...");
  let changes = await getStagedChanges();

  if (changes.length === 0) {
    spinner.stop("No staged changes found");

    // Check if there are unstaged changes
    const hasUnstaged = await hasUnstagedChanges();

    if (hasUnstaged) {
      const stageAll = await p.confirm({
        message: "No staged changes found. Would you like to stage all changes?",
        initialValue: true,
      });

      if (p.isCancel(stageAll)) {
        p.cancel("Commit cancelled");
        return;
      }

      if (stageAll) {
        spinner.start("Staging all changes...");
        await stageAllChanges();
        spinner.stop("All changes staged");

        // Get staged changes again
        spinner.start("Analyzing staged changes...");
        changes = await getStagedChanges();

        if (changes.length === 0) {
          spinner.stop("No changes to commit");
          return;
        }
      } else {
        p.note("Use 'git add <files>' to stage specific files.", "Info");
        return;
      }
    } else {
      p.note("No changes to commit. Working directory is clean.", "Info");
      return;
    }
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
    return;
  }

  spinner.stop(`Found ${includedChanges.length} file(s) to analyze`);

  // Show summary
  p.note(
    [
      `Included: ${includedChanges.length} file(s)`,
      ...includedChanges.map((c) => `  ✓ ${c.path} (${c.status})`),
      skippedChanges.length > 0 ? `\nSkipped: ${skippedChanges.length} file(s)` : "",
      ...skippedChanges.map((c) => `  ⊘ ${c.path} - ${c.skipReason}`),
    ]
      .filter(Boolean)
      .join("\n"),
    "Changes summary"
  );

  // Generate commit message
  spinner.start("Generating commit message with AI...");

  try {
    const commitMessage = await generateCommitMessage(
      includedChanges.map((c) => ({
        path: c.path,
        status: c.status,
        diff: c.diff,
      }))
    );

    spinner.stop("Commit message generated");

    // Display the generated message
    p.note(commitMessage, "Suggested commit message");

    // Ask if user wants to use it
    const shouldCommit = await p.confirm({
      message: "Do you want to commit with this message?",
      initialValue: false,
    });

    if (p.isCancel(shouldCommit)) {
      p.cancel("Commit cancelled");
      return;
    }

    if (shouldCommit) {
      // Execute the commit
      spinner.start("Creating commit...");
      const proc = Bun.spawn(["git", "commit", "-m", commitMessage], {
        stdout: "pipe",
        stderr: "pipe",
      });

      await proc.exited;

      if (proc.exitCode === 0) {
        spinner.stop("Commit created successfully!");
      } else {
        const error = await new Response(proc.stderr).text();
        spinner.stop("Commit failed");
        throw new Error(error || "Failed to create commit");
      }
    } else {
      p.note("You can copy the message above and use it manually.", "Commit cancelled");
    }
  } catch (error) {
    spinner.stop("Failed to generate commit message");
    throw error;
  }
}
