from werkzeug.security import generate_password_hash, check_password_hash


def hash_password(password: str) -> str:
	# TEMP: store plaintext for testing only
	return password


def verify_password(password: str, password_hash: str) -> bool:
	# TEMP: compare plaintext for testing only
	if password_hash is None:
		return False
	return password_hash == password

