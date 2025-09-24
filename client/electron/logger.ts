import { app } from "electron";
import fs from "fs";
import path from "path";

class Logger {
  private logFilePath: string;
  private initialized: boolean = false;

  constructor() {
    // 延迟初始化，因为在构造函数时 app.getPath 可能不可用
    this.logFilePath = "";
  }

  private initialize() {
    if (this.initialized) return;

    try {
      // 使用程序所在目录的 logs 文件夹
      let logsDir: string;

      if (app.isPackaged === false) {
        // 开发模式：基于 app.getAppPath()，避免依赖未初始化的环境变量
        const appRoot = app.getAppPath();
        logsDir = path.join(appRoot || process.cwd(), 'logs');
        console.log('Logger: Development mode, appRoot:', appRoot);
      } else {
        // 生产模式：使用用户数据目录，因为 Program Files 通常是只读的
        // const userDataPath = app.getPath('userData');
        // logsDir = path.join(userDataPath, 'logs');
        logsDir = path.join(path.dirname(app.getPath('exe')), 'logs');
        console.log('Logger: Production mode, userData:', logsDir);
      }
      console.log('Logger: Logs directory:', logsDir);
      
      // 确保日志目录存在
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      // 日志文件路径：logs/electron-YYYY-MM-DD.log
      const today = new Date().toISOString().split('T')[0];
      this.logFilePath = path.join(logsDir, `electron-${today}.log`);

      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize logger:', error);
      // Fallback: disable file logging to avoid repeated failures
      this.logFilePath = '';
      this.initialized = true;
    }
  }

  private formatMessage(level: string, message: string, ...args: unknown[]): string {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.length > 0 ? ` ${JSON.stringify(args)}` : '';
    return `[${timestamp}] [${level}] ${message}${formattedArgs}\n`;
  }

  private writeToFile(message: string) {
    if (!this.initialized) {
      this.initialize();
    }

    if (this.logFilePath) {
      try {
        // Use non-blocking append to avoid sync I/O on main thread
        void fs.promises.appendFile(this.logFilePath, message, { encoding: 'utf-8' }).catch((error) => {
          console.error('Failed to write to log file:', error);
        });
      } catch (error) {
        console.error('Failed to schedule log file write:', error);
      }
    }
  }

  info(message: string, ...args: unknown[]) {
    const formattedMessage = this.formatMessage('INFO', message, ...args);
    console.log(`[INFO] ${message}`, ...args);
    this.writeToFile(formattedMessage);
  }

  warn(message: string, ...args: unknown[]) {
    const formattedMessage = this.formatMessage('WARN', message, ...args);
    console.warn(`[WARN] ${message}`, ...args);
    this.writeToFile(formattedMessage);
  }

  error(message: string, ...args: unknown[]) {
    const formattedMessage = this.formatMessage('ERROR', message, ...args);
    console.error(`[ERROR] ${message}`, ...args);
    this.writeToFile(formattedMessage);
  }

  debug(message: string, ...args: unknown[]) {
    const formattedMessage = this.formatMessage('DEBUG', message, ...args);
    console.debug(`[DEBUG] ${message}`, ...args);
    this.writeToFile(formattedMessage);
  }

  getLogFilePath(): string {
    if (!this.initialized) {
      this.initialize();
    }
    return this.logFilePath;
  }
}

// 创建全局日志实例
export const logger = new Logger();