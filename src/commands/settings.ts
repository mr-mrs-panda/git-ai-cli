import * as p from "@clack/prompts";
import { loadConfig, updateConfig, getConfigLocation, type Config, type ReasoningEffort } from "../utils/config.ts";
import { Spinner } from "../utils/ui.ts";

const AVAILABLE_MODELS = [
  { value: "gpt-5.2", label: "GPT-5.2", hint: "Fast on 'none', deep on 'high'" },
  { value: "gpt-5.2-chat", label: "GPT-5.2 Chat", hint: "Optimized for conversations" },
  { value: "gpt-5.2-pro", label: "GPT-5.2 Pro", hint: "Complex tasks, high reasoning" },
  { value: "gpt-5.1", label: "GPT-5.1", hint: "Previous generation" },
  { value: "gpt-5.1-codex", label: "GPT-5.1 Codex", hint: "Optimized for code" },
  { value: "gpt-5-mini", label: "GPT-5 Mini", hint: "Cost-effective, lighter" },
  { value: "gpt-5-nano", label: "GPT-5 Nano", hint: "Very lightweight" },
  { value: "o3", label: "o3", hint: "Previous generation reasoning" },
  { value: "o3-mini", label: "o3 Mini", hint: "Lighter o3 variant" },
];

const REASONING_LEVELS: Array<{ value: ReasoningEffort; label: string; hint: string }> = [
  { value: "none", label: "None", hint: "No reasoning phase (fastest)" },
  { value: "low", label: "Low", hint: "Minimal reasoning (balanced)" },
  { value: "medium", label: "Medium", hint: "Moderate reasoning depth" },
  { value: "high", label: "High", hint: "Deep reasoning (slower)" },
  { value: "xhigh", label: "Extra High", hint: "Maximum reasoning (GPT-5.2 Pro only)" },
];

async function showCurrentConfig(): Promise<void> {
  const config = await loadConfig();
  const preferences = config.preferences;
  const commitPreferences = preferences?.commit;
  const prPreferences = preferences?.pullRequest;

  p.note(
    `  Model: ${config.model || "gpt-5.2"}\n` +
    `  Reasoning Effort: ${config.reasoningEffort || "low"}\n` +
    `  Temperature: ${config.temperature || 1}\n` +
    `  Commit Default Mode: ${(commitPreferences?.defaultMode ?? "grouped")}\n` +
    `  Commit Always Stage All: ${(commitPreferences?.alwaysStageAll ?? true) ? "Yes" : "No"}\n` +
    `  Commit -y Auto Push: ${(commitPreferences?.autoPushOnYes ?? false) ? "Yes" : "No"}\n` +
    `  Pull Requests As Draft: ${(prPreferences?.createAsDraft ?? true) ? "Yes" : "No"}\n` +
    `  API Key: ${config.openaiApiKey ? "***" + config.openaiApiKey.slice(-4) : "Not set"}`,
    "Current Settings"
  );
}

export async function settings(): Promise<void> {
  console.clear();
  p.intro("⚙️  Git AI CLI - Settings");

  await showCurrentConfig();

  // Main settings loop
  while (true) {
    const settingToChange = await p.select({
      message: "What would you like to configure?",
      options: [
        { value: "model", label: "AI Model", hint: "Change the GPT model" },
        { value: "reasoning", label: "Reasoning Effort", hint: "Adjust reasoning depth" },
        { value: "temperature", label: "Temperature", hint: "Creativity vs consistency" },
        { value: "commitMode", label: "Commit Default Mode", hint: "Single or grouped commits" },
        { value: "commitStageAll", label: "Commit Always Stage All", hint: "Include all changes automatically" },
        { value: "commitAutoPushOnYes", label: "Commit -y Auto Push", hint: "Auto-push when using --yes" },
        { value: "prDraft", label: "PR Draft Default", hint: "Create pull requests as draft by default" },
        { value: "apiKey", label: "API Key", hint: "Update OpenAI API key" },
        { value: "view", label: "View Config File", hint: "Show config file location" },
        { value: "reset", label: "Reset to Defaults", hint: "Restore default settings" },
        { value: "exit", label: "Exit Settings", hint: "Return to main menu" },
      ],
    });

    if (p.isCancel(settingToChange) || settingToChange === "exit") {
      return;
    }

    const config = await loadConfig();
    const updates: Partial<Config> = {};

    switch (settingToChange) {
      case "model": {
        const model = await p.select({
          message: "Select AI model:",
          options: AVAILABLE_MODELS,
          initialValue: config.model || "gpt-5.2",
        });

        if (p.isCancel(model)) {
          continue;
        }

        updates.model = model as string;
        break;
      }

      case "reasoning": {
        const reasoning = await p.select({
          message: "Select reasoning effort level:",
          options: REASONING_LEVELS,
          initialValue: config.reasoningEffort || "low",
        });

        if (p.isCancel(reasoning)) {
          continue;
        }

        updates.reasoningEffort = reasoning as ReasoningEffort;

        // Warn if using xhigh with non-pro models
        if (reasoning === "xhigh" && !config.model?.includes("pro")) {
          p.note(
            "Warning: 'xhigh' reasoning is designed for GPT-5.2 Pro.\n" +
            "Other models may not support this level.",
            "Compatibility Notice"
          );
        }
        break;
      }

      case "temperature": {
        const temperature = await p.text({
          message: "Enter temperature (0.0 - 2.0):",
          placeholder: "1",
          initialValue: String(config.temperature || 1),
          validate: (value) => {
            const num = parseFloat(value);
            if (isNaN(num)) return "Must be a number";
            if (num < 0 || num > 2) return "Must be between 0.0 and 2.0";
          },
        });

        if (p.isCancel(temperature)) {
          continue;
        }

        updates.temperature = parseFloat(temperature as string);
        break;
      }

      case "commitMode": {
        const mode = await p.select({
          message: "Default commit mode:",
          options: [
            { value: "grouped", label: "Grouped", hint: "Create multiple logical commits by default" },
            { value: "single", label: "Single", hint: "Create one commit by default" },
          ],
          initialValue: config.preferences?.commit.defaultMode || "grouped",
        });

        if (p.isCancel(mode)) {
          continue;
        }

        updates.preferences = {
          ...config.preferences,
          commit: {
            ...config.preferences?.commit,
            defaultMode: mode as "grouped" | "single",
          },
        };
        break;
      }

      case "commitStageAll": {
        const alwaysStage = await p.confirm({
          message: "Should commit always stage all changes first?",
          initialValue: config.preferences?.commit.alwaysStageAll ?? true,
        });

        if (p.isCancel(alwaysStage)) {
          continue;
        }

        updates.preferences = {
          ...config.preferences,
          commit: {
            ...config.preferences?.commit,
            alwaysStageAll: alwaysStage,
          },
        };
        break;
      }

      case "commitAutoPushOnYes": {
        const autoPush = await p.confirm({
          message: "Should `commit -y` always push automatically?",
          initialValue: config.preferences?.commit.autoPushOnYes ?? false,
        });

        if (p.isCancel(autoPush)) {
          continue;
        }

        updates.preferences = {
          ...config.preferences,
          commit: {
            ...config.preferences?.commit,
            autoPushOnYes: autoPush,
          },
        };
        break;
      }

      case "prDraft": {
        const prAsDraft = await p.confirm({
          message: "Create new pull requests as draft by default?",
          initialValue: config.preferences?.pullRequest.createAsDraft ?? true,
        });

        if (p.isCancel(prAsDraft)) {
          continue;
        }

        updates.preferences = {
          ...config.preferences,
          pullRequest: {
            ...config.preferences?.pullRequest,
            createAsDraft: prAsDraft,
          },
        };
        break;
      }

      case "apiKey": {
        const apiKey = await p.text({
          message: "Enter your OpenAI API key:",
          placeholder: "sk-...",
          validate: (value) => {
            if (!value || value.length === 0) return "API key is required";
            if (!value.startsWith("sk-")) return "API key should start with 'sk-'";
          },
        });

        if (p.isCancel(apiKey)) {
          continue;
        }

        updates.openaiApiKey = apiKey as string;
        break;
      }

      case "view": {
        p.note(
          `Config file location:\n${getConfigLocation()}\n\n` +
          `You can edit this file directly with your favorite editor.`,
          "Configuration File"
        );
        continue;
      }

      case "reset": {
        const confirm = await p.confirm({
          message: "Reset all settings to defaults? (API key and GitHub token will be kept)",
          initialValue: false,
        });

        if (p.isCancel(confirm) || !confirm) {
          continue;
        }

        await updateConfig({
          openaiApiKey: config.openaiApiKey, // Keep API key
          githubToken: config.githubToken, // Keep GitHub token
          model: "gpt-5.2",
          temperature: 1,
          reasoningEffort: "low",
          preferences: {
            commit: {
              alwaysStageAll: true,
              defaultMode: "grouped",
              autoPushOnYes: false,
            },
            pullRequest: {
              createAsDraft: true,
            },
          },
        });

        p.note("Settings have been reset to defaults", "✓ Reset Complete");
        await showCurrentConfig();
        continue;
      }
    }

    // Save updates
    if (Object.keys(updates).length > 0) {
      const spinner = new Spinner();
      spinner.start("Saving settings...");

      await updateConfig(updates);

      spinner.stop("Settings saved!");

      // Show updated config
      await showCurrentConfig();
    }
  }
}
