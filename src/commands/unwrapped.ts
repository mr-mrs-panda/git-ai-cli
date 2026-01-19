import * as p from "@clack/prompts";
import { collectUnwrappedStats, generateUnwrappedHTML, type Language } from "../services/unwrapped.ts";
import { isGitRepository, isGitHubRepository } from "../utils/git.ts";
import { Spinner } from "../utils/ui.ts";
import { tmpdir } from "os";
import { join } from "path";

export interface UnwrappedOptions {
  autoYes?: boolean;
  language?: Language;
}

// Fun loading messages for entertainment while stats are being collected
const loadingMessages = [
  "🔮 Peering into the commit history...",
  "📚 Reading through ancient PRs...",
  "🧮 Counting those lines of code...",
  "🎯 Finding your busiest days...",
  "🌙 Checking for late-night commits...",
  "🏖️ Detecting weekend warriors...",
  "🔥 Calculating your streak...",
  "📊 Crunching the numbers...",
  "🎨 Preparing beautiful visualizations...",
  "✨ Sprinkling some AI magic...",
  "🚀 Almost ready for liftoff...",
  "🎁 Wrapping up your year...",
  "🎵 Composing your code symphony...",
  "🏆 Tallying your achievements...",
  "📈 Graphing your growth...",
  "🦉 Counting night owl commits...",
  "💪 Measuring your dedication...",
  "🎭 Analyzing your commit personality...",
  "🌟 Highlighting your best moments...",
  "🍾 Preparing the celebration...",
];

// Fun facts to display while waiting
const funFacts = [
  "💡 Did you know? The first git commit was made by Linus Torvalds in 2005.",
  "🐙 Fun fact: GitHub's mascot Octocat was designed by Simon Oxley.",
  "📝 The average commit message is about 50 characters long.",
  "🌍 Over 100 million developers use GitHub worldwide.",
  "⚡ Git can handle projects with thousands of contributors.",
  "🔢 The Linux kernel has over 1 million commits.",
  "🎮 Some of the most popular repos are game engines and frameworks.",
  "🌈 GitHub supports over 500 programming languages.",
  "🤖 AI is transforming how we write and review code.",
  "📦 npm has over 2 million packages available.",
];

export async function unwrapped(options: UnwrappedOptions = {}): Promise<void> {
  const { autoYes = false, language = "english" } = options;

  // Check if we're in a git repository
  if (!(await isGitRepository())) {
    throw new Error("Not a git repository. Please run this command from a git repository.");
  }

  // Check if it's a GitHub repository (for full stats)
  const isGitHub = await isGitHubRepository();
  
  if (!isGitHub && !autoYes) {
    p.note(
      "This doesn't appear to be a GitHub repository.\n" +
      "Some stats like PR information and releases will be limited.",
      "⚠️ Limited Mode"
    );
    
    const proceed = await p.confirm({
      message: "Continue anyway?",
      initialValue: true,
    });
    
    if (p.isCancel(proceed) || !proceed) {
      p.cancel("Operation cancelled");
      process.exit(0);
    }
  }

  console.log("");
  console.log("┌─────────────────────────────────────────────────────────────┐");
  console.log("│                                                             │");
  console.log("│   🎉  Git Unwrapped - Your Year in Code  🎉                 │");
  console.log("│                                                             │");
  console.log("│   Analyzing your repository's last 365 days...              │");
  console.log("│                                                             │");
  console.log("└─────────────────────────────────────────────────────────────┘");
  console.log("");

  const spinner = new Spinner();
  let messageIndex = 0;
  let factIndex = 0;
  let lastFact = "";

  // Rotate loading messages
  spinner.start(loadingMessages[0] ?? "Loading...");
  
  const messageInterval = setInterval(() => {
    messageIndex = (messageIndex + 1) % loadingMessages.length;
    spinner.message(loadingMessages[messageIndex] ?? "Processing...");
  }, 2500);

  // Show fun facts periodically
  const factInterval = setInterval(() => {
    factIndex = (factIndex + 1) % funFacts.length;
    lastFact = funFacts[factIndex] ?? "";
    console.log(`\n  ${lastFact}\n`);
  }, 8000);

  try {
    // Collect stats with progress updates
    const stats = await collectUnwrappedStats({
      onProgress: (message) => {
        spinner.message(message);
      },
      language,
    });

    // Clear the message rotation
    clearInterval(messageInterval);
    clearInterval(factInterval);

    spinner.message("🎨 Generating your personalized report...");

    // Generate HTML report
    const html = await generateUnwrappedHTML(stats, {
      onProgress: (message) => {
        spinner.message(message);
      },
      language,
    });

    // Save to temp file
    const filename = `unwrapped-${stats.repoOwner}-${stats.repoName}-${Date.now()}.html`;
    const filepath = join(tmpdir(), filename);
    
    await Bun.write(filepath, html);

    spinner.stop("✅ Your Unwrapped report is ready!");

    // Show summary
    console.log("");
    console.log("┌─────────────────────────────────────────────────────────────┐");
    console.log("│                    📊 Quick Summary                         │");
    console.log("├─────────────────────────────────────────────────────────────┤");
    console.log(`│  📝 Commits:        ${String(stats.totalCommits).padEnd(39)}│`);
    console.log(`│  ➕ Lines Added:    ${String("+" + stats.linesAdded.toLocaleString()).padEnd(39)}│`);
    console.log(`│  ➖ Lines Deleted:  ${String("-" + stats.linesDeleted.toLocaleString()).padEnd(39)}│`);
    console.log(`│  🔀 PRs Merged:     ${String(stats.mergedPRs).padEnd(39)}│`);
    console.log(`│  🏷️  Releases:       ${String(stats.totalReleases).padEnd(39)}│`);
    console.log(`│  🔥 Longest Streak: ${String(stats.longestStreak + " days").padEnd(39)}│`);
    console.log("└─────────────────────────────────────────────────────────────┘");
    console.log("");

    p.note(
      `Report saved to:\n${filepath}\n\nOpening in your browser...`,
      "🎁 Your Unwrapped"
    );

    // Open in browser
    await openInBrowser(filepath);

  } catch (error) {
    clearInterval(messageInterval);
    clearInterval(factInterval);
    spinner.stop("Failed to generate report");
    throw error;
  }
}

async function openInBrowser(filepath: string): Promise<void> {
  const platform = process.platform;
  
  let command: string[];
  
  if (platform === "darwin") {
    command = ["open", filepath];
  } else if (platform === "win32") {
    command = ["cmd", "/c", "start", "", filepath];
  } else {
    // Linux - try xdg-open, then fallback to other browsers
    command = ["xdg-open", filepath];
  }

  try {
    const proc = Bun.spawn(command, {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
  } catch {
    // If browser open fails, just show the path
    p.log.info(`Could not open browser. Open manually: ${filepath}`);
  }
}
