/**
 * Ollama LLM Provider
 * Aligned with BaseLLMProvider architecture
 */

import { configManager } from "../../configManager";
import type { AppConfig } from "../../configManager";
import { httpPostJson } from "./httpClient";
import { logger } from "../../logger";
import { BaseLLMProvider } from "./BaseLLMProvider";
import type {
  ProviderResolvedConfig,
  GenerateStructuredJsonParams,
  DescribeImageOptions,
} from "./llmProviderTypes";
import { MIN_JSON_COMPLETION_TOKENS } from "./llmProviderTypes";
import type { SupportedLang } from "./promptHelper";
import { normalizeLanguage } from "./promptHelper";

export interface OllamaResolvedConfig extends ProviderResolvedConfig {
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

export type StructuredResponseFormat = NonNullable<GenerateStructuredJsonParams["responseFormat"]>;

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

const DEFAULT_JSON_TIMEOUT_MS = 60000;

export class OllamaProvider extends BaseLLMProvider {
  protected readonly providerLabel: string = "Ollama";

  protected resolveConfig(cfg: AppConfig): OllamaResolvedConfig {
    const section = cfg.ollama ?? {};
    return {
      endpoint: trimEndpoint(section.ollamaEndpoint || cfg.ollamaEndpoint),
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

  public async embed(inputs: string[], overrideModel?: string): Promise<number[][]> {
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

  public async generateStructuredJson(params: GenerateStructuredJsonParams): Promise<unknown> {
    const {
      messages,
      responseFormat,
      temperature = 0.7,
      maxTokens = MIN_JSON_COMPLETION_TOKENS,
      overrideModel,
      language,
    } = params;
    
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

    const usedLang = normalizeLanguage(language ?? cfg.language ?? "en", "en");
    logger.info("Structured JSON request", {
      provider: this.providerLabel,
      lang: usedLang,
      model,
      schema: Boolean(responseFormat?.json_schema?.schema),
    });

    // Convert messages to Ollama format if needed
    const ollamaMessages: OllamaMessage[] = messages.map(msg => ({
      role: msg.role as OllamaRole,
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    }));

    const prompt = this.messagesToPrompt(ollamaMessages, responseFormat?.json_schema, usedLang);
    const tokenBudget = Math.max(maxTokens, MIN_JSON_COMPLETION_TOKENS);

    const payload: OllamaGeneratePayload = {
      model,
      prompt,
      stream: false,
      think: false,
      options: { temperature, num_predict: tokenBudget },
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
      const message = resp.error?.message || `Failed generate via ${this.providerLabel}: HTTP ${resp.status}`;
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

  public async describeImage(images: string[], options?: DescribeImageOptions): Promise<string> {
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

  public async checkServiceHealth(): Promise<boolean> {
    try {
      const cfg = configManager.getConfig();
      const resolved = this.resolveConfig(cfg);
      
      if (!resolved.endpoint) {
        logger.warn("Ollama endpoint not configured");
        return false;
      }
      
      // Ollama uses /api/tags endpoint to list available models (GET request)
      const url = `${resolved.endpoint}/api/tags`;
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      try {
        const headers: Record<string, string> = { "Accept": "application/json" };
        if (resolved.apiKey) {
          headers.Authorization = `Bearer ${resolved.apiKey}`;
        }
        
        const response = await fetch(url, {
          method: "GET",
          headers,
          signal: controller.signal,
        });
        
        clearTimeout(timeout);
        
        if (!response.ok) {
          logger.warn("Ollama health check failed", { status: response.status });
          return false;
        }
        
        const data = await response.json() as { models?: Array<{ name: string }> };
        return Array.isArray(data.models);
      } catch (error) {
        clearTimeout(timeout);
        throw error;
      }
    } catch (e) {
      logger.warn("Ollama service health check failed", e as unknown);
      return false;
    }
  }
}

/**
 * Backward compatibility wrapper for OllamaClient with old-style API
 */
export class OllamaClient extends OllamaProvider {
  // Override to support the old API signature
  async generateStructuredJson(
    messagesOrParams: OllamaMessage[] | GenerateStructuredJsonParams,
    responseFormat?: StructuredResponseFormat,
    temperature = 0.7,
    maxTokens = MIN_JSON_COMPLETION_TOKENS,
    overrideModel = "",
    lang?: SupportedLang
  ): Promise<unknown> {
    // If first argument is already a params object, use it directly
    if (!Array.isArray(messagesOrParams)) {
      return super.generateStructuredJson(messagesOrParams);
    }
    
    // Otherwise, convert old-style arguments to params object
    const adjustedMaxTokens = Math.max(maxTokens, MIN_JSON_COMPLETION_TOKENS);
    return super.generateStructuredJson({
      messages: messagesOrParams.map(msg => ({
        role: msg.role as "system" | "user" | "assistant",
        content: msg.content
      })),
      responseFormat: responseFormat?.json_schema ? {
        json_schema: {
          ...responseFormat.json_schema,
          schema: responseFormat.json_schema.schema as Record<string, unknown>
        }
      } : undefined,
      temperature,
      maxTokens: adjustedMaxTokens,
      overrideModel,
      language: lang,
    });
  }
}

// Export singleton instances
export const ollamaProvider = new OllamaProvider();
export const ollamaClient = new OllamaClient();

// Export utility
export { trimEndpoint };
