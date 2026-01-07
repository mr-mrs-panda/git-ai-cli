import * as p from "@clack/prompts";
import { getBranchDiffs } from "../utils/git.ts";

export interface PRDiffResult {
  diffs: Array<{ path: string; status: string; diff: string }>;
  skippedCount: number;
}

/**
 * Get branch diffs for PR generation
 * Retrieves and filters diffs for use in PR title/description generation
 *
 * @param baseBranch - The base branch to compare against
 * @param spinner - Optional spinner for progress updates
 * @returns Filtered diffs ready for PR generation
 */
export async function getBranchDiffsForPR(
  baseBranch: string,
  spinner?: ReturnType<typeof p.spinner>
): Promise<PRDiffResult> {
  try {
    if (spinner) {
      spinner.start("Analyzing code changes...");
    }

    const allDiffs = await getBranchDiffs(baseBranch);

    // Filter out skipped files
    const diffs = allDiffs
      .filter((d) => !d.skipped)
      .map((d) => ({ path: d.path, status: d.status, diff: d.diff }));

    const skippedCount = allDiffs.length - diffs.length;

    if (spinner) {
      spinner.stop(`Found ${diffs.length} file(s) with changes`);
    }

    return { diffs, skippedCount };
  } catch (error) {
    // Gracefully degrade if diff retrieval fails
    if (spinner) {
      spinner.stop("Could not analyze diffs, using commits only");
    }
    return { diffs: [], skippedCount: 0 };
  }
}
