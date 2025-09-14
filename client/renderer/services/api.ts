const API_BASE_URL = 'http://localhost:8000/api';

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
  async getDirectoryStructure(profession: string, purpose: string) {
    return this.request('/chat/directory-structure', {
      method: 'POST',
      body: JSON.stringify({
        profession,
        purpose,
        min_directories: 6,
        max_directories: 20,
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

  // 文件预览
  async previewFile(filePath: string) {
    return this.request('/files/preview', {
      method: 'POST',
      body: JSON.stringify({
        file_path: filePath,
      }),
    });
  }
}

export const apiService = new ApiService();