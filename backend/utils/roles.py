from typing import Literal

CanonicalRole = Literal["admin", "road_surveyor", "asset_manager", "viewer"]

DISPLAY_TO_CANONICAL = {
	"Admin": "admin",
	"Road Surveyor": "road_surveyor",
	"Asset Manager": "asset_manager",
	"Viewer": "viewer",
	# legacy/aliases
	"surveyor": "road_surveyor",
	"asset": "asset_manager",
	"admin": "admin",
	"viewer": "viewer",
}

CANONICAL_TO_DISPLAY = {
	"admin": "Admin",
	"road_surveyor": "Road Surveyor",
	"asset_manager": "Asset Manager",
	"viewer": "Viewer",
}


def normalize_to_canonical(role_value: str | None) -> CanonicalRole:
	if not role_value:
		return "road_surveyor"
	return DISPLAY_TO_CANONICAL.get(role_value, DISPLAY_TO_CANONICAL.get(role_value.title(), "road_surveyor"))  # type: ignore[return-value]


def to_display_role(canonical: CanonicalRole) -> str:
	return CANONICAL_TO_DISPLAY.get(canonical, "Road Surveyor")

