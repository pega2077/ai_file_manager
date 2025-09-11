"""
文件格式转换工具
负责使用 Pandoc 进行各种文档格式之间的转换
"""
import os
import platform
import subprocess
from pathlib import Path
from typing import Optional, Dict, List, Tuple
from loguru import logger


class FileConverter:
    """文件格式转换器"""
    
    # 支持的文件类型映射
    FILE_TYPE_MAPPING = {
        # 文本格式
        '.txt': 'plain',
        '.md': 'markdown',
        '.markdown': 'markdown',
        '.rst': 'rst',
        '.tex': 'latex',
        
        # 文档格式
        '.docx': 'docx',
        '.doc': 'doc',
        '.odt': 'odt',
        '.rtf': 'rtf',
        '.pdf': 'pdf',
        
        # 网页格式
        '.html': 'html',
        '.htm': 'html',
        '.xhtml': 'html',
        
        # 演示文稿
        '.pptx': 'pptx',
        '.ppt': 'ppt',
        '.odp': 'odp',
        
        # 电子表格
        '.xlsx': 'xlsx',
        '.xls': 'xls',
        '.ods': 'ods',
        '.csv': 'csv',
        
        # 其他格式
        '.epub': 'epub',
        '.mobi': 'mobi',
        '.azw3': 'azw3',
        '.fb2': 'fb2',
        '.json': 'json',
        '.xml': 'xml',
        '.yaml': 'yaml',
        '.yml': 'yaml'
    }
    
    # Pandoc 格式映射
    PANDOC_FORMAT_MAPPING = {
        'plain': 'plain',
        'markdown': 'markdown',
        'rst': 'rst',
        'latex': 'latex',
        'docx': 'docx',
        'doc': 'doc',
        'odt': 'odt',
        'rtf': 'rtf',
        'pdf': 'pdf',
        'html': 'html',
        'pptx': 'pptx',
        'ppt': 'ppt',
        'odp': 'odp',
        'xlsx': 'xlsx',
        'xls': 'xls',
        'ods': 'ods',
        'csv': 'csv',
        'epub': 'epub',
        'mobi': 'mobi',
        'azw3': 'azw3',
        'fb2': 'fb2',
        'json': 'json',
        'xml': 'xml',
        'yaml': 'yaml'
    }
    
    def __init__(self, pandoc_path: Optional[str] = None):
        """
        初始化文件转换器
        
        Args:
            pandoc_path: Pandoc 可执行文件路径，如果为 None 则使用系统默认路径
        """
        self.platform = platform.system().lower()
        self.pandoc_path = pandoc_path or self._get_default_pandoc_path()
        logger.info(f"文件转换器初始化完成，平台: {self.platform}, Pandoc路径: {self.pandoc_path}")
    
    def _get_default_pandoc_path(self) -> str:
        """获取默认的 Pandoc 路径"""
        if self.platform == "windows":
            # Windows 平台默认路径
            project_root = Path(__file__).parent.parent.parent
            default_path = project_root / "bin" / "pandoc.exe"
            if default_path.exists():
                return str(default_path)
            return "pandoc.exe"  # 使用系统PATH中的pandoc
        else:
            # macOS/Linux 平台
            project_root = Path(__file__).parent.parent.parent
            default_path = project_root / "bin" / "pandoc"
            if default_path.exists():
                return str(default_path)
            return "pandoc"  # 使用系统PATH中的pandoc
    
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
    
    def get_supported_pandoc_formats(self) -> List[str]:
        """获取支持的 Pandoc 格式列表"""
        return list(self.PANDOC_FORMAT_MAPPING.keys())
    
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
            return file_format.lower() in self.PANDOC_FORMAT_MAPPING
    
    def _build_pandoc_command(
        self,
        input_file: str,
        input_format: str,
        output_file: str,
        output_format: str,
        extra_args: Optional[List[str]] = None
    ) -> List[str]:
        """
        构建 Pandoc 命令
        
        Args:
            input_file: 输入文件路径
            input_format: 输入格式
            output_file: 输出文件路径
            output_format: 输出格式
            extra_args: 额外的 Pandoc 参数
        
        Returns:
            Pandoc 命令列表
        """
        cmd = [self.pandoc_path]
        
        # 输入格式
        if input_format in self.PANDOC_FORMAT_MAPPING:
            pandoc_input_format = self.PANDOC_FORMAT_MAPPING[input_format]
            cmd.extend(['-f', pandoc_input_format])
        
        # 输出格式
        if output_format in self.PANDOC_FORMAT_MAPPING:
            pandoc_output_format = self.PANDOC_FORMAT_MAPPING[output_format]
            cmd.extend(['-t', pandoc_output_format])
        
        # 输入文件
        cmd.append(input_file)
        
        # 输出文件
        cmd.extend(['-o', output_file])
        
        # 额外参数
        if extra_args:
            cmd.extend(extra_args)
        
        # 平台特定的调整
        if self.platform == "windows":
            # Windows 特定设置
            if output_format == 'pdf':
                # 在 Windows 上可能需要指定 PDF 引擎
                if '--pdf-engine' not in (extra_args or []):
                    cmd.extend(['--pdf-engine', 'xelatex'])
        
        logger.debug(f"构建的 Pandoc 命令: {' '.join(cmd)}")
        return cmd
    
    def convert_file(
        self,
        input_file_path: str,
        target_format: str,
        output_file_path: str,
        output_format: Optional[str] = None,
        extra_args: Optional[List[str]] = None
    ) -> Tuple[bool, str]:
        """
        使用 Pandoc 进行文件格式转换
        
        Args:
            input_file_path: 输入文件路径
            target_format: 目标格式（如果 output_format 为 None，则用作输出格式）
            output_file_path: 输出文件路径
            output_format: 输出格式（可选，如果未指定则使用 target_format）
            extra_args: 额外的 Pandoc 参数
        
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
            input_format = self.detect_file_type_by_extension(input_file_path)
            if not input_format:
                error_msg = f"无法识别输入文件格式: {input_file_path}"
                logger.error(error_msg)
                return False, error_msg
            
            # 确定输出格式
            final_output_format = output_format or target_format
            
            # 检查输出格式是否支持
            if not self.is_format_supported(final_output_format):
                error_msg = f"不支持的输出格式: {final_output_format}"
                logger.error(error_msg)
                return False, error_msg
            
            # 创建输出目录
            output_path = Path(output_file_path)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            
            # 构建 Pandoc 命令
            cmd = self._build_pandoc_command(
                input_file_path,
                input_format,
                output_file_path,
                final_output_format,
                extra_args
            )
            
            # 执行转换
            logger.info(f"开始转换: {input_file_path} -> {output_file_path}")
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300  # 5分钟超时
            )
            
            if result.returncode == 0:
                success_msg = f"文件转换成功: {input_file_path} -> {output_file_path}"
                logger.info(success_msg)
                return True, success_msg
            else:
                error_msg = f"Pandoc 转换失败: {result.stderr}"
                logger.error(error_msg)
                return False, error_msg
                
        except subprocess.TimeoutExpired:
            error_msg = "文件转换超时"
            logger.error(error_msg)
            return False, error_msg
        except FileNotFoundError:
            error_msg = f"找不到 Pandoc 可执行文件: {self.pandoc_path}"
            logger.error(error_msg)
            return False, error_msg
        except Exception as e:
            error_msg = f"文件转换过程中发生错误: {str(e)}"
            logger.error(error_msg)
            return False, error_msg
    
    def convert_to_markdown(
        self,
        input_file_path: str,
        output_file_path: Optional[str] = None
    ) -> Tuple[bool, str]:
        """
        将文件转换为 Markdown 格式
        
        Args:
            input_file_path: 输入文件路径
            output_file_path: 输出文件路径，如果为 None 则自动生成
        
        Returns:
            (成功标志, 错误信息或成功消息)
        """
        if output_file_path is None:
            input_path = Path(input_file_path)
            output_file_path = str(input_path.with_suffix('.md'))
        
        return self.convert_file(
            input_file_path,
            'markdown',
            output_file_path,
            extra_args=['--extract-media', str(Path(output_file_path).parent / 'media')]
        )
    
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
            output_format: 输出格式
            output_dir: 输出目录
            extra_args: 额外的 Pandoc 参数
        
        Returns:
            每个文件的转换结果字典
        """
        results = {}
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        
        for input_file in input_files:
            input_path = Path(input_file)
            output_file = output_path / f"{input_path.stem}.{output_format}"
            
            result = self.convert_file(
                input_file,
                output_format,
                str(output_file),
                extra_args=extra_args
            )
            results[input_file] = result
            
            logger.info(f"批量转换进度: {input_file} -> {'成功' if result[0] else '失败'}")
        
        return results
    
    def check_pandoc_availability(self) -> Tuple[bool, str]:
        """
        检查 Pandoc 是否可用
        
        Returns:
            (是否可用, 版本信息或错误信息)
        """
        try:
            result = subprocess.run(
                [self.pandoc_path, '--version'],
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if result.returncode == 0:
                version_info = result.stdout.split('\n')[0]
                logger.info(f"Pandoc 可用: {version_info}")
                return True, version_info
            else:
                error_msg = f"Pandoc 执行失败: {result.stderr}"
                logger.error(error_msg)
                return False, error_msg
                
        except FileNotFoundError:
            error_msg = f"找不到 Pandoc 可执行文件: {self.pandoc_path}"
            logger.error(error_msg)
            return False, error_msg
        except subprocess.TimeoutExpired:
            error_msg = "Pandoc 版本检查超时"
            logger.error(error_msg)
            return False, error_msg
        except Exception as e:
            error_msg = f"检查 Pandoc 可用性时发生错误: {str(e)}"
            logger.error(error_msg)
            return False, error_msg
