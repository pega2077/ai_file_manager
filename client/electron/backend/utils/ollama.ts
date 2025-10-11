import { configManager } from "../../configManager";
import type { AppConfig } from "../../configManager";
import { httpPostJson } from "./httpClient";
import { logger } from "../../logger";
import type { SupportedLang } from "./promptHelper";
import { normalizeLanguage } from "./promptHelper";

export type OllamaLikeProvider = "ollama" | "pega";

interface OllamaResolvedConfig {
  endpoint: string;
  chatModel?: string;
  embedModel?: string;
  visionModel?: string;
  apiKey?: string;
}

const trimEndpoint = (value?: string): string => (value ?? "").replace(/\/+$/, "");

function resolveOllamaLikeConfig(provider: OllamaLikeProvider, cfg: AppConfig): OllamaResolvedConfig {
  if (provider === "pega") {
    const section = cfg.pega ?? {};
    return {
      endpoint: trimEndpoint(section.pegaEndpoint || cfg.pegaEndpoint),
      chatModel: section.pegaModel || cfg.pegaModel,
      embedModel: section.pegaEmbedModel || cfg.pegaEmbedModel,
      visionModel: section.pegaVisionModel || cfg.pegaVisionModel,
      apiKey: section.pegaApiKey || cfg.pegaApiKey || section.pegaAuthToken || cfg.pegaAuthToken,
    };
  }

  const section = cfg.ollama ?? {};
  return {
    endpoint: trimEndpoint(section.ollamaEndpoint || cfg.ollamaEndpoint),
    chatModel: section.ollamaModel || cfg.ollamaModel,
    embedModel: section.ollamaEmbedModel || cfg.ollamaEmbedModel,
    visionModel: section.ollamaVisionModel || cfg.ollamaVisionModel,
    apiKey: section.ollamaApiKey || cfg.ollamaApiKey,
  };
}

export interface OllamaEmbedRequest {
  input: string[];
  model?: string;
}

export interface OllamaEmbedResponse {
  model: string;
  embeddings: number[][];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
}

export async function embedWithOllama(
  inputs: string[],
  overrideModel?: string,
  provider: OllamaLikeProvider = "ollama"
): Promise<number[][]> {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return [];
  }
  const cfg = configManager.getConfig();
  const resolved = resolveOllamaLikeConfig(provider, cfg);
  const endpoint = resolved.endpoint;
  const providerLabel = provider === "pega" ? "Pega" : "Ollama";
  if (!endpoint) {
    throw new Error(`${providerLabel} endpoint not configured`);
  }
  const fallbackModel = provider === "pega" ? "pega-embed" : "bge-m3";
  const model = overrideModel || resolved.embedModel || resolved.chatModel || fallbackModel;
  const url = `${endpoint}/api/embed`;
  const payload = { model, input: inputs } satisfies OllamaEmbedRequest;
  const apiKey = resolved.apiKey;
  const resp = await httpPostJson<OllamaEmbedResponse>(url, payload, {
    Accept: "application/json",
  }, undefined, apiKey);
  if (!resp.ok || !resp.data) {
    const msg =
      resp.error?.message || `Failed embedding via ${providerLabel}: HTTP ${resp.status}`;
    logger.error("embedWithOllama failed", msg);
    throw new Error(msg);
  }
  if (!resp.data.embeddings || !Array.isArray(resp.data.embeddings)) {
    throw new Error(`Invalid ${providerLabel} embedding response`);
  }
  return resp.data.embeddings;
}

// -------- Structured Generation (JSON) --------
export type OllamaRole = "system" | "user" | "assistant";
export interface OllamaMessage {
  role: OllamaRole;
  content: string;
}

export interface StructuredResponseFormat {
  json_schema?: {
    name?: string;
    schema: unknown;
    strict?: boolean;
  };
}

export interface OllamaGeneratePayload {
  model: string;
  prompt: string;
  stream?: boolean;
  think?: boolean;
  options?: {
    temperature?: number;
    num_predict?: number;
  };
  format?: "json" | Record<string, unknown>;
}

export interface OllamaGenerateResponseBody {
  model: string;
  created_at?: string;
  response: string; // textual response (we will parse JSON)
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

// ---- Vision (images) generate payload ----
export interface OllamaVisionGeneratePayload extends OllamaGeneratePayload {
  images: string[]; // base64-encoded images
}

function messagesToPrompt(
  messages: OllamaMessage[],
  schema?: StructuredResponseFormat["json_schema"],
  lang: SupportedLang = "en"
): string {
  const parts: string[] = [];
  for (const m of messages) {
    const role = m.role || "user";
    parts.push(`${role.toUpperCase()}: ${m.content}`);
  }
  if (schema?.schema) {
    const schemaStr = (() => {
      try {
        return JSON.stringify(schema.schema);
      } catch {
        return String(schema.schema);
      }
    })();
    if (lang === "zh") {
      parts.push(
        "\nSYSTEM: 输出必须是有效的 JSON，只能输出 JSON，不要包含反引号或多余文本,目录名称使用中文。"
      );
      parts.push(`SYSTEM: 严格遵守此 JSON Schema：${schemaStr}`);
    } else {
      parts.push(
        "\nSYSTEM: Output MUST be valid JSON only. Do not include backticks or extra text."
      );
      parts.push(`SYSTEM: Strictly conform to this JSON Schema: ${schemaStr}`);
    }
  } else {
    if (lang === "zh") {
      parts.push(
        "\nSYSTEM: 输出必须是有效的 JSON，只能输出 JSON，不要包含反引号或多余文本,目录名称使用中文。"
      );
    } else {
      parts.push(
        "\nSYSTEM: Output MUST be valid JSON only. Do not include backticks or extra text."
      );
    }
  }
  return parts.join("\n\n");
}

/**
 * Call Ollama /api/generate to obtain structured JSON output.
 * If responseFormat with json_schema is provided, we set format to 'json' and include the schema in the prompt for stricter adherence.
 */
export async function generateStructuredJsonWithOllama(
  messages: OllamaMessage[],
  responseFormat?: StructuredResponseFormat,
  temperature = 0.7,
  maxTokens = 3000,
  overrideModel = "",
  lang?: SupportedLang,
  provider: OllamaLikeProvider = "ollama"
): Promise<unknown> {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages are required");
  }
  const cfg = configManager.getConfig();
  const resolved = resolveOllamaLikeConfig(provider, cfg);
  const endpoint = resolved.endpoint;
  const providerLabel = provider === "pega" ? "Pega" : "Ollama";
  if (!endpoint) {
    throw new Error(`${providerLabel} endpoint not configured`);
  }
  const fallbackModel = provider === "pega" ? "pega-chat" : "qwen3:8b";
  const model = overrideModel || resolved.chatModel || fallbackModel;
  if (!model) {
    throw new Error(`${providerLabel} model not configured`);
  }

  const url = `${endpoint}/api/generate`;
  // Fallback to system-configured language when not explicitly provided
  const usedLang = normalizeLanguage(lang ?? cfg.language ?? "en", "en");
  logger.info(
    `${providerLabel} structured JSON request`,
    { lang: usedLang, model }
  );
  const prompt = messagesToPrompt(messages, responseFormat?.json_schema, usedLang);
  const payload: OllamaGeneratePayload = {
    model,
    prompt,
    stream: false,
    think: false,
    options: { temperature, num_predict: maxTokens },
  };
  // Ollama supports forcing JSON with `format: "json"`; include schema details in prompt for stricter adherence
  if (responseFormat?.json_schema?.schema) {
    payload.format = "json";
  }
  logger.info("Ollama generate payload prepared", JSON.stringify(payload));
  const apiKey = resolved.apiKey;
  const resp = await httpPostJson<OllamaGenerateResponseBody>(
    url,
    payload,
    { Accept: "application/json" },
    60000,
    apiKey
  );
  if (!resp.ok || !resp.data) {
    const msg =
      resp.error?.message || `Failed generate via ${providerLabel}: HTTP ${resp.status} DATA ${resp.data}`;
    throw new Error(msg);
  }
  console.log("Ollama raw response:", resp.data);
  const raw = resp.data.response ?? "";
  try {
    const res = JSON.parse(raw);
    res.payload = payload;
    return res;
  } catch (e) {
    console.error(`Failed to parse JSON from ${providerLabel} response`, {
      snippet: raw.slice(0, 200),
    });
    // If model returned text with extra notes, try to extract JSON
    const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        /* fallthrough */
      }
    }
    console.error(`Failed to parse JSON from ${providerLabel} response`, {
      snippet: raw.slice(0, 200),
    });
    throw new Error("Invalid JSON returned by model");
  }
}

/**
 * Describe image(s) using a vision-capable Ollama model via /api/generate.
 * images: one or more base64 strings (no data: prefix required, raw base64 recommended).
 * Returns the textual response from the model.
 */
export async function describeImageWithOllama(
  images: string | string[],
  options?: { prompt?: string; overrideModel?: string; timeoutMs?: number; maxTokens?: number; provider?: OllamaLikeProvider }
): Promise<string> {
  const imgs = Array.isArray(images) ? images : [images];
  if (imgs.length === 0) return "";

  const cfg = configManager.getConfig();
  const provider = options?.provider ?? "ollama";
  const resolved = resolveOllamaLikeConfig(provider, cfg);
  const endpoint = resolved.endpoint;
  const providerLabel = provider === "pega" ? "Pega" : "Ollama";
  if (!endpoint) throw new Error(`${providerLabel} endpoint not configured`);
  const fallbackModel = provider === "pega" ? "pega-vision" : "qwen3:8b";
  const model = options?.overrideModel || resolved.visionModel || resolved.chatModel || fallbackModel;
  if (!model) throw new Error(`${providerLabel} vision model not configured`);

  const url = `${endpoint}/api/generate`;
  const payload: OllamaVisionGeneratePayload = {
    model,
    prompt: options?.prompt || "What is in this picture? Describe it in detail.",
    stream: false,
    think: false,
    images: imgs,
  };
  if (options?.maxTokens && options.maxTokens > 0) {
    payload.options = { ...(payload.options || {}), num_predict: options.maxTokens };
  }

  const apiKey = resolved.apiKey;
  const resp = await httpPostJson<OllamaGenerateResponseBody>(
    url,
    payload,
    { Accept: "application/json" },
    Math.max(30000, options?.timeoutMs ?? 300000),
    apiKey
  );
  if (!resp.ok || !resp.data) {
    const msg = resp.error?.message || `Failed vision generate via ${providerLabel}: HTTP ${resp.status}`;
    logger.error("describeImageWithOllama failed", msg);
    throw new Error(msg);
  }
  const text = resp.data.response ?? "";
  return typeof text === "string" ? text : String(text);
}
