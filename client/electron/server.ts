import express, { Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { configManager } from "./configManager";
import { logger } from "./logger";
import { registerSystemRoutes } from "./backend/systemController";
import { registerFilesRoutes } from "./backend/filesController";
import { registerFilesOpRoutes } from "./backend/filesOpController";
import { authenticateDB, initializeDB } from "./backend/db";
import {getGlobalIndexPath} from "./backend/utils/vectorStore";
import { registerChatRoutes } from "./backend/chatController";

let server: Server | null = null;

/**
 * Initialize and start the local Express server using config values.
 * Exposes health endpoint(s) and logs lifecycle events.
 */
export const startServer = async (): Promise<void> => {
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
    app.use(express.json({ limit: "2mb" }));
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
      logger.info(`Express server listening on http://${host}:${port}`);
    });

    srv.on("error", (err: unknown) => {
      logger.error("Express server failed to start", err);
    });
    server = srv;
  } catch (error) {
    logger.error("Failed to start Express server", error as unknown);
    throw error;
  }
};

/**
 * Stop the local Express server if running.
 */
export const stopServer = async (): Promise<void> => {
  if (!server) {
    logger.info("Express server is not running or already stopped.");
    return;
  }
  await new Promise<void>((resolve) => {
    server?.close(() => {
      logger.info("Express server stopped.");
      server = null;
      resolve();
    });
  });
};
