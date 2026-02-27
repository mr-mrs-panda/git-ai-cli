import { join } from "path";
import { mkdir } from "fs/promises";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";
export type CommitMode = "single" | "grouped";
export type LLMProvider = "openai" | "gemini" | "anthropic";
export type LLMTask = "commit" | "pr" | "branch" | "release" | "unwrapped" | "celebrate";

export interface UserPreferences {
  commit: {
    alwaysStageAll: boolean;
    defaultMode: CommitMode;
    autoPushOnYes: boolean;
  };
  pullRequest: {
    createAsDraft: boolean;
  };
}

export interface LLMProfile {
  provider: LLMProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKey?: string;
}

export interface LLMConfig {
  defaultProfile: string;
  profiles: Record<string, LLMProfile>;
  taskPresets: Record<LLMTask, string>;
  retry: {
    maxAttempts: number;
    backoffMs: number;
  };
  timeouts: {
    requestMs: number;
  };
}

export interface Config {
  githubToken?: string;
  llm: LLMConfig;
  preferences: UserPreferences;
}

type PartialLLMConfig = {
  defaultProfile?: string;
  profiles?: Record<string, Partial<LLMProfile>>;
  taskPresets?: Partial<Record<LLMTask, string>>;
  retry?: Partial<LLMConfig["retry"]>;
  timeouts?: Partial<LLMConfig["timeouts"]>;
};

type PartialUserPreferences = {
  commit?: Partial<UserPreferences["commit"]>;
  pullRequest?: Partial<UserPreferences["pullRequest"]>;
};

export interface ConfigUpdate {
  githubToken?: string;
  llm?: PartialLLMConfig;
  preferences?: PartialUserPreferences;
}

const DEFAULT_LLM_CONFIG: LLMConfig = {
  defaultProfile: "smart-main",
  profiles: {
    "smart-main": {
      provider: "openai",
      temperature: 0.7,
      maxTokens: 4096,
      reasoningEffort: "low",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY",
    },
  },
  taskPresets: {
    commit: "smart-main",
    pr: "smart-main",
    branch: "smart-main",
    release: "smart-main",
    unwrapped: "smart-main",
    celebrate: "smart-main",
  },
  retry: {
    maxAttempts: 3,
    backoffMs: 400,
  },
  timeouts: {
    requestMs: 60000,
  },
};

const DEFAULT_PREFERENCES: UserPreferences = {
  commit: {
    alwaysStageAll: true,
    defaultMode: "grouped",
    autoPushOnYes: false,
  },
  pullRequest: {
    createAsDraft: true,
  },
};

const DEFAULT_CONFIG: Config = {
  llm: DEFAULT_LLM_CONFIG,
  preferences: DEFAULT_PREFERENCES,
};

function hasLegacyConfigFields(input: unknown): boolean {
  if (!input || typeof input !== "object") {
    return false;
  }

  const candidate = input as Record<string, unknown>;
  return (
    "openaiApiKey" in candidate ||
    "model" in candidate ||
    "temperature" in candidate ||
    "reasoningEffort" in candidate
  );
}

function migrateLegacyConfig(legacy: Record<string, unknown>): ConfigUpdate {
  const model = typeof legacy.model === "string" ? legacy.model : undefined;
  const temperature = typeof legacy.temperature === "number" ? legacy.temperature : undefined;
  const reasoningEffort =
    legacy.reasoningEffort === "none" ||
    legacy.reasoningEffort === "low" ||
    legacy.reasoningEffort === "medium" ||
    legacy.reasoningEffort === "high" ||
    legacy.reasoningEffort === "xhigh"
      ? legacy.reasoningEffort
      : undefined;

  const openaiApiKey = typeof legacy.openaiApiKey === "string" ? legacy.openaiApiKey : undefined;
  const githubToken = typeof legacy.githubToken === "string" ? legacy.githubToken : undefined;

  const preferences = (legacy.preferences && typeof legacy.preferences === "object")
    ? legacy.preferences as ConfigUpdate["preferences"]
    : undefined;

  return {
    githubToken,
    llm: {
      defaultProfile: "smart-main",
      profiles: {
        "smart-main": {
          provider: "openai",
          model,
          temperature,
          reasoningEffort,
          baseUrl: "https://api.openai.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
          apiKey: openaiApiKey,
        },
      },
    },
    preferences,
  };
}

function getDefaultConfig(): Config {
  return structuredClone(DEFAULT_CONFIG);
}

function mergeConfigWithDefaults(config: ConfigUpdate): Config {
  const defaults = getDefaultConfig();

  const mergedProfiles: Record<string, LLMProfile> = { ...defaults.llm.profiles };
  for (const [name, profile] of Object.entries(config.llm?.profiles || {})) {
    const base = mergedProfiles[name] || defaults.llm.profiles[defaults.llm.defaultProfile];
    if (!base) continue;
    mergedProfiles[name] = { ...base, ...profile };
  }

  const llm: LLMConfig = {
    defaultProfile: config.llm?.defaultProfile ?? defaults.llm.defaultProfile,
    profiles: mergedProfiles,
    taskPresets: {
      ...defaults.llm.taskPresets,
      ...(config.llm?.taskPresets || {}),
    },
    retry: {
      maxAttempts: config.llm?.retry?.maxAttempts ?? defaults.llm.retry.maxAttempts,
      backoffMs: config.llm?.retry?.backoffMs ?? defaults.llm.retry.backoffMs,
    },
    timeouts: {
      requestMs: config.llm?.timeouts?.requestMs ?? defaults.llm.timeouts.requestMs,
    },
  };

  const preferences: UserPreferences = {
    commit: {
      alwaysStageAll:
        config.preferences?.commit?.alwaysStageAll ?? defaults.preferences.commit.alwaysStageAll,
      defaultMode:
        config.preferences?.commit?.defaultMode ?? defaults.preferences.commit.defaultMode,
      autoPushOnYes:
        config.preferences?.commit?.autoPushOnYes ?? defaults.preferences.commit.autoPushOnYes,
    },
    pullRequest: {
      createAsDraft:
        config.preferences?.pullRequest?.createAsDraft ?? defaults.preferences.pullRequest.createAsDraft,
    },
  };

  return {
    githubToken: config.githubToken,
    llm,
    preferences,
  };
}

function getConfigDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) {
    throw new Error("Could not determine home directory");
  }

  const configBase = process.env.XDG_CONFIG_HOME || join(home, ".config");
  return join(configBase, "git-ai");
}

function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

async function ensureConfigDir(): Promise<void> {
  const configDir = getConfigDir();
  try {
    await mkdir(configDir, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
}

export async function loadConfig(): Promise<Config> {
  const configPath = getConfigPath();
  const file = Bun.file(configPath);
  const exists = await file.exists();

  if (!exists) {
    return getDefaultConfig();
  }

  const content = await file.text();
  const parsed = JSON.parse(content) as ConfigUpdate & Record<string, unknown>;

  if (hasLegacyConfigFields(parsed)) {
    return mergeConfigWithDefaults(migrateLegacyConfig(parsed));
  }

  return mergeConfigWithDefaults(parsed);
}

export async function saveConfig(config: Config): Promise<void> {
  await ensureConfigDir();
  const configPath = getConfigPath();
  const content = JSON.stringify(config, null, 2);
  await Bun.write(configPath, content);
}

export async function updateConfig(updates: ConfigUpdate): Promise<Config> {
  const current = await loadConfig();

  const mergedInput: ConfigUpdate = {
    githubToken: updates.githubToken ?? current.githubToken,
    llm: {
      ...current.llm,
      ...updates.llm,
      profiles: {
        ...current.llm.profiles,
        ...(updates.llm?.profiles || {}),
      },
      taskPresets: {
        ...current.llm.taskPresets,
        ...(updates.llm?.taskPresets || {}),
      },
      retry: {
        ...current.llm.retry,
        ...(updates.llm?.retry || {}),
      },
      timeouts: {
        ...current.llm.timeouts,
        ...(updates.llm?.timeouts || {}),
      },
    },
    preferences: {
      commit: {
        ...current.preferences.commit,
        ...(updates.preferences?.commit || {}),
      },
      pullRequest: {
        ...current.preferences.pullRequest,
        ...(updates.preferences?.pullRequest || {}),
      },
    },
  };

  const next = mergeConfigWithDefaults(mergedInput);
  await saveConfig(next);
  return next;
}

export async function hasApiKey(): Promise<boolean> {
  const config = await loadConfig();
  const defaultProfile = config.llm.profiles[config.llm.defaultProfile];
  if (!defaultProfile) return false;
  if (!defaultProfile.model || defaultProfile.model.trim().length === 0) return false;
  return !!defaultProfile.apiKey && defaultProfile.apiKey.trim().length > 0;
}

export async function hasGitHubToken(): Promise<boolean> {
  const config = await loadConfig();
  return !!config.githubToken && config.githubToken.length > 0;
}

export async function getGitHubToken(): Promise<string | null> {
  const config = await loadConfig();

  if (config.githubToken && config.githubToken.length > 0) {
    return config.githubToken;
  }

  const envToken = process.env.GITHUB_TOKEN;
  if (envToken && envToken.length > 0) {
    return envToken;
  }

  return null;
}

export function getConfigLocation(): string {
  return getConfigPath();
}

export async function deleteConfig(): Promise<void> {
  const configPath = getConfigPath();
  try {
    await Bun.file(configPath).exists() && (await Bun.$`rm ${configPath}`.quiet());
  } catch {
    // Ignore errors if file doesn't exist
  }
}

export async function getTaskProfile(task: LLMTask): Promise<{ name: string; profile: LLMProfile }> {
  const config = await loadConfig();
  const profileName = config.llm.taskPresets[task] || config.llm.defaultProfile;
  const profile = config.llm.profiles[profileName];
  if (!profile) {
    throw new Error(`LLM profile '${profileName}' not found for task '${task}'.`);
  }

  return { name: profileName, profile };
}

export async function getProfileByName(name: string): Promise<LLMProfile> {
  const config = await loadConfig();
  const profile = config.llm.profiles[name];
  if (!profile) {
    throw new Error(`LLM profile '${name}' not found.`);
  }
  return profile;
}
