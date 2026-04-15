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
    history_cursor = (
        db.ai_messages.find(
            {"chat_id": ObjectId(chat_id), "_id": {"$ne": user_res.inserted_id}},
            {"role": 1, "content": 1, "_id": 0},
        )
        .sort("created_at", -1)
        .limit(10)
    )
    history = list(history_cursor)
    history.reverse()  # Chronological order
    print(f"[DEBUG] chat_id={chat_id} | question={content[:80]} | history_count={len(history)}")
    for i, h in enumerate(history):
        print(f"[DEBUG]   history[{i}]: role={h.get('role')} content={str(h.get('content',''))[:80]}")

    # 3. Generate AI response using LangChatbot
    try:
        chatbot = LangGraphChatbot(
            route_id=route_id,
            chat_id=chat_id, 
            user_id=user_id
        )
        ai_response_text = chatbot.ask(content, history=history)

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



@ai_bp.post("/chats/<chat_id>/edit-message")
@jwt_required()
def edit_message(chat_id: str):
    """
    Edit a previously sent user message and regenerate the AI response.
    Deletes all messages from the edited message onward, saves the new
    user message, and generates a fresh AI response.
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
      - name: body
        in: body
        required: true
        schema:
          type: object
          required:
            - message_id
            - content
          properties:
            message_id:
              type: string
              description: The _id of the message to edit
            content:
              type: string
              description: The new message content
            route_id:
              type: integer
              description: Optional route ID
    responses:
      201:
        description: Message edited and new response generated
    """
    body = request.get_json(silent=True) or {}
    message_id = body.get("message_id")
    content = body.get("content")
    route_id = body.get("route_id")

    if not message_id or not content:
        return jsonify({"error": "message_id and content are required"}), 400

    user_id = current_user_id_str()
    if not user_id:
        return jsonify({"error": "unauthorized"}), 401

    db = get_db()
    chat = db.ai_chats.find_one(
        {"_id": ObjectId(chat_id), "user_id": ObjectId(user_id)}
    )
    if not chat:
        return jsonify({"error": "not found"}), 404

    # Find the original message to get its created_at
    original_msg = db.ai_messages.find_one(
        {"_id": ObjectId(message_id), "chat_id": ObjectId(chat_id)}
    )
    if not original_msg:
        return jsonify({"error": "message not found"}), 404

    # Delete this message and all messages after it
    db.ai_messages.delete_many({
        "chat_id": ObjectId(chat_id),
        "created_at": {"$gte": original_msg["created_at"]},
    })

    # Use chat context if not provided
    if not route_id and chat.get("route_id"):
        route_id = chat.get("route_id")

    # Save the new user message
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

    # Get remaining history (messages before the edited one)
    history_cursor = (
        db.ai_messages.find(
            {"chat_id": ObjectId(chat_id), "_id": {"$ne": user_res.inserted_id}},
            {"role": 1, "content": 1, "_id": 0},
        )
        .sort("created_at", -1)
        .limit(10)
    )
    history = list(history_cursor)
    history.reverse()

    # Generate AI response
    try:
        chatbot = LangGraphChatbot(
            route_id=route_id,
            chat_id=chat_id,
            user_id=user_id
        )
        ai_response_text = chatbot.ask(content, history=history)
    except Exception as e:
        print(f"[routes] Chatbot error on edit: {e}")
        import traceback
        traceback.print_exc()
        ai_response_text = "I apologize, but I encountered an error processing your request. Please try again."

    # Save AI response
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

    # Update chat metadata
    db.ai_chats.update_one(
        {"_id": ObjectId(chat_id)},
        {"$set": {"updated_at": get_now_iso(), "last_message_preview": content[:200]}},
    )

    # Return all remaining messages so frontend can replace its state
    all_msgs = list(
        db.ai_messages.find({"chat_id": ObjectId(chat_id)}).sort("created_at", 1)
    )
    for m in all_msgs:
        m["_id"] = str(m["_id"])
        m["chat_id"] = chat_id
        m["user_id"] = str(m.get("user_id", ""))

    return jsonify({"messages": all_msgs}), 201

@ai_bp.patch("/chats/<chat_id>")
@jwt_required()
def update_chat(chat_id: str):
    """
    Update a chat session (e.g. rename)
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
      - name: body
        in: body
        required: true
        schema:
          type: object
          properties:
            title:
              type: string
              description: New chat title
    responses:
      200:
        description: Chat updated successfully
      404:
        description: Chat not found
      401:
        description: Unauthorized
    """
    user_id = current_user_id_str()
    if not user_id:
        return jsonify({"error": "unauthorized"}), 401

    body = request.get_json(silent=True) or {}
    update_fields = {}
    if "title" in body:
        update_fields["title"] = (body["title"] or "").strip() or "New Chat"
    if not update_fields:
        return jsonify({"error": "nothing to update"}), 400

    update_fields["updated_at"] = get_now_iso()

    db = get_db()
    res = db.ai_chats.update_one(
        {"_id": ObjectId(chat_id), "user_id": ObjectId(user_id)},
        {"$set": update_fields},
    )
    if not res.matched_count:
        return jsonify({"error": "not found"}), 404

    return jsonify({"ok": True})


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
