"""
Tool Node — LLM-driven tool calling via LangGraph's ToolNode.
The agent_node makes LLM calls that can invoke tools,
and the tool_node executes those tool calls.
"""

import logging
import time

from langchain_core.messages import SystemMessage, AIMessage, HumanMessage, ToolMessage
from langgraph.prebuilt import ToolNode
from ai.lang_graph_chatbot.state import AgentState, extract_text_content
from ai.lang_graph_chatbot.tools import ALL_TOOLS
from ai.lang_graph_chatbot.models import get_gemini_model

logger = logging.getLogger("chatbot.agent")


AGENT_PROMPT = """You are RoadSightAI — a friendly, helpful road survey assistant.

Use the available tools when the user asks for specific data (assets, surveys, counts, conditions, locations). Do not invent results; always call a tool before answering when data is required.

{context}

When the user refers to "this route", use route_id={route_id}.
"""




def _build_context(state: AgentState) -> str:
    """Build a context string from the current state to inject into the system prompt."""
    parts = []
    route_id = state.get("route_id")
    if route_id is not None:
        parts.append(f"Selected Route ID: {route_id}")
    return "\n".join(parts) if parts else "No specific route selected."


def _sanitize_messages_for_gemini(messages: list) -> list:
    """
    Sanitize message history to comply with Gemini's function calling constraints.
    Gemini requires:
    - The first message must be a HumanMessage
    - Function call (AIMessage with tool_calls) must immediately follow a HumanMessage or ToolMessage
    - No consecutive AIMessages without a HumanMessage or ToolMessage in between

    Strategy: search the FULL message list for the last HumanMessage, then include all
    messages from that point forward. This keeps the current turn's tool-calling loop
    intact regardless of how many tool calls have been made in the current turn.

    IMPORTANT: Always pass the full (or sufficiently large) message list here — do NOT
    pre-slice before calling this function, or the HumanMessage anchor may be missed.
    """
    # Find the index of the last HumanMessage in the full list
    last_human_idx = -1
    for i in range(len(messages) - 1, -1, -1):
        if isinstance(messages[i], HumanMessage):
            last_human_idx = i
            break

    if last_human_idx == -1:
        # No human message found — return as-is (shouldn't happen normally)
        logger.warning("No HumanMessage found in messages during sanitization")
        return messages

    # Keep everything from the last HumanMessage onward (the current turn's tool loop)
    current_turn = messages[last_human_idx:]

    # Validate: remove any stale AIMessages that aren't tool-call or tool-response related
    sanitized = []
    for msg in current_turn:
        if isinstance(msg, AIMessage) and not msg.tool_calls and sanitized and isinstance(sanitized[-1], AIMessage):
            # Skip consecutive non-tool AIMessages
            logger.debug("Skipping consecutive non-tool AIMessage during sanitization")
            continue
        sanitized.append(msg)

    logger.debug(f"Sanitized messages: {len(messages)} → {len(sanitized)} (from HumanMessage at idx {last_human_idx})")
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
    # Pass the full message list so the sanitizer can always find the last HumanMessage.
    history = _sanitize_messages_for_gemini(state["messages"])

    logger.info(f"Agent invocation | route_id={route_id} | message_count={len(history)}")

    MAX_RETRIES = 3
    response = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            t0 = time.time()
            response = llm_with_tools.invoke([system] + history)
            elapsed = time.time() - t0
        except Exception as e:
            logger.error(f"Agent LLM call failed on attempt {attempt}: {e}", exc_info=True)
            if attempt == MAX_RETRIES:
                raise
            continue

        has_tool_calls = bool(getattr(response, "tool_calls", None))
        raw_content = response.content
        content_empty = not raw_content if isinstance(raw_content, str) else not any(raw_content)

        if has_tool_calls:
            tool_names = [tc.get("name", "?") for tc in response.tool_calls]
            logger.info(f"Agent attempt={attempt} | {elapsed:.1f}s | tool_calls={tool_names}")
        else:
            logger.info(f"Agent attempt={attempt} | {elapsed:.1f}s | text response | content_empty={content_empty} | first_200={str(raw_content)[:200]}")

        if has_tool_calls or not content_empty:
            break
        if attempt < MAX_RETRIES:
            logger.warning(f"Agent empty response on attempt {attempt}, retrying...")

    has_tool_calls = bool(getattr(response, "tool_calls", None))
    result: dict = {"messages": [response]}

    # When agent produces a final text response (no tool calls), set final_response
    if not has_tool_calls:
        text = extract_text_content(response.content)
        if not text:
            raw = response.content
            if isinstance(raw, list):
                for part in raw:
                    if isinstance(part, dict):
                        for val in part.values():
                            if isinstance(val, str) and val.strip():
                                text = val.strip()
                                break
                    if text:
                        break
            if not text and raw:
                text = str(raw)
        if text:
            logger.info(f"Agent setting final_response: {text[:150]}")
            result["final_response"] = text

    return result


def _logged_tool_node(state: AgentState) -> dict:
    """
    Wraps LangGraph's prebuilt ToolNode with logging.
    Logs each tool call name, args, result preview, duration, and errors.
    """
    last_message = state["messages"][-1]
    tool_calls = getattr(last_message, "tool_calls", [])

    if tool_calls:
        for tc in tool_calls:
            name = tc.get("name", "?")
            args = tc.get("args", {})
            logger.info(f"Tool call: {name}({args})")

    t0 = time.time()
    try:
        result = _raw_tool_node.invoke(state)
        elapsed = time.time() - t0

        # Log tool results
        result_messages = result.get("messages", [])
        for msg in result_messages:
            if isinstance(msg, ToolMessage):
                content_preview = str(msg.content)[:300]
                tool_name = getattr(msg, "name", "unknown")
                if "error" in content_preview.lower():
                    logger.error(f"Tool {tool_name} returned error | {elapsed:.1f}s | {content_preview}")
                else:
                    logger.info(f"Tool {tool_name} completed | {elapsed:.1f}s | result_preview={content_preview}")

        return result

    except Exception as e:
        elapsed = time.time() - t0
        logger.error(f"Tool execution failed after {elapsed:.1f}s: {e}", exc_info=True)
        # Return error as a ToolMessage so the agent loop can continue
        error_messages = []
        for tc in tool_calls:
            error_messages.append(
                ToolMessage(
                    content=f"Error executing tool: {str(e)}",
                    tool_call_id=tc.get("id", ""),
                    name=tc.get("name", "unknown"),
                )
            )
        return {"messages": error_messages}


# Pre-built ToolNode — used internally by _logged_tool_node
_raw_tool_node = ToolNode(ALL_TOOLS)

# Exposed tool_node with logging wrapper
tool_node = _logged_tool_node


def should_continue_tools(state: AgentState) -> str:
    """
    Conditional edge after agent_node:
    - If the last message has tool_calls → route to 'tools' 
    - Otherwise → route to 'formatter' (for visualization) or 'validator' (for text)
    """
    last_message = state["messages"][-1]

    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        tool_names = [tc.get("name", "?") for tc in last_message.tool_calls]
        logger.debug(f"Routing to tools: {tool_names}")
        return "tools"

    # No more tool calls — decide based on response_type
    response_type = state.get("response_type")
    if response_type == "visualization":
        logger.debug("Routing to formatter (visualization)")
        return "formatter"

    logger.debug("Routing to validator (text)")
    return "validator"
