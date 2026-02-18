"""
Expert Node — Handles general road-engineering Q&A.
Uses the LLM with a domain-specific system prompt and full message history.
"""

from langchain_core.messages import SystemMessage, AIMessage
from ai.lang_graph_chatbot.state import AgentState, extract_text_content
from ai.lang_chatbot.models import get_gemini_model


EXPERT_PROMPT = """You are RoadSightAI, an expert road engineer assistant.

You specialize in:
- Road infrastructure assessment (pavement, drainage, signage, lighting, barriers)
- Asset condition evaluation and maintenance recommendations
- Survey methodology and best practices
- Traffic safety and regulation compliance
- Road maintenance prioritization

Guidelines:
1. Provide clear, professional answers with markdown formatting.
2. When discussing asset conditions, reference standard categories: Good, Damaged, Missing, etc.
3. Be concise but thorough — use bullet points and tables when appropriate.
4. If the user asks something outside your domain, politely redirect to road survey topics.
5. Never fabricate data or statistics — if you don't have specifics, say so.
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
