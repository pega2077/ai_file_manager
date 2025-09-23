import { Sequelize } from "sequelize";
import path from "path";
import fs from "fs";
import { configManager } from "../configManager";
import { logger } from "../logger";
import {app} from "electron";

// Initialize Sequelize with SQLite using configured database path
const config = configManager.loadConfig();
const dbPath = path.isAbsolute(config.sqliteDbPath)
  ? config.sqliteDbPath
  : path.join(path.dirname(app.getPath("exe")), config.sqliteDbPath);

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
  // logging: (msg: string) => (logger.debug(msg)),
  logging: false,
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

/**
 * Initialize database schema on first run (idempotent).
 * Creates tables and indexes if they do not already exist.
 */
export async function initializeDB(): Promise<void> {
  try {
    const existedBefore = fs.existsSync(dbPath);
    // Ensure FK is enforced and use WAL for better concurrency
    await sequelize.query("PRAGMA foreign_keys = ON;");
    await sequelize.query("PRAGMA journal_mode = WAL;");

    // Create files table
    await sequelize.query(
      `CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id TEXT UNIQUE NOT NULL,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        category TEXT NOT NULL,
        summary TEXT,
        tags TEXT,
        size INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        processed BOOLEAN DEFAULT FALSE
      );`
    );

    // Create indexes for files
    await sequelize.query(
      `CREATE INDEX IF NOT EXISTS idx_files_file_id ON files(file_id);`
    );
    await sequelize.query(
      `CREATE INDEX IF NOT EXISTS idx_files_category ON files(category);`
    );

    // Create chunks table
    await sequelize.query(
      `CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_id TEXT UNIQUE NOT NULL,
        file_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        content_type TEXT DEFAULT 'text',
        char_count INTEGER NOT NULL,
        token_count INTEGER,
        embedding_id TEXT,
        start_pos INTEGER,
        end_pos INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        FOREIGN KEY (file_id) REFERENCES files (file_id)
      );`
    );

    // Create indexes for chunks
    await sequelize.query(
      `CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id);`
    );
    await sequelize.query(
      `CREATE INDEX IF NOT EXISTS idx_chunks_embedding_id ON chunks(embedding_id);`
    );

    logger.info("SQLite schema verified/initialized successfully");
    logger.info(`SQLite database file ${existedBefore ? "already existed" : "was created/initialized"}: ${dbPath}`);
  } catch (error) {
    logger.error("Failed to initialize SQLite schema", error as unknown);
    throw error;
  }
}
