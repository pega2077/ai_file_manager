import { configManager } from "../../configManager";
import { httpPostJson } from "./httpClient";
import { logger } from "../../logger";

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

export async function embedWithOllama(inputs: string[], overrideModel?: string): Promise<number[][]> {
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
  const resp = await httpPostJson<OllamaEmbedResponse>(url, payload, { "Accept": "application/json" });
  if (!resp.ok || !resp.data) {
    const msg = resp.error?.message || `Failed embedding via Ollama: HTTP ${resp.status}`;
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
export interface OllamaMessage { role: OllamaRole; content: string }

export interface StructuredResponseFormat {
  json_schema?: {
    name?: string;
    schema: unknown;
    strict?: boolean;
  }
}

export interface OllamaGeneratePayload {
  model: string;
  prompt: string;
  stream?: boolean;
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

function messagesToPrompt(messages: OllamaMessage[], schema?: StructuredResponseFormat["json_schema"]): string {
  const parts: string[] = [];
  for (const m of messages) {
    const role = m.role || "user";
    parts.push(`${role.toUpperCase()}: ${m.content}`);
  }
  if (schema?.schema) {
    const schemaStr = (() => {
      try { return JSON.stringify(schema.schema); } catch { return String(schema.schema); }
    })();
    parts.push("\nSYSTEM: Output MUST be valid JSON only. Do not include backticks or extra text.");
    parts.push(`SYSTEM: Strictly conform to this JSON Schema: ${schemaStr}`);
  } else {
    parts.push("\nSYSTEM: Output MUST be valid JSON only. Do not include backticks or extra text.");
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
  maxTokens = 1000,
  overrideModel?: string
): Promise<unknown> {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages are required");
  }
  const cfg = configManager.getConfig();
  const endpoint = (cfg.ollamaEndpoint || "").replace(/\/$/, "");
  const model = overrideModel || cfg.ollamaModel || "llama3";
  if (!endpoint) {
    throw new Error("Ollama endpoint not configured");
  }
  const url = `${endpoint}/api/generate`;
  const prompt = messagesToPrompt(messages, responseFormat?.json_schema);
  const payload: OllamaGeneratePayload = {
    model,
    prompt,
    stream: false,
    options: { temperature, num_predict: maxTokens },
  };
  // Ollama supports forcing JSON with `format: "json"`; include schema details in prompt for stricter adherence
  if (responseFormat?.json_schema?.schema) {
    payload.format = "json";
  }

  const resp = await httpPostJson<OllamaGenerateResponseBody>(url, payload, { Accept: "application/json" }, 60000);
  if (!resp.ok || !resp.data) {
    const msg = resp.error?.message || `Failed generate via Ollama: HTTP ${resp.status}`;
    logger.error("generateStructuredJsonWithOllama failed", msg);
    throw new Error(msg);
  }
  console.log("Ollama raw response:", resp.data);
  const raw = resp.data.response ?? "";
  try {
    return JSON.parse(raw);
  } catch (e) {
    // If model returned text with extra notes, try to extract JSON
    const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fallthrough */ }
    }
    logger.error("Failed to parse JSON from Ollama response", { snippet: raw.slice(0, 200) });
    throw new Error("Invalid JSON returned by model");
  }
}
