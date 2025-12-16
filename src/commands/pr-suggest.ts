import * as p from "@clack/prompts";
import { getBranchInfo, isGitRepository } from "../utils/git.ts";
import { generatePRSuggestion } from "../utils/openai.ts";

export async function prSuggest(): Promise<void> {
  // Check if we're in a git repository
  const isRepo = await isGitRepository();
  if (!isRepo) {
    throw new Error("Not a git repository. Please run this command in a git repository.");
  }

  const spinner = p.spinner();

  // Get branch info
  spinner.start("Analyzing branch commits...");

  let branchInfo;
  try {
    branchInfo = await getBranchInfo();
  } catch (error) {
    spinner.stop("Failed to analyze branch");
    throw error;
  }

  const { currentBranch, baseBranch, commits } = branchInfo;

  if (commits.length === 0) {
    spinner.stop("No commits found");
    p.note(
      `Your branch '${currentBranch}' has no commits compared to '${baseBranch}'.\n` +
        "Make some commits first before generating a PR suggestion.",
      "Info"
    );
    return;
  }

  spinner.stop(`Found ${commits.length} commit(s) on '${currentBranch}'`);

  // Show branch summary
  p.note(
    [
      `Branch: ${currentBranch}`,
      `Base: ${baseBranch}`,
      `Commits: ${commits.length}`,
      "",
      "Recent commits:",
      ...commits.slice(0, 5).map((c) => `  • ${c.message}`),
      commits.length > 5 ? `  ... and ${commits.length - 5} more` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    "Branch info"
  );

  // Generate PR suggestion
  spinner.start("Generating PR title and description with AI...");

  try {
    const { title, description } = await generatePRSuggestion(
      currentBranch,
      commits.map((c) => ({ message: c.message }))
    );

    spinner.stop("PR suggestion generated");

    // Display the generated PR info
    p.note(title, "Suggested PR Title");
    p.note(description, "Suggested PR Description");

    // Ask if user wants to copy
    const action = await p.select({
      message: "What would you like to do?",
      options: [
        { value: "copy-title", label: "Copy title to clipboard" },
        { value: "copy-desc", label: "Copy description to clipboard" },
        { value: "copy-both", label: "Copy both (formatted)" },
        { value: "nothing", label: "Nothing, just show me" },
      ],
    });

    if (p.isCancel(action)) {
      return;
    }

    if (action === "copy-title") {
      await copyToClipboard(title);
      p.note("Title copied to clipboard!", "Success");
    } else if (action === "copy-desc") {
      await copyToClipboard(description);
      p.note("Description copied to clipboard!", "Success");
    } else if (action === "copy-both") {
      const combined = `${title}\n\n${description}`;
      await copyToClipboard(combined);
      p.note("Title and description copied to clipboard!", "Success");
    }
  } catch (error) {
    spinner.stop("Failed to generate PR suggestion");
    throw error;
  }
}

/**
 * Copy text to clipboard using platform-specific commands
 */
async function copyToClipboard(text: string): Promise<void> {
  const platform = process.platform;

  let command: string[];

  if (platform === "darwin") {
    // macOS
    command = ["pbcopy"];
  } else if (platform === "linux") {
    // Linux - try xclip first, fall back to xsel
    try {
      const proc = Bun.spawn(["which", "xclip"], { stdout: "pipe" });
      await proc.exited;
      if (proc.exitCode === 0) {
        command = ["xclip", "-selection", "clipboard"];
      } else {
        command = ["xsel", "--clipboard", "--input"];
      }
    } catch {
      command = ["xsel", "--clipboard", "--input"];
    }
  } else if (platform === "win32") {
    // Windows
    command = ["clip"];
  } else {
    throw new Error(`Clipboard not supported on platform: ${platform}`);
  }

  const proc = Bun.spawn(command, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(text);
  proc.stdin.end();

  await proc.exited;

  if (proc.exitCode !== 0) {
    const error = await new Response(proc.stderr).text();
    throw new Error(`Failed to copy to clipboard: ${error}`);
  }
}
