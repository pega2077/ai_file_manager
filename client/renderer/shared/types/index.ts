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
  checkFileNameOnImport: boolean;
  autoSaveRAG: boolean;
  autoTagEnabled?: boolean;
  tagSummaryMaxLength?: number;
  enableDirectoryWatcher?: boolean;
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

export interface FileRecordStatus {
  file_id: string;
  path: string;
  name: string;
  imported: boolean;
  processed: boolean;
  category: string;
  size: number;
  created_at: string;
  updated_at: string | null;
}

export interface BatchFileRecordResponse {
  records: FileRecordStatus[];
  missing: string[];
}

export interface StageFileResponse {
  file_id: string;
  staged_path: string;
  filename: string;
  type: string;
  category: string;
  size: number;
  created_at: string;
  imported: boolean;
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
  imported: boolean;
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
  imported: boolean;
}

export interface FileConversionResult {
  source_file_path: string;
  output_file_path: string;
  output_format: string;
  size: number;
  message: string;
}

export interface WebpageConversionResult {
  source_url: string;
  title: string;
  byline: string;
  excerpt: string;
  content_type: string;
  html_temp_file_path?: string;
  output_file_path: string;
  output_format: string;
  size: number;
  message: string;
}

// Mirror of main process AppConfig for renderer typing convenience
export interface OllamaConfig {
  ollamaEndpoint?: string;
  ollamaModel?: string;
  ollamaEmbedModel?: string;
  ollamaVisionModel?: string;
  ollamaApiKey?: string;
}

export interface OpenAIConfig {
  openaiEndpoint?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  openaiEmbedModel?: string;
  openaiVisionModel?: string;
}

export interface OpenRouterConfig {
  openrouterEndpoint?: string;
  openrouterApiKey?: string;
  openrouterModel?: string;
  openrouterEmbedModel?: string;
  openrouterVisionModel?: string;
}

export interface BailianConfig {
  bailianEndpoint?: string;
  bailianApiKey?: string;
  bailianModel?: string;
  bailianEmbedModel?: string;
  bailianVisionModel?: string;
}

export interface LlamaCppConfig {
  llamacppTextModelPath?: string;
  llamacppVisionModelPath?: string;
  llamacppVisionDecoderPath?: string;
  llamacppInstallDir?: string;
  llamacppPort?: number;
  llamacppHost?: string;
}

export interface AppConfig {
  useLocalService: boolean;
  localServicePort: number;
  localServiceHost: string;
  /** Selected LLM provider for chat/completions */
  llmProvider?: 'ollama' | 'openai' | 'azure-openai' | 'openrouter' | 'bailian' | 'pega' | 'llamacpp';
  ollama?: OllamaConfig;
  openai?: OpenAIConfig;
  openrouter?: OpenRouterConfig;
  bailian?: BailianConfig;
  llamacpp?: LlamaCppConfig;
  ollamaEndpoint?: string;
  ollamaModel?: string;
  ollamaEmbedModel?: string;
  ollamaVisionModel?: string;
  pega?: {
    pegaEndpoint?: string;
    pegaModel?: string;
    pegaEmbedModel?: string;
    pegaVisionModel?: string;
    pegaApiKey?: string;
    pegaAuthToken?: string;
    pegaMode?: "ollama" | "openrouter";
    pegaPreviousProvider?: AppConfig['llmProvider'];
  };
  fileConvertEndpoint?: string;
  sqliteDbPath: string;
  language?: string;
  theme?: 'light' | 'dark';
  themeFollowSystem?: boolean;
  autoSave?: boolean;
  showHiddenFiles?: boolean;
  enablePreview?: boolean;
  previewSupportedExtensions?: string[];
  autoSaveRAG?: boolean;
  autoTagEnabled?: boolean;
  tagSummaryMaxLength?: number;
  autoClassifyWithoutConfirmation?: boolean;
  checkFileNameOnImport?: boolean;
  enableDirectoryWatcher?: boolean;
  workDirectory?: string;
  isInitialized?: boolean;
  apiBaseUrl?: string;
  sentry?: {
    dsn?: string;
    environment?: string;
    sendLogsByDefault?: boolean;
  };
}