"""
INTEGRATION GUIDE: How to connect chatbot_ai.py with your routes.py

Your routes.py already handles:
✓ Chat creation and management (POST /chats, GET /chats)
✓ Message storage (POST /chats/{id}/messages, GET /chats/{id}/messages)
✓ User authentication (JWT)

You need to:
1. Place chatbot_ai.py in your ai/ folder
2. Update your routes.py add_message endpoint to generate AI responses
3. Install required packages

This is the MODIFIED routes.py with AI integration:
"""

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from bson import ObjectId
from db import get_db
from utils.ids import get_now_iso
from ai.chatbot import get_chatbot
from ai.demo_chatbot import get_demo_chatbot, DemoChatbot  # Demo chatbot for library videos
from ai.video_handler import VideoRAGHandler
from werkzeug.utils import secure_filename
import boto3
from botocore.exceptions import ClientError
import uuid
import os

ai_bp = Blueprint("ai", __name__)

# Demo video IDs (library videos with preprocessed JSON data)
DEMO_VIDEO_IDS = ['2025_0817_115147_F', '2025_0817_115647_F', '2025_0817_120147_F']

# Initialize video RAG handler
video_rag_handler = VideoRAGHandler()

def current_user_id_str() -> str | None:
    identity = get_jwt_identity()
    if isinstance(identity, str) and identity:
        return identity
    return None

@ai_bp.post("/chats")
@jwt_required()
def create_chat():
    body = request.get_json(silent=True) or {}
    title = (body.get("title") or "New Chat").strip() or "New Chat"
    user_id = current_user_id_str()
    if not user_id:
        return jsonify({"error": "unauthorized"}), 401
    
    db = get_db()
    doc = {
        "user_id": ObjectId(user_id),
        "title": title,
        "created_at": get_now_iso(),
        "updated_at": get_now_iso(),
    }
    res = db.ai_chats.insert_one(doc)
    doc["_id"] = str(res.inserted_id)
    doc["user_id"] = user_id
    return jsonify({"chat": doc}), 201

@ai_bp.get("/chats")
@jwt_required()
def list_chats():
    user_id = current_user_id_str()
    if not user_id:
        return jsonify({"error": "unauthorized"}), 401
    
    db = get_db()
    items = list(db.ai_chats.find({"user_id": ObjectId(user_id)}).sort("updated_at", -1))
    for it in items:
        it["_id"] = str(it["_id"])
        it["user_id"] = user_id
    return jsonify({"items": items})

@ai_bp.get("/chats/<chat_id>/messages")
@jwt_required()
def list_messages(chat_id: str):
    user_id = current_user_id_str()
    if not user_id:
        return jsonify({"error": "unauthorized"}), 401
    
    db = get_db()
    chat = db.ai_chats.find_one({"_id": ObjectId(chat_id), "user_id": ObjectId(user_id)})
    if not chat:
        return jsonify({"error": "not found"}), 404
    
    msgs = list(db.ai_messages.find({"chat_id": ObjectId(chat_id)}).sort("created_at", 1))
    for m in msgs:
        m["_id"] = str(m["_id"])
        m["chat_id"] = chat_id
        m["user_id"] = user_id
    return jsonify({"items": msgs})

@ai_bp.post("/chats/<chat_id>/messages")
@jwt_required()
def add_message(chat_id: str):
    body = request.get_json(silent=True) or {}
    content = body.get("content")
    video_id = body.get("video_id")  # Optional: current video being discussed
    
    if not content:
        return jsonify({"error": "content is required"}), 400
    
    user_id = current_user_id_str()
    if not user_id:
        return jsonify({"error": "unauthorized"}), 401
    
    db = get_db()
    chat = db.ai_chats.find_one({"_id": ObjectId(chat_id), "user_id": ObjectId(user_id)})
    if not chat:
        return jsonify({"error": "not found"}), 404
    
    # 1. Save user message
    user_msg = {
        "chat_id": ObjectId(chat_id),
        "user_id": ObjectId(user_id),
        "role": "user",
        "content": content,
        "created_at": get_now_iso(),
    }
    user_res = db.ai_messages.insert_one(user_msg)
    user_msg["_id"] = str(user_res.inserted_id)
    user_msg["chat_id"] = chat_id
    user_msg["user_id"] = user_id
    
    # 2. Get conversation history (last 10 messages for context)
    history = list(db.ai_messages.find(
        {"chat_id": ObjectId(chat_id)}
    ).sort("created_at", -1).limit(10))
    history.reverse()  # Chronological order
    
    conversation_history = [
        {"role": msg["role"], "content": msg["content"]}
        for msg in history[:-1]  # Exclude the message we just added
    ]
    
    # 3. Generate AI response - use demo chatbot for library videos (asset queries only)
    try:
        import re
        import os
        
        # Detect if this is a timestamp/frame query (should go to regular chatbot for DB lookup)
        content_lower = content.lower()
        is_timestamp_query = bool(
            re.search(r'\d+:\d+', content) or  # "at 2:30", "1:45"
            re.search(r'\d+\s*(seconds?|sec|s)\b', content_lower) or  # "at 30 seconds"
            'frame' in content_lower or  # "frame 45", "what frame"
            'timestamp' in content_lower or  # "at timestamp"
            'at time' in content_lower or  # "at time"
            "what's at" in content_lower or  # "what's at 2:30"
            "whats at" in content_lower  # typo variant
        )
        
        # Check if video_id is provided and lookup in database to get filename
        normalized_video_id = None
        if video_id:
            try:
                # video_id is a MongoDB ObjectId - lookup the video to get title
                video_doc = db.videos.find_one({"_id": ObjectId(video_id)})
                if video_doc and video_doc.get('title'):
                    # Extract basename from title (e.g., "2025_0817_120147_F.mp4" -> "2025_0817_120147_F")
                    title = video_doc['title']
                    normalized_video_id = os.path.splitext(title)[0]
                    print(f"Video lookup: {video_id} -> title: {title} -> basename: {normalized_video_id}")
            except Exception as e:
                print(f"Could not lookup video {video_id}: {e}")
        
        # Route decision:
        # - Timestamp/frame queries -> regular chatbot (needs DB lookup)
        # - Asset queries on demo videos -> demo chatbot (uses preprocessed JSON)
        # - Everything else -> regular chatbot
        if normalized_video_id and normalized_video_id in DEMO_VIDEO_IDS and not is_timestamp_query:
            print(f"Demo video detected: {normalized_video_id} - using demo chatbot for asset query")
            demo_chatbot = get_demo_chatbot()
            ai_response_text = demo_chatbot.ask(content, video_id=normalized_video_id)
        else:
            if is_timestamp_query:
                print(f"Timestamp/frame query detected - using regular chatbot for DB lookup")
            # Use regular chatbot for uploaded videos, timestamp queries, and general queries
            chatbot = get_chatbot()
            ai_response_text = chatbot.ask(content, conversation_history=conversation_history, chat_id=chat_id)
    except Exception as e:
        print(f"Chatbot error: {e}")
        import traceback
        traceback.print_exc()
        ai_response_text = f"Error processing query: {str(e)}"
    
    # 4. Save AI response
    ai_msg = {
        "chat_id": ObjectId(chat_id),
        "user_id": ObjectId(user_id),
        "role": "assistant",
        "content": ai_response_text,
        "created_at": get_now_iso(),
    }
    ai_res = db.ai_messages.insert_one(ai_msg)
    ai_msg["_id"] = str(ai_res.inserted_id)
    ai_msg["chat_id"] = chat_id
    ai_msg["user_id"] = user_id
    
    # 5. Update chat metadata
    db.ai_chats.update_one(
        {"_id": ObjectId(chat_id)},
        {"$set": {
            "updated_at": get_now_iso(),
            "last_message_preview": content[:200]
        }}
    )
    
    # Return both messages so frontend can display conversation
    return jsonify({
        "user_message": user_msg,
        "assistant_message": ai_msg
    }), 201

@ai_bp.delete("/chats/<chat_id>")
@jwt_required()
def delete_chat(chat_id: str):
    user_id = current_user_id_str()
    if not user_id:
        return jsonify({"error": "unauthorized"}), 401
    
    db = get_db()
    res = db.ai_chats.delete_one({"_id": ObjectId(chat_id), "user_id": ObjectId(user_id)})
    if not res.deleted_count:
        return jsonify({"error": "not found"}), 404
    
    db.ai_messages.delete_many({"chat_id": ObjectId(chat_id)})
    return jsonify({"ok": True})

@ai_bp.route('/chats/<chat_id>/videos', methods=['GET'])
@jwt_required()
def get_chat_videos(chat_id):
    """Get all videos uploaded to a specific chat"""
    try:
        user_id = current_user_id_str()
        db = get_db()
        
        # Get videos for this chat
        videos = list(db.video_processing_results.find(
            {'chat_id': chat_id},
            {
                '_id': 0,
                'video_id': 1,
                'road_name': 1,
                'road_section': 1,
                'surveyor': 1,
                'total_defects': 1,
                'severity_distribution': 1,
                'processing_date': 1,
                'metadata.duration_seconds': 1,
                'metadata.file_size_mb': 1
            }
        ))
        
        return jsonify({
            'success': True,
            'chat_id': chat_id,
            'videos': videos,
            'count': len(videos)
        }), 200
        
    except Exception as e:
        print(f"Error getting chat videos: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@ai_bp.post("/generate-upload-url")
@jwt_required()
def generate_upload_url():
    """Generate presigned URL for direct S3 upload"""
    user_id = current_user_id_str()
    if not user_id:
        return jsonify({"error": "unauthorized"}), 401
    
    body = request.get_json(silent=True) or {}
    filename = body.get('filename')
    
    if not filename:
        return jsonify({"error": "filename is required"}), 400
    
    try:
        # Generate unique video ID
        video_id = f"{uuid.uuid4().hex}_{secure_filename(filename)}"
        s3_key = f"video-rag-test/{video_id}"
        
        # Create S3 client with explicit region
        s3_client = boto3.client('s3', region_name=os.getenv('AWS_REGION', 'ap-south-1'))
        
        # Generate presigned POST (allows direct browser upload)
        presigned_post = s3_client.generate_presigned_post(
            Bucket='datanh11',
            Key=s3_key,
            Fields={
                'Content-Type': 'video/mp4',
                'acl': 'private'
            },
            Conditions=[
                {'Content-Type': 'video/mp4'},
                {'acl': 'private'},
                ['content-length-range', 0, 2147483648]  # Max 2GB
            ],
            ExpiresIn=3600  # 1 hour
        )
        
        return jsonify({
            'video_id': video_id,
            's3_key': s3_key,
            's3_url': f"s3://datanh11/{s3_key}",
            'upload_url': presigned_post['url'],
            'upload_fields': presigned_post['fields']
        }), 200
        
    except ClientError as e:
        error_msg = str(e)
        print(f"S3 ClientError: {error_msg}")
        return jsonify({"error": f"S3 error: {error_msg}"}), 500
    except Exception as e:
        error_msg = str(e)
        print(f"Upload URL generation error: {error_msg}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Failed to generate upload URL: {error_msg}"}), 500

@ai_bp.post("/process-video")
@jwt_required()
def process_video():
    """Process video with RAG pipeline - supports both file upload and S3 path"""
    user_id = current_user_id_str()
    if not user_id:
        return jsonify({"error": "unauthorized"}), 401
    
    # Check if S3 path provided (new flow)
    body = request.form if request.files else (request.get_json(silent=True) or {})
    s3_key = body.get('s3_key')
    video_id = body.get('video_id')
    
    if s3_key:
        # New S3 flow
        road_name = body.get('road_name', 'Unknown Road')
        road_section = body.get('road_section', 'Unknown Section')
        surveyor = body.get('surveyor', 'Unknown')
        chat_id = body.get('chat_id')
        
        try:
            # Download from S3 to temporary location
            s3_client = boto3.client('s3')
            upload_dir = os.path.join(os.getcwd(), 'backend', 'uploads', 'videos')
            os.makedirs(upload_dir, exist_ok=True)
            video_path = os.path.join(upload_dir, video_id)
            
            # Download file from S3
            s3_client.download_file('datanh11', s3_key, video_path)
            
            # Process with video RAG handler
            result = video_rag_handler.process_video(
                video_path=video_path,
                video_id=video_id,
                road_name=road_name,
                road_section=road_section,
                surveyor=surveyor,
                user_id=user_id,
                chat_id=chat_id
            )
            
            return jsonify(result), 200
            
        except Exception as e:
            return jsonify({"error": f"Processing failed: {str(e)}"}), 500
    
    # Fallback: Old direct upload flow
    if 'video' not in request.files:
        return jsonify({"error": "No video file or s3_key provided"}), 400
    
    video_file = request.files['video']
    if video_file.filename == '':
        return jsonify({"error": "No selected file"}), 400
    
    # Get optional metadata
    road_name = body.get('road_name', 'Unknown Road')
    road_section = body.get('road_section', 'Unknown Section')
    surveyor = body.get('surveyor', 'Unknown')
    chat_id = body.get('chat_id')
    
    try:
        # Save video temporarily
        filename = secure_filename(video_file.filename)
        upload_dir = os.path.join(os.getcwd(), 'backend', 'uploads', 'videos')
        os.makedirs(upload_dir, exist_ok=True)
        video_path = os.path.join(upload_dir, filename)
        video_file.save(video_path)
        
        # Process with video RAG handler
        result = video_rag_handler.process_video(
            video_path=video_path,
            video_id=filename,
            road_name=road_name,
            road_section=road_section,
            surveyor=surveyor,
            user_id=user_id,
            chat_id=chat_id
        )
        
        return jsonify(result), 200
        
    except Exception as e:
        return jsonify({"error": f"Processing failed: {str(e)}"}), 500

@ai_bp.post("/query-video-defects")
@jwt_required()
def query_video_defects():
    """Query processed video defects using RAG"""
    user_id = current_user_id_str()
    if not user_id:
        return jsonify({"error": "unauthorized"}), 401
    
    body = request.get_json(silent=True) or {}
    query = body.get('query')
    chat_id = body.get('chat_id')  # Optional chat ID to filter results
    
    if not query:
        return jsonify({"error": "query is required"}), 400
    
    try:
        result = video_rag_handler.query_defects(query, user_id=user_id, chat_id=chat_id)
        return jsonify(result), 200
    except Exception as e:
        return jsonify({"error": f"Query failed: {str(e)}"}), 500

@ai_bp.get("/video-processing-status/<video_id>")
@jwt_required()
def get_video_processing_status(video_id: str):
    """Get processing status of a video"""
    user_id = current_user_id_str()
    if not user_id:
        return jsonify({"error": "unauthorized"}), 401
    
    try:
        status = video_rag_handler.get_processing_status(video_id, user_id=user_id)
        return jsonify(status), 200
    except Exception as e:
        return jsonify({"error": f"Failed to get status: {str(e)}"}), 500