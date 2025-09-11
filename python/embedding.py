"""
Embedding 生成模块
负责文本向量化处理和LLM交互
"""
import os
import json
import aiohttp
from typing import List, Dict, Any, Optional
import numpy as np
from pathlib import Path

from loguru import logger
from config import settings


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


class LLMClient:
    """Large Language Model client for various providers"""
    
    def __init__(self):
        self.llm_type = settings.llm_type
        self.llm_endpoint = settings.llm_endpoint
        self.llm_api_key = settings.llm_api_key
        self.llm_model = settings.llm_model
        
    async def generate_response(self, prompt: str, temperature: float = 0.7, max_tokens: int = 1000) -> str:
        """Generate response from LLM"""
        try:
            if self.llm_type == "ollama":
                return await self._call_ollama(prompt, temperature, max_tokens)
            elif self.llm_type == "openai":
                return await self._call_openai(prompt, temperature, max_tokens)
            elif self.llm_type == "claude":
                return await self._call_claude(prompt, temperature, max_tokens)
            elif self.llm_type == "aliyun":
                return await self._call_aliyun(prompt, temperature, max_tokens)
            elif self.llm_type == "local":
                return await self._call_local(prompt, temperature, max_tokens)
            else:
                logger.error(f"Unsupported LLM type: {self.llm_type}")
                return self._fallback_response(prompt)
                
        except Exception as e:
            logger.error(f"Error generating LLM response: {e}")
            return self._fallback_response(prompt)
    
    async def _call_ollama(self, prompt: str, temperature: float, max_tokens: int) -> str:
        """Call Ollama API"""
        url = f"{self.llm_endpoint}/api/generate"
        
        payload = {
            "model": self.llm_model or "llama2",
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens
            },
            "think": False
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload) as response:
                    if response.status == 200:
                        result = await response.json()
                        return result.get("response", "")
                    else:
                        logger.error(f"Ollama API error: {response.status}")
                        return self._fallback_response(prompt)
        except Exception as e:
            logger.error(f"Error calling Ollama: {e}")
            return self._fallback_response(prompt)
    
    async def _call_openai(self, prompt: str, temperature: float, max_tokens: int) -> str:
        """Call OpenAI API"""
        url = f"{self.llm_endpoint}/chat/completions"
        
        headers = {
            "Authorization": f"Bearer {self.llm_api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": self.llm_model or "gpt-3.5-turbo",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": temperature,
            "max_tokens": max_tokens
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers) as response:
                    if response.status == 200:
                        result = await response.json()
                        return result["choices"][0]["message"]["content"]
                    else:
                        logger.error(f"OpenAI API error: {response.status}")
                        return self._fallback_response(prompt)
        except Exception as e:
            logger.error(f"Error calling OpenAI: {e}")
            return self._fallback_response(prompt)
    
    async def _call_claude(self, prompt: str, temperature: float, max_tokens: int) -> str:
        """Call Claude API"""
        url = f"{self.llm_endpoint}/v1/messages"
        
        headers = {
            "x-api-key": self.llm_api_key,
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01"
        }
        
        payload = {
            "model": self.llm_model or "claude-3-sonnet-20240229",
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "temperature": temperature
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers) as response:
                    if response.status == 200:
                        result = await response.json()
                        return result["content"][0]["text"]
                    else:
                        logger.error(f"Claude API error: {response.status}")
                        return self._fallback_response(prompt)
        except Exception as e:
            logger.error(f"Error calling Claude: {e}")
            return self._fallback_response(prompt)
    
    async def _call_aliyun(self, prompt: str, temperature: float, max_tokens: int) -> str:
        """Call Aliyun API"""
        # Implement Aliyun API call based on their specific requirements
        url = f"{self.llm_endpoint}/v1/services/aigc/text-generation/generation"
        
        headers = {
            "Authorization": f"Bearer {self.llm_api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": self.llm_model or "qwen-turbo",
            "input": {
                "prompt": prompt
            },
            "parameters": {
                "temperature": temperature,
                "max_tokens": max_tokens
            }
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers) as response:
                    if response.status == 200:
                        result = await response.json()
                        return result["output"]["text"]
                    else:
                        logger.error(f"Aliyun API error: {response.status}")
                        return self._fallback_response(prompt)
        except Exception as e:
            logger.error(f"Error calling Aliyun: {e}")
            return self._fallback_response(prompt)
    
    async def _call_local(self, prompt: str, temperature: float, max_tokens: int) -> str:
        """Call local LLM service"""
        # This could be a local model server or a simple rule-based response
        return self._fallback_response(prompt)
    
    def _fallback_response(self, prompt: str) -> str:
        """Provide fallback response when LLM is not available"""
        # Simple rule-based categorization for file management
        prompt_lower = prompt.lower()
        
        if "categorize" in prompt_lower or "category" in prompt_lower:
            # Extract filename from prompt
            if ".pdf" in prompt_lower or ".doc" in prompt_lower:
                return '{"suggested_category": "Documents", "confidence": 0.8, "reason": "Document file type detected", "existing_category": null}'
            elif ".ppt" in prompt_lower:
                return '{"suggested_category": "Presentations", "confidence": 0.8, "reason": "Presentation file type detected", "existing_category": null}'
            elif ".xls" in prompt_lower or ".csv" in prompt_lower:
                return '{"suggested_category": "Spreadsheets", "confidence": 0.8, "reason": "Spreadsheet file type detected", "existing_category": null}'
            elif "meeting" in prompt_lower:
                return '{"suggested_category": "Meetings", "confidence": 0.7, "reason": "Meeting-related content detected", "existing_category": null}'
            elif "project" in prompt_lower:
                return '{"suggested_category": "Projects", "confidence": 0.7, "reason": "Project-related content detected", "existing_category": null}'
            else:
                return '{"suggested_category": "Documents", "confidence": 0.5, "reason": "Default categorization", "existing_category": null}'
        
        return "Response generated by fallback system. LLM service is not available."


# Global instances
_embedding_generator = None
_llm_client = None


def get_embedding_generator() -> EmbeddingGenerator:
    """Get global embedding generator instance"""
    global _embedding_generator
    if _embedding_generator is None:
        _embedding_generator = EmbeddingGenerator(settings.embedding_model)
    return _embedding_generator


def get_llm_client() -> Optional[LLMClient]:
    """Get global LLM client instance"""
    global _llm_client
    
    try:
        if _llm_client is None:
            _llm_client = LLMClient()
        return _llm_client
    except Exception as e:
        logger.error(f"Failed to initialize LLM client: {e}")
        return None
