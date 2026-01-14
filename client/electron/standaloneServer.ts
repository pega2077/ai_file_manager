/**
 * Standalone server for web mode (without Electron)
 * This server provides the same backend API as the Electron server
 * but also serves the static React application
 */
import express, { Request, Response, NextFunction } from "express";
import type { Server } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { configManager } from "./configManager";
import { logger } from "./logger";
import { registerSystemRoutes } from "./backend/systemController";
import { registerFilesRoutes } from "./backend/filesController";
import { registerFilesOpRoutes } from "./backend/filesOpController";
import { registerSystemTagsRoutes } from "./backend/systemTagsController";
import { authenticateDB, initializeDB } from "./backend/db";
import { getGlobalIndexPath } from "./backend/utils/vectorStore";
import { registerChatRoutes } from "./backend/chatController";
import { registerConversionRoutes } from "./backend/convertController";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let server: Server | null = null;

/**
 * Initialize and start the standalone Express server for web mode.
 * Serves both the API and the static React application.
 */
export const startStandaloneServer = async (): Promise<void> => {
  try {
    // Ensure config is loaded
    const config = configManager.loadConfig();

    const host = config.localServiceHost || "127.0.0.1";
    const port = Number(config.localServicePort) || 8000;

    if (server) {
      logger.info("Express server already running, skipping start.");
      return;
    }

    const app = express();
    
    // Body parsers
    app.use(express.json({ limit: "50mb" }));
    app.use(express.urlencoded({ extended: true }));

    // CORS: allow all origins and handle preflight
    app.use((req: Request, res: Response, next: NextFunction) => {
      res.header("Access-Control-Allow-Origin", "*");
      res.header(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept, Authorization"
      );
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
      );
      if (req.method === "OPTIONS") {
        return res.sendStatus(204);
      }
      next();
    });

    // Initialize DB connection and ensure schema exists
    await authenticateDB();
    await initializeDB();
    const vectorDbPath = await getGlobalIndexPath();
    logger.info(`Using FAISS vector DB path: ${vectorDbPath}`);

    // Register backend routes
    registerSystemRoutes(app);
    registerFilesRoutes(app);
    registerFilesOpRoutes(app);
    registerChatRoutes(app);
    registerConversionRoutes(app);
    registerSystemTagsRoutes(app);

    // Serve static files from the React build
    // The static files should be in builds/web relative to project root
    // When running with tsx, __dirname is electron directory
    // When running compiled, __dirname is builds/electron/electron directory
    const isCompiledMode = __dirname.includes('builds');
    const staticPath = isCompiledMode 
      ? path.resolve(__dirname, "..", "..", "web")
      : path.resolve(__dirname, "..", "builds", "web");
    logger.info(`Serving static files from: ${staticPath}`);
    
    app.use(express.static(staticPath));

    // SPA fallback: serve index.html for all non-API routes
    // Must be registered AFTER all specific routes
    app.use((req: Request, res: Response, next: NextFunction) => {
      // Don't serve index.html for API routes
      if (req.path.startsWith("/api/")) {
        return next();
      }
      // Serve index.html for all other routes
      res.sendFile(path.join(staticPath, "index.html"), (err) => {
        if (err) {
          next(err);
        }
      });
    });

    // Generic error handler (last middleware)
    app.use(
      (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        // mark parameter as used to satisfy noUnusedParameters
        void _next;
        logger.error("Express error handler caught exception", err);
        res.status(500).json({ error: "internal_error" });
      }
    );

    const srv = app.listen(port, host, () => {
      logger.info(`Standalone Express server listening on http://${host}:${port}`);
      logger.info(`Open http://${host}:${port} in your browser`);
    });

    srv.on("error", (err: unknown) => {
      logger.error("Express server failed to start", err);
    });
    
    server = srv;
  } catch (error) {
    logger.error("Failed to start standalone Express server", error as unknown);
    throw error;
  }
};

/**
 * Stop the standalone Express server if running.
 */
export const stopStandaloneServer = async (): Promise<void> => {
  if (!server) {
    logger.info("Express server is not running or already stopped.");
    return;
  }

  logger.info("Attempting to stop Express server gracefully...", server.address());
  server.closeAllConnections();
  
  const stopPromise = new Promise<void>((resolve, reject) => {
    server?.close((err?: Error) => {
      if (err) {
        logger.error("Error stopping Express server", err);
        reject(err);
      } else {
        logger.info("Express server stopped gracefully.");
        server = null;
        resolve();
      }
    });
  });

  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(() => {
      logger.warn("Express server stop timed out, forcing shutdown");
      // Force close all connections if available (Node.js 18.2.0+)
      if (server && 'closeAllConnections' in server && typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
        logger.info("Forced close of all server connections");
      }
      // Clear the reference regardless
      server = null;
      resolve(); // Resolve instead of reject to allow continuation
    }, 2000); // Reduced timeout to 2 seconds
  });

  try {
    await Promise.race([stopPromise, timeoutPromise]);
  } catch (error) {
    logger.error("Failed to stop Express server", error);
    // Ensure server reference is cleared even on error
    server = null;
    throw error;
  }
};

// If this file is run directly, start the server
if (import.meta.url === `file://${process.argv[1]}`) {
  startStandaloneServer().catch((error) => {
    logger.error("Failed to start standalone server", error);
    process.exit(1);
  });

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    logger.info("SIGINT received, shutting down...");
    await stopStandaloneServer();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("SIGTERM received, shutting down...");
    await stopStandaloneServer();
    process.exit(0);
  });
}
