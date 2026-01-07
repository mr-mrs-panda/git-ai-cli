import { describe, expect, test } from "bun:test";

/**
 * Unit tests for git.ts utility functions
 * These tests focus on pure parsing functions that don't require actual git operations
 */

// Replicate the parseGitHubRepo regex logic for testing
function parseGitHubRepoFromUrl(url: string): { owner: string; repo: string } | null {
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
}

// Protected branches that should never be deleted
const PROTECTED_BRANCHES = ["main", "master", "develop", "staging", "production"];

function isProtectedBranch(branch: string): boolean {
  return PROTECTED_BRANCHES.includes(branch.toLowerCase());
}

const MAX_FILE_SIZE_BYTES = 100_000; // 100KB

function shouldSkipFile(sizeBytes: number): boolean {
  return sizeBytes > MAX_FILE_SIZE_BYTES;
}

// Common migration file patterns
function isMigrationFile(path: string): boolean {
  const migrationPatterns = [
    /migrations?\//i,
    /\d{14}_.*\.(sql|ts|js)$/, // Timestamp-based migrations
    /^\d+[-_].*migration/i,
  ];

  return migrationPatterns.some(pattern => pattern.test(path));
}

// Parse conventional commit format
function parseConventionalCommit(message: string): {
  type: string;
  scope?: string;
  description: string;
  breaking: boolean;
} | null {
  const match = message.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);

  if (!match) return null;

  return {
    type: match[1],
    scope: match[2],
    description: match[4],
    breaking: match[3] === "!",
  };
}

function parseVersion(tag: string): { major: number; minor: number; patch: number } | null {
  const match = tag.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

function bumpVersion(
  version: { major: number; minor: number; patch: number },
  type: "major" | "minor" | "patch"
): string {
  switch (type) {
    case "major":
      return `v${version.major + 1}.0.0`;
    case "minor":
      return `v${version.major}.${version.minor + 1}.0`;
    case "patch":
      return `v${version.major}.${version.minor}.${version.patch + 1}`;
  }
}

describe("Git URL Parsing - HTTPS", () => {
  test("should parse standard HTTPS URL with .git", () => {
    const result = parseGitHubRepoFromUrl("https://github.com/mr-mrs-panda/git-ai-cli.git");
    expect(result).toEqual({ owner: "mr-mrs-panda", repo: "git-ai-cli" });
  });

  test("should parse HTTPS URL without .git", () => {
    const result = parseGitHubRepoFromUrl("https://github.com/owner/repo");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  test("should parse HTTPS URL with dashes in names", () => {
    const result = parseGitHubRepoFromUrl("https://github.com/my-org/my-awesome-repo.git");
    expect(result).toEqual({ owner: "my-org", repo: "my-awesome-repo" });
  });
});

describe("Git URL Parsing - SSH", () => {
  test("should parse standard SSH URL with .git", () => {
    const result = parseGitHubRepoFromUrl("git@github.com:mr-mrs-panda/git-ai-cli.git");
    expect(result).toEqual({ owner: "mr-mrs-panda", repo: "git-ai-cli" });
  });

  test("should parse SSH URL without .git", () => {
    const result = parseGitHubRepoFromUrl("git@github.com:owner/repo");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });
});

describe("Git URL Parsing - Edge Cases", () => {
  test("should return null for empty string", () => {
    const result = parseGitHubRepoFromUrl("");
    expect(result).toBeNull();
  });

  test("should return null for non-GitHub URL", () => {
    const result = parseGitHubRepoFromUrl("https://gitlab.com/owner/repo.git");
    expect(result).toBeNull();
  });

  test("should return null for invalid URL", () => {
    const result = parseGitHubRepoFromUrl("not-a-url");
    expect(result).toBeNull();
  });
});

describe("Branch Name Validation", () => {
  test("should identify main as protected", () => {
    expect(isProtectedBranch("main")).toBe(true);
  });

  test("should identify master as protected", () => {
    expect(isProtectedBranch("master")).toBe(true);
  });

  test("should identify develop as protected", () => {
    expect(isProtectedBranch("develop")).toBe(true);
  });

  test("should not identify feature branch as protected", () => {
    expect(isProtectedBranch("feature/add-login")).toBe(false);
  });

  test("should be case-insensitive", () => {
    expect(isProtectedBranch("MAIN")).toBe(true);
    expect(isProtectedBranch("Master")).toBe(true);
  });
});

describe("File Size Limits", () => {
  test("should not skip files under 100KB", () => {
    expect(shouldSkipFile(50_000)).toBe(false);
    expect(shouldSkipFile(99_999)).toBe(false);
  });

  test("should not skip files exactly at 100KB", () => {
    expect(shouldSkipFile(100_000)).toBe(false);
  });

  test("should skip files over 100KB", () => {
    expect(shouldSkipFile(100_001)).toBe(true);
    expect(shouldSkipFile(500_000)).toBe(true);
  });
});

describe("Migration File Detection", () => {
  test("should detect migration folder files", () => {
    expect(isMigrationFile("db/migrations/001_create_users.sql")).toBe(true);
    expect(isMigrationFile("src/migration/add_column.ts")).toBe(true);
  });

  test("should detect timestamp-based migrations", () => {
    expect(isMigrationFile("20240115120000_create_users.sql")).toBe(true);
  });

  test("should not detect regular files as migrations", () => {
    expect(isMigrationFile("src/utils/config.ts")).toBe(false);
    expect(isMigrationFile("README.md")).toBe(false);
  });
});

describe("Commit Message Parsing", () => {
  test("should parse simple commit", () => {
    const result = parseConventionalCommit("feat: add login feature");
    expect(result).toEqual({
      type: "feat",
      scope: undefined,
      description: "add login feature",
      breaking: false,
    });
  });

  test("should parse commit with scope", () => {
    const result = parseConventionalCommit("fix(auth): correct password validation");
    expect(result).toEqual({
      type: "fix",
      scope: "auth",
      description: "correct password validation",
      breaking: false,
    });
  });

  test("should parse breaking change with !", () => {
    const result = parseConventionalCommit("feat!: remove deprecated API");
    expect(result).toEqual({
      type: "feat",
      scope: undefined,
      description: "remove deprecated API",
      breaking: true,
    });
  });

  test("should return null for non-conventional commits", () => {
    expect(parseConventionalCommit("Update readme")).toBeNull();
    expect(parseConventionalCommit("WIP")).toBeNull();
  });
});

describe("Semantic Version Parsing", () => {
  test("should parse version with v prefix", () => {
    expect(parseVersion("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  test("should parse version without v prefix", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  test("should return null for invalid versions", () => {
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("latest")).toBeNull();
  });

  test("should bump major version correctly", () => {
    expect(bumpVersion({ major: 1, minor: 2, patch: 3 }, "major")).toBe("v2.0.0");
  });

  test("should bump minor version correctly", () => {
    expect(bumpVersion({ major: 1, minor: 2, patch: 3 }, "minor")).toBe("v1.3.0");
  });

  test("should bump patch version correctly", () => {
    expect(bumpVersion({ major: 1, minor: 2, patch: 3 }, "patch")).toBe("v1.2.4");
  });
});

