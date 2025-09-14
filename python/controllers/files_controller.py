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
    
    def convert_to_markdown(self, file_path: Path, output_path: Path) -> tuple[bool, Optional[str]]:
        """Convert document to markdown format and save to output path"""
        try:
            if self.is_text_file(file_path):
                # For text files, read directly and convert
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # Add markdown formatting if it's plain text
                if file_path.suffix.lower() == '.txt':
                    lines = content.split('\n')
                    # Simple conversion: treat empty lines as paragraph breaks
                    markdown_content = '\n\n'.join([line for line in lines if line.strip()])
                else:
                    markdown_content = content
                
                # Save to output path
                with open(output_path, 'w', encoding='utf-8') as f:
                    f.write(markdown_content)
                
                logger.info(f"Text file converted to markdown: {file_path} -> {output_path}")
                return True, markdown_content
            
            elif self.is_document_type(file_path):
                # Use pandoc converter for other document types
                try:
                    success, message = self.converter.convert_to_markdown(str(file_path), str(output_path))
                    if success and output_path.exists():
                        # Read the converted content for analysis
                        with open(output_path, 'r', encoding='utf-8') as f:
                            markdown_content = f.read()
                        
                        logger.info(f"Document converted to markdown using pandoc: {file_path} -> {output_path}")
                        return True, markdown_content
                    else:
                        logger.error(f"Pandoc conversion failed: {message}")
                        return False, None
                        
                except Exception as e:
                    logger.error(f"Error in pandoc conversion: {e}")
                    return False, None
            
            else:
                logger.warning(f"File type not supported for conversion: {file_path.suffix}")
                # For unsupported types, just copy the file
                shutil.copy2(file_path, output_path)
                logger.info(f"File copied without conversion: {file_path} -> {output_path}")
                return True, None
                
        except Exception as e:
            logger.error(f"Error converting file to markdown: {e}")
            return False, None
    
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
        existing_categories: List[str],
        directory_structure: Optional[List[Dict[str, str]]] = None
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
            prompt = self._create_categorization_prompt(filename, content, existing_categories, directory_structure)
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
        existing_categories: List[str],
        directory_structure: Optional[List[Dict[str, str]]] = None
    ) -> str:
        """Create prompt for LLM categorization"""
        content_preview = content[:1000] if content else "No content available"
        
        # Build directory structure info if provided
        directory_info = ""
        if directory_structure:
            dir_items = []
            for item in directory_structure:
                item_type = item.get("type", "")
                item_name = item.get("name", "")
                if item_type == "folder":
                    dir_items.append(f"📁 {item_name}")
                elif item_type == "file":
                    dir_items.append(f"📄 {item_name}")
            
            if dir_items:
                directory_info = f"\n\nDirectory context (where this file will be placed):\n" + "\n".join(dir_items[:20])  # Limit to 20 items
        
        # Build the guidelines section
        guidelines = """Guidelines:
1. Prefer existing categories when appropriate
2. Suggest clear, descriptive category names
3. Consider file type, content topic, and intended use
4. Keep category names concise and meaningful"""
        
        if directory_info:
            guidelines += "\n5. Consider the directory context - suggest categories that fit well with the existing folder structure"
        
        prompt = f"""Analyze this file and suggest the best category for organization.

Filename: {filename}
Content preview: {content_preview}{directory_info}

Existing categories: {', '.join(existing_categories) if existing_categories else 'None'}

Please respond with a JSON object containing:
- "suggested_category": The recommended category name (use existing category if suitable, or suggest a new one)
- "confidence": A confidence score from 0.0 to 1.0
- "reason": Brief explanation for the categorization
- "existing_category": The existing category name if you recommend using one, null if suggesting a new category

{guidelines}

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
    
    def convert_and_save_to_category(self, source_file_path: Path, category: str, original_filename: str) -> tuple[Path, Optional[str]]:
        """Convert file to markdown and save directly to category directory"""
        category_path = self.workdir / category
        category_path.mkdir(parents=True, exist_ok=True)
        
        # Generate unique filename for markdown output
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        base_name = Path(original_filename).stem
        
        # Always save as .md file
        final_filename = f"{base_name}_{timestamp}.md"
        final_path = category_path / final_filename
        
        try:
            # Convert to markdown and save directly
            success, content = self.convert_to_markdown(source_file_path, final_path)
            
            if success:
                logger.info(f"File converted and saved to: {final_path}")
                return final_path, content
            else:
                logger.error(f"Failed to convert file: {source_file_path}")
                raise HTTPException(status_code=500, detail=f"Failed to convert file to markdown")
        
        except Exception as e:
            logger.error(f"Error converting and saving file: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to convert and save file: {str(e)}")

    def create_folder_structure(self, target_folder: str, structure: List[Dict[str, str]]) -> tuple[bool, str]:
        """Create folder structure in target directory"""
        try:
            target_path = Path(target_folder)
            
            # Ensure target directory exists
            target_path.mkdir(parents=True, exist_ok=True)
            
            created_folders = []
            for item in structure:
                if item.get("type") != "folder":
                    continue
                    
                folder_name = item.get("name", "")
                if not folder_name:
                    continue
                    
                # Create full path
                folder_path = target_path / folder_name
                folder_path.mkdir(parents=True, exist_ok=True)
                created_folders.append(str(folder_path))
            
            logger.info(f"Created folder structure in {target_folder}: {created_folders}")
            return True, f"Successfully created {len(created_folders)} folders"
            
        except Exception as e:
            logger.error(f"Error creating folder structure: {e}")
            return False, str(e)

    def list_directory_structure(self, directory_path: str) -> List[Dict[str, Any]]:
        """List directory structure including files and folders with detailed information"""
        try:
            dir_path = Path(directory_path)
            
            if not dir_path.exists():
                logger.warning(f"Directory does not exist: {directory_path}")
                return []
            
            if not dir_path.is_dir():
                logger.warning(f"Path is not a directory: {directory_path}")
                return []
            
            structure = []
            
            # List all items in the directory
            for item in sorted(dir_path.iterdir()):
                item_type = "folder" if item.is_dir() else "file"
                
                item_info = {
                    "name": item.name,
                    "type": item_type
                }
                
                try:
                    # Get file stats
                    stat = item.stat()
                    
                    # Size (only for files)
                    if item_type == "file":
                        item_info["size"] = stat.st_size
                    else:
                        item_info["size"] = None
                        # Count items in folder
                        try:
                            item_info["item_count"] = len(list(item.iterdir()))
                        except (OSError, PermissionError):
                            item_info["item_count"] = None
                    
                    # Creation time (st_birthtime on some systems, fallback to st_ctime)
                    try:
                        created_time = getattr(stat, 'st_birthtime', stat.st_ctime)
                        item_info["created_at"] = datetime.fromtimestamp(created_time).isoformat()
                    except (AttributeError, OSError):
                        item_info["created_at"] = None
                    
                    # Modified time
                    try:
                        item_info["modified_at"] = datetime.fromtimestamp(stat.st_mtime).isoformat()
                    except OSError:
                        item_info["modified_at"] = None
                        
                except (OSError, PermissionError) as e:
                    logger.warning(f"Could not get stats for {item}: {e}")
                    item_info.update({
                        "size": None,
                        "created_at": None,
                        "modified_at": None,
                        "item_count": None
                    })
                
                structure.append(item_info)
            
            logger.info(f"Listed directory structure for {directory_path}: {len(structure)} items")
            return structure
            
        except Exception as e:
            logger.error(f"Error listing directory structure: {e}")
            return []

    def list_directory_structure_recursive(self, directory_path: str, max_depth: int = 3) -> List[Dict[str, Any]]:
        """Recursively list directory structure as a flat list with depth limit"""
        try:
            dir_path = Path(directory_path)
            
            if not dir_path.exists():
                logger.warning(f"Directory does not exist: {directory_path}")
                return []
            
            if not dir_path.is_dir():
                logger.warning(f"Path is not a directory: {directory_path}")
                return []
            
            result = []
            
            def collect_items(current_path: Path, current_depth: int = 0, relative_path: str = ""):
                """Recursively collect all items into a flat list"""
                if current_depth > max_depth:
                    return
                
                try:
                    stat = current_path.stat()
                    item_info = {
                        "name": current_path.name,
                        "type": "folder" if current_path.is_dir() else "file",
                        "path": str(current_path),
                        "relative_path": relative_path or ".",
                        "depth": current_depth
                    }
                    
                    # Add file/folder specific info
                    if current_path.is_file():
                        item_info.update({
                            "size": stat.st_size,
                            "created_at": datetime.fromtimestamp(getattr(stat, 'st_birthtime', stat.st_ctime)).isoformat(),
                            "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat()
                        })
                    else:
                        # For directories, add item count
                        try:
                            children = list(current_path.iterdir())
                            item_info["item_count"] = len(children)
                            
                            # Recursively collect children
                            for child in sorted(children):
                                child_relative_path = f"{relative_path}/{child.name}" if relative_path != "." else child.name
                                collect_items(child, current_depth + 1, child_relative_path)
                                
                        except (OSError, PermissionError) as e:
                            logger.warning(f"Could not list contents of {current_path}: {e}")
                            item_info["item_count"] = 0
                            item_info["access_error"] = str(e)
                        
                        # Add timestamps for directories too
                        try:
                            item_info["created_at"] = datetime.fromtimestamp(getattr(stat, 'st_birthtime', stat.st_ctime)).isoformat()
                            item_info["modified_at"] = datetime.fromtimestamp(stat.st_mtime).isoformat()
                        except (AttributeError, OSError):
                            item_info["created_at"] = None
                            item_info["modified_at"] = None
                    
                    result.append(item_info)
                    
                except (OSError, PermissionError) as e:
                    logger.warning(f"Could not access {current_path}: {e}")
                    result.append({
                        "name": current_path.name,
                        "type": "folder" if current_path.is_dir() else "file",
                        "path": str(current_path),
                        "relative_path": relative_path or ".",
                        "depth": current_depth,
                        "access_error": str(e)
                    })
            
            collect_items(dir_path, 0, ".")
            logger.info(f"Collected {len(result)} items from recursive directory listing for {directory_path} with max_depth {max_depth}")
            return result
            
        except Exception as e:
            logger.error(f"Error building recursive directory structure: {e}")
            return []

# Initialize file manager
file_manager = FileManager()

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
        if is_document and file_manager.is_text_file(source_file_path):
            # For text files, read content for analysis
            try:
                with open(source_file_path, 'r', encoding='utf-8') as f:
                    markdown_content = f.read()[:2000]  # Preview for analysis
            except Exception as e:
                logger.warning(f"Could not read file for content analysis: {e}")
        
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
        # 获取数据库管理器实例
        from database import DatabaseManager
        db_manager = DatabaseManager()
        
        page = request.page
        limit = request.limit
        category_filter = request.category
        search_query = request.search
        
        # Get files from database with filtering and pagination
        files_data, total_count = db_manager.list_files(
            page=page,
            limit=limit,
            category=category_filter,
            search=search_query
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
async def create_folder_structure(request: CreateFolderStructureRequest):
    """Create folder structure in target directory"""
    try:
        # Validate target folder path
        if not request.target_folder or not request.target_folder.strip():
            return create_error_response(
                message="Target folder path is required",
                error_code="INVALID_REQUEST"
            )
        
        # Validate structure
        if not request.structure:
            return create_error_response(
                message="Folder structure cannot be empty",
                error_code="INVALID_REQUEST"
            )
        
        # Create folder structure
        success, message = file_manager.create_folder_structure(
            request.target_folder, 
            [item.model_dump() for item in request.structure]
        )
        
        if success:
            return create_success_response(
                message=message,
                data={
                    "target_folder": request.target_folder,
                    "folders_created": len(request.structure)
                }
            )
        else:
            return create_error_response(
                message=f"Failed to create folder structure: {message}",
                error_code="INTERNAL_ERROR"
            )
            
    except Exception as e:
        logger.error(f"Error creating folder structure: {e}")
        return create_error_response(
            message="Failed to create folder structure",
            error_code="INTERNAL_ERROR",
            error_details=str(e)
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
