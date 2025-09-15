"""
Search Controller
搜索相关接口控制器
"""
import time
from typing import List, Dict, Any, Optional
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from loguru import logger

# 导入公共工具
from commons import create_response, create_error_response, create_success_response
# 导入配置
from config import settings
# 导入数据库和向量数据库
from database import DatabaseManager
from vector_db import VectorDatabase
# 导入embedding生成器
from embedding import get_embedding_generator

# 创建路由器
search_router = APIRouter(prefix="/api/search", tags=["search"])

# 请求/响应模型
class SemanticSearchRequest(BaseModel):
    query: str = Field(..., description="Search query text")
    limit: int = Field(default=10, ge=1, le=50, description="Maximum number of results")
    similarity_threshold: float = Field(default=0.7, ge=0.0, le=1.0, description="Similarity threshold")
    file_types: Optional[List[str]] = Field(default=None, description="Filter by file types")
    categories: Optional[List[str]] = Field(default=None, description="Filter by categories")
    tags: Optional[List[str]] = Field(default=None, description="Filter by tags")

class KeywordSearchRequest(BaseModel):
    query: str = Field(..., description="Search query keywords")
    page: int = Field(default=1, ge=1, description="Page number")
    limit: int = Field(default=20, ge=1, le=100, description="Results per page")
    file_types: Optional[List[str]] = Field(default=None, description="Filter by file types")
    categories: Optional[List[str]] = Field(default=None, description="Filter by categories")

class FilenameSearchRequest(BaseModel):
    query: str = Field(..., description="Filename search query")
    page: int = Field(default=1, ge=1, description="Page number")
    limit: int = Field(default=20, ge=1, le=100, description="Results per page")
    file_types: Optional[List[str]] = Field(default=None, description="Filter by file types")
    categories: Optional[List[str]] = Field(default=None, description="Filter by categories")

class SemanticSearchResult(BaseModel):
    chunk_id: str
    file_id: str
    file_name: str
    file_path: str
    chunk_content: str
    chunk_index: int
    similarity_score: float
    context: Dict[str, Any]

class KeywordSearchResult(BaseModel):
    file_id: str
    file_name: str
    file_path: str
    file_type: str
    category: str
    matched_chunks: List[Dict[str, Any]]
    relevance_score: float

class FilenameSearchResult(BaseModel):
    file_id: str
    file_name: str
    file_path: str
    file_type: str
    category: str
    size: int
    added_at: str
    tags: List[str]

class SearchMetadata(BaseModel):
    query: str
    total_results: int
    search_time_ms: int
    embedding_time_ms: Optional[int] = None

@search_router.post("/semantic",
    summary="Semantic search using vector similarity",
    description="Perform semantic search based on vector similarity of embeddings",
    responses={
        200: {"description": "Search completed successfully"},
        400: {"description": "Invalid request parameters"},
        500: {"description": "Server error during search"}
    }
)
async def semantic_search(request: SemanticSearchRequest):
    """Perform semantic search using vector embeddings"""
    start_time = time.time()

    try:
        # 验证查询参数
        if not request.query or not request.query.strip():
            return create_error_response(
                message="Query cannot be empty",
                error_code="EMPTY_QUERY"
            )

        # 清理查询文本
        request.query = request.query.strip()

        logger.info(f"Starting semantic search for query: '{request.query}'")
        # 获取embedding生成器
        embedding_generator = get_embedding_generator()

        # 生成查询的embedding
        embedding_start = time.time()
        logger.info(f"Generating embedding for query: '{request.query}'")
        query_embedding = embedding_generator.generate_embedding(request.query)
        embedding_time = int((time.time() - embedding_start) * 1000)

        if not query_embedding:
            logger.error("Failed to generate embedding for query")
            return create_error_response(
                message="Failed to generate embedding for query",
                error_code="EMBEDDING_GENERATION_FAILED"
            )

        logger.info(f"Embedding generated successfully in {embedding_time}ms")

        # 获取向量数据库实例
        vector_db = VectorDatabase(settings.database_path / "vectors", dimension=384)

        # 初始化向量数据库
        if not vector_db.initialize():
            return create_error_response(
                message="Failed to initialize vector database",
                error_code="VECTOR_DB_INIT_FAILED"
            )

        # 执行向量搜索
        try:
            similar_results = vector_db.search_similar(
                query_embedding=query_embedding,
                limit=request.limit * 2,  # 获取更多结果用于过滤
                similarity_threshold=request.similarity_threshold
            )
            logger.info(f"Vector search completed, found {len(similar_results)} results")
        except Exception as search_error:
            logger.error(f"Vector search failed: {search_error}")
            return create_error_response(
                message="Failed to perform vector search",
                error_code="VECTOR_SEARCH_FAILED",
                error_details=str(search_error)
            )

        # 获取数据库管理器实例
        db_manager = DatabaseManager()

        # 构建结果
        results = []
        for result in similar_results[:request.limit]:
            try:
                # 从向量数据库结果中获取 embedding_id
                embedding_id = result.get("embedding_id", "")
                if not embedding_id:
                    logger.warning("No embedding_id found in search result")
                    continue

                # 根据 embedding_id 从 SQLite 获取完整的 chunk 信息
                chunk_data = db_manager.get_chunk_by_embedding_id(embedding_id)
                if not chunk_data:
                    logger.warning(f"Chunk data not found for embedding_id: {embedding_id}")
                    continue

                # 获取文件信息
                file_data = db_manager.get_file_by_id(chunk_data.get("file_id"))
                if not file_data:
                    logger.warning(f"File data not found for file_id: {chunk_data.get('file_id')}")
                    continue

                # 应用过滤器
                if request.file_types and file_data.get("type") not in request.file_types:
                    continue
                if request.categories and file_data.get("category") not in request.categories:
                    continue
                if request.tags:
                    file_tags = file_data.get("tags", [])
                    if not any(tag in file_tags for tag in request.tags):
                        continue

                # 获取上下文（参考 chinese_rag.py 的实现方式）
                context = {}
                chunk_index = chunk_data.get("chunk_index", 0)

                # 获取前一个chunk作为上下文
                if chunk_index > 0:
                    prev_chunk = db_manager.get_chunk_by_index(
                        chunk_data.get("file_id"), chunk_index - 1
                    )
                    if prev_chunk:
                        context["prev_chunk"] = prev_chunk.get("content", "")[:200] + "..." if len(prev_chunk.get("content", "")) > 200 else prev_chunk.get("content", "")

                # 获取后一个chunk作为上下文
                next_chunk = db_manager.get_chunk_by_index(
                    chunk_data.get("file_id"), chunk_index + 1
                )
                if next_chunk:
                    context["next_chunk"] = next_chunk.get("content", "")[:200] + "..." if len(next_chunk.get("content", "")) > 200 else next_chunk.get("content", "")

                # 构建结果（参考 chinese_rag.py 的格式）
                result_item = {
                    "chunk_id": chunk_data.get("chunk_id", ""),
                    "file_id": chunk_data.get("file_id", ""),
                    "file_name": file_data.get("name", ""),
                    "file_path": file_data.get("path", ""),
                    "chunk_content": chunk_data.get("content", ""),
                    "chunk_index": chunk_index,
                    "similarity_score": result.get("similarity_score", 0.0),
                    "context": context,
                    "metadata": {
                        "file_category": file_data.get("category", ""),
                        "file_type": file_data.get("type", ""),
                        "chunk_length": len(chunk_data.get("content", "")),
                        "created_at": chunk_data.get("created_at", "")
                    }
                }

                results.append(result_item)

            except Exception as result_error:
                logger.error(f"Error processing search result: {result_error}")
                continue

        logger.info(f"Successfully processed {len(results)} search results")

        search_time = int((time.time() - start_time) * 1000)

        logger.info(f"Semantic search completed in {search_time}ms, returned {len(results)} results")

        return create_success_response(
            message="Semantic search completed successfully",
            data={
                "results": results,
                "search_metadata": {
                    "query": request.query,
                    "total_results": len(results),
                    "search_time_ms": search_time,
                    "embedding_time_ms": embedding_time,
                    "similarity_threshold": request.similarity_threshold,
                    "filters_applied": {
                        "file_types": request.file_types,
                        "categories": request.categories,
                        "tags": request.tags
                    }
                }
            }
        )

    except Exception as e:
        logger.error(f"Error in semantic search: {e}")
        return create_error_response(
            message="Failed to perform semantic search",
            error_code="INTERNAL_ERROR",
            error_details=str(e)
        )

@search_router.post("/keyword",
    summary="Keyword-based text search",
    description="Perform keyword search across file contents",
    responses={
        200: {"description": "Search completed successfully"},
        400: {"description": "Invalid request parameters"},
        500: {"description": "Server error during search"}
    }
)
async def keyword_search(request: KeywordSearchRequest):
    """Perform keyword-based search"""
    start_time = time.time()

    try:
        # 获取数据库管理器实例
        db_manager = DatabaseManager()

        # 搜索包含关键词的chunks
        chunks, total_count = db_manager.search_chunks_by_content(
            query=request.query,
            page=request.page,
            limit=request.limit * 3  # 获取更多结果用于聚合
        )

        # 按文件分组结果
        file_results = {}
        for chunk in chunks:
            file_id = chunk["file_id"]

            if file_id not in file_results:
                # 获取文件信息
                file_data = db_manager.get_file_by_id(file_id)
                if not file_data:
                    continue

                # 应用过滤器
                if request.file_types and file_data["type"] not in request.file_types:
                    continue
                if request.categories and file_data["category"] not in request.categories:
                    continue

                file_results[file_id] = {
                    "file_id": file_id,
                    "file_name": file_data["name"],
                    "file_path": file_data["path"],
                    "file_type": file_data["type"],
                    "category": file_data["category"],
                    "matched_chunks": [],
                    "relevance_score": 0.0
                }

            if file_id in file_results:
                # 高亮匹配文本
                content = chunk["content"]
                query_lower = request.query.lower()
                highlight = content

                # 简单的关键词高亮（可以改进为更复杂的高亮逻辑）
                if query_lower in content.lower():
                    start = content.lower().find(query_lower)
                    end = start + len(request.query)
                    highlight = (
                        content[:start] +
                        "**" + content[start:end] + "**" +
                        content[end:]
                    )

                file_results[file_id]["matched_chunks"].append({
                    "chunk_id": chunk["chunk_id"],
                    "content": content,
                    "chunk_index": chunk["chunk_index"],
                    "highlight": highlight
                })

                # 计算相关性分数（基于匹配次数和位置）
                file_results[file_id]["relevance_score"] += 1.0

        # 转换为列表并排序
        results = list(file_results.values())
        results.sort(key=lambda x: x["relevance_score"], reverse=True)

        # 分页
        start_idx = (request.page - 1) * request.limit
        end_idx = start_idx + request.limit
        paginated_results = results[start_idx:end_idx]

        search_time = int((time.time() - start_time) * 1000)

        return create_success_response(
            message="Keyword search completed successfully",
            data={
                "results": paginated_results,
                "pagination": {
                    "current_page": request.page,
                    "total_pages": (len(results) + request.limit - 1) // request.limit,
                    "total_count": len(results),
                    "limit": request.limit
                },
                "search_metadata": {
                    "query": request.query,
                    "total_results": len(results),
                    "search_time_ms": search_time
                }
            }
        )

    except Exception as e:
        logger.error(f"Error in keyword search: {e}")
        return create_error_response(
            message="Failed to perform keyword search",
            error_code="INTERNAL_ERROR",
            error_details=str(e)
        )

@search_router.post("/filename",
    summary="Filename fuzzy search",
    description="Perform fuzzy search across filenames",
    responses={
        200: {"description": "Search completed successfully"},
        400: {"description": "Invalid request parameters"},
        500: {"description": "Server error during search"}
    }
)
async def filename_search(request: FilenameSearchRequest):
    """Perform filename-based fuzzy search"""
    start_time = time.time()

    try:
        # 验证查询参数
        if not request.query or not request.query.strip():
            return create_error_response(
                message="Query cannot be empty",
                error_code="EMPTY_QUERY"
            )

        # 清理查询文本
        request.query = request.query.strip()

        logger.info(f"Starting filename search for query: '{request.query}'")

        # 获取数据库管理器实例
        db_manager = DatabaseManager()

        # 搜索文件名匹配的文件
        files, total_count = db_manager.search_files_by_name(
            query=request.query,
            page=request.page,
            limit=request.limit
        )

        # 应用过滤器
        filtered_files = []
        for file_data in files:
            # 应用文件类型过滤器
            if request.file_types and file_data["type"] not in request.file_types:
                continue
            # 应用分类过滤器
            if request.categories and file_data["category"] not in request.categories:
                continue
            
            filtered_files.append(file_data)

        # 转换为结果格式
        results = []
        for file_data in filtered_files:
            result_item = {
                "file_id": file_data["file_id"],
                "file_name": file_data["name"],
                "file_path": file_data["path"],
                "file_type": file_data["type"],
                "category": file_data["category"],
                "size": file_data["size"],
                "added_at": file_data["added_at"],
                "tags": file_data.get("tags", [])
            }
            results.append(result_item)

        search_time = int((time.time() - start_time) * 1000)

        logger.info(f"Filename search completed in {search_time}ms, returned {len(results)} results")

        return create_success_response(
            message="Filename search completed successfully",
            data={
                "results": results,
                "pagination": {
                    "current_page": request.page,
                    "total_pages": (total_count + request.limit - 1) // request.limit,
                    "total_count": total_count,
                    "limit": request.limit
                },
                "search_metadata": {
                    "query": request.query,
                    "total_results": len(results),
                    "search_time_ms": search_time,
                    "filters_applied": {
                        "file_types": request.file_types,
                        "categories": request.categories
                    }
                }
            }
        )

    except Exception as e:
        logger.error(f"Error in filename search: {e}")
        return create_error_response(
            message="Failed to perform filename search",
            error_code="INTERNAL_ERROR",
            error_details=str(e)
        )
