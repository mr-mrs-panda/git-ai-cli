import { generateBranchName } from "../utils/openai.ts";
import { getAllChanges } from "../utils/git.ts";

export interface BranchSuggestion {
  name: string;
  type: "feature" | "bugfix" | "chore" | "refactor";
  description: string;
}

/**
 * Analyze all changes (staged and unstaged) and generate a branch name suggestion
 *
 * @param feedback - Optional user feedback to improve the branch name
 * @returns Branch name suggestion or null if no changes found
 */
export async function analyzeBranchName(feedback?: string): Promise<BranchSuggestion | null> {
  // Get all changes regardless of stage status
  const allChanges = await getAllChanges();

  if (allChanges.length === 0) {
    return null;
  }

  // Filter out skipped files
  const includedChanges = allChanges.filter((c) => !c.skipped);

  if (includedChanges.length === 0) {
    return null;
  }

  // Generate branch name using AI
  const suggestion = await generateBranchName(
    includedChanges.map((c) => ({
      path: c.path,
      status: c.status,
      diff: c.diff,
    })),
    feedback
  );

  return suggestion;
}
