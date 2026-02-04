"""
AI Routes - Chatbot handlers for road survey analysis
"""

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from bson import ObjectId
from db import get_db
from utils.ids import get_now_iso
from ai.lang_chatbot.lang_bot import LangChatbot
import os

ai_bp = Blueprint("ai", __name__)


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
    items = list(
        db.ai_chats.find({"user_id": ObjectId(user_id)}).sort("updated_at", -1)
    )
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
    chat = db.ai_chats.find_one(
        {"_id": ObjectId(chat_id), "user_id": ObjectId(user_id)}
    )
    if not chat:
        return jsonify({"error": "not found"}), 404

    msgs = list(
        db.ai_messages.find({"chat_id": ObjectId(chat_id)}).sort("created_at", 1)
    )
    for m in msgs:
        m["_id"] = str(m["_id"])
        m["chat_id"] = chat_id
        m["user_id"] = user_id
    return jsonify({"items": msgs})


@ai_bp.post("/chats/<chat_id>/messages")
@jwt_required()
def add_message(chat_id: str):
    """Handle user message and generate AI response using LangChatbot"""
    body = request.get_json(silent=True) or {}
    content = body.get("content")
    video_id = body.get("video_id")  # Optional: current video being discussed

    if not content:
        return jsonify({"error": "content is required"}), 400

    user_id = current_user_id_str()
    if not user_id:
        return jsonify({"error": "unauthorized"}), 401

    db = get_db()
    chat = db.ai_chats.find_one(
        {"_id": ObjectId(chat_id), "user_id": ObjectId(user_id)}
    )
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
    history = list(
        db.ai_messages.find({"chat_id": ObjectId(chat_id)})
        .sort("created_at", -1)
        .limit(10)
    )
    history.reverse()  # Chronological order

    conversation_history = [
        {"role": msg["role"], "content": msg["content"]}
        for msg in history[:-1]  # Exclude the message we just added
    ]

    # 3. Generate AI response using LangChatbot
    try:
        # Resolve video_id to normalized format if provided
        normalized_video_id = None
        if video_id:
            try:
                video_doc = db.videos.find_one({"_id": ObjectId(video_id)})
                if video_doc:
                    # Get video name from storage_url or title
                    storage_url = video_doc.get("storage_url", "")
                    title = video_doc.get("title", "")
                    if storage_url:
                        normalized_video_id = os.path.splitext(os.path.basename(storage_url))[0]
                    elif title:
                        normalized_video_id = os.path.splitext(title)[0]
                    print(f"[routes] Video lookup: {video_id} -> {normalized_video_id}")
            except Exception as e:
                print(f"[routes] Video lookup failed: {e}")
        
        # Create chatbot with video context and chat_id for memory
        chatbot = LangChatbot(video_id=normalized_video_id, chat_id=chat_id, user_id=user_id)
        ai_response_text = chatbot.ask(content)

    except Exception as e:
        print(f"[routes] Chatbot error: {e}")
        import traceback
        traceback.print_exc()
        ai_response_text = "I apologize, but I encountered an error processing your request. Please try again."

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
        {"$set": {"updated_at": get_now_iso(), "last_message_preview": content[:200]}},
    )

    # Return both messages so frontend can display conversation
    print({"user_message": user_msg, "assistant_message": ai_msg})
    return jsonify({"user_message": user_msg, "assistant_message": ai_msg}), 201


@ai_bp.delete("/chats/<chat_id>")
@jwt_required()
def delete_chat(chat_id: str):
    user_id = current_user_id_str()
    if not user_id:
        return jsonify({"error": "unauthorized"}), 401

    db = get_db()
    res = db.ai_chats.delete_one(
        {"_id": ObjectId(chat_id), "user_id": ObjectId(user_id)}
    )
    if not res.deleted_count:
        return jsonify({"error": "not found"}), 404

    db.ai_messages.delete_many({"chat_id": ObjectId(chat_id)})
    return jsonify({"ok": True})
