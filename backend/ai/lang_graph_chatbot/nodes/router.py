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

User: "How many asset labels exist under the Signage category?"
Intent: tool

User: "How many asset labels are included under Roadway Lighting?"
Intent: tool

User: "List all labels under Signage"
Intent: tool

User: "List all labels under Roadway Lighting"
Intent: tool

User: "List all ITS asset labels"
Intent: tool

User: "List all Pavement asset labels"
Intent: tool

User: "Count Signage assets by label and condition"
Intent: tool

User: "Count Roadway Lighting assets by label and condition"
Intent: tool

User: "Count ITS assets by label and condition"
Intent: tool

User: "How many asset categories are present in the inventory?"
Intent: tool

User: "Identify asset category for CCTV"
Intent: tool

User: "What category does Guardrail belong to?"
Intent: tool

User: "Identify asset category for Kerb"
Intent: tool

User: "Identify asset category for Tunnel"
Intent: tool

User: "Name three asset types under Pavement"
Intent: tool

User: "Name three asset types under ITS"
Intent: tool

User: "Identify assets installed at regular intervals along the road"
Intent: tool

User: "Identify assets related to pedestrian movement"
Intent: tool

User: "Identify assets supporting traffic flow and control"
Intent: tool

User: "List all asset types under Directional Signage"
Intent: tool

User: "List all asset types included in Other Infrastructure Assets"
Intent: tool

User: "Identify all asset types under ITS"
Intent: tool

User: "What percentage of Signage assets are Gantry Directional Signs?"
Intent: tool

User: "Which label dominates the Signage inventory?"
Intent: tool

User: "Which Directional Signage label is most prone to damage?"
Intent: tool

User: "What percentage of Signage assets require attention?"
Intent: tool

User: "Summarize the overall health of Signage across the network"
Intent: tool

User: "Identify top 3 risk corridors based on Signage condition"
Intent: tool

User: "What percentage of Roadway Lighting assets are Street Light Poles?"
Intent: tool

User: "Which lighting label shows the highest damage frequency?"
Intent: tool

User: "Summarize the overall health of Roadway Lighting across the network"
Intent: tool

User: "Identify top risk locations due to poor lighting conditions"
Intent: tool

User: "What percentage of ITS assets are CCTV?"
Intent: tool

User: "Which ITS label shows highest failure rate?"
Intent: tool

User: "Summarize overall ITS health"
Intent: tool

User: "Identify top 5 safety risks in ITS network"
Intent: tool

User: "What percentage of Pavement assets are Road Marking Lines?"
Intent: tool

User: "Which Pavement label has highest deterioration rate?"
Intent: tool

User: "Summarize Pavement health across network"
Intent: tool

User: "Identify top 5 pavement risk zones"
Intent: tool

User: "What percentage of Other Infrastructure Assets are Guardrails?"
Intent: tool

User: "Which safety asset has highest damage rate?"
Intent: tool

User: "Summarize overall health of roadside safety assets"
Intent: tool

User: "What percentage of Structure assets are Bridges?"
Intent: tool

User: "Which Structure type has highest damage ratio?"
Intent: tool

User: "Summarize overall structural health of network"
Intent: tool

User: "What percentage of Beautification assets are vegetation based?"
Intent: tool

User: "Which Beautification label dominates inventory?"
Intent: tool

User: "Identify top 5 locations with degraded beautification"
Intent: tool

User: "Which category has the highest number of damaged assets?"
Intent: tool

User: "Identify top 5 assets contributing to safety risk across the network"
Intent: tool

User: "Show me a pie chart of asset conditions"
Intent: visualization

User: "Create a bar chart of damage types"
Intent: visualization

User: "Generate a pie chart showing label wise distribution of Roadway Lighting"
Intent: visualization

User: "Create a bar chart comparing Poles vs Feeder Pillars vs Cables"
Intent: visualization

User: "Generate a stacked bar chart of Lighting Label vs Condition"
Intent: visualization

User: "Show Good vs Damaged lighting assets using a bar chart"
Intent: visualization

User: "Generate a visual dashboard summary for lighting performance"
Intent: visualization

User: "Generate a pie chart showing label wise distribution of Directional Signage"
Intent: visualization

User: "Compare Street Signs vs Pole Directional Signs using a bar chart"
Intent: visualization

User: "Generate a stacked bar chart of Directional Signage Label vs Condition"
Intent: visualization

User: "Show Good vs Damaged Directional Signage using a bar chart"
Intent: visualization

User: "Create a heatmap style summary of Signage health"
Intent: visualization

User: "Generate a pie chart of ITS label distribution"
Intent: visualization

User: "Generate a bar chart comparing Monitoring vs Control devices"
Intent: visualization

User: "Generate stacked bar chart of ITS Label vs Condition"
Intent: visualization

User: "Show Good vs Damaged ITS assets using bar chart"
Intent: visualization

User: "Create a dashboard summary of ITS health"
Intent: visualization

User: "Generate a pie chart of Pavement label distribution"
Intent: visualization

User: "Compare geometric elements vs marking elements using bar chart"
Intent: visualization

User: "Generate stacked bar chart of Pavement Label vs Condition"
Intent: visualization

User: "Show Good vs Damaged Pavement assets"
Intent: visualization

User: "Generate a pie chart of Other Infrastructure label wise distribution"
Intent: visualization

User: "Generate a bar chart comparing protective vs boundary assets"
Intent: visualization

User: "Generate stacked bar chart of Other Infrastructure Label vs Condition"
Intent: visualization

User: "Create dashboard summary of roadside safety health"
Intent: visualization

User: "Generate pie chart of Structure label distribution"
Intent: visualization

User: "Compare Bridges vs Flyovers vs Underpasses using bar chart"
Intent: visualization

User: "Generate stacked bar chart of Structures Label vs Condition"
Intent: visualization

User: "Generate structural risk ranking graph"
Intent: visualization

User: "Generate pie chart of Beautification label distribution"
Intent: visualization

User: "Compare Vegetation vs Urban Furniture using bar chart"
Intent: visualization

User: "Generate stacked bar chart of Beautification Label vs Condition"
Intent: visualization

User: "Show Good vs Damaged Beautification assets using bar chart"
Intent: visualization

User: "Generate vegetation health index graph"
Intent: visualization

User: "Generate public realm quality dashboard summary"
Intent: visualization

User: "Identify locations with the highest number of Damaged Signs"
Intent: tool

User: "Identify corridors with the highest number of damaged lighting assets"
Intent: tool

User: "Identify junctions with maximum damaged ITS assets"
Intent: tool

User: "Identify corridors with highest faded road markings"
Intent: tool

User: "Identify top 5 corridors with damaged Guardrails"
Intent: tool

User: "Identify highest risk locations based on missing protective assets"
Intent: tool

User: "Identify top risk structures by corridor"
Intent: tool

User: "Identify top 5 pavement risk zones"
Intent: tool

User: "Identify top 5 locations with degraded beautification"
Intent: tool

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
