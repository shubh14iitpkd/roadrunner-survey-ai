"""
Shared context for the chatbot - stores current request context like user_id.
This module exists to avoid circular imports between agents.py and tools.py.
"""

from typing import Optional

# Module-level current user_id for tools to access
_current_user_id: Optional[str] = None


def set_current_user_id(user_id: Optional[str]) -> None:
    """Set the current user_id for the active request"""
    global _current_user_id
    _current_user_id = user_id


def get_current_user_id() -> Optional[str]:
    """Get the current user_id set for the active request"""
    return _current_user_id
