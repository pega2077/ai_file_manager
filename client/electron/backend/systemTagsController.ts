import type { Request, Response, Express } from "express";
import SystemTagModel from "./models/systemTag";
import { logger } from "../logger";
import { generateStructuredJson } from "./utils/llm";
import type { LlmMessage } from "./utils/llm";
import type { StructuredResponseFormat } from "./utils/ollama";
import { normalizeLanguage } from "./utils/promptHelper";
import type { SupportedLang } from "./utils/promptHelper";
import { configManager } from "../configManager";
import type { ProviderName } from "./utils/llm";

/**
 * List all system tags
 */
export async function listSystemTagsHandler(_req: Request, res: Response): Promise<void> {
  try {
    const tags = await SystemTagModel.findAll({
      order: [["tag_name", "ASC"]],
    });

    const tagNames = tags.map((tag) => tag.tag_name);

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        tags: tagNames,
      },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/system-tags/list failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Failed to list system tags", details: null },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

/**
 * Save system tags (replace all existing tags with new list)
 */
export async function saveSystemTagsHandler(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as { tags?: unknown } | undefined;
    const tags = Array.isArray(body?.tags)
      ? (body.tags as unknown[])
          .filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 0)
          .map((t) => t.trim())
      : [];

    // Remove duplicates
    const uniqueTags = Array.from(new Set(tags));

    // Start transaction: delete all and insert new tags
    const timestamp = new Date().toISOString();
    
    // Delete all existing tags
    await SystemTagModel.destroy({ where: {} });

    // Insert new tags
    if (uniqueTags.length > 0) {
      await SystemTagModel.bulkCreate(
        uniqueTags.map((tag) => ({
          tag_name: tag,
          created_at: timestamp,
          updated_at: timestamp,
        }))
      );
    }

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        tags: uniqueTags,
        saved_count: uniqueTags.length,
      },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/system-tags/save failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Failed to save system tags", details: null },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

/**
 * Build prompt messages for tag optimization
 */
function buildOptimizeTagsMessages(params: {
  language: SupportedLang;
  inputTags: string[];
  systemTags: string[];
}): LlmMessage[] {
  const { language, inputTags, systemTags } = params;
  
  const inputTagsStr = inputTags.join(", ");
  const systemTagsStr = systemTags.join(", ");

  if (language === "zh") {
    return [
      {
        role: "system",
        content:
          "你是一名标签优化助手。请将输入的标签与系统标签进行比较，将输入标签中与系统标签相同或相似含义的词进行替换，确保标签的一致性。严格输出 JSON 格式。",
      },
      {
        role: "user",
        content:
          `系统标签（参考标准）：${systemTagsStr}\n\n输入标签：${inputTagsStr}\n\n请返回优化后的标签列表。规则：\n1. 如果输入标签与某个系统标签完全相同或含义相似，则使用系统标签替换\n2. 如果输入标签在系统标签中找不到对应项，则保留原标签\n3. 去除重复标签\n4. 保持标签简洁明了\n\n仅返回 JSON，格式如下：\n{\n  "optimized_tags": ["标签1", "标签2", ...]\n}`,
      },
    ];
  }

  // English
  return [
    {
      role: "system",
      content:
        "You are a tag optimization assistant. Compare input tags with system tags, and replace input tags that have the same or similar meaning with corresponding system tags to ensure consistency. Output JSON only.",
    },
    {
      role: "user",
      content:
        `System tags (reference standard): ${systemTagsStr}\n\nInput tags: ${inputTagsStr}\n\nReturn optimized tag list. Rules:\n1. If an input tag matches or has similar meaning to a system tag, replace it with the system tag\n2. If an input tag has no corresponding system tag, keep it as is\n3. Remove duplicates\n4. Keep tags concise and clear\n\nReturn JSON only in this format:\n{\n  "optimized_tags": ["tag1", "tag2", ...]\n}`,
    },
  ];
}

/**
 * Optimize tags by comparing with system tags using LLM
 */
export async function optimizeTagsHandler(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as { tags?: unknown; language?: unknown; provider?: unknown } | undefined;
    
    const inputTags = Array.isArray(body?.tags)
      ? (body.tags as unknown[])
          .filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 0)
          .map((t) => t.trim())
      : [];

    if (inputTags.length === 0) {
      res.status(200).json({
        success: true,
        message: "ok",
        data: {
          optimized_tags: [],
          original_tags: [],
        },
        error: null,
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    // Get system tags
    const systemTagRecords = await SystemTagModel.findAll({
      order: [["tag_name", "ASC"]],
    });
    const systemTags = systemTagRecords.map((tag) => tag.tag_name);

    // If no system tags, return input tags as-is
    if (systemTags.length === 0) {
      const uniqueTags = Array.from(new Set(inputTags));
      res.status(200).json({
        success: true,
        message: "ok",
        data: {
          optimized_tags: uniqueTags,
          original_tags: inputTags,
        },
        error: null,
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const language = normalizeLanguage(body?.language ?? (configManager.getConfig().language ?? "zh"), "zh");
    const providerRaw = typeof body?.provider === "string" ? body.provider.trim().toLowerCase() : undefined;
    const provider: ProviderName | undefined = providerRaw === "openai"
      ? "openai"
      : providerRaw === "azure-openai" || providerRaw === "azure" || providerRaw === "azure_openai"
      ? "azure-openai"
      : providerRaw === "openrouter"
      ? "openrouter"
      : providerRaw === "bailian" || providerRaw === "aliyun" || providerRaw === "dashscope"
      ? "bailian"
      : providerRaw === "ollama"
      ? "ollama"
      : undefined;

    const messages: LlmMessage[] = buildOptimizeTagsMessages({
      language,
      inputTags,
      systemTags,
    });

    const responseFormat: StructuredResponseFormat = {
      json_schema: {
        name: "optimize_tags_schema",
        schema: {
          type: "object",
          properties: {
            optimized_tags: { type: "array", items: { type: "string" } },
          },
          required: ["optimized_tags"],
          additionalProperties: false,
        },
        strict: true,
      },
    } as const;

    let result: unknown;
    try {
      result = await generateStructuredJson(messages, responseFormat, 0.2, 800, "", language, provider);
    } catch (e) {
      logger.error("/api/tags/optimize LLM failed", e as unknown);
      // Fallback: return input tags on LLM error
      const uniqueTags = Array.from(new Set(inputTags));
      res.status(200).json({
        success: true,
        message: "ok",
        data: {
          optimized_tags: uniqueTags,
          original_tags: inputTags,
          warning: "LLM optimization failed, returning original tags",
        },
        error: null,
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const obj = (result || {}) as Record<string, unknown>;
    const optimizedTags = Array.isArray(obj.optimized_tags)
      ? (obj.optimized_tags as unknown[])
          .filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 0)
          .map((t) => t.trim())
      : inputTags;

    // Remove duplicates
    const uniqueOptimizedTags = Array.from(new Set(optimizedTags));

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        optimized_tags: uniqueOptimizedTags,
        original_tags: inputTags,
      },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/tags/optimize failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Failed to optimize tags", details: null },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

/**
 * Register all system tags routes
 */
export function registerSystemTagsRoutes(app: Express): void {
  app.post("/api/system-tags/list", listSystemTagsHandler);
  app.post("/api/system-tags/save", saveSystemTagsHandler);
  app.post("/api/tags/optimize", optimizeTagsHandler);
}
