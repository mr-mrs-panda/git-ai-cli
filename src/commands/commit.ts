import * as p from "@clack/prompts";
import { getAllChanges, isGitRepository, hasOriginRemote, addOriginRemote, pushToOrigin, stageAllChanges, getCurrentBranch } from "../utils/git.ts";
import { generateCommitMessage } from "../utils/openai.ts";
import { Spinner } from "../utils/ui.ts";

export interface CommitOptions {
  autoYes?: boolean;
}

export async function commit(options: CommitOptions = {}): Promise<void> {
  const { autoYes = false } = options;
  // Check if we're in a git repository
  const isRepo = await isGitRepository();
  if (!isRepo) {
    throw new Error("Not a git repository. Please run this command in a git repository.");
  }

  const spinner = new Spinner();

  // Get all changes (staged, unstaged, and untracked)
  spinner.start("Analyzing all changes...");
  const allChanges = await getAllChanges();

  if (allChanges.length === 0) {
    spinner.stop("No changes found");
    p.note("No changes to commit. Working directory is clean.", "Info");
    return;
  }

  spinner.stop(`Found ${allChanges.length} file(s) with changes`);

  // Stage all changes
  spinner.start("Staging all changes...");
  await stageAllChanges();
  spinner.stop("All changes staged");

  // Filter out skipped files
  const includedChanges = allChanges.filter((c) => !c.skipped);
  const skippedChanges = allChanges.filter((c) => c.skipped);

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

  // Get current branch name for context
  const currentBranch = await getCurrentBranch();

  // Generate commit message with feedback loop
  spinner.start("Generating commit message...");

  let commitMessage: string = "";
  let userFeedback: string | undefined;
  let continueLoop = true;

  try {
    while (continueLoop) {
      // Generate commit message
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

      // In autoYes mode, accept the first suggestion
      let action: string;
      if (autoYes) {
        p.log.info("Auto-accepting: Committing with this message");
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
          return;
        }

        action = selectedAction as string;
      }

      if (action === "regenerate") {
        // Ask for feedback
        const feedback = await p.text({
          message: "What would you like to change? (e.g., 'Make it shorter', 'Add more details about why')",
          placeholder: "Provide feedback here...",
          validate: (value) => {
            if (!value || value.trim().length === 0) return "Feedback is required";
          },
        });

        if (p.isCancel(feedback)) {
          p.cancel("Commit cancelled");
          return;
        }

        userFeedback = feedback as string;
        spinner.start("Regenerating commit message with your feedback...");
        // Continue the loop
      } else if (action === "commit") {
        continueLoop = false;
      } else {
        // cancel
        p.cancel("Commit cancelled");
        return;
      }
    }
  } catch (error) {
    spinner.stop("Failed to generate commit message");
    throw error;
  }

  if (!commitMessage) {
    return;
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
  } finally {
    // Clean up temp file
    try {
      await Bun.spawn(["rm", "-f", tmpFile]).exited;
    } catch {
      // Ignore cleanup errors
    }
  }

  // Ask if user wants to push
  let shouldPush = autoYes;

  if (!autoYes) {
    const response = await p.confirm({
      message: "Do you want to push this commit?",
      initialValue: true,
    });

    if (p.isCancel(response)) {
      p.note("Commit created but not pushed.", "Done");
      return;
    }

    shouldPush = response;
  } else {
    p.log.info("Auto-accepting: Pushing to origin");
  }

  if (shouldPush) {
    spinner.start("Checking remote configuration...");
    const hasOrigin = await hasOriginRemote();

    if (!hasOrigin) {
      spinner.stop("No origin remote found");

      if (autoYes) {
        p.note("Commit created but not pushed (no origin remote configured).", "Done");
        return;
      }

      const remoteUrl = await p.text({
        message: "Enter the remote repository URL:",
        placeholder: "https://github.com/username/repo.git",
        validate: (value) => {
          if (!value) return "URL is required";
          if (!value.includes("github.com") && !value.includes("gitlab.com") && !value.includes("bitbucket.org") && !value.startsWith("git@")) {
            return "Please enter a valid git repository URL";
          }
        },
      });

      if (p.isCancel(remoteUrl)) {
        p.note("Commit created but not pushed.", "Done");
        return;
      }

      spinner.start("Adding origin remote...");
      try {
        await addOriginRemote(remoteUrl);
        spinner.stop("Origin remote added");
      } catch (error) {
        spinner.stop("Failed to add remote");
        throw new Error(`Failed to add origin remote: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      spinner.stop("Origin remote exists");
    }

    spinner.start("Pushing to origin...");
    try {
      await pushToOrigin(true);
      spinner.stop("Successfully pushed to origin!");
    } catch (error) {
      spinner.stop("Push failed");
      throw new Error(`Failed to push: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    p.note("Commit created but not pushed.", "Done");
  }
}
