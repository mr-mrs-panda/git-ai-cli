import * as p from "@clack/prompts";
import { Octokit } from "octokit";
import {
  isGitRepository,
  isGitHubRepository,
  parseGitHubRepo,
  getCurrentBranch,
  getBaseBranch,
  getLatestVersionTag,
  parseVersion,
  incrementVersion,
  formatVersionTag,
  getCommitsSinceTag,
  createTag,
  pushTags,
  hasUnstagedChanges,
  switchToBranch,
  fetchOrigin,
  pullBranch,
} from "../utils/git.ts";
import { generateReleaseNotes, suggestVersionBump, type PRInfo } from "../utils/openai.ts";
import { getGitHubToken } from "../utils/config.ts";
import { getMergedPRsSinceTag } from "./github.ts";

export interface ReleaseOptions {
  autoYes?: boolean;
  versionType?: "major" | "minor" | "patch";
  includePRs?: boolean;
}

export interface ReleaseResult {
  version: string;
  releaseUrl?: string;
}

/**
 * Create a GitHub release with AI-generated release notes
 */
export async function createRelease(options: ReleaseOptions = {}): Promise<ReleaseResult | null> {
  const { autoYes = false, versionType, includePRs = false } = options;

  // Check if we're in a git repository
  const isRepo = await isGitRepository();
  if (!isRepo) {
    throw new Error("Not a git repository. Please run this command in a git repository.");
  }

  // Check for unstaged/uncommitted changes
  const hasChanges = await hasUnstagedChanges();
  if (hasChanges) {
    throw new Error(
      "You have unstaged or uncommitted changes. Please commit or stash them before creating a release."
    );
  }

  const spinner = p.spinner();

  // Check if we're on the base branch (main/master), switch if not
  let currentBranch = await getCurrentBranch();
  const baseBranch = await getBaseBranch();

  if (currentBranch !== baseBranch) {
    spinner.start(`Switching to '${baseBranch}' branch...`);
    try {
      await switchToBranch(baseBranch);
      currentBranch = baseBranch;
      spinner.stop(`Switched to '${baseBranch}'`);
    } catch (error) {
      spinner.stop(`Failed to switch to '${baseBranch}'`);
      throw new Error(
        `Could not switch to '${baseBranch}' branch: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Fetch and pull latest changes
  spinner.start(`Updating '${baseBranch}' branch...`);
  try {
    await fetchOrigin();
    await pullBranch();
    spinner.stop(`'${baseBranch}' branch is up to date`);
  } catch (error) {
    spinner.stop(`Warning: Could not update '${baseBranch}'`);
    // Continue anyway - might be offline or no remote
    p.log.warn(`Could not pull latest changes: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Try to get PR info if GitHub is available (default behavior)
  // Can be disabled with includePRs: false
  let pullRequests: PRInfo[] = [];
  let repoInfo: { owner: string; repo: string } | null = null;
  let githubToken: string | null = null;

  // Check if we should try to fetch PRs (default: true if not explicitly disabled)
  const shouldFetchPRs = includePRs !== false;

  if (shouldFetchPRs) {
    githubToken = await getGitHubToken();
    if (githubToken) {
      repoInfo = await parseGitHubRepo();
    }
  }

  // Get the latest version tag
  spinner.start("Finding latest version tag...");
  const latestTag = await getLatestVersionTag();

  let newVersion: { major: number; minor: number; patch: number };

  if (!latestTag) {
    spinner.stop("No version tags found");
    p.note("No existing version tags found. Starting from v0.0.0", "Info");
    newVersion = { major: 0, minor: 0, patch: 1 };
  } else {
    spinner.stop(`Latest version: ${latestTag}`);

    const parsedVersion = parseVersion(latestTag);
    if (!parsedVersion) {
      throw new Error(`Invalid version tag format: ${latestTag}. Expected format: v1.2.3`);
    }

    // Get commits to analyze
    spinner.start("Analyzing commits for version suggestion...");
    const commits = await getCommitsSinceTag(latestTag);

    if (commits.length === 0) {
      spinner.stop("No commits found");
      throw new Error(`No commits found since ${latestTag}. Nothing to release.`);
    }

    spinner.stop(`Found ${commits.length} commit(s) since ${latestTag}`);

    // Fetch PRs if we have token/repo info (default behavior when GitHub is available)
    if (shouldFetchPRs && githubToken && repoInfo) {
      spinner.start("Fetching merged PRs since last release...");
      try {
        pullRequests = await getMergedPRsSinceTag(
          latestTag,
          repoInfo.owner,
          repoInfo.repo,
          githubToken
        );
        if (pullRequests.length > 0) {
          spinner.stop(`Found ${pullRequests.length} merged PR(s) since ${latestTag}`);
        } else {
          spinner.stop("No merged PRs found since last release");
        }
      } catch {
        spinner.stop("Could not fetch PRs, continuing with commits only");
      }
    }

    // Ask AI for version bump suggestion
    let bumpType: "major" | "minor" | "patch";

    if (versionType) {
      bumpType = versionType;
      if (!autoYes) {
        p.log.info(`Version bump type (manual): ${bumpType}`);
      }
    } else {
      spinner.start("Asking AI for version bump suggestion...");
      let suggestion: { type: "major" | "minor" | "patch"; reason: string };

      try {
        suggestion = await suggestVersionBump(
          commits.map((c) => ({ message: c.message })),
          pullRequests.length > 0 ? pullRequests : undefined
        );
        spinner.stop("AI suggestion received");
      } catch (error) {
        spinner.stop("Failed to get AI suggestion");
        // Fallback to manual selection
        suggestion = { type: "patch", reason: "Could not determine automatically" };
      }

      // Calculate what each bump would result in
      const patchVersion = incrementVersion(parsedVersion, "patch");
      const minorVersion = incrementVersion(parsedVersion, "minor");
      const majorVersion = incrementVersion(parsedVersion, "major");

      // If autoYes, accept AI suggestion automatically
      if (autoYes) {
        bumpType = suggestion.type;
        const targetVersion = incrementVersion(parsedVersion, bumpType);
        p.log.info(`Auto-accepting AI suggestion: ${bumpType} (${latestTag} → v${targetVersion.major}.${targetVersion.minor}.${targetVersion.patch})`);
        p.log.info(`Reason: ${suggestion.reason}`);
      } else {
        // Show AI suggestion
        p.note(
          `Suggested: ${suggestion.type.toUpperCase()}\nReason: ${suggestion.reason}`,
          "AI Suggestion"
        );

        // Offer options with AI suggestion as default
        const options: Array<{ value: string; label: string; hint?: string }> = [];

        // Put suggested option first
        if (suggestion.type === "major") {
          options.push(
            {
              value: "major",
              label: `major (${latestTag} → v${majorVersion.major}.${majorVersion.minor}.${majorVersion.patch}) - Recommended by AI`,
              hint: "Breaking changes",
            },
            {
              value: "minor",
              label: `minor (${latestTag} → v${minorVersion.major}.${minorVersion.minor}.${minorVersion.patch})`,
              hint: "New features (backwards compatible)",
            },
            {
              value: "patch",
              label: `patch (${latestTag} → v${patchVersion.major}.${patchVersion.minor}.${patchVersion.patch})`,
              hint: "Bug fixes and small changes",
            }
          );
        } else if (suggestion.type === "minor") {
          options.push(
            {
              value: "minor",
              label: `minor (${latestTag} → v${minorVersion.major}.${minorVersion.minor}.${minorVersion.patch}) - Recommended by AI`,
              hint: "New features (backwards compatible)",
            },
            {
              value: "patch",
              label: `patch (${latestTag} → v${patchVersion.major}.${patchVersion.minor}.${patchVersion.patch})`,
              hint: "Bug fixes and small changes",
            },
            {
              value: "major",
              label: `major (${latestTag} → v${majorVersion.major}.${majorVersion.minor}.${majorVersion.patch})`,
              hint: "Breaking changes",
            }
          );
        } else {
          options.push(
            {
              value: "patch",
              label: `patch (${latestTag} → v${patchVersion.major}.${patchVersion.minor}.${patchVersion.patch}) - Recommended by AI`,
              hint: "Bug fixes and small changes",
            },
            {
              value: "minor",
              label: `minor (${latestTag} → v${minorVersion.major}.${minorVersion.minor}.${minorVersion.patch})`,
              hint: "New features (backwards compatible)",
            },
            {
              value: "major",
              label: `major (${latestTag} → v${majorVersion.major}.${majorVersion.minor}.${majorVersion.patch})`,
              hint: "Breaking changes",
            }
          );
        }

        const response = await p.select({
          message: "What type of version bump?",
          options,
        });

        if (p.isCancel(response)) {
          p.cancel("Release cancelled");
          return null;
        }

        bumpType = response as "major" | "minor" | "patch";
      }
    }

    newVersion = incrementVersion(parsedVersion, bumpType);
  }

  const newVersionTag = formatVersionTag(newVersion);

  // Get commits (already fetched above if latestTag exists, otherwise get all)
  const commits = latestTag ? await getCommitsSinceTag(latestTag) : [];

  // Show commits summary
  if (commits.length > 0) {
    p.note(
      [
        `Commits to include in ${newVersionTag}:`,
        "",
        ...commits.slice(0, 10).map((c) => `  • ${c.message}`),
        commits.length > 10 ? `  ... and ${commits.length - 10} more` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      "Commits"
    );
  }

  // Show PRs summary if available
  if (pullRequests.length > 0) {
    p.note(
      [
        `PRs included in ${newVersionTag}:`,
        "",
        ...pullRequests.slice(0, 10).map((pr) => `  • #${pr.number}: ${pr.title}`),
        pullRequests.length > 10 ? `  ... and ${pullRequests.length - 10} more` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      "Pull Requests"
    );
  }

  // Generate release notes with AI
  spinner.start("Generating release notes with AI...");

  let releaseTitle: string;
  let releaseNotes: string;

  try {
    const result = await generateReleaseNotes(
      newVersionTag,
      commits.map((c) => ({ message: c.message, author: c.author, date: c.date })),
      pullRequests.length > 0 ? pullRequests : undefined
    );
    releaseTitle = result.title;
    releaseNotes = result.notes;
    spinner.stop("Release notes generated");
  } catch (error) {
    spinner.stop("Failed to generate release notes");
    throw error;
  }

  // Display generated release notes
  p.note(releaseTitle, "Release Title");
  p.note(releaseNotes, "Release Notes");

  // Confirm release creation
  let shouldCreate = autoYes;

  if (!autoYes) {
    const response = await p.confirm({
      message: `Create release ${newVersionTag}?`,
      initialValue: true,
    });

    if (p.isCancel(response)) {
      p.cancel("Release cancelled");
      return null;
    }

    shouldCreate = response;
  } else {
    p.log.info(`Auto-accepting: Creating release ${newVersionTag}`);
  }

  if (!shouldCreate) {
    p.note("Release creation cancelled", "Info");
    return null;
  }

  // Create the git tag locally
  spinner.start(`Creating tag ${newVersionTag}...`);
  try {
    await createTag(newVersionTag, releaseTitle);
    spinner.stop(`Tag ${newVersionTag} created`);
  } catch (error) {
    spinner.stop("Failed to create tag");
    throw error;
  }

  // Push the tag to origin
  spinner.start("Pushing tag to origin...");
  try {
    await pushTags();
    spinner.stop("Tag pushed successfully");
  } catch (error) {
    spinner.stop("Failed to push tag");
    throw error;
  }

  // Check if this is a GitHub repository
  const isGitHub = await isGitHubRepository();

  if (!isGitHub) {
    p.note(
      `Tag ${newVersionTag} created and pushed successfully.\n` +
        "This is not a GitHub repository, so no GitHub release was created.",
      "Success"
    );
    return { version: newVersionTag };
  }

  // Create GitHub release
  spinner.start("Creating GitHub release...");

  // Get GitHub token (may already have it from PR fetch)
  if (!githubToken) {
    githubToken = await getGitHubToken();
  }

  if (!githubToken) {
    spinner.stop("GitHub token missing");

    if (autoYes) {
      p.note(
        "GitHub personal access token is required to create releases.\n" +
          "Please configure your token using 'git-ai settings' or set GITHUB_TOKEN environment variable.",
        "GitHub Token Missing"
      );
      return { version: newVersionTag };
    }

    p.note(
      "GitHub personal access token is required to create releases.\n" +
        "You can create one at: https://github.com/settings/tokens\n\n" +
        "Required scopes: 'repo' (for private repos) or 'public_repo' (for public repos)",
      "GitHub Token Required"
    );

    const token = await p.text({
      message: "Enter your GitHub personal access token:",
      placeholder: "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      validate: (value) => {
        if (!value || value.length === 0) return "Token is required";
        if (!value.startsWith("ghp_") && !value.startsWith("github_pat_")) {
          return "Token should start with 'ghp_' or 'github_pat_'";
        }
      },
    });

    if (p.isCancel(token)) {
      p.note(`Tag ${newVersionTag} created and pushed, but GitHub release was not created.`, "Info");
      return { version: newVersionTag };
    }

    // Save token to config
    const { updateConfig } = await import("../utils/config.ts");
    await updateConfig({ githubToken: token });
    githubToken = token;
  }

  // Parse GitHub repo info (may already have it from PR fetch)
  if (!repoInfo) {
    repoInfo = await parseGitHubRepo();
  }

  if (!repoInfo) {
    spinner.stop("Failed to parse repository");
    throw new Error("Could not parse GitHub repository information from origin URL");
  }

  const { owner, repo } = repoInfo;

  try {
    const octokit = new Octokit({ auth: githubToken });

    // Create GitHub release
    const { data } = await octokit.rest.repos.createRelease({
      owner,
      repo,
      tag_name: newVersionTag,
      name: releaseTitle,
      body: releaseNotes,
      draft: false,
      prerelease: false,
    });

    spinner.stop("GitHub release created successfully!");

    p.note(
      `Version: ${data.tag_name}\n` +
        `Title: ${data.name}\n` +
        `URL: ${data.html_url}`,
      "Release Details"
    );

    return { version: newVersionTag, releaseUrl: data.html_url };
  } catch (error: any) {
    spinner.stop("Failed to create GitHub release");
    const message = error.response?.data?.message || error.message || String(error);
    throw new Error(`Could not create GitHub release: ${message}`);
  }
}
