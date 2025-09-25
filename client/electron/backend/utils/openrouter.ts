// OpenRouter utility wrapper (OpenAI-compatible)
// Configuration:
// - Set `openrouter.openrouterApiKey` and optional `openrouter.openrouterEndpoint` in config.json,
//   or provide env `OPENROUTER_API_KEY`.
// - Default endpoint: https://openrouter.ai/api/v1
// - Models are configurable via ConfigManager: `openrouterModel`, `openrouterEmbedModel`, `openrouterVisionModel`.
import OpenAI from "openai";
import { configManager } from "../../configManager";
import { logger } from "../../logger";
import type {
  ChatCompletionMessageParam,
  ChatCompletionContentPart,
} from "openai/resources/chat/completions";

function getClient() {
  const cfg = configManager.getConfig();
  const oc = cfg.openrouter || {};
  const apiKey = ((oc.openrouterApiKey) || process.env.OPENROUTER_API_KEY || "").trim();
  const baseURL = (oc.openrouterEndpoint || "https://openrouter.ai/api/v1").replace(/\/$/, "");
  if (!apiKey) {
    throw new Error("OpenRouter API key is not configured. Set in config.json or OPENROUTER_API_KEY env.");
  }
  // OpenRouter requires a specific HTTP header for UA according to docs; optional here.
  return new OpenAI({ apiKey, baseURL, defaultHeaders: { "HTTP-Referer": "https://github.com/pega2077/ai_file_manager", "X-Title": "AI File Manager" } });
}

export async function embedWithOpenRouter(inputs: string[], overrideModel?: string): Promise<number[][]> {
  if (!Array.isArray(inputs) || inputs.length === 0) return [];
  const cfg = configManager.getConfig();
  const oc = cfg.openrouter || {};
  const model = overrideModel || oc.openrouterEmbedModel || oc.openrouterModel || "text-embedding-3-large";
  const client = getClient();
  try {
    const resp = await client.embeddings.create({ model, input: inputs });
    return resp.data.map((d) => d.embedding as number[]);
  } catch (e) {
    logger.error("embedWithOpenRouter failed", e as unknown);
    throw e;
  }
}

export async function generateStructuredJsonWithOpenRouter(
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
  const oc = cfg.openrouter || {};
  const model = overrideModel || oc.openrouterModel || "openrouter/auto";
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
    logger.error("generateStructuredJsonWithOpenRouter failed", e as unknown);
    throw e;
  }
}

export async function describeImageWithOpenRouter(
  imageBase64: string,
  prompt = "What is in this picture? Describe it in detail.",
  overrideModel?: string
): Promise<string> {
  const cfg = configManager.getConfig();
  const oc = cfg.openrouter || {};
  const model = overrideModel || oc.openrouterVisionModel || oc.openrouterModel || "gpt-4o-mini";
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
    logger.error("describeImageWithOpenRouter failed", e as unknown);
    throw e;
  }
}
