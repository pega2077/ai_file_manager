import { configManager } from "../../configManager";
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
  embedWithOpenRouter,
} from "./openrouter";
import {
  embedWithBailian,
  generateStructuredJsonWithBailian,
  describeImageWithBailian,
} from "./bailian";

export type LlmMessage = OllamaMessage; // role + string content

export type LlmTask = "chat" | "embed" | "vision";

export type ProviderName = "ollama" | "openai" | "azure-openai" | "openrouter" | "bailian";

export function getActiveProvider(): ProviderName {
  const cfg = configManager.getConfig();
  const p = cfg.llmProvider || "ollama";
  if (p === "openai" || p === "azure-openai" || p === "openrouter" || p === "bailian") {
    return p;
  }
  return "ollama";
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
    // Embedding for OpenRouter uses separate endpoint; still expose model for UI/readouts
    if (task === "embed") return oc.openrouterEmbedModel || "";
    if (task === "vision") return oc.openrouterVisionModel || oc.openrouterModel || "";
    return oc.openrouterModel || "";
  }
  if (provider === "bailian") {
    const bc = cfg.bailian || {};
    if (task === "embed") return bc.bailianEmbedModel || cfg.bailianEmbedModel || "";
    if (task === "vision") return bc.bailianVisionModel || bc.bailianModel || cfg.bailianVisionModel || cfg.bailianModel || "";
    return bc.bailianModel || cfg.bailianModel || "";
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
    return embedWithOpenRouter(inputs, overrideModel);
  }
  if (provider === "bailian") {
    return embedWithBailian(inputs, overrideModel);
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
  if (provider === "bailian") {
    const oaMessages = messages.map((m) => ({ role: m.role, content: m.content }));
    const schema = responseFormat?.json_schema?.schema as Record<string, unknown> | undefined;
    return generateStructuredJsonWithBailian(oaMessages, schema, temperature, maxTokens, overrideModel || undefined);
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
  if (provider === "bailian") {
    const img = Array.isArray(imageBase64) ? imageBase64[0] : imageBase64;
    return describeImageWithBailian(img, options?.prompt, options?.overrideModel, options?.timeoutMs);
  }
  const imgs = Array.isArray(imageBase64) ? imageBase64 : [imageBase64];
  return describeImageWithOllama(imgs, {
    prompt: options?.prompt,
    overrideModel: options?.overrideModel,
    timeoutMs: options?.timeoutMs,
  });
}
