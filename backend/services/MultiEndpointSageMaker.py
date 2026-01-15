import boto3
import os
import json
import base64
import cv2
from pathlib import Path
from io import BytesIO
from PIL import Image
import concurrent.futures
from dotenv import load_dotenv
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
        self.frame_interval = config.get("frame_interval", 3)
    
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
        for future in concurrent.futures.as_completed(future_to_model):
            e_type = future_to_model[future]
            _, result = future.result()
            if result:
                det[e_type] = result.get("detections")
        return det

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

        print(f"[MULTI SAGEMAKER] Processing video: {video_id}|{video_path}, route_id: {route_id}")
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            print(f'[MULTI SAGEMAKER] Cannot open video: {video_path}')
        
        fps = int(cap.get(cv2.CAP_PROP_FPS))
        if fps == 0:
            raise ValueError(f"FPS is 0: {video_path}")

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        duration = total_frames / fps
        print(f"[MULTI SAGEMAKER] Video properties: {width}x{height}, {fps}fps, {total_frames} frames, {duration:.2f}s")

        frame_count = 0
        detections = []
        try: 
            while frame_count < total_frames:
                ret, frame = cap.read()
                if not ret:
                    break;

                timestamp = frame_count / fps

                if frame_count % self.frame_interval == 0:
                    det = self._get_frame_detections(frame)
                    print(det)
                    frame_doc = {
                        "frame_number": frame_count,
                        "timestamp": timestamp,
                        "detections": det
                    }
                    detections.append(frame_doc)
                frame_count += 1
            
            with open(f"{video_id}.json", 'w') as f:
                json.dump(detections, f)
            
            return {
                "video_id": video_id,
                "route_id": route_id,
                "survey_id": survey_id,
                "total_frames": total_frames,
                "fps": fps,
                "width": width,
                "height": height,
                "duration": duration,
                "detections": detections
            }
        except Exception as e:
            print(f"[MULTI SAGEMAKER] Error processing video: {video_path}, {str(e)}")
            return None



if __name__ == "__main__":
    mesm = MultiEndpointSageMaker()
    print(mesm.endpoints)
    mesm.check_endpoints_health()
    # mesm.process_video(video_id="1", video_path=Path("/home/ns/Code/roadvision/roadrunner-survey-ai/backend/in.mp4"), output_dir=Path("/home/ns/Code/roadvision/roadrunner-survey-ai/backend/out.mp4"))