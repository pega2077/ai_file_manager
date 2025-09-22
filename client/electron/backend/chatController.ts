import type { Express, Request, Response } from "express";
import { generateStructuredJsonWithOllama } from "./utils/ollama";
import { logger } from "../logger";
import { configManager } from "../configManager";

export function registerChatRoutes(app: Express) {
  // POST /api/chat/recommend-directory
  app.post("/api/chat/recommend-directory", chatRecommendDirectoryHandler);
  // POST /api/chat/directory-structure
  app.post("/api/chat/directory-structure", chatDirectoryStructureHandler);
}

type ChatRecommendBody = {
  file_name?: unknown;
  file_content?: unknown;
  current_structure?: unknown;
  temperature?: unknown;
  max_tokens?: unknown;
};

export async function chatRecommendDirectoryHandler(req: Request, res: Response): Promise<void> {
  try {
    const startTs = Date.now();
    const body = req.body as ChatRecommendBody | undefined;
    const fileName = typeof body?.file_name === "string" ? body.file_name : "";
    const fileContent = typeof body?.file_content === "string" ? body.file_content : "";
    const currentStructure = Array.isArray(body?.current_structure)
      ? (body!.current_structure as unknown[]).filter((v) => typeof v === "string").map((v) => String(v))
      : [];
    const temperature = typeof body?.temperature === "number" ? body.temperature : 0.7;
    const maxTokens = typeof body?.max_tokens === "number" ? body.max_tokens : 500;

    if (!fileName && !fileContent) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: { code: "INVALID_REQUEST", message: "file_name or file_content is required", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const structureStr = currentStructure.length > 0 ? currentStructure.join("\n") : "";
    const messages = [
      {
        role: "system" as const,
        content:
          "You are a file classification expert. Recommend the best directory to store the file based on its name and partial content. Output JSON strictly.",
      },
      {
        role: "user" as const,
        content: `Current structure (one per line, may be empty):\n${structureStr}\n\nFile name: ${fileName}\nFile content (partial): ${fileContent}\n\nReturn JSON: {\n  "recommended_directory": string,\n  "confidence": number,\n  "reasoning": string,\n  "alternatives": string[]\n}`,
      },
    ];

    const responseFormat = {
      json_schema: {
        name: "chat_recommend_directory_schema",
        schema: {
          type: "object",
          properties: {
            recommended_directory: { type: "string" },
            confidence: { type: "number" },
            reasoning: { type: "string" },
            alternatives: { type: "array", items: { type: "string" } },
          },
          required: ["recommended_directory", "confidence", "reasoning", "alternatives"],
        },
        strict: true,
      },
    } as const;

    let result: unknown;
    try {
      result = await generateStructuredJsonWithOllama(messages, responseFormat, temperature, maxTokens);
    } catch (err) {
      logger.error("/api/chat/recommend-directory LLM failed", err as unknown);
      res.status(500).json({
        success: false,
        message: "llm_error",
        data: null,
        error: { code: "LLM_ERROR", message: (err as Error).message, details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const obj = result as Record<string, unknown>;
    const recommended_directory = typeof obj?.recommended_directory === "string" ? (obj.recommended_directory as string) : "未分类";
    const confidence = typeof obj?.confidence === "number" ? (obj.confidence as number) : 0.0;
    const reasoning = typeof obj?.reasoning === "string" ? (obj.reasoning as string) : "";
    const alternatives = Array.isArray(obj?.alternatives) ? (obj.alternatives as unknown[]).filter((v) => typeof v === "string").map((v) => String(v)) : [];

    const cfg = configManager.getConfig();
    const responseTime = Date.now() - startTs;

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        recommended_directory,
        confidence: Math.max(0, Math.min(1, confidence)),
        reasoning,
        alternatives,
        metadata: {
          model_used: cfg.ollamaModel || "",
          tokens_used: 0,
          response_time_ms: responseTime,
          generation_time_ms: responseTime,
        },
      },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/chat/recommend-directory failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Recommend directory failed", details: null },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

type ChatDirectoryStructureBody = {
  profession?: unknown;
  purpose?: unknown;
  min_directories?: unknown; // default 6
  max_directories?: unknown; // default 20
  temperature?: unknown; // default 0.7
  max_tokens?: unknown; // default 1000
};

export async function chatDirectoryStructureHandler(req: Request, res: Response): Promise<void> {
  try {
    const startTs = Date.now();
    const body = req.body as ChatDirectoryStructureBody | undefined;
    const profession = typeof body?.profession === "string" ? body.profession.trim() : "";
    const purpose = typeof body?.purpose === "string" ? body.purpose.trim() : "";
    const minDirsRaw = typeof body?.min_directories === "number" ? body.min_directories : 6;
    const maxDirsRaw = typeof body?.max_directories === "number" ? body.max_directories : 20;
    const temperature = typeof body?.temperature === "number" ? body.temperature : 0.7;
    const maxTokens = typeof body?.max_tokens === "number" ? body.max_tokens : 1000;

    if (!profession || !purpose) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: { code: "INVALID_REQUEST", message: "profession and purpose are required", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const minDirectories = Math.max(1, Math.min(50, Math.floor(minDirsRaw)));
    const maxDirectories = Math.max(minDirectories, Math.min(100, Math.floor(maxDirsRaw)));

    const messages = [
      {
        role: "system" as const,
        content:
          "You are a helpful assistant that designs practical, hierarchical directory structures. Output strictly valid JSON only.",
      },
      {
        role: "user" as const,
        content:
          `Profession: ${profession}\nPurpose: ${purpose}\n\nPlease propose a clear directory structure with between ${minDirectories} and ${maxDirectories} directories (flat or hierarchical using '/' to indicate subfolders).\nFocus on real-world usefulness for organizing documents.\nReturn JSON: {\n  "directories": string[],\n  "metadata": {\n    "description": string\n  }\n}`,
      },
    ];

    const responseFormat = {
      json_schema: {
        name: "directory_structure_schema",
        schema: {
          type: "object",
          properties: {
            directories: { type: "array", items: { type: "string" } },
            metadata: {
              type: "object",
              properties: {
                description: { type: "string" },
              },
              required: ["description"],
            },
          },
          required: ["directories", "metadata"],
        },
        strict: true,
      },
    } as const;

    let result: unknown;
    try {
      result = await generateStructuredJsonWithOllama(messages, responseFormat, temperature, maxTokens);
    } catch (err) {
      logger.error("/api/chat/directory-structure LLM failed", err as unknown);
      res.status(500).json({
        success: false,
        message: "llm_error",
        data: null,
        error: { code: "LLM_ERROR", message: (err as Error).message, details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const cfg = configManager.getConfig();
    const responseTime = Date.now() - startTs;
    const obj = result as Record<string, unknown>;
    const directories = Array.isArray(obj?.directories)
      ? (obj.directories as unknown[]).filter((v) => typeof v === "string").map((v) => String(v))
      : [];
    const metaVal = obj && typeof obj === "object" && (obj as Record<string, unknown>).metadata;
    const description =
      metaVal && typeof (metaVal as Record<string, unknown>).description === "string"
        ? String((metaVal as Record<string, unknown>).description)
        : "";

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        directories,
        metadata: {
          model_used: cfg.ollamaModel || "",
          tokens_used: 0,
          response_time_ms: responseTime,
          generation_time_ms: responseTime,
          description,
        },
      },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/chat/directory-structure failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Directory structure generation failed", details: null },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}
