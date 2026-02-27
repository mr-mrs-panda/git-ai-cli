import { z } from "zod";
import { invokeStructured, invokeText } from "./llm.ts";

export async function generateCommitMessage(
  changes: Array<{ path: string; status: string; diff: string }>,
  branchName?: string,
  feedback?: string
): Promise<string> {
  const changesText = changes
    .map((change) => `File: ${change.path} (${change.status})\n${change.diff}\n`)
    .join("\n---\n\n");

  const branchContext = branchName
    ? `\nBranch name: ${branchName}\nConsider the branch name context when writing the commit message.\n`
    : "";

  const feedbackSection = feedback
    ? `\n\nUSER FEEDBACK ON PREVIOUS VERSION:\n${feedback}\n\nIMPORTANT: Address the user's feedback and regenerate the commit message accordingly.\n`
    : "";

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

Git changes:
${changesText}${feedbackSection}

IMPORTANT: Generate ONLY the commit message.`;

  return invokeText("commit", prompt);
}

const prSuggestionSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
});

export async function generatePRSuggestion(
  branchName: string,
  commits: Array<{ message: string }>,
  diffs?: Array<{ path: string; status: string; diff: string }>,
  feedback?: string,
  existingPR?: { title: string; body: string | null }
): Promise<{ title: string; description: string }> {
  const commitsText = commits.map((c, i) => `${i + 1}. ${c.message}`).join("\n");
  const diffsText = diffs && diffs.length > 0
    ? "\n\nCode Changes:\n" + diffs.map((d, i) => `File ${i + 1}: ${d.path} (${d.status})\n${d.diff}\n---`).join("\n")
    : "";

  const existingPRSection = existingPR
    ? `\n\nEXISTING PR CONTEXT:\nCurrent Title: ${existingPR.title}\nCurrent Description:\n${existingPR.body || "(no description)"}`
    : "";

  const feedbackSection = feedback
    ? `\n\nUSER FEEDBACK:\n${feedback}\nAddress this feedback in the regenerated output.`
    : "";

  const prompt = `Generate a professional pull request title and markdown description.

Branch name: ${branchName}

Commits:
${commitsText}${diffsText}${existingPRSection}${feedbackSection}

Rules:
- Title max 72 chars
- Description must include sections: Summary, Changes
- Optional Technical Notes only if needed
- Focus on user impact and rationale
- Return structured data`;

  return invokeStructured("pr", prompt, prSuggestionSchema);
}

const branchSchema = z.object({
  type: z.enum(["feature", "bugfix", "chore", "refactor"]),
  name: z.string().min(1),
  description: z.string().min(1),
});

export async function generateBranchName(
  changes: Array<{ path: string; status: string; diff: string }>,
  feedback?: string
): Promise<{ name: string; type: "feature" | "bugfix" | "chore" | "refactor"; description: string }> {
  const changesText = changes
    .map((change) => `File: ${change.path} (${change.status})\n${change.diff}\n`)
    .join("\n---\n\n");

  const feedbackSection = feedback
    ? `\n\nUSER FEEDBACK:\n${feedback}\nAddress this feedback.`
    : "";

  const prompt = `Analyze git changes and suggest a branch name.

Rules:
- Determine one type: feature|bugfix|chore|refactor
- Name format: <type>/<kebab-case>
- Keep concise (max 50 chars)

Changes:
${changesText}${feedbackSection}`;

  const result = await invokeStructured("branch", prompt, branchSchema, {
    reasoningEffort: "none",
    temperature: 1,
  });

  return {
    type: result.type,
    name: result.name,
    description: result.description,
  };
}

export interface CommitGroup {
  id: number;
  type: string;
  scope?: string;
  description: string;
  reasoning: string;
  files: string[];
  dependencies: number[];
  commitHeader: string;
  commitBody?: string;
  commitFooter?: string;
}

export interface GroupingResult {
  groups: CommitGroup[];
  totalGroups: number;
}

const groupingSchema = z.object({
  groups: z.array(z.object({
    id: z.number().int().positive(),
    type: z.string().min(1),
    scope: z.string().optional(),
    description: z.string().min(1),
    reasoning: z.string().default(""),
    files: z.array(z.string()).default([]),
    dependencies: z.array(z.number().int().positive()).default([]),
    commitHeader: z.string().min(1),
    commitBody: z.string().optional(),
    commitFooter: z.string().optional(),
  })).min(1),
  totalGroups: z.number().int().positive(),
});

export async function analyzeAndPlanGroupedCommits(
  changes: Array<{ path: string; status: string; diff: string }>,
  branchName?: string
): Promise<GroupingResult> {
  const changesText = changes
    .map((change, i) => `File ${i + 1}: ${change.path} (${change.status})\n${change.diff}\n`)
    .join("\n---\n\n");

  const branchContext = branchName
    ? `Branch name: ${branchName}\nConsider branch context while grouping.\n\n`
    : "";

  const prompt = `Group these file changes into logical, atomic conventional commits.

${branchContext}
Rules:
- 1..10 groups
- Keep feature, refactor, docs, test separated where meaningful
- Include dependency ordering in dependencies
- Every changed file should appear in at least one group
- For every group provide a complete commit message plan:
  - commitHeader: Conventional Commit header (<type>[optional scope]: <description>, max 72 chars)
  - commitBody: optional body (explain why/what)
  - commitFooter: optional footer (issues/breaking metadata)
- commitHeader must be valid and specific for that group's files

Changes:
${changesText}`;

  const result = await invokeStructured("commit", prompt, groupingSchema);
  const groups = result.groups.slice(0, 10).map((g, idx) => ({
    id: g.id || idx + 1,
    type: g.type,
    scope: g.scope,
    description: g.description,
    reasoning: g.reasoning,
    files: g.files,
    dependencies: g.dependencies,
    commitHeader: g.commitHeader,
    commitBody: g.commitBody,
    commitFooter: g.commitFooter,
  }));

  return { groups, totalGroups: groups.length };
}

export interface PRInfo {
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  mergedAt: string;
}

const versionBumpSchema = z.object({
  type: z.enum(["major", "minor", "patch"]),
  reason: z.string().min(1),
});

export async function suggestVersionBump(
  commits: Array<{ message: string }>,
  pullRequests?: PRInfo[]
): Promise<{ type: "major" | "minor" | "patch"; reason: string }> {
  const commitsText = commits.map((c) => `- ${c.message}`).join("\n");
  const prsText = pullRequests && pullRequests.length > 0
    ? `\n\nPRs:\n${pullRequests.map((pr) => `- #${pr.number}: ${pr.title} [${pr.labels.join(", ")}]`).join("\n")}`
    : "";

  const prompt = `Suggest semantic version bump based on the changelog.

Commits:
${commitsText}${prsText}

Semver policy:
- major: breaking changes
- minor: new features
- patch: fixes/chore/docs`;

  return invokeStructured("release", prompt, versionBumpSchema, {
    reasoningEffort: "none",
    temperature: 0.3,
  });
}

const releaseNotesSchema = z.object({
  title: z.string().min(1),
  notes: z.string().min(1),
});

export async function generateReleaseNotes(
  version: string,
  commits: Array<{ message: string; author: string; date: string }>,
  pullRequests?: PRInfo[]
): Promise<{ title: string; notes: string }> {
  const commitsText = commits.map((c) => `- ${c.message} (by ${c.author})`).join("\n");

  const prsText = pullRequests && pullRequests.length > 0
    ? `\n\nPull Requests:\n${pullRequests.map((pr) => `- #${pr.number}: ${pr.title}${pr.body ? `\n  ${pr.body.slice(0, 500)}` : ""}`).join("\n")}`
    : "";

  const prompt = `Create release notes for version ${version}.

Commits:
${commitsText}${prsText}

Format requirements:
- title: short release title
- notes: markdown with sections for Features, Bug Fixes, Changes, Docs, Chores where applicable`;

  return invokeStructured("release", prompt, releaseNotesSchema);
}
