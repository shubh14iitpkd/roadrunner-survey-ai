from pymongo import MongoClient

client = MongoClient('mongodb://localhost:27017/')
db = client['roadrunner']

print("=" * 80)
print("VERIFICATION OF IMPROVED CHATBOT ANSWERS")
print("=" * 80)

# Question 1: Total street lights on route 105
pipeline1 = [
    {'$match': {'route_id': 105}},
    {'$unwind': '$detections'},
    {'$match': {'detections.class_name': 'Street lights'}},
    {'$count': 'total'}
]
result1 = list(db.frames.aggregate(pipeline1))
total_street_lights = result1[0]['total'] if result1 else 0

print(f"\n1. Street lights on route 105:")
print(f"   Chatbot Answer: 33,931")
print(f"   Actual Count:   {total_street_lights:,}")
print(f"   Status: {'✓ CORRECT' if total_street_lights == 33931 else '✗ INCORRECT'}")

# Question 2: Frames with street lights on route 105
frames_with_lights = db.frames.count_documents({
    'route_id': 105,
    'detections.class_name': 'Street lights'
})

print(f"\n2. Frames with street lights on route 105:")
print(f"   Chatbot Answer: 3,509")
print(f"   Actual Count:   {frames_with_lights:,}")
print(f"   Status: {'✓ CORRECT' if frames_with_lights == 3509 else '✗ INCORRECT'}")

# Question 3: Total road markings in database
pipeline3 = [
    {'$unwind': '$detections'},
    {'$match': {'detections.class_name': 'Road markings'}},
    {'$count': 'total'}
]
result3 = list(db.frames.aggregate(pipeline3))
total_road_markings = result3[0]['total'] if result3 else 0

print(f"\n3. Total road markings in database:")
print(f"   Chatbot Answer: 37,096")
print(f"   Actual Count:   {total_road_markings:,}")
print(f"   Status: {'✓ CORRECT' if total_road_markings == 37096 else '✗ INCORRECT'}")

print("\n" + "=" * 80)
all_correct = (total_street_lights == 33931 and 
               frames_with_lights == 3509 and 
               total_road_markings == 37096)
print(f"OVERALL: {'✓✓✓ ALL ANSWERS CORRECT!' if all_correct else '✗ SOME ANSWERS INCORRECT'}")
print("=" * 80)
