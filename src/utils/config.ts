import { join } from "path";
import { mkdir } from "fs/promises";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

export interface Config {
  openaiApiKey?: string;
  githubToken?: string;
  model?: string;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
}

const DEFAULT_CONFIG: Config = {
  model: "gpt-5.2",
  temperature: 1,
  reasoningEffort: "low",
};

/**
 * Get the config directory path
 */
function getConfigDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) {
    throw new Error("Could not determine home directory");
  }

  // Use XDG_CONFIG_HOME if set, otherwise use ~/.config
  const configBase = process.env.XDG_CONFIG_HOME || join(home, ".config");
  return join(configBase, "git-ai");
}

/**
 * Get the config file path
 */
function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

/**
 * Ensure config directory exists
 */
async function ensureConfigDir(): Promise<void> {
  const configDir = getConfigDir();
  try {
    await mkdir(configDir, { recursive: true });
  } catch (error) {
    // Ignore if directory already exists
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
}

/**
 * Load config from file
 */
export async function loadConfig(): Promise<Config> {
  const configPath = getConfigPath();

  try {
    const file = Bun.file(configPath);
    const exists = await file.exists();

    if (!exists) {
      return { ...DEFAULT_CONFIG };
    }

    const content = await file.text();
    const config = JSON.parse(content) as Config;

    // Merge with defaults
    return {
      ...DEFAULT_CONFIG,
      ...config,
    };
  } catch (error) {
    // If file doesn't exist or is invalid, return defaults
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Save config to file
 */
export async function saveConfig(config: Config): Promise<void> {
  await ensureConfigDir();

  const configPath = getConfigPath();
  const content = JSON.stringify(config, null, 2);

  await Bun.write(configPath, content);
}

/**
 * Update specific config values
 */
export async function updateConfig(updates: Partial<Config>): Promise<Config> {
  const config = await loadConfig();
  const newConfig = {
    ...config,
    ...updates,
  };

  await saveConfig(newConfig);
  return newConfig;
}

/**
 * Check if API key is configured
 */
export async function hasApiKey(): Promise<boolean> {
  const config = await loadConfig();
  return !!config.openaiApiKey && config.openaiApiKey.length > 0;
}

/**
 * Check if GitHub token is configured
 */
export async function hasGitHubToken(): Promise<boolean> {
  const config = await loadConfig();
  return !!config.githubToken && config.githubToken.length > 0;
}

/**
 * Get GitHub token from config or environment variable
 * Config takes precedence over environment variable
 */
export async function getGitHubToken(): Promise<string | null> {
  const config = await loadConfig();

  // First check config
  if (config.githubToken && config.githubToken.length > 0) {
    return config.githubToken;
  }

  // Fall back to environment variable
  const envToken = process.env.GITHUB_TOKEN;
  if (envToken && envToken.length > 0) {
    return envToken;
  }

  return null;
}

/**
 * Get config file location for display
 */
export function getConfigLocation(): string {
  return getConfigPath();
}

/**
 * Delete config file
 */
export async function deleteConfig(): Promise<void> {
  const configPath = getConfigPath();
  try {
    await Bun.file(configPath).exists() && (await Bun.$`rm ${configPath}`.quiet());
  } catch {
    // Ignore errors if file doesn't exist
  }
}
