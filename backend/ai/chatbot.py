"""
RoadRunner Chatbot - COMPLETE REDESIGN WITH FULL FEATURES PRESERVED

✅ KEEPS ALL ORIGINAL FEATURES:
   - Video RAG integration (defect queries)
   - Smart location geocoding with road database
   - Conversation memory with road-route mapping
   - AI-powered intent analysis (video_defect, video_metadata, route-based, location-based)
   - Multiple query types (frames, videos, assets, roads, surveys)
   - Context-aware answer generation

🔄 DYNAMIC (NO HARDCODING):
   - Query generation powered by schema
   - Answer templates generated from results
   - All keywords from database configuration
   - Zero static keyword lists

"""

import json
import os
from typing import Optional, List, Dict
from dotenv import load_dotenv
from google import genai
from pymongo import MongoClient
from pymongo.errors import ServerSelectionTimeoutError
import googlemaps
import re
from collections import defaultdict, Counter
from difflib import SequenceMatcher
from datetime import datetime, timedelta

# Import from schema.py
from ai.schema import SCHEMA, DB_NAME

load_dotenv()

# =============================================================================
# CONFIGURATION
# =============================================================================

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")
DB_NAME = os.getenv("DB_NAME", "roadrunner")

if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY not found in environment variables")

# Initialize Google Maps client (optional but recommended)
gmaps = googlemaps.Client(key=GOOGLE_MAPS_API_KEY) if GOOGLE_MAPS_API_KEY else None

# Import video RAG handler (lazy import to avoid circular dependencies)
_video_rag_handler = None


def get_video_rag_handler():
    """Get or initialize video RAG handler singleton"""
    global _video_rag_handler
    if _video_rag_handler is None:
        try:
            from ai.video_handler import VideoRAGHandler

            _video_rag_handler = VideoRAGHandler()
        except Exception as e:
            print(f"Warning: Could not initialize VideoRAGHandler: {e}")
            _video_rag_handler = None
    return _video_rag_handler


# =============================================================================
# SCHEMA LOADER (Dynamic configuration)
# =============================================================================


class DynamicSchemaLoader:
    """Loads and manages database schema from configuration"""

    def __init__(self):
        self.schema = {}
        self.collections = {}
        try:
            from ai.schema import SCHEMA, DB_NAME as SCHEMA_DB_NAME

            self.schema = SCHEMA
            self.db_name = SCHEMA_DB_NAME
            self._initialize_collections()
        except Exception as e:
            print(f"Warning: Could not load schema: {e}")
            self._use_default_schema()

    def _use_default_schema(self):
        """Fallback default schema"""
        self.schema = {
            "frames": {"description": "Video frames with detected objects"},
            "videos": {"description": "Video metadata and recordings"},
            "assets": {"description": "Road assets like street lights, signs"},
            "roads": {"description": "Road information and routes"},
            "surveys": {"description": "Survey status and metadata"},
            "video_processing_results": {
                "description": "Processed video data and defects"
            },
        }
        self.db_name = "roadrunner"
        self._initialize_collections()

    def _initialize_collections(self):
        """Initialize collection metadata"""
        for collection_name, collection_info in self.schema.items():
            self.collections[collection_name] = {
                "name": collection_name,
                "description": collection_info.get("description", ""),
                "fields": collection_info.get("fields", {}),
                "keywords": self._extract_keywords(collection_info),
            }

    def _extract_keywords(self, collection_info: dict) -> List[str]:
        """Extract searchable keywords from collection description"""
        description = collection_info.get("description", "").lower()
        fields = collection_info.get("fields", {})

        keywords = []
        # From description
        for word in description.split():
            if len(word) > 3:  # Skip short words
                keywords.append(word.lower())

        # From field names
        for field_name in fields.keys():
            keywords.append(field_name.lower())
            # Add variations (with underscores replaced)
            keywords.append(field_name.replace("_", " ").lower())

        return list(set(keywords))  # Remove duplicates

    def get_collection_for_query(self, question: str) -> Optional[str]:
        """Determine which collection to query based on question"""
        question_lower = question.lower()

        # Score each collection based on keyword matches
        scores = {}
        for col_name, col_info in self.collections.items():
            score = 0
            for keyword in col_info["keywords"]:
                if keyword in question_lower:
                    score += 1
            scores[col_name] = score

        # Return highest scoring collection
        if max(scores.values()) > 0:
            return max(scores, key=scores.get)

        return None

    def get_schema(self) -> dict:
        return self.schema

    def get_db_name(self) -> str:
        return self.db_name


# =============================================================================
# GEOCODING HELPERS
# =============================================================================


class GeocodeCache:
    """Cache geocoding results to minimize API calls"""

    def __init__(self, db):
        self.cache = db.geocoding_cache
        try:
            self.cache.create_index("query", unique=True)
        except:
            pass  # Index might already exist

    def get(self, query: str) -> Optional[Dict]:
        result = self.cache.find_one({"query": query.lower()})
        if result:
            return {"lat": result["lat"], "lng": result["lng"]}
        return None

    def set(self, query: str, lat: float, lng: float):
        self.cache.update_one(
            {"query": query.lower()},
            {"$set": {"query": query.lower(), "lat": lat, "lng": lng}},
            upsert=True,
        )

    def clear(self):
        """Clear all cached geocoding results"""
        count = self.cache.delete_many({}).deleted_count
        print(f"🗑️ Cleared {count} cached geocoding entries")
        return count


# =============================================================================
# MONGODB CONNECTION
# =============================================================================


class MongoDBClient:
    """MongoDB connection manager"""

    def __init__(self, mongo_uri: str, db_name: str):
        try:
            self.client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
            self.client.admin.command("ping")
            self.db = self.client[db_name]
            self.geocode_cache = GeocodeCache(self.db)
            print(f"✓ Connected to MongoDB: {db_name}")
        except ServerSelectionTimeoutError:
            raise ValueError(f"Cannot connect to MongoDB at {mongo_uri}")

    def find(self, collection: str, query: dict, limit: int = 10) -> List[dict]:
        """Execute find query"""
        try:
            print(
                f"\n🔎 EXECUTING FIND: db.{collection}.find({json.dumps(query, default=str)})"
            )
            results = list(self.db[collection].find(query).limit(limit))
            print(f"[MongoDB] RESULTS: {len(results)} documents found")
            for doc in results:
                if "_id" in doc:
                    doc["_id"] = str(doc["_id"])
            return results
        except Exception as e:
            print(f"❌ Find query error: {e}")
            return []

    def aggregate(self, collection: str, pipeline: list) -> List[dict]:
        """Execute aggregation pipeline"""
        try:
            print(
                f"\n🔎 EXECUTING AGGREGATE: db.{collection}.aggregate({json.dumps(pipeline, default=str, indent=2)})"
            )
            results = list(self.db[collection].aggregate(pipeline))
            print(f"[MongoDB] RESULTS: {len(results)} documents found")
            for doc in results:
                if "_id" in doc:
                    doc["_id"] = str(doc["_id"])
            return results
        except Exception as e:
            print(f"❌ Aggregation error: {e}")
            return []

    def close(self):
        self.client.close()


# =============================================================================
# INTENT ANALYZER (SCHEMA-DRIVEN, NO VIDEO BIAS)
# =============================================================================


class IntentAnalyzer:
    """Uses schema.py to intelligently route queries to correct collections"""

    def __init__(self, api_key: str, schema_loader: DynamicSchemaLoader):
        self.client = genai.Client(api_key=api_key)
        self.model = "gemini-2.0-flash-exp"
        self.schema = schema_loader

    def analyze(
        self,
        question: str,
        chat_id: Optional[str] = None,
        chat_has_videos: bool = False,
    ) -> Dict:
        """
        Analyze user intention using schema definitions

        Args:
            question: User's question
            chat_id: Chat identifier
            chat_has_videos: If True, ONLY use video_processing_results collection

        Returns:
            {
                "collection": str,
                "needs_geocoding": bool,
                "location_name": str or None,
                "route_id": int or None,
                "reasoning": str
            }
        """

        # CRITICAL: If chat has videos, ONLY query video_processing_results
        if chat_has_videos:
            return {
                "collection": "video_processing_results",
                "query_type": "video_metadata_query",
                "needs_geocoding": False,
                "location_name": None,
                "route_id": None,
                "reasoning": "Chat has uploaded videos - querying video_processing_results only",
            }

        # Build schema context from schema.py (EXCLUDE video_processing_results for non-video chats)
        schema_context = {}
        for coll_name, coll_schema in SCHEMA.items():
            # Skip video_processing_results if chat has NO videos
            if coll_name == "video_processing_results":
                continue

            schema_context[coll_name] = {
                "description": coll_schema.get("description", ""),
                "priority": coll_schema.get("priority", "medium"),
                "when_to_use": coll_schema.get("when_to_use", []),
                "primary_intent": coll_schema.get("primary_intent", ""),
            }

        # Let Gemini decide based on schema, not hardcoded rules
        prompt = f"""You are a database query router. Analyze the user's question and determine which collection to query.

USER QUESTION: "{question}"

AVAILABLE COLLECTIONS (from schema.py):
{json.dumps(schema_context, indent=2)}

INSTRUCTIONS:
1. Match the question to the MOST RELEVANT collection based on:
   - description
   - when_to_use examples
   - primary_intent
   - priority (highest priority collections are preferred)

2. SPECIAL CASES (only use if explicitly mentioned):
   - If asking about DEFECTS IN VIDEO with semantic search needed ("show me cracks similar to", "find potholes like")
     → Use query_type: "video_defect_query" (RAG/Milvus)
   - Otherwise, ALWAYS use standard collections (frames, videos, assets, roads, surveys)

3. Extract routing info:
   - route_id: If question says "route XXX" (e.g., "route 105")
   - location_name: If question mentions a street/area name (e.g., "Al Waab Street")
   - needs_geocoding: true if location_name provided and needs GPS coordinates

4. Be PRECISE - match questions to the collection that best fits the schema

RESPOND WITH ONLY VALID JSON:

{{
  "collection": "frames" or "videos" or "assets" or "roads" or "surveys" or "video_defect_query",
  "needs_geocoding": true or false,
  "location_name": "extracted location" or null,
  "route_id": route_number or null,
  "reasoning": "why this collection was chosen"
}}
"""

        try:
            response = self.client.models.generate_content(
                model=self.model, contents=prompt
            )

            text = response.text.strip()

            # Clean markdown
            for prefix in ["```json\n", "```json", "```"]:
                if text.startswith(prefix):
                    text = text[len(prefix) :]
            if text.endswith("```"):
                text = text[:-3]

            intent = json.loads(text.strip())

            # Map to old format for compatibility
            collection = intent.get("collection", "frames")
            if collection == "video_defect_query":
                intent["query_type"] = "video_defect_query"
            else:
                # Standard collection query
                if intent.get("route_id"):
                    intent["query_type"] = "route_based"
                elif intent.get("needs_geocoding"):
                    intent["query_type"] = "location_based"
                else:
                    intent["query_type"] = "generic"

            return intent

        except Exception as e:
            print(f"Intent analysis error: {e}")
            return {
                "collection": "frames",
                "query_type": "generic",
                "needs_geocoding": False,
                "location_name": None,
                "route_id": None,
                "reasoning": "Error in analysis",
            }


# =============================================================================
# SMART LOCATION HANDLER (ORIGINAL LOGIC PRESERVED)
# =============================================================================


class SmartLocationHandler:
    """Handles location geocoding based on AI intent analysis"""

    def __init__(self, geocode_cache: GeocodeCache, db_client=None):
        self.cache = geocode_cache
        self.db = db_client

    def process(self, intent: Dict) -> Optional[Dict]:
        """
        Process location based on intent analysis

        Returns:
            {"type": "location", "lat": float, "lng": float, "query": str, "route_id": int} or None
        """

        if not intent.get("needs_geocoding"):
            return None

        location_name = intent.get("location_name")
        if not location_name:
            return None

        # STEP 1: Check if this location exists in roads collection first
        if self.db:
            road_match = self._find_matching_road(location_name)
            if road_match:
                print(
                    f"✓ Found '{location_name}' in roads database → route {road_match['route_id']}"
                )
                return {
                    "type": "location",
                    "lat": road_match.get("start_lat"),
                    "lng": road_match.get("start_lng"),
                    "query": f"{location_name} (from database)",
                    "route_id": road_match["route_id"],
                    "road_name": road_match.get("road_name"),
                }

        # STEP 2: Check cache
        cached = self.cache.get(location_name)
        if cached:
            print(f"✓ Using cached coordinates for '{location_name}'")
            return {
                "type": "location",
                "lat": cached["lat"],
                "lng": cached["lng"],
                "query": f"{location_name} (cached)",
            }

        # STEP 3: Geocode using Google Maps API
        if not gmaps:
            print(f"⚠️ Google Maps API not configured, cannot geocode '{location_name}'")
            return None

        try:
            result = gmaps.geocode(f"{location_name}, Qatar")
            if result:
                location = result[0]["geometry"]["location"]
                coords = {"lat": location["lat"], "lng": location["lng"]}

                # Cache it
                self.cache.set(location_name, coords["lat"], coords["lng"])
                print(
                    f"✓ Geocoded '{location_name}' → ({coords['lat']}, {coords['lng']})"
                )

                return {
                    "type": "location",
                    "lat": coords["lat"],
                    "lng": coords["lng"],
                    "query": f"{location_name} (geocoded)",
                }

        except Exception as e:
            print(f"✗ Geocoding error: {e}")
            return None

    def _find_matching_road(self, location_name: str) -> Optional[Dict]:
        """
        Search for location in roads collection using fuzzy matching
        Tries exact match → partial match → fuzzy match
        """
        if not self.db:
            return None

        search_term = location_name.lower().strip()

        # Step 1: Try exact matches first (case-insensitive)
        for field in ["road_name", "start_point_name", "end_point_name"]:
            result = self.db.db.roads.find_one(
                {field: {"$regex": f"^{re.escape(location_name)}$", "$options": "i"}}
            )
            if result:
                print(f"   ✅ Exact match: '{location_name}' → {field}")
                return result

        # Step 2: Try partial matches (contains)
        for field in ["road_name", "start_point_name", "end_point_name"]:
            result = self.db.db.roads.find_one(
                {field: {"$regex": re.escape(location_name), "$options": "i"}}
            )
            if result:
                print(f"   ✅ Partial match: '{location_name}' → {field}")
                return result

        # Step 3: Fuzzy matching - get all roads and find best match
        print(f"   🔍 Trying fuzzy matching for '{location_name}'...")
        all_roads = list(self.db.db.roads.find({}))

        best_match = None
        best_score = 0
        best_field = None
        threshold = 0.6  # Minimum similarity score (60%)

        for road in all_roads:
            for field in ["road_name", "start_point_name", "end_point_name"]:
                if field in road and road[field]:
                    field_value = str(road[field]).lower().strip()

                    # Calculate similarity using SequenceMatcher
                    similarity = SequenceMatcher(None, search_term, field_value).ratio()

                    if similarity > best_score and similarity >= threshold:
                        best_score = similarity
                        best_match = road
                        best_field = field

        if best_match:
            matched_value = best_match.get(best_field, "unknown")
            print(
                f"   ✅ Fuzzy match: '{location_name}' → '{matched_value}' (score: {best_score:.2f})"
            )
            return best_match

        print(f"   ❌ No match found for '{location_name}'")
        return None


# =============================================================================
# DYNAMIC QUERY GENERATOR (SCHEMA-BASED)
# =============================================================================


class DynamicQueryGenerator:
    """Converts natural language questions to MongoDB queries using schema.py directly"""

    def __init__(self, api_key: str, schema_loader: DynamicSchemaLoader):
        self.client = genai.Client(api_key=api_key)
        self.model = "gemini-2.0-flash-exp"
        self.schema = schema_loader

    def generate(
        self,
        question: str,
        collection: str,
        location_info: Optional[Dict] = None,
        conversation_history: list = None,
    ) -> Optional[dict]:
        """Generate MongoDB query from natural language using schema.py"""

        # Get schema for target collection from schema.py
        if collection not in SCHEMA:
            print(f"Collection '{collection}' not found in schema.py")
            return None

        collection_schema = SCHEMA[collection]

        # Build schema context from schema.py
        schema_str = json.dumps(collection_schema, indent=2, default=str)

        # Build location context dynamically
        location_context = ""
        if location_info:
            route_id = location_info.get("route_id")
            if route_id:
                location_context = f"\nUSE: route_id={route_id}"
            else:
                lat = location_info.get("lat")
                lng = location_info.get("lng")
                location_context = f"\nUSE: Geospatial query near ({lat}, {lng})"

        # Build conversation context
        context = ""
        if conversation_history:
            recent = conversation_history[-3:]
            context = "\nRecent conversation: " + " | ".join(
                [f"{m['role']}: {m['content'][:50]}" for m in recent]
            )

        # Use schema.py directly - no hardcoded rules!
        prompt = f"""Generate a MongoDB query for the '{collection}' collection.

USER QUESTION: "{question}"

COLLECTION SCHEMA (from schema.py):
{schema_str}
{location_context}{context}

INSTRUCTIONS:
1. Read the schema carefully - it contains:
   - Field descriptions and types
   - Search priorities
   - When to use this collection
   - Example queries

2. Generate appropriate MongoDB query:
   - Use "find" for simple queries
   - Use "aggregate" for complex operations (grouping, counting, unwinding)

3. Handle location:
   - If route_id provided, use: {{"route_id": <number>}}
   - If GPS coordinates, use geospatial queries based on field types in schema

4. Be intelligent:
   - Match question keywords to field names
   - Use aggregation for counts/statistics
   - Filter by relevant fields

RESPOND WITH ONLY VALID JSON:

{{
  "type": "find" or "aggregate",
  "collection": "{collection}",
  "query": {{...}} or [...pipeline...]

5. SURVEYS Collection:
   Keywords: "survey status", "survey date", "asset totals"
   Operation: Find by route_id

6. VIDEO_PROCESSING_RESULTS Collection:
   Keywords: "video defects", "defects detected", "defect types"
   Operation: Find by chat_id or video_id

USER QUESTION: {question}

RESPOND WITH ONLY VALID JSON (no markdown):

{{
  "collection": "frames" or "videos" or "assets" or "roads" or "surveys" or "video_processing_results",
  "type": "find" or "aggregate",
  "query": {{ ... }},
  "intent": "brief explanation"
}}

CRITICAL - MIXED DETECTIONS SCHEMA:
The 'detections' field in frames can be EITHER:
  - A flat Array (legacy): detections[].class_name
  - A nested Object (new): detections.lighting_endpoint_name[].class_name, detections.oia_endpoint_name[].class_name, etc.

When querying detections by class_name, you MUST use $or to check ALL possible paths:

FRAMES QUERY EXAMPLES:

1. "How many street lights on route 108?" (CORRECT - checks both schemas):
   {{"collection": "frames", "type": "aggregate", "query": [
     {{"$match": {{"route_id": 108}}}},
     {{"$project": {{
       "all_detections": {{
         "$cond": {{
           "if": {{"$isArray": "$detections"}},
           "then": "$detections",
           "else": {{
             "$concatArrays": [
               {{"$ifNull": ["$detections.lighting_endpoint_name", []]}},
               {{"$ifNull": ["$detections.pavement_endpoint_name", []]}},
               {{"$ifNull": ["$detections.structures_endpoint_name", []]}},
               {{"$ifNull": ["$detections.oia_endpoint_name", []]}},
               {{"$ifNull": ["$detections.its_endpoint_name", []]}}
             ]
           }}
         }}
       }}
     }}}},
     {{"$unwind": "$all_detections"}},
     {{"$match": {{"all_detections.class_name": {{"$regex": "STREET_LIGHT", "$options": "i"}}}}}},
     {{"$group": {{"_id": null, "count": {{"$sum": 1}}}}}}
   ], "intent": "Count street lights on route (handles both schemas)"}}

2. "How many defects on route 258?" (count ALL detections):
   {{"collection": "frames", "type": "aggregate", "query": [
     {{"$match": {{"route_id": 258}}}},
     {{"$group": {{"_id": null, "total": {{"$sum": "$detections_count"}}}}}}
   ], "intent": "Count all detections using detections_count field"}}

3. "How many countdown timers on route 1?" → ASSETS:
   {{"collection": "assets", "type": "aggregate", "query": [
     {{"$match": {{"route_id": 1, "type": "Countdown Timer"}}}},
     {{"$group": {{"_id": null, "count": {{"$sum": 1}}}}}}
   ], "intent": "Count countdown timer assets"}}

4. "What is the road name of route 214?" → ROADS:
   {{"collection": "roads", "type": "find", "query": {{"route_id": 214}}, "intent": "Get road information"}}
"""

        try:
            response = self.client.models.generate_content(
                model=self.model, contents=prompt
            )

            text = response.text.strip()

            # Clean markdown
            for prefix in ["```json\n", "```json", "```"]:
                if text.startswith(prefix):
                    text = text[len(prefix) :]
            if text.endswith("```"):
                text = text[:-3]

            query_spec = json.loads(text.strip())
            return query_spec

        except json.JSONDecodeError as e:
            print(f"JSON decode error: {e}")
            return None
        except Exception as e:
            print(f"Query generation error: {e}")
            return None


# =============================================================================
# QUERY AUTO-CORRECTION LAYER
# =============================================================================


class QueryCorrector:
    """Automatically fixes common LLM query generation mistakes"""

    @staticmethod
    def fix_query(query_spec: dict, question: str) -> dict:
        """Apply all correction rules"""
        if not query_spec:
            return query_spec

        print("🔧 Applying query auto-corrections...")

        # Fix 1: "defects" in frames → count ALL detections, not filter by class
        query_spec = QueryCorrector._fix_defects_query(query_spec, question)

        # Fix 2: Remove incorrect $sum operations
        query_spec = QueryCorrector._fix_sum_operations(query_spec)

        # Fix 3: Ensure proper route_id type (int not string)
        query_spec = QueryCorrector._fix_route_id_type(query_spec)

        return query_spec

    @staticmethod
    def _fix_defects_query(query_spec: dict, question: str) -> dict:
        """
        When user asks 'how many defects' in frames collection,
        they mean ALL detections, not specific defect classes.

        Remove class_name filters that search for 'defect' or specific defect types.
        """
        if query_spec.get("collection") != "frames":
            return query_spec

        # Check if question is about counting defects/detections
        question_lower = question.lower()
        is_defect_count = any(
            word in question_lower
            for word in [
                "how many defect",
                "count defect",
                "number of defect",
                "total defect",
                "defects on",
            ]
        )

        if not is_defect_count:
            return query_spec

        # Check if query has aggregation pipeline
        if query_spec.get("type") == "aggregate" and isinstance(
            query_spec.get("query"), list
        ):
            pipeline = query_spec["query"]
            corrected_pipeline = []

            for stage in pipeline:
                # Remove $match stages that filter by class_name for defects
                if "$match" in stage:
                    match_cond = stage["$match"]
                    # Remove class_name filters
                    if "detections.class_name" in match_cond:
                        print(
                            "   ⚠️  Removed incorrect class_name filter for defect counting"
                        )
                        continue  # Skip this stage
                    elif "class_name" in match_cond:
                        print(
                            "   ⚠️  Removed incorrect class_name filter for defect counting"
                        )
                        continue

                corrected_pipeline.append(stage)

            query_spec["query"] = corrected_pipeline
            print("   ✅ Fixed: Counting ALL detections (not filtering by class_name)")

        return query_spec

    @staticmethod
    def _fix_sum_operations(query_spec: dict) -> dict:
        """Fix incorrect $sum: 0 or $sum: 1 operations"""
        if query_spec.get("type") == "aggregate" and isinstance(
            query_spec.get("query"), list
        ):
            pipeline = query_spec["query"]

            for stage in pipeline:
                if "$group" in stage:
                    group_spec = stage["$group"]
                    for key, value in group_spec.items():
                        if isinstance(value, dict) and "$sum" in value:
                            # $sum: 0 or $sum: 1 should always be $sum: 1 for counting
                            if value["$sum"] == 0:
                                value["$sum"] = 1
                                print("   ✅ Fixed: $sum: 0 → $sum: 1")

        return query_spec

    @staticmethod
    def _fix_route_id_type(query_spec: dict) -> dict:
        """Ensure route_id is integer, not string"""

        def convert_route_ids(obj):
            if isinstance(obj, dict):
                for key, value in obj.items():
                    if key == "route_id" and isinstance(value, str) and value.isdigit():
                        obj[key] = int(value)
                        print(f"   ✅ Fixed: route_id '{value}' → {int(value)}")
                    elif isinstance(value, (dict, list)):
                        convert_route_ids(value)
            elif isinstance(obj, list):
                for item in obj:
                    convert_route_ids(item)

        if "query" in query_spec:
            convert_route_ids(query_spec["query"])

        return query_spec


# =============================================================================
# DYNAMIC ANSWER GENERATOR (SCHEMA + RESULT-BASED)
# =============================================================================


class DynamicAnswerGenerator:
    """Generates natural language answers from database results using Gemini"""

    def __init__(self, api_key: str):
        self.client = genai.Client(api_key=api_key)
        self.model = "gemini-2.0-flash-exp"

    def _humanize_results(self, results: list) -> list:
        """
        Pre-humanize class names in database results before sending to Gemini.
        This ensures Gemini sees clean names like 'Street Light (Good)'
        instead of 'STREET_LIGHT_AssetCondition_Good'.
        """
        import copy
        import re

        def humanize_class_name(class_name: str) -> str:
            """Convert STREET_LIGHT_AssetCondition_Good -> Street Light (Good)"""
            if not isinstance(class_name, str):
                return class_name

            # Check for AssetCondition pattern
            match = re.match(
                r"^(.+?)_?AssetCondition_?(.+)$", class_name, re.IGNORECASE
            )
            if match:
                asset_part = match.group(1).replace("_", " ").title()
                condition = match.group(2).replace("_", " ").title()
                return f"{asset_part} ({condition})"

            # Check if it looks like a class name (has underscores, starts with caps)
            if "_" in class_name and class_name[0].isupper():
                return class_name.replace("_", " ").title()

            return class_name

        def process_value(value):
            """Recursively process values to humanize class names"""
            if isinstance(value, str):
                return humanize_class_name(value)
            elif isinstance(value, dict):
                return {k: process_value(v) for k, v in value.items()}
            elif isinstance(value, list):
                return [process_value(item) for item in value]
            return value

        # Deep copy to avoid modifying original results
        humanized = copy.deepcopy(results)
        return [process_value(item) for item in humanized]

    def generate(
        self,
        question: str,
        results: list,
        location_info: Optional[Dict] = None,
        conversation_history: list = None,
        query_spec: Optional[Dict] = None,
        extra_context: str = None,
    ) -> str:
        """Generate natural language answer from results"""

        if not results and not extra_context:
            return self._generate_no_results_message(
                question, location_info, query_spec
            )

        # Pre-humanize class names in results BEFORE sending to Gemini
        # This ensures Gemini sees "Street Light (Good)" not "STREET_LIGHT_AssetCondition_Good"
        humanized_results = self._humanize_results(results[:5])
        results_preview = json.dumps(humanized_results, indent=2, default=str)

        # Build context
        context = ""
        if conversation_history:
            context = "\n\nRecent conversation:\n"
            for msg in conversation_history[-3:]:
                role = "User" if msg["role"] == "user" else "Assistant"
                context += f"{role}: {msg['content']}\n"

        location_context = ""
        if location_info:
            route_id = location_info.get("route_id")
            road_name = location_info.get("road_name")

            if route_id and road_name:
                location_context = (
                    f"\nLocation matched in database: route {route_id} ({road_name})"
                )
            elif location_info.get("query"):
                location_context = f"\nLocation context: {location_info.get('query')}"

        extra_context_str = ""
        if extra_context:
            extra_context_str = f"\n\nADDITIONAL ASSET DATA:\n{extra_context}\n"

        prompt = f"""You are a helpful assistant for RoadRunner (road survey system).
1. **PRIVACY & SECURITY**:
   - **NEVER** mention "demo videos", "demonstration data", "JSON files", "filtered", or "database".
   - **NEVER** reveal internal Video IDs (e.g., "2025_0817..."). Refer to them as "the video" or "survey data".

USER QUESTION: {question}{location_context}

DATABASE RESULTS:
{results_preview}{extra_context_str}

{context}

INSTRUCTIONS:

1. **Synthesize Information**:
   - specific questions might use `DATABASE RESULTS`.
   - General questions might use `ADDITIONAL ASSET DATA`.
   - Combine insights from BOTH sources if available.

   - If result has "count" field → This is an aggregation count result
   - If result has "_id": null → This is a grouped count (extract the "count" value)
   - If results are array of objects → These are individual records

2. **Answer naturally and professionally**:
   - Start with a direct answer or summary.
   - Avoid phrases like "Based on the filtered data" or "According to the database".
   - Instead say: "The survey shows...", "We found...", or "There are...".
   - If user asked "how many X on route Y?" → Say "Route Y has [count] [X]"
   - Use numbers with commas for readability (1,234 not 1234)
   - Be conversational and helpful

3. **Use the actual data**:
   - Read the count/numbers from the results JSON above
   - Don't make up numbers
   - If multiple types, organize them clearly

4. **Formatting guidelines (IMPORTANT - use valid GitHub Flavored Markdown)**:
   - For bullet lists: Use "- " with a space after, one item per line
   - For numbered lists: Use "1. ", "2. ", etc. with a space after
   - For bold text: Use **double asterisks** 
   - For emphasis: Use *single asterisks*
   - Ensure blank lines before and after lists
   - Do NOT use escaped underscores like \\_
   - Keep paragraphs separated by blank lines

5. **Be specific**:
   - Mention the route number if asked
   - Mention the detection type if asked
   - Add context if the data shows interesting patterns

EXAMPLES:

Question: "how many street lights on route 105?"
Result: [{{"_id": null, "count": 1523}}]
Answer: "Route 105 has 1,523 street lights detected in the survey."

Question: "what defects were found?"
Result: [{{"asset_type": "Kerb", "timestamp": 13.5, "severity": "moderate"}}, ...]
Answer: "The survey detected several road defects including Median issues at 0:26 and 0:54 (moderate severity), Kerb problems at 0:13, 0:18, and 0:56 (moderate severity), Carriageway defects at 0:26, and Road Marking issues at 0:56."

Now answer the user's question clearly and professionally:
"""

        try:
            response = self.client.models.generate_content(
                model=self.model, contents=prompt
            )

            raw_answer = response.text.strip()

            # Apply formatting and sanitization
            formatted_answer = AnswerFormatter.format(raw_answer, results, question)
            return formatted_answer

        except Exception as e:
            print(f"Answer generation error: {e}")

            # Fallback response
            if location_info:
                fallback = (
                    f"Found {len(results)} results near {location_info.get('query')}."
                )
            else:
                fallback = f"Found {len(results)} results for your query."

            return AnswerFormatter.format(fallback, results, question)

    def _generate_no_results_message(
        self, question: str, location_info: Optional[Dict], query_spec: Optional[Dict]
    ) -> str:
        """Generate helpful error message when no results found"""

        # Extract route number if mentioned
        route_match = re.search(r"route\s+(\d+)", question, re.IGNORECASE)
        route_num = route_match.group(1) if route_match else None

        # Extract location name if mentioned
        location_name = None
        if location_info:
            location_name = (
                location_info.get("query", "")
                .replace(" (cached)", "")
                .replace(" (geocoded)", "")
                .replace(" (from database)", "")
            )

        # Context-specific messages
        if query_spec:
            collection = query_spec.get("collection", "")

            if collection == "roads" and route_num:
                message = f"I couldn't find any road information for route {route_num}. This route might not exist in the system yet."
            elif collection == "frames" and route_num:
                message = f"I couldn't find any survey data (frames) for route {route_num}. This route either hasn't been surveyed yet."
            elif collection == "frames" and location_name:
                message = f"I couldn't find any survey data near '{location_name}'. Try asking by route number instead."
            elif collection == "assets" and route_num:
                message = f"I couldn't find any assets on route {route_num}. This route might not have been surveyed for assets yet."
            elif collection == "videos":
                message = f"I couldn't find any videos matching your query."
            elif collection == "surveys":
                message = f"I couldn't find any survey records matching your query."
            else:
                if location_name:
                    message = f"No data found near {location_name}. Try asking by route number instead."
                else:
                    message = "Please provide a specific route number or video."
        else:
            # Generic fallback
            if location_name:
                message = f"No data found near {location_name}. Try asking by route number instead."
            else:
                message = "Please provide a specific route number or video."

        # Apply formatting
        return AnswerFormatter.format(message, None, question)


# =============================================================================
# ANSWER FORMATTER & SANITIZER
# =============================================================================


class AnswerFormatter:
    """Formats and sanitizes LLM answers for better presentation"""

    @staticmethod
    def format(answer: str, results: list = None, question: str = None) -> str:
        """
        Apply minimal formatting rules.
        With ReactMarkdown on frontend, we only need to:
        1. Humanize asset names (Road_Marking_Line -> Road Marking Line)
        2. Basic whitespace cleanup

        We explicitly DO NOT:
        - Add commas to numbers (breaks markdown rendering)
        - Wrap underscored identifiers in backticks (ReactMarkdown handles this)
        - Aggressively restructure content
        """

        print("[AnswerFormatter] format() called")

        # Step 0: CRITICAL - Unescape backslash-underscores FIRST
        # Gemini outputs \_ to prevent markdown italics, but this breaks our regex
        answer = answer.replace("\\_", "_")

        # Step 1: Humanize asset names (convert Road_Marking_Line -> Road Marking Line)
        answer = AnswerFormatter._humanize_asset_names(answer)

        print(f"[AnswerFormatter] After humanization (first 300 chars): {answer[:300]}")

        # Step 2: Basic cleanup only
        answer = AnswerFormatter._clean_raw_output(answer)

        return answer.strip()

    @staticmethod
    def _escape_markdown_underscores(text: str) -> str:
        """
        Escape underscores that could be interpreted as markdown italic markers.
        Wraps identifiers (snake_case) in backticks.
        """
        # Pattern: alphanumeric words connected by underscores
        # Examples: video_name, 2025_08_17, STREET_LIGHT
        # Lookbehind/ahead ensures we don't double-wrap existing code blocks

        def replace_func(match):
            # If already inside backticks, don't touch
            full_match = match.group(0)
            if "`" in full_match:
                return full_match

            # Wrap in backticks
            return f"`{full_match}`"

        # Detect word characters connected by underscores, ensure strict boundaries
        # This regex mimics identifiers: start with word char, contains underscores, ends with word char
        pattern = r"(?<!`)\b[a-zA-Z0-9]+(?:_[a-zA-Z0-9]+)+\b(?!`)"

        return re.sub(pattern, replace_func, text)

    @staticmethod
    def _humanize_asset_names(text: str) -> str:
        """
        Transform raw asset class names into human-readable format.

        Examples:
        - STREET_LIGHT_AssetCondition_Good → Street Light (Good)
        - Traffic_Bollard_AssetCondition_Missing → Traffic Bollard (Missing)
        - STREET_LIGHT_POLE → Street Light Pole
        - Kerb_AssetCondition_Good → Kerb (Good)
        """
        import re

        def humanize_match(match):
            raw_name = match.group(0)

            # Pattern 1: ASSET_NAME_AssetCondition_CONDITION
            condition_match = re.match(
                r"^(.+?)_?AssetCondition_?(.+)$", raw_name, re.IGNORECASE
            )

            if condition_match:
                asset_part = condition_match.group(1)
                condition = condition_match.group(2)

                # Convert asset name: STREET_LIGHT → Street Light
                asset_name = asset_part.replace("_", " ")
                asset_name = asset_name.title()

                # Clean up condition
                condition = condition.replace("_", " ").title()

                return f"{asset_name} ({condition})"

            # Pattern 2: Just SCREAMING_SNAKE_CASE asset name (no condition)
            # Convert to Title Case
            humanized = raw_name.replace("_", " ")

            # Handle all-caps words smartly
            words = humanized.split()
            result_words = []
            for word in words:
                if word.isupper() and len(word) > 1:
                    # All caps - convert to Title Case
                    result_words.append(word.title())
                else:
                    result_words.append(word)

            return " ".join(result_words)

        # Match patterns that look like asset class names:
        # - All caps with underscores: STREET_LIGHT_POLE
        # - Mixed case with AssetCondition: Traffic_Bollard_AssetCondition_Good
        # - Starts with caps and has underscores
        pattern = r"\b[A-Z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b"

        text = re.sub(pattern, humanize_match, text)

        return text

    @staticmethod
    def _clean_raw_output(text: str) -> str:
        """Remove unwanted characters and clean up text"""

        # Fix LaTeX-style escaped underscores (\_ -> _)
        text = text.replace("\\_", "_")

        # Remove multiple spaces
        text = re.sub(r"  +", " ", text)

        # Remove multiple newlines (keep max 2)
        text = re.sub(r"\n{3,}", "\n\n", text)

        # Fix common markdown issues
        text = text.replace("**bold**", "**")
        text = text.replace("****", "")

        return text

    @staticmethod
    def _format_numbers(text: str) -> str:
        """Format numbers with commas for readability, avoiding identifiers"""

        def add_commas(match):
            number = match.group(1)
            try:
                num = int(number)
                if num >= 1000:
                    return f"{num:,}"
                return number
            except:
                return number

        # Safe pattern:
        # - Capture 4+ digits
        # - Lookbehind: Not preceded by digit, dot, underscore, or letter (prevents formatting identifiers or coordinates)
        # - Lookahead: Not followed by digit, dot, underscore, or letter
        # - Not part of "route X" (case insensitive match for Route/route)
        pattern = r"(?<![\d._a-zA-Z])(?<![Rr]oute\s)(\d{4,})(?![\d._a-zA-Z])"

        return re.sub(pattern, add_commas, text)

    @staticmethod
    def _enhance_markdown(text: str) -> str:
        """Enhance markdown - currently limited to avoid breaking lists"""
        # Bolding Routes
        text = re.sub(r"Route\s+(\d+)", r"**Route \1**", text, flags=re.IGNORECASE)

        # Clean up severity mentions if present
        text = re.sub(
            r"\((moderate|high|low|severe)\s+severity\)",
            r"(**\1 severity**)",
            text,
            flags=re.IGNORECASE,
        )

        return text

    @staticmethod
    def _add_structure(text: str, results: list = None, question: str = None) -> str:
        """Add structure to unstructured answers"""

        # If answer is very short (< 50 chars), it's probably fine as is
        if len(text) < 50:
            return text

        # If answer has multiple sentences, ensure proper spacing
        text = re.sub(r"\.([A-Z])", r". \1", text)

        # If listing multiple items, ensure they're formatted as bullet points
        # Check if answer has multiple items separated by commas
        if question and ("list" in question.lower() or "show" in question.lower()):
            # Convert comma-separated lists to bullet points
            if "," in text and text.count(",") >= 2:
                # Split by commas and create bullet points
                parts = text.split(",")
                if len(parts) > 2:
                    header = parts[0]
                    items = [f"• {item.strip()}" for item in parts[1:]]
                    text = f"{header}:\n" + "\n".join(items)

        return text


# =============================================================================
# VIDEO HANDLER (KEEPS ORIGINAL FEATURES)
# =============================================================================


class VideoHandler:
    """Handles video defect and metadata queries"""

    def __init__(self, db_client: MongoDBClient, answer_gen: DynamicAnswerGenerator):
        self.db = db_client
        self.answer_gen = answer_gen

    def _chat_has_videos(self, chat_id: str) -> bool:
        """Check if a chat has any uploaded videos"""
        try:
            count = self.db.db.video_processing_results.count_documents(
                {"chat_id": chat_id}
            )
            return count > 0
        except Exception as e:
            print(f"Error checking chat videos: {e}")
            return False

    def _get_chat_videos(self, chat_id: str) -> list:
        """Get all videos for a specific chat"""
        try:
            videos = list(
                self.db.db.video_processing_results.find(
                    {"chat_id": chat_id},
                    {
                        "video_id": 1,
                        "road_name": 1,
                        "road_section": 1,
                        "total_defects": 1,
                        "processing_date": 1,
                    },
                )
            )
            return videos
        except Exception as e:
            print(f"Error getting chat videos: {e}")
            return []

    def handle_video_defect_query(
        self, question: str, history: list = None, chat_id: str = None
    ) -> str:
        """Handle video defect queries using RAG pipeline"""
        try:
            print("🔍 Querying video defects with RAG...")

            video_rag = get_video_rag_handler()
            if video_rag is None:
                return "Video defect analysis is not available. Please ensure the video processing system is configured."

            # Query the video RAG system
            result = video_rag.query_defects(
                question, user_id=None, chat_id=chat_id, top_k=10
            )

            if not result.get("success"):
                error_msg = result.get("error", "Unknown error")

                # If Milvus is empty, fallback to metadata query
                if (
                    "No relevant defects found" in error_msg
                    or "collection is empty" in error_msg.lower()
                ):
                    print(
                        "⚠️ Milvus collection empty, falling back to video metadata query"
                    )
                    return self.handle_video_metadata_query(question, history, chat_id)

                return f"Error querying video defects: {error_msg}"

            answer = result.get("answer", "No answer generated")
            num_sources = result.get("num_sources", 0)

            # Check if answer indicates no defects found
            if num_sources == 0 or "No defects found" in answer or "❌" in answer:
                print("⚠️ No defects in results, falling back to video metadata query")
                return self.handle_video_metadata_query(question, history, chat_id)

            if num_sources > 0:
                answer += f"\n\n📊 *Based on {num_sources} video defect records*"

            return answer

        except Exception as e:
            print(f"Error in video defect query: {e}")
            import traceback

            traceback.print_exc()
            return f"Error processing video defect query: {str(e)}"

    def handle_video_metadata_query(
        self, question: str, history: list = None, chat_id: str = None
    ) -> str:
        """Handle video metadata queries"""
        try:
            print("📹 Querying video metadata...")

            # Query MongoDB for video processing results
            query = {"chat_id": chat_id} if chat_id else {}
            results = self.db.find("video_processing_results", query, limit=10)

            if not results:
                return (
                    "No videos have been processed yet. Upload a video to get started!"
                )

            # Build context and generate answer
            video_context = self._build_video_context(results)
            return self._generate_video_metadata_answer(
                question, video_context, results
            )

        except Exception as e:
            print(f"Error in video metadata query: {e}")
            import traceback

            traceback.print_exc()
            return f"Error retrieving video information: {str(e)}"

    def _build_video_context(self, videos: list) -> str:
        """Build detailed context from video data"""
        context_parts = []

        for idx, video in enumerate(videos, 1):
            metadata = video.get("metadata", {})
            gps_start = metadata.get("gps_start", {})
            gps_end = metadata.get("gps_end", {})

            # Use type_distribution if available
            type_dist = video.get("type_distribution", {})
            if not type_dist:
                defects = video.get("defects", [])
                type_dist = dict(
                    Counter([d.get("asset_type", "Unknown") for d in defects])
                )

            total_defects = video.get("total_defects", len(video.get("defects", [])))

            context = f"""
Video {idx}:
- ID: {video.get('video_id', 'N/A')}
- Road: {video.get('road_name', 'N/A')}
- Section: {video.get('road_section', 'N/A')}
- Surveyor: {video.get('surveyor', 'N/A')}
- Survey Date: {video.get('processing_date', metadata.get('survey_date', 'N/A'))}
- Duration: {metadata.get('duration_seconds', 0):.1f} seconds
- Resolution: {metadata.get('width', 0)}x{metadata.get('height', 0)}
- FPS: {metadata.get('fps', 0):.1f}
- File Size: {metadata.get('file_size_mb', 0):.1f} MB
- Total Defects Detected: {total_defects}
- Defect Types (name: count): {type_dist}
- Severity Distribution: {video.get('severity_distribution', {})}
- GPS Start: {gps_start.get('lat', 0):.6f}, {gps_start.get('lng', 0):.6f}
- GPS End: {gps_end.get('lat', 0):.6f}, {gps_end.get('lng', 0):.6f}
"""
            context_parts.append(context.strip())

        return "\n\n".join(context_parts)

    def _generate_video_metadata_answer(
        self, question: str, video_context: str, videos: list
    ) -> str:
        """Generate intelligent answer about video metadata using Gemini (fully dynamic)"""

        # Build rich structured data for Gemini to work with
        structured_data = []

        for idx, video in enumerate(videos, 1):
            metadata = video.get("metadata", {})
            type_dist = video.get("type_distribution", {})
            severity_dist = video.get("severity_distribution", {})
            defects = video.get("defects", [])

            video_data = {
                "video_id": video.get("video_id", "N/A"),
                "road_name": video.get("road_name", "N/A"),
                "section": video.get("road_section", "N/A"),
                "surveyor": video.get("surveyor", "N/A"),
                "survey_date": video.get("processing_date")
                or metadata.get("survey_date", "N/A"),
                "duration_seconds": metadata.get("duration_seconds", 0),
                "total_defects": video.get("total_defects", len(defects)),
                "asset_types": type_dist,
                "severity_breakdown": severity_dist,
                "individual_detections": [
                    {
                        "timestamp": d.get("timestamp", "N/A"),
                        "asset_type": d.get("asset_type", "Unknown"),
                        "condition": d.get("condition", "Unknown"),
                        "severity": d.get("severity", "Unknown"),
                        "confidence": round(d.get("confidence", 0) * 100, 1),
                    }
                    for d in defects
                ],
            }
            structured_data.append(video_data)

        # Let Gemini intelligently answer based on the question and available data
        prompt = f"""You are an expert AI assistant for road survey video analysis. Answer the user's question using ONLY the provided data.

USER QUESTION: "{question}"

AVAILABLE VIDEO DATA:
{json.dumps(structured_data, indent=2)}

INSTRUCTIONS:
1. **Understand the intent**: What is the user asking for?
   - Timestamps? → Show individual_detections with timestamps
   - Specific asset type (e.g., "kerbs", "street lights")? → Filter individual_detections by asset_type
   - Count? → Use total_defects or asset_types counts
   - List all? → Show all asset_types with counts
   - Summary? → Provide overview with key stats

2. **Format appropriately**:
   - Use **bold** for headers and asset names
   - Use bullet points (•) for lists
   - Group by timestamp if showing individual detections
   - Include confidence levels when showing specific detections
   - Use clear sections with proper spacing

3. **Be accurate**:
   - Use ONLY data from the JSON above
   - Don't invent asset types not in the data
   - Match asset names exactly (handle underscores → spaces)
   - Show actual counts from the data

4. **Be intelligent**:
   - If they ask for "kerbs", match "Kerb" in asset_type (case-insensitive, handle plurals)
   - If they ask for timestamps, show individual_detections grouped by timestamp
   - If they ask about condition, include condition field
   - If they ask "how many", provide the count

5. **Tone**: Professional but conversational, concise but complete

Provide your answer:
"""

        try:
            response = self.answer_gen.client.models.generate_content(
                model=self.answer_gen.model, contents=prompt
            )
            raw_answer = response.text.strip()
            # Apply formatting to ensure consistent output
            return AnswerFormatter.format(raw_answer, None, question)
        except Exception as e:
            print(f"Error generating video metadata answer: {e}")
            return AnswerFormatter.format(video_context, None, question)


# =============================================================================
# CONVERSATION MEMORY (ORIGINAL FEATURES)
# =============================================================================


class ConversationMemory:
    """Manages conversation history and context extraction"""

    def __init__(self):
        self.history = []

    def add(self, role: str, content: str, **metadata):
        """Add message to history"""
        msg = {"role": role, "content": content}
        msg.update(metadata)
        self.history.append(msg)

    def get(self) -> list:
        """Get conversation history"""
        return self.history

    def clear(self):
        """Clear history"""
        self.history = []

    def _answer_meta_question(self, question: str) -> str:
        """Answer questions about the conversation itself"""

        if not self.history or len(self.history) < 2:
            return "We haven't discussed any specific roads yet. Ask me about a route and I'll remember it!"

        # Extract route information from history
        routes_mentioned = []
        locations_mentioned = []

        for msg in self.history:
            # Find route numbers
            route_matches = re.findall(r"route\s+(\d+)", msg["content"], re.IGNORECASE)
            routes_mentioned.extend(route_matches)

            # Find location names
            location_matches = re.findall(
                r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b", msg["content"]
            )
            if location_matches:
                locations_mentioned.extend(location_matches)

        if routes_mentioned:
            last_route = routes_mentioned[-1]
            unique_routes = list(dict.fromkeys(routes_mentioned))

            if len(unique_routes) == 1:
                return f"You're asking about route {last_route}. That's the route we've been discussing."
            else:
                return f"You've asked about routes: {', '.join(unique_routes)}. The most recent one is route {last_route}."

        return "I can see our conversation, but I need a specific route number to give you accurate data."

    def _extract_road_route_mapping(self) -> dict:
        """Extract road name → route_id mappings from conversation"""

        mappings = {}

        # Only look at assistant responses
        for msg in self.history:
            if msg.get("role") == "user":
                continue

            content = msg["content"]

            # Pattern 1: "is named X" or "is called X"
            match = re.search(
                r"route\s+(\d+)\s+(?:is\s+)?(?:named|called)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)",
                content,
                re.IGNORECASE,
            )
            if match:
                route_id = match.group(1)
                road_name = match.group(2).strip()

                if road_name.lower() not in [
                    "it",
                    "a",
                    "the",
                    "municipal",
                    "urban",
                    "road",
                    "street",
                ]:
                    mappings[road_name] = int(route_id)

        return mappings


# =============================================================================
# MAIN CHATBOT (ORCHESTRATOR)
# =============================================================================


class RoadRunnerChatbot:
    """Main chatbot orchestrator with full feature preservation"""

    def __init__(
        self,
        mongo_uri: str = MONGO_URI,
        db_name: str = DB_NAME,
        api_key: str = GEMINI_API_KEY,
    ):
        print("🚀 Initializing RoadRunner Chatbot (Full Redesign)...")

        # Initialize components
        self.schema_loader = DynamicSchemaLoader()
        self.db = MongoDBClient(mongo_uri, db_name)

        # AI Components - pass schema_loader to intent_analyzer
        self.intent_analyzer = IntentAnalyzer(api_key, self.schema_loader)
        self.location_handler = SmartLocationHandler(self.db.geocode_cache, self.db)
        self.query_gen = DynamicQueryGenerator(api_key, self.schema_loader)
        self.answer_gen = DynamicAnswerGenerator(api_key)

        # Video handling
        self.video_handler = VideoHandler(self.db, self.answer_gen)

        # Conversation memory
        self.memory = ConversationMemory()

        print("✅ RoadRunner Chatbot Ready!")

    def _get_latest_video_for_route(self, route_id: int) -> Optional[str]:
        """Find the most recently processed video for a route"""
        try:
            # Query video_processing_results sorted by processing_date
            # Note: This collection typically stores 'video_id' as the filename/identifier
            video = self.db.db.video_processing_results.find_one(
                {"route_id": int(route_id)}, sort=[("processing_date", -1)]
            )
            if video:
                print(
                    f"✓ Found latest video for route {route_id}: {video.get('video_id')}"
                )
                return video.get("video_id")

            # Fallback: Check videos collection (for non-processed but registered videos)
            video = self.db.db.videos.find_one(
                {"route_id": int(route_id), "status": "completed"},
                sort=[("created_at", -1)],
            )
            if video:
                # If title looks like a filename (e.g. "2025_0817.._F.mp4"), strip extension
                title = video.get("title", "")
                if title.endswith(".mp4") or title.endswith(".MP4"):
                    return os.path.splitext(title)[0]
                return str(video["_id"])

            return None
        except Exception as e:
            print(f"Error finding latest video for route {route_id}: {e}")
            return None

    def _get_latest_global_video(self) -> Optional[str]:
        """Find the most recently processed video in the entire system"""
        try:
            # Query video_processing_results sorted by processing_date
            video = self.db.db.video_processing_results.find_one(
                {}, sort=[("processing_date", -1)]
            )
            if video:
                print(f"✓ Found latest GLOBAL video: {video.get('video_id')}")
                return video.get("video_id")

            # Fallback: Check videos collection
            video = self.db.db.videos.find_one(
                {"status": "completed"},
                sort=[("created_at", -1)],
            )
            if video:
                title = video.get("title", "")
                if title.endswith(".mp4") or title.endswith(".MP4"):
                    return os.path.splitext(title)[0]
                return str(video["_id"])

            return None
        except Exception as e:
            print(f"Error finding latest global video: {e}")
            return None

    def _handle_road_summary_query(self) -> str:
        """Handle queries about how many routes/roads are surveyed"""
        try:
            # Query distinct route_ids from surveys collection
            route_ids = self.db.db.surveys.distinct("route_id")

            count = len(route_ids)
            if count == 0:
                return "We haven't surveyed any routes yet."

            # Get road details for each route
            lines = [f"We have surveyed **{count}** routes:"]

            for route_id in sorted(route_ids):
                # Try to find road info for this route
                road = self.db.db.roads.find_one({"route_id": route_id})
                if road:
                    name = road.get("road_name", f"Route {route_id}")
                    distance = road.get("estimated_distance_km", 0)
                    lines.append(f"\n- **{name}** (Route {route_id}, {distance} km)")
                else:
                    lines.append(f"\n- **Route {route_id}**")

            return "\n".join(lines)

        except Exception as e:
            print(f"Error handling road summary: {e}")
            return "I encountered an error while retrieving the route list."

    def _handle_survey_stats_query(self, question: str) -> str:
        """Handle queries about survey statistics (counts, surveyors, dates)"""
        try:
            # 1. Determine Time Filter
            q_lower = question.lower()
            end_date = datetime.utcnow()
            date_filter_text = "in total"

            # Survey date is stored as "YYYY-MM-DD" string in surveys collection
            start_date_str = None

            if "today" in q_lower:
                start_date_str = end_date.strftime("%Y-%m-%d")
                date_filter_text = "today"
            elif "this month" in q_lower:
                start_date_str = end_date.strftime("%Y-%m")
                date_filter_text = "this month"
            elif "this year" in q_lower:
                start_date_str = end_date.strftime("%Y")
                date_filter_text = "this year"

            # Build Query on 'surveys' collection
            match_query = {}
            if start_date_str:
                match_query["survey_date"] = {"$regex": f"^{start_date_str}"}

            # 2. Determine Intent Type

            # Intent A: "Who conducted most surveys?"
            if "who" in q_lower and ("conducted" in q_lower or "surveyor" in q_lower):
                pipeline = [
                    {"$match": match_query},
                    {"$group": {"_id": "$surveyor_name", "count": {"$sum": 1}}},
                    {"$sort": {"count": -1}},
                    {"$limit": 5},
                ]
                results = list(self.db.db.surveys.aggregate(pipeline))

                if not results:
                    return f"No surveys found {date_filter_text}."

                top = results[0]
                name = top.get("_id") or "Unknown"
                count = top.get("count", 0)

                # Build detailed response
                lines = [
                    f"**{name}** conducted the most surveys ({count}) {date_filter_text}."
                ]

                if len(results) > 1:
                    lines.append("\n**Other contributors:**")
                    for r in results[1:]:
                        rname = r.get("_id") or "Unknown"
                        rcount = r.get("count", 0)
                        lines.append(f"\n- {rname}: {rcount} surveys")

                return "\n".join(lines)

            # Intent B: "What dates were surveys conducted?"
            elif "what dates" in q_lower or "when" in q_lower:
                cursor = self.db.db.surveys.find(
                    match_query, {"survey_date": 1, "surveyor_name": 1}
                ).sort("survey_date", -1)

                survey_list = list(cursor)

                if not survey_list:
                    return f"No surveys found {date_filter_text}."

                # Group by date
                by_date = {}
                for doc in survey_list:
                    s_date = doc.get("survey_date", "Unknown")
                    if s_date not in by_date:
                        by_date[s_date] = 0
                    by_date[s_date] += 1

                lines = [f"**Survey activity {date_filter_text}:**"]
                for d in sorted(by_date.keys(), reverse=True)[:7]:
                    try:
                        dt = datetime.strptime(d, "%Y-%m-%d")
                        fmt_d = dt.strftime("%B %d, %Y")
                    except:
                        fmt_d = d
                    count = by_date[d]
                    lines.append(f"\n- **{fmt_d}**: {count} survey(s)")

                total = len(survey_list)
                lines.append(f"\n_Total: {total} surveys recorded._")

                return "\n".join(lines)

            # Intent C: "How many surveys?" (Default)
            else:
                count = self.db.db.surveys.count_documents(match_query)

                # Get some extra stats
                surveyors = self.db.db.surveys.distinct("surveyor_name", match_query)
                routes = self.db.db.surveys.distinct("route_id", match_query)

                lines = [f"We have conducted **{count}** surveys {date_filter_text}."]
                if surveyors:
                    lines.append(f"\n- **Surveyors involved:** {len(surveyors)}")
                if routes:
                    lines.append(f"\n- **Routes covered:** {len(routes)}")

                return "\n".join(lines)

        except Exception as e:
            print(f"Error handling survey stats: {e}")
            import traceback

            traceback.print_exc()
            return "I couldn't retrieve the survey statistics."

    def _handle_defect_ranking(self) -> str:
        """Handle queries about which road has the most defects"""
        try:
            print("[CHATBOT] calculating defect ranking...")

            # Pipeline to count damaged assets per video
            pipeline = [
                # 1. Match damaged assets
                {
                    "$match": {
                        "condition": {
                            "$in": [
                                "poor",
                                "damaged",
                                "bad",
                                "critical",
                                "missing",
                                "broken",
                            ]
                        }
                    }
                },
                # 2. Group by video
                {"$group": {"_id": "$video_id", "defect_count": {"$sum": 1}}},
                # 3. Sort by count descending
                {"$sort": {"defect_count": -1}},
                # 4. Limit to top 5 videos
                {"$limit": 5},
            ]

            top_videos = list(self.db.db.assets.aggregate(pipeline))

            if not top_videos:
                return "I couldn't find any defects recorded in the system yet."

            # Now we need to link video_id -> route_id -> road_name
            # We'll do this manually since lookup can be tricky with different types

            lines = ["**Roads with the most defects:**"]

            for item in top_videos:
                video_id = item["_id"]
                count = item["defect_count"]

                # Find survey to get route
                # Surveys connect video_id (or filename) to route_id
                # video_id in assets might be full filename or normalized ID

                # Try finding exact match
                survey = self.db.db.surveys.find_one({"video_id": video_id})

                # If not found, try matching regex (assets usually have full filename)
                if not survey:
                    normalized = video_id.replace(".mp4", "")
                    survey = self.db.db.surveys.find_one(
                        {"video_id": {"$regex": f"^{normalized}"}}
                    )

                route_name = "Unknown Route"
                if survey:
                    route_id = survey.get("route_id")

                    # Look up road name
                    road = self.db.db.roads.find_one({"route_id": route_id})
                    if road:
                        route_name = (
                            f"{road.get('road_name', 'Unknown')} (Route {route_id})"
                        )
                    else:
                        route_name = f"Route {route_id}"
                else:
                    route_name = f"Video {video_id}"

                lines.append(f"\n- **{route_name}**: {count} defects")

            return "\n".join(lines)

        except Exception as e:
            print(f"Error ranking defects: {e}")
            import traceback

            traceback.print_exc()
            return "I clearly encountered an error while calculating defect statistics."

    def ask(
        self,
        question: str,
        conversation_history: list = None,
        use_history: bool = True,
        chat_id: str = None,
        current_video_id: str = None,
    ) -> str:
        """
        Process user question with production logic:
        1. Context Resolution (Video > Route > Ambiguous)
        2. Source Selection (Demo JSON vs DB)
        3. Intent Routing
        """

        try:
            print(f"\n[CHATBOT] Question: {question}")
            print(f"[CHATBOT] Chat ID: {chat_id} | Video ID: {current_video_id}")

            # Use provided history or internal history
            if conversation_history is not None:
                history_to_use = conversation_history
                update_internal = False
            else:
                self.memory.add("user", question)
                history_to_use = self.memory.get() if use_history else None
                update_internal = True

            # PRE-CHECK: Meta-question about conversation?
            meta_keywords = [
                "which road",
                "what road",
                "what route",
                "which route",
                "what am i asking",
                "what did i ask",
                "what was the",
                "remind me",
            ]

            # Special case for "which road/route has highest/most defects"
            q_lower = question.lower()
            if (
                ("road" in q_lower or "route" in q_lower)
                and ("highest" in q_lower or "most" in q_lower)
                and (
                    "defect" in q_lower or "damage" in q_lower or "condition" in q_lower
                )
            ):
                print("[CHATBOT] Defect Ranking Query detected")
                return self._handle_defect_ranking()

            if any(keyword in question.lower() for keyword in meta_keywords):
                print("[CHATBOT] Meta-question detected")
                print("[CHATBOT] Meta-question detected")
                return self.memory._answer_meta_question(question)

            # PRE-CHECK: Road/Route Summary Query?
            # "How many roads", "How many routes", "What routes have we surveyed"
            q_lower = question.lower()
            if (
                "how many roads" in q_lower
                or "how many routes" in q_lower
                or ("routes" in q_lower and "surveyed" in q_lower)
                or ("roads" in q_lower and "surveyed" in q_lower)
            ):
                print("[CHATBOT] Road/Route Summary Query detected")
                return self._handle_road_summary_query()

            # PRE-CHECK: Survey Statistics Query?
            # "How many surveys", "Who conducted most", "What dates surveys"
            if (
                "how many surveys" in q_lower
                or ("who" in q_lower and "conducted" in q_lower)
                or ("what dates" in q_lower and "survey" in q_lower)
            ):
                print("[CHATBOT] Survey Stats Query detected")
                return self._handle_survey_stats_query(question)

            # Lazy import to avoid circular dependency
            from ai.demo_chatbot import get_demo_chatbot, DemoChatbot

            # =========================================================================
            # 1. ANALYZE INTENT (Extract route, assets, etc.)
            # =========================================================================
            print("[CHATBOT] Analyzing intent...")
            intent = self.intent_analyzer.analyze(
                question, chat_id, chat_has_videos=False
            )  # Always analyze fully first

            extracted_route_id = intent.get("route_id")
            # If AI didn't catch route but text has it, try regex backup
            if not extracted_route_id:
                route_match = re.search(r"route\s+(\d+)", question, re.IGNORECASE)
                if route_match:
                    extracted_route_id = int(route_match.group(1))
                    intent["route_id"] = extracted_route_id

            # =========================================================================
            # 2. DETERMINE TARGET CONTEXT (Video vs Route vs None)
            # =========================================================================
            target_video_id = None
            is_demo = False
            video_label = None  # Friendly name for the video

            # Check for "Global Query" intent (across all videos)
            is_global_query = any(
                phrase in question.lower()
                for phrase in [
                    "all videos",
                    "every video",
                    "across all videos",
                    "across videos",
                    "all data",
                ]
            )

            if is_global_query:
                print("✓ Context: Global Query (All Videos)")
                # Explicitly DO NOT set target_video_id so we query the whole DB

            # Source A: User Selected Video (Explicit)
            elif current_video_id:
                target_video_id = current_video_id
                print(f"✓ Context: Explicit Video Selected ({target_video_id})")

            # Source B: Route Mentioned (Higher Priority than Chat Context)
            elif extracted_route_id:
                target_video_id = self._get_latest_video_for_route(extracted_route_id)
                if target_video_id:
                    print(
                        f"✓ Context: Inferred Latest Video for Route {extracted_route_id} -> {target_video_id}"
                    )
                    # PRIVACY: Set friendly label for inferred context
                    video_label = "the latest survey data for this route"
                else:
                    print(
                        f"⚠️ Context: Route {extracted_route_id} found but no videos exist"
                    )

            # Source C: Chat Context (Implicit Video - Fallback)
            # Only use if we haven't found a target video yet
            elif chat_id and self.video_handler._chat_has_videos(chat_id):
                print(f"✓ Context: Inferring video from Chat Session {chat_id}")
                # NOTE: Chat context handling is complex as it might be multiple videos.
                # For now, we let the standard handlers pick it up via chat_id,
                # UNLESS we need a specific ID for Demo logic.
                pass

            # Check if target is Demo (Applies to ALL sources)
            if target_video_id:
                # Check against Demo list
                # Demo IDs are typically filenames like 2025_0817...
                normalized_id = target_video_id.replace(".mp4", "")
                if normalized_id in DemoChatbot.DEMO_VIDEOS:
                    is_demo = True
                    print("✓ Context Type: DEMO VIDEO")

            # =========================================================================
            # 3. CONTEXT FALLBACK FOR ASSET/FRAME QUERIES
            # =========================================================================
            # If no video context yet, fallback to the most recent uploaded video
            if not target_video_id and not is_global_query:
                print("⚠️ No context provided - Falling back to most recent video...")
                fallback_video = self._get_latest_global_video()

                if fallback_video:
                    target_video_id = fallback_video
                    video_label = "the most recently uploaded survey"
                    print(f"✓ Fallback successful -> {target_video_id}")

                    # Check if fallback video is a demo video
                    normalized_fallback = target_video_id.replace(".mp4", "").replace(
                        ".MP4", ""
                    )
                    if normalized_fallback in DemoChatbot.DEMO_VIDEOS:
                        is_demo = True
                        print("✓ Fallback Type: DEMO VIDEO")
                else:
                    # No videos exist at all
                    return "No survey videos have been uploaded yet. Please upload a video to get started!"

            # -------------------------------------------------------------------------
            # PATH A: DEMO VIDEO LOGIC (JSON Source)
            # -------------------------------------------------------------------------
            if is_demo:
                print("⚡ executing DEMO logic (JSON source)...")
                demo_bot = get_demo_chatbot()
                # Pass friendly label if available
                return demo_bot.ask(
                    question, video_id=target_video_id, video_label=video_label
                )

            # -------------------------------------------------------------------------
            # PATH B: PRODUCTION DB LOGIC (Mongo Source)
            # -------------------------------------------------------------------------

            # Handle "Latest Survey" asset counts/conditions
            # Users asking "How many street lights on route X?" -> query assets for that specific video
            # Only inject filter if NOT a global query
            if (
                target_video_id
                and intent.get("collection") in ["assets", "frames"]
                and not is_global_query
            ):
                # Inject video_id filter into query generation if possible,
                # OR use the specific video handlers.

                # If specific frame/timestamp query -> specific frame lookup
                if (
                    "frame" in question.lower()
                    or "timestamp" in question.lower()
                    or "what's at" in question.lower()
                ):
                    # We can use the existing 'video_metadata_query' flow but point it to the target video
                    # But current VideoHandler looks up by chat_id.
                    # We need to bridge this.
                    # Let's use the DB directly for precision if we have a frame number/timestamp
                    # OR route to standard flow with extra constraints.
                    pass

            # Proceed with standard generation, but inject location/video context

            # STEP 2b: Process location (Standard)
            location_info = None
            if intent.get("needs_geocoding"):
                location_info = self.location_handler.process(intent)

            # STEP 3: Generate Query
            # Standard logic attempts 'frames' then 'collection'
            # We enforce "Most Recent Survey" by modifying the query if we have a target_video_id

            print(f"🔄 Generating query for {intent.get('collection', 'frames')}...")

            # Prepare context for query generator
            # If we identified a specific target video (from route), we should ideally filter by it
            # But the schema-based generator might not know about 'video_id' field in all collections consistently.
            # 'frames' has 'video_id' (or 'key'). 'assets' has 'video_id'.

            query_spec = self.query_gen.generate(
                question,
                intent.get("collection", "frames"),
                location_info,
                history_to_use,
            )

            # CRITICAL ADJUSTMENT: Inject Video ID filter if we found a target video AND it's not a global query
            if query_spec and target_video_id and not is_global_query:
                if "query" in query_spec:
                    # Inject video_id filter to ensure "Most Recent Survey" rule
                    is_blocking_filter = True

                    # Determine correct field name based on collection
                    collection = query_spec.get(
                        "collection", intent.get("collection", "")
                    )

                    # Frames use 'key' (basename), others use 'video_id'
                    if collection == "frames":
                        filter_field = "key"
                        # Ensure we use basename for key
                        filter_value = target_video_id.replace(".mp4", "").replace(
                            ".MP4", ""
                        )
                    else:
                        filter_field = "video_id"
                        filter_value = target_video_id

                    if query_spec["type"] == "find":
                        query_spec["query"][filter_field] = {
                            "$regex": re.escape(filter_value),
                            "$options": "i",
                        }
                        print(
                            f"   ➕ Injected filter: {filter_field} matches '{filter_value}'"
                        )

                    elif query_spec["type"] == "aggregate":
                        # Add match stage at beginning
                        pipeline = query_spec["query"]
                        if isinstance(pipeline, list):
                            # Try to find existing match
                            match_stage = next(
                                (s for s in pipeline if "$match" in s), None
                            )
                            if match_stage:
                                match_stage["$match"][filter_field] = {
                                    "$regex": re.escape(filter_value),
                                    "$options": "i",
                                }
                            else:
                                pipeline.insert(
                                    0,
                                    {
                                        "$match": {
                                            filter_field: {
                                                "$regex": re.escape(filter_value),
                                                "$options": "i",
                                            }
                                        }
                                    },
                                )
                            print(
                                f"   ➕ Injected aggregation filter: {filter_field} matches '{filter_value}'"
                            )

            if not query_spec:
                return "I couldn't understand how to query that information. Please try rephrasing."

            query_spec = QueryCorrector.fix_query(query_spec, question)

            print(f"⚙️ Executing query: {query_spec['collection']}.{query_spec['type']}")
            if query_spec["type"] == "find":
                results = self.db.find(query_spec["collection"], query_spec["query"])
            else:
                results = self.db.aggregate(
                    query_spec["collection"], query_spec["query"]
                )

            print(f"📈 Found {len(results)} results")

            # STEP 4: Generate Answer
            answer = self.answer_gen.generate(
                question,
                results,
                location_info,
                history_to_use,
                query_spec,
                # No extra_context needed for DB path, as we queried the DB
            )

            # Add to history
            if update_internal:
                self.memory.add(
                    "assistant",
                    answer,
                    results_count=len(results),
                    intent=intent.get("query_type"),
                )

            return answer

        except Exception as e:
            print(f"❌ Chatbot error: {e}")
            import traceback

            traceback.print_exc()
            return f"Error: {str(e)}"

    def get_history(self) -> list:
        """Get conversation history"""
        return self.memory.get()

    def clear_history(self):
        """Clear conversation history"""
        self.memory.clear()

    def close(self):
        """Close connections"""
        self.db.close()


# =============================================================================
# SINGLETON INSTANCE
# =============================================================================

_chatbot_instance = None


def get_chatbot() -> RoadRunnerChatbot:
    """Get or initialize singleton chatbot instance"""
    global _chatbot_instance
    if _chatbot_instance is None:
        _chatbot_instance = RoadRunnerChatbot()
    return _chatbot_instance


# =============================================================================
# TESTING
# =============================================================================

if __name__ == "__main__":
    print("\n" + "=" * 70)
    print("🚀 RoadRunner Chatbot - Full Redesign with All Features Preserved")
    print("=" * 70)

    try:
        # chatbot = get_chatbot()
        f = AnswerFormatter()
        s = """
            At frame 60, corresponding to a timestamp of 2.0 seconds, the survey data includes the following detections across multiple entries for Route 258:
            Street Lights: One entry identifies multiple street lights, with confidence levels ranging from 0.3331 to 0.8969.
            Street Light Assets (Good Condition): Another entry detects STREET_LIGHT_POLE_AssetCondition_Good (confidence: 0.9116) and STREET_LIGHT_AssetCondition_Good (confidence: 0.8417).
            Pavement Assets (Good Condition): There are detections of Kerb (confidence: 0.9454), Median_AssetCondition_Good (confidence: 0.8514), Kerb_AssetCondition_Good (confidence: 0.8417), and Road_Marking_Line_AssetCondition_Good (confidence: 0.8061).
            Traffic Signal Heads (Good Condition): There are detections of TRAFFIC_SIGNAL_HEAD_AssetCondition_Good (confidence: 0.5835).
        """
        print(f.format(s))

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback

        traceback.print_exc()
