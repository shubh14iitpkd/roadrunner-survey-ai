"""
Formatter Node — Transforms tool output into a visualization using structured output.
Uses LangChain's with_structured_output() to guarantee the LLM produces
data in the exact Recharts-compatible format — no post-processing needed.
"""

import json
from langchain_core.messages import SystemMessage
from ai.lang_graph_chatbot.state import AgentState
from ai.lang_graph_chatbot.models import get_gemini_model
from ai.lang_graph_chatbot.nodes.tool_node import _sanitize_messages_for_gemini
from ai.lang_graph_chatbot.nodes.viz_schema import VisualizationOutput


FORMATTER_PROMPT = """You are a data visualization formatter for a road survey AI.

Your job is to read the tool results in the conversation and produce a chart
that answers the user's question. You MUST populate the output fields correctly:

## Chart type rules
- **pie** — label-wise distribution (one slice per asset label). Use `data` field.
- **bar** — comparisons between a few items, rankings, or Good vs Damaged. Use `data` field.
- **doughnut** — same as pie but with a hole. Use `data` field.
- **stacked_bar** — label vs condition (Good/Damaged per label). Use `series` field with one series per condition.

## Data format rules
- For **pie / bar / doughnut**: populate `data` as a flat list of `{label, value}` objects.
  Example: `[{"label": "Street Light Pole", "value": 142}, ...]`
- For **stacked_bar**: populate `series` as a list of series, each with a `name` and `data`.
  Example: `[{"name": "Good", "data": [{"label": "Street Light Pole", "value": 142}]}, ...]`
- NEVER mix up the formats — `data` for flat charts, `series` for stacked_bar.
- NEVER use Chart.js format (no `labels`/`datasets` keys, no `backgroundColor`).

## Value extraction
- Extract all numbers from the tool result JSON.
- For **pie / label distribution**: use the `total` count per label.
- For **Good vs Damaged bar**: use the `good` and `damaged` counts.
- For **stacked_bar Label vs Condition**: one series for Good, one for Damaged.
- For **comparison bar** (Poles vs Feeder Pillars): use `total` count per label.
- For **risk ranking**: use `damaged` count per asset type, sorted descending.
- For **dashboard summary**: use `damaged` count per category.
- Always use real numbers from the data — never invent values.
"""


def formatter_node(state: AgentState) -> dict:
    """
    Transform tool output into a structured visualization using with_structured_output().
    The LLM is constrained to return a VisualizationOutput Pydantic model, guaranteeing
    correct Recharts-compatible format with no post-processing needed.
    """
    llm = get_gemini_model()

    # with_structured_output forces the LLM to return a VisualizationOutput object.
    # This eliminates Chart.js format, wrong key names, and missing fields.
    structured_llm = llm.with_structured_output(VisualizationOutput)

    system = SystemMessage(content=FORMATTER_PROMPT)
    history = _sanitize_messages_for_gemini(state["messages"])

    try:
        result: VisualizationOutput = structured_llm.invoke([system] + history)

        # Build the chart dict — exclude intro_text, omit None fields
        chart_dict = result.model_dump(exclude={"intro_text"}, exclude_none=True)
        chart_json = json.dumps(chart_dict, indent=2)

        content = f"{result.intro_text}\n\n```visualization\n{chart_json}\n```"

        print(f"[Formatter] Structured output OK: type={result.type}, title={result.title!r}")

    except Exception as e:
        print(f"[Formatter] Structured output failed: {e}")
        content = "I encountered an issue generating the chart. Please try rephrasing your question."

    return {
        "messages": [],
        "final_response": content,
    }
