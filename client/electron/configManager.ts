import fs from "fs";
import path from "path";
import { logger } from "./logger";
import {app} from "electron";

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
  };
  /** LLM provider selection: 'ollama' | 'openai' | 'azure-openai' (future) */
  llmProvider?: 'ollama' | 'openai' | 'azure-openai';
  openai?: {
    /** OpenAI compatible endpoint (e.g., https://api.openai.com/v1 or custom) */
    openaiEndpoint?: string;
    /** OpenAI API key (read from env OPENAI_API_KEY if not set in config) */
    openaiApiKey?: string;
    /** Default chat/completion model for OpenAI */
    openaiModel?: string;
    /** Default embedding model for OpenAI */
    openaiEmbedModel?: string;
    /** Default vision-capable model for OpenAI (e.g., gpt-4o-mini) */
    openaiVisionModel?: string;
  };
  /** Legacy flat fields (deprecated; kept for backward compatibility) */
  ollamaEndpoint?: string;
  ollamaModel?: string;
  ollamaEmbedModel?: string;
  ollamaVisionModel?: string;
  openaiEndpoint?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  openaiEmbedModel?: string;
  openaiVisionModel?: string;
  /** Optional HTTP endpoint for third-party file conversion service */
  fileConvertEndpoint?: string;
  /** Relative or absolute path to the local SQLite database file */
  sqliteDbPath: string;
  /** UI language preference, e.g., 'en' | 'zh' */
  language?: string;
  /** UI theme preference */
  theme?: 'light' | 'dark';
  /** Whether to auto save general edits */
  autoSave?: boolean;
  /** Whether to show hidden files in UI */
  showHiddenFiles?: boolean;
  /** Enable file preview feature */
  enablePreview?: boolean;
  /** Auto-import to RAG after save */
  autoSaveRAG?: boolean;
  /** Auto classify without confirmation */
  autoClassifyWithoutConfirmation?: boolean;
  /** Current workspace directory path */
  workDirectory?: string;
  /** App initialization flag */
  isInitialized?: boolean;
  /** When not using local service, custom API base URL */
  apiBaseUrl?: string;
}

const DEFAULT_CONFIG: AppConfig = {
  useLocalService: true,
  localServicePort: 8000,
  localServiceHost: "127.0.0.1",
  // Default to local Ollama as primary LLM provider; can be changed to 'openai'
  llmProvider: 'ollama',
  // Grouped configs (preferred in saved config.json)
  ollama: {
    ollamaEndpoint: "http://127.0.0.1:11434",
    ollamaModel: "qwen3:8b",
    ollamaEmbedModel: "bge-m3",
    ollamaVisionModel: "qwen2.5vl:7b",
  },
  openai: {
    openaiEndpoint: "https://api.openai.com/v1",
    openaiApiKey: undefined,
    openaiModel: "gpt-4o-mini",
    openaiEmbedModel: "text-embedding-3-large",
    openaiVisionModel: "gpt-4o-mini",
  },
  fileConvertEndpoint: "",
  // Default to repository-standard SQLite location; can be overridden in config.json
  sqliteDbPath: "database/files.db",
  // App defaults (override in config.json)
  language: 'zh',
  theme: 'light',
  autoSave: true,
  showHiddenFiles: false,
  enablePreview: true,
  autoSaveRAG: true,
  autoClassifyWithoutConfirmation: false,
  workDirectory: '',
  isInitialized: false,
  apiBaseUrl: 'http://localhost:8000'
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
    try {
      const base = app.isPackaged
        ? path.dirname(app.getPath('exe'))
        : app.getAppPath();
      return base || process.cwd();
    } catch (err) {
      logger.error('ConfigManager: Failed to resolve app root, using CWD', err);
      return process.cwd();
    }
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
    this.config = { ...DEFAULT_CONFIG };
    logger.info('ConfigManager: Initialized with default config', this.config);
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
          openai: { ...(DEFAULT_CONFIG.openai || {}), ...(userConfig.openai || {}) },
        };

        // Backward compatibility: map legacy flat fields into grouped blocks
        if (
          userConfig.ollamaEndpoint ||
          userConfig.ollamaModel ||
          userConfig.ollamaEmbedModel ||
          userConfig.ollamaVisionModel
        ) {
          merged.ollama = {
            ...(merged.ollama || {}),
            ollamaEndpoint: userConfig.ollamaEndpoint ?? merged.ollama?.ollamaEndpoint,
            ollamaModel: userConfig.ollamaModel ?? merged.ollama?.ollamaModel,
            ollamaEmbedModel: userConfig.ollamaEmbedModel ?? merged.ollama?.ollamaEmbedModel,
            ollamaVisionModel: userConfig.ollamaVisionModel ?? merged.ollama?.ollamaVisionModel,
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

        // Prefer env OPENAI_API_KEY when not explicitly set in config
        if (!merged.openai?.openaiApiKey) {
          const envKey = process.env.OPENAI_API_KEY || process.env.OPENAIKEY || process.env.OPENAI_TOKEN;
          if (envKey) {
            merged.openai = { ...(merged.openai || {}), openaiApiKey: envKey };
          }
        }

        this.config = merged;
        logger.info('Config loaded from:', this.configPath);
      } else {
        logger.warn('Config file not found, using defaults. Path:', this.configPath);
        // 如果配置文件不存在，创建默认配置文件
        this.saveConfig();
      }
    } catch (error) {
      logger.error('Failed to load config:', error);
      // 出错时使用默认配置，并尝试注入环境变量中的 OpenAI Key
      const merged: AppConfig = { ...DEFAULT_CONFIG };
      const envKey = process.env.OPENAI_API_KEY || process.env.OPENAIKEY || process.env.OPENAI_TOKEN;
      if (envKey) {
        merged.openai = { ...(merged.openai || {}), openaiApiKey: envKey };
      }
      this.config = merged;
    }

    return this.config;
  }

  /**
   * 保存配置文件
   */
  saveConfig(): void {
    try {
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
    this.config = { ...this.config, ...updates };
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
    const appRoot = this.getAppRoot();
    // In development, appRoot usually points to client/dist-electron, so go up two levels to repo root.
    // In production, appRoot points to the installation directory; go up one level to bundle root.
    const projectRoot = app.isPackaged ? path.join(appRoot, '..') : path.join(appRoot, '..', '..');

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
    const appRoot = this.getAppRoot();
    const projectRoot = app.isPackaged ? path.join(appRoot, '..') : path.join(appRoot, '..', '..');

    const dbPath = this.config.sqliteDbPath;
    return path.isAbsolute(dbPath) ? dbPath : path.join(projectRoot, dbPath);
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