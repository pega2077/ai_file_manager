"""
Chat Controller
聊天相关接口控制器
"""
import time
import uuid
from datetime import datetime
from typing import Dict, Any, Optional, List
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from loguru import logger

# 导入公共工具
from commons import create_response, create_error_response
# 导入配置
from config import settings
# 导入数据库管理器
from database import DatabaseManager
# 导入向量数据库
from vector_db import VectorDatabase
# 导入 LLM 客户端
from embedding import get_llm_client, get_embedding_generator

# 创建路由器
chat_router = APIRouter(prefix="/api/chat", tags=["chat"])

# 请求/响应模型
class ChatAskRequest(BaseModel):
    question: str = Field(..., description="用户问题")
    context_limit: int = Field(default=5, description="检索上下文数量", ge=1, le=20)
    similarity_threshold: float = Field(default=0.7, description="相似度阈值", ge=0.0, le=1.0)
    temperature: float = Field(default=0.7, description="LLM 温度参数", ge=0.0, le=2.0)
    max_tokens: int = Field(default=1000, description="最大生成token数", ge=100, le=4000)
    stream: bool = Field(default=False, description="是否流式响应")
    file_filters: Optional[Dict[str, Any]] = Field(default=None, description="文件筛选条件")

class FileFilters(BaseModel):
    file_ids: Optional[List[str]] = Field(default=None, description="指定文件ID列表")
    categories: Optional[List[str]] = Field(default=None, description="指定分类列表")
    tags: Optional[List[str]] = Field(default=None, description="指定标签列表")

class ChatHistoryRequest(BaseModel):
    page: int = Field(default=1, description="页码", ge=1)
    limit: int = Field(default=20, description="每页数量", ge=1, le=100)
    session_id: Optional[str] = Field(default=None, description="会话ID")

class ChatResponse(BaseModel):
    answer: str
    confidence: float
    sources: List[Dict[str, Any]]
    metadata: Dict[str, Any]

class ChatHistoryResponse(BaseModel):
    conversations: List[Dict[str, Any]]
    pagination: Dict[str, Any]

class SourceInfo(BaseModel):
    file_id: str
    file_name: str
    file_path: str
    chunk_id: str
    chunk_content: str
    chunk_index: int
    relevance_score: float

class ChatMetadata(BaseModel):
    model_used: str
    tokens_used: int
    response_time_ms: int
    retrieval_time_ms: int
    generation_time_ms: int

# 全局实例
_db_manager = None
_vector_db = None
_llm_client = None
_embedding_generator = None

def get_db_manager() -> DatabaseManager:
    """获取数据库管理器实例"""
    global _db_manager
    if _db_manager is None:
        _db_manager = DatabaseManager()
    return _db_manager

def get_vector_db() -> VectorDatabase:
    """获取向量数据库实例"""
    global _vector_db
    if _vector_db is None:
        _vector_db = VectorDatabase(settings.database_path / "vectors", dimension=settings.embedding_dimension)
        _vector_db.initialize()
    return _vector_db

def get_llm_client_instance():
    """获取LLM客户端实例"""
    global _llm_client
    if _llm_client is None:
        _llm_client = get_llm_client()
    return _llm_client

def get_embedding_generator_instance():
    """获取embedding生成器实例"""
    global _embedding_generator
    if _embedding_generator is None:
        _embedding_generator = get_embedding_generator()
    return _embedding_generator

@chat_router.post("/ask")
async def ask_question(request: ChatAskRequest):
    """
    智能问答接口
    基于RAG的智能问答功能
    """
    start_time = time.time()

    try:
        # 获取组件实例
        db_manager = get_db_manager()
        vector_db = get_vector_db()
        llm_client = get_llm_client_instance()
        embedding_gen = get_embedding_generator_instance()

        if not llm_client:
            return create_error_response(
                "LLM服务不可用，请检查配置",
                error_code="LLM_NOT_AVAILABLE"
            )

        # 1. 生成问题embedding
        retrieval_start = time.time()
        question_embedding = embedding_gen.generate_embedding(request.question)
        if not question_embedding:
            return create_error_response(
                "生成问题embedding失败",
                error_code="EMBEDDING_GENERATION_FAILED"
            )

        # 2. 向量检索相关文档
        search_results = vector_db.search_similar(
            query_embedding=question_embedding,
            limit=request.context_limit,
            similarity_threshold=request.similarity_threshold
        )
        logger.debug(f"检索到 {len(search_results)} 条相关文档")

        if not search_results:
            return create_response(
                data=ChatResponse(
                    answer="抱歉，我没有找到相关的信息来回答您的问题。",
                    confidence=0.0,
                    sources=[],
                    metadata={
                        "model_used": settings.llm_model or "unknown",
                        "tokens_used": 0,
                        "response_time_ms": int((time.time() - start_time) * 1000),
                        "retrieval_time_ms": int((time.time() - retrieval_start) * 1000),
                        "generation_time_ms": 0
                    }
                )
            )

        retrieval_time = int((time.time() - retrieval_start) * 1000)

        # 3. 构建上下文
        context_parts = []
        sources = []

        for result in search_results:
            chunk_id = result['metadata'].get('chunk_id')
            if not chunk_id:
                continue
                
            chunk_data = db_manager.get_chunk_by_id(chunk_id)

            if chunk_data:
                # 获取文件信息
                file_data = db_manager.get_file_by_id(chunk_data['file_id'])
                if file_data:
                    context_parts.append(f"文档片段 {chunk_data['chunk_index']}: {chunk_data['content']}")

                    sources.append({
                        "file_id": file_data['file_id'],
                        "file_name": file_data['name'],
                        "file_path": file_data['path'],
                        "chunk_id": chunk_id,
                        "chunk_content": chunk_data['content'][:200] + "..." if len(chunk_data['content']) > 200 else chunk_data['content'],
                        "chunk_index": chunk_data['chunk_index'],
                        "relevance_score": result['similarity_score']
                    })

        context = "\n\n".join(context_parts)

        # 4. 构建提示词
        prompt = f"""基于以下文档内容回答用户的问题。如果文档中没有相关信息，请说明无法回答。

文档内容：
{context}

用户问题：{request.question}

请提供准确、简洁的回答，并说明答案的来源。"""
        # logger.debug(f"构建的提示词: {prompt}")
        # 5. 调用LLM生成回答
        generation_start = time.time()
        answer = await llm_client.generate_response(
            prompt=prompt,
            temperature=request.temperature,
            max_tokens=request.max_tokens
        )
        generation_time = int((time.time() - generation_start) * 1000)

        # 6. 计算置信度（基于检索结果的相似度）
        avg_similarity = sum(result['similarity_score'] for result in search_results) / len(search_results)
        confidence = min(avg_similarity * 1.2, 1.0)  # 稍微放大但不超过1.0

        # 7. 保存对话历史
        conversation_id = str(uuid.uuid4())
        session_id = str(uuid.uuid4())  # 为每个对话创建新会话

        conversation_data = {
            "id": conversation_id,
            "session_id": session_id,
            "question": request.question,
            "answer": answer,
            "sources_count": len(sources),
            "confidence": confidence,
            "created_at": datetime.now().isoformat(),
            "metadata": {
                "context_limit": request.context_limit,
                "temperature": request.temperature,
                "max_tokens": request.max_tokens,
                "retrieval_time_ms": retrieval_time,
                "generation_time_ms": generation_time
            }
        }

        db_manager.save_conversation(conversation_data)

        # 8. 构建响应
        response_data = ChatResponse(
            answer=answer,
            confidence=round(confidence, 2),
            sources=sources,
            metadata={
                "model_used": settings.llm_model or "unknown",
                "tokens_used": len(answer.split()),  # 粗略估算token数
                "response_time_ms": int((time.time() - start_time) * 1000),
                "retrieval_time_ms": retrieval_time,
                "generation_time_ms": generation_time
            }
        )

        return create_response(data=response_data)

    except Exception as e:
        logger.error(f"问答处理失败: {e}")
        return create_error_response(
            f"问答处理失败: {str(e)}",
            error_code="GENERATION_FAILED"
        )

@chat_router.post("/history")
async def get_chat_history(request: ChatHistoryRequest):
    """
    获取对话历史记录
    """
    try:
        db_manager = get_db_manager()

        # 获取对话历史
        conversations, total_count = db_manager.get_conversations(
            page=request.page,
            limit=request.limit,
            session_id=request.session_id
        )

        # 构建分页信息
        total_pages = (total_count + request.limit - 1) // request.limit

        pagination = {
            "current_page": request.page,
            "total_pages": total_pages,
            "total_count": total_count,
            "limit": request.limit
        }

        response_data = ChatHistoryResponse(
            conversations=conversations,
            pagination=pagination
        )

        return create_response(data=response_data)

    except Exception as e:
        logger.error(f"获取对话历史失败: {e}")
        return create_error_response(
            f"获取对话历史失败: {str(e)}",
            error_code="INTERNAL_ERROR"
        )
