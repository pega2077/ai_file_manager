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

// Ensure JSON Schema compatibility for providers that require additionalProperties=false
function normalizeJsonSchema<T>(input: T): T {
  const seen = new WeakSet<object>();
  function walk(node: unknown): unknown {
    if (!node || typeof node !== "object") return node;
    if (seen.has(node as object)) return node;
    seen.add(node as object);

    const n = node as Record<string, unknown>;
    const typeVal = typeof n.type === "string" ? String(n.type).toLowerCase() : undefined;

    if (typeVal === "object") {
      if (!Object.prototype.hasOwnProperty.call(n, "additionalProperties")) {
        (n as Record<string, unknown>).additionalProperties = false;
      }
      if (n.properties && typeof n.properties === "object") {
        const props = n.properties as Record<string, unknown>;
        for (const key of Object.keys(props)) {
          props[key] = walk(props[key]);
        }
      }
      if (n.patternProperties && typeof n.patternProperties === "object") {
        const pprops = n.patternProperties as Record<string, unknown>;
        for (const key of Object.keys(pprops)) {
          pprops[key] = walk(pprops[key]);
        }
      }
    }

    if (typeVal === "array") {
      if (n.items) (n as Record<string, unknown>).items = walk(n.items);
    }

    for (const k of ["allOf", "anyOf", "oneOf", "not", "if", "then", "else"]) {
      const v = n[k as keyof typeof n];
      if (v) {
        if (Array.isArray(v)) (n as Record<string, unknown>)[k] = v.map((s) => walk(s));
        else (n as Record<string, unknown>)[k] = walk(v);
      }
    }
    for (const k of ["definitions", "$defs"]) {
      const v = n[k as keyof typeof n];
      if (v && typeof v === "object") {
        const defs = v as Record<string, unknown>;
        for (const key of Object.keys(defs)) {
          defs[key] = walk(defs[key]);
        }
      }
    }
    return n;
  }
  try {
    const clone = JSON.parse(JSON.stringify(input)) as unknown;
    return walk(clone) as T;
  } catch {
    return input;
  }
}

function getClient() {
  const cfg = configManager.getConfig();
  const oc = cfg.openai || {};
  const apiKey = ((oc.openaiApiKey || cfg.openaiApiKey) || process.env.OPENAI_API_KEY || "").trim();
  const baseURL = ((oc.openaiEndpoint || cfg.openaiEndpoint) || "https://api.openai.com/v1").replace(/\/$/, "");
  if (!apiKey) {
    throw new Error("OpenAI API key is not configured. Set in config.json or OPENAI_API_KEY env.");
  }
  return new OpenAI({ apiKey, baseURL });
}

export async function embedWithOpenAI(inputs: string[], overrideModel?: string): Promise<number[][]> {
  if (!Array.isArray(inputs) || inputs.length === 0) return [];
  const cfg = configManager.getConfig();
  const oc = cfg.openai || {};
  const model = overrideModel || oc.openaiEmbedModel || cfg.openaiEmbedModel || "text-embedding-3-large";
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
  const oc = cfg.openai || {};
  const model = overrideModel || oc.openaiModel || cfg.openaiModel || "gpt-4o-mini";
  const client = getClient();
  try {
    const normalizedSchema = schema ? (normalizeJsonSchema(schema) as Record<string, unknown>) : undefined;
    const resp = await client.chat.completions.create({
      model,
      temperature,
      max_tokens: maxTokens,
      messages,
      response_format: normalizedSchema
        ? { type: "json_schema", json_schema: { name: "schema", schema: normalizedSchema, strict: true } }
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
  overrideModel?: string,
  maxTokens?: number
): Promise<string> {
  const cfg = configManager.getConfig();
  const oc = cfg.openai || {};
  const model = overrideModel || oc.openaiVisionModel || oc.openaiModel || cfg.openaiVisionModel || cfg.openaiModel || "gpt-4o-mini";
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
      max_tokens: typeof maxTokens === 'number' && maxTokens > 0 ? maxTokens : 800,
    });
    const out = resp.choices?.[0]?.message?.content || "";
    return out;
  } catch (e) {
    logger.error("describeImageWithOpenAI failed", e as unknown);
    throw e;
  }
}
