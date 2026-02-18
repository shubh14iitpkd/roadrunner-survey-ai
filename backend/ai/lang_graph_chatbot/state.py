"""
LangGraph Chatbot State Definition
Defines the AgentState used throughout the graph nodes.
"""

from enum import Enum
from typing import Annotated, Optional
from typing_extensions import TypedDict
from langgraph.graph.message import add_messages


class ResponseType(str, Enum):
    """Type of response the chatbot should produce."""
    TEXT = "text"                    # Plain markdown response
    VISUALIZATION = "visualization" # JSON payload inside ```visualization code block


def extract_text_content(content) -> str:
    """
    Normalize LLM content to a plain string.
    
    LLM responses can return content as:
    - A plain string
    - A list of content block dicts like [{'type': 'text', 'text': '...', 'extras': {...}}]
    - A list of strings
    
    This function extracts the text from any of these formats.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict):
                # Content block dict — extract the 'text' field
                parts.append(part.get("text", ""))
            else:
                parts.append(str(part))
        return "\n\n".join(p for p in parts if p)
    return str(content) if content else ""


class AgentState(TypedDict):
    """
    Shared state flowing through all LangGraph nodes.
    
    Attributes:
        messages: Conversation history managed by LangGraph's add_messages reducer
        intent: Router classification — "expert", "tool", or "visualization"
        response_type: How to format the final answer (text or visualization)
        video_id: Active video context for queries (None = use most recent)
        user_id: User ID for display name resolution and preferences
        final_response: Validated output string to return to the caller
    """
    messages: Annotated[list, add_messages]
    intent: Optional[str]
    response_type: ResponseType
    video_id: Optional[str]
    user_id: Optional[str]
    final_response: Optional[str]
