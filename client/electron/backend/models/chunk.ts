import { DataTypes, Model, Optional, type Sequelize } from "sequelize";

export interface ChunkAttributes {
  id: number;
  chunk_id: string; // UNIQUE identifier per chunk
  file_id: string; // references files.file_id
  chunk_index: number;
  content: string;
  content_type: string; // default 'text'
  char_count: number;
  token_count: number | null;
  embedding_id: string | null;
  start_pos: number | null;
  end_pos: number | null;
  created_at: string; // ISO TEXT
}

type ChunkCreationAttributes = Optional<ChunkAttributes, "id" | "token_count" | "embedding_id" | "start_pos" | "end_pos">;

export class ChunkModel extends Model<ChunkAttributes, ChunkCreationAttributes> implements ChunkAttributes {
  declare id: number;
  declare chunk_id: string;
  declare file_id: string;
  declare chunk_index: number;
  declare content: string;
  declare content_type: string;
  declare char_count: number;
  declare token_count: number | null;
  declare embedding_id: string | null;
  declare start_pos: number | null;
  declare end_pos: number | null;
  declare created_at: string;
}

let initialized = false;

export const initializeChunkModel = (sequelize: Sequelize): typeof ChunkModel => {
  if (initialized) {
    return ChunkModel;
  }

  ChunkModel.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      chunk_id: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      file_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      chunk_index: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      content_type: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: "text",
      },
      char_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      token_count: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      embedding_id: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      start_pos: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      end_pos: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
    },
    {
      sequelize,
      tableName: "chunks",
      timestamps: false,
      indexes: [
        { fields: ["file_id"] },
        { fields: ["chunk_id"], unique: true },
        { fields: ["file_id", "chunk_index"], unique: true },
      ],
    }
  );

  initialized = true;
  return ChunkModel;
};

export default ChunkModel;
