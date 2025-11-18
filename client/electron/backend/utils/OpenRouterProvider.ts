/**
 * OpenRouter LLM Provider
 * OpenAI-compatible API with custom headers and error handling
 */

import { configManager } from "../../configManager";
import type { AppConfig } from "../../configManager";
import { logger } from "../../logger";
import { BaseLLMProvider } from "./BaseLLMProvider";
import type {
  ProviderResolvedConfig,
  GenerateStructuredJsonParams,
  DescribeImageOptions,
} from "./llmProviderTypes";
import { MIN_JSON_COMPLETION_TOKENS } from "./llmProviderTypes";
import type {
  ChatCompletionMessageParam,
  ChatCompletionContentPart,
} from "openai/resources/chat/completions";

type ChatCompletionTextContentPart = Extract<ChatCompletionContentPart, { type: "text" }>;

function isTextContentPart(part: ChatCompletionContentPart): part is ChatCompletionTextContentPart {
  return part.type === "text" && typeof (part as ChatCompletionTextContentPart).text === "string";
}

interface OpenRouterResolvedConfig extends ProviderResolvedConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  headers: Record<string, string>;
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

export interface OpenRouterEmbedRequest { 
  input: string | string[]; 
  model: string;
}

interface OpenRouterEmbedResponseData { 
  embedding: number[];
}

interface OpenRouterEmbedResponse { 
  data?: OpenRouterEmbedResponseData[]; 
  model?: string; 
  error?: OpenRouterErrorPayload;
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_REFERER = "https://github.com/pega2077/ai_file_manager";
const DEFAULT_TITLE = "AI File Manager";

export class OpenRouterProvider extends BaseLLMProvider {
  protected readonly providerLabel = "OpenRouter";

  protected resolveConfig(cfg: AppConfig): OpenRouterResolvedConfig {
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

    return {
      apiKey,
      baseUrl,
      timeoutMs,
      headers,
      chatModel: oc.openrouterModel,
      embedModel: oc.openrouterEmbedModel,
      visionModel: oc.openrouterVisionModel || oc.openrouterModel,
    };
  }

  protected getDefaultEmbedModel(): string {
    return "qwen/qwen3-embedding-0.6b";
  }

  protected getDefaultChatModel(): string {
    return "openrouter/auto";
  }

  protected getDefaultVisionModel(): string {
    return "gpt-4o-mini";
  }

  /**
   * Post JSON to OpenRouter API
   */
  private async postOpenRouterJson<T>(
    path: string,
    body: unknown,
    options?: {
      timeoutMs?: number;
      apiKeyOverride?: string;
      headers?: Record<string, string>;
    }
  ): Promise<T> {
    const config = this.resolveConfig(configManager.getConfig()) as OpenRouterResolvedConfig;
    const url = path.startsWith("http") ? path : `${config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const controller = new AbortController();
    const effectiveApiKey = options?.apiKeyOverride && options.apiKeyOverride.trim()
      ? options.apiKeyOverride.trim()
      : config.apiKey;
    const effectiveTimeout = typeof options?.timeoutMs === "number" && options.timeoutMs > 0
      ? options.timeoutMs
      : config.timeoutMs;
    const timer = setTimeout(() => controller.abort(), effectiveTimeout);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${effectiveApiKey}`,
          ...config.headers,
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

  public async embed(inputs: string[], overrideModel?: string): Promise<number[][]> {
    const arr = Array.isArray(inputs) ? inputs : [inputs];
    if (arr.length === 0) return [];
    
    const cfg = configManager.getConfig();
    const config = this.resolveConfig(cfg) as OpenRouterResolvedConfig;
    const model = overrideModel || config.embedModel || this.getDefaultEmbedModel();
    
    const payload: OpenRouterEmbedRequest = {
      model,
      input: arr.length === 1 ? arr[0] : arr,
    };
    
    const response = await this.postOpenRouterJson<OpenRouterEmbedResponse>("/embeddings", payload, {
      timeoutMs: config.timeoutMs,
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

  public async generateStructuredJson(params: GenerateStructuredJsonParams): Promise<unknown> {
    const {
      messages,
      responseFormat,
      temperature = 0.7,
      maxTokens = MIN_JSON_COMPLETION_TOKENS,
      overrideModel,
    } = params;
    
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("messages are required");
    }

    const cfg = configManager.getConfig();
    const config = this.resolveConfig(cfg) as OpenRouterResolvedConfig;
    const model = overrideModel || config.chatModel || this.getDefaultChatModel();

    try {
      const schema = responseFormat?.json_schema?.schema;
      const normalizedSchema = schema ? (this.normalizeJsonSchema(schema) as Record<string, unknown>) : undefined;
      
      const tokenBudget = Math.max(maxTokens, MIN_JSON_COMPLETION_TOKENS);

      const payload = {
        model,
        messages: messages as ChatCompletionMessageParam[],
        temperature,
        max_tokens: tokenBudget,
        response_format: normalizedSchema
          ? { type: "json_schema", json_schema: { name: "schema", schema: normalizedSchema, strict: true } }
          : { type: "json_object" },
      };
      
      logger.info("OpenRouter payload:", payload);
      const resp = await this.postOpenRouterJson<OpenRouterChatCompletionResponse>("/chat/completions", payload);
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

  public async describeImage(images: string[], options?: DescribeImageOptions): Promise<string> {
    if (!Array.isArray(images) || images.length === 0) {
      return "";
    }

    const imageBase64 = images[0]; // OpenRouter handles single image at a time
    const prompt = options?.prompt || "What is in this picture? Describe it in detail.";
    const maxTokens = options?.maxTokens;
    const overrideModel = options?.overrideModel;

    const cfg = configManager.getConfig();
    const config = this.resolveConfig(cfg) as OpenRouterResolvedConfig;
    const model = overrideModel || config.visionModel || this.getDefaultVisionModel();

    try {
      const content: ChatCompletionContentPart[] = [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
      ];
      
      const payload = {
        model,
        messages: [{ role: "user", content }],
        temperature: 0.2,
        max_tokens: typeof maxTokens === "number" && maxTokens > 0 ? maxTokens : 800,
      };

      const resp = await this.postOpenRouterJson<OpenRouterChatCompletionResponse>("/chat/completions", payload);
      
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

  public async checkServiceHealth(): Promise<boolean> {
    try {
      const config = this.resolveConfig(configManager.getConfig()) as OpenRouterResolvedConfig;
      const url = `${config.baseUrl}/models`;
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${config.apiKey}`,
            ...config.headers,
          },
          signal: controller.signal,
        });
        
        clearTimeout(timeout);
        
        if (!response.ok) {
          logger.warn("OpenRouter health check failed", { status: response.status });
          return false;
        }
        
        const data = await response.json() as { data?: Array<{ id: string }> };
        return Array.isArray(data.data) && data.data.length > 0;
      } catch (error) {
        clearTimeout(timeout);
        throw error;
      }
    } catch (e) {
      logger.warn("OpenRouter service health check failed", e as unknown);
      return false;
    }
  }
}

// Export singleton instance
export const openRouterProvider = new OpenRouterProvider();

// Export legacy function wrappers for backward compatibility
export async function embedWithOpenRouter(inputs: string[] | string, overrideModel?: string): Promise<number[][]> {
  const arr = Array.isArray(inputs) ? inputs : [inputs];
  return openRouterProvider.embed(arr, overrideModel);
}

export async function generateStructuredJsonWithOpenRouter(
  messages: ChatCompletionMessageParam[],
  schema?: Record<string, unknown>,
  temperature = 0.7,
  maxTokens = MIN_JSON_COMPLETION_TOKENS,
  overrideModel?: string
): Promise<unknown> {
  return openRouterProvider.generateStructuredJson({
    messages,
    responseFormat: schema ? { json_schema: { schema, strict: true } } : undefined,
    temperature,
    maxTokens,
    overrideModel,
  });
}

export async function describeImageWithOpenRouter(
  imageBase64: string,
  prompt = "What is in this picture? Describe it in detail.",
  overrideModel?: string,
  maxTokens?: number
): Promise<string> {
  return openRouterProvider.describeImage([imageBase64], { prompt, overrideModel, maxTokens });
}

// Re-export normalizeJsonSchema for backward compatibility
export { normalizeJsonSchema } from "./BaseLLMProvider";
