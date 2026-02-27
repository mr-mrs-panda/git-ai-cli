import * as p from "@clack/prompts";
import { isGitRepository, hasOriginRemote, addOriginRemote, pushToOrigin } from "../utils/git.ts";
import { generateAndCommit } from "../services/commit.ts";
import { loadConfig } from "../utils/config.ts";
import { Spinner } from "../utils/ui.ts";

export interface CommitCommandOptions {
  autoYes?: boolean;
  singleCommit?: boolean;
}

export async function commit(options: CommitCommandOptions = {}): Promise<void> {
  const { autoYes = false, singleCommit } = options;

  // Check if we're in a git repository
  const isRepo = await isGitRepository();
  if (!isRepo) {
    throw new Error("Not a git repository. Please run this command in a git repository.");
  }

  // Show mode info
  const config = await loadConfig();
  const preferences = config.preferences;
  const commitPreferences = preferences?.commit;

  const resolvedSingleCommit = singleCommit ?? (commitPreferences?.defaultMode === "single");
  const alwaysStageAll = commitPreferences?.alwaysStageAll ?? true;
  const autoPushOnYes = commitPreferences?.autoPushOnYes ?? false;

  if (!resolvedSingleCommit) {
    p.log.info("Grouped commit mode enabled");
  }

  const spinner = new Spinner();

  // Generate and commit using service layer
  const result = await generateAndCommit({
    confirmBeforeCommit: true,
    spinner: spinner.getUnderlyingSpinner(),
    singleCommit: resolvedSingleCommit,
    autoYes,
    alwaysStageAll,
  });

  if (!result) {
    // User cancelled or no changes
    return;
  }

  // Ask if user wants to push
  // In autoYes mode, commit command should only create commits and never auto-push.
  let shouldPush = false;

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
    shouldPush = autoPushOnYes;
    p.log.info(
      shouldPush
        ? "Auto-accepting: Pushing based on your settings"
        : "Auto-accepting: Skipping push based on your settings"
    );
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
