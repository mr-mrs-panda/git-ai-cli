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
  changes: Array<{ path: string; status: string; diff: string }>
): Promise<string> {
  const config = await loadConfig();
  const client = await getOpenAIClient();

  const changesText = changes
    .map((change) => {
      return `File: ${change.path} (${change.status})\n${change.diff}\n`;
    })
    .join("\n---\n\n");

  const prompt = `You are an expert at writing concise, meaningful git commit messages following conventional commit standards.

Analyze the following git changes and generate a commit message.

Rules:
- Use conventional commit format: <type>(<scope>): <description>
- Types: feat, fix, docs, style, refactor, test, chore
- Keep the first line under 72 characters
- Be specific and descriptive
- Focus on the "why" and "what", not the "how"

Git changes:
${changesText}

Generate ONLY the commit message, nothing else.`;

  const response = await client.chat.completions.create({
    model: config.model || "gpt-5.2",
    messages: [{ role: "user", content: prompt }],
    temperature: config.temperature || 0.7,
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
    temperature: config.temperature || 0.7,
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
