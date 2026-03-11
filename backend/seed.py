import random
from datetime import datetime
from pymongo import MongoClient

MONGO_URI = "mongodb://localhost:27017"
DB_NAME = "roadrunner"
COLLECTION = "roads"

client = MongoClient(MONGO_URI)
db = client[DB_NAME]
collection = db[COLLECTION]

roads = [
"Rawdat Al Khail St",
"Wadi Al Wasah",
"Wadi Al Gaeya",
"Street 502",
"Street 340",
"Salwa-Lusail Temporary Truck RTE",
"Salwa Rd",
"Rawdat Al Habara",
"Ras ABu Abboud Rd",
"Omar Al Mukhtar St",
"Najma",
"Industrial Area Foot Over Bridge",
"LBN Al Fardi St",
"Grand Hamad, Doha",
"G-Ring (2) RD",
"F Ring RD",
"West Industrial St",
"East Industrial Rd",
"Dukhan Highway",
"D-Ring road,Doha",
"CG56 + 946",
"Ash Shahaniyah",
"Al Wakra RD",
"Al Saad Plaza",
"Al Rayyan",
"Al Najma SR",
"Al Muntazah, AR Rayyan",
"Al Khor Costal RD 2",
"Al Khawar",
"Al Jamiaa St",
"Al Istiqlal St",
"Al Corniche",
"Ak Khor Costal Rd",
"Abu Nakhlah",
"AR Rayyan (3)",
"963 Street",
"AL Amir St",
"9F5V + 3M6",
"8G36+MQF, Doha",
"856 Al Thumama St",
"7FVP+JW, Doha",
"7FGQ+QH5, Doha",
"7C4J + C63",
"6GHQH + 5WW",
"6GH3 + RPG",
"6G82 + CQ4",
"166 Rawdat, Al Khail St",
"15 Al Amana",
"1494 Al Rayyan Rd"
]

road_types = [
"National/Expressway",
"Municipal/Urban Road",
"Local Access Road",
"Special Zone"
]

road_sides = ["LHS", "RHS"]

def random_lat():
    return round(random.uniform(24.9, 26.2), 6)

def random_lng():
    return round(random.uniform(50.7, 52.0), 6)

documents = []

route_id = 1

for road in roads:

    start_lat = random_lat()
    start_lng = random_lng()
    end_lat = random_lat()
    end_lng = random_lng()

    doc = {
        "route_id": 200+route_id,
        "road_name": road,
        "start_point_name": f"{road} Point A",
        "start_lat": start_lat,
        "start_lng": start_lng,
        "end_point_name": f"{road} Point B",
        "end_lat": end_lat,
        "end_lng": end_lng,
        "estimated_distance_km": round(random.uniform(2, 25), 2),
        "road_type": random.choice(road_types),
        "road_side": random.choice(road_sides),
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }

    documents.append(doc)
    route_id += 1

collection.insert_many(documents)

print(f"Inserted {len(documents)} routes")
