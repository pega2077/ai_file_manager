"""
Embedding 生成模块
负责文本向量化处理和LLM交互
"""
import os
import re
import json
import aiohttp
from typing import List, Dict, Any, Optional
import numpy as np
from pathlib import Path

from loguru import logger
from config import settings


class EmbeddingGenerator:
    """Embedding生成器 - 使用 SentenceTransformer 处理中文和多语言内容"""
    
    def __init__(self, model_name: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"):
        self.model_name = model_name
        self.model = None
        self.dimension = 384  # paraphrase-multilingual-MiniLM-L12-v2 的向量维度
        self._loading = False
        
        # 本地模型路径配置 - 优先使用配置文件设置
        if settings.embedding_cache_dir:
            self.local_model_dir = Path(settings.embedding_cache_dir)
        else:
            self.local_model_dir = Path(__file__).parent.parent / "models" / "embeddings"
        
        self.local_model_dir.mkdir(parents=True, exist_ok=True)
        
        # 如果配置了特定的本地模型路径，直接使用
        self.specific_local_path = settings.embedding_local_path
        
    def get_local_model_path(self) -> Path:
        """获取本地模型路径"""
        # 将模型名转换为安全的文件夹名
        safe_name = self.model_name.replace("/", "_").replace("\\", "_")
        return self.local_model_dir / safe_name
        
    def is_model_downloaded(self) -> bool:
        """检查模型是否已下载到本地"""
        local_path = self.get_local_model_path()
        # 检查关键文件是否存在
        return (local_path.exists() and 
                (local_path / "config.json").exists() and
                (local_path / "pytorch_model.bin").exists())
    
    def load_model(self):
        """加载embedding模型 - 优先使用本地模型"""
        if self._loading:
            return False
            
        try:
            self._loading = True
            logger.info(f"开始加载 embedding 模型: {self.model_name}")
            
            # 设置 Hugging Face 镜像源
            import os
            os.environ["HF_ENDPOINT"] = settings.hf_endpoint
            logger.info(f"使用 Hugging Face 镜像源: {settings.hf_endpoint}")
            
            from sentence_transformers import SentenceTransformer
            
            # 优先级1: 使用配置文件中指定的具体本地路径
            if self.specific_local_path and Path(self.specific_local_path).exists():
                logger.info(f"使用配置指定的本地路径: {self.specific_local_path}")
                self.model = SentenceTransformer(self.specific_local_path)
            else:
                # 优先级2: 尝试从默认本地缓存加载
                local_path = self.get_local_model_path()
                
                if self.is_model_downloaded():
                    logger.info(f"从本地缓存加载模型: {local_path}")
                    self.model = SentenceTransformer(str(local_path))
                else:
                    logger.info(f"本地模型不存在，从镜像源下载: {self.model_name}")
                    
                    # 从远程下载并缓存到本地
                    self.model = SentenceTransformer(
                        self.model_name,
                        cache_folder=str(self.local_model_dir.parent)
                    )
                    
                    # 保存到指定的本地路径
                    logger.info(f"保存模型到本地: {local_path}")
                    self.model.save(str(local_path))
            
            # 获取实际的向量维度
            self.dimension = self.model.get_sentence_embedding_dimension()
            
            logger.info(f"模型 {self.model_name} 加载完成，向量维度: {self.dimension}")
            return True
            
        except ImportError:
            logger.error("sentence-transformers 未安装，请安装: pip install sentence-transformers")
            return False
        except Exception as e:
            logger.error(f"加载embedding模型失败: {e}")
            return False
        finally:
            self._loading = False
    
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
                    raise RuntimeError("Embedding模型加载失败，无法生成embeddings。请检查模型配置和网络连接。")
            
            # 预处理中文文本，确保与批量处理保持一致
            processed_text = self.normalize_chinese_text(text)
            
            # 生成真正的embedding
            embedding = self.model.encode(processed_text, convert_to_tensor=False, normalize_embeddings=True)
            
            # 确保返回 Python list 格式
            if hasattr(embedding, 'tolist'):
                return embedding.tolist()
            else:
                return embedding.astype(float).tolist()
            
        except Exception as e:
            logger.error(f"生成embedding失败: {e}")
            raise RuntimeError(f"生成embedding失败: {str(e)}")
    
    def generate_embeddings_batch(self, texts: List[str]) -> List[Optional[np.ndarray]]:
        """批量生成embeddings - 更高效的批处理，返回numpy数组"""
        if not texts:
            return []
            
        try:
            if not self.is_model_loaded():
                if not self.load_model():
                    raise RuntimeError("Embedding模型加载失败，无法生成embeddings。请检查模型配置和网络连接。")
            
            # 预处理文本
            processed_texts = [self.normalize_chinese_text(text) for text in texts]
            
            # 过滤空文本并记录索引
            valid_texts = []
            valid_indices = []
            for i, text in enumerate(processed_texts):
                if text.strip():
                    valid_texts.append(text)
                    valid_indices.append(i)
            
            if not valid_texts:
                logger.warning("No valid texts provided for batch embedding generation")
                return [None] * len(texts)
            
            # 批量生成embeddings（更高效）
            logger.info(f"Generating embeddings for {len(valid_texts)} texts")
            embeddings = self.model.encode(
                valid_texts, 
                convert_to_tensor=False, 
                batch_size=32,
                show_progress_bar=False,
                normalize_embeddings=True
            )
            
            # 创建结果数组，为无效文本插入None
            results = [None] * len(texts)
            for i, valid_idx in enumerate(valid_indices):
                # 确保返回 numpy 数组格式
                embedding = embeddings[i]
                if not isinstance(embedding, np.ndarray):
                    embedding = np.array(embedding)
                results[valid_idx] = embedding.astype(np.float32)
            
            logger.info(f"Successfully generated {len(valid_texts)} embeddings")
            return results
            
        except Exception as e:
            logger.error(f"批量生成embedding失败: {e}")
            raise RuntimeError(f"批量生成embedding失败: {str(e)}")

    def normalize_chinese_text(self, text: str) -> str:
        """Normalize Chinese text for better embedding quality"""
        if not text:
            return ""
        
        # Basic text cleaning
        text = re.sub(r'\s+', ' ', text)  # Normalize whitespace
        text = text.strip()
        
        # Handle Chinese punctuation normalization
        chinese_punct_map = {
            '，': ', ',
            '。': '. ',
            '！': '! ',
            '？': '? ',
            '；': '; ',
            '：': ': ',
            '"': '"',
            '"': '"',
            ''': "'",
            ''': "'",
            '（': ' (',
            '）': ') ',
            '【': ' [',
            '】': '] '
        }
        
        for chinese, english in chinese_punct_map.items():
            text = text.replace(chinese, english)
        
        # Clean up extra spaces
        text = re.sub(r'\s+', ' ', text).strip()
        
        return text
    
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
            "status": "loaded" if self.is_model_loaded() else "not_loaded",
            "supports_multilingual": True,
            "supports_chinese": True,
            "local_model_path": str(self.get_local_model_path()),
            "is_model_downloaded": self.is_model_downloaded(),
            "local_model_dir": str(self.local_model_dir)
        }
    
    def download_model(self, force_download: bool = False) -> bool:
        """预下载模型到本地"""
        try:
            if self.is_model_downloaded() and not force_download:
                logger.info("模型已存在于本地，跳过下载")
                return True
            
            logger.info(f"开始下载模型: {self.model_name}")
            
            # 设置 Hugging Face 镜像源
            import os
            os.environ["HF_ENDPOINT"] = settings.hf_endpoint
            logger.info(f"使用 Hugging Face 镜像源: {settings.hf_endpoint}")
            
            from sentence_transformers import SentenceTransformer
            
            # 下载模型
            model = SentenceTransformer(
                self.model_name,
                cache_folder=str(self.local_model_dir.parent)
            )
            
            # 保存到指定路径
            local_path = self.get_local_model_path()
            model.save(str(local_path))
            
            logger.info(f"模型下载完成: {local_path}")
            return True
            
        except Exception as e:
            logger.error(f"下载模型失败: {e}")
            return False
    
    def load_from_local_path(self, local_path: str) -> bool:
        """从指定的本地路径加载模型"""
        try:
            logger.info(f"从指定路径加载模型: {local_path}")
            
            from sentence_transformers import SentenceTransformer
            
            local_path_obj = Path(local_path)
            if not local_path_obj.exists():
                logger.error(f"本地模型路径不存在: {local_path}")
                return False
            
            self.model = SentenceTransformer(str(local_path_obj))
            self.dimension = self.model.get_sentence_embedding_dimension()
            
            logger.info(f"从本地路径加载模型成功，维度: {self.dimension}")
            return True
            
        except Exception as e:
            logger.error(f"从本地路径加载模型失败: {e}")
            return False
    
    def clear_local_cache(self) -> bool:
        """清除本地缓存的模型"""
        try:
            import shutil
            
            if self.local_model_dir.exists():
                shutil.rmtree(self.local_model_dir)
                logger.info(f"已清除本地模型缓存: {self.local_model_dir}")
                return True
            else:
                logger.info("本地模型缓存不存在")
                return True
                
        except Exception as e:
            logger.error(f"清除本地缓存失败: {e}")
            return False
    
    def preprocess_chinese_text(self, text: str) -> str:
        """预处理中文文本"""
        if not text:
            return text
            
        # 移除多余的空白字符
        text = ' '.join(text.split())
        
        # 处理中英文之间的空格
        import re
        # 在中文和英文/数字之间添加空格
        text = re.sub(r'([\u4e00-\u9fff])([a-zA-Z0-9])', r'\1 \2', text)
        text = re.sub(r'([a-zA-Z0-9])([\u4e00-\u9fff])', r'\1 \2', text)
        
        return text.strip()
    
    def split_chinese_text(self, text: str, max_length: int = 512) -> List[str]:
        """按适当的长度分割中文文本，避免破坏句子结构"""
        if not text or len(text) <= max_length:
            return [text] if text else []
        
        # 中文句子分隔符
        sentence_endings = ['。', '！', '？', '；', '\n']
        chunks = []
        current_chunk = ""
        
        sentences = []
        current_sentence = ""
        
        # 先按句子分割
        for char in text:
            current_sentence += char
            if char in sentence_endings:
                sentences.append(current_sentence.strip())
                current_sentence = ""
        
        # 如果还有剩余内容
        if current_sentence.strip():
            sentences.append(current_sentence.strip())
        
        # 合并句子到chunks
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


class LLMClient:
    """Large Language Model client for various providers"""
    
    def __init__(self):
        self.llm_type = settings.llm_type
        self.llm_endpoint = settings.llm_endpoint
        self.llm_api_key = settings.llm_api_key
        self.llm_model = settings.llm_model
        
    async def generate_response(self, prompt: str, temperature: float = 0.7, max_tokens: int = 1000) -> str:
        """Generate response from LLM"""
        logger.debug(f"Generating response using {self.llm_type} model")
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

        # logger.debug(f"Calling Ollama API with payload: {payload}")
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload) as response:
                    if response.status == 200:
                        result = await response.json()
                        # logger.debug(f"Ollama response: {result}")
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
