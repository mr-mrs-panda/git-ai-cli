import * as p from "@clack/prompts";
import { basename, resolve } from "node:path";
import { existsSync } from "node:fs";
import {
  isGitRepository,
  getRepositoryRoot,
  isValidBranchName,
  getLocalBranches,
  createWorktree,
} from "../utils/git.ts";
import { Spinner } from "../utils/ui.ts";

export interface WorktreeOptions {
  name?: string;
  autoYes?: boolean;
}

export function sanitizeDirectorySegment(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
}

async function openShellInDirectory(path: string): Promise<void> {
  const shell = process.env.SHELL || "bash";
  const proc = Bun.spawn([shell], {
    cwd: path,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
}

export async function createWorktreeCommand(options: WorktreeOptions = {}): Promise<void> {
  const { autoYes = false } = options;
  const spinner = new Spinner();

  const isRepo = await isGitRepository();
  if (!isRepo) {
    throw new Error("Not a git repository. Please run this command in a git repository.");
  }

  p.intro("🌳 Worktree - Create branch worktree from main");

  let branchName = options.name?.trim();

  if (!branchName) {
    if (autoYes) {
      throw new Error("Missing worktree name. Usage: git-ai worktree <name>");
    }

    const response = await p.text({
      message: "Enter worktree/branch name:",
      placeholder: "social-media-master",
      validate: (value) => {
        if (!value || !value.trim()) return "Name is required";
      },
    });

    if (p.isCancel(response)) {
      p.cancel("Worktree creation cancelled");
      process.exit(0);
    }

    branchName = String(response).trim();
  }

  if (!branchName) {
    throw new Error("Worktree name cannot be empty.");
  }

  const validBranchName = await isValidBranchName(branchName);
  if (!validBranchName) {
    throw new Error(`Invalid branch name '${branchName}'.`);
  }

  const existingBranches = await getLocalBranches();
  if (existingBranches.includes(branchName)) {
    throw new Error(`Branch '${branchName}' already exists.`);
  }

  const folderSuffix = sanitizeDirectorySegment(branchName);
  if (!folderSuffix) {
    throw new Error("Branch name does not produce a valid folder name.");
  }

  const repoRoot = await getRepositoryRoot();
  const projectName = basename(repoRoot);
  const worktreePath = resolve(repoRoot, "..", `${projectName}-${folderSuffix}`);

  if (existsSync(worktreePath)) {
    throw new Error(`Target path already exists: ${worktreePath}`);
  }

  spinner.start(`Creating worktree '${worktreePath}' with branch '${branchName}' from 'main'...`);
  try {
    await createWorktree(worktreePath, branchName, "main");
    spinner.stop(`Created worktree '${worktreePath}'`);
  } catch (error) {
    spinner.stop("Failed to create worktree");
    throw error;
  }

  p.note(
    `Branch: ${branchName}\nPath: ${worktreePath}\nBase: main`,
    "Worktree Created"
  );

  if (process.stdin.isTTY && process.stdout.isTTY) {
    p.log.info(`Opening shell in '${worktreePath}'...`);
    await openShellInDirectory(worktreePath);
    return;
  }

  p.note(`Run this command to switch:\ncd ${worktreePath}`, "Next Step");
}
