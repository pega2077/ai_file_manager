/**
 * LlamaServerProvider - Singleton manager for llama-server lifecycle
 * Manages starting, stopping, and switching between text and vision models
 */

import { spawn, ChildProcess } from 'child_process';
import { logger } from '../../logger';
import type { AppConfig } from '../../configManager';
import path from 'path';

type ModelType = 'text' | 'vision';

interface ServerStatus {
  running: boolean;
  modelType: ModelType | null;
  pid: number | null;
}

export class LlamaServerProvider {
  private static instance: LlamaServerProvider;
  private serverProcess: ChildProcess | null = null;
  private currentModelType: ModelType | null = null;
  private config: AppConfig['llamacpp'] | null = null;
  private isStarting = false;

  private constructor() {
    // Private constructor for singleton pattern
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): LlamaServerProvider {
    if (!LlamaServerProvider.instance) {
      LlamaServerProvider.instance = new LlamaServerProvider();
    }
    return LlamaServerProvider.instance;
  }

  /**
   * Update configuration
   */
  public updateConfig(config: AppConfig['llamacpp']): void {
    this.config = config;
  }

  /**
   * Check if server is running
   */
  public async isServerRunning(): Promise<boolean> {
    if (!this.serverProcess || this.serverProcess.exitCode !== null) {
      return false;
    }

    // Try to ping the server health endpoint
    try {
      const endpoint = `http://${this.config?.llamacppHost || '127.0.0.1'}:${this.config?.llamacppPort || 8080}/health`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      
      const response = await fetch(endpoint, { 
        signal: controller.signal,
        method: 'GET',
      });
      
      clearTimeout(timeout);
      return response.ok;
    } catch (error) {
      logger.warn('Llama server health check failed:', error);
      return false;
    }
  }

  /**
   * Get current server status
   */
  public getStatus(): ServerStatus {
    return {
      running: this.serverProcess !== null && this.serverProcess.exitCode === null,
      modelType: this.currentModelType,
      pid: this.serverProcess?.pid || null,
    };
  }

  /**
   * Start llama-server with specified model type
   */
  public async startServer(modelType: ModelType): Promise<void> {
    if (this.isStarting) {
      logger.info('Server is already starting, waiting...');
      // Wait for the current start operation to complete
      await this.waitForServerReady();
      return;
    }

    // Check if server is already running with the same model type
    const isRunning = await this.isServerRunning();
    if (isRunning && this.currentModelType === modelType) {
      logger.info(`Llama server already running with ${modelType} model`);
      return;
    }

    // If server is running with different model type, stop it first
    if (isRunning && this.currentModelType !== modelType) {
      logger.info(`Switching from ${this.currentModelType} to ${modelType} model, stopping current server...`);
      await this.stopServer();
    }

    if (!this.config) {
      throw new Error('Llama CPP configuration is not set');
    }

    this.isStarting = true;

    try {
      const modelPath = modelType === 'text' 
        ? this.config.llamacppTextModelPath 
        : this.config.llamacppVisionModelPath;

      if (!modelPath) {
        throw new Error(`${modelType} model path is not configured`);
      }

      // Build llama-server command
      const serverCommand = this.buildServerCommand(modelType, modelPath);
      
      logger.info(`Starting llama-server for ${modelType} model:`, serverCommand.join(' '));

      // Spawn the server process
      this.serverProcess = spawn(serverCommand[0], serverCommand.slice(1), {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      this.currentModelType = modelType;

      // Handle server output
      this.serverProcess.stdout?.on('data', (data) => {
        logger.debug(`llama-server stdout: ${data.toString()}`);
      });

      this.serverProcess.stderr?.on('data', (data) => {
        logger.debug(`llama-server stderr: ${data.toString()}`);
      });

      // Handle server exit
      this.serverProcess.on('exit', (code, signal) => {
        logger.info(`llama-server exited with code ${code}, signal ${signal}`);
        this.serverProcess = null;
        this.currentModelType = null;
      });

      // Handle server errors
      this.serverProcess.on('error', (error) => {
        logger.error('llama-server process error:', error);
        this.serverProcess = null;
        this.currentModelType = null;
      });

      // Wait for server to be ready
      await this.waitForServerReady();
      
      logger.info(`llama-server started successfully for ${modelType} model (PID: ${this.serverProcess.pid})`);
    } catch (error) {
      logger.error('Failed to start llama-server:', error);
      this.serverProcess = null;
      this.currentModelType = null;
      throw error;
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * Stop llama-server
   */
  public async stopServer(): Promise<void> {
    if (!this.serverProcess) {
      logger.info('No llama-server process to stop');
      return;
    }

    return new Promise<void>((resolve) => {
      const pid = this.serverProcess!.pid;
      
      logger.info(`Stopping llama-server (PID: ${pid})...`);

      this.serverProcess!.once('exit', () => {
        logger.info('llama-server stopped successfully');
        this.serverProcess = null;
        this.currentModelType = null;
        resolve();
      });

      // Try graceful shutdown first
      this.serverProcess!.kill('SIGTERM');

      // Force kill after timeout
      setTimeout(() => {
        if (this.serverProcess && this.serverProcess.exitCode === null) {
          logger.warn('Force killing llama-server after timeout');
          this.serverProcess.kill('SIGKILL');
          this.serverProcess = null;
          this.currentModelType = null;
          resolve();
        }
      }, 5000);
    });
  }

  /**
   * Ensure server is running for the specified model type
   * Auto-starts if not running
   */
  public async ensureServerRunning(modelType: ModelType): Promise<void> {
    const isRunning = await this.isServerRunning();
    
    if (!isRunning || this.currentModelType !== modelType) {
      await this.startServer(modelType);
    }
  }

  /**
   * Build llama-server command arguments
   */
  private buildServerCommand(modelType: ModelType, modelPath: string): string[] {
    const host = this.config?.llamacppHost || '127.0.0.1';
    const port = this.config?.llamacppPort || 8080;
    
    // Determine llama-server executable path
    let serverExecutable = 'llama-server';
    if (this.config?.llamacppInstallDir) {
      serverExecutable = path.join(this.config.llamacppInstallDir, 'llama-server');
      // Add .exe extension on Windows
      if (process.platform === 'win32') {
        serverExecutable += '.exe';
      }
    }

    const args = [
      '--model', modelPath,
      '--host', host,
      '--port', port.toString(),
    ];

    // Add vision-specific parameters if using vision model
    if (modelType === 'vision' && this.config?.llamacppVisionDecoderPath) {
      args.push('--mmproj', this.config.llamacppVisionDecoderPath);
    }

    return [serverExecutable, ...args];
  }

  /**
   * Wait for server to be ready (health check polling)
   */
  private async waitForServerReady(maxRetries = 30, retryDelayMs = 1000): Promise<void> {
    const endpoint = `http://${this.config?.llamacppHost || '127.0.0.1'}:${this.config?.llamacppPort || 8080}/health`;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        
        const response = await fetch(endpoint, { 
          signal: controller.signal,
          method: 'GET',
        });
        
        clearTimeout(timeout);
        
        if (response.ok) {
          logger.info('llama-server is ready');
          return;
        }
      } catch (error) {
        // Server not ready yet, continue waiting
        logger.debug(`Waiting for llama-server to be ready (attempt ${i + 1}/${maxRetries})...`);
      }
      
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }

    throw new Error('llama-server failed to become ready within timeout');
  }
}

// Export singleton instance
export const llamaServerProvider = LlamaServerProvider.getInstance();
