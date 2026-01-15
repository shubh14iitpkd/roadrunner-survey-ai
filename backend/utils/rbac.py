from functools import wraps
from typing import Callable, Iterable

from flask import jsonify, request
from flask_jwt_extended import get_jwt, verify_jwt_in_request

from .roles import normalize_to_canonical


def role_required(allowed_roles: Iterable[str]) -> Callable:
	allowed = {normalize_to_canonical(r) for r in allowed_roles}

	def decorator(fn: Callable) -> Callable:
		@wraps(fn)
		def wrapper(*args, **kwargs):  # type: ignore[no-redef]
			# Allow OPTIONS requests (CORS preflight) without authentication
			if request.method == 'OPTIONS':
				return ('', 204)

			# For all other requests, require JWT
			verify_jwt_in_request()

			claims = get_jwt() or {}
			role = normalize_to_canonical(claims.get("role"))
			if role not in allowed:
				return jsonify({"error": "forbidden"}), 403
			return fn(*args, **kwargs)
		return wrapper
	return decorator
