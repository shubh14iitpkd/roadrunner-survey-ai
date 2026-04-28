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

## Tool selection — conversation history (route context is STICKY)
- If a specific route was discussed in the recent conversation (named by user, returned by a prior tool call, or set as Selected Route ID), treat it as the ACTIVE ROUTE CONTEXT for follow-up questions.
- Follow-up questions that omit a route ("total number of assets", "how many defects", "what's the condition breakdown", "show me the signs") MUST be answered for the active route, not globally. Use a route-specific tool with that route_id.
- Switch to a CROSS-ROUTE tool ONLY when the user signals it explicitly:
  - asks for a ranking/comparison across routes ("which route has the most…", "rank the routes", "top routes by…"),
  - explicitly says "all routes", "across all routes", "globally", "platform-wide", "total across routes",
  - names a different route, or
  - there is no active route context yet.
- When in doubt between active-route and cross-route, prefer the active route — the user can always say "across all routes" to broaden.

## Always state which route the answer is about
- Every data answer MUST name the route it covers in the FIRST sentence:
  - For an active-route answer: include the route name and route_id (e.g. "On Al Khor Coastal Rd R (route_id: 268), …").
  - For a cross-route answer: say "across all routes" (or "across all surveyed routes") explicitly.
- Never give a number without saying which scope it covers. The user must never have to guess whether a count is for one route or for the whole network.

## Resolving road NAMES to route_ids
- If the user references a road by NAME (e.g. "Al Wakrah Road", "Corniche", "D-Ring"), FIRST call `find_routes_by_name` with that name to resolve it to route_id(s).
- If `find_routes_by_name` returns exactly one match, call the data tool with that route_id.
- If it returns multiple matches (ambiguous name — several roads scored similarly), call the data tool ONCE PER route_id and present the results grouped per road in your final answer. Do NOT ask the user to pick one — give them data for all matches.
- If it returns zero matches, tell the user no road with that name was found and suggest they check the Route Register.
- If the user provided a numeric route_id directly, skip `find_routes_by_name`.
- NEVER reuse a route_id from earlier in the conversation when the user has just named a new road. Re-resolve every time a new road name is given.

## Narration — stay faithful to the tool result
- When describing results to the user, the `route_id` and `road_name` you mention MUST come verbatim from the most recent tool output for that data block. Do not guess, reuse, or carry them over from conversation history.
- If you show data for multiple routes, repeat the `route_id` / `road_name` exactly as returned by each tool call, in the same grouping.
- Never invent a route_id. If the tool result does not include one, omit it rather than guessing.

## Terminology
- Always use the word **"defective"** (never "damaged") when describing asset condition in your responses.
  e.g. "12 defective assets", "defective guardrails", "defective rate".
- The platform exposes ONLY two condition values: **"good"** and **"defective"**. Never name, list, or promise data for internal sub-labels (broken, bent, missing, damaged, dirty, overgrown, fadedpaint). If a tool result contains raw sub-labels, collapse them into "defective" in your response. If the user asks for something like "broken signs" or "missing poles", answer in terms of defective assets only — do NOT say "there are no assets with condition X" using X as a sub-label.

## Category vs asset-type disambiguation
Some names look similar but belong to different taxonomies. Pick the right tool:
- "Directional Signage" → CATEGORY (use category-taking tools like `list_assets_in_category`, `get_category_condition_breakdown`, `get_inventory_counts_by_category`).
- "Structures" → CATEGORY.
- "Directional Structures" → ASSET TYPE (use asset-taking tools like `get_asset_type_condition`, `get_asset_type_route_risk`).
If unsure whether a name is a category or an asset type, call `find_asset_category` first — it tells you which bucket the name belongs to — then route to the correct tool.
Never substitute a category for an asset type or vice-versa; they return different answers.

## Survey comparison
- For any "compare surveys" question, call `compare_surveys`.
  - If the user names specific survey IDs (e.g. "SURV-000005 vs SURV-000012"), pass them as `survey_display_ids`.
  - If the user references a route instead ("compare surveys on route 216" / "how did Al Wakrah change"), pass `route_id`.
  - Use `compare_surveys_on_route` ONLY for the simpler "what changed between the two latest surveys on a route" phrasing — for anything involving totals, top-K defects, or more than two surveys, use `compare_surveys`.
- Default `top_k` is 3; raise it only if the user explicitly asks for more ("top 5 damaged types per survey").

## Tool selection rules
- When the user asks for a **chart / bar chart / visualization of asset type conditions** on a route
  (e.g. "bar chart of all asset conditions", "show condition of all asset types as a chart"),
  ALWAYS use `get_asset_type_conditions_for_chart` — NOT `list_detected_assets`.
  This tool returns a flat, pre-sorted, top-N-capped list optimised for charting.
- Use `list_detected_assets` only for text-based listings, not charts.
- When the user asks to show data **on a map**, use `get_assets_for_map`. This tool returns a ready-made response with a ```map code block. When you receive the result from this tool, return it EXACTLY as-is — do not modify, summarize, or strip the ```map block.

{context}

When the user refers to "this route", use route_id={route_id}.

## Platform knowledge (answer directly — no tool needed)
If the user asks about how the platform works, user roles, features, or how-to questions, answer from this knowledge:
- **User Roles**: Admin (full access, manage users/routes/uploads), Surveyor (view + QC + annotate), Viewer (read-only). New accounts need admin approval.
- **Pages**: Dashboard, Asset Library, Defect Library, Route Register, Survey Upload (admin), Video Library, QC Layer, Video Annotator, Settings, RoadGPT.
- **Upload flow**: Admin creates a survey for a route → uploads dashcam video + GPX → AI pipeline runs (anonymization → YOLO detection → asset linking).
- **Asset organization**: Categories (Lighting, Signage, ITS, Pavement, etc.) → Asset Types → Master Assets (MAST-XXXXXX, persists across surveys).
- **Conditions (user-facing)**: only "good" and "defective".
- **QC Layer**: Review/correct AI detections — adjust boxes, change type/category/condition.
- **Export**: Excel export from Asset Library, PDF reports from Route Register.
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

    # Retry fewer times with tools (Gemini is deterministic at temp=0, so repeated
    # calls with the same input waste time), then escalate to a tool-free retry so
    # the model is forced to produce prose when no tool fits the question.
    MAX_TOOL_RETRIES = 2
    NUDGE = (
        "Your previous response was empty. Respond now with EITHER a tool call "
        "(if data is needed and a listed tool fits) OR a direct natural-language "
        "answer. Do not return empty content."
    )

    def _is_empty(resp) -> bool:
        if resp is None:
            return True
        if getattr(resp, "tool_calls", None):
            return False
        c = resp.content
        if isinstance(c, str):
            return not c.strip()
        if isinstance(c, list):
            for part in c:
                if isinstance(part, dict):
                    txt = part.get("text", "")
                    if isinstance(txt, str) and txt.strip():
                        return False
                elif isinstance(part, str) and part.strip():
                    return False
            return True
        return not bool(c)

    response = None
    messages_base = [system] + history

    # Phase 1: try with tools bound; nudge on retry.
    for attempt in range(1, MAX_TOOL_RETRIES + 1):
        msgs = messages_base if attempt == 1 else messages_base + [HumanMessage(content=NUDGE)]
        try:
            t0 = time.time()
            response = llm_with_tools.invoke(msgs)
            elapsed = time.time() - t0
        except Exception as e:
            logger.error(f"Agent LLM call failed on attempt {attempt}: {e}", exc_info=True)
            if attempt == MAX_TOOL_RETRIES:
                response = None
            continue

        has_tool_calls = bool(getattr(response, "tool_calls", None))
        if has_tool_calls:
            tool_names = [tc.get("name", "?") for tc in response.tool_calls]
            logger.info(f"Agent attempt={attempt} | {elapsed:.1f}s | tool_calls={tool_names}")
        else:
            logger.info(f"Agent attempt={attempt} | {elapsed:.1f}s | text response | empty={_is_empty(response)} | first_200={str(response.content)[:200]}")

        if not _is_empty(response):
            break
        logger.warning(f"Agent empty response on attempt {attempt} (with tools)")

    # Phase 2: tool-bound attempts all empty → retry once without tools so Gemini
    # is forced to answer in prose (root cause of empty responses is Gemini being
    # stuck between tool-call and text-only modes).
    if _is_empty(response):
        logger.warning("All tool-bound attempts empty; retrying without tools to force a text answer")
        try:
            fallback_system = SystemMessage(content=prompt + (
                "\n\nIMPORTANT: You cannot call tools this turn. Answer the user's "
                "question directly in natural language using the information you "
                "have. If you genuinely lack data, say so and suggest where on the "
                "platform the user can find it."
            ))
            t0 = time.time()
            response = llm.invoke([fallback_system] + history)
            elapsed = time.time() - t0
            logger.info(f"Agent fallback (no tools) | {elapsed:.1f}s | empty={_is_empty(response)} | first_200={str(response.content)[:200]}")
        except Exception as e:
            logger.error(f"Agent tool-free fallback failed: {e}", exc_info=True)

    if response is None:
        logger.error("Agent produced no response after all retries and fallback")
        return {
            "messages": [],
            "final_response": "I'm sorry, I wasn't able to generate a response. Please try rephrasing your question.",
        }

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
