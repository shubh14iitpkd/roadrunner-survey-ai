"""
Tool Node — LLM-driven tool calling via LangGraph's ToolNode.
The agent_node makes LLM calls that can invoke tools,
and the tool_node executes those tool calls.
"""

from langchain_core.messages import SystemMessage
from langgraph.prebuilt import ToolNode
from ai.lang_graph_chatbot.state import AgentState
from ai.lang_graph_chatbot.tools import ALL_TOOLS
from ai.lang_chatbot.models import get_gemini_model


AGENT_PROMPT = """You are RoadSightAI, an intelligent assistant for road survey analysis.

You have access to tools to query the database:
- **list_videos**: List uploaded videos (can filter by route)
- **list_surveys**: List surveys (can filter by route and status)
- **get_asset_condition_summary**: Get asset counts and condition breakdown (for a specific video OR an entire route)

## Current Context
{context}

## Guidelines
1. Always use tools to get data. Never guess statistics.
2. When the user says "this route" or asks about the current route, ALWAYS use route_id={route_id} in your tool calls.
3. If the user asks about a specific video, use the `video_id`.
4. Format responses in clear markdown with numbers formatted using commas.
5. Use tables or bullet lists to organize data.
6. When showing condition data, always include both counts and percentages.
"""


def _build_context(state: AgentState) -> str:
    """Build a context string from the current state to inject into the system prompt."""
    parts = []
    route_id = state.get("route_id")
    video_id = state.get("video_id")
    if route_id is not None:
        parts.append(f"Selected Route ID: {route_id}")
    if video_id:
        parts.append(f"Selected Video ID: {video_id}")
    return "\n".join(parts) if parts else "No specific route or video selected."


def agent_node(state: AgentState) -> dict:
    """
    LLM call with tool bindings. The LLM may produce tool_calls
    in its response, which will be executed by the ToolNode downstream.
    """
    llm = get_gemini_model()
    llm_with_tools = llm.bind_tools(ALL_TOOLS)

    route_id = state.get("route_id", "none")
    context = _build_context(state)
    prompt = AGENT_PROMPT.format(context=context, route_id=route_id)

    system = SystemMessage(content=prompt)
    history = state["messages"][-10:]

    response = llm_with_tools.invoke([system] + history)

    return {"messages": [response]}


# Pre-built ToolNode that executes tool calls
tool_node = ToolNode(ALL_TOOLS)


def should_continue_tools(state: AgentState) -> str:
    """
    Conditional edge after agent_node:
    - If the last message has tool_calls → route to 'tools' 
    - Otherwise → route to 'formatter' (for visualization) or 'validator' (for text)
    """
    last_message = state["messages"][-1]

    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"

    # No more tool calls — decide based on response_type
    if state.get("response_type") == "visualization":
        return "formatter"
    return "validator"
