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
                        start_pos INTEGER,
                        end_pos INTEGER,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY (file_id) REFERENCES files (file_id)
                    )
                """)
                
                # Create conversations table for chat history
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS conversations (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        conversation_id TEXT UNIQUE NOT NULL,
                        session_id TEXT NOT NULL,
                        question TEXT NOT NULL,
                        answer TEXT NOT NULL,
                        sources_count INTEGER DEFAULT 0,
                        confidence REAL DEFAULT 0.0,
                        created_at TEXT NOT NULL,
                        metadata TEXT  -- JSON string for additional metadata
                    )
                """)
                
                # Create indexes for better performance
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_files_file_id ON files(file_id)")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_files_category ON files(category)")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id)")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_chunks_embedding_id ON chunks(embedding_id)")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id)")
                cursor.execute("CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at)")
                
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
                   type: str = None,
                   search: str = None,
                   sort_by: str = None,
                   sort_order: str = "desc") -> Tuple[List[Dict[str, Any]], int]:
        """List files with pagination and filtering"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                # Build query
                conditions = []
                params = []
                
                if category:
                    conditions.append("category LIKE ?")
                    params.append(f"%{category}%")
                
                if type:
                    # Support both extension (e.g., "png") and MIME type (e.g., "image/png")
                    if "/" in type:
                        # MIME type
                        conditions.append("type = ?")
                        params.append(type)
                    else:
                        # Extension - match both MIME type ending with extension and exact extension
                        conditions.append("(type LIKE ? OR type = ?)")
                        params.extend([f"%/{type}", type])
                
                if search:
                    conditions.append("(name LIKE ? OR summary LIKE ?)")
                    params.extend([f"%{search}%", f"%{search}%"])
                
                where_clause = " WHERE " + " AND ".join(conditions) if conditions else ""
                
                # Build order by clause
                order_by = "added_at DESC"  # default
                if sort_by:
                    valid_sort_fields = {"name", "size", "added_at"}
                    if sort_by in valid_sort_fields:
                        order = "ASC" if sort_order.lower() == "asc" else "DESC"
                        order_by = f"{sort_by} {order}"
                
                # Get total count
                count_query = f"SELECT COUNT(*) FROM files{where_clause}"
                cursor.execute(count_query, params)
                total_count = cursor.fetchone()[0]
                
                # Get paginated results
                offset = (page - 1) * limit
                query = f"""
                    SELECT * FROM files{where_clause} 
                    ORDER BY {order_by} 
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
    
    def insert_file_chunks(self, chunks_data: List[Dict[str, Any]]) -> int:
        """Insert multiple chunk records for a file"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                # Insert chunks in batch
                inserted_count = 0
                for chunk_info in chunks_data:
                    try:
                        cursor.execute("""
                            INSERT INTO chunks (
                                chunk_id, file_id, chunk_index, content, content_type,
                                char_count, token_count, embedding_id, start_pos, end_pos, created_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (
                            chunk_info['chunk_id'],
                            chunk_info['file_id'],
                            chunk_info['chunk_index'],
                            chunk_info['content'],
                            chunk_info.get('content_type', 'text'),
                            chunk_info['char_count'],
                            chunk_info.get('token_count'),
                            chunk_info.get('embedding_id'),
                            chunk_info.get('start_pos'),
                            chunk_info.get('end_pos'),
                            chunk_info.get('created_at', datetime.now().isoformat())
                        ))
                        inserted_count += 1
                        
                    except Exception as chunk_error:
                        logger.error(f"Failed to insert chunk {chunk_info.get('chunk_id')}: {chunk_error}")
                        continue
                
                conn.commit()
                logger.info(f"Successfully inserted {inserted_count}/{len(chunks_data)} chunks")
                return inserted_count
                
        except Exception as e:
            logger.error(f"Failed to insert file chunks: {e}")
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
    
    def get_chunks_by_file_id_paginated(self, file_id: str, page: int = 1, limit: int = 50) -> List[Dict[str, Any]]:
        """Get chunks for a file with pagination"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                offset = (page - 1) * limit
                cursor.execute("""
                    SELECT * FROM chunks 
                    WHERE file_id = ? 
                    ORDER BY chunk_index
                    LIMIT ? OFFSET ?
                """, (file_id, limit, offset))
                
                rows = cursor.fetchall()
                return [dict(row) for row in rows]
                
        except Exception as e:
            logger.error(f"Failed to get chunks for file with pagination: {e}")
            return []
    
    def get_chunks_count_by_file_id(self, file_id: str) -> int:
        """Get total count of chunks for a file"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT COUNT(*) FROM chunks 
                    WHERE file_id = ?
                """, (file_id,))
                
                row = cursor.fetchone()
                return row[0] if row else 0
                
        except Exception as e:
            logger.error(f"Failed to get chunks count for file: {e}")
            return 0
    
    def get_chunk_by_id(self, chunk_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific chunk by its ID"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM chunks WHERE chunk_id = ?", (chunk_id,))
                
                row = cursor.fetchone()
                return dict(row) if row else None
                
        except Exception as e:
            logger.error(f"Failed to get chunk by ID: {e}")
            return None
    
    def get_chunk_by_index(self, file_id: str, chunk_index: int) -> Optional[Dict[str, Any]]:
        """Get a specific chunk by file ID and chunk index"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT * FROM chunks 
                    WHERE file_id = ? AND chunk_index = ?
                """, (file_id, chunk_index))
                
                row = cursor.fetchone()
                return dict(row) if row else None
                
        except Exception as e:
            logger.error(f"Failed to get chunk by index: {e}")
            return None
    
    def get_chunk_by_embedding_id(self, embedding_id: str) -> Optional[Dict[str, Any]]:
        """Get a chunk by its embedding ID"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT * FROM chunks 
                    WHERE embedding_id = ?
                """, (embedding_id,))
                
                row = cursor.fetchone()
                return dict(row) if row else None
                
        except Exception as e:
            logger.error(f"Failed to get chunk by embedding ID: {e}")
            return None
    
    def search_chunks_by_content(
        self, 
        query: str, 
        page: int = 1, 
        limit: int = 20
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Search chunks by content with pagination"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                # Get total count
                cursor.execute("""
                    SELECT COUNT(*) FROM chunks 
                    WHERE content LIKE ?
                """, (f"%{query}%",))
                total_count = cursor.fetchone()[0]
                
                # Get paginated results
                offset = (page - 1) * limit
                cursor.execute("""
                    SELECT c.*, f.name as file_name, f.path as file_path, 
                           f.type as file_type, f.category
                    FROM chunks c
                    JOIN files f ON c.file_id = f.file_id
                    WHERE c.content LIKE ?
                    ORDER BY 
                        CASE 
                            WHEN c.content LIKE ? THEN 1  -- Exact phrase match
                            WHEN c.content LIKE ? THEN 2  -- Starts with query
                            ELSE 3                         -- Contains query
                        END,
                        LENGTH(c.content) - LENGTH(REPLACE(LOWER(c.content), LOWER(?), '')) DESC
                    LIMIT ? OFFSET ?
                """, (
                    f"%{query}%",
                    f"{query}%",
                    f"%{query}%",
                    query.lower(),
                    limit, 
                    offset
                ))
                
                rows = cursor.fetchall()
                results = []
                for row in rows:
                    chunk_dict = dict(row)
                    # Remove duplicate fields from join
                    chunk_dict.pop('file_name', None)
                    chunk_dict.pop('file_path', None)
                    chunk_dict.pop('file_type', None)
                    chunk_dict.pop('category', None)
                    results.append(chunk_dict)
                
                return results, total_count
                
        except Exception as e:
            logger.error(f"Failed to search chunks by content: {e}")
            return [], 0
    
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
    
    def update_file(self, file_id: str, updates: Dict[str, Any]) -> bool:
        """Update file metadata"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                # Build update query dynamically
                update_fields = []
                values = []
                
                if "category" in updates:
                    update_fields.append("category = ?")
                    values.append(updates["category"])
                
                if "summary" in updates:
                    update_fields.append("summary = ?")
                    values.append(updates["summary"])
                
                if "tags" in updates:
                    update_fields.append("tags = ?")
                    values.append(json.dumps(updates["tags"]))

                if "processed" in updates:
                    update_fields.append("processed = ?")
                    values.append(1 if updates["processed"] else 0)

                
                if not update_fields:
                    logger.warning(f"No valid fields to update for file {file_id}")
                    return False
                
                # Add updated_at timestamp
                update_fields.append("updated_at = ?")
                values.append(datetime.now().isoformat())
                
                # Add file_id for WHERE clause
                values.append(file_id)
                
                query = f"""
                    UPDATE files 
                    SET {', '.join(update_fields)}
                    WHERE file_id = ?
                """
                
                cursor.execute(query, values)
                conn.commit()
                
                if cursor.rowcount > 0:
                    logger.info(f"Updated file {file_id} with fields: {list(updates.keys())}")
                    return True
                else:
                    logger.warning(f"File {file_id} not found for update")
                    return False
                
        except Exception as e:
            logger.error(f"Failed to update file: {e}")
            return False
    
    def search_files_by_name(self, query: str, page: int = 1, limit: int = 20) -> Tuple[List[Dict[str, Any]], int]:
        """Search files by filename with fuzzy matching"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                # Build fuzzy search query using LIKE with wildcards
                search_pattern = f"%{query}%"
                
                # Get total count
                cursor.execute("""
                    SELECT COUNT(*) FROM files 
                    WHERE name LIKE ?
                """, (search_pattern,))
                total_count = cursor.fetchone()[0]
                
                # Get paginated results
                offset = (page - 1) * limit
                cursor.execute("""
                    SELECT * FROM files 
                    WHERE name LIKE ?
                    ORDER BY name ASC
                    LIMIT ? OFFSET ?
                """, (search_pattern, limit, offset))
                
                rows = cursor.fetchall()
                results = []
                
                for row in rows:
                    file_dict = {
                        "id": row[0],
                        "file_id": row[1],
                        "path": row[2],
                        "name": row[3],
                        "type": row[4],
                        "category": row[5],
                        "summary": row[6],
                        "tags": json.loads(row[7]) if row[7] else [],
                        "size": row[8],
                        "added_at": row[9],
                        "updated_at": row[10],
                        "processed": bool(row[11])
                    }
                    results.append(file_dict)
                
                return results, total_count
                
        except Exception as e:
            logger.error(f"Failed to search files by name: {e}")
            return [], 0
    
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

    def save_conversation(self, conversation_data: Dict[str, Any]) -> bool:
        """Save conversation to database"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()

                cursor.execute("""
                    INSERT INTO conversations (
                        conversation_id, session_id, question, answer,
                        sources_count, confidence, created_at, metadata
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    conversation_data['id'],
                    conversation_data['session_id'],
                    conversation_data['question'],
                    conversation_data['answer'],
                    conversation_data.get('sources_count', 0),
                    conversation_data.get('confidence', 0.0),
                    conversation_data.get('created_at', datetime.now().isoformat()),
                    json.dumps(conversation_data.get('metadata', {}))
                ))

                conn.commit()
                logger.info(f"Conversation saved: {conversation_data['id']}")
                return True

        except Exception as e:
            logger.error(f"Failed to save conversation: {e}")
            return False

    def get_conversations(self,
                         page: int = 1,
                         limit: int = 20,
                         session_id: str = None) -> Tuple[List[Dict[str, Any]], int]:
        """Get conversations with pagination and filtering"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()

                # Build query
                conditions = []
                params = []

                if session_id:
                    conditions.append("session_id = ?")
                    params.append(session_id)

                where_clause = " WHERE " + " AND ".join(conditions) if conditions else ""

                # Get total count
                count_query = f"SELECT COUNT(*) FROM conversations{where_clause}"
                cursor.execute(count_query, params)
                total_count = cursor.fetchone()[0]

                # Get paginated results
                offset = (page - 1) * limit
                query = f"""
                    SELECT * FROM conversations{where_clause}
                    ORDER BY created_at DESC
                    LIMIT ? OFFSET ?
                """
                params.extend([limit, offset])

                cursor.execute(query, params)
                rows = cursor.fetchall()

                conversations = []
                for row in rows:
                    conv_data = dict(row)
                    conv_data['metadata'] = json.loads(conv_data['metadata'] or '{}')
                    conversations.append(conv_data)

                return conversations, total_count

        except Exception as e:
            logger.error(f"Failed to get conversations: {e}")
            return [], 0

    def get_conversation_by_id(self, conversation_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific conversation by ID"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM conversations WHERE conversation_id = ?", (conversation_id,))

                row = cursor.fetchone()
                if row:
                    conv_data = dict(row)
                    conv_data['metadata'] = json.loads(conv_data['metadata'] or '{}')
                    return conv_data

                return None

        except Exception as e:
            logger.error(f"Failed to get conversation by ID: {e}")
            return None

    def delete_conversation(self, conversation_id: str) -> bool:
        """Delete a conversation by ID"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM conversations WHERE conversation_id = ?", (conversation_id,))
                conn.commit()

                deleted_count = cursor.rowcount
                if deleted_count > 0:
                    logger.info(f"Conversation deleted: {conversation_id}")
                    return True
                else:
                    logger.warning(f"Conversation not found: {conversation_id}")
                    return False

        except Exception as e:
            logger.error(f"Failed to delete conversation: {e}")
            return False
    
    def clear_all(self) -> bool:
        """Clear all data from all tables"""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                # Delete all data from tables (in correct order due to foreign keys)
                cursor.execute("DELETE FROM chunks")
                chunks_deleted = cursor.rowcount
                
                cursor.execute("DELETE FROM conversations")
                conversations_deleted = cursor.rowcount
                
                cursor.execute("DELETE FROM files")
                files_deleted = cursor.rowcount
                
                conn.commit()
                
                logger.info(f"Database cleared: {files_deleted} files, {chunks_deleted} chunks, {conversations_deleted} conversations")
                return True
                
        except Exception as e:
            logger.error(f"Failed to clear database: {e}")
            return False


# Global database manager instance
_db_manager = None


def get_db_manager() -> DatabaseManager:
    """Get global database manager instance"""
    global _db_manager
    if _db_manager is None:
        _db_manager = DatabaseManager()
    return _db_manager
