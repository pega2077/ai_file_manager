/**
 * llama_server LLM Provider
 * 
 * Provides integration with llama.cpp's llama_server REST API
 * which exposes OpenAI-compatible endpoints.
 * 
 * Configuration:
 * - Set `llamaServerEndpoint` to your llama_server instance (e.g., http://localhost:8080)
 * - Optional API key if your server requires authentication
 * - Configure models for chat, embedding, and vision tasks
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
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionContentPart } from "openai/resources/chat/completions";

export interface LlamaServerResolvedConfig extends ProviderResolvedConfig {
  endpoint: string;
  apiKey?: string;
  chatModel?: string;
  embedModel?: string;
  visionModel?: string;
  timeoutMs?: number;
}

/**
 * Trim trailing slashes from endpoint URL
 */
const trimEndpoint = (value?: string): string => (value ?? "").replace(/\/+$/, "");

/**
 * LlamaServerProvider - Connects to llama.cpp's llama_server OpenAI-compatible API
 */
export class LlamaServerProvider extends BaseLLMProvider {
  protected readonly providerLabel: string = "llama_server";

  protected resolveConfig(cfg: AppConfig): LlamaServerResolvedConfig {
    const section = cfg.llamaServer ?? {};
    return {
      endpoint: trimEndpoint(section.llamaServerEndpoint || cfg.llamaServerEndpoint),
      apiKey: section.llamaServerApiKey || cfg.llamaServerApiKey,
      chatModel: section.llamaServerModel || cfg.llamaServerModel,
      embedModel: section.llamaServerEmbedModel || cfg.llamaServerEmbedModel,
      visionModel: section.llamaServerVisionModel || cfg.llamaServerVisionModel,
      timeoutMs: section.llamaServerTimeoutMs || cfg.llamaServerTimeoutMs,
    };
  }

  protected getDefaultEmbedModel(): string {
    return "text-embedding-3-small";
  }

  protected getDefaultChatModel(): string {
    return "gpt-3.5-turbo";
  }

  protected getDefaultVisionModel(): string {
    return "gpt-4o-mini";
  }

  /**
   * Create OpenAI client configured for llama_server endpoint
   */
  private createClient(config: LlamaServerResolvedConfig): OpenAI {
    if (!config.endpoint) {
      throw new Error(`${this.providerLabel} endpoint not configured`);
    }

    return new OpenAI({
      apiKey: config.apiKey || "not-needed",
      baseURL: config.endpoint,
      timeout: config.timeoutMs || 60000,
    });
  }

  public async embed(inputs: string[], overrideModel?: string): Promise<number[][]> {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      return [];
    }

    const cfg = configManager.getConfig();
    const resolved = this.resolveConfig(cfg);
    const client = this.createClient(resolved);

    const model = overrideModel || resolved.embedModel || resolved.chatModel || this.getDefaultEmbedModel();
    
    logger.info("llama_server embedding request", {
      provider: this.providerLabel,
      model,
      inputCount: inputs.length,
    });

    try {
      const response = await client.embeddings.create({
        model,
        input: inputs,
      });

      if (!response.data || response.data.length === 0) {
        throw new Error("No embeddings returned from llama_server");
      }

      const embeddings = response.data.map((item) => item.embedding);
      
      if (embeddings.length !== inputs.length) {
        logger.warn("llama_server embedding count mismatch", {
          expected: inputs.length,
          received: embeddings.length,
        });
      }

      return embeddings;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("llama_server embedding failed", {
        provider: this.providerLabel,
        model,
        error: message,
      });
      throw new Error(`${this.providerLabel} embedding failed: ${message}`);
    }
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
    const resolved = this.resolveConfig(cfg);
    const client = this.createClient(resolved);

    const model = overrideModel || resolved.chatModel || this.getDefaultChatModel();
    const tokenBudget = Math.max(maxTokens, MIN_JSON_COMPLETION_TOKENS);

    logger.info("llama_server structured JSON request", {
      provider: this.providerLabel,
      model,
      messageCount: messages.length,
      hasSchema: Boolean(responseFormat?.json_schema?.schema),
    });

    try {
      const completionParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
        model,
        messages: messages as ChatCompletionMessageParam[],
        temperature,
        max_tokens: tokenBudget,
      };

      // Add response format if schema is provided
      if (responseFormat?.json_schema?.schema) {
        const normalizedSchema = this.normalizeJsonSchema(responseFormat.json_schema.schema) as Record<string, unknown>;
        completionParams.response_format = {
          type: "json_schema",
          json_schema: {
            name: responseFormat.json_schema.name || "response",
            schema: normalizedSchema,
            strict: responseFormat.json_schema.strict ?? true,
          },
        };
      }

      const response = await client.chat.completions.create(completionParams);

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No content in llama_server response");
      }

      const parsed = this.tryParseJson(content);
      if (parsed === undefined) {
        logger.error("Failed to parse JSON from llama_server", {
          provider: this.providerLabel,
          snippet: content.slice(0, 200),
        });
        throw new Error("Invalid JSON returned by llama_server");
      }

      return parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("llama_server structured JSON request failed", {
        provider: this.providerLabel,
        model,
        error: message,
      });
      throw new Error(`${this.providerLabel} structured JSON failed: ${message}`);
    }
  }

  public async describeImage(images: string[], options?: DescribeImageOptions): Promise<string> {
    if (!Array.isArray(images) || images.length === 0) {
      return "";
    }

    const cfg = configManager.getConfig();
    const resolved = this.resolveConfig(cfg);
    const client = this.createClient(resolved);

    const model = options?.overrideModel || resolved.visionModel || resolved.chatModel || this.getDefaultVisionModel();
    const prompt = options?.prompt || "What is in this image? Describe it in detail.";

    logger.info("llama_server vision request", {
      provider: this.providerLabel,
      model,
      imageCount: images.length,
    });

    try {
      // Build message with images
      const content: ChatCompletionContentPart[] = [
        { type: "text", text: prompt },
      ];

      // Add images - llama_server expects data URLs or base64
      for (const img of images) {
        const imageUrl = img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}`;
        content.push({
          type: "image_url",
          image_url: { url: imageUrl },
        });
      }

      const response = await client.chat.completions.create({
        model,
        messages: [
          {
            role: "user",
            content,
          },
        ],
        max_tokens: options?.maxTokens || 800,
      });

      const description = response.choices[0]?.message?.content || "";
      return typeof description === "string" ? description : String(description);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("llama_server vision request failed", {
        provider: this.providerLabel,
        model,
        error: message,
      });
      throw new Error(`${this.providerLabel} vision request failed: ${message}`);
    }
  }
}

// Export singleton instance
export const llamaServerProvider = new LlamaServerProvider();

// Export utility
export { trimEndpoint };
