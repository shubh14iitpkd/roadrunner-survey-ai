"""
RoadRunner Chatbot - Enhanced with AI-Powered Intent & Geospatial Support + Video RAG
Uses google.genai (NEW API) - Fixed for 2026
Queries: frames, videos, assets, roads, surveys, and VIDEO DEFECTS with intelligent location detection
"""

import json
import os
from typing import Optional, List, Dict
from dotenv import load_dotenv
from google import genai
from pymongo import MongoClient
from pymongo.errors import ServerSelectionTimeoutError
import googlemaps

from ai.schema import SCHEMA, DB_NAME

load_dotenv()

# =============================================================================
# CONFIGURATION
# =============================================================================

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")

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
            upsert=True
        )
    
    def clear(self):
        """Clear all cached geocoding results"""
        count = self.cache.delete_many({}).deleted_count
        print(f"🗑️  Cleared {count} cached geocoding entries")
        return count

# =============================================================================
# MONGODB CONNECTION
# =============================================================================

class MongoDBClient:
    """MongoDB connection manager"""
    
    def __init__(self, mongo_uri: str, db_name: str):
        try:
            self.client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
            self.client.admin.command('ping')
            self.db = self.client[db_name]
            self.geocode_cache = GeocodeCache(self.db)
            print(f"✓ Connected to MongoDB: {db_name}")
        except ServerSelectionTimeoutError:
            raise ValueError(f"Cannot connect to MongoDB at {mongo_uri}")
    
    def find(self, collection: str, query: dict, limit: int = 10) -> List[dict]:
        """Execute find query"""
        try:
            results = list(self.db[collection].find(query).limit(limit))
            for doc in results:
                if '_id' in doc:
                    doc['_id'] = str(doc['_id'])
            return results
        except Exception as e:
            print(f"Find query error: {e}")
            return []
    
    def aggregate(self, collection: str, pipeline: list) -> List[dict]:
        """Execute aggregation pipeline"""
        try:
            results = list(self.db[collection].aggregate(pipeline))
            for doc in results:
                if '_id' in doc:
                    doc['_id'] = str(doc['_id'])
            return results
        except Exception as e:
            print(f"Aggregation error: {e}")
            return []
    
    def close(self):
        self.client.close()

# =============================================================================
# INTENT ANALYZER (AI-POWERED)
# =============================================================================

class IntentAnalyzer:
    """Uses Gemini to understand user intention before querying"""
    
    def __init__(self, api_key: str):
        self.client = genai.Client(api_key=api_key)
        self.model = "gemini-2.0-flash-exp"
    
    def analyze(self, question: str) -> Dict:
        """
        Analyze user intention to determine if location geocoding is needed
        
        Returns:
            {
                "needs_geocoding": bool,
                "location_name": str or None,
                "route_id": int or None,
                "query_type": "route_based" or "location_based" or "generic"
            }
        """
        
        # PRE-FILTER: Use keyword matching for video questions to avoid Gemini non-determinism
        question_lower = question.lower()
        
        # Check for EXPLICIT defect keywords
        defect_keywords = ['defect', 'pothole', 'crack', 'damage', 'severity', 'how many defects', 'show defects']
        has_defect_keyword = any(keyword in question_lower for keyword in defect_keywords)
        
        # Check for general video/asset keywords (assets detected in video)
        video_keywords = ['what does video', 'what is video', 'video about', 'any text', 'text detected', 
                          'video say', 'describe video', 'video content', 'video show', 
                          'what assets', 'assets detected', 'assets found', 'what was detected',
                          'what did you detect', 'what did video detect', 'what items']
        has_video_keyword = any(keyword in question_lower for keyword in video_keywords)
        
        # Check for detailed defect listing keywords - these need FULL defect data from MongoDB
        detail_keywords = ['which defect', 'name of defect', 'list defect', 'list all', 'all defect',
                           'defects detected', 'what defects', 'types of defect', 'defect types',
                           'timestamp', 'when', 'at what time', 'what time', 'time of', 'list assets',
                           'all assets', 'what assets']
        needs_details = any(keyword in question_lower for keyword in detail_keywords)
        
        # If asking for detailed defect information, classify as video_metadata_query immediately
        # (not video_defect_query which uses RAG/Milvus for semantic search)
        if needs_details:
            return {
                "query_type": "video_metadata_query",
                "needs_geocoding": False,
                "location_name": None,
                "route_id": None,
                "reasoning": "User asking for detailed defect listing, timestamps, or names - needs MongoDB query"
            }
        
        # If it's clearly a general video question (and NOT about defects), classify immediately
        if has_video_keyword and not has_defect_keyword:
            return {
                "query_type": "video_metadata_query",
                "needs_geocoding": False,
                "location_name": None,
                "route_id": None,
                "reasoning": "Pre-filtered as general video question"
            }
        
        # If it's explicitly about defects, classify immediately
        if has_defect_keyword and not has_video_keyword:
            return {
                "query_type": "video_defect_query",
                "needs_geocoding": False,
                "location_name": None,
                "route_id": None,
                "reasoning": "Pre-filtered as defect query"
            }
        
        # Otherwise, use Gemini for analysis
        prompt = f"""Analyze this user question about a road survey database (including VIDEO DEFECTS).

USER QUESTION: "{question}"

Determine the user's intention:

**PRIORITY RULES (CHECK IN THIS ORDER):**

1. VIDEO DEFECTS / ROAD DEFECTS?
   - MUST contain EXPLICIT defect keywords: "defect", "pothole", "crack", "damage", "severity", "how many defects"
   - Example: "show me all severe potholes" → video_defect_query
   - Example: "what defects were found" → video_defect_query
   - Example: "how many cracks" → video_defect_query
   - If YES: query_type = "video_defect_query"

2. VIDEO METADATA / GENERAL VIDEO INFORMATION?
   - Any question about the video itself that is NOT about defects
   - Keywords: "video", "what does video", "what is video", "about", "duration", "fps", "resolution", "road", "surveyor", "when", "what road", "any text", "text detected", "describe video", "video content"
   - Example: "what video did I upload" → video_metadata_query
   - Example: "what road was surveyed" → video_metadata_query
   - Example: "what does the video say" → video_metadata_query
   - Example: "what is video about" → video_metadata_query
   - Example: "any text detected in video?" → video_metadata_query
   - If YES: query_type = "video_metadata_query"

3. ROUTE ID (specific route number)?
   - Must have the word "route" followed by a number
   - If YES: They want data filtered by route_id field in database
   - Example: "street lights on route 214" → route_based
   
4. LOCATION/AREA/STREET NAME (NOT a route ID)?
   - If YES: They want data filtered by geographic coordinates
   - Example: "street lights on Al Waab Street" → location_based
   - Example: "assets near Corniche" → location_based
   - Example: "963 Street" → location_based (this is a street NAME, not route 963)
   - Example: "101 Avenue" → location_based (this is a street NAME, not route 101)
   
4. Is it a GENERIC question without specific route or location?
   - Example: "how many street lights in total" → generic

CRITICAL RULES:
================
1. Defect/video queries ALWAYS get query_type = "video_defect_query"
2. ONLY treat as route_based if the question explicitly says "route XXX"
3. Numbers followed by "Street", "Avenue", "Road", "St", "Ave" are STREET NAMES → location_based
4. If the question mentions BOTH a route ID AND a location name:
   - Route ID takes PRIORITY → route_based
   - Example: "route 108 near Al Waab" → route_based (use route_id: 108)

RESPOND WITH ONLY VALID JSON:
{{
  "query_type": "video_defect_query" or "route_based" or "location_based" or "generic",
  "needs_geocoding": true or false,
  "location_name": "extracted location name" or null,
  "route_id": extracted_route_number or null,
  "reasoning": "brief explanation"
}}

EXAMPLES:

1. "show me all severe potholes"
{{"query_type": "video_defect_query", "needs_geocoding": false, "location_name": null, "route_id": null, "reasoning": "User asking about video defects"}}

2. "how many street lights on route 214"
{{"query_type": "route_based", "needs_geocoding": false, "location_name": null, "route_id": 214, "reasoning": "User asking about specific route ID"}}

3. "how many street lights on Al Waab Street"
{{"query_type": "location_based", "needs_geocoding": true, "location_name": "Al Waab Street", "route_id": null, "reasoning": "User asking about a street/location name"}}

4. "assets near Corniche area"
{{"query_type": "location_based", "needs_geocoding": true, "location_name": "Corniche", "route_id": null, "reasoning": "User asking about geographic area"}}

5. "what's on route 108 near Doha"
{{"query_type": "route_based", "needs_geocoding": false, "location_name": null, "route_id": 108, "reasoning": "Route ID takes priority over location mention"}}

5. "how many countdown timers in total"
{{"query_type": "generic", "needs_geocoding": false, "location_name": null, "route_id": null, "reasoning": "Generic aggregation query"}}

6. "street lights around West Bay area"
{{"query_type": "location_based", "needs_geocoding": true, "location_name": "West Bay", "route_id": null, "reasoning": "Asking about location, not route"}}

7. "how many street lights on 963 Street"
{{"query_type": "location_based", "needs_geocoding": true, "location_name": "963 Street", "route_id": null, "reasoning": "963 Street is a street name, not route 963"}}

8. "assets on 101 Avenue"
{{"query_type": "location_based", "needs_geocoding": true, "location_name": "101 Avenue", "route_id": null, "reasoning": "101 Avenue is a street name, not route 101"}}
"""
        
        try:
            response = self.client.models.generate_content(
                model=self.model,
                contents=prompt
            )
            
            text = response.text.strip()
            
            # Clean markdown
            for prefix in ["```json\n", "```json", "```"]:
                if text.startswith(prefix):
                    text = text[len(prefix):]
            if text.endswith("```"):
                text = text[:-3]
            
            intent = json.loads(text.strip())
            return intent
        
        except Exception as e:
            print(f"Intent analysis error: {e}")
            # Fallback: assume generic query
            return {
                "query_type": "generic",
                "needs_geocoding": False,
                "location_name": None,
                "route_id": None,
                "reasoning": "Error in analysis"
            }

# =============================================================================
# SMART LOCATION HANDLER (AI-DRIVEN)
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
                print(f"✓ Found '{location_name}' in roads database → route {road_match['route_id']}")
                # Use the start point coordinates as the location
                return {
                    "type": "location",
                    "lat": road_match.get("start_lat"),
                    "lng": road_match.get("start_lng"),
                    "query": f"{location_name} (from database)",
                    "route_id": road_match["route_id"],
                    "road_name": road_match.get("road_name")
                }
        
        # STEP 2: Check cache
        cached = self.cache.get(location_name)
        if cached:
            print(f"✓ Using cached coordinates for '{location_name}'")
            return {
                "type": "location",
                "lat": cached["lat"],
                "lng": cached["lng"],
                "query": f"{location_name} (cached)"
            }
        
        # STEP 3: Geocode using Google Maps API
        if not gmaps:
            print(f"⚠️ Google Maps API not configured, cannot geocode '{location_name}'")
            return None
        
        try:
            # Geocode with "Qatar" context for better accuracy
            result = gmaps.geocode(f"{location_name}, Qatar")
            if result:
                location = result[0]["geometry"]["location"]
                coords = {"lat": location["lat"], "lng": location["lng"]}
                
                # Cache it
                self.cache.set(location_name, coords["lat"], coords["lng"])
                print(f"✓ Geocoded '{location_name}' → ({coords['lat']}, {coords['lng']})")
                
                return {
                    "type": "location",
                    "lat": coords["lat"],
                    "lng": coords["lng"],
                    "query": f"{location_name} (geocoded)"
                }
        except Exception as e:
            print(f"✗ Geocoding error: {e}")
        
        return None
    
    def _find_matching_road(self, location_name: str) -> Optional[Dict]:
        """Search for location in roads collection by road_name, start_point_name, or end_point_name"""
        if not self.db:
            return None
        
        # Normalize the search term
        search_term = location_name.lower().strip()
        
        # Try exact matches first
        for field in ["road_name", "start_point_name", "end_point_name"]:
            result = self.db.db.roads.find_one({
                field: {"$regex": f"^{location_name}$", "$options": "i"}
            })
            if result:
                return result
        
        # Try partial matches (contains)
        for field in ["road_name", "start_point_name", "end_point_name"]:
            result = self.db.db.roads.find_one({
                field: {"$regex": location_name, "$options": "i"}
            })
            if result:
                return result
        
        return None

# =============================================================================
# QUERY GENERATOR
# =============================================================================

class QueryGenerator:
    """Converts natural language questions to MongoDB queries using Gemini"""
    
    def __init__(self, api_key: str):
        self.client = genai.Client(api_key=api_key)
        self.model = "gemini-2.0-flash-exp"
    
    def generate(self, question: str, location_info: Optional[Dict] = None, conversation_history: list = None) -> Optional[dict]:
        """Generate MongoDB query from natural language"""
        
        schema_str = json.dumps(SCHEMA, indent=2)
        
        # Build location context
        location_context = ""
        if location_info:
            lat = location_info["lat"]
            lng = location_info["lng"]
            route_id = location_info.get("route_id")
            road_name = location_info.get("road_name")
            
            location_context = f"""

LOCATION DETECTED: {location_info['query']}
Coordinates: Latitude {lat}, Longitude {lng}
"""
            
            # If we found this in the database, prioritize route-based query
            if route_id:
                location_context += f"""
⚠️ CRITICAL: This location was found in the roads database!
- Route ID: {route_id}
- Road Name: {road_name}
- USE route_id: {route_id} instead of geospatial coordinates for more accurate results
- Example query: {{"route_id": {route_id}}}
"""
            else:
                # Only use geospatial if not found in database
                location_context += f"""
For FRAMES collection, use geospatial query:
{{
  "location.coordinates.0": {{"$gte": {lng - 0.005}, "$lte": {lng + 0.005}}},
  "location.coordinates.1": {{"$gte": {lat - 0.005}, "$lte": {lat + 0.005}}}
}}

For ASSETS collection, use lat/lng fields:
{{
  "lat": {{"$gte": {lat - 0.005}, "$lte": {lat + 0.005}}},
  "lng": {{"$gte": {lng - 0.005}, "$lte": {lng + 0.005}}}
}}

Note: location.coordinates in FRAMES is [longitude, latitude] format
- coordinates[0] = longitude
- coordinates[1] = latitude
"""
        
        # Build conversation context with route extraction
        context = ""
        last_route_id = None
        if conversation_history:
            context = "\n\nRECENT CONVERSATION:\n"
            for msg in conversation_history[-5:]:
                role = "User" if msg["role"] == "user" else "Assistant"
                context += f"{role}: {msg['content']}\n"
                
                # Extract route_id from conversation for context
                import re
                route_matches = re.findall(r'route\s+(\d+)', msg['content'], re.IGNORECASE)
                if route_matches:
                    last_route_id = int(route_matches[-1])
            
            if last_route_id:
                context += f"\n⚠️ IMPORTANT: Last discussed route was route {last_route_id}. If user says 'same road', 'that route', 'this route', use route_id: {last_route_id}\n"
        
        prompt = f"""You are a MongoDB expert for a road survey database with 5 collections.

DATABASE SCHEMA:
{schema_str}

{location_context}
{context}

CRITICAL CONTEXT RESOLUTION:
============================
If the user's question contains references like "same road", "that route", "this route", "same one":
- Check the conversation history above for the last mentioned route_id
- Use that route_id in your query
- Example: If history shows "route 105" and user asks "how many road markings on same road", use route_id: 105

CRITICAL INTENT DETECTION RULES:
==================================

1. FRAMES Collection (with geospatial support):
   Keywords: "street lights", "road markings", "detections", "signboards", "frames"
   Location fields: location.coordinates[0]=lng, location.coordinates[1]=lat
   Example: "How many street lights on Al Waab St?"
   Operation: $unwind detections + geospatial filter if location provided

2. VIDEOS Collection:
   Keywords: "videos", "video duration", "video status"
   Example: "What videos from route 258?"
   Operation: Simple find by route_id

3. ASSETS Collection (with geospatial support):
   Keywords: "countdown timer", "assets", "signs", "condition" (good/fair/poor)
   Location fields: lat, lng
   Example: "How many countdown timers near coordinates?"
   Operation: Filter by type + geospatial bounding box

4. ROADS Collection:
   Keywords: "distance", "road", "route info"
   Example: "What's the distance of route 214?"
   Operation: Find by route_id or road_name

5. SURVEYS Collection:
   Keywords: "survey status", "survey date", "asset totals"
   Example: "What's the survey status for route 1?"
   Operation: Find by route_id

{context}

USER QUESTION: {question}

RESPOND WITH ONLY VALID JSON (no markdown):
{{
  "collection": "frames" or "videos" or "assets" or "roads" or "surveys",
  "type": "find" or "aggregate",
  "query": {{ ... }},
  "intent": "brief explanation"
}}

GEOSPATIAL QUERY EXAMPLES:

1. "How many street lights on Al Waab St?" (with location detected):
{{"collection": "frames", "type": "aggregate", "query": [
  {{"$match": {{
    "location.coordinates.0": {{"$gte": LNG-0.005, "$lte": LNG+0.005}},
    "location.coordinates.1": {{"$gte": LAT-0.005, "$lte": LAT+0.005}}
  }}}},
  {{"$unwind": "$detections"}},
  {{"$match": {{"detections.class_name": "Street lights"}}}},
  {{"$group": {{"_id": null, "count": {{"$sum": 1}}}}}}
], "intent": "Count street lights near location"}}

2. "How many street lights on route 108?" (no location):
{{"collection": "frames", "type": "aggregate", "query": [
  {{"$match": {{"route_id": 108}}}},
  {{"$unwind": "$detections"}},
  {{"$match": {{"detections.class_name": "Street lights"}}}},
  {{"$group": {{"_id": null, "count": {{"$sum": 1}}}}}}
], "intent": "Count street lights on route"}}

3. "How many countdown timers on route 1?" → ASSETS:
{{"collection": "assets", "type": "aggregate", "query": [
  {{"$match": {{"route_id": 1, "type": "Countdown Timer"}}}},
  {{"$group": {{"_id": null, "count": {{"$sum": 1}}}}}}
], "intent": "Count countdown timer assets"}}

4. "What is the road name of route 214?" → ROADS:
{{"collection": "roads", "type": "find", "query": {{"route_id": 214}}, "intent": "Get road information by route number"}}

5. "What is the distance of route 214?" → ROADS:
{{"collection": "roads", "type": "find", "query": {{"route_id": 214}}, "intent": "Get road distance information"}}
"""
        
        try:
            response = self.client.models.generate_content(
                model=self.model,
                contents=prompt
            )
            
            text = response.text.strip()
            
            # Clean markdown
            for prefix in ["```json\n", "```json", "```"]:
                if text.startswith(prefix):
                    text = text[len(prefix):]
            if text.endswith("```"):
                text = text[:-3]
            
            query_spec = json.loads(text.strip())
            return query_spec
        
        except json.JSONDecodeError as e:
            print(f"JSON decode error: {e}")
            print(f"Response text: {text[:200]}")
            return None
        except Exception as e:
            print(f"Query generation error: {e}")
            return None

# =============================================================================
# ANSWER GENERATOR
# =============================================================================

class AnswerGenerator:
    """Generates natural language answers from database results"""
    
    def __init__(self, api_key: str):
        self.client = genai.Client(api_key=api_key)
        self.model = "gemini-2.0-flash-exp"
    
    def generate(self, question: str, results: list, location_info: Optional[Dict] = None, conversation_history: list = None, query_spec: Optional[Dict] = None) -> str:
        """Generate natural language answer from results"""
        
        if not results:
            # Provide context-aware error messages
            return self._generate_no_results_message(question, location_info, query_spec)
        
        results_preview = json.dumps(results[:5], indent=2, default=str)
        
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
            
            # Show what was actually found in database
            if route_id and road_name:
                location_context = f"\nLocation matched in database: route {route_id} ({road_name})"
            elif location_info.get("query"):
                location_context = f"\nLocation context: {location_info.get('query')}"
        
        prompt = f"""You are a helpful assistant for RoadRunner (road survey system).

QUESTION: {question}{location_context}

DATA FOUND:
{results_preview}

{context}

CRITICAL INSTRUCTIONS:
======================
1. Use ONLY the exact data from the database results above
2. DO NOT echo back the user's query keywords or location names
3. Use the actual values from the results (route_id, road_name, route names, etc.)
4. If the user asked about "Al Jamiaa st" but the database shows "route 217, Al Jamiaa St", say "route 217" or "Al Jamiaa St" (from database), not what the user typed

Examples:
- User asks: "street lights on Al Jamiaa st north"
- Database shows: route_id: 217, road_name: "Al Jamiaa St"
- Good answer: "I found 5,432 street lights on route 217 (Al Jamiaa St)."
- Bad answer: "I found 5,432 street lights on Al Jamiaa st north." ❌

Generate a clear, concise answer (2-3 sentences max):
- State exact counts if available (from result.count or count field)
- Use actual route_id and road names from the DATABASE, not user's query
- Include key metadata (types, conditions, distances) from the actual results
- Be professional but conversational
"""
        
        try:
            response = self.client.models.generate_content(
                model=self.model,
                contents=prompt
            )
            return response.text.strip()
        except Exception as e:
            print(f"Answer generation error: {e}")
            # Fallback response
            if location_info:
                return f"Found {len(results)} results near {location_info.get('query')}."
            return f"Found {len(results)} results for your query."
    
    def _generate_no_results_message(self, question: str, location_info: Optional[Dict], query_spec: Optional[Dict]) -> str:
        """Generate helpful error message when no results found"""
        import re
        
        # Extract route number if mentioned
        route_match = re.search(r'route\s+(\d+)', question, re.IGNORECASE)
        route_num = route_match.group(1) if route_match else None
        
        # Extract location name if mentioned
        location_name = None
        if location_info:
            location_name = location_info.get('query', '').replace(' (cached)', '')
        
        # Context-specific messages
        if query_spec:
            collection = query_spec.get('collection', '')
            
            if collection == 'roads' and route_num:
                return f"I couldn't find any road information for route {route_num}. This route might not exist in the system yet, or it might have a different route number. Try asking 'list available routes' to see what's in the database."
            
            elif collection == 'frames' and route_num:
                return f"I couldn't find any survey data (frames) for route {route_num}. This route either hasn't been surveyed yet, or the data isn't available in the system."
            
            elif collection == 'frames' and location_name:
                return f"I couldn't find any survey data near '{location_name}'. This could mean: (1) The location name isn't recognized, (2) This area hasn't been surveyed yet, or (3) Try asking by route number instead of location name."
            
            elif collection == 'assets' and route_num:
                return f"I couldn't find any assets on route {route_num}. This route might not have been surveyed for assets yet."
            
            elif collection == 'videos':
                return f"I couldn't find any videos matching your query. The video data might not be uploaded yet."
            
            elif collection == 'surveys':
                return f"I couldn't find any survey records matching your query."
        
        # Generic fallback
        if location_info:
            return f"No data found near {location_name}. Try asking by route number instead, or check if the location name is spelled correctly."
        
        return "I couldn't find any data matching your question. Try asking about a specific route number (e.g., 'route 214') or rephrase your question."

# =============================================================================
# MAIN CHATBOT
# =============================================================================

class RoadRunnerChatbot:
    """Main chatbot orchestrator with AI-powered intent understanding"""
    
    def __init__(self, mongo_uri: str = MONGO_URI, db_name: str = DB_NAME, api_key: str = GEMINI_API_KEY):
        self.db = MongoDBClient(mongo_uri, db_name)
        self.intent_analyzer = IntentAnalyzer(api_key)
        self.location_handler = SmartLocationHandler(self.db.geocode_cache, self.db)
        self.query_gen = QueryGenerator(api_key)
        self.answer_gen = AnswerGenerator(api_key)
        self.conversation_history = []
    
    def ask(self, question: str, conversation_history: list = None, use_history: bool = True, chat_id: str = None) -> str:
        """Process user question with intelligent intent understanding"""
        try:
            print(f"\n📝 Question: {question}")
            print(f"💬 Chat ID: {chat_id}")
            
            # Use provided history or internal history
            if conversation_history is not None:
                history_to_use = conversation_history
                update_internal = False
            else:
                self.conversation_history.append({"role": "user", "content": question})
                history_to_use = self.conversation_history if use_history else None
                update_internal = True
            
            # PRE-CHECK: Is this a meta-question about the conversation itself?
            meta_keywords = ['which road', 'what road', 'what route', 'which route', 'what am i asking', 
                           'what did i ask', 'what was the', 'remind me', 'what were we talking']
            question_lower = question.lower()
            
            if any(keyword in question_lower for keyword in meta_keywords):
                print("💭 Meta-question detected - answering from conversation context")
                return self._answer_meta_question(question, history_to_use)
            
            # PRE-CHECK 2: Extract road name → route mapping from conversation
            road_route_map = self._extract_road_route_mapping(history_to_use)
            if road_route_map:
                print(f"🗺️  Remembered mappings: {road_route_map}")
                # Check if question mentions any of these road names
                for road_name, route_id in road_route_map.items():
                    if road_name.lower() in question_lower:
                        print(f"✓ Recognized '{road_name}' as route {route_id} from conversation!")
                        # Inject route context into question for better understanding
                        question = f"{question} (route {route_id})"
            
            # STEP 1: Analyze intent (AI-powered)
            print("🧠 Analyzing intent...")
            intent = self.intent_analyzer.analyze(question)
            print(f"✓ Intent: {intent['query_type']} - {intent.get('reasoning', '')}")
            
            # CHECK: Is this a video defect query?
            if intent['query_type'] == 'video_defect_query':
                print("🎥 Video defect query detected")
                # Check if this chat has videos uploaded
                if chat_id and self._chat_has_videos(chat_id):
                    print("✓ Chat has videos - using RAG pipeline")
                    return self._handle_video_defect_query(question, history_to_use, chat_id)
                else:
                    print("⚠️  No videos in this chat - using normal query")
                    return "No videos have been uploaded to this chat yet. Upload a video first to ask about defects."
            
            # CHECK: Is this a video metadata query?
            if intent['query_type'] == 'video_metadata_query':
                print("📹 Video metadata query detected")
                if chat_id and self._chat_has_videos(chat_id):
                    return self._handle_video_metadata_query(question, history_to_use, chat_id)
                else:
                    return "No videos have been uploaded to this chat yet. Upload a video to get started!"
            
            # STEP 2: Process location if needed
            location_info = None
            if intent.get("needs_geocoding"):
                print("🌍 Processing location...")
                location_info = self.location_handler.process(intent)
                if location_info:
                    print(f"✓ Location: {location_info['query']}")
            
            # STEP 3: Generate MongoDB query
            print("🔄 Generating query...")
            query_spec = self.query_gen.generate(
                question,
                location_info,
                history_to_use
            )
            
            if not query_spec:
                return "Could not understand your question. Try asking about frames, videos, assets, roads, or surveys."
            
            print(f"📊 Query: {query_spec['collection']}.{query_spec['type']}")
            
            # STEP 4: Execute query
            print("⚙️  Executing query...")
            if query_spec["type"] == "find":
                results = self.db.find(query_spec["collection"], query_spec["query"])
            else:  # aggregate
                results = self.db.aggregate(query_spec["collection"], query_spec["query"])
            
            print(f"📈 Found {len(results)} results")
            
            # STEP 5: Generate answer
            print("✍️  Generating answer...")
            answer = self.answer_gen.generate(
                question,
                results,
                location_info,
                history_to_use,
                query_spec
            )
            
            # Add to history only if using internal history
            if update_internal:
                self.conversation_history.append({
                    "role": "assistant",
                    "content": answer,
                    "results_count": len(results),
                    "intent": intent['query_type']
                })
            
            return answer
        
        except Exception as e:
            print(f"❌ Chatbot error: {e}")
            import traceback
            traceback.print_exc()
            return f"Error: {str(e)}"
    
    def _answer_meta_question(self, question: str, history: list) -> str:
        """Answer questions about the conversation itself"""
        if not history or len(history) < 2:
            return "We haven't discussed any specific roads yet. Ask me about a route and I'll remember it!"
        
        # Extract route information from history
        import re
        routes_mentioned = []
        locations_mentioned = []
        
        for msg in history:
            # Find route numbers
            route_matches = re.findall(r'route\s+(\d+)', msg['content'], re.IGNORECASE)
            routes_mentioned.extend(route_matches)
            
            # Find location names (simple pattern - words starting with capital)
            location_matches = re.findall(r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b', msg['content'])
            if location_matches:
                locations_mentioned.extend(location_matches)
        
        if routes_mentioned:
            last_route = routes_mentioned[-1]
            unique_routes = list(dict.fromkeys(routes_mentioned))  # Remove duplicates, preserve order
            
            if len(unique_routes) == 1:
                return f"You're asking about route {last_route}. That's the route we've been discussing."
            else:
                return f"You've asked about routes: {', '.join(unique_routes)}. The most recent one is route {last_route}."
        
        # Check if they mentioned locations
        if locations_mentioned:
            relevant_locations = [loc for loc in locations_mentioned if len(loc) > 3]  # Filter short words
            if relevant_locations:
                return f"You mentioned: {', '.join(list(dict.fromkeys(relevant_locations))[:3])}. But I need a specific route number to give you accurate data."
        
        # Generic response
        return "I can see our conversation history, but I don't see any specific route numbers mentioned yet. Try asking about 'route 105' or another route number."
    
    def _chat_has_videos(self, chat_id: str) -> bool:
        """Check if a chat has any uploaded videos"""
        try:
            count = self.db.db.video_processing_results.count_documents({'chat_id': chat_id})
            return count > 0
        except Exception as e:
            print(f"Error checking chat videos: {e}")
            return False
    
    def _get_chat_videos(self, chat_id: str) -> list:
        """Get all videos for a specific chat"""
        try:
            videos = list(self.db.db.video_processing_results.find(
                {'chat_id': chat_id},
                {'video_id': 1, 'road_name': 1, 'road_section': 1, 'total_defects': 1, 'processing_date': 1}
            ))
            return videos
        except Exception as e:
            print(f"Error getting chat videos: {e}")
            return []
    
    def _handle_video_defect_query(self, question: str, history: list = None, chat_id: str = None) -> str:
        """Handle video defect queries using RAG pipeline"""
        try:
            print("🔍 Querying video defects with RAG...")
            video_rag = get_video_rag_handler()
            
            if video_rag is None:
                return "Video defect analysis is not available at the moment. Please ensure the video processing system is configured."
            
            # Query the video RAG system with chat isolation with chat isolation
            result = video_rag.query_defects(question, user_id=None, chat_id=chat_id, top_k=10)
            
            if not result.get('success'):
                error_msg = result.get('error', 'Unknown error')
                
                # If Milvus is empty, fallback to metadata query
                if 'No relevant defects found' in error_msg or 'collection is empty' in error_msg.lower():
                    print("⚠️ Milvus collection empty, falling back to video metadata query")
                    return self._handle_video_metadata_query(question, history, chat_id)
                
                return f"Error querying video defects: {error_msg}"
            
            answer = result.get('answer', 'No answer generated')
            num_sources = result.get('num_sources', 0)
            
            # Check if answer indicates no defects found (even though success=True)
            if num_sources == 0 or 'No defects found' in answer or '❌' in answer:
                print("⚠️ No defects in results, falling back to video metadata query")
                return self._handle_video_metadata_query(question, history, chat_id)
            
            if num_sources > 0:
                answer += f"\n\n📊 *Based on {num_sources} video defect records*"
            
            return answer
            
        except Exception as e:
            print(f"Error in video defect query: {e}")
            import traceback
            traceback.print_exc()
            return f"Error processing video defect query: {str(e)}"
    
    def _handle_video_metadata_query(self, question: str, history: list = None, chat_id: str = None) -> str:
        """Handle video metadata queries with intelligent Gemini responses"""
        try:
            print("📹 Querying video metadata...")
            
            # Query MongoDB for video processing results in this chat
            query = {'chat_id': chat_id} if chat_id else {}
            results = self.db.find('video_processing_results', query, limit=10)
            
            if not results:
                return "No videos have been processed yet. Upload a video to get started!"
            
            # Build context from video data
            video_context = self._build_video_context(results)
            
            # Generate intelligent response with Gemini
            return self._generate_video_metadata_answer(question, video_context, results)
            
        except Exception as e:
            print(f"Error in video metadata query: {e}")
            import traceback
            traceback.print_exc()
            return f"Error retrieving video information: {str(e)}"
    
    def _build_video_context(self, videos: list, include_individual_defects: bool = False) -> str:
        """Build detailed context from video data including detected assets"""
        context_parts = []
        
        for idx, video in enumerate(videos, 1):
            metadata = video.get('metadata', {})
            gps_start = metadata.get('gps_start', {})
            gps_end = metadata.get('gps_end', {})
            
            # Use type_distribution if available (more accurate), otherwise count from defects
            type_dist = video.get('type_distribution', {})
            if not type_dist:
                defects = video.get('defects', [])
                from collections import Counter
                type_dist = dict(Counter([d.get('asset_type', 'Unknown') for d in defects]))
            
            total_defects = video.get('total_defects', len(video.get('defects', [])))
            
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
            
            # Include individual defects with timestamps if requested
            if include_individual_defects:
                defects = video.get('defects', [])
                if defects:
                    context += "\n\nIndividual Defects (with timestamps):\n"
                    for defect in defects[:50]:  # Limit to first 50 to avoid token overflow
                        timestamp = defect.get('timestamp', 'N/A')
                        timestamp_sec = defect.get('timestamp_seconds', 'N/A')
                        asset_type = defect.get('asset_type', 'Unknown')
                        condition = defect.get('condition', 'Unknown')
                        context += f"  - {asset_type} ({condition}) at {timestamp} ({timestamp_sec}s)\n"
            
            context_parts.append(context.strip())
        
        return "\n\n".join(context_parts)
    
    def _generate_video_metadata_answer(self, question: str, video_context: str, videos: list) -> str:
        """Generate intelligent answer about video metadata using Gemini"""
        
        # Direct answers for simple questions (no need for Gemini)
        question_lower = question.lower()
        
        # Check if question is about timestamps/when defects occurred
        timestamp_keywords = ['when', 'timestamp', 'time', 'at what time', 'what time']
        needs_timestamps = any(kw in question_lower for kw in timestamp_keywords)
        
        # Check if asking for list of all defects/assets
        list_keywords = ['which defect', 'name of defect', 'list defect', 'what defect', 
                         'defect name', 'defects detected', 'list all', 'all assets', 
                         'types of defect', 'defect types', 'list assets', 'what assets']
        needs_list = any(phrase in question_lower for phrase in list_keywords)
        
        # Check if asking for a specific asset type (e.g., "timestamps for kerbs", "show me street lights")
        specific_asset = None
        if len(videos) == 1:
            video = videos[0]
            type_dist = video.get('type_distribution', {})
            
            # Try to match asset type from question
            for asset_type in type_dist.keys():
                # Check both with underscores and spaces, case-insensitive
                asset_variants = [
                    asset_type.lower(),
                    asset_type.replace('_', ' ').lower(),
                    asset_type.replace('_', '').lower()
                ]
                if any(variant in question_lower for variant in asset_variants):
                    specific_asset = asset_type
                    break
        
        if len(videos) == 1:
            total_defects = video.get('total_defects', 0)
            defects = video.get('defects', [])
            
            # Filter defects if specific asset type is requested
            filtered_defects = defects
            if specific_asset:
                filtered_defects = [d for d in defects if d.get('asset_type') == specific_asset]
            
            # Handle timestamp queries - provide individual defect timestamps with details
            if needs_timestamps and filtered_defects:
                if specific_asset:
                    asset_display = specific_asset.replace('_', ' ')
                    response = f"**Timestamps for {asset_display} ({len(filtered_defects)} detections):**\n\n"
                else:
                    response = f"**Timestamps of All {len(filtered_defects)} Detected Assets:**\n\n"
                
                # Group by timestamp for better readability
                from collections import defaultdict
                by_timestamp = defaultdict(list)
                for defect in filtered_defects:
                    ts = defect.get('timestamp', 'N/A')
                    asset = defect.get('asset_type', 'Unknown')
                    condition = defect.get('condition', 'Unknown')
                    confidence = defect.get('confidence', 0) * 100
                    by_timestamp[ts].append(f"{asset} ({condition}) - {confidence:.1f}% confidence")
                
                # Sort by timestamp
                for ts in sorted(by_timestamp.keys()):
                    assets = by_timestamp[ts]
                    response += f"**{ts}:**\n"
                    for asset in assets:
                        response += f"  • {asset}\n"
                    response += "\n"
                
                return response.strip()
            elif needs_timestamps and not filtered_defects and specific_asset:
                return f"No {specific_asset.replace('_', ' ')} detections found in the video."
            
            # Handle "list all" or "which defects" - show ALL or filtered by specific asset
            elif needs_list or specific_asset:
                if specific_asset and specific_asset in type_dist:
                    # User asking about specific asset type
                    count = type_dist[specific_asset]
                    asset_display = specific_asset.replace('_', ' ')
                    
                    response = f"**{asset_display}: {count} detected**\n\n"
                    
                    # Show conditions breakdown for this asset
                    conditions = {}
                    for defect in filtered_defects:
                        cond = defect.get('condition', 'Unknown')
                        conditions[cond] = conditions.get(cond, 0) + 1
                    
                    response += "**Condition Breakdown:**\n"
                    for cond, cnt in sorted(conditions.items(), key=lambda x: -x[1]):
                        response += f"  • {cond}: {cnt}\n"
                    
                    # Add sample locations/timestamps
                    if filtered_defects:
                        response += f"\n**Sample Detections:**\n"
                        for defect in filtered_defects[:5]:
                            ts = defect.get('timestamp', 'N/A')
                            cond = defect.get('condition', 'Unknown')
                            conf = defect.get('confidence', 0) * 100
                            response += f"  • {ts} - {cond} ({conf:.1f}% confidence)\n"
                        if len(filtered_defects) > 5:
                            response += f"\n*...and {len(filtered_defects) - 5} more*"
                    
                    return response.strip()
                    
                elif type_dist:
                    response = f"**All {total_defects} Detected Assets:**\n\n"
                    
                    # Sort by count (descending)
                    sorted_types = sorted(type_dist.items(), key=lambda x: -x[1])
                    
                    for asset_name, count in sorted_types:
                        # Format asset name nicely (replace underscores)
                        formatted_name = asset_name.replace('_', ' ')
                        response += f"• **{formatted_name}**: {count}\n"
                    
                    # Add severity breakdown if available
                    severity = video.get('severity_distribution', {})
                    if severity:
                        response += f"\n**Severity Breakdown:**\n"
                        for sev, count in severity.items():
                            icon = {'minor': '🟢', 'moderate': '🟡', 'severe': '🔴'}.get(sev, '⚪')
                            response += f"  {icon} {sev.capitalize()}: {count}\n"
                    
                    # Add category breakdown
                    categories = {}
                    for defect in defects:
                        cat = defect.get('category', 'Unknown')
                        categories[cat] = categories.get(cat, 0) + 1
                    
                    if categories:
                        response += f"\n**By Category:**\n"
                        for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
                            formatted_cat = cat.replace('_', ' ')
                            response += f"  • {formatted_cat}: {count}\n"
                    
                    return response.strip()
                else:
                    return f"Found {total_defects} defects, but detailed type information is not available."
            
            # Road name questions
            elif 'road' in question_lower and not needs_list:
                road = video.get('road_name', 'Unknown')
                section = video.get('road_section', '')
                if section and section != 'Unknown Section':
                    return f"The road surveyed is **{road}** (Section: {section})."
                return f"The road surveyed is **{road}**."
            
            # Date questions
            elif ('when' in question_lower or 'date' in question_lower) and not needs_timestamps:
                date = video.get('processing_date') or video.get('metadata', {}).get('survey_date', 'N/A')
                return f"The survey was conducted on {date}."
        
        # For complex questions or multiple videos, use Gemini
        prompt = f"""You are an AI assistant helping with road survey video analysis.

User Question: {question}

Available Video Data (FROM DATABASE):
{video_context}

CRITICAL INSTRUCTIONS:
1. **USE ONLY THE ACTUAL DATA FROM THE DATABASE ABOVE** - Do NOT make up or hallucinate any information
2. If they ask "which defects" or "name of defects", list ALL defects from "Defect Types" field with their counts
3. Format defect lists clearly with bullet points and counts
4. Do NOT invent defect names - only mention defects that appear in "Defect Types" data
5. Be specific with counts: show the exact number for each defect type
6. If they ask for road name, use the exact "Road:" value
7. Be concise and natural - don't dump all data unless asked
8. Use professional but friendly tone

**EXAMPLE for "which defects are detected":**
Data shows: Defect Types: {{'Bridge': 2, 'Bench': 3, 'CCTV': 1}}
Good answer: "The video detected:\n• Bridge: 2\n• Bench: 3\n• CCTV: 1"
Bad answer: "17 defects were detected" ❌ (NOT SPECIFIC ENOUGH)

Provide a clear, conversational answer using ONLY the actual database values:
"""
        
        try:
            response = self.intent_analyzer.client.models.generate_content(
                model=self.intent_analyzer.model,
                contents=prompt
            )
            return response.text.strip()
        except Exception as e:
            print(f"Error generating video metadata answer: {e}")
            # Fallback to simple answer
            if len(videos) == 1:
                video = videos[0]
                # Try to answer specific questions
                question_lower = question.lower()
                if 'road' in question_lower or 'name' in question_lower:
                    road = video.get('road_name', 'Unknown')
                    section = video.get('road_section', '')
                    if section and section != 'Unknown Section':
                        return f"The road surveyed is **{road}** (Section: {section})."
                    return f"The road surveyed is **{road}**."
                elif 'when' in question_lower or 'date' in question_lower:
                    return f"The survey was conducted on {video.get('processing_date', 'N/A')}."
                elif 'defect' in question_lower:
                    total = video.get('total_defects', 0)
                    types = video.get('type_distribution', {})
                    return f"Found **{total} defects**: {types}"
                
            # Generic fallback
            return video_context
            return f"Error retrieving video information: {str(e)}"
    
    def _extract_road_route_mapping(self, history: list) -> dict:
        """Extract road name → route_id mappings from conversation history"""
        if not history:
            return {}
        
        import re
        mappings = {}
        
        # Only look at assistant responses (where role='assistant')
        for msg in history:
            # Skip user messages - only process assistant answers
            if msg.get('role') == 'user':
                continue
                
            content = msg['content']
            
            # Find all route numbers in the message
            route_matches = re.findall(r'route\s+(\d+)', content, re.IGNORECASE)
            if not route_matches:
                continue
            
            # Pattern 1: "is named Al Corniche" or "is called Al Corniche"
            # Must have "route XXX" before it in the same sentence
            match = re.search(r'route\s+(\d+)\s+(?:is\s+)?(?:named|called)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)', content, re.IGNORECASE)
            if match:
                route_id = match.group(1)
                road_name = match.group(2).strip()
                # Filter out common words that aren't road names
                if road_name.lower() not in ['it', 'a', 'the', 'municipal', 'urban', 'road', 'street', 'point']:
                    mappings[road_name] = int(route_id)
                    print(f"📍 Learned: {road_name} = route {route_id}")
                continue
            
            # Pattern 2: Looking for "road on route XXX is named Al Corniche"
            match = re.search(r'route\s+(\d+).*?(?:is\s+named|named)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)', content, re.IGNORECASE)
            if match:
                route_id = match.group(1)
                road_name = match.group(2).strip()
                if road_name.lower() not in ['it', 'a', 'the', 'municipal', 'urban', 'road', 'street', 'point']:
                    mappings[road_name] = int(route_id)
                    print(f"📍 Learned: {road_name} = route {route_id}")
                continue
        
        return mappings
    
    def get_history(self) -> list:
        return self.conversation_history
    
    def clear_history(self):
        self.conversation_history = []
    
    def close(self):
        self.db.close()

# =============================================================================
# SINGLETON
# =============================================================================

_chatbot_instance = None

def get_chatbot() -> RoadRunnerChatbot:
    """Get or initialize singleton chatbot instance"""
    global _chatbot_instance
    if _chatbot_instance is None:
        _chatbot_instance = RoadRunnerChatbot()
    return _chatbot_instance
