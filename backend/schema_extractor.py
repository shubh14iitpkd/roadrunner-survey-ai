import json
from pymongo import MongoClient
from collections import defaultdict

MONGO_URI = "mongodb://localhost:27017"
DB_NAME = "roadrunner"

client = MongoClient(MONGO_URI)
db = client[DB_NAME]

SAMPLE_SIZE = 1000

result = []

for collection_name in db.list_collection_names():
    collection = db[collection_name]
    schema = defaultdict(set)

    for doc in collection.find().limit(SAMPLE_SIZE):
        for field, value in doc.items():
            schema[field].add(type(value).__name__)

    # convert sets to lists for JSON serialization
    cleaned_schema = {field: list(types) for field, types in schema.items()}

    result.append({
        "collection": collection_name,
        "schema": cleaned_schema
    })

with open("schema.json", "w") as f:
    json.dump(result, f)