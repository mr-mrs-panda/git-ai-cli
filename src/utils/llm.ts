import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { loadConfig, type LLMProfile, type LLMTask } from "./config.ts";
import { providerRequiresApiKey } from "./provider-registry.ts";

interface InvokeOptions {
  profileName?: string;
  temperature?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
}

function getResponseText(response: any): string {
  const content = typeof response?.content === "string"
    ? response.content
    : Array.isArray(response?.content)
      ? response.content.map((c: any) => c?.text || "").join("\n")
      : "";
  return content.trim();
}

function shouldSendTemperature(profile: LLMProfile, requestedTemperature: number): boolean {
  const model = profile.model?.toLowerCase() || "";

  // Newer GPT-5 style models may reject explicit temperature.
  // In that case we rely on provider defaults.
  if (profile.provider === "openai" && model.startsWith("gpt-5")) {
    return false;
  }

  return Number.isFinite(requestedTemperature);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveApiKey(profile: LLMProfile): string | null {
  if (profile.apiKey && profile.apiKey.length > 0) {
    return profile.apiKey;
  }

  if (profile.apiKeyEnv && process.env[profile.apiKeyEnv]) {
    return process.env[profile.apiKeyEnv] || null;
  }

  return null;
}

async function createChatModel(profile: LLMProfile, opts: InvokeOptions = {}): Promise<any> {
  const modelId = profile.model?.trim();
  if (!modelId) {
    throw new Error(`Missing model for provider '${profile.provider}'. Configure it via 'git-ai settings'.`);
  }

  const apiKey = resolveApiKey(profile);
  if (!apiKey && providerRequiresApiKey(profile.provider)) {
    const envHint = profile.apiKeyEnv ? ` (set ${profile.apiKeyEnv})` : "";
    throw new Error(`Missing API key for provider '${profile.provider}'${envHint}`);
  }

  const temperature = opts.temperature ?? profile.temperature ?? 0.7;
  const maxTokens = profile.maxTokens ?? 4096;
  const reasoningEffort = opts.reasoningEffort ?? profile.reasoningEffort ?? "low";
  const includeTemperature = shouldSendTemperature(profile, temperature);

  if (profile.provider === "openai") {
    return new ChatOpenAI({
      apiKey: apiKey || "",
      model: modelId,
      ...(includeTemperature ? { temperature } : {}),
      maxTokens,
      reasoningEffort,
      configuration: profile.baseUrl ? { baseURL: profile.baseUrl } : undefined,
    } as any);
  }

  if (profile.provider === "custom-openai-compatible") {
    return new ChatOpenAI({
      ...(apiKey ? { apiKey } : {}),
      model: modelId,
      ...(includeTemperature ? { temperature } : {}),
      maxTokens,
      configuration: profile.baseUrl
        ? { baseURL: profile.baseUrl, defaultHeaders: profile.customHeaders }
        : { defaultHeaders: profile.customHeaders },
    } as any);
  }

  if (profile.provider === "gemini") {
    return new ChatGoogleGenerativeAI({
      apiKey: apiKey || "",
      model: modelId,
      ...(includeTemperature ? { temperature } : {}),
      maxOutputTokens: maxTokens,
      baseUrl: profile.baseUrl,
    } as any);
  }

  if (profile.provider === "ollama") {
    let ChatOllamaCtor: any;
    try {
      const mod = await import("@langchain/ollama");
      ChatOllamaCtor = mod.ChatOllama;
    } catch {
      throw new Error(
        "Ollama provider selected but '@langchain/ollama' is not installed. Run: bun add @langchain/ollama"
      );
    }

    return new ChatOllamaCtor({
      model: modelId,
      ...(includeTemperature ? { temperature } : {}),
      ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
    } as any);
  }

  return new ChatAnthropic({
    apiKey: apiKey || "",
    model: modelId,
    ...(includeTemperature ? { temperature } : {}),
    maxTokens,
    anthropicApiUrl: profile.baseUrl,
  } as any);
}

function shouldFallbackFromStructuredOutput(error: unknown, provider: LLMProfile["provider"]): boolean {
  if (provider !== "gemini") {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  return (
    lowered.includes("response_schema") ||
    lowered.includes("exclusiveminimum") ||
    lowered.includes("invalid json payload")
  );
}

function shouldUseJsonOnlyStructured(profile: LLMProfile): boolean {
  return profile.provider === "gemini";
}

function extractFirstJsonObject(raw: string): unknown {
  const text = raw.trim();
  if (!text) {
    throw new Error("Received empty model response");
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1]);
  }

  try {
    return JSON.parse(text);
  } catch {
    // Continue with best-effort object extraction.
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(text.slice(start, end + 1));
  }

  throw new Error("Could not find valid JSON object in model response");
}

async function invokeStructuredJsonFallback<TSchema extends z.ZodTypeAny>(
  model: any,
  prompt: string,
  schema: TSchema
): Promise<z.infer<TSchema>> {
  const jsonSchema = typeof (z as any).toJSONSchema === "function"
    ? (z as any).toJSONSchema(schema)
    : undefined;

  const fallbackPrompt = `${prompt}

Return ONLY a valid JSON object.
Do not include markdown fences.
Do not include explanations.
${jsonSchema ? `Match this JSON schema exactly:\n${JSON.stringify(jsonSchema, null, 2)}` : ""}`;

  const response = await model.invoke([new HumanMessage(fallbackPrompt)]);
  const text = getResponseText(response);
  const parsed = extractFirstJsonObject(text);
  return schema.parse(parsed);
}

async function getProfileChain(task: LLMTask, overrideProfileName?: string): Promise<Array<{ name: string; profile: LLMProfile }>> {
  const config = await loadConfig();
  const llm = config.llm;
  if (!llm) {
    throw new Error("LLM configuration missing");
  }

  const startName = overrideProfileName || llm.taskPresets[task] || llm.defaultProfile;
  const profile = llm.profiles[startName];
  if (!profile) {
    throw new Error(`LLM profile '${startName}' not found`);
  }
  if (!profile.model || profile.model.trim().length === 0) {
    throw new Error(
      `Missing model for provider '${profile.provider}'. Configure it via 'git-ai settings'.`
    );
  }
  return [{ name: startName, profile }];
}

export async function invokeText(task: LLMTask, prompt: string, opts: InvokeOptions = {}): Promise<string> {
  const config = await loadConfig();
  const attempts = Math.max(1, config.llm?.retry.maxAttempts ?? 3);
  const backoffMs = Math.max(100, config.llm?.retry.backoffMs ?? 400);
  const profiles = await getProfileChain(task, opts.profileName);

  let lastError: unknown;

  for (const candidate of profiles) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const model = createChatModel(candidate.profile, opts);
        const resolvedModel = await model;
        const response = await resolvedModel.invoke([new HumanMessage(prompt)]);
        const trimmed = getResponseText(response);
        if (!trimmed) {
          throw new Error("Received empty model response");
        }

        return trimmed;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          await sleep(backoffMs * attempt);
        }
      }
    }
  }

  throw new Error(`LLM invocation failed for task '${task}': ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function invokeStructured<TSchema extends z.ZodTypeAny>(
  task: LLMTask,
  prompt: string,
  schema: TSchema,
  opts: InvokeOptions = {}
): Promise<z.infer<TSchema>> {
  const config = await loadConfig();
  const attempts = Math.max(1, config.llm?.retry.maxAttempts ?? 3);
  const backoffMs = Math.max(100, config.llm?.retry.backoffMs ?? 400);
  const profiles = await getProfileChain(task, opts.profileName);

  let lastError: unknown;

  for (const candidate of profiles) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const model = createChatModel(candidate.profile, opts);
        const resolvedModel = await model;

        if (shouldUseJsonOnlyStructured(candidate.profile)) {
          return await invokeStructuredJsonFallback(resolvedModel, prompt, schema);
        }

        const structured = resolvedModel.withStructuredOutput(schema);
        const output = await structured.invoke([new HumanMessage(prompt)]);
        return schema.parse(output);
      } catch (error) {
        if (shouldFallbackFromStructuredOutput(error, candidate.profile.provider)) {
          try {
            const model = await createChatModel(candidate.profile, opts);
            return await invokeStructuredJsonFallback(model, prompt, schema);
          } catch (fallbackError) {
            lastError = fallbackError;
          }
        } else {
          lastError = error;
        }
        if (attempt < attempts) {
          await sleep(backoffMs * attempt);
        }
      }
    }
  }

  throw new Error(`LLM structured invocation failed for task '${task}': ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
