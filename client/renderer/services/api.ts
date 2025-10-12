// Dynamic API base URL - will be initialized from electron store
let ROOT_BASE_URL = 'http://localhost:8000';
let API_BASE_URL = `${ROOT_BASE_URL}/api`;

import { FileConversionResult, StageFileResponse } from '../shared/types';
import type { AppConfig } from '../shared/types';

// Function to update API base URL
export const updateApiBaseUrl = (url: string) => {
  const normalized = url.replace(/\/+$/, '');
  ROOT_BASE_URL = normalized;
  API_BASE_URL = `${normalized}/api`;
};

// Initialize API base URL from electron store
const initializeApiBaseUrl = async () => {
  if (window.electronAPI) {
    try {
      const url = await window.electronAPI.getApiBaseUrl();
      updateApiBaseUrl(url);
    } catch (error) {
      console.warn('Failed to get API base URL from store, using default:', error);
      ROOT_BASE_URL = 'http://localhost:8000';
      API_BASE_URL = `${ROOT_BASE_URL}/api`;
    }
  }
};

// Initialize immediately
initializeApiBaseUrl();

interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data: T;
  error: {
    code: string;
    message: string;
    details: unknown;
  } | null;
  timestamp: string;
  request_id: string;
}

export interface ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  payload?: unknown;
}

interface RecommendDirectoryResponse {
  recommended_directory: string;
  alternatives: string[];
}

interface DescribeImageResponse {
  description: string;
  language: string;
  model_used: string;
}

interface FileConversionFormats {
  input_formats: string[];
  output_formats: string[];
  default_output_directory: string;
  pandoc_available: boolean;
  markitdown_available: boolean;
}

interface FileDetail {
  id: string;
  name: string;
  path: string;
  type: string;
  category: string;
  summary: string;
  tags: string[];
  size: number;
  chunks_count: number;
  created_at: string;
  updated_at: string;
  metadata: {
    author?: string;
    created_date?: string;
    modified_date?: string;
  };
}

export interface ChatSearchResultItem {
  chunk_record_id: number;
  chunk_id: string;
  chunk_index: number;
  file_id: string;
  file_name: string;
  file_path: string;
  file_category: string;
  file_tags: string[];
  snippet: string;
  relevance_score: number;
  match_reason: string;
}

export interface ChatSearchMetadata {
  query: string;
  result_count: number;
  keyword_time_ms: number;
  vector_time_ms: number | null;
  retrieval_time_ms: number;
  similarity_threshold: number;
  context_limit: number;
  max_results: number;
  filters_applied: {
    file_ids: string[];
    categories: string[];
    tags: string[];
  };
  response_time_ms: number;
}

export interface ChatSearchResponse {
  results: ChatSearchResultItem[];
  retrieval_mode: 'keyword' | 'vector' | 'none';
  metadata: ChatSearchMetadata;
}

export interface QuestionSource {
  file_id: string;
  file_name: string;
  file_path: string;
  chunk_id: string;
  chunk_content: string;
  chunk_index: number;
  relevance_score: number;
  match_reason?: string;
}

export interface QuestionResponse {
  answer: string;
  confidence: number;
  sources: QuestionSource[];
  metadata: {
    model_used: string;
    tokens_used: number;
    response_time_ms: number;
    retrieval_time_ms: number;
    generation_time_ms: number;
    retrieval_mode?: 'keyword' | 'vector' | 'none' | 'manual';
  };
}

export interface AnalyzeChunkSelection {
  chunk_record_id: number;
  relevance_score: number;
  match_reason: string;
}

export interface SearchKnowledgeOptions {
  context_limit?: number;
  similarity_threshold?: number;
  max_results?: number;
  file_ids?: string[];
  categories?: string[];
  tags?: string[];
}

export interface AnalyzeQuestionOptions {
  context_limit?: number;
  temperature?: number;
  max_tokens?: number;
  similarity_threshold?: number;
  override_model?: string;
  language?: string;
  providerOverride?: string;
}

interface SystemConfigUpdate {
  llm_type?: 'local' | 'openai' | 'ollama' | 'claude' | 'custom';
  llm_endpoint?: string;
  llm_api_key?: string;
  chunk_size?: number;
  chunk_overlap?: number;
  similarity_threshold?: number;
  max_file_size_mb?: number;
  workdir_path?: string;
}

type ProviderName = 'ollama' | 'openai' | 'azure-openai' | 'openrouter' | 'bailian' | 'pega';

class ApiService {
  private locale = 'en';
  private provider: ProviderName | null = null;
  private pegaBaseUrl: string | null = null;

  private async ensureProvider(): Promise<ProviderName> {
    // Load once from app config via IPC and cache locally
    if (this.provider !== null) return this.provider;
    try {
      const cfg = (await window.electronAPI.getAppConfig()) as import('../shared/types').AppConfig | undefined;
      const p = (cfg?.llmProvider ?? 'ollama') as ProviderName;
      this.provider = p;
      return p;
    } catch (err) {
      console.warn('Failed to load provider from app config:', err);
      // Fallback to default used by main process config defaults
      this.provider = 'ollama';
      return 'ollama';
    }
  }

  setProvider(provider: ProviderName) {
    this.provider = provider;
    this.pegaBaseUrl = null;
  }

  clearProviderCache() {
    this.provider = null;
    this.pegaBaseUrl = null;
  }

  setLocale(locale: string) {
    this.locale = locale;
  }

  private mergeHeaders(headers?: HeadersInit): HeadersInit {
    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept-Language': this.locale,
    };

    if (!headers) {
      return baseHeaders;
    }

    if (headers instanceof Headers) {
      const result = new Headers(headers);
      result.set('Accept-Language', this.locale);
      if (!result.has('Content-Type')) {
        result.set('Content-Type', 'application/json');
      }
      return result;
    }

    if (Array.isArray(headers)) {
      const result = new Headers(headers);
      result.set('Accept-Language', this.locale);
      if (!result.has('Content-Type')) {
        result.set('Content-Type', 'application/json');
      }
      return result;
    }

    return {
      ...baseHeaders,
      ...(headers as Record<string, string>),
    };
  }

  private async parseJsonOrThrow<T>(response: Response): Promise<T> {
    const rawText = await response.text();
    const trimmed = rawText.trim();
    let parsed: unknown;
    let parsedSuccessfully = false;

    if (trimmed.length > 0) {
      try {
        parsed = JSON.parse(trimmed);
        parsedSuccessfully = true;
      } catch {
        parsedSuccessfully = false;
      }
    }

    if (!response.ok) {
      const error = new Error(`HTTP error! status: ${response.status}`) as ApiError;
      error.status = response.status;

      if (parsedSuccessfully && parsed && typeof parsed === 'object') {
        const payload = parsed as Partial<ApiResponse<unknown>>;
        const errorPart = (payload.error ?? undefined) as
          | { code?: string; message?: string; details?: unknown }
          | null
          | undefined;
        const fromErrorPart = typeof errorPart?.message === 'string' ? errorPart.message : undefined;
        const fromPayloadMessage = typeof payload.message === 'string' ? payload.message : undefined;

        if (fromErrorPart && fromErrorPart.trim()) {
          error.message = fromErrorPart;
        } else if (fromPayloadMessage && fromPayloadMessage.trim()) {
          error.message = fromPayloadMessage;
        }

        if (errorPart?.code) {
          error.code = errorPart.code;
        }

        if (errorPart?.details !== undefined) {
          error.details = errorPart.details;
        }

        error.payload = payload;
      } else if (trimmed.length > 0) {
        error.message = trimmed;
        error.payload = trimmed;
      }

      throw error;
    }

    if (!parsedSuccessfully) {
      if (trimmed.length === 0) {
        return undefined as T;
      }
      throw new Error('Failed to parse JSON response');
    }

    return parsed as T;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const url = `${API_BASE_URL}${endpoint}`;
    const mergedHeaders = this.mergeHeaders(options.headers);
    const response = await fetch(url, {
      ...options,
      headers: mergedHeaders,
    });

    return this.parseJsonOrThrow<ApiResponse<T>>(response);
  }

  private async requestFromRoot<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${ROOT_BASE_URL}${endpoint}`;
    const mergedHeaders = this.mergeHeaders(options.headers);
    const response = await fetch(url, {
      ...options,
      headers: mergedHeaders,
    });

    return this.parseJsonOrThrow<T>(response);
  }

  private async ensurePegaBaseUrl(): Promise<string> {
    if (this.pegaBaseUrl) {
      return this.pegaBaseUrl;
    }

    if (!window.electronAPI) {
      throw new Error('Electron API is unavailable; cannot resolve Pega endpoint');
    }

    try {
      const cfg = (await window.electronAPI.getAppConfig()) as AppConfig | undefined;
      const endpoint = cfg?.pega?.pegaEndpoint;
      if (typeof endpoint === 'string' && endpoint.trim().length > 0) {
        const normalized = endpoint.replace(/\/+$/, '');
        this.pegaBaseUrl = normalized;
        return normalized;
      }
      throw new Error('Pega endpoint not configured');
    } catch (error) {
      console.warn('Failed to resolve Pega endpoint from config, using default http://127.0.0.1:3300:', error);
      const fallback = 'http://127.0.0.1:3300';
      this.pegaBaseUrl = fallback;
      return fallback;
    }
  }

  private async requestFromPega<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const baseUrl = await this.ensurePegaBaseUrl();
    const url = `${baseUrl}${endpoint}`;
    const mergedHeaders = this.mergeHeaders(options.headers);
    const response = await fetch(url, {
      ...options,
      headers: mergedHeaders,
    });

    return this.parseJsonOrThrow<T>(response);
  }

  private extractToken(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }
    const base = payload as Record<string, unknown>;
    if (typeof base.token === 'string') {
      return base.token;
    }
    const data = base.data;
    if (data && typeof data === 'object') {
      const token = (data as Record<string, unknown>).token;
      if (typeof token === 'string') {
        return token;
      }
    }
    return undefined;
  }

  private extractApiKey(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }
    const base = payload as Record<string, unknown>;
    if (typeof base.apiKey === 'string') {
      return base.apiKey;
    }
    const data = base.data;
    if (data && typeof data === 'object') {
      const apiKey = (data as Record<string, unknown>).apiKey;
      if (typeof apiKey === 'string') {
        return apiKey;
      }
    }
    return undefined;
  }

  private extractMessage(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object') {
      return undefined;
    }
    const base = payload as Record<string, unknown>;
    if (typeof base.message === 'string') {
      return base.message;
    }
    const data = base.data;
    if (data && typeof data === 'object') {
      const msg = (data as Record<string, unknown>).message;
      if (typeof msg === 'string') {
        return msg;
      }
    }
    return undefined;
  }

  // 获取目录结构推荐
  async getDirectoryStructure(params: {
    profession: string;
    purpose: string;
    max_depth?: number; // kept for backward compatibility with callers
    folder_depth?: number; // backend expects folder_depth
    min_directories?: number;
    max_directories?: number;
    temperature?: number;
    language?: string; // pass to backend for prompt localization
    style?: 'flat' | 'hierarchical';
  }) {
    const provider = await this.ensureProvider();
    return this.request('/chat/directory-structure', {
      method: 'POST',
      body: JSON.stringify({
        provider,
        profession: params.profession,
        purpose: params.purpose,
        // backend expects folder_depth; prefer explicit folder_depth, fallback to max_depth, then default 2
        folder_depth: params.folder_depth ?? params.max_depth ?? 2,
        min_directories: params.min_directories || 6,
        max_directories: params.max_directories || 20,
        temperature: params.temperature || 0.7,
        language: params.language,
        style: params.style || 'flat',
      }),
    });
  }

  // 创建文件夹结构
  async createFolders(targetFolder: string, structure: Array<{ name: string; type: string }>) {
    return this.request('/files/create-folders', {
      method: 'POST',
      body: JSON.stringify({
        target_folder: targetFolder,
        structure,
      }),
    });
  }

  // 列出目录结构
  async listDirectory(directoryPath: string) {
    return this.request('/files/list-directory', {
      method: 'POST',
      body: JSON.stringify({
        directory_path: directoryPath,
      }),
    });
  }

  // 递归列出目录结构
  async listDirectoryRecursive(directoryPath: string, maxDepth: number = 3) {
    return this.request('/files/list-directory-recursive', {
      method: 'POST',
      body: JSON.stringify({
        directory_path: directoryPath,
        max_depth: maxDepth,
      }),
    });
  }

  // 文件预览（支持缩放图片）
  async previewFile(
    filePath: string,
    opts?: { origin?: boolean; maxWidth?: number; maxHeight?: number }
  ) {
    const payload: Record<string, unknown> = { file_path: filePath };
    if (typeof opts?.origin === 'boolean') payload.origin = opts.origin;
    if (typeof opts?.maxWidth === 'number') payload.max_width = opts.maxWidth;
    if (typeof opts?.maxHeight === 'number') payload.max_height = opts.maxHeight;
    return this.request('/files/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // 导入文件
  async importFile(filePath: string, category?: string, tags?: string[], autoProcess: boolean = true) {
    const provider = await this.ensureProvider();
    return this.request('/files/import', {
      method: 'POST',
      body: JSON.stringify({
        provider,
        file_path: filePath,
        category,
        tags,
        auto_process: autoProcess,
      }),
    });
  }

  // 保存文件到目录
  async stageFileToTemp(sourceFilePath: string) {
    return this.request<StageFileResponse>('/files/stage', {
      method: 'POST',
      body: JSON.stringify({
        source_file_path: sourceFilePath,
      }),
    });
  }

  async saveFile(sourceFilePath: string, targetDirectory: string, overwrite: boolean = false, fileId?: string) {
    return this.request('/files/save-file', {
      method: 'POST',
      body: JSON.stringify({
        source_file_path: sourceFilePath,
        target_directory: targetDirectory,
        overwrite,
        ...(fileId ? { file_id: fileId } : {}),
      }),
    });
  }

  // 获取分类建议
  async suggestCategory(filePath: string, directoryStructure?: Array<{ name: string; type: string }>) {
    const provider = await this.ensureProvider();
    return this.request('/files/suggest-category', {
      method: 'POST',
      body: JSON.stringify({
        provider,
        file_path: filePath,
        directory_structure: directoryStructure,
      }),
    });
  }

  // 推荐保存目录
  async recommendDirectory(filePath: string, availableDirectories: string[], content?: string): Promise<ApiResponse<RecommendDirectoryResponse>> {
    const provider = await this.ensureProvider();
    return this.request<RecommendDirectoryResponse>('/files/recommend-directory', {
      method: 'POST',
      body: JSON.stringify({
        provider,
        file_path: filePath,
        available_directories: availableDirectories,
        ...(content && content.trim() ? { content } : {}),
      }),
    });
  }

  // 导入到RAG库
  async importToRag(fileId: string, noSaveDb: boolean = false, content?: string) {
    const provider = await this.ensureProvider();
    return this.request('/files/import-to-rag', {
      method: 'POST',
      body: JSON.stringify({
        provider,
        file_id: fileId,
        no_save_db: noSaveDb,
        ...(content && content.trim() ? { content } : {}),
      }),
    });
  }

  // 图像描述（视觉）：支持 max_tokens 限制
  async describeImage(imageBase64: string, language?: 'zh' | 'en', promptHint?: string, timeoutMs?: number, maxTokens?: number) {
    const provider = await this.ensureProvider();
    return this.request<DescribeImageResponse>('/chat/describe-image', {
      method: 'POST',
      body: JSON.stringify({
        provider,
        image_base64: imageBase64,
        language,
        prompt_hint: promptHint,
        timeout_ms: timeoutMs,
        ...(typeof maxTokens === 'number' && maxTokens > 0 ? { max_tokens: maxTokens } : {}),
      }),
    });
  }

  async searchKnowledge(question: string, options?: SearchKnowledgeOptions): Promise<ApiResponse<ChatSearchResponse>> {
    const contextLimit = Math.max(1, Math.floor(options?.context_limit ?? 5));
    const similarityThreshold =
      typeof options?.similarity_threshold === 'number'
        ? options.similarity_threshold
        : 0.7;
    const maxResultsRaw =
      typeof options?.max_results === 'number'
        ? Math.max(1, Math.floor(options.max_results))
        : contextLimit * 4;
    const payload: Record<string, unknown> = {
      query: question,
      context_limit: contextLimit,
      similarity_threshold: similarityThreshold,
      max_results: Math.min(50, maxResultsRaw),
    };

    const filters: Record<string, unknown> = {};
    if (options?.file_ids && options.file_ids.length > 0) {
      filters.file_ids = options.file_ids;
    }
    if (options?.categories && options.categories.length > 0) {
      filters.categories = options.categories;
    }
    if (options?.tags && options.tags.length > 0) {
      filters.tags = options.tags;
    }
    if (Object.keys(filters).length > 0) {
      payload.file_filters = filters;
    }

  return this.request<ChatSearchResponse>('/chat/search', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async analyzeQuestion(
    question: string,
    selectedChunks: AnalyzeChunkSelection[],
    options?: AnalyzeQuestionOptions
  ): Promise<ApiResponse<QuestionResponse>> {
    const provider =
      options?.providerOverride ?? (await this.ensureProvider());
    const contextLimit = Math.max(
      1,
      Math.floor(options?.context_limit ?? Math.max(selectedChunks.length, 5))
    );
    const payload: Record<string, unknown> = {
      question,
      selected_chunks: selectedChunks.map((chunk) => ({
        chunk_record_id: chunk.chunk_record_id,
        relevance_score: chunk.relevance_score,
        match_reason: chunk.match_reason,
      })),
      context_limit: contextLimit,
      temperature:
        typeof options?.temperature === 'number' ? options.temperature : 0.7,
      max_tokens:
        typeof options?.max_tokens === 'number'
          ? Math.max(100, Math.floor(options.max_tokens))
          : 2000,
      similarity_threshold:
        typeof options?.similarity_threshold === 'number'
          ? options.similarity_threshold
          : 0.7,
      provider,
    };

    if (options?.override_model) {
      payload.override_model = options.override_model;
    }
    if (options?.language) {
      payload.language = options.language;
    }

  return this.request<QuestionResponse>('/chat/analyze', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // 文件名搜索
  // 获取文件格式转换支持的格式
  async getConversionFormats() {
    return this.request<FileConversionFormats>('/files/convert/formats', {
      method: 'GET',
    });
  }

  // 将文件转换为指定格式
  async convertFile(payload: { filePath: string; targetFormat: string; outputDirectory?: string; overwrite?: boolean }) {
    return this.request<FileConversionResult>('/files/convert', {
      method: 'POST',
      body: JSON.stringify({
        file_path: payload.filePath,
        target_format: payload.targetFormat,
        output_directory: payload.outputDirectory,
        overwrite: payload.overwrite ?? false,
      }),
    });
  }

  async filenameSearch(query: string, page: number = 1, limit: number = 20, fileTypes?: string[], categories?: string[]) {
    return this.request('/search/filename', {
      method: 'POST',
      body: JSON.stringify({
        query,
        page,
        limit,
        file_types: fileTypes,
        categories,
      }),
    });
  }

  // 获取分段内容
  async getChunkContent(chunkId: string) {
    return this.request(`/files/chunks/${chunkId}`, {
      method: 'GET',
    });
  }

  // 清空所有数据
  async clearAllData() {
    return this.request('/system/clear-data', {
      method: 'POST',
    });
  }

  // 更新系统配置
  async updateSystemConfig(config: SystemConfigUpdate) {
    return this.request('/system/config/update', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  // 获取文件列表
  async getFileList(params?: {
    page?: number;
    limit?: number;
    category?: string;
    type?: string;
    search?: string;
    tags?: string[];
    sort_by?: string;
    sort_order?: string;
  }) {
    return this.request('/files/list', {
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  }

  // 获取文件详情
  async getFileDetail(fileId: string): Promise<ApiResponse<FileDetail>> {
    return this.request<FileDetail>(`/files/${fileId}`, {
      method: 'GET',
    });
  }

  // 更新文件信息（名称、分类、标签），支持重命名磁盘文件
  async updateFile(payload: { file_id: string; name?: string; category?: string; tags?: string[] }) {
    return this.request('/files/update', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // 删除文件记录，可选删除磁盘文件
  async deleteFile(payload: { file_id: string; deleteFromDisk?: boolean }) {
    return this.request('/files/delete', {
      method: 'POST',
      body: JSON.stringify({
        file_id: payload.file_id,
        confirm_delete: Boolean(payload.deleteFromDisk),
      }),
    });
  }

  // 创建单个目录
  async createDirectory(directoryPath: string) {
    return this.request('/files/create-directory', {
      method: 'POST',
      body: JSON.stringify({
        directory_path: directoryPath,
      }),
    });
  }

  // 智能问答
  async askQuestion(question: string, options?: {
    context_limit?: number;
    similarity_threshold?: number;
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    file_ids?: string[];
  }): Promise<ApiResponse<QuestionResponse>> {
    const provider = await this.ensureProvider();
    const contextLimit = Math.max(1, Math.floor(options?.context_limit ?? 5));
    const similarityThreshold =
      typeof options?.similarity_threshold === 'number'
        ? options.similarity_threshold
        : 0.5;

    const searchResponse = await this.searchKnowledge(question, {
      context_limit: contextLimit,
      similarity_threshold: similarityThreshold,
      max_results: contextLimit * 4,
      file_ids: options?.file_ids,
    });

    if (!searchResponse.success) {
      return searchResponse as unknown as ApiResponse<QuestionResponse>;
    }

    const searchData = searchResponse.data as ChatSearchResponse | undefined;
    if (!searchData) {
      const nowIso = new Date().toISOString();
      return {
        success: true,
        message: 'no_context',
        data: {
          answer: 'No relevant context found. Please refine your search or import more documents.',
          confidence: 0,
          sources: [],
          metadata: {
            model_used: provider,
            tokens_used: 0,
            response_time_ms: 0,
            retrieval_time_ms: 0,
            generation_time_ms: 0,
            retrieval_mode: 'none',
          },
        },
        error: null,
        timestamp: nowIso,
        request_id: '',
      };
    }

    const selections = searchData.results
      .slice(0, contextLimit)
      .map((item) => ({
        chunk_record_id: item.chunk_record_id,
        relevance_score: item.relevance_score,
        match_reason: item.match_reason,
      }));

    if (selections.length === 0) {
      const nowIso = new Date().toISOString();
      return {
        success: true,
        message: 'no_context',
        data: {
          answer: 'No relevant context found. Please refine your search or import more documents.',
          confidence: 0,
          sources: [],
          metadata: {
            model_used: provider,
            tokens_used: 0,
            response_time_ms: searchData.metadata.response_time_ms,
            retrieval_time_ms: searchData.metadata.retrieval_time_ms,
            generation_time_ms: 0,
            retrieval_mode: searchData.retrieval_mode,
          },
        },
        error: null,
        timestamp: nowIso,
        request_id: '',
      };
    }

    return this.analyzeQuestion(question, selections, {
      context_limit: contextLimit,
      temperature: options?.temperature,
      max_tokens: options?.max_tokens,
      similarity_threshold: similarityThreshold,
      providerOverride: provider,
    });
  }

  async registerPegaAccount(payload: { email?: string; phone?: string; password: string }) {
    const bodyPayload: Record<string, string> = {
      email: payload.email ?? '',
      phone: payload.phone ?? '',
      password: payload.password,
    };

    const body = JSON.stringify(bodyPayload);
    const response = await this.requestFromPega<Record<string, unknown>>('/auth/register', {
      method: 'POST',
      body,
    });
    return {
      token: this.extractToken(response),
      message: this.extractMessage(response),
      raw: response,
    };
  }

  async loginPegaAccount(payload: { identifier: string; password: string }) {
    const body = JSON.stringify({
      identifier: payload.identifier,
      password: payload.password,
    });
    const response = await this.requestFromPega<Record<string, unknown>>('/auth/login', {
      method: 'POST',
      body,
    });
    return {
      token: this.extractToken(response),
      message: this.extractMessage(response),
      raw: response,
    };
  }

  async fetchPegaApiKey(token: string) {
    const response = await this.requestFromPega<Record<string, unknown>>('/auth/apikey', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return {
      apiKey: this.extractApiKey(response),
      message: this.extractMessage(response),
      raw: response,
    };
  }
}

export const apiService = new ApiService();