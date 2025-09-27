// Dynamic API base URL - will be initialized from electron store
let API_BASE_URL = 'http://localhost:8000/api';

import { FileConversionResult } from '../shared/types';

// Function to update API base URL
export const updateApiBaseUrl = (url: string) => {
  API_BASE_URL = `${url}/api`;
};

// Initialize API base URL from electron store
const initializeApiBaseUrl = async () => {
  if (window.electronAPI) {
    try {
      const url = await window.electronAPI.getApiBaseUrl();
      updateApiBaseUrl(url);
    } catch (error) {
      console.warn('Failed to get API base URL from store, using default:', error);
      API_BASE_URL = 'http://localhost:8000/api';
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

interface AskQuestionPayload {
  question: string;
  context_limit: number;
  similarity_threshold: number;
  temperature: number;
  max_tokens: number;
  stream: boolean;
  provider?: string;
  file_filters?: {
    file_ids: string[];
  };
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

class ApiService {
  private locale = 'en';
  private provider: string | null = null;

  private async ensureProvider(): Promise<string> {
    // Load once from app config via IPC and cache locally
    if (this.provider !== null) return this.provider;
    try {
      const cfg = (await window.electronAPI.getAppConfig()) as import('../shared/types').AppConfig | undefined;
      const p = cfg?.llmProvider ?? 'ollama';
      this.provider = p;
      return p;
    } catch (err) {
      console.warn('Failed to load provider from app config:', err);
      // Fallback to default used by main process config defaults
      this.provider = 'ollama';
      return 'ollama';
    }
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

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const url = `${API_BASE_URL}${endpoint}`;
    const mergedHeaders = this.mergeHeaders(options.headers);
    const response = await fetch(url, {
      ...options,
      headers: mergedHeaders,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
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
  async saveFile(sourceFilePath: string, targetDirectory: string, overwrite: boolean = false) {
    return this.request('/files/save-file', {
      method: 'POST',
      body: JSON.stringify({
        source_file_path: sourceFilePath,
        target_directory: targetDirectory,
        overwrite,
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
  }) {
    console.log('askQuestion:', options);
    const provider = await this.ensureProvider();
    const payload: AskQuestionPayload = {
      question,
      context_limit: options?.context_limit || 5,
      similarity_threshold: options?.similarity_threshold || 0.5,
      temperature: options?.temperature || 0.7,
      max_tokens: options?.max_tokens || 2000,
      stream: options?.stream || false,
      provider,
    };

    if (options?.file_ids && options.file_ids.length > 0) {
      payload.file_filters = {
        file_ids: options.file_ids
      };
    }

    return this.request('/chat/ask', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
}

export const apiService = new ApiService();