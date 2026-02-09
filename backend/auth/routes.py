from datetime import timedelta

from flask import Blueprint, jsonify, request
from flask_jwt_extended import (
	create_access_token,
	create_refresh_token,
	get_jwt_identity,
	jwt_required,
)

from db import get_db
from utils.security import hash_password, verify_password
from utils.roles import normalize_to_canonical, to_display_role


auth_bp = Blueprint("auth", __name__)


@auth_bp.post("/signup")
def signup():
	"""
	User signup
	---
	tags:
	  - Auth
	parameters:
	  - name: body
	    in: body
	    required: true
	    schema:
	      type: object
	      required:
	        - email
	        - password
	      properties:
	        name:
	          type: string
	        email:
	          type: string
	        password:
	          type: string
	        role:
	          type: string
	        first_name:
	          type: string
	        last_name:
	          type: string
	        organisation:
	          type: string
	responses:
	  201:
	    description: User created successfully
	  400:
	    description: Missing email or password
	  409:
	    description: Email already registered
	"""
	body = request.get_json(silent=True) or {}
	name = (body.get("name") or "").strip()
	email_raw = (body.get("email") or "").strip()
	email = email_raw.lower()
	password = body.get("password") or ""
	role_input = body.get("role")
	canonical_role = normalize_to_canonical(role_input)
	first_name = (body.get("first_name") or "").strip()
	last_name = (body.get("last_name") or "").strip()
	organisation = (body.get("organisation") or "").strip()
	if not email or not password:
		return jsonify({"error": "email and password are required"}), 400

	db = get_db()
	if db.users.find_one({"email_lower": email}):
		return jsonify({"error": "email already registered"}), 409

	password_hash = hash_password(password)
	user_doc = {
		"name": name,
		"first_name": first_name,
		"last_name": last_name,
		"organisation": organisation,
		"email": email_raw,
		"email_lower": email,
		"password_hash": password_hash,
		"role": canonical_role,  # store canonical
		"is_verified": True,
	}
	insert_result = db.users.insert_one(user_doc)
	user_id = str(insert_result.inserted_id)

	access_token = create_access_token(
		identity=user_id,
		expires_delta=timedelta(hours=12),
		additional_claims={"email": email_raw, "role": canonical_role},
	)
	refresh_token = create_refresh_token(
		identity=user_id,
		additional_claims={"email": email_raw, "role": canonical_role},
	)
	return (
		jsonify(
			{
				"access_token": access_token,
				"refresh_token": refresh_token,
				"user": {
					"_id": user_id,
					"email": email_raw,
					"name": name,
					"first_name": first_name,
					"last_name": last_name,
					"organisation": organisation,
					"role": to_display_role(canonical_role),
				},
			}
		),
		201,
	)


@auth_bp.post("/login")
def login():
	"""
	User login
	---
	tags:
	  - Auth
	parameters:
	  - name: body
	    in: body
	    required: true
	    schema:
	      type: object
	      required:
	        - email
	        - password
	      properties:
	        email:
	          type: string
	        password:
	          type: string
	responses:
	  200:
	    description: Login successful
	  400:
	    description: Missing email or password
	  401:
	    description: Invalid credentials
	"""
	body = request.get_json(silent=True) or {}
	email_raw = (body.get("email") or "").strip()
	email = email_raw.lower()
	password = body.get("password") or ""
	if not email or not password:
		return jsonify({"error": "email and password are required"}), 400

	db = get_db()
	user = db.users.find_one({"email_lower": email})
	if not user or not verify_password(password, user.get("password_hash", "")):
		return jsonify({"error": "invalid credentials"}), 401

	user_id = str(user["_id"])  # BSON ObjectId -> string
	canonical_role = normalize_to_canonical(user.get("role"))
	access_token = create_access_token(
		identity=user_id,
		expires_delta=timedelta(hours=12),
		additional_claims={"email": user.get("email"), "role": canonical_role},
	)
	refresh_token = create_refresh_token(
		identity=user_id,
		additional_claims={"email": user.get("email"), "role": canonical_role},
	)
	return jsonify({
		"access_token": access_token,
		"refresh_token": refresh_token,
		"user": {
			"_id": user_id,
			"email": user.get("email"),
			"name": user.get("name", ""),
			"first_name": user.get("first_name", ""),
			"last_name": user.get("last_name", ""),
			"organisation": user.get("organisation", ""),
			"role": to_display_role(canonical_role),
		},
	})


@auth_bp.post("/refresh")
@jwt_required(refresh=True)
def refresh():
	"""
	Refresh access token
	---
	tags:
	  - Auth
	security:
	  - Bearer: []
	responses:
	  200:
	    description: Token refreshed successfully
	    schema:
	      type: object
	      properties:
	        access_token:
	          type: string
	"""
	current_identity = get_jwt_identity()
	access_token = create_access_token(identity=current_identity, expires_delta=timedelta(hours=12))
	return jsonify({"access_token": access_token})


@auth_bp.get("/me")
@jwt_required()
def me():
	"""
	Get current user profile
	---
	tags:
	  - Auth
	security:
	  - Bearer: []
	responses:
	  200:
	    description: User profile retrieved successfully
	  401:
	    description: Unauthorized
	  404:
	    description: User not found
	"""
	identity = get_jwt_identity() or ""
	if not identity:
		return jsonify({"error": "unauthorized"}), 401

	db = get_db()
	try:
		from bson import ObjectId
		user = db.users.find_one({"_id": ObjectId(identity)})
	except:
		user = None

	if not user:
		return jsonify({"error": "user not found"}), 404

	canonical_role = normalize_to_canonical(user.get("role"))
	return jsonify({
		"user": {
			"_id": identity,
			"email": user.get("email"),
			"name": user.get("name", ""),
			"first_name": user.get("first_name", ""),
			"last_name": user.get("last_name", ""),
			"organisation": user.get("organisation", ""),
			"role": to_display_role(canonical_role),
		}
	})

