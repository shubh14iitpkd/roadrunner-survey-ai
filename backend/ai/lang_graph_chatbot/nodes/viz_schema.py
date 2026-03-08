"""
Pydantic models for structured LLM output in the formatter node.
Using with_structured_output() guarantees data is always in correct Recharts format.
"""

from typing import List, Literal, Optional
from pydantic import BaseModel, Field


class FlatDataItem(BaseModel):
    """One data point for pie, bar, or doughnut charts."""
    label: str = Field(description="The category or group label")
    value: float = Field(description="The numeric value")


class SeriesDataItem(BaseModel):
    """One data point within a stacked bar series."""
    label: str = Field(description="The X-axis label (asset name, category, etc.)")
    value: float = Field(description="The numeric count or value")


class StackedBarSeries(BaseModel):
    """One series (e.g. 'Good' or 'Damaged') in a stacked bar chart."""
    name: str = Field(description="Series name, e.g. 'Good' or 'Damaged'")
    data: List[SeriesDataItem] = Field(description="Data points for this series")


class VisualizationOutput(BaseModel):
    """
    Chart output in Recharts-compatible format.
    - For pie / bar / doughnut: populate `data` with flat [{label, value}] items.
    - For stacked_bar: populate `series` with [{name, data: [{label, value}]}] items.
    """
    intro_text: str = Field(
        description="One brief sentence introducing the chart, e.g. 'Here is the label-wise distribution of Roadway Lighting assets.'"
    )
    type: Literal["pie", "bar", "doughnut", "stacked_bar"] = Field(
        description=(
            "Chart type: "
            "'pie' for label distribution proportions, "
            "'bar' for comparisons (good/damaged, 2-3 asset types, rankings), "
            "'doughnut' for proportion with a hole in the middle, "
            "'stacked_bar' for label vs condition breakdowns (requires series, not data)"
        )
    )
    title: str = Field(description="Descriptive chart title")
    data: Optional[List[FlatDataItem]] = Field(
        default=None,
        description="REQUIRED for pie, bar, doughnut. Must be a flat list of {label, value} objects. DO NOT use for stacked_bar."
    )
    series: Optional[List[StackedBarSeries]] = Field(
        default=None,
        description="REQUIRED for stacked_bar only. List of series, each with a name and data points. DO NOT use for pie, bar, or doughnut."
    )
