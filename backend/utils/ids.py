from datetime import datetime
from typing import Any

from flask import g

from db import get_db


def get_now_iso() -> str:
	return datetime.utcnow().isoformat() + "Z"


def next_sequence(sequence_name: str) -> int:
	db = get_db()
	counters = db["counters"]
	res: Any = counters.find_one_and_update(
		{"_id": sequence_name},
		{"$inc": {"seq": 1}},
		upsert=True,
		return_document=True,
	)
	return int(res.get("seq", 1))

