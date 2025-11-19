import { DataTypes, Model, Optional, type Sequelize } from "sequelize";

export interface SystemTagAttributes {
  id: number;
  tag_name: string;
  created_at: string;
  updated_at: string | null;
}

type SystemTagCreationAttributes = Optional<SystemTagAttributes, "id" | "updated_at">;

export class SystemTagModel extends Model<SystemTagAttributes, SystemTagCreationAttributes> implements SystemTagAttributes {
  declare id: number;
  declare tag_name: string;
  declare created_at: string;
  declare updated_at: string | null;
}

let initialized = false;

export const initializeSystemTagModel = (sequelize: Sequelize): typeof SystemTagModel => {
  if (initialized) {
    return SystemTagModel;
  }

  SystemTagModel.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      tag_name: {
        type: DataTypes.TEXT,
        allowNull: false,
        unique: true,
      },
      created_at: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      updated_at: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      sequelize,
      tableName: "system_tags",
      timestamps: false,
    }
  );

  initialized = true;
  return SystemTagModel;
};

export default SystemTagModel;
