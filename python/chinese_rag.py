

"""
中文 RAG 系统
实现文本分片、向量化、FAISS 存储和检索测试
"""
import os
import sys
from pathlib import Path
from typing import List, Dict, Any
import re

# 添加项目根目录到路径
project_root = Path(__file__).parent.parent
sys.path.append(str(project_root))

from python.embedding import EmbeddingGenerator, get_embedding_generator
from python.vector_db import VectorDatabase
from python.config import settings


class ChineseRAG:
    """中文 RAG 系统"""

    def __init__(self, input_file: str):
        self.input_file = Path(input_file)
        self.embedding_generator = get_embedding_generator()
        self.vector_db = None
        self.chunks = []
        self.chunk_size = 512  # 分片大小
        self.overlap = 50      # 分片重叠

    def load_text(self) -> str:
        """加载文本文件"""
        try:
            with open(self.input_file, 'r', encoding='utf-8') as f:
                text = f.read()
            print(f"成功加载文件: {self.input_file}, 长度: {len(text)} 字符")
            return text
        except Exception as e:
            print(f"加载文件失败: {e}")
            return ""

    def split_text_into_chunks(self, text: str) -> List[str]:
        """将文本分片"""
        if not text:
            return []

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
            if len(current_chunk) + len(sentence) <= self.chunk_size:
                current_chunk += sentence
            else:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                current_chunk = sentence

        if current_chunk:
            chunks.append(current_chunk.strip())

        print(f"文本分片完成，共 {len(chunks)} 个分片")
        return chunks

    def initialize_vector_db(self):
        """初始化向量数据库"""
        db_path = Path(__file__).parent / "database" / "vectors"
        self.vector_db = VectorDatabase(db_path, dimension=384)  # 模型维度
        success = self.vector_db.initialize()
        if success:
            print("向量数据库初始化成功")
        else:
            print("向量数据库初始化失败")
        return success

    def process_and_store(self):
        """处理文本并存储到向量数据库"""
        # 加载文本
        text = self.load_text()
        if not text:
            return False

        # 分片
        self.chunks = self.split_text_into_chunks(text)
        if not self.chunks:
            print("分片失败")
            return False

        # 初始化向量数据库
        if not self.initialize_vector_db():
            return False

        # 生成 embeddings 并存储
        embeddings_data = []
        for i, chunk in enumerate(self.chunks):
            print(f"处理分片 {i+1}/{len(self.chunks)}")

            # 生成 embedding
            embedding = self.embedding_generator.generate_embedding(chunk)
            if embedding is None:
                print(f"分片 {i+1} 生成 embedding 失败")
                continue

            # 准备存储数据
            chunk_data = {
                "embedding_id": f"chunk_{i}",
                "embedding": embedding,
                "metadata": {
                    "file_path": str(self.input_file),
                    "chunk_index": i,
                    "chunk_text": chunk[:200] + "..." if len(chunk) > 200 else chunk,
                    "chunk_length": len(chunk)
                }
            }
            embeddings_data.append(chunk_data)

        # 批量存储
        if embeddings_data:
            success_count = self.vector_db.add_embeddings_batch(embeddings_data)
            print(f"成功存储 {success_count}/{len(embeddings_data)} 个向量")
            return success_count > 0

        return False

    def search_similar(self, query: str, limit: int = 5, similarity_threshold: float = 0.7) -> List[Dict[str, Any]]:
        """搜索相似内容"""
        if not self.vector_db:
            print("向量数据库未初始化")
            return []

        # 生成查询 embedding
        query_embedding = self.embedding_generator.generate_embedding(query)
        if query_embedding is None:
            print("查询 embedding 生成失败")
            return []

        # 搜索相似向量
        results = self.vector_db.search_similar(query_embedding, limit=limit, similarity_threshold=similarity_threshold)
        return results

    def test_rag(self):
        """测试 RAG 系统"""
        # test_queries = [
        #     "刘备是谁？",
        #     "关羽和张飞的关系",
        #     "黄巾起义的原因",
        #     "三国演义的开头"
        # ]

        # print("\n=== RAG 系统测试 ===")

        # # 先运行预定义的测试查询
        # print("运行预定义测试查询...")
        # for query in test_queries:
        #     print(f"\n查询: {query}")
        #     results = self.search_similar(query, limit=3)

        #     if results:
        #         print("检索结果:")
        #         for i, result in enumerate(results, 1):
        #             metadata = result.get("metadata", {})
        #             similarity = result.get("similarity_score", 0)
        #             chunk_text = metadata.get("chunk_text", "")
        #             print(f"  {i}. 相似度: {similarity:.3f}")
        #             print(f"     内容: {chunk_text}")
        #     else:
        #         print("未找到相关结果")

        # 进入交互模式
        print("\n=== 交互式查询模式 ===")
        print("请输入您的查询（输入 'quit' 或 'exit' 退出）:")

        while True:
            try:
                query = input("\n查询: ").strip()
                if query.lower() in ['quit', 'exit', 'q']:
                    print("退出查询模式")
                    break

                if not query:
                    continue

                results = self.search_similar(query, limit=10, similarity_threshold=0.01)

                if results:
                    print("检索结果:")
                    for i, result in enumerate(results, 1):
                        metadata = result.get("metadata", {})
                        similarity = result.get("similarity_score", 0)
                        chunk_text = metadata.get("chunk_text", "")
                        chunk_index = metadata.get("chunk_index", "N/A")
                        print(f"  {i}. 相似度: {similarity:.3f}")
                        print(f"     分片索引: {chunk_index}")
                        print(f"     内容: {chunk_text}")
                        print()
                else:
                    print("未找到相关结果")

            except KeyboardInterrupt:
                print("\n用户中断，退出查询模式")
                break
            except Exception as e:
                print(f"查询过程中出现错误: {e}")
                continue


def main():
    """主函数"""
    # inputfile = r"D:\Projects\ai_file_manager\workdir\Books\三国演义_20250911_211928.md"
    loadfiledata = True
    inputfile = r"D:\test\万历十五年.txt"

    # 检查文件是否存在
    if not Path(inputfile).exists():
        print(f"错误：文件不存在 - {inputfile}")
        return

    # 创建 RAG 系统
    rag = ChineseRAG(inputfile)

    if loadfiledata:
        # 处理并存储
        print("开始处理文本...")
        success = rag.process_and_store()

        if success:
            print("文本处理完成")
            # 直接进入测试模式
            rag.test_rag()
        else:
            print("文本处理失败")
    else:
        # 直接加载向量数据库
        print("跳过数据导入，直接加载向量数据库...")
        if rag.initialize_vector_db():
            print("向量数据库加载完成")
            # 直接进入测试模式
            rag.test_rag()
        else:
            print("向量数据库加载失败")


if __name__ == "__main__":
    main()
