"""
Validator Node — Validates and sanitizes the final response.
Checks for empty/malformed output, ensures visualization/map JSON is parseable.
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
    - For VISUALIZATION: formatter sets final_response directly — trust it and do a
      light JSON parse check. Only fall back to messages if final_response is empty.
    - For TEXT / MAP: light content sanity checks.
    """
    response = state.get("final_response")
    response_type = state.get("response_type", ResponseType.TEXT)

    # For visualization the formatter always sets final_response directly.
    # Only use the message fallback if it's somehow empty.
    if response_type == ResponseType.VISUALIZATION and response and response.strip():
        return {"final_response": _validate_visualization(response)}

    # Generic fallback: read from last AI message in state
    if not response:
        for msg in reversed(state["messages"]):
            if hasattr(msg, "type") and msg.type == "ai" and msg.content:
                response = extract_text_content(msg.content)
                break

    if isinstance(response, list):
        response = extract_text_content(response)
    if not response or not response.strip():
        return {"final_response": FALLBACK_RESPONSE}

    if response_type == ResponseType.VISUALIZATION:
        response = _validate_visualization(response)
    elif "```map" in response:
        response = _validate_map(response)
    else:
        response = _validate_text(response)

    return {"final_response": response}


def _validate_text(response: str) -> str:
    if len(response.strip()) < 2:
        return FALLBACK_RESPONSE
    return response.strip()


def _validate_map(response: str) -> str:
    """Validate that ```map blocks contain valid JSON with markers."""
    pattern = r"```map\s*\n(.*?)```"
    match = re.search(pattern, response, re.DOTALL)
    if not match:
        return response

    json_str = match.group(1).strip()
    try:
        data = json.loads(json_str)
        if "markers" not in data or not isinstance(data["markers"], list):
            return _strip_block(response, "map") + "\n\n*(Map data was malformed)*"
    except json.JSONDecodeError:
        return _strip_block(response, "map") + "\n\n*(Map JSON was invalid)*"

    return response


def _validate_visualization(response: str) -> str:
    """Light check: confirm a ```visualization block with parseable JSON exists."""
    pattern = r"```visualization\s*\n(.*?)```"
    match = re.search(pattern, response, re.DOTALL)
    if not match:
        return response  # no block — return as-is, better than stripping

    json_str = match.group(1).strip()
    try:
        json.loads(json_str)  # just confirm it's valid JSON
    except json.JSONDecodeError as e:
        print(f"[Validator] Visualization JSON invalid: {e}")
        # Still return the response — don't strip it; the frontend will show an error

    return response


def _strip_block(response: str, block_type: str) -> str:
    """Remove a malformed code block from the response."""
    pattern = rf"```{block_type}\s*\n.*?```"
    return re.sub(pattern, "", response, flags=re.DOTALL).strip()
