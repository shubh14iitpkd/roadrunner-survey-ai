import json
import os
from pathlib import Path
import sys

# Ensure backend root is on sys.path for relative imports when running directly
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
	sys.path.insert(0, str(BACKEND_ROOT))

from dotenv import load_dotenv
from pymongo import MongoClient, ASCENDING

from utils.security import hash_password


SEEDS_DIR = Path(__file__).resolve().parent.parent / "seeds"


def load_json(filename: str):
	path = SEEDS_DIR / filename
	if not path.exists():
		return None
	with path.open("r", encoding="utf-8") as f:
		return json.load(f)


def main():
	load_dotenv()
	mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017")
	db_name = os.getenv("MONGO_DB_NAME", "roadrunner")
	client = MongoClient(mongo_uri, uuidRepresentation="standard")
	db = client[db_name]

	# Ensure base indexes
	db["users"].create_index([("email", ASCENDING)], unique=True, name="uniq_email")
	db["roads"].create_index([("route_id", ASCENDING)], unique=True, name="uniq_route")

	# Seed default admin if not exists
	admin_email = os.getenv("SEED_ADMIN_EMAIL", "admin@example.com")
	admin_password = os.getenv("SEED_ADMIN_PASSWORD", "admin123")
	if not db.users.find_one({"email": admin_email}):
		print(f"Creating admin user: {admin_email}")
		db.users.insert_one({
			"name": "Admin",
			"email": admin_email,
			"password_hash": hash_password(admin_password),
			"role": "admin",
			"is_verified": True,
		})

	# Seed collections from JSON files if present
	for name, coll in [
		("asset_categories.json", "asset_categories"),
		("asset_master.json", "asset_master"),
		("roads.json", "roads"),
		("surveys.json", "surveys"),
		("videos.json", "videos"),
		("assets.json", "assets"),
	]:
		data = load_json(name)
		if not data:
			continue
		if isinstance(data, list) and data:
			print(f"Seeding {len(data)} docs into {coll}")
			db[coll].insert_many(data, ordered=False)

	print("Seeding complete.")


if __name__ == "__main__":
	main()
