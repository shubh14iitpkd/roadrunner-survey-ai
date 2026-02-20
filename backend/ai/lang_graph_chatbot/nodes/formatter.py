"""
Formatter Node — Transforms tool output into visualization JSON.
Only invoked when response_type is VISUALIZATION.
Produces a ```visualization code block with chart JSON.
"""

from langchain_core.messages import SystemMessage, AIMessage
from ai.lang_graph_chatbot.state import AgentState, extract_text_content
from ai.lang_graph_chatbot.models import get_gemini_model


FORMATTER_PROMPT = """You are a data visualization formatter.

Your job is to take raw data from tool results and produce a response that contains:
1. A brief sentence introducing the visualization
2. A fenced code block tagged as ```visualization containing valid JSON for a chart

The JSON format MUST follow this exact structure:
{
  "type": "<chart_type>",
  "title": "<chart title>",
  "data": [
    {"label": "<label>", "value": <number>},
    ...
  ]
}

Supported chart types: "pie", "bar", "doughnut"

Example for asset condition data:

Here's the asset condition breakdown:

```visualization
{
  "type": "pie",
  "title": "Asset Conditions",
  "data": [
    {"label": "Good", "value": 340},
    {"label": "Damaged", "value": 67}
  ]
}
```

IMPORTANT RULES:
- Extract the actual numbers from the tool output messages in the conversation
- The JSON must be valid and parseable
- Only output ONE visualization code block
- Always include a brief introductory sentence before the code block
- Do not include any other code blocks
"""


def formatter_node(state: AgentState) -> dict:
    """
    Transform tool output into a visualization JSON code block.
    Reads the conversation history (which includes tool results)
    and produces a formatted visualization response.
    """
    llm = get_gemini_model()

    system = SystemMessage(content=FORMATTER_PROMPT)
    # Include recent messages which contain the tool results
    history = state["messages"][-3:]

    response = llm.invoke([system] + history)

    return {
        "messages": [response],
        "final_response": extract_text_content(response.content),
    }
