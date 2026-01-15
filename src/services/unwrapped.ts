import { Octokit } from "octokit";
import { loadConfig } from "../utils/config.ts";
import { parseGitHubRepo, getLatestVersionTag } from "../utils/git.ts";
import { getGitHubToken } from "../utils/config.ts";
import OpenAI from "openai";

export interface UnwrappedStats {
  // Time range
  startDate: Date;
  endDate: Date;

  // Commit stats
  totalCommits: number;
  topAuthors: Array<{ name: string; commits: number; percentage: number }>;
  commitsByMonth: Array<{ month: string; count: number }>;
  commitsByDayOfWeek: Array<{ day: string; count: number }>;
  commitsByHour: Array<{ hour: number; count: number }>;
  busiestDay: { date: string; count: number };
  longestStreak: number;
  averageCommitsPerWeek: number;

  // File stats
  mostChangedFiles: Array<{ path: string; changes: number }>;
  fileTypesChanged: Array<{ extension: string; count: number }>;
  linesAdded: number;
  linesDeleted: number;

  // PR stats
  totalPRs: number;
  mergedPRs: number;
  averagePRSize: number;
  fastestMerge: { title: string; hours: number } | null;
  slowestMerge: { title: string; days: number } | null;
  prsByMonth: Array<{ month: string; count: number }>;

  // Release stats
  totalReleases: number;
  releases: Array<{ tag: string; name: string; date: string; body: string }>;

  // All commit messages (first line only) for AI analysis
  allCommitMessages: string[];

  // Fun stats
  mostActiveAuthor: { name: string; commits: number } | null;
  nightOwlCommits: number; // commits between 10pm-6am
  weekendWarriorCommits: number;
  averageCommitMessageLength: number;
  longestCommitMessage: { message: string; author: string };
  shortestCommitMessage: { message: string; author: string };
  mostCommonWords: Array<{ word: string; count: number }>;
  emojiCount: number;

  // Repo info
  repoName: string;
  repoOwner: string;
}

export interface UnwrappedOptions {
  onProgress?: (message: string) => void;
}

/**
 * Collect year-in-review stats for a repository
 */
export async function collectUnwrappedStats(
  options: UnwrappedOptions = {}
): Promise<UnwrappedStats> {
  const { onProgress = () => { } } = options;

  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 1);

  const repoInfo = await parseGitHubRepo();
  if (!repoInfo) {
    throw new Error("Could not parse GitHub repository information");
  }

  const { owner, repo } = repoInfo;

  onProgress("📊 Fetching commit history...");

  // Get all commits from the last year
  const commits = await getCommitsForYear(startDate, endDate);

  onProgress(`Found ${commits.length} commits in the last year`);

  // Analyze commits
  onProgress("🔍 Analyzing commit patterns...");
  const commitAnalysis = analyzeCommits(commits, startDate, endDate);

  // Get PR stats if GitHub token is available
  onProgress("🔄 Fetching pull request data...");
  const prStats = await getPRStats(owner, repo, startDate, endDate, onProgress);

  // Get release stats
  onProgress("🏷️ Fetching release information...");
  const releaseStats = await getReleaseStats(owner, repo, startDate, endDate);

  // Get file change stats
  onProgress("📁 Analyzing file changes...");
  const fileStats = await getFileChangeStats(startDate, endDate);

  // Extract all commit messages (first line only) for AI analysis
  const allCommitMessages = commits.map((c) => c.message.split("\n")[0] ?? c.message).slice(0, 200);

  // Combine all stats
  const stats: UnwrappedStats = {
    startDate,
    endDate,
    repoName: repo,
    repoOwner: owner,
    allCommitMessages,
    ...commitAnalysis,
    ...prStats,
    ...releaseStats,
    ...fileStats,
  };

  return stats;
}

interface CommitData {
  hash: string;
  message: string;
  author: string;
  date: Date;
}

async function getCommitsForYear(
  startDate: Date,
  endDate: Date
): Promise<CommitData[]> {
  const formatString = "%H|%s|%an|%aI";
  const proc = Bun.spawn(
    [
      "git",
      "log",
      `--since=${startDate.toISOString()}`,
      `--until=${endDate.toISOString()}`,
      `--pretty=format:${formatString}`,
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
  await proc.exited;

  if (proc.exitCode !== 0) {
    return [];
  }

  const output = await new Response(proc.stdout).text();
  if (!output.trim()) return [];

  return output
    .trim()
    .split("\n")
    .map((line) => {
      const parts = line.split("|");
      return {
        hash: parts[0] ?? "",
        message: parts[1] ?? "",
        author: parts[2] ?? "",
        date: new Date(parts[3] ?? ""),
      };
    })
    .filter((c) => c.hash);
}

function analyzeCommits(commits: CommitData[], startDate: Date, endDate: Date) {
  // Author stats
  const authorCounts = new Map<string, number>();
  commits.forEach((c) => {
    authorCounts.set(c.author, (authorCounts.get(c.author) || 0) + 1);
  });

  const topAuthors = Array.from(authorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({
      name,
      commits: count,
      percentage: Math.round((count / commits.length) * 100),
    }));

  // Commits by month
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const commitsByMonthMap = new Map<string, number>();
  commits.forEach((c) => {
    const key = `${monthNames[c.date.getMonth()]} ${c.date.getFullYear()}`;
    commitsByMonthMap.set(key, (commitsByMonthMap.get(key) || 0) + 1);
  });

  const commitsByMonth = Array.from(commitsByMonthMap.entries()).map(
    ([month, count]) => ({ month, count })
  );

  // Commits by day of week
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayCount: number[] = [0, 0, 0, 0, 0, 0, 0];
  commits.forEach((c) => {
    const dayIndex = c.date.getDay();
    dayCount[dayIndex] = (dayCount[dayIndex] ?? 0) + 1;
  });
  const commitsByDayOfWeek = dayNames.map((day, i) => ({
    day,
    count: dayCount[i] ?? 0,
  }));

  // Commits by hour
  const hourCounts = new Array(24).fill(0);
  commits.forEach((c) => {
    hourCounts[c.date.getHours()]++;
  });
  const commitsByHour = hourCounts.map((count, hour) => ({ hour, count }));

  // Night owl commits (10pm - 6am)
  const nightOwlCommits = commits.filter((c) => {
    const hour = c.date.getHours();
    return hour >= 22 || hour < 6;
  }).length;

  // Weekend warrior
  const weekendWarriorCommits = commits.filter((c) => {
    const day = c.date.getDay();
    return day === 0 || day === 6;
  }).length;

  // Busiest day
  const dayCommits = new Map<string, number>();
  commits.forEach((c) => {
    const key = c.date.toISOString().split("T")[0] ?? "";
    dayCommits.set(key, (dayCommits.get(key) || 0) + 1);
  });

  let busiestDay = { date: "", count: 0 };
  dayCommits.forEach((count, date) => {
    if (count > busiestDay.count) {
      busiestDay = { date, count };
    }
  });

  // Longest streak
  const sortedDays = Array.from(dayCommits.keys()).sort();
  let longestStreak = 0;
  let currentStreak = 0;
  let prevDate: Date | null = null;

  sortedDays.forEach((dateStr) => {
    const current = new Date(dateStr);
    if (prevDate) {
      const diff = Math.floor(
        (current.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (diff === 1) {
        currentStreak++;
      } else {
        currentStreak = 1;
      }
    } else {
      currentStreak = 1;
    }
    longestStreak = Math.max(longestStreak, currentStreak);
    prevDate = current;
  });

  // Average commits per week
  const weeks = Math.ceil(
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 7)
  );
  const averageCommitsPerWeek = Math.round(commits.length / weeks);

  // Commit message analysis
  const messageLengths = commits.map((c) => c.message.length);
  const averageCommitMessageLength = Math.round(
    messageLengths.reduce((a, b) => a + b, 0) / messageLengths.length
  );

  const longestIdx = messageLengths.indexOf(Math.max(...messageLengths));
  const shortestIdx = messageLengths.indexOf(Math.min(...messageLengths));

  const longestCommitMessage = {
    message: commits[longestIdx]?.message ?? "",
    author: commits[longestIdx]?.author ?? "",
  };

  const shortestCommitMessage = {
    message: commits[shortestIdx]?.message ?? "",
    author: commits[shortestIdx]?.author ?? "",
  };

  // Most common words in commit messages
  const wordCounts = new Map<string, number>();
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "as",
    "is",
    "was",
    "are",
    "were",
    "been",
    "be",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "shall",
    "can",
    "it",
    "its",
    "this",
    "that",
    "these",
    "those",
  ]);

  commits.forEach((c) => {
    const words = c.message.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
    words.forEach((word) => {
      if (!stopWords.has(word)) {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
    });
  });

  const mostCommonWords = Array.from(wordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }));

  // Emoji count
  const emojiRegex =
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
  const emojiCount = commits.reduce((acc, c) => {
    const matches = c.message.match(emojiRegex);
    return acc + (matches?.length || 0);
  }, 0);

  // Most active author
  const mostActiveAuthor = topAuthors[0]
    ? { name: topAuthors[0].name, commits: topAuthors[0].commits }
    : null;

  return {
    totalCommits: commits.length,
    topAuthors,
    commitsByMonth,
    commitsByDayOfWeek,
    commitsByHour,
    busiestDay,
    longestStreak,
    averageCommitsPerWeek,
    nightOwlCommits,
    weekendWarriorCommits,
    averageCommitMessageLength,
    longestCommitMessage,
    shortestCommitMessage,
    mostCommonWords,
    emojiCount,
    mostActiveAuthor,
  };
}

async function getPRStats(
  owner: string,
  repo: string,
  startDate: Date,
  endDate: Date,
  onProgress: (msg: string) => void
) {
  const githubToken = await getGitHubToken();

  if (!githubToken) {
    onProgress("⚠️ No GitHub token - skipping PR stats");
    return {
      totalPRs: 0,
      mergedPRs: 0,
      averagePRSize: 0,
      fastestMerge: null,
      slowestMerge: null,
      prsByMonth: [],
    };
  }

  try {
    const octokit = new Octokit({ auth: githubToken });

    // Fetch closed PRs
    const { data: prs } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: "closed",
      sort: "updated",
      direction: "desc",
      per_page: 100,
    });

    // Filter to PRs in the time range
    const relevantPRs = prs.filter((pr) => {
      if (!pr.merged_at) return false;
      const mergedAt = new Date(pr.merged_at);
      return mergedAt >= startDate && mergedAt <= endDate;
    });

    onProgress(`Found ${relevantPRs.length} merged PRs`);

    // Calculate merge times
    const mergeTimes = relevantPRs
      .map((pr) => {
        const created = new Date(pr.created_at);
        const merged = new Date(pr.merged_at!);
        const hours = (merged.getTime() - created.getTime()) / (1000 * 60 * 60);
        return { title: pr.title, hours };
      })
      .sort((a, b) => a.hours - b.hours);

    const fastestMerge =
      mergeTimes.length > 0 && mergeTimes[0]
        ? { title: mergeTimes[0].title, hours: Math.round(mergeTimes[0].hours) }
        : null;

    const lastMerge = mergeTimes[mergeTimes.length - 1];
    const slowestMerge =
      mergeTimes.length > 0 && lastMerge
        ? {
          title: lastMerge.title,
          days: Math.round(lastMerge.hours / 24),
        }
        : null;

    // PRs by month
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const prsByMonthMap = new Map<string, number>();
    relevantPRs.forEach((pr) => {
      const date = new Date(pr.merged_at!);
      const key = `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
      prsByMonthMap.set(key, (prsByMonthMap.get(key) || 0) + 1);
    });

    const prsByMonth = Array.from(prsByMonthMap.entries()).map(
      ([month, count]) => ({ month, count })
    );

    return {
      totalPRs: prs.filter((pr) => {
        const created = new Date(pr.created_at);
        return created >= startDate && created <= endDate;
      }).length,
      mergedPRs: relevantPRs.length,
      averagePRSize: 0, // Would need additional API calls
      fastestMerge,
      slowestMerge,
      prsByMonth,
    };
  } catch (error) {
    onProgress("⚠️ Could not fetch PR stats");
    return {
      totalPRs: 0,
      mergedPRs: 0,
      averagePRSize: 0,
      fastestMerge: null,
      slowestMerge: null,
      prsByMonth: [],
    };
  }
}

async function getReleaseStats(
  owner: string,
  repo: string,
  startDate: Date,
  endDate: Date
) {
  const githubToken = await getGitHubToken();

  if (!githubToken) {
    // Fall back to local tags
    const proc = Bun.spawn(
      [
        "git",
        "tag",
        "-l",
        "v*",
        "--sort=-version:refname",
        "--format=%(refname:short)|%(creatordate:iso)",
      ],
      { stdout: "pipe", stderr: "pipe" }
    );
    await proc.exited;

    const output = await new Response(proc.stdout).text();
    const releases = output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [tag, dateStr] = line.split("|");
        return { tag: tag ?? "", name: tag ?? "", date: dateStr ?? "", body: "" };
      })
      .filter((r) => {
        const date = new Date(r.date);
        return date >= startDate && date <= endDate;
      });

    return {
      totalReleases: releases.length,
      releases,
    };
  }

  try {
    const octokit = new Octokit({ auth: githubToken });

    // Fetch all releases with pagination
    const allReleases: Array<{
      tag_name: string;
      name: string | null;
      published_at: string | null;
      created_at: string;
      body: string | null;
    }> = [];
    
    let page = 1;
    let hasMore = true;
    
    while (hasMore) {
      const { data: releases } = await octokit.rest.repos.listReleases({
        owner,
        repo,
        per_page: 100,
        page,
      });
      
      if (releases.length === 0) {
        hasMore = false;
      } else {
        allReleases.push(...releases);
        page++;
        
        // Stop if we've gone past our date range (releases are sorted by date desc)
        const oldestInBatch = releases[releases.length - 1];
        if (oldestInBatch) {
          const oldestDate = new Date(oldestInBatch.published_at || oldestInBatch.created_at);
          if (oldestDate < startDate) {
            hasMore = false;
          }
        }
      }
    }

    const relevantReleases = allReleases
      .filter((r) => {
        const date = new Date(r.published_at || r.created_at);
        return date >= startDate && date <= endDate;
      })
      .map((r) => ({
        tag: r.tag_name,
        name: r.name || r.tag_name,
        date: r.published_at || r.created_at,
        body: r.body || "",
      }));

    return {
      totalReleases: relevantReleases.length,
      releases: relevantReleases,
    };
  } catch {
    return {
      totalReleases: 0,
      releases: [],
    };
  }
}

async function getFileChangeStats(startDate: Date, endDate: Date) {
  // Get file change stats using git log
  const proc = Bun.spawn(
    [
      "git",
      "log",
      `--since=${startDate.toISOString()}`,
      `--until=${endDate.toISOString()}`,
      "--numstat",
      "--format=",
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
  await proc.exited;

  const output = await new Response(proc.stdout).text();

  const fileChanges = new Map<string, number>();
  const extensionCounts = new Map<string, number>();
  let linesAdded = 0;
  let linesDeleted = 0;

  output
    .trim()
    .split("\n")
    .forEach((line) => {
      const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (match) {
        const added = match[1] === "-" ? 0 : parseInt(match[1] ?? "0", 10);
        const deleted = match[2] === "-" ? 0 : parseInt(match[2] ?? "0", 10);
        const path = match[3] ?? "";

        linesAdded += added;
        linesDeleted += deleted;

        const changes = added + deleted;
        fileChanges.set(path, (fileChanges.get(path) || 0) + changes);

        const ext = path.split(".").pop() || "none";
        extensionCounts.set(ext, (extensionCounts.get(ext) || 0) + 1);
      }
    });

  const mostChangedFiles = Array.from(fileChanges.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, changes]) => ({ path, changes }));

  const fileTypesChanged = Array.from(extensionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([extension, count]) => ({ extension, count }));

  return {
    mostChangedFiles,
    fileTypesChanged,
    linesAdded,
    linesDeleted,
  };
}

/**
 * Generate HTML report from stats
 */
export async function generateUnwrappedHTML(
  stats: UnwrappedStats,
  options: UnwrappedOptions = {}
): Promise<string> {
  const { onProgress = () => { } } = options;

  onProgress("🎨 Generating AI summary...");

  // Generate AI summary
  const summary = await generateAISummary(stats);

  onProgress("📦 Summarizing new features...");
  const featuresSummary = await generateFeaturesSummary(stats);

  onProgress("✨ Creating beautiful HTML report...");

  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  // Calculate personality type based on stats
  const personality = getDevPersonality(stats);

  // Generate chart data
  const monthlyData = JSON.stringify(stats.commitsByMonth);
  const dayData = JSON.stringify(stats.commitsByDayOfWeek);
  const hourData = JSON.stringify(stats.commitsByHour);
  const fileTypeData = JSON.stringify(stats.fileTypesChanged.slice(0, 6));

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${stats.repoOwner}/${stats.repoName} - Unwrapped ${new Date().getFullYear()}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
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
      --accent-blue: #58a6ff;
      --accent-purple: #a371f7;
      --accent-orange: #f0883e;
      --accent-pink: #f778ba;
      --accent-cyan: #76e3ea;
      --gradient-1: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      --gradient-2: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
      --gradient-3: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
      --gradient-4: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
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
      background: radial-gradient(ellipse at center, rgba(88, 166, 255, 0.15) 0%, transparent 70%);
      pointer-events: none;
    }
    
    .hero h1 {
      font-size: 3.5rem;
      font-weight: 900;
      background: var(--gradient-1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 0.5rem;
    }
    
    .hero .repo-name {
      font-size: 1.5rem;
      color: var(--text-secondary);
      margin-bottom: 1rem;
    }
    
    .hero .date-range {
      color: var(--text-muted);
      font-size: 1rem;
    }
    
    .year-badge {
      display: inline-block;
      background: var(--gradient-2);
      padding: 0.5rem 1.5rem;
      border-radius: 50px;
      font-weight: 700;
      font-size: 1.25rem;
      margin-top: 1.5rem;
      animation: pulse 2s infinite;
    }
    
    @keyframes pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.05); }
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
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1.5rem;
    }
    
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 1.5rem;
      transition: all 0.3s ease;
    }
    
    .card:hover {
      background: var(--bg-card-hover);
      transform: translateY(-4px);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
    }
    
    .card-label {
      font-size: 0.875rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }
    
    .card-value {
      font-size: 3rem;
      font-weight: 800;
      background: var(--gradient-1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    
    .card-value.green { background: var(--gradient-4); -webkit-background-clip: text; background-clip: text; }
    .card-value.pink { background: var(--gradient-2); -webkit-background-clip: text; background-clip: text; }
    .card-value.cyan { background: var(--gradient-3); -webkit-background-clip: text; background-clip: text; }
    
    .card-subtitle {
      font-size: 0.875rem;
      color: var(--text-secondary);
      margin-top: 0.25rem;
    }
    
    /* Big Stats */
    .big-stat {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 2.5rem;
      text-align: center;
      margin: 2rem 0;
    }
    
    .big-stat .number {
      font-size: 5rem;
      font-weight: 900;
      background: var(--gradient-1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      line-height: 1;
    }
    
    .big-stat .label {
      font-size: 1.5rem;
      color: var(--text-secondary);
      margin-top: 0.5rem;
    }
    
    /* Personality Card */
    .personality-card {
      background: linear-gradient(135deg, #1a1f35 0%, #161b22 100%);
      border: 2px solid var(--accent-purple);
      border-radius: 24px;
      padding: 2.5rem;
      text-align: center;
      margin: 2rem 0;
      position: relative;
      overflow: hidden;
    }
    
    .personality-card::before {
      content: '';
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: conic-gradient(from 0deg, transparent, rgba(163, 113, 247, 0.1), transparent 30%);
      animation: rotate 10s linear infinite;
    }
    
    @keyframes rotate {
      100% { transform: rotate(360deg); }
    }
    
    .personality-card .content {
      position: relative;
      z-index: 1;
    }
    
    .personality-type {
      font-size: 2.5rem;
      font-weight: 800;
      background: linear-gradient(135deg, var(--accent-purple), var(--accent-pink));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    
    .personality-desc {
      color: var(--text-secondary);
      font-size: 1.1rem;
      margin-top: 0.5rem;
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
    
    /* Top Authors */
    .author-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    
    .author-item {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1rem;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
    }
    
    .author-rank {
      font-size: 1.5rem;
      font-weight: 800;
      width: 40px;
      text-align: center;
    }
    
    .author-rank.gold { color: #ffd700; }
    .author-rank.silver { color: #c0c0c0; }
    .author-rank.bronze { color: #cd7f32; }
    
    .author-info {
      flex: 1;
    }
    
    .author-name {
      font-weight: 600;
      font-size: 1.1rem;
    }
    
    .author-stats {
      color: var(--text-secondary);
      font-size: 0.875rem;
    }
    
    .author-bar {
      width: 100px;
      height: 8px;
      background: var(--border);
      border-radius: 4px;
      overflow: hidden;
    }
    
    .author-bar-fill {
      height: 100%;
      background: var(--gradient-1);
      border-radius: 4px;
    }
    
    /* Fun Facts */
    .fun-facts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.5rem;
    }
    
    .fun-fact {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 1.5rem;
      display: flex;
      align-items: flex-start;
      gap: 1rem;
    }
    
    .fun-fact .emoji {
      font-size: 2rem;
    }
    
    .fun-fact .text h4 {
      font-weight: 600;
      margin-bottom: 0.25rem;
    }
    
    .fun-fact .text p {
      color: var(--text-secondary);
      font-size: 0.9rem;
    }
    
    /* AI Summary */
    .ai-summary {
      background: linear-gradient(135deg, #1f2937 0%, #161b22 100%);
      border: 2px solid var(--accent-blue);
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
    
    .ai-summary .ai-content p:last-child {
      margin-bottom: 0;
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
      font-weight: 600;
    }
    
    /* Features Summary */
    .features-summary {
      background: linear-gradient(135deg, #1a2f1a 0%, #161b22 100%);
      border: 2px solid var(--accent-green);
      border-radius: 24px;
      padding: 2.5rem;
      margin: 2rem 0;
    }
    
    .features-summary h3 {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 1.5rem;
      margin-bottom: 1.5rem;
      color: var(--accent-green);
    }
    
    .features-summary .features-content {
      color: var(--text-secondary);
      font-size: 1rem;
      line-height: 1.7;
    }
    
    .features-summary .feature-category {
      margin-bottom: 1.5rem;
    }
    
    .features-summary .feature-category:last-child {
      margin-bottom: 0;
    }
    
    .features-summary .feature-category h4 {
      color: var(--text-primary);
      font-size: 1.1rem;
      margin-bottom: 0.75rem;
    }
    
    .features-summary ul {
      margin: 0;
      padding-left: 1.5rem;
    }
    
    .features-summary li {
      margin-bottom: 0.5rem;
    }
    
    .features-summary strong {
      color: var(--text-primary);
    }
    
    .features-summary p {
      margin-bottom: 0.75rem;
    }
    
    /* Word Cloud */
    .word-cloud {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      justify-content: center;
      padding: 1.5rem;
    }
    
    .word-tag {
      padding: 0.5rem 1rem;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 50px;
      font-size: 0.9rem;
    }
    
    .word-tag.size-1 { font-size: 1.5rem; font-weight: 700; background: var(--gradient-1); color: white; }
    .word-tag.size-2 { font-size: 1.25rem; font-weight: 600; }
    .word-tag.size-3 { font-size: 1rem; }
    
    /* File Changes */
    .file-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
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
      color: var(--accent-green);
      font-weight: 600;
      min-width: 60px;
    }
    
    .file-path {
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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
      color: var(--accent-blue);
      text-decoration: none;
    }
    
    /* Responsive */
    @media (max-width: 768px) {
      .hero h1 { font-size: 2.5rem; }
      .big-stat .number { font-size: 3.5rem; }
      .container { padding: 1rem; }
    }
  </style>
</head>
<body>
  <div class="hero">
    <h1>🎉 Unwrapped</h1>
    <p class="repo-name">${stats.repoOwner}/${stats.repoName}</p>
    <p class="date-range">${formatDate(stats.startDate)} - ${formatDate(stats.endDate)}</p>
    <div class="year-badge">${new Date().getFullYear()} Year in Review</div>
  </div>
  
  <div class="container">
    <!-- Big Stats -->
    <div class="big-stat">
      <div class="number">${stats.totalCommits.toLocaleString()}</div>
      <div class="label">commits pushed this year</div>
    </div>
    
    <!-- Developer Personality -->
    <div class="personality-card">
      <div class="content">
        <div style="font-size: 3rem; margin-bottom: 1rem;">${personality.emoji}</div>
        <div class="personality-type">${personality.type}</div>
        <div class="personality-desc">${personality.description}</div>
      </div>
    </div>
    
    <!-- AI Summary -->
    <div class="ai-summary">
      <h3>🤖 AI Year in Review</h3>
      <div class="ai-content">${summary}</div>
    </div>
    
    <!-- Features Summary -->
    ${featuresSummary ? `
    <div class="features-summary">
      <h3>📦 What You Shipped</h3>
      <div class="features-content">${featuresSummary}</div>
    </div>
    ` : ''}
    
    <!-- Quick Stats Cards -->
    <div class="section-header">
      <span class="emoji">📈</span>
      <h2>By The Numbers</h2>
    </div>
    
    <div class="cards-grid">
      <div class="card">
        <div class="card-label">Lines Added</div>
        <div class="card-value green">+${stats.linesAdded.toLocaleString()}</div>
      </div>
      <div class="card">
        <div class="card-label">Lines Deleted</div>
        <div class="card-value pink">-${stats.linesDeleted.toLocaleString()}</div>
      </div>
      <div class="card">
        <div class="card-label">Pull Requests Merged</div>
        <div class="card-value cyan">${stats.mergedPRs}</div>
      </div>
      <div class="card">
        <div class="card-label">Releases</div>
        <div class="card-value">${stats.totalReleases}</div>
      </div>
      <div class="card">
        <div class="card-label">Avg Commits/Week</div>
        <div class="card-value green">${stats.averageCommitsPerWeek}</div>
      </div>
      <div class="card">
        <div class="card-label">Longest Streak</div>
        <div class="card-value pink">${stats.longestStreak} days</div>
      </div>
    </div>
    
    <!-- Top Contributors -->
    ${stats.topAuthors.length > 0 ? `
    <div class="section-header">
      <span class="emoji">🏆</span>
      <h2>Top Contributors</h2>
    </div>
    
    <div class="author-list">
      ${stats.topAuthors.map((author, i) => `
        <div class="author-item">
          <div class="author-rank ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}">${i + 1}</div>
          <div class="author-info">
            <div class="author-name">${author.name}</div>
            <div class="author-stats">${author.commits} commits (${author.percentage}%)</div>
          </div>
          <div class="author-bar">
            <div class="author-bar-fill" style="width: ${author.percentage}%"></div>
          </div>
        </div>
      `).join('')}
    </div>
    ` : ''}
    
    <!-- Charts -->
    <div class="section-header">
      <span class="emoji">📊</span>
      <h2>Activity Patterns</h2>
    </div>
    
    <div class="cards-grid">
      <div class="chart-container">
        <div class="chart-title">Commits by Month</div>
        <canvas id="monthlyChart"></canvas>
      </div>
      <div class="chart-container">
        <div class="chart-title">Commits by Day</div>
        <canvas id="dayChart"></canvas>
      </div>
    </div>
    
    <div class="cards-grid">
      <div class="chart-container">
        <div class="chart-title">Commits by Hour</div>
        <canvas id="hourChart"></canvas>
      </div>
      <div class="chart-container">
        <div class="chart-title">File Types Changed</div>
        <canvas id="fileTypeChart"></canvas>
      </div>
    </div>
    
    <!-- Fun Facts -->
    <div class="section-header">
      <span class="emoji">🎯</span>
      <h2>Fun Facts</h2>
    </div>
    
    <div class="fun-facts">
      <div class="fun-fact">
        <div class="emoji">🌙</div>
        <div class="text">
          <h4>Night Owl Commits</h4>
          <p>${stats.nightOwlCommits} commits between 10pm - 6am</p>
        </div>
      </div>
      <div class="fun-fact">
        <div class="emoji">🏖️</div>
        <div class="text">
          <h4>Weekend Warrior</h4>
          <p>${stats.weekendWarriorCommits} commits on weekends</p>
        </div>
      </div>
      <div class="fun-fact">
        <div class="emoji">🔥</div>
        <div class="text">
          <h4>Busiest Day</h4>
          <p>${stats.busiestDay.count} commits on ${stats.busiestDay.date}</p>
        </div>
      </div>
      <div class="fun-fact">
        <div class="emoji">😀</div>
        <div class="text">
          <h4>Emoji Usage</h4>
          <p>${stats.emojiCount} emojis in commit messages</p>
        </div>
      </div>
      ${stats.fastestMerge ? `
      <div class="fun-fact">
        <div class="emoji">⚡</div>
        <div class="text">
          <h4>Fastest PR Merge</h4>
          <p>"${stats.fastestMerge.title.substring(0, 40)}..." in ${stats.fastestMerge.hours}h</p>
        </div>
      </div>
      ` : ''}
      ${stats.slowestMerge ? `
      <div class="fun-fact">
        <div class="emoji">🐢</div>
        <div class="text">
          <h4>Longest PR</h4>
          <p>"${stats.slowestMerge.title.substring(0, 40)}..." took ${stats.slowestMerge.days} days</p>
        </div>
      </div>
      ` : ''}
    </div>
    
    <!-- Most Common Words -->
    <div class="section-header">
      <span class="emoji">💬</span>
      <h2>Commit Message Word Cloud</h2>
    </div>
    
    <div class="chart-container">
      <div class="word-cloud">
        ${stats.mostCommonWords.map((w, i) => `
          <span class="word-tag ${i < 2 ? 'size-1' : i < 5 ? 'size-2' : 'size-3'}">${w.word} (${w.count})</span>
        `).join('')}
      </div>
    </div>
    
    <!-- Most Changed Files -->
    <div class="section-header">
      <span class="emoji">📁</span>
      <h2>Most Changed Files</h2>
    </div>
    
    <div class="chart-container">
      <div class="file-list">
        ${stats.mostChangedFiles.slice(0, 8).map(f => `
          <div class="file-item">
            <span class="file-changes">+${f.changes}</span>
            <span class="file-path">${f.path}</span>
          </div>
        `).join('')}
      </div>
    </div>
    
    <!-- Releases -->
    ${stats.releases.length > 0 ? `
    <div class="section-header">
      <span class="emoji">🏷️</span>
      <h2>Releases This Year</h2>
    </div>
    
    <div class="cards-grid">
      ${stats.releases.slice(0, 6).map(r => `
        <div class="card">
          <div class="card-label">${new Date(r.date).toLocaleDateString()}</div>
          <div class="card-value" style="font-size: 1.5rem;">${r.tag}</div>
          <div class="card-subtitle">${r.name}</div>
        </div>
      `).join('')}
    </div>
    ` : ''}
  </div>
  
  <div class="footer">
    <p>Generated with ❤️ by <a href="https://github.com/mr-mrs-panda/git-ai-cli">Git AI CLI</a></p>
    <p style="margin-top: 0.5rem;">🎵 Your year in code, unwrapped!</p>
  </div>
  
  <script>
    const monthlyData = ${monthlyData};
    const dayData = ${dayData};
    const hourData = ${hourData};
    const fileTypeData = ${fileTypeData};
    
    Chart.defaults.color = '#8b949e';
    Chart.defaults.borderColor = '#30363d';
    
    // Monthly commits chart
    new Chart(document.getElementById('monthlyChart'), {
      type: 'bar',
      data: {
        labels: monthlyData.map(d => d.month),
        datasets: [{
          data: monthlyData.map(d => d.count),
          backgroundColor: 'rgba(88, 166, 255, 0.7)',
          borderRadius: 6,
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });
    
    // Day of week chart
    new Chart(document.getElementById('dayChart'), {
      type: 'bar',
      data: {
        labels: dayData.map(d => d.day),
        datasets: [{
          data: dayData.map(d => d.count),
          backgroundColor: [
            'rgba(247, 120, 186, 0.7)',
            'rgba(63, 185, 80, 0.7)',
            'rgba(63, 185, 80, 0.7)',
            'rgba(63, 185, 80, 0.7)',
            'rgba(63, 185, 80, 0.7)',
            'rgba(63, 185, 80, 0.7)',
            'rgba(247, 120, 186, 0.7)',
          ],
          borderRadius: 6,
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });
    
    // Hour chart
    new Chart(document.getElementById('hourChart'), {
      type: 'line',
      data: {
        labels: hourData.map(d => d.hour + ':00'),
        datasets: [{
          data: hourData.map(d => d.count),
          borderColor: 'rgba(163, 113, 247, 1)',
          backgroundColor: 'rgba(163, 113, 247, 0.2)',
          fill: true,
          tension: 0.4,
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });
    
    // File types chart
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
  </script>
</body>
</html>`;

  return html;
}

function getDevPersonality(stats: UnwrappedStats): {
  type: string;
  emoji: string;
  description: string;
} {
  const nightRatio = stats.nightOwlCommits / stats.totalCommits;
  const weekendRatio = stats.weekendWarriorCommits / stats.totalCommits;

  if (nightRatio > 0.3) {
    return {
      type: "Night Owl 🦉",
      emoji: "🌙",
      description:
        "You thrive when the world sleeps. Your best code happens after midnight.",
    };
  }

  if (weekendRatio > 0.4) {
    return {
      type: "Weekend Warrior 💪",
      emoji: "🏋️",
      description:
        "Who needs rest? You ship code while others are relaxing.",
    };
  }

  if (stats.averageCommitsPerWeek > 20) {
    return {
      type: "Commit Machine 🤖",
      emoji: "⚙️",
      description:
        "You're a coding powerhouse. Small, frequent commits keep the project moving.",
    };
  }

  if (stats.longestStreak > 14) {
    return {
      type: "Streak Master 🔥",
      emoji: "🔥",
      description:
        "Consistency is your superpower. Your commit streak is legendary.",
    };
  }

  if (stats.emojiCount > 20) {
    return {
      type: "Emoji Enthusiast ✨",
      emoji: "🎨",
      description:
        "Your commit messages are works of art, complete with expressive emojis.",
    };
  }

  if (stats.mergedPRs > 20) {
    return {
      type: "PR Champion 🏆",
      emoji: "🚀",
      description:
        "You're a collaboration hero, merging PRs and keeping the team unblocked.",
    };
  }

  return {
    type: "Steady Builder 🏗️",
    emoji: "🛠️",
    description:
      "You're the reliable backbone of the project. Consistent and dependable.",
  };
}

async function generateAISummary(stats: UnwrappedStats): Promise<string> {
  try {
    const config = await loadConfig();

    const fallbackHtml = `<p>🚀 This year, <strong>${stats.repoOwner}/${stats.repoName}</strong> saw <strong>${stats.totalCommits}</strong> commits from ${stats.topAuthors.length} contributors.</p>
<p>The team added <strong>+${stats.linesAdded.toLocaleString()}</strong> lines and removed <strong>-${stats.linesDeleted.toLocaleString()}</strong> lines of code.</p>
${stats.mergedPRs > 0 ? `<p><strong>${stats.mergedPRs}</strong> pull requests were merged and the project shipped <strong>${stats.totalReleases}</strong> releases.</p>` : `<p>The project shipped <strong>${stats.totalReleases}</strong> releases.</p>`}
<p>🎉 Keep up the great work!</p>`;

    if (!config.openaiApiKey) {
      return fallbackHtml;
    }

    const client = new OpenAI({ apiKey: config.openaiApiKey });

    // Prepare release titles for context
    const releaseTitles = stats.releases
      .map((r) => `${r.tag}: ${r.name}`)
      .join("\n");

    // Sample commit messages (take a good spread - first 50, last 50, or all if < 100)
    let commitSample: string[];
    if (stats.allCommitMessages.length <= 100) {
      commitSample = stats.allCommitMessages;
    } else {
      const first50 = stats.allCommitMessages.slice(0, 50);
      const last50 = stats.allCommitMessages.slice(-50);
      commitSample = [...first50, ...last50];
    }
    const commitList = commitSample.join("\n");

    const prompt = `You are a friendly, upbeat AI writing a "Year in Review" summary for a GitHub repository - like Spotify Wrapped but for code!

Analyze the repository's year based on both the statistics AND the actual commit messages and releases to tell a compelling story.

## Repository Stats
- Repository: ${stats.repoOwner}/${stats.repoName}
- Total Commits: ${stats.totalCommits}
- Top Author: ${stats.mostActiveAuthor?.name || 'Unknown'} (${stats.mostActiveAuthor?.commits || 0} commits)
- Lines Added: ${stats.linesAdded.toLocaleString()}
- Lines Deleted: ${stats.linesDeleted.toLocaleString()}
- Pull Requests Merged: ${stats.mergedPRs}
- Releases: ${stats.totalReleases}
- Night Owl Commits (10pm-6am): ${stats.nightOwlCommits}
- Weekend Commits: ${stats.weekendWarriorCommits}
- Longest Streak: ${stats.longestStreak} days
- Busiest Day: ${stats.busiestDay.date} with ${stats.busiestDay.count} commits
- Most Used Words: ${stats.mostCommonWords.slice(0, 5).map(w => w.word).join(', ')}

${stats.releases.length > 0 ? `## Releases This Year
${releaseTitles}` : ''}

## Sample Commit Messages (to understand what was worked on)
${commitList}

---

Based on ALL of this information, write a fun, insightful 3-4 sentence summary that:
1. Identifies the main themes/features that were worked on this year (based on commits & releases)
2. Highlights an interesting pattern or achievement
3. Has a celebratory, Spotify-Wrapped-style tone
4. Mentions specific things that happened (not just numbers)

Be creative and tell the story of this repository's year!

Write in **simple HTML format** (will be embedded in a styled container).

RULES:
1. Use <p> tags for paragraphs
2. Use <strong> for emphasis on key achievements/numbers
3. Use <ul><li> for listing main themes/features worked on
4. Use emojis liberally 🎉🚀💪
5. 3-4 short paragraphs max
6. Be celebratory, Spotify-Wrapped-style!
7. Mention SPECIFIC things that happened (features, fixes, improvements based on commits)

Example format:
<p>🚀 What a year for <strong>repo-name</strong>! You shipped <strong>X releases</strong> including the amazing <strong>feature Y</strong>.</p>
<p>Your main focus areas were:</p>
<ul>
  <li>💡 Feature A and B</li>
  <li>🐛 Bug fixes and improvements</li>
  <li>🔧 Refactoring and cleanup</li>
</ul>
<p>🎉 Keep shipping amazing code!</p>

OUTPUT ONLY THE HTML, nothing else.`;

    const response = await client.chat.completions.create({
      model: config.model || "gpt-5.2",
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.choices[0]?.message?.content?.trim();
    
    // Validate it looks like HTML
    if (content && (content.includes("<p>") || content.includes("<ul>"))) {
      return content;
    }
    
    // If not HTML, wrap it
    if (content) {
      return `<p>${content.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
    }

    return `<p>What a year for <strong>${stats.repoName}</strong>! ${stats.totalCommits} commits and counting. 🎉</p>`;
  } catch {
    return `<p>This year, <strong>${stats.repoOwner}/${stats.repoName}</strong> saw <strong>${stats.totalCommits}</strong> commits.</p>
<p>The team added <span style="color: #3fb950;">+${stats.linesAdded.toLocaleString()}</span> lines of code and shipped <strong>${stats.totalReleases}</strong> releases.</p>
<p>🎉 Amazing work!</p>`;
  }
}

/**
 * Generate AI-powered features summary based on release notes
 */
async function generateFeaturesSummary(stats: UnwrappedStats): Promise<string> {
  // If no releases, return empty
  if (stats.releases.length === 0) {
    return "";
  }

  try {
    const config = await loadConfig();

    // Build release info with bodies
    const releaseInfo = stats.releases
      .map((r) => {
        let info = `### ${r.tag}: ${r.name}`;
        if (r.body) {
          // Truncate very long release notes
          const body = r.body.length > 1000 ? r.body.substring(0, 1000) + "..." : r.body;
          info += `\n${body}`;
        }
        return info;
      })
      .join("\n\n");

    const fallbackHtml = `<p>This year you shipped <strong>${stats.totalReleases} releases</strong>:</p>
<ul>
${stats.releases.slice(0, 5).map((r) => `  <li><strong>${r.tag}</strong>: ${r.name}</li>`).join("\n")}
</ul>`;

    if (!config.openaiApiKey) {
      return fallbackHtml;
    }

    const client = new OpenAI({ apiKey: config.openaiApiKey });

    const prompt = `You are an AI that summarizes software releases into a concise feature overview.

Analyze these GitHub releases from the past year and create a **beautiful HTML summary** of the main features and improvements.

## Releases
${releaseInfo}

---

Create a visually appealing HTML summary that:
1. Groups features into categories (🚀 Features, 🐛 Bug Fixes, 🔧 Improvements, etc.)
2. Highlights the most impactful changes
3. Uses <strong> for key feature names
4. Uses emojis for visual appeal
5. Is concise - max 3-4 bullet points per category
6. Only includes categories that have content

Format:
<div class="feature-category">
  <h4>🚀 New Features</h4>
  <ul>
    <li><strong>Feature Name</strong> - Brief description</li>
  </ul>
</div>
<div class="feature-category">
  <h4>🔧 Improvements</h4>
  <ul>
    <li>Improvement 1</li>
  </ul>
</div>

OUTPUT ONLY THE HTML, nothing else.`;

    const response = await client.chat.completions.create({
      model: config.model || "gpt-5.2",
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.choices[0]?.message?.content?.trim();

    if (content && (content.includes("<") || content.includes(">"))) {
      return content;
    }

    return fallbackHtml;
  } catch {
    return `<p>Shipped <strong>${stats.totalReleases} releases</strong> this year! 🚀</p>`;
  }
}
