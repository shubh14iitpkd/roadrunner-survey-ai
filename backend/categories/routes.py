from flask import Blueprint, jsonify, request

from db import get_db
from utils.rbac import role_required

categories_bp = Blueprint("categories", __name__)
master_bp = Blueprint("master", __name__)


@categories_bp.get("/")
@role_required(["admin", "surveyor", "viewer"])
def list_categories():
	"""
	List all asset categories

	tags:
	  - Categories
	security:
	  - Bearer: []
	responses:
	  200:
	    description: Categories retrieved successfully
	"""
	db = get_db()
	items = list(db.asset_categories.find({}))
	for it in items:
		it["_id"] = str(it["_id"])  # to string
	return jsonify({"items": items})


@categories_bp.post("/")
@role_required(["admin"])
def create_category():
	"""
	Create a new asset category
	
	tags:
	  - Categories
	security:
	  - Bearer: []
	parameters:
	  - name: body
	    in: body
	    required: true
	    schema:
	      type: object
	      required:
	        - key
	        - name
	      properties:
	        key:
	          type: string
	        name:
	          type: string
	responses:
	  201:
	    description: Category created successfully
	  400:
	    description: Missing required fields
	"""
	body = request.get_json(silent=True) or {}
	required = ["key", "name"]
	missing = [k for k in required if body.get(k) in (None, "")]
	if missing:
		return jsonify({"error": f"missing: {', '.join(missing)}"}), 400
	db = get_db()
	db.asset_categories.insert_one(body)
	return jsonify({"item": body}), 201


@categories_bp.put("/<key>")
@role_required(["admin"])
def update_category(key: str):
	"""
	Update an asset category
	
	tags:
	  - Categories
	security:
	  - Bearer: []
	parameters:
	  - name: key
	    in: path
	    type: string
	    required: true
	  - name: body
	    in: body
	    required: true
	    schema:
	      type: object
	responses:
	  200:
	    description: Category updated successfully
	  404:
	    description: Category not found
	"""
	body = request.get_json(silent=True) or {}
	db = get_db()
	res = db.asset_categories.find_one_and_update({"key": key}, {"$set": body})
	if not res:
		return jsonify({"error": "not found"}), 404
	return jsonify({"ok": True})


@categories_bp.delete("/<key>")
@role_required(["admin"])
def delete_category(key: str):
	"""
	Delete an asset category
	
	tags:
	  - Categories
	security:
	  - Bearer: []
	parameters:
	  - name: key
	    in: path
	    type: string
	    required: true
	responses:
	  200:
	    description: Category deleted successfully
	  404:
	    description: Category not found
	"""
	db = get_db()
	res = db.asset_categories.delete_one({"key": key})
	if not res.deleted_count:
		return jsonify({"error": "not found"}), 404
	return jsonify({"ok": True})


@master_bp.get("/assets")
@role_required(["admin", "surveyor", "viewer"])
def list_master_assets():
	"""
	List all master assets

	tags:
	  - Master Assets
	security:
	  - Bearer: []
	responses:
	  200:
	    description: Master assets retrieved successfully
	"""
	db = get_db()
	items = list(db.asset_master.find({}))
	for it in items:
		it["_id"] = str(it["_id"])  # to string
	return jsonify({"items": items})


@master_bp.post("/assets")
@role_required(["admin"])
def create_master_asset():
	"""
	Create a new master asset
	
	tags:
	  - Master Assets
	security:
	  - Bearer: []
	parameters:
	  - name: body
	    in: body
	    required: true
	    schema:
	      type: object
	      required:
	        - code
	        - name
	        - category_key
	      properties:
	        code:
	          type: string
	        name:
	          type: string
	        category_key:
	          type: string
	responses:
	  201:
	    description: Master asset created successfully
	  400:
	    description: Missing required fields
	"""
	body = request.get_json(silent=True) or {}
	required = ["code", "name", "category_key"]
	missing = [k for k in required if body.get(k) in (None, "")]
	if missing:
		return jsonify({"error": f"missing: {', '.join(missing)}"}), 400
	db = get_db()
	db.asset_master.insert_one(body)
	return jsonify({"item": body}), 201


@master_bp.put("/assets/<code>")
@role_required(["admin"])
def update_master_asset(code: str):
	"""
	Update a master asset
	
	tags:
	  - Master Assets
	security:
	  - Bearer: []
	parameters:
	  - name: code
	    in: path
	    type: string
	    required: true
	  - name: body
	    in: body
	    required: true
	    schema:
	      type: object
	responses:
	  200:
	    description: Master asset updated successfully
	  404:
	    description: Asset not found
	"""
	body = request.get_json(silent=True) or {}
	db = get_db()
	res = db.asset_master.find_one_and_update({"code": code}, {"$set": body})
	if not res:
		return jsonify({"error": "not found"}), 404
	return jsonify({"ok": True})


@master_bp.delete("/assets/<code>")
@role_required(["admin"])
def delete_master_asset(code: str):
	"""
	Delete a master asset
	
	tags:
	  - Master Assets
	security:
	  - Bearer: []
	parameters:
	  - name: code
	    in: path
	    type: string
	    required: true
	responses:
	  200:
	    description: Master asset deleted successfully
	  404:
	    description: Asset not found
	"""
	db = get_db()
	res = db.asset_master.delete_one({"code": code})
	if not res.deleted_count:
		return jsonify({"error": "not found"}), 404
	return jsonify({"ok": True})

