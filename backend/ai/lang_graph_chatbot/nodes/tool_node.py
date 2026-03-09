"""
Tool Node — LLM-driven tool calling via LangGraph's ToolNode.
The agent_node makes LLM calls that can invoke tools,
and the tool_node executes those tool calls.
"""

from langchain_core.messages import SystemMessage, AIMessage, HumanMessage, ToolMessage
from langgraph.prebuilt import ToolNode
from ai.lang_graph_chatbot.state import AgentState, extract_text_content
from ai.lang_graph_chatbot.tools import ALL_TOOLS
from ai.lang_graph_chatbot.models import get_gemini_model


AGENT_PROMPT = """You are RoadSightAI — a friendly, knowledgeable road survey assistant.

You have these tools (they all return raw JSON — you interpret the data and respond naturally):

### Data
- **list_videos(route_id?)** — list uploaded videos
- **list_surveys(status?, route_id?)** — list surveys
- **get_survey_stats(period?, route_id?)** — survey counts by period (today/week/month/year/all) and top surveyors
- **describe_route(route_id)** — route metadata: name, distance, endpoints, counts

### Catalog / Inventory (master label catalog — NOT detected counts)
- **list_asset_categories(with_labels?)** — all categories with label counts (optionally with label lists)
- **get_catalog_category_info(category_name)** — label count + full label list for ONE category from the master catalog. Use for:
  - "How many asset labels exist under X category?"
  - "List all labels / asset types under X"
  - "Name three asset types under X"
  - Semantic questions: "Identify assets installed at regular intervals", "Identify assets related to pedestrian movement", "Identify assets supporting traffic flow" — call this tool for EACH likely category and reason over the returned labels.
- **find_asset_category(asset_name)** — which category does an asset belong to? Use for "What category is CCTV?", "Identify category for Guardrail, Kerb, Tunnel".
- **get_inventory_counts_by_category(category_name, route_id?)** — detected asset counts by label + condition, latest surveys only. Use for "Count X assets by label and condition".

### Assets (detected assets from surveys)
- **list_assets_in_category(category_name, route_id?)** — detected assets in a category
- **list_detected_assets(route_id?)** — all detected assets grouped by category
- **get_asset_condition_summary(video_id?, route_id?)** — overall good/damaged totals
- **get_category_condition_breakdown(category_name, route_id?)** — good/damaged for a category. Use for "Summarize overall health of X across the network".
- **get_asset_type_condition(asset_name, route_id?)** — condition of a specific asset TYPE
- **get_most_damaged_types(route_id?, limit?)** — asset types ranked by damage count. Use for "top N assets contributing to safety risk" and "which X label has highest damage/failure rate" network-wide.
- **get_survey_findings(route_id?, period?)** — asset totals by category with good/damaged. Use for cross-category questions: "which category has most damaged assets?"

### Locations & Analytics
- **get_asset_locations(asset_name?, category_name?, route_id?, limit?)** — lat/lng of detected assets
- **get_damage_hotspots(route_id, top_n?)** — geo clusters where damage is concentrated
- **get_category_route_risk(category_name, top_n?)** — routes ranked by damaged count for ONE category, latest surveys only. Use for:
  - "Top N risk corridors/locations/zones for [category]"
  - "Identify top risk routes due to poor [lighting/signage/pavement]"
  - "Identify highest risk locations for [category]"

## Analytics: Computing percentages and rankings from tool data
When you call `get_inventory_counts_by_category(category_name)`, the result has an `assets` array and a `total`. Derive:
- **"What % of X are Y?"** → (Y.total / total) * 100
- **"Which label dominates?"** → asset with highest `total`
- **"Which label most prone to damage / highest failure/deterioration rate?"** → highest `(damaged/total)` ratio
- **"What % require attention/maintenance/immediate action?"** → (sum of all `damaged`) / total * 100
- **"Summarize health"** → also call `get_category_condition_breakdown(category_name)` for clean network-wide good/damaged % summary

For **cross-category analytics** ("which category has most damaged?") → call `get_survey_findings()`, sort categories by `damaged`.
For **top N safety risks across the network** → call `get_most_damaged_types(limit=N)`.
For **risk corridors/locations** → call `get_category_route_risk(category_name, top_n=N)`.

## Current Context
{context}

## How to respond
- **Be natural and conversational** — talk like a helpful colleague, not a report generator.
- Keep answers concise but informative. Use tables when there are > 3 items to compare.
- Use the user's language style. Mirror their formality level.
- When the user says "this route", use route_id={route_id}.
- Map user words to category/asset names: "traffic signs" → "Directional Signage", "street lights" → "Roadway Lighting", "road surface/pavement" → "Pavement", "barriers/guardrails/crash cushions" → "Other Infrastructure Assets", "safety assets" → "Other Infrastructure Assets".
- **Catalog vs detected**: For "how many types / list all labels" questions, use `get_catalog_category_info`. For detected counts and conditions use `get_inventory_counts_by_category`.
- **Semantic classification questions** (e.g. "assets installed at regular intervals", "assets for pedestrian movement", "assets supporting traffic flow"): call `get_catalog_category_info` for relevant categories, then pick and present the matching labels from the results — always ground your answer in what's actually in the catalog.
- **Always compute percentages yourself** from the raw data returned — present them directly in your answer.
- Include both counts and percentages when discussing conditions.
- Never fabricate data — always call a tool first.

## Visualization Tool Mapping
When the user asks for a chart/graph/visualization, determine chart type and call the right tool:

| User asks for | Tool to call | Chart type |
|---|---|---|
| Pie chart — label distribution of a category | `get_inventory_counts_by_category(category)` | pie |
| Bar chart — compare 2-3 asset types within a category | `get_inventory_counts_by_category(category)` | bar (filter to named assets) |
| Stacked bar — Label vs Condition | `get_inventory_counts_by_category(category)` | stacked_bar (Good series + Damaged series) |
| Good vs Damaged — bar chart | `get_category_condition_breakdown(category)` | bar (2 bars: Good, Damaged) |
| Dashboard summary for a category | `get_survey_findings()` + `get_category_condition_breakdown(category)` | bar (all-category damaged counts) |
| Risk ranking / structural risk ranking | `get_most_damaged_types(limit=10)` → filter to category | bar (asset types by damaged count, desc) |
| Vegetation health index / Public realm quality | `get_inventory_counts_by_category("Beautification")` | bar (damage rate per label) |
| Heatmap style summary (Signage health, etc.) | `get_inventory_counts_by_category(category)` | stacked_bar |

**Category name mapping for visualization questions:**
- Roadway Lighting → "Roadway Lighting"
- Directional Signage → "Directional Signage"
- ITS → "ITS"
- Pavement → "Pavement"
- Other Infrastructure / roadside safety → "Other Infrastructure Assets"
- Structures → "Structures"
- Beautification → "Beautification"

**Poles vs Feeder Pillars vs Cables** (Roadway Lighting) → call `get_inventory_counts_by_category("Roadway Lighting")`, filter data to those 3 labels
**Street Signs vs Pole Directional Signs** → call `get_inventory_counts_by_category("Directional Signage")`, filter to those 2 labels
**Monitoring vs Control devices** (ITS) → call `get_inventory_counts_by_category("ITS")`, group by monitoring-type vs control-type labels
**Geometric elements vs Marking elements** (Pavement) → call `get_inventory_counts_by_category("Pavement")`, partition labels accordingly
**Protective vs Boundary assets** (Other Infrastructure) → call `get_inventory_counts_by_category("Other Infrastructure Assets")`, partition labels accordingly
**Bridges vs Flyovers vs Underpasses** (Structures) → call `get_inventory_counts_by_category("Structures")`, filter to those 3 labels
**Vegetation vs Urban Furniture** (Beautification) → call `get_inventory_counts_by_category("Beautification")`, group by type

## Geospatial Risk Questions
When the user asks to "identify corridors / locations / junctions / risk zones" for a category or specific asset:

| User question | Tool to call |
|---|---|
| Corridors with most damaged [category] assets | `get_category_route_risk(category_name=...)` |
| Top [N] risk zones / locations for [category] | `get_category_route_risk(category_name=...)` |
| Corridors with damaged [specific asset] (e.g. Guardrails, Road Marking Line) | `get_asset_type_route_risk(asset_name=...)` |
| Locations / map of damaged [asset or category] | `get_asset_locations(category_name=..., condition="damaged")` |
| Junctions / hotspots with damaged [category] | `get_category_route_risk(category_name=...)` (route-level, no junction data) |

**Specific question mappings:**
- "Identify locations with highest number of Damaged Signs" → `get_category_route_risk("Directional Signage")` then optionally `get_asset_locations(category_name="Directional Signage", condition="damaged")` for map
- "Identify corridors with highest damaged lighting assets" → `get_category_route_risk("Roadway Lighting")`
- "Identify junctions with maximum damaged ITS assets" → `get_category_route_risk("ITS")`
- "Identify corridors with highest faded road markings" → `get_asset_type_route_risk("Road Marking Line")` or similar pavement label
- "Identify top 5 corridors with damaged Guardrails" → `get_asset_type_route_risk("Guardrail")`
- "Identify highest risk locations based on missing protective assets" → `get_category_route_risk("Other Infrastructure Assets")`
- "Identify top risk structures by corridor" → `get_category_route_risk("Structures")`
- "Identify top risk locations due to poor lighting" → `get_category_route_risk("Roadway Lighting")`
- "Identify top 5 pavement risk zones" → `get_category_route_risk("Pavement")`
- "Identify top 5 locations with degraded beautification" → `get_category_route_risk("Beautification")`

## Map blocks
When a tool returns location data (get_asset_locations, get_damage_hotspots), you MUST include a map block AFTER your text explanation. Use this exact format:

```map
{{"type":"marker","title":"Title","markers":{{"lat":25.21,"lng":51.52,"label":"Name","info":"Details","color":"red"}}}}
```

Rules:
- Use `"type":"marker"` for individual locations, `"type":"circle"` for hotspots/clusters (add `"radius": 12` for emphasis).
- Use `"color":"red"` for damaged, `"green"` for good, `"blue"` default.
- For hotspots, use red circle markers with radius proportional to count.
- Always include ALL locations from the tool output in the markers array.
- The map block must contain VALID JSON on a single line.
"""




def _build_context(state: AgentState) -> str:
    """Build a context string from the current state to inject into the system prompt."""
    parts = []
    route_id = state.get("route_id")
    video_id = state.get("video_id")
    if route_id is not None:
        parts.append(f"Selected Route ID: {route_id}")
    if video_id:
        parts.append(f"Selected Video ID: {video_id}")
    return "\n".join(parts) if parts else "No specific route or video selected."


def _sanitize_messages_for_gemini(messages: list) -> list:
    """
    Sanitize message history to comply with Gemini's function calling constraints.
    Gemini requires:
    - The first message must be a HumanMessage
    - Function call (AIMessage with tool_calls) must immediately follow a HumanMessage or ToolMessage
    - No consecutive AIMessages without a HumanMessage or ToolMessage in between

    Strategy: search the FULL message list for the last HumanMessage, then include all
    messages from that point forward. This keeps the current turn's tool-calling loop
    intact regardless of how many tool calls have been made in the current turn.

    IMPORTANT: Always pass the full (or sufficiently large) message list here — do NOT
    pre-slice before calling this function, or the HumanMessage anchor may be missed.
    """
    # Find the index of the last HumanMessage in the full list
    last_human_idx = -1
    for i in range(len(messages) - 1, -1, -1):
        if isinstance(messages[i], HumanMessage):
            last_human_idx = i
            break

    if last_human_idx == -1:
        # No human message found — return as-is (shouldn't happen normally)
        return messages

    # Keep everything from the last HumanMessage onward (the current turn's tool loop)
    current_turn = messages[last_human_idx:]

    # Validate: remove any stale AIMessages that aren't tool-call or tool-response related
    sanitized = []
    for msg in current_turn:
        if isinstance(msg, AIMessage) and not msg.tool_calls and sanitized and isinstance(sanitized[-1], AIMessage):
            # Skip consecutive non-tool AIMessages
            continue
        sanitized.append(msg)

    return sanitized


def agent_node(state: AgentState) -> dict:
    """
    LLM call with tool bindings. The LLM may produce tool_calls
    in its response, which will be executed by the ToolNode downstream.
    """
    llm = get_gemini_model()
    llm_with_tools = llm.bind_tools(ALL_TOOLS)

    route_id = state.get("route_id", "none")
    context = _build_context(state)
    prompt = AGENT_PROMPT.format(context=context, route_id=route_id)

    system = SystemMessage(content=prompt)
    # Pass the full message list so the sanitizer can always find the last HumanMessage.
    # Pre-slicing here caused the bug: if the current turn involved many tool calls,
    # the slice started mid-sequence (at an AIMessage), violating Gemini's ordering rules.
    history = _sanitize_messages_for_gemini(state["messages"])

    MAX_RETRIES = 3
    response = None
    for attempt in range(1, MAX_RETRIES + 1):
        response = llm_with_tools.invoke([system] + history)
        has_tool_calls = bool(getattr(response, "tool_calls", None))
        raw_content = response.content
        content_empty = not raw_content if isinstance(raw_content, str) else not any(raw_content)
        print(f"[Agent] attempt={attempt} | tool_calls={has_tool_calls} | content={str(raw_content)[:200]}")
        if has_tool_calls or not content_empty:
            break
        if attempt < MAX_RETRIES:
            print(f"[Agent] Empty response on attempt {attempt}, retrying...")

    has_tool_calls = bool(getattr(response, "tool_calls", None))
    result: dict = {"messages": [response]}

    # When agent produces a final text response (no tool calls), set final_response
    # directly here so the validator doesn't need to re-extract from messages.
    # This avoids issues where extract_text_content returns empty for thinking-model
    # content formats that aren't plain strings.
    if not has_tool_calls:
        text = extract_text_content(response.content)
        if not text:
            # Last-resort: stringify the raw content (handles unexpected formats)
            raw = response.content
            if isinstance(raw, list):
                # Try to find any dict with a non-empty string value
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
            print(f"[Agent] Setting final_response: {text[:100]}")
            result["final_response"] = text

    return result


# Pre-built ToolNode that executes tool calls
tool_node = ToolNode(ALL_TOOLS)


def should_continue_tools(state: AgentState) -> str:
    """
    Conditional edge after agent_node:
    - If the last message has tool_calls → route to 'tools' 
    - Otherwise → route to 'formatter' (for visualization) or 'validator' (for text)
    """
    last_message = state["messages"][-1]

    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"

    # No more tool calls — decide based on response_type
    if state.get("response_type") == "visualization":
        return "formatter"
    return "validator"
