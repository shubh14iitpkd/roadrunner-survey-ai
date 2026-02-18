"""
Validator Node — Validates and sanitizes the final response.
Checks for empty/malformed output, ensures visualization JSON is parseable.
"""

import json
import re
from ai.lang_graph_chatbot.state import AgentState, ResponseType, extract_text_content


FALLBACK_RESPONSE = (
    "I apologize, but I wasn't able to generate a proper response. "
    "Could you please rephrase your question?"
)


def validator_node(state: AgentState) -> dict:
    """
    Validate the final response before returning to the user.
    - For TEXT: ensure non-empty and reasonable
    - For VISUALIZATION: ensure the JSON inside ```visualization is valid
    """
    # Get the response to validate
    response = state.get("final_response")

    # If no final_response was set, try to extract from last AI message
    if not response:
        for msg in reversed(state["messages"]):
            if hasattr(msg, "type") and msg.type == "ai" and msg.content:
                response = extract_text_content(msg.content)
                break

    # Normalize: LLM sometimes returns content as a list of dicts or strings
    if isinstance(response, list):
        response = extract_text_content(response)
    if not response or not response.strip():
        return {"final_response": FALLBACK_RESPONSE}

    response_type = state.get("response_type", ResponseType.TEXT)

    if response_type == ResponseType.VISUALIZATION:
        response = _validate_visualization(response)
    else:
        response = _validate_text(response)

    return {"final_response": response}


def _validate_text(response: str) -> str:
    """Validate a plain text/markdown response."""
    if len(response.strip()) < 2:
        return FALLBACK_RESPONSE
    return response.strip()


def _validate_visualization(response: str) -> str:
    """
    Validate that the response contains a valid ```visualization code block.
    If the JSON is malformed, fall back to a text-only response.
    """
    # Find ```visualization ... ``` blocks
    pattern = r"```visualization\s*\n(.*?)```"
    match = re.search(pattern, response, re.DOTALL)

    if not match:
        # No visualization block found — return as-is (text fallback)
        return response

    json_str = match.group(1).strip()

    try:
        data = json.loads(json_str)
        # Basic schema check
        if "type" not in data or "data" not in data:
            return _strip_visualization_block(response) + "\n\n*(Visualization data was malformed)*"
        if not isinstance(data["data"], list):
            return _strip_visualization_block(response) + "\n\n*(Visualization data was malformed)*"
    except json.JSONDecodeError:
        return _strip_visualization_block(response) + "\n\n*(Visualization JSON was invalid)*"

    return response


def _strip_visualization_block(response: str) -> str:
    """Remove the malformed visualization code block from the response."""
    pattern = r"```visualization\s*\n.*?```"
    return re.sub(pattern, "", response, flags=re.DOTALL).strip()
