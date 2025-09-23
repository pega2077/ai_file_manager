import fs from "fs";
import path from "path";
import { logger } from "./logger";
import {app} from "electron";

export interface AppConfig {
  useLocalService: boolean;
  localServicePort: number;
  localServiceHost: string;
  ollamaEndpoint?: string;
  ollamaModel?: string;
  ollamaEmbedModel?: string;
  /** Optional HTTP endpoint for third-party file conversion service */
  fileConvertEndpoint?: string;
  /** Relative or absolute path to the local SQLite database file */
  sqliteDbPath: string;
}

const DEFAULT_CONFIG: AppConfig = {
  useLocalService: true,
  localServicePort: 8000,
  localServiceHost: "127.0.0.1",
  ollamaEndpoint: "http://127.0.0.1:11434",
  ollamaModel: "qwen3:8b",
  ollamaEmbedModel: "bge-m3",
  fileConvertEndpoint: "",
  // Default to repository-standard SQLite location; can be overridden in config.json
  sqliteDbPath: "database/files.db"
};

export class ConfigManager {
  private configPath: string;
  private config: AppConfig;

  constructor() {
    logger.info("App path:", app.getAppPath());
    logger.info("Exe path:", app.getPath("exe"));
    // 获取程序所在目录
    let appRoot = "";
    
    if (process.env.APP_ROOT) {
      // 开发模式
      appRoot = app.getAppPath();
      console.log('ConfigManager: Development mode :', process.env.APP_ROOT);
    } else {
      // 生产模式
      appRoot = path.dirname(app.getPath("exe"));
      logger.info('ConfigManager: Production mode :', appRoot);
    }
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

        // 合并用户配置和默认配置
        this.config = { ...DEFAULT_CONFIG, ...userConfig };
        logger.info('Config loaded from:', this.configPath);
      } else {
        logger.warn('Config file not found, using defaults. Path:', this.configPath);
        // 如果配置文件不存在，创建默认配置文件
        this.saveConfig();
      }
    } catch (error) {
      logger.error('Failed to load config:', error);
      // 出错时使用默认配置
      this.config = { ...DEFAULT_CONFIG };
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
    const appRoot = process.env.APP_ROOT || path.dirname(process.execPath);
    const projectRoot = process.env.APP_ROOT
      ? path.join(appRoot, '..', '..')
      : path.join(appRoot, '..');

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
    const appRoot = process.env.APP_ROOT || path.dirname(process.execPath);
    const projectRoot = process.env.APP_ROOT
      ? path.join(appRoot, '..', '..')
      : path.join(appRoot, '..');

    const dbPath = this.config.sqliteDbPath;
    return path.isAbsolute(dbPath) ? dbPath : path.join(projectRoot, dbPath);
  }
}

// 创建全局配置管理器实例
export const configManager = new ConfigManager();