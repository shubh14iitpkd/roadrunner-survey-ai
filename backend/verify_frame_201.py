from pymongo import MongoClient

client = MongoClient('mongodb://localhost:27017/')
db = client['roadrunner']

# Check frame 201 specifically
frame = db.frames.find_one({'frame_number': 201})

if frame:
    print(f"Frame Number: {frame.get('frame_number')}")
    print(f"Route ID: {frame.get('route_id')}")
    print(f"Total detections: {frame.get('detections_count')}")
    
    detections = frame.get('detections', [])
    road_markings = [d for d in detections if d.get('class_name') == 'Road markings']
    
    print(f"\nRoad markings in this frame: {len(road_markings)}")
    print(f"Street lights in this frame: {len([d for d in detections if d.get('class_name') == 'Street lights'])}")
    
    print(f"\nRoad marking detections:")
    for rm in road_markings:
        print(f"  - Detection {rm.get('detection_id')}: confidence {rm.get('confidence')}")
    
    print(f"\n{'✓ CORRECT' if len(road_markings) == 4 else '✗ WRONG'}: Frame 201 has {len(road_markings)} road markings")
    print(f"AI said: 77 road markings")
    print(f"Accuracy: {'✓' if len(road_markings) == 77 else '✗ INCORRECT - AI is wrong!'}")
else:
    print("Frame 201 not found!")

# Check if there are multiple frames with frame_number 201
all_frame_201s = list(db.frames.find({'frame_number': 201}))
print(f"\n\nTotal frames with frame_number=201: {len(all_frame_201s)}")

if len(all_frame_201s) > 1:
    print("Multiple frames found! Let me check all of them:")
    total_road_markings = 0
    for idx, f in enumerate(all_frame_201s):
        detections = f.get('detections', [])
        road_markings = [d for d in detections if d.get('class_name') == 'Road markings']
        print(f"  Frame {idx+1} (route {f.get('route_id')}): {len(road_markings)} road markings")
        total_road_markings += len(road_markings)
    
    print(f"\nTotal road markings across ALL frame_number=201: {total_road_markings}")
    print(f"AI answer (77): {'✓ CLOSE' if abs(total_road_markings - 77) < 5 else '✗ Still wrong'}")
