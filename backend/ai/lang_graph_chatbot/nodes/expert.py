"""
Expert Node — Handles general road-engineering Q&A.
Uses the LLM with a domain-specific system prompt and full message history.
"""

from langchain_core.messages import SystemMessage, AIMessage
from ai.lang_graph_chatbot.state import AgentState, extract_text_content
from ai.lang_chatbot.models import get_gemini_model


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

    response = llm.invoke([system] + history)

    return {
        "messages": [response],
        "final_response": extract_text_content(response.content),
    }
