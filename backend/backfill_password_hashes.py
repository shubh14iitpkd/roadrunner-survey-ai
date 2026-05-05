"""Backfill bcrypt hashes for users still storing plaintext passwords.

Usage:
    cd backend && python backfill_password_hashes.py [--dry-run]

Picks up MONGO_URI / MONGO_DB_NAME from env (falls back to local defaults
matching backend/config.py).
"""
import argparse
import os
import sys

from pymongo import MongoClient

from utils.security import hash_password, is_bcrypt_hash


def main() -> int:
	parser = argparse.ArgumentParser()
	parser.add_argument("--dry-run", action="store_true", help="Report counts, do not write")
	args = parser.parse_args()

	mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017")
	db_name = "roadrunner" # os.getenv("MONGO_DB_NAME", "roadrunner")

	client = MongoClient(mongo_uri, uuidRepresentation="standard", serverSelectionTimeoutMS=5000)
	db = client[db_name]

	cursor = db.users.find({"password_hash": {"$type": "string"}}, {"_id": 1, "email": 1, "password_hash": 1})

	total = 0
	already_hashed = 0
	empty = 0
	updated = 0
	skipped = 0

	for user in cursor:
		total += 1
		current = user.get("password_hash") or ""
		if not current:
			empty += 1
			skipped += 1
			continue
		if is_bcrypt_hash(current):
			already_hashed += 1
			continue

		new_hash = hash_password(current)
		if args.dry_run:
			updated += 1
			continue

		db.users.update_one(
			{"_id": user["_id"], "password_hash": current},
			{"$set": {"password_hash": new_hash}},
		)
		updated += 1

	print(f"Scanned: {total}")
	print(f"Already bcrypt: {already_hashed}")
	print(f"Empty password_hash (skipped): {empty}")
	print(f"{'Would update' if args.dry_run else 'Updated'}: {updated}")
	print(f"Skipped: {skipped}")
	return 0


if __name__ == "__main__":
	sys.exit(main())
