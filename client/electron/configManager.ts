import fs from "fs";
import path from "path";
import { logger } from "./logger";
import { app } from "electron";
import { getBaseDir, resolveProjectRoot, resolveDatabaseAbsolutePath } from "./backend/utils/pathHelper";
import { DEFAULT_SUPPORTED_PREVIEW_EXTENSIONS, sanitizePreviewExtensions } from "../shared/filePreviewConfig";

export interface AppConfig {
  useLocalService: boolean;
  localServicePort: number;
  localServiceHost: string;
  // Grouped LLM configs (preferred)
  ollama?: {
    ollamaEndpoint?: string;
    ollamaModel?: string;
    ollamaEmbedModel?: string;
    ollamaVisionModel?: string;
    ollamaApiKey?: string;
  };
  pega?: {
    pegaEndpoint?: string;
    pegaModel?: string;
    pegaEmbedModel?: string;
    pegaVisionModel?: string;
    pegaOpenrouterModel?: string;
    pegaOpenrouterVisionModel?: string;
    pegaOpenrouterEmbedModel?: string;
    pegaOpenrouterEmbedEndpoint?: string;
    pegaOpenrouterEmbedKey?: string;
    openrouterEmbedModel?: string;
    pegaApiKey?: string;
    pegaAuthToken?: string;
    pegaMode?: "ollama" | "openrouter";
    pegaPreviousProvider?: AppConfig['llmProvider'];
  };
  bailian?: {
    /** Bailian (DashScope) OpenAI-compatible endpoint */
    bailianEndpoint?: string;
    /** Bailian access token (env fallback: BAILIAN_API_KEY or DASHSCOPE_API_KEY) */
    bailianApiKey?: string;
    /** Default chat/completion model */
    bailianModel?: string;
    /** Default embedding model */
    bailianEmbedModel?: string;
    /** Default multimodal/vision model */
    bailianVisionModel?: string;
  };
  /** LLM provider selection: 'ollama' | 'openai' | 'azure-openai' | 'openrouter' | 'bailian' | 'pega' */
  llmProvider?: 'ollama' | 'openai' | 'azure-openai' | 'openrouter' | 'bailian' | 'pega';
  openai?: {
    /** OpenAI compatible endpoint (e.g., https://api.openai.com/v1 or custom) */
    openaiEndpoint?: string;
    /** OpenAI API key (read from env OPENAI_API_KEY if not set in config) */
    openaiApiKey?: string;
    /** Default chat/completion model for OpenAI */
  openaiModel?: string;
    pegaMode?: "ollama" | "openrouter";
    /** Default embedding model for OpenAI */
    openaiEmbedModel?: string;
    /** Default vision-capable model for OpenAI (e.g., gpt-4o-mini) */
    openaiVisionModel?: string;
  };
  openrouter?: {
    /** OpenRouter API base URL (OpenAI-compatible) */
    openrouterEndpoint?: string;
    /** OpenRouter API key (read from env OPENROUTER_API_KEY if not set) */
    openrouterApiKey?: string;
    /** Default chat/completion model for OpenRouter */
    openrouterModel?: string;
    /** Default embedding model name for external embed endpoint */
    openrouterEmbedModel?: string;
    /** Default vision-capable model for OpenRouter */
    openrouterVisionModel?: string;
    /** Optional request timeout override in milliseconds */
    openrouterTimeoutMs?: number;
    /** Optional generic timeout override */
    timeoutMs?: number;
    /** Optional generic request timeout override */
    requestTimeoutMs?: number;
    /** Custom Referer header for OpenRouter */
    openrouterReferer?: string;
    /** Custom X-Title header for OpenRouter */
    openrouterTitle?: string;
    /** Additional headers for OpenRouter requests */
    openrouterHeaders?: Record<string, string>;
  };
  /** Legacy flat fields (deprecated; kept for backward compatibility) */
  ollamaEndpoint?: string;
  ollamaModel?: string;
  ollamaEmbedModel?: string;
  ollamaVisionModel?: string;
  ollamaApiKey?: string;
  pegaEndpoint?: string;
  pegaModel?: string;
  pegaEmbedModel?: string;
  pegaVisionModel?: string;
  pegaOpenrouterModel?: string;
  pegaOpenrouterVisionModel?: string;
  pegaOpenrouterEmbedModel?: string;
  pegaOpenrouterEmbedEndpoint?: string;
  pegaOpenrouterEmbedKey?: string;
  pegaApiKey?: string;
  pegaAuthToken?: string;
  openaiEndpoint?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  openaiEmbedModel?: string;
  openaiVisionModel?: string;
  // Potential legacy OpenRouter flat fields (none defined yet, reserved)
  bailianEndpoint?: string;
  bailianApiKey?: string;
  bailianModel?: string;
  bailianEmbedModel?: string;
  bailianVisionModel?: string;
  /** Optional HTTP endpoint for third-party file conversion service */
  fileConvertEndpoint?: string;
  /** Relative or absolute path to the local SQLite database file */
  sqliteDbPath: string;
  /** UI language preference, e.g., 'en' | 'zh' */
  language?: string;
  /** UI theme preference */
  theme?: 'light' | 'dark';
  /** Whether UI theme should follow the operating system appearance */
  themeFollowSystem?: boolean;
  /** Whether to auto save general edits */
  autoSave?: boolean;
  /** Whether to show hidden files in UI */
  showHiddenFiles?: boolean;
  /** Enable file preview feature */
  enablePreview?: boolean;
  /** Supported file extensions for preview (lowercase, without dot) */
  previewSupportedExtensions?: string[];
  /** Auto-import to RAG after save */
  autoSaveRAG?: boolean;
  /** Enable automatic tagging when importing/processing files */
  autoTagEnabled?: boolean;
  /** Max summary content length when generating tag summary (characters) */
  tagSummaryMaxLength?: number;
  /** Auto classify without confirmation */
  autoClassifyWithoutConfirmation?: boolean;
  /** Validate file name quality before completing import */
  checkFileNameOnImport?: boolean;
  /** Enable background directory watcher for automatic imports */
  enableDirectoryWatcher?: boolean;
  /** Current workspace directory path */
  workDirectory?: string;
  /** App initialization flag */
  isInitialized?: boolean;
  /** When not using local service, custom API base URL */
  apiBaseUrl?: string;
  /** Optional video capture settings for extracting screenshots from videos */
  videoCapture?: {
    intervalSeconds?: number;
    maxShots?: number;
    targetWidth?: number;
    targetHeight?: number;
    timeoutMs?: number;
  };
  /** Optional Sentry configuration for telemetry and feedback */
  sentry?: {
    dsn?: string;
    environment?: string;
    sendLogsByDefault?: boolean;
  };
  /** Preset tag library for tag organization with synonym checking */
  presetTags?: string[];
}

const DEFAULT_CONFIG: AppConfig = {
  useLocalService: true,
  localServicePort: 8000,
  localServiceHost: "127.0.0.1",
  // Default to local Ollama as primary LLM provider; can be changed to 'openai'
  llmProvider: 'pega',
  // Grouped configs (preferred in saved config.json)
  ollama: {
    ollamaEndpoint: "http://127.0.0.1:11434",
    ollamaModel: "qwen3:8b",
    ollamaEmbedModel: "bge-m3",
    ollamaVisionModel: "qwen2.5vl:7b",
    ollamaApiKey: undefined,
  },
  pega: {
    pegaEndpoint: "https://llm.pegamob.com",
    pegaModel: "qwen3:8b",
    pegaEmbedModel: "bge-m3",
    pegaVisionModel: "qwen2.5vl:7b",
    pegaOpenrouterModel: "openai/gpt-oss-20b:free",
    pegaOpenrouterVisionModel: "qwen/qwen2.5-vl-32b-instruct:free",
    pegaOpenrouterEmbedModel: "all-MiniLM-L6-v2",
    pegaOpenrouterEmbedEndpoint: "https://embed.pegamob.com",
    pegaOpenrouterEmbedKey: undefined,
    openrouterEmbedModel: "all-MiniLM-L6-v2",
    pegaApiKey: undefined,
    pegaAuthToken: undefined,
    pegaMode: "openrouter",
    pegaPreviousProvider: undefined,
  },
  openai: {
    openaiEndpoint: "https://api.openai.com/v1",
    openaiApiKey: undefined,
    openaiModel: "gpt-4o-mini",
    openaiEmbedModel: "text-embedding-3-large",
    openaiVisionModel: "gpt-4o-mini",
  },
  openrouter: {
    openrouterEndpoint: "https://openrouter.ai/api/v1",
    openrouterApiKey: undefined,
    openrouterModel: "openai/gpt-oss-20b:free",
    openrouterEmbedModel: "qwen/qwen3-embedding-0.6b",
    openrouterVisionModel: "google/gemma-3-12b-it:free",
  },
  bailian: {
    bailianEndpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    bailianApiKey: undefined,
    bailianModel: "qwen-plus",
    bailianEmbedModel: "text-embedding-v4",
    bailianVisionModel: "qwen3-vl-plus",//
  },
  fileConvertEndpoint: "https://converter.pegamob.com",
  // Default to repository-standard SQLite location; can be overridden in config.json
  sqliteDbPath: "database/files.db",
  // App defaults (override in config.json)
  language: 'zh',
  theme: 'light',
  themeFollowSystem: false,
  autoSave: true,
  showHiddenFiles: false,
  enablePreview: true,
  previewSupportedExtensions: Array.from(DEFAULT_SUPPORTED_PREVIEW_EXTENSIONS),
  autoSaveRAG: true,
  autoTagEnabled: true,
  tagSummaryMaxLength: 1000,
  autoClassifyWithoutConfirmation: true,
  checkFileNameOnImport: true,
  enableDirectoryWatcher: false,
  workDirectory: '',
  isInitialized: false,
  apiBaseUrl: 'http://localhost:8000',
  videoCapture: {
    intervalSeconds: 10,
    maxShots: 5,
    // targetWidth/targetHeight omitted => use video native resolution
    timeoutMs: 60000,
  },
  sentry: {
    dsn: "https://235a9bae8ce69a567a7aa733d298613c@o4507153410293760.ingest.us.sentry.io/4510357919956992",
    environment: "production",
    sendLogsByDefault: false,
  },
  presetTags: [
    // Common document categories
    '工作', '学习', '项目', '会议', '报告', '总结',
    // Media and content types  
    '图片', '视频', '音频', '文档', '演示',
    // General classifications
    '重要', '紧急', '参考', '归档', '草稿',
    // Domain specific
    '技术', '设计', '营销', '财务', '法律',
  ],
};

export class ConfigManager {
  private configPath: string;
  private config: AppConfig;
  /**
   * Determine the base directory of the running app.
   * - Development: `app.getAppPath()` (typically points to client/dist-electron)
   * - Production: directory of the packaged executable
   * Falls back to `process.cwd()` if Electron APIs are unavailable.
   */
  public getAppRoot(): string {
    return getBaseDir();
  }

  constructor() {
    logger.info("App path:", app.getAppPath());
    logger.info("Exe path:", app.getPath("exe"));
    // Determine base directory depending on packaged state
    const appRoot = this.getAppRoot();

    logger.info(
      `ConfigManager: ${app.isPackaged ? 'Production' : 'Development'} mode :`,
      appRoot
    );

    this.configPath = path.join(appRoot, 'config.json');
    logger.info('ConfigManager: Config path set to', this.configPath);
    this.config = this.normalizeConfig({ ...DEFAULT_CONFIG });
    logger.info('ConfigManager: Initialized with default config', this.config);
  }

  private normalizeConfig(config: AppConfig): AppConfig {
    return {
      ...config,
      previewSupportedExtensions: sanitizePreviewExtensions(
        config.previewSupportedExtensions,
        DEFAULT_SUPPORTED_PREVIEW_EXTENSIONS
      ),
    };
  }

  /**
   * 加载配置文件
   */
  loadConfig(): AppConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf-8');
        const userConfig = JSON.parse(configData) as Partial<AppConfig>;

        // Deep merge top-level + grouped sections
        const merged: AppConfig = {
          ...DEFAULT_CONFIG,
          ...userConfig,
          ollama: { ...(DEFAULT_CONFIG.ollama || {}), ...(userConfig.ollama || {}) },
          pega: { ...(DEFAULT_CONFIG.pega || {}), ...(userConfig.pega || {}) },
          openai: { ...(DEFAULT_CONFIG.openai || {}), ...(userConfig.openai || {}) },
          openrouter: { ...(DEFAULT_CONFIG.openrouter || {}), ...(userConfig.openrouter || {}) },
          bailian: { ...(DEFAULT_CONFIG.bailian || {}), ...(userConfig.bailian || {}) },
        };

        // Backward compatibility: map legacy flat fields into grouped blocks
        if (
          userConfig.ollamaEndpoint ||
          userConfig.ollamaModel ||
          userConfig.ollamaEmbedModel ||
          userConfig.ollamaVisionModel ||
          userConfig.ollamaApiKey
        ) {
          merged.ollama = {
            ...(merged.ollama || {}),
            ollamaEndpoint: userConfig.ollamaEndpoint ?? merged.ollama?.ollamaEndpoint,
            ollamaModel: userConfig.ollamaModel ?? merged.ollama?.ollamaModel,
            ollamaEmbedModel: userConfig.ollamaEmbedModel ?? merged.ollama?.ollamaEmbedModel,
            ollamaVisionModel: userConfig.ollamaVisionModel ?? merged.ollama?.ollamaVisionModel,
            ollamaApiKey: userConfig.ollamaApiKey ?? merged.ollama?.ollamaApiKey,
          };
        }
        if (
          userConfig.pegaEndpoint ||
          userConfig.pegaModel ||
          userConfig.pegaEmbedModel ||
          userConfig.pegaVisionModel ||
          userConfig.pegaOpenrouterEmbedModel ||
          userConfig.pegaOpenrouterEmbedEndpoint ||
          userConfig.pegaOpenrouterEmbedKey ||
          userConfig.pegaApiKey ||
          userConfig.pegaAuthToken
        ) {
          merged.pega = {
            ...(merged.pega || {}),
            pegaEndpoint: userConfig.pegaEndpoint ?? merged.pega?.pegaEndpoint,
            pegaModel: userConfig.pegaModel ?? merged.pega?.pegaModel,
            pegaEmbedModel: userConfig.pegaEmbedModel ?? merged.pega?.pegaEmbedModel,
            pegaVisionModel: userConfig.pegaVisionModel ?? merged.pega?.pegaVisionModel,
            pegaOpenrouterEmbedModel: userConfig.pegaOpenrouterEmbedModel ?? merged.pega?.pegaOpenrouterEmbedModel,
            pegaOpenrouterEmbedEndpoint: userConfig.pegaOpenrouterEmbedEndpoint ?? merged.pega?.pegaOpenrouterEmbedEndpoint,
            pegaOpenrouterEmbedKey: userConfig.pegaOpenrouterEmbedKey ?? merged.pega?.pegaOpenrouterEmbedKey,
            pegaApiKey: userConfig.pegaApiKey ?? merged.pega?.pegaApiKey,
            pegaAuthToken: userConfig.pegaAuthToken ?? merged.pega?.pegaAuthToken,
          };
        }
        if (
          userConfig.openaiEndpoint ||
          userConfig.openaiApiKey ||
          userConfig.openaiModel ||
          userConfig.openaiEmbedModel ||
          userConfig.openaiVisionModel
        ) {
          merged.openai = {
            ...(merged.openai || {}),
            openaiEndpoint: userConfig.openaiEndpoint ?? merged.openai?.openaiEndpoint,
            openaiApiKey: userConfig.openaiApiKey ?? merged.openai?.openaiApiKey,
            openaiModel: userConfig.openaiModel ?? merged.openai?.openaiModel,
            openaiEmbedModel: userConfig.openaiEmbedModel ?? merged.openai?.openaiEmbedModel,
            openaiVisionModel: userConfig.openaiVisionModel ?? merged.openai?.openaiVisionModel,
          };
        }
        if (
          userConfig.bailianEndpoint ||
          userConfig.bailianApiKey ||
          userConfig.bailianModel ||
          userConfig.bailianEmbedModel ||
          userConfig.bailianVisionModel
        ) {
          merged.bailian = {
            ...(merged.bailian || {}),
            bailianEndpoint: userConfig.bailianEndpoint ?? merged.bailian?.bailianEndpoint,
            bailianApiKey: userConfig.bailianApiKey ?? merged.bailian?.bailianApiKey,
            bailianModel: userConfig.bailianModel ?? merged.bailian?.bailianModel,
            bailianEmbedModel: userConfig.bailianEmbedModel ?? merged.bailian?.bailianEmbedModel,
            bailianVisionModel: userConfig.bailianVisionModel ?? merged.bailian?.bailianVisionModel,
          };
        }

        // Env injection for OpenRouter API key if not set
        if (!merged.openrouter?.openrouterApiKey) {
          const envKey = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_TOKEN;
          if (envKey) {
            merged.openrouter = { ...(merged.openrouter || {}), openrouterApiKey: envKey };
          }
        }

        // Prefer env OPENAI_API_KEY when not explicitly set in config
        if (!merged.openai?.openaiApiKey) {
          const envKey = process.env.OPENAI_API_KEY || process.env.OPENAIKEY || process.env.OPENAI_TOKEN;
          if (envKey) {
            merged.openai = { ...(merged.openai || {}), openaiApiKey: envKey };
          }
        }

        if (!merged.bailian?.bailianApiKey) {
          const envKey =
            process.env.BAILIAN_API_KEY ||
            process.env.DASHSCOPE_API_KEY ||
            process.env.ALIYUN_BAILIAN_API_KEY ||
            process.env.ALIYUN_DASHSCOPE_API_KEY;
          if (envKey) {
            merged.bailian = { ...(merged.bailian || {}), bailianApiKey: envKey };
          }
        }

        if (!merged.pega?.pegaApiKey) {
          const envKey = process.env.PEGA_API_KEY || process.env.PEGA_TOKEN || process.env.PEGA_LLM_API_KEY;
          if (envKey) {
            merged.pega = { ...(merged.pega || {}), pegaApiKey: envKey };
          }
        }

        if (!merged.pega?.pegaAuthToken) {
          const envToken = process.env.PEGA_AUTH_TOKEN || process.env.PEGA_JWT_TOKEN;
          if (envToken) {
            merged.pega = { ...(merged.pega || {}), pegaAuthToken: envToken };
          }
        }

        const userPegaMode = (() => {
          const nested = typeof userConfig.pega?.pegaMode === "string" ? userConfig.pega.pegaMode : undefined;
          return nested || merged.pega?.pegaMode;
        })();
        const normalizedMode = userPegaMode === "openrouter" ? "openrouter" : "ollama";
        merged.pega = { ...(merged.pega || {}), pegaMode: normalizedMode };

        // Ensure pega endpoint always use default endpoint
        // if (!merged.pega) {
        //   merged.pega = { ...DEFAULT_CONFIG.pega };
        // }
        // merged.pega.pegaEndpoint = DEFAULT_CONFIG.pega?.pegaEndpoint;

        // Sanitize new options
        if (merged.tagSummaryMaxLength == null || Number.isNaN(Number(merged.tagSummaryMaxLength))) {
          merged.tagSummaryMaxLength = DEFAULT_CONFIG.tagSummaryMaxLength;
        } else {
          const v = Math.floor(Number(merged.tagSummaryMaxLength));
          merged.tagSummaryMaxLength = v > 0 ? v : DEFAULT_CONFIG.tagSummaryMaxLength;
        }
        if (typeof merged.autoTagEnabled !== 'boolean') {
          merged.autoTagEnabled = DEFAULT_CONFIG.autoTagEnabled;
        }

        if (typeof merged.themeFollowSystem !== 'boolean') {
          merged.themeFollowSystem = DEFAULT_CONFIG.themeFollowSystem;
        }

        if (typeof merged.enableDirectoryWatcher !== 'boolean') {
          merged.enableDirectoryWatcher = DEFAULT_CONFIG.enableDirectoryWatcher;
        }

        if (typeof merged.checkFileNameOnImport !== 'boolean') {
          merged.checkFileNameOnImport = DEFAULT_CONFIG.checkFileNameOnImport;
        }

        this.config = this.normalizeConfig(merged);
        logger.info('Config loaded from:', this.configPath);
      } else {
        logger.warn('Config file not found, using defaults. Path:', this.configPath);
        // 如果配置文件不存在，创建默认配置文件
        this.saveConfig();
      }
    } catch (error) {
      logger.error('Failed to load config:', error);
      // 出错时使用默认配置，并尝试注入环境变量中的 OpenAI Key
      const merged: AppConfig = this.normalizeConfig({ ...DEFAULT_CONFIG });
      const envKey = process.env.OPENAI_API_KEY || process.env.OPENAIKEY || process.env.OPENAI_TOKEN;
      if (envKey) {
        merged.openai = { ...(merged.openai || {}), openaiApiKey: envKey };
      }
      this.config = this.normalizeConfig(merged);
    }

    return this.config;
  }

  /**
   * 保存配置文件
   */
  saveConfig(): void {
    try {
      this.config = this.normalizeConfig(this.config);
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
      console.log('Config saved to:', this.configPath);
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  }

  /**
   * 获取配置
   */
  getConfig(): AppConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(updates: Partial<AppConfig>): void {
    this.config = this.normalizeConfig({ ...this.config, ...updates });
    this.saveConfig();
  }

  /**
   * 检查本地服务文件是否存在
   */
  checkLocalServiceFiles(): { pathExists: boolean; exeExists: boolean } {
    const { servicePath, exePath } = this.resolveLocalServicePaths();

    const pathExists = fs.existsSync(servicePath);
    const exeExists = fs.existsSync(exePath);

    console.log('Checking service files:');
    console.log('  Service path:', servicePath, 'exists:', pathExists);
    console.log('  Python exe:', exePath, 'exists:', exeExists);

    return { pathExists, exeExists };
  }

  /**
   * 获取本地服务启动命令
   */
  getLocalServiceCommand(): { exe: string; args: string[]; cwd: string } {
    const { servicePath, exePath, projectRoot } = this.resolveLocalServicePaths();
    return { exe: exePath, args: [servicePath], cwd: projectRoot };
  }

  /**
   * Resolve default paths for python server script and python executable based on
   * project layout and current platform. This replaces config-driven paths.
   */
  private resolveLocalServicePaths(): { servicePath: string; exePath: string; projectRoot: string } {
  const projectRoot = resolveProjectRoot();

    const servicePath = path.join(projectRoot, 'python', 'server.py');
    // Windows uses Scripts\python.exe, POSIX uses bin/python
    const exePath = process.platform === 'win32'
      ? path.join(projectRoot, 'python', 'venv', 'Scripts', 'python.exe')
      : path.join(projectRoot, 'python', 'venv', 'bin', 'python');

    return { servicePath, exePath, projectRoot };
  }

  /**
   * Resolve the configured SQLite database path to an absolute path.
   * If the path in config is relative, it will be resolved against the project root.
   */
  getDatabaseAbsolutePath(): string {
  const dbPath = this.config.sqliteDbPath;
  return resolveDatabaseAbsolutePath(dbPath);
  }

  /**
   * Derive the effective API base URL according to config.
   * If useLocalService is true, build from host/port; otherwise, use apiBaseUrl.
   */
  getEffectiveApiBaseUrl(): string {
    const cfg = this.getConfig();
    if (cfg.useLocalService) {
      const base = `http://${cfg.localServiceHost}:${cfg.localServicePort}`;
      return base;
    }
    const custom = (cfg.apiBaseUrl || '').trim();
    if (!custom) return 'http://localhost:8000';
    return custom.replace(/\/$/, '');
  }
}

// 创建全局配置管理器实例
export const configManager = new ConfigManager();