"""
Shared visualization utilities used by both formatter_node and validator_node.
Kept in a separate module to avoid circular imports.
"""

import re
import json


def _normalize_chart_json(data: dict) -> dict:
    """
    Normalize alternative chart JSON formats to our flat Recharts format.

    The LLM sometimes produces Chart.js-style data:
        {"type": "bar", "data": {"labels": [...], "datasets": [{...}]}}

    Our Recharts format uses:
        {"type": "bar",  "data": [{"label": "...", "value": N}]}    (flat, 1 dataset)
        {"type": "stacked_bar", "series": [{name, data: [{label, value}]}]}  (multi-dataset)

    Also normalises stacked_bar series items that use {x, y} instead of {label, value}.
    """
    chart_type = data.get("type", "")
    raw_data = data.get("data")

    # ── Case 1: Chart.js nested format  ────────────────────────────────────────
    if isinstance(raw_data, dict):
        labels = raw_data.get("labels", [])
        datasets = raw_data.get("datasets", [])

        if not labels or not datasets:
            return data  # can't convert, leave as-is

        if len(datasets) == 1:
            # Single dataset → flat [{label, value}] list
            ds = datasets[0]
            values = ds.get("data", [])
            flat = [{"label": lbl, "value": val} for lbl, val in zip(labels, values)]
            return {**data, "data": flat}
        else:
            # Multiple datasets → stacked_bar with series
            series = []
            for ds in datasets:
                name = ds.get("label") or ds.get("name") or "Series"
                values = ds.get("data", [])
                series.append({
                    "name": name,
                    "data": [{"label": lbl, "value": val} for lbl, val in zip(labels, values)],
                })
            normalized = {k: v for k, v in data.items() if k != "data"}
            normalized["type"] = "stacked_bar"
            normalized["series"] = series
            return normalized

    # ── Case 2: stacked_bar with {x, y} items instead of {label, value} ────────
    if chart_type == "stacked_bar":
        series = data.get("series", [])
        normalized_series = []
        for s in series:
            name = s.get("name") or s.get("label") or "Series"
            items = []
            for item in s.get("data", []):
                items.append({
                    "label": item.get("label") or item.get("x") or "",
                    "value": item.get("value") if item.get("value") is not None else item.get("y", 0),
                })
            normalized_series.append({"name": name, "data": items})
        return {**data, "series": normalized_series}

    return data


def _ensure_visualization_block(content: str) -> str:
    """
    Robustly ensure a formatter response contains a ```visualization code block
    with data in our canonical Recharts format.

    Steps:
    1. Rename any fenced code block (any language tag) whose body starts with {
       to ```visualization.
    2. If no fenced block found, locate raw JSON and wrap it.
    3. Parse the JSON inside the block and normalize its data structure
       (converts Chart.js format, {x,y} items, etc. to our flat format).
    """
    # ── Step 1 & 2: ensure there IS a ```visualization block ───────────────────
    result = re.sub(
        r"```[A-Za-z0-9_]*\s*\n(\s*\{)",
        r"```visualization\n\1",
        content,
    )

    if "```visualization" not in result:
        json_start = result.find("{")
        if json_start == -1:
            return result

        # Brace-balanced extraction
        depth, json_end = 0, -1
        in_string, escape = False, False
        for i, ch in enumerate(result[json_start:], start=json_start):
            if escape:
                escape = False
                continue
            if ch == "\\" and in_string:
                escape = True
                continue
            if ch == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    json_end = i + 1
                    break

        if json_end == -1:
            return result

        raw_json = result[json_start:json_end]
        prefix = result[:json_start].rstrip()
        suffix = result[json_end:].strip()
        parts = [prefix] if prefix else []
        parts.append(f"```visualization\n{raw_json}\n```")
        if suffix:
            parts.append(suffix)
        result = "\n\n".join(parts)

    # ── Step 3: parse and normalize the JSON inside the block ──────────────────
    pattern = r"(```visualization\s*\n)(.*?)(```)"
    match = re.search(pattern, result, re.DOTALL)
    if not match:
        return result

    json_str = match.group(2).strip()
    try:
        parsed = json.loads(json_str)
        normalized = _normalize_chart_json(parsed)
        if normalized is not parsed:
            # Re-serialize with the corrected structure
            new_block = f"```visualization\n{json.dumps(normalized, indent=2)}\n```"
            result = result[:match.start()] + new_block + result[match.end():]
    except (json.JSONDecodeError, Exception):
        pass  # If parsing fails, leave the block as-is for the validator to handle

    return result
