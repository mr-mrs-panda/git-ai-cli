import * as p from "@clack/prompts";
import { collectPRCelebrateStats, generatePRCelebrateHTML, type Language } from "../services/pr-celebrate.ts";
import { isGitRepository, isGitHubRepository, getCurrentBranch, getBaseBranch } from "../utils/git.ts";
import { Spinner } from "../utils/ui.ts";
import { tmpdir } from "os";
import { join } from "path";

export interface PRCelebrateOptions {
    autoYes?: boolean;
    language?: Language;
}

// Fun loading messages for PR celebration
const loadingMessages = [
    "🎊 Preparing the celebration...",
    "📊 Gathering PR statistics...",
    "👀 Analyzing your commits...",
    "📝 Reading through the changes...",
    "🔍 Counting those lines of code...",
    "🎯 Finding the highlights...",
    "💫 Sprinkling celebration magic...",
    "🏆 Calculating achievements...",
    "✨ Making it beautiful...",
    "🎁 Wrapping up your PR...",
    "🍾 Getting the confetti ready...",
    "🌟 Highlighting your work...",
    "📈 Visualizing your impact...",
    "🎨 Creating the celebration page...",
];

// Fun facts about PRs
const funFacts = [
    "💡 Did you know? The average PR takes about 4 hours to merge.",
    "🔢 Smaller PRs (< 200 lines) are reviewed 15% faster.",
    "📝 Good PR descriptions reduce review time by 40%.",
    "👥 PRs with 2 reviewers have 50% fewer bugs.",
    "⚡ Quick reviews improve team velocity significantly.",
    "🎯 Focused PRs are easier to review and merge.",
    "📊 Most PRs change between 10-50 files.",
    "🚀 Atomic commits make rollbacks easier.",
    "💬 Code review comments improve code quality.",
    "🌟 Your PR is about to be celebrated!",
];

export async function prCelebrate(options: PRCelebrateOptions = {}): Promise<void> {
    const { autoYes = false, language = "english" } = options;

    // Check if we're in a git repository
    if (!(await isGitRepository())) {
        throw new Error("Not a git repository. Please run this command from a git repository.");
    }

    // Check if it's a GitHub repository
    const isGitHub = await isGitHubRepository();

    if (!isGitHub) {
        throw new Error(
            "This doesn't appear to be a GitHub repository.\n" +
            "PR Celebrate requires a GitHub repository with an existing PR."
        );
    }

    const currentBranch = await getCurrentBranch();
    const baseBranch = await getBaseBranch();

    if (currentBranch === baseBranch) {
        throw new Error(
            `You're on the base branch (${baseBranch}).\n` +
            "Please checkout the feature branch with an existing PR to celebrate."
        );
    }

    console.log("");
    console.log("┌─────────────────────────────────────────────────────────────┐");
    console.log("│                                                             │");
    console.log("│   🎊  PR Celebrate - Your PR, Celebrated!  🎊               │");
    console.log("│                                                             │");
    console.log(`│   Branch: ${currentBranch.padEnd(47)}│`);
    console.log("│                                                             │");
    console.log("└─────────────────────────────────────────────────────────────┘");
    console.log("");

    const spinner = new Spinner();
    let messageIndex = 0;
    let factIndex = 0;

    // Rotate loading messages
    spinner.start(loadingMessages[0] ?? "Loading...");

    const messageInterval = setInterval(() => {
        messageIndex = (messageIndex + 1) % loadingMessages.length;
        spinner.message(loadingMessages[messageIndex] ?? "Processing...");
    }, 2000);

    // Show fun facts periodically
    const factInterval = setInterval(() => {
        factIndex = (factIndex + 1) % funFacts.length;
        console.log(`\n  ${funFacts[factIndex]}\n`);
    }, 6000);

    try {
        // Collect stats with progress updates
        const stats = await collectPRCelebrateStats({
            onProgress: (message) => {
                spinner.message(message);
            },
            language,
        });

        // Clear the message rotation
        clearInterval(messageInterval);
        clearInterval(factInterval);

        spinner.message("🎨 Generating your celebration page...");

        // Generate HTML report
        const html = await generatePRCelebrateHTML(stats, {
            onProgress: (message) => {
                spinner.message(message);
            },
            language,
        });

        // Save to temp file
        const filename = `pr-celebrate-${stats.repoOwner}-${stats.repoName}-${stats.prNumber}-${Date.now()}.html`;
        const filepath = join(tmpdir(), filename);

        await Bun.write(filepath, html);

        spinner.stop("✅ Your PR celebration is ready!");

        // Show summary
        console.log("");
        console.log("┌─────────────────────────────────────────────────────────────┐");
        console.log("│                    🎊 PR Summary                            │");
        console.log("├─────────────────────────────────────────────────────────────┤");
        console.log(`│  🔢 PR Number:      #${String(stats.prNumber).padEnd(37)}│`);
        console.log(`│  📁 Files Changed:  ${String(stats.filesChanged).padEnd(39)}│`);
        console.log(`│  ➕ Lines Added:    ${String("+" + stats.linesAdded.toLocaleString()).padEnd(39)}│`);
        console.log(`│  ➖ Lines Deleted:  ${String("-" + stats.linesDeleted.toLocaleString()).padEnd(39)}│`);
        console.log(`│  📝 Commits:        ${String(stats.totalCommits).padEnd(39)}│`);
        console.log(`│  👥 Contributors:   ${String(stats.authors.length).padEnd(39)}│`);
        console.log(`│  ${stats.prState === "merged" ? "✅" : "⏳"} Status:         ${String(stats.prState.toUpperCase()).padEnd(39)}│`);
        console.log("└─────────────────────────────────────────────────────────────┘");
        console.log("");

        const sizeEmojis: Record<string, string> = {
            tiny: "🐜 Tiny",
            small: "🌱 Small",
            medium: "📦 Medium",
            large: "🏗️ Large",
            massive: "🚀 Massive",
            legendary: "🏆 Legendary",
        };

        p.note(
            `PR Size: ${sizeEmojis[stats.sizeCategory] ?? stats.sizeCategory}\n` +
            `Report saved to:\n${filepath}\n\nOpening in your browser...`,
            "🎁 Your PR Celebration"
        );

        // Open in browser
        await openInBrowser(filepath);

    } catch (error) {
        clearInterval(messageInterval);
        clearInterval(factInterval);
        spinner.stop("Failed to generate celebration");
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
