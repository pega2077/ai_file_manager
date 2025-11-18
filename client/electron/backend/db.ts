import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";
import { QueryTypes, Sequelize } from "sequelize";
import { configManager } from "../configManager";
import { logger } from "../logger";
import { initializeFileModel } from "./models/file";
import { initializeChunkModel } from "./models/chunk";
import { initializeSystemTagModel } from "./models/systemTag";

let sequelizeInstance: Sequelize | null = null;
let ensuredDirectoryFor: string | null = null;

const resolveDatabasePath = (): string => {
  const config = configManager.loadConfig();
  const configuredPath = typeof config.sqliteDbPath === "string" && config.sqliteDbPath.trim().length > 0
    ? config.sqliteDbPath.trim()
    : "database/files.db";

  const absolutePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(configManager.getAppRoot(), configuredPath);

  return absolutePath;
};

const ensureDatabaseDirectory = async (storagePath: string): Promise<void> => {
  if (ensuredDirectoryFor === storagePath) {
    return;
  }

  const dir = path.dirname(storagePath);
  try {
    await fsp.mkdir(dir, { recursive: true });
    ensuredDirectoryFor = storagePath;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "EEXIST") {
      ensuredDirectoryFor = storagePath;
      return;
    }
    logger.warn("Failed to ensure SQLite directory exists", {
      directory: dir,
      error: String(error),
    });
  }
};

const databaseFileExists = async (storagePath: string): Promise<boolean> => {
  try {
    await fsp.access(storagePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const getOrCreateSequelize = (): Sequelize => {
  const storagePath = resolveDatabasePath();
  if (sequelizeInstance) {
    return sequelizeInstance;
  }

  sequelizeInstance = new Sequelize({
    dialect: "sqlite",
    storage: storagePath,
    logging: false,
  });

  return sequelizeInstance;
};

export const getSequelize = (): Sequelize => getOrCreateSequelize();

export async function authenticateDB(): Promise<void> {
  try {
    const storagePath = resolveDatabasePath();
    await ensureDatabaseDirectory(storagePath);
    const sequelize = getOrCreateSequelize();
    await sequelize.authenticate();
    logger.info("Sequelize connected to SQLite database", { storagePath });
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
    const storagePath = resolveDatabasePath();
    await ensureDatabaseDirectory(storagePath);
    const existedBefore = await databaseFileExists(storagePath);

    const sequelize = getOrCreateSequelize();

    await sequelize.query("PRAGMA foreign_keys = ON;");
    await sequelize.query("PRAGMA journal_mode = WAL;");

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
        imported BOOLEAN DEFAULT FALSE,
        processed BOOLEAN DEFAULT FALSE
      );`
    );

    await sequelize.query(
      `CREATE INDEX IF NOT EXISTS idx_files_file_id ON files(file_id);`
    );
    await sequelize.query(
      `CREATE INDEX IF NOT EXISTS idx_files_category ON files(category);`
    );

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

    await sequelize.query(
      `CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id);`
    );
    await sequelize.query(
      `CREATE INDEX IF NOT EXISTS idx_chunks_embedding_id ON chunks(embedding_id);`
    );

    await sequelize.query(
      `CREATE TABLE IF NOT EXISTS system_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_name TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT
      );`
    );

    await sequelize.query(
      `CREATE INDEX IF NOT EXISTS idx_system_tags_name ON system_tags(tag_name);`
    );

    try {
      const filesTableInfo = await sequelize.query<{ name: string }>("PRAGMA table_info(files);", {
        type: QueryTypes.SELECT,
      });
      const hasImportedColumn = filesTableInfo.some((column) => column.name === "imported");
      if (!hasImportedColumn) {
        await sequelize.query("ALTER TABLE files ADD COLUMN imported BOOLEAN DEFAULT FALSE;");
        await sequelize.query("UPDATE files SET imported = 0 WHERE imported IS NULL;");
        logger.info("SQLite schema: added missing 'imported' column to files table");
      }
    } catch (migrationError) {
      logger.warn("Failed to ensure 'imported' column exists on files table", migrationError as unknown);
    }

    initializeFileModel(sequelize);
    initializeChunkModel(sequelize);
    initializeSystemTagModel(sequelize);

    logger.info("SQLite schema verified/initialized successfully");
    logger.info(
      `SQLite database file ${existedBefore ? "already existed" : "was created/initialized"}: ${storagePath}`
    );
  } catch (error) {
    logger.error("Failed to initialize SQLite schema", error as unknown);
    throw error;
  }
}

export async function closeDB(): Promise<void> {
  if (!sequelizeInstance) {
    return;
  }

  try {
    await sequelizeInstance.close();
    logger.info("Sequelize connection closed");
  } catch (error) {
    logger.error("Failed to close Sequelize connection", error as unknown);
  } finally {
    sequelizeInstance = null;
    ensuredDirectoryFor = null;
  }
}
