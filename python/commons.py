"""
Common utilities and helper functions
公共工具和辅助函数模块
"""
import uuid
from datetime import datetime
from typing import Dict, Any, Optional


def create_response(
    success: bool = True,
    message: str = "",
    data: Any = None,
    error: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create standardized API response format
    创建统一格式的API响应
    
    Args:
        success: Whether the request was successful
        message: Response message
        data: Response data
        error: Error information if any
    
    Returns:
        Standardized response dictionary
    """
    return {
        "success": success,
        "message": message,
        "data": data,
        "error": error,
        "timestamp": datetime.now().isoformat(),
        "request_id": str(uuid.uuid4())
    }


def create_error_response(
    message: str,
    error_code: str = "INTERNAL_ERROR",
    error_details: Any = None
) -> Dict[str, Any]:
    """
    Create standardized error response
    创建标准化错误响应
    
    Args:
        message: Error message
        error_code: Error code
        error_details: Additional error details
    
    Returns:
        Standardized error response dictionary
    """
    return create_response(
        success=False,
        message=message,
        error={
            "code": error_code,
            "message": message,
            "details": error_details
        }
    )


def create_success_response(
    message: str = "Operation completed successfully",
    data: Any = None
) -> Dict[str, Any]:
    """
    Create standardized success response
    创建标准化成功响应
    
    Args:
        message: Success message
        data: Response data
    
    Returns:
        Standardized success response dictionary
    """
    return create_response(
        success=True,
        message=message,
        data=data
    )
