from typing import Literal

CanonicalRole = Literal["admin", "road_surveyor", "super_admin", "asset_manager", "viewer"]

DISPLAY_TO_CANONICAL = {
	"admin": "admin",
	"road surveyor": "road_surveyor",
	"road_surveyor": "road_surveyor",
	"asset manager": "asset_manager",
	"asset_manager": "asset_manager",
	"viewer": "viewer",
	"super admin": "super_admin",
	# legacy/aliases
	"surveyor": "road_surveyor",
	"asset": "asset_manager",
	"admin": "admin",
	"viewer": "viewer",
	"super_admin": "super_admin"
}

CANONICAL_TO_DISPLAY = {
	"admin": "Admin",
	"road_surveyor": "Road Surveyor",
	"asset_manager": "Asset Manager",
	"viewer": "Viewer",
	"super_admin": "Super Admin"
}


def normalize_to_canonical(role_value: str | None) -> CanonicalRole:
	if not role_value:
		return "road_surveyor"
	# Try exact match first, then lowercase, then lowercase with spaces replaced by underscores
	normalized = role_value.lower().replace(" ", "_")
	return DISPLAY_TO_CANONICAL.get(role_value, DISPLAY_TO_CANONICAL.get(role_value.lower(), DISPLAY_TO_CANONICAL.get(normalized, "road_surveyor")))  # type: ignore[return-value]


def to_display_role(canonical: CanonicalRole) -> str:
	return CANONICAL_TO_DISPLAY.get(canonical, "Road Surveyor")

