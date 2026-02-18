from rapidfuzz import process, fuzz
from get_resolved_map import get_resolved_map
import re

# Need to do this else fuzzy match doesn't perform well
def preprocess_name(search_term: str) -> str:
    search = search_term.lower().replace("assetcondition", "")
    search = re.sub(r'\s+', ' ', search)
    return search.strip()

def get_entity_id_from_name(search_term: str, user_id: str | None = None, resolved_map = None) -> str:
    """
    Get the asset_id or category_id from name
    """
    if resolved_map is None:
        resolved_map = get_resolved_map(user_id)
    
    cat_name_to_id = {preprocess_name(v["display_name"]).lower(): k for k, v in resolved_map["categories"].items()}
    asset_name_to_id = {preprocess_name(v["display_name"]).lower(): k for k, v in resolved_map["labels"].items()}

    cat_match = process.extractOne(search_term.lower(), cat_name_to_id.keys(), scorer=fuzz.WRatio)
    asset_match = process.extractOne(search_term.lower(), asset_name_to_id.keys(), scorer=fuzz.WRatio)

    cat_score = cat_match[1] if cat_match else 0
    asset_score = asset_match[1] if asset_match else 0
    
    THRESHOLD = 70

    if max(cat_score, asset_score) < THRESHOLD:
        return None,None,None, "Could not find the asset or category"

    if cat_score > asset_score:
        return "category", cat_name_to_id[cat_match[0]], cat_match[0]
    else:
        return "asset", asset_name_to_id[asset_match[0]], asset_match[0]

if __name__ == "__main__":
    print(get_entity_id_from_name("street light pole damaged"))
    print(get_entity_id_from_name("street light pole good"))
    print(get_entity_id_from_name("ov"))
    print(get_entity_id_from_name("its enclosure visible"))
    print(get_entity_id_from_name("gantry"))
    print(get_entity_id_from_name("grass"))
    print(get_entity_id_from_name("lcs no display"))
    print(get_entity_id_from_name("street light pole"))
    
