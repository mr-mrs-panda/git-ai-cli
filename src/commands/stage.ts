import * as p from "@clack/prompts";
import {
  isGitRepository,
  getUnstagedChanges,
  getStagedFilePaths,
  stageFiles,
  unstageFiles,
} from "../utils/git.ts";

export interface StageCommandOptions {
  autoYes?: boolean;
}

export async function stage(options: StageCommandOptions = {}): Promise<void> {
  const { autoYes = false } = options;

  // Check if we're in a git repository
  const isRepo = await isGitRepository();
  if (!isRepo) {
    throw new Error("Not a git repository. Please run this command in a git repository.");
  }

  // Get both staged and unstaged changes
  const stagedFilePaths = await getStagedFilePaths();
  const unstagedFiles = await getUnstagedChanges();

  // Create a map of all files with their status
  const allFilesMap = new Map<string, { status: string; isStaged: boolean }>();

  // Add staged files
  for (const path of stagedFilePaths) {
    allFilesMap.set(path, { status: "STAGED", isStaged: true });
  }

  // Add unstaged files (they might already be in the map if they have both staged and unstaged changes)
  for (const file of unstagedFiles) {
    const existing = allFilesMap.get(file.path);
    if (existing) {
      // File has both staged and unstaged changes
      allFilesMap.set(file.path, {
        status: `${existing.status}+UNSTAGED`,
        isStaged: true // Keep it marked as staged
      });
    } else {
      allFilesMap.set(file.path, { status: file.status, isStaged: false });
    }
  }

  if (allFilesMap.size === 0) {
    p.note("No changes found.", "Nothing to stage");
    return;
  }

  // Create options for the multiselect prompt
  const fileOptions = Array.from(allFilesMap.entries()).map(([path, info]) => {
    // Create a label with status indicator
    let statusIndicator = "";
    if (info.isStaged && info.status.includes("UNSTAGED")) {
      statusIndicator = "⚡ STAGED+MODIFIED";
    } else if (info.isStaged) {
      statusIndicator = "✓ STAGED";
    } else if (info.status === "??") {
      statusIndicator = "● NEW";
    } else if (info.status.includes("M")) {
      statusIndicator = "✎ MODIFIED";
    } else if (info.status.includes("D")) {
      statusIndicator = "✗ DELETED";
    } else if (info.status.includes("R")) {
      statusIndicator = "→ RENAMED";
    } else if (info.status.includes("A")) {
      statusIndicator = "+ ADDED";
    } else {
      statusIndicator = `[${info.status}]`;
    }

    return {
      value: path,
      label: `${statusIndicator.padEnd(20)} ${path}`,
    };
  });

  // Show multiselect prompt with pre-selected staged files
  const initiallyStaged = Array.from(allFilesMap.entries())
    .filter(([_, info]) => info.isStaged)
    .map(([path, _]) => path);

  const selectedFiles = await p.multiselect({
    message: "Select files to stage (toggle with space, already staged files are pre-selected):",
    options: fileOptions,
    initialValues: initiallyStaged,
    required: false,
  });

  if (p.isCancel(selectedFiles)) {
    p.cancel("Operation cancelled");
    return;
  }

  const selectedSet = new Set(selectedFiles as string[]);
  const initiallyStagedSet = new Set(initiallyStaged);

  // Determine what to stage and unstage
  const toStage = Array.from(selectedSet).filter(f => !initiallyStagedSet.has(f));
  const toUnstage = Array.from(initiallyStagedSet).filter(f => !selectedSet.has(f));

  // Apply changes
  try {
    if (toStage.length > 0) {
      await stageFiles(toStage);
      p.log.success(`Staged ${toStage.length} file(s)`);
    }

    if (toUnstage.length > 0) {
      await unstageFiles(toUnstage);
      p.log.success(`Unstaged ${toUnstage.length} file(s)`);
    }

    if (toStage.length === 0 && toUnstage.length === 0) {
      p.note("No changes made to staging area.", "No changes");
      return;
    }

    // Show summary
    const summary: string[] = [];
    if (toStage.length > 0) {
      summary.push("Staged:");
      summary.push(...toStage.map((f) => `  + ${f}`));
    }
    if (toUnstage.length > 0) {
      if (summary.length > 0) summary.push("");
      summary.push("Unstaged:");
      summary.push(...toUnstage.map((f) => `  - ${f}`));
    }

    p.note(summary.join("\n"), "Changes applied");
  } catch (error) {
    throw new Error(`Failed to update staging area: ${error instanceof Error ? error.message : String(error)}`);
  }
}
