import { $ } from "bun";

const MAX_FILE_SIZE_BYTES = 100_000; // 100KB - skip files larger than this

export interface GitFileChange {
  path: string;
  status: string;
  diff: string;
  skipped: boolean;
  skipReason?: string;
}

export interface GitBranchInfo {
  currentBranch: string;
  baseBranch: string;
  commits: GitCommit[];
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

/**
 * Get the current git branch name
 */
export async function getCurrentBranch(): Promise<string> {
  const result = await $`git branch --show-current`.text();
  return result.trim();
}

/**
 * Get the base branch (usually main or master)
 */
export async function getBaseBranch(): Promise<string> {
  try {
    // Check if main exists
    await $`git rev-parse --verify main`.quiet();
    return "main";
  } catch {
    try {
      // Fall back to master
      await $`git rev-parse --verify master`.quiet();
      return "master";
    } catch {
      // Default to main if neither exists
      return "main";
    }
  }
}

/**
 * Get staged file changes with their diffs
 * Skips files that are too large
 */
export async function getStagedChanges(): Promise<GitFileChange[]> {
  const files: GitFileChange[] = [];

  // Get list of staged files
  const statusOutput = await $`git diff --cached --name-status`.text();

  if (!statusOutput.trim()) {
    return [];
  }

  const lines = statusOutput.trim().split("\n");

  for (const line of lines) {
    const [status, ...pathParts] = line.split("\t");
    const path = pathParts.join("\t");

    if (!status || !path) continue;

    // Check file size
    const fileInfo = await getFileInfo(path, status);

    if (fileInfo.skipped) {
      files.push({
        path,
        status,
        diff: "",
        skipped: true,
        skipReason: fileInfo.skipReason,
      });
      continue;
    }

    // Get diff for this specific file
    try {
      const diff = await $`git diff --cached ${path}`.text();
      files.push({
        path,
        status,
        diff: diff.trim(),
        skipped: false,
      });
    } catch {
      files.push({
        path,
        status,
        diff: "",
        skipped: true,
        skipReason: "Could not read diff",
      });
    }
  }

  return files;
}

/**
 * Check if file should be skipped based on size or type
 */
async function getFileInfo(
  path: string,
  status: string
): Promise<{ skipped: boolean; skipReason?: string }> {
  // Skip deleted files
  if (status === "D") {
    return { skipped: true, skipReason: "File deleted" };
  }

  // Check for known migration patterns
  if (isMigrationFile(path)) {
    return { skipped: true, skipReason: "Migration file" };
  }

  try {
    // Check file size
    const stat = await Bun.file(path).size;

    if (stat > MAX_FILE_SIZE_BYTES) {
      return {
        skipped: true,
        skipReason: `File too large (${formatBytes(stat)})`,
      };
    }
  } catch {
    // If we can't stat the file (e.g., it's new), include it
  }

  return { skipped: false };
}

/**
 * Check if file is likely a migration file
 */
function isMigrationFile(path: string): boolean {
  const migrationPatterns = [
    /migrations?\//i,
    /\d{4}_\d{2}_\d{2}_/,
    /\d{10,}_/,
    /_migration\.(ts|js|sql)$/i,
  ];

  return migrationPatterns.some((pattern) => pattern.test(path));
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Get commits for the current branch compared to base branch
 */
export async function getBranchCommits(): Promise<GitCommit[]> {
  const baseBranch = await getBaseBranch();
  const currentBranch = await getCurrentBranch();

  if (currentBranch === baseBranch) {
    throw new Error(`You are currently on the base branch '${baseBranch}'`);
  }

  try {
    // Get commits that are in current branch but not in base branch
    const logOutput = await $`git log ${baseBranch}..HEAD --pretty=format:%H|%s|%an|%ai`.text();

    if (!logOutput.trim()) {
      return [];
    }

    return logOutput
      .trim()
      .split("\n")
      .map((line) => {
        const [hash, message, author, date] = line.split("|");
        return { hash: hash ?? "", message: message ?? "", author: author ?? "", date: date ?? "" };
      })
      .filter((commit) => commit.hash && commit.message);
  } catch {
    return [];
  }
}

/**
 * Get branch information including commits
 */
export async function getBranchInfo(): Promise<GitBranchInfo> {
  const currentBranch = await getCurrentBranch();
  const baseBranch = await getBaseBranch();
  const commits = await getBranchCommits();

  return {
    currentBranch,
    baseBranch,
    commits,
  };
}

/**
 * Check if there are any unstaged changes
 */
export async function hasUnstagedChanges(): Promise<boolean> {
  try {
    const status = await $`git status --porcelain`.text();
    // Check for lines that start with ' M', ' D', '??', etc. (not staged)
    const lines = status.trim().split("\n").filter(Boolean);
    return lines.some((line) => {
      const first = line[0];
      const second = line[1];
      // Line format: XY filename
      // X = index status, Y = working tree status
      // If Y is not space, there are unstaged changes
      return second !== " " && second !== undefined;
    });
  } catch {
    return false;
  }
}

/**
 * Stage all changes
 */
export async function stageAllChanges(): Promise<void> {
  await $`git add .`;
}

/**
 * Check if we're in a git repository
 */
export async function isGitRepository(): Promise<boolean> {
  try {
    await $`git rev-parse --git-dir`.quiet();
    return true;
  } catch {
    return false;
  }
}
