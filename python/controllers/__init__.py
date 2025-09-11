"""
Controllers package for AI File Manager API
"""

from .system_controller import system_router
from .search_controller import search_router

__all__ = [
    "system_router",
    "search_router"
]
