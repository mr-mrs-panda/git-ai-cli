import * as p from "@clack/prompts";
import { getStagedChanges, isGitRepository, hasUnstagedChanges, hasOriginRemote, addOriginRemote, pushToOrigin } from "../utils/git.ts";
import { generateAndCommit } from "../services/commit.ts";

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

  const spinner = p.spinner();

  // Get staged changes
  spinner.start("Analyzing staged changes...");
  let changes = await getStagedChanges();

  if (changes.length === 0) {
    spinner.stop("No staged changes found");

    // Check if there are unstaged changes
    const hasUnstaged = await hasUnstagedChanges();

    if (hasUnstaged) {
      let stageAll = autoYes;

      if (!autoYes) {
        const response = await p.confirm({
          message: "No staged changes found. Would you like to stage all changes?",
          initialValue: true,
        });

        if (p.isCancel(response)) {
          p.cancel("Commit cancelled");
          return;
        }

        stageAll = response;
      } else {
        p.log.info("Auto-accepting: Staging all changes");
      }

      if (!stageAll) {
        p.note("Use 'git add <files>' to stage specific files.", "Info");
        return;
      }
    } else {
      p.note("No changes to commit. Working directory is clean.", "Info");
      return;
    }
  }

  // Use the shared commit service
  const commitMessage = await generateAndCommit({
    confirmBeforeCommit: !autoYes,
    spinner,
  });

  if (!commitMessage) {
    return;
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
