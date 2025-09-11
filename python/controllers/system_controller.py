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
        workdir_exists = WORKDIR_PATH.exists()
        database_dir_exists = DATABASE_PATH.exists()
        
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
                file_count = len([f for f in WORKDIR_PATH.rglob("*") if f.is_file()])
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
        # 计算默认 pandoc 路径
        default_pandoc_path = str(PROJECT_ROOT / "bin" / "pandoc.exe")
        
        config = {
            "embedding_model": "sentence-transformers/all-MiniLM-L6-v2",
            "llm_model": "not_configured",
            "llm_type": "local",
            "llm_endpoint": "http://localhost:11434",
            "llm_api_key": "",
            "chunk_size": 1000,
            "chunk_overlap": 200,
            "similarity_threshold": 0.7,
            "max_file_size_mb": 50,
            "pandoc_path": default_pandoc_path,
            "supported_file_types": [
                ".txt", ".md", ".pdf", ".docx", ".doc", 
                ".html", ".htm", ".rtf", ".odt"
            ],
            "workdir_path": str(WORKDIR_PATH),
            "database_path": str(DATABASE_PATH)
        }
        
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
        # 获取当前配置
        default_pandoc_path = str(PROJECT_ROOT / "bin" / "pandoc.exe")
        current_config = {
            "llm_type": "local",
            "llm_endpoint": "http://localhost:11434",
            "llm_api_key": "",
            "chunk_size": 1000,
            "chunk_overlap": 200,
            "similarity_threshold": 0.7,
            "max_file_size_mb": 50,
            "pandoc_path": default_pandoc_path
        }
        
        # 更新配置
        updated_config = current_config.copy()
        restart_required = False
        
        # 定义需要重启的配置项
        restart_required_fields = {"llm_type", "llm_endpoint", "chunk_size", "pandoc_path"}
        
        for field, value in request.dict(exclude_unset=True).items():
            if value is not None:
                old_value = updated_config.get(field)
                updated_config[field] = value
                
                if field in restart_required_fields and old_value != value:
                    restart_required = True
                
                logger.info(f"Configuration updated: {field} = {value}")
        
        return create_response(
            message="System configuration updated successfully",
            data={
                "updated_config": updated_config,
                "restart_required": restart_required
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
