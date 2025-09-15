"""
File Manager Module
文件管理器模块
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

from fastapi import UploadFile, HTTPException
from pydantic import BaseModel, Field
from loguru import logger

# 导入公共工具
from commons import create_response, create_error_response, create_success_response
# 导入配置
from config import settings
# 导入文件转换器
from file_converter import FileConverter

# 请求/响应模型
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

    def save_file_to_directory(self, source_file_path: str, target_directory: str, overwrite: bool) -> dict:
        """Save file to specified directory with overwrite handling"""
        try:
            # Convert to Path objects
            source_path = Path(source_file_path)
            target_path = Path(target_directory)

            # Check if source file exists
            if not source_path.exists():
                return create_error_response(
                    message="Source file does not exist",
                    error_code="SOURCE_FILE_MISSING"
                )

            # Determine target directory - handle both absolute and relative paths
            if target_path.is_absolute():
                # If target_directory is absolute path, use it directly
                target_dir = target_path
            else:
                # If target_directory is relative, resolve relative to workdir for security
                target_dir = self.workdir / target_directory
            
            target_dir.mkdir(parents=True, exist_ok=True)

            # Determine target filename
            target_filename = source_path.name
            final_target_path = target_dir / target_filename

            if final_target_path.exists() and not overwrite:
                # Add timestamp to filename
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                name_without_ext = final_target_path.stem
                extension = final_target_path.suffix
                new_filename = f"{name_without_ext}_{timestamp}{extension}"
                final_target_path = target_dir / new_filename

            # Copy file
            shutil.copy2(source_path, final_target_path)

            logger.info(f"File saved to directory: {source_path} -> {final_target_path}")

            return create_success_response(
                message="File saved successfully",
                data={
                    "source_file_path": str(source_path),
                    "saved_path": str(final_target_path),
                    "filename": final_target_path.name,
                    "overwritten": overwrite and (target_dir / source_path.name).exists()
                }
            )

        except Exception as e:
            logger.error(f"Error saving file to directory: {e}")
            return create_error_response(
                message="Failed to save file",
                error_code="SAVE_FILE_ERROR",
                error_details=str(e)
            )

    async def recommend_directory(self, file_path: str, available_directories: List[str]) -> dict:
        """Analyze file and recommend the best directory to save it"""
        try:
            # Convert to Path object
            source_path = Path(file_path)

            # Check if source file exists
            if not source_path.exists():
                return create_error_response(
                    message="Source file does not exist",
                    error_code="SOURCE_FILE_MISSING"
                )

            filename = source_path.name

            # Extract content for analysis
            content_preview = ""
            if self.is_text_file(source_path):
                # Read text file directly
                try:
                    with open(source_path, 'r', encoding='utf-8') as f:
                        content_preview = f.read(500)
                except Exception as e:
                    logger.warning(f"Could not read text file {filename}: {e}")
            elif self.is_document_type(source_path):
                # Convert document to text using pandoc
                try:
                    success, converted_content = self.converter.convert_to_markdown(str(source_path), None)
                    if success and converted_content:
                        # Take first 500 characters for analysis
                        content_preview = converted_content[:500]
                    else:
                        logger.warning(f"Failed to convert document {filename} to text")
                except Exception as e:
                    logger.error(f"Error converting document {filename}: {e}")

            # Use LLM to recommend directory
            try:
                # Import LLM service
                from embedding import get_llm_client

                llm = get_llm_client()
                if not llm:
                    return create_error_response(
                        message="LLM service not available",
                        error_code="LLM_NOT_AVAILABLE"
                    )

                # Create prompt for directory recommendation
                prompt = self._create_directory_recommendation_prompt(
                    filename, content_preview, available_directories
                )

                # Get LLM response
                response = await llm.generate_response(prompt)
                logger.debug(f"LLM response for directory recommendation: {response}")

                # Parse response
                recommendation = self._parse_directory_recommendation_response(response, available_directories)

                return create_success_response(
                    message="Directory recommendation generated successfully",
                    data={
                        "file_path": file_path,
                        "filename": filename,
                        "recommended_directory": recommendation.recommended_directory,
                        "confidence": recommendation.confidence,
                        "reasoning": recommendation.reasoning,
                        "alternatives": recommendation.alternatives
                    }
                )

            except Exception as e:
                logger.error(f"Error getting LLM recommendation: {e}")
                return create_error_response(
                    message="Failed to generate directory recommendation",
                    error_code="LLM_ERROR",
                    error_details=str(e)
                )

        except Exception as e:
            logger.error(f"Error recommending directory for file {file_path}: {e}")
            return create_error_response(
                message="Failed to analyze file and recommend directory",
                error_code="ANALYSIS_ERROR",
                error_details=str(e)
            )

    def _create_directory_recommendation_prompt(
        self,
        filename: str,
        content_preview: str,
        available_directories: List[str]
    ) -> str:
        """Create prompt for LLM directory recommendation"""
        content_info = content_preview[:200] if content_preview else "No content available"

        directories_list = "\n".join([f"- {dir}" for dir in available_directories])

        prompt = f"""Analyze this file and recommend the most appropriate directory to save it.

Filename: {filename}
Content preview: {content_info}

Available directories:
{directories_list}

Please analyze the filename and content to determine which directory would be the best fit. Consider:
1. The topic and content type of the file
2. The purpose and naming of available directories
3. Common organizational patterns

Respond with a JSON object containing:
- "recommended_directory": The best directory path from the available options.The directory path not directory name.
- "confidence": A confidence score from 0.0 to 1.0
- "reasoning": Brief explanation for the recommendation
- "alternatives": Array of up to 3 alternative directory suggestions (in order of preference).The directory path not directory name.

Example response:
{{
  "recommended_directory": "Documents/Work",
  "confidence": 0.9,
  "reasoning": "This appears to be a work-related document based on the content about project planning",
  "alternatives": ["Documents/Projects", "Work/Planning"]
}}

If no suitable directory is found, you can suggest creating a new one by specifying a reasonable directory name.
"""
        return prompt

    def _parse_directory_recommendation_response(self, response: str, available_directories: List[str]) -> dict:
        """Parse LLM response for directory recommendation"""
        try:
            # Try to parse JSON response
            response_data = json.loads(response.strip())

            recommended_directory = response_data.get("recommended_directory", "")
            confidence = min(max(float(response_data.get("confidence", 0.5)), 0.0), 1.0)
            reasoning = response_data.get("reasoning", "Recommended based on file analysis")
            alternatives = response_data.get("alternatives", [])

            # Validate recommended directory
            if recommended_directory not in available_directories:
                # If not in available directories, still accept it (could be a suggestion for new directory)
                pass

            return type('DirectoryRecommendation', (), {
                'recommended_directory': recommended_directory,
                'confidence': confidence,
                'reasoning': reasoning,
                'alternatives': alternatives[:3]  # Limit to 3 alternatives
            })()

        except Exception as e:
            logger.error(f"Error parsing LLM directory recommendation response: {e}")
            # Fallback: return first available directory
            fallback_dir = available_directories[0] if available_directories else "Documents"
            return type('DirectoryRecommendation', (), {
                'recommended_directory': fallback_dir,
                'confidence': 0.5,
                'reasoning': "Fallback recommendation due to parsing error",
                'alternatives': []
            })()

    async def import_to_rag(self, file_path: str) -> dict:
        """Import file to RAG library by processing embeddings and storing in database"""
        try:
            # Convert to Path object
            source_path = Path(file_path)

            # Check if source file exists
            if not source_path.exists():
                return create_error_response(
                    message="Source file does not exist",
                    error_code="SOURCE_FILE_MISSING"
                )

            # Check if it's a file
            if not source_path.is_file():
                return create_error_response(
                    message="Path is not a file",
                    error_code="INVALID_FILE_TYPE"
                )

            # Check file size
            max_size_bytes = settings.max_file_size_mb * 1024 * 1024
            file_size = source_path.stat().st_size

            if file_size > max_size_bytes:
                return create_error_response(
                    message=f"File too large. Maximum size: {settings.max_file_size_mb}MB",
                    error_code="FILE_TOO_LARGE"
                )

            filename = source_path.name

            logger.info(f"Importing file to RAG: {filename}, size: {file_size} bytes")

            # Convert file to markdown format (similar to import_file)
            temp_md_path = None
            markdown_content = None

            if self.is_text_file(source_path):
                # For text files, read directly
                try:
                    with open(source_path, 'r', encoding='utf-8') as f:
                        markdown_content = f.read()

                    final_file_path = source_path
                    final_file_size = file_size
                except Exception as e:
                    logger.error(f"Error reading text file {filename}: {e}")
                    return create_error_response(
                        message="Failed to read text file",
                        error_code="READ_ERROR",
                        error_details=str(e)
                    )
            elif self.is_document_type(source_path):
                # For document types, convert to markdown
                try:
                    # Create a temporary markdown file
                    temp_md_path = self.temp_dir / f"{uuid.uuid4()}.md"
                    success, content = self.converter.convert_to_markdown(str(source_path), str(temp_md_path))

                    if success and content:
                        markdown_content = content
                        final_file_path = temp_md_path
                        final_file_size = temp_md_path.stat().st_size if temp_md_path.exists() else 0
                    else:
                        return create_error_response(
                            message="Failed to convert document to markdown",
                            error_code="CONVERSION_FAILED"
                        )
                except Exception as e:
                    logger.error(f"Error converting document {filename}: {e}")
                    return create_error_response(
                        message="Document conversion failed",
                        error_code="CONVERSION_ERROR",
                        error_details=str(e)
                    )
            else:
                return create_error_response(
                    message=f"Unsupported file type: {source_path.suffix}",
                    error_code="UNSUPPORTED_FILE_TYPE"
                )

            if not markdown_content:
                return create_error_response(
                    message="No content extracted from file",
                    error_code="NO_CONTENT"
                )

            # Generate file_id for RAG storage
            file_id = str(uuid.uuid4())

            # Process embeddings and store in databases (similar to import_file)
            try:
                await process_file_embeddings(
                    file_id=file_id,
                    content=markdown_content,
                    file_path=str(final_file_path),
                    category="RAG_Import"  # Use a special category for RAG imports
                )
                logger.info(f"File embeddings processed successfully: {file_id}")

            except Exception as embed_error:
                logger.error(f"Failed to process file embeddings: {embed_error}")
                return create_error_response(
                    message="Failed to process file embeddings",
                    error_code="EMBEDDING_ERROR",
                    error_details=str(embed_error)
                )

            # Save basic file info to database (without full file record, just for RAG)
            try:
                from database import DatabaseManager
                db_manager = DatabaseManager()

                rag_file_info = {
                    'file_id': file_id,
                    'path': str(final_file_path.relative_to(settings.workdir_path)) if final_file_path != source_path else str(source_path),
                    'name': filename,
                    'type': "text/markdown",
                    'category': "RAG_Import",
                    'summary': f"RAG imported file from {file_path}",
                    'tags': ["rag_import"],
                    'size': final_file_size,
                    'added_at': datetime.now().isoformat(),
                    'processed': True
                }

                db_id = db_manager.insert_file(rag_file_info)
                logger.info(f"RAG file record saved to database with ID: {db_id}")

            except Exception as db_error:
                logger.error(f"Failed to save RAG file record to database: {db_error}")
                # Continue execution - embeddings are already stored

            # Clean up temporary file if created
            if temp_md_path and temp_md_path.exists():
                try:
                    temp_md_path.unlink()
                except Exception as e:
                    logger.warning(f"Failed to clean up temp file {temp_md_path}: {e}")

            logger.info(f"File successfully imported to RAG library: {filename} -> {file_id}")

            return create_success_response(
                message="File successfully imported to RAG library",
                data={
                    "file_id": file_id,
                    "original_path": file_path,
                    "filename": filename,
                    "file_size": file_size,
                    "processed_size": final_file_size,
                    "content_length": len(markdown_content),
                    "import_timestamp": datetime.now().isoformat()
                }
            )

        except Exception as e:
            logger.error(f"Error importing file to RAG: {e}")
            return create_error_response(
                message="Failed to import file to RAG library",
                error_code="IMPORT_ERROR",
                error_details=str(e)
            )


# Initialize file manager
file_manager = FileManager()


async def process_file_embeddings(file_id: str, content: str, file_path: str, category: str):
    """Process file content to generate embeddings and store in vector database"""
    try:
        # Import embedding and vector database modules
        from embedding import get_embedding_generator
        from vector_db import get_vector_db_manager

        # Initialize components
        embedding_gen = get_embedding_generator()
        vector_db = get_vector_db_manager()

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