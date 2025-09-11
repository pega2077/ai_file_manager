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

from fastapi import APIRouter, UploadFile, File, HTTPException, Form, BackgroundTasks
from pydantic import BaseModel, Field
from loguru import logger

# 导入公共工具
from commons import create_response, create_error_response, create_success_response
# 导入配置
from config import settings
# 导入文件转换器
from file_converter import FileConverter

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

class FileManager:
    """File management helper class"""
    
    def __init__(self):
        self.converter = FileConverter()
        self.workdir = settings.workdir_path
        self.temp_dir = self.workdir / "temp"
        self._ensure_directories()
    
    def _ensure_directories(self):
        """Ensure necessary directories exist"""
        self.workdir.mkdir(parents=True, exist_ok=True)
        self.temp_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"Ensured directories: workdir={self.workdir}, temp={self.temp_dir}")
    
    def is_document_type(self, file_path: Path) -> bool:
        """Check if file is a document type"""
        extension = file_path.suffix.lower()
        return extension in DOCUMENT_EXTENSIONS
    
    def is_text_file(self, file_path: Path) -> bool:
        """Check if file is a text file that can be read directly"""
        extension = file_path.suffix.lower()
        return extension in TEXT_EXTENSIONS
    
    def save_uploaded_file(self, upload_file: UploadFile) -> Path:
        """Save uploaded file to temp directory"""
        file_id = str(uuid.uuid4())
        file_extension = Path(upload_file.filename).suffix
        temp_filename = f"{file_id}{file_extension}"
        temp_file_path = self.temp_dir / temp_filename
        
        try:
            with open(temp_file_path, "wb") as buffer:
                shutil.copyfileobj(upload_file.file, buffer)
            
            logger.info(f"File saved to temp: {temp_file_path}")
            return temp_file_path
        
        except Exception as e:
            logger.error(f"Error saving uploaded file: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to save uploaded file: {str(e)}")
    
    def copy_file_to_temp(self, source_file_path: Path) -> Path:
        """Copy local file to temp directory"""
        file_id = str(uuid.uuid4())
        file_extension = source_file_path.suffix
        temp_filename = f"{file_id}{file_extension}"
        temp_file_path = self.temp_dir / temp_filename
        
        try:
            shutil.copy2(source_file_path, temp_file_path)
            logger.info(f"File copied to temp: {source_file_path} -> {temp_file_path}")
            return temp_file_path
        
        except Exception as e:
            logger.error(f"Error copying file to temp: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to copy file to temp: {str(e)}")
    
    def convert_to_markdown(self, file_path: Path) -> Optional[str]:
        """Convert document to markdown format"""
        try:
            if self.is_text_file(file_path):
                # For text files, read directly
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # Add markdown formatting if it's plain text
                if file_path.suffix.lower() == '.txt':
                    lines = content.split('\n')
                    # Simple conversion: treat empty lines as paragraph breaks
                    markdown_content = '\n\n'.join([line for line in lines if line.strip()])
                    return markdown_content
                else:
                    return content
            
            elif self.is_document_type(file_path):
                # Use converter for other document types - create temp output file
                temp_md_path = file_path.parent / f"{file_path.stem}_temp.md"
                
                try:
                    success, message = self.converter.convert_to_markdown(str(file_path), str(temp_md_path))
                    if success and temp_md_path.exists():
                        with open(temp_md_path, 'r', encoding='utf-8') as f:
                            markdown_content = f.read()
                        # Clean up temp file
                        temp_md_path.unlink()
                        return markdown_content
                    else:
                        logger.error(f"Pandoc conversion failed: {message}")
                        return None
                        
                except Exception as e:
                    logger.error(f"Error in pandoc conversion: {e}")
                    # Clean up temp file if it exists
                    if temp_md_path.exists():
                        temp_md_path.unlink()
                    return None
            
            else:
                logger.warning(f"File type not supported for conversion: {file_path.suffix}")
                return None
                
        except Exception as e:
            logger.error(f"Error converting file to markdown: {e}")
            return None
    
    def get_workdir_categories(self) -> List[str]:
        """Get existing category directories in workdir"""
        categories = []
        try:
            for item in self.workdir.iterdir():
                if item.is_dir() and item.name != "temp":
                    categories.append(item.name)
            
            logger.info(f"Found existing categories: {categories}")
            return categories
        
        except Exception as e:
            logger.error(f"Error reading workdir categories: {e}")
            return []
    
    async def suggest_category_with_llm(
        self, 
        filename: str, 
        content: str, 
        existing_categories: List[str]
    ) -> CategorySuggestion:
        """Use LLM to suggest file category"""
        try:
            # Import LLM service here to avoid circular imports
            from embedding import get_llm_client
            
            llm = get_llm_client()
            if not llm:
                # Fallback to simple rule-based categorization
                return self._rule_based_categorization(filename, content, existing_categories)
            
            # Prepare prompt for LLM
            prompt = self._create_categorization_prompt(filename, content, existing_categories)
            # logger.debug(f"LLM categorization prompt: {prompt}")
            # Get LLM response
            response = await llm.generate_response(prompt)
            logger.debug(f"LLM response for categorization: {response}")
            # Parse LLM response
            suggestion = self._parse_llm_response(response, existing_categories)
            return suggestion
            
        except Exception as e:
            logger.error(f"Error in LLM categorization: {e}")
            # Fallback to rule-based categorization
            return self._rule_based_categorization(filename, content, existing_categories)
    
    def _create_categorization_prompt(
        self, 
        filename: str, 
        content: str, 
        existing_categories: List[str]
    ) -> str:
        """Create prompt for LLM categorization"""
        content_preview = content[:1000] if content else "No content available"
        
        prompt = f"""Analyze this file and suggest the best category for organization.

Filename: {filename}
Content preview: {content_preview}

Existing categories: {', '.join(existing_categories) if existing_categories else 'None'}

Please respond with a JSON object containing:
- "suggested_category": The recommended category name (use existing category if suitable, or suggest a new one)
- "confidence": A confidence score from 0.0 to 1.0
- "reason": Brief explanation for the categorization
- "existing_category": The existing category name if you recommend using one, null if suggesting a new category

Guidelines:
1. Prefer existing categories when appropriate
2. Suggest clear, descriptive category names
3. Consider file type, content topic, and intended use
4. Keep category names concise and meaningful

Example response format:
{{"suggested_category": "Documents", "confidence": 0.9, "reason": "Word document containing meeting notes", "existing_category": "Documents"}}
"""
        return prompt
    
    def _parse_llm_response(self, response: str, existing_categories: List[str]) -> CategorySuggestion:
        """Parse LLM response to extract category suggestion"""
        try:
            # Try to parse JSON response
            response_data = json.loads(response.strip())
            
            suggested_category = response_data.get("suggested_category", "Documents")
            confidence = min(max(float(response_data.get("confidence", 0.5)), 0.0), 1.0)
            reason = response_data.get("reason", "Categorized based on file content and type")
            existing_category = response_data.get("existing_category")
            
            # Validate existing category
            if existing_category and existing_category not in existing_categories:
                existing_category = None
            
            return CategorySuggestion(
                suggested_category=suggested_category,
                confidence=confidence,
                reason=reason,
                existing_category=existing_category
            )
            
        except Exception as e:
            logger.error(f"Error parsing LLM response: {e}")
            return self._rule_based_categorization("", "", existing_categories)
    
    def _rule_based_categorization(
        self, 
        filename: str, 
        content: str, 
        existing_categories: List[str]
    ) -> CategorySuggestion:
        """Fallback rule-based categorization"""
        filename_lower = filename.lower()
        content_lower = content.lower() if content else ""
        
        # Rule-based categorization logic
        if any(ext in filename_lower for ext in ['.pdf', '.doc', '.docx', '.txt']):
            category = "Documents"
        elif any(ext in filename_lower for ext in ['.ppt', '.pptx']):
            category = "Presentations"
        elif any(ext in filename_lower for ext in ['.xls', '.xlsx', '.csv']):
            category = "Spreadsheets"
        elif any(ext in filename_lower for ext in ['.jpg', '.png', '.gif', '.bmp']):
            category = "Images"
        elif any(keyword in content_lower for keyword in ['meeting', 'minutes', 'agenda']):
            category = "Meetings"
        elif any(keyword in content_lower for keyword in ['project', 'plan', 'task']):
            category = "Projects"
        else:
            category = "Miscellaneous"
        
        # Check if suggested category exists
        existing_category = category if category in existing_categories else None
        
        return CategorySuggestion(
            suggested_category=category,
            confidence=0.7,
            reason=f"Rule-based categorization based on file type and content keywords",
            existing_category=existing_category
        )
    
    def create_category_directory(self, category_name: str) -> Path:
        """Create new category directory"""
        category_path = self.workdir / category_name
        category_path.mkdir(parents=True, exist_ok=True)
        logger.info(f"Created category directory: {category_path}")
        return category_path
    
    def move_file_to_category(self, temp_file_path: Path, category: str, original_filename: str) -> Path:
        """Move file from temp to category directory"""
        category_path = self.workdir / category
        category_path.mkdir(parents=True, exist_ok=True)
        
        # Generate unique filename to avoid conflicts
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        file_extension = Path(original_filename).suffix
        base_name = Path(original_filename).stem
        final_filename = f"{base_name}_{timestamp}{file_extension}"
        
        final_path = category_path / final_filename
        
        try:
            shutil.move(str(temp_file_path), str(final_path))
            logger.info(f"File moved to: {final_path}")
            return final_path
        
        except Exception as e:
            logger.error(f"Error moving file: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to move file: {str(e)}")

# Initialize file manager
file_manager = FileManager()

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
        
        # Copy file to temp directory
        temp_file_path = file_manager.copy_file_to_temp(source_file_path)
        
        # Get file info
        filename = source_file_path.name
        file_tags = request.tags
        
        # Check if it's a document type
        is_document = file_manager.is_document_type(temp_file_path)
        markdown_content = None
        
        if is_document:
            # Convert to markdown
            markdown_content = file_manager.convert_to_markdown(temp_file_path)
            if not markdown_content:
                logger.warning(f"Failed to convert document to markdown: {filename}")
        
        logger.info(f"Processing file: {filename}, size: {file_size} bytes, is_document: {is_document}, content preview: {markdown_content[:100] if markdown_content else 'N/A'}")

        # Get existing categories
        existing_categories = file_manager.get_workdir_categories()
        
        # Determine final category
        final_category = request.category
        category_suggestion = None
        
        if request.auto_process and not request.category:
            # Use LLM to suggest category
            content_for_analysis = markdown_content or ""
            category_suggestion = await file_manager.suggest_category_with_llm(
                filename, 
                content_for_analysis, 
                existing_categories
            )
            final_category = category_suggestion.suggested_category
        
        if not final_category:
            final_category = "Uncategorized"
        
        # Move file to appropriate directory
        if category_suggestion and not category_suggestion.existing_category:
            # Create new category directory
            file_manager.create_category_directory(final_category)
        
        final_file_path = file_manager.move_file_to_category(
            temp_file_path, 
            final_category, 
            filename
        )
        
        # Create file info response
        file_info = FileInfo(
            file_id=str(uuid.uuid4()),
            name=filename,
            path=str(final_file_path.relative_to(settings.workdir_path)),
            type=mimetypes.guess_type(filename)[0] or "application/octet-stream",
            size=file_size,
            category=final_category,
            summary=f"Imported from {request.file_path}" + (
                f" - {category_suggestion.reason}" if category_suggestion else ""
            ),
            tags=file_tags,
            added_at=datetime.now().isoformat(),
            processed=True
        )
        
        logger.info(f"File imported successfully: {filename} -> {final_category}")
        
        return create_success_response(
            message="File imported successfully",
            data=file_info.dict()
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error importing file: {e}")
        # Clean up temp file if it exists
        if 'temp_file_path' in locals() and temp_file_path.exists():
            temp_file_path.unlink()
        
        return create_error_response(
            message="Failed to import file",
            error_code="FILE_PROCESSING_FAILED",
            error_details=str(e)
        )

class FileListRequest(BaseModel):
    page: int = Field(1, ge=1, description="Page number")
    limit: int = Field(20, ge=1, le=100, description="Items per page")
    category: Optional[str] = Field(None, description="Filter by category")
    type: Optional[str] = Field(None, description="Filter by file type")
    search: Optional[str] = Field(None, description="Search in filename")
    tags: Optional[List[str]] = Field(default_factory=list, description="Filter by tags")

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
        page = request.page
        limit = request.limit
        category_filter = request.category
        type_filter = request.type
        search_query = request.search.lower() if request.search else ""
        tags_filter = request.tags
        
        # Get all files from workdir
        all_files = []
        
        for category_dir in settings.workdir_path.iterdir():
            if category_dir.is_dir() and category_dir.name != "temp":
                for file_path in category_dir.rglob("*"):
                    if file_path.is_file():
                        # Create file info
                        try:
                            stat = file_path.stat()
                            file_info = {
                                "id": str(uuid.uuid4()),
                                "name": file_path.name,
                                "path": str(file_path.relative_to(settings.workdir_path)),
                                "type": mimetypes.guess_type(file_path.name)[0] or "application/octet-stream",
                                "category": category_dir.name,
                                "summary": f"File in {category_dir.name} category",
                                "tags": [],
                                "size": stat.st_size,
                                "added_at": datetime.fromtimestamp(stat.st_ctime).isoformat(),
                                "updated_at": datetime.fromtimestamp(stat.st_mtime).isoformat()
                            }
                            
                            # Apply filters
                            if category_filter and file_info["category"] != category_filter:
                                continue
                            if type_filter and type_filter not in file_info["type"]:
                                continue
                            if search_query and search_query not in file_info["name"].lower():
                                continue
                            
                            all_files.append(file_info)
                            
                        except Exception as e:
                            logger.warning(f"Error processing file {file_path}: {e}")
                            continue
        
        # Pagination
        total_count = len(all_files)
        start_idx = (page - 1) * limit
        end_idx = start_idx + limit
        files_page = all_files[start_idx:end_idx]
        
        total_pages = (total_count + limit - 1) // limit
        
        return create_success_response(
            message="File list retrieved successfully",
            data={
                "files": files_page,
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
