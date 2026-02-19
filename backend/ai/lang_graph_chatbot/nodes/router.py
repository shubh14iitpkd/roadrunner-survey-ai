"""
Router Node — Intent classification for incoming user messages.
Classifies into: expert, tool, or visualization.
Uses LLM-based classification with few-shot examples for reliable routing.
"""

from langchain_core.messages import SystemMessage, HumanMessage
from ai.lang_graph_chatbot.state import AgentState, ResponseType, extract_text_content
from ai.lang_graph_chatbot.models import get_gemini_model


ROUTER_PROMPT = """You are an intent classifier for a road survey AI assistant.
Given the user's latest message, classify the intent into EXACTLY ONE of these categories:

- **expert**: General knowledge questions, greetings, explanations, advice, opinions, or anything that does NOT require looking up specific data from a database. Use this for anything conversational or educational.
- **tool**: The user wants specific data retrieved from the database — listing videos, listing surveys, counting assets, getting condition reports, or any request that requires querying stored data.
- **visualization**: The user explicitly asks for a chart, graph, pie chart, bar chart, doughnut chart, or any visual/graphical representation of data.

## Examples

User: "Hello!"
Intent: expert

User: "What is a pothole?"
Intent: expert

User: "How does road drainage work?"
Intent: expert

User: "What causes road deterioration?"
Intent: expert

User: "What are best practices for road surveys?"
Intent: expert

User: "List all videos"
Intent: tool

User: "Show me my surveys"
Intent: tool

User: "How many assets are damaged?"
Intent: tool

User: "What is the condition of assets in this video?"
Intent: tool

User: "Tell me about the latest survey"
Intent: tool

User: "How many surveys this month?"
Intent: tool

User: "Who conducted the most surveys?"
Intent: tool

User: "Describe this route"
Intent: tool

User: "Where were traffic signs detected?"
Intent: tool

User: "Where are the damage hotspots?"
Intent: tool

User: "Which assets have the most defects?"
Intent: tool

User: "What is the condition of street lights?"
Intent: tool

User: "What are the asset categories?"
Intent: tool

User: "Show me a pie chart of asset conditions"
Intent: visualization

User: "Create a bar chart of damage types"
Intent: visualization

Respond with ONLY the single word: expert, tool, or visualization. Nothing else."""


def router_node(state: AgentState) -> dict:
    """
    Classify the user's intent using the LLM and store the full classification
    in state so get_route can use it directly without keyword heuristics.
    """
    llm = get_gemini_model()

    last_msg = _extract_last_user_message(state)

    messages = [
        SystemMessage(content=ROUTER_PROMPT),
        HumanMessage(content=last_msg),
    ]

    response = llm.invoke(messages)
    raw = extract_text_content(response.content).strip().lower()

    # Normalize: only accept known intents, default to expert
    if raw in ("tool", "visualization"):
        intent = raw
    else:
        intent = "expert"

    print(f"[Router] Raw LLM output: '{raw}' → Intent: {intent}")

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
