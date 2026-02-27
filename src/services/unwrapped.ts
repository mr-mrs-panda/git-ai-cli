import { Octokit } from "octokit";
import { parseGitHubRepo, getLatestVersionTag } from "../utils/git.ts";
import { getGitHubToken } from "../utils/config.ts";
import { invokeText } from "../utils/llm.ts";

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

export type Language = "english" | "german";

export interface UnwrappedOptions {
  onProgress?: (message: string) => void;
  language?: Language;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function sanitizeAiSummaryToSafeHtml(content: string): string {
  const plain = content.replace(/<[^>]*>/g, "").replace(/\r/g, "").trim();
  if (!plain) {
    return "<p>No summary available.</p>";
  }

  const blocks = plain
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  return blocks
    .map((block) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const isBulletBlock = lines.length > 0 && lines.every((line) => /^[-*•]\s+/.test(line));

      if (isBulletBlock) {
        const items = lines
          .map((line) => line.replace(/^[-*•]\s+/, ""))
          .map((line) => `<li>${escapeHtml(line)}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }

      return `<p>${escapeHtml(lines.join(" "))}</p>`;
    })
    .join("\n");
}

// Translation system
interface Translations {
  unwrapped: string;
  yearInReview: string;
  byTheNumbers: string;
  topContributors: string;
  activityPatterns: string;
  funFacts: string;
  commitMessageWordCloud: string;
  mostChangedFiles: string;
  releasesThisYear: string;
  commitsPushedThisYear: string;
  linesAdded: string;
  linesDeleted: string;
  pullRequestsMerged: string;
  releases: string;
  avgCommitsPerWeek: string;
  longestStreak: string;
  days: string;
  nightOwlCommits: string;
  nightOwlCommitsDesc: string;
  weekendWarrior: string;
  weekendWarriorDesc: string;
  busiestDay: string;
  busiestDayDesc: string;
  emojiUsage: string;
  emojiUsageDesc: string;
  fastestPRMerge: string;
  longestPR: string;
  commitsByMonth: string;
  commitsByDay: string;
  commitsByHour: string;
  fileTypesChanged: string;
  generatedWith: string;
  yourYearInCode: string;
  commits: string;
  aiYearInReview: string;
  whatYouShipped: string;
  // Personality types
  nightOwlType: string;
  nightOwlDesc: string;
  weekendWarriorType: string;
  weekendWarriorTypeDesc: string;
  commitMachineType: string;
  commitMachineDesc: string;
  streakMasterType: string;
  streakMasterDesc: string;
  emojiEnthusiastType: string;
  emojiEnthusiastDesc: string;
  prChampionType: string;
  prChampionDesc: string;
  steadyBuilderType: string;
  steadyBuilderDesc: string;
}

const translations: Record<Language, Translations> = {
  english: {
    unwrapped: "Unwrapped",
    yearInReview: "Year in Review",
    byTheNumbers: "By The Numbers",
    topContributors: "Top Contributors",
    activityPatterns: "Activity Patterns",
    funFacts: "Fun Facts",
    commitMessageWordCloud: "Commit Message Word Cloud",
    mostChangedFiles: "Most Changed Files",
    releasesThisYear: "Releases This Year",
    commitsPushedThisYear: "commits pushed this year",
    linesAdded: "Lines Added",
    linesDeleted: "Lines Deleted",
    pullRequestsMerged: "Pull Requests Merged",
    releases: "Releases",
    avgCommitsPerWeek: "Avg Commits/Week",
    longestStreak: "Longest Streak",
    days: "days",
    nightOwlCommits: "Night Owl Commits",
    nightOwlCommitsDesc: "commits between 10pm - 6am",
    weekendWarrior: "Weekend Warrior",
    weekendWarriorDesc: "commits on weekends",
    busiestDay: "Busiest Day",
    busiestDayDesc: "commits on",
    emojiUsage: "Emoji Usage",
    emojiUsageDesc: "emojis in commit messages",
    fastestPRMerge: "Fastest PR Merge",
    longestPR: "Longest PR",
    commitsByMonth: "Commits by Month",
    commitsByDay: "Commits by Day",
    commitsByHour: "Commits by Hour",
    fileTypesChanged: "File Types Changed",
    generatedWith: "Generated with ❤️ by",
    yourYearInCode: "Your year in code, unwrapped!",
    commits: "commits",
    aiYearInReview: "AI Year in Review",
    whatYouShipped: "What You Shipped",
    nightOwlType: "Night Owl 🦉",
    nightOwlDesc: "You thrive when the world sleeps. Your best code happens after midnight.",
    weekendWarriorType: "Weekend Warrior 💪",
    weekendWarriorTypeDesc: "Who needs rest? You ship code while others are relaxing.",
    commitMachineType: "Commit Machine 🤖",
    commitMachineDesc: "You're a coding powerhouse. Small, frequent commits keep the project moving.",
    streakMasterType: "Streak Master 🔥",
    streakMasterDesc: "Consistency is your superpower. Your commit streak is legendary.",
    emojiEnthusiastType: "Emoji Enthusiast ✨",
    emojiEnthusiastDesc: "Your commit messages are works of art, complete with expressive emojis.",
    prChampionType: "PR Champion 🏆",
    prChampionDesc: "You're a collaboration hero, merging PRs and keeping the team unblocked.",
    steadyBuilderType: "Steady Builder 🏗️",
    steadyBuilderDesc: "You're the reliable backbone of the project. Consistent and dependable.",
  },
  german: {
    unwrapped: "Unwrapped",
    yearInReview: "Jahresrückblick",
    byTheNumbers: "Die Zahlen",
    topContributors: "Top Mitwirkende",
    activityPatterns: "Aktivitätsmuster",
    funFacts: "Wissenswertes",
    commitMessageWordCloud: "Commit-Nachrichten Wortwolke",
    mostChangedFiles: "Am meisten geänderte Dateien",
    releasesThisYear: "Releases dieses Jahr",
    commitsPushedThisYear: "Commits dieses Jahr",
    linesAdded: "Zeilen hinzugefügt",
    linesDeleted: "Zeilen gelöscht",
    pullRequestsMerged: "Pull Requests gemerged",
    releases: "Releases",
    avgCommitsPerWeek: "Ø Commits/Woche",
    longestStreak: "Längste Serie",
    days: "Tage",
    nightOwlCommits: "Nacht-Eule Commits",
    nightOwlCommitsDesc: "Commits zwischen 22-6 Uhr",
    weekendWarrior: "Wochenend-Krieger",
    weekendWarriorDesc: "Commits am Wochenende",
    busiestDay: "Aktivster Tag",
    busiestDayDesc: "Commits am",
    emojiUsage: "Emoji-Nutzung",
    emojiUsageDesc: "Emojis in Commit-Nachrichten",
    fastestPRMerge: "Schnellster PR Merge",
    longestPR: "Längster PR",
    commitsByMonth: "Commits pro Monat",
    commitsByDay: "Commits pro Tag",
    commitsByHour: "Commits pro Stunde",
    fileTypesChanged: "Geänderte Dateitypen",
    generatedWith: "Erstellt mit ❤️ von",
    yourYearInCode: "Dein Jahr in Code, unwrapped!",
    commits: "Commits",
    aiYearInReview: "KI Jahresrückblick",
    whatYouShipped: "Was du geliefert hast",
    nightOwlType: "Nacht-Eule 🦉",
    nightOwlDesc: "Du blühst auf, wenn die Welt schläft. Dein bester Code entsteht nach Mitternacht.",
    weekendWarriorType: "Wochenend-Krieger 💪",
    weekendWarriorTypeDesc: "Wer braucht schon Pause? Du lieferst Code, während andere sich ausruhen.",
    commitMachineType: "Commit-Maschine 🤖",
    commitMachineDesc: "Du bist eine Code-Kraftwerk. Kleine, häufige Commits halten das Projekt in Bewegung.",
    streakMasterType: "Serien-Meister 🔥",
    streakMasterDesc: "Beständigkeit ist deine Superkraft. Deine Commit-Serie ist legendär.",
    emojiEnthusiastType: "Emoji-Enthusiast ✨",
    emojiEnthusiastDesc: "Deine Commit-Nachrichten sind Kunstwerke, komplett mit ausdrucksstarken Emojis.",
    prChampionType: "PR-Champion 🏆",
    prChampionDesc: "Du bist ein Kollaborations-Held, mergst PRs und hältst das Team am Laufen.",
    steadyBuilderType: "Verlässlicher Baumeister 🏗️",
    steadyBuilderDesc: "Du bist das zuverlässige Rückgrat des Projekts. Konstant und verlässlich.",
  },
};

function t(key: keyof Translations, language: Language = "english"): string {
  return translations[language][key];
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
      body?: string | null;
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
  const { onProgress = () => { }, language = "english" } = options;

  onProgress("🎨 Generating AI year-in-review...");

  // Generate comprehensive AI summary (includes both overview and features)
  const summary = await generateAISummary(stats, language);
  const safeSummaryHtml = sanitizeAiSummaryToSafeHtml(summary);

  onProgress("✨ Creating beautiful HTML report...");

  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  // Calculate personality type based on stats
  const personality = getDevPersonality(stats, language);

  // Generate chart data
  const monthlyData = safeJsonForScript(stats.commitsByMonth);
  const dayData = safeJsonForScript(stats.commitsByDayOfWeek);
  const hourData = safeJsonForScript(stats.commitsByHour);
  const fileTypeData = safeJsonForScript(stats.fileTypesChanged.slice(0, 6));
  const escapedRepoOwner = escapeHtml(stats.repoOwner);
  const escapedRepoName = escapeHtml(stats.repoName);

  const html = `<!DOCTYPE html>
<html lang="${language === "german" ? "de" : "en"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedRepoOwner}/${escapedRepoName} - ${t("unwrapped", language)} ${new Date().getFullYear()}</title>
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
    <h1>🎉 ${t("unwrapped", language)}</h1>
    <p class="repo-name">${escapedRepoOwner}/${escapedRepoName}</p>
    <p class="date-range">${formatDate(stats.startDate)} - ${formatDate(stats.endDate)}</p>
    <div class="year-badge">${new Date().getFullYear()} ${t("yearInReview", language)}</div>
  </div>
  
  <div class="container">
    <!-- Big Stats -->
    <div class="big-stat">
      <div class="number">${stats.totalCommits.toLocaleString()}</div>
      <div class="label">${t("commitsPushedThisYear", language)}</div>
    </div>
    
    <!-- Developer Personality -->
    <div class="personality-card">
      <div class="content">
        <div style="font-size: 3rem; margin-bottom: 1rem;">${personality.emoji}</div>
        <div class="personality-type">${personality.type}</div>
        <div class="personality-desc">${personality.description}</div>
      </div>
    </div>
    
    <!-- AI Year-in-Review (comprehensive summary) -->
    <div class="ai-summary">
      <h3>🤖 ${t("aiYearInReview", language)}</h3>
      <div class="ai-content">${safeSummaryHtml}</div>
    </div>
    
    <!-- Quick Stats Cards -->
    <div class="section-header">
      <span class="emoji">📈</span>
      <h2>${t("byTheNumbers", language)}</h2>
    </div>

    <div class="cards-grid">
      <div class="card">
        <div class="card-label">${t("linesAdded", language)}</div>
        <div class="card-value green">+${stats.linesAdded.toLocaleString()}</div>
      </div>
      <div class="card">
        <div class="card-label">${t("linesDeleted", language)}</div>
        <div class="card-value pink">-${stats.linesDeleted.toLocaleString()}</div>
      </div>
      <div class="card">
        <div class="card-label">${t("pullRequestsMerged", language)}</div>
        <div class="card-value cyan">${stats.mergedPRs}</div>
      </div>
      <div class="card">
        <div class="card-label">${t("releases", language)}</div>
        <div class="card-value">${stats.totalReleases}</div>
      </div>
      <div class="card">
        <div class="card-label">${t("avgCommitsPerWeek", language)}</div>
        <div class="card-value green">${stats.averageCommitsPerWeek}</div>
      </div>
      <div class="card">
        <div class="card-label">${t("longestStreak", language)}</div>
        <div class="card-value pink">${stats.longestStreak} ${t("days", language)}</div>
      </div>
    </div>
    
    <!-- Top Contributors -->
    ${stats.topAuthors.length > 0 ? `
    <div class="section-header">
      <span class="emoji">🏆</span>
      <h2>${t("topContributors", language)}</h2>
    </div>
    
    <div class="author-list">
      ${stats.topAuthors.map((author, i) => `
        <div class="author-item">
          <div class="author-rank ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}">${i + 1}</div>
          <div class="author-info">
            <div class="author-name">${escapeHtml(author.name)}</div>
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
      <h2>${t("activityPatterns", language)}</h2>
    </div>

    <div class="cards-grid">
      <div class="chart-container">
        <div class="chart-title">${t("commitsByMonth", language)}</div>
        <canvas id="monthlyChart"></canvas>
      </div>
      <div class="chart-container">
        <div class="chart-title">${t("commitsByDay", language)}</div>
        <canvas id="dayChart"></canvas>
      </div>
    </div>

    <div class="cards-grid">
      <div class="chart-container">
        <div class="chart-title">${t("commitsByHour", language)}</div>
        <canvas id="hourChart"></canvas>
      </div>
      <div class="chart-container">
        <div class="chart-title">${t("fileTypesChanged", language)}</div>
        <canvas id="fileTypeChart"></canvas>
      </div>
    </div>
    
    <!-- Fun Facts -->
    <div class="section-header">
      <span class="emoji">🎯</span>
      <h2>${t("funFacts", language)}</h2>
    </div>

    <div class="fun-facts">
      <div class="fun-fact">
        <div class="emoji">🌙</div>
        <div class="text">
          <h4>${t("nightOwlCommits", language)}</h4>
          <p>${stats.nightOwlCommits} ${t("nightOwlCommitsDesc", language)}</p>
        </div>
      </div>
      <div class="fun-fact">
        <div class="emoji">🏖️</div>
        <div class="text">
          <h4>${t("weekendWarrior", language)}</h4>
          <p>${stats.weekendWarriorCommits} ${t("weekendWarriorDesc", language)}</p>
        </div>
      </div>
      <div class="fun-fact">
        <div class="emoji">🔥</div>
        <div class="text">
          <h4>${t("busiestDay", language)}</h4>
          <p>${stats.busiestDay.count} ${t("busiestDayDesc", language)} ${stats.busiestDay.date}</p>
        </div>
      </div>
      <div class="fun-fact">
        <div class="emoji">😀</div>
        <div class="text">
          <h4>${t("emojiUsage", language)}</h4>
          <p>${stats.emojiCount} ${t("emojiUsageDesc", language)}</p>
        </div>
      </div>
      ${stats.fastestMerge ? `
      <div class="fun-fact">
        <div class="emoji">⚡</div>
        <div class="text">
          <h4>${t("fastestPRMerge", language)}</h4>
          <p>"${escapeHtml(stats.fastestMerge.title.substring(0, 40))}..." in ${stats.fastestMerge.hours}h</p>
        </div>
      </div>
      ` : ''}
      ${stats.slowestMerge ? `
      <div class="fun-fact">
        <div class="emoji">🐢</div>
        <div class="text">
          <h4>${t("longestPR", language)}</h4>
          <p>"${escapeHtml(stats.slowestMerge.title.substring(0, 40))}..." took ${stats.slowestMerge.days} ${t("days", language)}</p>
        </div>
      </div>
      ` : ''}
    </div>
    
    <!-- Most Common Words -->
    <div class="section-header">
      <span class="emoji">💬</span>
      <h2>${t("commitMessageWordCloud", language)}</h2>
    </div>
    
    <div class="chart-container">
      <div class="word-cloud">
        ${stats.mostCommonWords.map((w, i) => `
          <span class="word-tag ${i < 2 ? 'size-1' : i < 5 ? 'size-2' : 'size-3'}">${escapeHtml(w.word)} (${w.count})</span>
        `).join('')}
      </div>
    </div>
    
    <!-- Most Changed Files -->
    <div class="section-header">
      <span class="emoji">📁</span>
      <h2>${t("mostChangedFiles", language)}</h2>
    </div>
    
    <div class="chart-container">
      <div class="file-list">
        ${stats.mostChangedFiles.slice(0, 8).map(f => `
          <div class="file-item">
            <span class="file-changes">+${f.changes}</span>
            <span class="file-path">${escapeHtml(f.path)}</span>
          </div>
        `).join('')}
      </div>
    </div>
    
    <!-- Releases -->
    ${stats.releases.length > 0 ? `
    <div class="section-header">
      <span class="emoji">🏷️</span>
      <h2>${t("releasesThisYear", language)}</h2>
    </div>

    <div class="cards-grid">
      ${stats.releases.map(r => `
        <div class="card">
          <div class="card-label">${new Date(r.date).toLocaleDateString()}</div>
          <div class="card-value" style="font-size: 1.5rem;">${escapeHtml(r.tag)}</div>
          <div class="card-subtitle">${escapeHtml(r.name)}</div>
        </div>
      `).join('')}
    </div>
    ` : ''}
  </div>
  
  <div class="footer">
    <p>${t("generatedWith", language)} <a href="https://github.com/mr-mrs-panda/git-ai-cli">Git AI CLI</a></p>
    <p style="margin-top: 0.5rem;">🎵 ${t("yourYearInCode", language)}</p>
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

function getDevPersonality(stats: UnwrappedStats, language: Language = "english"): {
  type: string;
  emoji: string;
  description: string;
} {
  const nightRatio = stats.nightOwlCommits / stats.totalCommits;
  const weekendRatio = stats.weekendWarriorCommits / stats.totalCommits;

  if (nightRatio > 0.3) {
    return {
      type: t("nightOwlType", language),
      emoji: "🌙",
      description: t("nightOwlDesc", language),
    };
  }

  if (weekendRatio > 0.4) {
    return {
      type: t("weekendWarriorType", language),
      emoji: "🏋️",
      description: t("weekendWarriorTypeDesc", language),
    };
  }

  if (stats.averageCommitsPerWeek > 20) {
    return {
      type: t("commitMachineType", language),
      emoji: "⚙️",
      description: t("commitMachineDesc", language),
    };
  }

  if (stats.longestStreak > 14) {
    return {
      type: t("streakMasterType", language),
      emoji: "🔥",
      description: t("streakMasterDesc", language),
    };
  }

  if (stats.emojiCount > 20) {
    return {
      type: t("emojiEnthusiastType", language),
      emoji: "🎨",
      description: t("emojiEnthusiastDesc", language),
    };
  }

  if (stats.mergedPRs > 20) {
    return {
      type: t("prChampionType", language),
      emoji: "🚀",
      description: t("prChampionDesc", language),
    };
  }

  return {
    type: t("steadyBuilderType", language),
    emoji: "🛠️",
    description: t("steadyBuilderDesc", language),
  };
}

async function generateAISummary(stats: UnwrappedStats, language: Language = "english"): Promise<string> {
  try {
    const fallbackHtml = language === "german"
      ? `<p>🚀 Dieses Jahr gab es bei <strong>${stats.repoOwner}/${stats.repoName}</strong> <strong>${stats.totalCommits}</strong> Commits von ${stats.topAuthors.length} Mitwirkenden.</p>
<p>Das Team fügte <strong>+${stats.linesAdded.toLocaleString()}</strong> Zeilen hinzu und entfernte <strong>-${stats.linesDeleted.toLocaleString()}</strong> Zeilen Code.</p>
${stats.mergedPRs > 0 ? `<p><strong>${stats.mergedPRs}</strong> Pull Requests wurden gemerged und das Projekt lieferte <strong>${stats.totalReleases}</strong> Releases.</p>` : `<p>Das Projekt lieferte <strong>${stats.totalReleases}</strong> Releases.</p>`}
<p>🎉 Weiter so!</p>`
      : `<p>🚀 This year, <strong>${stats.repoOwner}/${stats.repoName}</strong> saw <strong>${stats.totalCommits}</strong> commits from ${stats.topAuthors.length} contributors.</p>
<p>The team added <strong>+${stats.linesAdded.toLocaleString()}</strong> lines and removed <strong>-${stats.linesDeleted.toLocaleString()}</strong> lines of code.</p>
${stats.mergedPRs > 0 ? `<p><strong>${stats.mergedPRs}</strong> pull requests were merged and the project shipped <strong>${stats.totalReleases}</strong> releases.</p>` : `<p>The project shipped <strong>${stats.totalReleases}</strong> releases.</p>`}
<p>🎉 Keep up the great work!</p>`;

    // Generate monthly release summaries if there are releases
    let monthlyReleaseSummaries = "";
    if (stats.releases.length > 0) {
      // Group releases by month
      const releasesByMonth = new Map<string, typeof stats.releases>();
      for (const release of stats.releases) {
        const date = new Date(release.date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const monthReleases = releasesByMonth.get(monthKey) || [];
        monthReleases.push(release);
        releasesByMonth.set(monthKey, monthReleases);
      }

      // Generate summaries for each month in parallel
      const monthSummaryPromises = Array.from(releasesByMonth.entries()).map(async ([monthKey, releases]) => {
        const [year, month] = monthKey.split('-');
        const monthName = new Date(parseInt(year!), parseInt(month!) - 1).toLocaleDateString(
          language === "german" ? "de-DE" : "en-US",
          { month: "long", year: "numeric" }
        );

        // Build release info for this month
        const releaseInfo = releases
          .map((r) => {
            let info = `${r.tag}: ${r.name}`;
            if (r.body) {
              const body = r.body.length > 600 ? r.body.substring(0, 600) + "..." : r.body;
              info += `\n${body}`;
            }
            return info;
          })
          .join("\n\n");

        const prompt = language === "german"
          ? `Fasse die ${releases.length} Releases für ${monthName} in 2-3 prägnanten Bullet Points zusammen. Fokussiere auf die wichtigsten Features/Änderungen.

${releaseInfo}

Ausgabe als einfache Bullet-Liste (•) ohne Überschriften.`
          : `Summarize the ${releases.length} releases for ${monthName} in 2-3 concise bullet points. Focus on the most important features/changes.

${releaseInfo}

Output as simple bullet list (•) without headings.`;

        try {
          const content = await invokeText("unwrapped", prompt, { temperature: 0.7 });
          return { monthName, summary: content, releaseCount: releases.length };
        } catch {
          return { monthName, summary: "", releaseCount: releases.length };
        }
      });

      const monthSummaries = await Promise.all(monthSummaryPromises);
      const validSummaries = monthSummaries.filter(m => m.summary);

      if (validSummaries.length > 0) {
        monthlyReleaseSummaries = validSummaries
          .map(m => `**${m.monthName}** (${m.releaseCount} ${language === "german" ? "Releases" : "releases"}):\n${m.summary}`)
          .join("\n\n");
      }
    }

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

    const prompt = language === "german"
      ? `Du bist eine freundliche, positive KI, die einen "Jahresrückblick" für ein GitHub-Repository schreibt - wie Spotify Wrapped, aber für Code!

Analysiere das Jahr des Repositories basierend auf den Statistiken UND den tatsächlichen Commit-Nachrichten und Releases, um eine packende Geschichte zu erzählen.

## Repository-Statistiken
- Repository: ${stats.repoOwner}/${stats.repoName}
- Commits insgesamt: ${stats.totalCommits}
- Top-Autor: ${stats.mostActiveAuthor?.name || 'Unbekannt'} (${stats.mostActiveAuthor?.commits || 0} Commits)
- Zeilen hinzugefügt: ${stats.linesAdded.toLocaleString()}
- Zeilen gelöscht: ${stats.linesDeleted.toLocaleString()}
- Pull Requests gemerged: ${stats.mergedPRs}
- Releases: ${stats.totalReleases}
- Nacht-Eule Commits (22-6 Uhr): ${stats.nightOwlCommits}
- Wochenend-Commits: ${stats.weekendWarriorCommits}
- Längste Serie: ${stats.longestStreak} Tage
- Aktivster Tag: ${stats.busiestDay.date} mit ${stats.busiestDay.count} Commits
- Häufigste Wörter: ${stats.mostCommonWords.slice(0, 5).map(w => w.word).join(', ')}

${monthlyReleaseSummaries ? `## Monats-Release-Highlights (${stats.releases.length} Releases insgesamt)
${monthlyReleaseSummaries}` : ''}

## Beispiel Commit-Nachrichten
${commitList}

---

Erstelle eine **umfassende HTML-Zusammenfassung** in ZWEI Teilen:

**TEIL 1: Jahresüberblick** (2-3 Absätze, Spotify-Wrapped-Stil)
- Feiere die Zahlen und Errungenschaften
- Hebe interessante Muster hervor (Nacht-Eule, Streaks, etc.)
- Packend und feierlich

**TEIL 2: Was ihr geliefert habt** (Kategorisierte Feature-Liste basierend auf den Monats-Highlights)
- Gruppiere in: 🚀 Features, 🐛 Bug Fixes, 🔧 Verbesserungen, etc.
- Max 4-5 Bullet Points pro Kategorie
- Zeige das Gesamtbild über das ganze Jahr

Format:
<p>🚀 Was für ein Jahr für <strong>repo-name</strong>! Ihr habt <strong>${stats.totalCommits} Commits</strong> gemacht und <strong>${stats.totalReleases} Releases</strong> ausgeliefert...</p>
<p>Weitere Details zu Patterns...</p>

<div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid rgba(255,255,255,0.1);">
  <h4 style="color: #3fb950; margin-bottom: 1.5rem; font-size: 1.2rem;">📦 Was ihr dieses Jahr geliefert habt</h4>
  <div style="display: flex; flex-direction: column; gap: 1.25rem;">
    <div>
      <div style="color: #f0f6fc; font-weight: 600; margin-bottom: 0.5rem;">🚀 Neue Features</div>
      <ul style="margin: 0; padding-left: 1.5rem; color: #8b949e;">
        <li>Feature X - Beschreibung</li>
      </ul>
    </div>
    <div>
      <div style="color: #f0f6fc; font-weight: 600; margin-bottom: 0.5rem;">🔧 Verbesserungen</div>
      <ul style="margin: 0; padding-left: 1.5rem; color: #8b949e;">
        <li>Verbesserung A</li>
      </ul>
    </div>
  </div>
</div>

<p style="margin-top: 1.5rem;">🎉 Abschluss-Celebration!</p>

AUSGABE NUR DAS HTML, sonst nichts.`
      : `You are a friendly, upbeat AI writing a "Year in Review" summary for a GitHub repository - like Spotify Wrapped but for code!

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

${monthlyReleaseSummaries ? `## Monthly Release Highlights (${stats.releases.length} releases total)
${monthlyReleaseSummaries}` : ''}

## Sample Commit Messages
${commitList}

---

Create a **comprehensive HTML summary** in TWO parts:

**PART 1: Year Overview** (2-3 paragraphs, Spotify-Wrapped style)
- Celebrate the numbers and achievements
- Highlight interesting patterns (night owl, streaks, etc.)
- Engaging and celebratory

**PART 2: What You Shipped** (Categorized feature list based on monthly highlights)
- Group into: 🚀 Features, 🐛 Bug Fixes, 🔧 Improvements, etc.
- Max 4-5 bullet points per category
- Show the big picture across the whole year

Format:
<p>🚀 What a year for <strong>repo-name</strong>! You made <strong>${stats.totalCommits} commits</strong> and shipped <strong>${stats.totalReleases} releases</strong>...</p>
<p>More details about patterns...</p>

<div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid rgba(255,255,255,0.1);">
  <h4 style="color: #3fb950; margin-bottom: 1.5rem; font-size: 1.2rem;">📦 What You Shipped This Year</h4>
  <div style="display: flex; flex-direction: column; gap: 1.25rem;">
    <div>
      <div style="color: #f0f6fc; font-weight: 600; margin-bottom: 0.5rem;">🚀 New Features</div>
      <ul style="margin: 0; padding-left: 1.5rem; color: #8b949e;">
        <li>Feature X - Description</li>
      </ul>
    </div>
    <div>
      <div style="color: #f0f6fc; font-weight: 600; margin-bottom: 0.5rem;">🔧 Improvements</div>
      <ul style="margin: 0; padding-left: 1.5rem; color: #8b949e;">
        <li>Improvement A</li>
      </ul>
    </div>
  </div>
</div>

<p style="margin-top: 1.5rem;">🎉 Closing celebration!</p>

OUTPUT ONLY THE HTML, nothing else.`;

    const content = await invokeText("unwrapped", prompt);
    
    // Validate it looks like HTML
    if (content && (content.includes("<p>") || content.includes("<ul>"))) {
      return content;
    }
    
    // If not HTML, wrap it
    if (content) {
      return `<p>${content.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
    }

    return language === "german"
      ? `<p>Was für ein Jahr für <strong>${stats.repoName}</strong>! ${stats.totalCommits} Commits und es geht weiter. 🎉</p>`
      : `<p>What a year for <strong>${stats.repoName}</strong>! ${stats.totalCommits} commits and counting. 🎉</p>`;
  } catch {
    return language === "german"
      ? `<p>Dieses Jahr gab es bei <strong>${stats.repoOwner}/${stats.repoName}</strong> <strong>${stats.totalCommits}</strong> Commits.</p>
<p>Das Team fügte <span style="color: #3fb950;">+${stats.linesAdded.toLocaleString()}</span> Zeilen Code hinzu und lieferte <strong>${stats.totalReleases}</strong> Releases.</p>
<p>🎉 Großartige Arbeit!</p>`
      : `<p>This year, <strong>${stats.repoOwner}/${stats.repoName}</strong> saw <strong>${stats.totalCommits}</strong> commits.</p>
<p>The team added <span style="color: #3fb950;">+${stats.linesAdded.toLocaleString()}</span> lines of code and shipped <strong>${stats.totalReleases}</strong> releases.</p>
<p>🎉 Amazing work!</p>`;
  }
}
