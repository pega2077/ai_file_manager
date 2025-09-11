"""
System Management Controller
系统管理相关接口控制器
"""
import os
import time
from typing import Dict, Any, Optional
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from loguru import logger

# 导入公共工具
from commons import create_response
# 导入配置
from config import settings

# 项目配置
PROJECT_ROOT = Path(__file__).parent.parent.parent
WORKDIR_PATH = PROJECT_ROOT / "workdir"
DATABASE_PATH = PROJECT_ROOT / "database"

# 服务启动时间
START_TIME = time.time()

# 创建路由器
system_router = APIRouter(prefix="/api/system", tags=["system"])

# 请求模型
class ConfigUpdateRequest(BaseModel):
    llm_type: Optional[str] = None
    llm_endpoint: Optional[str] = None
    llm_api_key: Optional[str] = None
    chunk_size: Optional[int] = None
    chunk_overlap: Optional[int] = None
    similarity_threshold: Optional[float] = None
    max_file_size_mb: Optional[int] = None
    pandoc_path: Optional[str] = None

@system_router.get("/status")
async def get_system_status():
    """获取系统运行状态"""
    try:
        # 检查目录是否存在
        workdir_exists = settings.workdir_path.exists()
        database_dir_exists = settings.database_path.exists()
        
        # 计算运行时间
        uptime_seconds = int(time.time() - START_TIME)
        
        # 检查数据库连接状态（暂时模拟）
        database_status = "connected" if database_dir_exists else "disconnected"
        
        # 模拟各服务状态
        services = {
            "database": database_status,
            "vector_db": "disconnected",  # 暂未实现
            "embedding_model": "error",   # 暂未加载
            "llm_model": "error"          # 暂未配置
        }
        
        # 确定整体健康状态
        if services["database"] == "connected":
            if services["vector_db"] == "connected" and services["embedding_model"] == "loaded":
                status = "healthy"
            else:
                status = "degraded"
        else:
            status = "unhealthy"
        
        # 统计信息（暂时模拟）
        statistics = {
            "total_files": 0,
            "total_chunks": 0,
            "total_embeddings": 0,
            "storage_used_mb": 0
        }
        
        # 如果workdir存在，统计文件数量
        if workdir_exists:
            try:
                file_count = len([f for f in settings.workdir_path.rglob("*") if f.is_file()])
                statistics["total_files"] = file_count
            except Exception as e:
                logger.warning(f"Unable to count files: {e}")
        
        system_status = {
            "status": status,
            "services": services,
            "statistics": statistics,
            "version": "1.0.0",
            "uptime_seconds": uptime_seconds
        }
        
        return create_response(
            message="System status retrieved successfully",
            data=system_status
        )
        
    except Exception as e:
        logger.error(f"Failed to get system status: {e}")
        return create_response(
            success=False,
            message="Failed to get system status",
            error={
                "code": "INTERNAL_ERROR",
                "message": str(e),
                "details": None
            }
        )

@system_router.get("/config")
async def get_system_config():
    """获取系统配置信息"""
    try:
        # 使用配置文件中的数据
        config = settings.get_config_dict()
        
        return create_response(
            message="System configuration retrieved successfully",
            data=config
        )
        
    except Exception as e:
        logger.error(f"Failed to get system config: {e}")
        return create_response(
            success=False,
            message="Failed to get system configuration",
            error={
                "code": "INTERNAL_ERROR",
                "message": str(e),
                "details": None
            }
        )

@system_router.post("/config/update")
async def update_system_config(request: ConfigUpdateRequest):
    """更新系统配置"""
    try:
        # 准备更新数据
        updates = request.dict(exclude_unset=True)
        
        # 使用配置文件的更新方法
        result = settings.update_config(updates)
        
        # 获取更新后的配置
        updated_config = settings.get_config_dict()
        
        return create_response(
            message="System configuration updated successfully",
            data={
                "updated_config": updated_config,
                "updated_fields": result["updated_fields"],
                "restart_required": result["restart_required"]
            }
        )
        
    except Exception as e:
        logger.error(f"Failed to update system config: {e}")
        return create_response(
            success=False,
            message="Failed to update system configuration",
            error={
                "code": "INTERNAL_ERROR",
                "message": str(e),
                "details": None
            }
        )
