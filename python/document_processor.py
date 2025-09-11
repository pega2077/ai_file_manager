"""
文档处理模块
负责文档转换、分段、分类和摘要生成
"""
import os
import re
from typing import List, Dict, Any, Optional, Tuple
from pathlib import Path
import hashlib

from loguru import logger


class DocumentProcessor:
    """文档处理器"""
    
    def __init__(self, chunk_size: int = 1000, chunk_overlap: int = 200):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        
    def detect_file_type(self, file_path: Path) -> str:
        """检测文件类型"""
        suffix = file_path.suffix.lower()
        type_mapping = {
            '.txt': 'text',
            '.md': 'markdown',
            '.pdf': 'pdf',
            '.docx': 'word',
            '.doc': 'word',
            '.html': 'html',
            '.htm': 'html',
            '.rtf': 'rtf',
            '.odt': 'odt'
        }
        return type_mapping.get(suffix, 'unknown')
    
    def extract_text(self, file_path: Path) -> str:
        """从文件中提取文本内容"""
        try:
            file_type = self.detect_file_type(file_path)
            
            if file_type in ['text', 'markdown']:
                return self._extract_text_file(file_path)
            elif file_type == 'pdf':
                return self._extract_pdf(file_path)
            elif file_type == 'word':
                return self._extract_word(file_path)
            elif file_type in ['html', 'htm']:
                return self._extract_html(file_path)
            else:
                logger.warning(f"不支持的文件类型: {file_type}")
                return ""
                
        except Exception as e:
            logger.error(f"提取文本失败 {file_path}: {e}")
            return ""
    
    def _extract_text_file(self, file_path: Path) -> str:
        """提取纯文本文件内容"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()
        except UnicodeDecodeError:
            # 尝试其他编码
            for encoding in ['gbk', 'gb2312', 'latin1']:
                try:
                    with open(file_path, 'r', encoding=encoding) as f:
                        return f.read()
                except:
                    continue
            logger.error(f"无法解码文件: {file_path}")
            return ""
    
    def _extract_pdf(self, file_path: Path) -> str:
        """提取PDF文件内容（待实现）"""
        # TODO: 使用 PyPDF2 或 pdfplumber 提取PDF内容
        logger.warning("PDF提取功能待实现")
        return ""
    
    def _extract_word(self, file_path: Path) -> str:
        """提取Word文档内容（待实现）"""
        # TODO: 使用 python-docx 提取Word内容
        logger.warning("Word文档提取功能待实现")
        return ""
    
    def _extract_html(self, file_path: Path) -> str:
        """提取HTML文件内容（待实现）"""
        # TODO: 使用 BeautifulSoup 提取HTML内容
        logger.warning("HTML提取功能待实现")
        return ""
    
    def split_text_into_chunks(self, text: str, metadata: Optional[Dict] = None) -> List[Dict[str, Any]]:
        """将文本分割成chunks"""
        if not text.strip():
            return []
        
        chunks = []
        
        # 按段落分割
        paragraphs = text.split('\n\n')
        
        current_chunk = ""
        chunk_index = 0
        
        for paragraph in paragraphs:
            paragraph = paragraph.strip()
            if not paragraph:
                continue
            
            # 如果当前chunk加上新段落超过限制
            if len(current_chunk) + len(paragraph) > self.chunk_size:
                if current_chunk:
                    # 保存当前chunk
                    chunks.append(self._create_chunk(
                        content=current_chunk.strip(),
                        chunk_index=chunk_index,
                        metadata=metadata
                    ))
                    chunk_index += 1
                    
                    # 处理overlap
                    if self.chunk_overlap > 0:
                        overlap_text = current_chunk[-self.chunk_overlap:]
                        current_chunk = overlap_text + "\n\n" + paragraph
                    else:
                        current_chunk = paragraph
                else:
                    # 如果单个段落就超过限制，强制分割
                    if len(paragraph) > self.chunk_size:
                        sub_chunks = self._split_long_paragraph(paragraph, chunk_index, metadata)
                        chunks.extend(sub_chunks)
                        chunk_index += len(sub_chunks)
                        current_chunk = ""
                    else:
                        current_chunk = paragraph
            else:
                # 添加到当前chunk
                if current_chunk:
                    current_chunk += "\n\n" + paragraph
                else:
                    current_chunk = paragraph
        
        # 处理最后一个chunk
        if current_chunk.strip():
            chunks.append(self._create_chunk(
                content=current_chunk.strip(),
                chunk_index=chunk_index,
                metadata=metadata
            ))
        
        return chunks
    
    def _create_chunk(self, content: str, chunk_index: int, metadata: Optional[Dict] = None) -> Dict[str, Any]:
        """创建chunk对象"""
        chunk = {
            "chunk_index": chunk_index,
            "content": content,
            "content_type": self._detect_content_type(content),
            "char_count": len(content),
            "token_count": self._estimate_token_count(content),
            "metadata": metadata or {}
        }
        
        # 生成chunk的唯一ID
        chunk["id"] = self._generate_chunk_id(content, chunk_index)
        
        return chunk
    
    def _split_long_paragraph(self, paragraph: str, start_index: int, metadata: Optional[Dict] = None) -> List[Dict[str, Any]]:
        """分割过长的段落"""
        chunks = []
        sentences = re.split(r'[.!?。！？]', paragraph)
        
        current_chunk = ""
        chunk_index = start_index
        
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
                
            if len(current_chunk) + len(sentence) > self.chunk_size:
                if current_chunk:
                    chunks.append(self._create_chunk(
                        content=current_chunk.strip(),
                        chunk_index=chunk_index,
                        metadata=metadata
                    ))
                    chunk_index += 1
                    current_chunk = sentence
                else:
                    # 如果单个句子就超过限制，按字符强制分割
                    if len(sentence) > self.chunk_size:
                        for i in range(0, len(sentence), self.chunk_size):
                            chunk_text = sentence[i:i + self.chunk_size]
                            chunks.append(self._create_chunk(
                                content=chunk_text,
                                chunk_index=chunk_index,
                                metadata=metadata
                            ))
                            chunk_index += 1
                    else:
                        current_chunk = sentence
            else:
                if current_chunk:
                    current_chunk += ". " + sentence
                else:
                    current_chunk = sentence
        
        if current_chunk.strip():
            chunks.append(self._create_chunk(
                content=current_chunk.strip(),
                chunk_index=chunk_index,
                metadata=metadata
            ))
        
        return chunks
    
    def _detect_content_type(self, content: str) -> str:
        """检测内容类型"""
        content = content.strip()
        
        # 检测标题
        if content.startswith('#') or (len(content) < 100 and '\n' not in content):
            return "heading"
        
        # 检测代码块
        if '```' in content or content.startswith('    ') or content.startswith('\t'):
            return "code"
        
        # 检测表格
        if '|' in content and '-' in content:
            lines = content.split('\n')
            if len(lines) >= 2 and '|' in lines[0] and '|' in lines[1]:
                return "table"
        
        return "text"
    
    def _estimate_token_count(self, text: str) -> int:
        """估算token数量（简单估算：英文按空格分割，中文按字符计算）"""
        # 简单估算：平均每个token约4个字符
        return len(text) // 4
    
    def _generate_chunk_id(self, content: str, chunk_index: int) -> str:
        """生成chunk的唯一ID"""
        content_hash = hashlib.md5(content.encode('utf-8')).hexdigest()[:8]
        return f"chunk_{chunk_index}_{content_hash}"
    
    def classify_document(self, text: str, file_path: Path) -> str:
        """文档自动分类（简单规则分类）"""
        text_lower = text.lower()
        file_name = file_path.name.lower()
        
        # 根据关键词和文件名进行简单分类
        if any(keyword in text_lower or keyword in file_name for keyword in 
               ['技术', 'tech', 'api', 'code', '编程', 'programming', '开发', 'develop']):
            return "技术文档"
        elif any(keyword in text_lower or keyword in file_name for keyword in 
                ['报告', 'report', '分析', 'analysis', '研究', 'research']):
            return "报告分析"
        elif any(keyword in text_lower or keyword in file_name for keyword in 
                ['教程', 'tutorial', '指南', 'guide', '手册', 'manual']):
            return "教程指南"
        elif any(keyword in text_lower or keyword in file_name for keyword in 
                ['笔记', 'note', '记录', 'record', '日志', 'log']):
            return "笔记记录"
        else:
            return "其他文档"
    
    def generate_summary(self, text: str, max_length: int = 200) -> str:
        """生成文档摘要（简单提取前几句）"""
        if not text.strip():
            return ""
        
        # 简单的摘要生成：提取前几句话
        sentences = re.split(r'[.!?。！？]', text)
        summary_sentences = []
        current_length = 0
        
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
                
            if current_length + len(sentence) > max_length:
                break
                
            summary_sentences.append(sentence)
            current_length += len(sentence)
        
        summary = "。".join(summary_sentences[:3])  # 最多3句话
        return summary + "。" if summary and not summary.endswith("。") else summary
    
    def extract_tags(self, text: str, max_tags: int = 5) -> List[str]:
        """提取文档标签（简单关键词提取）"""
        # 这里是一个简单的实现，实际应该使用更复杂的NLP技术
        text_lower = text.lower()
        
        # 预定义的一些标签关键词
        tag_keywords = {
            "Python": ["python", "py", "flask", "django"],
            "JavaScript": ["javascript", "js", "node", "react", "vue"],
            "数据分析": ["数据", "分析", "统计", "图表"],
            "机器学习": ["机器学习", "深度学习", "ai", "算法"],
            "文档": ["文档", "document", "说明"],
            "教程": ["教程", "tutorial", "指南", "guide"],
            "API": ["api", "接口", "endpoint"],
            "数据库": ["数据库", "database", "sql", "mysql", "postgresql"]
        }
        
        found_tags = []
        for tag, keywords in tag_keywords.items():
            if any(keyword in text_lower for keyword in keywords):
                found_tags.append(tag)
                if len(found_tags) >= max_tags:
                    break
        
        return found_tags
