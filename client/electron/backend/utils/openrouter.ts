// OpenRouter utility wrapper (OpenAI-compatible for chat; external endpoint for embeddings)
// Configuration:
// - Set `openrouter.openrouterApiKey` and optional `openrouter.openrouterEndpoint` in config.json,
//   or provide env `OPENROUTER_API_KEY`.
// - Default chat base endpoint: https://openrouter.ai/api/v1
// - Embeddings use a separate endpoint with Ollama-compatible format: see `openrouter.openrouterEmbedEndpoint`.
import { configManager } from "../../configManager";
import { logger } from "../../logger";
import { httpPostJson } from "./httpClient";
import type {
  ChatCompletionMessageParam,
  ChatCompletionContentPart,
} from "openai/resources/chat/completions";

type ChatCompletionTextContentPart = Extract<ChatCompletionContentPart, { type: "text" }>;

function isTextContentPart(part: ChatCompletionContentPart): part is ChatCompletionTextContentPart {
  return part.type === "text" && typeof (part as ChatCompletionTextContentPart).text === "string";
}

// Ensure JSON Schema compatibility for providers requiring additionalProperties=false
export function normalizeJsonSchema<T>(input: T): T {
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

interface OpenRouterResolvedConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  headers: Record<string, string>;
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_REFERER = "https://github.com/pega2077/ai_file_manager";
const DEFAULT_TITLE = "AI File Manager";

function resolveOpenRouterConfig(): OpenRouterResolvedConfig {
  const cfg = configManager.getConfig();
  const oc = cfg.openrouter || {};
  const apiKey = ((oc.openrouterApiKey) || process.env.OPENROUTER_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("OpenRouter API key is not configured. Set in config.json or OPENROUTER_API_KEY env.");
  }

  const baseUrl = (typeof oc.openrouterEndpoint === "string" && oc.openrouterEndpoint.trim()
    ? oc.openrouterEndpoint
    : DEFAULT_BASE_URL).replace(/\/$/, "");

  const timeoutCandidate = [oc.openrouterTimeoutMs, oc.requestTimeoutMs, oc.timeoutMs]
    .map((value) => {
      if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
      }
      return value;
    })
    .find((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);

  const timeoutMs = timeoutCandidate ?? DEFAULT_TIMEOUT_MS;

  const headers: Record<string, string> = {
    "HTTP-Referer": DEFAULT_REFERER,
    "X-Title": DEFAULT_TITLE,
  };

  if (typeof oc.openrouterReferer === "string" && oc.openrouterReferer.trim()) {
    headers["HTTP-Referer"] = oc.openrouterReferer.trim();
  }
  if (typeof oc.openrouterTitle === "string" && oc.openrouterTitle.trim()) {
    headers["X-Title"] = oc.openrouterTitle.trim();
  }
  if (oc.openrouterHeaders && typeof oc.openrouterHeaders === "object") {
    for (const [key, value] of Object.entries(oc.openrouterHeaders)) {
      if (typeof value === "string" && value.trim()) {
        headers[key] = value.trim();
      }
    }
  }

  return { apiKey, baseUrl, timeoutMs, headers };
}

interface OpenRouterChatCompletionResponseChoice {
  message?: {
    role?: string;
    content?: string | ChatCompletionContentPart[];
  };
}

interface OpenRouterChatCompletionResponse {
  choices?: OpenRouterChatCompletionResponseChoice[];
  error?: {
    message?: string;
  };
}

async function postOpenRouterJson<T>(
  path: string,
  body: unknown,
  overrideTimeoutMs?: number
): Promise<T> {
  const { apiKey, baseUrl, timeoutMs, headers } = resolveOpenRouterConfig();
  const url = path.startsWith("http") ? path : `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const controller = new AbortController();
  const effectiveTimeout = typeof overrideTimeoutMs === "number" && overrideTimeoutMs > 0
    ? overrideTimeoutMs
    : timeoutMs;
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const rawText = await response.text();
    if (!response.ok) {
      let errorMessage = `OpenRouter request failed with status ${response.status}`;
      try {
        const parsed = rawText ? JSON.parse(rawText) as { error?: { message?: string } } : undefined;
        if (parsed?.error?.message) {
          errorMessage = parsed.error.message;
        }
      } catch {
        // Ignore JSON parse errors for error payload
      }
      logger.error("OpenRouter request failed", { url, status: response.status, message: errorMessage });
      throw new Error(errorMessage);
    }

    if (!rawText) {
      return {} as T;
    }

    try {
      return JSON.parse(rawText) as T;
    } catch (parseError) {
      logger.error("OpenRouter response parsing failed", {
        url,
        message: (parseError as Error).message,
      });
      throw new Error("Invalid JSON response from OpenRouter");
    }
  } catch (error) {
    const err = error as Error;
    if (err.name === "AbortError") {
      logger.error("OpenRouter request timed out", { url, timeoutMs: effectiveTimeout });
      throw new Error("OpenRouter request timed out");
    }
    logger.error("OpenRouter request error", { url, message: err.message });
    throw err;
  } finally {
    clearTimeout(timer);
  }
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
  try {
    const normalizedSchema = schema ? (normalizeJsonSchema(schema) as Record<string, unknown>) : undefined;
    const payload = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      response_format: normalizedSchema
        ? { type: "json_schema", json_schema: { name: "schema", schema: normalizedSchema, strict: true } }
        : { type: "json_object" },
    };
    const resp = await postOpenRouterJson<OpenRouterChatCompletionResponse>("/chat/completions", payload);

    const choice = resp.choices?.[0]?.message;
    const content = choice?.content;
    const text = Array.isArray(content)
      ? content.filter(isTextContentPart).map((part) => part.text).join("\n")
      : typeof content === "string"
        ? content
        : "";

    if (!text) {
      throw new Error("Empty response returned from OpenRouter");
    }
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
  try {
    const content: ChatCompletionContentPart[] = [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
    ];
    const payload = {
      model,
      messages: [
        { role: "user", content },
      ],
      temperature: 0.2,
      max_tokens: typeof maxTokens === "number" && maxTokens > 0 ? maxTokens : 800,
    };

    const resp = await postOpenRouterJson<OpenRouterChatCompletionResponse>("/chat/completions", payload);
    const message = resp.choices?.[0]?.message;
    const contentValue = message?.content;
    if (Array.isArray(contentValue)) {
      const textParts = contentValue.filter(isTextContentPart).map((part) => part.text);
      if (textParts.length > 0) {
        return textParts.join("\n");
      }
    } else if (typeof contentValue === "string") {
      return contentValue;
    }
    throw new Error("OpenRouter vision model returned empty content");
  } catch (e) {
    logger.error("describeImageWithOpenRouter failed", e as unknown);
    throw e;
  }
}
