"""
Router Node — Intent classification for incoming user messages.
Classifies into: expert, tool, or visualization.
Uses LLM-based classification with few-shot examples for reliable routing.
"""

import logging
import time

from langchain_core.messages import SystemMessage, HumanMessage
from ai.lang_graph_chatbot.state import AgentState, ResponseType, extract_text_content
from ai.lang_graph_chatbot.models import get_gemini_model

logger = logging.getLogger("chatbot.router")


ROUTER_PROMPT = """You are an intent classifier for a road survey assistant.
Classify the user's latest message into exactly one of: expert, tool, or visualization.

- expert: general knowledge, definitions, advice, or anything that does not require querying the database.
- tool: requires fetching or computing specific data (lists, counts, conditions, survey results, locations).
- visualization: explicitly asks for a chart/graph or other visual output.

Respond with ONLY one word: expert, tool, or visualization."""

def router_node(state: AgentState) -> dict:
    """
    Classify the user's intent using the LLM and store the full classification
    in state so get_route can use it directly without keyword heuristics.
    """
    llm = get_gemini_model()

    last_msg = _extract_last_user_message(state)
    logger.info(f"Router classifying: '{last_msg[:120]}'")

    messages = [
        SystemMessage(content=ROUTER_PROMPT),
        HumanMessage(content=last_msg),
    ]

    t0 = time.time()
    try:
        response = llm.invoke(messages)
    except Exception as e:
        logger.error(f"Router LLM call failed: {e}", exc_info=True)
        return {"intent": "expert", "response_type": ResponseType.TEXT}
    elapsed = time.time() - t0

    raw = extract_text_content(response.content).strip().lower()

    # Normalize: only accept known intents, default to expert
    if raw in ("tool", "visualization"):
        intent = raw
    else:
        intent = "expert"

    logger.info(f"Router result: raw='{raw}' → intent={intent} | {elapsed:.1f}s")

    if intent == "visualization":
        return {
            "intent": "visualization",
            "response_type": ResponseType.VISUALIZATION,
        }
    elif intent == "tool":
        return {
            "intent": "tool",
            "response_type": ResponseType.TEXT,
        }
    else:
        return {
            "intent": "expert",
            "response_type": ResponseType.TEXT,
        }


def get_route(state: AgentState) -> str:
    """
    Conditional edge function after router_node.
    Reads the intent stored by router_node and maps to graph edges.
    
    Returns: "expert" | "agent" (agent handles both tool and visualization)
    """
    intent = state.get("intent", "expert")

    if intent in ("tool", "visualization"):
        return "agent"

    return "expert"


def _extract_last_user_message(state: AgentState) -> str:
    """Extract the content of the last human message from state."""
    for msg in reversed(state["messages"]):
        if hasattr(msg, "type") and msg.type == "human":
            return msg.content
        elif isinstance(msg, dict) and msg.get("role") == "user":
            return msg.get("content", "")
    return ""
