import boto3
import os
import json
import base64
import cv2
import subprocess
import numpy as np
from pathlib import Path
from io import BytesIO
from PIL import Image
from typing import Dict, List, Tuple, Optional
import concurrent.futures
from dotenv import load_dotenv
from datetime import datetime
load_dotenv()

class MultiEndpointSageMaker:
    def __init__(self):
        self.endpoint_types = ["lighting","its","oia","pavement", "structures"]
        config = self._load_multi_endpoint_config()
        if not config:
            raise Exception("[MULTI SAGEMAKER] endpoint config not found")
        
        endpoints = {}
        for etype in self.endpoint_types:
            ekey = f"{etype}_endpoint_name"
            val = config.get(ekey)
            if not val:
                print(f"Endpoint for {etype} not found.")
            else:
                endpoints[ekey] = val
        if not endpoints:
            raise Exception("[MULTI SAGEMAKER] config doesn't have any endpoints for required types")

        self.endpoints = endpoints
        print(f"[SAGEMAKER] Found Endpoints: {self.endpoints}")

        self.region = config.get("region", "ap-south-1")
        self.sagemaker_runtime = boto3.client(
            'sagemaker-runtime',
            region_name=self.region,
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY")
        )

        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=min(7, len(self.endpoint_types)))
        self.frame_interval = config.get("frame_interval", 30)
    
    def _load_multi_endpoint_config(self) -> Optional[str]:
        curr_dir = Path(__file__).parent
        possible_paths = [
            curr_dir / "endpoint_config_multi.json",
            curr_dir.parent / "endpoint_config_multi.json",
            curr_dir.parent.parent / "endpoint_config_multi.json",
        ]


        for config_paths in possible_paths:
            if config_paths.exists():
                try:
                    with open(config_paths, 'r') as f:
                        config = json.load(f)
                        return config
                except Exception as e:
                    print(f"Error loading config from {config_paths}: {e}")
                    continue
    
    def check_endpoints_health(self):
        sm_client = boto3.client(
            'sagemaker',
            region_name=self.region,
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY")
        )
        for _, ep in self.endpoints.items():
            self.check_endpoint_health(ep, sm_client)

    
    def check_endpoint_health(self, ep, sm_client) -> Tuple[bool, str]:
        """
        Check if the SageMaker endpoint is healthy and in service.
        
        Returns:
            Tuple of (is_healthy, message)
        """
        if not ep:
            msg = f"Endpoint configuration is '{ep}'"
            print(f"[MULTI SAGEMAKER] Health check failed: {msg}")
            return False, msg
            
        if not self.sagemaker_runtime:
            msg = "AWS credentials not found or invalid (boto3 client failed to initialize)"
            print(f"[MULTI SAGEMAKER] Health check failed: {msg}")
            return False, msg
            
        try:
            if not sm_client:
                sm_client = boto3.client(
                    'sagemaker',
                    region_name=self.region,
                    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
                    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY")
                )
            response = sm_client.describe_endpoint(EndpointName=ep)
            status = response['EndpointStatus']
            
            if status == 'InService':
                msg = f"SageMaker endpoint '{ep}' is InService"
                print(f"[MULTI SAGEMAKER] {msg}")
                return True, msg
            else:
                msg = f"SageMaker endpoint  '{ep}' status is '{status}' (expected 'InService')"
                print(f"[MULTI SAGEMAKER] Health check failed: {msg}")
                return False, msg
                
        except Exception as e:
            msg = f"AWS Error: {str(e)}"
            print(f"[MULTI SAGEMAKER] Health check error: {msg}")
            return False, msg

    def _encode_frame(self, frame):
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        pil_image = Image.fromarray(frame_rgb)
        buffered = BytesIO()
        pil_image.save(buffered, format="JPEG", quality=85)
        img_base64 = base64.b64encode(buffered.getvalue()).decode()
        return json.dumps({'image': img_base64})

    def _invoke_single_endpoint(self, endpoint_name, payload):
        try:
            response = self.sagemaker_runtime.invoke_endpoint(
                EndpointName=endpoint_name,
                ContentType='application/json',
                Body=payload
            )

            results = json.loads(response['Body'].read().decode('utf-8'))
            if not results.get("success"): 
                print(results)
            return (endpoint_name, results)
        except Exception as e:
            msg = f"AWS Error: {str(e)}"
            print(f"[MULTI SAGEMAKER] Invoke endpoint error: {msg}")
            return None
        
    def _get_frame_detections(self, frame):
        payload = self._encode_frame(frame)

        future_to_model = {}
        for e_type, endpoint_name in self.endpoints.items():
            future_to_model[self.executor.submit(self._invoke_single_endpoint, endpoint_name, payload)] = e_type

        det = {}
        total = 0
        for future in concurrent.futures.as_completed(future_to_model):
            e_type = future_to_model[future]
            _, result = future.result()
            if result:
                det[e_type] = result.get("detections")
                total+=len(det[e_type])
        return det, total

    def process_video(
        self,
        video_path: Path,
        output_dir: Path,
        video_id: str,
        route_id: int = None,
        survey_id: str = None,
        db = None,
        progress_callback: callable = None
    ) -> Dict:
        """
        Process video with SageMaker endpoints, create annotated video, and save metadata.
        """
        # Create output directories
        frames_identifier = f"route_{route_id}" if route_id is not None else video_id
        frames_dir = output_dir / "frames" / frames_identifier / video_id
        frames_dir.mkdir(parents=True, exist_ok=True)

        annotated_videos_dir = output_dir / "annotated_videos"
        annotated_videos_dir.mkdir(parents=True, exist_ok=True)

        metadata_dir = output_dir / "metadata"
        metadata_dir.mkdir(parents=True, exist_ok=True)

        print(f"[MULTI SAGEMAKER] Processing video: {video_id}|{video_path}, route_id: {route_id}")
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise ValueError(f'Cannot open video: {video_path}')
        
        fps = int(cap.get(cv2.CAP_PROP_FPS))
        if fps == 0:
            raise ValueError(f"FPS is 0: {video_path}")

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        duration = total_frames / fps
        print(f"[MULTI SAGEMAKER] Video properties: {width}x{height}, {fps}fps, {total_frames} frames, {duration:.2f}s")

        # Setup FFmpeg for annotated video output
        output_video_path = annotated_videos_dir / f"{video_id}_annotated.mp4"
        ffmpeg_cmd = [
            'ffmpeg', '-y', '-f', 'rawvideo', '-vcodec', 'rawvideo',
            '-s', f'{width}x{height}', '-pix_fmt', 'bgr24', '-r', str(fps),
            '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            '-preset', 'medium', '-f', 'mp4', str(output_video_path)
        ]
        try:
            ffmpeg_process = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
        except Exception as e:
            print(f"[MULTI SAGEMAKER] Error starting FFmpeg: {e}")
            raise

        frame_count = 0
        processed_count = 0
        detections_list = []
        frame_metadata = []

        try: 
            while frame_count < total_frames:
                ret, frame = cap.read()
                if not ret:
                    break

                timestamp = frame_count / fps

                if frame_count % self.frame_interval == 0:
                    det, det_count = self._get_frame_detections(frame)
                    
                    # Flatten detections for drawing and storage
                    flat_detections = self._flatten_detections(det)
                    
                    # Draw annotations on frame
                    annotated_frame = self.draw_detections(frame.copy(), flat_detections)

                    # Save annotated frame as image
                    frame_filename = f"frame_{frame_count:06d}_{timestamp:.2f}s.jpg"
                    frame_path = frames_dir / frame_filename
                    cv2.imwrite(str(frame_path), annotated_frame)

                    # Store frame metadata
                    relative_frame_path = f"frames/{frames_identifier}/{video_id}/{frame_filename}"
                    frame_doc = {
                        "frame_number": frame_count,
                        "timestamp": timestamp,
                        "frame_path": relative_frame_path,
                        "detections": det,  # Keep original structure with endpoint types
                        "detections_count": det_count
                    }
                    frame_metadata.append(frame_doc)

                    # Store frame in MongoDB
                    if db is not None:
                        mongo_frame_doc = {
                            "video_id": video_id,
                            "route_id": route_id,
                            "survey_id": survey_id,
                            "frame_number": frame_count,
                            "timestamp": timestamp,
                            "frame_path": f"/uploads/{relative_frame_path}",
                            "detections": det,
                            "detections_count": det_count,
                            "created_at": datetime.utcnow().isoformat()
                        }
                        try:
                            db.frames.insert_one(mongo_frame_doc)
                        except Exception as e:
                            print(f"[MULTI SAGEMAKER] Warning: Failed to store frame in MongoDB: {e}")

                    # Write annotated frame to output video
                    try:
                        ffmpeg_process.stdin.write(annotated_frame.tobytes())
                    except Exception as e:
                        print(f"[MULTI SAGEMAKER] Error writing frame to FFmpeg: {e}")

                    detections_list.extend(flat_detections)
                    processed_count += 1

                    if progress_callback:
                        progress = int((frame_count / total_frames) * 100)
                        progress_callback(progress, f"Processing frame {frame_count}/{total_frames}")
                else:
                    # Write original frame to output video
                    try:
                        ffmpeg_process.stdin.write(frame.tobytes())
                    except Exception as e:
                        print(f"[MULTI SAGEMAKER] Error writing frame to FFmpeg: {e}")

                frame_count += 1

        finally:
            cap.release()
            if 'ffmpeg_process' in locals():
                ffmpeg_process.stdin.close()
                ffmpeg_process.wait()
                if ffmpeg_process.returncode != 0:
                    print(f"[MULTI SAGEMAKER] FFmpeg exited with error code: {ffmpeg_process.returncode}")

        # Save frame metadata as JSON
        metadata_path = metadata_dir / f"{video_id}_frame_metadata.json"
        with open(metadata_path, 'w') as f:
            json.dump(frame_metadata, f, indent=2)

        print(f"[MULTI SAGEMAKER] Processing complete!")
        print(f"[MULTI SAGEMAKER] Processed {processed_count} frames, Annotated video: {output_video_path}")

        return {
            "video_id": video_id,
            "route_id": route_id,
            "survey_id": survey_id,
            "total_frames": total_frames,
            "processed_frames": processed_count,
            "fps": fps,
            "width": width,
            "height": height,
            "duration": duration,
            "annotated_video_path": str(output_video_path.relative_to(output_dir.parent)),
            "frames_directory": str(frames_dir.relative_to(output_dir.parent)),
            "frame_metadata_path": str(metadata_path.relative_to(output_dir.parent)),
            "total_detections": len(detections_list),
            "detections_summary": self._summarize_detections(detections_list)
        }

    def _flatten_detections(self, det: Dict) -> List[Dict]:
        """
        Flatten multi-endpoint detections into a single list for drawing.
        
        Args:
            det: Dictionary with endpoint types as keys and list of detections as values
            
        Returns:
            Flat list of detections
        """
        flat = []
        for endpoint_type, detections in det.items():
            if detections:
                for d in detections:
                    flat.append({**d, "source_endpoint": endpoint_type})
        return flat

    def draw_detections(self, frame: np.ndarray, detections: List[Dict]) -> np.ndarray:
        """
        Draw detection bounding boxes and labels on frame.
        """
        class_colors = {}
        default_colors = [
            (0, 255, 0), (255, 0, 0), (0, 0, 255),
            (255, 255, 0), (255, 0, 255), (0, 255, 255),
        ]

        for detection in detections:
            bbox = detection.get('bbox', {})
            class_name = detection.get('class_name', 'unknown')
            confidence = detection.get('confidence', 0.0)

            if not isinstance(bbox, dict):
                continue

            x1, y1 = int(bbox.get('x1', 0)), int(bbox.get('y1', 0))
            x2, y2 = int(bbox.get('x2', 0)), int(bbox.get('y2', 0))

            if class_name not in class_colors:
                class_colors[class_name] = default_colors[len(class_colors) % len(default_colors)]
            color = class_colors[class_name]

            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 3)

            label = f"{class_name}: {confidence:.2f}"
            font, font_scale, thickness = cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2
            (label_w, label_h), baseline = cv2.getTextSize(label, font, font_scale, thickness)
            cv2.rectangle(frame, (x1, y1 - label_h - baseline - 10), (x1 + label_w + 10, y1), color, -1)
            cv2.putText(frame, label, (x1 + 5, y1 - baseline - 5), font, font_scale, (255, 255, 255), thickness)

        return frame

    def _summarize_detections(self, detections: List[Dict]) -> Dict:
        """Summarize detections by class name."""
        summary = {}
        for det in detections:
            class_name = det.get('class_name', 'unknown')
            summary[class_name] = summary.get(class_name, 0) + 1
        return summary

    def link_frames_to_gpx(
        self,
        frame_metadata_path: Path,
        gpx_data: List[Dict],
        video_id: str = None,
        db = None
    ) -> List[Dict]:
        """
        Link video frames to GPX coordinates based on timestamps.
        """
        print(f"[MULTI SAGEMAKER] Linking frames to GPX data")

        with open(frame_metadata_path, 'r') as f:
            frames = json.load(f)

        linked_frames = []
        for frame in frames:
            timestamp = frame['timestamp']
            closest_gpx = min(gpx_data, key=lambda p: abs(p.get('timestamp', 0) - timestamp))

            linked_frame = {
                **frame,
                "lat": closest_gpx.get('lat'),
                "lon": closest_gpx.get('lon'),
                "altitude": closest_gpx.get('altitude'),
                "gpx_timestamp": closest_gpx.get('timestamp')
            }
            linked_frames.append(linked_frame)

            if db is not None and video_id:
                try:
                    db.frames.update_one(
                        {"video_id": video_id, "frame_number": frame['frame_number']},
                        {"$set": {
                            "location": {
                                "type": "Point",
                                "coordinates": [closest_gpx.get('lon'), closest_gpx.get('lat')]
                            },
                            "altitude": closest_gpx.get('altitude'),
                            "gpx_timestamp": closest_gpx.get('timestamp'),
                            "updated_at": datetime.utcnow().isoformat()
                        }}
                    )
                except Exception as e:
                    print(f"[MULTI SAGEMAKER] Warning: Failed to update frame GPS in MongoDB: {e}")

        print(f"[MULTI SAGEMAKER] Linked {len(linked_frames)} frames to GPS coordinates")
        return linked_frames


# if __name__ == "__main__":
#     mesm = MultiEndpointSageMaker()
#     print(mesm.endpoints)
#     mesm.check_endpoints_health()
#     mesm.process_video(video_id="1", video_path=Path("/home/ns/Code/roadvision/roadrunner-survey-ai/backend/in.mp4"), output_dir=Path("/home/ns/Code/roadvision/roadrunner-survey-ai/backend/out.mp4"))