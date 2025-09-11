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

# 导入控制器
from controllers.system_controller import system_router

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
