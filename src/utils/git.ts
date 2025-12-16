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
    const formatString = "%H|%s|%an|%ai";
    const proc = Bun.spawn(["git", "log", `${baseBranch}..HEAD`, `--pretty=format:${formatString}`], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;

    if (proc.exitCode !== 0) {
      return [];
    }

    const logOutput = await new Response(proc.stdout).text();

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
 * Check if there are any unstaged changes or uncommitted changes
 */
export async function hasUnstagedChanges(): Promise<boolean> {
  try {
    const status = await $`git status --porcelain`.text();
    // Don't trim! The format is position-sensitive
    if (!status) {
      return false;
    }
    const lines = status.split("\n").filter(Boolean);
    return lines.some((line) => {
      if (line.length < 2) return false;
      const indexStatus = line[0];   // X in XY format
      const workTreeStatus = line[1]; // Y in XY format
      // Line format: XY filename
      // X = index status, Y = working tree status
      // Return true if:
      // 1. Working tree has changes (Y is not space)
      // 2. Index has staged changes (X is not space and not ?)
      // 3. Untracked files (??)
      return (
        line.startsWith("??") || // Untracked files
        (workTreeStatus !== " " && workTreeStatus !== undefined) || // Unstaged changes
        (indexStatus !== " " && indexStatus !== "?") // Staged but uncommitted changes
      );
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

/**
 * Check if remote 'origin' exists
 */
export async function hasOriginRemote(): Promise<boolean> {
  try {
    const remotes = await $`git remote`.text();
    return remotes.trim().split("\n").includes("origin");
  } catch {
    return false;
  }
}

/**
 * Get the current remote URL for origin (if it exists)
 */
export async function getOriginUrl(): Promise<string | null> {
  try {
    const url = await $`git remote get-url origin`.text();
    return url.trim();
  } catch {
    return null;
  }
}

/**
 * Add origin remote
 */
export async function addOriginRemote(url: string): Promise<void> {
  await $`git remote add origin ${url}`;
}

/**
 * Push current branch to origin
 */
export async function pushToOrigin(setUpstream: boolean = true): Promise<void> {
  const currentBranch = await getCurrentBranch();
  const args = setUpstream
    ? ["git", "push", "-u", "origin", currentBranch]
    : ["git", "push", "origin", currentBranch];

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  await proc.exited;

  if (proc.exitCode !== 0) {
    const error = await new Response(proc.stderr).text();
    throw new Error(error || "Failed to push to origin");
  }
}

/**
 * Check if current branch is pushed to origin
 */
export async function isBranchPushed(): Promise<boolean> {
  try {
    const currentBranch = await getCurrentBranch();
    // Check if the branch exists on the remote
    const result = await $`git ls-remote --heads origin ${currentBranch}`.text();
    if (!result.trim()) {
      return false;
    }
    // Check if local and remote are in sync
    const localCommit = await $`git rev-parse HEAD`.text();
    const remoteCommit = await $`git rev-parse origin/${currentBranch}`.text();
    return localCommit.trim() === remoteCommit.trim();
  } catch {
    return false;
  }
}

/**
 * Check if origin is a GitHub repository
 */
export async function isGitHubRepository(): Promise<boolean> {
  try {
    const url = await getOriginUrl();
    if (!url) return false;
    return url.includes("github.com");
  } catch {
    return false;
  }
}

/**
 * Parse GitHub owner and repo from origin URL
 */
export async function parseGitHubRepo(): Promise<{ owner: string; repo: string } | null> {
  try {
    const url = await getOriginUrl();
    if (!url) return null;

    // Handle both HTTPS and SSH URLs
    // HTTPS: https://github.com/owner/repo.git
    // SSH: git@github.com:owner/repo.git
    let match = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);

    if (match && match[1] && match[2]) {
      return {
        owner: match[1],
        repo: match[2],
      };
    }
    return null;
  } catch {
    return null;
  }
}
