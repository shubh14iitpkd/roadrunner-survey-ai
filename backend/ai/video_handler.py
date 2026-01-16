"""
Video RAG Handler - Integration layer between video processing pipeline and chatbot
Handles video upload, GPX extraction, defect detection, and querying
"""

import os
import json
import logging
from typing import Dict, List, Optional
from datetime import datetime
from pathlib import Path
from db import get_db
from bson import ObjectId

# Import video processing components
from ai.video import (
    RoadDefectProcessor,
    ProcessingConfig,
    VideoMetadata,
    VideoProcessor
)

# Import GPX extraction
import sys
backend_path = os.path.join(os.path.dirname(__file__), '..')
if backend_path not in sys.path:
    sys.path.append(backend_path)

from utils.extract_gpx import extract_gpx

logger = logging.getLogger(__name__)

class VideoRAGHandler:
    """Handles video processing and RAG integration for chatbot"""
    
    def __init__(self):
        """Initialize video RAG handler"""
        self.config = ProcessingConfig()
        self.processor = None
        
        # Initialize processor lazily (on first use)
        logger.info("VideoRAGHandler initialized")
    
    def _get_processor(self) -> RoadDefectProcessor:
        """Get or create processor instance"""
        if self.processor is None:
            self.processor = RoadDefectProcessor(self.config)
        return self.processor
    
    def process_video(
        self,
        video_path: str,
        video_id: str,
        road_name: str = "Unknown Road",
        road_section: str = "Unknown Section",
        surveyor: str = "Unknown",
        user_id: str = None,
        chat_id: str = None
    ) -> Dict:
        """
        Process video through complete RAG pipeline
        
        Args:
            video_path: Path to uploaded video file
            video_id: Unique identifier
            road_name: Name of the road
            road_section: Section/segment identifier
            surveyor: Name of surveyor
            user_id: User who uploaded the video
            chat_id: Optional chat ID to associate with this video
            
        Returns:
            Processing result dictionary
        """
        logger.info(f"Processing video: {video_id} for user {user_id}, chat {chat_id}")
        
        try:
            # Step 1: Extract GPX data from video
            logger.info(f"Extracting GPX data from {video_path}")
            gpx_path = extract_gpx(video_path)
            
            # Parse GPX to get GPS coordinates
            gps_start, gps_end = self._parse_gpx(gpx_path) if gpx_path else (None, None)
            
            # If no GPX data, use config defaults
            if not gps_start or not gps_end:
                logger.warning("No GPX data found, using default coordinates")
                gps_start = {'lat': self.config.gps_start_lat, 'lng': self.config.gps_start_lng}
                gps_end = {'lat': self.config.gps_end_lat, 'lng': self.config.gps_end_lng}
            
            # Step 2: Get video metadata
            fps, duration, total_frames, width, height = VideoProcessor.get_video_info(video_path)
            file_size_mb = os.path.getsize(video_path) / (1024 * 1024)
            
            metadata = VideoMetadata(
                video_id=video_id,
                video_path=video_path,
                road_name=road_name,
                road_section=road_section,
                surveyor=surveyor,
                survey_date=datetime.now().strftime('%Y-%m-%d'),
                gps_start=gps_start,
                gps_end=gps_end,
                duration_seconds=duration,
                fps=fps,
                total_frames=total_frames,
                width=width,
                height=height,
                file_size_mb=file_size_mb
            )
            
            # Step 3: Process video with defect detection pipeline
            processor = self._get_processor()
            result = processor.process_video(video_path, video_id, metadata, chat_id=chat_id)
            
            # Step 4: Store result in MongoDB
            db = get_db()
            processing_record = {
                'video_id': video_id,
                'user_id': ObjectId(user_id) if user_id else None,
                'chat_id': chat_id,
                'status': result.get('status'),
                'road_name': road_name,
                'road_section': road_section,
                'surveyor': surveyor,
                'total_defects': result.get('total_defects', 0),
                'severity_distribution': result.get('severity_distribution', {}),
                'type_distribution': result.get('type_distribution', {}),
                'defects': result.get('defects', []),
                'metadata': metadata.to_dict(),
                'processing_date': result.get('processing_date'),
                'timeline': result.get('timeline', {}),
                'created_at': datetime.now().isoformat()
            }
            
            db.video_processing_results.insert_one(processing_record)
            logger.info(f"✓ Video {video_id} processed successfully: {result.get('total_defects', 0)} defects found")
            
            # Save results to file
            results_dir = os.path.join(os.path.dirname(video_path), '..', 'results')
            os.makedirs(results_dir, exist_ok=True)
            results_file = os.path.join(results_dir, f"{video_id}_results.json")
            
            with open(results_file, 'w') as f:
                json.dump(result, f, indent=2)
            
            return {
                'success': True,
                'video_id': video_id,
                'status': result.get('status'),
                'total_defects': result.get('total_defects', 0),
                'severity_distribution': result.get('severity_distribution', {}),
                'type_distribution': result.get('type_distribution', {}),
                'processing_time': result.get('timeline', {}).get('total', 'N/A'),
                'results_file': results_file,
                'gpx_file': gpx_path
            }
            
        except Exception as e:
            logger.error(f"Error processing video {video_id}: {e}", exc_info=True)
            
            # Store error in database
            db = get_db()
            error_record = {
                'video_id': video_id,
                'user_id': ObjectId(user_id) if user_id else None,
                'status': 'failed',
                'error': str(e),
                'created_at': datetime.now().isoformat()
            }
            db.video_processing_results.insert_one(error_record)
            
            return {
                'success': False,
                'video_id': video_id,
                'status': 'failed',
                'error': str(e)
            }
    
    def query_defects(self, query: str, user_id: str = None, chat_id: str = None, top_k: int = 10) -> Dict:
        """
        Query processed video defects using RAG
        
        Args:
            query: Natural language query
            user_id: Optional user filter
            chat_id: Optional chat ID to filter results
            top_k: Number of results
            
        Returns:
            Query result dictionary
        """
        logger.info(f"Querying defects: {query} (user: {user_id}, chat: {chat_id})")
        
        try:
            processor = self._get_processor()
            result = processor.query_defects(query, chat_id=chat_id)
            
            return {
                'success': True,
                'query': query,
                'answer': result.get('answer'),
                'sources': result.get('sources', []),
                'num_sources': result.get('num_sources', 0)
            }
            
        except Exception as e:
            logger.error(f"Error querying defects: {e}", exc_info=True)
            return {
                'success': False,
                'query': query,
                'error': str(e)
            }
    
    def get_processing_status(self, video_id: str, user_id: str = None) -> Dict:
        """
        Get processing status of a video
        
        Args:
            video_id: Video identifier
            user_id: Optional user filter
            
        Returns:
            Status dictionary
        """
        try:
            db = get_db()
            
            query = {'video_id': video_id}
            if user_id:
                query['user_id'] = ObjectId(user_id)
            
            record = db.video_processing_results.find_one(
                query,
                sort=[('created_at', -1)]  # Get latest
            )
            
            if not record:
                return {
                    'found': False,
                    'video_id': video_id,
                    'status': 'not_found'
                }
            
            # Convert ObjectId to string
            if '_id' in record:
                record['_id'] = str(record['_id'])
            if 'user_id' in record and record['user_id']:
                record['user_id'] = str(record['user_id'])
            
            return {
                'found': True,
                'video_id': video_id,
                'status': record.get('status'),
                'total_defects': record.get('total_defects', 0),
                'severity_distribution': record.get('severity_distribution', {}),
                'type_distribution': record.get('type_distribution', {}),
                'processing_date': record.get('processing_date'),
                'timeline': record.get('timeline', {})
            }
            
        except Exception as e:
            logger.error(f"Error getting status for {video_id}: {e}")
            return {
                'found': False,
                'video_id': video_id,
                'status': 'error',
                'error': str(e)
            }
    
    def _parse_gpx(self, gpx_path: str) -> tuple:
        """
        Parse GPX file to extract start and end coordinates
        
        Args:
            gpx_path: Path to GPX file
            
        Returns:
            Tuple of (start_coords, end_coords) dictionaries
        """
        try:
            import xml.etree.ElementTree as ET
            
            tree = ET.parse(gpx_path)
            root = tree.getroot()
            
            # Find all trackpoints
            ns = {'gpx': 'http://www.topografix.com/GPX/1/1'}
            trackpoints = root.findall('.//gpx:trkpt', ns)
            
            if not trackpoints:
                # Try without namespace
                trackpoints = root.findall('.//trkpt')
            
            if not trackpoints or len(trackpoints) < 2:
                logger.warning(f"Not enough trackpoints in GPX file: {gpx_path}")
                return None, None
            
            # Get first and last points
            start_point = trackpoints[0]
            end_point = trackpoints[-1]
            
            start_coords = {
                'lat': float(start_point.get('lat')),
                'lng': float(start_point.get('lon'))
            }
            
            end_coords = {
                'lat': float(end_point.get('lat')),
                'lng': float(end_point.get('lon'))
            }
            
            logger.info(f"Parsed GPX: start={start_coords}, end={end_coords}")
            return start_coords, end_coords
            
        except Exception as e:
            logger.error(f"Error parsing GPX file {gpx_path}: {e}")
            return None, None
