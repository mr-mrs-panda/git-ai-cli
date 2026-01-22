import { Octokit } from "octokit";
import { loadConfig } from "../utils/config.ts";
import { parseGitHubRepo, getCurrentBranch, getBaseBranch, getBranchDiffs } from "../utils/git.ts";
import { getGitHubToken } from "../utils/config.ts";
import OpenAI from "openai";

export interface PRCelebrateStats {
    // PR info
    prNumber: number;
    prTitle: string;
    prBody: string | null;
    prUrl: string;
    prState: string;
    createdAt: Date;
    mergedAt: Date | null;

    // Branch info
    branchName: string;
    baseBranch: string;

    // Commit stats
    totalCommits: number;
    commits: Array<{ hash: string; message: string; author: string; date: Date }>;
    authors: Array<{ name: string; commits: number; percentage: number }>;

    // Code stats
    filesChanged: number;
    linesAdded: number;
    linesDeleted: number;
    netLines: number;

    // File breakdown
    changedFiles: Array<{ path: string; additions: number; deletions: number; status: string }>;
    fileTypesChanged: Array<{ extension: string; count: number }>;

    // Time stats
    ageInDays: number;
    ageInHours: number;
    timeToMerge: number | null; // hours if merged

    // Size classification
    sizeCategory: "tiny" | "small" | "medium" | "large" | "massive" | "legendary";

    // Review info
    reviewCount: number;
    approvalCount: number;
    commentCount: number;
    reviewers: string[];

    // Labels
    labels: string[];

    // Repo info
    repoName: string;
    repoOwner: string;
}

// AI-generated celebration content
export interface AICelebrationContent {
    // Size card content
    sizeTitle: string;
    sizeEmoji: string;
    sizeDescription: string;

    // Celebration message
    celebrationMessage: string;

    // Colors (hex)
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;

    // AI Summary (HTML)
    summary: string;

    // Fun tagline for the PR
    tagline: string;
}

export type Language = "english" | "german";

export interface PRCelebrateOptions {
    onProgress?: (message: string) => void;
    language?: Language;
}

// Translation system
interface Translations {
    celebrate: string;
    prCelebration: string;
    pullRequest: string;
    byTheNumbers: string;
    codeChanges: string;
    timeline: string;
    contributors: string;
    filesChanged: string;
    linesAdded: string;
    linesDeleted: string;
    netChange: string;
    commits: string;
    reviewers: string;
    approvals: string;
    comments: string;
    created: string;
    merged: string;
    pending: string;
    open: string;
    closed: string;
    timeToMerge: string;
    age: string;
    days: string;
    hours: string;
    minutes: string;
    fileTypes: string;
    mostChangedFiles: string;
    aiSummary: string;
    prSize: string;
    generatedWith: string;
    yourPRCelebrated: string;

    // Size categories
    sizeTiny: string;
    sizeSmall: string;
    sizeMedium: string;
    sizeLarge: string;
    sizeMassive: string;
    sizeLegendary: string;

    sizeTinyDesc: string;
    sizeSmallDesc: string;
    sizeMediumDesc: string;
    sizeLargeDesc: string;
    sizeMassiveDesc: string;
    sizeLegendaryDesc: string;

    // Celebration messages
    celebrationMerged: string;
    celebrationPending: string;
    celebrationLarge: string;
    celebrationTeam: string;
}

const translations: Record<Language, Translations> = {
    english: {
        celebrate: "PR Celebrate",
        prCelebration: "PR Celebration",
        pullRequest: "Pull Request",
        byTheNumbers: "By The Numbers",
        codeChanges: "Code Changes",
        timeline: "Timeline",
        contributors: "Contributors",
        filesChanged: "Files Changed",
        linesAdded: "Lines Added",
        linesDeleted: "Lines Deleted",
        netChange: "Net Change",
        commits: "Commits",
        reviewers: "Reviewers",
        approvals: "Approvals",
        comments: "Comments",
        created: "Created",
        merged: "Merged",
        pending: "Pending Review",
        open: "Open",
        closed: "Closed",
        timeToMerge: "Time to Merge",
        age: "PR Age",
        days: "days",
        hours: "hours",
        minutes: "minutes",
        fileTypes: "File Types",
        mostChangedFiles: "Most Changed Files",
        aiSummary: "AI Summary",
        prSize: "PR Size",
        generatedWith: "Generated with ❤️ by",
        yourPRCelebrated: "Your PR, celebrated!",

        sizeTiny: "Tiny PR 🐜",
        sizeSmall: "Small PR 🌱",
        sizeMedium: "Medium PR 📦",
        sizeLarge: "Large PR 🏗️",
        sizeMassive: "Massive PR 🚀",
        sizeLegendary: "Legendary PR 🏆",

        sizeTinyDesc: "Quick fix! Surgical precision at its finest.",
        sizeSmallDesc: "Focused and efficient. Perfect size for review.",
        sizeMediumDesc: "A solid chunk of work. Well-scoped feature.",
        sizeLargeDesc: "Major contribution! This took some serious effort.",
        sizeMassiveDesc: "Epic undertaking! You've been busy.",
        sizeLegendaryDesc: "This PR is the stuff of legends. Absolute unit.",

        celebrationMerged: "🎉 This PR has been merged! Time to celebrate!",
        celebrationPending: "⏳ Waiting for review. The anticipation builds!",
        celebrationLarge: "🔥 This is a significant contribution!",
        celebrationTeam: "👥 Great teamwork with multiple contributors!",
    },
    german: {
        celebrate: "PR Feier",
        prCelebration: "PR Feier",
        pullRequest: "Pull Request",
        byTheNumbers: "Die Zahlen",
        codeChanges: "Code-Änderungen",
        timeline: "Zeitverlauf",
        contributors: "Mitwirkende",
        filesChanged: "Geänderte Dateien",
        linesAdded: "Zeilen hinzugefügt",
        linesDeleted: "Zeilen gelöscht",
        netChange: "Netto-Änderung",
        commits: "Commits",
        reviewers: "Reviewer",
        approvals: "Genehmigungen",
        comments: "Kommentare",
        created: "Erstellt",
        merged: "Gemerged",
        pending: "Warte auf Review",
        open: "Offen",
        closed: "Geschlossen",
        timeToMerge: "Zeit bis Merge",
        age: "PR Alter",
        days: "Tage",
        hours: "Stunden",
        minutes: "Minuten",
        fileTypes: "Dateitypen",
        mostChangedFiles: "Am meisten geänderte Dateien",
        aiSummary: "KI-Zusammenfassung",
        prSize: "PR Größe",
        generatedWith: "Erstellt mit ❤️ von",
        yourPRCelebrated: "Dein PR, gefeiert!",

        sizeTiny: "Winziger PR 🐜",
        sizeSmall: "Kleiner PR 🌱",
        sizeMedium: "Mittlerer PR 📦",
        sizeLarge: "Großer PR 🏗️",
        sizeMassive: "Massiver PR 🚀",
        sizeLegendary: "Legendärer PR 🏆",

        sizeTinyDesc: "Schneller Fix! Chirurgische Präzision vom Feinsten.",
        sizeSmallDesc: "Fokussiert und effizient. Perfekte Größe für Review.",
        sizeMediumDesc: "Ein solides Stück Arbeit. Gut abgegrenztes Feature.",
        sizeLargeDesc: "Großer Beitrag! Das hat einiges an Aufwand gekostet.",
        sizeMassiveDesc: "Episches Unterfangen! Du warst fleißig.",
        sizeLegendaryDesc: "Dieser PR ist legendär. Absolut massiv.",

        celebrationMerged: "🎉 Dieser PR wurde gemerged! Zeit zum Feiern!",
        celebrationPending: "⏳ Warte auf Review. Die Spannung steigt!",
        celebrationLarge: "🔥 Das ist ein bedeutender Beitrag!",
        celebrationTeam: "👥 Tolle Teamarbeit mit mehreren Mitwirkenden!",
    },
};

function t(key: keyof Translations, language: Language = "english"): string {
    return translations[language][key];
}

/**
 * Get the PR for the current branch
 */
export async function getCurrentPR(
    owner: string,
    repo: string,
    branch: string,
    githubToken: string
): Promise<{
    number: number;
    title: string;
    body: string | null;
    url: string;
    state: string;
    created_at: string;
    merged_at: string | null;
    labels: string[];
} | null> {
    try {
        const octokit = new Octokit({ auth: githubToken });

        // List PRs with this head branch
        const { data: prs } = await octokit.rest.pulls.list({
            owner,
            repo,
            head: `${owner}:${branch}`,
            state: "all",
            sort: "updated",
            direction: "desc",
        });

        if (prs.length > 0 && prs[0]) {
            const pr = prs[0];
            return {
                number: pr.number,
                title: pr.title,
                body: pr.body,
                url: pr.html_url,
                state: pr.merged_at ? "merged" : pr.state,
                created_at: pr.created_at,
                merged_at: pr.merged_at,
                labels: pr.labels
                    .map((label) => (typeof label === "object" && label !== null ? label.name : String(label)))
                    .filter((name): name is string => Boolean(name)),
            };
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * Collect PR stats for celebration
 */
export async function collectPRCelebrateStats(
    options: PRCelebrateOptions = {}
): Promise<PRCelebrateStats> {
    const { onProgress = () => { } } = options;

    const repoInfo = await parseGitHubRepo();
    if (!repoInfo) {
        throw new Error("Could not parse GitHub repository information");
    }

    const { owner, repo } = repoInfo;
    const currentBranch = await getCurrentBranch();
    const baseBranch = await getBaseBranch();

    onProgress("🔍 Finding PR for current branch...");

    const githubToken = await getGitHubToken();
    if (!githubToken) {
        throw new Error("GitHub token required. Run 'git-ai settings' to configure.");
    }

    const pr = await getCurrentPR(owner, repo, currentBranch, githubToken);
    if (!pr) {
        throw new Error(`No PR found for branch '${currentBranch}'. Create a PR first!`);
    }

    onProgress(`📊 Found PR #${pr.number}: ${pr.title}`);

    // Get PR details including reviews and comments
    const octokit = new Octokit({ auth: githubToken });

    onProgress("📝 Fetching commits...");

    // Fetch ALL commits with pagination
    type CommitInfo = { sha: string; commit: { message: string; author: { name?: string; date?: string } | null }; author: { login: string } | null };
    const allCommits: CommitInfo[] = [];
    let commitPage = 1;
    let hasMoreCommits = true;

    while (hasMoreCommits) {
        const { data: pageCommits } = await octokit.rest.pulls.listCommits({
            owner,
            repo,
            pull_number: pr.number,
            per_page: 100,
            page: commitPage,
        });

        // Map to our expected type
        const mappedCommits: CommitInfo[] = pageCommits.map((c) => ({
            sha: c.sha,
            commit: {
                message: c.commit.message,
                author: c.commit.author,
            },
            author: c.author && "login" in c.author && c.author.login ? { login: c.author.login } : null,
        }));

        allCommits.push(...mappedCommits);

        if (pageCommits.length < 100) {
            hasMoreCommits = false;
        } else {
            commitPage++;
            onProgress(`📝 Fetching commits... (${allCommits.length} so far)`);
        }
    }

    onProgress(`📝 Found ${allCommits.length} commits`);


    // Parse commits
    const commits = allCommits.map((c) => ({
        hash: c.sha.substring(0, 7),
        message: c.commit.message.split("\n")[0] ?? c.commit.message,
        author: c.commit.author?.name ?? c.author?.login ?? "Unknown",
        date: new Date(c.commit.author?.date ?? new Date()),
    }));

    // Author stats
    const authorCounts = new Map<string, number>();
    commits.forEach((c) => {
        authorCounts.set(c.author, (authorCounts.get(c.author) || 0) + 1);
    });

    const authors = Array.from(authorCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({
            name,
            commits: count,
            percentage: Math.round((count / commits.length) * 100),
        }));

    onProgress("📁 Fetching file changes...");

    // Fetch ALL files with pagination
    const allFiles: Array<{ filename: string; additions: number; deletions: number; status: string }> = [];
    let filePage = 1;
    let hasMoreFiles = true;

    while (hasMoreFiles) {
        const { data: pageFiles } = await octokit.rest.pulls.listFiles({
            owner,
            repo,
            pull_number: pr.number,
            per_page: 100,
            page: filePage,
        });

        allFiles.push(...pageFiles);

        if (pageFiles.length < 100) {
            hasMoreFiles = false;
        } else {
            filePage++;
            onProgress(`📁 Fetching files... (${allFiles.length} so far)`);
        }
    }

    onProgress(`📁 Found ${allFiles.length} changed files`);

    // File stats
    const changedFiles = allFiles.map((f) => ({
        path: f.filename,
        additions: f.additions,
        deletions: f.deletions,
        status: f.status,
    }));

    const linesAdded = allFiles.reduce((sum, f) => sum + f.additions, 0);
    const linesDeleted = allFiles.reduce((sum, f) => sum + f.deletions, 0);

    // File types
    const extensionCounts = new Map<string, number>();
    changedFiles.forEach((f) => {
        const ext = f.path.split(".").pop() || "none";
        extensionCounts.set(ext, (extensionCounts.get(ext) || 0) + 1);
    });

    const fileTypesChanged = Array.from(extensionCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([extension, count]) => ({ extension, count }));

    onProgress("💬 Fetching reviews...");
    const { data: reviews } = await octokit.rest.pulls.listReviews({
        owner,
        repo,
        pull_number: pr.number,
    });

    const { data: comments } = await octokit.rest.pulls.listReviewComments({
        owner,
        repo,
        pull_number: pr.number,
    });

    const reviewers = [...new Set(reviews.map((r) => r.user?.login).filter(Boolean) as string[])];
    const approvalCount = reviews.filter((r) => r.state === "APPROVED").length;

    // Time calculations
    const createdAt = new Date(pr.created_at);
    const now = new Date();
    const mergedAt = pr.merged_at ? new Date(pr.merged_at) : null;

    const ageMs = now.getTime() - createdAt.getTime();
    const ageInHours = Math.floor(ageMs / (1000 * 60 * 60));
    const ageInDays = Math.floor(ageInHours / 24);

    const timeToMerge = mergedAt
        ? Math.floor((mergedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60))
        : null;

    // Determine size category
    const totalChanges = linesAdded + linesDeleted;
    let sizeCategory: PRCelebrateStats["sizeCategory"];

    if (totalChanges < 10) {
        sizeCategory = "tiny";
    } else if (totalChanges < 100) {
        sizeCategory = "small";
    } else if (totalChanges < 500) {
        sizeCategory = "medium";
    } else if (totalChanges < 1000) {
        sizeCategory = "large";
    } else if (totalChanges < 5000) {
        sizeCategory = "massive";
    } else {
        sizeCategory = "legendary";
    }

    return {
        prNumber: pr.number,
        prTitle: pr.title,
        prBody: pr.body,
        prUrl: pr.url,
        prState: pr.state,
        createdAt,
        mergedAt,
        branchName: currentBranch,
        baseBranch,
        totalCommits: commits.length,
        commits,
        authors,
        filesChanged: changedFiles.length,
        linesAdded,
        linesDeleted,
        netLines: linesAdded - linesDeleted,
        changedFiles: changedFiles.sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions)),
        fileTypesChanged,
        ageInDays,
        ageInHours,
        timeToMerge,
        sizeCategory,
        reviewCount: reviews.length,
        approvalCount,
        commentCount: comments.length,
        reviewers,
        labels: pr.labels,
        repoName: repo,
        repoOwner: owner,
    };
}

/**
 * Generate HTML celebration page for the PR
 */
export async function generatePRCelebrateHTML(
    stats: PRCelebrateStats,
    options: PRCelebrateOptions = {}
): Promise<string> {
    const { onProgress = () => { }, language = "english" } = options;

    onProgress("🤖 Generating AI celebration content...");
    const aiContent = await generateAICelebrationContent(stats, language);

    onProgress("🎨 Creating celebration page...");

    const formatDate = (date: Date) =>
        date.toLocaleDateString(language === "german" ? "de-DE" : "en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });

    // Use AI-generated colors or fallback
    const primaryColor = aiContent.primaryColor || "#a371f7";
    const secondaryColor = aiContent.secondaryColor || "#f778ba";
    const accentColor = aiContent.accentColor || "#58a6ff";

    const stateColor = stats.prState === "merged" ? primaryColor : stats.prState === "open" ? "#3fb950" : "#f85149";
    const stateText = stats.prState === "merged" ? t("merged", language) : stats.prState === "open" ? t("open", language) : t("closed", language);

    // File type chart data
    const fileTypeData = JSON.stringify(stats.fileTypesChanged.slice(0, 6));

    // Commit timeline data (group by date)
    const commitsByDate = new Map<string, number>();
    stats.commits.forEach((c) => {
        const dateKey = c.date.toISOString().split("T")[0] ?? "";
        commitsByDate.set(dateKey, (commitsByDate.get(dateKey) || 0) + 1);
    });
    const timelineData = JSON.stringify(
        Array.from(commitsByDate.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, count]) => ({ date, count }))
    );

    // Format large numbers for display
    const formatNumber = (n: number) => n.toLocaleString();

    const html = `<!DOCTYPE html>
<html lang="${language === "german" ? "de" : "en"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PR #${stats.prNumber} - ${t("prCelebration", language)}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    :root {
      --bg-dark: #0d1117;
      --bg-card: #161b22;
      --bg-card-hover: #21262d;
      --border: #30363d;
      --text-primary: #f0f6fc;
      --text-secondary: #8b949e;
      --text-muted: #6e7681;
      --accent-green: #3fb950;
      --accent-blue: ${accentColor};
      --accent-purple: ${primaryColor};
      --accent-orange: #f0883e;
      --accent-pink: ${secondaryColor};
      --accent-cyan: #76e3ea;
      --accent-red: #f85149;
      --primary-color: ${primaryColor};
      --secondary-color: ${secondaryColor};
      --gradient-1: linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%);
      --gradient-2: linear-gradient(135deg, ${secondaryColor} 0%, #f5576c 100%);
      --gradient-3: linear-gradient(135deg, ${accentColor} 0%, #00f2fe 100%);
      --gradient-4: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
      --gradient-merged: linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%);
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg-dark);
      color: var(--text-primary);
      line-height: 1.6;
      overflow-x: hidden;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
    }
    
    /* Hero Section */
    .hero {
      text-align: center;
      padding: 4rem 2rem;
      background: linear-gradient(180deg, #161b22 0%, #0d1117 100%);
      position: relative;
      overflow: hidden;
    }
    
    .hero::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: radial-gradient(ellipse at center, ${primaryColor}25 0%, transparent 70%);
      pointer-events: none;
    }
    
    .hero h1 {
      font-size: 3rem;
      font-weight: 900;
      background: var(--gradient-merged);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 1rem;
    }
    
    .hero .tagline {
      font-size: 1.1rem;
      color: ${primaryColor};
      font-style: italic;
      margin-bottom: 1rem;
    }
    
    .pr-number {
      font-size: 1.5rem;
      color: var(--text-secondary);
      margin-bottom: 0.5rem;
    }
    
    .pr-title {
      font-size: 1.25rem;
      color: var(--text-primary);
      max-width: 800px;
      margin: 0 auto 1rem;
      word-break: break-word;
    }
    
    .pr-meta {
      display: flex;
      justify-content: center;
      gap: 1.5rem;
      flex-wrap: wrap;
      margin-bottom: 1.5rem;
    }
    
    .pr-meta-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--text-secondary);
    }
    
    .state-badge {
      display: inline-block;
      padding: 0.5rem 1.5rem;
      border-radius: 50px;
      font-weight: 700;
      font-size: 1rem;
      background: ${stateColor};
      color: white;
      animation: ${stats.prState === "merged" ? "pulse 2s infinite" : "none"};
    }
    
    @keyframes pulse {
      0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 ${primaryColor}66; }
      50% { transform: scale(1.05); box-shadow: 0 0 20px 10px ${primaryColor}00; }
    }
    
    /* Size Badge */
    .size-card {
      background: linear-gradient(135deg, #1a1f35 0%, #161b22 100%);
      border: 2px solid ${primaryColor};
      border-radius: 24px;
      padding: 2.5rem;
      text-align: center;
      margin: 2rem 0;
      position: relative;
      overflow: hidden;
    }
    
    .size-card::before {
      content: '';
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: conic-gradient(from 0deg, transparent, ${primaryColor}22, transparent 30%);
      animation: rotate 10s linear infinite;
    }
    
    @keyframes rotate {
      100% { transform: rotate(360deg); }
    }
    
    .size-card .content {
      position: relative;
      z-index: 1;
    }
    
    .size-emoji {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
    
    .size-title {
      font-size: 2rem;
      font-weight: 800;
      background: linear-gradient(135deg, ${primaryColor}, ${secondaryColor});
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    
    .size-desc {
      color: var(--text-secondary);
      font-size: 1.1rem;
      margin-top: 0.5rem;
    }
    
    /* Section Headers */
    .section-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin: 3rem 0 1.5rem;
    }
    
    .section-header h2 {
      font-size: 1.75rem;
      font-weight: 700;
    }
    
    .section-header .emoji {
      font-size: 2rem;
    }
    
    /* Cards Grid */
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1.5rem;
    }
    
    .cards-grid-3 {
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    }
    
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 1.5rem;
      transition: all 0.3s ease;
      min-width: 0;
    }
    
    .card:hover {
      background: var(--bg-card-hover);
      transform: translateY(-4px);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
    }
    
    .card-label {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .card-value {
      font-size: clamp(1.5rem, 4vw, 2.5rem);
      font-weight: 800;
      background: var(--gradient-1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      word-break: break-word;
      line-height: 1.2;
    }
    
    .card-value.green { background: var(--gradient-4); -webkit-background-clip: text; background-clip: text; }
    .card-value.pink { background: var(--gradient-2); -webkit-background-clip: text; background-clip: text; }
    .card-value.cyan { background: var(--gradient-3); -webkit-background-clip: text; background-clip: text; }
    .card-value.purple { background: var(--gradient-merged); -webkit-background-clip: text; background-clip: text; }
    
    .card-subtitle {
      font-size: 0.75rem;
      color: var(--text-secondary);
      margin-top: 0.25rem;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    /* AI Summary */
    .ai-summary {
      background: linear-gradient(135deg, #1f2937 0%, #161b22 100%);
      border: 2px solid ${accentColor};
      border-radius: 24px;
      padding: 2.5rem;
      margin: 2rem 0;
    }
    
    .ai-summary h3 {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 1.5rem;
      margin-bottom: 1rem;
    }
    
    .ai-summary .ai-content {
      color: var(--text-secondary);
      font-size: 1.1rem;
      line-height: 1.8;
    }
    
    .ai-summary .ai-content p {
      margin-bottom: 1rem;
    }
    
    .ai-summary .ai-content ul {
      margin: 1rem 0;
      padding-left: 1.5rem;
    }
    
    .ai-summary .ai-content li {
      margin-bottom: 0.5rem;
    }
    
    .ai-summary .ai-content strong {
      color: var(--text-primary);
    }
    
    /* Chart Container */
    .chart-container {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 1.5rem;
      margin: 1.5rem 0;
    }
    
    .chart-title {
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 1rem;
      color: var(--text-primary);
    }
    
    /* File List */
    .file-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      max-height: 400px;
      overflow-y: auto;
    }
    
    .file-item {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem 1rem;
      background: var(--bg-card);
      border-radius: 8px;
      font-family: 'SF Mono', 'Consolas', monospace;
      font-size: 0.85rem;
    }
    
    .file-changes {
      display: flex;
      gap: 0.5rem;
      min-width: 100px;
    }
    
    .file-add {
      color: var(--accent-green);
      font-weight: 600;
    }
    
    .file-del {
      color: var(--accent-red);
      font-weight: 600;
    }
    
    .file-path {
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    
    .file-status {
      padding: 0.125rem 0.5rem;
      border-radius: 4px;
      font-size: 0.7rem;
      text-transform: uppercase;
      font-weight: 600;
    }
    
    .file-status.added { background: rgba(63, 185, 80, 0.2); color: var(--accent-green); }
    .file-status.modified { background: rgba(88, 166, 255, 0.2); color: var(--accent-blue); }
    .file-status.removed { background: rgba(248, 81, 73, 0.2); color: var(--accent-red); }
    .file-status.renamed { background: rgba(240, 136, 62, 0.2); color: var(--accent-orange); }
    
    /* Contributors */
    .contributor-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    
    .contributor-item {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1rem;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
    }
    
    .contributor-rank {
      font-size: 1.5rem;
      font-weight: 800;
      width: 40px;
      text-align: center;
    }
    
    .contributor-rank.gold { color: #ffd700; }
    .contributor-rank.silver { color: #c0c0c0; }
    .contributor-rank.bronze { color: #cd7f32; }
    
    .contributor-info {
      flex: 1;
    }
    
    .contributor-name {
      font-weight: 600;
      font-size: 1.1rem;
    }
    
    .contributor-stats {
      color: var(--text-secondary);
      font-size: 0.875rem;
    }
    
    /* Commits Timeline */
    .commits-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      max-height: 300px;
      overflow-y: auto;
    }
    
    .commit-item {
      display: flex;
      gap: 1rem;
      padding: 0.75rem;
      background: var(--bg-card);
      border-radius: 8px;
      align-items: flex-start;
    }
    
    .commit-hash {
      font-family: 'SF Mono', monospace;
      color: var(--accent-blue);
      font-size: 0.85rem;
      flex-shrink: 0;
    }
    
    .commit-message {
      color: var(--text-primary);
      flex: 1;
      word-break: break-word;
    }
    
    .commit-author {
      color: var(--text-muted);
      font-size: 0.8rem;
      flex-shrink: 0;
    }
    
    /* Labels */
    .labels-container {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 1rem;
    }
    
    .label {
      padding: 0.25rem 0.75rem;
      background: var(--accent-purple);
      border-radius: 50px;
      font-size: 0.8rem;
      font-weight: 500;
    }
    
    /* Celebration Message */
    .celebration {
      background: linear-gradient(135deg, ${primaryColor}1a 0%, ${secondaryColor}1a 100%);
      border: 1px solid ${primaryColor};
      border-radius: 16px;
      padding: 2rem;
      text-align: center;
      margin: 2rem 0;
      font-size: 1.25rem;
    }
    
    /* Footer */
    .footer {
      text-align: center;
      padding: 3rem;
      color: var(--text-muted);
      border-top: 1px solid var(--border);
      margin-top: 4rem;
    }
    
    .footer a {
      color: ${accentColor};
      text-decoration: none;
    }
    
    .pr-link {
      display: inline-block;
      margin-top: 1rem;
      padding: 0.75rem 2rem;
      background: var(--gradient-1);
      color: white;
      text-decoration: none;
      border-radius: 50px;
      font-weight: 600;
      transition: transform 0.2s;
    }
    
    .pr-link:hover {
      transform: scale(1.05);
    }
    
    /* Responsive */
    @media (max-width: 768px) {
      .hero h1 { font-size: 2rem; }
      .container { padding: 1rem; }
      .cards-grid { grid-template-columns: 1fr 1fr; }
      .card-value { font-size: 1.5rem; }
    }
    
    @media (max-width: 480px) {
      .cards-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="hero">
    <p class="pr-number">${stats.repoOwner}/${stats.repoName}</p>
    <h1>🎊 ${t("prCelebration", language)}</h1>
    ${aiContent.tagline ? `<p class="tagline">"${escapeHtml(aiContent.tagline)}"</p>` : ""}
    <p class="pr-title">#${stats.prNumber}: ${escapeHtml(stats.prTitle)}</p>
    <div class="pr-meta">
      <span class="pr-meta-item">📅 ${formatDate(stats.createdAt)}</span>
      <span class="pr-meta-item">👤 ${stats.authors[0]?.name ?? "Unknown"}</span>
      <span class="pr-meta-item">🌿 ${stats.branchName} → ${stats.baseBranch}</span>
    </div>
    <span class="state-badge">${stateText.toUpperCase()}</span>
    ${stats.labels.length > 0 ? `
    <div class="labels-container" style="justify-content: center; margin-top: 1rem;">
      ${stats.labels.map((l) => `<span class="label">${escapeHtml(l)}</span>`).join("")}
    </div>
    ` : ""}
  </div>
  
  <div class="container">
    <!-- Size Card (AI-generated) -->
    <div class="size-card">
      <div class="content">
        <div class="size-emoji">${aiContent.sizeEmoji}</div>
        <div class="size-title">${escapeHtml(aiContent.sizeTitle)}</div>
        <div class="size-desc">${escapeHtml(aiContent.sizeDescription)}</div>
      </div>
    </div>
    
    <!-- Celebration Message (AI-generated) -->
    ${aiContent.celebrationMessage ? `
    <div class="celebration">
      ${escapeHtml(aiContent.celebrationMessage)}
    </div>
    ` : ""}
    
    <!-- AI Summary -->
    <div class="ai-summary">
      <h3>🤖 ${t("aiSummary", language)}</h3>
      <div class="ai-content">${aiContent.summary}</div>
    </div>
    
    <!-- Stats Cards -->
    <div class="section-header">
      <span class="emoji">📈</span>
      <h2>${t("byTheNumbers", language)}</h2>
    </div>
    
    <div class="cards-grid">
      <div class="card">
        <div class="card-label">${t("filesChanged", language)}</div>
        <div class="card-value cyan">${formatNumber(stats.filesChanged)}</div>
      </div>
      <div class="card">
        <div class="card-label">${t("linesAdded", language)}</div>
        <div class="card-value green">+${formatNumber(stats.linesAdded)}</div>
      </div>
      <div class="card">
        <div class="card-label">${t("linesDeleted", language)}</div>
        <div class="card-value pink">-${formatNumber(stats.linesDeleted)}</div>
      </div>
      <div class="card">
        <div class="card-label">${t("netChange", language)}</div>
        <div class="card-value ${stats.netLines >= 0 ? "green" : "pink"}">${stats.netLines >= 0 ? "+" : ""}${formatNumber(stats.netLines)}</div>
      </div>
      <div class="card">
        <div class="card-label">${t("commits", language)}</div>
        <div class="card-value purple">${stats.totalCommits}</div>
      </div>
      <div class="card">
        <div class="card-label">${t("age", language)}</div>
        <div class="card-value">${stats.ageInDays > 0 ? `${stats.ageInDays} ${t("days", language)}` : `${stats.ageInHours} ${t("hours", language)}`}</div>
      </div>
      ${stats.timeToMerge !== null ? `
      <div class="card">
        <div class="card-label">${t("timeToMerge", language)}</div>
        <div class="card-value green">${stats.timeToMerge > 24 ? `${Math.floor(stats.timeToMerge / 24)}d ${stats.timeToMerge % 24}h` : `${stats.timeToMerge}h`}</div>
      </div>
      ` : ""}
      <div class="card">
        <div class="card-label">${t("reviewers", language)}</div>
        <div class="card-value cyan">${stats.reviewers.length}</div>
        <div class="card-subtitle">${stats.reviewers.slice(0, 3).join(", ")}${stats.reviewers.length > 3 ? "..." : ""}</div>
      </div>
      <div class="card">
        <div class="card-label">${t("approvals", language)}</div>
        <div class="card-value green">${stats.approvalCount}</div>
      </div>
      <div class="card">
        <div class="card-label">${t("comments", language)}</div>
        <div class="card-value">${stats.commentCount}</div>
      </div>
    </div>
    
    <!-- Charts -->
    <div class="section-header">
      <span class="emoji">📊</span>
      <h2>${t("codeChanges", language)}</h2>
    </div>
    
    <div class="cards-grid cards-grid-3">
      <div class="chart-container">
        <div class="chart-title">${t("fileTypes", language)}</div>
        <canvas id="fileTypeChart"></canvas>
      </div>
      ${stats.commits.length > 1 ? `
      <div class="chart-container">
        <div class="chart-title">${t("timeline", language)}</div>
        <canvas id="timelineChart"></canvas>
      </div>
      ` : ""}
    </div>
    
    <!-- Contributors -->
    ${stats.authors.length > 0 ? `
    <div class="section-header">
      <span class="emoji">👥</span>
      <h2>${t("contributors", language)}</h2>
    </div>
    
    <div class="contributor-list">
      ${stats.authors.map((author, i) => `
        <div class="contributor-item">
          <div class="contributor-rank ${i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : ""}">${i + 1}</div>
          <div class="contributor-info">
            <div class="contributor-name">${escapeHtml(author.name)}</div>
            <div class="contributor-stats">${author.commits} ${t("commits", language).toLowerCase()} (${author.percentage}%)</div>
          </div>
        </div>
      `).join("")}
    </div>
    ` : ""}
    
    <!-- Recent Commits -->
    <div class="section-header">
      <span class="emoji">📝</span>
      <h2>${t("commits", language)}</h2>
    </div>
    
    <div class="chart-container">
      <div class="commits-list">
        ${stats.commits.slice(0, 15).map((c) => `
          <div class="commit-item">
            <span class="commit-hash">${c.hash}</span>
            <span class="commit-message">${escapeHtml(c.message)}</span>
            <span class="commit-author">${escapeHtml(c.author)}</span>
          </div>
        `).join("")}
        ${stats.commits.length > 15 ? `<div class="commit-item" style="justify-content: center; color: var(--text-muted);">... and ${stats.commits.length - 15} more commits</div>` : ""}
      </div>
    </div>
    
    <!-- Changed Files -->
    <div class="section-header">
      <span class="emoji">📁</span>
      <h2>${t("mostChangedFiles", language)}</h2>
    </div>
    
    <div class="chart-container">
      <div class="file-list">
        ${stats.changedFiles.slice(0, 20).map((f) => `
          <div class="file-item">
            <span class="file-status ${f.status}">${f.status}</span>
            <div class="file-changes">
              <span class="file-add">+${f.additions}</span>
              <span class="file-del">-${f.deletions}</span>
            </div>
            <span class="file-path">${escapeHtml(f.path)}</span>
          </div>
        `).join("")}
        ${stats.changedFiles.length > 20 ? `<div class="file-item" style="justify-content: center; color: var(--text-muted);">... and ${stats.changedFiles.length - 20} more files</div>` : ""}
      </div>
    </div>
    
    <!-- Link to PR -->
    <div style="text-align: center; margin-top: 3rem;">
      <a href="${stats.prUrl}" target="_blank" class="pr-link">🔗 View PR on GitHub</a>
    </div>
  </div>
  
  <div class="footer">
    <p>${t("generatedWith", language)} <a href="https://github.com/mr-mrs-panda/git-ai-cli">Git AI CLI</a></p>
    <p style="margin-top: 0.5rem;">🎉 ${t("yourPRCelebrated", language)}</p>
  </div>
  
  <script>
    const fileTypeData = ${fileTypeData};
    const timelineData = ${timelineData};
    
    Chart.defaults.color = '#8b949e';
    Chart.defaults.borderColor = '#30363d';
    
    // File types chart
    if (fileTypeData.length > 0) {
      new Chart(document.getElementById('fileTypeChart'), {
        type: 'doughnut',
        data: {
          labels: fileTypeData.map(d => '.' + d.extension),
          datasets: [{
            data: fileTypeData.map(d => d.count),
            backgroundColor: [
              'rgba(88, 166, 255, 0.8)',
              'rgba(63, 185, 80, 0.8)',
              'rgba(163, 113, 247, 0.8)',
              'rgba(240, 136, 62, 0.8)',
              'rgba(247, 120, 186, 0.8)',
              'rgba(118, 227, 234, 0.8)',
            ],
          }]
        },
        options: {
          plugins: {
            legend: { position: 'right' }
          }
        }
      });
    }
    
    // Timeline chart
    const timelineCanvas = document.getElementById('timelineChart');
    if (timelineCanvas && timelineData.length > 1) {
      new Chart(timelineCanvas, {
        type: 'line',
        data: {
          labels: timelineData.map(d => d.date),
          datasets: [{
            data: timelineData.map(d => d.count),
            borderColor: 'rgba(163, 113, 247, 1)',
            backgroundColor: 'rgba(163, 113, 247, 0.2)',
            fill: true,
            tension: 0.4,
          }]
        },
        options: {
          plugins: { legend: { display: false } },
          scales: { 
            y: { beginAtZero: true },
            x: { display: timelineData.length <= 7 }
          }
        }
      });
    }
    
    // Confetti for merged PRs
    ${stats.prState === "merged" ? `
    setTimeout(() => {
      confetti({
        particleCount: 150,
        spread: 100,
        origin: { y: 0.6 }
      });
    }, 500);
    ` : ""}
  </script>
</body>
</html>`;

    return html;
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getSizeInfo(
    size: PRCelebrateStats["sizeCategory"],
    language: Language
): {
    title: string;
    emoji: string;
    description: string;
    color: string;
    secondaryColor: string;
} {
    const sizeMap: Record<PRCelebrateStats["sizeCategory"], { titleKey: keyof Translations; descKey: keyof Translations; emoji: string; color: string; secondaryColor: string }> = {
        tiny: { titleKey: "sizeTiny", descKey: "sizeTinyDesc", emoji: "🐜", color: "#76e3ea", secondaryColor: "#58a6ff" },
        small: { titleKey: "sizeSmall", descKey: "sizeSmallDesc", emoji: "🌱", color: "#3fb950", secondaryColor: "#76e3ea" },
        medium: { titleKey: "sizeMedium", descKey: "sizeMediumDesc", emoji: "📦", color: "#58a6ff", secondaryColor: "#a371f7" },
        large: { titleKey: "sizeLarge", descKey: "sizeLargeDesc", emoji: "🏗️", color: "#a371f7", secondaryColor: "#f778ba" },
        massive: { titleKey: "sizeMassive", descKey: "sizeMassiveDesc", emoji: "🚀", color: "#f0883e", secondaryColor: "#f85149" },
        legendary: { titleKey: "sizeLegendary", descKey: "sizeLegendaryDesc", emoji: "🏆", color: "#ffd700", secondaryColor: "#f0883e" },
    };

    const info = sizeMap[size];
    return {
        title: t(info.titleKey, language),
        description: t(info.descKey, language),
        emoji: info.emoji,
        color: info.color,
        secondaryColor: info.secondaryColor,
    };
}

function getDefaultCelebrationContent(stats: PRCelebrateStats, language: Language): AICelebrationContent {
    const sizeInfo = getSizeInfo(stats.sizeCategory, language);

    const celebrationMessages: Record<string, { en: string; de: string }> = {
        merged: { en: "🎉 This PR has been merged! Time to celebrate!", de: "🎉 Dieser PR wurde gemerged! Zeit zum Feiern!" },
        large: { en: "🔥 This is a significant contribution!", de: "🔥 Das ist ein bedeutender Beitrag!" },
        team: { en: "👥 Great teamwork with multiple contributors!", de: "👥 Tolle Teamarbeit mit mehreren Mitwirkenden!" },
        default: { en: "✨ Another great PR!", de: "✨ Noch ein toller PR!" },
    };

    let celebrationKey = "default";
    if (stats.prState === "merged") celebrationKey = "merged";
    else if (stats.linesAdded + stats.linesDeleted > 500) celebrationKey = "large";
    else if (stats.authors.length > 1) celebrationKey = "team";

    const msg = celebrationMessages[celebrationKey] ?? celebrationMessages.default!;

    return {
        sizeTitle: sizeInfo.title,
        sizeEmoji: sizeInfo.emoji,
        sizeDescription: sizeInfo.description,
        celebrationMessage: language === "german" ? msg.de : msg.en,
        primaryColor: sizeInfo.color,
        secondaryColor: sizeInfo.secondaryColor,
        accentColor: "#58a6ff",
        summary: language === "german"
            ? `<p>Dieser PR bringt <strong>${stats.totalCommits} Commits</strong> mit <strong>+${stats.linesAdded.toLocaleString()}</strong> Zeilen hinzugefügt und <strong>-${stats.linesDeleted.toLocaleString()}</strong> Zeilen entfernt über <strong>${stats.filesChanged} Dateien</strong>.</p>`
            : `<p>This PR brings <strong>${stats.totalCommits} commits</strong> with <strong>+${stats.linesAdded.toLocaleString()}</strong> lines added and <strong>-${stats.linesDeleted.toLocaleString()}</strong> lines removed across <strong>${stats.filesChanged} files</strong>.</p>`,
        tagline: "",
    };
}

async function generateAICelebrationContent(stats: PRCelebrateStats, language: Language): Promise<AICelebrationContent> {
    const defaultContent = getDefaultCelebrationContent(stats, language);

    try {
        const config = await loadConfig();

        if (!config.openaiApiKey) {
            return defaultContent;
        }

        const client = new OpenAI({ apiKey: config.openaiApiKey });

        // Build commit list (sample for large PRs)
        const commitSample = stats.commits.length > 50
            ? [...stats.commits.slice(0, 25), ...stats.commits.slice(-25)]
            : stats.commits;
        const commitList = commitSample
            .map((c) => `- ${c.message}`)
            .join("\n");

        // Build file changes summary (top changed files)
        const filesSummary = stats.changedFiles
            .slice(0, 30)
            .map((f) => `- ${f.path} (+${f.additions}/-${f.deletions})`)
            .join("\n");

        // Color palettes for different PR types
        const colorPalettes = {
            feature: { primary: "#667eea", secondary: "#764ba2", accent: "#58a6ff" },
            bugfix: { primary: "#3fb950", secondary: "#76e3ea", accent: "#58a6ff" },
            refactor: { primary: "#f0883e", secondary: "#f85149", accent: "#ffd700" },
            docs: { primary: "#58a6ff", secondary: "#76e3ea", accent: "#a371f7" },
            test: { primary: "#a371f7", secondary: "#f778ba", accent: "#58a6ff" },
            epic: { primary: "#ffd700", secondary: "#f0883e", accent: "#f85149" },
            merged: { primary: "#a371f7", secondary: "#f778ba", accent: "#3fb950" },
        };

        const prompt = language === "german"
            ? `Du bist ein enthusiastischer KI-Assistent, der Pull Requests feiert. Analysiere diesen PR und erstelle personalisierte Inhalte.

## PR Details
- Titel: ${stats.prTitle}
- Branch: ${stats.branchName} → ${stats.baseBranch}
- Status: ${stats.prState}
- Commits: ${stats.totalCommits}
- Zeilen: +${stats.linesAdded} / -${stats.linesDeleted}
- Dateien: ${stats.filesChanged}
- Mitwirkende: ${stats.authors.map((a) => a.name).join(", ")}
- Labels: ${stats.labels.join(", ") || "keine"}
${stats.prBody ? `- Beschreibung: ${stats.prBody.substring(0, 800)}` : ""}

## Commits (${stats.totalCommits} total)
${commitList}

## Geänderte Dateien (${stats.filesChanged} total)
${filesSummary}

## Verfügbare Farbpaletten
${JSON.stringify(colorPalettes, null, 2)}

---

Erstelle eine JSON-Antwort mit personalisiertem Inhalt für diesen PR. Wähle kreative Titel und Beschreibungen basierend auf dem Inhalt. 
Wähle Farben die zum PR-Typ passen (Feature=lila, Bugfix=grün, Refactor=orange, Docs=blau, Epic=gold).

JSON Format:
{
  "sizeTitle": "Kreativer Titel für die PR-Größe (z.B. 'Monumentaler Meilenstein 🏔️', 'Code-Tsunami 🌊', etc.)",
  "sizeEmoji": "Passendes Emoji",
  "sizeDescription": "Kurze witzige Beschreibung des PR-Umfangs",
  "celebrationMessage": "Feierliche Nachricht zum PR (mit Emoji)",
  "primaryColor": "Hex-Farbe für Hauptfarbe",
  "secondaryColor": "Hex-Farbe für Sekundärfarbe", 
  "accentColor": "Hex-Farbe für Akzentfarbe",
  "summary": "HTML-Zusammenfassung (2-3 <p> Absätze) was der PR macht und warum er toll ist",
  "tagline": "Kurzer witziger Slogan für den PR (5-10 Wörter)"
}

NUR JSON ausgeben, nichts anderes!`
            : `You are an enthusiastic AI assistant that celebrates Pull Requests. Analyze this PR and create personalized content.

## PR Details
- Title: ${stats.prTitle}
- Branch: ${stats.branchName} → ${stats.baseBranch}
- Status: ${stats.prState}
- Commits: ${stats.totalCommits}
- Lines: +${stats.linesAdded} / -${stats.linesDeleted}
- Files: ${stats.filesChanged}
- Contributors: ${stats.authors.map((a) => a.name).join(", ")}
- Labels: ${stats.labels.join(", ") || "none"}
${stats.prBody ? `- Description: ${stats.prBody.substring(0, 800)}` : ""}

## Commits (${stats.totalCommits} total)
${commitList}

## Changed Files (${stats.filesChanged} total)
${filesSummary}

## Available Color Palettes
${JSON.stringify(colorPalettes, null, 2)}

---

Create a JSON response with personalized content for this PR. Choose creative titles and descriptions based on the content.
Pick colors that match the PR type (Feature=purple, Bugfix=green, Refactor=orange, Docs=blue, Epic=gold).

JSON Format:
{
  "sizeTitle": "Creative title for PR size (e.g. 'Monumental Milestone 🏔️', 'Code Tsunami 🌊', etc.)",
  "sizeEmoji": "Fitting emoji",
  "sizeDescription": "Short witty description of the PR scope",
  "celebrationMessage": "Celebratory message for the PR (with emoji)",
  "primaryColor": "Hex color for primary",
  "secondaryColor": "Hex color for secondary", 
  "accentColor": "Hex color for accent",
  "summary": "HTML summary (2-3 <p> paragraphs) of what the PR does and why it's great",
  "tagline": "Short witty tagline for the PR (5-10 words)"
}

OUTPUT ONLY JSON, nothing else!`;

        const response = await client.chat.completions.create({
            model: config.model || "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.8,
            response_format: { type: "json_object" },
        });

        const content = response.choices[0]?.message?.content?.trim();

        if (content) {
            try {
                const parsed = JSON.parse(content) as Partial<AICelebrationContent>;

                // Validate and merge with defaults
                return {
                    sizeTitle: parsed.sizeTitle || defaultContent.sizeTitle,
                    sizeEmoji: parsed.sizeEmoji || defaultContent.sizeEmoji,
                    sizeDescription: parsed.sizeDescription || defaultContent.sizeDescription,
                    celebrationMessage: parsed.celebrationMessage || defaultContent.celebrationMessage,
                    primaryColor: isValidHexColor(parsed.primaryColor) ? parsed.primaryColor! : defaultContent.primaryColor,
                    secondaryColor: isValidHexColor(parsed.secondaryColor) ? parsed.secondaryColor! : defaultContent.secondaryColor,
                    accentColor: isValidHexColor(parsed.accentColor) ? parsed.accentColor! : defaultContent.accentColor,
                    summary: parsed.summary || defaultContent.summary,
                    tagline: parsed.tagline || "",
                };
            } catch {
                return defaultContent;
            }
        }

        return defaultContent;
    } catch {
        return defaultContent;
    }
}

function isValidHexColor(color: string | undefined): boolean {
    if (!color) return false;
    return /^#[0-9A-Fa-f]{6}$/.test(color);
}

