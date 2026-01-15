
import os
import sys
from bson import ObjectId
from dotenv import load_dotenv

# Add backend directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app import create_app
from db import get_db

def reset_video_status(video_id_str):
    load_dotenv()
    app = create_app()
    
    with app.app_context():
        # Connect directly using app config
        from pymongo import MongoClient
        client = MongoClient(app.config["MONGO_URI"])
        db = client[app.config["MONGO_DB_NAME"]]
        
        try:
            video_id = ObjectId(video_id_str)
            result = db.videos.update_one(
                {"_id": video_id},
                {"$set": {"status": "uploaded", "progress": 0}}
            )
            
            if result.modified_count > 0:
                print(f"Successfully reset video {video_id_str} to 'uploaded' status.")
            else:
                video = db.videos.find_one({"_id": video_id})
                if video:
                    print(f"Video found but not updated. Current status: {video.get('status')}")
                else:
                    print(f"Video {video_id_str} not found.")
                    
        except Exception as e:
            print(f"Error resetting video: {e}")

if __name__ == "__main__":
    # The ID from the user's logs: 691c79b4b4a21196d371d439
    # Wait, the log said: /api/videos/691c79b4b4a21196d371d439
    # But ObjectId is usually 24 hex chars. 
    # 691c79b4b4a21196d371d439 is 24 chars.
    # Let's use the one from the logs.
    reset_video_status("691c79b4b4a21196d371d439")
