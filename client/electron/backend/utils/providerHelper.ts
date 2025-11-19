import type { Response } from "express";
import type { ProviderName } from "./llm";

export const SUPPORTED_PROVIDER_NAMES: readonly ProviderName[] = [
  "openai",
  "azure-openai",
  "openrouter",
  "bailian",
  "ollama",
  "pega",
  "llamacpp",
] as const;

const PROVIDER_ALIAS_MAP: Record<string, ProviderName> = {
  openai: "openai",
  "azure-openai": "azure-openai",
  azure: "azure-openai",
  azure_openai: "azure-openai",
  openrouter: "openrouter",
  bailian: "bailian",
  aliyun: "bailian",
  dashscope: "bailian",
  ollama: "ollama",
  pega: "pega",
  llamacpp: "llamacpp",
  "llama-cpp": "llamacpp",
  "llama_cpp": "llamacpp",
};

export function normalizeProviderName(raw: unknown): ProviderName | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return PROVIDER_ALIAS_MAP[normalized];
}

export function isProviderValueProvided(raw: unknown): raw is string {
  return typeof raw === "string" && raw.trim().length > 0;
}

export function respondWithInvalidProvider(res: Response, raw: unknown): void {
  const providedValue = typeof raw === "string" ? raw.trim() : null;
  res.status(400).json({
    success: false,
    message: "invalid_provider",
    data: null,
    error: {
      code: "INVALID_PROVIDER",
      message: "Unsupported provider specified",
      details: {
        provider: providedValue,
        supported_providers: SUPPORTED_PROVIDER_NAMES,
      },
    },
    timestamp: new Date().toISOString(),
    request_id: "",
  });
}
