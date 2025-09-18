"""
File Management Controller
文件管理相关接口控制器
"""
import os
import shutil
import tempfile
from pathlib import Path
from typing import Dict, Any, Optional, List
from datetime import datetime
import uuid
import mimetypes
import asyncio
import json

from fastapi import APIRouter, UploadFile, File, HTTPException, Form, BackgroundTasks, Header
from pydantic import BaseModel, Field
from loguru import logger

# 导入公共工具
from commons import create_response, create_error_response, create_success_response
from i18n import detect_locale, t
# 导入配置
from config import settings
# 导入文件转换器
from file_converter_mid import FileConverterMid
from file_converter import FileConverter
# 导入文件管理器
from file_manager import FileManager, process_file_embeddings, split_text_into_chunks_improved

# 创建路由器
files_router = APIRouter(prefix="/api/files", tags=["files"])

# 请求/响应模型
class FileImportRequest(BaseModel):
    category: Optional[str] = Field(None, description="Manual category assignment")
    tags: Optional[List[str]] = Field(default_factory=list, description="Manual tags")
    auto_process: bool = Field(True, description="Auto process file (categorize, summarize, embedding)")

class FileInfo(BaseModel):
    file_id: str
    name: str
    path: str
    type: str
    size: int
    category: Optional[str] = None
    summary: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    added_at: str
    processed: bool = False

class CategorySuggestion(BaseModel):
    suggested_category: str
    confidence: float
    reason: str
    existing_category: Optional[str] = None

class FolderStructureItem(BaseModel):
    name: str = Field(..., description="Folder name, can include subdirectories like 'parent/child'")
    type: str = Field(..., description="Type of item, currently only 'folder' is supported")

class CreateFolderStructureRequest(BaseModel):
    target_folder: str = Field(..., description="Target folder path where to create the structure")
    structure: List[FolderStructureItem] = Field(..., description="List of folders to create")

class DirectoryItem(BaseModel):
    name: str = Field(..., description="Name of the file or folder")
    type: str = Field(..., description="Type: 'file' or 'folder'")
    size: Optional[int] = Field(None, description="File size in bytes (None for folders)")
    created_at: Optional[str] = Field(None, description="Creation date (ISO format)")
    modified_at: Optional[str] = Field(None, description="Last modified date (ISO format)")
    item_count: Optional[int] = Field(None, description="Number of items in folder (None for files)")

class ListDirectoryRequest(BaseModel):
    directory_path: str = Field(..., description="Path to the directory to list")

class ListDirectoryRecursiveRequest(BaseModel):
    directory_path: str = Field(..., description="Path to the directory to list recursively")
    max_depth: int = Field(3, description="Maximum depth to traverse", ge=1, le=10)

class SaveFileRequest(BaseModel):
    source_file_path: str = Field(..., description="Path of the source file to save")
    target_directory: str = Field(..., description="Target directory path")
    overwrite: bool = Field(False, description="Whether to overwrite if file exists")

class RecommendDirectoryRequest(BaseModel):
    file_path: str = Field(..., description="Path of the file to analyze")
    available_directories: List[str] = Field(..., description="List of available directory paths in the project")

class ImportToRagRequest(BaseModel):
    file_path: str = Field(..., description="Path of the file to import to RAG library")
    no_save_db: bool = Field(False, description="If true, do not save file record to database, only process embeddings")

class ChunkInfo(BaseModel):
    id: str
    file_id: str
    chunk_index: int
    content: str
    content_type: str
    char_count: int
    token_count: int
    embedding_id: str
    created_at: str

class ChunkListRequest(BaseModel):
    file_id: str = Field(..., description="File ID to get chunks for")
    page: int = Field(1, description="Page number", ge=1)
    limit: int = Field(50, description="Number of chunks per page", ge=1, le=100)

class ChunkListResponse(BaseModel):
    chunks: List[ChunkInfo]
    pagination: Dict[str, Any]

class ChunkContentResponse(BaseModel):
    id: str
    file_id: str
    chunk_index: int
    content: str
    content_type: str
    char_count: int
    token_count: int
    embedding_id: str
    created_at: str
    file_name: str
    file_path: str

class FileConvertRequest(BaseModel):
    file_path: str = Field(..., description="Path of the source file to convert")
    target_format: str = Field(..., description="Desired output format, e.g. pdf, markdown")
    output_directory: Optional[str] = Field(None, description="Absolute output directory for the converted file")
    overwrite: bool = Field(False, description="Overwrite existing output file when it exists")


class FileConvertResponse(BaseModel):
    source_file_path: str
    output_file_path: str
    output_format: str
    size: int
    message: str


class FileConversionFormatsResponse(BaseModel):
    input_formats: List[str]
    output_formats: List[str]
    default_output_directory: str
    pandoc_available: bool
    markitdown_available: bool

# 文档类型检测
DOCUMENT_EXTENSIONS = {
    '.txt', '.md', '.markdown', '.rst', '.tex',
    '.docx', '.doc', '.odt', '.rtf', '.pdf',
    '.html', '.htm', '.xhtml',
    '.pptx', '.ppt', '.odp',
    '.xlsx', '.xls', '.ods', '.csv'
}

TEXT_EXTENSIONS = {
    '.txt', '.md', '.markdown', '.rst', '.json', '.xml', '.yaml', '.yml'
}

# Initialize file manager
file_manager = FileManager()
conversion_output_dir = settings.workdir_path / 'Converted Documents'
conversion_output_dir.mkdir(parents=True, exist_ok=True)
pandoc_converter = FileConverter(settings.pandoc_path or None)

async def process_file_embeddings(file_id: str, content: str, file_path: str, category: str):
    """Process file content to generate embeddings and store in vector database"""
    try:
        # Import embedding and vector database modules
        from embedding import get_embedding_generator
        from vector_db import VectorDatabase
        from config import settings

        # Initialize components
        embedding_gen = get_embedding_generator()
        vector_db = VectorDatabase(settings.database_path / "vectors", dimension=384)

        # Initialize vector database if not loaded
        if not vector_db.initialize():
            raise Exception("Failed to initialize vector database")

        # Split content into chunks using improved method (similar to chinese_rag.py)
        chunks = split_text_into_chunks_improved(content, max_length=512)

        if not chunks:
            logger.warning(f"No content chunks generated for file: {file_id}")
            return

        logger.info(f"Processing {len(chunks)} chunks for file: {file_id}")

        # Generate embeddings for all chunks
        embeddings_data = []
        for i, chunk in enumerate(chunks):
            try:
                # Generate embedding for single chunk
                embedding = embedding_gen.generate_embedding(chunk)
                if embedding is None:
                    logger.warning(f"Failed to generate embedding for chunk {i} of file: {file_id}")
                    continue

                embedding_id = f"{file_id}_chunk_{i}"

                embeddings_data.append({
                    "embedding_id": embedding_id,
                    "embedding": embedding,
                    "metadata": {}  # 向量数据库中不再存储metadata，只存储embedding_id用于关联
                })

            except Exception as chunk_error:
                logger.error(f"Error processing chunk {i} for file {file_id}: {chunk_error}")
                continue

        # Store embeddings in vector database
        if embeddings_data:
            success_count = vector_db.add_embeddings_batch(embeddings_data)
            logger.info(f"Successfully stored {success_count}/{len(embeddings_data)} embeddings for file: {file_id}")
        else:
            logger.warning(f"No embeddings generated for file: {file_id}")

        # Store chunks metadata in SQLite database only
        try:
            from database import DatabaseManager
            db_manager = DatabaseManager()

            chunks_data = []
            for i, chunk in enumerate(chunks):
                chunk_data = {
                    'chunk_id': f"{file_id}_chunk_{i}",
                    'file_id': file_id,
                    'chunk_index': i,
                    'content': chunk,
                    'content_type': 'text',
                    'char_count': len(chunk),
                    'token_count': len(chunk.split()),
                    'embedding_id': f"{file_id}_chunk_{i}",
                    'file_path': file_path,
                    'category': category,
                    'created_at': datetime.now().isoformat()
                }
                chunks_data.append(chunk_data)

            # Save chunks to database
            saved_chunks_count = db_manager.insert_file_chunks(chunks_data)
            logger.info(f"Successfully stored {saved_chunks_count}/{len(chunks_data)} chunks metadata in SQLite database")

        except Exception as db_error:
            logger.error(f"Failed to save chunks metadata to SQLite database: {db_error}")

        # Update file record to mark as processed
        try:
            from database import DatabaseManager
            db_manager = DatabaseManager()
            logger.info(f"File embedding processing completed for: {file_id}")

        except Exception as e:
            logger.error(f"Failed to update file processing status: {e}")

    except Exception as e:
        logger.error(f"Error processing file embeddings: {e}")
        raise

def split_text_into_chunks_improved(text: str, max_length: int = 512) -> List[str]:
    """改进的文本分片方法，基于句子分割，避免破坏句子结构"""
    if not text:
        return []

    if len(text) <= max_length:
        return [text]

    chunks = []
    sentences = []

    # 按句子分割
    sentence_endings = ['。', '！', '？', '；', '\n']
    current_sentence = ""

    for char in text:
        current_sentence += char
        if char in sentence_endings:
            sentences.append(current_sentence.strip())
            current_sentence = ""

    # 如果还有剩余内容
    if current_sentence.strip():
        sentences.append(current_sentence.strip())

    # 合并句子到chunks
    current_chunk = ""
    for sentence in sentences:
        if len(current_chunk) + len(sentence) <= max_length:
            current_chunk += sentence
        else:
            if current_chunk:
                chunks.append(current_chunk.strip())
            current_chunk = sentence

    if current_chunk:
        chunks.append(current_chunk.strip())

    return [chunk for chunk in chunks if chunk]

# FileManager类的实例
file_manager = FileManager()
conversion_output_dir = settings.workdir_path / 'Converted Documents'
conversion_output_dir.mkdir(parents=True, exist_ok=True)
pandoc_converter = FileConverter(settings.pandoc_path or None)

@files_router.get("/")
async def files_root():
    """Files API root - show available endpoints"""
    return create_success_response(
        message="File Management API",
        data={
            "endpoints": {
                "GET /api/files/": "Show this information",
                "GET /api/files/health": "Health check for file management service",
                "POST /api/files/import": "Import file to workspace",
                "POST /api/files/list": "Get paginated file list with filters",
                "GET /api/files/{file_id}": "Get file details (not implemented yet)",
                "POST /api/files/delete": "Delete file (not implemented yet)",
                "POST /api/files/update": "Update file metadata (not implemented yet)"
            },
            "supported_formats": list(DOCUMENT_EXTENSIONS),
            "text_formats": list(TEXT_EXTENSIONS)
        }
    )

@files_router.get("/health")
async def health_check():
    """Health check for file management service"""
    try:
        # Check if directories exist and are accessible
        workdir_accessible = settings.workdir_path.exists() and settings.workdir_path.is_dir()
        temp_accessible = file_manager.temp_dir.exists() and file_manager.temp_dir.is_dir()
        
        # Count existing categories
        categories = file_manager.get_workdir_categories()
        
        return create_success_response(
            message="File management service is healthy",
            data={
                "workdir_accessible": workdir_accessible,
                "temp_accessible": temp_accessible,
                "categories_count": len(categories),
                "categories": categories,
                "workdir_path": str(settings.workdir_path),
                "temp_path": str(file_manager.temp_dir)
            }
        )
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return create_error_response(
            message="File management service health check failed",
            error_code="HEALTH_CHECK_FAILED",
            error_details=str(e)
        )

class FileImportRequestBody(BaseModel):
    file_path: str = Field(..., description="Local file path to import")
    category: Optional[str] = Field(None, description="Manual category assignment")
    tags: Optional[List[str]] = Field(default_factory=list, description="Manual tags")
    auto_process: bool = Field(True, description="Auto process file (categorize, summarize, embedding)")
    directory_structure: Optional[List[Dict[str, str]]] = Field(None, description="Directory structure for contextual categorization")

@files_router.post("/import", 
    summary="Import file to workspace",
    description="""
    Import a file from local path to the workspace with automatic categorization.
    
    **Steps performed:**
    1. Copy file from local path to workdir/temp
    2. Check if it's a document type (word, txt, markdown, ppt, html, etc.)
    3. Convert document to markdown format if applicable
    4. Get current workdir directory list
    5. Use LLM to suggest category based on filename and content
    6. Move file to appropriate category directory or create new one
    
    **Supported file types:**
    - Documents: .txt, .md, .docx, .doc, .pdf, .rtf, .odt
    - Presentations: .pptx, .ppt, .odp
    - Spreadsheets: .xlsx, .xls, .csv, .ods
    - Web: .html, .htm, .xhtml
    - Other text: .rst, .tex, .json, .xml, .yaml, .yml
    """,
    responses={
        200: {"description": "File imported successfully"},
        400: {"description": "Bad request - file not found or too large"},
        500: {"description": "Server error during file processing"}
    }
)
async def import_file(request: FileImportRequestBody):
    """Import file from local path to workspace with automatic categorization"""
    try:
        # 获取数据库管理器实例（避免循环导入）
        from database import DatabaseManager
        db_manager = DatabaseManager()
        
        # Validate file path
        source_file_path = Path(request.file_path)
        if not source_file_path.exists():
            raise HTTPException(status_code=400, detail=f"File not found: {request.file_path}")
        
        if not source_file_path.is_file():
            raise HTTPException(status_code=400, detail=f"Path is not a file: {request.file_path}")
        
        # Check file size
        max_size_bytes = settings.max_file_size_mb * 1024 * 1024
        file_size = source_file_path.stat().st_size
        
        if file_size > max_size_bytes:
            raise HTTPException(
                status_code=400, 
                detail=f"File too large. Maximum size: {settings.max_file_size_mb}MB"
            )
        
        # Get file info
        filename = source_file_path.name
        file_tags = request.tags
        
        # Check if it's a document type
        is_document = file_manager.is_document_type(source_file_path)
        
        logger.info(f"Processing file: {filename}, size: {file_size} bytes, is_document: {is_document}")

        # Get existing categories for LLM analysis
        existing_categories = file_manager.get_workdir_categories()
        
        # For content analysis, we need to get a preview first
        markdown_content = None
        if file_manager.is_text_file(source_file_path):
            # For text files, read content for analysis
            try:
                with open(source_file_path, 'r', encoding='utf-8') as f:
                    markdown_content = f.read()[:2000]  # Preview for analysis
            except Exception as e:
                logger.warning(f"Could not read file for content analysis: {e}")
        elif is_document:
            # For other document types, try to convert for analysis
            try:
                success, content = file_manager.converter.convert_to_markdown(str(source_file_path), None)
                if success and content:
                    markdown_content = content[:2000]
            except Exception as e:
                logger.warning(f"Could not convert document for content analysis: {e}")
        
        # Determine final category
        final_category = request.category
        category_suggestion = None
        
        if request.auto_process and not request.category:
            # Use LLM to suggest category
            content_for_analysis = markdown_content or ""
            category_suggestion = await file_manager.suggest_category_with_llm(
                filename, 
                content_for_analysis, 
                existing_categories,
                request.directory_structure
            )
            final_category = category_suggestion.suggested_category
        
        if not final_category:
            final_category = "Uncategorized"
        
        # Create category directory if it doesn't exist
        if category_suggestion and not category_suggestion.existing_category:
            file_manager.create_category_directory(final_category)
        elif final_category not in existing_categories:
            file_manager.create_category_directory(final_category)
        
        # Convert and save file directly to category directory
        final_file_path, full_markdown_content = file_manager.convert_and_save_to_category(
            source_file_path, 
            final_category, 
            filename
        )
        
        # Create file info response
        final_file_size = final_file_path.stat().st_size
        file_info = FileInfo(
            file_id=str(uuid.uuid4()),
            name=final_file_path.name,  # Use the actual saved filename (with .md extension)
            path=str(final_file_path.relative_to(settings.workdir_path)),
            type="text/markdown",  # Always markdown now
            size=final_file_size,  # Size of the converted file
            category=final_category,
            summary=f"Converted from {filename} and imported from {request.file_path}" + (
                f" - {category_suggestion.reason}" if category_suggestion else ""
            ),
            tags=file_tags,
            added_at=datetime.now().isoformat(),
            processed=True
        )
        
        # Save file record to database
        try:
            file_db_info = {
                'file_id': file_info.file_id,
                'path': file_info.path,
                'name': file_info.name,
                'type': file_info.type,
                'category': file_info.category,
                'summary': file_info.summary,
                'tags': file_info.tags,
                'size': file_info.size,
                'added_at': file_info.added_at,
                'processed': file_info.processed
            }
            
            db_id = db_manager.insert_file(file_db_info)
            logger.info(f"File record saved to database with ID: {db_id}")
            
        except Exception as db_error:
            logger.error(f"Failed to save file record to database: {db_error}")
            # Continue execution - don't fail the entire import due to database error
        
        # Auto process: Generate embeddings and store in vector database
        if request.auto_process and full_markdown_content:
            try:
                await process_file_embeddings(
                    file_id=file_info.file_id,
                    content=full_markdown_content,
                    file_path=str(final_file_path),
                    category=final_category
                )
                logger.info(f"File embeddings processed successfully: {file_info.file_id}")
                
            except Exception as embed_error:
                logger.error(f"Failed to process file embeddings: {embed_error}")
                # Continue execution - don't fail the entire import due to embedding error
        
        logger.info(f"File imported and converted successfully: {filename} -> {final_category}/{final_file_path.name}")
        
        return create_success_response(
            message="File imported and converted to markdown successfully",
            data=file_info.model_dump()
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error importing file: {e}")
        
        return create_error_response(
            message="Failed to import file",
            error_code="FILE_PROCESSING_FAILED",
            error_details=str(e)
        )

class FileListRequest(BaseModel):
    page: int = Field(1, ge=1, description="Page number")
    limit: int = Field(20, ge=1, le=100, description="Items per page")
    category: Optional[str] = Field(None, description="Filter by category (fuzzy search)")
    type: Optional[str] = Field(None, description="Filter by file type")
    search: Optional[str] = Field(None, description="Search in filename")
    tags: Optional[List[str]] = Field(default_factory=list, description="Filter by tags")
    sort_by: Optional[str] = Field(None, description="Sort by field: name, size, added_at")
    sort_order: Optional[str] = Field("desc", description="Sort order: asc or desc")

@files_router.post("/list", 
    summary="Get file list with filtering",
    description="Retrieve paginated list of files with optional filtering by category, type, or search query",
    responses={
        200: {"description": "File list retrieved successfully"},
        500: {"description": "Server error during file listing"}
    }
)
async def list_files(request: FileListRequest):
    """Get file list with filtering and pagination"""
    try:
        # 获取数据库管理器实例
        from database import DatabaseManager
        db_manager = DatabaseManager()
        
        page = request.page
        limit = request.limit
        category_filter = request.category
        type_filter = request.type
        search_query = request.search
        sort_by = request.sort_by
        sort_order = request.sort_order
        
        # Get files from database with filtering and pagination
        files_data, total_count = db_manager.list_files(
            page=page,
            limit=limit,
            category=category_filter,
            type=type_filter,
            search=search_query,
            sort_by=sort_by,
            sort_order=sort_order
        )
        
        # Convert database format to API response format
        files_response = []
        for file_data in files_data:
            file_info = {
                "file_id": file_data["file_id"],
                "name": file_data["name"],
                "path": file_data["path"],
                "type": file_data["type"],
                "category": file_data["category"],
                "summary": file_data["summary"],
                "tags": file_data["tags"],  # Already parsed from JSON by DatabaseManager
                "size": file_data["size"],
                "added_at": file_data["added_at"],
                "updated_at": file_data.get("updated_at"),
                "processed": file_data["processed"]
            }
            files_response.append(file_info)
        
        total_pages = (total_count + limit - 1) // limit
        
        return create_success_response(
            message="File list retrieved successfully",
            data={
                "files": files_response,
                "pagination": {
                    "current_page": page,
                    "total_pages": total_pages,
                    "total_count": total_count,
                    "limit": limit
                }
            }
        )
        
    except Exception as e:
        logger.error(f"Error listing files: {e}")
        return create_error_response(
            message="Failed to list files",
            error_code="INTERNAL_ERROR",
            error_details=str(e)
        )

@files_router.get("/{file_id}",
    summary="Get file details by ID",
    description="Retrieve detailed information about a specific file by its file_id",
    responses={
        200: {"description": "File details retrieved successfully"},
        404: {"description": "File not found"},
        500: {"description": "Server error during file retrieval"}
    }
)
async def get_file_by_id(file_id: str):
    """Get file details by file_id"""
    try:
        # 获取数据库管理器实例
        from database import DatabaseManager
        db_manager = DatabaseManager()
        
        # Get file from database
        file_data = db_manager.get_file_by_id(file_id)
        
        if not file_data:
            raise HTTPException(status_code=404, detail=f"File not found: {file_id}")
        
        # Convert database format to API response format
        file_info = {
            "file_id": file_data["file_id"],
            "name": file_data["name"],
            "path": file_data["path"],
            "type": file_data["type"],
            "category": file_data["category"],
            "summary": file_data["summary"],
            "tags": file_data["tags"],  # Already parsed from JSON
            "size": file_data["size"],
            "added_at": file_data["added_at"],
            "updated_at": file_data.get("updated_at"),
            "processed": file_data["processed"]
        }
        
        return create_success_response(
            message="File details retrieved successfully",
            data=file_info
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting file by ID {file_id}: {e}")
        return create_error_response(
            message="Failed to get file details",
            error_code="INTERNAL_ERROR",
            error_details=str(e)
        )

# 请求模型
class FileDeleteRequest(BaseModel):
    file_id: str = Field(..., description="ID of the file to delete")

class FileUpdateRequest(BaseModel):
    file_id: str = Field(..., description="ID of the file to update")
    category: Optional[str] = Field(None, description="New category for the file")
    tags: Optional[List[str]] = Field(None, description="New tags for the file")
    summary: Optional[str] = Field(None, description="New summary for the file")

@files_router.post("/delete",
    summary="Delete file",
    description="Delete a file and all its associated chunks and embeddings",
    responses={
        200: {"description": "File deleted successfully"},
        404: {"description": "File not found"},
        500: {"description": "Server error during file deletion"}
    }
)
async def delete_file(request: FileDeleteRequest):
    """Delete file by file_id"""
    try:
        file_id = request.file_id
        
        # 获取数据库管理器实例
        from database import DatabaseManager
        db_manager = DatabaseManager()
        
        # 获取向量数据库管理器实例
        from vector_db import VectorDatabase
        vector_db_manager = VectorDatabase(settings.database_path)
        
        # 检查文件是否存在
        file_data = db_manager.get_file_by_id(file_id)
        if not file_data:
            raise HTTPException(status_code=404, detail=f"File not found: {file_id}")
        
        # 删除向量数据库中的embeddings
        # 从 SQLite 获取该文件的所有 chunks，然后删除对应的 embeddings
        chunks = db_manager.get_chunks_by_file_id(file_id)
        deleted_embeddings = 0
        for chunk in chunks:
            embedding_id = chunk.get("embedding_id")
            if embedding_id and vector_db_manager.delete_embedding(embedding_id):
                deleted_embeddings += 1
        
        # 删除数据库中的文件记录
        deleted_from_db = db_manager.delete_file(file_id)
        
        if deleted_from_db:
            return create_success_response(
                message="File deleted successfully",
                data={
                    "deleted_file_id": file_id,
                    "deleted_chunks_count": deleted_embeddings,
                    "file_name": file_data["name"]
                }
            )
        else:
            return create_error_response(
                message="Failed to delete file from database",
                error_code="INTERNAL_ERROR"
            )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting file {request.file_id}: {e}")
        return create_error_response(
            message="Failed to delete file",
            error_code="INTERNAL_ERROR",
            error_details=str(e)
        )

@files_router.post("/update",
    summary="Update file metadata",
    description="Update file category, tags, and summary",
    responses={
        200: {"description": "File updated successfully"},
        400: {"description": "Invalid request parameters"},
        404: {"description": "File not found"},
        500: {"description": "Server error during file update"}
    }
)
async def update_file(request: FileUpdateRequest):
    """Update file metadata"""
    try:
        file_id = request.file_id
        
        # 验证至少提供了一个更新字段
        updates = {}
        if request.category is not None:
            updates["category"] = request.category
        if request.tags is not None:
            updates["tags"] = request.tags
        if request.summary is not None:
            updates["summary"] = request.summary
        
        if not updates:
            return create_error_response(
                message="At least one field must be provided for update",
                error_code="INVALID_REQUEST"
            )
        
        # 获取数据库管理器实例
        from database import DatabaseManager
        db_manager = DatabaseManager()
        
        # 检查文件是否存在
        file_data = db_manager.get_file_by_id(file_id)
        if not file_data:
            raise HTTPException(status_code=404, detail=f"File not found: {file_id}")
        
        # 更新文件信息
        updated = db_manager.update_file(file_id, updates)
        
        if updated:
            # 获取更新后的文件信息
            updated_file_data = db_manager.get_file_by_id(file_id)
            
            return create_success_response(
                message="File updated successfully",
                data={
                    "file_id": updated_file_data["file_id"],
                    "name": updated_file_data["name"],
                    "category": updated_file_data["category"],
                    "tags": updated_file_data["tags"],
                    "summary": updated_file_data["summary"],
                    "updated_at": updated_file_data.get("updated_at")
                }
            )
        else:
            return create_error_response(
                message="Failed to update file",
                error_code="INTERNAL_ERROR"
            )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating file {request.file_id}: {e}")
        return create_error_response(
            message="Failed to update file",
            error_code="INTERNAL_ERROR",
            error_details=str(e)
        )

@files_router.post("/create-folders",
    summary="Create folder structure",
    description="""
    Create a folder structure in the specified target directory.
    
    **Parameters:**
    - target_folder: The base directory where folders will be created
    - structure: List of folder items with name and type
    
    **Example structure:**
    [
        {"name": "Documents", "type": "folder"},
        {"name": "Documents/Work", "type": "folder"},
        {"name": "Images", "type": "folder"}
    ]
    """,
    responses={
        200: {"description": "Folders created successfully"},
        400: {"description": "Invalid request parameters"},
        500: {"description": "Server error during folder creation"}
    }
)
async def create_folder_structure(request: CreateFolderStructureRequest, accept_language: str | None = Header(None)):
    """Create folder structure in target directory"""
    locale = detect_locale(accept_language)
    try:
        if not request.target_folder or not request.target_folder.strip():
            return create_error_response(
                message=t('backend.files.create.invalidTarget', locale=locale),
                error_code="INVALID_REQUEST"
            )

        if not request.structure:
            return create_error_response(
                message=t('backend.files.create.emptyStructure', locale=locale),
                error_code="INVALID_REQUEST"
            )

        success, details_message = file_manager.create_folder_structure(
            request.target_folder,
            [item.model_dump() for item in request.structure]
        )

        if success:
            return create_success_response(
                message=t('backend.files.create.success', locale=locale),
                data={
                    "target_folder": request.target_folder,
                    "folders_created": len(request.structure),
                    "details": details_message
                }
            )

        return create_error_response(
            message=t('backend.files.create.failure', locale=locale),
            error_code="INTERNAL_ERROR",
            error_details=details_message
        )

    except Exception as error:
        logger.error(f"Error creating folder structure: {error}")
        return create_error_response(
            message=t('backend.files.create.failure', locale=locale),
            error_code="INTERNAL_ERROR",
            error_details=str(error)
        )

@files_router.post("/list-directory",
    summary="List directory structure",
    description="""
    List the contents of a directory including files and subdirectories.
    
    **Parameters:**
    - directory_path: Path to the directory to list
    
    **Returns:**
    List of items with name and type (file/folder)
    """,
    responses={
        200: {"description": "Directory contents retrieved successfully"},
        400: {"description": "Invalid directory path"},
        500: {"description": "Server error during directory listing"}
    }
)
async def list_directory(request: ListDirectoryRequest):
    """List directory structure including files and folders"""
    try:
        # Validate directory path
        if not request.directory_path or not request.directory_path.strip():
            return create_error_response(
                message="Directory path is required",
                error_code="INVALID_REQUEST"
            )
        
        # List directory structure
        structure = file_manager.list_directory_structure(request.directory_path)
        
        return create_success_response(
            message=f"Successfully listed directory contents",
            data={
                "directory_path": request.directory_path,
                "items": structure,
                "total_count": len(structure)
            }
        )
            
    except Exception as e:
        logger.error(f"Error listing directory: {e}")
        return create_error_response(
            message="Failed to list directory contents",
            error_code="INTERNAL_ERROR",
            error_details=str(e)
        )

@files_router.post("/list-directory-recursive",
    summary="List directory structure recursively",
    description="""
    List the complete directory structure recursively with depth limit.
    
    **Parameters:**
    - directory_path: Path to the directory to list recursively
    - max_depth: Maximum depth to traverse (1-10, default 3)
    
    **Returns:**
    Tree structure with nested children, sizes, and timestamps
    """,
    responses={
        200: {"description": "Directory tree retrieved successfully"},
        400: {"description": "Invalid directory path or depth"},
        500: {"description": "Server error during directory traversal"}
    }
)
async def list_directory_recursive(request: ListDirectoryRecursiveRequest):
    """List directory structure recursively with depth limit"""
    try:
        # Validate max_depth
        if request.max_depth < 1 or request.max_depth > 10:
            return create_error_response(
                message="max_depth must be between 1 and 10",
                error_code="INVALID_REQUEST"
            )
        
        # Validate directory path
        if not request.directory_path or not request.directory_path.strip():
            return create_error_response(
                message="Directory path is required",
                error_code="INVALID_REQUEST"
            )
        
        # Build recursive directory list
        items = file_manager.list_directory_structure_recursive(
            request.directory_path, 
            request.max_depth
        )
        
        return create_success_response(
            message=f"Successfully listed directory contents with max depth {request.max_depth}",
            data={
                "directory_path": request.directory_path,
                "max_depth": request.max_depth,
                "items": items,
                "total_count": len(items)
            }
        )
            
    except Exception as e:
        logger.error(f"Error listing directory recursively: {e}")
        return create_error_response(
            message="Failed to list directory tree",
            error_code="INTERNAL_ERROR",
            error_details=str(e)
        )


class FilePreviewRequest(BaseModel):
    file_path: str = Field(..., description="Full path to the file to preview")


@files_router.post("/preview",
    summary="Get file preview content",
    description="""Get preview content for text and image files.
    
    Supports text files (.txt, .md, .json, .py, .js, .ts, .html, .css, etc.) 
    and image files (.jpg, .jpeg, .png, .gif, .bmp, .webp, etc.)
    
    For text files, returns the first 10KB of content.
    For images, returns base64 encoded data.
    """,
    responses={
        200: {"description": "File preview retrieved successfully"},
        400: {"description": "Invalid file path or unsupported file type"},
        404: {"description": "File not found"},
        500: {"description": "Server error during file preview"}
    }
)
async def preview_file(request: FilePreviewRequest):
    """Get file preview content for supported file types"""
    try:
        # Validate file path
        if not request.file_path or not request.file_path.strip():
            return create_error_response(
                message="File path is required",
                error_code="INVALID_REQUEST"
            )
        
        file_path = Path(request.file_path)
        
        # Check if file exists
        if not file_path.exists():
            return create_error_response(
                message="File not found",
                error_code="FILE_NOT_FOUND"
            )
        
        # Check if it's a file (not directory)
        if not file_path.is_file():
            return create_error_response(
                message="Path is not a file",
                error_code="INVALID_FILE_TYPE"
            )
        
        # Get file extension and MIME type
        file_extension = file_path.suffix.lower()
        mime_type, _ = mimetypes.guess_type(str(file_path))
        
        # Supported text file extensions
        text_extensions = {'.txt', '.md', '.markdown', '.json', '.py', '.js', '.ts', '.html', '.css', 
                          '.xml', '.yaml', '.yml', '.ini', '.cfg', '.conf', '.log', '.sh', '.bat', 
                          '.ps1', '.sql', '.csv', '.rtf'}
        
        # Supported image extensions
        image_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'}
        
        if file_extension in text_extensions or (mime_type and mime_type.startswith('text/')):
            # Text file preview with multiple encoding attempts
            encodings_to_try = ['utf-8', 'gbk', 'gb2312', 'utf-16', 'latin-1']
            
            content = None
            used_encoding = None
            
            for encoding in encodings_to_try:
                try:
                    with open(file_path, 'r', encoding=encoding) as f:
                        content = f.read(10240)  # Read first 10KB
                        used_encoding = encoding
                        break
                except UnicodeDecodeError:
                    continue
            
            if content is None:
                return create_error_response(
                    message="文件编码不受支持，无法预览。请尝试使用系统默认程序打开文件。",
                    error_code="UNSUPPORTED_ENCODING"
                )
            
            truncated = len(content) >= 10240
            
            return create_success_response(
                message="Text file preview retrieved successfully",
                data={
                    "file_path": str(file_path),
                    "file_type": "text",
                    "mime_type": mime_type,
                    "content": content,
                    "truncated": truncated,
                    "size": file_path.stat().st_size,
                    "encoding": used_encoding
                }
            )
                
        elif file_extension in image_extensions or (mime_type and mime_type.startswith('image/')):
            # Image file preview
            try:
                import base64
                
                with open(file_path, 'rb') as f:
                    image_data = f.read()
                    base64_data = base64.b64encode(image_data).decode('utf-8')
                
                return create_success_response(
                    message="Image file preview retrieved successfully",
                    data={
                        "file_path": str(file_path),
                        "file_type": "image",
                        "mime_type": mime_type,
                        "content": f"data:{mime_type};base64,{base64_data}",
                        "size": file_path.stat().st_size
                    }
                )
                
            except Exception as e:
                return create_error_response(
                    message="Failed to process image file",
                    error_code="IMAGE_PROCESSING_ERROR",
                    error_details=str(e)
                )
        
        else:
            return create_error_response(
                message=f"File type not supported for preview. Supported: text files and images. Extension: {file_extension}, MIME: {mime_type}",
                error_code="UNSUPPORTED_FILE_TYPE"
            )
            
    except Exception as e:
        logger.error(f"Error previewing file: {e}")
        return create_error_response(
            message="Failed to preview file",
            error_code="INTERNAL_ERROR",
            error_details=str(e)
        )

@files_router.post("/save-file")
async def save_file(request: SaveFileRequest):
    """Save file to specified directory"""
    try:
        target_path = Path(request.target_directory)
        if not target_path.is_absolute():
            return create_error_response(
                message="目标目录必须是完整的绝对路径",
                error_code="INVALID_PATH",
                error_details=f"提供的路径不是绝对路径: {request.target_directory}"
            )

        copy_result = file_manager.save_file_to_directory(
            source_file_path=request.source_file_path,
            target_directory=request.target_directory,
            overwrite=request.overwrite
        )

        if not copy_result.get("success", False):
            return copy_result

        data = copy_result.get("data") or {}
        saved_path_str = data.get("saved_path")
        if not saved_path_str:
            return create_error_response(
                message="Failed to locate saved file",
                error_code="SAVE_FILE_ERROR"
            )

        saved_path = Path(saved_path_str)

        relative_path = data.get("relative_path")
        inside_workdir = False
        if relative_path:
            inside_workdir = True
        else:
            try:
                relative_path = str(saved_path.relative_to(settings.workdir_path))
                inside_workdir = True
            except Exception:
                relative_path = str(saved_path)

        category = None
        if inside_workdir:
            parts = Path(relative_path).parts
            category = parts[0] if parts else "Uncategorized"
        else:
            category = "External"
        category = category or "Uncategorized"

        mime_type = data.get("mime_type") or mimetypes.guess_type(saved_path_str)[0] or "application/octet-stream"
        size = data.get("size") or saved_path.stat().st_size

        file_id = str(uuid.uuid4())
        summary = f"Imported file from {request.source_file_path}"
        processed = False

        from database import DatabaseManager
        db_manager = DatabaseManager()
        try:
            db_manager.insert_file({
                'file_id': file_id,
                'path': str(saved_path),
                'name': saved_path.name,
                'type': mime_type,
                'category': category,
                'summary': summary,
                'tags': [],
                'size': size,
                'added_at': datetime.now().isoformat(),
                'processed': False
            })
        except Exception as db_error:
            logger.error(f"Failed to record file in database: {db_error}")
            return create_error_response(
                message="Failed to record file metadata",
                error_code="DATABASE_ERROR",
                error_details=str(db_error)
            )

        markdown_path = data.get("temp_markdown_path")
        markdown_content = None
        if markdown_path:
            try:
                with open(markdown_path, 'r', encoding='utf-8') as temp_file:
                    markdown_content = temp_file.read()
            except Exception as read_error:
                logger.warning(f"Failed to read temp markdown file {markdown_path}: {read_error}")

        if markdown_content:
            try:
                await process_file_embeddings(
                    file_id=file_id,
                    content=markdown_content,
                    file_path=str(saved_path),
                    category=category
                )
                processed = True
                try:
                    db_manager.update_file(file_id, {"processed": True})
                except Exception as update_error:
                    logger.warning(f"Failed to mark file as processed: {update_error}")
            except Exception as embed_error:
                logger.error(f"Failed to process embeddings for {file_id}: {embed_error}")

        response_data = {
            **data,
            "file_id": file_id,
            "relative_path": relative_path,
            "category": category,
            "processed": processed,
            "mime_type": mime_type,
            "size": size
        }

        return create_success_response(
            message="File saved successfully",
            data=response_data
        )

    except Exception as e:
        logger.error(f"Error in save_file endpoint: {e}")
        return create_error_response(
            message="Internal server error",
            error_code="INTERNAL_ERROR",
            error_details=str(e)
        )
@files_router.post("/recommend-directory")
async def recommend_directory(request: RecommendDirectoryRequest):
    """Analyze file and recommend the best directory to save it"""
    try:
        result = await file_manager.recommend_directory(
            file_path=request.file_path,
            available_directories=request.available_directories
        )
        return result
        
    except Exception as e:
        logger.error(f"Error in recommend_directory endpoint: {e}")
        return create_error_response(
            message="Internal server error",
            error_code="INTERNAL_ERROR",
            error_details=str(e)
        )

@files_router.post("/import-to-rag")
async def import_to_rag(request: ImportToRagRequest):
    """Import file to RAG library for semantic search"""
    try:
        result = await file_manager.import_to_rag(file_path=request.file_path, no_save_db=request.no_save_db)
        return result
        
    except Exception as e:
        logger.error(f"Error in import_to_rag endpoint: {e}")
        return create_error_response(
            message="Internal server error",
            error_code="INTERNAL_ERROR",
            error_details=str(e)
        )

@files_router.get("/convert/formats")
async def get_conversion_formats():
    """Retrieve supported file conversion formats."""
    try:
        markitdown_available = True
        try:
            markitdown_formats = set(file_manager.converter.get_supported_formats())
        except Exception as converter_error:
            markitdown_available = False
            markitdown_formats = set()
            logger.warning(f"MarkItDown format discovery failed: {converter_error}")
        pandoc_available, pandoc_status = pandoc_converter.check_pandoc_availability()
        input_formats = sorted(set(FileConverter.FILE_TYPE_MAPPING.keys()).union(markitdown_formats))
        output_formats = set(FileConverter.PANDOC_FORMAT_MAPPING.keys())
        output_formats.update({'markdown', 'md'})
        response = FileConversionFormatsResponse(
            input_formats=input_formats,
            output_formats=sorted(output_formats),
            default_output_directory=str(conversion_output_dir),
            pandoc_available=pandoc_available,
            markitdown_available=markitdown_available
        )
        if not pandoc_available:
            logger.warning(f"Pandoc availability check failed: {pandoc_status}")
        return create_success_response(
            message="Conversion formats retrieved successfully",
            data=response.dict()
        )
    except Exception as e:
        logger.error(f"Error retrieving conversion formats: {e}")
        return create_error_response(
            message="Failed to retrieve conversion formats",
            error_code="INTERNAL_ERROR",
            error_details=str(e)
        )


@files_router.post("/convert")
async def convert_file(request: FileConvertRequest):
    """Convert a file into the specified format."""
    try:
        input_path = Path(request.file_path).expanduser()
        if not input_path.exists() or not input_path.is_file():
            return create_error_response(
                message="Source file not found",
                error_code="RESOURCE_NOT_FOUND",
                error_details=request.file_path
            )

        normalized_format = request.target_format.strip().lower()
        if not normalized_format:
            return create_error_response(
                message="Target format is required",
                error_code="INVALID_REQUEST"
            )

        if normalized_format.startswith('.'):
            normalized_format = normalized_format[1:]

        output_dir = Path(request.output_directory).expanduser() if request.output_directory else conversion_output_dir
        if not output_dir.is_absolute():
            return create_error_response(
                message="Output directory must be an absolute path",
                error_code="INVALID_PATH",
                error_details=str(output_dir)
            )

        output_dir.mkdir(parents=True, exist_ok=True)

        extension_map = {'markdown': 'md', 'md': 'md', 'plain': 'txt'}
        output_extension = extension_map.get(normalized_format, normalized_format)
        output_path = output_dir / f"{input_path.stem}.{output_extension}"

        if output_path.exists() and not request.overwrite:
            return create_error_response(
                message="Output file already exists",
                error_code="FILE_EXISTS",
                error_details=str(output_path)
            )

        if normalized_format in {'md', 'markdown'}:
            def run_conversion():
                return file_manager.converter.convert_to_markdown(str(input_path), str(output_path))
        else:
            if normalized_format not in FileConverter.PANDOC_FORMAT_MAPPING:
                return create_error_response(
                    message="Target format is not supported",
                    error_code="UNSUPPORTED_FORMAT",
                    error_details=normalized_format
                )

            pandoc_available, pandoc_status = pandoc_converter.check_pandoc_availability()
            if not pandoc_available:
                logger.error(f"Pandoc is not available: {pandoc_status}")
                return create_error_response(
                    message="Pandoc is not available on this system",
                    error_code="PANDOC_NOT_AVAILABLE",
                    error_details=pandoc_status
                )

            def run_conversion():
                return pandoc_converter.convert_file(
                    str(input_path),
                    normalized_format,
                    str(output_path)
                )

        logger.info(f"Starting file conversion: {input_path} -> {output_path} ({normalized_format})")
        success, info_message = await asyncio.to_thread(run_conversion)

        if not success:
            logger.error(f"File conversion failed: {info_message}")
            return create_error_response(
                message="File conversion failed",
                error_code="CONVERSION_FAILED",
                error_details=info_message
            )

        if not output_path.exists():
            logger.error(f"Conversion succeeded but output file missing: {output_path}")
            return create_error_response(
                message="Converted file was not created",
                error_code="CONVERSION_FAILED",
                error_details=str(output_path)
            )

        size = output_path.stat().st_size
        response = FileConvertResponse(
            source_file_path=str(input_path),
            output_file_path=str(output_path),
            output_format=output_extension,
            size=size,
            message=info_message
        )

        return create_success_response(
            message="File converted successfully",
            data=response.dict()
        )

    except Exception as e:
        logger.error(f"Error during file conversion: {e}")
        return create_error_response(
            message="Internal server error",
            error_code="INTERNAL_ERROR",
            error_details=str(e)
        )


@files_router.post("/chunks/list")
async def list_chunks(request: ChunkListRequest):
    """Get chunks list for a file"""
    try:
        from database import DatabaseManager
        db_manager = DatabaseManager()
        
        # Get chunks with pagination
        chunks = db_manager.get_chunks_by_file_id_paginated(
            file_id=request.file_id,
            page=request.page,
            limit=request.limit
        )
        
        # Get total count
        total_count = db_manager.get_chunks_count_by_file_id(request.file_id)
        
        # Format response
        chunks_data = []
        for chunk in chunks:
            chunks_data.append(ChunkInfo(
                id=chunk['chunk_id'],
                file_id=chunk['file_id'],
                chunk_index=chunk['chunk_index'],
                content=chunk['content'][:200] + "..." if len(chunk['content']) > 200 else chunk['content'],  # Truncate for list view
                content_type=chunk['content_type'],
                char_count=chunk['char_count'],
                token_count=chunk['token_count'],
                embedding_id=chunk['embedding_id'],
                created_at=chunk['created_at']
            ))
        
        pagination = {
            "current_page": request.page,
            "total_pages": (total_count + request.limit - 1) // request.limit,
            "total_count": total_count,
            "limit": request.limit
        }
        
        return create_success_response(
            data=ChunkListResponse(
                chunks=chunks_data,
                pagination=pagination
            ).dict()
        )
        
    except Exception as e:
        logger.error(f"Error in list_chunks endpoint: {e}")
        return create_error_response(
            message="Internal server error",
            error_code="INTERNAL_ERROR",
            error_details=str(e)
        )

@files_router.get("/chunks/{chunk_id}")
async def get_chunk_content(chunk_id: str):
    """Get full content of a specific chunk"""
    try:
        from database import DatabaseManager
        db_manager = DatabaseManager()
        
        # Get chunk by ID
        chunk = db_manager.get_chunk_by_id(chunk_id)
        if not chunk:
            return create_error_response(
                message="Chunk not found",
                error_code="RESOURCE_NOT_FOUND"
            )
        
        # Get file info
        file_info = db_manager.get_file_by_id(chunk['file_id'])
        if not file_info:
            return create_error_response(
                message="File not found",
                error_code="RESOURCE_NOT_FOUND"
            )
        
        # Format response
        response_data = ChunkContentResponse(
            id=chunk['chunk_id'],
            file_id=chunk['file_id'],
            chunk_index=chunk['chunk_index'],
            content=chunk['content'],
            content_type=chunk['content_type'],
            char_count=chunk['char_count'],
            token_count=chunk['token_count'],
            embedding_id=chunk['embedding_id'],
            created_at=chunk['created_at'],
            file_name=file_info['name'],
            file_path=file_info['path']
        )
        
        return create_success_response(data=response_data.dict())
        
    except Exception as e:
        logger.error(f"Error in get_chunk_content endpoint: {e}")
        return create_error_response(
            message="Internal server error",
            error_code="INTERNAL_ERROR",
            error_details=str(e)
        )

