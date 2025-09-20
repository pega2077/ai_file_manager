import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn, ChildProcess } from "child_process";
import { logger } from "./logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pythonProcess: ChildProcess | null = null;

export const checkServiceStatus = async (apiBaseUrl: string): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${apiBaseUrl}/api/system/status`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    logger.warn('Service not running:', error);
    return false;
  }
};

export const startPythonServer = (): void => {
  const projectRoot = path.join(__dirname, '..', '..');
  const pythonScript = path.join(projectRoot, 'python', 'server.py');
  const venvPython = path.join(projectRoot, 'python', 'venv', 'Scripts', 'python.exe');

  logger.info('Starting Python server directly:', pythonScript);

  // 使用虚拟环境的 Python 解释器直接启动
  pythonProcess = spawn(venvPython, [pythonScript], {
    cwd: projectRoot,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  pythonProcess.stdout?.on('data', (data) => {
    logger.info('Python server stdout:', data.toString().trim());
  });

  pythonProcess.stderr?.on('data', (data) => {
    const output = data.toString().trim();
    // 检查是否包含错误关键词
    const isError = /\b(ERROR|error|Error|FATAL|fatal|Fatal|CRITICAL|critical|Critical|Exception|exception)\b/.test(output);

    if (isError) {
      logger.error('Python server stderr:', output);
    } else {
      logger.info('Python server stderr:', output);
    }
  });

  pythonProcess.on('close', (code) => {
    logger.info('Python server process exited with code:', code);
    pythonProcess = null;
  });

  pythonProcess.on('error', (error) => {
    logger.error('Failed to start Python server:', error);
  });

  // Note: Removed unref() to keep process attached for output logging
  // pythonProcess.unref();
};

export const stopPythonServer = (): void => {
  if (pythonProcess && !pythonProcess.killed) {
    logger.info('Stopping Python server...');
    pythonProcess.kill('SIGTERM');
    pythonProcess = null;
  } else {
    logger.info('Python server is not running or already stopped.');
  }
};