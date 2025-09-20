import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn, ChildProcess } from "child_process";

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
    console.log('Service not running:', error);
    return false;
  }
};

export const startPythonServer = (): void => {
  const projectRoot = path.join(__dirname, '..', '..');
  const pythonScript = path.join(projectRoot, 'python', 'server.py');
  const venvPython = path.join(projectRoot, 'python', 'venv', 'Scripts', 'python.exe');

  console.log('Starting Python server directly:', pythonScript);

  // 使用虚拟环境的 Python 解释器直接启动
  pythonProcess = spawn(venvPython, [pythonScript], {
    cwd: projectRoot,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  pythonProcess.stdout?.on('data', (data) => {
    console.log('Python server stdout:', data.toString());
  });

  pythonProcess.stderr?.on('data', (data) => {
    console.error('Python server stderr:', data.toString());
  });

  pythonProcess.on('close', (code) => {
    console.log('Python server process exited with code:', code);
    pythonProcess = null;
  });

  pythonProcess.on('error', (error) => {
    console.error('Failed to start Python server:', error);
  });

  // Note: Removed unref() to keep process attached for output logging
  // pythonProcess.unref();
};

export const stopPythonServer = (): void => {
  if (pythonProcess && !pythonProcess.killed) {
    console.log('Stopping Python server...');
    pythonProcess.kill('SIGTERM');
    pythonProcess = null;
  } else {
    console.log('Python server is not running or already stopped.');
  }
};