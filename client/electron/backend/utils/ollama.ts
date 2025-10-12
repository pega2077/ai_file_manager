import { configManager } from "../../configManager";
import type { AppConfig } from "../../configManager";
import { httpPostJson } from "./httpClient";
import { logger } from "../../logger";
import type { SupportedLang } from "./promptHelper";
import { normalizeLanguage } from "./promptHelper";

export interface OllamaResolvedConfig {
  endpoint: string;
  chatModel?: string;
  embedModel?: string;
  visionModel?: string;
  apiKey?: string;
}

const trimEndpoint = (value?: string): string => (value ?? "").replace(/\/+$/, "");

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
  response: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

export interface OllamaVisionGeneratePayload extends OllamaGeneratePayload {
  images: string[];
}

export interface DescribeImageOptions {
  prompt?: string;
  overrideModel?: string;
  timeoutMs?: number;
  maxTokens?: number;
}

const DEFAULT_JSON_TIMEOUT_MS = 60000;

export abstract class BaseOllamaClient {
  protected abstract readonly providerLabel: string;

  protected abstract resolveConfig(cfg: AppConfig): OllamaResolvedConfig;

  protected abstract getDefaultEmbedModel(): string;

  protected abstract getDefaultChatModel(): string;

  protected abstract getDefaultVisionModel(): string;

  protected trimEndpoint(value?: string): string {
    return trimEndpoint(value);
  }

  async embed(inputs: string[], overrideModel?: string): Promise<number[][]> {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      return [];
    }
    const cfg = configManager.getConfig();
    const resolved = this.resolveConfig(cfg);
    if (!resolved.endpoint) {
      throw new Error(`${this.providerLabel} endpoint not configured`);
    }
    const model = overrideModel || resolved.embedModel || resolved.chatModel || this.getDefaultEmbedModel();
    const url = `${resolved.endpoint}/api/embed`;
    const payload: OllamaEmbedRequest = { model, input: inputs };
    const resp = await httpPostJson<OllamaEmbedResponse>(
      url,
      payload,
      { Accept: "application/json" },
      undefined,
      resolved.apiKey
    );
    if (!resp.ok || !resp.data) {
      const message = resp.error?.message || `Failed embedding via ${this.providerLabel}: HTTP ${resp.status}`;
      logger.error("Embedding request failed", { provider: this.providerLabel, message });
      throw new Error(message);
    }
    if (!Array.isArray(resp.data.embeddings)) {
      throw new Error(`Invalid ${this.providerLabel} embedding response`);
    }
    return resp.data.embeddings;
  }

  async generateStructuredJson(
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
    const resolved = this.resolveConfig(cfg);
    if (!resolved.endpoint) {
      throw new Error(`${this.providerLabel} endpoint not configured`);
    }
    const model = overrideModel || resolved.chatModel || this.getDefaultChatModel();
    if (!model) {
      throw new Error(`${this.providerLabel} model not configured`);
    }

    const usedLang = normalizeLanguage(lang ?? cfg.language ?? "en", "en");
    logger.info("Structured JSON request", {
      provider: this.providerLabel,
      lang: usedLang,
      model,
      schema: Boolean(responseFormat?.json_schema?.schema),
    });

    const prompt = this.messagesToPrompt(messages, responseFormat?.json_schema, usedLang);
    const payload: OllamaGeneratePayload = {
      model,
      prompt,
      stream: false,
      think: false,
      options: { temperature, num_predict: maxTokens },
    };
    if (responseFormat?.json_schema?.schema) {
      payload.format = "json";
    }

    const resp = await httpPostJson<OllamaGenerateResponseBody>(
      `${resolved.endpoint}/api/generate`,
      payload,
      { Accept: "application/json" },
      DEFAULT_JSON_TIMEOUT_MS,
      resolved.apiKey
    );
    if (!resp.ok || !resp.data) {
      const message =
        resp.error?.message || `Failed generate via ${this.providerLabel}: HTTP ${resp.status}`;
      logger.error("Structured JSON request failed", {
        provider: this.providerLabel,
        model,
        status: resp.status,
        message,
      });
      throw new Error(message);
    }

    const raw = resp.data.response ?? "";
    const parsed = this.tryParseJson(raw);
    if (parsed !== undefined) {
      return { ...parsed, payload };
    }

    logger.error("Failed to parse JSON response", {
      provider: this.providerLabel,
      snippet: raw.slice(0, 200),
    });
    throw new Error("Invalid JSON returned by model");
  }

  async describeImage(images: string[], options?: DescribeImageOptions): Promise<string> {
    if (!Array.isArray(images) || images.length === 0) {
      return "";
    }
    const cfg = configManager.getConfig();
    const resolved = this.resolveConfig(cfg);
    if (!resolved.endpoint) {
      throw new Error(`${this.providerLabel} endpoint not configured`);
    }
    const model = options?.overrideModel || resolved.visionModel || resolved.chatModel || this.getDefaultVisionModel();
    if (!model) {
      throw new Error(`${this.providerLabel} vision model not configured`);
    }

    const payload: OllamaVisionGeneratePayload = {
      model,
      prompt: options?.prompt || "What is in this picture? Describe it in detail.",
      stream: false,
      think: false,
      images,
    };
    if (options?.maxTokens && options.maxTokens > 0) {
      payload.options = { ...(payload.options || {}), num_predict: options.maxTokens };
    }

    const resp = await httpPostJson<OllamaGenerateResponseBody>(
      `${resolved.endpoint}/api/generate`,
      payload,
      { Accept: "application/json" },
      Math.max(30000, options?.timeoutMs ?? 300000),
      resolved.apiKey
    );
    if (!resp.ok || !resp.data) {
      const message = resp.error?.message || `Failed vision generate via ${this.providerLabel}: HTTP ${resp.status}`;
      logger.error("Vision request failed", {
        provider: this.providerLabel,
        model,
        status: resp.status,
        message,
      });
      throw new Error(message);
    }
    const text = resp.data.response ?? "";
    return typeof text === "string" ? text : String(text);
  }

  protected messagesToPrompt(
    messages: OllamaMessage[],
    schema: StructuredResponseFormat["json_schema"],
    lang: SupportedLang
  ): string {
    const parts: string[] = [];
    for (const message of messages) {
      const role = message.role || "user";
      parts.push(`${role.toUpperCase()}: ${message.content}`);
    }

    const schemaInstruction = this.buildSchemaInstruction(schema, lang);
    if (schemaInstruction) {
      parts.push(schemaInstruction);
    }

    return parts.join("\n\n");
  }

  private buildSchemaInstruction(
    schema: StructuredResponseFormat["json_schema"],
    lang: SupportedLang
  ): string {
    const base = lang === "zh"
      ? "\nSYSTEM: 输出必须是有效的 JSON，只能输出 JSON，不要包含反引号或多余文本,目录名称使用中文。"
      : "\nSYSTEM: Output MUST be valid JSON only. Do not include backticks or extra text.";

    if (!schema?.schema) {
      return base;
    }

    let schemaStr: string;
    try {
      schemaStr = JSON.stringify(schema.schema);
    } catch (error) {
      schemaStr = String(schema.schema);
      logger.warn("Failed to stringify JSON schema", {
        provider: this.providerLabel,
        error,
      });
    }

    const extra = lang === "zh"
      ? `SYSTEM: 严格遵守此 JSON Schema：${schemaStr}`
      : `SYSTEM: Strictly conform to this JSON Schema: ${schemaStr}`;
    return `${base}\n${extra}`;
  }

  private tryParseJson(raw: string): Record<string, unknown> | undefined {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (!match) {
        return undefined;
      }
      try {
        return JSON.parse(match[0]) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    }
  }
}

export class OllamaClient extends BaseOllamaClient {
  protected readonly providerLabel = "Ollama";

  protected resolveConfig(cfg: AppConfig): OllamaResolvedConfig {
    const section = cfg.ollama ?? {};
    return {
      endpoint: this.trimEndpoint(section.ollamaEndpoint || cfg.ollamaEndpoint),
      chatModel: section.ollamaModel || cfg.ollamaModel,
      embedModel: section.ollamaEmbedModel || cfg.ollamaEmbedModel,
      visionModel: section.ollamaVisionModel || cfg.ollamaVisionModel,
      apiKey: section.ollamaApiKey || cfg.ollamaApiKey,
    };
  }

  protected getDefaultEmbedModel(): string {
    return "bge-m3";
  }

  protected getDefaultChatModel(): string {
    return "qwen3:8b";
  }

  protected getDefaultVisionModel(): string {
    return "qwen3:8b";
  }
}

export const ollamaClient = new OllamaClient();

export { trimEndpoint };
