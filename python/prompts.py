"""
Prompt Template Manager
提示词模板管理器
"""
from typing import Dict, Any, Optional
from pathlib import Path
import json
from loguru import logger


class PromptTemplate:
    """提示词模板管理类"""

    def __init__(self, template_file: Optional[str] = None):
        """
        初始化提示词模板管理器

        Args:
            template_file: 模板文件路径，如果为None则使用默认模板
        """
        self.templates: Dict[str, str] = {}
        self.template_file = template_file or self._get_default_template_path()

        self._load_templates()

    def _get_default_template_path(self) -> str:
        """获取默认模板文件路径"""
        return str(Path(__file__).parent / "prompts" / "templates.json")

    def _load_templates(self):
        """加载提示词模板"""
        try:
            if Path(self.template_file).exists():
                with open(self.template_file, 'r', encoding='utf-8') as f:
                    self.templates = json.load(f)
                logger.info(f"已加载提示词模板文件: {self.template_file}")
            else:
                # 使用默认模板
                self._load_default_templates()
                logger.info("使用默认提示词模板")
        except Exception as e:
            logger.error(f"加载提示词模板失败: {e}")
            self._load_default_templates()

    def _load_default_templates(self):
        """加载默认提示词模板"""
        self.templates = {
            "chat_qa": """基于以下文档内容回答用户的问题。如果文档中没有相关信息，请说明无法回答。

文档内容：
{context}

用户问题：{question}

请提供准确、简洁的回答，并说明答案的来源。""",

            "chat_summary": """请根据以下文档内容生成一个简洁的摘要。

文档内容：
{content}

摘要：""",

            "chat_translate": """请将以下文本翻译成{target_language}。

原文：
{text}

翻译："""
        }

    def get_template(self, template_name: str) -> str:
        """
        获取指定名称的提示词模板

        Args:
            template_name: 模板名称

        Returns:
            提示词模板字符串

        Raises:
            ValueError: 如果模板不存在
        """
        if template_name not in self.templates:
            available_templates = list(self.templates.keys())
            raise ValueError(f"提示词模板 '{template_name}' 不存在。可用模板: {available_templates}")

        return self.templates[template_name]

    def format_template(self, template_name: str, **kwargs) -> str:
        """
        格式化提示词模板

        Args:
            template_name: 模板名称
            **kwargs: 格式化参数

        Returns:
            格式化后的提示词

        Raises:
            ValueError: 如果模板不存在或格式化失败
        """
        template = self.get_template(template_name)

        try:
            return template.format(**kwargs)
        except KeyError as e:
            raise ValueError(f"模板 '{template_name}' 缺少必需的参数: {e}")

    def add_template(self, name: str, template: str):
        """
        添加新的提示词模板

        Args:
            name: 模板名称
            template: 模板内容
        """
        self.templates[name] = template
        logger.info(f"已添加提示词模板: {name}")

    def save_templates(self):
        """保存模板到文件"""
        try:
            template_path = Path(self.template_file)
            template_path.parent.mkdir(parents=True, exist_ok=True)

            with open(self.template_file, 'w', encoding='utf-8') as f:
                json.dump(self.templates, f, ensure_ascii=False, indent=2)

            logger.info(f"提示词模板已保存到: {self.template_file}")
        except Exception as e:
            logger.error(f"保存提示词模板失败: {e}")

    def list_templates(self) -> Dict[str, str]:
        """
        列出所有可用模板

        Returns:
            模板名称和内容的字典
        """
        return self.templates.copy()


# 全局实例
_prompt_template = None

def get_prompt_template() -> PromptTemplate:
    """获取提示词模板管理器实例"""
    global _prompt_template
    if _prompt_template is None:
        _prompt_template = PromptTemplate()
    return _prompt_template
