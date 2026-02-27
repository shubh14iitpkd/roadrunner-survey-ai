# import re
# from pymongo import MongoClient

# a = MongoClient("mongodb://localhost:27017/")["roadrunner"]["system_asset_labels"]
# aa = a.find()

# for aaa in aa:
#     d = aaa["display_name"] 
#     d2 = re.sub(r' AssetCondition \w+| VerticalClearance \w+$', '', d)
#     print(d2.strip())
#     a.update_one({"_id": aaa["_id"]}, {"$set": {"display_name": d2.strip()}})

# dmap = {}

# for aaa in aa:
#     d = aaa["display_name"]
#     if d in dmap:
#         dmap[d].append(aaa["asset_id"])
#     else:
#         dmap[d] = [aaa["asset_id"]]

# for gid, aids in dmap.items():
#     for asset_id in aids:
#         a.update_one({"asset_id": asset_id}, {"$set": {"group_id": gid}})
#         print(f"Updated {asset_id} to {gid}")

from pymongo import MongoClient, UpdateMany

# 1. Setup Connection
client = MongoClient("mongodb://localhost:27017/")
db = client["roadrunner"]

def migrate_group_ids():
    print("Fetching label mappings...")
    # 2. Get all mappings from system_asset_labels
    labels_cursor = db.system_asset_labels.find({}, {"asset_id": 1, "group_id": 1})
    
    # Create a dictionary: { "type_asset_1": "Artificial Grass", ... }
    mapping = {doc["asset_id"]: doc["group_id"] for doc in labels_cursor if "group_id" in doc}
    
    if not mapping:
        print("No group_ids found in system_asset_labels. Aborting.")
        return

    print(f"Found {len(mapping)} unique asset mappings. Updating assets...")

    # 3. Prepare bulk updates
    bulk_ops = []
    for asset_id, group_id in mapping.items():
        bulk_ops.append(
            UpdateMany(
                {"asset_id": asset_id}, 
                {"$set": {"group_id": group_id}}
            )
        )

    # 4. Execute bulk update
    if bulk_ops:
        result = db.assets.bulk_write(bulk_ops)
        print(f"Migration Complete!")
        print(f"Matched: {result.matched_count}")
        print(f"Modified: {result.modified_count}")

if __name__ == "__main__":
    migrate_group_ids()