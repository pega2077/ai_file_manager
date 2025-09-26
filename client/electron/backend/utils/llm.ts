import { configManager } from "../../configManager";
import { logger } from "../../logger";
import type { SupportedLang } from "./promptHelper";
import {
  generateStructuredJsonWithOllama,
  describeImageWithOllama,
  embedWithOllama,
  type StructuredResponseFormat,
  type OllamaMessage,
} from "./ollama";
import {
  embedWithOpenAI,
  generateStructuredJsonWithOpenAI,
  describeImageWithOpenAI,
} from "./openai";
import {
  generateStructuredJsonWithOpenRouter,
  describeImageWithOpenRouter,
} from "./openrouter";

export type LlmMessage = OllamaMessage; // role + string content

export type LlmTask = "chat" | "embed" | "vision";

export type ProviderName = "ollama" | "openai" | "azure-openai" | "openrouter";

export function getActiveProvider(): ProviderName {
  const cfg = configManager.getConfig();
  const p = cfg.llmProvider || "ollama";
  return p === "openai" || p === "azure-openai" || p === "openrouter" ? p : "ollama";
}

export function getActiveModelName(task: LlmTask, providerOverride?: ProviderName): string {
  const cfg = configManager.getConfig();
  const provider = providerOverride || getActiveProvider();
  if (provider === "openai" || provider === "azure-openai") {
    const oc = cfg.openai || {};
    if (task === "embed") return oc.openaiEmbedModel || cfg.openaiEmbedModel || "";
    if (task === "vision") return oc.openaiVisionModel || oc.openaiModel || cfg.openaiVisionModel || cfg.openaiModel || "";
    return oc.openaiModel || cfg.openaiModel || "";
  }
  if (provider === "openrouter") {
    const oc = cfg.openrouter || {};
    if (task === "embed") return oc.openrouterEmbedModel || oc.openrouterModel || "";
    if (task === "vision") return oc.openrouterVisionModel || oc.openrouterModel || "";
    return oc.openrouterModel || "";
  }
  // default to ollama
  const oc = cfg.ollama || {};
  if (task === "embed") return oc.ollamaEmbedModel || cfg.ollamaEmbedModel || "";
  if (task === "vision") return oc.ollamaVisionModel || oc.ollamaModel || cfg.ollamaVisionModel || cfg.ollamaModel || "";
  return oc.ollamaModel || cfg.ollamaModel || "";
}

export async function embedText(inputs: string[], overrideModel?: string): Promise<number[][]> {
  const provider = getActiveProvider();
  if (provider === "openai" || provider === "azure-openai") {
    return embedWithOpenAI(inputs, overrideModel);
  }
  if (provider === "openrouter") {
    // OpenRouter does not currently support embeddings reliably; fall back to Ollama embeddings
    // logger.warn("OpenRouter embeddings not supported; falling back to Ollama embedding model");
    return embedWithOllama(inputs, overrideModel);
  }
  return embedWithOllama(inputs, overrideModel);
}

export async function generateStructuredJson(
  messages: LlmMessage[],
  responseFormat?: StructuredResponseFormat,
  temperature = 0.7,
  maxTokens = 3000,
  overrideModel = "",
  lang?: SupportedLang,
  providerOverride?: ProviderName
): Promise<unknown> {
  const provider = providerOverride || getActiveProvider();
  if (provider === "openai" || provider === "azure-openai") {
    // Map to OpenAI message format (string content only)
    const oaMessages = messages.map((m) => ({ role: m.role, content: m.content }));
    const schema = responseFormat?.json_schema?.schema as Record<string, unknown> | undefined;
    return generateStructuredJsonWithOpenAI(oaMessages, schema, temperature, maxTokens, overrideModel || undefined);
  }
  if (provider === "openrouter") {
    const oaMessages = messages.map((m) => ({ role: m.role, content: m.content }));
    const schema = responseFormat?.json_schema?.schema as Record<string, unknown> | undefined;
    return generateStructuredJsonWithOpenRouter(oaMessages, schema, temperature, maxTokens, overrideModel || undefined);
  }
  return generateStructuredJsonWithOllama(
    messages,
    responseFormat,
    temperature,
    maxTokens,
    overrideModel,
    lang
  );
}

export async function describeImage(
  imageBase64: string | string[],
  options?: { prompt?: string; overrideModel?: string; timeoutMs?: number }
): Promise<string> {
  const provider = getActiveProvider();
  if (provider === "openai" || provider === "azure-openai") {
    const img = Array.isArray(imageBase64) ? imageBase64[0] : imageBase64;
    return describeImageWithOpenAI(img, options?.prompt, options?.overrideModel);
  }
  if (provider === "openrouter") {
    const img = Array.isArray(imageBase64) ? imageBase64[0] : imageBase64;
    return describeImageWithOpenRouter(img, options?.prompt, options?.overrideModel);
  }
  const imgs = Array.isArray(imageBase64) ? imageBase64 : [imageBase64];
  return describeImageWithOllama(imgs, {
    prompt: options?.prompt,
    overrideModel: options?.overrideModel,
    timeoutMs: options?.timeoutMs,
  });
}
