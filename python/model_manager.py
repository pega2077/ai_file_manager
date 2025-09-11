#!/usr/bin/env python3
"""
模型管理脚本
用于下载、管理和测试 embedding 模型
"""

import sys
import argparse
from pathlib import Path
from embedding import EmbeddingGenerator

def download_model(model_name: str, force: bool = False):
    """下载指定的模型"""
    print(f"下载模型: {model_name}")
    
    embedding_gen = EmbeddingGenerator(model_name)
    
    if embedding_gen.download_model(force_download=force):
        print("✓ 模型下载成功")
        
        # 显示模型信息
        model_info = embedding_gen.get_model_info()
        print(f"  模型路径: {model_info['local_model_path']}")
        print(f"  向量维度: {model_info['dimension']}")
    else:
        print("✗ 模型下载失败")

def list_models():
    """列出可用的模型"""
    print("可用的多语言模型:")
    
    models = [
        "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        "sentence-transformers/paraphrase-multilingual-mpnet-base-v2", 
        "sentence-transformers/distiluse-base-multilingual-cased",
        "sentence-transformers/all-MiniLM-L6-v2",
        "sentence-transformers/all-mpnet-base-v2"
    ]
    
    for i, model in enumerate(models, 1):
        print(f"  {i}. {model}")
        
        # 检查是否已下载
        embedding_gen = EmbeddingGenerator(model)
        if embedding_gen.is_model_downloaded():
            print(f"     ✓ 已下载到: {embedding_gen.get_local_model_path()}")
        else:
            print(f"     ✗ 未下载")

def test_model(model_name: str):
    """测试指定的模型"""
    print(f"测试模型: {model_name}")
    
    embedding_gen = EmbeddingGenerator(model_name)
    
    # 测试文本
    test_texts = [
        "这是一段中文测试文本",
        "This is English test text",
        "これは日本語のテストです"
    ]
    
    if embedding_gen.load_model():
        print("✓ 模型加载成功")
        
        model_info = embedding_gen.get_model_info()
        print(f"  向量维度: {model_info['dimension']}")
        print(f"  支持中文: {model_info['supports_chinese']}")
        
        print("\n测试文本 embedding:")
        for i, text in enumerate(test_texts, 1):
            embedding = embedding_gen.generate_embedding(text)
            if embedding:
                print(f"  {i}. {text[:30]}... -> 维度: {len(embedding)}")
            else:
                print(f"  {i}. {text[:30]}... -> 生成失败")
    else:
        print("✗ 模型加载失败")

def clear_cache():
    """清除本地模型缓存"""
    print("清除本地模型缓存...")
    
    embedding_gen = EmbeddingGenerator()
    
    if embedding_gen.clear_local_cache():
        print("✓ 缓存清除成功")
    else:
        print("✗ 缓存清除失败")

def show_status():
    """显示当前状态"""
    print("模型管理状态:")
    
    embedding_gen = EmbeddingGenerator()
    model_info = embedding_gen.get_model_info()
    
    print(f"  默认模型: {model_info['model_name']}")
    print(f"  本地模型目录: {model_info['local_model_dir']}")
    print(f"  模型已下载: {'是' if model_info['is_model_downloaded'] else '否'}")
    print(f"  模型已加载: {'是' if model_info['is_loaded'] else '否'}")
    
    if model_info['is_model_downloaded']:
        print(f"  本地模型路径: {model_info['local_model_path']}")

def main():
    parser = argparse.ArgumentParser(description="Embedding 模型管理工具")
    
    subparsers = parser.add_subparsers(dest="command", help="可用命令")
    
    # download 命令
    download_parser = subparsers.add_parser("download", help="下载模型")
    download_parser.add_argument("model", nargs="?", 
                               default="sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
                               help="模型名称")
    download_parser.add_argument("--force", action="store_true", help="强制重新下载")
    
    # list 命令
    subparsers.add_parser("list", help="列出可用模型")
    
    # test 命令
    test_parser = subparsers.add_parser("test", help="测试模型")
    test_parser.add_argument("model", nargs="?",
                           default="sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2", 
                           help="模型名称")
    
    # clear 命令
    subparsers.add_parser("clear", help="清除本地缓存")
    
    # status 命令
    subparsers.add_parser("status", help="显示当前状态")
    
    args = parser.parse_args()
    
    if args.command == "download":
        download_model(args.model, args.force)
    elif args.command == "list":
        list_models()
    elif args.command == "test":
        test_model(args.model)
    elif args.command == "clear":
        clear_cache()
    elif args.command == "status":
        show_status()
    else:
        parser.print_help()

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n用户中断操作")
        sys.exit(1)
    except Exception as e:
        print(f"错误: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
