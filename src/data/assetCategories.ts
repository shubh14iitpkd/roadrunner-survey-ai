// Official Asset Categories and Types for Road Asset Management System
// Based on Final_Asset_Category_and_Types_1.xlsx

export interface AssetType {
  category: string;
  type: string;
  code: string;
}

export const assetCategories = [
  "DIRECTIONAL SIGNAGE",
  "ITS",
  "OTHER INFRASTRUCTURE ASSETS",
  "ROADWAY LIGHTING",
  "STRUCTURES",
  "BEAUTIFICATION"
] as const;

export const assetTypes: AssetType[] = [
  // DIRECTIONAL SIGNAGE (5 types)
  { category: "DIRECTIONAL SIGNAGE", type: "DIRECTIONAL STRUCTURE", code: "DS-001" },
  { category: "DIRECTIONAL SIGNAGE", type: "GANTRY DIRECTIONAL SIGN", code: "DS-002" },
  { category: "DIRECTIONAL SIGNAGE", type: "POLE DIRECTIONAL SIGN", code: "DS-003" },
  { category: "DIRECTIONAL SIGNAGE", type: "STREET SIGN", code: "DS-004" },
  { category: "DIRECTIONAL SIGNAGE", type: "TRAFFIC SIGN", code: "DS-005" },

  // ITS (18 types)
  { category: "ITS", type: "AIR QUALITY MONITORING SYSTEM (AQMS)", code: "ITS-001" },
  { category: "ITS", type: "CLOSED CIRCUIT TELEVISION (CCTV)", code: "ITS-002" },
  { category: "ITS", type: "DYNAMIC MESSAGE SIGN (DMS)", code: "ITS-003" },
  { category: "ITS", type: "EMERGENCY PHONE", code: "ITS-004" },
  { category: "ITS", type: "FIRE EXTINGUISHER", code: "ITS-005" },
  { category: "ITS", type: "ITS ENCLOSURE", code: "ITS-006" },
  { category: "ITS", type: "ITS FEEDER PILLAR", code: "ITS-007" },
  { category: "ITS", type: "ITS STRUCTURE", code: "ITS-008" },
  { category: "ITS", type: "LANE CONTROL SIGNS (LCS)", code: "ITS-009" },
  { category: "ITS", type: "OVER-HEIGHT VEHICLE DETECTION SYSTEM (OVDS)", code: "ITS-010" },
  { category: "ITS", type: "OVDS SPEAKER", code: "ITS-011" },
  { category: "ITS", type: "ROAD WEATHER INFORMATION SYSTEM (RWIS)", code: "ITS-012" },
  { category: "ITS", type: "SMALL DYNAMIC MESSAGING SIGN", code: "ITS-013" },
  { category: "ITS", type: "TRAFFIC SIGNAL", code: "ITS-014" },
  { category: "ITS", type: "TRAFFIC SIGNAL FEEDER PILLAR", code: "ITS-015" },
  { category: "ITS", type: "TRAFFIC SIGNAL HEAD", code: "ITS-016" },
  { category: "ITS", type: "TRAFFIC SIGNAL JUNCTION", code: "ITS-017" },
  { category: "ITS", type: "VEHICLE RESTRAINT SYSTEM", code: "ITS-018" },

  // OTHER INFRASTRUCTURE ASSETS (24 types)
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "ANIMAL FENCE", code: "OIA-001" },
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "ANIMAL GRID", code: "OIA-002" },
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "CRASH CUSHION", code: "OIA-003" },
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "FENCE", code: "OIA-004" },
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "GUARDRAIL", code: "OIA-005" },
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "TRAFFIC BOLLARD", code: "OIA-006" },
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "KERB", code: "OIA-007" },
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "ROAD MARKING LINE", code: "OIA-008" },
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "ROAD MARKING POINT", code: "OIA-009" },
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "ROAD MARKING POLYGON", code: "OIA-010" },
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "ROAD STUDS", code: "OIA-011" },
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "RUMBLE STRIP", code: "OIA-012" },
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "SPEED HUMPS", code: "OIA-013" },
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "ACCESSWAY", code: "OIA-014" },
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "BICYCLE LANE", code: "OIA-015" },
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "CARRIAGEWAY", code: "OIA-016" },
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "CENTRAL ROUNDABOUT ISLAND", code: "OIA-017" },
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "FOOTPATH", code: "OIA-018" },
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "JUNCTION ISLAND", code: "OIA-019" },
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "MEDIAN", code: "OIA-020" },
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "PARKING BAY", code: "OIA-021" },
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "SEPERATOR ISLAND", code: "OIA-022" },
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "SHOULDER", code: "OIA-023" },
  { category: "OTHER INFRASTRUCTURE ASSETS", type: "MONUMENT", code: "OIA-024" },

  // ROADWAY LIGHTING (3 types)
  { category: "ROADWAY LIGHTING", type: "STREET LIGHT FEEDER PILLAR", code: "RL-001" },
  { category: "ROADWAY LIGHTING", type: "STREET LIGHT POLE", code: "RL-002" },
  { category: "ROADWAY LIGHTING", type: "UNDERPASS LUMINAIRE", code: "RL-003" },

  // STRUCTURES (14 types)
  { category: "STRUCTURES", type: "BRIDGE", code: "ST-001" },
  { category: "STRUCTURES", type: "CABLE BRIDGE", code: "ST-002" },
  { category: "STRUCTURES", type: "CAMEL CROSSING", code: "ST-003" },
  { category: "STRUCTURES", type: "CULVERT", code: "ST-004" },
  { category: "STRUCTURES", type: "FLYOVER", code: "ST-005" },
  { category: "STRUCTURES", type: "FOOTBRIDGE", code: "ST-006" },
  { category: "STRUCTURES", type: "OVERPASS OP (ONLY PEDESTRIAN)", code: "ST-007" },
  { category: "STRUCTURES", type: "OVERPASS OV", code: "ST-008" },
  { category: "STRUCTURES", type: "PEDESTRAIN UNDERPASS", code: "ST-009" },
  { category: "STRUCTURES", type: "RETAINING WALL", code: "ST-010" },
  { category: "STRUCTURES", type: "TOLL GATE", code: "ST-011" },
  { category: "STRUCTURES", type: "TUNNEL", code: "ST-012" },
  { category: "STRUCTURES", type: "UNDERPASS", code: "ST-013" },
  { category: "STRUCTURES", type: "VIADUCT", code: "ST-014" },

  // BEAUTIFICATION (23 types)
  { category: "BEAUTIFICATION", type: "ARTIFICIAL GRASS", code: "BF-001" },
  { category: "BEAUTIFICATION", type: "BENCH", code: "BF-002" },
  { category: "BEAUTIFICATION", type: "BIKE RACK", code: "BF-003" },
  { category: "BEAUTIFICATION", type: "BIN", code: "BF-004" },
  { category: "BEAUTIFICATION", type: "DECORATIVE FENCE", code: "BF-005" },
  { category: "BEAUTIFICATION", type: "FITNESS EQUIPMENT", code: "BF-006" },
  { category: "BEAUTIFICATION", type: "FLOWER BED", code: "BF-007" },
  { category: "BEAUTIFICATION", type: "FOUNTAIN", code: "BF-008" },
  { category: "BEAUTIFICATION", type: "GARDEN", code: "BF-009" },
  { category: "BEAUTIFICATION", type: "GRAVEL AREA", code: "BF-010" },
  { category: "BEAUTIFICATION", type: "HEDGE", code: "BF-011" },
  { category: "BEAUTIFICATION", type: "HOARDING", code: "BF-012" },
  { category: "BEAUTIFICATION", type: "INTERLOCK AREA", code: "BF-013" },
  { category: "BEAUTIFICATION", type: "JOGGER TRACK", code: "BF-014" },
  { category: "BEAUTIFICATION", type: "KERBSTONE", code: "BF-015" },
  { category: "BEAUTIFICATION", type: "LANDSCAPE LIGHT", code: "BF-016" },
  { category: "BEAUTIFICATION", type: "NATURAL GRASS", code: "BF-017" },
  { category: "BEAUTIFICATION", type: "PLANTER POT", code: "BF-018" },
  { category: "BEAUTIFICATION", type: "RECESSED LIGHT", code: "BF-019" },
  { category: "BEAUTIFICATION", type: "ROAD BATTER", code: "BF-020" },
  { category: "BEAUTIFICATION", type: "SAND AREA", code: "BF-021" },
  { category: "BEAUTIFICATION", type: "TREE", code: "BF-022" },
  { category: "BEAUTIFICATION", type: "TREEGUARD", code: "BF-023" },
];

export const getCategoryIcon = (category: string) => {
  switch (category) {
    case "DIRECTIONAL SIGNAGE":
      return "signpost";
    case "ITS":
      return "cpu";
    case "OTHER INFRASTRUCTURE ASSETS":
      return "layers";
    case "ROADWAY LIGHTING":
      return "lightbulb";
    case "STRUCTURES":
      return "building-2";
    case "BEAUTIFICATION":
      return "trees";
    default:
      return "box";
  }
};

export const getCategoryColor = (category: string) => {
  switch (category) {
    case "DIRECTIONAL SIGNAGE":
      return "from-blue-500 to-blue-600";
    case "ITS":
      return "from-purple-500 to-purple-600";
    case "OTHER INFRASTRUCTURE ASSETS":
      return "from-amber-500 to-amber-600";
    case "ROADWAY LIGHTING":
      return "from-yellow-500 to-yellow-600";
    case "STRUCTURES":
      return "from-green-500 to-green-600";
    case "BEAUTIFICATION":
      return "from-pink-500 to-pink-600";
    default:
      return "from-gray-500 to-gray-600";
  }
};
