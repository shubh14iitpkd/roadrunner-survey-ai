import os
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

# Connect to MongoDB
MONGO_URI = os.getenv('MONGO_URI', 'mongodb://localhost:27017/')
DB_NAME = os.getenv('DB_NAME', 'roadrunner')

client = MongoClient(MONGO_URI)
db = client[DB_NAME]

import re

assets = db.assets.find()

conditions = set()
for a in assets:
    name = a.get("type", "")
    p = re.sub(r"\w+_AssetCondition_|\w+_VerticalClearance_", "", name)
    conditions.add(p)

print(conditions)
