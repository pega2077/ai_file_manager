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
            # 如果存在已保存的索引，则加载
            if self.index_file.exists():
                self.load_index()
            else:
                logger.info("创建新的向量索引")
                # 使用内积索引，适合归一化的embeddings
                self.index = faiss.IndexFlatIP(self.dimension)
                
            # 加载元数据
            if self.metadata_file.exists():
                self.load_metadata()
            
            self.is_loaded = True
            logger.info(f"向量数据库初始化完成，维度: {self.dimension}")
            return True
            
        except Exception as e:
            logger.error(f"初始化向量数据库失败: {e}")
            return False
    
    def load_index(self):
        """加载已保存的索引"""
        try:
            self.index = faiss.read_index(str(self.index_file))
            logger.info(f"加载向量索引: {self.index_file}, 包含 {self.index.ntotal} 个向量")
        except Exception as e:
            logger.error(f"加载向量索引失败: {e}")
            # 如果加载失败，创建新索引
            self.index = faiss.IndexFlatIP(self.dimension)
    
    def save_index(self):
        """保存索引到文件"""
        try:
            if self.index is not None:
                faiss.write_index(self.index, str(self.index_file))
                logger.info(f"保存向量索引: {self.index_file}, 包含 {self.index.ntotal} 个向量")
            else:
                logger.warning("索引为空，跳过保存")
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
            
            # 检查embedding维度
            if len(embedding) != self.dimension:
                logger.error(f"Embedding维度不匹配: 期望{self.dimension}, 实际{len(embedding)}")
                return False
            
            # 将embedding转换为numpy数组并归一化
            embedding_array = np.array([embedding], dtype=np.float32)
            
            # L2归一化，用于内积搜索
            faiss.normalize_L2(embedding_array)
            
            # 添加到Faiss索引
            self.index.add(embedding_array)
            
            # 保存元数据，记录在索引中的位置
            current_index = self.index.ntotal - 1
            self.metadata[embedding_id] = {
                **metadata,
                "embedding_id": embedding_id,
                "index_id": current_index  # 在Faiss中的索引位置
            }
            
            logger.debug(f"添加embedding: {embedding_id}, 索引位置: {current_index}")
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
            if not self.is_loaded or not self.metadata or self.index.ntotal == 0:
                return []
            
            # 检查query embedding维度
            if len(query_embedding) != self.dimension:
                logger.error(f"Query embedding维度不匹配: 期望{self.dimension}, 实际{len(query_embedding)}")
                return []
            
            # 将query embedding转换为numpy数组并归一化
            query_array = np.array([query_embedding], dtype=np.float32)
            faiss.normalize_L2(query_array)
            
            # 搜索最相似的向量
            # 搜索数量应该至少是limit，但不超过索引中的总数
            search_k = min(limit * 2, self.index.ntotal)
            scores, indices = self.index.search(query_array, search_k)
            
            # 解析搜索结果
            results = []
            for i in range(search_k):
                index_id = indices[0][i]
                score = float(scores[0][i])
                
                # 跳过无效索引
                if index_id == -1:
                    continue
                
                # 应用相似度阈值过滤
                if score < similarity_threshold:
                    continue
                
                # 查找对应的metadata
                embedding_id = None
                metadata = None
                for eid, meta in self.metadata.items():
                    if meta.get("index_id") == index_id:
                        embedding_id = eid
                        metadata = meta
                        break
                
                if embedding_id and metadata:
                    results.append({
                        "embedding_id": embedding_id,
                        "similarity_score": score,
                        "metadata": metadata
                    })
                
                # 达到限制数量就停止
                if len(results) >= limit:
                    break
            
            # 按相似度分数降序排序
            results.sort(key=lambda x: x["similarity_score"], reverse=True)
            
            logger.debug(f"相似度搜索完成，找到 {len(results)} 个结果")
            return results
            
        except Exception as e:
            logger.error(f"相似度搜索失败: {e}")
            return []
    
    def delete_embedding(self, embedding_id: str) -> bool:
        """删除指定的embedding"""
        try:
            if embedding_id in self.metadata:
                # 注意：FAISS不直接支持删除单个向量
                # 这里只删除元数据，实际向量仍在索引中
                # 如果需要真正删除，需要调用rebuild_index()重建索引
                del self.metadata[embedding_id]
                self.save_metadata()
                logger.info(f"删除embedding元数据: {embedding_id} (需要重建索引以完全删除)")
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
        stats = {
            "total_embeddings": len(self.metadata),
            "dimension": self.dimension,
            "is_loaded": self.is_loaded,
            "database_path": str(self.database_path)
        }
        
        if self.is_loaded and self.index is not None:
            stats["index_total_vectors"] = self.index.ntotal
            stats["index_dimension"] = self.index.d
        
        return stats
    
    def get_embedding_by_id(self, embedding_id: str) -> Optional[Dict[str, Any]]:
        """根据embedding_id获取元数据"""
        return self.metadata.get(embedding_id)
    
    def list_embeddings_by_file(self, file_id: str) -> List[Dict[str, Any]]:
        """获取指定文件的所有embeddings"""
        results = []
        for embedding_id, metadata in self.metadata.items():
            if metadata.get("file_id") == file_id:
                results.append({
                    "embedding_id": embedding_id,
                    "metadata": metadata
                })
        return results
    
    def clear_all(self) -> bool:
        """清空所有数据"""
        try:
            # 重新创建空索引
            self.index = faiss.IndexFlatIP(self.dimension)
            self.metadata = {}
            
            # 删除索引和元数据文件
            if self.index_file.exists():
                self.index_file.unlink()
            if self.metadata_file.exists():
                self.metadata_file.unlink()
            
            logger.info("向量数据库已清空")
            return True
            
        except Exception as e:
            logger.error(f"清空向量数据库失败: {e}")
            return False
    
    def rebuild_index(self):
        """重建索引（用于删除操作后的优化）"""
        try:
            logger.info("开始重建向量索引...")
            
            # 收集所有仍然有效的embeddings
            valid_embeddings = []
            valid_metadata = {}
            
            # 这里需要从某处重新获取embeddings数据
            # 由于我们没有存储原始embeddings，这里只能重新创建空索引
            # 在实际应用中，应该从数据库或其他存储中重新获取embeddings
            
            # 创建新的空索引
            new_index = faiss.IndexFlatIP(self.dimension)
            
            # 更新索引和元数据
            old_count = self.index.ntotal if self.index else 0
            self.index = new_index
            
            # 重新分配index_id
            for i, (embedding_id, metadata) in enumerate(self.metadata.items()):
                metadata["index_id"] = i
                valid_metadata[embedding_id] = metadata
            
            self.metadata = valid_metadata
            
            # 保存重建后的索引和元数据
            self.save_index()
            self.save_metadata()
            
            logger.info(f"向量索引重建完成，从 {old_count} 个向量重建为 {self.index.ntotal} 个向量")
            
        except Exception as e:
            logger.error(f"重建索引失败: {e}")
    
    def add_embeddings_from_chunks(self, chunks_with_embeddings: List[Dict[str, Any]]):
        """从chunks重新添加embeddings到重建的索引"""
        try:
            added_count = 0
            for chunk_data in chunks_with_embeddings:
                embedding_id = chunk_data.get("embedding_id")
                embedding = chunk_data.get("embedding")
                metadata = chunk_data.get("metadata", {})
                
                if embedding_id and embedding and embedding_id in self.metadata:
                    # 重新添加embedding到索引
                    embedding_array = np.array([embedding], dtype=np.float32)
                    faiss.normalize_L2(embedding_array)
                    self.index.add(embedding_array)
                    
                    # 更新metadata中的index_id
                    self.metadata[embedding_id]["index_id"] = self.index.ntotal - 1
                    added_count += 1
            
            logger.info(f"重建索引时添加了 {added_count} 个embeddings")
            
            # 保存更新后的索引和元数据
            self.save_index()
            self.save_metadata()
            
        except Exception as e:
            logger.error(f"重建索引时添加embeddings失败: {e}")


