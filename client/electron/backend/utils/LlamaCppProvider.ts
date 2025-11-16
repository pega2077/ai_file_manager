/**
 * LlamaCpp LLM Provider
 * Provides local LLM inference using node-llama-cpp
 * Supports model downloading, embeddings, structured JSON, and vision
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
import type { SupportedLang } from "./promptHelper";
import { normalizeLanguage } from "./promptHelper";
import {
  getLlama,
  type Llama,
  type LlamaModel,
  type LlamaContext,
  type LlamaChatSession,
  LlamaChatSession as LlamaChatSessionClass,
  createModelDownloader,
  type ModelDownloaderOptions,
} from "node-llama-cpp";
import path from "path";
import fs from "fs";
import os from "os";
import { app } from "electron";

export interface LlamaCppResolvedConfig extends ProviderResolvedConfig {
  modelsDirectory?: string;
  chatModelPath?: string;
  embedModelPath?: string;
  visionModelPath?: string;
  contextSize?: number;
  gpuLayers?: number;
  threads?: number;
}

const DEFAULT_JSON_TIMEOUT_MS = 60000;
const DEFAULT_CONTEXT_SIZE = 4096;
const DEFAULT_GPU_LAYERS = -1; // Auto-detect

/**
 * Get default models directory path
 */
function getDefaultModelsDirectory(): string {
  const userDataPath = app.getPath("userData");
  return path.join(userDataPath, "llama-models");
}

/**
 * Ensure models directory exists
 */
function ensureModelsDirectory(modelsDir: string): void {
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
    logger.info(`Created models directory: ${modelsDir}`);
  }
}

export class LlamaCppProvider extends BaseLLMProvider {
  protected readonly providerLabel: string = "LlamaCpp";
  
  // Singleton instances for reuse
  private llamaInstance: Llama | null = null;
  private loadedModels: Map<string, LlamaModel> = new Map();
  private contexts: Map<string, LlamaContext> = new Map();
  private chatSessions: Map<string, LlamaChatSession> = new Map();

  protected resolveConfig(cfg: AppConfig): LlamaCppResolvedConfig {
    const section = cfg.llamacpp ?? {};
    return {
      modelsDirectory: section.modelsDirectory || cfg.modelsDirectory || getDefaultModelsDirectory(),
      chatModelPath: section.chatModelPath || cfg.chatModelPath,
      embedModelPath: section.embedModelPath || cfg.embedModelPath,
      visionModelPath: section.visionModelPath || cfg.visionModelPath,
      contextSize: section.contextSize || cfg.contextSize || DEFAULT_CONTEXT_SIZE,
      gpuLayers: section.gpuLayers !== undefined ? section.gpuLayers : (cfg.gpuLayers !== undefined ? cfg.gpuLayers : DEFAULT_GPU_LAYERS),
      threads: section.threads || cfg.threads || os.cpus().length,
    };
  }

  protected getDefaultEmbedModel(): string {
    return "nomic-embed-text-v1.5.Q4_K_M.gguf";
  }

  protected getDefaultChatModel(): string {
    return "Meta-Llama-3.1-8B-Instruct.Q4_K_M.gguf";
  }

  protected getDefaultVisionModel(): string {
    return "llava-v1.6-vicuna-7b.Q4_K_M.gguf";
  }

  /**
   * Get or initialize Llama instance
   */
  private async getLlamaInstance(): Promise<Llama> {
    if (!this.llamaInstance) {
      logger.info("Initializing Llama instance");
      this.llamaInstance = await getLlama();
      logger.info("Llama instance initialized successfully");
    }
    return this.llamaInstance;
  }

  /**
   * Load a model from file path
   */
  private async loadModel(modelPath: string, config: LlamaCppResolvedConfig): Promise<LlamaModel> {
    // Check if model is already loaded
    if (this.loadedModels.has(modelPath)) {
      logger.info(`Using cached model: ${modelPath}`);
      return this.loadedModels.get(modelPath)!;
    }

    // Verify model file exists
    if (!fs.existsSync(modelPath)) {
      throw new Error(`Model file not found: ${modelPath}`);
    }

    logger.info(`Loading model: ${modelPath}`);
    const llama = await this.getLlamaInstance();
    
    const model = await llama.loadModel({
      modelPath,
      gpuLayers: config.gpuLayers,
    });

    this.loadedModels.set(modelPath, model);
    logger.info(`Model loaded successfully: ${modelPath}`);
    return model;
  }

  /**
   * Get or create a context for a model
   */
  private async getContext(modelPath: string, config: LlamaCppResolvedConfig): Promise<LlamaContext> {
    const contextKey = `${modelPath}:${config.contextSize}`;
    
    if (this.contexts.has(contextKey)) {
      return this.contexts.get(contextKey)!;
    }

    const model = await this.loadModel(modelPath, config);
    const context = await model.createContext({
      contextSize: config.contextSize,
      threads: config.threads,
    });

    this.contexts.set(contextKey, context);
    logger.info(`Context created for model: ${modelPath}`);
    return context;
  }

  /**
   * Download a model from HuggingFace or other sources
   */
  public async downloadModel(
    modelUrl: string,
    fileName?: string,
    options?: Partial<ModelDownloaderOptions>
  ): Promise<string> {
    const cfg = configManager.getConfig();
    const resolved = this.resolveConfig(cfg);
    const modelsDir = resolved.modelsDirectory!;
    
    ensureModelsDirectory(modelsDir);

    const modelFileName = fileName || path.basename(modelUrl);
    const outputPath = path.join(modelsDir, modelFileName);

    // Check if model already exists
    if (fs.existsSync(outputPath)) {
      logger.info(`Model already exists: ${outputPath}`);
      return outputPath;
    }

    logger.info(`Downloading model from: ${modelUrl}`);
    logger.info(`Output path: ${outputPath}`);

    const downloader = await createModelDownloader({
      modelUri: modelUrl,
      dirPath: modelsDir,
      fileName: modelFileName,
      ...options,
    });

    await downloader.download();
    logger.info(`Model downloaded successfully: ${outputPath}`);
    
    return outputPath;
  }

  /**
   * List downloaded models in the models directory
   */
  public async listModels(): Promise<string[]> {
    const cfg = configManager.getConfig();
    const resolved = this.resolveConfig(cfg);
    const modelsDir = resolved.modelsDirectory!;

    if (!fs.existsSync(modelsDir)) {
      return [];
    }

    const files = fs.readdirSync(modelsDir);
    return files.filter(file => file.endsWith('.gguf'));
  }

  /**
   * Get model file path, downloading if necessary
   */
  private async getModelPath(
    configuredPath: string | undefined,
    defaultModel: string,
    modelsDir: string
  ): Promise<string> {
    if (configuredPath) {
      // Use absolute path if provided
      if (path.isAbsolute(configuredPath)) {
        if (fs.existsSync(configuredPath)) {
          return configuredPath;
        }
        throw new Error(`Model file not found: ${configuredPath}`);
      }
      
      // Try relative to models directory
      const fullPath = path.join(modelsDir, configuredPath);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
      throw new Error(`Model file not found: ${fullPath}`);
    }

    // Use default model name and check if it exists
    const defaultPath = path.join(modelsDir, defaultModel);
    if (fs.existsSync(defaultPath)) {
      return defaultPath;
    }

    // Model not found, user needs to download it
    throw new Error(
      `No model found. Please configure a model path or download a model. ` +
      `Expected location: ${defaultPath}`
    );
  }

  public async embed(inputs: string[], overrideModel?: string): Promise<number[][]> {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      return [];
    }

    const cfg = configManager.getConfig();
    const resolved = this.resolveConfig(cfg);
    const modelsDir = resolved.modelsDirectory!;
    
    ensureModelsDirectory(modelsDir);

    const modelPath = await this.getModelPath(
      overrideModel || resolved.embedModelPath,
      this.getDefaultEmbedModel(),
      modelsDir
    );

    logger.info(`Generating embeddings with model: ${modelPath}`);
    
    const model = await this.loadModel(modelPath, resolved);
    const embeddings: number[][] = [];

    // Generate embeddings for each input
    for (const input of inputs) {
      const context = await model.createEmbeddingContext();
      const embedding = await context.getEmbeddingFor(input);
      embeddings.push(Array.from(embedding.vector));
      
      // Dispose context after use to free memory
      await context.dispose();
    }

    logger.info(`Generated ${embeddings.length} embeddings`);
    return embeddings;
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
    const modelsDir = resolved.modelsDirectory!;
    
    ensureModelsDirectory(modelsDir);

    const modelPath = await this.getModelPath(
      overrideModel || resolved.chatModelPath,
      this.getDefaultChatModel(),
      modelsDir
    );

    const usedLang = normalizeLanguage(language ?? cfg.language ?? "en", "en");
    logger.info("Structured JSON request", {
      provider: this.providerLabel,
      lang: usedLang,
      modelPath,
      schema: Boolean(responseFormat?.json_schema?.schema),
    });

    const context = await this.getContext(modelPath, resolved);
    const session = new LlamaChatSessionClass({
      contextSequence: context.getSequence(),
    });

    // Build the prompt with schema instructions
    let systemPrompt = usedLang === "zh"
      ? "你是一个有用的助手。请用JSON格式回答。"
      : "You are a helpful assistant. Please respond in JSON format.";

    if (responseFormat?.json_schema?.schema) {
      const schemaStr = JSON.stringify(responseFormat.json_schema.schema, null, 2);
      systemPrompt += usedLang === "zh"
        ? `\n\n严格遵守以下JSON Schema：\n${schemaStr}\n\n只输出有效的JSON，不要包含任何额外的文本或反引号。`
        : `\n\nStrictly conform to this JSON Schema:\n${schemaStr}\n\nOutput only valid JSON, do not include any extra text or backticks.`;
    }

    // Combine system prompt with messages
    const allMessages = [
      { role: "system" as const, content: systemPrompt },
      ...messages,
    ];

    // Build conversation history
    for (let i = 0; i < allMessages.length - 1; i++) {
      const msg = allMessages[i];
      if (msg.role === "user") {
        const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        await session.prompt(content);
      } else if (msg.role === "system") {
        // System messages are typically handled by the chat wrapper
        continue;
      }
    }

    // Get the last user message
    const lastMsg = allMessages[allMessages.length - 1];
    const lastContent = typeof lastMsg.content === "string" 
      ? lastMsg.content 
      : JSON.stringify(lastMsg.content);

    // Generate response
    const response = await session.prompt(lastContent, {
      temperature,
      maxTokens,
    });

    logger.info("Generated response", {
      provider: this.providerLabel,
      responseLength: response.length,
    });

    // Parse JSON from response
    const parsed = this.tryParseJson(response);
    if (parsed !== undefined) {
      return parsed;
    }

    logger.error("Failed to parse JSON response", {
      provider: this.providerLabel,
      snippet: response.slice(0, 200),
    });
    throw new Error("Invalid JSON returned by model");
  }

  public async describeImage(images: string[], options?: DescribeImageOptions): Promise<string> {
    if (!Array.isArray(images) || images.length === 0) {
      return "";
    }

    const cfg = configManager.getConfig();
    const resolved = this.resolveConfig(cfg);
    const modelsDir = resolved.modelsDirectory!;
    
    ensureModelsDirectory(modelsDir);

    const modelPath = await this.getModelPath(
      options?.overrideModel || resolved.visionModelPath,
      this.getDefaultVisionModel(),
      modelsDir
    );

    logger.info("Vision request", {
      provider: this.providerLabel,
      modelPath,
      imageCount: images.length,
    });

    const context = await this.getContext(modelPath, resolved);
    const session = new LlamaChatSessionClass({
      contextSequence: context.getSequence(),
    });

    const prompt = options?.prompt || "What is in this picture? Describe it in detail.";
    
    // Note: Vision support in node-llama-cpp requires specific model formats
    // This is a basic implementation - may need adjustment based on the actual vision model
    const response = await session.prompt(prompt, {
      maxTokens: options?.maxTokens || 500,
    });

    logger.info("Vision response generated", {
      provider: this.providerLabel,
      responseLength: response.length,
    });

    return response;
  }

  /**
   * Clean up resources
   */
  public async dispose(): Promise<void> {
    logger.info("Disposing LlamaCpp provider resources");
    
    // Dispose chat sessions
    for (const [key, session] of this.chatSessions) {
      // LlamaChatSession doesn't have a dispose method in current version
      this.chatSessions.delete(key);
    }

    // Dispose contexts
    for (const [key, context] of this.contexts) {
      await context.dispose();
      this.contexts.delete(key);
    }

    // Dispose models
    for (const [key, model] of this.loadedModels) {
      await model.dispose();
      this.loadedModels.delete(key);
    }

    // Dispose llama instance
    if (this.llamaInstance) {
      await this.llamaInstance.dispose();
      this.llamaInstance = null;
    }

    logger.info("LlamaCpp provider resources disposed");
  }
}

// Export singleton instance
export const llamaCppProvider = new LlamaCppProvider();
