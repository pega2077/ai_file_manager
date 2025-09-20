import fs from "fs";
import path from "path";
import { logger } from "./logger";
import { log } from "console";

export interface AppConfig {
  useLocalService: boolean;
  localServicePath: string;
  localServicePythonExe: string;
  localServicePort: number;
  localServiceHost: string;
}

const DEFAULT_CONFIG: AppConfig = {
  useLocalService: true,
  localServicePath: "python/server.py",
  localServicePythonExe: "python/venv/Scripts/python.exe",
  localServicePort: 8000,
  localServiceHost: "127.0.0.1"
};

export class ConfigManager {
  private configPath: string;
  private config: AppConfig;

  constructor() {
    // 获取程序所在目录（项目根目录）
    const appRoot = process.env.APP_ROOT || path.dirname(process.execPath);

    if (process.env.APP_ROOT) {
      // 开发模式：使用 client/config.json
      this.configPath = path.join(appRoot, 'config.json');
    } else {
      // 生产模式：使用程序安装目录/../config.json
      const projectRoot = path.join(appRoot, '..');
      this.configPath = path.join(projectRoot, 'config.json');
    }

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
        console.log('Config loaded from:', this.configPath);
      } else {
        console.log('Config file not found, using defaults. Path:', this.configPath);
        // 如果配置文件不存在，创建默认配置文件
        this.saveConfig();
      }
    } catch (error) {
      console.error('Failed to load config:', error);
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
    const appRoot = process.env.APP_ROOT || path.dirname(process.execPath);
    const projectRoot = process.env.APP_ROOT
      ? path.join(appRoot, '..', '..')  // 开发模式：从 client 向上两级到项目根
      : path.join(appRoot, '..');       // 生产模式：从安装目录向上

    const servicePath = path.isAbsolute(this.config.localServicePath)
      ? this.config.localServicePath
      : path.join(projectRoot, this.config.localServicePath);

    const exePath = path.isAbsolute(this.config.localServicePythonExe)
      ? this.config.localServicePythonExe
      : path.join(projectRoot, this.config.localServicePythonExe);

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
    const appRoot = process.env.APP_ROOT || path.dirname(process.execPath);
    const projectRoot = process.env.APP_ROOT
      ? path.join(appRoot, '..', '..')  // 开发模式：从 client 向上两级到项目根
      : path.join(appRoot, '..');       // 生产模式：从安装目录向上

    const servicePath = path.isAbsolute(this.config.localServicePath)
      ? this.config.localServicePath
      : path.join(projectRoot, this.config.localServicePath);

    const exePath = path.isAbsolute(this.config.localServicePythonExe)
      ? this.config.localServicePythonExe
      : path.join(projectRoot, this.config.localServicePythonExe);

    return {
      exe: exePath,
      args: [servicePath],
      cwd: projectRoot
    };
  }
}

// 创建全局配置管理器实例
export const configManager = new ConfigManager();