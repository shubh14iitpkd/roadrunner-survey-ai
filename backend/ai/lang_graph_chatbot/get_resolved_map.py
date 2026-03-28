from db import get_db


def get_resolved_map(user_id: str | None = None):
    """Get resolved map from database for display names"""
    db = get_db()
    system_cats = list(db.system_asset_categories.find())
    system_labels = list(db.system_asset_labels.find())

    prefs = {}
    if user_id:
        try:
            prefs = db.user_preferences.find_one({"user_id": ObjectId(user_id)}) or {}
        except:
            prefs = {}
    
    labels_override = prefs.get("label_overrides", {})
    cat_override = prefs.get("category_overrides", {})
 
    categories = {}
    for cat in system_cats:
        cid = cat["category_id"]
        categories[cid] = {
            "display_name": cat_override.get(cid, {}).get("display_name") or cat["display_name"],
            "default_name": cat["default_name"]
        }
    
    labels = {}
    for l in system_labels:
        aid = l["asset_id"]
        labels[aid] = {
            "display_name": labels_override.get(aid, {}).get("display_name") or l["display_name"],
            "default_name": l["default_name"],
            "category_id": l.get("category_id"),
            "group_id": l.get("group_id")
        }
    
    result = {"categories": categories, "labels": labels}
    return result

if __name__ == "__main__":
    print(get_resolved_map())
