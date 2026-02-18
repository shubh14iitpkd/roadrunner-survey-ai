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
- **list_videos**: List all uploaded videos
- **list_surveys**: List all surveys, optionally filtered by status
- **get_asset_condition_summary**: Get good vs damaged asset counts for a video

## Guidelines
1. Always use tools to get data. Never guess statistics.
2. If no video_id is specified by the user, leave it empty to use the most recent video.
3. Format responses in clear markdown with numbers formatted using commas.
4. Use tables or bullet lists to organize data.
5. When showing condition data, always include both counts and percentages.
"""


def agent_node(state: AgentState) -> dict:
    """
    LLM call with tool bindings. The LLM may produce tool_calls
    in its response, which will be executed by the ToolNode downstream.
    """
    llm = get_gemini_model()
    llm_with_tools = llm.bind_tools(ALL_TOOLS)

    system = SystemMessage(content=AGENT_PROMPT)
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
