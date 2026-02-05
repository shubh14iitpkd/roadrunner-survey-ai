"""
RoadRunner Database Schema Definition
Defines the structure of all collections for MongoDB queries
"""

# =============================================================================
# DATABASE CONFIGURATION
# =============================================================================

DB_NAME = "roadrunner"

# =============================================================================
# COLLECTION SCHEMAS
# =============================================================================

SCHEMA = {
    "frames": {
        "description": "Video frames extracted from road survey videos with computer vision detections. CRITICAL: 'detections' field can be either an Array (legacy) or an Object (new). Queries MUST check both paths using $or or generic structure.",
        "collection_name": "frames",
        "priority": "high",
        "key_fields": ["video_id", "route_id", "frame_number", "timestamp", "location"],
        "primary_intent": "Answer questions about what is visible on the road, object detection results, infrastructure presence. handle BOTH flat 'detections' array AND nested 'detections.lighting_endpoint_name' etc.",
        "when_to_use": [
            "User asks what objects are present in a frame or video",
            "User asks how many times an object appears",
            "User asks about detections on a route or survey",
            "User asks 'how many defects' → COUNT ALL DETECTIONS",
            "User asks where something is located",
            "User asks about confidence, bounding boxes, or AI detections"
        ],
        "fields": {
            "_id": "ObjectId - Unique frame identifier",
            "video_id": "String - Reference to parent video (HIGH priority)",
            "survey_id": "ObjectId - Reference to survey session",
            "route_id": "Integer - Road route number (HIGHEST priority)",
            "frame_number": "Integer - Sequential frame number",
            "timestamp": "Float - Time in video (seconds)",
            "frame_path": "String - Path to frame image",
            "detections": "Array OR Object - MIXED SCHEMA. Can be flat Array OR Object with keys: lighting_endpoint_name, pavement_endpoint_name, structures_endpoint_name, oia_endpoint_name, its_endpoint_name",
            "detections[].class_name": "String - Class name (Legacy Array)",
            "detections.lighting_endpoint_name[].class_name": "String - Lighting assets",
            "detections.pavement_endpoint_name[].class_name": "String - Pavement defects",
            "detections.structures_endpoint_name[].class_name": "String - Structure defects",
            "detections.oia_endpoint_name[].class_name": "String - Other assets",
            "detections.its_endpoint_name[].class_name": "String - ITS assets",
            "detections_count": "Integer - Total number of detections",
            "location": "GeoJSON - {type: 'Point', coordinates: [lng, lat]}",
            "altitude": "Float - Altitude data (nullable)",
            "gpx_timestamp": "Float - GPX timestamp",
            "created_at": "ISO String - Creation timestamp",
            "updated_at": "ISO String - Last update timestamp"
        },
        "query_patterns": {
            "count_detections": "How many [detection_type] on route [number]?",
            "find_frames": "Show me frames with [detection_type] from route [number]",
            "list_detections": "What detections are on frame [number]?"
        }
    },
    
    "videos": {
        "description": "Video survey files with metadata, lifecycle status, processing state, and annotated outputs. Bridge between raw data ingestion and analytical results.",
        "collection_name": "videos",
        "priority": "high",
        "key_fields": ["route_id", "survey_id", "title", "status"],
        "primary_intent": "Answer questions about video files, upload status, processing status, duration, storage locations, annotated videos, and category-wise outputs.",
        "when_to_use": [
            "User asks whether a video is uploaded, processing, or completed",
            "User asks for video duration, size, or progress",
            "User asks for video URL, thumbnail, or GPX file",
            "User asks for annotated video output",
            "User asks for category-wise annotated videos",
            "User asks which route or survey a video belongs to"
        ],
        "fields": {
            "_id": "ObjectId - Unique video identifier",
            "survey_id": "ObjectId - Reference to survey (HIGHEST priority)",
            "route_id": "Integer - Road route number (HIGHEST priority)",
            "title": "String - Video filename",
            "storage_url": "String - Path to video file (HIGH priority for access)",
            "thumbnail_url": "String - Path to thumbnail image",
            "gpx_file_url": "String - Path to GPS track file (HIGH priority)",
            "size_bytes": "Integer - Video file size in bytes",
            "duration_seconds": "Integer - Total video duration (HIGH priority)",
            "status": "String - Processing status (uploaded, processing, completed) (HIGHEST priority)",
            "progress": "Integer - Processing progress (0-100)",
            "eta": "String or Null - Estimated time to completion",
            "annotated_video_url": "String - Main annotated video output (HIGHEST priority)",
            "category_videos": "Object - Category-wise annotated videos (HIGH priority)",
            "category_videos.corridor_pavement": "String - Pavement defects video",
            "category_videos.corridor_structure": "String - Structure defects video",
            "category_videos.directional_signage": "String - Signage video",
            "category_videos.its": "String - Intelligent traffic systems video",
            "category_videos.roadway_lighting": "String - Lighting video",
            "category_videos.corridor_fence": "String - Fence video",
            "created_at": "ISO String - Upload timestamp",
            "updated_at": "ISO String - Last update timestamp"
        },
        "query_patterns": {
            "list_by_route": "What videos from route [number]?",
            "find_by_status": "Which videos are [status]?",
            "get_details": "Show video information for route [number]"
        }
    },
    
    "assets": {
        "priority": "medium",
        "description": "This collection stores individual detected road and roadside assets with their condition, confidence, and precise geographic location. It represents asset inventory data derived from surveys and detections, useful for condition monitoring, maintenance planning, and spatial asset queries.",
        "collection_name": "assets",
        "primary_intent": "Answer questions about specific assets, their type, category, condition, confidence level, and GPS location, as well as summaries of asset health across routes or surveys.",
        "when_to_use": [
            "User asks what assets were detected on a route or survey",
            "User asks for assets by type (e.g., manhole covers, poles, signs)",
            "User asks for asset condition (good, fair, poor)",
            "User asks where a particular asset is located",
            "User asks about confidence of detection",
            "User asks for asset inventory or maintenance-related queries"
        ],
        "fallback_to_gemini": True,
        "key_fields": ["route_id", "category", "type", "condition"],
        "fields": {
            "_id": {
                "meaning": "Unique identifier of the asset record",
                "use_for": "Internal reference",
                "search_priority": "low"
            },
            "route_id": {
                "meaning": "Route number where the asset was detected",
                "use_for": "Filtering assets by route",
                "search_priority": "highest"
            },
            "survey_id": {
                "meaning": "Survey identifier in which the asset was detected",
                "use_for": "Filtering assets by survey",
                "search_priority": "high"
            },
            "category": {
                "meaning": "High-level category of the asset (e.g., Utility Infrastructure)",
                "use_for": "Grouping assets into infrastructure domains",
                "search_priority": "high"
            },
            "type": {
                "meaning": "Specific asset type (e.g., Manhole Cover, Street Light, Signboard)",
                "use_for": "Identifying what asset is present",
                "search_priority": "highest"
            },
            "condition": {
                "meaning": "Condition of the asset (good, fair, poor)",
                "use_for": "Maintenance priority and health assessment",
                "search_priority": "highest"
            },
            "confidence": {
                "meaning": "AI confidence score for asset detection",
                "use_for": "Reliability evaluation and filtering",
                "search_priority": "medium"
            },
            "lat": {
                "meaning": "Latitude of the detected asset",
                "use_for": "Map visualization and spatial search",
                "search_priority": "highest"
            },
            "lng": {
                "meaning": "Longitude of the detected asset",
                "use_for": "Map visualization and spatial search",
                "search_priority": "highest"
            },
            "detected_at": {
                "meaning": "Timestamp when the asset was detected",
                "use_for": "Temporal queries and timeline analysis",
                "search_priority": "medium"
            },
            "description": {
                "meaning": "Human-readable description of the asset detection",
                "use_for": "Natural language explanation in responses",
                "search_priority": "medium"
            }
        },
        "condition_values": ["good", "damaged"],
        "example_categories": [
            "Traffic Signs", "Traffic Control", "Lighting", 
            "Barriers", "Signage", "Infrastructure", "Utility Infrastructure"
        ],
        "example_questions": [
            "What assets were detected on route 1?",
            "Show me all manhole covers in fair condition",
            "Where is the manhole cover detected?",
            "How confident is the detection of this asset?",
            "List all assets under Utility Infrastructure category",
            "Which assets are in poor condition and need attention?",
            "Give me the asset inventory for a specific survey"
        ],
        "response_style": {
            "tone": "Operational, asset-focused, maintenance-oriented",
            "include_location": True,
            "include_condition": True,
            "include_confidence": True,
            "prefer_database_over_gemini": True
        },
        "query_patterns": {
            "count_by_type": "How many [asset_type] on route [number]?",
            "filter_by_condition": "Assets in [condition] condition on route [number]?",
            "list_by_category": "Show me [category] assets",
            "count_by_condition": "Asset condition breakdown for route [number]?",
            "geospatial": "Assets near coordinates [lat], [lng]?"
        }
    },
    
    "roads": {
        "description": "Road network information with start/end points, characteristics, distance, and GPX reference. Provides contextual information to enrich answers with human-readable road details.",
        "collection_name": "roads",
        "priority": "medium",
        "key_fields": ["route_id", "road_name", "road_type"],
        "primary_intent": "Answer questions about road identity, names, route extents, road types, distances, and GPX source information.",
        "when_to_use": [
            "User asks for road name from a route ID",
            "User asks where a route starts or ends",
            "User asks about road type or side",
            "User asks for estimated road length",
            "User asks for GPX file location of a route"
        ],
        "fields": {
            "_id": "ObjectId - Unique road identifier",
            "route_id": "Integer - Unique road route number (e.g., 214, 108) (HIGHEST priority - join key)",
            "road_name": "String - Human-readable road name (e.g., Al Corniche) (HIGHEST priority)",
            "start_point_name": "String - Starting point name",
            "start_lat": "Float - Starting latitude",
            "start_lng": "Float - Starting longitude",
            "end_point_name": "String - Ending point name",
            "end_lat": "Float - Ending latitude",
            "end_lng": "Float - Ending longitude",
            "estimated_distance_km": "Float - Road length in kilometers (HIGH priority)",
            "road_type": "String - Type of road (Municipal/Urban Road, Highway, Main Road, Local Access Road) (HIGH priority)",
            "road_side": "String - Side of road surveyed (LHS=Left, RHS=Right)",
            "gpx_file_url": "String - Path to GPS track file (HIGH priority)",
            "created_at": "ISO String - Creation timestamp",
            "updated_at": "ISO String - Last update timestamp"
        },
        "query_patterns": {
            "get_distance": "What's the distance of route [number]?",
            "get_road_info": "Show road information for route [number]",
            "find_by_name": "What road is [road_name]?",
            "geospatial": "Roads near coordinates [lat], [lng]?"
        }
    },
    
    "surveys": {
        "description": "Survey session metadata with date, surveyor, versioning, status, and aggregated condition totals. Tracks survey history and progress.",
        "collection_name": "surveys",
        "priority": "medium",
        "key_fields": ["route_id", "survey_date", "status", "is_latest"],
        "primary_intent": "Answer questions about when a survey was conducted, who conducted it, its version, whether it is the latest survey, its status, and high-level asset condition summaries.",
        "when_to_use": [
            "User asks about survey date or surveyor",
            "User asks how many surveys exist for a route",
            "User asks which survey is the latest",
            "User asks survey status (uploaded, processing, completed)",
            "User asks overall asset condition summary",
            "User asks for GPX availability for a survey"
        ],
        "fields": {
            "_id": "ObjectId - Unique survey identifier",
            "route_id": "Integer - Road route number surveyed (HIGHEST priority)",
            "road_id": "String or ObjectId - Reference to road document (HIGH priority)",
            "survey_date": "String - Survey date (YYYY-MM-DD format) (HIGH priority)",
            "surveyor_name": "String - Name of surveyor",
            "survey_version": "Integer - Version number of survey for same route (HIGH priority)",
            "is_latest": "Boolean - Whether this is the most recent survey (HIGHEST priority)",
            "status": "String - Survey status (uploaded, processing, completed, etc.) (HIGHEST priority)",
            "totals": "Object - Aggregated condition summary of surveyed assets",
            "totals.total_assets": "Integer - Total number of assets inspected (HIGH priority)",
            "totals.good": "Integer - Count of assets in good condition",
            "totals.fair": "Integer - Count of assets in fair condition",
            "totals.poor": "Integer - Count of assets in poor condition (HIGH priority)",
            "gpx_file_url": "String or Null - GPS track file URL",
            "created_at": "ISO String - Survey record creation time",
            "updated_at": "ISO String - Last modification time"
        },
        "status_values": ["uploaded", "completed", "in_progress"],
        "query_patterns": {
            "get_status": "What's the survey status for route [number]?",
            "get_totals": "Asset totals for route [number]?",
            "list_completed": "Which surveys are completed?",
            "get_latest": "Latest survey information for route [number]?"
        }
    },
    
    "video_processing_results": {
        "description": "Final summarized intelligence of a processed video. Represents analytical outcome of AI processing including defect counts, severity distribution, defect types, per-defect spatial and temporal data, and survey metadata. HIGHEST priority collection for defect statistics and analysis.",
        "collection_name": "video_processing_results",
        "priority": "highest",
        "key_fields": ["video_id", "chat_id", "user_id", "status"],
        "primary_intent": "Answer questions about defect statistics, severity analysis, defect types, per-video summaries, defect locations, timestamps, GPS coordinates, and overall survey quality.",
        "when_to_use": [
            "User asks how many defects were found in a video",
            "User asks severity distribution (minor, moderate, severe)",
            "User asks what types of defects/assets were detected",
            "User asks where a defect is located geographically",
            "User asks defect details by timestamp",
            "User asks summary of a processed survey",
            "User asks processing status of a video",
            "User asks about video metadata like duration, FPS, resolution"
        ],
        "fields": {
            "_id": "ObjectId - Unique result identifier",
            "video_id": "String - Original video filename/ID (HIGHEST priority)",
            "user_id": "ObjectId - User who uploaded video",
            "chat_id": "String - Associated chat session",
            "status": "String - Processing status (completed, processing, failed) (HIGHEST priority)",
            "road_name": "String - Road name from video (HIGH priority)",
            "road_section": "String - Road section identifier",
            "surveyor": "String - Surveyor name",
            "total_defects": "Integer - Total number of defects detected (HIGHEST priority)",
            "severity_distribution": "Object - Count by severity {minor, moderate, severe} (HIGHEST priority)",
            "severity_distribution.minor": "Integer - Count of minor defects",
            "severity_distribution.moderate": "Integer - Count of moderate defects",
            "severity_distribution.severe": "Integer - Count of severe defects (HIGHEST priority for safety)",
            "type_distribution": "Object - Count by asset type {asset_type: count} (HIGH priority)",
            "defects": "Array - List of all detected defects/assets (HIGHEST priority)",
            "defects[].timestamp": "String - Timestamp in video (MM:SS format) (HIGH priority)",
            "defects[].timestamp_seconds": "Float - Timestamp in seconds (HIGH priority)",
            "defects[].category": "String - Asset category (Pavement, Roadway_Lighting, ITS, etc)",
            "defects[].asset_type": "String - Specific asset type (Kerb, STREET_LIGHT, Median, etc) (HIGHEST priority)",
            "defects[].condition": "String - Asset condition (Good, Unknown, Damaged, etc) (HIGH priority)",
            "defects[].confidence": "Float - Detection confidence (0-1)",
            "defects[].position": "String - Position in frame (center, left, right)",
            "defects[].estimated_size": "String - Bounding box size in pixels",
            "defects[].description": "String - Human-readable description",
            "defects[].source": "String - Detection source (sagemaker_yolo, gemini, etc)",
            "defects[].segment_id": "String - Video segment identifier",
            "defects[].bbox": "Object - Bounding box coordinates {x1, y1, x2, y2}",
            "defects[].gps_coords": "Object - GPS location {lat, lng, accuracy} (HIGH priority)",
            "defects[].chat_id": "String - Associated chat session",
            "defects[].defect_type": "String - Combined asset_type and condition",
            "defects[].severity": "String - Severity level (minor, moderate, severe)",
            "metadata": "Object - Video metadata (duration, fps, resolution, etc)",
            "metadata.video_id": "String - Video identifier",
            "metadata.video_path": "String - Path to video file",
            "metadata.road_name": "String - Road name",
            "metadata.road_section": "String - Road section",
            "metadata.surveyor": "String - Surveyor name",
            "metadata.survey_date": "String - Survey date",
            "metadata.gps_start": "Object - Starting GPS coordinates {lat, lng}",
            "metadata.gps_end": "Object - Ending GPS coordinates {lat, lng}",
            "metadata.duration_seconds": "Float - Video duration",
            "metadata.fps": "Float - Frames per second",
            "metadata.total_frames": "Integer - Total frame count",
            "metadata.width": "Integer - Video width in pixels",
            "metadata.height": "Integer - Video height in pixels",
            "metadata.file_size_mb": "Float - File size in MB",
            "metadata.chat_id": "String - Associated chat",
            "processing_date": "String or Null - Date processing completed",
            "timeline": "Object - Temporal distribution data",
            "created_at": "ISO String - Processing completion timestamp"
        },
        "query_patterns": {
            "list_defects": "Which defects detected? / List all assets / Name of defects",
            "count_by_type": "How many [asset_type] detected?",
            "timestamps": "When were defects detected? / Timestamps of all defects / At what time?",
            "by_severity": "Show severe defects / List moderate issues",
            "by_condition": "Which assets are damaged? / Show good condition items"
        }
    }
}

# =============================================================================
# DETECTION CLASSES (from frames collection)
# =============================================================================

DETECTION_CLASSES = {
    7: "Road markings",
    9: "Street lights",
    # Add other detection classes as needed
}

# =============================================================================
# ASSET CATEGORIES & TYPES (from assets collection)
# =============================================================================

ASSET_CATEGORIES = [
    "Artificial_Grass",
    "Bench",
    "Bike_Rack",
    "Bin",
    "Decorative_Fence",
    "Fitness_Equipment",
    "Flower_Bed",
    "Fountain",
    "Garden",
    "Gravel_Area",
    "Hedge",
    "Hoarding",
    "Interlock_Area",
    "Jogger_Track",
    "Kerbstone",
    "Landscape_Light",
    "Natural_Grass",
    "Planter_Pot",
    "Recessed_Light",
    "Road_Batter",
    "Sand_Area",
    "Tree",
    "Treeguard",
    "Directional_Structure_AssetCondition_Good",
    "Directional_Structure_AssetCondition_Damaged",
    "Gantry_Directional_Sign_AssetCondition_Good",
    "Gantry_Directional_Sign_AssetCondition_Damaged",
    "Street_Sign_AssetCondition_Good",
    "Street_Sign_AssetCondition_Damaged",
    "Pole_Directional_Sign_AssetCondition_Good",
    "Pole_Directional_Sign_AssetCondition_Damaged",
    "Traffic_Sign_AssetCondition_Good",
    "Traffic_Sign_AssetCondition_Damaged",
    "Traffic_Sign_AssetCondition_Dirty",
    "Traffic_Sign_AssetCondition_Overgrown",
    "AIR_QUALITY_MONITORING_SYSTEM_AQMS",
    "CLOSED_CIRCUIT_TELEVISION_CCTV",
    "DYNAMIC_MESSAGE_SIGN_DMS",
    "EMERGENCY_PHONE",
    "FIRE_EXTINGUISHER",
    "ITS_ENCLOSURE",
    "ITS_FEEDER_PILLAR",
    "ITS_STRUCTURE",
    "LANE_CONTROL_SIGNS_LCS",
    "OVER_HEIGHT_VEHICLE_DETECTION_SYSTEM_OVDS",
    "OVDS_SPEAKER",
    "ROAD_WEATHER_INFORMATION_SYSTEM_RWIS",
    "SMALL_DYNAMIC_MESSAGING_SIGN",
    "TRAFFIC_SIGNAL",
    "TRAFFIC_SIGNAL_FEEDER_PILLAR",
    "TRAFFIC_SIGNAL_HEAD",
    "TRAFFIC_SIGNAL_JUNCTION",
    "VEHICLE_RESTRAINT_SYSTEM",
    "AIR_QUALITY_MONITORING_SYSTEM_AQMS_AssetCondition_Good",
    "AIR_QUALITY_MONITORING_SYSTEM_AQMS_AssetCondition_Damaged",
    "DYNAMIC_MESSAGE_SIGN_DMS_AssetCondition_Good",
    "DYNAMIC_MESSAGE_SIGN_DMS_AssetCondition_Damaged",
    "DYNAMIC_MESSAGE_SIGN_DMS_AssetCondition_NoDisplay",
    "EMERGENCY_PHONE_AssetCondition_Good",
    "EMERGENCY_PHONE_AssetCondition_Damaged",
    "FIRE_EXTINGUISHER_AssetCondition_Fine",
    "FIRE_EXTINGUISHER_AssetCondition_Missing",
    "ITS_ENCLOSURE_AssetCondition_Visible",
    "ITS_FEEDER_PILLAR_AssetCondition_Good",
    "ITS_FEEDER_PILLAR_AssetCondition_Damaged",
    "ITS_STRUCTURE_AssetCondition_Good",
    "ITS_STRUCTURE_AssetCondition_Damaged",
    "LANE_CONTROL_SIGNS_LCS_AssetCondition_Good",
    "LANE_CONTROL_SIGNS_LCS_AssetCondition_Damaged",
    "LANE_CONTROL_SIGNS_LCS_AssetCondition_NoDisplay",
    "OVER_HEIGHT_VEHICLE_DETECTION_SYSTEM_OVDS_AssetCondition_Good",
    "OVER_HEIGHT_VEHICLE_DETECTION_SYSTEM_OVDS_AssetCondition_Damaged",
    "OVDS_SPEAKER_AssetCondition_Good",
    "OVDS_SPEAKER_AssetCondition_Damaged",
    "SMALL_DYNAMIC_MESSAGING_SIGN_AssetCondition_Good",
    "SMALL_DYNAMIC_MESSAGING_SIGN_AssetCondition_Damaged",
    "SMALL_DYNAMIC_MESSAGING_SIGN_AssetCondition_Display",
    "TRAFFIC_SIGNAL_AssetCondition_Good",
    "TRAFFIC_SIGNAL_AssetCondition_Damaged",
    "TRAFFIC_SIGNAL_FEEDER_PILLAR_AssetCondition_Good",
    "TRAFFIC_SIGNAL_FEEDER_PILLAR_AssetCondition_Damaged",
    "TRAFFIC_SIGNAL_HEAD_AssetCondition_Good",
    "TRAFFIC_SIGNAL_HEAD_AssetCondition_Damaged",
    "TRAFFIC_SIGNAL_JUNCTION_AssetCondition_Good",
    "VEHICLE_RESTRAINT_SYSTEM_AssetCondition_Good",
    "VEHICLE_RESTRAINT_SYSTEM_AssetCondition_Damaged",
    "Animal_Fence",
    "Animal_Grid",
    "Crash_Cushion",
    "Fence",
    "Guardrail",
    "Traffic_Bollard",
    "Animal_Fence_AssetCondition_Good",
    "Animal_Fence_AssetCondition_Damaged",
    "Animal_Fence_AssetCondition_MissingPanel",
    "Animal_Grid_AssetCondition_Good",
    "Animal_Grid_AssetCondition_Damaged",
    "Crash_Cushion_AssetCondition_Good",
    "Crash_Cushion_AssetCondition_Damaged",
    "Crash_Cushion_AssetCondition_Missing",
    "Fence_AssetCondition_Good",
    "Fence_AssetCondition_Damaged",
    "Fence_AssetCondition_Missing",
    "Guardrail_AssetCondition_Good",
    "Guardrail_AssetCondition_Damaged",
    "Traffic_Bollard_AssetCondition_Good",
    "Traffic_Bollard_AssetCondition_Missing",
    "Traffic_Bollard_AssetCondition_Broken",
    "Traffic_Bollard_AssetCondition_Bent",
    "STREET_LIGHT_FEEDER_PILLAR",
    "STREET_LIGHT",
    "STREET_LIGHT_POLE",
    "UNDERPASS_LUMINAIRE",
    "STREET_LIGHT_FEEDER_PILLAR_AssetCondition_Good",
    "STREET_LIGHT_FEEDER_PILLAR_AssetCondition_Damaged",
    "STREET_LIGHT_AssetCondition_Good",
    "STREET_LIGHT_AssetCondition_Damaged",
    "STREET_LIGHT_POLE_AssetCondition_Good",
    "STREET_LIGHT_POLE_AssetCondition_Damaged",
    "UNDERPASS_LUMINAIRE_AssetCondition_Good",
    "UNDERPASS_LUMINAIRE_AssetCondition_Damaged",
    "Bridge",
    "Cable_Bridge",
    "Camel_Crossing",
    "Culvert",
    "Flyover",
    "Footbridge",
    "Monument",
    "Overpass_OP_Only_Pedestrian",
    "Overpass_OV",
    "Pedestrian_Underpass",
    "Retaining_Wall",
    "Toll_Gate",
    "Tunnel",
    "Underpass",
    "Viaduct",
    "Bridge_AssetCondition_Good",
    "Bridge_AssetCondition_Damaged",
    "Cable_Bridge_AssetCondition_Good",
    "Cable_Bridge_AssetCondition_Damaged",
    "Camel_Crossing_AssetCondition_Good",
    "Camel_Crossing_AssetCondition_Damaged",
    "Culvert_AssetCondition_Good",
    "Culvert_AssetCondition_Damaged",
    "Flyover_AssetCondition_Good",
    "Flyover_AssetCondition_Damaged",
    "Footbridge_AssetCondition_Good",
    "Footbridge_AssetCondition_Damaged",
    "Monument_AssetCondition_Good",
    "Monument_AssetCondition_Damaged",
    "Overpass_OP_Only_Pedestrian_AssetCondition_Good",
    "Overpass_OP_Only_Pedestrian_AssetCondition_Damaged",
    "Overpass_OV_AssetCondition_Good",
    "Overpass_OV_AssetCondition_Damaged",
    "Pedestrian_Underpass_AssetCondition_Good",
    "Pedestrian_Underpass_AssetCondition_Damaged",
    "Retaining_Wall_AssetCondition_Good",
    "Retaining_Wall_AssetCondition_Damaged",
    "Toll_Gate_AssetCondition_Good",
    "Toll_Gate_AssetCondition_Damaged",
    "Tunnel_AssetCondition_Good",
    "Tunnel_AssetCondition_Damaged",
    "Underpass_AssetCondition_Good",
    "Underpass_AssetCondition_Damaged",
    "Viaduct_VerticalClearance_Good",
    "Viaduct_VerticalClearance_Damaged"
]

ASSET_TYPES = {
    "Pedestrian Crossing Sign": "Traffic Signs",
    "Countdown Timer": "Traffic Control",
    "Street Light": "Lighting",
    # Add as needed
}

# =============================================================================
# ROAD TYPES (from roads collection)
# =============================================================================

ROAD_TYPES = [
    "Municipal/Urban Road",
    "Highway",
    "Expressway",
    "Local Road"
]

# =============================================================================
# COLLECTION METADATA
# =============================================================================

COLLECTION_INFO = {
    "frames": {
        "primary_key": "_id",
        "indexes": ["route_id", "video_id", "timestamp"],
        "geospatial_index": "location"
    },
    "videos": {
        "primary_key": "_id",
        "indexes": ["route_id", "status", "survey_id"]
    },
    "assets": {
        "primary_key": "_id",
        "indexes": ["route_id", "category", "type", "condition"],
        "geospatial_index": ["lat", "lng"]
    },
    "roads": {
        "primary_key": "_id",
        "indexes": ["route_id", "road_name"],
        "geospatial_indexes": ["start_lat", "start_lng", "end_lat", "end_lng"]
    },
    "surveys": {
        "primary_key": "_id",
        "indexes": ["route_id", "status", "survey_date"]
    }
}

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def get_collection_schema(collection_name: str) -> dict:
    """Get schema for a specific collection"""
    return SCHEMA.get(collection_name, {})

def get_all_collections() -> list:
    """Get list of all collection names"""
    return list(SCHEMA.keys())

def get_field_description(collection_name: str, field_name: str) -> str:
    """Get description for a specific field"""
    collection = SCHEMA.get(collection_name, {})
    return collection.get("fields", {}).get(field_name, "Unknown field")

def validate_condition(condition: str) -> bool:
    """Validate asset condition value"""
    return condition in SCHEMA["assets"]["condition_values"]

def validate_road_type(road_type: str) -> bool:
    """Validate road type value"""
    return road_type in ROAD_TYPES

def validate_survey_status(status: str) -> bool:
    """Validate survey status value"""
    return status in SCHEMA["surveys"]["status_values"]

def get_asset_category(asset_type: str) -> str:
    """Get category for an asset type"""
    return ASSET_TYPES.get(asset_type, "Unknown")
