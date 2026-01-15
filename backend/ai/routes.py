from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from bson import ObjectId

from db import get_db
from utils.ids import get_now_iso

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
	items = list(db.ai_chats.find({"user_id": ObjectId(user_id)}).sort("updated_at", -1))
	for it in items:
		it["_id"] = str(it["_id"])  # to string
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
		m["_id"] = str(m["_id"])  # to string
		m["chat_id"] = chat_id
		m["user_id"] = user_id
	return jsonify({"items": msgs})


@ai_bp.post("/chats/<chat_id>/messages")
@jwt_required()
def add_message(chat_id: str):
	body = request.get_json(silent=True) or {}
	role = body.get("role")
	content = body.get("content")
	if role not in ("user", "assistant") or not content:
		return jsonify({"error": "role ('user'|'assistant') and content are required"}), 400
	user_id = current_user_id_str()
	if not user_id:
		return jsonify({"error": "unauthorized"}), 401
	db = get_db()
	chat = db.ai_chats.find_one({"_id": ObjectId(chat_id), "user_id": ObjectId(user_id)})
	if not chat:
		return jsonify({"error": "not found"}), 404
	msg = {
		"chat_id": ObjectId(chat_id),
		"user_id": ObjectId(user_id),
		"role": role,
		"content": content,
		"created_at": get_now_iso(),
	}
	res = db.ai_messages.insert_one(msg)
	db.ai_chats.update_one({"_id": ObjectId(chat_id)}, {"$set": {"updated_at": get_now_iso(), "last_message_preview": content[:200]}})
	msg["_id"] = str(res.inserted_id)
	msg["chat_id"] = chat_id
	msg["user_id"] = user_id
	return jsonify({"message": msg}), 201


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
