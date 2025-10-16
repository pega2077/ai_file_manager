import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../db";

export interface FileAttributes {
  id: number;
  file_id: string;
  path: string;
  name: string;
  type: string;
  category: string;
  summary: string | null;
  tags: string | null; // JSON array string in DB
  size: number;
  created_at: string; // ISO string stored as TEXT
  updated_at: string | null;
  processed: number | boolean | null;
  imported: number | boolean | null;
}

type FileCreationAttributes = Optional<FileAttributes, "id" | "summary" | "tags" | "updated_at" | "processed" | "imported">;

export class FileModel extends Model<FileAttributes, FileCreationAttributes> implements FileAttributes {
  declare id: number;
  declare file_id: string;
  declare path: string;
  declare name: string;
  declare type: string;
  declare category: string;
  declare summary: string | null;
  declare tags: string | null;
  declare size: number;
  declare created_at: string;
  declare updated_at: string | null;
  declare processed: number | boolean | null;
  declare imported: number | boolean | null;
}

// Initialize (idempotent) model definition
FileModel.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    file_id: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    path: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    name: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    category: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    summary: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    tags: {
      type: DataTypes.TEXT, // JSON string
      allowNull: true,
    },
    size: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    created_at: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    updated_at: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    processed: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
    imported: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    sequelize,
    tableName: "files",
    timestamps: false,
  }
);

export default FileModel;
