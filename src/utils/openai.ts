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

  const prompt = `You are an expert at writing concise, meaningful git commit messages following conventional commit standards.

Analyze the following git changes and generate a commit message.
${branchContext}
Rules:
- Use conventional commit format: <type>(<scope>): <description>
- Types: feat, fix, docs, style, refactor, test, chore
- Keep the first line under 72 characters
- Be specific and descriptive
- Focus on the "why" and "what", not the "how"
- If a branch name is provided, ensure the commit message aligns with the branch's purpose

Git changes:
${changesText}

Generate ONLY the commit message, nothing else.`;

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
  commits: Array<{ message: string }>
): Promise<{ title: string; description: string }> {
  const config = await loadConfig();
  const client = await getOpenAIClient();

  const commitsText = commits.map((c, i) => `${i + 1}. ${c.message}`).join("\n");

  const prompt = `You are an expert at writing clear, professional pull request titles and descriptions.

Analyze the following information and generate a PR title and description.

Branch name: ${branchName}

Commits:
${commitsText}

Rules:
- Title should be clear, concise, and descriptive (max 72 characters)
- Description should include:
  * Brief summary of changes
  * Key features or fixes
  * Any relevant context
- Use markdown formatting for the description
- Be professional and specific

Generate the response in the following format:
TITLE: <your title here>

DESCRIPTION:
<your description here>`;

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

  // Debug: log the raw response
  console.log("[DEBUG] AI Response for branch name:");
  console.log(content);
  console.log("[DEBUG] End of response\n");

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
