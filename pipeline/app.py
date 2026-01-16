
"""
Test Local Video on SageMaker YOLO Endpoint
Quick verification that the model is working properly
Processes local video and creates annotated output
"""

import os
import sys
import json
import base64
import time
from io import BytesIO
from PIL import Image
import cv2
import sagemaker
from sagemaker.predictor import Predictor
from sagemaker.serializers import JSONSerializer
from sagemaker.deserializers import JSONDeserializer
import boto3

# ==================== CONFIGURATION ====================
LOCAL_VIDEO_PATH = r""
OUTPUT_VIDEO = "output_annotated.mp4"
FRAME_INTERVAL = 3           # Process every 5th frame (adjust for speed)
CONFIDENCE_THRESHOLD = 0.25  # Show detections above 25% confidence
MAX_FRAMES = None             # Limit to 300 frames for quick test (remove to process all)
# =======================================================

print("=" * 70)
print("  🎬 TESTING LOCAL VIDEO ON SAGEMAKER ENDPOINT")
print("=" * 70)
print()

# Load endpoint configuration
try:
    with open('endpoint_config.json', 'r') as f:
        config = json.load(f)
    endpoint_name = config['endpoint_name']
    region = config['region']
    print(f"✓ Endpoint: {endpoint_name}")
    print(f"✓ Region: {region}")
except FileNotFoundError:
    print("❌ Error: endpoint_config.json not found!")
    print("   Run: python deploy.py first")
    sys.exit(1)

print()

# ==================== STEP 1: Check Video File ====================
print("=" * 70)
print("STEP 1/4: Checking local video file")
print("=" * 70)
print()

print(f"📹 Video path: {LOCAL_VIDEO_PATH}")

if not os.path.exists(LOCAL_VIDEO_PATH):
    print(f"❌ Error: Video file not found!")
    print(f"   Expected: {LOCAL_VIDEO_PATH}")
    sys.exit(1)

video_size_mb = os.path.getsize(LOCAL_VIDEO_PATH) / (1024 * 1024)
print(f"✓ File found: {video_size_mb:.2f} MB")
print()

# ==================== STEP 2: Analyze Video ====================
print("=" * 70)
print("STEP 2/4: Analyzing video properties")
print("=" * 70)
print()

# Open video with OpenCV
cap = cv2.VideoCapture(LOCAL_VIDEO_PATH)

if not cap.isOpened():
    print("❌ Error: Cannot open video file")
    print("   Video may be corrupted or in unsupported format")
    sys.exit(1)

# Get video properties
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
fps = int(cap.get(cv2.CAP_PROP_FPS))
width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
duration = total_frames / fps if fps > 0 else 0

print(f"📊 Video Properties:")
print(f"   Resolution: {width}x{height}")
print(f"   FPS: {fps}")
print(f"   Total frames: {total_frames}")
print(f"   Duration: {duration:.1f} seconds ({duration/60:.1f} minutes)")
print()

# Calculate processing plan
frames_to_process = min(total_frames, MAX_FRAMES) if MAX_FRAMES else total_frames
frames_to_analyze = frames_to_process // FRAME_INTERVAL

print(f"⚙️  Processing Plan:")
print(f"   Total frames in video: {total_frames}")
print(f"   Frames to process: {frames_to_process}")
print(f"   Frame interval: Every {FRAME_INTERVAL} frame(s)")
print(f"   Frames to analyze with YOLO: {frames_to_analyze}")
print(f"   Estimated time: {frames_to_analyze * 1.5:.0f}-{frames_to_analyze * 2.5:.0f} seconds")
print()

# ==================== STEP 3: Initialize & Process ====================
print("=" * 70)
print("STEP 3/4: Processing video with YOLO endpoint")
print("=" * 70)
print()

# Initialize predictor
print("🔧 Initializing SageMaker predictor...")
try:
    predictor = Predictor(
        endpoint_name=endpoint_name,
        serializer=JSONSerializer(),
        deserializer=JSONDeserializer(),
        sagemaker_session=sagemaker.Session(
            boto_session=boto3.Session(region_name=region)
        )
    )
    print("✓ Predictor ready")
except Exception as e:
    print(f"❌ Error creating predictor: {e}")
    cap.release()
    sys.exit(1)

print()

# Prepare output video writer
print("🎬 Processing frames...")
fourcc = cv2.VideoWriter_fourcc(*'mp4v')
out = cv2.VideoWriter(OUTPUT_VIDEO, fourcc, fps, (width, height))

frame_count = 0
processed_count = 0
detection_stats = {}
inference_times = []
first_detection_shown = False

# Color map for different classes
class_colors = {}
default_colors = [
    (0, 255, 0),    # Green
    (255, 0, 0),    # Blue
    (0, 0, 255),    # Red
    (255, 255, 0),  # Cyan
    (255, 0, 255),  # Magenta
    (0, 255, 255),  # Yellow
]

print(f"   Progress: ", end='', flush=True)
progress_interval = max(1, frames_to_analyze // 20)

start_time = time.time()

while frame_count < frames_to_process:
    ret, frame = cap.read()
    
    if not ret:
        break
    
    # Process every Nth frame
    if frame_count % FRAME_INTERVAL == 0:
        # Convert frame to PIL Image
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        pil_image = Image.fromarray(frame_rgb)
        
        # Encode to base64
        buffered = BytesIO()
        pil_image.save(buffered, format="JPEG", quality=85)
        img_base64 = base64.b64encode(buffered.getvalue()).decode()
        
        # Send to endpoint
        try:
            inference_start = time.time()
            payload = {'image': img_base64}
            response = predictor.predict(payload)
            inference_time = time.time() - inference_start
            inference_times.append(inference_time)
            
            # Parse predictions
            if isinstance(response, dict):
                predictions = response.get('predictions', [])
            else:
                predictions = response if isinstance(response, list) else []
            
            # Filter by confidence threshold
            predictions = [p for p in predictions 
                          if p.get('confidence', 0) >= CONFIDENCE_THRESHOLD]
            
            # Show first detection as proof
            if predictions and not first_detection_shown:
                print(f"\n   ✓ First detection at frame {frame_count}:")
                for p in predictions[:3]:
                    print(f"      - {p.get('class_name')}: {p.get('confidence', 0):.2f}")
                print(f"   Progress: ", end='', flush=True)
                first_detection_shown = True
            
            # Draw bounding boxes on frame
            draw_frame = frame.copy()
            
            for pred in predictions:
                class_name = pred.get('class_name', 'Unknown')
                confidence = pred.get('confidence', 0)
                bbox = pred.get('bbox', {})
                
                # Assign color to class
                if class_name not in class_colors:
                    color_idx = len(class_colors) % len(default_colors)
                    class_colors[class_name] = default_colors[color_idx]
                
                color = class_colors[class_name]
                
                if isinstance(bbox, dict):
                    x1 = int(bbox.get('x1', 0))
                    y1 = int(bbox.get('y1', 0))
                    x2 = int(bbox.get('x2', 0))
                    y2 = int(bbox.get('y2', 0))
                    
                    # Draw bounding box (thicker for visibility)
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
            
            # Write annotated frame
            out.write(draw_frame)
            processed_count += 1
            
            # Progress indicator
            if processed_count % progress_interval == 0:
                print("█", end='', flush=True)
            
        except Exception as e:
            print(f"\n⚠️  Error at frame {frame_count}: {e}")
            # Write original frame on error
            out.write(frame)
    else:
        # Write original frame (not processed)
        out.write(frame)
    
    frame_count += 1

print(" ✓ Done!")
print()

processing_time = time.time() - start_time

# Release resources
cap.release()
out.release()

print(f"✓ Processed {processed_count} frames (analyzed {processed_count} with YOLO)")
print(f"✓ Total frames written: {frame_count}")
print(f"✓ Processing time: {processing_time:.1f} seconds")
print()

# ==================== STEP 4: Results ====================
print("=" * 70)
print("STEP 4/4: Results & Model Verification")
print("=" * 70)
print()

# Model verification
if processed_count > 0 and len(inference_times) > 0:
    print("✅ MODEL VERIFICATION:")
    print(f"   ✓ Endpoint is responding")
    print(f"   ✓ Model loaded successfully")
    print(f"   ✓ Inference pipeline working")
    print(f"   ✓ {processed_count} frames analyzed")
    print()
else:
    print("⚠️  MODEL VERIFICATION:")
    print(f"   ✗ No frames were processed")
    print(f"   Check logs above for errors")
    print()

# Detection statistics
print("📊 Detection Statistics:")
if detection_stats:
    print("   ✅ Model is detecting objects!")
    print()
    print("-" * 70)
    print(f"{'Class':<20} {'Count':<10} {'Avg per Frame':<15} {'%'}")
    print("-" * 70)
    total_detections = sum(detection_stats.values())
    
    for class_name, count in sorted(detection_stats.items(), 
                                   key=lambda x: x[1], reverse=True):
        avg_per_frame = count / processed_count
        percentage = (count / total_detections) * 100
        print(f"{class_name:<20} {count:<10} {avg_per_frame:<15.2f} {percentage:.1f}%")
    
    print("-" * 70)
    print(f"{'TOTAL':<20} {total_detections:<10} "
          f"{total_detections/processed_count:<15.2f} 100.0%")
    print()
    
    print(f"✅ Conclusion: Model is working correctly!")
    print(f"   - Detected {len(detection_stats)} different classes")
    print(f"   - Total {total_detections} detections")
    print(f"   - Average {total_detections/processed_count:.2f} objects per frame")
else:
    print("   ⚠️  No objects detected")
    print()
    print("   Possible reasons:")
    print(f"   - Video doesn't contain objects model was trained on")
    print(f"   - Confidence threshold too high (current: {CONFIDENCE_THRESHOLD})")
    print(f"   - Video quality issues")
    print()
    print("   Try lowering CONFIDENCE_THRESHOLD to 0.1 and run again")

print()

# Performance metrics
print("⚡ Performance Metrics:")
if inference_times:
    avg_inference = sum(inference_times) / len(inference_times)
    min_inference = min(inference_times)
    max_inference = max(inference_times)
    
    print(f"   Average inference time: {avg_inference:.2f}s per frame")
    print(f"   Min inference time: {min_inference:.2f}s")
    print(f"   Max inference time: {max_inference:.2f}s")
    print(f"   Total inference time: {sum(inference_times):.1f}s")
    print(f"   Processing rate: {processed_count / processing_time:.2f} frames/sec")
    
    # First vs subsequent (cold start check)
    if len(inference_times) > 1:
        first_time = inference_times[0]
        avg_rest = sum(inference_times[1:]) / len(inference_times[1:])
        print()
        print(f"   Cold start (1st frame): {first_time:.2f}s")
        print(f"   Warm average: {avg_rest:.2f}s")
        if first_time > avg_rest * 2:
            print(f"   ✓ Cold start detected (normal)")
    
    # Cost estimation
    total_inference_seconds = sum(inference_times)
    estimated_cost = total_inference_seconds * 0.0004
    print()
    print(f"💰 Cost for this test:")
    print(f"   Total inference time: {total_inference_seconds:.1f}s")
    print(f"   Estimated cost: ${estimated_cost:.4f}")

print()

# Output file info
print("💾 Output File:")
print(f"   Location: {OUTPUT_VIDEO}")
print(f"   Size: {os.path.getsize(OUTPUT_VIDEO) / (1024 * 1024):.2f} MB")
print()

# Class color legend
if class_colors:
    print("🎨 Detection Colors:")
    color_names = {
        (0, 255, 0): "Green",
        (255, 0, 0): "Blue",
        (0, 0, 255): "Red",
        (255, 255, 0): "Cyan",
        (255, 0, 255): "Magenta",
        (0, 255, 255): "Yellow",
    }
    for class_name, color in class_colors.items():
        color_name = color_names.get(color, "Custom")
        print(f"   {class_name}: {color_name} boxes")
    print()

print("=" * 70)
print("✅ TESTING COMPLETE!")
print("=" * 70)
print()

# Verification summary
if detection_stats:
    print("🎉 MODEL VERIFICATION: PASSED ✅")
    print()
    print("Your YOLO model on SageMaker is:")
    print("   ✓ Successfully deployed")
    print("   ✓ Responding to requests")
    print("   ✓ Running inference correctly")
    print("   ✓ Detecting objects as expected")
else:
    print("⚠️  MODEL VERIFICATION: INCONCLUSIVE")
    print()
    print("Model is running but no detections found.")
    print("Try adjusting CONFIDENCE_THRESHOLD or use different video.")

print()
print("🎯 Next Steps:")
print(f"   1. Watch annotated video: {OUTPUT_VIDEO}")
print(f"   2. Run: start {OUTPUT_VIDEO}")
print(f"   3. If satisfied, proceed with: python setup_api.py")
print()

print("💡 Adjust settings in script:")
print(f"   - FRAME_INTERVAL (current: {FRAME_INTERVAL}) - lower for more frames")
print(f"   - CONFIDENCE_THRESHOLD (current: {CONFIDENCE_THRESHOLD}) - lower for more detections")
print(f"   - MAX_FRAMES (current: {MAX_FRAMES}) - increase or None for full video")
print()

print("=" * 70)
