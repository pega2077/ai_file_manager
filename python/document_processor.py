"""
文档处理模块 - 简化版
负责文件类型检测和转换为 Markdown
"""
from typing import List, Optional, Tuple, Dict
from pathlib import Path

from loguru import logger
from file_converter import FileConverter


class DocumentProcessor:
    """文档处理器 - 简化版，专注于文件类型检测和转换为Markdown"""
    
    def __init__(self, pandoc_path: Optional[str] = None):
        self.file_converter = FileConverter(pandoc_path)
        
        # 检查文件转换器可用性
        is_available, version_info = self.file_converter.check_pandoc_availability()
        if is_available:
            logger.info(f"文档处理器初始化完成，Pandoc 版本: {version_info}")
        else:
            logger.warning(f"Pandoc 不可用: {version_info}，文档转换功能将无法使用")
        
    def detect_file_type(self, file_path: Path) -> Optional[str]:
        """
        检测文件类型
        
        Args:
            file_path: 文件路径
            
        Returns:
            文件类型字符串，如果无法识别则返回 None
        """
        return self.file_converter.detect_file_type_by_extension(str(file_path))
    
    def is_pandoc_supported(self, file_path: Path) -> bool:
        """
        检查文件是否支持 Pandoc 转换
        
        Args:
            file_path: 文件路径
            
        Returns:
            是否支持 Pandoc 转换
        """
        file_type = self.detect_file_type(file_path)
        if not file_type:
            return False
            
        return self.file_converter.is_format_supported(file_type)
    

    
    def convert_to_markdown(self, input_file_path: Path, output_dir: Optional[Path] = None) -> Tuple[bool, str, Optional[Path]]:
        """
        将文档转换为 Markdown 格式
        
        Args:
            input_file_path: 输入文件路径
            output_dir: 输出目录，如果为 None 则使用输入文件所在目录
        
        Returns:
            (成功标志, 消息, 输出文件路径)
        """
        try:
            # 检查文件类型
            file_type = self.detect_file_type(input_file_path)
            if not file_type:
                error_msg = f"无法识别文件类型: {input_file_path}"
                logger.error(error_msg)
                return False, error_msg, None
            
            # 检查是否支持 Pandoc 转换
            if not self.is_pandoc_supported(input_file_path):
                error_msg = f"文件类型 '{file_type}' 不支持 Pandoc 转换"
                logger.error(error_msg)
                return False, error_msg, None
            
            # 如果已经是 Markdown 格式，直接返回成功
            if file_type == 'markdown':
                success_msg = f"文件已经是 Markdown 格式: {input_file_path}"
                logger.info(success_msg)
                return True, success_msg, input_file_path
            
            # 设置输出路径
            if output_dir is None:
                output_dir = input_file_path.parent
            
            output_file_path = output_dir / f"{input_file_path.stem}.md"
            
            # 使用文件转换器转换为 Markdown
            success, message = self.file_converter.convert_to_markdown(
                str(input_file_path),
                str(output_file_path)
            )
            
            if success:
                logger.info(f"成功转换为 Markdown: {input_file_path} -> {output_file_path}")
                return True, message, output_file_path
            else:
                logger.error(f"转换失败: {message}")
                return False, message, None
                
        except Exception as e:
            error_msg = f"转换文档失败: {str(e)}"
            logger.error(error_msg)
            return False, error_msg, None
    
    def get_supported_file_formats(self) -> List[str]:
        """获取支持的文件格式列表"""
        return self.file_converter.get_supported_formats()
    
    def batch_convert_to_markdown(
        self, 
        input_files: List[Path], 
        output_dir: Optional[Path] = None
    ) -> Dict[str, Tuple[bool, str, Optional[Path]]]:
        """
        批量转换文档为 Markdown
        
        Args:
            input_files: 输入文件路径列表
            output_dir: 输出目录
        
        Returns:
            转换结果字典 {文件路径: (成功标志, 消息, 输出路径)}
        """
        results = {}
        
        for input_file in input_files:
            result = self.convert_to_markdown(input_file, output_dir)
            results[str(input_file)] = result
            
            status = "成功" if result[0] else "失败"
            logger.info(f"批量转换进度: {input_file.name} -> {status}")
        
        return results
    
    def check_pandoc_status(self) -> Tuple[bool, str]:
        """
        检查 Pandoc 状态
        
        Returns:
            (是否可用, 状态信息)
        """
        return self.file_converter.check_pandoc_availability()
