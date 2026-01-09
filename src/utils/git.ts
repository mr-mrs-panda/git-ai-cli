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

    if (!status) continue;

    // For renames (R) and copies (C), pathParts has [oldPath, newPath]
    // For other operations, pathParts has [path]
    // We want the final destination path
    const path = pathParts[pathParts.length - 1];

    if (!path) continue;

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
 * Get all file changes (staged and unstaged) with their diffs
 * Combines both staged, unstaged and untracked changes into one list
 * Skips files that are too large
 *
 * @returns Array of all file changes (staged + unstaged + untracked)
 */
export async function getAllChanges(): Promise<GitFileChange[]> {
  const files: GitFileChange[] = [];
  const seenPaths = new Set<string>();

  // Get all changes (staged and unstaged) - tracked files only
  const trackedOutput = await $`git diff --name-status HEAD`.text();

  if (trackedOutput.trim()) {
    const lines = trackedOutput.trim().split("\n");

    for (const line of lines) {
      const [status, ...pathParts] = line.split("\t");

      if (!status) continue;

      // For renames (R) and copies (C), pathParts has [oldPath, newPath]
      // For other operations, pathParts has [path]
      // We want the final destination path
      const path = pathParts[pathParts.length - 1];

      if (!path || seenPaths.has(path)) continue;
      seenPaths.add(path);

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

      // Get diff for this specific file (both staged and unstaged)
      try {
        const diff = await $`git diff ${path}`.text();
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
  }

  // Also get untracked files (new files not yet added to git)
  try {
    const untrackedOutput = await $`git ls-files --others --exclude-standard`.text();

    if (untrackedOutput.trim()) {
      const untrackedLines = untrackedOutput.trim().split("\n");

      for (const path of untrackedLines) {
        if (!path || seenPaths.has(path)) continue;
        seenPaths.add(path);

        // Check file size
        const fileInfo = await getFileInfo(path, "?");

        if (fileInfo.skipped) {
          files.push({
            path,
            status: "?",
            diff: "",
            skipped: true,
            skipReason: fileInfo.skipReason,
          });
          continue;
        }

        // Try to read untracked file content as diff
        try {
          const content = await Bun.file(path).text();
          files.push({
            path,
            status: "?",
            diff: content,
            skipped: false,
          });
        } catch {
          files.push({
            path,
            status: "?",
            diff: "",
            skipped: true,
            skipReason: "Could not read file",
          });
        }
      }
    }
  } catch {
    // If untracked file listing fails, just continue with tracked files
  }

  return files;
}

/**
 * Get file changes with diffs for current branch compared to base branch
 * Similar to getStagedChanges but for branch comparison
 * Skips files that are too large or are migrations
 */
export async function getBranchDiffs(baseBranch?: string): Promise<GitFileChange[]> {
  const files: GitFileChange[] = [];
  const base = baseBranch || (await getBaseBranch());
  const currentBranch = await getCurrentBranch();

  if (currentBranch === base) {
    return [];
  }

  try {
    // Get list of changed files between branches (using three-dot notation)
    // base...HEAD = changes from merge-base to HEAD (only feature branch changes)
    const proc = Bun.spawn(
      ["git", "diff", `${base}...HEAD`, "--name-status"],
      { stdout: "pipe", stderr: "pipe" }
    );
    await proc.exited;

    if (proc.exitCode !== 0) {
      return [];
    }

    const statusOutput = await new Response(proc.stdout).text();

    if (!statusOutput.trim()) {
      return [];
    }

    const lines = statusOutput.trim().split("\n");

    for (const line of lines) {
      const [status, ...pathParts] = line.split("\t");
      const path = pathParts.join("\t");

      if (!status || !path) continue;

      // Check file size and type (reuse existing helper)
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

      // Get diff for this specific file between branches
      try {
        const diffProc = Bun.spawn(
          ["git", "diff", `${base}...HEAD`, "--", path],
          { stdout: "pipe", stderr: "pipe" }
        );
        await diffProc.exited;

        if (diffProc.exitCode === 0) {
          const diff = await new Response(diffProc.stdout).text();
          files.push({
            path,
            status,
            diff: diff.trim(),
            skipped: false,
          });
        } else {
          files.push({
            path,
            status,
            diff: "",
            skipped: true,
            skipReason: "Could not read diff",
          });
        }
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
  } catch {
    return [];
  }
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

/**
 * Check if a PR exists for the current branch
 * Requires GitHub token to check
 */
export async function prExistsForBranch(
  githubToken: string
): Promise<{ exists: boolean; pr?: { number: number; url: string } }> {
  try {
    const currentBranch = await getCurrentBranch();
    const repoInfo = await parseGitHubRepo();

    if (!repoInfo) {
      return { exists: false };
    }

    const { owner, repo } = repoInfo;

    // Dynamic import to avoid loading Octokit if not needed
    const { Octokit } = await import("octokit");
    const octokit = new Octokit({ auth: githubToken });

    const { data: existingPRs } = await octokit.rest.pulls.list({
      owner,
      repo,
      head: `${owner}:${currentBranch}`,
      state: "open",
    });

    if (existingPRs && existingPRs.length > 0 && existingPRs[0]) {
      const pr = existingPRs[0];
      return {
        exists: true,
        pr: {
          number: pr.number,
          url: pr.html_url,
        },
      };
    }

    return { exists: false };
  } catch {
    // If we can't check (no token, network error, etc.), assume PR doesn't exist
    return { exists: false };
  }
}

/**
 * Get all local branches
 */
export async function getLocalBranches(): Promise<string[]> {
  try {
    const proc = Bun.spawn(["git", "branch", "--format=%(refname:short)"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;

    if (proc.exitCode !== 0) {
      return [];
    }

    const output = await new Response(proc.stdout).text();
    return output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((b) => b.trim());
  } catch {
    return [];
  }
}

/**
 * Get remote branches (origin/*) merged into the given base ref.
 * Returns short names without the "origin/" prefix.
 */
export async function getRemoteMergedBranches(baseRef: string): Promise<string[]> {
  try {
    const proc = Bun.spawn(["git", "branch", "-r", "--merged", baseRef, "--format=%(refname:short)"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;

    if (proc.exitCode !== 0) {
      return [];
    }

    const output = await new Response(proc.stdout).text();
    return output
      .trim()
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean)
      .filter((b) => b.startsWith("origin/"))
      .filter((b) => b !== "origin/HEAD")
      .map((b) => b.replace(/^origin\//, ""));
  } catch {
    return [];
  }
}

/**
 * Delete a remote branch from origin.
 */
export async function deleteRemoteBranch(branchName: string): Promise<void> {
  const proc = Bun.spawn(["git", "push", "origin", "--delete", branchName], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;

  if (proc.exitCode !== 0) {
    const error = await new Response(proc.stderr).text();
    throw new Error(error || `Failed to delete remote branch 'origin/${branchName}'`);
  }
}

/**
 * Check if a branch exists on the remote
 */
export async function branchExistsOnRemote(branchName: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["git", "show-ref", "--verify", "--quiet", `refs/remotes/origin/${branchName}`], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;

    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Check if a branch is merged into the base branch
 */
export async function isBranchMerged(branchName: string, baseBranchOrRef?: string): Promise<boolean> {
  try {
    const base = baseBranchOrRef || (await getBaseBranch());
    const proc = Bun.spawn(["git", "branch", "--merged", base, "--format=%(refname:short)"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;

    if (proc.exitCode !== 0) {
      return false;
    }

    const output = await new Response(proc.stdout).text();
    const mergedBranches = output
      .trim()
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean);

    return mergedBranches.includes(branchName);
  } catch {
    return false;
  }
}

/**
 * Check whether `maybeAncestor` is an ancestor of `ref`.
 * Uses exit codes of `git merge-base --is-ancestor`.
 */
export async function isAncestor(maybeAncestor: string, ref: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["git", "merge-base", "--is-ancestor", maybeAncestor, ref], {
      stdout: "ignore",
      stderr: "pipe",
    });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Fetch from origin
 */
export async function fetchOrigin(): Promise<void> {
  const proc = Bun.spawn(["git", "fetch", "--prune", "origin"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;

  if (proc.exitCode !== 0) {
    const error = await new Response(proc.stderr).text();
    throw new Error(error || "Failed to fetch from origin");
  }
}

/**
 * Delete a local branch
 */
export async function deleteLocalBranch(branchName: string, force: boolean = false): Promise<void> {
  const args = force ? ["git", "branch", "-D", branchName] : ["git", "branch", "-d", branchName];

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;

  if (proc.exitCode !== 0) {
    const error = await new Response(proc.stderr).text();
    throw new Error(error || `Failed to delete branch '${branchName}'`);
  }
}

/**
 * Switch to a branch
 */
export async function switchToBranch(branchName: string): Promise<void> {
  const proc = Bun.spawn(["git", "checkout", branchName], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;

  if (proc.exitCode !== 0) {
    const error = await new Response(proc.stderr).text();
    throw new Error(error || `Failed to switch to branch '${branchName}'`);
  }
}

/**
 * Pull changes from origin for the current branch
 */
export async function pullBranch(): Promise<void> {
  const proc = Bun.spawn(["git", "pull"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;

  if (proc.exitCode !== 0) {
    const error = await new Response(proc.stderr).text();
    throw new Error(error || "Failed to pull from origin");
  }
}

/**
 * Get the latest version tag (v*.*.*)
 * Returns null if no version tags exist
 */
export async function getLatestVersionTag(): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", "tag", "-l", "v*", "--sort=-version:refname"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;

    if (proc.exitCode !== 0) {
      return null;
    }

    const output = await new Response(proc.stdout).text();
    const tags = output.trim().split("\n").filter(Boolean);

    return tags[0] || null;
  } catch {
    return null;
  }
}

/**
 * Parse version from tag (e.g., "v1.2.3" → { major: 1, minor: 2, patch: 3 })
 */
export function parseVersion(tag: string): { major: number; minor: number; patch: number } | null {
  const match = tag.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;

  return {
    major: parseInt(match[1] ?? "0", 10),
    minor: parseInt(match[2] ?? "0", 10),
    patch: parseInt(match[3] ?? "0", 10),
  };
}

/**
 * Increment version based on type
 */
export function incrementVersion(
  version: { major: number; minor: number; patch: number },
  type: "major" | "minor" | "patch"
): { major: number; minor: number; patch: number } {
  if (type === "major") {
    return { major: version.major + 1, minor: 0, patch: 0 };
  } else if (type === "minor") {
    return { major: version.major, minor: version.minor + 1, patch: 0 };
  } else {
    return { major: version.major, minor: version.minor, patch: version.patch + 1 };
  }
}

/**
 * Format version to tag string (e.g., { major: 1, minor: 2, patch: 3 } → "v1.2.3")
 */
export function formatVersionTag(version: { major: number; minor: number; patch: number }): string {
  return `v${version.major}.${version.minor}.${version.patch}`;
}

/**
 * Create a git tag
 */
export async function createTag(tag: string, message: string): Promise<void> {
  const proc = Bun.spawn(["git", "tag", "-a", tag, "-m", message], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;

  if (proc.exitCode !== 0) {
    const error = await new Response(proc.stderr).text();
    throw new Error(error || `Failed to create tag '${tag}'`);
  }
}

/**
 * Push tags to origin
 */
export async function pushTags(): Promise<void> {
  const proc = Bun.spawn(["git", "push", "--tags"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;

  if (proc.exitCode !== 0) {
    const error = await new Response(proc.stderr).text();
    throw new Error(error || "Failed to push tags");
  }
}

/**
 * Get commits since a specific tag
 */
export async function getCommitsSinceTag(tag: string): Promise<GitCommit[]> {
  try {
    const formatString = "%H|%s|%an|%ai";
    const proc = Bun.spawn(["git", "log", `${tag}..HEAD`, `--pretty=format:${formatString}`], {
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
 * Get the date of a specific tag
 */
export async function getTagDate(tag: string): Promise<Date | null> {
  try {
    const proc = Bun.spawn(["git", "log", "-1", "--format=%aI", tag], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;

    if (proc.exitCode !== 0) {
      return null;
    }

    const dateOutput = await new Response(proc.stdout).text();
    const trimmed = dateOutput.trim();

    if (!trimmed) {
      return null;
    }

    return new Date(trimmed);
  } catch {
    return null;
  }
}

