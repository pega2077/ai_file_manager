// OpenRouter utility wrapper (OpenAI-compatible for chat and embeddings)
// Configuration:
// - Set `openrouter.openrouterApiKey` and optional `openrouter.openrouterEndpoint` in config.json,
//   or provide env `OPENROUTER_API_KEY`.
// - Default base endpoint: https://openrouter.ai/api/v1
// - Embeddings default to the OpenRouter /embeddings API with model qwen/qwen3-embedding-0.6b.
import { configManager } from "../../configManager";
import { logger } from "../../logger";
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

interface OpenRouterErrorPayload {
  message?: string;
  code?: number | string;
  metadata?: Record<string, unknown>;
}

interface OpenRouterChatCompletionResponse {
  choices?: OpenRouterChatCompletionResponseChoice[];
  error?: OpenRouterErrorPayload;
}

async function postOpenRouterJson<T>(
  path: string,
  body: unknown,
  options?: {
    timeoutMs?: number;
    apiKeyOverride?: string;
    headers?: Record<string, string>;
  }
): Promise<T> {
  const { apiKey, baseUrl, timeoutMs, headers } = resolveOpenRouterConfig();
  const url = path.startsWith("http") ? path : `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const controller = new AbortController();
  const effectiveApiKey = options?.apiKeyOverride && options.apiKeyOverride.trim()
    ? options.apiKeyOverride.trim()
    : apiKey;
  const effectiveTimeout = typeof options?.timeoutMs === "number" && options.timeoutMs > 0
    ? options.timeoutMs
    : timeoutMs;
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${effectiveApiKey}`,
        ...headers,
        ...(options?.headers ?? {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const rawText = await response.text();
    if (!response.ok) {
      let errorMessage = `OpenRouter request failed with status ${response.status}`;
      let parsed: { error?: OpenRouterErrorPayload } | undefined;
      try {
        parsed = rawText ? JSON.parse(rawText) as { error?: OpenRouterErrorPayload } : undefined;
        if (parsed?.error?.message) {
          errorMessage = parsed.error.message;
        }
      } catch {
        // Ignore JSON parse errors for error payload
      }
      logger.error("OpenRouter request failed", {
        url,
        status: response.status,
        message: errorMessage,
        providerErrorCode: parsed?.error?.code,
        providerMetadata: parsed?.error?.metadata,
        rawResponse: rawText,
      });
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

// Embedding request/response types aligned with OpenRouter /embeddings endpoint
export interface OpenRouterEmbedRequest { input: string | string[]; model: string }
interface OpenRouterEmbedResponseData { embedding: number[] }
interface OpenRouterEmbedResponse { data?: OpenRouterEmbedResponseData[]; model?: string; error?: OpenRouterErrorPayload }

export async function embedWithOpenRouter(inputs: string[] | string, overrideModel?: string): Promise<number[][]> {
  const arr = Array.isArray(inputs) ? inputs : [inputs];
  if (arr.length === 0) return [];
  const cfg = configManager.getConfig();
  const oc = cfg.openrouter || {};
  const model = overrideModel || oc.openrouterEmbedModel || "qwen/qwen3-embedding-0.6b";
  const timeoutCandidate = [oc.openrouterTimeoutMs, oc.requestTimeoutMs, oc.timeoutMs]
    .map((value) => {
      if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
      }
      return value;
    })
    .find((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  const payload: OpenRouterEmbedRequest = {
    model,
    input: arr.length === 1 ? arr[0] : arr,
  };
  const response = await postOpenRouterJson<OpenRouterEmbedResponse>("/embeddings", payload, {
    timeoutMs: timeoutCandidate,
  });
  if (response?.error) {
    logger.error("OpenRouter embedding error", {
      message: response.error.message,
      code: response.error.code,
      metadata: response.error.metadata,
    });
    throw new Error(response.error.message || "OpenRouter embeddings request failed");
  }
  if (!response?.data || !Array.isArray(response.data) || response.data.length === 0) {
    throw new Error("OpenRouter embeddings response is empty");
  }
  const embeddings = response.data.map((entry) => {
    if (!entry || !Array.isArray(entry.embedding)) {
      throw new Error("Invalid embedding entry returned from OpenRouter");
    }
    return entry.embedding;
  });
  if (embeddings.length !== arr.length) {
    logger.warn("Embedding count mismatch", {
      requested: arr.length,
      received: embeddings.length,
      model,
    });
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
    logger.info("OpenRouter payload:", payload);
    const resp = await postOpenRouterJson<OpenRouterChatCompletionResponse>("/chat/completions", payload);
    logger.info("OpenRouter response:", resp);
    if (resp.error) {
      logger.error("OpenRouter provider error", {
        message: resp.error.message,
        code: resp.error.code,
        metadata: resp.error.metadata,
      });
      throw new Error(resp.error.message || "OpenRouter provider returned error");
    }
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
    if (resp.error) {
      logger.error("OpenRouter provider error", {
        message: resp.error.message,
        code: resp.error.code,
        metadata: resp.error.metadata,
      });
      throw new Error(resp.error.message || "OpenRouter provider returned error");
    }
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
