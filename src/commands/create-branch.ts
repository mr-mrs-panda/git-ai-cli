import * as p from "@clack/prompts";
import { isGitRepository, getCurrentBranch } from "../utils/git.ts";
import { analyzeBranchName } from "../services/branch.ts";
import { Spinner } from "../utils/ui.ts";

export interface CreateBranchOptions {
  autoYes?: boolean;
}

export async function createBranch(options: CreateBranchOptions = {}): Promise<void> {
  const { autoYes = false } = options;
  // Check if we're in a git repository
  const isRepo = await isGitRepository();
  if (!isRepo) {
    throw new Error("Not a git repository. Please run this command in a git repository.");
  }

  const spinner = new Spinner();

  // Get current branch to show context
  const currentBranch = await getCurrentBranch();
  p.note(`You are currently on branch: ${currentBranch}`, "Current Branch");

  // Analyze changes and generate branch name
  spinner.start("Analyzing changes...");

  let suggestion;
  try {
    suggestion = await analyzeBranchName();
  } catch (error) {
    spinner.stop("Failed to analyze changes");
    throw error;
  }

  if (!suggestion) {
    spinner.stop("No changes found");
    p.note(
      "No changes detected in your working directory.\n" +
      "Make some changes first, then run this command again.",
      "Info"
    );
    return;
  }

  spinner.stop("Branch name generated");

  // Display the suggestion
  p.note(
    `Type: ${suggestion.type}\n` +
    `Name: ${suggestion.name}\n` +
    `Description: ${suggestion.description}`,
    "Suggested Branch Name"
  );

  // Ask if user wants to create the branch
  let shouldCreate = autoYes;
  let customName: string | undefined;

  if (!autoYes) {
    const response = await p.confirm({
      message: `Create branch '${suggestion.name}'?`,
      initialValue: true,
    });

    if (p.isCancel(response)) {
      p.cancel("Branch creation cancelled");
      return;
    }

    shouldCreate = response;

    if (!shouldCreate) {
      // Offer to let user customize the name
      customName = await p.text({
        message: "Enter a custom branch name (or press Ctrl+C to cancel):",
        placeholder: suggestion.name,
        validate: (value) => {
          if (!value || value.length === 0) return "Branch name is required";
          if (value.includes(" ")) return "Branch name cannot contain spaces";
          if (!/^[a-zA-Z0-9/_-]+$/.test(value)) {
            return "Branch name can only contain letters, numbers, hyphens, underscores, and slashes";
          }
        },
      }) as string;

      if (p.isCancel(customName)) {
        p.cancel("Branch creation cancelled");
        return;
      }

      suggestion.name = customName;
      shouldCreate = true;
    }
  } else {
    p.log.info(`Auto-accepting: Creating branch '${suggestion.name}'`);
  }

  if (!shouldCreate) {
    return;
  }

  // Create the branch
  spinner.start(`Creating branch '${suggestion.name}'...`);

  try {
    const proc = Bun.spawn(["git", "checkout", "-b", suggestion.name], {
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.exited;

    if (proc.exitCode !== 0) {
      const error = await new Response(proc.stderr).text();
      spinner.stop("Failed to create branch");

      // Check if branch already exists
      if (error.includes("already exists")) {
        throw new Error(`Branch '${suggestion.name}' already exists`);
      }

      throw new Error(error || "Failed to create branch");
    }

    spinner.stop(`Successfully created and switched to branch '${suggestion.name}'`);

    p.note(
      `You are now on the new branch '${suggestion.name}'.\n` +
      `Your changes are still staged and ready to commit.`,
      "Success"
    );
  } catch (error) {
    spinner.stop("Failed to create branch");
    throw error;
  }
}
