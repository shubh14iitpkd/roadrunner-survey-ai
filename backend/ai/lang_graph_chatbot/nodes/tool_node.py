"""
Tool Node — LLM-driven tool calling via LangGraph's ToolNode.
The agent_node makes LLM calls that can invoke tools,
and the tool_node executes those tool calls.
"""

from langchain_core.messages import SystemMessage, AIMessage, HumanMessage, ToolMessage
from langgraph.prebuilt import ToolNode
from ai.lang_graph_chatbot.state import AgentState
from ai.lang_graph_chatbot.tools import ALL_TOOLS
from ai.lang_chatbot.models import get_gemini_model


AGENT_PROMPT = """You are RoadSightAI — a friendly, knowledgeable road survey assistant.

You have these tools (they all return raw JSON — you interpret the data and respond naturally):

### Data
- **list_videos(route_id?)** — list uploaded videos
- **list_surveys(status?, route_id?)** — list surveys
- **get_survey_stats(period?, route_id?)** — survey counts by period (today/week/month/year/all) and top surveyors
- **describe_route(route_id)** — route metadata: name, distance, endpoints, counts

### Assets
- **list_asset_categories(with_labels?)** — all categories (optionally with labels)
- **list_assets_in_category(category_name, route_id?)** — detected assets in a category
- **list_detected_assets(route_id?)** — all detected assets grouped by category
- **get_asset_condition_summary(video_id?, route_id?)** — overall good/damaged totals
- **get_category_condition_breakdown(category_name, route_id?)** — good/damaged for a category
- **get_asset_type_condition(asset_name, route_id?)** — condition of a specific asset TYPE (e.g. "Street Light Pole")
- **get_most_damaged_types(route_id?, limit?)** — asset types ranked by damage count

### Locations
- **get_asset_locations(asset_name?, category_name?, route_id?, limit?)** — lat/lng of detected assets
- **get_damage_hotspots(route_id, top_n?)** — clusters where damage is concentrated

## Current Context
{context}

## How to respond
- **Be natural and conversational** — talk like a helpful colleague, not a report generator.
- Keep answers concise but informative. Use tables only when the user asks for lists or when there are >3 items.
- Use the user's language style. Mirror their formality level.
- When the user says "this route", use route_id={route_id}.
- Map user words to category/asset names: "traffic signs" → "Directional Signage", "street lights" → "Roadway Lighting", "road surface/pavement" → "Pavement", "barriers/guardrails" → "Oia".
- Include both counts and percentages when discussing conditions.
- Never fabricate data — always call a tool first.
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


def _sanitize_messages_for_gemini(messages: list) -> list:
    """
    Sanitize message history to comply with Gemini's function calling constraints.
    Gemini requires:
    - Function call (AIMessage with tool_calls) must follow a HumanMessage or ToolMessage
    - No consecutive AIMessages without a HumanMessage or ToolMessage in between

    Strategy: find the last HumanMessage and only include messages from that point forward.
    This keeps the current turn's tool-calling loop intact while dropping older turns
    that may have broken ordering from other graph nodes (expert, validator, formatter).
    """
    # Find the index of the last HumanMessage
    last_human_idx = -1
    for i in range(len(messages) - 1, -1, -1):
        if isinstance(messages[i], HumanMessage):
            last_human_idx = i
            break

    if last_human_idx == -1:
        # No human message found — return as-is (shouldn't happen normally)
        return messages

    # Keep everything from the last HumanMessage onward (the current turn's tool loop)
    current_turn = messages[last_human_idx:]

    # Validate: remove any stale AIMessages that aren't tool-call or tool-response related
    sanitized = []
    for msg in current_turn:
        if isinstance(msg, AIMessage) and not msg.tool_calls and sanitized and isinstance(sanitized[-1], AIMessage):
            # Skip consecutive non-tool AIMessages
            continue
        sanitized.append(msg)

    return sanitized


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
    history = _sanitize_messages_for_gemini(state["messages"][-10:])

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
