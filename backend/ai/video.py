#!/usr/bin/env python3
import os
import json
import time
import logging
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, asdict
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from dotenv import load_dotenv

# Load .env from backend directory (parent of ai/)
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

# Import your defects mappings
from ai.defects import CLASS_MAPPINGS

# Optional boto3 imports
try:
    import boto3
    from botocore.exceptions import ClientError
    BOTO3_AVAILABLE = True
except ImportError:
    BOTO3_AVAILABLE = False
    boto3 = None

# Offline mode for faster startup
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'

def generate_upload_url(video_name: str):
    s3_client = boto3.client('s3')
    bucket_name = "datanh11"
    object_key = f"video-rag-test/{video_name}"
    
    try:
        # Generate a presigned POST URL for the browser
        response = s3_client.generate_presigned_post(
            Bucket=bucket_name,
            Key=object_key,
            ExpiresIn=3600  # Valid for 1 hour
        )
        return response
    except ClientError as e:
        print(f"Error: {e}")
        return None

import cv2
import numpy as np
import base64
from io import BytesIO
from PIL import Image

# Optional imports
try:
    from google import genai
    from google.genai import types
    GOOGLE_AI_AVAILABLE = True
except ImportError:
    GOOGLE_AI_AVAILABLE = False

try:
    import vertexai
    from vertexai.generative_models import GenerativeModel, Part, GenerationConfig
    VERTEXAI_AVAILABLE = True
except ImportError:
    VERTEXAI_AVAILABLE = False

try:
    import weaviate
    from weaviate.classes.init import Auth
    from weaviate.classes.config import Configure, Property, DataType
    WEAVIATE_AVAILABLE = True
except ImportError:
    WEAVIATE_AVAILABLE = False

try:
    from sentence_transformers import SentenceTransformer
    SENTENCE_TRANSFORMERS_AVAILABLE = True
except ImportError:
    SENTENCE_TRANSFORMERS_AVAILABLE = False

logging.basicConfig(
    level=logging.WARNING,  # Changed from INFO to WARNING to reduce log verbosity
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ============================================================================
# CONFIGURATION
# ============================================================================

@dataclass
class ProcessingConfig:
    gcp_project_id: str = os.getenv('GCP_PROJECT_ID', '')
    gcp_region: str = os.getenv('GCP_REGION', 'us-central1')
    weaviate_collection: str = os.getenv('WEAVIATE_COLLECTION', 'RoadDefects')
    segment_duration: int = int(os.getenv('SEGMENT_DURATION', '60'))
    segment_overlap: int = int(os.getenv('SEGMENT_OVERLAP', '5'))
    parallel_workers: int = int(os.getenv('PARALLEL_WORKERS', '6'))
    gps_start_lat: float = float(os.getenv('GPS_START_LAT', '28.4595'))
    gps_start_lng: float = float(os.getenv('GPS_START_LNG', '77.0266'))
    gps_end_lat: float = float(os.getenv('GPS_END_LAT', '28.4612'))
    gps_end_lng: float = float(os.getenv('GPS_END_LNG', '77.0298'))
    road_name: str = os.getenv('ROAD_NAME', 'Unknown Road')
    road_section: str = os.getenv('ROAD_SECTION', 'Unknown Section')
    surveyor: str = os.getenv('SURVEYOR', 'Unknown')
    
    # SageMaker Multi-Endpoint Configuration (5 endpoints for parallel processing)
    sagemaker_endpoints: List[str] = None  # Will be set in __post_init__
    aws_region: str = os.getenv('AWS_REGION', 'ap-south-1')
    frame_interval: int = 30  # Process every 30th frame
    endpoint_workers: int = 8  # Workers per endpoint
    frame_batch_workers: int = 3  # Parallel frame batches
    
    def __post_init__(self):
        """Initialize multi-endpoint configuration"""
        if self.sagemaker_endpoints is None:
            self.sagemaker_endpoints = [
                os.getenv('PAVEMENT_ENDPOINT', 'pavement-yolo-serverless-endpoint-20260113-135153'),
                os.getenv('STRUCTURES_ENDPOINT', 'structures-yolo-serverless-endpoint-20260114-135901'),
                os.getenv('LIGHTING_ENDPOINT', 'roadway-lighting-yolo-serverless-endpoint-20260113-140110'),
                os.getenv('ITS_ENDPOINT', 'ITS-yolo-serverless-endpoint-20260113-134454'),
                os.getenv('OIA_ENDPOINT', 'OIA-yolo-serverless-endpoint-20260113-124102-20260113-132401')
            ]

# ============================================================================
# DATA MODELS - UPDATED WITH ASSET CATEGORIES
# ============================================================================

@dataclass
class Defect:
    timestamp: str
    timestamp_seconds: float
    category: str  # Directional_Signage, ITS, OIA, Pavement, etc.
    asset_type: str  # Kerb, Guardrail, Traffic_Sign, etc.
    condition: str  # Good, Damaged, Missing, etc.
    confidence: float
    position: str
    estimated_size: str
    description: str
    source: str
    segment_id: str
    bbox: Optional[Dict] = None
    gps_coords: Optional[Dict] = None
    chat_id: Optional[str] = None
    
    # Legacy compatibility
    @property
    def defect_type(self) -> str:
        """For backward compatibility"""
        if self.condition and self.condition != 'Unknown':
            return f"{self.asset_type}_{self.condition}"
        return self.asset_type
    
    @property
    def severity(self) -> str:
        """Map condition to severity - computed from condition"""
        if self.condition in ['Good', 'Fine', 'Visible']:
            return 'minor'
        elif self.condition in ['Damaged', 'Broken', 'Bent', 'Dirty', 'Overgrown']:
            return 'moderate'
        elif self.condition in ['Missing', 'NoDisplay', 'MissingPanel']:
            return 'severe'
        return 'moderate'
    
    def to_dict(self) -> Dict:
        d = asdict(self)
        d['defect_type'] = self.defect_type
        d['severity'] = self.severity
        return d

@dataclass
class VideoSegment:
    segment_id: str
    video_path: str
    start_time_sec: float
    end_time_sec: float
    start_frame: int
    end_frame: int
    fps: float
    
    @property
    def duration_sec(self) -> float:
        return self.end_time_sec - self.start_time_sec

@dataclass
class VideoMetadata:
    video_id: str
    video_path: str
    road_name: str
    road_section: str
    surveyor: str
    survey_date: str
    gps_start: Dict[str, float]
    gps_end: Dict[str, float]
    duration_seconds: float
    fps: float
    total_frames: int
    width: int
    height: int
    file_size_mb: float
    chat_id: Optional[str] = None
    
    def to_dict(self) -> Dict:
        return asdict(self)

# ============================================================================
# VIDEO PROCESSING
# ============================================================================

class VideoProcessor:
    @staticmethod
    def get_video_info(video_path: str) -> Tuple[float, float, int, int, int]:
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        duration_seconds = total_frames / fps if fps > 0 else 0
        cap.release()
        logger.info(f"📹 Video: {fps:.2f}fps, {duration_seconds:.2f}s, {width}x{height}")
        return fps, duration_seconds, total_frames, width, height
    
    @staticmethod
    def create_segments(video_path: str, num_segments: int = 5, overlap: int = 5) -> List[VideoSegment]:
        """Create segments dynamically based on number of available endpoints
        
        Args:
            video_path: Path to video file
            num_segments: Number of segments to create (matches endpoint count)
            overlap: Overlap between consecutive segments in seconds
            
        Returns:
            List of VideoSegment objects
            
        Formula: segment_duration = (video_duration + (num_segments - 1) * overlap) / num_segments
        This ensures optimal distribution across all endpoints with proper overlap.
        """
        fps, duration_seconds, total_frames, _, _ = VideoProcessor.get_video_info(video_path)
        
        # Calculate optimal segment duration to divide video evenly across endpoints
        segment_duration = (duration_seconds + (num_segments - 1) * overlap) / num_segments
        
        segments = []
        for segment_id in range(num_segments):
            # Calculate start time with overlap consideration
            if segment_id == 0:
                segment_start = 0.0
            else:
                # Start overlaps with previous segment
                segment_start = segment_id * segment_duration - segment_id * overlap
            
            # Calculate end time
            if segment_id == num_segments - 1:
                # Last segment goes to end of video
                segment_end = duration_seconds
            else:
                segment_end = segment_start + segment_duration
            
            # Ensure we don't exceed video duration
            segment_end = min(segment_end, duration_seconds)
            
            start_frame = int(segment_start * fps)
            end_frame = int(segment_end * fps)
            
            segment = VideoSegment(
                segment_id=f"seg_{segment_id:03d}",
                video_path=video_path,
                start_time_sec=segment_start,
                end_time_sec=segment_end,
                start_frame=start_frame,
                end_frame=end_frame,
                fps=fps
            )
            segments.append(segment)
            logger.debug(f"  {segment.segment_id}: {segment_start:.2f}s - {segment_end:.2f}s ({segment.duration_sec:.2f}s)")
        
        logger.info(f"✂️  Created {len(segments)} segments optimized for {num_segments} endpoints ({segment_duration:.1f}s avg, {overlap}s overlap)")
        return segments


def compress_video_for_upload(video_path: str, max_width: int = 1280) -> bytes:
    """Compress video to reduce upload time"""
    import cv2
    import tempfile
    
    cap = cv2.VideoCapture(video_path)
    fps = int(cap.get(cv2.CAP_PROP_FPS))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    
    # Calculate new dimensions
    if width > max_width:
        scale = max_width / width
        new_width = max_width
        new_height = int(height * scale)
    else:
        new_width = width
        new_height = height
    
    # Create temp file for compressed video
    temp_file = tempfile.NamedTemporaryFile(suffix='.mp4', delete=False)
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(temp_file.name, fourcc, fps, (new_width, new_height))
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if width > max_width:
            frame = cv2.resize(frame, (new_width, new_height))
        out.write(frame)
    
    cap.release()
    out.release()
    
    with open(temp_file.name, 'rb') as f:
        data = f.read()
    
    os.unlink(temp_file.name)
    return data

# ============================================================================
# SAGEMAKER YOLO DETECTOR
# ============================================================================

class SageMakerDetector:
    """Detect assets using multiple SageMaker YOLO endpoints with parallel processing"""
    
    def __init__(self, endpoints: List[str], region: str, frame_interval: int = 30, endpoint_workers: int = 8):
        self.endpoints = endpoints if endpoints else []
        self.region = region
        self.frame_interval = frame_interval
        self.endpoint_workers = endpoint_workers
        self.sagemaker_runtimes = {}  # One runtime client per endpoint
        self.endpoint_index = 0  # For round-robin distribution
        
        # Try to load from endpoint_config.json as fallback
        config_path = Path(__file__).parent.parent / "pipeline" / "endpoint_config.json"
        if config_path.exists() and not self.endpoints:
            try:
                with open(config_path, 'r') as f:
                    config = json.load(f)
                self.endpoints = [config.get('endpoint_name', 'pavement-yolo-serverless-endpoint-20260113-135153')]
                self.region = config.get('region', self.region)
                logger.info(f"📋 Loaded SageMaker config from file")
            except Exception as e:
                logger.warning(f"⚠️  Could not load endpoint config: {e}")
        
        # Initialize boto3 clients for all endpoints
        if not BOTO3_AVAILABLE:
            logger.warning("⚠️  boto3 not available. SageMaker disabled.")
            return
        
        if not self.endpoints:
            logger.warning("⚠️  No endpoints configured. SageMaker disabled.")
            return
            
        try:
            for endpoint in self.endpoints:
                runtime = boto3.client(
                    'sagemaker-runtime',
                    region_name=self.region,
                    aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
                    aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY')
                )
                self.sagemaker_runtimes[endpoint] = runtime
            
            logger.info(f"✅ SageMaker YOLO detector initialized with {len(self.endpoints)} endpoints:")
            for idx, endpoint in enumerate(self.endpoints, 1):
                endpoint_short = endpoint.split('-')[0]  # Extract category
                logger.info(f"   {idx}. {endpoint_short}: {endpoint}")
        except Exception as e:
            logger.error(f"❌ Failed to initialize SageMaker: {e}")
            self.sagemaker_runtimes = {}
    
    def get_endpoint_for_segment(self, segment_id: str) -> str:
        """Get endpoint for segment using round-robin distribution
        
        This distributes segments evenly across all available endpoints
        for maximum parallelization.
        """
        if not self.endpoints:
            return None
        
        # Round-robin: cycle through endpoints
        endpoint = self.endpoints[self.endpoint_index % len(self.endpoints)]
        self.endpoint_index += 1
        return endpoint
    
    def extract_frames_from_segment(self, segment: VideoSegment) -> List[Tuple[int, np.ndarray, float]]:
        """Extract frames from video segment at specified intervals
        
        Returns:
            List of (frame_number, frame_array, timestamp_seconds)
        """
        cap = cv2.VideoCapture(segment.video_path)
        cap.set(cv2.CAP_PROP_POS_FRAMES, segment.start_frame)
        
        frames = []
        current_frame = segment.start_frame
        
        while current_frame < segment.end_frame:
            ret, frame = cap.read()
            if not ret:
                break
            
            # Extract every Nth frame
            if (current_frame - segment.start_frame) % self.frame_interval == 0:
                timestamp = current_frame / segment.fps
                frames.append((current_frame, frame, timestamp))
                logger.debug(f"📸 Extracted frame {current_frame} at {timestamp:.2f}s")
            
            current_frame += 1
        
        cap.release()
        logger.info(f"📸 Extracted {len(frames)} frames from {segment.segment_id} (every {self.frame_interval}th frame)")
        return frames
    
    def detect_in_frame(self, frame: np.ndarray, endpoint_name: str) -> Dict:
        """Send single frame to SageMaker endpoint
        
        Args:
            frame: Frame to process
            endpoint_name: Specific endpoint to use
        
        Returns:
            Response dict with format: {'success': bool, 'detections': [...], 'total_count': int, 'summary': {...}}
        """
        if not self.sagemaker_runtimes or endpoint_name not in self.sagemaker_runtimes:
            return {'success': False, 'detections': [], 'total_count': 0, 'summary': {}}
        
        try:
            # Convert BGR to RGB
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            
            # Convert to PIL Image
            pil_image = Image.fromarray(frame_rgb)
            
            # Encode to base64 JPEG
            buffered = BytesIO()
            pil_image.save(buffered, format="JPEG", quality=85)
            img_base64 = base64.b64encode(buffered.getvalue()).decode()
            
            # Prepare payload
            payload = json.dumps({'image': img_base64})
            
            # Invoke SageMaker endpoint
            runtime = self.sagemaker_runtimes[endpoint_name]
            response = runtime.invoke_endpoint(
                EndpointName=endpoint_name,
                ContentType='application/json',
                Body=payload
            )
            
            # Parse response
            result = json.loads(response['Body'].read().decode())
            return result
            
        except Exception as e:
            logger.error(f"❌ SageMaker inference error: {e}")
            return {'success': False, 'detections': [], 'total_count': 0, 'summary': {}}
    
    def analyze_segment(self, segment: VideoSegment, endpoint_name: str = None) -> List[Defect]:
        """Analyze video segment using SageMaker YOLO
        
        Args:
            segment: Video segment to analyze
            endpoint_name: Specific endpoint to use (auto-assigned if None)
        
        Returns:
            List of Defect objects detected in segment
        """
        if not self.sagemaker_runtimes:
            logger.warning(f"⚠️  SageMaker not available for {segment.segment_id}")
            return []
        
        # Get endpoint for this segment (round-robin)
        if endpoint_name is None:
            endpoint_name = self.get_endpoint_for_segment(segment.segment_id)
        
        endpoint_short = endpoint_name.split('-')[0] if endpoint_name else 'unknown'
        logger.info(f"🔍 Analyzing {segment.segment_id} with [{endpoint_short}] endpoint...")
        
        # Extract frames
        frames = self.extract_frames_from_segment(segment)
        
        if not frames:
            logger.warning(f"⚠️  No frames extracted from {segment.segment_id}")
            return []
        
        # Process frames in parallel for faster inference
        all_detections = []
        
        def process_frame(frame_data):
            frame_number, frame, timestamp = frame_data
            result = self.detect_in_frame(frame, endpoint_name)
            frame_detections = []
            
            if result.get('success') and result.get('detections'):
                detections = result['detections']
                logger.info(f"✅ Frame {frame_number}: {len(detections)} detections")
                
                # Convert each detection to Defect object
                for det in detections:
                    defect = self._detection_to_defect(det, timestamp, segment)
                    frame_detections.append(defect)
            else:
                logger.debug(f"   Frame {frame_number}: No detections")
            
            return frame_detections
        
        # Use ThreadPoolExecutor for parallel processing (max 10 concurrent requests to avoid overwhelming endpoint)
        max_workers = min(10, len(frames))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            results = executor.map(process_frame, frames)
            for frame_detections in results:
                all_detections.extend(frame_detections)
        
        logger.info(f"✅ SageMaker found {len(all_detections)} total detections in {segment.segment_id}")
        return all_detections
    
    def _detection_to_defect(self, detection: Dict, timestamp: float, segment: VideoSegment) -> Defect:
        """Convert SageMaker detection to Defect object
        
        Detection format:
        {
            'box': [x1, y1, x2, y2],
            'confidence': float,
            'class': int,
            'class_name': str,  # e.g., 'STREET_LIGHT_POLE_AssetCondition_Good'
            'center': [x, y],
            'area': float
        }
        """
        class_name = detection.get('class_name', 'Unknown')
        confidence = detection.get('confidence', 0.0)
        
        # Parse class_name to extract category, asset_type, and condition
        # Format: CATEGORY_AssetCondition_Condition or CATEGORY_VerticalClearance_Value
        category = 'Unknown'
        asset_type = class_name
        condition = 'Unknown'
        
        if '_AssetCondition_' in class_name:
            parts = class_name.split('_AssetCondition_')
            asset_type = parts[0]
            condition = parts[1] if len(parts) > 1 else 'Unknown'
        elif '_VerticalClearance_' in class_name:
            parts = class_name.split('_VerticalClearance_')
            asset_type = parts[0]
            condition = f"Clearance_{parts[1]}" if len(parts) > 1 else 'Unknown'
        
        # Find category from CLASS_MAPPINGS
        for cat, assets in CLASS_MAPPINGS.items():
            if class_name in assets:
                category = cat
                break
        
        # Format timestamp
        ts_minutes = int(timestamp // 60)
        ts_seconds = int(timestamp % 60)
        timestamp_str = f"{ts_minutes:02d}:{ts_seconds:02d}"
        
        # Get bounding box for size estimation and store as dict
        bbox_data = detection.get('box', [])
        bbox_dict = None
        estimated_size = 'Unknown'
        if len(bbox_data) == 4:
            width = abs(bbox_data[2] - bbox_data[0])
            height = abs(bbox_data[3] - bbox_data[1])
            estimated_size = f"{int(width)}x{int(height)}px"
            bbox_dict = {
                'x1': bbox_data[0],
                'y1': bbox_data[1],
                'x2': bbox_data[2],
                'y2': bbox_data[3]
            }
        
        # Note: severity is a computed property based on condition, don't pass it
        return Defect(
            timestamp=timestamp_str,
            timestamp_seconds=timestamp,
            category=category,
            asset_type=asset_type,
            condition=condition,
            confidence=confidence,
            position='center',  # YOLO doesn't provide lane info
            estimated_size=estimated_size,
            description=f"{asset_type} detected via SageMaker YOLO with {confidence:.2%} confidence",
            source='sagemaker_yolo',
            segment_id=segment.segment_id,
            bbox=bbox_dict
        )

# ============================================================================
# GEMINI ANALYZER - UPDATED WITH FULL ASSET DETECTION
# ============================================================================

class GeminiAnalyzer:
    def __init__(self, project_id: str, region: str):
        self.project_id = project_id
        self.region = region
        self.model = None
        self.api_key = os.getenv('GEMINI_API_KEY')
        self.use_google_ai = False  # Track which API we're using
        
        logger.info(f"🔧 Initializing Gemini: GOOGLE_AI_AVAILABLE={GOOGLE_AI_AVAILABLE}, api_key={'set' if self.api_key else 'missing'}")
        
        # Prefer Google AI SDK (simpler, just needs API key)
        # REPLACE lines 170-195 in video.py with this:

        if GOOGLE_AI_AVAILABLE and self.api_key:
            try:
                # NEW SDK: Create client instead of configure
                self.client = genai.Client(api_key=self.api_key)
                self.model = "gemini-2.0-flash-exp"
                self.use_google_ai = True
                logger.info("✅ Gemini 2.0 Flash initialized (Google AI SDK)")
                return
            except Exception as e:
                logger.error(f"Google AI initialization failed: {e}")
                # Don't fallback to Vertex AI if we have an API key - it will fail anyway

        # Vertex AI fallback only if no API key was provided
        if VERTEXAI_AVAILABLE and project_id and not self.api_key:
            try:
                vertexai.init(project=project_id, location=region)
                self.model = GenerativeModel("gemini-2.0-flash-exp")
                self.use_google_ai = False
                logger.info("✅ Gemini 2.0 Flash initialized (Vertex AI)")
                return
            except Exception as e:
                logger.error(f"Vertex AI initialization failed: {e}")

        logger.warning("⚠️ Gemini not available. Using MOCK mode with realistic defects.")
        self.model = None
        self.client = None

    
    def _build_asset_detection_prompt(self) -> str:
        """Build comprehensive prompt from CLASS_MAPPINGS"""
        
        # Dynamically generate categories from CLASS_MAPPINGS
        categories_text = "ASSET CATEGORIES TO DETECT:\n\n"
        
        for idx, (category, assets) in enumerate(CLASS_MAPPINGS.items(), 1):
            categories_text += f"{idx}. {category.upper().replace('_', ' ')}:\n"
            
            # Extract base asset types (without conditions)
            base_assets = set()
            conditions = set()
            
            for asset_name in assets.keys():
                if '_AssetCondition_' in asset_name or '_VerticalClearance_' in asset_name:
                    # Extract condition
                    parts = asset_name.split('_AssetCondition_') if '_AssetCondition_' in asset_name else asset_name.split('_VerticalClearance_')
                    base_name = parts[0]
                    condition = parts[1] if len(parts) > 1 else 'Unknown'
                    base_assets.add(base_name)
                    conditions.add(condition)
                else:
                    base_assets.add(asset_name)
            
            # List assets
            if base_assets:
                assets_list = ", ".join(sorted(base_assets)[:10])  # Limit to 10 for brevity
                if len(base_assets) > 10:
                    assets_list += f", ... ({len(base_assets)} total)"
                categories_text += f"   Assets: {assets_list}\n"
            
            # List conditions
            if conditions:
                conditions_list = " | ".join(sorted(conditions))
                categories_text += f"   CONDITIONS: {conditions_list}\n"
            
            categories_text += "\n"
        
        return categories_text
    
    def analyze_segment(self, segment: VideoSegment, s3_object_key: str) -> List[Defect]:
            
            if self.model is None:
                return self._mock_analyze_segment(segment)
            
            logger.info(f"🔍 Analyzing {segment.segment_id} with Gemini...")
            
            try:
                # Check if file exists in S3 before attempting download
                s3_client = boto3.client('s3')
                try:
                    s3_client.head_object(Bucket='datanh11', Key=s3_object_key)
                except ClientError as e:
                    if e.response['Error']['Code'] == "404":
                        logger.error(f"❌ File {s3_object_key} not found in S3 bucket 'datanh11'")
                        return self._mock_analyze_segment(segment)
                    raise

                temp_path = f"/tmp/{segment.segment_id}.mp4"
                s3_client.download_file('datanh11', s3_object_key, temp_path)

                # 2. Upload to Gemini Files API (Fast on EC2)
                video_file = self.client.files.upload(file=temp_path)
                logger.info(f"Uploaded {segment.segment_id} to Gemini Files API: {video_file.name}, state: {video_file.state.name}")
                
                # Wait briefly for processing (usually < 5s for segments)
                max_wait = 30  # 30 second timeout
                wait_count = 0
                while video_file.state.name == "PROCESSING" and wait_count < max_wait:
                    time.sleep(1)
                    wait_count += 1
                    video_file = self.client.files.get(name=video_file.name)
                    logger.info(f"File {video_file.name} state: {video_file.state.name} (waited {wait_count}s)")
                
                if video_file.state.name != "ACTIVE":
                    raise ValueError(f"File {video_file.name} not ready after {max_wait}s. State: {video_file.state.name}")

                assets_info = self._build_asset_detection_prompt()
                prompt = f"""Analyze this {segment.duration_sec:.0f}-second road infrastructure survey video.

        {assets_info}

        CRITICAL: Output ONLY valid JSON. NO markdown, NO explanations.

        For EACH asset detected, provide:
        1. timestamp (MM:SS)
        2. category (Pavement/DirectionalSignage/ITS/OIA/Roadway_Lighting_Asset_Detection/Structures_Asset_Detection/Beautification)
        3. asset_type (exact asset name from list above)
        4. condition (Good/Damaged/Missing/Broken/etc.)
        5. position (left/center/right)
        6. size (XXcm x YYcm if applicable)
        7. confidence (0.0-1.0)
        8. description (brief observation)

        If NO defects/assets: {{"assets": []}}

        Example:
        {{"assets": [
        {{"timestamp": "00:05", "category": "Pavement", "asset_type": "Kerb", "condition": "Damaged", "position": "left", "size": "50cm section", "confidence": 0.87, "description": "Kerb showing visible cracks and chipping"}},
        {{"timestamp": "00:12", "category": "OIA", "asset_type": "Guardrail", "condition": "Good", "position": "right", "size": "NA", "confidence": 0.92, "description": "Guardrail in good condition"}}
        ]}}

        Analyze now."""
                
                # 3. Analyze using the File reference
                response = self.client.models.generate_content(
                    model=self.model,
                    contents=[video_file, prompt],
                    config=types.GenerateContentConfig(
                        temperature=0.1,
                        response_mime_type="application/json"
                    )
                )
                
                # Cleanup local temp file
                if os.path.exists(temp_path):
                    os.remove(temp_path)
                    
                analysis = json.loads(response.text)
                
                defects = []
                for asset_data in analysis.get("assets", []):
                    try:
                        ts_parts = asset_data["timestamp"].split(":")
                        ts_seconds = int(ts_parts[0]) * 60 + int(ts_parts[1])
                        global_ts = segment.start_time_sec + ts_seconds
                        
                        defects.append(Defect(
                            timestamp=f"{int(global_ts // 60):02d}:{int(global_ts % 60):02d}",
                            timestamp_seconds=global_ts,
                            category=asset_data.get("category", "Unknown"),
                            asset_type=asset_data.get("asset_type", "Unknown"),
                            condition=asset_data.get("condition", "Unknown"),
                            confidence=float(asset_data.get("confidence", 0.0)),
                            position=asset_data.get("position", "center"),
                            estimated_size=asset_data.get("size", "NA"),
                            description=asset_data.get("description", ""),
                            source="gemini",
                            segment_id=segment.segment_id
                        ))
                    except (KeyError, ValueError):
                        continue
                
                logger.info(f"✅ Found {len(defects)} assets in {segment.segment_id}")
                return defects
                
            except Exception as e:
                logger.error(f"Gemini error: {e}")
                return self._mock_analyze_segment(segment)

    
    def _mock_analyze_segment(self, segment: VideoSegment) -> List[Defect]:
        """Generate realistic mock defects using CLASS_MAPPINGS"""
        import random
        
        # Dynamically sample from CLASS_MAPPINGS
        mock_assets = []
        
        for category, assets in CLASS_MAPPINGS.items():
            # Extract base assets with their conditions
            asset_conditions = {}
            
            for asset_name in assets.keys():
                if '_AssetCondition_' in asset_name or '_VerticalClearance_' in asset_name:
                    parts = asset_name.split('_AssetCondition_') if '_AssetCondition_' in asset_name else asset_name.split('_VerticalClearance_')
                    base_name = parts[0]
                    condition = parts[1] if len(parts) > 1 else 'Good'
                    
                    if base_name not in asset_conditions:
                        asset_conditions[base_name] = []
                    asset_conditions[base_name].append(condition)
                else:
                    # Base asset without condition
                    if asset_name not in asset_conditions:
                        asset_conditions[asset_name] = ['Good', 'Damaged']
            
            # Add to mock assets (sample a few from each category)
            for asset_type, conditions in list(asset_conditions.items())[:3]:  # Limit per category
                mock_assets.append((category, asset_type, conditions))
        
        positions = ['left', 'center', 'right']
        num_assets = random.randint(2, 4)
        defects = []
        
        for i in range(num_assets):
            category, asset_type, conditions = random.choice(mock_assets)
            condition = random.choice(conditions)
            offset = random.uniform(2, segment.duration_sec - 2)
            global_ts = segment.start_time_sec + offset
            
            defect = Defect(
                timestamp=f"{int(global_ts // 60):02d}:{int(global_ts % 60):02d}",
                timestamp_seconds=global_ts,
                category=category,
                asset_type=asset_type,
                condition=condition,
                confidence=random.uniform(0.70, 0.95),
                position=random.choice(positions),
                estimated_size=f"{random.randint(10, 100)}cm section",
                description=f"Mock {asset_type} detected with {condition} condition",
                source='gemini_mock',
                segment_id=segment.segment_id
            )
            defects.append(defect)
        
        return defects

# ============================================================================
# FEATURE SYNTHESIS
# ============================================================================

class FeatureSynthesizer:
    @staticmethod
    def synthesize(gemini_defects: List[Defect], metadata: VideoMetadata, config: ProcessingConfig) -> List[Defect]:
        logger.info(f"🔗 Synthesizing {len(gemini_defects)} defects...")
        
        for defect in gemini_defects:
            defect.gps_coords = FeatureSynthesizer._interpolate_gps(defect.timestamp_seconds, metadata)
            defect.chat_id = metadata.chat_id
        
        synthesized = FeatureSynthesizer._deduplicate(gemini_defects)
        logger.info(f"✅ Synthesized {len(synthesized)} unique defects")
        return synthesized
    
    @staticmethod
    def _interpolate_gps(timestamp_seconds: float, metadata: VideoMetadata) -> Dict:
        if metadata.duration_seconds == 0:
            return metadata.gps_start.copy()
        
        progress = min(1.0, timestamp_seconds / metadata.duration_seconds)
        
        return {
            'lat': round(metadata.gps_start['lat'] + (metadata.gps_end['lat'] - metadata.gps_start['lat']) * progress, 6),
            'lng': round(metadata.gps_start['lng'] + (metadata.gps_end['lng'] - metadata.gps_start['lng']) * progress, 6),
            'accuracy': 'interpolated'
        }
    
    @staticmethod
    def _deduplicate(defects: List[Defect], time_threshold: float = 2.0) -> List[Defect]:
        if not defects:
            return []
        
        sorted_defects = sorted(defects, key=lambda d: d.timestamp_seconds)
        unique = []
        
        for defect in sorted_defects:
            is_duplicate = False
            for existing in unique:
                time_diff = abs(defect.timestamp_seconds - existing.timestamp_seconds)
                if (defect.asset_type == existing.asset_type and
                    defect.position == existing.position and
                    time_diff <= time_threshold):
                    is_duplicate = True
                    if defect.confidence > existing.confidence:
                        unique.remove(existing)
                        unique.append(defect)
                    break
            if not is_duplicate:
                unique.append(defect)
        
        return unique

# ============================================================================
# WEAVIATE VECTOR DATABASE
# ============================================================================

class DefectVectorDB:
    def __init__(self, collection_name: str = 'RoadDefects'):
        self.collection_name = collection_name
        self.client = None
        self.embedder = None
        
        if not WEAVIATE_AVAILABLE:
            logger.warning("⚠️  Weaviate not available. Vector DB disabled.")
            return
        
        if not SENTENCE_TRANSFORMERS_AVAILABLE:
            logger.warning("⚠️  sentence-transformers not available. Embeddings disabled.")
            return
        
        try:
            # Try connecting to existing instance first
            try:
                self.client = weaviate.connect_to_local(
                    host="localhost",
                    port=8079,
                    grpc_port=50050
                )
                logger.info("✅ Weaviate connected (existing instance)")
            except Exception:
                # Fall back to embedded if no instance running
                self.client = weaviate.connect_to_embedded(
                    version="1.27.0",
                    persistence_data_path="./weaviate_data"
                )
                logger.info("✅ Weaviate connected (embedded mode)")
            
            self.embedder = SentenceTransformer('all-mpnet-base-v2')
            self._ensure_collection()
        except Exception as e:
            logger.error(f"❌ Weaviate connection failed: {e}")
            self.client = None
            self.embedder = None
    
    def _ensure_collection(self):
        if self.client is None:
            return
        
        try:
            # Check if collection exists
            if self.client.collections.exists(self.collection_name):
                logger.info(f"✅ Collection exists: {self.collection_name}")
                return
            
            # Create collection with schema
            logger.info(f"📦 Creating collection: {self.collection_name}")
            self.client.collections.create(
                name=self.collection_name,
                properties=[
                    Property(name="defect_id", data_type=DataType.TEXT),
                    Property(name="video_id", data_type=DataType.TEXT),
                    Property(name="category", data_type=DataType.TEXT),
                    Property(name="asset_type", data_type=DataType.TEXT),
                    Property(name="condition", data_type=DataType.TEXT),
                    Property(name="severity", data_type=DataType.TEXT),
                    Property(name="position", data_type=DataType.TEXT),
                    Property(name="confidence", data_type=DataType.NUMBER),
                    Property(name="timestamp", data_type=DataType.TEXT),
                    Property(name="timestamp_seconds", data_type=DataType.NUMBER),
                    Property(name="lat", data_type=DataType.NUMBER),
                    Property(name="lng", data_type=DataType.NUMBER),
                    Property(name="description", data_type=DataType.TEXT),
                    Property(name="chat_id", data_type=DataType.TEXT),
                    Property(name="estimated_size", data_type=DataType.TEXT),
                ],
                vectorizer_config=Configure.Vectorizer.none()
            )
            logger.info(f"✅ Collection created: {self.collection_name}")
        except Exception as e:
            logger.error(f"❌ Collection setup failed: {e}")
    
    def index_defects(self, video_id: str, defects: List[Defect]) -> bool:
        if not defects:
            logger.warning("⚠️  No defects to index")
            return False
        
        if self.client is None or self.embedder is None:
            logger.warning("⚠️  Weaviate not available, skipping indexing")
            return False
        
        logger.info(f"💾 Indexing {len(defects)} defects to Weaviate...")
        
        try:
            collection = self.client.collections.get(self.collection_name)
            
            with collection.batch.dynamic() as batch:
                for idx, defect in enumerate(defects):
                    # Rich text for better embeddings
                    text = f"{defect.category} {defect.asset_type} {defect.condition} {defect.position} lane {defect.description}"
                    
                    embedding = self.embedder.encode(text, convert_to_numpy=True).tolist()
                    
                    properties = {
                        'defect_id': f"{video_id}_defect_{idx:04d}",
                        'video_id': video_id,
                        'category': defect.category,
                        'asset_type': defect.asset_type,
                        'condition': defect.condition,
                        'severity': defect.severity,
                        'position': defect.position,
                        'confidence': float(defect.confidence),
                        'timestamp': f"{defect.timestamp}",
                        'timestamp_seconds': float(defect.timestamp_seconds),
                        'lat': float(defect.gps_coords['lat']) if defect.gps_coords else 0.0,
                        'lng': float(defect.gps_coords['lng']) if defect.gps_coords else 0.0,
                        'description': defect.description,
                        'chat_id': defect.chat_id or '',
                        'estimated_size': defect.estimated_size
                    }
                    
                    batch.add_object(properties=properties, vector=embedding)
            
            logger.info(f"✅ Indexed {len(defects)} defects to Weaviate")
            return True
            
        except Exception as e:
            logger.error(f"❌ Indexing failed: {e}")
            return False
    
    def search(self, query: str, chat_id: Optional[str] = None, top_k: int = 10) -> List[Dict]:
        if self.client is None or self.embedder is None:
            logger.warning("⚠️  Weaviate not available")
            return []
        
        try:
            query_embedding = self.embedder.encode(query, convert_to_numpy=True).tolist()
            collection = self.client.collections.get(self.collection_name)
            
            # Build filter if chat_id provided
            filter_obj = None
            if chat_id:
                from weaviate.classes.query import Filter
                filter_obj = Filter.by_property("chat_id").equal(chat_id)
            
            response = collection.query.near_vector(
                near_vector=query_embedding,
                limit=top_k,
                filters=filter_obj,
                return_properties=[
                    'defect_id', 'video_id', 'category', 'asset_type', 'condition',
                    'severity', 'position', 'confidence', 'timestamp', 'timestamp_seconds',
                    'lat', 'lng', 'description', 'chat_id', 'estimated_size'
                ]
            )
            
            # Convert Weaviate response to list of dicts
            results = []
            for obj in response.objects:
                result = obj.properties.copy()
                result['distance'] = obj.metadata.distance if obj.metadata.distance else 0.0
                results.append(result)
            
            logger.info(f"🔍 Found {len(results)} results")
            return results
            
        except Exception as e:
            logger.error(f"❌ Search failed: {e}")
            return []

# ============================================================================
# RAG QUERY ENGINE
# ============================================================================

class RoadDefectRAG:
    def __init__(self, vector_db: DefectVectorDB):
        self.vector_db = vector_db
        self.model = None
        
        # Only try Vertex AI if we have a project ID and no API key fallback
        gemini_api_key = os.getenv('GEMINI_API_KEY')
        if VERTEXAI_AVAILABLE and os.getenv('GCP_PROJECT_ID') and not gemini_api_key:
            try:
                vertexai.init(project=os.getenv('GCP_PROJECT_ID'), location='us-central1')
                self.model = GenerativeModel('gemini-2.0-flash-exp')
                logger.info("✅ RAG with Gemini initialized")
            except Exception as e:
                logger.error(f"⚠️  RAG Gemini not available: {e}")
    
    def answer_question(self, question: str, chat_id: Optional[str] = None) -> Dict:
        logger.info(f"❓ Question: {question}")
        
        search_results = self.vector_db.search(question, chat_id=chat_id, top_k=10)
        
        if not search_results:
            return {
                'question': question,
                'answer': '❌ No relevant assets found in database.',
                'sources': [],
                'num_sources': 0
            }
        
        context = self._format_context(search_results)
        
        if self.model:
            answer = self._generate_with_llm(question, context)
        else:
            answer = self._generate_simple(question, search_results)
        
        return {
            'question': question,
            'answer': answer,
            'sources': [r.get('defect_id', r.get('id', 'unknown')) for r in search_results],
            'num_sources': len(search_results)
        }
    
    def _format_context(self, results: List[Dict]) -> str:
        lines = []
        for r in results:
            category = r.get('category', 'Unknown')
            asset = r.get('asset_type', 'unknown')
            condition = r.get('condition', 'unknown')
            timestamp = r.get('timestamp', '?')
            desc = r.get('description', '')[:80]
            line = f"- {category}: {asset} ({condition}) at {timestamp} - {desc}"
            lines.append(line)
        return "\n".join(lines)
    
    def _generate_with_llm(self, question: str, context: str) -> str:
        try:
            prompt = f"You are a road infrastructure expert. Q: {question}\n\nAssets found:\n{context}\n\nProvide professional concise answer:"
            response = self.model.generate_content(prompt)
            return response.text
        except Exception as e:
            return f"(Gemini error: {e})\n\n{context}"
    
    def _generate_simple(self, question: str, results: List[Dict]) -> str:
        """Generate intelligent summary without LLM"""
        
        # Analyze the data
        total = len(results)
        categories = {}
        asset_types = {}
        conditions = {}
        severities = {'minor': 0, 'moderate': 0, 'severe': 0}
        sources = {}
        
        for r in results:
            # Count by category
            cat = r.get('category', 'Unknown')
            categories[cat] = categories.get(cat, 0) + 1
            
            # Count by asset type
            asset = r.get('asset_type', 'unknown')
            asset_types[asset] = asset_types.get(asset, 0) + 1
            
            # Count by condition
            cond = r.get('condition', 'Unknown')
            conditions[cond] = conditions.get(cond, 0) + 1
            
            # Count by severity (computed property)
            sev = 'moderate'  # default
            if cond in ['Good', 'Fine', 'Visible']:
                sev = 'minor'
            elif cond in ['Missing', 'NoDisplay', 'MissingPanel']:
                sev = 'severe'
            severities[sev] = severities.get(sev, 0) + 1
            
            # Count by source
            src = r.get('source', 'unknown')
            sources[src] = sources.get(src, 0) + 1
        
        # Build intelligent answer
        answer = f"**Summary of {total} Detected Assets:**\n\n"
        
        # Categories breakdown
        answer += "**📂 By Category:**\n"
        for cat, count in sorted(categories.items(), key=lambda x: -x[1]):
            cat_display = cat.replace('_', ' ')
            answer += f"- {cat_display}: {count} assets\n"
        
        # Asset types breakdown (top 5)
        answer += f"\n**🔍 Top Asset Types:**\n"
        top_assets = sorted(asset_types.items(), key=lambda x: -x[1])[:5]
        for asset, count in top_assets:
            asset_display = asset.replace('_', ' ')
            answer += f"- {asset_display}: {count}\n"
        
        # Conditions breakdown
        answer += f"\n**⚠️  Condition Status:**\n"
        for cond, count in sorted(conditions.items(), key=lambda x: -x[1]):
            emoji = '✅' if cond == 'Good' else '⚠️' if cond == 'Unknown' else '❌'
            answer += f"- {emoji} {cond}: {count}\n"
        
        # Severity breakdown
        answer += f"\n**📊 Severity Distribution:**\n"
        answer += f"- 🟢 Minor: {severities['minor']}\n"
        answer += f"- 🟡 Moderate: {severities['moderate']}\n"
        answer += f"- 🔴 Severe: {severities['severe']}\n"
        
        # Detection source
        answer += f"\n**🤖 Detection Source:**\n"
        for src, count in sources.items():
            src_display = src.replace('_', ' ').title()
            answer += f"- {src_display}: {count}\n"
        
        # Sample detections
        answer += f"\n**📍 Sample Detections:**\n"
        for idx, r in enumerate(results[:3], 1):
            asset = r.get('asset_type', 'unknown').replace('_', ' ')
            cond = r.get('condition', 'unknown')
            ts = r.get('timestamp', '?')
            conf = r.get('confidence', 0) * 100
            answer += f"{idx}. {asset} ({cond}) at {ts} - {conf:.1f}% confidence\n"
        
        if total > 3:
            answer += f"\n*...and {total - 3} more assets*"
        
        return answer

# ============================================================================
# MAIN PIPELINE
# ============================================================================

class RoadDefectProcessor:
    def __init__(self, config: ProcessingConfig):
        self.config = config
        self.sagemaker = SageMakerDetector(
            config.sagemaker_endpoints, 
            config.aws_region, 
            config.frame_interval,
            config.endpoint_workers
        )
        self.gemini = GeminiAnalyzer(config.gcp_project_id, config.gcp_region)
        self.vector_db = DefectVectorDB(config.weaviate_collection)
        self.rag = RoadDefectRAG(self.vector_db)
        endpoint_count = len(config.sagemaker_endpoints) if config.sagemaker_endpoints else 0
        logger.info(f"✅ Pipeline initialized ({endpoint_count} SageMaker endpoints, Gemini fallback, {config.parallel_workers} segment workers)")
    
    def process_video(self, video_path: str, video_id: str, metadata: VideoMetadata, chat_id: Optional[str] = None) -> Dict:
        metadata.chat_id = chat_id
        
        start_time = time.time()
        logger.info(f"\n{'='*60}")
        logger.info(f"🎬 PROCESSING: {video_id}")
        logger.info(f"📍 Road: {metadata.road_name} ({metadata.road_section})")
        logger.info(f"{'='*60}")
        
        try:
            logger.info("\n[1/4] Creating segments...")
            # Use number of available endpoints for optimal segment division
            num_segments = len(self.config.sagemaker_endpoints) if self.config.sagemaker_endpoints else 5
            segments = VideoProcessor.create_segments(video_path, num_segments=num_segments, overlap=self.config.segment_overlap)
            
            logger.info(f"\n[2/4] Processing {len(segments)} segments...")
            all_defects = []
            
            # PRIMARY: Try SageMaker YOLO detection first
            logger.info(f"🎯 PRIMARY: Using {len(self.config.sagemaker_endpoints)} SageMaker endpoints for parallel detection...")
            sagemaker_defects = []
            
            if self.sagemaker.sagemaker_runtimes:
                with ThreadPoolExecutor(max_workers=self.config.parallel_workers) as executor:
                    futures = {
                        executor.submit(self.sagemaker.analyze_segment, segment): segment
                        for segment in segments
                    }
                    
                    for future in as_completed(futures):
                        defects = future.result()
                        sagemaker_defects.extend(defects)
                
                logger.info(f"✅ SageMaker YOLO: {len(sagemaker_defects)} detections")
                all_defects.extend(sagemaker_defects)
            else:
                logger.warning("⚠️  SageMaker not available, skipping...")
            
            # FALLBACK: Use Gemini if SageMaker found nothing or is unavailable
            if len(sagemaker_defects) == 0:
                logger.info("🔄 FALLBACK: No SageMaker detections, using Gemini video analysis...")
                filename = os.path.basename(video_path)
                s3_key = f"video-rag-test/{filename}"
                
                with ThreadPoolExecutor(max_workers=self.config.parallel_workers) as executor:
                    futures = {
                        executor.submit(self.gemini.analyze_segment, segment, s3_key): segment
                        for segment in segments
                    }
                    
                    for future in as_completed(futures):
                        defects = future.result()
                        all_defects.extend(defects)
                
                logger.info(f"✅ Gemini fallback: {len(all_defects)} detections")
            else:
                logger.info(f"✅ Using SageMaker results ({len(sagemaker_defects)} detections)")
            
            logger.info(f"✅ Total: {len(all_defects)} raw assets")
            
            logger.info("\n[3/4] Synthesizing results...")
            synthesized = FeatureSynthesizer.synthesize(all_defects, metadata, self.config)
            
            logger.info("\n[4/4] Saving to Weaviate...")
            self.vector_db.index_defects(video_id, synthesized)
            
            total_time = time.time() - start_time
            
            # Count by category
            category_distribution = {}
            for d in synthesized:
                category_distribution[d.category] = category_distribution.get(d.category, 0) + 1
            
            result = {
                'video_id': video_id,
                'status': 'completed',
                'total_defects': len(synthesized),
                'defects': [d.to_dict() for d in synthesized],
                'severity_distribution': self._count_severity(synthesized),
                'category_distribution': category_distribution,
                'type_distribution': self._count_type(synthesized),
                'processing_time_seconds': total_time,
                'chat_id': chat_id
            }
            
            logger.info(f"\n{'='*60}")
            logger.info(f"✅ COMPLETE")
            logger.info(f"📊 Assets: {len(synthesized)} | Time: {total_time:.2f}s")
            logger.info(f"📁 Categories: {category_distribution}")
            logger.info(f"{'='*60}\n")
            
            return result
            
        except Exception as e:
            logger.error(f"❌ Error: {e}", exc_info=True)
            return {'video_id': video_id, 'status': 'failed', 'error': str(e)}
    
    def query_defects(self, question: str, chat_id: Optional[str] = None) -> Dict:
        return self.rag.answer_question(question, chat_id=chat_id)
    
    def _count_severity(self, defects: List[Defect]) -> Dict[str, int]:
        counts = {'minor': 0, 'moderate': 0, 'severe': 0}
        for d in defects:
            counts[d.severity] = counts.get(d.severity, 0) + 1
        return counts
    
    def _count_type(self, defects: List[Defect]) -> Dict[str, int]:
        counts = {}
        for d in defects:
            counts[d.asset_type] = counts.get(d.asset_type, 0) + 1
        return counts