"""
配置管理模块
"""
import os
from pathlib import Path
from typing import Dict, Any, Optional
from pydantic import BaseSettings, Field
from loguru import logger


class Settings(BaseSettings):
    """应用配置"""
    
    # 服务配置
    host: str = Field(default="127.0.0.1", env="HOST")
    port: int = Field(default=8000, env="PORT")
    debug: bool = Field(default=True, env="DEBUG")
    
    # 目录配置
    project_root: Path = Field(default_factory=lambda: Path(__file__).parent.parent)
    workdir_path: Optional[Path] = None
    database_path: Optional[Path] = None
    logs_path: Optional[Path] = None
    
    # 文档处理配置
    chunk_size: int = Field(default=1000, env="CHUNK_SIZE")
    chunk_overlap: int = Field(default=200, env="CHUNK_OVERLAP")
    max_file_size_mb: int = Field(default=50, env="MAX_FILE_SIZE_MB")
    pandoc_path: str = Field(default="", env="PANDOC_PATH")  # 将在 __init__ 中设置默认路径
    
    # Embedding配置
    embedding_model: str = Field(
        default="sentence-transformers/all-MiniLM-L6-v2", 
        env="EMBEDDING_MODEL"
    )
    embedding_dimension: int = Field(default=384, env="EMBEDDING_DIMENSION")
    
    # 搜索配置
    similarity_threshold: float = Field(default=0.7, env="SIMILARITY_THRESHOLD")
    max_search_results: int = Field(default=20, env="MAX_SEARCH_RESULTS")
    
    # LLM配置
    llm_type: str = Field(default="local", env="LLM_TYPE")  # local, openai, ollama, claude, custom
    llm_model: str = Field(default="", env="LLM_MODEL")
    llm_endpoint: str = Field(default="http://localhost:11434", env="LLM_ENDPOINT")
    llm_api_key: str = Field(default="", env="LLM_API_KEY")
    llm_temperature: float = Field(default=0.7, env="LLM_TEMPERATURE")
    llm_max_tokens: int = Field(default=1000, env="LLM_MAX_TOKENS")
    
    # 支持的文件类型
    supported_file_types: list = Field(
        default=[".txt", ".md", ".pdf", ".docx", ".doc", ".html", ".htm", ".rtf", ".odt"]
    )
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._init_paths()
    
    def _init_paths(self):
        """初始化路径配置"""
        if self.workdir_path is None:
            self.workdir_path = self.project_root / "workdir"
        
        if self.database_path is None:
            self.database_path = self.project_root / "database"
        
        if self.logs_path is None:
            self.logs_path = self.project_root / "logs"
        
        if not self.pandoc_path:  # 如果 pandoc_path 为空，设置默认路径
            self.pandoc_path = str(self.project_root / "bin" / "pandoc.exe")
    
    def create_directories(self):
        """创建必要的目录"""
        directories = [self.workdir_path, self.database_path, self.logs_path]
        
        for directory in directories:
            try:
                directory.mkdir(parents=True, exist_ok=True)
                logger.info(f"目录已创建或已存在: {directory}")
            except Exception as e:
                logger.error(f"创建目录失败 {directory}: {e}")
    
    def get_config_dict(self) -> Dict[str, Any]:
        """获取配置字典"""
        return {
            "embedding_model": self.embedding_model,
            "llm_model": self.llm_model,
            "llm_type": self.llm_type,
            "llm_endpoint": self.llm_endpoint,
            "llm_api_key": "***" if self.llm_api_key else "",  # 隐藏API密钥
            "chunk_size": self.chunk_size,
            "chunk_overlap": self.chunk_overlap,
            "similarity_threshold": self.similarity_threshold,
            "max_file_size_mb": self.max_file_size_mb,
            "pandoc_path": self.pandoc_path,
            "supported_file_types": self.supported_file_types,
            "workdir_path": str(self.workdir_path),
            "database_path": str(self.database_path)
        }
    
    def update_config(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        """更新配置"""
        updated_fields = {}
        restart_required = False
        
        # 定义需要重启的配置项
        restart_required_fields = {
            "embedding_model", "llm_type", "llm_endpoint", 
            "database_path", "workdir_path", "pandoc_path"
        }
        
        for key, value in updates.items():
            if hasattr(self, key):
                old_value = getattr(self, key)
                setattr(self, key, value)
                updated_fields[key] = {"old": old_value, "new": value}
                
                if key in restart_required_fields and old_value != value:
                    restart_required = True
                    
                logger.info(f"配置更新: {key} = {value}")
        
        return {
            "updated_fields": updated_fields,
            "restart_required": restart_required
        }


# 全局配置实例
settings = Settings()
