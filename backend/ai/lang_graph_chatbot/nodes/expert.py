"""
Expert Node — Handles general road-engineering Q&A.
Uses the LLM with a domain-specific system prompt and full message history.
"""

import logging
import time

from langchain_core.messages import SystemMessage, AIMessage
from ai.lang_graph_chatbot.state import AgentState, extract_text_content
from ai.lang_graph_chatbot.models import get_gemini_model

logger = logging.getLogger("chatbot.expert")


EXPERT_PROMPT = """You are RoadSightAI — a friendly road engineering expert.

Keep answers **brief and natural** (2-3 sentences unless the user asks for details).
Talk like a helpful colleague, not a textbook.

You know about:
- Road infrastructure (pavement, drainage, signage, lighting, barriers)
- Asset condition assessment and maintenance
- Survey methodology and traffic safety

If you don't have specifics, say so honestly. Stay on topic — if asked about something outside roads, gently redirect.
"""



def expert_node(state: AgentState) -> dict:
    """
    Handle general road-engineering questions using the LLM directly.
    No tools needed — just conversation with domain expertise.
    """
    llm = get_gemini_model()

    # Build messages with system prompt + conversation history
    system = SystemMessage(content=EXPERT_PROMPT)
    
    # Take last 10 messages for context window management
    history = state["messages"][-10:]

    logger.info(f"Expert invocation | message_count={len(history)}")
    t0 = time.time()
    try:
        response = llm.invoke([system] + history)
    except Exception as e:
        logger.error(f"Expert LLM call failed: {e}", exc_info=True)
        return {
            "messages": [],
            "final_response": "I'm sorry, I encountered an error. Please try again.",
        }
    elapsed = time.time() - t0

    text = extract_text_content(response.content)
    logger.info(f"Expert response | {elapsed:.1f}s | first_150={text[:150]}")

    return {
        "messages": [response],
        "final_response": text,
    }
