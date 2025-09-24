import { configManager } from "../../configManager";
import { httpPostJson } from "./httpClient";
import { logger } from "../../logger";
import type { SupportedLang } from "./promptHelper";

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
  overrideModel?: string
): Promise<number[][]> {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return [];
  }
  const cfg = configManager.getConfig();
  const endpoint = (cfg.ollamaEndpoint || "").replace(/\/$/, "");
  const model = overrideModel || cfg.ollamaEmbedModel || "bge-m3";
  if (!endpoint) {
    throw new Error("Ollama endpoint not configured");
  }
  const url = `${endpoint}/api/embed`;
  const payload = { model, input: inputs } satisfies OllamaEmbedRequest;
  const resp = await httpPostJson<OllamaEmbedResponse>(url, payload, {
    Accept: "application/json",
  });
  if (!resp.ok || !resp.data) {
    const msg =
      resp.error?.message || `Failed embedding via Ollama: HTTP ${resp.status}`;
    logger.error("embedWithOllama failed", msg);
    throw new Error(msg);
  }
  if (!resp.data.embeddings || !Array.isArray(resp.data.embeddings)) {
    throw new Error("Invalid Ollama embedding response");
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
  lang?: SupportedLang
): Promise<unknown> {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages are required");
  }
  const cfg = configManager.getConfig();
  const endpoint = (cfg.ollamaEndpoint || "").replace(/\/$/, "");
  const model = overrideModel || cfg.ollamaModel ;
  if (!endpoint) {
    throw new Error("Ollama endpoint not configured");
  }
  if (!model) {
    throw new Error("Ollama model not configured");
  }

  const url = `${endpoint}/api/generate`;
  console.log(
    "Ollama generateStructuredJsonWithOllama, lang:",
    lang,
    "model:",
    model
  );
  const prompt = messagesToPrompt(messages, responseFormat?.json_schema, lang);
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
  // logger.info("Ollama generate payload prepared", JSON.stringify(payload));
  const resp = await httpPostJson<OllamaGenerateResponseBody>(
    url,
    payload,
    { Accept: "application/json" },
    60000
  );
  if (!resp.ok || !resp.data) {
    const msg =
      resp.error?.message || `Failed generate via Ollama: HTTP ${resp.status}`;
    throw new Error(msg);
  }
  //console.log("Ollama raw response:", resp.data);
  const raw = resp.data.response ?? "";
  try {
    const res = JSON.parse(raw);
    res.payload = payload;
    return res;
  } catch (e) {
    console.error("Failed to parse JSON from Ollama response", {
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
    console.error("Failed to parse JSON from Ollama response", {
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
  options?: { prompt?: string; overrideModel?: string; timeoutMs?: number }
): Promise<string> {
  const imgs = Array.isArray(images) ? images : [images];
  if (imgs.length === 0) return "";

  const cfg = configManager.getConfig();
  const endpoint = (cfg.ollamaEndpoint || "").replace(/\/$/, "");
  const model = options?.overrideModel || cfg.ollamaVisionModel || cfg.ollamaModel;
  if (!endpoint) throw new Error("Ollama endpoint not configured");
  if (!model) throw new Error("Ollama vision model not configured");

  const url = `${endpoint}/api/generate`;
  const payload: OllamaVisionGeneratePayload = {
    model,
    prompt: options?.prompt || "What is in this picture? Describe it in detail.",
    stream: false,
    think: false,
    images: imgs,
  };

  const resp = await httpPostJson<OllamaGenerateResponseBody>(
    url,
    payload,
    { Accept: "application/json" },
    Math.max(30000, options?.timeoutMs ?? 60000)
  );
  if (!resp.ok || !resp.data) {
    const msg = resp.error?.message || `Failed vision generate via Ollama: HTTP ${resp.status}`;
    logger.error("describeImageWithOllama failed", msg);
    throw new Error(msg);
  }
  const text = resp.data.response ?? "";
  return typeof text === "string" ? text : String(text);
}
