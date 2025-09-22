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
