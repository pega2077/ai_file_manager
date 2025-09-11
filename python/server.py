"""
AI文件管理器 FastAPI 服务端
"""
import os
import time
import uuid
from datetime import datetime
from typing import Dict, Any, Optional
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uvicorn
from loguru import logger

# 项目配置
PROJECT_ROOT = Path(__file__).parent.parent
WORKDIR_PATH = PROJECT_ROOT / "workdir"
DATABASE_PATH = PROJECT_ROOT / "database"

app = FastAPI(
    title="AI文件管理器 API",
    description="桌面端RAG文档整理程序后端服务",
    version="1.0.0"
)

# CORS配置，允许前端访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 服务启动时间
START_TIME = time.time()

# 响应模型
class APIResponse(BaseModel):
    success: bool
    message: str
    data: Optional[Any] = None
    error: Optional[Dict[str, Any]] = None
    timestamp: str
    request_id: str

def create_response(
    success: bool = True,
    message: str = "",
    data: Any = None,
    error: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """创建统一格式的API响应"""
    return {
        "success": success,
        "message": message,
        "data": data,
        "error": error,
        "timestamp": datetime.now().isoformat(),
        "request_id": str(uuid.uuid4())
    }

@app.get("/")
async def root():
    """根路径"""
    return create_response(
        message="AI文件管理器 API 服务正在运行",
        data={"version": "1.0.0", "status": "running"}
    )

@app.get("/api/system/status")
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
                logger.warning(f"无法统计文件数量: {e}")
        
        system_status = {
            "status": status,
            "services": services,
            "statistics": statistics,
            "version": "1.0.0",
            "uptime_seconds": uptime_seconds
        }
        
        return create_response(
            message="系统状态获取成功",
            data=system_status
        )
        
    except Exception as e:
        logger.error(f"获取系统状态失败: {e}")
        return create_response(
            success=False,
            message="获取系统状态失败",
            error={
                "code": "INTERNAL_ERROR",
                "message": str(e),
                "details": None
            }
        )

@app.get("/api/system/config")
async def get_system_config():
    """获取系统配置信息"""
    try:
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
            "supported_file_types": [
                ".txt", ".md", ".pdf", ".docx", ".doc", 
                ".html", ".htm", ".rtf", ".odt"
            ],
            "workdir_path": str(WORKDIR_PATH),
            "database_path": str(DATABASE_PATH)
        }
        
        return create_response(
            message="系统配置获取成功",
            data=config
        )
        
    except Exception as e:
        logger.error(f"获取系统配置失败: {e}")
        return create_response(
            success=False,
            message="获取系统配置失败",
            error={
                "code": "INTERNAL_ERROR",
                "message": str(e),
                "details": None
            }
        )

@app.exception_handler(404)
async def not_found_handler(request, exc):
    """404错误处理"""
    return JSONResponse(
        status_code=404,
        content=create_response(
            success=False,
            message="接口不存在",
            error={
                "code": "RESOURCE_NOT_FOUND",
                "message": f"路径 {request.url.path} 不存在",
                "details": None
            }
        )
    )

@app.exception_handler(500)
async def internal_error_handler(request, exc):
    """500错误处理"""
    logger.error(f"内部服务器错误: {exc}")
    return JSONResponse(
        status_code=500,
        content=create_response(
            success=False,
            message="服务器内部错误",
            error={
                "code": "INTERNAL_ERROR",
                "message": "服务器内部错误",
                "details": None
            }
        )
    )

def init_directories():
    """初始化必要的目录"""
    try:
        WORKDIR_PATH.mkdir(parents=True, exist_ok=True)
        DATABASE_PATH.mkdir(parents=True, exist_ok=True)
        logger.info(f"工作目录: {WORKDIR_PATH}")
        logger.info(f"数据库目录: {DATABASE_PATH}")
    except Exception as e:
        logger.error(f"初始化目录失败: {e}")
        raise

if __name__ == "__main__":
    # 配置日志
    logger.add(
        PROJECT_ROOT / "logs" / "server.log",
        rotation="1 day",
        retention="7 days",
        level="INFO"
    )
    
    # 初始化目录
    init_directories()
    
    logger.info("启动 AI文件管理器 API 服务...")
    
    # 启动服务
    uvicorn.run(
        "server:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        log_level="info"
    )
