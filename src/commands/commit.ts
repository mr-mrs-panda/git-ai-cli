import * as p from "@clack/prompts";
import { isGitRepository, hasOriginRemote, addOriginRemote, pushToOrigin } from "../utils/git.ts";
import { generateAndCommit } from "../services/commit.ts";
import { Spinner } from "../utils/ui.ts";

export interface CommitCommandOptions {
  autoYes?: boolean;
  singleCommit?: boolean;
}

export async function commit(options: CommitCommandOptions = {}): Promise<void> {
  const { autoYes = false, singleCommit = true } = options;

  // Check if we're in a git repository
  const isRepo = await isGitRepository();
  if (!isRepo) {
    throw new Error("Not a git repository. Please run this command in a git repository.");
  }

  // Show mode info
  if (!singleCommit) {
    p.log.info("Grouped commit mode enabled");
  }

  const spinner = new Spinner();

  // Generate and commit using service layer
  const result = await generateAndCommit({
    confirmBeforeCommit: true,
    spinner: spinner.getUnderlyingSpinner(),
    singleCommit,
    autoYes,
  });

  if (!result) {
    // User cancelled or no changes
    return;
  }

  // Ask if user wants to push
  let shouldPush = autoYes;

  if (!autoYes) {
    const response = await p.confirm({
      message: "Do you want to push these commits?",
      initialValue: true,
    });

    if (p.isCancel(response)) {
      p.note("Commit(s) created but not pushed.", "Done");
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
        p.note("Commit(s) created but not pushed (no origin remote configured).", "Done");
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
        p.note("Commit(s) created but not pushed.", "Done");
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
    p.note("Commit(s) created but not pushed.", "Done");
  }
}
