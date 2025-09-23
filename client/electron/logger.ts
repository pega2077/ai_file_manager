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
        // 开发模式：从 client/dist-electron 向上两级到项目根目录
        logsDir = path.join(process.env.APP_ROOT, 'logs');
        console.log('Logger: Development mode, APP_ROOT:', process.env.APP_ROOT);
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
        fs.appendFileSync(this.logFilePath, message);
      } catch (error) {
        console.error('Failed to write to log file:', error);
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