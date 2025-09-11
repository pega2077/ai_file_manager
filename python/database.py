"""
Database models and connection management
数据库模型和连接管理
"""
import sqlite3
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple
from contextlib import contextmanager
from loguru import logger

from config import settings


class DatabaseManager:
    """SQLite database manager"""
    
    def __init__(self, db_path: Path = None):
        self.db_path = db_path or (settings.database_path / "files.db")
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_database()
    
    def _init_database(self):
        """Initialize database tables"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                # Create files table
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS files (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        file_id TEXT UNIQUE NOT NULL,
                        path TEXT NOT NULL,
                        name TEXT NOT NULL,
                        type TEXT NOT NULL,
                        category TEXT NOT NULL,
                        summary TEXT,
                        tags TEXT,  -- JSON array as string
                        size INTEGER NOT NULL,
                        added_at TEXT NOT NULL,
                        updated_at TEXT,
                        processed BOOLEAN DEFAULT FALSE
                    )
                """)
                
                # Create chunks table
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS chunks (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        chunk_id TEXT UNIQUE NOT NULL,
                        file_id TEXT NOT NULL,
                        chunk_index INTEGER NOT NULL,
                        content TEXT NOT NULL,
                        content_type TEXT DEFAULT 'text',
                        char_count INTEGER NOT NULL,
                        token_count INTEGER,
                        embedding_id TEXT,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY (file_id) REFERENCES files (file_id)
                    )
                """)
                
                # Create indexes for better performance
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_files_file_id ON files(file_id)")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_files_category ON files(category)")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id)")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_chunks_embedding_id ON chunks(embedding_id)")
                
                conn.commit()
                logger.info(f"Database initialized: {self.db_path}")
                
        except Exception as e:
            logger.error(f"Failed to initialize database: {e}")
            raise
    
    @contextmanager
    def get_connection(self):
        """Get database connection with context manager"""
        conn = None
        try:
            conn = sqlite3.connect(str(self.db_path))
            conn.row_factory = sqlite3.Row  # Enable dict-like access to rows
            yield conn
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Database error: {e}")
            raise
        finally:
            if conn:
                conn.close()
    
    def insert_file(self, file_info: Dict[str, Any]) -> int:
        """Insert file record"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                cursor.execute("""
                    INSERT INTO files (
                        file_id, path, name, type, category, summary, 
                        tags, size, added_at, processed
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    file_info['file_id'],
                    file_info['path'],
                    file_info['name'],
                    file_info['type'],
                    file_info['category'],
                    file_info.get('summary', ''),
                    json.dumps(file_info.get('tags', [])),
                    file_info['size'],
                    file_info['added_at'],
                    file_info.get('processed', False)
                ))
                
                file_db_id = cursor.lastrowid
                conn.commit()
                
                logger.info(f"File record inserted: {file_info['file_id']}")
                return file_db_id
                
        except Exception as e:
            logger.error(f"Failed to insert file record: {e}")
            raise
    
    def get_file_by_id(self, file_id: str) -> Optional[Dict[str, Any]]:
        """Get file by file_id"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM files WHERE file_id = ?", (file_id,))
                row = cursor.fetchone()
                
                if row:
                    file_data = dict(row)
                    file_data['tags'] = json.loads(file_data['tags'] or '[]')
                    return file_data
                
                return None
                
        except Exception as e:
            logger.error(f"Failed to get file by ID: {e}")
            return None
    
    def list_files(self, 
                   page: int = 1, 
                   limit: int = 20, 
                   category: str = None, 
                   search: str = None) -> Tuple[List[Dict[str, Any]], int]:
        """List files with pagination and filtering"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                # Build query
                conditions = []
                params = []
                
                if category:
                    conditions.append("category = ?")
                    params.append(category)
                
                if search:
                    conditions.append("(name LIKE ? OR summary LIKE ?)")
                    params.extend([f"%{search}%", f"%{search}%"])
                
                where_clause = " WHERE " + " AND ".join(conditions) if conditions else ""
                
                # Get total count
                count_query = f"SELECT COUNT(*) FROM files{where_clause}"
                cursor.execute(count_query, params)
                total_count = cursor.fetchone()[0]
                
                # Get paginated results
                offset = (page - 1) * limit
                query = f"""
                    SELECT * FROM files{where_clause} 
                    ORDER BY added_at DESC 
                    LIMIT ? OFFSET ?
                """
                params.extend([limit, offset])
                
                cursor.execute(query, params)
                rows = cursor.fetchall()
                
                files = []
                for row in rows:
                    file_data = dict(row)
                    file_data['tags'] = json.loads(file_data['tags'] or '[]')
                    files.append(file_data)
                
                return files, total_count
                
        except Exception as e:
            logger.error(f"Failed to list files: {e}")
            return [], 0
    
    def insert_chunk(self, chunk_info: Dict[str, Any]) -> int:
        """Insert chunk record"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                cursor.execute("""
                    INSERT INTO chunks (
                        chunk_id, file_id, chunk_index, content, content_type,
                        char_count, token_count, embedding_id, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    chunk_info['chunk_id'],
                    chunk_info['file_id'],
                    chunk_info['chunk_index'],
                    chunk_info['content'],
                    chunk_info.get('content_type', 'text'),
                    chunk_info['char_count'],
                    chunk_info.get('token_count'),
                    chunk_info.get('embedding_id'),
                    chunk_info.get('created_at', datetime.now().isoformat())
                ))
                
                chunk_db_id = cursor.lastrowid
                conn.commit()
                
                logger.info(f"Chunk record inserted: {chunk_info['chunk_id']}")
                return chunk_db_id
                
        except Exception as e:
            logger.error(f"Failed to insert chunk record: {e}")
            raise
    
    def get_chunks_by_file_id(self, file_id: str) -> List[Dict[str, Any]]:
        """Get all chunks for a file"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT * FROM chunks 
                    WHERE file_id = ? 
                    ORDER BY chunk_index
                """, (file_id,))
                
                rows = cursor.fetchall()
                return [dict(row) for row in rows]
                
        except Exception as e:
            logger.error(f"Failed to get chunks for file: {e}")
            return []
    
    def update_chunk_embedding_id(self, chunk_id: str, embedding_id: str):
        """Update chunk with embedding ID"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    UPDATE chunks 
                    SET embedding_id = ? 
                    WHERE chunk_id = ?
                """, (embedding_id, chunk_id))
                
                conn.commit()
                logger.debug(f"Updated chunk {chunk_id} with embedding ID {embedding_id}")
                
        except Exception as e:
            logger.error(f"Failed to update chunk embedding ID: {e}")
            raise
    
    def delete_file(self, file_id: str) -> bool:
        """Delete file and its chunks"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                # Delete chunks first (foreign key constraint)
                cursor.execute("DELETE FROM chunks WHERE file_id = ?", (file_id,))
                chunks_deleted = cursor.rowcount
                
                # Delete file
                cursor.execute("DELETE FROM files WHERE file_id = ?", (file_id,))
                files_deleted = cursor.rowcount
                
                conn.commit()
                
                if files_deleted > 0:
                    logger.info(f"Deleted file {file_id} and {chunks_deleted} chunks")
                    return True
                else:
                    logger.warning(f"File {file_id} not found for deletion")
                    return False
                
        except Exception as e:
            logger.error(f"Failed to delete file: {e}")
            return False
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get database statistics"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                # Count files
                cursor.execute("SELECT COUNT(*) FROM files")
                total_files = cursor.fetchone()[0]
                
                # Count chunks
                cursor.execute("SELECT COUNT(*) FROM chunks")
                total_chunks = cursor.fetchone()[0]
                
                # Count by category
                cursor.execute("""
                    SELECT category, COUNT(*) 
                    FROM files 
                    GROUP BY category 
                    ORDER BY COUNT(*) DESC
                """)
                categories = dict(cursor.fetchall())
                
                # Count processed files
                cursor.execute("SELECT COUNT(*) FROM files WHERE processed = TRUE")
                processed_files = cursor.fetchone()[0]
                
                return {
                    "total_files": total_files,
                    "total_chunks": total_chunks,
                    "processed_files": processed_files,
                    "categories": categories
                }
                
        except Exception as e:
            logger.error(f"Failed to get statistics: {e}")
            return {}


# Global database manager instance
_db_manager = None


def get_db_manager() -> DatabaseManager:
    """Get global database manager instance"""
    global _db_manager
    if _db_manager is None:
        _db_manager = DatabaseManager()
    return _db_manager
