"""
AI Routes - Chatbot handlers for road survey analysis
"""

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from bson import ObjectId
from db import get_db
from utils.ids import get_now_iso
from ai.lang_graph_chatbot.chatbot import LangGraphChatbot
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
    """
    Create a new chat session
    ---
    tags:
      - AI
    security:
      - Bearer: []
    parameters:
      - name: body
        in: body
        required: true
        schema:
          type: object
          properties:
            title:
              type: string
              description: Chat title
    responses:
      201:
        description: Chat created successfully
      401:
        description: Unauthorized
    """
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
    """
    List user's chat sessions
    ---
    tags:
      - AI
    security:
      - Bearer: []
    responses:
      200:
        description: List of chats retrieved successfully
      401:
        description: Unauthorized
    """
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
    """
    List messages in a chat
    ---
    tags:
      - AI
    security:
      - Bearer: []
    parameters:
      - name: chat_id
        in: path
        type: string
        required: true
        description: The ID of the chat
    responses:
      200:
        description: Messages retrieved successfully
      404:
        description: Chat not found
      401:
        description: Unauthorized
    """
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
    """
    Send a message to the AI chatbot
    ---
    tags:
      - AI
    description: Handle user message and generate AI response using LangChatbot
    security:
      - Bearer: []
    parameters:
      - name: chat_id
        in: path
        type: string
        required: true
        description: The ID of the chat
      - name: body
        in: body
        required: true
        schema:
          type: object
          required:
            - content
          properties:
            content:
              type: string
              description: The user's message
            route_id:
              type: integer
              description: Optional ID of the route being discussed
    responses:
      201:
        description: Message sent and response received
        schema:
          type: object
          properties:
            user_message:
              type: object
            assistant_message:
              type: object
      400:
        description: Content is required
      401:
        description: Unauthorized
      404:
        description: Chat not found
    """
    """Handle user message and generate AI response using LangChatbot"""
    body = request.get_json(silent=True) or {}
    content = body.get("content")
    route_id = body.get("route_id")  # Optional: current route being discussed
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

    # Use chat context if not provided in message
    if not route_id and chat.get("route_id"):
        route_id = chat.get("route_id")

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

    # 3. Generate AI response using LangChatbot
    try:
        chatbot = LangGraphChatbot(
            route_id=route_id,
            chat_id=chat_id, 
            user_id=user_id
        )
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
    """
    Delete a chat session
    ---
    tags:
      - AI
    security:
      - Bearer: []
    parameters:
      - name: chat_id
        in: path
        type: string
        required: true
        description: The ID of the chat
    responses:
      200:
        description: Chat deleted successfully
      404:
        description: Chat not found
      401:
        description: Unauthorized
    """
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
