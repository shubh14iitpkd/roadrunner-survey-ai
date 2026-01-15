"""
Video Processing Service - Local Version
Processes videos using SageMaker YOLO endpoint and creates annotated videos
with multithreading support for faster processing
"""

import os
import json
import base64
import time
import cv2
from io import BytesIO
from PIL import Image
import boto3
import sagemaker
from sagemaker.predictor import Predictor
from sagemaker.serializers import JSONSerializer
from sagemaker.deserializers import JSONDeserializer
import concurrent.futures
from typing import Tuple, Dict, Optional, Callable


class VideoProcessor:
    """Process videos with YOLO model on SageMaker using multithreading"""

    def __init__(self, endpoint_name: str = None, region: str = None, 
                 config_file: str = "endpoint_config.json"):
        """
        Initialize the video processor with endpoint configuration
        
        Args:
            endpoint_name: SageMaker endpoint name (optional, will try to load from config)
            region: AWS region (optional, will try to load from config)
            config_file: Path to endpoint config JSON file
        """
        # Try to load from config file first
        if os.path.exists(config_file):
            try:
                with open(config_file, 'r') as f:
                    config = json.load(f)
                self.endpoint_name = config.get('endpoint_name', endpoint_name)
                self.region = config.get('region', region)
                print(f"✓ Loaded config from {config_file}")
            except Exception as e:
                print(f"Warning: Could not load config file: {e}")
                self.endpoint_name = endpoint_name
                self.region = region
        else:
            self.endpoint_name = endpoint_name
            self.region = region

        # Fallback to defaults if still not set
        if not self.endpoint_name:
            self.endpoint_name = "yolo-v8-endpoint"
            print(f"Using default endpoint name: {self.endpoint_name}")
        
        if not self.region:
            self.region = "ap-south-1"
            print(f"Using default region: {self.region}")

        # Processing parameters
        self.frame_interval = 3  # Process every 3rd frame
        self.confidence_threshold = 0.25
        self.max_workers = 10  # Number of parallel threads for inference

        # Color map for different classes
        self.class_colors = {}
        self.default_colors = [
            (0, 255, 0),    # Green
            (255, 0, 0),    # Blue
            (0, 0, 255),    # Red
            (255, 255, 0),  # Cyan
            (255, 0, 255),  # Magenta
            (0, 255, 255),  # Yellow
        ]

        # Initialize predictor
        self.predictor = None
        self._init_predictor()

    def _init_predictor(self):
        """Initialize SageMaker predictor"""
        try:
            self.predictor = Predictor(
                endpoint_name=self.endpoint_name,
                serializer=JSONSerializer(),
                deserializer=JSONDeserializer(),
                sagemaker_session=sagemaker.Session(
                    boto_session=boto3.Session(region_name=self.region)
                )
            )
            print(f"✓ SageMaker predictor initialized: {self.endpoint_name}")
        except Exception as e:
            print(f"❌ Error: Could not initialize SageMaker predictor: {e}")
            print("   Make sure:")
            print("   1. AWS credentials are configured (aws configure)")
            print("   2. Endpoint name is correct")
            print("   3. You have access to the endpoint")
            self.predictor = None

    def set_parameters(self, frame_interval: int = None, confidence_threshold: float = None,
                      max_workers: int = None):
        """
        Update processing parameters
        
        Args:
            frame_interval: Process every Nth frame
            confidence_threshold: Minimum confidence for detections (0.0-1.0)
            max_workers: Number of parallel threads
        """
        if frame_interval is not None:
            self.frame_interval = frame_interval
            print(f"Frame interval set to: {frame_interval}")
        
        if confidence_threshold is not None:
            self.confidence_threshold = confidence_threshold
            print(f"Confidence threshold set to: {confidence_threshold}")
        
        if max_workers is not None:
            self.max_workers = max_workers
            print(f"Max workers set to: {max_workers}")

    def process_single_frame(self, frame: any, frame_idx: int) -> Tuple[any, Dict[str, int], int]:
        """
        Process a single frame with YOLO detection
        
        Args:
            frame: OpenCV frame (numpy array)
            frame_idx: Index of the frame in video
            
        Returns:
            Tuple of (annotated_frame, detection_stats, frame_idx)
        """
        # Initialize return values
        draw_frame = frame.copy()
        detection_stats = {}

        try:
            # Convert frame to PIL Image
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            pil_image = Image.fromarray(frame_rgb)

            # Encode to base64
            buffered = BytesIO()
            pil_image.save(buffered, format="JPEG", quality=85)
            img_base64 = base64.b64encode(buffered.getvalue()).decode()

            # Send to endpoint
            payload = {'image': img_base64}
            response = self.predictor.predict(payload)

            # Parse predictions
            if isinstance(response, dict):
                predictions = response.get('predictions', [])
            else:
                predictions = response if isinstance(response, list) else []

            # Filter by confidence threshold
            predictions = [p for p in predictions
                         if p.get('confidence', 0) >= self.confidence_threshold]

            # Draw bounding boxes on frame
            for pred in predictions:
                class_name = pred.get('class_name', 'Unknown')
                
                # Skip all board-related detections
                if 'board' in class_name.lower():
                    continue
                    
                confidence = pred.get('confidence', 0)
                bbox = pred.get('bbox', {})

                # Assign color to class
                if class_name not in self.class_colors:
                    color_idx = len(self.class_colors) % len(self.default_colors)
                    self.class_colors[class_name] = self.default_colors[color_idx]

                color = self.class_colors[class_name]

                if isinstance(bbox, dict):
                    x1 = int(bbox.get('x1', 0))
                    y1 = int(bbox.get('y1', 0))
                    x2 = int(bbox.get('x2', 0))
                    y2 = int(bbox.get('y2', 0))

                    # Draw bounding box
                    cv2.rectangle(draw_frame, (x1, y1), (x2, y2), color, 3)

                    # Draw label with background
                    label = f"{class_name}: {confidence:.2f}"
                    font = cv2.FONT_HERSHEY_SIMPLEX
                    font_scale = 0.7
                    thickness = 2

                    (label_w, label_h), baseline = cv2.getTextSize(
                        label, font, font_scale, thickness
                    )

                    # Label background
                    cv2.rectangle(
                        draw_frame,
                        (x1, y1 - label_h - baseline - 10),
                        (x1 + label_w + 10, y1),
                        color,
                        -1
                    )

                    # Label text
                    cv2.putText(
                        draw_frame,
                        label,
                        (x1 + 5, y1 - baseline - 5),
                        font,
                        font_scale,
                        (255, 255, 255),
                        thickness
                    )

                    # Track detection stats
                    detection_stats[class_name] = detection_stats.get(class_name, 0) + 1

            return draw_frame, detection_stats, frame_idx

        except Exception as e:
            print(f"Error processing frame {frame_idx}: {e}")
            # Return original frame on error
            return frame, detection_stats, frame_idx

    def process_video(self, input_path: str, output_path: str = None,
                     progress_callback: Optional[Callable] = None) -> dict:
        """
        Process a video file with YOLO detection using multithreading
        
        Args:
            input_path: Path to input video file
            output_path: Path for output annotated video (default: input_annotated.mp4)
            progress_callback: Optional callback function(progress_percent, status_message)
            
        Returns:
            dict with processing statistics
        """
        # Validate input
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"Video file not found: {input_path}")

        # Set default output path if not provided
        if output_path is None:
            base_name = os.path.splitext(input_path)[0]
            output_path = f"{base_name}_annotated.mp4"

        print("\n" + "=" * 70)
        print("VIDEO PROCESSING STARTED")
        print("=" * 70)
        print(f"Input: {input_path}")
        print(f"Output: {output_path}")
        print()

        # Open video
        cap = cv2.VideoCapture(input_path)
        if not cap.isOpened():
            raise ValueError(f"Cannot open video file: {input_path}")

        # Get video properties
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = int(cap.get(cv2.CAP_PROP_FPS))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        print(f"Video properties: {width}x{height} @ {fps} FPS, {total_frames} frames")
        print(f"Processing every {self.frame_interval} frame(s)")
        print(f"Using {self.max_workers} worker threads")
        print(f"Confidence threshold: {self.confidence_threshold}")
        print()

        if progress_callback:
            progress_callback(0, "Starting video processing...")

        # Step 1: Read all frames and store with indices
        print("Reading frames...")
        frame_data = []  # List of (frame_idx, frame)
        
        for idx in range(total_frames):
            ret, frame = cap.read()
            if not ret:
                break
            frame_data.append((idx, frame))

        cap.release()
        actual_frames = len(frame_data)
        print(f"✓ Read {actual_frames} frames")

        # Step 2: Prepare output buffer
        frames_to_write = [None] * actual_frames
        global_detection_stats = {}
        processed_count = 0

        # Step 3: Process frames with multithreading
        if self.predictor:
            print("Processing frames with SageMaker endpoint...")
            start_time = time.time()
            
            with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers) as executor:
                # Submit tasks only for frames that need processing
                futures = {}
                
                for idx, frame in frame_data:
                    if idx % self.frame_interval == 0:
                        # Submit for inference
                        future = executor.submit(self.process_single_frame, frame, idx)
                        futures[future] = idx
                    else:
                        # Store original frame (not processed)
                        frames_to_write[idx] = frame

                # Collect results as they complete
                completed = 0
                total_to_process = len(futures)
                
                for future in concurrent.futures.as_completed(futures):
                    idx = futures[future]
                    try:
                        annotated_frame, detection_stats, frame_idx = future.result()
                        
                        # Store annotated frame in correct position
                        frames_to_write[frame_idx] = annotated_frame
                        
                        # Merge detection stats
                        for class_name, count in detection_stats.items():
                            global_detection_stats[class_name] = \
                                global_detection_stats.get(class_name, 0) + count
                        
                        processed_count += 1
                        completed += 1
                        
                        # Update progress
                        if progress_callback and completed % max(1, total_to_process // 20) == 0:
                            progress = int((completed / total_to_process) * 90)
                            progress_callback(
                                progress, 
                                f"Processed {completed}/{total_to_process} frames"
                            )
                    
                    except Exception as e:
                        print(f"Error collecting result for frame {idx}: {e}")
                        # Use original frame
                        frames_to_write[idx] = frame_data[idx][1]

            processing_time = time.time() - start_time
            print(f"✓ Completed processing {processed_count} frames in {processing_time:.2f}s")
        else:
            print("⚠ No predictor available, copying original frames")
            # No predictor - just use original frames
            for idx, frame in frame_data:
                frames_to_write[idx] = frame

        # Step 4: Write all frames in correct sequence
        print("Writing output video...")
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

        if not out.isOpened():
            raise ValueError(f"Cannot create output video: {output_path}")

        written_frames = 0
        for idx in range(actual_frames):
            if frames_to_write[idx] is not None:
                out.write(frames_to_write[idx])
                written_frames += 1
            else:
                print(f"Warning: Frame {idx} is None, using black frame")
                # Write black frame as fallback
                black_frame = cv2.zeros((height, width, 3), dtype='uint8')
                out.write(black_frame)
                written_frames += 1

            # Update progress for writing phase
            if progress_callback and idx % max(1, actual_frames // 10) == 0:
                progress = 90 + int((idx / actual_frames) * 10)
                progress_callback(progress, f"Writing frame {idx}/{actual_frames}")

        out.release()
        print(f"✓ Wrote {written_frames} frames to {output_path}")

        if progress_callback:
            progress_callback(100, "Processing complete!")

        # Return statistics
        total_detections = sum(global_detection_stats.values())
        
        result = {
            'total_frames': actual_frames,
            'processed_frames': processed_count,
            'detection_stats': global_detection_stats,
            'total_detections': total_detections,
            'video_duration': actual_frames / fps if fps > 0 else 0,
            'output_path': output_path,
            'fps': fps,
            'resolution': f"{width}x{height}"
        }

        # Print summary
        print("\n" + "=" * 70)
        print("PROCESSING SUMMARY")
        print("=" * 70)
        print(f"Total frames: {actual_frames}")
        print(f"Frames analyzed: {processed_count}")
        print(f"Total detections: {total_detections}")
        print(f"Duration: {result['video_duration']:.2f} seconds")
        
        if global_detection_stats:
            print("\nDetection breakdown:")
            for class_name, count in sorted(global_detection_stats.items(), 
                                          key=lambda x: x[1], reverse=True):
                print(f"  {class_name}: {count}")
        else:
            print("\nNo detections found")
        
        print(f"\n✓ Output saved to: {output_path}")
        print("=" * 70 + "\n")

        return result


# Example usage and testing
if __name__ == "__main__":
    print("\n" + "=" * 70)
    print("SAGEMAKER VIDEO PROCESSOR - LOCAL MODE")
    print("=" * 70 + "\n")
    
    # Option 1: Load from endpoint_config.json (if it exists)
    processor = VideoProcessor()
    
    # Option 2: Specify endpoint directly
    # processor = VideoProcessor(
    #     endpoint_name="your-endpoint-name",
    #     region="ap-south-1"
    # )
    
    # Optional: Adjust parameters
    processor.set_parameters(
        frame_interval=3,           # Process every 3rd frame
        confidence_threshold=0.25,  # 25% confidence minimum
        max_workers=8               # 8 parallel threads
    )
    
    # Progress callback function
    def progress_update(percent, message):
        print(f"[{percent:3d}%] {message}")
    
    # Specify your input video
    input_video = r"/Volumes/MySSD/RV/roadrunner-survey-ai/backend/uploads/vlc-record-2025-10-31-18h08m44s-2025_0812_150128_F.mp4-.mp4"
    
    # Optional: specify output path (or let it auto-generate)
    output_video = "output_annotated.mp4"
    
    # Check if input exists
    if not os.path.exists(input_video):
        print(f"❌ Error: Input video not found: {input_video}")
        print("\nPlease update the 'input_video' variable with your video path")
        print("Example: input_video = r'C:\\path\\to\\your\\video.mp4'")
    else:
        try:
            stats = processor.process_video(
                input_path=input_video,
                output_path=output_video,
                progress_callback=progress_update
            )
            
            print("\n✅ SUCCESS!")
            print(f"Processed video saved to: {stats['output_path']}")
            
        except Exception as e:
            print(f"\n❌ Error during processing: {e}")
            import traceback
            traceback.print_exc()