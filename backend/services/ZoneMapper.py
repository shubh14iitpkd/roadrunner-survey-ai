import re

ZONES = ["overhead", "median", "pavement", "shoulder"]

ASSET_ZONE_MAP = {
    # ─── LANDSCAPING ───────────────────────────────────────────────
    "Artificial_Grass":                             ["median", "shoulder"],
    "Natural_Grass":                                ["median", "shoulder"],
    "Flower_Bed":                                   ["median", "shoulder"],
    "Garden":                                       ["median", "shoulder"],
    "Hedge":                                        ["median", "shoulder"],
    "Tree":                                         ["median", "shoulder"],
    "Treeguard":                                    ["median", "shoulder"],
    "Planter_Pot":                                  ["median", "shoulder"],
    "Gravel_Area":                                  ["shoulder", "median"],
    "Sand_Area":                                    ["shoulder", "median"],
    "Interlock_Area":                               ["shoulder", "median"],
    "Jogger_Track":                                 ["shoulder"],
    "Road_Batter":                                  ["shoulder"],

    # ─── STREET FURNITURE ──────────────────────────────────────────
    "Bench":                                        ["shoulder", "median"],
    "Bike_Rack":                                    ["shoulder", "median"],
    "Bin":                                          ["shoulder", "median"],
    "Fountain":                                     ["median"],
    "Fitness_Equipment":                            ["shoulder"],
    "Landscape_Light":                              ["median", "shoulder"],
    "Recessed_Light":                               ["shoulder", "median"],

    # ─── FENCING & BARRIERS ────────────────────────────────────────
    "Decorative_Fence":                             ["median", "shoulder"],
    "Fence":                                        ["shoulder", "median"],
    "Animal_Fence":                                 ["shoulder"],
    "Animal_Grid":                                  ["pavement", "shoulder"],
    "Guardrail":                                    ["shoulder", "median"],
    "Vehicle_Restraint_System":                     ["shoulder", "median"],
    "Crash_Cushion":                                ["shoulder", "median"],
    "Hoarding":                                     ["shoulder"],
    "Traffic_Bollard":                              ["median", "shoulder", "pavement"],

    # ─── ROAD SURFACE & MARKINGS ───────────────────────────────────
    "Carriageway":                                  ["pavement"],
    "Road_Marking_Line":                            ["pavement"],
    "Road_Marking_Point":                           ["pavement"],
    "Road_Marking_Polygon":                         ["pavement"],
    "Road_Studs":                                   ["pavement"],
    "Rumble_Strip":                                 ["shoulder", "pavement"],
    "Speed_Humps":                                  ["pavement"],
    "Kerb":                                         ["shoulder"],
    "Kerbstone":                                    ["shoulder"],
    "Shoulder":                                     ["shoulder"],
    "Accessway":                                    ["pavement", "shoulder"],
    "Footpath":                                     ["shoulder"],
    "Parking_Bay":                                  ["shoulder"],

    # ─── ISLANDS & MEDIANS ─────────────────────────────────────────
    "Median":                                       ["median"],
    "Central_Roundabout_Island":                    ["median"],
    "Junction_Island":                              ["median"],
    "Separator_Island":                             ["median"],

    # ─── SIGNAGE ───────────────────────────────────────────────────
    "Traffic_Sign":                                 ["shoulder", "median", "overhead"],
    "Street_Sign":                                  ["overhead", "shoulder"],
    "Pole_Directional_Sign":                        ["overhead", "shoulder", "median"],
    "Directional_Structure":                        ["overhead"],
    "Gantry_Directional_Sign":                      ["overhead"],
    "DYNAMIC_MESSAGE_SIGN_DMS":                     ["overhead"],
    "LANE_CONTROL_SIGNS_LCS":                       ["overhead"],
    "SMALL_DYNAMIC_MESSAGING_SIGN":                 ["overhead", "shoulder"],
    "OVER_HEIGHT_VEHICLE_DETECTION_SYSTEM_OVDS":    ["overhead"],
    "OVDS_SPEAKER":                                 ["overhead"],

    # ─── ITS / ELECTRONICS ─────────────────────────────────────────
    "CLOSED_CIRCUIT_TELEVISION_CCTV":               ["overhead", "shoulder"],
    "AIR_QUALITY_MONITORING_SYSTEM_AQMS":           ["shoulder", "median"],
    "ROAD_WEATHER_INFORMATION_SYSTEM_RWIS":         ["shoulder", "median"],
    "ITS_ENCLOSURE":                                ["shoulder", "median"],
    "ITS_FEEDER_PILLAR":                            ["shoulder", "median"],
    "ITS_STRUCTURE":                                ["overhead", "shoulder"],
    "EMERGENCY_PHONE":                              ["shoulder"],
    "FIRE_EXTINGUISHER":                            ["shoulder", "median"],
    "TRAFFIC_SIGNAL":                               ["overhead", "median"],
    "TRAFFIC_SIGNAL_HEAD":                          ["overhead"],
    "TRAFFIC_SIGNAL_FEEDER_PILLAR":                 ["shoulder", "median"],
    "TRAFFIC_SIGNAL_JUNCTION":                      ["overhead", "median"],

    # ─── LIGHTING ──────────────────────────────────────────────────
    "STREET_LIGHT":                                 ["overhead"],
    "STREET_LIGHT_POLE":                            ["median", "shoulder"],
    "STREET_LIGHT_FEEDER_PILLAR":                   ["shoulder", "median"],
    "UNDERPASS_LUMINAIRE":                          ["overhead"],

    # ─── STRUCTURES ────────────────────────────────────────────────
    "Bridge":                                       ["overhead"],
    "Cable_Bridge":                                 ["overhead"],
    "Flyover":                                      ["overhead"],
    "Overpass_OV":                                  ["overhead"],
    "Overpass_OP_Only_Pedestrian":                  ["overhead"],
    "Footbridge":                                   ["overhead"],
    "Viaduct":                                      ["overhead"],
    "Underpass":                                    ["overhead"],
    "Pedestrian_Underpass":                         ["overhead"],
    "Tunnel":                                       ["overhead"],
    "Camel_Crossing":                               ["overhead"],
    "Culvert":                                      ["shoulder"],
    "Retaining_Wall":                               ["shoulder"],
    "Toll_Gate":                                    ["overhead", "pavement"],
    "Monument":                                     ["median"],
}

class ZoneMapper:
    def __init__(self):
        self.asset_zone_map = ASSET_ZONE_MAP
        self.zones = ZONES
    

    def normalize_asset_class(self, raw_class: str) -> str:
        return re.sub(r'_AssetCondition_\w+|_VerticalClearance_\w+$', '', raw_class)

    def is_overhead(self, norm_class, ltwh: tuple, frame_height: int, threshold=0.55) -> bool:
        """Assets in the upper portion of frame are likely overhead structures."""
        if "overhead" not in self.asset_zone_map.get(norm_class,[]):
            return False
        _, y1, _, h = ltwh
        y2 = y1 + h
        return y2 < frame_height/2.25

    def get_road_side(self, ltwh: tuple, frame_width: int) -> str:
        """
        Returns 'LHS', 'RHS'.
        - Assumes forward-facing center-mounted camera
        """
        x1, _, w, _ = ltwh
        x2 = x1 + w
        cx = (x1 + x2) / 2

        if cx < frame_width / 2:
            return "LHS"
        else:
            return "RHS"

    def resolve_zone(self, raw_class: str, ltwh: tuple, frame_width: int, frame_height: int) -> str:
        zones = self.get_zones(raw_class)
        
        if len(zones) == 1:
            return zones[0]
        
        x1, _, w, _ = ltwh
        x2 = x1 + w
        cx = (x1 + x2) / 2
        relative_x = cx / frame_width

        if self.is_overhead(self.normalize_asset_class(raw_class), ltwh, frame_height):
            print(raw_class, "overhead")
            return "overhead"

        if relative_x < 0.15 or relative_x > 0.85:
            position_guess = "shoulder"
        elif 0.30 > relative_x or relative_x > 0.70:
            position_guess = "median"
        else:
            position_guess = "pavement"

        if position_guess in zones:
            return position_guess

        return zones[0]

    def get_zones(self, raw_class: str) -> list[str]:
        base = self.normalize_asset_class(raw_class)
        return self.asset_zone_map.get(base, ["median"])


    def get_primary_zone(self, raw_class: str) -> str:
        return get_zones(raw_class)[0]

if __name__ == "__main__":
    print(get_zones("Traffic_Sign"))
    print(get_zones("Traffic_Bollard_AssetCondition_OK"))
    print(get_zones("STREET_LIGHT_AssetCondition_OK_VerticalClearance_OK"))
