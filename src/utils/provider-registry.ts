import { type LLMProvider } from "./config.ts";

export interface ProviderMeta {
  id: LLMProvider;
  label: string;
  defaultBaseUrl: string;
  defaultApiKeyEnv?: string;
  requiresApiKey: boolean;
}

const PROVIDERS: Record<LLMProvider, ProviderMeta> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultApiKeyEnv: "OPENAI_API_KEY",
    requiresApiKey: true,
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com",
    defaultApiKeyEnv: "GEMINI_API_KEY",
    requiresApiKey: true,
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    defaultApiKeyEnv: "ANTHROPIC_API_KEY",
    requiresApiKey: true,
  },
  ollama: {
    id: "ollama",
    label: "Ollama",
    defaultBaseUrl: "http://localhost:11434",
    defaultApiKeyEnv: "OLLAMA_API_KEY",
    requiresApiKey: false,
  },
  "custom-openai-compatible": {
    id: "custom-openai-compatible",
    label: "Custom (OpenAI-compatible)",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultApiKeyEnv: "OPENAI_API_KEY",
    requiresApiKey: false,
  },
};

export function getProviderMeta(provider: LLMProvider): ProviderMeta {
  return PROVIDERS[provider];
}

export function listProviders(): ProviderMeta[] {
  return Object.values(PROVIDERS);
}

export function providerRequiresApiKey(provider: LLMProvider): boolean {
  return getProviderMeta(provider).requiresApiKey;
}
