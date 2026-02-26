import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as realGit from "../utils/git.ts";

type GitWorktree = { path: string; branch: string | null; isMain: boolean };

interface GitMocks {
  isGitRepository: () => Promise<boolean>;
  getCurrentBranch: () => Promise<string>;
  getBaseBranch: () => Promise<string>;
  switchToBranch: (branchName: string) => Promise<void>;
  fetchOrigin: () => Promise<void>;
  getLocalBranches: () => Promise<string[]>;
  branchExistsOnRemote: (branchName: string) => Promise<boolean>;
  isBranchMerged: (branchName: string, baseBranchOrRef?: string) => Promise<boolean>;
  isAncestor: (maybeAncestor: string, ref: string) => Promise<boolean>;
  deleteLocalBranch: (branchName: string, force?: boolean) => Promise<void>;
  hasOriginRemote: () => Promise<boolean>;
  getWorktrees: () => Promise<GitWorktree[]>;
  removeWorktree: (path: string, force?: boolean) => Promise<void>;
  removeDirectoryRecursive: (path: string) => Promise<void>;
}

function setupMocks(overrides: Partial<GitMocks> = {}) {
  const callOrder: string[] = [];
  const notes: string[] = [];
  const warns: string[] = [];

  const gitMocks: GitMocks = {
    isGitRepository: async () => true,
    getCurrentBranch: async () => "main",
    getBaseBranch: async () => "main",
    switchToBranch: async () => undefined,
    fetchOrigin: async () => undefined,
    getLocalBranches: async () => [],
    branchExistsOnRemote: async () => true,
    isBranchMerged: async () => false,
    isAncestor: async () => false,
    deleteLocalBranch: async (branchName, force = false) => {
      callOrder.push(`deleteLocalBranch:${branchName}:${force}`);
    },
    hasOriginRemote: async () => true,
    getWorktrees: async () => [],
    removeWorktree: async (path, force = false) => {
      callOrder.push(`removeWorktree:${path}:${force}`);
    },
    removeDirectoryRecursive: async (path) => {
      callOrder.push(`removeDir:${path}`);
    },
    ...overrides,
  };

  mock.module("../utils/git.ts", () => ({
    ...realGit,
    ...gitMocks,
  }));
  mock.module("../utils/ui.ts", () => ({
    Spinner: class {
      start() {}
      stop() {}
      safeStop() {}
    },
  }));
  mock.module("@clack/prompts", () => ({
    intro: () => undefined,
    note: (message: string) => {
      notes.push(message);
    },
    confirm: async () => true,
    isCancel: () => false,
    cancel: () => undefined,
    log: {
      info: () => undefined,
      warn: (message: string) => warns.push(message),
    },
  }));

  return { callOrder, notes, warns };
}

async function loadCleanup() {
  return await import(`./cleanup.ts?test=${Date.now()}-${Math.random()}`);
}

describe("cleanup command", () => {
  beforeEach(() => {
    mock.restore();
  });
  afterEach(() => {
    mock.restore();
  });

  test("deletes merged branch even when origin branch is already deleted", async () => {
    const { notes } = setupMocks({
      getLocalBranches: async () => ["main", "master", "develop", "staging", "feature/merged-remote-deleted", "feature/local-only"],
      branchExistsOnRemote: async () => false,
      isAncestor: async (branch) => branch === "feature/merged-remote-deleted",
    });
    const { cleanup } = await loadCleanup();

    await cleanup({ autoYes: true });

    expect(notes.some((n) => n.includes("Skipped 4 protected/current branch(es)"))).toBe(true);
    expect(notes.some((n) => n.includes("already deleted on origin"))).toBe(true);
    expect(notes.some((n) => n.includes("feature/merged-remote-deleted"))).toBe(true);
    expect(notes.some((n) => n.includes("feature/local-only"))).toBe(true);
    expect(notes.some((n) => n.includes("Found 1 merged branch(es)"))).toBe(true);
  });

  test("removes worktrees before deleting local branch", async () => {
    const { callOrder } = setupMocks({
      getLocalBranches: async () => ["main", "feature/one"],
      branchExistsOnRemote: async () => true,
      isAncestor: async (branch) => branch === "feature/one",
      getWorktrees: async () => [
        { path: "/tmp/repo", branch: "main", isMain: true },
        { path: "/tmp/repo-feature-one", branch: "feature/one", isMain: false },
      ],
    });
    const { cleanup } = await loadCleanup();

    await cleanup({ autoYes: true });

    expect(callOrder).toEqual([
      "removeWorktree:/tmp/repo-feature-one:true",
      "removeDir:/tmp/repo-feature-one",
      "deleteLocalBranch:feature/one:false",
    ]);
  });

  test("continues when removeWorktree fails and still runs folder fallback", async () => {
    const { callOrder, warns } = setupMocks({
      getLocalBranches: async () => ["main", "feature/one"],
      branchExistsOnRemote: async () => true,
      isAncestor: async (branch) => branch === "feature/one",
      getWorktrees: async () => [{ path: "/tmp/repo-feature-one", branch: "feature/one", isMain: false }],
      removeWorktree: async () => {
        throw new Error("worktree locked");
      },
      removeDirectoryRecursive: async (path) => {
        callOrder.push(`removeDir:${path}`);
      },
    });
    const { cleanup } = await loadCleanup();

    await cleanup({ autoYes: true });

    expect(callOrder).toEqual([
      "removeDir:/tmp/repo-feature-one",
      "deleteLocalBranch:feature/one:false",
    ]);
    expect(warns.some((w) => w.includes("Worktree remove failed"))).toBe(true);
  });

  test("force-deletes local branch when normal delete fails", async () => {
    const { callOrder } = setupMocks({
      getLocalBranches: async () => ["main", "feature/one"],
      branchExistsOnRemote: async () => true,
      isAncestor: async (branch) => branch === "feature/one",
      deleteLocalBranch: async (branch, force = false) => {
        callOrder.push(`deleteLocalBranch:${branch}:${force}`);
        if (!force) {
          throw new Error("normal delete failed");
        }
      },
    });
    const { cleanup } = await loadCleanup();

    await cleanup({ autoYes: true });

    expect(callOrder).toEqual([
      "deleteLocalBranch:feature/one:false",
      "deleteLocalBranch:feature/one:true",
    ]);
  });

  test("summary includes local/worktree/skipped counters", async () => {
    const { notes } = setupMocks({
      getLocalBranches: async () => ["main", "feature/one", "feature/local-only"],
      branchExistsOnRemote: async (branch) => branch !== "feature/local-only",
      isAncestor: async (branch) => branch === "feature/one",
      getWorktrees: async () => [{ path: "/tmp/repo-feature-one", branch: "feature/one", isMain: false }],
    });
    const { cleanup } = await loadCleanup();

    await cleanup({ autoYes: true });

    const summary = notes.find((n) => n.includes("Local branches deleted"));
    expect(summary).toBeDefined();
    expect(summary).toContain("Local branches deleted: 1");
    expect(summary).toContain("Worktrees removed: 1");
    expect(summary).toContain("Skipped branches: 2");
  });
});
