import fs from "fs";
import path from "path";
import { ensureLogsDirSync } from "./backend/utils/pathHelper";

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
      // Resolve and ensure logs directory using helper
  const logsDir = ensureLogsDirSync();
      console.log('Logger: Logs directory:', logsDir);

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