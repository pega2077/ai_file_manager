/**
 * Llama CPP LLM Provider
 * Manages local llama-server integration with automatic server lifecycle management
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
import { llamaServerProvider } from "./LlamaServerProvider";
import type { SupportedLang } from "./promptHelper";
import { normalizeLanguage } from "./promptHelper";

export interface LlamaCppResolvedConfig extends ProviderResolvedConfig {
  endpoint: string;
  textModelPath?: string;
  visionModelPath?: string;
  visionDecoderPath?: string;
  installDir?: string;
  port: number;
  host: string;
}

const trimEndpoint = (value?: string): string => (value ?? "").replace(/\/+$/, "");

export interface LlamaCppEmbedRequest {
  content: string;
}

export interface LlamaCppEmbedResponse {
  embedding: number[];
}

export interface LlamaCppCompletionRequest {
  prompt: string;
  n_predict?: number;
  temperature?: number;
  stop?: string[];
  stream?: boolean;
  image_data?: Array<{ data: string; id?: number }>;
}

export interface LlamaCppCompletionResponse {
  content: string;
  stop: boolean;
  model?: string;
  tokens_predicted?: number;
  tokens_evaluated?: number;
  generation_settings?: Record<string, unknown>;
  prompt?: string;
  stopped_eos?: boolean;
  stopped_limit?: boolean;
  stopped_word?: boolean;
  stopping_word?: string;
  timings?: Record<string, unknown>;
}

const DEFAULT_JSON_TIMEOUT_MS = 60000;

export class LlamaCppProvider extends BaseLLMProvider {
  protected readonly providerLabel: string = "LlamaCpp";

  protected resolveConfig(cfg: AppConfig): LlamaCppResolvedConfig {
    const section = cfg.llamacpp ?? {};
    const host = section.llamacppHost || '127.0.0.1';
    const port = section.llamacppPort || 8080;
    
    return {
      endpoint: `http://${host}:${port}`,
      textModelPath: section.llamacppTextModelPath,
      visionModelPath: section.llamacppVisionModelPath,
      visionDecoderPath: section.llamacppVisionDecoderPath,
      installDir: section.llamacppInstallDir,
      port,
      host,
    };
  }

  protected getDefaultEmbedModel(): string {
    return 'text-embedding'; // Not really used, model is loaded via path
  }

  protected getDefaultChatModel(): string {
    return 'text-generation'; // Not really used, model is loaded via path
  }

  protected getDefaultVisionModel(): string {
    return 'vision-generation'; // Not really used, model is loaded via path
  }

  /**
   * Generate text embeddings
   */
  public async embed(inputs: string[], _overrideModel?: string): Promise<number[][]> {
    this.validateInputs(inputs, "embed");

    const cfg = configManager.getConfig();
    const llamaCppConfig = cfg.llamacpp;
    
    // Update server provider config
    llamaServerProvider.updateConfig(llamaCppConfig);
    
    // Ensure text model server is running
    await llamaServerProvider.ensureServerRunning('text');

    const config = this.resolveConfig(cfg);
    const url = `${config.endpoint}/embedding`;

    logger.info(`Generating embeddings for ${inputs.length} inputs via llama-server`);

    const embeddings: number[][] = [];

    for (const input of inputs) {
      try {
        const payload: LlamaCppEmbedRequest = { content: input };
        const response = await httpPostJson<LlamaCppEmbedResponse>(
          url,
          payload,
          { Accept: "application/json" },
          30000
        );

        if (!response.ok || !response.data?.embedding || !Array.isArray(response.data.embedding)) {
          throw new Error("Invalid embedding response from llama-server");
        }

        embeddings.push(response.data.embedding);
      } catch (error) {
        logger.error(`Failed to generate embedding for input: ${error}`);
        throw error;
      }
    }

    logger.info(`Generated ${embeddings.length} embeddings`);
    return embeddings;
  }

  /**
   * Generate structured JSON response
   */
  public async generateStructuredJson(params: GenerateStructuredJsonParams): Promise<unknown> {
    const { messages, responseFormat, language = "en", maxTokens } = params;

    const cfg = configManager.getConfig();
    const llamaCppConfig = cfg.llamacpp;
    
    // Update server provider config
    llamaServerProvider.updateConfig(llamaCppConfig);
    
    // Ensure text model server is running
    await llamaServerProvider.ensureServerRunning('text');

    const config = this.resolveConfig(cfg);
    const url = `${config.endpoint}/completion`;

    const lang: SupportedLang = normalizeLanguage(language);

    // Build prompt from messages
    let fullPrompt = "";
    for (const msg of messages) {
      if (msg.role === 'system') {
        fullPrompt += `${msg.content}\n\n`;
      } else if (msg.role === 'user') {
        fullPrompt += msg.content;
      }
    }

    // Append JSON format instruction
    if (responseFormat?.json_schema) {
      fullPrompt += "\n\nRespond with valid JSON only. No markdown, no explanations.";
      fullPrompt += `\nJSON Schema:\n${JSON.stringify(responseFormat.json_schema.schema, null, 2)}`;
    }

    const payload: LlamaCppCompletionRequest = {
      prompt: fullPrompt,
      temperature: params.temperature ?? 0.1,
      n_predict: maxTokens ?? MIN_JSON_COMPLETION_TOKENS,
      stream: false,
    };

    logger.info(`Generating structured JSON with llama-server`);

    try {
      const response = await httpPostJson<LlamaCppCompletionResponse>(
        url,
        payload,
        { Accept: "application/json" },
        config.timeoutMs ?? 60000
      );

      if (!response.ok || !response.data?.content) {
        throw new Error("Empty response from llama-server");
      }

      // Try to parse JSON from response
      const parsed = this.tryParseJson(response.data.content);
      return parsed;
    } catch (error) {
      logger.error("Failed to generate structured JSON:", error);
      throw error;
    }
  }

  /**
   * Describe image(s) using vision model
   */
  public async describeImage(images: string[], options?: DescribeImageOptions): Promise<string> {
    this.validateInputs(images, "describeImage");

    const cfg = configManager.getConfig();
    const llamaCppConfig = cfg.llamacpp;
    
    // Update server provider config
    llamaServerProvider.updateConfig(llamaCppConfig);
    
    // Ensure vision model server is running
    await llamaServerProvider.ensureServerRunning('vision');

    const config = this.resolveConfig(cfg);
    const url = `${config.endpoint}/completion`;
    
    // Build prompt
    const prompt = options?.prompt ?? "Describe this image in detail.";

    // Convert base64 images to llama-server format
    const imageData = images.map((base64, index) => ({
      data: base64.replace(/^data:image\/[a-z]+;base64,/, ''),
      id: index,
    }));

    const payload: LlamaCppCompletionRequest = {
      prompt,
      temperature: 0.3,
      n_predict: options?.maxTokens ?? 500,
      stream: false,
      image_data: imageData,
    };

    logger.info(`Describing ${images.length} images with llama-server vision model`);

    try {
      const response = await httpPostJson<LlamaCppCompletionResponse>(
        url,
        payload,
        { Accept: "application/json" },
        options?.timeoutMs ?? 60000
      );

      if (!response.ok || !response.data?.content) {
        throw new Error("Empty response from llama-server");
      }

      logger.info("Image description completed");
      return response.data.content;
    } catch (error) {
      logger.error("Failed to describe image:", error);
      throw error;
    }
  }

  public async checkServiceHealth(): Promise<boolean> {
    try {
      const cfg = configManager.getConfig();
      const config = this.resolveConfig(cfg);
      
      if (!config.endpoint) {
        logger.warn("LlamaCpp endpoint not configured");
        return false;
      }
      
      // LlamaCpp server has a /health endpoint
      const url = `${config.endpoint}/health`;
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      try {
        const response = await fetch(url, {
          method: "GET",
          signal: controller.signal,
        });
        
        clearTimeout(timeout);
        
        // If the health endpoint returns OK, service is healthy
        return response.ok;
      } catch (error) {
        clearTimeout(timeout);
        throw error;
      }
    } catch (e) {
      logger.warn("LlamaCpp service health check failed", e as unknown);
      return false;
    }
  }
}

// Export singleton instance
export const llamaCppProvider = new LlamaCppProvider();
