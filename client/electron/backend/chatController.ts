import type { Express, Request, Response } from "express";
import { generateStructuredJsonWithOllama } from "./utils/ollama";
import { logger } from "../logger";
import { configManager } from "../configManager";

export function registerChatRoutes(app: Express) {
  // POST /api/chat/recommend-directory
  app.post("/api/chat/recommend-directory", chatRecommendDirectoryHandler);
  // POST /api/chat/directory-structure
  app.post("/api/chat/directory-structure", chatDirectoryStructureHandler);
  // POST /api/chat/ask
  app.post("/api/chat/ask", chatAskHandler);
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

// ------------- Chat Ask (RAG) -------------
import ChunkModel from "./models/chunk";
import FileModel from "./models/file";
import { embedWithOllama } from "./utils/ollama";
import { isFaissAvailable, globalIndexExists, searchGlobalFaissIndex } from "./utils/vectorStore";
import faiss from "faiss-node";

type ChatAskBody = {
  question?: unknown;
  context_limit?: unknown;
  similarity_threshold?: unknown;
  temperature?: unknown;
  max_tokens?: unknown;
  stream?: unknown;
  file_filters?: unknown;
  mode?: unknown; // "mode1" or "mode2"
};

export async function chatAskHandler(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as ChatAskBody | undefined;
    const modeRaw = typeof body?.mode === "string" ? String(body!.mode).toLowerCase() : "";
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
export async function chatAskHandlerMode1(req: Request, res: Response): Promise<void> {
  const startAll = Date.now();
  try {
    const body = req.body as ChatAskBody | undefined;
    const question = typeof body?.question === "string" ? body!.question.trim() : "";
    const contextLimitRaw = typeof body?.context_limit === "number" ? body!.context_limit : undefined;
    const simThreshRaw = typeof body?.similarity_threshold === "number" ? body!.similarity_threshold : undefined;
    const temperature = typeof body?.temperature === "number" ? body!.temperature : 0.7;
    const maxTokens = typeof body?.max_tokens === "number" ? body!.max_tokens : 1000;
  // stream flag is accepted but not supported in current backend; ignore for now to keep API compatibility
  // const stream = typeof body?.stream === "boolean" ? body!.stream : false;
  const parsedFileFilters = ((): { file_ids?: string[]; categories?: string[]; tags?: string[] } => {
    const fileFilters = body?.file_filters;
    if (!fileFilters || typeof fileFilters !== "object") return {};
    const obj = fileFilters as Record<string, unknown>;
    const ids = Array.isArray(obj.file_ids) ? (obj.file_ids as unknown[]).filter((v) => typeof v === "string").map((v) => String(v)) : undefined;
    const cats = Array.isArray(obj.categories) ? (obj.categories as unknown[]).filter((v) => typeof v === "string").map((v) => String(v)) : undefined;
    const tags = Array.isArray(obj.tags) ? (obj.tags as unknown[]).filter((v) => typeof v === "string").map((v) => String(v)) : undefined;
    return { file_ids: ids, categories: cats, tags };
  })();

    if (!question) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: { code: "INVALID_REQUEST", message: "question is required", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    // Validate numeric ranges
    const contextLimit = Math.max(1, Math.min(20, Math.floor(contextLimitRaw ?? 5)));
    const similarityThreshold = Math.max(0, Math.min(1, Number.isFinite(simThreshRaw as number) ? (simThreshRaw as number) : 0.7));
    const tempClamped = Math.max(0, Math.min(2, temperature));
    const maxTokensClamped = Math.max(100, Math.min(4000, Math.floor(maxTokens)));

    // Embedding for the question
    const t0 = Date.now();
    let qEmbedding: number[] = [];
    try {
      const emb = await embedWithOllama([question]);
      qEmbedding = emb[0] ?? [];
      if (qEmbedding.length === 0) throw new Error("empty embedding");
    } catch (e) {
      logger.error("/api/chat/ask embed failed", e as unknown);
      res.status(500).json({
        success: false,
        message: "embedding_error",
        data: null,
        error: { code: "EMBED_ERROR", message: (e as Error).message, details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }
    const embedMs = Date.now() - t0;

    // FAISS search
    const t1 = Date.now();
    let chunkIds: number[] = [];
    let distances: number[] = [];
    if (!isFaissAvailable() || !(await globalIndexExists())) {
      res.status(200).json({
        success: true,
        message: "ok",
        data: {
          answer: "Knowledge base is empty, please import files first.",
          confidence: 0.0,
          sources: [],
          metadata: {
            model_used: configManager.getConfig().ollamaModel || "",
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

    try {
      const resFaiss = await searchGlobalFaissIndex({ query: qEmbedding, k: Math.min(100, contextLimit * 5), oversample: 1.0 });
      chunkIds = resFaiss.ids;
      distances = resFaiss.distances;
    } catch (e) {
      logger.error("/api/chat/ask faiss search failed", e as unknown);
      res.status(500).json({
        success: false,
        message: "search_error",
        data: null,
        error: { code: "VECTOR_SEARCH_ERROR", message: (e as Error).message, details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }
    const retrievalMs = Date.now() - t1 + embedMs;

    // Convert L2 distance to a crude similarity score in [0,1]
    const simScores = distances.map((d) => 1 / (1 + d));

    // Load chunk rows and join files; then apply file_filters
    let rows: Array<{
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
    if (chunkIds.length > 0) {
      const chunks = await ChunkModel.findAll({
        where: { id: chunkIds },
        raw: true,
      }).catch(() => []) as Array<{
        id: number;
        file_id: string;
        chunk_index: number;
        content: string;
        chunk_id: string;
      }>;

      // Map by id for quick access
  const byId = new Map<number, { id: number; file_id: string; chunk_index: number; content: string; chunk_id: string }>();
  for (const c of chunks) byId.set(c.id, c);

      // Gather unique file_ids
      const fileIds = Array.from(new Set(chunks.map((c) => c.file_id)));
      const files = fileIds.length > 0
        ? await FileModel.findAll({ where: { file_id: fileIds }, raw: true }).catch(() => []) as Array<{
            file_id: string;
            name: string;
            path: string;
            category: string;
            tags: string | null;
          }>
        : [];
      const fileById = new Map<string, { file_id: string; name: string; path: string; category: string; tags: string | null }>();
      for (const f of files) fileById.set(f.file_id, f);

      // Assemble rows in the order of faiss ids list, attach similarity
      for (let i = 0; i < chunkIds.length; i++) {
        const id = chunkIds[i];
        const sim = simScores[i] ?? 0;
        const c = byId.get(id);
        if (!c) continue;
  const f = fileById.get(c.file_id);
        rows.push({
          id,
          chunk_id: String(c.chunk_id),
          file_id: String(c.file_id),
          chunk_index: Number(c.chunk_index),
          content: String(c.content),
          file_name: f ? String(f.name) : "",
          file_path: f ? String(f.path) : "",
          file_category: f ? String(f.category) : "",
          file_tags: f ? (f.tags as string | null) : null,
          relevance_score: sim,
        });
      }
    }

    // Apply file_filters
    if (rows.length > 0) {
      rows = rows.filter((r) => {
        if (parsedFileFilters.file_ids && parsedFileFilters.file_ids.length > 0 && !parsedFileFilters.file_ids.includes(r.file_id)) return false;
        if (parsedFileFilters.categories && parsedFileFilters.categories.length > 0 && !parsedFileFilters.categories.includes(r.file_category)) return false;
        if (parsedFileFilters.tags && parsedFileFilters.tags.length > 0) {
          try {
            const tagsArr = r.file_tags ? (JSON.parse(r.file_tags) as string[]) : [];
            if (!parsedFileFilters.tags.some((t) => tagsArr.includes(t))) return false;
          } catch {
            return false;
          }
        }
        return true;
      });
    }

    // Similarity threshold
    rows = rows.filter((r) => r.relevance_score >= similarityThreshold);
    // Take top-N by score
    rows.sort((a, b) => b.relevance_score - a.relevance_score);
    const top = rows.slice(0, contextLimit);

    // Build context string
    const contextStr = top.map((r, i) => `[#${i + 1}] File: ${r.file_name} (${r.file_path})\nChunk ${r.chunk_index}: ${r.content}`).join("\n\n");

    // LLM prompt for answer generation with JSON schema
    const messages = [
      { role: "system" as const, content: "You are a helpful assistant that answers questions using provided context accurately. If the answer is not in the context, say you are not sure. Output JSON only." },
      { role: "user" as const, content: `Question: ${question}\n\nContext:\n${contextStr}\n\nReturn JSON: {\n  "answer": string,\n  "confidence": number\n}` },
    ];
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
      const result = await generateStructuredJsonWithOllama(messages, responseFormat, tempClamped, maxTokensClamped);
      genObj = (result as Record<string, unknown>) || {};
    } catch (e) {
      logger.error("/api/chat/ask generation failed", e as unknown);
      res.status(500).json({
        success: false,
        message: "llm_error",
        data: null,
        error: { code: "LLM_ERROR", message: (e as Error).message, details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }
    const genMs = Date.now() - tGen;

    const answer = typeof genObj.answer === "string" ? (genObj.answer as string) : "";
    const conf = typeof genObj.confidence === "number" ? (genObj.confidence as number) : 0.0;

    // Build sources output
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
    logger.error("/api/chat/ask failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Chat ask failed", details: null },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

// Mode2: Build an in-memory FAISS index from filtered files, then search
export async function chatAskHandlerMode2(req: Request, res: Response): Promise<void> {
  const startAll = Date.now();
  try {
    const body = req.body as ChatAskBody | undefined;
    const question = typeof body?.question === "string" ? body!.question.trim() : "";
    const contextLimitRaw = typeof body?.context_limit === "number" ? body!.context_limit : undefined;
    const simThreshRaw = typeof body?.similarity_threshold === "number" ? body!.similarity_threshold : undefined;
    const temperature = typeof body?.temperature === "number" ? body!.temperature : 0.7;
    const maxTokens = typeof body?.max_tokens === "number" ? body!.max_tokens : 1000;
    const parsedFileFilters = ((): { file_ids?: string[]; categories?: string[]; tags?: string[] } => {
      const fileFilters = body?.file_filters;
      if (!fileFilters || typeof fileFilters !== "object") return {};
      const obj = fileFilters as Record<string, unknown>;
      const ids = Array.isArray(obj.file_ids) ? (obj.file_ids as unknown[]).filter((v) => typeof v === "string").map((v) => String(v)) : undefined;
      const cats = Array.isArray(obj.categories) ? (obj.categories as unknown[]).filter((v) => typeof v === "string").map((v) => String(v)) : undefined;
      const tags = Array.isArray(obj.tags) ? (obj.tags as unknown[]).filter((v) => typeof v === "string").map((v) => String(v)) : undefined;
      return { file_ids: ids, categories: cats, tags };
    })();

    if (!question) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: { code: "INVALID_REQUEST", message: "question is required", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    // Validate numeric ranges
    const contextLimit = Math.max(1, Math.min(20, Math.floor(contextLimitRaw ?? 5)));
    const similarityThreshold = Math.max(0, Math.min(1, Number.isFinite(simThreshRaw as number) ? (simThreshRaw as number) : 0.7));
    const tempClamped = Math.max(0, Math.min(2, temperature));
    const maxTokensClamped = Math.max(100, Math.min(4000, Math.floor(maxTokens)));

    // Build whitelist of file_ids by applying file_filters to files table first
    const allFiles = await FileModel.findAll({ raw: true }).catch(() => []) as Array<{
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
        if (parsedFileFilters.file_ids && parsedFileFilters.file_ids.length > 0 && !parsedFileFilters.file_ids.includes(f.file_id)) continue;
        // categories filter
        if (parsedFileFilters.categories && parsedFileFilters.categories.length > 0 && !parsedFileFilters.categories.includes(f.category)) continue;
        // tags filter (OR semantics)
        if (parsedFileFilters.tags && parsedFileFilters.tags.length > 0) {
          try {
            const tagsArr = f.tags ? (JSON.parse(f.tags) as string[]) : [];
            if (!parsedFileFilters.tags.some((t) => tagsArr.includes(t))) continue;
          } catch {
            continue;
          }
        }
        allowedFileIds.add(f.file_id);
      }
    }
    // If no filters provided, allow all files
    const usingFilters = Boolean((parsedFileFilters.file_ids && parsedFileFilters.file_ids.length) || (parsedFileFilters.categories && parsedFileFilters.categories.length) || (parsedFileFilters.tags && parsedFileFilters.tags.length));
    if (!usingFilters) {
      allowedFileIds = new Set(allFiles.map((f) => f.file_id));
    }

    // Load chunks for allowed files
    const chunks = await ChunkModel.findAll({ where: { file_id: Array.from(allowedFileIds) }, raw: true }).catch(() => []) as Array<{
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
          answer: "No chunks matched the filter; please adjust file_filters or import files first.",
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
      const emb = await embedWithOllama([question]);
      qEmbedding = emb[0] ?? [];
      if (qEmbedding.length === 0) throw new Error("empty embedding");
    } catch (e) {
      logger.error("/api/chat/ask(mode2) embed failed", e as unknown);
      res.status(500).json({
        success: false,
        message: "embedding_error",
        data: null,
        error: { code: "EMBED_ERROR", message: (e as Error).message, details: null },
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
      vectors = await embedWithOllama(texts);
    } catch (e) {
      logger.error("/api/chat/ask(mode2) chunk embedding failed", e as unknown);
      res.status(500).json({
        success: false,
        message: "embedding_error",
        data: null,
        error: { code: "EMBED_ERROR", message: (e as Error).message, details: null },
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
        error: { code: "EMBED_ERROR", message: "No embeddings produced for chunks", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    // Create in-memory index and add vectors
    let index: faiss.Index;
    try {
      const { IndexFlatL2 } = faiss as unknown as { IndexFlatL2: new (d: number) => faiss.Index };
      index = new IndexFlatL2(dim);
    } catch (e) {
      logger.error("Failed to create in-memory FAISS index", e as unknown);
      res.status(500).json({
        success: false,
        message: "search_error",
        data: null,
        error: { code: "VECTOR_INDEX_ERROR", message: (e as Error).message, details: null },
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
        error: { code: "VECTOR_INDEX_ADD_ERROR", message: (e as Error).message, details: null },
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
    const files = fileIds.length > 0
      ? await FileModel.findAll({ where: { file_id: fileIds }, raw: true }).catch(() => []) as Array<{
          file_id: string;
          name: string;
          path: string;
          category: string;
          tags: string | null;
        }>
      : [];
    const fileById = new Map<string, { file_id: string; name: string; path: string; category: string; tags: string | null }>();
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
    const filteredRows = rows.filter((r) => r.relevance_score >= similarityThreshold);
    filteredRows.sort((a, b) => b.relevance_score - a.relevance_score);
    const top = filteredRows.slice(0, contextLimit);

    const contextStr = top.map((r, i) => `[#${i + 1}] File: ${r.file_name} (${r.file_path})\nChunk ${r.chunk_index}: ${r.content}`).join("\n\n");

    const messages = [
      { role: "system" as const, content: "You are a helpful assistant that answers questions using provided context accurately. If the answer is not in the context, say you are not sure. Output JSON only." },
      { role: "user" as const, content: `Question: ${question}\n\nContext:\n${contextStr}\n\nReturn JSON: {\n  "answer": string,\n  "confidence": number\n}` },
    ];
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
      const result = await generateStructuredJsonWithOllama(messages, responseFormat, tempClamped, maxTokensClamped);
      genObj = (result as Record<string, unknown>) || {};
    } catch (e) {
      logger.error("/api/chat/ask(mode2) generation failed", e as unknown);
      res.status(500).json({
        success: false,
        message: "llm_error",
        data: null,
        error: { code: "LLM_ERROR", message: (e as Error).message, details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }
    const genMs = Date.now() - tGen;

    const answer = typeof genObj.answer === "string" ? (genObj.answer as string) : "";
    const conf = typeof genObj.confidence === "number" ? (genObj.confidence as number) : 0.0;

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
      error: { code: "INTERNAL_ERROR", message: "Chat ask (mode2) failed", details: null },
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
