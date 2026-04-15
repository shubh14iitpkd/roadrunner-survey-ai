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

IMPORTANT: Always answer the user's LATEST question. The conversation history is provided for context only. Do NOT repeat a previous answer — read the latest message carefully and respond to it specifically. If data is needed, call the appropriate tool.

## Tool selection — conversation history
- Do NOT assume a route_id from conversation history unless the user explicitly says "this route" or "that route".
- When the user asks a cross-route question like "which route has the most defects?", use a cross-route tool (e.g. `rank_routes_by_damage`) — do NOT narrow it to a single route from history.
- Only use a route-specific tool when the user clearly specifies or references a particular route.

## Terminology
- Always use the word **"defective"** (never "damaged") when describing asset condition in your responses.
  e.g. "12 defective assets", "defective guardrails", "defective rate".

## Tool selection rules
- When the user asks for a **chart / bar chart / visualization of asset type conditions** on a route
  (e.g. "bar chart of all asset conditions", "show condition of all asset types as a chart"),
  ALWAYS use `get_asset_type_conditions_for_chart` — NOT `list_detected_assets`.
  This tool returns a flat, pre-sorted, top-N-capped list optimised for charting.
- Use `list_detected_assets` only for text-based listings, not charts.
- When the user asks to show data **on a map**, use `get_assets_for_map`. This tool returns a ready-made response with a ```map code block. When you receive the result from this tool, return it EXACTLY as-is — do not modify, summarize, or strip the ```map block.

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

    Strategy:
    1. Keep conversation history (alternating Human/AI pairs) for context.
    2. From the last HumanMessage onward, keep the current turn's tool-calling
       loop intact.
    3. Ensure the first message is always a HumanMessage.
    """
    if not messages:
        return messages

    # Find the index of the last HumanMessage (start of the current turn)
    last_human_idx = -1
    for i in range(len(messages) - 1, -1, -1):
        if isinstance(messages[i], HumanMessage):
            last_human_idx = i
            break

    if last_human_idx == -1:
        logger.warning("No HumanMessage found in messages during sanitization")
        return messages

    # Split: conversation history (before last HumanMessage) + current turn
    history = messages[:last_human_idx]
    current_turn = messages[last_human_idx:]

    # Build sanitized history: keep alternating Human/AI pairs, skip tool-call messages
    sanitized_history = []
    for msg in history:
        if isinstance(msg, ToolMessage):
            continue  # Skip tool messages from prior turns
        if isinstance(msg, AIMessage) and msg.tool_calls:
            continue  # Skip tool-calling AI messages from prior turns
        if isinstance(msg, AIMessage) and sanitized_history and isinstance(sanitized_history[-1], AIMessage):
            continue  # Skip consecutive AI messages
        sanitized_history.append(msg)

    # Ensure history starts with a HumanMessage (Gemini requirement)
    while sanitized_history and not isinstance(sanitized_history[0], HumanMessage):
        sanitized_history.pop(0)

    # Cap history to last 10 messages to stay within context limits
    sanitized_history = sanitized_history[-10:]

    # Sanitize current turn
    sanitized_turn = []
    for msg in current_turn:
        if isinstance(msg, AIMessage) and not msg.tool_calls and sanitized_turn and isinstance(sanitized_turn[-1], AIMessage):
            logger.debug("Skipping consecutive non-tool AIMessage during sanitization")
            continue
        sanitized_turn.append(msg)

    result = sanitized_history + sanitized_turn
    logger.debug(f"Sanitized messages: {len(messages)} → {len(result)} (history={len(sanitized_history)}, turn={len(sanitized_turn)})")
    return result


def agent_node(state: AgentState) -> dict:
    """
    LLM call with tool bindings. The LLM may produce tool_calls
    in its response, which will be executed by the ToolNode downstream.
    """
    # If a tool already set final_response (e.g. map passthrough), skip the LLM call
    if state.get("final_response"):
        logger.info("Agent skipping LLM call — final_response already set (map passthrough)")
        return {"messages": []}

    llm = get_gemini_model()
    llm_with_tools = llm.bind_tools(ALL_TOOLS)

    route_id = state.get("route_id", "none")
    context = _build_context(state)
    prompt = AGENT_PROMPT.format(context=context, route_id=route_id)

    system = SystemMessage(content=prompt)
    # Pass the full message list so the sanitizer can always find the last HumanMessage.
    history = _sanitize_messages_for_gemini(state["messages"])

    logger.info(f"Agent invocation | route_id={route_id} | message_count={len(history)}")

    MAX_RETRIES = 5
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
            import time as _time; _time.sleep(0.5)  # brief pause before retry

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

        # Log tool results and check for map passthrough
        result_messages = result.get("messages", [])
        for msg in result_messages:
            if isinstance(msg, ToolMessage):
                content_preview = str(msg.content)[:300]
                tool_name = getattr(msg, "name", "unknown")
                if "error" in content_preview.lower():
                    logger.error(f"Tool {tool_name} returned error | {elapsed:.1f}s | {content_preview}")
                else:
                    logger.info(f"Tool {tool_name} completed | {elapsed:.1f}s | result_preview={content_preview}")

                # If tool returned a ```map block, pass it through directly as final_response
                # to prevent the agent LLM from rewriting/stripping the JSON
                tool_content = str(msg.content)
                if "```map" in tool_content:
                    logger.info(f"Map passthrough: setting tool result as final_response")
                    result["final_response"] = tool_content

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
