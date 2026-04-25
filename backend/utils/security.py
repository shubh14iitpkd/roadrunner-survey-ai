import bcrypt


def hash_password(password: str) -> str:
	if not isinstance(password, str):
		password = str(password or "")
	return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def is_bcrypt_hash(value: str) -> bool:
	return isinstance(value, str) and value.startswith(("$2a$", "$2b$", "$2y$"))


def verify_password(password: str, password_hash: str) -> bool:
	if not password_hash or not isinstance(password, str) or not isinstance(password_hash, str):
		return False
	try:
		return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
	except (ValueError, TypeError):
		return False
