import { configManager } from "../../configManager";
import { logger } from "../../logger";
import type {
  ChatCompletionMessageParam,
  ChatCompletionContentPart,
} from "openai/resources/chat/completions";
import { httpPostJson } from "./httpClient";
import { normalizeJsonSchema } from "./openrouter";

interface PegaOpenRouterEmbedResponse { embeddings: number[][] }

interface PegaOpenRouterResolvedConfig {
  baseUrl: string;
  apiKey?: string;
  chatModel?: string;
  embedModel?: string;
  visionModel?: string;
  headers: Record<string, string>;
  timeoutMs: number;
  embedEndpoint: string;
  embedKey?: string;
}

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_REFERER = "https://github.com/pega2077/ai_file_manager";
const DEFAULT_TITLE = "AI File Manager";
const DEFAULT_EMBED_ENDPOINT = "https://embed.pegamob.com";

type ChatCompletionTextContentPart = Extract<ChatCompletionContentPart, { type: "text" }>;

function isTextContentPart(part: ChatCompletionContentPart): part is ChatCompletionTextContentPart {
  return part.type === "text" && typeof (part as ChatCompletionTextContentPart).text === "string";
}

function resolvePegaOpenRouterConfig(): PegaOpenRouterResolvedConfig {
  const cfg = configManager.getConfig();
  const section = cfg.pega ?? {};
  const rawEndpoint = (section.pegaEndpoint || cfg.pegaEndpoint || "").trim();
  const normalizedEndpoint = rawEndpoint.replace(/\/+$/, "");
  if (!normalizedEndpoint) {
    throw new Error("Pega endpoint not configured");
  }
  const apiKey = (
    section.pegaApiKey ||
    cfg.pegaApiKey ||
    section.pegaAuthToken ||
    cfg.pegaAuthToken ||
    ""
  ).trim();

  const headers: Record<string, string> = {
    "HTTP-Referer": DEFAULT_REFERER,
    "X-Title": DEFAULT_TITLE,
  };

  const embedEndpointRaw = (
    section.pegaOpenrouterEmbedEndpoint ||
    cfg.pega?.pegaOpenrouterEmbedEndpoint ||
    DEFAULT_EMBED_ENDPOINT
  ) as string;
  const embedEndpoint = embedEndpointRaw.trim().replace(/\/+$/, "") || DEFAULT_EMBED_ENDPOINT;

  const embedKey = (
    section.pegaOpenrouterEmbedKey ||
    cfg.pegaOpenrouterEmbedKey ||
    cfg.pega?.pegaOpenrouterEmbedKey ||
    ""
  ).trim();

  return {
    baseUrl: `${normalizedEndpoint}/openrouter/api`,
    apiKey,
    chatModel:
      section.pegaOpenrouterModel ||
      (section.pegaMode === "openrouter" ? section.pegaModel : undefined) ||
      cfg.pegaOpenrouterModel ||
      (cfg.pega?.pegaMode === "openrouter" ? cfg.pegaModel : undefined) ||
      section.pegaModel ||
      cfg.pegaModel,
    visionModel:
      section.pegaOpenrouterVisionModel ||
      (section.pegaMode === "openrouter" ? section.pegaVisionModel : undefined) ||
      cfg.pegaOpenrouterVisionModel ||
      (cfg.pega?.pegaMode === "openrouter" ? cfg.pegaVisionModel : undefined) ||
      section.pegaVisionModel ||
      cfg.pegaVisionModel,
    embedModel:
      section.pegaOpenrouterEmbedModel ||
      (section.pegaMode === "openrouter" ? section.pegaEmbedModel : undefined) ||
      cfg.pegaOpenrouterEmbedModel ||
      cfg.pega?.pegaOpenrouterEmbedModel ||
      (cfg.pega?.pegaMode === "openrouter" ? cfg.pegaEmbedModel : undefined) ||
      cfg.pegaEmbedModel,
    headers,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    embedEndpoint,
    embedKey: embedKey ? embedKey : undefined,
  };
}

interface PegaOpenRouterChatCompletionChoice {
  message?: {
    role?: string;
    content?: string | ChatCompletionContentPart[];
  };
}

interface PegaOpenRouterChatCompletionResponse {
  choices?: PegaOpenRouterChatCompletionChoice[];
  error?: {
    message?: string;
  };
}

async function postPegaOpenRouterJson<T>(
  resolved: PegaOpenRouterResolvedConfig,
  path: string,
  body: unknown,
  overrideTimeoutMs?: number
): Promise<T> {
  const url = path.startsWith("http") ? path : `${resolved.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const controller = new AbortController();
  const effectiveTimeout = typeof overrideTimeoutMs === "number" && overrideTimeoutMs > 0
    ? overrideTimeoutMs
    : resolved.timeoutMs;
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...resolved.headers,
    };
    if (resolved.apiKey) {
      headers.Authorization = `Bearer ${resolved.apiKey}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const rawText = await response.text();
    if (!response.ok) {
      let errorMessage = `Pega OpenRouter request failed with status ${response.status}`;
      try {
        const parsed = rawText ? JSON.parse(rawText) as { error?: { message?: string } } : undefined;
        if (parsed?.error?.message) {
          errorMessage = parsed.error.message;
        }
      } catch {
        // Ignore JSON parse error for error payload.
      }
      logger.error("Pega OpenRouter request failed", { url, status: response.status, message: errorMessage });
      throw new Error(errorMessage);
    }

    if (!rawText) {
      return {} as T;
    }

    try {
      return JSON.parse(rawText) as T;
    } catch (parseError) {
      logger.error("Pega OpenRouter response parsing failed", {
        url,
        message: (parseError as Error).message,
      });
      throw new Error("Invalid JSON response from Pega OpenRouter");
    }
  } catch (error) {
    const err = error as Error;
    if (err.name === "AbortError") {
      logger.error("Pega OpenRouter request timed out", { url, timeoutMs: effectiveTimeout });
      throw new Error("Pega OpenRouter request timed out");
    }
    logger.error("Pega OpenRouter request error", { url, message: err.message });
    throw err;
  } finally {
    clearTimeout(timer);
  }
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
  const model = overrideModel || resolved.embedModel || resolved.chatModel;
  if (!model) {
    throw new Error("Pega embedding model not configured");
  }
  const endpoint = resolved.embedEndpoint.replace(/\/+$/, "");
  if (!endpoint) {
    throw new Error("Pega OpenRouter embed endpoint not configured");
  }
  try {
    const url = `${endpoint}/api/embed`;
  const response = await httpPostJson<PegaOpenRouterEmbedResponse>(
      url,
      { model, input: payload },
      { Accept: "application/json", ...resolved.headers },
      resolved.timeoutMs,
      resolved.embedKey || resolved.apiKey || undefined
    );
    if (!response.ok || !response.data) {
      const msg = response.error?.message || `Failed embedding via Pega OpenRouter embed endpoint: HTTP ${response.status}`;
      logger.error("embedWithPegaOpenRouter failed", msg);
      throw new Error(msg);
    }
    const embeddings = response.data.embeddings;
    if (!embeddings || !Array.isArray(embeddings)) {
      throw new Error("Invalid embedding response from Pega OpenRouter");
    }
    return embeddings;
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
  const model = overrideModel || resolved.chatModel;
  if (!model) {
    throw new Error("Pega chat model not configured");
  }
  try {
    const normalizedSchema = schema
      ? (normalizeJsonSchema(schema) as Record<string, unknown>)
      : undefined;
    const response = await postPegaOpenRouterJson<PegaOpenRouterChatCompletionResponse>(
      resolved,
      "/chat/completions",
      {
        model,
        temperature,
        max_tokens: maxTokens,
        messages,
        response_format: normalizedSchema
          ? { type: "json_schema", json_schema: { name: "schema", schema: normalizedSchema, strict: true } }
          : { type: "json_object" },
      }
    );
    //console.log("Pega OpenRouter response:", response);
    const choice = response.choices?.[0]?.message;
    const content = choice?.content;
    const text = Array.isArray(content)
      ? content.filter(isTextContentPart).map((part) => part.text).join("\n")
      : typeof content === "string"
        ? content
        : "";
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
  const model = overrideModel || resolved.visionModel || resolved.chatModel;
  if (!model) {
    throw new Error("Pega vision model not configured");
  }
  try {
    const content: ChatCompletionContentPart[] = [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
    ];
    const response = await postPegaOpenRouterJson<PegaOpenRouterChatCompletionResponse>(
      resolved,
      "/chat/completions",
      {
        model,
        messages: [{ role: "user", content }],
        temperature: 0.2,
        max_tokens: typeof maxTokens === "number" && maxTokens > 0 ? maxTokens : 800,
      }
    );
    const message = response.choices?.[0]?.message;
    const value = message?.content;
    if (Array.isArray(value)) {
      const parts = value.filter(isTextContentPart).map((part) => part.text);
      if (parts.length > 0) {
        return parts.join("\n");
      }
    } else if (typeof value === "string") {
      return value;
    }
    throw new Error("Pega OpenRouter vision model returned empty content");
  } catch (error) {
    logger.error("Pega OpenRouter vision request failed", error as unknown);
    throw error;
  }
}
