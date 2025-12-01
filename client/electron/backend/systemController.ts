import type { Request, Response, Express } from "express";
import type { Transaction } from "sequelize";
import fs from "fs";
import { promises as fsp } from "fs";
import { logger } from "../logger";
import { getSequelize } from "./db";
import { getGlobalIndexPath } from "./utils/vectorStore";
import { providerFactory, type ProviderType } from "./utils/LLMProviderFactory";
import { configManager } from "../configManager";

interface ModelInfo {
  id: string;
  name: string;
}

interface ModelsResponse {
  models: ModelInfo[];
  chatModels: ModelInfo[];
  visionModels: ModelInfo[];
  embedModels: ModelInfo[];
}

// Type guard helpers for API response validation
interface OllamaModelsData {
  models?: Array<{ name: string; details?: { family?: string } }>;
}

interface OpenAIModelsData {
  data?: Array<{ id: string }>;
}

interface OpenRouterModelsData {
  data?: Array<{ id: string; name?: string }>;
}

interface PegaStatusData {
  ollama?: { available: boolean; models?: string[] };
  openrouter?: { available: boolean; models?: string[] };
}

const isOllamaModelsData = (data: unknown): data is OllamaModelsData => {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return d.models === undefined || Array.isArray(d.models);
};

const isOpenAIModelsData = (data: unknown): data is OpenAIModelsData => {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return d.data === undefined || Array.isArray(d.data);
};

const isOpenRouterModelsData = (data: unknown): data is OpenRouterModelsData => {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return d.data === undefined || Array.isArray(d.data);
};

const isPegaStatusData = (data: unknown): data is PegaStatusData => {
  if (typeof data !== 'object' || data === null) return false;
  return true;
};

// Route handlers for system-level operations
const status = (_req: Request, res: Response) => {
  res.json({ status: "healthy" });
};

// Check LLM provider health status
const checkProviderHealth = async (req: Request, res: Response) => {
  try {
    const { provider } = req.body as { provider?: ProviderType };
    
    if (provider) {
      // Check single provider
      if (!providerFactory.hasProvider(provider)) {
        return res.status(400).json({
          success: false,
          error: {
            code: "INVALID_PROVIDER",
            message: `Provider '${provider}' is not registered`,
          },
        });
      }
      
      const isHealthy = await providerFactory.checkProviderHealth(provider);
      return res.json({
        success: true,
        message: "Provider health check completed",
        data: {
          provider,
          healthy: isHealthy,
        },
      });
    } else {
      // Check all providers
      const healthStatus = await providerFactory.checkAllProvidersHealth();
      const result: Record<string, boolean> = {};
      healthStatus.forEach((isHealthy, providerType) => {
        result[providerType] = isHealthy;
      });
      
      return res.json({
        success: true,
        message: "Provider health check completed",
        data: result,
      });
    }
  } catch (err) {
    logger.error("Provider health check failed", err as unknown);
    res.status(500).json({
      success: false,
      error: {
        code: "HEALTH_CHECK_FAILED",
        message: (err as Error).message || "Internal error",
      },
    });
  }
};

// Fetch available models from a provider
const listProviderModels = async (req: Request, res: Response) => {
  try {
    const { provider } = req.body as { provider?: ProviderType };
    
    if (!provider) {
      return res.status(400).json({
        success: false,
        error: {
          code: "MISSING_PROVIDER",
          message: "Provider is required",
        },
      });
    }

    const cfg = configManager.getConfig();
    let models: ModelInfo[] = [];
    let chatModels: ModelInfo[] = [];
    let visionModels: ModelInfo[] = [];
    let embedModels: ModelInfo[] = [];

    switch (provider) {
      case "ollama": {
        // Fetch models from Ollama API
        const endpoint = cfg.ollama?.ollamaEndpoint || cfg.ollamaEndpoint || "http://127.0.0.1:11434";
        const apiKey = cfg.ollama?.ollamaApiKey || cfg.ollamaApiKey;
        try {
          const headers: Record<string, string> = { "Accept": "application/json" };
          if (apiKey) {
            headers.Authorization = `Bearer ${apiKey}`;
          }
          const response = await fetch(`${endpoint}/api/tags`, {
            method: "GET",
            headers,
          });
          if (response.ok) {
            const rawData: unknown = await response.json();
            if (isOllamaModelsData(rawData) && Array.isArray(rawData.models)) {
              models = rawData.models.map((m) => ({ id: m.name, name: m.name }));
              // All models in Ollama can potentially be used for chat
              chatModels = models;
              // Vision models typically have 'vl' or 'vision' in their name
              visionModels = models.filter((m) => 
                m.id.toLowerCase().includes('vl') || 
                m.id.toLowerCase().includes('vision') ||
                m.id.toLowerCase().includes('llava')
              );
              // Embedding models typically have 'embed' or 'bge' in their name
              embedModels = models.filter((m) => 
                m.id.toLowerCase().includes('embed') || 
                m.id.toLowerCase().includes('bge') ||
                m.id.toLowerCase().includes('nomic')
              );
            }
          }
        } catch (e) {
          logger.warn("Failed to fetch Ollama models", e as unknown);
        }
        break;
      }

      case "openai":
      case "azure-openai": {
        // Fetch models from OpenAI API
        const endpoint = cfg.openai?.openaiEndpoint || cfg.openaiEndpoint || "https://api.openai.com/v1";
        const apiKey = cfg.openai?.openaiApiKey || cfg.openaiApiKey || process.env.OPENAI_API_KEY;
        if (apiKey) {
          try {
            const response = await fetch(`${endpoint}/models`, {
              method: "GET",
              headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Accept": "application/json",
              },
            });
            if (response.ok) {
              const rawData: unknown = await response.json();
              if (isOpenAIModelsData(rawData) && Array.isArray(rawData.data)) {
                models = rawData.data.map((m) => ({ id: m.id, name: m.id }));
                // Chat models (gpt-*)
                chatModels = models.filter((m) => 
                  m.id.startsWith('gpt-') || 
                  m.id.includes('turbo') ||
                  m.id.includes('o1-') ||
                  m.id.includes('o3-')
                );
                // Vision models (gpt-4o, gpt-4-vision, etc.)
                visionModels = models.filter((m) => 
                  m.id.includes('vision') || 
                  m.id.includes('4o') ||
                  m.id.includes('o1')
                );
                // Embedding models
                embedModels = models.filter((m) => 
                  m.id.includes('embedding') || 
                  m.id.includes('embed')
                );
              }
            }
          } catch (e) {
            logger.warn("Failed to fetch OpenAI models", e as unknown);
          }
        }
        break;
      }

      case "openrouter": {
        // Fetch models from OpenRouter API
        const endpoint = cfg.openrouter?.openrouterEndpoint || "https://openrouter.ai/api/v1";
        const apiKey = cfg.openrouter?.openrouterApiKey || process.env.OPENROUTER_API_KEY;
        try {
          const headers: Record<string, string> = { "Accept": "application/json" };
          if (apiKey) {
            headers.Authorization = `Bearer ${apiKey}`;
          }
          const response = await fetch(`${endpoint}/models`, {
            method: "GET",
            headers,
          });
          if (response.ok) {
            const rawData: unknown = await response.json();
            if (isOpenRouterModelsData(rawData) && Array.isArray(rawData.data)) {
              models = rawData.data.map((m) => ({ id: m.id, name: m.name || m.id }));
              // All OpenRouter models can be used for chat
              chatModels = models;
              // Vision models
              visionModels = models.filter((m) => 
                m.id.toLowerCase().includes('vision') || 
                m.id.toLowerCase().includes('vl') ||
                m.id.toLowerCase().includes('4o') ||
                m.id.toLowerCase().includes('gemini')
              );
            }
          }

          // Fetch embedding models from dedicated API
          const embedResponse = await fetch(`${endpoint}/embeddings/models`, {
            method: "GET",
            headers,
          });
          if (embedResponse.ok) {
            const embedRawData: unknown = await embedResponse.json();
            if (isOpenRouterModelsData(embedRawData) && Array.isArray(embedRawData.data)) {
              embedModels = embedRawData.data.map((m) => ({ id: m.id, name: m.name || m.id }));
            }
          }
        } catch (e) {
          logger.warn("Failed to fetch OpenRouter models", e as unknown);
        }
        break;
      }

      case "bailian": {
        // Bailian uses DashScope API
        const endpoint = cfg.bailian?.bailianEndpoint || cfg.bailianEndpoint || "https://dashscope.aliyuncs.com/compatible-mode/v1";
        const apiKey = cfg.bailian?.bailianApiKey || cfg.bailianApiKey || process.env.DASHSCOPE_API_KEY;
        if (apiKey) {
          try {
            const response = await fetch(`${endpoint}/models`, {
              method: "GET",
              headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Accept": "application/json",
              },
            });
            if (response.ok) {
              const rawData: unknown = await response.json();
              if (isOpenAIModelsData(rawData) && Array.isArray(rawData.data)) {
                models = rawData.data.map((m) => ({ id: m.id, name: m.id }));
                chatModels = models.filter((m) => 
                  m.id.includes('qwen') || 
                  m.id.includes('turbo') ||
                  m.id.includes('plus')
                );
                visionModels = models.filter((m) => 
                  m.id.includes('vl')
                );
                embedModels = models.filter((m) => 
                  m.id.includes('embedding')
                );
              }
            }
          } catch (e) {
            logger.warn("Failed to fetch Bailian models", e as unknown);
          }
        }
        // Add default Bailian models if API fails
        if (models.length === 0) {
          chatModels = [
            { id: 'qwen-plus', name: 'Qwen Plus' },
            { id: 'qwen-turbo', name: 'Qwen Turbo' },
            { id: 'qwen-max', name: 'Qwen Max' },
          ];
          visionModels = [
            { id: 'qwen-vl-plus', name: 'Qwen VL Plus' },
            { id: 'qwen-vl-max', name: 'Qwen VL Max' },
          ];
          embedModels = [
            { id: 'text-embedding-v1', name: 'Text Embedding V1' },
            { id: 'text-embedding-v2', name: 'Text Embedding V2' },
          ];
          models = [...chatModels, ...visionModels, ...embedModels];
        }
        break;
      }

      case "pega": {
        // Pega provides models through its gateway
        const endpoint = cfg.pega?.pegaEndpoint || "https://llm.pegamob.com";
        const apiKey = cfg.pega?.pegaApiKey || cfg.pega?.pegaAuthToken;
        const pegaMode = cfg.pega?.pegaMode || "openrouter";
        
        try {
          const headers: Record<string, string> = { "Accept": "application/json" };
          if (apiKey) {
            headers.Authorization = `Bearer ${apiKey}`;
          }
          const response = await fetch(`${endpoint}/status`, {
            method: "GET",
            headers,
          });
          if (response.ok) {
            const rawData: unknown = await response.json();
            if (isPegaStatusData(rawData)) {
              // Use models from the active mode
              if (pegaMode === "ollama" && rawData.ollama?.models) {
                models = rawData.ollama.models.map((m) => ({ id: m, name: m }));
              } else if (pegaMode === "openrouter" && rawData.openrouter?.models) {
                models = rawData.openrouter.models.map((m) => ({ id: m, name: m }));
              }
              
              chatModels = models;
              visionModels = models.filter((m) => 
                m.id.toLowerCase().includes('vl') || 
                m.id.toLowerCase().includes('vision')
              );
              embedModels = models.filter((m) => 
                m.id.toLowerCase().includes('embed') || 
                m.id.toLowerCase().includes('bge')
              );
            }
          }
        } catch (e) {
          logger.warn("Failed to fetch Pega models", e as unknown);
        }
        
        // Add default Pega models if API fails
        if (models.length === 0) {
          if (pegaMode === "ollama") {
            chatModels = [
              { id: 'qwen3:8b', name: 'Qwen 3 8B' },
              { id: 'qwen3:14b', name: 'Qwen 3 14B' },
            ];
            visionModels = [
              { id: 'qwen2.5vl:7b', name: 'Qwen 2.5 VL 7B' },
            ];
            embedModels = [
              { id: 'bge-m3', name: 'BGE M3' },
            ];
          } else {
            chatModels = [
              { id: 'openai/gpt-oss-20b:free', name: 'GPT OSS 20B (Free)' },
              { id: 'google/gemma-3-12b-it:free', name: 'Gemma 3 12B (Free)' },
            ];
            visionModels = [
              { id: 'qwen/qwen2.5-vl-32b-instruct:free', name: 'Qwen 2.5 VL 32B (Free)' },
            ];
            embedModels = [
              { id: 'all-MiniLM-L6-v2', name: 'MiniLM L6 v2' },
            ];
          }
          models = [...chatModels, ...visionModels, ...embedModels];
        }
        break;
      }

      case "llamacpp": {
        // LlamaCpp uses local models - return configured models
        chatModels = [{ id: 'default', name: 'Local Text Model' }];
        visionModels = [{ id: 'default', name: 'Local Vision Model' }];
        embedModels = []; // LlamaCpp doesn't typically support embeddings
        models = [...chatModels, ...visionModels];
        break;
      }

      default:
        return res.status(400).json({
          success: false,
          error: {
            code: "INVALID_PROVIDER",
            message: `Provider '${provider}' is not supported`,
          },
        });
    }

    return res.json({
      success: true,
      message: "Models fetched successfully",
      data: {
        models,
        chatModels,
        visionModels,
        embedModels,
      } as ModelsResponse,
    });
  } catch (err) {
    logger.error("Failed to list provider models", err as unknown);
    res.status(500).json({
      success: false,
      error: {
        code: "LIST_MODELS_FAILED",
        message: (err as Error).message || "Internal error",
      },
    });
  }
};

// Clear all application data: SQLite rows and vector index
const clearData = async (_req: Request, res: Response) => {
  try {
    const sequelize = getSequelize();
    // 1) Clear SQLite tables (order matters due to FK: chunks -> files)
    await sequelize.transaction(async (transaction: Transaction) => {
      await sequelize.query("DELETE FROM chunks;", { transaction });
      await sequelize.query("DELETE FROM files;", { transaction });
    });
    // VACUUM outside of transaction (SQLite requirement)
    try {
      await sequelize.query("VACUUM;");
    } catch (e) {
      logger.warn("VACUUM failed after clearing tables (non-fatal)", e as unknown);
    }

    // 2) Remove FAISS vector index file if it exists
    const vectorDbPath = getGlobalIndexPath();
    try {
      await fsp.access(vectorDbPath, fs.constants.F_OK);
      await fsp.unlink(vectorDbPath);
      logger.info(`Deleted FAISS index file: ${vectorDbPath}`);
    } catch {
      // File not found is fine; treat as already cleared
    }

    res.status(200).json({ success: true, message: "cleared" });
  } catch (err) {
    logger.error("/api/system/clear-data failed", err as unknown);
    res.status(500).json({ success: false, message: "internal_error" });
  }
};

export const registerSystemRoutes = (app: Express) => {
  // Health endpoints
  app.get("/api/system/status", status);
  // Provider health check
  app.post("/api/providers/health", checkProviderHealth);
  // List provider models
  app.post("/api/providers/models", listProviderModels);
  // Dangerous operation: clear all app data (DB + vector index)
  app.post("/api/system/clear-data", clearData);
};
