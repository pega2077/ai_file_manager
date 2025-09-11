"""
Embedding 生成模块
负责文本向量化处理
"""
import os
from typing import List, Dict, Any, Optional
import numpy as np
from pathlib import Path

from loguru import logger


class EmbeddingGenerator:
    """Embedding生成器"""
    
    def __init__(self, model_name: str = "sentence-transformers/all-MiniLM-L6-v2"):
        self.model_name = model_name
        self.model = None
        self.dimension = 384  # all-MiniLM-L6-v2 的向量维度
        
    def load_model(self):
        """加载embedding模型"""
        try:
            # TODO: 实际加载sentence-transformers模型
            # from sentence_transformers import SentenceTransformer
            # self.model = SentenceTransformer(self.model_name)
            logger.info(f"模型 {self.model_name} 加载完成（模拟）")
            return True
        except Exception as e:
            logger.error(f"加载embedding模型失败: {e}")
            return False
    
    def is_model_loaded(self) -> bool:
        """检查模型是否已加载"""
        return self.model is not None
    
    def generate_embedding(self, text: str) -> Optional[List[float]]:
        """为单个文本生成embedding"""
        if not text.strip():
            return None
            
        try:
            if not self.is_model_loaded():
                if not self.load_model():
                    return None
            
            # TODO: 实际生成embedding
            # embedding = self.model.encode(text)
            # return embedding.tolist()
            
            # 暂时返回随机向量（用于测试）
            return np.random.rand(self.dimension).tolist()
            
        except Exception as e:
            logger.error(f"生成embedding失败: {e}")
            return None
    
    def generate_embeddings_batch(self, texts: List[str]) -> List[Optional[List[float]]]:
        """批量生成embeddings"""
        if not texts:
            return []
            
        try:
            if not self.is_model_loaded():
                if not self.load_model():
                    return [None] * len(texts)
            
            embeddings = []
            for text in texts:
                embedding = self.generate_embedding(text)
                embeddings.append(embedding)
            
            return embeddings
            
        except Exception as e:
            logger.error(f"批量生成embedding失败: {e}")
            return [None] * len(texts)
    
    def compute_similarity(self, embedding1: List[float], embedding2: List[float]) -> float:
        """计算两个embedding的相似度（余弦相似度）"""
        try:
            vec1 = np.array(embedding1)
            vec2 = np.array(embedding2)
            
            # 余弦相似度
            dot_product = np.dot(vec1, vec2)
            norm1 = np.linalg.norm(vec1)
            norm2 = np.linalg.norm(vec2)
            
            if norm1 == 0 or norm2 == 0:
                return 0.0
                
            similarity = dot_product / (norm1 * norm2)
            return float(similarity)
            
        except Exception as e:
            logger.error(f"计算相似度失败: {e}")
            return 0.0
    
    def get_model_info(self) -> Dict[str, Any]:
        """获取模型信息"""
        return {
            "model_name": self.model_name,
            "dimension": self.dimension,
            "is_loaded": self.is_model_loaded(),
            "status": "loaded" if self.is_model_loaded() else "not_loaded"
        }
