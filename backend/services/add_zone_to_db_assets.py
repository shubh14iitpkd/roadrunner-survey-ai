from pymongo import MongoClient
from bson import ObjectId
from ZoneMapper import ZoneMapper

def main()  :
    # Connect to local MongoDB
    client = MongoClient("mongodb://localhost:27017/")
    db = client["roadrunner"]
    assets_c = db["assets"]
    try: 
        all_assets = list(assets_c.find())
        zm =  ZoneMapper()
        # print(len(all_assets))
        frame_width = 2560
        frame_height = 1440 

        for asset in all_assets:
            box = asset["box"].values()
            side = zm.get_road_side(box, frame_width)
            zone = zm.resolve_zone(asset["asset_type"], box, frame_width, frame_height)
            # print(asset["asset_type"], side, zone)

            assets_c.update_one(
                filter = {"_id": asset["_id"]},
                update = { "$set": {
                    "side" : side,
                    "zone" : zone,
                    } }
                )
    finally:
        client.close()
        
        

        

    client.close()


if __name__ == "__main__":
    main()
