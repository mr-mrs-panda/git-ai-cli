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

  // Analyze changes and generate branch name with feedback loop
  spinner.start("Analyzing changes...");

  let suggestion;
  let userFeedback: string | undefined;
  let continueLoop = true;
  let finalBranchName: string = "";

  try {
    while (continueLoop) {
      // Generate branch name
      suggestion = await analyzeBranchName(userFeedback);

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

      // In autoYes mode, accept the first suggestion
      let action: string;
      if (autoYes) {
        p.log.info(`Auto-accepting: Creating branch '${suggestion.name}'`);
        action = "create";
        finalBranchName = suggestion.name;
        continueLoop = false;
      } else {
        // Ask what user wants to do
        const selectedAction = await p.select({
          message: "What would you like to do?",
          options: [
            { value: "create", label: "Create this branch" },
            { value: "regenerate", label: "Regenerate with feedback" },
            { value: "custom", label: "Enter custom name" },
            { value: "cancel", label: "Cancel" },
          ],
        });

        if (p.isCancel(selectedAction)) {
          p.cancel("Branch creation cancelled");
          return;
        }

        action = selectedAction as string;
      }

      if (action === "regenerate") {
        // Ask for feedback
        const feedback = await p.text({
          message: "What would you like to change? (e.g., 'Use shorter name', 'Should be a bugfix, not feature')",
          placeholder: "Provide feedback here...",
          validate: (value) => {
            if (!value || value.trim().length === 0) return "Feedback is required";
          },
        });

        if (p.isCancel(feedback)) {
          p.cancel("Branch creation cancelled");
          return;
        }

        userFeedback = feedback as string;
        spinner.start("Regenerating branch name with your feedback...");
        // Continue the loop
      } else if (action === "create") {
        finalBranchName = suggestion.name;
        continueLoop = false;
      } else if (action === "custom") {
        // Offer to let user customize the name
        const customName = await p.text({
          message: "Enter a custom branch name:",
          placeholder: suggestion.name,
          validate: (value) => {
            if (!value || value.length === 0) return "Branch name is required";
            if (value.includes(" ")) return "Branch name cannot contain spaces";
            if (!/^[a-zA-Z0-9/_-]+$/.test(value)) {
              return "Branch name can only contain letters, numbers, hyphens, underscores, and slashes";
            }
          },
        });

        if (p.isCancel(customName)) {
          p.cancel("Branch creation cancelled");
          return;
        }

        finalBranchName = customName as string;
        continueLoop = false;
      } else {
        // cancel
        p.cancel("Branch creation cancelled");
        return;
      }
    }
  } catch (error) {
    spinner.stop("Failed to analyze changes");
    throw error;
  }

  if (!finalBranchName) {
    return;
  }

  // Create the branch
  spinner.start(`Creating branch '${finalBranchName}'...`);

  try {
    const proc = Bun.spawn(["git", "checkout", "-b", finalBranchName], {
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.exited;

    if (proc.exitCode !== 0) {
      const error = await new Response(proc.stderr).text();
      spinner.stop("Failed to create branch");

      // Check if branch already exists
      if (error.includes("already exists")) {
        throw new Error(`Branch '${finalBranchName}' already exists`);
      }

      throw new Error(error || "Failed to create branch");
    }

    spinner.stop(`Successfully created and switched to branch '${finalBranchName}'`);

    p.note(
      `You are now on the new branch '${finalBranchName}'.\n` +
      `Your changes are still staged and ready to commit.`,
      "Success"
    );
  } catch (error) {
    spinner.stop("Failed to create branch");
    throw error;
  }
}
