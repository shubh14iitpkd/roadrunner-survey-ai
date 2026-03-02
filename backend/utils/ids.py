from datetime import datetime
from typing import Any

from flask import g

from db import get_db


def get_now_iso() -> str:
	return datetime.utcnow().isoformat() + "Z"


def next_sequence(sequence_name: str, db=None) -> int:
	if db is None:
		db = get_db()
	counters = db["counters"]
	res: Any = counters.find_one_and_update(
		{"_id": sequence_name},
		{"$inc": {"seq": 1}},
		upsert=True,
		return_document=True,
	)
	return int(res.get("seq", 1))


def generate_defect_id(db=None) -> str:
	seq = next_sequence("defectId", db=db)
	return f"DEF-{str(seq).rjust(6, '0')}"


def generate_asset_display_id(db=None) -> str:
	seq = next_sequence("asset_display_id", db=db)
	return f"AST-{str(seq).rjust(6, '0')}"
