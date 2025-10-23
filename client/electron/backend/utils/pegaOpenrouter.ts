import OpenAI from "openai";
import { configManager } from "../../configManager";
import { logger } from "../../logger";
import type {
  ChatCompletionMessageParam,
  ChatCompletionContentPart,
} from "openai/resources/chat/completions";
import { normalizeJsonSchema } from "./openrouter";

interface PegaOpenRouterResolvedConfig {
  baseUrl: string;
  apiKey: string;
  chatModel?: string;
  embedModel?: string;
  visionModel?: string;
}

function resolvePegaOpenRouterConfig(): PegaOpenRouterResolvedConfig {
  const cfg = configManager.getConfig();
  const section = cfg.pega ?? {};
  const baseUrl = (section.pegaEndpoint || cfg.pegaEndpoint || "").replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("Pega endpoint not configured");
  }
  const apiKey = (
    section.pegaApiKey ||
    cfg.pegaApiKey ||
    section.pegaAuthToken ||
    cfg.pegaAuthToken ||
    ""
  ).trim();
  if (!apiKey) {
    throw new Error("Pega API key is not configured");
  }
  return {
    baseUrl,
    apiKey,
    chatModel:
      section.pegaOpenrouterModel ||
      (section.pegaMode === "openrouter" ? section.pegaModel : undefined) ||
      cfg.pegaOpenrouterModel ||
      (cfg.pegaMode === "openrouter" ? cfg.pegaModel : undefined) ||
      section.pegaModel ||
      cfg.pegaModel,
    embedModel: section.pegaEmbedModel || cfg.pegaEmbedModel,
    visionModel:
      section.pegaOpenrouterVisionModel ||
      (section.pegaMode === "openrouter" ? section.pegaVisionModel : undefined) ||
      cfg.pegaOpenrouterVisionModel ||
      (cfg.pegaMode === "openrouter" ? cfg.pegaVisionModel : undefined) ||
      section.pegaVisionModel ||
      cfg.pegaVisionModel,
  };
}

function createClient(resolved: PegaOpenRouterResolvedConfig): OpenAI {
  return new OpenAI({
    apiKey: resolved.apiKey,
    baseURL: `${resolved.baseUrl}/openrouter`,
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/pega2077/ai_file_manager",
      "X-Title": "AI File Manager",
    },
  });
}

export async function embedWithPegaOpenRouter(
  inputs: string[] | string,
  overrideModel?: string
): Promise<number[][]> {
  const payload = Array.isArray(inputs) ? inputs : [inputs];
  if (payload.length === 0) {
    return [];
  }
  const resolved = resolvePegaOpenRouterConfig();
  const client = createClient(resolved);
  const model = overrideModel || resolved.embedModel || resolved.chatModel;
  if (!model) {
    throw new Error("Pega embedding model not configured");
  }
  try {
    const response = await client.embeddings.create({
      model,
      input: payload,
    });
    return response.data.map((item) => item.embedding);
  } catch (error) {
    logger.error("Pega OpenRouter embeddings failed", error as unknown);
    throw error;
  }
}

export async function generateStructuredJsonWithPegaOpenRouter(
  messages: ChatCompletionMessageParam[],
  schema?: Record<string, unknown>,
  temperature = 0.7,
  maxTokens = 1500,
  overrideModel?: string
): Promise<unknown> {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages are required");
  }
  const resolved = resolvePegaOpenRouterConfig();
  const client = createClient(resolved);
  const model = overrideModel || resolved.chatModel;
  if (!model) {
    throw new Error("Pega chat model not configured");
  }
  try {
    const normalizedSchema = schema
      ? (normalizeJsonSchema(schema) as Record<string, unknown>)
      : undefined;
    const response = await client.chat.completions.create({
      model,
      temperature,
      max_tokens: maxTokens,
      messages,
      response_format: normalizedSchema
        ? { type: "json_schema", json_schema: { name: "schema", schema: normalizedSchema, strict: true } }
        : { type: "json_object" },
    });
    const text = response.choices?.[0]?.message?.content || "";
    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (match) {
        return JSON.parse(match[0]);
      }
      throw new Error("Model did not return valid JSON");
    }
  } catch (error) {
    logger.error("Pega OpenRouter structured JSON failed", error as unknown);
    throw error;
  }
}

export async function describeImageWithPegaOpenRouter(
  imageBase64: string,
  prompt = "What is in this picture? Describe it in detail.",
  overrideModel?: string,
  maxTokens?: number
): Promise<string> {
  if (!imageBase64) {
    return "";
  }
  const resolved = resolvePegaOpenRouterConfig();
  const client = createClient(resolved);
  const model = overrideModel || resolved.visionModel || resolved.chatModel;
  if (!model) {
    throw new Error("Pega vision model not configured");
  }
  try {
    const content: ChatCompletionContentPart[] = [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
    ];
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content }],
      temperature: 0.2,
      max_tokens: typeof maxTokens === "number" && maxTokens > 0 ? maxTokens : 800,
    });
    return response.choices?.[0]?.message?.content || "";
  } catch (error) {
    logger.error("Pega OpenRouter vision request failed", error as unknown);
    throw error;
  }
}
