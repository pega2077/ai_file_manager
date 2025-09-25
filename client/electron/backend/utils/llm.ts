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

export type LlmMessage = OllamaMessage; // role + string content

export type LlmTask = "chat" | "embed" | "vision";

export function getActiveProvider(): "ollama" | "openai" | "azure-openai" {
  const cfg = configManager.getConfig();
  const p = cfg.llmProvider || "ollama";
  return p === "openai" || p === "azure-openai" ? p : "ollama";
}

export function getActiveModelName(task: LlmTask): string {
  const cfg = configManager.getConfig();
  const provider = getActiveProvider();
  if (provider === "openai" || provider === "azure-openai") {
    if (task === "embed") return cfg.openaiEmbedModel || "";
    if (task === "vision") return cfg.openaiVisionModel || cfg.openaiModel || "";
    return cfg.openaiModel || "";
  }
  // default to ollama
  if (task === "embed") return cfg.ollamaEmbedModel || "";
  if (task === "vision") return cfg.ollamaVisionModel || cfg.ollamaModel || "";
  return cfg.ollamaModel || "";
}

export async function embedText(inputs: string[], overrideModel?: string): Promise<number[][]> {
  const provider = getActiveProvider();
  if (provider === "openai" || provider === "azure-openai") {
    return embedWithOpenAI(inputs, overrideModel);
  }
  return embedWithOllama(inputs, overrideModel);
}

export async function generateStructuredJson(
  messages: LlmMessage[],
  responseFormat?: StructuredResponseFormat,
  temperature = 0.7,
  maxTokens = 3000,
  overrideModel = "",
  lang?: SupportedLang
): Promise<unknown> {
  const provider = getActiveProvider();
  if (provider === "openai" || provider === "azure-openai") {
    // Map to OpenAI message format (string content only)
    const oaMessages = messages.map((m) => ({ role: m.role, content: m.content }));
    const schema = responseFormat?.json_schema?.schema as Record<string, unknown> | undefined;
    return generateStructuredJsonWithOpenAI(oaMessages, schema, temperature, maxTokens, overrideModel || undefined);
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
  const imgs = Array.isArray(imageBase64) ? imageBase64 : [imageBase64];
  return describeImageWithOllama(imgs, {
    prompt: options?.prompt,
    overrideModel: options?.overrideModel,
    timeoutMs: options?.timeoutMs,
  });
}
