import { type LLMProvider } from "./config.ts";

export interface ProviderModelInfo {
  id: string;
  label: string;
  hint?: string;
}

function normalizeBaseUrl(provider: LLMProvider, baseUrl?: string): string {
  if (baseUrl && baseUrl.trim()) {
    return baseUrl.replace(/\/$/, "");
  }

  if (provider === "openai") return "https://api.openai.com/v1";
  if (provider === "gemini") return "https://generativelanguage.googleapis.com";
  return "https://api.anthropic.com";
}

function uniqueSorted(items: ProviderModelInfo[]): ProviderModelInfo[] {
  const seen = new Set<string>();
  const out: ProviderModelInfo[] = [];

  for (const item of items) {
    if (!item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }

  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = 15000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} ${response.statusText}${text ? `: ${text.slice(0, 240)}` : ""}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOpenAIModels(apiKey: string, baseUrl?: string): Promise<ProviderModelInfo[]> {
  const root = normalizeBaseUrl("openai", baseUrl);
  const data = await fetchJson(`${root}/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  const models = Array.isArray(data?.data) ? data.data : [];
  return uniqueSorted(
    models
      .map((m: any) => ({ id: String(m?.id || ""), label: String(m?.id || "") }))
      .filter((m: ProviderModelInfo) => m.id.length > 0)
  );
}

async function fetchGeminiModels(apiKey: string, baseUrl?: string): Promise<ProviderModelInfo[]> {
  const root = normalizeBaseUrl("gemini", baseUrl);
  const url = `${root}/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const data = await fetchJson(url, { method: "GET" });
  const models = Array.isArray(data?.models) ? data.models : [];

  return uniqueSorted(
    models
      .map((m: any) => {
        const rawName = String(m?.name || "");
        const id = rawName.startsWith("models/") ? rawName.slice("models/".length) : rawName;
        const methods = Array.isArray(m?.supportedGenerationMethods)
          ? m.supportedGenerationMethods.map((x: unknown) => String(x)).join(", ")
          : "";
        return {
          id,
          label: id,
          hint: methods || undefined,
        };
      })
      .filter((m: ProviderModelInfo) => m.id.length > 0)
  );
}

async function fetchAnthropicModels(apiKey: string, baseUrl?: string): Promise<ProviderModelInfo[]> {
  const root = normalizeBaseUrl("anthropic", baseUrl);
  const data = await fetchJson(`${root}/v1/models`, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
  });

  const models = Array.isArray(data?.data) ? data.data : [];
  return uniqueSorted(
    models
      .map((m: any) => {
        const id = String(m?.id || "");
        const displayName = String(m?.display_name || id);
        return {
          id,
          label: id,
          hint: displayName !== id ? displayName : undefined,
        };
      })
      .filter((m: ProviderModelInfo) => m.id.length > 0)
  );
}

export async function discoverProviderModels(
  provider: LLMProvider,
  apiKey: string,
  baseUrl?: string
): Promise<ProviderModelInfo[]> {
  if (!apiKey || !apiKey.trim()) {
    throw new Error(`Missing API key for provider '${provider}'`);
  }

  if (provider === "openai") {
    return fetchOpenAIModels(apiKey, baseUrl);
  }
  if (provider === "gemini") {
    return fetchGeminiModels(apiKey, baseUrl);
  }
  return fetchAnthropicModels(apiKey, baseUrl);
}

export function getDefaultProviderBaseUrl(provider: LLMProvider): string {
  return normalizeBaseUrl(provider);
}

export function getDefaultProviderApiKeyEnv(provider: LLMProvider): string {
  if (provider === "openai") return "OPENAI_API_KEY";
  if (provider === "gemini") return "GEMINI_API_KEY";
  return "ANTHROPIC_API_KEY";
}
