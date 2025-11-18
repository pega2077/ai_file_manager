import type { Request, Response, Express } from "express";
import type { Transaction } from "sequelize";
import fs from "fs";
import { promises as fsp } from "fs";
import { logger } from "../logger";
import { getSequelize } from "./db";
import { getGlobalIndexPath } from "./utils/vectorStore";
import { providerFactory, type ProviderType } from "./utils/LLMProviderFactory";

// Route handlers for system-level operations
const status = (_req: Request, res: Response) => {
  res.json({ status: "healthy" });
};

// Check LLM provider health status
const checkProviderHealth = async (req: Request, res: Response) => {
  try {
    const { provider } = req.body as { provider?: ProviderType };
    
    if (provider) {
      // Check single provider
      if (!providerFactory.hasProvider(provider)) {
        return res.status(400).json({
          success: false,
          error: {
            code: "INVALID_PROVIDER",
            message: `Provider '${provider}' is not registered`,
          },
        });
      }
      
      const isHealthy = await providerFactory.checkProviderHealth(provider);
      return res.json({
        success: true,
        message: "Provider health check completed",
        data: {
          provider,
          healthy: isHealthy,
        },
      });
    } else {
      // Check all providers
      const healthStatus = await providerFactory.checkAllProvidersHealth();
      const result: Record<string, boolean> = {};
      healthStatus.forEach((isHealthy, providerType) => {
        result[providerType] = isHealthy;
      });
      
      return res.json({
        success: true,
        message: "Provider health check completed",
        data: result,
      });
    }
  } catch (err) {
    logger.error("Provider health check failed", err as unknown);
    res.status(500).json({
      success: false,
      error: {
        code: "HEALTH_CHECK_FAILED",
        message: (err as Error).message || "Internal error",
      },
    });
  }
};

// Clear all application data: SQLite rows and vector index
const clearData = async (_req: Request, res: Response) => {
  try {
    const sequelize = getSequelize();
    // 1) Clear SQLite tables (order matters due to FK: chunks -> files)
    await sequelize.transaction(async (transaction: Transaction) => {
      await sequelize.query("DELETE FROM chunks;", { transaction });
      await sequelize.query("DELETE FROM files;", { transaction });
    });
    // VACUUM outside of transaction (SQLite requirement)
    try {
      await sequelize.query("VACUUM;");
    } catch (e) {
      logger.warn("VACUUM failed after clearing tables (non-fatal)", e as unknown);
    }

    // 2) Remove FAISS vector index file if it exists
    const vectorDbPath = getGlobalIndexPath();
    try {
      await fsp.access(vectorDbPath, fs.constants.F_OK);
      await fsp.unlink(vectorDbPath);
      logger.info(`Deleted FAISS index file: ${vectorDbPath}`);
    } catch {
      // File not found is fine; treat as already cleared
    }

    res.status(200).json({ success: true, message: "cleared" });
  } catch (err) {
    logger.error("/api/system/clear-data failed", err as unknown);
    res.status(500).json({ success: false, message: "internal_error" });
  }
};

export const registerSystemRoutes = (app: Express) => {
  // Health endpoints
  app.get("/api/system/status", status);
  // Provider health check
  app.post("/api/providers/health", checkProviderHealth);
  // Dangerous operation: clear all app data (DB + vector index)
  app.post("/api/system/clear-data", clearData);
};
