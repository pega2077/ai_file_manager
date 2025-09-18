// Dynamic API base URL - will be initialized from electron store
let API_BASE_URL = 'http://localhost:8000/api';

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

interface FileConversionFormats {
  input_formats: string[];
  output_formats: string[];
  default_output_directory: string;
  pandoc_available: boolean;
  markitdown_available: boolean;
}

interface FileConversionResult {
  source_file_path: string;
  output_file_path: string;
  output_format: string;
  size: number;
  message: string;
}

class ApiService {
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const url = `${API_BASE_URL}${endpoint}`;
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
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
    max_depth?: number;
    min_directories?: number;
    max_directories?: number;
    temperature?: number;
  }) {
    return this.request('/chat/directory-structure', {
      method: 'POST',
      body: JSON.stringify({
        profession: params.profession,
        purpose: params.purpose,
        max_depth: params.max_depth || 2,
        min_directories: params.min_directories || 6,
        max_directories: params.max_directories || 20,
        temperature: params.temperature || 0.7,
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

  // 文件预览
  async previewFile(filePath: string) {
    return this.request('/files/preview', {
      method: 'POST',
      body: JSON.stringify({
        file_path: filePath,
      }),
    });
  }

  // 导入文件
  async importFile(filePath: string, category?: string, tags?: string[], autoProcess: boolean = true) {
    return this.request('/files/import', {
      method: 'POST',
      body: JSON.stringify({
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
    return this.request('/files/suggest-category', {
      method: 'POST',
      body: JSON.stringify({
        file_path: filePath,
        directory_structure: directoryStructure,
      }),
    });
  }

  // 推荐保存目录
  async recommendDirectory(filePath: string, availableDirectories: string[]): Promise<ApiResponse<RecommendDirectoryResponse>> {
    return this.request<RecommendDirectoryResponse>('/files/recommend-directory', {
      method: 'POST',
      body: JSON.stringify({
        file_path: filePath,
        available_directories: availableDirectories,
      }),
    });
  }

  // 导入到RAG库
  async importToRag(filePath: string) {
    return this.request('/files/import-to-rag', {
      method: 'POST',
      body: JSON.stringify({
        file_path: filePath,
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
}

export const apiService = new ApiService();