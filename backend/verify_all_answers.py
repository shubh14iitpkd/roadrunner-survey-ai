from pymongo import MongoClient

client = MongoClient('mongodb://localhost:27017/')
db = client['roadrunner']

print("=" * 80)
print("VERIFYING ALL AI ANSWERS")
print("=" * 80)

# Question 1: Total street lights on all roads
print("\n1. Total street lights on all roads")
pipeline = [
    {'$unwind': '$detections'},
    {'$match': {'detections.class_name': 'Street lights'}},
    {'$count': 'total'}
]
result = list(db.frames.aggregate(pipeline))
total_all = result[0]['total'] if result else 0
print(f"   AI Answer: 135,630")
print(f"   Actual:    {total_all:,}")
print(f"   Status:    {'✓ CORRECT' if total_all == 135630 else '✗ WRONG'}")

# Question 2: Street lights on route 105
print("\n2. Street lights on route 105")
pipeline = [
    {'$match': {'route_id': 105}},
    {'$unwind': '$detections'},
    {'$match': {'detections.class_name': 'Street lights'}},
    {'$count': 'total'}
]
result = list(db.frames.aggregate(pipeline))
total_105 = result[0]['total'] if result else 0
print(f"   AI Answer: 33,931")
print(f"   Actual:    {total_105:,}")
print(f"   Status:    {'✓ CORRECT' if total_105 == 33931 else '✗ WRONG'}")

# Question 3: Street lights on frame 201 of route 105
print("\n3. Street lights on frame 201 of route 105")
pipeline = [
    {'$match': {'route_id': 105, 'frame_number': 201}},
    {'$unwind': '$detections'},
    {'$match': {'detections.class_name': 'Street lights'}},
    {'$count': 'total'}
]
result = list(db.frames.aggregate(pipeline))
total_frame_201 = result[0]['total'] if result else 0

# Also check how many frames match
frames_201 = list(db.frames.find({'route_id': 105, 'frame_number': 201}))
print(f"   AI Answer: 17")
print(f"   Actual:    {total_frame_201:,} (across {len(frames_201)} frames)")
for idx, f in enumerate(frames_201):
    detections = f.get('detections', [])
    street_lights = [d for d in detections if d.get('class_name') == 'Street lights']
    print(f"      Frame {idx+1}: {len(street_lights)} street lights")
print(f"   Status:    {'✓ CORRECT' if total_frame_201 == 17 else '✗ WRONG'}")

# Question 4: Road markings on timestamp 6.7
print("\n4. Road markings at timestamp 6.7")
# Check exact timestamp
pipeline_exact = [
    {'$match': {'timestamp': 6.7}},
    {'$unwind': '$detections'},
    {'$match': {'detections.class_name': 'Road markings'}},
    {'$count': 'total'}
]
result_exact = list(db.frames.aggregate(pipeline_exact))
total_exact = result_exact[0]['total'] if result_exact else 0

# Check frames near 6.7 (in case of floating point issues)
frames_67 = list(db.frames.find({'timestamp': {'$gte': 6.69, '$lte': 6.71}}))
print(f"   AI Answer: 77")
print(f"   Exact 6.7: {total_exact:,}")
print(f"   Frames found at ~6.7: {len(frames_67)}")

# Check all frames with this timestamp
if len(frames_67) > 0:
    total_near = 0
    for f in frames_67:
        detections = f.get('detections', [])
        road_markings = [d for d in detections if d.get('class_name') == 'Road markings']
        total_near += len(road_markings)
        print(f"      Route {f.get('route_id')}, Frame {f.get('frame_number')}: {len(road_markings)} road markings")
    print(f"   Total near 6.7: {total_near}")
    print(f"   Status:    {'✓ CORRECT' if total_near == 77 else '✗ WRONG (AI: 77, Actual: ' + str(total_near) + ')'}")
else:
    print(f"   Status:    ✗ No frames found at timestamp 6.7")

# Additional context: Check if there's a specific frame at 6.7 on route 105
frame_67_105 = db.frames.find_one({'route_id': 105, 'timestamp': {'$gte': 6.69, '$lte': 6.71}})
if frame_67_105:
    print(f"\n   Context: Found frame on route 105 at timestamp {frame_67_105.get('timestamp')}")
    detections = frame_67_105.get('detections', [])
    road_markings = [d for d in detections if d.get('class_name') == 'Road markings']
    print(f"            This frame has {len(road_markings)} road markings")

print("\n" + "=" * 80)
print("SUMMARY")
print("=" * 80)
correct = 0
total_questions = 4

if total_all == 135630:
    correct += 1
if total_105 == 33931:
    correct += 1
if total_frame_201 == 17:
    correct += 1
# We'll check the timestamp one separately

print(f"Verified: {correct}/4 answers checked")
print("=" * 80)
