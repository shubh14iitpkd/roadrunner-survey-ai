"""
Langchain Agent Factory for RoadSight AI Chatbot
Creates an agent with all available tools for road survey queries
"""

from typing import Optional
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.messages import SystemMessage

from ai.lang_chatbot.models import get_gemini_model
from ai.lang_chatbot.tools import ALL_TOOLS
from ai.lang_chatbot.mongo_tools import FRAME_TOOLS
from ai.lang_chatbot.context import set_current_user_id

# Global memory saver for conversation persistence
_memory_saver = MemorySaver()

SYSTEM_PROMPT = """You are RoadSightAI, an intelligent assistant for road survey analysis.

You help users understand road conditions, asset inventories, survey results, and video analysis data.

## Your Capabilities
You have access to tools that query:
- **Asset data**: Categories, types, conditions, damage reports
- **Road information**: Route details, road names, distances
- **Survey data**: Survey status, dates, asset totals, list of surveys, who conducted most surveys
- **Frame data**: Specific frame detections, timestamps
- **Video analysis**: Processing status, defect summaries

## Guidelines

1. **Use Tools First**: Always use the appropriate tool to get accurate data. Don't guess statistics.

2. **Video Context**: When a video_id is provided in the conversation, use it for relevant queries.

3. **Be Specific**: 
   - For asset queries, use: get_asset_categories, get_asset_list, get_asset_by_type
   - For condition queries, use: get_road_condition, get_damaged_assets
   - For surveys, use: get_survey_status, get_survey_list
   - For roads, use: get_road_info, search_road_by_name
   - For frames, use: get_frame, get_frame_at_timestamp

4. **Response Format**:
   - Use clear markdown formatting
   - Present numbers with commas for readability
   - Organize data in lists or tables when appropriate
   - Provide brief insights based on the data

5. **Error Handling**: If a tool returns no data, explain what was searched and suggest alternatives.

## Example Interactions

User: "What are the asset categories?"
→ Use get_asset_categories with the current video_id

User: "How many street lights?"  
→ Use get_asset_by_type with asset_type="street light"

User: "What's at frame 100?"
→ Use get_frame with the frame_number=100

User: "Road condition?"
→ Use get_road_condition for overall assessment

User: "Survey status for route 214?"
→ Use get_survey_status with route_id=214
"""


def agent_factory(
    model: str = "gemini",
    video_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> object:
    """
    Create a Langchain agent with all road survey tools.
    
    Args:
        model: LLM model to use ("gemini")
        video_id: Optional video ID to inject into context
        user_id: Optional user ID for applying preference overrides
    
    Returns:
        Configured agent executor
    """
    # Set user_id in shared context for tools to access
    set_current_user_id(user_id)
    
    llm = None
    
    if model == "gemini":
        llm = get_gemini_model()
    else:
        raise ValueError(f"Unknown model: {model}")
    
    # Combine all tools
    all_tools = ALL_TOOLS + FRAME_TOOLS
    
    # Build system prompt with optional video context
    prompt = SYSTEM_PROMPT
    if video_id:
        prompt += f"\n\n## Current Context\nActive Video ID: {video_id}\nUse this video_id for relevant queries unless the user specifies otherwise."
    
    # Create the agent with memory checkpointer for conversation persistence
    agent = create_react_agent(
        model=llm,
        tools=all_tools,
        prompt=prompt,
        checkpointer=_memory_saver,  # Enable conversation memory
    )
    
    return agent


def get_agent_with_context(video_id: str = None, route_id: int = None) -> object:
    """
    Create an agent with injected context for a specific video or route.
    
    Args:
        video_id: Video identifier for demo or regular video
        route_id: Route number for survey queries
    
    Returns:
        Configured agent executor with context
    """
    context_parts = []
    
    if video_id:
        context_parts.append(f"Active Video: {video_id}")
    if route_id:
        context_parts.append(f"Active Route: {route_id}")
    
    context = " | ".join(context_parts) if context_parts else None
    
    return agent_factory(video_id=video_id)
