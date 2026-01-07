import OpenAI from "openai";
import { loadConfig } from "./config.ts";

let openaiClient: OpenAI | null = null;
let currentApiKey: string | null = null;

/**
 * Initialize OpenAI client with API key from config
 */
async function getOpenAIClient(): Promise<OpenAI> {
  const config = await loadConfig();

  if (!config.openaiApiKey) {
    throw new Error(
      "OpenAI API key not configured. Please run the tool to set up your API key."
    );
  }

  // Reinitialize if API key changed
  if (openaiClient && currentApiKey === config.openaiApiKey) {
    return openaiClient;
  }

  currentApiKey = config.openaiApiKey;
  openaiClient = new OpenAI({ apiKey: config.openaiApiKey });
  return openaiClient;
}

/**
 * Generate commit message and analyze for bugs in one request
 */
export async function generateCommitMessageWithBugAnalysis(
  changes: Array<{ path: string; status: string; diff: string }>,
  branchName?: string
): Promise<{
  commitMessage: string;
  bugs: Array<{ file: string; description: string; severity: string }>;
}> {
  const config = await loadConfig();
  const client = await getOpenAIClient();

  const changesText = changes
    .map((change) => {
      return `File: ${change.path} (${change.status})\n${change.diff}\n`;
    })
    .join("\n---\n\n");

  const branchContext = branchName
    ? `\nBranch name: ${branchName}\nConsider the branch name context when writing the commit message.\n`
    : '';

  const prompt = `You are an expert code reviewer and git commit message writer.

Analyze the following git changes and:
1. Generate a commit message following Conventional Commits specification
2. Identify any CRITICAL bugs or security issues in the code

${branchContext}
COMMIT MESSAGE STRUCTURE:
A commit message consists of three parts separated by blank lines:

1. HEADER (required): <type>[optional scope]: <description>
   - Types: feat, fix, docs, style, refactor, perf, test, chore
   - Keep under 72 characters
   - Use imperative mood ("add feature" not "added feature")

2. BODY (optional but recommended for non-trivial changes):
   - Explain the "why" and "what", not the "how"
   - Provide context and motivation for the change
   - Wrap at 72 characters per line

3. FOOTER (optional):
   - Reference issues: "Fixes #123" or "Closes #456"
   - Breaking changes: "BREAKING CHANGE: description"

BUG ANALYSIS - Only report CRITICAL issues:
- Null pointer/undefined access
- Security vulnerabilities (SQL injection, XSS, etc.)
- Logic errors causing data loss or corruption
- Race conditions or concurrency issues
- Incorrect error handling causing crashes
- Memory/resource leaks
- Infinite loops

DO NOT report: style issues, minor optimizations, code smells, missing tests, documentation.

Git changes:
${changesText}

RESPOND WITH VALID JSON ONLY:
{
  "commitMessage": "the full commit message here (can be multi-line with header, body, footer)",
  "bugs": [
    {
      "file": "path/to/file.ts",
      "description": "Brief description of the critical bug",
      "severity": "critical|high"
    }
  ]
}

If no critical bugs found, return empty bugs array: "bugs": []`;

  const response = await client.chat.completions.create({
    model: config.model || "gpt-5.2",
    messages: [{ role: "user", content: prompt }],
    temperature: 1,
    reasoning_effort: config.reasoningEffort || "low",
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("Failed to generate commit message");
  }

  try {
    const result = JSON.parse(content);
    return {
      commitMessage: result.commitMessage || "",
      bugs: result.bugs || [],
    };
  } catch (error) {
    console.error("Failed to parse response:", content);
    throw new Error("Failed to parse AI response");
  }
}

/**
 * Generate commit message from git changes
 */
export async function generateCommitMessage(
  changes: Array<{ path: string; status: string; diff: string }>,
  branchName?: string
): Promise<string> {
  const config = await loadConfig();
  const client = await getOpenAIClient();

  const changesText = changes
    .map((change) => {
      return `File: ${change.path} (${change.status})\n${change.diff}\n`;
    })
    .join("\n---\n\n");

  const branchContext = branchName
    ? `\nBranch name: ${branchName}\nConsider the branch name context when writing the commit message.\n`
    : '';

  const prompt = `You are an expert at writing meaningful git commit messages following Conventional Commits specification.

Analyze the following git changes and generate a commit message with header, body, and footer.
${branchContext}
STRUCTURE:
A commit message consists of three parts separated by blank lines:

1. HEADER (required): <type>[optional scope]: <description>
   - Types: feat, fix, docs, style, refactor, perf, test, chore
   - Keep under 72 characters
   - Use imperative mood ("add feature" not "added feature")

2. BODY (optional but recommended for non-trivial changes):
   - Explain the "why" and "what", not the "how"
   - Provide context and motivation for the change
   - Can be multiple paragraphs
   - Wrap at 72 characters per line

3. FOOTER (optional):
   - Reference issues: "Fixes #123" or "Closes #456"
   - Breaking changes: "BREAKING CHANGE: description"
   - Other metadata

EXAMPLES:

Simple commit (header only):
fix(auth): correct typo in login validation

Commit with body:
feat(api): add user profile endpoint

This endpoint allows clients to fetch user profile data including
avatar, bio, and social links. It supports optional query parameters
for filtering returned fields.

Commit with body and footer:
refactor(database): migrate from SQL to NoSQL

The application now uses MongoDB instead of PostgreSQL to better handle
unstructured user data and improve horizontal scaling capabilities.
The migration maintains backward compatibility with existing data.

BREAKING CHANGE: Database connection configuration format has changed
Closes #234

Git changes:
${changesText}

IMPORTANT: Generate ONLY the commit message. If the changes are simple, a header-only commit is fine. For significant changes, include a body explaining why the change was needed.`;

  const response = await client.chat.completions.create({
    model: config.model || "gpt-5.2",
    messages: [{ role: "user", content: prompt }],
    temperature: config.temperature || 1,
    reasoning_effort: config.reasoningEffort || "low",
  });

  const message = response.choices[0]?.message?.content?.trim();

  if (!message) {
    throw new Error("Failed to generate commit message");
  }

  return message;
}

/**
 * Generate PR title and description from branch info
 */
export async function generatePRSuggestion(
  branchName: string,
  commits: Array<{ message: string }>,
  diffs?: Array<{ path: string; status: string; diff: string }>,
  feedback?: string
): Promise<{ title: string; description: string }> {
  const config = await loadConfig();
  const client = await getOpenAIClient();

  const commitsText = commits.map((c, i) => `${i + 1}. ${c.message}`).join("\n");

  const diffsText = diffs && diffs.length > 0
    ? "\n\nCode Changes:\n" +
      diffs.map((d, i) =>
        `File ${i + 1}: ${d.path} (${d.status})\n${d.diff}\n---`
      ).join("\n")
    : "";

  const feedbackSection = feedback
    ? `\n\nUSER FEEDBACK ON PREVIOUS VERSION:
${feedback}

IMPORTANT: Address the user's feedback and regenerate the PR title and description accordingly.\n`
    : '';

  const prompt = `You are an expert at writing clear, professional pull request titles and descriptions.

Analyze the following information and generate a PR title and description.

Branch name: ${branchName}

Commits:
${commitsText}${diffsText}${feedbackSection}

Rules:
- Title should be clear, concise, and descriptive (max 72 characters)
- Use commits to understand the high-level changes
- Use code diffs (if provided) to understand implementation details and technical changes
- Be professional and specific
- Focus on WHY the change was made, not just WHAT changed

Generate the response in the following format:
TITLE: <your title here>

DESCRIPTION:
## Summary
[1-2 sentences explaining what this PR does and why]

## Changes
- [Key change 1]
- [Key change 2]
- [Key change 3]
[List the main changes as bullet points]

## Technical Notes
[Optional: Only include if there are breaking changes, API changes, new dependencies, or other important technical details. Otherwise omit this section entirely]

IMPORTANT:
- The description should be ready to use directly in GitHub - do NOT include labels like "PR Description:" or "Title:" in the description itself
- Only include the markdown content for the description
- Omit the "Technical Notes" section entirely if there are no breaking changes or important technical details`;

  const response = await client.chat.completions.create({
    model: config.model || "gpt-5.2",
    messages: [{ role: "user", content: prompt }],
    temperature: config.temperature || 1,
    reasoning_effort: config.reasoningEffort || "low",
  });

  const content = response.choices[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("Failed to generate PR suggestion");
  }

  // Parse the response
  const titleMatch = content.match(/TITLE:\s*(.+?)(?:\n|$)/);
  const descMatch = content.match(/DESCRIPTION:\s*([\s\S]+)$/);

  const title = titleMatch?.[1]?.trim() || "Update";
  const description = descMatch?.[1]?.trim() || content;

  return { title, description };
}

/**
 * Generate branch name from git changes
 */
export async function generateBranchName(
  changes: Array<{ path: string; status: string; diff: string }>
): Promise<{ name: string; type: "feature" | "bugfix" | "chore" | "refactor"; description: string }> {
  const config = await loadConfig();
  const client = await getOpenAIClient();

  const changesText = changes
    .map((change) => {
      return `File: ${change.path} (${change.status})\n${change.diff}\n`;
    })
    .join("\n---\n\n");

  const prompt = `You are an expert at analyzing code changes and creating descriptive git branch names.

Analyze the following git changes and generate a branch name.

Rules:
- Determine if this is a feature, bugfix, chore, or refactor
- Use the format: <type>/<descriptive-name>
- Types: feature, bugfix, chore, refactor
- The descriptive name should be kebab-case (lowercase with hyphens)
- Keep the branch name concise but descriptive (max 50 characters total)
- Focus on what is being changed, not how
- Be specific about the component/area being modified

Git changes:
${changesText}

IMPORTANT: You MUST respond with ONLY these three lines, no other text:
TYPE: <feature|bugfix|chore|refactor>
NAME: <type>/<descriptive-name>
DESCRIPTION: <one sentence description>`;

  const response = await client.chat.completions.create({
    model: config.model || "gpt-5.2",
    messages: [{ role: "user", content: prompt }],
    temperature: 1, // Use fixed temperature for consistent output
    reasoning_effort: "none", // Disable reasoning for faster, more predictable responses
  });

  const content = response.choices[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("Failed to generate branch name");
  }


  // Parse the response - try different patterns
  let typeMatch = content.match(/TYPE:\s*(feature|bugfix|chore|refactor)/i);
  let nameMatch = content.match(/NAME:\s*(.+?)(?:\n|$)/i);
  let descMatch = content.match(/DESCRIPTION:\s*(.+?)$/is);

  // If structured format fails, try to extract from free-form text
  if (!typeMatch || !nameMatch) {
    // Look for branch name pattern (type/name)
    const branchPattern = content.match(/(feature|bugfix|chore|refactor)\/([a-z0-9-]+)/i);
    if (branchPattern) {
      const extractedType = branchPattern[1]?.toLowerCase();
      const extractedName = branchPattern[0]; // full match like "feature/add-something"

      return {
        type: extractedType as "feature" | "bugfix" | "chore" | "refactor",
        name: extractedName,
        description: content.split('\n').find(line => line.length > 20)?.trim() || "Branch for code changes"
      };
    }
  }

  const type = (typeMatch?.[1]?.toLowerCase() as "feature" | "bugfix" | "chore" | "refactor") || "feature";
  const name = nameMatch?.[1]?.trim() || `${type}/update`;
  const description = descMatch?.[1]?.trim() || "Branch for code changes";

  return { name, type, description };
}

/**
 * PR information for release analysis
 */
export interface PRInfo {
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  mergedAt: string;
}

/**
 * Suggest version bump type based on commits and optionally PRs
 */
export async function suggestVersionBump(
  commits: Array<{ message: string }>,
  pullRequests?: PRInfo[]
): Promise<{ type: "major" | "minor" | "patch"; reason: string }> {
  const config = await loadConfig();
  const client = await getOpenAIClient();

  const commitsText = commits.map((c) => `- ${c.message}`).join("\n");

  let prsText = "";
  let labelsHint = "";

  if (pullRequests && pullRequests.length > 0) {
    prsText = `\n\nPull Requests merged since last release:\n${pullRequests
      .map((pr) => {
        let prLine = `- #${pr.number}: ${pr.title}`;
        if (pr.labels.length > 0) {
          prLine += ` [${pr.labels.join(", ")}]`;
        }
        return prLine;
      })
      .join("\n")}`;

    // Check for significant labels
    const allLabels = pullRequests.flatMap((pr) => pr.labels.map((l) => l.toLowerCase()));
    if (allLabels.some((l) => l.includes("breaking") || l.includes("major"))) {
      labelsHint = "\n\nNote: Some PRs have 'breaking' or 'major' labels - consider a MAJOR bump.";
    } else if (allLabels.some((l) => l.includes("enhancement") || l.includes("feature"))) {
      labelsHint = "\n\nNote: Some PRs have 'enhancement' or 'feature' labels - consider at least a MINOR bump.";
    }
  }

  const prompt = `You are an expert at semantic versioning (semver). Analyze the following commits${pullRequests && pullRequests.length > 0 ? " and pull requests" : ""} and suggest the appropriate version bump type.

Commits:
${commitsText}${prsText}${labelsHint}

Semver Rules:
- MAJOR (x.0.0): Breaking changes, incompatible API changes, major refactors that break existing functionality
- MINOR (0.x.0): New features, backwards-compatible functionality additions
- PATCH (0.0.x): Bug fixes, small improvements, documentation updates, chores

Keywords to look for:
- MAJOR: "BREAKING CHANGE", "breaking:", major refactor, API changes, remove deprecated features
- MINOR: "feat:", "feature:", new functionality, new endpoints, new commands
- PATCH: "fix:", "bugfix:", "chore:", "docs:", "style:", "refactor:" (non-breaking), "test:"

Analyze the commits${pullRequests && pullRequests.length > 0 ? " and PR information" : ""} and determine the highest priority version bump needed.

RESPOND WITH VALID JSON ONLY:
{
  "type": "major" | "minor" | "patch",
  "reason": "Brief explanation why this version bump is appropriate"
}`;

  const response = await client.chat.completions.create({
    model: config.model || "gpt-5.2",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    reasoning_effort: "none",
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("Failed to suggest version bump");
  }

  try {
    const result = JSON.parse(content);
    const type = result.type;
    const reason = result.reason || "No reason provided";

    // Validate type
    if (!["major", "minor", "patch"].includes(type)) {
      return { type: "patch", reason: "Could not determine version bump type" };
    }

    return { type, reason };
  } catch (error) {
    console.error("Failed to parse version bump suggestion:", content);
    return { type: "patch", reason: "Could not determine version bump type" };
  }
}

/**
 * Generate release notes from commits and optionally PRs
 */
export async function generateReleaseNotes(
  version: string,
  commits: Array<{ message: string; author: string; date: string }>,
  pullRequests?: PRInfo[]
): Promise<{ title: string; notes: string }> {
  const config = await loadConfig();
  const client = await getOpenAIClient();

  const commitsText = commits
    .map((c) => `- ${c.message} (by ${c.author})`)
    .join("\n");

  let prsText = "";
  if (pullRequests && pullRequests.length > 0) {
    prsText = `\n\nPull Requests merged since last release:\n${pullRequests
      .map((pr) => {
        let prEntry = `- #${pr.number}: ${pr.title}`;
        if (pr.labels.length > 0) {
          prEntry += ` [${pr.labels.join(", ")}]`;
        }
        if (pr.body) {
          // Truncate long PR bodies
          const truncatedBody = pr.body.length > 500
            ? pr.body.substring(0, 500) + "..."
            : pr.body;
          prEntry += `\n  Description: ${truncatedBody.replace(/\n/g, "\n  ")}`;
        }
        return prEntry;
      })
      .join("\n\n")}`;
  }

  const prompt = `You are an expert at writing clear, professional release notes.

Analyze the following commits${pullRequests && pullRequests.length > 0 ? " and pull requests" : ""} and generate release notes for version ${version}.

Commits since last release:
${commitsText}${prsText}

Rules:
- Title should be the version number with a brief theme (e.g., "v1.2.0 - Performance Improvements")
- Notes should be organized by category:
  * 🚀 Features (new functionality)
  * 🐛 Bug Fixes (fixes and corrections)
  * 🔧 Changes (refactoring, updates, improvements)
  * 📚 Documentation (docs changes)
  * 🧹 Chores (maintenance, dependencies)
- Use bullet points for each change
- Be concise and clear
- Use markdown formatting
- Focus on user-facing changes
- Group related changes together
${pullRequests && pullRequests.length > 0 ? "- Use PR titles and descriptions for better context on changes\n- Reference PR numbers where relevant (e.g., #123)" : ""}

Generate the response in the following format:
TITLE: <version theme here>

NOTES:
<your release notes here in markdown>`;

  const response = await client.chat.completions.create({
    model: config.model || "gpt-5.2",
    messages: [{ role: "user", content: prompt }],
    temperature: config.temperature || 1,
    reasoning_effort: config.reasoningEffort || "low",
  });

  const content = response.choices[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("Failed to generate release notes");
  }

  // Parse the response
  const titleMatch = content.match(/TITLE:\s*(.+?)(?:\n|$)/);
  const notesMatch = content.match(/NOTES:\s*([\s\S]+)$/);

  const title = titleMatch?.[1]?.trim() || version;
  const notes = notesMatch?.[1]?.trim() || content;

  return { title, notes };
}
