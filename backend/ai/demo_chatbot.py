"""
Demo Chatbot Handler - Simplified and Fixed
Routes:
- Asset queries → Demo data JSON
- Timestamp/Frame queries → Frames DB (via 'key' field)

Always includes total frame count in responses.
Never shows raw IDs - uses friendly names only.
"""

import json
import os
import re
from pathlib import Path
from typing import Dict, List, Optional
from collections import defaultdict

# MongoDB for frame queries
from pymongo import MongoClient
from dotenv import load_dotenv

# Gemini client
try:
    from google import genai

    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False

load_dotenv()

# Import AnswerFormatter for consistent response formatting
try:
    from ai.chatbot import AnswerFormatter

    FORMATTER_AVAILABLE = True
except ImportError:
    FORMATTER_AVAILABLE = False


# ---------------------------------------------------------------------------
# DEMO DATA LOADER
# ---------------------------------------------------------------------------


class DemoDataLoader:
    """Loads and caches preprocessed demo asset data"""

    _instance = None
    _data = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if self._data is None:
            self._load_data()

    def _load_data(self):
        """Load preprocessed demo data"""
        data_path = Path(__file__).parent / "demo-data" / "demo-assets-processed.json"

        if not data_path.exists():
            print(f"Demo data not found at {data_path}")
            self._data = {"videos": {}, "assets": [], "summary": {}}
            return

        with open(data_path, "r") as f:
            self._data = json.load(f)

        print(f"Loaded demo data: {len(self._data.get('assets', []))} assets")

    @property
    def videos(self) -> Dict:
        return self._data.get("videos", {})

    @property
    def assets(self) -> List[Dict]:
        return self._data.get("assets", [])

    @property
    def summary(self) -> Dict:
        return self._data.get("summary", {})

    def get_assets_by_video(self, video_id: str) -> List[Dict]:
        """Get all assets for a specific video"""
        # Normalize video_id (remove .mp4 extension if present)
        video_id = video_id.replace(".mp4", "").replace(".MP4", "")
        return [a for a in self.assets if a.get("video_id") == video_id]

    def get_assets_by_type(self, asset_type: str, video_id: str = None) -> List[Dict]:
        """Get assets matching a type (fuzzy match with underscore handling)"""
        # Normalize search term: replace spaces with underscores and vice versa
        type_lower = asset_type.lower()
        type_underscore = type_lower.replace(" ", "_")
        type_space = type_lower.replace("_", " ")

        results = []
        for a in self.assets:
            asset_type_val = a.get("type", "").lower()
            class_name_val = a.get("className", "").lower()

            # Check all variants
            if (
                type_lower in asset_type_val
                or type_underscore in asset_type_val
                or type_space in asset_type_val
                or type_lower in class_name_val
                or type_underscore in class_name_val
                or type_space in class_name_val
            ):
                if video_id is None or a.get("video_id") == video_id:
                    results.append(a)
        return results

    def get_assets_by_condition(
        self, condition: str, video_id: str = None
    ) -> List[Dict]:
        """Get assets by condition"""
        condition_lower = condition.lower()
        results = []
        for a in self.assets:
            if condition_lower in a.get("condition", "").lower():
                if video_id is None or a.get("video_id") == video_id:
                    results.append(a)
        return results

    def get_assets_by_category(self, category: str, video_id: str = None) -> List[Dict]:
        """Get assets by category"""
        category_lower = category.lower()
        results = []
        for a in self.assets:
            if category_lower in a.get("category", "").lower():
                if video_id is None or a.get("video_id") == video_id:
                    results.append(a)
        return results

    def get_summary_for_video(self, video_id: str) -> Dict:
        """Get summary statistics for a specific video"""
        video_id = video_id.replace(".mp4", "").replace(".MP4", "")
        assets = self.get_assets_by_video(video_id)

        by_category = defaultdict(int)
        by_type = defaultdict(int)
        by_condition = defaultdict(int)

        for a in assets:
            by_category[a.get("category", "Unknown")] += 1
            by_type[a.get("type", "Unknown")] += 1
            by_condition[a.get("condition", "Unknown")] += 1
        return {
            "video_id": video_id,
            "total_assets": len(assets),
            "by_category": dict(by_category),
            "by_type": dict(by_type),
            "by_condition": dict(by_condition),
        }

    def get_assets_by_condition(
        self, condition_keywords: List[str], video_id: str = None
    ) -> List[Dict]:
        """Get full list of assets matching condition keywords"""
        assets = self.get_assets_by_video(video_id) if video_id else self.assets
        matches = []

        for a in assets:
            cond = a.get("condition", "").lower()
            if any(k in cond for k in condition_keywords):
                matches.append(
                    {
                        "type": a.get("type", "Unknown"),
                        "condition": a.get("condition"),
                        "timestamp": a.get("timestamp"),
                        "frame": a.get("frame"),
                    }
                )

        # Sort by timestamp
        matches.sort(key=lambda x: x.get("timestamp", 0))
        return matches

    def get_defects_by_category(self, video_id: str = None) -> Dict[str, int]:
        """Get count of damaged/defect assets per category"""
        assets = self.get_assets_by_video(video_id) if video_id else self.assets

        defects_by_category = defaultdict(int)
        for a in assets:
            condition = a.get("condition", "").lower()
            if condition in ["damaged", "bad", "poor", "missing", "broken", "bent"]:
                category = a.get("category", "Unknown")
                defects_by_category[category] += 1

        return dict(defects_by_category)

    def get_condition_breakdown_for_type(
        self, asset_type: str, video_id: str = None
    ) -> Dict:
        """Get good vs damaged count for a specific asset type"""
        assets = self.get_assets_by_type(asset_type, video_id)

        good_count = 0
        damaged_count = 0

        for a in assets:
            condition = a.get("condition", "").lower()
            if condition in ["good", "fine", "visible"]:
                good_count += 1
            elif condition in [
                "damaged",
                "bad",
                "poor",
                "missing",
                "broken",
                "bent",
                "dirty",
                "overgrown",
            ]:
                damaged_count += 1
            else:
                # Treat unknown as good by default
                good_count += 1

        return {
            "asset_type": asset_type,
            "total": len(assets),
            "good": good_count,
            "damaged": damaged_count,
            "damage_rate": round(damaged_count / len(assets) * 100, 1) if assets else 0,
        }

    def get_damaged_assets_for_improvements(self, video_id: str = None) -> List[Dict]:
        """Get all damaged assets grouped by type for improvement suggestions"""
        assets = self.get_assets_by_video(video_id) if video_id else self.assets

        damaged_by_type = defaultdict(lambda: {"count": 0, "samples": []})

        for a in assets:
            condition = a.get("condition", "").lower()
            if condition in [
                "damaged",
                "bad",
                "poor",
                "missing",
                "broken",
                "bent",
                "dirty",
                "overgrown",
            ]:
                asset_type = a.get("type", "Unknown")
                damaged_by_type[asset_type]["count"] += 1
                # Collect ALL samples if under a reasonable limit, or just 10?
                # User wants a list, likely all of them if reasonable.
                # For improvement suggestions specifically, we keep a sample.
                if len(damaged_by_type[asset_type]["samples"]) < 5:
                    damaged_by_type[asset_type]["samples"].append(
                        {
                            "condition": a.get("condition"),
                            "timestamp": a.get("timestamp"),
                            "frame": a.get("frame"),
                        }
                    )

        # Sort by count descending
        result = []
        for asset_type, data in sorted(
            damaged_by_type.items(), key=lambda x: -x[1]["count"]
        ):
            result.append(
                {"type": asset_type, "count": data["count"], "samples": data["samples"]}
            )

        return result


# ---------------------------------------------------------------------------
# FRAMES DB CLIENT
# ---------------------------------------------------------------------------


class FramesDBClient:
    """MongoDB client for frames queries only"""

    def __init__(self):
        mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
        self.client = MongoClient(mongo_uri)
        self.db = self.client["roadrunner"]
        self.frames = self.db["frames"]

    def get_frames_by_key(self, key: str) -> int:
        """Get total frame count for a video key"""
        return self.frames.count_documents({"key": key})

    def get_frame_at_timestamp(
        self, key: str, timestamp_seconds: float, tolerance: float = 1.0
    ) -> List[Dict]:
        """Get frames near a specific timestamp"""
        query = {
            "key": key,
            "timestamp": {
                "$gte": timestamp_seconds - tolerance,
                "$lte": timestamp_seconds + tolerance,
            },
        }
        frames = list(self.frames.find(query).sort("timestamp", 1).limit(5))
        return frames

    def get_frame_by_number(self, key: str, frame_number: int) -> Optional[Dict]:
        """Get a specific frame by number"""
        return self.frames.find_one({"key": key, "frame_number": frame_number})

    def get_all_detection_types(self, key: str) -> Dict[str, int]:
        """Get count of all detection types for a video"""
        pipeline = [
            {"$match": {"key": key}},
            {
                "$project": {
                    "all_detections": {
                        "$cond": {
                            "if": {"$isArray": "$detections"},
                            "then": "$detections",
                            "else": {
                                "$concatArrays": [
                                    {
                                        "$ifNull": [
                                            "$detections.lighting_endpoint_name",
                                            [],
                                        ]
                                    },
                                    {
                                        "$ifNull": [
                                            "$detections.pavement_endpoint_name",
                                            [],
                                        ]
                                    },
                                    {
                                        "$ifNull": [
                                            "$detections.structures_endpoint_name",
                                            [],
                                        ]
                                    },
                                    {"$ifNull": ["$detections.oia_endpoint_name", []]},
                                    {"$ifNull": ["$detections.its_endpoint_name", []]},
                                ]
                            },
                        }
                    }
                }
            },
            {"$unwind": "$all_detections"},
            {"$group": {"_id": "$all_detections.class_name", "count": {"$sum": 1}}},
        ]
        results = list(self.frames.aggregate(pipeline))
        return {r["_id"]: r["count"] for r in results if r["_id"]}


# ---------------------------------------------------------------------------
# DEMO CHATBOT - REWRITTEN
# ---------------------------------------------------------------------------


class DemoChatbot:
    """Simplified chatbot for demo videos"""

    DEMO_VIDEOS = ["2025_0817_115147_F", "2025_0817_115647_F", "2025_0817_120147_F"]

    def __init__(self):
        self.data = DemoDataLoader()
        self.frames_db = FramesDBClient()
        self.api_key = os.getenv("GEMINI_API_KEY")
        self.client = None
        self.model = "gemini-2.0-flash-exp"

        if GENAI_AVAILABLE and self.api_key:
            self.client = genai.Client(api_key=self.api_key)
            print("Demo Chatbot initialized with Gemini")
        else:
            print("Demo Chatbot running without Gemini (will return formatted data)")

    def is_demo_video(self, video_id: str) -> bool:
        """Check if a video ID is a demo video"""
        if not video_id:
            return False
        normalized = video_id.replace(".mp4", "").replace(".MP4", "")
        return normalized in self.DEMO_VIDEOS

    def _normalize_video_id(self, video_id: str) -> str:
        """Normalize video ID to match key format"""
        return video_id.replace(".mp4", "").replace(".MP4", "") if video_id else ""

    def _detect_query_type(self, question: str) -> str:
        """Detect what type of query this is"""
        q_lower = question.lower()

        # Timestamp query: "at 1:30", "at 90 seconds", "timestamp 2:00"
        if re.search(r"(?:at|timestamp)\s*\d+[:\s]\d{2}", q_lower) or re.search(
            r"(?:at|timestamp)\s*\d+\s*(?:seconds?|sec|s)\b", q_lower
        ):
            return "timestamp"

        # Frame query: "frame 45", "frame number 100"
        if re.search(r"frame\s*(?:number\s*)?\d+", q_lower):
            return "frame"

        # Default to asset query
        return "asset"

    def _parse_timestamp(self, question: str) -> Optional[float]:
        """Parse timestamp from question, returns seconds"""
        # Match "X:XX" format
        match = re.search(r"(\d+):(\d{2})", question)
        if match:
            minutes = int(match.group(1))
            seconds = int(match.group(2))
            return minutes * 60 + seconds

        # Match "X seconds" format
        match = re.search(r"(\d+)\s*(?:seconds?|sec|s)\b", question, re.IGNORECASE)
        if match:
            return float(match.group(1))

        return None

    def _parse_frame_number(self, question: str) -> Optional[int]:
        """Parse frame number from question"""
        match = re.search(r"frame\s*(?:number\s*)?(\d+)", question, re.IGNORECASE)
        if match:
            return int(match.group(1))
        return None

    def _format_detections(self, detections) -> List[str]:
        """Format detections from frame into readable list"""
        result = []

        if isinstance(detections, list):
            # Legacy array format
            for det in detections:
                class_name = det.get("class_name", "Unknown")
                # Humanize: STREET_LIGHT_AssetCondition_Good -> Street Light (Good)
                humanized = self._humanize_class_name(class_name)
                result.append(humanized)
        elif isinstance(detections, dict):
            # New nested format
            for endpoint_name, endpoint_dets in detections.items():
                if isinstance(endpoint_dets, list):
                    for det in endpoint_dets:
                        class_name = det.get("class_name", "Unknown")
                        humanized = self._humanize_class_name(class_name)
                        result.append(humanized)

        return result

    def _humanize_class_name(self, class_name: str) -> str:
        """Convert STREET_LIGHT_AssetCondition_Good -> Street Light (Good)"""
        # Check for AssetCondition pattern
        match = re.match(r"^(.+?)_?AssetCondition_?(.+)$", class_name, re.IGNORECASE)
        if match:
            asset_part = match.group(1).replace("_", " ").title()
            condition = match.group(2).replace("_", " ").title()
            return f"{asset_part} ({condition})"

        # Just replace underscores with spaces
        return class_name.replace("_", " ").title()

    def _format_timestamp(self, seconds: float) -> str:
        """Format seconds as MM:SS"""
        mins = int(seconds // 60)
        secs = int(seconds % 60)
        return f"{mins}:{secs:02d}"

    def ask(self, question: str, video_id: str = None, video_label: str = None) -> str:
        """Answer a question about demo video assets"""
        video_key = self._normalize_video_id(video_id)
        query_type = self._detect_query_type(question)

        # Determine display name for video
        display_name = video_label if video_label else (video_key or "All videos")

        # Get total frame count for context
        total_frames = self.frames_db.get_frames_by_key(video_key) if video_key else 0

        if query_type == "timestamp":
            response = self._handle_timestamp_query(
                question, video_key, total_frames, display_name
            )
        elif query_type == "frame":
            response = self._handle_frame_query(
                question, video_key, total_frames, display_name
            )
        else:
            response = self._handle_asset_query(
                question, video_key, total_frames, display_name
            )

        # Apply formatting if available
        if FORMATTER_AVAILABLE:
            response = AnswerFormatter.format(response, None, question)

        return response

    def _handle_timestamp_query(
        self, question: str, video_key: str, total_frames: int, display_name: str
    ) -> str:
        """Handle timestamp-based queries using frames DB"""
        timestamp = self._parse_timestamp(question)
        if timestamp is None:
            return "Could not parse timestamp from your question."

        if not video_key:
            return "Please select a video first."

        # Query frames DB
        frames = self.frames_db.get_frame_at_timestamp(video_key, timestamp)

        if not frames:
            return f"No frames found at {self._format_timestamp(timestamp)}."

        # Build response
        lines = [f"**At {self._format_timestamp(timestamp)}** ({display_name}):\n"]

        for frame in frames:
            frame_num = frame.get("frame_number", "?")
            frame_ts = frame.get("timestamp", 0)
            detections = self._format_detections(frame.get("detections", []))

            # Get location if available
            location = frame.get("location", {})
            coords = location.get("coordinates", [])

            if detections:
                det_str = ", ".join(set(detections[:10]))  # Unique, max 10
                lines.append(
                    f"• **Frame {frame_num}** ({self._format_timestamp(frame_ts)}): {det_str}"
                )
            else:
                lines.append(
                    f"• **Frame {frame_num}** ({self._format_timestamp(frame_ts)}): No detections"
                )

            if coords and len(coords) >= 2:
                lines.append(f"  Location: {coords[1]:.6f}, {coords[0]:.6f}")

        return "\n".join(lines)

    def _handle_frame_query(
        self, question: str, video_key: str, total_frames: int, display_name: str
    ) -> str:
        """Handle frame number-based queries"""
        frame_num = self._parse_frame_number(question)
        if frame_num is None:
            return "Could not parse frame number from your question."

        if not video_key:
            return "Please select a video first."

        frame = self.frames_db.get_frame_by_number(video_key, frame_num)

        if not frame:
            return f"Frame {frame_num} not found."

        # Build response
        lines = [f"**Frame {frame_num}** ({display_name}):\n"]

        detections = self._format_detections(frame.get("detections", []))
        timestamp = frame.get("timestamp", 0)
        location = frame.get("location", {})
        coords = location.get("coordinates", [])

        lines.append(f"• Timestamp: {self._format_timestamp(timestamp)}")

        if detections:
            # Count unique detections
            det_counts = defaultdict(int)
            for det in detections:
                det_counts[det] += 1

            lines.append(f"• Detections ({len(detections)} total):")
            for det_type, count in sorted(det_counts.items(), key=lambda x: -x[1])[:10]:
                lines.append(f"  - {det_type}: {count}")
        else:
            lines.append("• No detections in this frame")

        if coords and len(coords) >= 2:
            lines.append(f"• Location: {coords[1]:.6f}, {coords[0]:.6f}")

        return "\n".join(lines)

    def _handle_asset_query(
        self, question: str, video_key: str, total_frames: int, display_name: str
    ) -> str:
        """Handle asset queries using demo data"""
        intent = self._analyze_intent(question)

        # Handle special query types first
        if intent.get("wants_defect_analysis"):
            return self._handle_defect_analysis(video_key, display_name)

        if intent.get("wants_improvements"):
            return self._handle_improvements_query(video_key, display_name)

        if intent.get("wants_condition_breakdown") and intent.get("asset_type"):
            return self._handle_condition_breakdown(
                intent["asset_type"], video_key, display_name
            )

        # Default asset query handling
        # Check if user wants a LIST of items by condition
        condition_keywords = ["poor", "damaged", "bad", "critical", "broken", "missing"]
        matches_condition = any(k in question.lower() for k in condition_keywords)
        is_list_query = any(
            k in question.lower() for k in ["list", "what", "which", "show"]
        )

        if matches_condition and is_list_query:
            # Fetch detailed list
            assets = self.data.get_assets_by_condition(condition_keywords, video_key)
            if not assets:
                return f"No assets found matching the condition in {display_name}."

            # Aggregate by type
            counts = defaultdict(int)
            for a in assets:
                counts[a["type"]] += 1

            # Build aggregated context string
            asset_context = "\n".join(
                [
                    f"- **{atype}**: {count}"
                    for atype, count in sorted(counts.items(), key=lambda x: -x[1])
                ]
            )

            return f"Found {len(assets)} assets matching the condition in {display_name}:\n{asset_context}"

        # Otherwise standard summary
        context = self._get_context_data(intent, video_key)
        context["video_name"] = display_name

        if self.client:
            return self._generate_answer_with_gemini(
                question, context, intent, display_name
            )
        else:
            return self._generate_simple_answer(question, context, intent)

    def _handle_defect_analysis(self, video_key: str, display_name: str) -> str:
        """Handle 'which category has most defects' type queries"""
        defects = self.data.get_defects_by_category(video_key)

        if not defects:
            return "No damaged assets found in this video."

        # Sort by count descending
        sorted_defects = sorted(defects.items(), key=lambda x: -x[1])
        worst_category = sorted_defects[0]
        total_defects = sum(defects.values())

        lines = [f"**Defect Analysis** - {display_name}\n"]
        lines.append(f"Total damaged assets: **{total_defects:,}**\n")
        lines.append(
            f"**{worst_category[0]}** has the highest number of defects with **{worst_category[1]:,}** damaged items.\n"
        )
        lines.append("**Defects by Category:**")

        for category, count in sorted_defects:
            percentage = round(count / total_defects * 100, 1)
            lines.append(f"• {category}: {count:,} ({percentage}%)")

        return "\n".join(lines)

    def _handle_condition_breakdown(
        self, asset_type: str, video_key: str, display_name: str
    ) -> str:
        """Handle 'what's the condition of <asset>' type queries"""
        breakdown = self.data.get_condition_breakdown_for_type(asset_type, video_key)

        if breakdown["total"] == 0:
            return f"No {asset_type} assets found in (Display Name: {display_name})."

        lines = [f"Condition of **{asset_type.title()}** based on {display_name}\n"]
        lines.append(f"* Total: **{breakdown['total']:,}** {asset_type} assets\n")
        lines.append(f"* Good condition: **{breakdown['good']:,}**\n")
        lines.append(f"* Damaged/Defective: **{breakdown['damaged']:,}**\n")
        lines.append(f"* Damage rate: **{breakdown['damage_rate']}%**")

        if breakdown["damage_rate"] > 20:
            lines.append(f"\nHigh damage rate - recommend prioritized maintenance")
        elif breakdown["damage_rate"] > 10:
            lines.append(f"\nModerate damage - schedule regular inspection")
        else:
            lines.append(f"\nGood overall condition")

        return "\n".join(lines)

    def _handle_improvements_query(self, video_key: str, display_name: str) -> str:
        """Handle 'what can be done to improve' type queries"""
        damaged = self.data.get_damaged_assets_for_improvements(video_key)

        if not damaged:
            return "No damaged assets requiring improvements were found."

        total_damaged = sum(item["count"] for item in damaged)

        lines = [f"To improve the road shown in {display_name}\n"]
        lines.append(
            f"Found **{total_damaged:,}** damaged assets requiring attention.\n"
        )

        # Improvement suggestions mapping
        suggestions = {
            "STREET_LIGHT": "Replace bulbs, check electrical connections, or replace fixtures",
            "STREET_LIGHT_POLE": "Inspect structural integrity, repaint or replace damaged poles",
            "STREET_LIGHT_FEEDER_PILLAR": "Check electrical components, repair enclosure damage",
            "Traffic_Sign": "Clean, repaint, or replace damaged signs for visibility",
            "Street_Sign": "Clean, repaint, or replace damaged signs",
            "Pole_Directional_Sign": "Repair or replace damaged directional signage",
            "Fence": "Repair or replace damaged fence panels for safety",
            "Guardrail": "Critical safety item - repair or replace immediately",
            "Traffic_Bollard": "Replace missing or broken bollards",
            "Road_Marking_Line": "Repaint faded or damaged road markings",
            "Road_Marking_Point": "Replace damaged road studs or markings",
            "Kerb": "Repair cracked or damaged kerb sections",
            "Carriageway": "Fill potholes, repair cracks, resurface if needed",
            "Median": "Restore damaged median barriers",
            "Footpath": "Repair uneven or damaged footpath surfaces",
            "TRAFFIC_SIGNAL": "Check signal operation, repair or replace damaged units",
            "TRAFFIC_SIGNAL_HEAD": "Replace damaged signal heads",
        }

        lines.append("**Recommended Actions:**\n")

        # Show ALL damaged asset types - no truncation
        for item in damaged:
            asset_type = item["type"]
            count = item["count"]

            # Get suggestion or create generic one
            suggestion = suggestions.get(
                asset_type,
                f'Inspect and repair damaged {asset_type.replace("_", " ").lower()}',
            )

            lines.append(f"**{asset_type.replace('_', ' ')}** ({count:,} items)")
            lines.append(f"  Recommendation: {suggestion}\n")

        return "\n".join(lines)

    def _analyze_intent(self, question: str) -> Dict:
        """Analyze question to determine what data to fetch"""
        q_lower = question.lower()

        intent = {
            "wants_count": False,
            "wants_list": False,
            "wants_summary": False,
            "wants_defect_analysis": False,
            "wants_condition_breakdown": False,
            "wants_improvements": False,
            "asset_type": None,
            "category": None,
            "condition": None,
        }

        # Defect analysis: "which category has most defects", "most damaged"
        if any(
            phrase in q_lower
            for phrase in [
                "most defect",
                "most damage",
                "highest defect",
                "category.*defect",
                "defect.*category",
                "which.*damage",
                "what.*damage",
            ]
        ):
            intent["wants_defect_analysis"] = True

        # Improvement suggestions: "improve", "fix", "repair", "what can be done"
        if any(
            phrase in q_lower
            for phrase in [
                "improve",
                "fix",
                "repair",
                "maintenance",
                "what can be done",
                "recommendations",
                "suggestions",
                "need attention",
            ]
        ):
            intent["wants_improvements"] = True

        # Condition breakdown for specific asset: "condition of/for <asset>"
        if any(
            phrase in q_lower
            for phrase in ["condition of", "condition for", "state of", "health of"]
        ):
            intent["wants_condition_breakdown"] = True

        # Count queries
        if any(word in q_lower for word in ["how many", "count", "total", "number of"]):
            intent["wants_count"] = True

        # List queries
        if any(word in q_lower for word in ["list", "show", "what are", "which"]):
            intent["wants_list"] = True

        # Summary queries
        if any(
            word in q_lower
            for word in ["summary", "summarize", "overview", "breakdown"]
        ):
            intent["wants_summary"] = True

        # Condition detection
        if "good" in q_lower:
            intent["condition"] = "good"
        elif any(word in q_lower for word in ["bad", "damaged", "poor"]):
            intent["condition"] = "damaged"

        # Asset type extraction - expanded list
        asset_types = [
            "street light",
            "traffic sign",
            "traffic signal",
            "kerb",
            "road marking",
            "guardrail",
            "fence",
            "bollard",
            "flyover",
            "cctv",
            "median",
            "shoulder",
            "carriageway",
            "footpath",
            "parking bay",
            "speed hump",
            "rumble strip",
            "overpass",
            "underpass",
            "bridge",
            "pole",
            "emergency phone",
            "fire extinguisher",
            "traffic bollard",
            "street sign",
            "directional sign",
        ]
        for asset_type in asset_types:
            if asset_type in q_lower:
                intent["asset_type"] = asset_type
                break

        # Category detection
        categories = {
            "pavement": "Corridor & Pavement",
            "structure": "Structures",
            "signage": "Directional Signage",
            "its": "ITS",
            "lighting": "Roadway Lighting",
            "oia": "OIA",
        }
        for key, cat in categories.items():
            if key in q_lower:
                intent["category"] = cat
                break

        return intent

    def _get_context_data(self, intent: Dict, video_key: str = None) -> Dict:
        """Fetch relevant data based on intent from demo data"""
        context = {
            "total_assets": 0,
            "by_type": {},
            "by_category": {},
            "by_condition": {},
        }

        if video_key:
            summary = self.data.get_summary_for_video(video_key)
            context["total_assets"] = summary["total_assets"]
            context["by_type"] = summary["by_type"]
            context["by_category"] = summary["by_category"]
            context["by_condition"] = summary["by_condition"]
        else:
            summary = self.data.summary
            context["total_assets"] = summary.get("total_assets", 0)
            context["by_type"] = summary.get("by_type", {})
            context["by_category"] = summary.get("by_category", {})
            context["by_condition"] = summary.get("by_condition", {})

        # Apply filters
        if intent.get("asset_type"):
            assets = self.data.get_assets_by_type(intent["asset_type"], video_key)
            context["filtered_assets"] = assets
            context["filtered_count"] = len(assets)
            context["filter_type"] = intent["asset_type"]

        if intent.get("condition"):
            assets = self.data.get_assets_by_condition(intent["condition"], video_key)
            context["filtered_assets"] = assets
            context["filtered_count"] = len(assets)
            context["filter_condition"] = intent["condition"]

        if intent.get("category"):
            assets = self.data.get_assets_by_category(intent["category"], video_key)
            context["filtered_assets"] = assets
            context["filtered_count"] = len(assets)
            context["filter_category"] = intent["category"]

        return context

    def _generate_answer_with_gemini(
        self, question: str, context: Dict, intent: Dict, display_name: str
    ) -> str:
        """Generate natural language answer using Gemini"""

        video_info = f"Video: {display_name}"

        data_context = f"""
VIDEO: {video_info}
TOTAL ASSETS (from demo data): {context['total_assets']}

BY CATEGORY: {json.dumps(context['by_category'], indent=2)}
BY TYPE: {json.dumps(context['by_type'], indent=2)}
BY CONDITION: {json.dumps(context['by_condition'], indent=2)}
"""

        if context.get("filtered_count") is not None:
            # Use friendlier language for context
            filter_desc = (
                context.get("filter_type")
                or context.get("filter_condition")
                or context.get("filter_category", "relevant")
            )
            data_context += (
                f"\nMATCHING ASSETS ({filter_desc}): {context['filtered_count']} found"
            )

        prompt = f"""You are a road survey assistant. Answer the user's question based ONLY on the data provided below.

USER QUESTION: {question}

{data_context}

INSTRUCTIONS:
1. DATA SOURCE: Never mention "filtered data", "JSON", "database", or "demo data".
2. TONE: Speak naturally. Use phrases like "In this video...", "The survey shows...", or "We found...".
3. CONTEXT: If the data shows "MATCHING ASSETS", use that as the answer count. Ignore "TOTAL ASSETS" if a specific type/condition was asked for.
4. ACCURACY: Use the exact numbers provided.
5. FORMATTING: Use commas for large numbers (e.g. 1,234). Use bullet points for lists.
6. ID PROTECTION: Never show internal video IDs. Use the display name provided (e.g. "the latest survey").

Answer:"""

        try:
            response = self.client.models.generate_content(
                model=self.model, contents=prompt
            )
            answer = response.text.strip()
            return answer
        except Exception as e:
            print(f"Gemini error: {e}")
            return self._generate_simple_answer(question, context, intent)

    def _generate_simple_answer(
        self, question: str, context: Dict, intent: Dict
    ) -> str:
        """Generate a simple answer without LLM"""
        video_name = context.get("video_name", "Unknown")
        total_frames = context.get("total_frames", 0)

        if intent.get("wants_summary"):
            lines = [f"**Asset Summary** - {video_name}"]
            lines.append(f"Total assets: {context['total_assets']:,}")

            lines.append("\n**By Category:**")
            for cat, count in sorted(
                context["by_category"].items(), key=lambda x: -x[1]
            ):
                lines.append(f"• {cat}: {count:,}")

            lines.append("\n**By Condition:**")
            for cond, count in context["by_condition"].items():
                lines.append(f"• {cond.title()}: {count:,}")

            return "\n".join(lines)

        if context.get("filtered_count") is not None:
            filter_desc = (
                context.get("filter_type")
                or context.get("filter_condition")
                or context.get("filter_category", "")
            )
            result = f"Found **{context['filtered_count']:,}** {filter_desc} assets in {video_name}."
            return result

        if intent.get("wants_count"):
            result = f"Total assets detected: **{context['total_assets']:,}**"
            return result

        # Default response
        result = f"Video {video_name} contains **{context['total_assets']:,}** detected assets across {len(context['by_category'])} categories."
        return result


# ---------------------------------------------------------------------------
# SINGLETON GETTER
# ---------------------------------------------------------------------------

_demo_chatbot = None


def get_demo_chatbot() -> DemoChatbot:
    """Get singleton demo chatbot instance"""
    global _demo_chatbot
    if _demo_chatbot is None:
        _demo_chatbot = DemoChatbot()
    return _demo_chatbot


# ---------------------------------------------------------------------------
# TEST
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    load_dotenv()

    chatbot = get_demo_chatbot()
    video = "2025_0817_115147_F"

    test_questions = [
        "What's at timestamp 1:30?",
        "Show me frame 45",
        "How many street lights are there?",
        "Give me a summary",
        "What assets are in good condition?",
    ]

    print("\n" + "=" * 60)
    print("DEMO CHATBOT TEST")
    print("=" * 60)

    for q in test_questions:
        print(f"\n>>> {q}")
        answer = chatbot.ask(q, video_id=video)
        print(f"{answer}")
        print("-" * 40)
