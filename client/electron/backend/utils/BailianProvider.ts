/**
 * Bailian (DashScope) LLM Provider
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
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export interface BailianResolvedConfig extends ProviderResolvedConfig {
  baseUrl: string;
  apiKey: string;
  chatModel?: string;
  embedModel?: string;
  visionModel?: string;
}

type BailianRole = "system" | "user" | "assistant";

interface BailianMessage {
  role: BailianRole;
  content: string | BailianContentPart[];
}

type BailianContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface BailianChatCompletionRequest {
  model: string;
  messages: BailianMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: {
    type: "json_object" | "json_schema";
    json_schema?: { name?: string; schema: Record<string, unknown>; strict?: boolean };
  };
}

interface BailianChatCompletionResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index?: number;
    message?: {
      role?: BailianRole;
      content?: string | BailianContentPart[];
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface BailianEmbeddingResponse {
  model?: string;
  data?: Array<{
    index?: number;
    embedding: number[];
  }>;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
}

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

export class BailianProvider extends BaseLLMProvider {
  protected readonly providerLabel = "Bailian";

  protected resolveConfig(cfg: AppConfig): BailianResolvedConfig {
    const bc = cfg.bailian || {};
    const baseUrl = (bc.bailianEndpoint || DEFAULT_BASE_URL).replace(/\/$/, "");
    const apiKey =
      (bc.bailianApiKey || cfg.bailianApiKey || "") || process.env.BAILIAN_API_KEY || process.env.DASHSCOPE_API_KEY || "";
    const trimmedKey = apiKey.trim();
    
    if (!trimmedKey) {
      throw new Error(
        "Bailian API key is not configured. Set bailian.bailianApiKey in config.json or provide BAILIAN_API_KEY/DASHSCOPE_API_KEY env."
      );
    }

    return {
      baseUrl,
      apiKey: trimmedKey,
      chatModel: bc.bailianModel || cfg.bailianModel,
      embedModel: bc.bailianEmbedModel || cfg.bailianEmbedModel,
      visionModel: bc.bailianVisionModel || cfg.bailianVisionModel || bc.bailianModel || cfg.bailianModel,
    };
  }

  protected getDefaultEmbedModel(): string {
    return "text-embedding-v1";
  }

  protected getDefaultChatModel(): string {
    return "qwen-max";
  }

  protected getDefaultVisionModel(): string {
    return "qwen-vl-max";
  }

  public async embed(inputs: string[], overrideModel?: string): Promise<number[][]> {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      return [];
    }

    const cfg = configManager.getConfig();
    const config = this.resolveConfig(cfg);
    const model = overrideModel || config.embedModel || this.getDefaultEmbedModel();

    const resp = await httpPostJson<BailianEmbeddingResponse>(
      `${config.baseUrl}/embeddings`,
      { model, input: inputs },
      { Accept: "application/json" },
      60000,
      config.apiKey
    );

    if (!resp.ok || !resp.data) {
      const msg = resp.error?.message || `Failed embedding via Bailian: HTTP ${resp.status}`;
      logger.error("embedWithBailian failed", msg);
      throw new Error(msg);
    }

    const items = resp.data.data;
    if (!items || !Array.isArray(items)) {
      throw new Error("Invalid embedding response from Bailian");
    }

    return items.map((item) => {
      if (!item.embedding || !Array.isArray(item.embedding)) {
        throw new Error("Invalid embedding vector in Bailian response");
      }
      return item.embedding;
    });
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
    const config = this.resolveConfig(cfg);
    const model = overrideModel || config.chatModel || this.getDefaultChatModel();

    const schema = responseFormat?.json_schema?.schema;
    const normalizedSchema = schema ? (this.normalizeJsonSchema(schema) as Record<string, unknown>) : undefined;
    const tokenBudget = Math.max(maxTokens, MIN_JSON_COMPLETION_TOKENS);

    const requestBody: BailianChatCompletionRequest = {
      model,
      messages: messages.map((m) => ({
        role: m.role as BailianRole,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
      temperature,
      max_tokens: tokenBudget,
      response_format: normalizedSchema
        ? { type: "json_schema", json_schema: { name: "schema", schema: normalizedSchema, strict: true } }
        : { type: "json_object" },
    };

    const resp = await httpPostJson<BailianChatCompletionResponse>(
      `${config.baseUrl}/chat/completions`,
      requestBody,
      { Accept: "application/json" },
      60000,
      config.apiKey
    );

    if (!resp.ok || !resp.data) {
      const msg = resp.error?.message || `Failed generate via Bailian: HTTP ${resp.status}`;
      logger.error("generateStructuredJsonWithBailian failed", msg);
      throw new Error(msg);
    }

    const choice = resp.data.choices?.[0]?.message?.content;
    const content = Array.isArray(choice)
      ? choice
          .map((part) => (typeof part === "string" ? part : part.type === "text" ? part.text : ""))
          .join("")
      : (choice as string | undefined) || "";

    try {
      return JSON.parse(content);
    } catch (err) {
      const match = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (match) {
        return JSON.parse(match[0]);
      }
      logger.error("Bailian response is not valid JSON", { snippet: content.slice(0, 200) });
      throw new Error("Model did not return valid JSON");
    }
  }

  public async describeImage(images: string[], options?: DescribeImageOptions): Promise<string> {
    if (!Array.isArray(images) || images.length === 0) {
      return "";
    }

    const imageBase64 = images[0]; // Bailian handles single image at a time
    const prompt = options?.prompt || "What is in this picture? Describe it in detail.";
    const maxTokens = options?.maxTokens;
    const overrideModel = options?.overrideModel;

    const cfg = configManager.getConfig();
    const config = this.resolveConfig(cfg);
    const model = overrideModel || config.visionModel || this.getDefaultVisionModel();

    const requestBody: BailianChatCompletionRequest = {
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: typeof maxTokens === 'number' && maxTokens > 0 ? maxTokens : 800,
    };

    const resp = await httpPostJson<BailianChatCompletionResponse>(
      `${config.baseUrl}/chat/completions`,
      requestBody,
      { Accept: "application/json" },
      options?.timeoutMs ?? 120000,
      config.apiKey
    );

    if (!resp.ok || !resp.data) {
      const msg = resp.error?.message || `Failed vision generate via Bailian: HTTP ${resp.status}`;
      logger.error("describeImageWithBailian failed", msg);
      throw new Error(msg);
    }

    const choice = resp.data.choices?.[0]?.message?.content;
    if (Array.isArray(choice)) {
      return choice
        .map((part) => (typeof part === "string" ? part : part.type === "text" ? part.text : ""))
        .join("")
        .trim();
    }
    return typeof choice === "string" ? choice.trim() : "";
  }

  public async checkServiceHealth(): Promise<boolean> {
    try {
      const cfg = configManager.getConfig();
      const config = this.resolveConfig(cfg);
      
      // Bailian uses OpenAI-compatible /models endpoint
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      try {
        const response = await fetch(`${config.baseUrl}/models`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${config.apiKey}`,
            "Accept": "application/json",
          },
          signal: controller.signal,
        });
        
        clearTimeout(timeout);
        
        if (!response.ok) {
          logger.warn("Bailian health check failed", { status: response.status });
          return false;
        }
        
        const data = await response.json() as { data?: Array<{ id: string }> };
        return Array.isArray(data.data) && data.data.length > 0;
      } catch (error) {
        clearTimeout(timeout);
        throw error;
      }
    } catch (e) {
      logger.warn("Bailian service health check failed", e as unknown);
      return false;
    }
  }
}

// Export singleton instance
export const bailianProvider = new BailianProvider();

// Export legacy function wrappers for backward compatibility
export async function embedWithBailian(inputs: string[], overrideModel?: string): Promise<number[][]> {
  return bailianProvider.embed(inputs, overrideModel);
}

export async function generateStructuredJsonWithBailian(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  schema?: Record<string, unknown>,
  temperature = 0.7,
  maxTokens = MIN_JSON_COMPLETION_TOKENS,
  overrideModel?: string
): Promise<unknown> {
  return bailianProvider.generateStructuredJson({
    messages: messages as ChatCompletionMessageParam[],
    responseFormat: schema ? { json_schema: { schema, strict: true } } : undefined,
    temperature,
    maxTokens,
    overrideModel,
  });
}

export async function describeImageWithBailian(
  imageBase64: string,
  prompt = "What is in this picture? Describe it in detail.",
  overrideModel?: string,
  timeoutMs = 120000,
  maxTokens?: number
): Promise<string> {
  return bailianProvider.describeImage([imageBase64], { prompt, overrideModel, timeoutMs, maxTokens });
}
