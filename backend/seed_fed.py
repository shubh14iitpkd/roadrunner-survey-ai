from pymongo import MongoClient

MONGO_URI = "mongodb://localhost:27017"
DB_NAME = "roadrunner"
COLLECTION = "assets"

client = MongoClient(MONGO_URI)
db = client[DB_NAME]
col = db[COLLECTION]

# get all video keys
video_keys = col.distinct("video_key")
defect_counter = 111

for video_key in video_keys:
    print(f"Processing video: {video_key}")

    # only damaged assets
    cursor = col.find(
        {
            "video_key": video_key,
            "condition": {"$ne": "good"}   # change if your damage rule differs
        }
    ).sort("frame_number", 1)



    for doc in cursor:
        defect_id = f"DEF-{defect_counter:06d}"

        col.update_one(
            {"_id": doc["_id"]},
            {"$set": {"defect_id": defect_id}}
        )

        defect_counter += 1

print("Done")