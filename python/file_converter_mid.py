"""
文件格式转换工具
使用 Microsoft MarkItDown 进行文档格式转换
"""
import os
from pathlib import Path
from typing import Optional, Dict, List, Tuple
from loguru import logger


class FileConverterMid:
    """基于 MarkItDown 的文件格式转换器"""

    # 支持的文件类型映射 (MarkItDown 支持的格式)
    FILE_TYPE_MAPPING = {
        # 文档格式
        '.docx': 'docx',
        '.doc': 'doc',
        '.pdf': 'pdf',
        '.pptx': 'pptx',
        '.ppt': 'ppt',
        '.xlsx': 'xlsx',
        '.xls': 'xls',
        '.epub': 'epub',

        # 网页格式
        '.html': 'html',
        '.htm': 'html',

        # 文本格式
        '.txt': 'txt',
        '.md': 'markdown',
        '.markdown': 'markdown',
        '.json': 'json',
        '.xml': 'xml',
        '.csv': 'csv',

        # 图像格式
        '.jpg': 'image',
        '.jpeg': 'image',
        '.png': 'image',
        '.gif': 'image',
        '.bmp': 'image',
        '.tiff': 'image',
        '.tif': 'image',

        # 音频格式
        '.wav': 'audio',
        '.mp3': 'audio',

        # 其他
        '.zip': 'zip',
    }

    def __init__(self, enable_plugins: bool = False, docintel_endpoint: Optional[str] = None):
        """
        初始化文件转换器

        Args:
            enable_plugins: 是否启用插件
            docintel_endpoint: Azure Document Intelligence 端点
        """
        try:
            from markitdown import MarkItDown
        except ImportError as e:
            raise ImportError(f"MarkItDown 未安装，请运行: pip install 'markitdown[all]'。错误: {e}")

        self.enable_plugins = enable_plugins
        self.docintel_endpoint = docintel_endpoint

        # 初始化 MarkItDown
        try:
            self.md = MarkItDown(
                enable_plugins=enable_plugins,
                docintel_endpoint=docintel_endpoint
            )
            logger.info("MarkItDown 文件转换器初始化完成")
        except Exception as e:
            logger.error(f"MarkItDown 初始化失败: {e}")
            raise

    def detect_file_type_by_extension(self, file_path: str) -> Optional[str]:
        """
        根据文件扩展名判断文件类型

        Args:
            file_path: 文件路径

        Returns:
            文件类型字符串，如果无法识别则返回 None
        """
        path = Path(file_path)
        extension = path.suffix.lower()

        file_type = self.FILE_TYPE_MAPPING.get(extension)
        if file_type:
            logger.debug(f"检测到文件类型: {file_path} -> {file_type}")
        else:
            logger.warning(f"未知的文件类型: {extension}")

        return file_type

    def get_supported_formats(self) -> List[str]:
        """获取支持的文件格式列表"""
        return list(self.FILE_TYPE_MAPPING.keys())

    def is_format_supported(self, file_format: str) -> bool:
        """
        检查格式是否受支持

        Args:
            file_format: 文件格式（扩展名或格式名）

        Returns:
            是否支持该格式
        """
        if file_format.startswith('.'):
            return file_format.lower() in self.FILE_TYPE_MAPPING
        else:
            return file_format.lower() in ['markdown', 'md']  # MarkItDown 主要输出 Markdown

    def convert_to_markdown(
        self,
        input_file_path: str | Path,
        output_file_path: Optional[str | Path] = None
    ) -> Tuple[bool, str]:
        """
        将文件转换为 Markdown 格式

        Args:
            input_file_path: 输入文件路径
            output_file_path: 输出文件路径，如果为 None 则自动生成

        Returns:
            (成功标志, 错误信息或成功消息)
        """
        try:
            # 检查输入文件是否存在
            input_path = Path(input_file_path)
            if not input_path.exists():
                error_msg = f"输入文件不存在: {input_file_path}"
                logger.error(error_msg)
                return False, error_msg

            # 检查输入文件类型
            input_format = self.detect_file_type_by_extension(str(input_path))
            if not input_format:
                error_msg = f"无法识别输入文件格式: {input_file_path}"
                logger.error(error_msg)
                return False, error_msg

            # 确定输出文件路径
            if output_file_path is None:
                output_file_path = str(input_path.with_suffix('.md'))
            else:
                output_file_path = str(output_file_path)

            # 创建输出目录
            output_path = Path(output_file_path)
            output_path.parent.mkdir(parents=True, exist_ok=True)

            # 使用 MarkItDown 转换
            logger.info(f"开始转换: {input_file_path} -> {output_file_path}")
            result = self.md.convert(input_file_path)

            # 写入输出文件
            with open(output_file_path, 'w', encoding='utf-8') as f:
                f.write(result.text_content)

            success_msg = f"文件转换成功: {input_file_path} -> {output_file_path}"
            logger.info(success_msg)
            return True, success_msg

        except Exception as e:
            error_msg = f"文件转换过程中发生错误: {str(e)}"
            logger.error(error_msg)
            return False, error_msg

    def convert_file(
        self,
        input_file_path: str,
        target_format: str,
        output_file_path: str,
        output_format: Optional[str] = None,
        extra_args: Optional[List[str]] = None
    ) -> Tuple[bool, str]:
        """
        使用 MarkItDown 进行文件格式转换
        注意：MarkItDown 主要用于转换为 Markdown

        Args:
            input_file_path: 输入文件路径
            target_format: 目标格式（如果 output_format 为 None，则用作输出格式）
            output_file_path: 输出文件路径
            output_format: 输出格式（可选，如果未指定则使用 target_format）
            extra_args: 额外的参数（MarkItDown 不使用）

        Returns:
            (成功标志, 错误信息或成功消息)
        """
        # 确定输出格式
        final_output_format = output_format or target_format

        # MarkItDown 主要转换为 Markdown
        if final_output_format.lower() in ['markdown', 'md']:
            return self.convert_to_markdown(input_file_path, output_file_path)
        else:
            error_msg = f"MarkItDown 仅支持转换为 Markdown 格式，不支持: {final_output_format}"
            logger.error(error_msg)
            return False, error_msg

    def batch_convert(
        self,
        input_files: List[str],
        output_format: str,
        output_dir: str,
        extra_args: Optional[List[str]] = None
    ) -> Dict[str, Tuple[bool, str]]:
        """
        批量转换文件

        Args:
            input_files: 输入文件路径列表
            output_format: 输出格式（必须是 markdown）
            output_dir: 输出目录
            extra_args: 额外的参数

        Returns:
            每个文件的转换结果字典
        """
        if output_format.lower() not in ['markdown', 'md']:
            error_msg = "批量转换仅支持转换为 Markdown 格式"
            logger.error(error_msg)
            return {file: (False, error_msg) for file in input_files}

        results = {}
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        for input_file in input_files:
            input_path = Path(input_file)
            output_file = output_path / f"{input_path.stem}.md"

            result = self.convert_to_markdown(input_file, str(output_file))
            results[input_file] = result

            logger.info(f"批量转换进度: {input_file} -> {'成功' if result[0] else '失败'}")

        return results

    def check_availability(self) -> Tuple[bool, str]:
        """
        检查 MarkItDown 是否可用

        Returns:
            (是否可用, 版本信息或错误信息)
        """
        try:
            from markitdown import MarkItDown
            # 尝试创建一个实例来检查可用性
            test_md = MarkItDown()
            return True, "MarkItDown 可用"
        except Exception as e:
            error_msg = f"MarkItDown 检查失败: {str(e)}"
            logger.error(error_msg)
            return False, error_msg