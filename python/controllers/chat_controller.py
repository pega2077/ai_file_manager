"""
Chat Controller
聊天相关接口控制器
"""
import json
import time
import uuid
from datetime import datetime
from typing import Dict, Any, Optional, List
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
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
# 导入提示词模板管理器
from prompts import get_prompt_template

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
    file_ids: Optional[List[str]] = Field(default=None, description="指定文件ID列表，用于缩小检索范围")

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

class DirectoryStructureRequest(BaseModel):
    profession: str = Field(..., description="职业")
    purpose: str = Field(..., description="文件夹用途")
    min_directories: int = Field(default=6, description="最少目录数量", ge=1, le=50)
    max_directories: int = Field(default=20, description="最多目录数量", ge=1, le=50)
    max_depth: int = Field(default=2, description="最大目录层级", ge=1, le=5)
    temperature: float = Field(default=0.7, description="LLM 温度参数", ge=0, le=2.0)
    max_tokens: int = Field(default=2000, description="最大生成token数", ge=100, le=4000)

class DirectoryItem(BaseModel):
    path: str
    description: str

class DirectoryStructureResponse(BaseModel):
    directories: List[DirectoryItem]
    metadata: Dict[str, Any]

class RecommendDirectoryRequest(BaseModel):
    file_name: str = Field(..., description="文件名称")
    file_content: str = Field(..., description="文件部分内容")
    current_structure: Optional[List[str]] = Field(default=None, description="当前目录结构")
    temperature: float = Field(default=0.7, description="LLM 温度参数", ge=0.0, le=2.0)
    max_tokens: int = Field(default=500, description="最大生成token数", ge=100, le=2000)

class RecommendDirectoryResponse(BaseModel):
    recommended_directory: str
    recommended_directory_exist: bool
    reasoning: str
    alternatives: List[str]
    metadata: Dict[str, Any]

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
_prompt_template_manager = None

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

def get_prompt_template_manager():
    """获取提示词模板管理器实例"""
    global _prompt_template_manager
    if _prompt_template_manager is None:
        _prompt_template_manager = get_prompt_template()
    return _prompt_template_manager

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
        prompt_template_manager = get_prompt_template_manager()

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
            similarity_threshold=request.similarity_threshold,
            file_ids=request.file_ids
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
            # 从向量数据库结果中获取 embedding_id
            embedding_id = result.get('embedding_id', '')
            if not embedding_id:
                continue
                
            # 根据 embedding_id 从 SQLite 获取完整的 chunk 信息
            chunk_data = db_manager.get_chunk_by_embedding_id(embedding_id)

            if chunk_data:
                # 获取文件信息
                file_data = db_manager.get_file_by_id(chunk_data['file_id'])
                if file_data:
                    context_parts.append(f"文档片段 {chunk_data['chunk_index']}: {chunk_data['content']}")

                    sources.append({
                        "file_id": file_data['file_id'],
                        "file_name": file_data['name'],
                        "file_path": file_data['path'],
                        "chunk_id": chunk_data['chunk_id'],
                        "chunk_content": chunk_data['content'][:200] + "..." if len(chunk_data['content']) > 200 else chunk_data['content'],
                        "chunk_index": chunk_data['chunk_index'],
                        "relevance_score": result['similarity_score']
                    })

        context = "\n\n".join(context_parts)

        # 4. 构建提示词
        prompt = prompt_template_manager.format_template(
            "chat_qa",
            context=context,
            question=request.question
        )
        # logger.debug(f"构建的提示词: {prompt}")
        # 5. 调用LLM生成回答
        generation_start = time.time()
        
        if request.stream:
            # 流式输出
            async def generate_stream():
                full_answer = ""
                async for chunk in llm_client.generate_stream_response(
                    prompt=prompt,
                    temperature=request.temperature,
                    max_tokens=request.max_tokens
                ):
                    full_answer += chunk
                    # 返回SSE格式的数据
                    yield f"data: {json.dumps({'chunk': chunk, 'type': 'content'})}\n\n"
                
                # 发送结束信号和元数据
                generation_time = int((time.time() - generation_start) * 1000)
                avg_similarity = sum(result['similarity_score'] for result in search_results) / len(search_results)
                confidence = min(avg_similarity * 1.2, 1.0)
                
                metadata = {
                    "model_used": settings.llm_model or "unknown",
                    "tokens_used": len(full_answer.split()),
                    "response_time_ms": int((time.time() - start_time) * 1000),
                    "retrieval_time_ms": retrieval_time,
                    "generation_time_ms": generation_time
                }
                
                yield f"data: {json.dumps({'type': 'metadata', 'confidence': round(confidence, 2), 'sources': sources, 'metadata': metadata})}\n\n"
                yield "data: [DONE]\n\n"
                
                # 保存对话历史（流式输出完成后）
                conversation_id = str(uuid.uuid4())
                session_id = str(uuid.uuid4())
                conversation_data = {
                    "id": conversation_id,
                    "session_id": session_id,
                    "question": request.question,
                    "answer": full_answer,
                    "sources_count": len(sources),
                    "confidence": confidence,
                    "created_at": datetime.now().isoformat(),
                    "metadata": {
                        "context_limit": request.context_limit,
                        "temperature": request.temperature,
                        "max_tokens": request.max_tokens,
                        "retrieval_time_ms": retrieval_time,
                        "generation_time_ms": generation_time,
                        "stream": True
                    }
                }
                db_manager.save_conversation(conversation_data)
            
            return StreamingResponse(
                generate_stream(),
                media_type="text/plain",
                headers={"Content-Type": "text/event-stream; charset=utf-8"}
            )
        else:
            # 普通输出
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

@chat_router.post("/directory-structure")
async def recommend_directory_structure(request: DirectoryStructureRequest):
    """
    目录结构推荐接口
    基于职业和用途推荐目录结构
    """
    start_time = time.time()

    try:
        # 获取组件实例
        llm_client = get_llm_client_instance()

        if not llm_client:
            return create_error_response(
                "LLM服务不可用，请检查配置",
                error_code="LLM_NOT_AVAILABLE"
            )

        # 构建messages
        messages = [
            {
                "role": "system",
                "content": "你是一个擅长为不同职业设计、可维护并易于扩展的文件夹/目录结构的助手。输出必须严格符合给定的 JSON Schema。"
            },
            {
                "role": "user",
                "content": f"""请根据下面输入参数，返回一个推荐的、便于长期维护的目录结构。输出必须仅为 JSON 字符串，不要使用```json，不要额外文字。

输入参数（JSON）:
{{
  "profession": "{request.profession}",
  "folder_purpose": "{request.purpose}",
  "min_directories": {request.min_directories},
  "max_directories": {request.max_directories},
  "max_depth": {request.max_depth}
}}

要求：
- 返回 JSON，主键名为 directories。
- directories 为数组，数组项包含：path（相对路径，例如 "招聘/简历/待筛选"）、description（用途说明）。
- 要覆盖常见场景（例如备份、归档、临时、公共/私有等），并给出 {request.min_directories}~{request.max_directories} 条路径项（视职业复杂度）。
- 目录结构的最大层级不超过 {request.max_depth} 层。
- 输出必须严格匹配下面的 JSON Schema。"""
            }
        ]

        # 设置response_format
        response_format = {
            "json_schema": {
                "name": "directory_schema",
                "schema": {
                    "type": "object",
                    "properties": {
                        "directories": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "path": {"type": "string"},                          
                                    "description": {"type": "string"},
                                },
                                "required": ["path", "description"]
                            }
                        }
                    },
                    "required": ["directories"]
                },
                "strict": True
            }
        }

        # 调用LLM生成推荐
        generation_start = time.time()
        response_data = await llm_client.generate_structured_response(
            messages=messages,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            response_format=response_format
        )
        generation_time = int((time.time() - generation_start) * 1000)
        # print("got response:")
        # print(response_data)
        # 检查响应是否包含错误
        if "error" in response_data:
            logger.error(f"LLM structured response error: {response_data['error']}")
            return create_error_response(
                f"LLM响应错误: {response_data['error']}",
                error_code="LLM_RESPONSE_ERROR"
            )

        # 解析directories
        directories = response_data.get("directories", [])
        logger.info(f"directories count: {len(directories)}")

        # 转换为DirectoryItem对象
        directory_items = []
        for item in directories:
            if not isinstance(item, dict):
                logger.warning(f"Invalid directory item format: {item}")
                continue
                
            path = item.get("path")
            description = item.get("description")
            
            if not path or not description:
                logger.warning(f"Missing required fields in directory item: {item}")
                continue
                
            # print("item:", path, description)
            directory_items.append(DirectoryItem(
                path=path,
                description=description
            ))

        response = DirectoryStructureResponse(
            directories=directory_items,
            metadata={
                "model_used": settings.llm_model or "unknown",
                "tokens_used": len(str(response_data).split()),
                "response_time_ms": int((time.time() - start_time) * 1000),
                "generation_time_ms": generation_time
            }
        )

        return create_response(data=response)

    except Exception as e:
        logger.error(f"目录结构推荐失败: {e}")
        return create_error_response(
            f"目录结构推荐失败: {str(e)}",
            error_code="GENERATION_FAILED"
        )

@chat_router.post("/recommend-directory")
async def recommend_directory(request: RecommendDirectoryRequest):
    """
    推荐存放目录接口
    基于文件内容推荐存放目录
    """
    start_time = time.time()

    try:
        # 获取组件实例
        llm_client = get_llm_client_instance()

        if not llm_client:
            return create_error_response(
                "LLM服务不可用，请检查配置",
                error_code="LLM_NOT_AVAILABLE"
            )

        # 构建当前目录结构字符串
        current_structure_str = ""
        if request.current_structure:
            current_structure_str = "\n".join(request.current_structure)

        # 构建messages
        messages = [
            {
                "role": "system",
                "content": "你是一个文件分类专家，擅长根据文件内容和名称推荐合适的存放目录。输出必须严格符合给定的 JSON Schema。"
            },
            {
                "role": "user",
                "content": f"""请根据以下文件信息：

文件信息:
- 当前目录结构:
{current_structure_str}
- 文件名: {request.file_name}
- 文件内容: {request.file_content[:1000]}

要求：
- 检查所有已有目录是否适合文件（根据文件名和内容）。
- 检查时如果包含项目名称，应当重点根据项目名称判断。
- 如果找到匹配目录 → 选择该目录，recommended_directory_exist = true。
- 如果没有找到 → 不要选择已有目录，生成新目录路径，recommended_directory_exist = false。
- 严格禁止将文件放入不相关的已有目录。如果找不到匹配的已有目录，必须创建新目录，不能假设或猜测已有目录。
- 返回 JSON，包含：recommended_directory（推荐目录）、recommended_directory_exist（推荐目录是否存在）、reasoning（推荐理由）、alternatives（备选目录数组）
- 禁止将包含 ```json```，```json```，禁止将包含额外的说明文字，不要包含其他说明文字。
- 输出必须严格匹配下面的 JSON Schema。"""
            }
        ]

        # 设置response_format
        response_format = {
            "json_schema": {
                "name": "directory_recommendation_schema",
                "schema": {
                    "type": "object",
                    "properties": {
                        "recommended_directory": {"type": "string"},
                        "recommended_directory_exist": {"type": "boolean"},
                        "reasoning": {"type": "string"},
                        "alternatives": {
                            "type": "array",
                            "items": {"type": "string"}
                        }
                    },
                    "required": ["recommended_directory", "recommended_directory_exist", "reasoning", "alternatives"]
                },
                "strict": True
            }
        }

        # 调用LLM生成推荐
        generation_start = time.time()
        response_data = await llm_client.generate_structured_response(
            messages=messages,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            response_format=response_format
        )
        generation_time = int((time.time() - generation_start) * 1000)

        # 检查响应是否包含错误
        if "error" in response_data:
            logger.error(f"LLM structured response error: {response_data['error']}")
            return create_error_response(
                f"LLM响应错误: {response_data['error']}",
                error_code="LLM_RESPONSE_ERROR"
            )

        # 直接使用结构化响应数据
        response = RecommendDirectoryResponse(
            recommended_directory=response_data.get("recommended_directory", "未分类"),
            recommended_directory_exist=response_data.get("recommended_directory_exist", False),
            reasoning=response_data.get("reasoning", "无法确定推荐理由"),
            alternatives=response_data.get("alternatives", []),
            metadata={
                "model_used": settings.llm_model or "unknown",
                "tokens_used": len(str(response_data).split()),
                "response_time_ms": int((time.time() - start_time) * 1000),
                "generation_time_ms": generation_time
            }
        )

        return create_response(data=response)

    except Exception as e:
        logger.error(f"推荐存放目录失败: {e}")
        return create_error_response(
            f"推荐存放目录失败: {str(e)}",
            error_code="GENERATION_FAILED"
        )
