import { generateBranchName } from "../utils/openai.ts";
import { getStagedChanges, hasUnstagedChanges, stageAllChanges } from "../utils/git.ts";

export interface BranchSuggestion {
  name: string;
  type: "feature" | "bugfix" | "chore" | "refactor";
  description: string;
}

/**
 * Analyze changes and generate a branch name suggestion
 *
 * @returns Branch name suggestion or null if no changes found
 */
export async function analyzeBranchName(): Promise<BranchSuggestion | null> {
  // Check if there are any changes at all
  const hasUnstaged = await hasUnstagedChanges();
  let stagedChanges = await getStagedChanges();

  // If no staged changes but there are unstaged changes, stage everything
  if (stagedChanges.length === 0 && hasUnstaged) {
    await stageAllChanges();
    stagedChanges = await getStagedChanges();
  }

  // If still no changes, return null
  if (stagedChanges.length === 0) {
    return null;
  }

  // Filter out skipped files
  const includedChanges = stagedChanges.filter((c) => !c.skipped);

  if (includedChanges.length === 0) {
    return null;
  }

  // Generate branch name using AI
  const suggestion = await generateBranchName(
    includedChanges.map((c) => ({
      path: c.path,
      status: c.status,
      diff: c.diff,
    }))
  );

  return suggestion;
}
