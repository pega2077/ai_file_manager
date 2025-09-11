"""
向量数据库模块
负责向量存储和检索
"""
import os
import pickle
from typing import List, Dict, Any, Optional, Tuple
from pathlib import Path
import numpy as np
import faiss
from loguru import logger


class VectorDatabase:
    """向量数据库（基于Faiss实现）"""
    
    def __init__(self, database_path: Path, dimension: int = 384):
        self.database_path = database_path
        self.dimension = dimension
        self.index = None
        self.metadata = {}  # 存储embedding对应的元数据
        self.is_loaded = False
        
        # 确保数据库目录存在
        self.database_path.mkdir(parents=True, exist_ok=True)
        self.index_file = self.database_path / "faiss_index.bin"
        self.metadata_file = self.database_path / "metadata.pkl"
    
    def initialize(self):
        """初始化向量数据库"""
        try:
            # TODO: 实际初始化Faiss索引
            # import faiss
            # self.index = faiss.IndexFlatIP(self.dimension)  # 内积索引
            
            # 如果存在已保存的索引，则加载
            if self.index_file.exists():
                self.load_index()
            else:
                logger.info("创建新的向量索引")
                # self.index = faiss.IndexFlatIP(self.dimension)
                
            # 加载元数据
            if self.metadata_file.exists():
                self.load_metadata()
            
            self.is_loaded = True
            logger.info("向量数据库初始化完成")
            return True
            
        except Exception as e:
            logger.error(f"初始化向量数据库失败: {e}")
            return False
    
    def load_index(self):
        """加载已保存的索引"""
        try:
            # TODO: 实际加载Faiss索引
            # import faiss
            # self.index = faiss.read_index(str(self.index_file))
            logger.info(f"加载向量索引: {self.index_file}")
        except Exception as e:
            logger.error(f"加载向量索引失败: {e}")
    
    def save_index(self):
        """保存索引到文件"""
        try:
            # TODO: 实际保存Faiss索引
            # import faiss
            # faiss.write_index(self.index, str(self.index_file))
            logger.info(f"保存向量索引: {self.index_file}")
        except Exception as e:
            logger.error(f"保存向量索引失败: {e}")
    
    def load_metadata(self):
        """加载元数据"""
        try:
            with open(self.metadata_file, 'rb') as f:
                self.metadata = pickle.load(f)
            logger.info(f"加载元数据，包含 {len(self.metadata)} 条记录")
        except Exception as e:
            logger.error(f"加载元数据失败: {e}")
            self.metadata = {}
    
    def save_metadata(self):
        """保存元数据"""
        try:
            with open(self.metadata_file, 'wb') as f:
                pickle.dump(self.metadata, f)
            logger.info(f"保存元数据，包含 {len(self.metadata)} 条记录")
        except Exception as e:
            logger.error(f"保存元数据失败: {e}")
    
    def add_embedding(self, embedding_id: str, embedding: List[float], metadata: Dict[str, Any]):
        """添加embedding到数据库"""
        try:
            if not self.is_loaded:
                if not self.initialize():
                    return False
            
            # TODO: 实际添加到Faiss索引
            # embedding_array = np.array([embedding], dtype=np.float32)
            # self.index.add(embedding_array)
            
            # 保存元数据
            self.metadata[embedding_id] = {
                **metadata,
                "embedding_id": embedding_id,
                "index_id": len(self.metadata)  # 在Faiss中的索引位置
            }
            
            logger.debug(f"添加embedding: {embedding_id}")
            return True
            
        except Exception as e:
            logger.error(f"添加embedding失败: {e}")
            return False
    
    def add_embeddings_batch(self, embeddings_data: List[Dict[str, Any]]):
        """批量添加embeddings"""
        success_count = 0
        for data in embeddings_data:
            embedding_id = data.get("embedding_id")
            embedding = data.get("embedding")
            metadata = data.get("metadata", {})
            
            if self.add_embedding(embedding_id, embedding, metadata):
                success_count += 1
        
        # 保存到文件
        if success_count > 0:
            self.save_index()
            self.save_metadata()
        
        logger.info(f"批量添加完成，成功: {success_count}/{len(embeddings_data)}")
        return success_count
    
    def search_similar(
        self, 
        query_embedding: List[float], 
        limit: int = 10,
        similarity_threshold: float = 0.7
    ) -> List[Dict[str, Any]]:
        """搜索相似的embeddings"""
        try:
            if not self.is_loaded or not self.metadata:
                return []
            
            # TODO: 实际使用Faiss搜索
            # query_array = np.array([query_embedding], dtype=np.float32)
            # scores, indices = self.index.search(query_array, min(limit * 2, len(self.metadata)))
            
            # 暂时返回模拟结果
            results = []
            for i, (embedding_id, metadata) in enumerate(self.metadata.items()):
                if i >= limit:
                    break
                    
                # 模拟相似度分数
                similarity_score = np.random.uniform(similarity_threshold, 1.0)
                
                if similarity_score >= similarity_threshold:
                    results.append({
                        "embedding_id": embedding_id,
                        "similarity_score": similarity_score,
                        "metadata": metadata
                    })
            
            # 按相似度排序
            results.sort(key=lambda x: x["similarity_score"], reverse=True)
            return results[:limit]
            
        except Exception as e:
            logger.error(f"相似度搜索失败: {e}")
            return []
    
    def delete_embedding(self, embedding_id: str) -> bool:
        """删除指定的embedding"""
        try:
            if embedding_id in self.metadata:
                # TODO: 实际从Faiss索引中删除比较复杂，可能需要重建索引
                del self.metadata[embedding_id]
                self.save_metadata()
                logger.info(f"删除embedding: {embedding_id}")
                return True
            else:
                logger.warning(f"Embedding不存在: {embedding_id}")
                return False
                
        except Exception as e:
            logger.error(f"删除embedding失败: {e}")
            return False
    
    def delete_embeddings_by_file(self, file_id: str) -> int:
        """删除指定文件的所有embeddings"""
        deleted_count = 0
        try:
            embedding_ids_to_delete = []
            
            for embedding_id, metadata in self.metadata.items():
                if metadata.get("file_id") == file_id:
                    embedding_ids_to_delete.append(embedding_id)
            
            for embedding_id in embedding_ids_to_delete:
                if self.delete_embedding(embedding_id):
                    deleted_count += 1
            
            logger.info(f"删除文件 {file_id} 的 {deleted_count} 个embeddings")
            return deleted_count
            
        except Exception as e:
            logger.error(f"删除文件embeddings失败: {e}")
            return deleted_count
    
    def get_statistics(self) -> Dict[str, Any]:
        """获取数据库统计信息"""
        return {
            "total_embeddings": len(self.metadata),
            "dimension": self.dimension,
            "is_loaded": self.is_loaded,
            "database_path": str(self.database_path)
        }
    
    def rebuild_index(self):
        """重建索引（用于删除操作后的优化）"""
        try:
            # TODO: 重建Faiss索引
            logger.info("重建向量索引...")
            # 重新创建索引并添加所有现有的embeddings
            # 这里需要重新加载所有embeddings并重建索引
            self.save_index()
            self.save_metadata()
            logger.info("向量索引重建完成")
            
        except Exception as e:
            logger.error(f"重建索引失败: {e}")


