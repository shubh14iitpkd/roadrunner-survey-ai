from pymongo import MongoClient

client = MongoClient('mongodb://localhost:27017/')
db = client['roadrunner']

# Query 1: Count frames with street lights on route 105
count_frames = db.frames.count_documents({
    'route_id': 105,
    'detections.class_name': 'Street lights'
})

print(f'Frames with street lights on route 105: {count_frames}')

# Query 2: Count total street light detections (individual detections, not frames)
pipeline = [
    {'$match': {'route_id': 105}},
    {'$unwind': '$detections'},
    {'$match': {'detections.class_name': 'Street lights'}},
    {'$count': 'total'}
]
result = list(db.frames.aggregate(pipeline))
total_detections = result[0]['total'] if result else 0

print(f'Total street light detections on route 105: {total_detections}')

# Query 3: Check what the AI might have counted
print(f'\n--- Verification ---')
print(f'AI Answer: 3509 street lights')
print(f'Actual Total Detections: {total_detections}')
print(f'Actual Frames with Street Lights: {count_frames}')
print(f'Match: {"✓ ACCURATE" if total_detections == 3509 else "✗ INCORRECT"}')

# Query 4: Sample data
sample = db.frames.find_one({
    'route_id': 105,
    'detections.class_name': 'Street lights'
})

if sample:
    print(f'\n--- Sample Frame ---')
    print(f'Route ID: {sample.get("route_id")}')
    print(f'Frame Number: {sample.get("frame_number")}')
    print(f'Total detections in this frame: {len(sample.get("detections", []))}')
    street_lights = [d for d in sample.get("detections", []) if d.get("class_name") == "Street lights"]
    print(f'Street lights in this frame: {len(street_lights)}')
