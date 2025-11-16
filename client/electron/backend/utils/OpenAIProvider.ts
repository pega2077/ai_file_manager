/**
 * OpenAI LLM Provider
 * Uses official OpenAI SDK for API interactions
 */

import OpenAI from "openai";
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

export class OpenAIProvider extends BaseLLMProvider {
  protected readonly providerLabel = "OpenAI";

  protected resolveConfig(cfg: AppConfig): ProviderResolvedConfig {
    const oc = cfg.openai || {};
    const apiKey = ((oc.openaiApiKey || cfg.openaiApiKey) || process.env.OPENAI_API_KEY || "").trim();
    const baseUrl = ((oc.openaiEndpoint || cfg.openaiEndpoint) || "https://api.openai.com/v1").replace(/\/$/, "");
    
    if (!apiKey) {
      throw new Error("OpenAI API key is not configured. Set in config.json or OPENAI_API_KEY env.");
    }

    return {
      baseUrl,
      apiKey,
      chatModel: oc.openaiModel || cfg.openaiModel,
      embedModel: oc.openaiEmbedModel || cfg.openaiEmbedModel,
      visionModel: oc.openaiVisionModel || oc.openaiModel || cfg.openaiVisionModel || cfg.openaiModel,
    };
  }

  protected getDefaultEmbedModel(): string {
    return "text-embedding-3-large";
  }

  protected getDefaultChatModel(): string {
    return "gpt-4o-mini";
  }

  protected getDefaultVisionModel(): string {
    return "gpt-4o-mini";
  }

  private getClient(): OpenAI {
    const config = this.resolveConfig(configManager.getConfig());
    return new OpenAI({ 
      apiKey: config.apiKey!, 
      baseURL: config.baseUrl 
    });
  }

  public async embed(inputs: string[], overrideModel?: string): Promise<number[][]> {
    if (!Array.isArray(inputs) || inputs.length === 0) return [];
    
    const cfg = configManager.getConfig();
    const config = this.resolveConfig(cfg);
    const model = overrideModel || config.embedModel || this.getDefaultEmbedModel();
    const client = this.getClient();

    try {
      const resp = await client.embeddings.create({ model, input: inputs });
      return resp.data.map((d) => d.embedding as number[]);
    } catch (e) {
      logger.error("embedWithOpenAI failed", e as unknown);
      throw e;
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
    const config = this.resolveConfig(cfg);
    const model = overrideModel || config.chatModel || this.getDefaultChatModel();
    const client = this.getClient();

    try {
      const schema = responseFormat?.json_schema?.schema;
      const normalizedSchema = schema ? (this.normalizeJsonSchema(schema) as Record<string, unknown>) : undefined;
      
      const tokenBudget = Math.max(maxTokens, MIN_JSON_COMPLETION_TOKENS);

      const resp = await client.chat.completions.create({
        model,
        temperature,
        max_tokens: tokenBudget,
        messages: messages as ChatCompletionMessageParam[],
        response_format: normalizedSchema
          ? { type: "json_schema", json_schema: { name: "schema", schema: normalizedSchema, strict: true } }
          : { type: "json_object" },
      });

      const text = resp.choices?.[0]?.message?.content || "";
      try {
        return JSON.parse(text);
      } catch {
        const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (match) return JSON.parse(match[0]);
        throw new Error("Model did not return valid JSON");
      }
    } catch (e) {
      logger.error("generateStructuredJsonWithOpenAI failed", e as unknown);
      throw e;
    }
  }

  public async describeImage(images: string[], options?: DescribeImageOptions): Promise<string> {
    if (!Array.isArray(images) || images.length === 0) {
      return "";
    }

    const imageBase64 = images[0]; // OpenAI handles single image at a time
    const prompt = options?.prompt || "What is in this picture? Describe it in detail.";
    const maxTokens = options?.maxTokens;
    const overrideModel = options?.overrideModel;

    const cfg = configManager.getConfig();
    const config = this.resolveConfig(cfg);
    const model = overrideModel || config.visionModel || this.getDefaultVisionModel();
    const client = this.getClient();

    try {
      const content: ChatCompletionContentPart[] = [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
      ];

      const resp = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content }],
        temperature: 0.2,
        max_tokens: typeof maxTokens === 'number' && maxTokens > 0 ? maxTokens : 800,
      });

      const out = resp.choices?.[0]?.message?.content || "";
      return out;
    } catch (e) {
      logger.error("describeImageWithOpenAI failed", e as unknown);
      throw e;
    }
  }
}

// Export singleton instance
export const openAIProvider = new OpenAIProvider();

// Export legacy function wrappers for backward compatibility
export async function embedWithOpenAI(inputs: string[], overrideModel?: string): Promise<number[][]> {
  return openAIProvider.embed(inputs, overrideModel);
}

export async function generateStructuredJsonWithOpenAI(
  messages: ChatCompletionMessageParam[],
  schema?: Record<string, unknown>,
  temperature = 0.7,
  maxTokens = MIN_JSON_COMPLETION_TOKENS,
  overrideModel?: string
): Promise<unknown> {
  return openAIProvider.generateStructuredJson({
    messages,
    responseFormat: schema ? { json_schema: { schema, strict: true } } : undefined,
    temperature,
    maxTokens,
    overrideModel,
  });
}

export async function describeImageWithOpenAI(
  imageBase64: string,
  prompt = "What is in this picture? Describe it in detail.",
  overrideModel?: string,
  maxTokens?: number
): Promise<string> {
  return openAIProvider.describeImage([imageBase64], { prompt, overrideModel, maxTokens });
}
