"""
AI文件管理器 FastAPI 服务端
"""
import os
import time
import uuid
from datetime import datetime
from typing import Dict, Any, Optional
from pathlib import Path
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uvicorn
from loguru import logger

# 导入控制器
from controllers.system_controller import system_router
from controllers.files_controller import files_router
from controllers.search_controller import search_router
from controllers.chat_controller import chat_router
# 导入配置
from config import settings
# 导入数据库管理器
from database import DatabaseManager

# 导入公共工具
from commons import create_response

# 项目配置
PROJECT_ROOT = Path(__file__).parent.parent
WORKDIR_PATH = PROJECT_ROOT / "workdir"
DATABASE_PATH = PROJECT_ROOT / "database"

app = FastAPI(
    title="AI文件管理器 API",
    description="桌面端RAG文档整理程序后端服务",
    version="1.0.0"
)

# 全局数据库管理器实例
db_manager = None

def get_db_manager() -> DatabaseManager:
    """获取数据库管理器实例"""
    global db_manager
    if db_manager is None:
        raise RuntimeError("Database manager not initialized. Call init_directories() first.")
    return db_manager

# CORS配置，允许前端访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 响应模型
class APIResponse(BaseModel):
    success: bool
    message: str
    data: Optional[Any] = None
    error: Optional[Dict[str, Any]] = None
    timestamp: str
    request_id: str

# 注册路由
app.include_router(system_router)
app.include_router(files_router)
app.include_router(search_router)
app.include_router(chat_router)

@app.get("/")
async def root():
    """根路径"""
    return create_response(
        message="AI文件管理器 API 服务正在运行",
        data={"version": "1.0.0", "status": "running"}
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
    """初始化必要的目录和配置文件"""
    global db_manager
    try:
        # 确保 .env 文件存在
        settings.ensure_env_file()
        
        # 使用设置中的路径创建目录
        settings.create_directories()
        
        # 初始化数据库连接
        db_manager = DatabaseManager()
        logger.info("Database initialized successfully")
        
        logger.info(f"工作目录: {settings.workdir_path}")
        logger.info(f"数据库目录: {settings.database_path}")
        logger.info(f"日志目录: {settings.logs_path}")
    except Exception as e:
        logger.error(f"初始化目录失败: {e}")
        raise

if __name__ == "__main__":
    # 配置日志
    logger.add(
        settings.logs_path / "server.log",
        rotation="1 day",
        retention="7 days",
        level="DEBUG" if settings.debug else "INFO"
    )
    
    # 初始化目录
    init_directories()
    
    logger.info("启动 AI文件管理器 API 服务...")
    
    # 启动服务
    uvicorn.run(
        "server:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
        log_level="debug" if settings.debug else "info"
    )
