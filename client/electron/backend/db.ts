import { Sequelize } from "sequelize";
import path from "path";
import fs from "fs";
import { configManager } from "../configManager";
import { logger } from "../logger";

// Initialize Sequelize with SQLite using configured database path
const dbPath = configManager.getDatabaseAbsolutePath();

// Ensure directory exists (best-effort) without blocking
try {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
} catch (err) {
  logger.warn("Failed to ensure SQLite directory exists", err as unknown);
}

export const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: dbPath,
  logging: (msg: string) => logger.debug(msg),
});

export async function authenticateDB(): Promise<void> {
  try {
    await sequelize.authenticate();
    logger.info("Sequelize connected to SQLite database", dbPath);
  } catch (error) {
    logger.error("Sequelize failed to connect to SQLite", error as unknown);
    throw error;
  }
}
