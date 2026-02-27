import * as p from "@clack/prompts";
import {
  loadConfig,
  updateConfig,
  getConfigLocation,
  type ConfigUpdate,
  type LLMProvider,
  type ReasoningEffort,
} from "../utils/config.ts";
import {
  discoverProviderModels,
  getDefaultProviderApiKeyEnv,
  getDefaultProviderBaseUrl,
} from "../utils/model-discovery.ts";
import { Spinner } from "../utils/ui.ts";
import { listProviders, providerRequiresApiKey } from "../utils/provider-registry.ts";

const REASONING_LEVELS: Array<{ value: ReasoningEffort; label: string; hint: string }> = [
  { value: "none", label: "None", hint: "No reasoning phase (fastest)" },
  { value: "low", label: "Low", hint: "Minimal reasoning" },
  { value: "medium", label: "Medium", hint: "Moderate depth" },
  { value: "high", label: "High", hint: "Deep reasoning" },
  { value: "xhigh", label: "Extra High", hint: "Maximum reasoning" },
];

function maskKey(key?: string): string {
  if (!key) return "Not set";
  if (key.length < 8) return "***";
  return `***${key.slice(-4)}`;
}

async function showCurrentConfig(): Promise<void> {
  const config = await loadConfig();
  const profile = config.llm.profiles[config.llm.defaultProfile];
  const fallbackEnv = profile ? getDefaultProviderApiKeyEnv(profile.provider) : "OPENAI_API_KEY";

  p.note(
    `  Provider: ${profile?.provider || "openai"}\n` +
      `  Model: ${profile?.model || "(not selected)"}\n` +
      `  Temperature: ${profile?.temperature ?? 0.7}\n` +
      `  Reasoning Effort: ${profile?.reasoningEffort || "low"}\n` +
      `  Base URL: ${profile?.baseUrl || "(provider default)"}\n` +
      `  API Key Env: ${profile?.apiKeyEnv || fallbackEnv}\n` +
      `  API Key (local): ${maskKey(profile?.apiKey)}\n` +
      `  Commit Default Mode: ${config.preferences.commit.defaultMode}\n` +
      `  Commit Always Stage All: ${config.preferences.commit.alwaysStageAll ? "Yes" : "No"}\n` +
      `  Commit -y Auto Push: ${config.preferences.commit.autoPushOnYes ? "Yes" : "No"}\n` +
      `  Pull Requests As Draft: ${config.preferences.pullRequest.createAsDraft ? "Yes" : "No"}\n` +
      `  GitHub Token: ${maskKey(config.githubToken)}`,
    "Current Settings"
  );
}

async function runLLMSetupWizard(): Promise<void> {
  const current = await loadConfig();
  const currentProfile = current.llm.profiles[current.llm.defaultProfile] || {
    provider: "openai" as LLMProvider,
    temperature: 0.7,
    maxTokens: 4096,
    reasoningEffort: "low" as ReasoningEffort,
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
  };

  const provider = await p.select({
    message: "Provider:",
    options: listProviders().map((meta) => ({
      value: meta.id,
      label: meta.label,
      hint: meta.defaultBaseUrl,
    })),
    initialValue: currentProfile.provider,
  });
  if (p.isCancel(provider)) return;

  const providerValue = provider as LLMProvider;
  const defaultApiEnv = getDefaultProviderApiKeyEnv(providerValue);
  const providerChanged = currentProfile.provider !== providerValue;
  const providerSupportsCustomBaseUrl =
    providerValue === "custom-openai-compatible" || providerValue === "ollama";
  const defaultBaseUrl =
    !providerChanged && currentProfile.baseUrl
      ? currentProfile.baseUrl
      : getDefaultProviderBaseUrl(providerValue);
  const requiresApiKey = providerRequiresApiKey(providerValue);
  let localApiKey = providerChanged ? undefined : currentProfile.apiKey;
  let resolvedBaseUrl = defaultBaseUrl;

  if (providerSupportsCustomBaseUrl) {
    const enteredBaseUrl = await p.text({
      message: "Custom provider base URL:",
      initialValue: defaultBaseUrl,
      validate: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return "Base URL is required";
        try {
          new URL(trimmed);
          return undefined;
        } catch {
          return "Enter a valid URL (e.g. https://api.example.com/v1)";
        }
      },
    });
    if (p.isCancel(enteredBaseUrl)) return;
    resolvedBaseUrl = String(enteredBaseUrl).trim().replace(/\/$/, "");
  }

  if (!localApiKey) {
    const entered = await p.password({
      message: requiresApiKey
        ? `Enter ${providerValue} API key:`
        : `Enter ${providerValue} API key (optional):`,
      mask: "*",
      validate: (value) => {
        if (!requiresApiKey) return undefined;
        return (!value || !value.trim()) ? "API key is required" : undefined;
      },
    });
    if (p.isCancel(entered)) return;
    localApiKey = String(entered).trim() || undefined;

    const immediateSave = new Spinner();
    immediateSave.start("Saving API key...");
    await updateConfig({
      llm: {
        defaultProfile: "smart-main",
        profiles: {
          "smart-main": {
            provider: providerValue,
            model: providerChanged ? undefined : currentProfile.model,
            temperature: currentProfile.temperature ?? 0.7,
            maxTokens: currentProfile.maxTokens ?? 4096,
            reasoningEffort: currentProfile.reasoningEffort ?? "low",
            baseUrl: resolvedBaseUrl,
            apiKeyEnv: defaultApiEnv,
            apiKey: localApiKey,
          },
        },
      },
    });
    immediateSave.stop("API key saved");
  }

  const discoveryKey = localApiKey || process.env[defaultApiEnv];

  const spinner = new Spinner();
  spinner.start(`Loading ${providerValue} models...`);
  let models: Array<{ id: string; label: string; hint?: string }> = [];
  try {
    models = await discoverProviderModels(providerValue, discoveryKey, resolvedBaseUrl);
    spinner.stop(`Loaded ${models.length} model(s)`);
  } catch (error) {
    spinner.stop("Failed to load models");
    p.log.warn(`Could not load models automatically: ${error instanceof Error ? error.message : String(error)}`);
  }

  let modelValue = "";
  if (models.length > 0) {
    const model = await p.select({
      message: "Model:",
      options: [
        ...models.map((m) => ({ value: m.id, label: m.label, hint: m.hint })),
        { value: "__manual__", label: "Manual model ID entry", hint: "Type model name yourself" },
      ],
      initialValue: currentProfile.model && models.some((m) => m.id === currentProfile.model)
        ? currentProfile.model
        : models[0]?.id,
    });
    if (p.isCancel(model)) return;

    if (model === "__manual__") {
      const manualModel = await p.text({
        message: "Enter model ID:",
        initialValue: currentProfile.model || "",
        validate: (value) => (!value || !value.trim() ? "Model ID is required" : undefined),
      });
      if (p.isCancel(manualModel)) return;
      modelValue = String(manualModel).trim();
    } else {
      modelValue = String(model);
    }
  } else {
    const manualModel = await p.text({
      message: "No models discovered. Enter model ID manually:",
      initialValue: currentProfile.model || "",
      validate: (value) => (!value || !value.trim() ? "Model ID is required" : undefined),
    });
    if (p.isCancel(manualModel)) return;
    modelValue = String(manualModel).trim();
  }

  const temperature = await p.text({
    message: "Temperature (0.0 - 2.0):",
    initialValue: String(currentProfile.temperature ?? 0.7),
    validate: (value) => {
      const num = parseFloat(value);
      if (isNaN(num)) return "Must be a number";
      if (num < 0 || num > 2) return "Must be between 0.0 and 2.0";
    },
  });
  if (p.isCancel(temperature)) return;

  const reasoning = await p.select({
    message: "Reasoning effort:",
    options: REASONING_LEVELS,
    initialValue: currentProfile.reasoningEffort ?? "low",
  });
  if (p.isCancel(reasoning)) return;

  const updates: ConfigUpdate = {
    llm: {
      defaultProfile: "smart-main",
      profiles: {
        "smart-main": {
          provider: providerValue,
          model: modelValue,
          temperature: parseFloat(temperature as string),
          maxTokens: currentProfile.maxTokens ?? 4096,
          reasoningEffort: reasoning as ReasoningEffort,
          baseUrl: resolvedBaseUrl,
          apiKeyEnv: defaultApiEnv,
          apiKey: localApiKey,
        },
      },
    },
  };

  const saveSpinner = new Spinner();
  saveSpinner.start("Saving LLM settings...");
  await updateConfig(updates);
  saveSpinner.stop("LLM settings saved!");
}

export async function settings(): Promise<void> {
  console.clear();
  p.intro("⚙️  Git AI CLI - Settings");
  await showCurrentConfig();

  while (true) {
    const choice = await p.select({
      message: "What would you like to configure?",
      options: [
        { value: "llmSetup", label: "LLM Setup Wizard", hint: "Provider, model, key env, temperature, reasoning" },
        { value: "commitMode", label: "Commit Default Mode", hint: "Single or grouped commits" },
        { value: "commitStageAll", label: "Commit Always Stage All", hint: "Include all changes automatically" },
        { value: "commitAutoPushOnYes", label: "Commit -y Auto Push", hint: "Auto-push when using --yes" },
        { value: "prDraft", label: "PR Draft Default", hint: "Create pull requests as draft by default" },
        { value: "githubToken", label: "GitHub Token", hint: "Used for PR/release APIs" },
        { value: "view", label: "View Config File", hint: "Show config file location" },
        { value: "exit", label: "Exit Settings" },
      ],
    });

    if (p.isCancel(choice) || choice === "exit") return;

    const config = await loadConfig();
    const updates: ConfigUpdate = {};

    if (choice === "llmSetup") {
      await runLLMSetupWizard();
      await showCurrentConfig();
      continue;
    }

    if (choice === "commitMode") {
      const mode = await p.select({
        message: "Default commit mode:",
        options: [
          { value: "grouped", label: "Grouped" },
          { value: "single", label: "Single" },
        ],
        initialValue: config.preferences.commit.defaultMode,
      });
      if (p.isCancel(mode)) continue;
      updates.preferences = {
        commit: {
          ...config.preferences.commit,
          defaultMode: mode as "grouped" | "single",
        },
      };
    }

    if (choice === "commitStageAll") {
      const alwaysStageAll = await p.confirm({
        message: "Always stage all changes before commit?",
        initialValue: config.preferences.commit.alwaysStageAll,
      });
      if (p.isCancel(alwaysStageAll)) continue;
      updates.preferences = {
        commit: {
          ...config.preferences.commit,
          alwaysStageAll,
        },
      };
    }

    if (choice === "commitAutoPushOnYes") {
      const autoPushOnYes = await p.confirm({
        message: "Auto-push when using `-y`?",
        initialValue: config.preferences.commit.autoPushOnYes,
      });
      if (p.isCancel(autoPushOnYes)) continue;
      updates.preferences = {
        commit: {
          ...config.preferences.commit,
          autoPushOnYes,
        },
      };
    }

    if (choice === "prDraft") {
      const createAsDraft = await p.confirm({
        message: "Create PRs as draft by default?",
        initialValue: config.preferences.pullRequest.createAsDraft,
      });
      if (p.isCancel(createAsDraft)) continue;
      updates.preferences = {
        pullRequest: {
          createAsDraft,
        },
      };
    }

    if (choice === "githubToken") {
      const token = await p.password({
        message: "GitHub token (empty clears local token):",
        mask: "*",
      });
      if (p.isCancel(token)) continue;
      updates.githubToken = String(token).trim() || undefined;
    }

    if (choice === "view") {
      p.note(
        `Config file location:\n${getConfigLocation()}\n\n` +
          `Tip: Set provider keys in ENV (OPENAI_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY / OLLAMA_API_KEY).`,
        "Configuration File"
      );
      continue;
    }

    if (Object.keys(updates).length > 0) {
      const spinner = new Spinner();
      spinner.start("Saving settings...");
      await updateConfig(updates);
      spinner.stop("Settings saved!");
      await showCurrentConfig();
    }
  }
}
