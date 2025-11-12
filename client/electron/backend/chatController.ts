import type { Express, Request, Response } from "express";
import { Op } from "sequelize";
import { generateStructuredJson, describeImage, getActiveModelName, embedText } from "./utils/llm";
import type { ProviderName } from "./utils/llm";
import { logger } from "../logger";
import { configManager } from "../configManager";
import {
  buildRecommendDirectoryMessages,
  buildFileNameAssessmentMessages,
  buildDirectoryStructureMessages,
  buildChatAskMessages,
  buildDocumentSummaryMessages,
  buildQueryPurposeMessages,
  buildVisionDescribePrompt,
  normalizeLanguage,
  normalizeDirectoryStyle,
  type DirectoryStyle,
  type SupportedLang,
} from "./utils/promptHelper";
import ChunkModel, { type ChunkAttributes } from "./models/chunk";
import FileModel, { type FileAttributes } from "./models/file";
import {
  isFaissAvailable,
  globalIndexExists,
  searchGlobalFaissIndex,
} from "./utils/vectorStore";
import faiss from "faiss-node";

export function registerChatRoutes(app: Express) {
  // POST /api/chat/recommend-directory
  app.post("/api/chat/recommend-directory", chatRecommendDirectoryHandler);
  // POST /api/chat/validate-file-name
  app.post("/api/chat/validate-file-name", chatValidateFileNameHandler);
  // POST /api/chat/directory-structure
  app.post("/api/chat/directory-structure", chatDirectoryStructureHandler);
  // POST /api/chat/query-purpose
  app.post("/api/chat/query-purpose", chatQueryPurposeHandler);
  // POST /api/chat/summarize-documents
  app.post("/api/chat/summarize-documents", chatSummarizeDocumentsHandler);
  // POST /api/chat/ask
  app.post("/api/chat/ask", chatAskHandler);
  // POST /api/chat/describe-image
  app.post("/api/chat/describe-image", chatDescribeImageHandler);
  // POST /api/chat/search (retrieval-only step)
  app.post("/api/chat/search", chatSearchHandler);
  // POST /api/chat/analyze (LLM analysis step)
  app.post("/api/chat/analyze", chatAnalyzeHandler);
  // POST /api/search/semantic (vector search API)
  app.post("/api/search/semantic", semanticSearchHandler);
}

type ChatRecommendBody = {
  file_name?: unknown;
  language?: unknown;
  file_content?: unknown;
  current_structure?: unknown;
  temperature?: unknown;
  max_tokens?: unknown;
  provider?: unknown;
};

type ChatValidateFileNameBody = {
  file_name?: unknown;
  file_content?: unknown;
  language?: unknown;
  provider?: unknown;
  temperature?: unknown;
  max_tokens?: unknown;
};

export async function chatRecommendDirectoryHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const startTs = Date.now();
    const body = req.body as ChatRecommendBody | undefined;
    const fileName = typeof body?.file_name === "string" ? body.file_name : "";
    const fileContent =
      typeof body?.file_content === "string" ? body.file_content : "";
    const currentStructure = Array.isArray(body?.current_structure)
      ? (body!.current_structure as unknown[])
          .filter((v) => typeof v === "string")
          .map((v) => String(v))
      : [];
    const temperature =
      typeof body?.temperature === "number" ? body.temperature : 0.7;
    const maxTokens =
      typeof body?.max_tokens === "number" ? body.max_tokens : 500;

    if (!fileName && !fileContent) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: {
          code: "INVALID_REQUEST",
          message: "file_name or file_content is required",
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const language: SupportedLang = normalizeLanguage(body?.language);
    const providerRaw =
      typeof body?.provider === "string"
        ? body.provider.trim().toLowerCase()
        : undefined;
    const provider: ProviderName | undefined =
      providerRaw === "openai"
        ? "openai"
        : providerRaw === "azure-openai" ||
          providerRaw === "azure" ||
          providerRaw === "azure_openai"
        ? "azure-openai"
        : providerRaw === "openrouter"
        ? "openrouter"
        : providerRaw === "bailian" ||
          providerRaw === "aliyun" ||
          providerRaw === "dashscope"
        ? "bailian"
        : providerRaw === "ollama"
        ? "ollama"
        : undefined;
    const messages = buildRecommendDirectoryMessages({
      language,
      fileName,
      fileContent,
      currentStructure,
    });

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
          required: [
            "recommended_directory",
            "confidence",
            "reasoning",
            "alternatives",
          ],
        },
        strict: true,
      },
    } as const;

    let result: unknown;
    try {
      result = await generateStructuredJson(
        messages,
        responseFormat,
        temperature,
        maxTokens,
        undefined,
        language,
        provider
      );
    } catch (err) {
      logger.error("/api/chat/recommend-directory LLM failed", err as unknown);
      res.status(500).json({
        success: false,
        message: "llm_error",
        data: null,
        error: {
          code: "LLM_ERROR",
          message: (err as Error).message,
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const obj = result as Record<string, unknown>;
    const recommended_directory =
      typeof obj?.recommended_directory === "string"
        ? (obj.recommended_directory as string)
        : "未分类";
    const confidence =
      typeof obj?.confidence === "number" ? (obj.confidence as number) : 0.0;
    const reasoning =
      typeof obj?.reasoning === "string" ? (obj.reasoning as string) : "";
    const alternatives = Array.isArray(obj?.alternatives)
      ? (obj.alternatives as unknown[])
          .filter((v) => typeof v === "string")
          .map((v) => String(v))
      : [];

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
          model_used: getActiveModelName("chat", provider),
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
      error: {
        code: "INTERNAL_ERROR",
        message: "Recommend directory failed",
        details: null,
      },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

export async function chatValidateFileNameHandler(
  req: Request,
  res: Response
): Promise<void> {
  const startTs = Date.now();
  try {
    const body = req.body as ChatValidateFileNameBody | undefined;
    const fileNameRaw = typeof body?.file_name === "string" ? body.file_name : "";
    const fileContentRaw =
      typeof body?.file_content === "string" ? body.file_content : "";

    const fileName = fileNameRaw.trim();
    const fileContent = fileContentRaw.trim();

    if (!fileName || !fileContent) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: {
          code: "INVALID_REQUEST",
          message: "file_name and file_content are required",
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const truncated = fileContent.length > MAX_FILENAME_ANALYSIS_CONTENT_LENGTH;
    const contentForPrompt = truncated
      ? `${fileContent.slice(0, MAX_FILENAME_ANALYSIS_CONTENT_LENGTH)}\n\n[Content truncated for analysis]`
      : fileContent;

    const language: SupportedLang = normalizeLanguage(body?.language);
    const provider = normalizeProviderName(body?.provider);

    const temperatureRaw =
      typeof body?.temperature === "number" && Number.isFinite(body.temperature)
        ? body.temperature
        : undefined;
    const maxTokensRaw =
      typeof body?.max_tokens === "number" && Number.isFinite(body.max_tokens)
        ? body.max_tokens
        : undefined;

    const temperature = Math.max(0, Math.min(1.5, temperatureRaw ?? 0.25));
    const maxTokens = Math.max(
      128,
      Math.min(800, Math.floor(maxTokensRaw ?? 320))
    );

    const messages = buildFileNameAssessmentMessages({
      language,
      fileName,
      fileContent: contentForPrompt,
      truncated,
      maxLength: MAX_FILENAME_ANALYSIS_CONTENT_LENGTH,
    });

    let result: unknown;
    try {
      result = await generateStructuredJson(
        messages,
        FILE_NAME_ASSESSMENT_RESPONSE_FORMAT,
        temperature,
        maxTokens,
        undefined,
        language,
        provider
      );
    } catch (err) {
      logger.error(
        "/api/chat/validate-file-name LLM failed",
        err as unknown
      );
      res.status(500).json({
        success: false,
        message: "llm_error",
        data: null,
        error: {
          code: "LLM_ERROR",
          message: (err as Error).message,
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const obj = (result as Record<string, unknown>) ?? {};
    const isReasonable = obj.is_reasonable === true;
    const confidenceRaw =
      typeof obj.confidence === "number"
        ? obj.confidence
        : typeof obj.confidence === "string"
        ? Number(obj.confidence)
        : 0;
    const confidence = Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw))
      : 0;
    const reasoning =
      typeof obj.reasoning === "string" ? obj.reasoning.trim() : "";

    const suggestedRaw = Array.isArray(obj.suggested_names)
      ? (obj.suggested_names as unknown[])
      : [];
    const suggestedNames = suggestedRaw
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value.length > 0)
      .slice(0, 5);

    const notesRaw = Array.isArray(obj.quality_notes)
      ? (obj.quality_notes as unknown[])
      : [];
    const qualityNotes = notesRaw
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value.length > 0)
      .slice(0, 5);

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        file_name: fileName,
        is_reasonable: isReasonable,
        confidence,
        reasoning,
        suggested_names: suggestedNames,
        quality_notes: qualityNotes,
        metadata: {
          model_used: getActiveModelName("chat", provider),
          truncated_input: truncated,
          analyzed_content_length: contentForPrompt.length,
          response_time_ms: Date.now() - startTs,
          temperature,
          max_tokens: maxTokens,
        },
      },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/chat/validate-file-name failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: {
        code: "INTERNAL_ERROR",
        message: "File name assessment failed",
        details: null,
      },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

// ------------- Describe Image (Vision) -------------
type ChatDescribeImageBody = {
  image_base64?: unknown; // raw base64 string or data URL
  image_url?: unknown; // http(s) URL to image
  language?: unknown; // 'zh' | 'en'
  prompt_hint?: unknown; // optional user hint
  timeout_ms?: unknown; // optional timeout override
  max_tokens?: unknown; // optional max tokens for vision answer
  provider?: unknown; // optional provider override: 'ollama' | 'openai' | 'azure-openai' | 'openrouter' | 'bailian'
  model?: unknown; // optional model override for selected provider
};

export async function chatDescribeImageHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const body = req.body as ChatDescribeImageBody | undefined;
    const base64 =
      typeof body?.image_base64 === "string" ? body.image_base64.trim() : "";
    const imageUrl =
      typeof body?.image_url === "string" ? body.image_url.trim() : "";
    const language: SupportedLang = normalizeLanguage(body?.language);
    const hint =
      typeof body?.prompt_hint === "string" ? body.prompt_hint : undefined;
    const timeoutMs =
      typeof body?.timeout_ms === "number"
        ? Math.max(10000, Math.floor(body.timeout_ms))
        : 300000;
    const maxTokens =
      typeof body?.max_tokens === "number" && body.max_tokens > 0
        ? Math.floor(body.max_tokens)
        : undefined;
    const overrideModel =
      typeof body?.model === "string" && body.model.trim().length > 0
        ? body.model.trim()
        : undefined;
    const providerRaw =
      typeof body?.provider === "string"
        ? body.provider.trim().toLowerCase()
        : undefined;
    const provider: ProviderName | undefined =
      providerRaw === "openai"
        ? "openai"
        : providerRaw === "azure-openai" ||
          providerRaw === "azure" ||
          providerRaw === "azure_openai"
        ? "azure-openai"
        : providerRaw === "openrouter"
        ? "openrouter"
        : providerRaw === "bailian" ||
          providerRaw === "aliyun" ||
          providerRaw === "dashscope"
        ? "bailian"
        : providerRaw === "ollama"
        ? "ollama"
        : undefined;

    if (!base64 && !imageUrl) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: {
          code: "INVALID_REQUEST",
          message: "image_base64 or image_url is required",
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    // Prepare base64 input: either from provided base64 (supports data URL) or fetched from image_url
    let cleaned = "";
    if (base64) {
      cleaned =
        base64.includes(",") && base64.toLowerCase().startsWith("data:")
          ? base64.split(",")[1] ?? ""
          : base64;
    } else {
      // fetch image from URL
      try {
        const controller = new AbortController();
        const fetchTimeout = setTimeout(
          () => controller.abort(),
          Math.max(10000, Math.min(timeoutMs, 300000))
        );
        try {
          const resp = await fetch(imageUrl, { signal: controller.signal });
          if (!resp.ok) {
            res.status(400).json({
              success: false,
              message: "invalid_request",
              data: null,
              error: {
                code: "INVALID_IMAGE_URL",
                message: `Failed to fetch image_url (HTTP ${resp.status})`,
                details: null,
              },
              timestamp: new Date().toISOString(),
              request_id: "",
            });
            return;
          }
          const ab = await resp.arrayBuffer();
          cleaned = Buffer.from(ab).toString("base64");
        } finally {
          clearTimeout(fetchTimeout);
        }
      } catch (e) {
        res.status(400).json({
          success: false,
          message: "invalid_request",
          data: null,
          error: {
            code: "INVALID_IMAGE_URL",
            message: `Failed to fetch image_url: ${(e as Error).message}`,
            details: null,
          },
          timestamp: new Date().toISOString(),
          request_id: "",
        });
        return;
      }
    }

    const prompt = buildVisionDescribePrompt(language, hint);

    let description = "";
    try {
      description = await describeImage(cleaned, {
        prompt,
        timeoutMs,
        maxTokens,
        providerOverride: provider,
        overrideModel,
      });
    } catch (e) {
      logger.error(
        "/api/chat/describe-image vision generation failed",
        e as unknown
      );
      res.status(500).json({
        success: false,
        message: "llm_error",
        data: null,
        error: {
          code: "LLM_ERROR",
          message: (e as Error).message,
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        description,
        language,
        model_used: overrideModel || getActiveModelName("vision", provider),
      },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/chat/describe-image failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: {
        code: "INTERNAL_ERROR",
        message: "Describe image failed",
        details: null,
      },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

export async function chatQueryPurposeHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const body = req.body as ChatQueryPurposeBody | undefined;
    const inputCandidates: unknown[] = [body?.text, body?.content, body?.query];
    let rawText = "";
    for (const candidate of inputCandidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        rawText = candidate;
        break;
      }
    }
    const text = rawText.trim();

    if (!text) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: {
          code: "INVALID_REQUEST",
          message: "text is required",
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const temperatureRaw =
      typeof body?.temperature === "number" &&
      Number.isFinite(body.temperature)
        ? body.temperature
        : undefined;
    const maxTokensRaw =
      typeof body?.max_tokens === "number" &&
      Number.isFinite(body.max_tokens)
        ? body.max_tokens
        : undefined;
    const temperature = Math.max(0, Math.min(2, temperatureRaw ?? 0.2));
  const maxTokensBase = maxTokensRaw ?? 256;
    const maxTokens = Math.max(
      64,
      Math.min(800, Math.floor(maxTokensBase))
    );

    const language: SupportedLang = normalizeLanguage(body?.language);
    const provider = normalizeProviderName(body?.provider);

    const messages = buildQueryPurposeMessages({
      language,
      text,
      purposeOptions: QUERY_PURPOSE_VALUES,
    });

    let result: unknown;
    try {
      result = await generateStructuredJson(
        messages,
        QUERY_PURPOSE_RESPONSE_FORMAT,
        temperature,
        maxTokens,
        undefined,
        language,
        provider
      );
    } catch (err) {
      logger.error("/api/chat/query-purpose LLM failed", err as unknown);
      res.status(500).json({
        success: false,
        message: "llm_error",
        data: null,
        error: {
          code: "LLM_ERROR",
          message: (err as Error).message,
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const obj = (result as Record<string, unknown>) ?? {};
    const rawPurpose =
      typeof obj.purpose === "string" ? obj.purpose.trim().toLowerCase() : "";
    const purpose: QueryPurpose = isQueryPurpose(rawPurpose)
      ? rawPurpose
      : "retrieval";
    const confidenceRaw =
      typeof obj.confidence === "number"
        ? obj.confidence
        : typeof obj.confidence === "string"
        ? Number(obj.confidence)
        : 0;
    const confidence = Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw))
      : 0;
    const reasoning =
      typeof obj.reasoning === "string" ? obj.reasoning.trim() : "";

    const responseData: {
      purpose: QueryPurpose;
      confidence: number;
      reasoning?: string;
    } = {
      purpose,
      confidence,
    };

    if (reasoning) {
      responseData.reasoning = reasoning;
    }

    res.status(200).json({
      success: true,
      message: "ok",
      data: responseData,
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/chat/query-purpose failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: {
        code: "INTERNAL_ERROR",
        message: "Query purpose detection failed",
        details: null,
      },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

export async function chatSummarizeDocumentsHandler(
  req: Request,
  res: Response
): Promise<void> {
  const startTs = Date.now();
  try {
    const body = req.body as ChatSummarizeDocumentsBody | undefined;
    const rawIds = Array.isArray(body?.document_ids)
      ? (body!.document_ids as unknown[])
      : [];
    const documentIds: string[] = rawIds
      .map((value) => {
        if (typeof value === "string" && value.trim()) return value.trim();
        if (typeof value === "number" && Number.isFinite(value)) {
          return String(value);
        }
        return "";
      })
      .filter((value) => value.length > 0);

    if (documentIds.length === 0) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: {
          code: "INVALID_REQUEST",
          message: "document_ids is required",
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    if (documentIds.length > MAX_DOCUMENT_IDS) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: {
          code: "INVALID_REQUEST",
          message: `document_ids cannot exceed ${MAX_DOCUMENT_IDS}`,
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const instructionCandidates = [
      typeof body?.instruction === "string" ? body.instruction : "",
      typeof body?.user_instruction === "string" ? body.user_instruction : "",
      typeof body?.query === "string" ? body.query : "",
    ];
    const instruction = instructionCandidates
      .map((value) => value.trim())
      .find((value) => value.length > 0);

    if (!instruction) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: {
          code: "INVALID_REQUEST",
          message: "instruction is required",
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const temperatureRaw =
      typeof body?.temperature === "number" &&
      Number.isFinite(body.temperature)
        ? body.temperature
        : undefined;
    const maxTokensRaw =
      typeof body?.max_tokens === "number" &&
      Number.isFinite(body.max_tokens)
        ? body.max_tokens
        : undefined;
    const perDocCharLimitRaw =
      typeof body?.per_document_char_limit === "number" &&
      Number.isFinite(body.per_document_char_limit)
        ? Math.floor(body.per_document_char_limit)
        : undefined;

    const temperature = Math.max(0, Math.min(2, temperatureRaw ?? 0.3));
    const maxTokens = Math.max(
      200,
      Math.min(4000, Math.floor(maxTokensRaw ?? 1200))
    );
    const perDocCharLimit = Math.max(
      MIN_PER_DOCUMENT_CHAR_LIMIT,
      Math.min(
        MAX_PER_DOCUMENT_CHAR_LIMIT,
        perDocCharLimitRaw ?? DEFAULT_PER_DOCUMENT_CHAR_LIMIT
      )
    );

    const language: SupportedLang = normalizeLanguage(body?.language);
    const provider = normalizeProviderName(body?.provider);

    const files = (await FileModel.findAll({
      where: { file_id: documentIds },
      raw: true,
    }).catch(() => [])) as FileAttributes[];

    const fileMap = new Map<string, FileAttributes>();
    for (const file of files) {
      if (file.file_id) {
        fileMap.set(file.file_id, file);
      }
    }

    const foundDocumentIds = documentIds.filter((id) => fileMap.has(id));
    const missingDocumentIds = documentIds.filter((id) => !fileMap.has(id));

    if (foundDocumentIds.length === 0) {
      res.status(404).json({
        success: false,
        message: "not_found",
        data: null,
        error: {
          code: "NOT_FOUND",
          message: "No documents found for provided document_ids",
          details: { missing_document_ids: missingDocumentIds },
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const chunkRows = (await ChunkModel.findAll({
      where: { file_id: foundDocumentIds },
      order: [
        ["file_id", "ASC"],
        ["chunk_index", "ASC"],
      ],
      raw: true,
    }).catch(() => [])) as ChunkAttributes[];

    const chunksByFile = new Map<string, ChunkAttributes[]>();
    for (const chunk of chunkRows) {
      if (!chunk.file_id) continue;
      const list = chunksByFile.get(chunk.file_id) ?? [];
      list.push(chunk);
      chunksByFile.set(chunk.file_id, list);
    }

    const documentsForPrompt: Array<{
      title: string;
      content: string;
      fileId: string;
    }> = [];
    const documentsMetadata: Array<{
      file_id: string;
      file_name: string;
      file_path: string;
      category: string;
      tags: string[];
      chunk_count: number;
      extracted_characters: number;
    }> = [];

    for (const fileId of foundDocumentIds) {
      const file = fileMap.get(fileId);
      if (!file) continue;
      const chunkList = chunksByFile.get(fileId) ?? [];
      const content = buildDocumentContentFromChunks(
        chunkList,
        perDocCharLimit
      );
      documentsForPrompt.push({
        title: file.name || file.path || file.file_id,
        content: content || "No extractable content available.",
        fileId,
      });
      documentsMetadata.push({
        file_id: file.file_id,
        file_name: file.name ?? "",
        file_path: file.path ?? "",
        category: file.category ?? "",
        tags: parseTags(file.tags ?? null),
        chunk_count: chunkList.length,
        extracted_characters: content.length,
      });
    }

    if (documentsForPrompt.length === 0) {
      res.status(404).json({
        success: false,
        message: "not_found",
        data: null,
        error: {
          code: "NO_CONTENT",
          message: "No content available for summarization",
          details: { missing_document_ids: missingDocumentIds },
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const messages = buildDocumentSummaryMessages({
      language,
      instruction,
      documents: documentsForPrompt,
    });

    let llmResult: Record<string, unknown> | undefined;
    try {
      const result = await generateStructuredJson(
        messages,
        DOCUMENT_SUMMARY_RESPONSE_FORMAT,
        temperature,
        maxTokens,
        undefined,
        language,
        provider
      );
      llmResult = (result as Record<string, unknown>) ?? undefined;
    } catch (err) {
      logger.error("/api/chat/summarize-documents LLM failed", err as unknown);
      res.status(500).json({
        success: false,
        message: "llm_error",
        data: null,
        error: {
          code: "LLM_ERROR",
          message: (err as Error).message,
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const summaryRaw =
      typeof llmResult?.summary === "string" ? llmResult.summary.trim() : "";
    const confidenceRaw =
      typeof llmResult?.confidence === "number"
        ? llmResult.confidence
        : typeof llmResult?.confidence === "string"
        ? Number(llmResult.confidence)
        : 0;
    const highlightsRaw = Array.isArray(llmResult?.highlights)
      ? (llmResult!.highlights as unknown[])
      : [];

    const highlights = highlightsRaw
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value.length > 0)
      .slice(0, 6);

    const summary =
      summaryRaw ||
      "Summary not available. Please review the selected documents manually.";
    const confidence = Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw))
      : 0;

    const modelUsed = getActiveModelName("chat", provider) || "";

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        summary,
        confidence,
        highlights,
        documents: documentsMetadata,
        missing_documents: missingDocumentIds,
        metadata: {
          instruction,
          language,
          model_used: modelUsed,
          response_time_ms: Date.now() - startTs,
          temperature,
          max_tokens: maxTokens,
          per_document_char_limit: perDocCharLimit,
          documents_summarized: documentsMetadata.length,
        },
      },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/chat/summarize-documents failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: {
        code: "INTERNAL_ERROR",
        message: "Document summarization failed",
        details: null,
      },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

type ParsedFileFilters = {
  file_ids?: string[];
  categories?: string[];
  tags?: string[];
  file_types?: string[];
};

type MatchReason =
  | "keyword-content"
  | "keyword-name"
  | "keyword-category"
  | "keyword-tag"
  | "vector";

interface RawChunkCandidate {
  chunkRecordId: number;
  score: number;
  matchReason: MatchReason;
  snippet?: string;
}

interface HydratedChunkRow {
  id: number;
  chunk_id: string;
  file_id: string;
  chunk_index: number;
  content: string;
  file_name: string;
  file_path: string;
  file_type: string;
  file_category: string;
  file_tags: string | null;
  tags_array: string[];
  relevance_score: number;
  match_reason: MatchReason;
  snippet: string;
}

const MAX_FILENAME_ANALYSIS_CONTENT_LENGTH = 6000;

const FILE_NAME_ASSESSMENT_RESPONSE_FORMAT = {
  json_schema: {
    name: "file_name_assessment_schema",
    schema: {
      type: "object",
      properties: {
        is_reasonable: { type: "boolean" },
        confidence: { type: "number" },
        reasoning: { type: "string" },
        suggested_names: {
          type: "array",
          items: { type: "string" },
        },
        quality_notes: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["is_reasonable", "confidence", "reasoning", "suggested_names"],
    },
    strict: true,
  },
} as const;

const QA_RESPONSE_FORMAT = {
  json_schema: {
    name: "chat_qa_answer_schema",
    schema: {
      type: "object",
      properties: {
        answer: { type: "string" },
        confidence: { type: "number" },
      },
      required: ["answer", "confidence"],
    },
    strict: true,
  },
} as const;

const QUERY_PURPOSE_VALUES = ["retrieval", "summary"] as const;
type QueryPurpose = (typeof QUERY_PURPOSE_VALUES)[number];

const QUERY_PURPOSE_RESPONSE_FORMAT = {
  json_schema: {
    name: "query_purpose_schema",
    schema: {
      type: "object",
      properties: {
        purpose: {
          type: "string",
          enum: QUERY_PURPOSE_VALUES as unknown as string[],
        },
        confidence: { type: "number" },
        reasoning: { type: "string" },
      },
      required: ["purpose", "confidence"],
    },
    strict: true,
  },
} as const;

function isQueryPurpose(value: string): value is QueryPurpose {
  return QUERY_PURPOSE_VALUES.includes(value as QueryPurpose);
}

const DOCUMENT_SUMMARY_RESPONSE_FORMAT = {
  json_schema: {
    name: "document_summary_schema",
    schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        confidence: { type: "number" },
        highlights: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["summary", "confidence"],
    },
    strict: true,
  },
} as const;

const MAX_DOCUMENT_IDS = 10;
const MIN_PER_DOCUMENT_CHAR_LIMIT = 500;
const MAX_PER_DOCUMENT_CHAR_LIMIT = 6000;
const DEFAULT_PER_DOCUMENT_CHAR_LIMIT = 3000;

function parseFileFilters(input: unknown): ParsedFileFilters {
  if (!input || typeof input !== "object") return {};
  const obj = input as Record<string, unknown>;
  const parseList = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const arr = (value as unknown[])
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter((v) => v.length > 0);
    return arr.length > 0 ? arr : undefined;
  };
  return {
    file_ids: parseList(obj.file_ids),
    categories: parseList(obj.categories),
    tags: parseList(obj.tags),
    file_types: parseList(obj.file_types),
  };
}

function normalizeProviderName(raw: unknown): ProviderName | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim().toLowerCase();
  switch (v) {
    case "openai":
      return "openai";
    case "azure-openai":
    case "azure":
    case "azure_openai":
      return "azure-openai";
    case "openrouter":
      return "openrouter";
    case "bailian":
    case "aliyun":
    case "dashscope":
      return "bailian";
    case "ollama":
      return "ollama";
    default:
      return undefined;
  }
}

function escapeForLike(input: string): string {
  return input.replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

function createDefaultSnippet(text: string, maxLength = 240): string {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function buildDocumentContentFromChunks(
  chunks: ChunkAttributes[],
  charLimit: number
): string {
  if (!chunks.length || charLimit <= 0) {
    return "";
  }
  let remaining = charLimit;
  const parts: string[] = [];
  for (const chunk of chunks) {
    const content = typeof chunk.content === "string" ? chunk.content : "";
    if (!content) continue;
    if (remaining <= 0) break;
    const normalized = content.trim();
    if (!normalized) continue;
    if (normalized.length <= remaining) {
      parts.push(normalized);
      remaining -= normalized.length;
    } else {
      parts.push(normalized.slice(0, remaining));
      remaining = 0;
      break;
    }
  }
  return parts.join("\n");
}

function buildSnippet(text: string, keyword?: string, maxLength = 240): string {
  if (!text) return "";
  const normalized = keyword?.trim();
  if (!normalized) {
    return createDefaultSnippet(text, maxLength);
  }
  const lowerText = text.toLowerCase();
  const lowerKeyword = normalized.toLowerCase();
  const index = lowerText.indexOf(lowerKeyword);
  if (index === -1) {
    return createDefaultSnippet(text, maxLength);
  }
  const half = Math.floor(maxLength / 2);
  const start = Math.max(0, index - half);
  const end = Math.min(text.length, start + maxLength);
  const snippet = text.slice(start, end);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${snippet}${suffix}`;
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .filter((v) => v.length > 0);
    }
  } catch {
    // ignore invalid JSON strings
  }
  return [];
}

function keywordScoreForReason(reason: MatchReason): number {
  switch (reason) {
    case "keyword-content":
      return 1.0;
    case "keyword-name":
      return 0.95;
    case "keyword-category":
      return 0.9;
    case "keyword-tag":
      return 0.88;
    default:
      return 0.85;
  }
}

function determineFileMatchReason(
  file: FileAttributes,
  keyword: string
): MatchReason {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return "keyword-name";
  if (file.name?.toLowerCase().includes(normalized)) {
    return "keyword-name";
  }
  if (file.category?.toLowerCase().includes(normalized)) {
    return "keyword-category";
  }
  const tagsArray = parseTags(file.tags);
  if (tagsArray.some((tag) => tag.toLowerCase().includes(normalized))) {
    return "keyword-tag";
  }
  return "keyword-name";
}

function filterRowsByFileFilters(
  rows: HydratedChunkRow[],
  filters: ParsedFileFilters
): HydratedChunkRow[] {
  return rows.filter((row) => {
    if (filters.file_ids && filters.file_ids.length > 0) {
      if (!filters.file_ids.includes(row.file_id)) return false;
    }
    if (filters.categories && filters.categories.length > 0) {
      if (!filters.categories.includes(row.file_category)) return false;
    }
    if (filters.tags && filters.tags.length > 0) {
      if (!row.tags_array.some((tag) => filters.tags!.includes(tag))) {
        return false;
      }
    }
    if (filters.file_types && filters.file_types.length > 0) {
      const normalizedRowType = row.file_type?.toLowerCase() ?? "";
      if (!normalizedRowType) {
        return false;
      }
      const normalizedFilters = filters.file_types.map((value) =>
        value.toLowerCase()
      );
      if (!normalizedFilters.includes(normalizedRowType)) {
        return false;
      }
    }
    return true;
  });
}

function parseMatchReason(raw: unknown): MatchReason {
  if (typeof raw !== "string") return "vector";
  const normalized = raw.trim().toLowerCase();
  if (normalized === "keyword-content") return "keyword-content";
  if (normalized === "keyword-name") return "keyword-name";
  if (normalized === "keyword-category") return "keyword-category";
  if (normalized === "keyword-tag") return "keyword-tag";
  return "vector";
}

async function hydrateChunkCandidates(
  candidates: RawChunkCandidate[],
  options?: { prefetchedChunks?: Map<number, ChunkAttributes> }
): Promise<HydratedChunkRow[]> {
  const unique: RawChunkCandidate[] = [];
  const seen = new Set<number>();
  for (const candidate of candidates) {
    if (!seen.has(candidate.chunkRecordId)) {
      seen.add(candidate.chunkRecordId);
      unique.push(candidate);
    }
  }
  if (unique.length === 0) return [];

  const chunkCache = new Map<number, ChunkAttributes>();
  if (options?.prefetchedChunks) {
    for (const [id, chunk] of options.prefetchedChunks.entries()) {
      chunkCache.set(id, chunk);
    }
  }

  const missingIds: number[] = [];
  for (const candidate of unique) {
    if (!chunkCache.has(candidate.chunkRecordId)) {
      missingIds.push(candidate.chunkRecordId);
    }
  }

  if (missingIds.length > 0) {
    const fetched = (await ChunkModel.findAll({
      where: { id: missingIds },
      raw: true,
    }).catch(() => [])) as ChunkAttributes[];
    for (const item of fetched) {
      chunkCache.set(item.id, item);
    }
  }

  const fileIds = new Set<string>();
  for (const chunk of chunkCache.values()) {
    if (chunk?.file_id) fileIds.add(chunk.file_id);
  }

  const files = (await FileModel.findAll({
    where: { file_id: Array.from(fileIds) },
    raw: true,
  }).catch(() => [])) as FileAttributes[];
  const fileMap = new Map<string, FileAttributes>();
  for (const file of files) {
    fileMap.set(file.file_id, file);
  }

  const hydrated: HydratedChunkRow[] = [];
  for (const candidate of unique) {
    const chunk = chunkCache.get(candidate.chunkRecordId);
    if (!chunk) continue;
    const file = fileMap.get(chunk.file_id);
    const tagsArray = parseTags(file?.tags ?? null);
    hydrated.push({
      id: chunk.id,
      chunk_id: chunk.chunk_id,
      file_id: chunk.file_id,
      chunk_index: chunk.chunk_index,
      content: chunk.content,
      file_name: file?.name ?? "",
      file_path: file?.path ?? "",
      file_type: file?.type ?? "",
      file_category: file?.category ?? "",
      file_tags: file?.tags ?? null,
      tags_array: tagsArray,
      relevance_score: candidate.score,
      match_reason: candidate.matchReason,
      snippet:
        candidate.snippet ??
        createDefaultSnippet(chunk.content),
    });
  }

  return hydrated;
}

async function performKeywordSearch(
  query: string,
  contextLimit: number,
  filters: ParsedFileFilters
): Promise<{ rows: HydratedChunkRow[]; retrievalTimeMs: number }> {
  const start = Date.now();
  const sanitized = query.trim();
  if (!sanitized) {
    return { rows: [], retrievalTimeMs: Date.now() - start };
  }

  const likePattern = `%${escapeForLike(sanitized)}%`;
  const chunkLimit = Math.max(contextLimit * 6, 10);
  const fileLimit = Math.max(contextLimit * 4, 5);

  const chunkMatches = (await ChunkModel.findAll({
    where: { content: { [Op.like]: likePattern } },
    order: [
      ["file_id", "ASC"],
      ["chunk_index", "ASC"],
    ],
    limit: chunkLimit,
    raw: true,
  }).catch(() => [])) as ChunkAttributes[];

  const prefetched = new Map<number, ChunkAttributes>();
  const candidates: RawChunkCandidate[] = [];
  for (const chunk of chunkMatches) {
    prefetched.set(chunk.id, chunk);
    candidates.push({
      chunkRecordId: chunk.id,
      score: keywordScoreForReason("keyword-content"),
      matchReason: "keyword-content",
      snippet: buildSnippet(chunk.content, sanitized),
    });
  }

  const fileMatches = (await FileModel.findAll({
    where: {
      [Op.or]: [
        { name: { [Op.like]: likePattern } },
        { category: { [Op.like]: likePattern } },
        { tags: { [Op.like]: likePattern } },
      ],
    },
    limit: fileLimit,
    raw: true,
  }).catch(() => [])) as FileAttributes[];

  const fileIdSet = new Set<string>();
  for (const file of fileMatches) {
    if (file.file_id) {
      fileIdSet.add(file.file_id);
    }
  }

  if (fileIdSet.size > 0) {
    const fileIds = Array.from(fileIdSet);
    const fileChunks = (await ChunkModel.findAll({
      where: { file_id: fileIds },
      order: [
        ["file_id", "ASC"],
        ["chunk_index", "ASC"],
      ],
      limit: Math.max(contextLimit * 4, fileIds.length * 2),
      raw: true,
    }).catch(() => [])) as ChunkAttributes[];

    const seenFile = new Set<string>();
    for (const chunk of fileChunks) {
      if (!chunk.file_id) continue;
      if (seenFile.has(chunk.file_id)) continue;
      seenFile.add(chunk.file_id);
      const fileMeta = fileMatches.find((f) => f.file_id === chunk.file_id);
      const reason = fileMeta
        ? determineFileMatchReason(fileMeta, sanitized)
        : "keyword-name";
      const score = keywordScoreForReason(reason);
      if (!prefetched.has(chunk.id)) {
        prefetched.set(chunk.id, chunk);
      }
      candidates.push({
        chunkRecordId: chunk.id,
        score,
        matchReason: reason,
        snippet: buildSnippet(chunk.content, sanitized),
      });
    }
  }

  candidates.sort((a, b) => {
    if (b.score === a.score) return a.chunkRecordId - b.chunkRecordId;
    return b.score - a.score;
  });

  const hydrated = await hydrateChunkCandidates(candidates, {
    prefetchedChunks: prefetched,
  });
  const filtered = filterRowsByFileFilters(hydrated, filters);

  return {
    rows: filtered,
    retrievalTimeMs: Date.now() - start,
  };
}

async function performVectorSearch(
  question: string,
  contextLimit: number,
  similarityThreshold: number,
  filters: ParsedFileFilters
): Promise<{ rows: HydratedChunkRow[]; retrievalTimeMs: number; embeddingTimeMs: number }> {
  const start = Date.now();
  const embeddingStart = Date.now();
  const emb = await embedText([question]);
  const qEmbedding = emb[0] ?? [];
  if (qEmbedding.length === 0) {
    throw new Error("empty embedding");
  }
  const embeddingTimeMs = Date.now() - embeddingStart;

  if (!isFaissAvailable() || !(await globalIndexExists())) {
    return { rows: [], retrievalTimeMs: Date.now() - start, embeddingTimeMs };
  }

  const searchStart = Date.now();
  const resFaiss = await searchGlobalFaissIndex({
    query: qEmbedding,
    k: Math.min(100, contextLimit * 5),
    oversample: 1.0,
  });
  const retrievalTimeMs = Date.now() - searchStart + embeddingTimeMs;

  const ids = resFaiss.ids ?? [];
  const distances = resFaiss.distances ?? [];
  if (ids.length === 0) {
    return { rows: [], retrievalTimeMs, embeddingTimeMs };
  }

  const candidates: RawChunkCandidate[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (typeof id !== "number") continue;
    const distance = distances[i] ?? 0;
    const similarity = 1 / (1 + distance);
    candidates.push({
      chunkRecordId: id,
      score: similarity,
      matchReason: "vector",
    });
  }

  const hydrated = await hydrateChunkCandidates(candidates);
  const filtered = filterRowsByFileFilters(hydrated, filters).filter(
    (row) => row.relevance_score >= similarityThreshold
  );
  filtered.sort((a, b) => b.relevance_score - a.relevance_score);

  return { rows: filtered, retrievalTimeMs, embeddingTimeMs };
}

async function retrieveContextCandidates(params: {
  question: string;
  contextLimit: number;
  similarityThreshold: number;
  filters: ParsedFileFilters;
  maxResults?: number;
}): Promise<{
  rows: HydratedChunkRow[];
  mode: "keyword" | "vector" | "none";
  keywordTimeMs: number;
  vectorTimeMs?: number;
}> {
  const { question, contextLimit, similarityThreshold, filters, maxResults } =
    params;
  const keywordRes = await performKeywordSearch(question, contextLimit, filters);
  let rows = keywordRes.rows;
  let mode: "keyword" | "vector" | "none" = "none";
  let vectorTimeMs: number | undefined;
  if (rows.length > 0) {
    mode = "keyword";
  } else {
    const vectorRes = await performVectorSearch(
      question,
      contextLimit,
      similarityThreshold,
      filters
    );
    rows = vectorRes.rows;
    vectorTimeMs = vectorRes.retrievalTimeMs;
    mode = rows.length > 0 ? "vector" : "none";
  }

  let limited = rows;
  if (typeof maxResults === "number" && maxResults > 0) {
    limited = rows.slice(0, maxResults);
  }

  return {
    rows: limited,
    mode,
    keywordTimeMs: keywordRes.retrievalTimeMs,
    vectorTimeMs,
  };
}

async function resolveChunkRecordIdsByPublicId(
  chunkIds: string[]
): Promise<Map<string, number>> {
  if (chunkIds.length === 0) return new Map<string, number>();
  const chunks = (await ChunkModel.findAll({
    where: { chunk_id: chunkIds },
    raw: true,
  }).catch(() => [])) as ChunkAttributes[];
  const map = new Map<string, number>();
  for (const chunk of chunks) {
    map.set(chunk.chunk_id, chunk.id);
  }
  return map;
}

async function parseSelectedChunks(
  raw: unknown
): Promise<RawChunkCandidate[]> {
  if (!raw) return [];
  const candidates: RawChunkCandidate[] = [];
  if (!Array.isArray(raw)) return candidates;

  const pendingByChunkId: Array<{
    chunk_id: string;
    score: number;
    matchReason: MatchReason;
  }> = [];

  for (const item of raw) {
    if (typeof item === "number") {
      candidates.push({
        chunkRecordId: item,
        score: 1.0,
        matchReason: "vector",
      });
      continue;
    }
    if (typeof item === "string") {
      const chunkId = item.trim();
      if (chunkId) {
        pendingByChunkId.push({
          chunk_id: chunkId,
          score: 1.0,
          matchReason: "vector",
        });
      }
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const idRaw = obj.chunk_record_id ?? obj.id;
    const scoreRaw =
      typeof obj.relevance_score === "number"
        ? obj.relevance_score
        : typeof obj.score === "number"
        ? obj.score
        : undefined;
    const reasonRaw = obj.match_reason ?? obj.reason;
    const chunkIdRaw = obj.chunk_id;
    const matchReason = parseMatchReason(reasonRaw);
    const score =
      typeof scoreRaw === "number" && Number.isFinite(scoreRaw)
        ? scoreRaw
        : matchReason === "vector"
        ? 0.75
        : keywordScoreForReason(matchReason);
    if (typeof idRaw === "number") {
      candidates.push({
        chunkRecordId: idRaw,
        score,
        matchReason,
      });
    } else if (typeof idRaw === "string" && idRaw.trim()) {
      const parsed = Number(idRaw);
      if (!Number.isNaN(parsed)) {
        candidates.push({
          chunkRecordId: parsed,
          score,
          matchReason,
        });
      } else if (typeof chunkIdRaw === "string" && chunkIdRaw.trim()) {
        pendingByChunkId.push({
          chunk_id: chunkIdRaw.trim(),
          score,
          matchReason,
        });
      }
    } else if (typeof chunkIdRaw === "string" && chunkIdRaw.trim()) {
      pendingByChunkId.push({
        chunk_id: chunkIdRaw.trim(),
        score,
        matchReason,
      });
    }
  }

  if (pendingByChunkId.length > 0) {
    const chunkIdSet = Array.from(
      new Set(pendingByChunkId.map((item) => item.chunk_id))
    );
    const resolved = await resolveChunkRecordIdsByPublicId(chunkIdSet);
    for (const pending of pendingByChunkId) {
      const recordId = resolved.get(pending.chunk_id);
      if (typeof recordId === "number") {
        candidates.push({
          chunkRecordId: recordId,
          score: pending.score,
          matchReason: pending.matchReason,
        });
      }
    }
  }

  return candidates;
}

async function generateAnswerFromChunks(options: {
  question: string;
  chunks: HydratedChunkRow[];
  temperature: number;
  maxTokens: number;
  provider?: ProviderName;
  language?: SupportedLang;
  overrideModel?: string;
}): Promise<{
  answer: string;
  confidence: number;
  sources: Array<{
    file_id: string;
    file_name: string;
    file_path: string;
    chunk_id: string;
    chunk_content: string;
    chunk_index: number;
    relevance_score: number;
    match_reason: MatchReason;
  }>;
  generationTimeMs: number;
  rawResult: Record<string, unknown>;
}> {
  const { question, chunks, temperature, maxTokens, provider, language, overrideModel } =
    options;
  const contextStr = chunks
    .map(
      (row, index) =>
        `[#${index + 1}] File: ${row.file_name} (${row.file_path})\nChunk ${
          row.chunk_index
        }: ${row.content}`
    )
    .join("\n\n");

  const messages = buildChatAskMessages({ question, contextStr });
  const start = Date.now();
  const result = (await generateStructuredJson(
    messages,
    QA_RESPONSE_FORMAT,
    temperature,
    maxTokens,
    overrideModel || "",
    language,
    provider
  )) as Record<string, unknown>;
  const generationTimeMs = Date.now() - start;

  const answer =
    typeof result?.answer === "string" ? (result.answer as string) : "";
  const confidence =
    typeof result?.confidence === "number"
      ? (result.confidence as number)
      : 0.0;

  const sources = chunks.map((row) => ({
    file_id: row.file_id,
    file_name: row.file_name,
    file_path: row.file_path,
    chunk_id: row.chunk_id,
    chunk_content: row.content,
    chunk_index: row.chunk_index,
    relevance_score: row.relevance_score,
    match_reason: row.match_reason,
  }));

  return {
    answer,
    confidence: Math.max(0, Math.min(1, confidence)),
    sources,
    generationTimeMs,
    rawResult: result,
  };
}

// ------------- Chat Ask (RAG) -------------

type ChatSearchBody = {
  query?: unknown;
  question?: unknown;
  context_limit?: unknown;
  similarity_threshold?: unknown;
  max_results?: unknown;
  file_filters?: unknown;
};

type ChatAnalyzeBody = {
  question?: unknown;
  selected_chunks?: unknown;
  chunks?: unknown;
  chunk_ids?: unknown;
  context_limit?: unknown;
  temperature?: unknown;
  max_tokens?: unknown;
  provider?: unknown;
  similarity_threshold?: unknown;
  file_filters?: unknown;
  override_model?: unknown;
  language?: unknown;
};

type SemanticSearchBody = {
  query?: unknown;
  limit?: unknown;
  similarity_threshold?: unknown;
  file_filters?: unknown;
  include_context?: unknown;
};

type ChatQueryPurposeBody = {
  text?: unknown;
  content?: unknown;
  query?: unknown;
  language?: unknown;
  temperature?: unknown;
  max_tokens?: unknown;
  provider?: unknown;
};

type ChatSummarizeDocumentsBody = {
  document_ids?: unknown;
  instruction?: unknown;
  user_instruction?: unknown;
  query?: unknown;
  language?: unknown;
  temperature?: unknown;
  max_tokens?: unknown;
  per_document_char_limit?: unknown;
  provider?: unknown;
};

export async function semanticSearchHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const body = req.body as SemanticSearchBody | undefined;
    const queryRaw =
      typeof body?.query === "string"
        ? body.query
        : typeof body?.query === "number"
        ? String(body.query)
        : "";
    const query = queryRaw.trim();
    if (!query) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: {
          code: "INVALID_REQUEST",
          message: "query is required",
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const resolveNumber = (value: unknown, fallback: number): number => {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
      return fallback;
    };

    const rawLimit = resolveNumber(body?.limit, 10);
    const rawSimilarity = resolveNumber(body?.similarity_threshold, 0.7);
    const includeContext = body?.include_context === false ? false : true;

    const limit = Math.max(1, Math.min(50, Math.floor(rawLimit)));
    const similarityThreshold = Math.max(
      0,
      Math.min(1, rawSimilarity)
    );

    const filters = parseFileFilters(body?.file_filters);

    const searchResult = await performVectorSearch(
      query,
      limit,
      similarityThreshold,
      filters
    );

    const rows = searchResult.rows.slice(0, limit);

    let contextMap = new Map<string, ChunkAttributes>();
    if (includeContext && rows.length > 0) {
      const neighborConditions = new Map<
        string,
        { file_id: string; chunk_index: number }
      >();
      for (const row of rows) {
        if (row.chunk_index > 0) {
          const prevKey = `${row.file_id}:${row.chunk_index - 1}`;
          if (!neighborConditions.has(prevKey)) {
            neighborConditions.set(prevKey, {
              file_id: row.file_id,
              chunk_index: row.chunk_index - 1,
            });
          }
        }
        const nextKey = `${row.file_id}:${row.chunk_index + 1}`;
        if (!neighborConditions.has(nextKey)) {
          neighborConditions.set(nextKey, {
            file_id: row.file_id,
            chunk_index: row.chunk_index + 1,
          });
        }
      }

      const neighbors = neighborConditions.size
        ? ((await ChunkModel.findAll({
            where: { [Op.or]: Array.from(neighborConditions.values()) },
            raw: true,
          }).catch(() => [])) as ChunkAttributes[])
        : [];

      contextMap = new Map(
        neighbors.map((chunk) => [
          `${chunk.file_id}:${chunk.chunk_index}`,
          chunk,
        ])
      );
    }

    const results = rows.map((row) => {
      const prev = includeContext
        ? contextMap.get(`${row.file_id}:${row.chunk_index - 1}`)?.content ??
          null
        : null;
      const next = includeContext
        ? contextMap.get(`${row.file_id}:${row.chunk_index + 1}`)?.content ??
          null
        : null;

      return {
        chunk_id: row.chunk_id,
        file_id: row.file_id,
        file_name: row.file_name,
        file_path: row.file_path,
        chunk_content: row.content,
        chunk_index: row.chunk_index,
        similarity_score: row.relevance_score,
        context: includeContext
          ? {
              prev_chunk: prev,
              next_chunk: next,
            }
          : undefined,
      };
    });

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        results,
        search_metadata: {
          query,
          total_results: searchResult.rows.length,
          search_time_ms: searchResult.retrievalTimeMs,
          embedding_time_ms: searchResult.embeddingTimeMs ?? null,
        },
      },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/search/semantic failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: {
        code: "INTERNAL_ERROR",
        message: "Semantic search failed",
        details: null,
      },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

export async function chatSearchHandler(
  req: Request,
  res: Response
): Promise<void> {
  const startTs = Date.now();
  try {
    const body = req.body as ChatSearchBody | undefined;
    const queryRaw =
      typeof body?.query === "string"
        ? body.query
        : typeof body?.question === "string"
        ? body.question
        : "";
    const query = queryRaw.trim();
    if (!query) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: {
          code: "INVALID_REQUEST",
          message: "query is required",
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const contextLimitRaw =
      typeof body?.context_limit === "number" ? body.context_limit : 5;
    const similarityThresholdRaw =
      typeof body?.similarity_threshold === "number"
        ? body.similarity_threshold
        : 0.7;
    const maxResultsRaw =
      typeof body?.max_results === "number" ? body.max_results : undefined;

    const contextLimit = Math.max(
      1,
      Math.min(20, Math.floor(contextLimitRaw))
    );
    const similarityThreshold = Math.max(
      0,
      Math.min(1, similarityThresholdRaw)
    );
    const maxResults = Math.max(
      contextLimit,
      Math.min(
        50,
        maxResultsRaw !== undefined
          ? Math.max(1, Math.floor(maxResultsRaw))
          : contextLimit * 4
      )
    );

    const filters = parseFileFilters(body?.file_filters);

    const retrieval = await retrieveContextCandidates({
      question: query,
      contextLimit: Math.max(contextLimit, Math.min(20, contextLimit * 3)),
      similarityThreshold,
      filters,
      maxResults,
    });

    const results = retrieval.rows.map((row) => ({
      chunk_record_id: row.id,
      chunk_id: row.chunk_id,
      chunk_index: row.chunk_index,
      file_id: row.file_id,
      file_name: row.file_name,
      file_path: row.file_path,
      file_category: row.file_category,
      file_tags: row.tags_array,
      snippet: row.snippet,
      relevance_score: row.relevance_score,
      match_reason: row.match_reason,
    }));

    const retrievalTimeMs =
      retrieval.mode === "keyword"
        ? retrieval.keywordTimeMs
        : retrieval.vectorTimeMs ?? retrieval.keywordTimeMs;

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        results,
        retrieval_mode: retrieval.mode,
        metadata: {
          query,
          result_count: results.length,
          keyword_time_ms: retrieval.keywordTimeMs,
          vector_time_ms: retrieval.vectorTimeMs ?? null,
          retrieval_time_ms: retrievalTimeMs,
          similarity_threshold: similarityThreshold,
          context_limit: contextLimit,
          max_results: maxResults,
          filters_applied: {
            file_ids: filters.file_ids ?? [],
            categories: filters.categories ?? [],
            tags: filters.tags ?? [],
          },
          response_time_ms: Date.now() - startTs,
        },
      },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/chat/search failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: {
        code: "INTERNAL_ERROR",
        message: "Search retrieval failed",
        details: null,
      },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

export async function chatAnalyzeHandler(
  req: Request,
  res: Response
): Promise<void> {
  const startAll = Date.now();
  try {
    const body = req.body as ChatAnalyzeBody | undefined;
    const questionRaw =
      typeof body?.question === "string" ? body.question : "";
    const question = questionRaw.trim();
    if (!question) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: {
          code: "INVALID_REQUEST",
          message: "question is required",
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const contextLimitRaw =
      typeof body?.context_limit === "number" ? body.context_limit : 5;
    const temperatureRaw =
      typeof body?.temperature === "number" ? body.temperature : 0.7;
    const maxTokensRaw =
      typeof body?.max_tokens === "number" ? body.max_tokens : 1000;
    const similarityThresholdRaw =
      typeof body?.similarity_threshold === "number"
        ? body.similarity_threshold
        : 0.7;

    const contextLimit = Math.max(
      1,
      Math.min(20, Math.floor(contextLimitRaw))
    );
    const temperature = Math.max(0, Math.min(2, temperatureRaw));
    const maxTokens = Math.max(100, Math.min(4000, Math.floor(maxTokensRaw)));
    const similarityThreshold = Math.max(
      0,
      Math.min(1, similarityThresholdRaw)
    );

    const filters = parseFileFilters(body?.file_filters);
    const provider = normalizeProviderName(body?.provider);
    const overrideModel =
      typeof body?.override_model === "string" &&
      body.override_model.trim().length > 0
        ? body.override_model.trim()
        : "";
    const language: SupportedLang | undefined =
      typeof body?.language === "string"
        ? normalizeLanguage(body.language)
        : undefined;

    const rawSelected =
      body?.selected_chunks ??
      body?.chunks ??
      (Array.isArray(body?.chunk_ids) ? body?.chunk_ids : undefined);
    let candidates = await parseSelectedChunks(rawSelected);
    let retrievalMode: "keyword" | "vector" | "none" | "manual" = "none";
    let retrievalTimeMs = 0;

    if (candidates.length > 0) {
      retrievalMode = "manual";
    } else {
      const retrieval = await retrieveContextCandidates({
        question,
        contextLimit: Math.max(contextLimit, Math.min(20, contextLimit * 3)),
        similarityThreshold,
        filters,
        maxResults: contextLimit * 4,
      });
      candidates = retrieval.rows.map((row) => ({
        chunkRecordId: row.id,
        score: row.relevance_score,
        matchReason: row.match_reason,
        snippet: row.snippet,
      }));
      retrievalMode = retrieval.mode;
      retrievalTimeMs =
        retrieval.mode === "keyword"
          ? retrieval.keywordTimeMs
          : retrieval.vectorTimeMs ?? retrieval.keywordTimeMs;
    }

    let hydrated = candidates.length
      ? await hydrateChunkCandidates(candidates)
      : [];
    if (hydrated.length > 0) {
      hydrated = filterRowsByFileFilters(hydrated, filters);
      hydrated.sort((a, b) => b.relevance_score - a.relevance_score);
      hydrated = hydrated.slice(0, contextLimit);
    }

    const cfg = configManager.getConfig();
    const modelFromConfig = cfg.ollamaModel || "";
    const modelUsed =
      overrideModel || getActiveModelName("chat", provider) || modelFromConfig;

    if (hydrated.length === 0) {
      res.status(200).json({
        success: true,
        message: "no_context",
        data: {
          answer:
            "No relevant context found. Please refine your search or import more documents.",
          confidence: 0.0,
          sources: [],
          metadata: {
            model_used: modelUsed,
            tokens_used: 0,
            response_time_ms: Date.now() - startAll,
            retrieval_time_ms: retrievalTimeMs,
            generation_time_ms: 0,
            retrieval_mode: retrievalMode,
          },
        },
        error: null,
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const answerResult = await generateAnswerFromChunks({
      question,
      chunks: hydrated,
      temperature,
      maxTokens,
      provider,
      language,
      overrideModel,
    });

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        answer: answerResult.answer,
        confidence: answerResult.confidence,
        sources: answerResult.sources,
        metadata: {
          model_used: modelUsed,
          tokens_used: 0,
          response_time_ms: Date.now() - startAll,
          retrieval_time_ms: retrievalTimeMs,
          generation_time_ms: answerResult.generationTimeMs,
          retrieval_mode: retrievalMode,
        },
      },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/chat/analyze failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: {
        code: "INTERNAL_ERROR",
        message: "Chat analyze failed",
        details: null,
      },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

type ChatAskBody = {
  question?: unknown;
  context_limit?: unknown;
  similarity_threshold?: unknown;
  temperature?: unknown;
  max_tokens?: unknown;
  stream?: unknown;
  file_filters?: unknown;
  mode?: unknown; // "mode1" or "mode2"
  provider?: unknown;
};

export async function chatAskHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const body = req.body as ChatAskBody | undefined;
    const modeRaw =
      typeof body?.mode === "string" ? String(body!.mode).toLowerCase() : "";
    if (modeRaw === "mode2" || modeRaw === "2") {
      return chatAskHandlerMode2(req, res);
    }
    return chatAskHandlerMode1(req, res);
  } catch (err) {
    // Fallback to mode1 on unexpected errors
    return chatAskHandlerMode1(req, res);
  }
}

// Keep current behavior as Mode1 (global FAISS search + post-filter)
export async function chatAskHandlerMode1(
  req: Request,
  res: Response
): Promise<void> {
  const startAll = Date.now();
  try {
    const body = req.body as ChatAskBody | undefined;
    const question =
      typeof body?.question === "string" ? body!.question.trim() : "";
    const contextLimitRaw =
      typeof body?.context_limit === "number" ? body!.context_limit : 5;
    const simThreshRaw =
      typeof body?.similarity_threshold === "number"
        ? body!.similarity_threshold
        : 0.7;
    const temperatureRaw =
      typeof body?.temperature === "number" ? body!.temperature : 0.7;
    const maxTokensRaw =
      typeof body?.max_tokens === "number" ? body!.max_tokens : 1000;

    if (!question) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: {
          code: "INVALID_REQUEST",
          message: "question is required",
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const contextLimit = Math.max(
      1,
      Math.min(20, Math.floor(contextLimitRaw))
    );
    const similarityThreshold = Math.max(
      0,
      Math.min(1, Number.isFinite(simThreshRaw as number) ? (simThreshRaw as number) : 0.7)
    );
    const tempClamped = Math.max(0, Math.min(2, temperatureRaw));
    const maxTokensClamped = Math.max(
      100,
      Math.min(4000, Math.floor(maxTokensRaw))
    );

    const provider = normalizeProviderName(body?.provider);
    const filters = parseFileFilters(body?.file_filters);

    const retrieval = await retrieveContextCandidates({
      question,
      contextLimit: Math.max(contextLimit, Math.min(20, contextLimit * 3)),
      similarityThreshold,
      filters,
      maxResults: contextLimit * 4,
    });

    let rows = retrieval.rows;
    rows.sort((a, b) => b.relevance_score - a.relevance_score);
    rows = rows.slice(0, contextLimit);

    if (rows.length === 0) {
      res.status(200).json({
        success: true,
        message: "ok",
        data: {
          answer: "Knowledge base is empty, please import files first.",
          confidence: 0.0,
          sources: [],
          metadata: {
            model_used: getActiveModelName("chat", provider) || "",
            tokens_used: 0,
            response_time_ms: Date.now() - startAll,
            retrieval_time_ms:
              retrieval.mode === "keyword"
                ? retrieval.keywordTimeMs
                : retrieval.vectorTimeMs ?? retrieval.keywordTimeMs,
            generation_time_ms: 0,
            retrieval_mode: retrieval.mode,
          },
        },
        error: null,
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const answerResult = await generateAnswerFromChunks({
      question,
      chunks: rows,
      temperature: tempClamped,
      maxTokens: maxTokensClamped,
      provider,
    });

    const cfg = configManager.getConfig();
    const modelUsed =
      getActiveModelName("chat", provider) || cfg.ollamaModel || "";

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        answer: answerResult.answer,
        confidence: answerResult.confidence,
        sources: answerResult.sources,
        metadata: {
          model_used: modelUsed,
          tokens_used: 0,
          response_time_ms: Date.now() - startAll,
          retrieval_time_ms:
            retrieval.mode === "keyword"
              ? retrieval.keywordTimeMs
              : retrieval.vectorTimeMs ?? retrieval.keywordTimeMs,
          generation_time_ms: answerResult.generationTimeMs,
          retrieval_mode: retrieval.mode,
        },
      },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/chat/ask failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: {
        code: "INTERNAL_ERROR",
        message: "Chat ask failed",
        details: null,
      },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

// Mode2: Build an in-memory FAISS index from filtered files, then search
export async function chatAskHandlerMode2(
  req: Request,
  res: Response
): Promise<void> {
  const startAll = Date.now();
  try {
    const body = req.body as ChatAskBody | undefined;
    const question =
      typeof body?.question === "string" ? body!.question.trim() : "";
    const contextLimitRaw =
      typeof body?.context_limit === "number" ? body!.context_limit : undefined;
    const simThreshRaw =
      typeof body?.similarity_threshold === "number"
        ? body!.similarity_threshold
        : undefined;
    const temperature =
      typeof body?.temperature === "number" ? body!.temperature : 0.7;
    const maxTokens =
      typeof body?.max_tokens === "number" ? body!.max_tokens : 1000;
    const parsedFileFilters = parseFileFilters(body?.file_filters);

    if (!question) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: {
          code: "INVALID_REQUEST",
          message: "question is required",
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    // Validate numeric ranges
    const contextLimit = Math.max(
      1,
      Math.min(20, Math.floor(contextLimitRaw ?? 5))
    );
    const similarityThreshold = Math.max(
      0,
      Math.min(
        1,
        Number.isFinite(simThreshRaw as number) ? (simThreshRaw as number) : 0.7
      )
    );
    const tempClamped = Math.max(0, Math.min(2, temperature));
    const maxTokensClamped = Math.max(
      100,
      Math.min(4000, Math.floor(maxTokens))
    );

    // Build whitelist of file_ids by applying file_filters to files table first
    const allFiles = (await FileModel.findAll({ raw: true }).catch(
      () => []
    )) as Array<{
      file_id: string;
      name: string;
      path: string;
      category: string;
      tags: string | null;
    }>;
    let allowedFileIds = new Set<string>();
    if (allFiles.length > 0) {
      for (const f of allFiles) {
        // file_ids filter
        if (
          parsedFileFilters.file_ids &&
          parsedFileFilters.file_ids.length > 0 &&
          !parsedFileFilters.file_ids.includes(f.file_id)
        )
          continue;
        // categories filter
        if (
          parsedFileFilters.categories &&
          parsedFileFilters.categories.length > 0 &&
          !parsedFileFilters.categories.includes(f.category)
        )
          continue;
        // tags filter (OR semantics)
        if (parsedFileFilters.tags && parsedFileFilters.tags.length > 0) {
          try {
            const tagsArr = f.tags ? (JSON.parse(f.tags) as string[]) : [];
            if (!parsedFileFilters.tags.some((t) => tagsArr.includes(t)))
              continue;
          } catch {
            continue;
          }
        }
        allowedFileIds.add(f.file_id);
      }
    }
    // If no filters provided, allow all files
    const usingFilters = Boolean(
      (parsedFileFilters.file_ids && parsedFileFilters.file_ids.length) ||
        (parsedFileFilters.categories && parsedFileFilters.categories.length) ||
        (parsedFileFilters.tags && parsedFileFilters.tags.length)
    );
    if (!usingFilters) {
      allowedFileIds = new Set(allFiles.map((f) => f.file_id));
    }

    // Load chunks for allowed files
    const chunks = (await ChunkModel.findAll({
      where: { file_id: Array.from(allowedFileIds) },
      raw: true,
    }).catch(() => [])) as Array<{
      id: number;
      file_id: string;
      chunk_index: number;
      content: string;
      chunk_id: string;
    }>;

    if (chunks.length === 0) {
      const cfgEmpty = configManager.getConfig();
      res.status(200).json({
        success: true,
        message: "ok",
        data: {
          answer:
            "No chunks matched the filter; please adjust file_filters or import files first.",
          confidence: 0.0,
          sources: [],
          metadata: {
            model_used: cfgEmpty.ollamaModel || "",
            tokens_used: 0,
            response_time_ms: Date.now() - startAll,
            retrieval_time_ms: 0,
            generation_time_ms: 0,
          },
        },
        error: null,
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    // Embed question
    const t0 = Date.now();
    let qEmbedding: number[] = [];
    try {
  const emb = await embedText([question]);
      qEmbedding = emb[0] ?? [];
      if (qEmbedding.length === 0) throw new Error("empty embedding");
    } catch (e) {
      logger.error("/api/chat/ask(mode2) embed failed", e as unknown);
      res.status(500).json({
        success: false,
        message: "embedding_error",
        data: null,
        error: {
          code: "EMBED_ERROR",
          message: (e as Error).message,
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }
    const embedMs = Date.now() - t0;

    // Build in-memory FAISS index for filtered chunks by embedding their contents
    // To reduce cost, cap number of chunks embedded to a reasonable upper bound (e.g., 2000)
    const MAX_CHUNKS = 2000;
    const selectedChunks = chunks.slice(0, MAX_CHUNKS);
    const texts = selectedChunks.map((c) => c.content);

    let vectors: number[][] = [];
    try {
  vectors = await embedText(texts);
    } catch (e) {
      logger.error("/api/chat/ask(mode2) chunk embedding failed", e as unknown);
      res.status(500).json({
        success: false,
        message: "embedding_error",
        data: null,
        error: {
          code: "EMBED_ERROR",
          message: (e as Error).message,
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const dim = vectors[0]?.length ?? 0;
    if (!dim) {
      res.status(500).json({
        success: false,
        message: "embedding_error",
        data: null,
        error: {
          code: "EMBED_ERROR",
          message: "No embeddings produced for chunks",
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    // Create in-memory index and add vectors
    let index: faiss.Index;
    try {
      const { IndexFlatL2 } = faiss as unknown as {
        IndexFlatL2: new (d: number) => faiss.Index;
      };
      index = new IndexFlatL2(dim);
    } catch (e) {
      logger.error("Failed to create in-memory FAISS index", e as unknown);
      res.status(500).json({
        success: false,
        message: "search_error",
        data: null,
        error: {
          code: "VECTOR_INDEX_ERROR",
          message: (e as Error).message,
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    // Flatten and add
    try {
      const flat: number[] = new Array(vectors.length * dim);
      for (let i = 0; i < vectors.length; i++) {
        const row = vectors[i]!;
        for (let d = 0; d < dim; d++) flat[i * dim + d] = row[d]!;
      }
      index.add(flat);
    } catch (e) {
      logger.error("Failed to add vectors to in-memory FAISS", e as unknown);
      res.status(500).json({
        success: false,
        message: "search_error",
        data: null,
        error: {
          code: "VECTOR_INDEX_ADD_ERROR",
          message: (e as Error).message,
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    // Perform search
    const t1 = Date.now();
    const k = Math.min(100, contextLimit * 5);
    const resFaiss = index.search(qEmbedding, Math.min(index.ntotal(), k));
    const labels = resFaiss.labels.filter((lbl) => lbl !== -1);
    const distances = resFaiss.distances.slice(0, labels.length);
    const retrievalMs = Date.now() - t1 + embedMs;

    // Convert distances to similarity scores in [0,1]
    const simScores = distances.map((d) => 1 / (1 + d));

    // Build rows from selectedChunks order (labels map directly to index order)
    const rows: Array<{
      id: number;
      chunk_id: string;
      file_id: string;
      chunk_index: number;
      content: string;
      file_name: string;
      file_path: string;
      file_category: string;
      file_tags: string | null;
      relevance_score: number;
    }> = [];

    // Build file map for metadata enrichment
    const fileIds = Array.from(new Set(selectedChunks.map((c) => c.file_id)));
    const files =
      fileIds.length > 0
        ? ((await FileModel.findAll({
            where: { file_id: fileIds },
            raw: true,
          }).catch(() => [])) as Array<{
            file_id: string;
            name: string;
            path: string;
            category: string;
            tags: string | null;
          }>)
        : [];
    const fileById = new Map<
      string,
      {
        file_id: string;
        name: string;
        path: string;
        category: string;
        tags: string | null;
      }
    >();
    for (const f of files) fileById.set(f.file_id, f);

    for (let i = 0; i < labels.length; i++) {
      const lbl = labels[i]!; // index into selectedChunks
      const chunk = selectedChunks[lbl]!;
      const f = fileById.get(chunk.file_id);
      rows.push({
        id: chunk.id,
        chunk_id: String(chunk.chunk_id),
        file_id: String(chunk.file_id),
        chunk_index: Number(chunk.chunk_index),
        content: String(chunk.content),
        file_name: f ? String(f.name) : "",
        file_path: f ? String(f.path) : "",
        file_category: f ? String(f.category) : "",
        file_tags: f ? (f.tags as string | null) : null,
        relevance_score: simScores[i] ?? 0,
      });
    }

    // Apply similarity threshold
    const filteredRows = rows.filter(
      (r) => r.relevance_score >= similarityThreshold
    );
    filteredRows.sort((a, b) => b.relevance_score - a.relevance_score);
    const top = filteredRows.slice(0, contextLimit);

    const contextStr = top
      .map(
        (r, i) =>
          `[#${i + 1}] File: ${r.file_name} (${r.file_path})\nChunk ${
            r.chunk_index
          }: ${r.content}`
      )
      .join("\n\n");

    const messages = buildChatAskMessages({ question, contextStr });
    const responseFormat = {
      json_schema: {
        name: "chat_qa_answer_schema",
        schema: {
          type: "object",
          properties: {
            answer: { type: "string" },
            confidence: { type: "number" },
          },
          required: ["answer", "confidence"],
        },
        strict: true,
      },
    } as const;

    const tGen = Date.now();
    let genObj: Record<string, unknown> = {};
    try {
      const result = await generateStructuredJson(
        messages,
        responseFormat,
        tempClamped,
        maxTokensClamped
      );
      genObj = (result as Record<string, unknown>) || {};
    } catch (e) {
      logger.error("/api/chat/ask(mode2) generation failed", e as unknown);
      res.status(500).json({
        success: false,
        message: "llm_error",
        data: null,
        error: {
          code: "LLM_ERROR",
          message: (e as Error).message,
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }
    const genMs = Date.now() - tGen;

    const answer =
      typeof genObj.answer === "string" ? (genObj.answer as string) : "";
    const conf =
      typeof genObj.confidence === "number"
        ? (genObj.confidence as number)
        : 0.0;

    const sources = top.map((r) => ({
      file_id: r.file_id,
      file_name: r.file_name,
      file_path: r.file_path,
      chunk_id: r.chunk_id,
      chunk_content: r.content,
      chunk_index: r.chunk_index,
      relevance_score: r.relevance_score,
    }));

    const cfg = configManager.getConfig();
    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        answer,
        confidence: Math.max(0, Math.min(1, conf)),
        sources,
        metadata: {
          model_used: cfg.ollamaModel || "",
          tokens_used: 0,
          response_time_ms: Date.now() - startAll,
          retrieval_time_ms: retrievalMs,
          generation_time_ms: genMs,
        },
      },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/chat/ask(mode2) failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: {
        code: "INTERNAL_ERROR",
        message: "Chat ask (mode2) failed",
        details: null,
      },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

type ChatDirectoryStructureBody = {
  profession?: unknown;
  purpose?: unknown;
  language?: unknown; // prompt template language, default "en"
  folder_depth?: unknown; // default 2
  min_directories?: unknown; // default 6
  max_directories?: unknown; // default 20
  temperature?: unknown; // default 0.7
  max_tokens?: unknown; // default 1000
  style?: unknown; // "flat" | "hierarchical" (default flat)
  provider?: unknown;
};

export async function chatDirectoryStructureHandler(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const startTs = Date.now();
    const body = req.body as ChatDirectoryStructureBody | undefined;
    const profession =
      typeof body?.profession === "string" ? body.profession.trim() : "";
    const purpose =
      typeof body?.purpose === "string" ? body.purpose.trim() : "";
    const folderDepth =
      typeof body?.folder_depth === "number" ? body.folder_depth : 2;
    const minDirsRaw =
      typeof body?.min_directories === "number" ? body.min_directories : 6;
    const maxDirsRaw =
      typeof body?.max_directories === "number" ? body.max_directories : 20;
    const temperature =
      typeof body?.temperature === "number" ? body.temperature : 0.7;
    const maxTokens =
      typeof body?.max_tokens === "number" ? body.max_tokens : 2000;
    const style: DirectoryStyle = normalizeDirectoryStyle(body?.style, "flat");

    if (!profession || !purpose) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: {
          code: "INVALID_REQUEST",
          message: "profession and purpose are required",
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const minDirectories = Math.max(1, Math.min(50, Math.floor(minDirsRaw)));
    const maxDirectories = Math.max(
      minDirectories,
      Math.min(100, Math.floor(maxDirsRaw))
    );
    const language: SupportedLang = normalizeLanguage(body?.language);
    const providerRaw =
      typeof body?.provider === "string"
        ? body.provider.trim().toLowerCase()
        : undefined;
    const provider: ProviderName | undefined =
      providerRaw === "openai"
        ? "openai"
        : providerRaw === "azure-openai" ||
          providerRaw === "azure" ||
          providerRaw === "azure_openai"
        ? "azure-openai"
        : providerRaw === "openrouter"
        ? "openrouter"
        : providerRaw === "bailian" ||
          providerRaw === "aliyun" ||
          providerRaw === "dashscope"
        ? "bailian"
        : providerRaw === "ollama"
        ? "ollama"
        : undefined;
    const messages = buildDirectoryStructureMessages({
      language,
      profession,
      purpose,
      folderDepth,
      minDirectories,
      maxDirectories,
      style,
    });
    const responseFormat = {
      json_schema: {
        name: "directory_schema",
        schema: {
          type: "object",
          properties: {
            directories: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  path: {
                    type: "string",
                  },
                  description: {
                    type: "string",
                  },
                },
                required: ["path", "description"],
              },
            },
          },
          required: ["directories"],
        },
        strict: true,
      },
    } as const;

    let result: unknown;
    try {
      result = await generateStructuredJson(
        messages,
        responseFormat,
        temperature,
        maxTokens,
        undefined,
        language,
        provider
      );
    } catch (err) {
      logger.error("/api/chat/directory-structure LLM failed", err as unknown);
      res.status(500).json({
        success: false,
        message: "llm_error",
        data: null,
        error: {
          code: "LLM_ERROR",
          message: (err as Error).message,
          details: null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const cfg = configManager.getConfig();
    const responseTime = Date.now() - startTs;
    const directories: { path: string; description: string }[] = [];
    type DirectoryItem = { path: string; description: string };
    const resultObj = result as { directories?: DirectoryItem[] } | undefined;
    for (const item of resultObj?.directories ?? []) {
      if (
        item &&
        typeof item === "object" &&
        "path" in item &&
        "description" in item &&
        typeof item.path === "string" &&
        typeof item.description === "string"
      ) {
        directories.push({ path: item.path, description: item.description });
      }
    }

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        directories,
        metadata: {
          model_used:
            getActiveModelName("chat", provider) || cfg.ollamaModel || "",
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
    logger.error("/api/chat/directory-structure failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: {
        code: "INTERNAL_ERROR",
        message: "Directory structure generation failed",
        details: null,
      },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}
