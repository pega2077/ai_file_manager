export interface DirectoryItem {
  name: string;
  type: 'file' | 'folder';
  path?: string;
  relative_path?: string;
  depth?: number;
  size?: number;
  created_at?: string;
  modified_at?: string;
  item_count?: number;
  children?: DirectoryItem[];
}

export interface DirectoryStructureResponse {
  directory_path: string;
  items: DirectoryItem[];
  total_count: number;
}

export interface RecommendDirectoryResponse {
  recommended_directory: string;
  alternatives: string[];
}

export interface Settings {
  theme: string;
  language: string;
  autoSave: boolean;
  showHiddenFiles: boolean;
  enablePreview: boolean;
  autoClassifyWithoutConfirmation: boolean;
  autoSaveRAG: boolean;
  workDirectory: string;
}

export interface TreeNode {
  title: string;
  value: string;
  key: string;
  children: TreeNode[];
}

export interface FileItem {
  name: string;
  type: 'file' | 'folder';
  size: number | null;
  created_at: string | null;
  modified_at: string | null;
  item_count: number | null;
}

export interface DirectoryResponse {
  directory_path: string;
  items: FileItem[];
  total_count: number;
}

export interface ImportFileResponse {
  file_id: string;
  name: string;
  path: string;
  type: string;
  size: number;
  category: string;
  summary: string;
  tags: string[];
  created_at: string;
  processed: boolean;
}

export interface ImportedFileItem {
  file_id: string;
  name: string;
  path: string;
  type: string;
  category: string;
  summary: string;
  tags: string[];
  size: number;
  created_at: string;
  updated_at: string;
  processed: boolean;
}

export interface FileConversionResult {
  source_file_path: string;
  output_file_path: string;
  output_format: string;
  size: number;
  message: string;
}

// Mirror of main process AppConfig for renderer typing convenience
export interface AppConfig {
  useLocalService: boolean;
  localServicePort: number;
  localServiceHost: string;
  /** Selected LLM provider for chat/completions */
  llmProvider?: 'ollama' | 'openai' | 'azure-openai' | 'openrouter' | 'bailian';
  ollamaEndpoint?: string;
  ollamaModel?: string;
  ollamaEmbedModel?: string;
  ollamaVisionModel?: string;
  fileConvertEndpoint?: string;
  sqliteDbPath: string;
  language?: string;
  theme?: 'light' | 'dark';
  autoSave?: boolean;
  showHiddenFiles?: boolean;
  enablePreview?: boolean;
  autoSaveRAG?: boolean;
  autoClassifyWithoutConfirmation?: boolean;
  workDirectory?: string;
  isInitialized?: boolean;
  apiBaseUrl?: string;
}