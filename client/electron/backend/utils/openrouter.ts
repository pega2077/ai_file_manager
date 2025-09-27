// OpenRouter utility wrapper (OpenAI-compatible for chat; external endpoint for embeddings)
// Configuration:
// - Set `openrouter.openrouterApiKey` and optional `openrouter.openrouterEndpoint` in config.json,
//   or provide env `OPENROUTER_API_KEY`.
// - Default chat base endpoint: https://openrouter.ai/api/v1
// - Embeddings use a separate endpoint with Ollama-compatible format: see `openrouter.openrouterEmbedEndpoint`.
import OpenAI from "openai";
import { configManager } from "../../configManager";
import { logger } from "../../logger";
import { httpPostJson } from "./httpClient";
import type {
  ChatCompletionMessageParam,
  ChatCompletionContentPart,
} from "openai/resources/chat/completions";

// Ensure JSON Schema compatibility for providers requiring additionalProperties=false
function normalizeJsonSchema<T>(input: T): T {
  // Recursively enforce additionalProperties: false for all object type schemas
  const seen = new WeakSet<object>();
  function walk(node: unknown): unknown {
    if (!node || typeof node !== "object") return node;
    if (seen.has(node as object)) return node;
    seen.add(node as object);

    const n = node as Record<string, unknown>;
    const typeVal = typeof n.type === "string" ? String(n.type).toLowerCase() : undefined;

    // If this is a schema object with type === 'object', ensure additionalProperties is false
    if (typeVal === "object") {
      if (!Object.prototype.hasOwnProperty.call(n, "additionalProperties")) {
        (n as Record<string, unknown>).additionalProperties = false;
      }
      // Recurse into properties
      if (n.properties && typeof n.properties === "object") {
        const props = n.properties as Record<string, unknown>;
        for (const key of Object.keys(props)) {
          props[key] = walk(props[key]);
        }
      }
      // Recurse into patternProperties if present
      if (n.patternProperties && typeof n.patternProperties === "object") {
        const pprops = n.patternProperties as Record<string, unknown>;
        for (const key of Object.keys(pprops)) {
          pprops[key] = walk(pprops[key]);
        }
      }
      // Handle required (leave as-is)
    }

    // If this is an array schema, recurse into items
    if (typeVal === "array") {
      if (n.items) (n as Record<string, unknown>).items = walk(n.items);
    }

    // Common composition keywords
    for (const k of ["allOf", "anyOf", "oneOf", "not", "if", "then", "else"]) {
      const v = n[k as keyof typeof n];
      if (v) {
        if (Array.isArray(v)) (n as Record<string, unknown>)[k] = v.map((s) => walk(s));
        else (n as Record<string, unknown>)[k] = walk(v);
      }
    }
    // Definitions and $defs
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
    // Clone to avoid mutating caller schema
    const clone = JSON.parse(JSON.stringify(input)) as unknown;
    return walk(clone) as T;
  } catch {
    return input;
  }
}

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

// Embedding request/response types aligned with Ollama /api/embed
export interface OpenRouterEmbedRequest { input: string | string[]; model?: string }
export interface OpenRouterEmbedResponse { model?: string; embeddings: number[][] }

export async function embedWithOpenRouter(inputs: string[] | string, overrideModel?: string): Promise<number[][]> {
  const arr = Array.isArray(inputs) ? inputs : [inputs];
  if (arr.length === 0) return [];
  const cfg = configManager.getConfig();
  const oc = cfg.openrouter || {};
  const endpoint = (oc.openrouterEmbedEndpoint || "https://embed.pegamob.com").replace(/\/$/, "");
  const url = `${endpoint}/api/embed`;
  const model = overrideModel || oc.openrouterEmbedModel || "all-MiniLM-L6-v2";
  const payload: OpenRouterEmbedRequest = { model, input: Array.isArray(inputs) ? inputs : inputs };
  const token = (oc.openrouterEmbedKey || "").trim() || undefined;
  const resp = await httpPostJson<OpenRouterEmbedResponse>(
    url,
    payload,
    { Accept: "application/json" },
    60000,
    token
  );
  if (!resp.ok || !resp.data) {
    const msg = resp.error?.message || `Failed embedding via OpenRouter embed endpoint: HTTP ${resp.status}`;
    logger.error("embedWithOpenRouter failed", msg);
    throw new Error(msg);
  }
  const embeddings = resp.data.embeddings;
  if (!embeddings || !Array.isArray(embeddings)) {
    throw new Error("Invalid embedding response from OpenRouter embed endpoint");
  }
  return embeddings;
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
    logger.error("generateStructuredJsonWithOpenRouter failed", e as unknown);
    throw e;
  }
}

export async function describeImageWithOpenRouter(
  imageBase64: string,
  prompt = "What is in this picture? Describe it in detail.",
  overrideModel?: string,
  maxTokens?: number
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
      max_tokens: typeof maxTokens === 'number' && maxTokens > 0 ? maxTokens : 800,
    });
    const out = resp.choices?.[0]?.message?.content || "";
    return out;
  } catch (e) {
    logger.error("describeImageWithOpenRouter failed", e as unknown);
    throw e;
  }
}
