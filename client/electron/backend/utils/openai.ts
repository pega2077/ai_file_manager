// OpenAI utility wrapper
// Configuration:
// - Set `openaiApiKey` and `openaiEndpoint` in config.json, or provide env `OPENAI_API_KEY`.
// - Default endpoint: https://api.openai.com/v1
// - Models are configurable via ConfigManager: `openaiModel`, `openaiEmbedModel`, `openaiVisionModel`.
import OpenAI from "openai";
import { configManager } from "../../configManager";
import { logger } from "../../logger";
import type {
  ChatCompletionMessageParam,
  ChatCompletionContentPart,
} from "openai/resources/chat/completions";

function getClient() {
  const cfg = configManager.getConfig();
  const apiKey = (cfg.openaiApiKey || process.env.OPENAI_API_KEY || "").trim();
  const baseURL = (cfg.openaiEndpoint || "https://api.openai.com/v1").replace(/\/$/, "");
  if (!apiKey) {
    throw new Error("OpenAI API key is not configured. Set in config.json or OPENAI_API_KEY env.");
  }
  return new OpenAI({ apiKey, baseURL });
}

export async function embedWithOpenAI(inputs: string[], overrideModel?: string): Promise<number[][]> {
  if (!Array.isArray(inputs) || inputs.length === 0) return [];
  const cfg = configManager.getConfig();
  const model = overrideModel || cfg.openaiEmbedModel || "text-embedding-3-large";
  const client = getClient();
  try {
    const resp = await client.embeddings.create({ model, input: inputs });
    return resp.data.map((d) => d.embedding as number[]);
  } catch (e) {
    logger.error("embedWithOpenAI failed", e as unknown);
    throw e;
  }
}

export async function generateStructuredJsonWithOpenAI(
  messages: ChatCompletionMessageParam[],
  schema?: Record<string, unknown>,
  temperature = 0.7,
  maxTokens = 1500,
  overrideModel?: string
): Promise<unknown> {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages are required");
  }
  const cfg = configManager.getConfig();
  const model = overrideModel || cfg.openaiModel || "gpt-4o-mini";
  const client = getClient();
  try {
    const resp = await client.chat.completions.create({
      model,
      temperature,
      max_tokens: maxTokens,
      messages,
      response_format: schema
        ? { type: "json_schema", json_schema: { name: "schema", schema, strict: true } }
        : { type: "json_object" },
    });
    const text = resp.choices?.[0]?.message?.content || "";
    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]);
      throw new Error("Model did not return valid JSON");
    }
  } catch (e) {
    logger.error("generateStructuredJsonWithOpenAI failed", e as unknown);
    throw e;
  }
}

export async function describeImageWithOpenAI(
  imageBase64: string,
  prompt = "What is in this picture? Describe it in detail.",
  overrideModel?: string
): Promise<string> {
  const cfg = configManager.getConfig();
  const model = overrideModel || cfg.openaiVisionModel || cfg.openaiModel || "gpt-4o-mini";
  const client = getClient();
  try {
    const content: ChatCompletionContentPart[] = [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
    ];
    const resp = await client.chat.completions.create({
      model,
      messages: [
        { role: "user", content },
      ],
      temperature: 0.2,
      max_tokens: 800,
    });
    const out = resp.choices?.[0]?.message?.content || "";
    return out;
  } catch (e) {
    logger.error("describeImageWithOpenAI failed", e as unknown);
    throw e;
  }
}
