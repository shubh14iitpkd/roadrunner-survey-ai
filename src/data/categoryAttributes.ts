// Asset Category -> Asset Type -> Attribute -> Subtype hierarchical structure
// export const CATEGORY_ATTRIBUTES: Record<string, Record<string, Record<string, string[]>>> = {
export const CATEGORY_ATTRIBUTES: Record<string, Record<string, Record<string, Record<string, string>[]>>> = {
  "DIRECTIONAL SIGNAGE": {
    "DIRECTIONAL STRUCTURE": {
      "ASSET CONDITION": [
        { "Good": "Directional_Structure_AssetCondition_Good" },
        { "Damaged": "Directional_Structure_AssetCondition_Damaged" }
      ],
      "CLADDING": [
        { "Yes": "Directional_Structure_Cladding_Yes" },
        { "No": "Directional_Structure_Cladding_No" }
      ],
      "ILLUMINATED": [
        { "Yes": "Directional_Structure_Illuminated_Yes" },
        { "No": "Directional_Structure_Illuminated_No" }
      ],
      "GANTRY TYPE": [
        { "Monotube": "Directional_Structure_GantryType_Monotube" },
        { "Gantry": "Directional_Structure_GantryType_Gantry" },
        { "Pole": "Directional_Structure_GantryType_Pole" }
      ],
      "POLE TYPE": [
        { "Flange": "Directional_Structure_PoleType_Flange" },
        { "Buried": "Directional_Structure_PoleType_Buried" }
      ],
      "TYPE": [
        { "Pole": "Directional_Structure_Type_Pole" },
        { "Structure": "Directional_Structure_Type_Structure" }
      ]
    },
    "GANTRY DIRECTIONAL SIGN": {
      "SIGN MATERIAL": [
        { "Metal": "Gantry_Directional_Sign_SignMaterial_Metal" }
      ],
      "ASSET CONDITION": [
        { "Good": "Gantry_Directional_Sign_AssetCondition_Good" },
        { "Damaged": "Gantry_Directional_Sign_AssetCondition_Damaged" }
      ],
      "GANTRY TYPE": [
        { "Electronic": "Gantry_Directional_Sign_GantryType_Electronic" },
        { "Regular": "Gantry_Directional_Sign_GantryType_Regular" },
        { "Joint": "Gantry_Directional_Sign_GantryType_Joint" }
      ],
      "SIGN FACE TYPE": [
        { "Reflective": "Gantry_Directional_Sign_SignFaceType_Reflective" },
        { "Non Reflective": "Gantry_Directional_Sign_SignFaceType_Non_Reflective" }
      ],
      "SIGN SUB CATEGORY": [
        { "Primary": "Gantry_Directional_Sign_SignSubCategory_Primary" },
        { "Secondary": "Gantry_Directional_Sign_SignSubCategory_Secondary" },
        { "Tertiary": "Gantry_Directional_Sign_SignSubCategory_Tertiary" }
      ],
      "SIGN TYPE": [
        { "Gantry": "Gantry_Directional_Sign_SignType_Gantry" },
        { "Single Pole": "Gantry_Directional_Sign_SignType_Single_Pole" },
        { "Double Pole": "Gantry_Directional_Sign_SignType_Double_Pole" },
        { "Cantilever": "Gantry_Directional_Sign_SignType_Cantilever" }
      ]
    },
    "POLE DIRECTIONAL SIGN": {
      "ILLUMINATED": [
        { "Yes": "Pole_Directional_Sign_Illuminated_Yes" },
        { "No": "Pole_Directional_Sign_Illuminated_No" }
      ],
      "ASSET CONDITION": [
        { "Good": "Pole_Directional_Sign_AssetCondition_Good" },
        { "Damaged": "Pole_Directional_Sign_AssetCondition_Damaged" }
      ],
      "POLE TYPE": [
        { "Single Pole": "Pole_Directional_Sign_PoleType_Single_Pole" },
        { "Double Pole": "Pole_Directional_Sign_PoleType_Double_Pole" }
      ],
      "SIGN FACE TYPE": [
        { "Sheet": "Pole_Directional_Sign_SignFaceType_Sheet" },
        { "Blank": "Pole_Directional_Sign_SignFaceType_Blank" }
      ]
    },
    "STREET SIGN": {
      "ASSET CONDITION": [
        { "Good": "Street_Sign_AssetCondition_Good" },
        { "Damaged": "Street_Sign_AssetCondition_Damaged" }
      ],
      "POLE TYPE": [
        { "Single Pole": "Street_Sign_PoleType_Single_Pole" },
        { "Double Pole": "Street_Sign_PoleType_Double_Pole" }
      ],
      "SIGN FACE TYPE": [
        { "Reflective": "Street_Sign_SignFaceType_Reflective" },
        { "Non Reflective": "Street_Sign_SignFaceType_Non_Reflective" }
      ],
      "SIGN TYPE": [
        { "Single Wall Mounted": "Street_Sign_SignType_Single_Wall_Mounted" },
        { "Double Wall Mounted": "Street_Sign_SignType_Double_Wall_Mounted" },
        { "Single Post Mounted": "Street_Sign_SignType_Single_Post_Mounted" },
        { "Double Post Mounted": "Street_Sign_SignType_Double_Post_Mounted" }
      ]
    },
    "TRAFFIC SIGN": {
      "BACKGROUND COLOR": [
        { "Green": "Traffic_Sign_BackgroundColor_Green" },
        { "Red": "Traffic_Sign_BackgroundColor_Red" },
        { "Blue": "Traffic_Sign_BackgroundColor_Blue" },
        { "Yellow": "Traffic_Sign_BackgroundColor_Yellow" },
        { "White": "Traffic_Sign_BackgroundColor_White" },
        { "Orange": "Traffic_Sign_BackgroundColor_Orange" },
        { "Brown": "Traffic_Sign_BackgroundColor_Brown" },
        { "Black": "Traffic_Sign_BackgroundColor_Black" },
        { "Fluorescent Yellow": "Traffic_Sign_BackgroundColor_Fluorescent_Yellow" }
      ],
      "SIGN LANGUAGE": [
        { "Monolingual (Single Language)": "Traffic_Sign_SignLanguage_Monolingual_Single_Language" },
        { "Bilingual (Two Languages)": "Traffic_Sign_SignLanguage_Bilingual_Two_Languages" },
        { "Multilingual (Three or More)": "Traffic_Sign_SignLanguage_Multilingual_Three_or_More" },
        { "Symbolic (No Text)": "Traffic_Sign_SignLanguage_Symbolic_No_Text" }
      ],
      "TEXT SYMBOL COLOR": [
        { "White": "Traffic_Sign_TextSymbolColor_White" },
        { "Black": "Traffic_Sign_TextSymbolColor_Black" }
      ],
      "TRAFFIC SIGN ILLUMINATION": [
        { "Yes": "Traffic_Sign_TrafficSignIllumination_Yes" },
        { "No": "Traffic_Sign_TrafficSignIllumination_No" }
      ],
      "ASSET CONDITION": [
        { "Good": "Traffic_Sign_AssetCondition_Good" },
        { "Damaged": "Traffic_Sign_AssetCondition_Damaged" },
        { "Dirty": "Traffic_Sign_AssetCondition_Dirty" },
        { "Overgrown": "Traffic_Sign_AssetCondition_Overgrown" }
      ],
      "POLE TYPE": [
        { "Small": "Traffic_Sign_PoleType_Small" },
        { "Normal": "Traffic_Sign_PoleType_Normal" },
        { "Large": "Traffic_Sign_PoleType_Large" }
      ],
      "SIGN CATEGORY": [
        { "Primary": "Traffic_Sign_SignCategory_Primary" },
        { "Secondary": "Traffic_Sign_SignCategory_Secondary" },
        { "Tertiary": "Traffic_Sign_SignCategory_Tertiary" }
      ],
      "SIGN FACE TYPE": [
        { "Reflective": "Traffic_Sign_SignFaceType_Reflective" },
        { "Non-Reflective": "Traffic_Sign_SignFaceType_Non_Reflective" }
      ],
      "SIGN TYPE": [
        { "Wall Mounted": "Traffic_Sign_SignType_Wall_Mounted" },
        { "Post Mounted": "Traffic_Sign_SignType_Post_Mounted" }
      ]
    }
  },
  "ITS": {
    "AIR QUALITY MONITORING SYSTEM (AQMS)": {
      "ASSET CONDITION": [
        { "Good": "AIR_QUALITY_MONITORING_SYSTEM_AQMS_AssetCondition_Good" },
        { "Damaged": "AIR_QUALITY_MONITORING_SYSTEM_AQMS_AssetCondition_Damaged" }
      ]
    },
    "CLOSED CIRCUIT TELEVISION (CCTV)": {
      "SHAPE": [],
      "CAMERA TYPE": [
        { "CCTV": "Closed_Circuit_Television_CCTV_CameraType_CCTV" },
        { "AID": "Closed_Circuit_Television_CCTV_CameraType_AID" },
        { "Traffic": "Closed_Circuit_Television_CCTV_CameraType_Traffic" }
      ]
    },
    "DYNAMIC MESSAGE SIGN (DMS) / ELECTRONIC SIGNBOARDS": {
      "ASSET CONDITION": [
        { "Good": "DYNAMIC_MESSAGE_SIGN_DMS_AssetCondition_Good" },
        { "Damaged": "DYNAMIC_MESSAGE_SIGN_DMS_AssetCondition_Damaged" },
        { "No Display": "DYNAMIC_MESSAGE_SIGN_DMS_AssetCondition_NoDisplay" }
      ]
    },
    "EMERGENCY PHONE": {
      "ASSET CONDITION": [
        { "Good": "EMERGENCY_PHONE_AssetCondition_Good" },
        { "Damaged": "EMERGENCY_PHONE_AssetCondition_Damaged" }
      ]
    },
    "FIRE EXTINGUISHER": {
      "ASSET CONDITION": [
        { "Fine": "FIRE_EXTINGUISHER_AssetCondition_Fine" },
        { "Missing": "FIRE_EXTINGUISHER_AssetCondition_Missing" }
      ]
    },
    "ITS ENCLOSURE": {
      "ASSET CONDITION": [
        { "Visible": "ITS_ENCLOSURE_AssetCondition_Visible" }
      ],
      "CABINET TYPE": [
        { "Single Cabinet": "ITS_Enclosure_CabinetType_Single_Cabinet" },
        { "Double Cabinet": "ITS_Enclosure_CabinetType_Double_Cabinet" }
      ]
    },
    "ITS FEEDER PILLAR": {
      "ASSET CONDITION": [
        { "Good": "ITS_FEEDER_PILLAR_AssetCondition_Good" },
        { "Damaged": "ITS_FEEDER_PILLAR_AssetCondition_Damaged" }
      ]
    },
    "ITS STRUCTURE": {
      "ASSET CONDITION": [
        { "Good": "ITS_STRUCTURE_AssetCondition_Good" },
        { "Damaged": "ITS_STRUCTURE_AssetCondition_Damaged" }
      ],
      "DESCRIPTION": [
        { "Monopole": "ITS_Structure_Description_Monopole" },
        { "Gantry": "ITS_Structure_Description_Gantry" },
        { "Pole": "ITS_Structure_Description_Pole" }
      ],
      "STRUCTURE TYPE": [
        { "Gantry - Full Span": "ITS_Structure_StructureType_Gantry_Full_Span" },
        { "Gantry": "ITS_Structure_StructureType_Gantry" },
        { "Pole": "ITS_Structure_StructureType_Pole" },
        { "Pole with Lowering": "ITS_Structure_StructureType_Pole_with_Lowering" },
        { "Gantry - Half Span": "ITS_Structure_StructureType_Gantry_Half_Span" },
        { "Cantilever": "ITS_Structure_StructureType_Cantilever" },
        { "Pole with Split Type": "ITS_Structure_StructureType_Pole_with_Split_Type" },
        { "Pole - CLD Type": "ITS_Structure_StructureType_Pole_CLD_Type" },
        { "Pole - Ring Type": "ITS_Structure_StructureType_Pole_Ring_Type" }
      ]
    },
    "LANE CONTROL SIGNS (LCS)": {
      "NUMBER POLES": [
        { "Yes": "Lane_Control_Signs_LCS_NumberPoles_Yes" },
        { "No": "Lane_Control_Signs_LCS_NumberPoles_No" }
      ],
      "ASSET CONDITION": [
        { "Good": "LANE_CONTROL_SIGNS_LCS_AssetCondition_Good" },
        { "Damaged": "LANE_CONTROL_SIGNS_LCS_AssetCondition_Damaged" },
        { "No Display": "LANE_CONTROL_SIGNS_LCS_AssetCondition_NoDisplay" }
      ],
      "TYPE": [
        { "Central Matrix": "Lane_Control_Signs_LCS_Type_Central_Matrix" },
        { "Red Ring": "Lane_Control_Signs_LCS_Type_Red_Ring" },
        { "Lanterns": "Lane_Control_Signs_LCS_Type_Lanterns" },
        { "Display Driver": "Lane_Control_Signs_LCS_Type_Display_Driver" }
      ]
    },
    "OVER-HEIGHT VEHICLE DETECTION SYSTEM (OVDS)": {
      "FLASH BEAM": [
        { "Yes": "Over_Height_Vehicle_Detection_System_OVDS_FlashBeam_Yes" },
        { "No": "Over_Height_Vehicle_Detection_System_OVDS_FlashBeam_No" }
      ],
      "NUMBER OF LANES COVERAGE": [],
      "OVDS SIGN": [],
      "ASSET CONDITION": [
        { "Good": "OVER_HEIGHT_VEHICLE_DETECTION_SYSTEM_OVDS_AssetCondition_Good" },
        { "Damaged": "OVER_HEIGHT_VEHICLE_DETECTION_SYSTEM_OVDS_AssetCondition_Damaged" }
      ]
    },
    "OVDS SPEAKER": {
      "ASSET CONDITION": [
        { "Good": "OVDS_SPEAKER_AssetCondition_Good" },
        { "Damaged": "OVDS_SPEAKER_AssetCondition_Damaged" }
      ]
    },
    "ROAD WEATHER INFORMATION SYSTEM (RWIS)": {
      "LOCATION": [
        { "GPS of the array of devices": "Road_Weather_Information_System_RWIS_Location_GPS" }
      ]
    },
    "SMALL DYNAMIC MESSAGING SIGN": {
      "ASSET CONDITION": [
        { "Good": "SMALL_DYNAMIC_MESSAGING_SIGN_AssetCondition_Good" },
        { "Damaged": "SMALL_DYNAMIC_MESSAGING_SIGN_AssetCondition_Damaged" },
        { "Display": "SMALL_DYNAMIC_MESSAGING_SIGN_AssetCondition_Display" }
      ],
      "DESCRIPTION": [
        { "Gantry Mounted": "Small_Dynamic_Messaging_Sign_Description_Gantry_Mounted" },
        { "Portable": "Small_Dynamic_Messaging_Sign_Description_Portable" },
        { "Tunnel roof mounted": "Small_Dynamic_Messaging_Sign_Description_Tunnel_roof_mounted" },
        { "Roadside Mounted": "Small_Dynamic_Messaging_Sign_Description_Roadside_Mounted" }
      ]
    },
    "TRAFFIC SIGNAL": {
      "ARM END CAP": [
        { "Yes": "Traffic_Signal_ArmEndCap_Yes" },
        { "No": "Traffic_Signal_ArmEndCap_No" }
      ],
      "BASE COVER": [
        { "Yes": "Traffic_Signal_BaseCover_Yes" },
        { "No": "Traffic_Signal_BaseCover_No" }
      ],
      "CLADDING": [
        { "Yes": "Traffic_Signal_Cladding_Yes" },
        { "No": "Traffic_Signal_Cladding_No" }
      ],
      "PUSH BUTTONS": [
        { "Yes": "Traffic_Signal_PushButtons_Yes" },
        { "No": "Traffic_Signal_PushButtons_No" }
      ],
      "TOP END CAP": [
        { "Yes": "Traffic_Signal_TopEndCap_Yes" },
        { "No": "Traffic_Signal_TopEndCap_No" }
      ],
      "ASSET CONDITION": [
        { "Good": "TRAFFIC_SIGNAL_AssetCondition_Good" },
        { "Damaged": "TRAFFIC_SIGNAL_AssetCondition_Damaged" }
      ],
      "GANTRY TYPE": [
        { "Single-Arm Gantry": "Traffic_Signal_GantryType_Single_Arm_Gantry" },
        { "Twin-Arm Gantry": "Traffic_Signal_GantryType_Twin_Arm_Gantry" },
        { "Overhead / Full-Span Gantry": "Traffic_Signal_GantryType_Overhead_Full_Span_Gantry" },
        { "Cantilever Gantry": "Traffic_Signal_GantryType_Cantilever_Gantry" },
        { "Mast Arm Gantry": "Traffic_Signal_GantryType_Mast_Arm_Gantry" },
        { "Hybrid / Modular Gantry": "Traffic_Signal_GantryType_Hybrid_Modular_Gantry" }
      ],
      "TYPE": [
        { "Regulatory": "Traffic_Signal_Type_Regulatory" },
        { "Directional": "Traffic_Signal_Type_Directional" },
        { "Warning": "Traffic_Signal_Type_Warning" },
        { "Informatory": "Traffic_Signal_Type_Informatory" }
      ]
    },
    "TRAFFIC SIGNAL FEEDER PILLAR": {
      "ASSET CONDITION": [
        { "Good": "TRAFFIC_SIGNAL_FEEDER_PILLAR_AssetCondition_Good" },
        { "Damaged": "TRAFFIC_SIGNAL_FEEDER_PILLAR_AssetCondition_Damaged" }
      ]
    },
    "TRAFFIC SIGNAL HEAD": {
      "ASSET CONDITION": [
        { "Good": "TRAFFIC_SIGNAL_HEAD_AssetCondition_Good" },
        { "Damaged": "TRAFFIC_SIGNAL_HEAD_AssetCondition_Damaged" }
      ],
      "SIGNAL HEAD ASPECT TYPE": [
        { "1": "Traffic_Signal_Head_SignalHeadAspectType_1" },
        { "2": "Traffic_Signal_Head_SignalHeadAspectType_2" },
        { "3": "Traffic_Signal_Head_SignalHeadAspectType_3" },
        { "4": "Traffic_Signal_Head_SignalHeadAspectType_4" }
      ],
      "SIGNAL HEAD FACE TYPE": [
        { "LED": "Traffic_Signal_Head_SignalHeadFaceType_LED" },
        { "Halogen": "Traffic_Signal_Head_SignalHeadFaceType_Halogen" }
      ],
      "SIGNAL HEAD TYPE": [
        { "Pedestrian": "Traffic_Signal_Head_SignalHeadType_Pedestrian" },
        { "Vehicular": "Traffic_Signal_Head_SignalHeadType_Vehicular" },
        { "Bicycle": "Traffic_Signal_Head_SignalHeadType_Bicycle" }
      ],
      "ARROW MASK": [
        { "Yes": "Traffic_Signal_Head_ArrowMask_Yes" },
        { "No": "Traffic_Signal_Head_ArrowMask_No" }
      ],
      "LED RETROFIT": [
        { "Yes": "Traffic_Signal_Head_LedRetrofit_Yes" },
        { "No": "Traffic_Signal_Head_LedRetrofit_No" }
      ],
      "PSH COUNTDOWN": [
        { "Yes": "Traffic_Signal_Head_PshCountdown_Yes" },
        { "No": "Traffic_Signal_Head_PshCountdown_No" }
      ],
      "SIGNAL HEAD COUNT": [
        { "Yes": "Traffic_Signal_Head_SignalHeadCount_Yes" },
        { "No": "Traffic_Signal_Head_SignalHeadCount_No" }
      ],
      "SPECIAL CLAMPS FITTING": [
        { "Yes": "Traffic_Signal_Head_SpecialClampsFitting_Yes" },
        { "No": "Traffic_Signal_Head_SpecialClampsFitting_No" }
      ],
      "SPECIAL MOUNTING BRACKET": [
        { "Yes": "Traffic_Signal_Head_SpecialMountingBracket_Yes" },
        { "No": "Traffic_Signal_Head_SpecialMountingBracket_No" }
      ],
      "STOP BICYCLE MAST": [
        { "Yes": "Traffic_Signal_Head_StopBicycleMast_Yes" },
        { "No": "Traffic_Signal_Head_StopBicycleMast_No" }
      ],
      "STOP MAN MASK": [
        { "Yes": "Traffic_Signal_Head_StopManMask_Yes" },
        { "No": "Traffic_Signal_Head_StopManMask_No" }
      ],
      "WALK BICYCLE MAST": [
        { "Yes": "Traffic_Signal_Head_WalkBicycleMast_Yes" },
        { "No": "Traffic_Signal_Head_WalkBicycleMast_No" }
      ],
      "WALK MAN MASK": [
        { "Yes": "Traffic_Signal_Head_WalkManMask_Yes" },
        { "No": "Traffic_Signal_Head_WalkManMask_No" }
      ]
    },
    "TRAFFIC SIGNAL JUNCTION": {
      "CONTROLLER": [
        { "Yes": "Traffic_Signal_Junction_Controller_Yes" },
        { "No": "Traffic_Signal_Junction_Controller_No" }
      ],
      "ASSET CONDITION": [
        { "Good": "TRAFFIC_SIGNAL_JUNCTION_AssetCondition_Good" },
        { "Damaged": "Traffic_Signal_Junction_AssetCondition_Damaged" }
      ],
      "INTERSECTION TYPE": [
        { "Merge Lane": "Traffic_Signal_Junction_IntersectionType_Merge_Lane" },
        { "Roundabout": "Traffic_Signal_Junction_IntersectionType_Roundabout" },
        { "3 Leg": "Traffic_Signal_Junction_IntersectionType_3_Leg" },
        { "4 Leg": "Traffic_Signal_Junction_IntersectionType_4_Leg" }
      ],
      "SIGNAL TYPE": [
        { "Regulatory": "Traffic_Signal_Junction_SignalType_Regulatory" },
        { "Directional": "Traffic_Signal_Junction_SignalType_Directional" },
        { "Warning": "Traffic_Signal_Junction_SignalType_Warning" },
        { "Informatory": "Traffic_Signal_Junction_SignalType_Informatory" }
      ]
    }
  },

  "OTHER INFRASTRUCTURE ASSETS": {
    "ANIMAL FENCE": {
      "ASSET CONDITION": [
        { "Good": "Animal_Fence_AssetCondition_Good" },
        { "Damaged": "Animal_Fence_AssetCondition_Damaged" },
        { "Missing Panel": "Animal_Fence_AssetCondition_MissingPanel" }
      ],
      "LENGTH": [
        { "Calculate from start to finish": "Animal_Fence_Length_Calculate" }
      ]
    },
    "ANIMAL GRID": {
      "ASSET CONDITION": [
        { "Good": "Animal_Grid_AssetCondition_Good" },
        { "Damaged": "Animal_Grid_AssetCondition_Damaged" }
      ]
    },
    "CRASH CUSHION": {
      "CUSHION CONNECTION": [
        { "Yes": "Crash_Cushion_CushionConnection_Yes" },
        { "No": "Crash_Cushion_CushionConnection_No" }
      ],
      "ASSET CONDITION": [
        { "Good": "Crash_Cushion_AssetCondition_Good" },
        { "Damaged": "Crash_Cushion_AssetCondition_Damaged" },
        { "Missing": "Crash_Cushion_AssetCondition_Missing" }
      ],
      "CHAINAGE END": [],
      "CHAINAGE START": [],
      "CUSHION TYPE": [
        { "Permanent": "Crash_Cushion_CushionType_Permanent" },
        { "Temporary": "Crash_Cushion_CushionType_Temporary" }
      ]
    },
    "FENCE": {
      "FENCE COLOR": [
        { "Yes": "Fence_FenceColor_Yes" },
        { "No": "Fence_FenceColor_No" }
      ],
      "FIXING POST FENCE": [
        { "Yes": "Fence_FixingPostFence_Yes" },
        { "No": "Fence_FixingPostFence_No" }
      ],
      "ASSET CONDITION": [
        { "Good": "Fence_AssetCondition_Good" },
        { "Damaged": "Fence_AssetCondition_Damaged" },
        { "Missing": "Fence_AssetCondition_Missing" }
      ],
      "CHAINAGE END": [],
      "CHAINAGE START": [],
      "FENCE TYPE": [
        { "Pedestrian fence": "Fence_FenceType_Pedestrian_fence" },
        { "Pedestrian guard rail": "Fence_FenceType_Pedestrian_guard_rail" },
        { "Sand fence": "Fence_FenceType_Sand_fence" },
        { "Chainlink fence": "Fence_FenceType_Chainlink_fence" },
        { "Illuminated fence": "Fence_FenceType_Illuminated_fence" },
        { "Road protection fence": "Fence_FenceType_Road_protection_fence" },
        { "Ornamental fence": "Fence_FenceType_Ornamental_fence" },
        { "Strained wire / Stock proof fence": "Fence_FenceType_Strained_wire_Stock_proof_fence" },
        { "Anticlimb fence": "Fence_FenceType_Anticlimb_fence" }
      ],
      "POST TYPE": [
        { "Selflock type": "Fence_PostType_Selflock_type" },
        { "Normal bolting": "Fence_PostType_Normal_bolting" },
        { "Clamping": "Fence_PostType_Clamping" }
      ],
      // "SHAPE.LEN": ["Calculate from start to finish"]
    },
    "GUARDRAIL": {
      "ASSET CONDITION": [
        { "Good": "Guardrail_AssetCondition_Good" },
        { "Damaged": "Guardrail_AssetCondition_Damaged" }
      ],
      "CHAINAGE END": [],
      "CHAINAGE START": [],
      "DESCRIPTION": [
        { "Steel": "Guardrail_Description_Steel" },
        { "Wire": "Guardrail_Description_Wire" }
      ],
      "GURAIL TYPE": [
        { "Monorail": "Guardrail_GurailType_Monorail" },
        { "Bridge parapet (3 rail / 4 rail system)": "Guardrail_GurailType_Bridge_parapet" },
        { "Handrails": "Guardrail_GurailType_Handrails" },
        { "Aesthetic parapets": "Guardrail_GurailType_Aesthetic_parapets" }
      ],
      // "SHAPE.LEN": ["Calculate from start to finish"]
    },
    "TRAFFIC BOLLARD": {
      "BOLLARD SHAPE": [
        { "Round": "Traffic_Bollard_BollardShape_Round" },
        { "Edge": "Traffic_Bollard_BollardShape_Edge" }
      ],
      "NO OF REFLECTORS": [
        { "Yes": "Traffic_Bollard_NoOfReflectors_Yes" },
        { "No": "Traffic_Bollard_NoOfReflectors_No" }
      ],
      "REFLECTIVE FILM": [
        { "Yes": "Traffic_Bollard_ReflectiveFilm_Yes" },
        { "No": "Traffic_Bollard_ReflectiveFilm_No" }
      ],
      "ASSET CONDITION": [
        { "Good": "Traffic_Bollard_AssetCondition_Good" },
        { "Missing": "Traffic_Bollard_AssetCondition_Missing" },
        { "Broken": "Traffic_Bollard_AssetCondition_Broken" },
        { "Bent": "Traffic_Bollard_AssetCondition_Bent" }
      ],
      "BOLLARD TYPE": [
        { "Fragible": "Traffic_Bollard_BollardType_Fragible" },
        { "Solid": "Traffic_Bollard_BollardType_Solid" }
      ]
    }
  },

  "PAVEMENT": {
    "KERB": {
      "ASSET CONDITION": [
        { "Good": "Kerb_AssetCondition_Good" },
        { "Damaged": "Kerb_AssetCondition_Damaged" }
      ]
    },
    "ROAD MARKING LINE": {
      "ROAD MARKING COLOUR": [
        { "Yes": "Road_Marking_Line_RoadMarkingColour_Yes" },
        { "No": "Road_Marking_Line_RoadMarkingColour_No" }
      ],
      "ASSET CONDITION": [
        { "Good": "Road_Marking_Line_AssetCondition_Good" },
        { "Damaged": "Road_Marking_Line_AssetCondition_Damaged" }
      ],
      // "DESCRIPTION": ["Shape"]
    },
    "ROAD MARKING POINT": {
      "ROAD MARKING COLOUR": [
        { "Yes": "Road_Marking_Point_RoadMarkingColour_Yes" },
        { "No": "Road_Marking_Point_RoadMarkingColour_No" }
      ],
      "ASSET CONDITION": [
        { "Good": "Road_Marking_Point_AssetCondition_Good" },
        { "Damaged": "Road_Marking_Point_AssetCondition_Damaged" }
      ]
    },
    "ROAD MARKING POLYGON": {
      "ROAD MARKING COLOUR": [
        { "Yes": "Road_Marking_Polygon_RoadMarkingColour_Yes" },
        { "No": "Road_Marking_Polygon_RoadMarkingColour_No" }
      ],
      "ASSET CONDITION": [
        { "Good": "Road_Marking_Polygon_AssetCondition_Good" },
        { "Damaged": "Road_Marking_Polygon_AssetCondition_Damaged" },
        { "Faded Paint": "Road_Marking_Polygon_AssetCondition_FadedPaint" }
      ],
      "CHAINAGE END": [],
      "CHAINAGE START": [],
      "TYPE": [
        { "Lane & Traffic Control Areas": "Road_Marking_Polygon_Type_Lane_Traffic_Control_Areas" },
        { "Pedestrian & Cyclist Areas": "Road_Marking_Polygon_Type_Pedestrian_Cyclist_Areas" },
        { "Parking & Restricted Areas": "Road_Marking_Polygon_Type_Parking_Restricted_Areas" },
        { "Special Purpose / Informational": "Information board" },
        { "Symbols & Text": "Road_Marking_Polygon_Type_Symbols_Text" }
      ]
    },
    "ROAD STUDS": {
      "COLOUR": [
        { "Yes": "Road_Studs_Colour_Yes" },
        { "No": "Road_Studs_Colour_No" }
      ],
      "STUD REFLECTIVITY": [
        { "Yes": "Road_Studs_StudReflectivity_Yes" },
        { "No": "Road_Studs_StudReflectivity_No" }
      ],
      "STUDS SHAPE": [
        { "Yes": "Road_Studs_StudsShape_Yes" },
        { "No": "Road_Studs_StudsShape_No" }
      ],
      "ASSET CONDITION": [
        { "Good": "Road_Studs_AssetCondition_Good" },
        { "Broken": "Road_Studs_AssetCondition_Broken" },
        { "Missing": "Road_Studs_AssetCondition_Missing" }
      ],
      "CHAINAGE END": [],
      "CHAINAGE START": [],
      // "SHAPE.LEN": ["Length of run of studs"],
      "STUDS TYPE": [
        { "Screw Type (2 Piece)": "Road_Studs_StudsType_Screw_Type_2_Piece" },
        { "Normal": "Road_Studs_StudsType_Normal" }
      ]
    },
    "RUMBLE STRIP": {
      "STRIP COLOR": [
        { "Yes": "Rumble_Strip_StripColor_Yes" },
        { "No": "Rumble_Strip_StripColor_No" }
      ],
      "ASSET CONDITION": [
        { "Good": "Rumble_Strip_AssetCondition_Good" },
        { "Damaged": "Rumble_Strip_AssetCondition_Damaged" },
        { "Paint Faded": "Rumble_Strip_AssetCondition_PaintFaded" }
      ],
      "CHAINAGE END": [],
      "CHAINAGE START": []
    },
    "SPEED HUMPS": {
      "ASSET CONDITION": [
        { "Good": "Speed_Humps_AssetCondition_Good" },
        { "Damaged": "Speed_Humps_AssetCondition_Damaged" }
      ],
      "CHAINAGE END": [],
      "CHAINAGE START": [],
      // "DESCRIPTION": ["Painted Arrows - Yes/No"],
      // "SPEED HUMP TYPE": ["One Way", "Two Way"],
      // "TYPE": ["One Way", "Two Way"]
    },
    "Accessway": {
      "ASSET CONDITION": [
        { "Good": "Accessway_AssetCondition_Good" },
        { "Damaged": "Accessway_AssetCondition_Damaged" }
      ],
      // "SHAPE.LEN": ["Length from GPS / Road Length Calculation"]
    },
    "CARRIAGEWAY": {
      "ASSET CONDITION": [
        { "Good": "Carriageway_AssetCondition_Good" },
        { "Damaged": "Carriageway_AssetCondition_Damaged" }
      ]
    },
    "CENTRAL ROUNDABOUT ISLAND": {
      "ASSET CONDITION": [
        { "Good": "Central_Roundabout_Island_AssetCondition_Good" },
        { "Damaged": "Central_Roundabout_Island_AssetCondition_Damaged" }
      ]
    },
    "FOOTPATH": {
      "ASSET CONDITION": [
        { "Good": "Footpath_AssetCondition_Good" },
        { "Damaged": "Footpath_AssetCondition_Damaged" }
      ]
    },
    "JUNCTION ISLAND": {
      "ASSET CONDITION": [
        { "Good": "Junction_Island_AssetCondition_Good" },
        { "Damaged": "Junction_Island_AssetCondition_Damaged" }
      ]
    },
    "MEDIAN": {
      "ASSET CONDITION": [
        { "Good": "Median_AssetCondition_Good" },
        { "Damaged": "Median_AssetCondition_Damaged" }
      ],
      "MEDIAN TYPE": [
        { "Centre Line": "Median_MedianType_Centre_Line" },
        { "Wide Centreline": "Median_MedianType_Wide_Centreline" },
        { "Central Hatching": "Median_MedianType_Central_Hatching" },
        { "Flexipost": "Median_MedianType_Flexipost" },
        { "Physical Median": "Median_MedianType_Physical_Median" }
      ]
    },
    "PARKING BAY": {
      "ASSET CONDITION": [
        { "Good": "Parking_Bay_AssetCondition_Good" },
        { "Poor": "Parking_Bay_AssetCondition_Poor" }
      ]
    },
    "SEPERATOR ISLAND": {
      "ASSET CONDITION": [
        { "Good": "Separator_Island_AssetCondition_Good" },
        { "Damaged": "Separator_Island_AssetCondition_Damaged" }
      ]
    },
    "SHOULDER": {
      "ASSET CONDITION": [
        { "Good": "Shoulder_AssetCondition_Good" },
        { "Damaged": "Shoulder_AssetCondition_Damaged" }
      ]
    }
  },

  "ROADWAY LIGHTING": {
    "STREET LIGHT FEEDER PILLAR": {
      "ASSET CONDITION": [
        { "Good": "STREET_LIGHT_FEEDER_PILLAR_AssetCondition_Good" },
        { "Damaged": "STREET_LIGHT_FEEDER_PILLAR_AssetCondition_Damaged" }
      ]
    },
    "STREET LIGHT": {
      "ASSET CONDITION": [
        { "Good": "STREET_LIGHT_AssetCondition_Good" },
        { "Damaged": "STREET_LIGHT_AssetCondition_Damaged" }
      ]
    },
    "STREET LIGHT POLE": {
      "ASSET CONDITION": [
        { "Good": "STREET_LIGHT_POLE_AssetCondition_Good" },
        { "Damaged": "STREET_LIGHT_POLE_AssetCondition_Damaged" }
      ],
      "DISTRIBUTION BOX": [],
      "LUMINAIRE COUNT": [],
      "NUMBER OF BRACKETS": [],
      "POLE SHAPE": [],
      "DESCRIPTION": [{ "Single": "Street_Light_Pole_Description_Single" }, { "Double": "Street_Light_Pole_Description_Double" }],
      "POLE TYPE": [{ "Standard": "Street_Light_Pole_PoleType_Standard" }, { "Highmast": "Street_Light_Pole_PoleType_Highmast" }]
    },
    "UNDERPASS LUMINAIRE": {
      "ASSET CONDITION": [
        { "Good": "UNDERPASS_LUMINAIRE_AssetCondition_Good" },
        { "Damaged": "UNDERPASS_LUMINAIRE_AssetCondition_Damaged" }
      ]
    }
  },

  "STRUCTURES": {
    "BRIDGE": {
      "ASSET CONDITION": [
        { "Good": "Bridge_AssetCondition_Good" },
        { "Damaged": "Bridge_AssetCondition_Damaged" }
      ],
      "NO LANES": [],
      "OBSTACLE CARRIED": []
    },
    "CABLE BRIDGE": {
      "ASSET CONDITION": [
        { "Good": "Cable_Bridge_AssetCondition_Good" },
        { "Damaged": "Cable_Bridge_AssetCondition_Damaged" }
      ],
      "OBSTACLE CARRIED": [{ "Yes": "Cable_Bridge_ObstacleCarried_Yes" }, { "No": "Cable_Bridge_ObstacleCarried_No" }],
      "NO LANES": [{ "Yes": "Cable_Bridge_NoLanes_Yes" }, { "No": "Cable_Bridge_NoLanes_No" }]
    },
    "CAMEL CROSSING": {
      "ASSET CONDITION": [
        { "Good": "Camel_Crossing_AssetCondition_Good" },
        { "Damaged": "Camel_Crossing_AssetCondition_Damaged" }
      ]
    },
    "CULVERT": {
      "ASSET CONDITION": [
        { "Good": "Culvert_AssetCondition_Good" },
        { "Damaged": "Culvert_AssetCondition_Damaged" }
      ]
    },
    "FLYOVER": {
      "ASSET CONDITION": [
        { "Good": "Flyover_AssetCondition_Good" },
        { "Damaged": "Flyover_AssetCondition_Damaged" }
      ],
      "NO LANES": [],
      "OBS CARRIED": [],
      "CHAINAGE END": [],
      "CHAINAGE START": []
    },
    "FOOTBRIDGE": {
      "ASSET CONDITION": [
        { "Good": "Footbridge_AssetCondition_Good" },
        { "Damaged": "Footbridge_AssetCondition_Damaged" }
      ]
    },
    "MONUMENT": {
      "ASSET CONDITION": [
        { "Good": "Monument_AssetCondition_Good" },
        { "Damaged": "Monument_AssetCondition_Damaged" }
      ]
    },
    "OVERPASS OP (ONLY PEDESTRIAN)": {
      "ASSET CONDITION": [
        { "Good": "Overpass_OP_Only_Pedestrian_AssetCondition_Good" },
        { "Damaged": "Overpass_OP_Only_Pedestrian_AssetCondition_Damaged" }
      ],
      "OBSTACLE CARRIED": []
    },
    "OVERPASS OV": {
      "ASSET CONDITION": [
        { "Good": "Overpass_OV_AssetCondition_Good" },
        { "Damaged": "Overpass_OV_AssetCondition_Damaged" }
      ],
      "NO LANES": [],
      "OBSTACLE CARRIED": []
    },
    "PEDESTRIAN UNDERPASS": {
      "ASSET CONDITION": [
        { "Good": "Pedestrian_Underpass_AssetCondition_Good" },
        { "Damaged": "Pedestrian_Underpass_AssetCondition_Damaged" }
      ]
    },
    "RETAINING WALL": {
      "ASSET CONDITION": [
        { "Good": "Retaining_Wall_AssetCondition_Good" },
        { "Damaged": "Retaining_Wall_AssetCondition_Damaged" }
      ],
      "LENGTH": []
    },
    "TOLL GATE": {
      "ASSET CONDITION": [
        { "Good": "Toll_Gate_AssetCondition_Good" },
        { "Damaged": "Toll_Gate_AssetCondition_Damaged" }
      ]
    },
    "TUNNEL": {
      "ASSET CONDITION": [
        { "Good": "Tunnel_AssetCondition_Good" },
        { "Damaged": "Tunnel_AssetCondition_Damaged" }
      ],
      "DESCRIPTION": [
        { "Underpass": "Tunnel_Description_Underpass" },
        { "Throughpass": "Tunnel_Description_Throughpass" }
      ],
      "SHAPE.LEN": []
    },
    "UNDERPASS": {
      "ASSET CONDITION": [
        { "Good": "Underpass_AssetCondition_Good" },
        { "Damaged": "Underpass_AssetCondition_Damaged" }
      ],
      "NO LANES": [],
      "VERTICAL CLEARANCE": [],
      "LENGTH": []
    },
    "VIADUCT": {
      "NO LANES": [],
      "OBSTACLE CARRIED": [],
      "VERTICAL CLEARANCE": [],
      "ASSET CONDITION": [
        { "Good": "Viaduct_AssetCondition_Good" },
        { "Damaged": "Viaduct_AssetCondition_Damaged" }
      ]
    }
  },

  "BEAUTIFICATION": {
    "Artificial Grass": {
      "CONDITION": [
        { "Wrong location": "Artificial_Grass_Condition_Wrong_location" },
        { "Damage": "Artificial_Grass_Condition_Damage" },
        { "Aesthetic Issues": "Artificial_Grass_Condition_Aesthetic_Issues" },
        { "Dust Accumulation": "Artificial_Grass_Condition_Dust_Accumulation" },
        { "Mis-aligned": "Artificial_Grass_Condition_Mis_aligned" },
        { "Grass Colour Fading": "Artificial_Grass_Condition_Grass_Colour_Fading" },
        { "Others": "Artificial_Grass_Condition_Others" }
      ]
    },
    "Bench": {
      "CONDITION": [
        { "Wrong location": "Bench_Condition_Wrong_location" },
        { "Damage": "Bench_Condition_Damage" },
        { "Fittings Issues": "Bench_Condition_Fittings_Issues" },
        { "Equipment Damage": "Bench_Condition_Equipment_Damage" },
        { "Paint Issues": "Bench_Condition_Paint_Issues" },
        { "Rust": "Bench_Condition_Rust" },
        { "Others": "Bench_Condition_Others" }
      ]
    },
    "Bike Rack": {
      "CONDITION": [
        { "Wrong location": "Bike_Rack_Condition_Wrong_location" },
        { "Damage": "Bike_Rack_Condition_Damage" },
        { "Fittings Issues": "Bike_Rack_Condition_Fittings_Issues" },
        { "Equipment Damage": "Bike_Rack_Condition_Equipment_Damage" },
        { "Paint Issues": "Bike_Rack_Condition_Paint_Issues" },
        { "Rust": "Bike_Rack_Condition_Rust" },
        { "Others": "Bike_Rack_Condition_Others" }
      ]
    },
    "Bin": {
      "CONDITION": [
        { "Wrong location": "Bin_Condition_Wrong_location" },
        { "Damage": "Bin_Condition_Damage" },
        { "Bins not emptied": "Bin_Condition_Bins_not_emptied" },
        { "Debris and litter": "Bin_Condition_Debris_and_litter" },
        { "Damaged": "Bin_Condition_Damaged" },
        { "Others": "Bin_Condition_Others" }
      ]
    },
    "Decorative Fence": {
      "CONDITION": [
        { "Wrong location": "Decorative_Fence_Condition_Wrong_location" },
        { "Damaged": "Decorative_Fence_Condition_Damaged" },
        { "Fence broken": "Decorative_Fence_Condition_Fence_broken" },
        { "Wear and tear": "Decorative_Fence_Condition_Wear_and_tear" },
        { "Mis-aligned": "Decorative_Fence_Condition_Mis_aligned" },
        { "Paint issues": "Decorative_Fence_Condition_Paint_issues" },
        { "Foundation Issues": "Decorative_Fence_Condition_Foundation_Issues" },
        { "Others": "Decorative_Fence_Condition_Others" }
      ]
    },
    "Fitness Equipment": {
      "CONDITION": [
        { "Wrong location": "Fitness_Equipment_Condition_Wrong_location" },
        { "Damage": "Fitness_Equipment_Condition_Damage" },
        { "Fittings Issues": "Fitness_Equipment_Condition_Fittings_Issues" },
        { "Equipment Damage": "Fitness_Equipment_Condition_Equipment_Damage" },
        { "Paint Issues": "Fitness_Equipment_Condition_Paint_Issues" },
        { "Rust": "Fitness_Equipment_Condition_Rust" },
        { "Others": "Fitness_Equipment_Condition_Others" }
      ]
    },
    "Flower Bed": {
      "CONDITION": [
        { "Wrong location": "Flower_Bed_Condition_Wrong_location" },
        { "Damage": "Flower_Bed_Condition_Damage" },
        { "Aesthetic Issues": "Flower_Bed_Condition_Aesthetic_Issues" },
        { "Dust Accumulation": "Flower_Bed_Condition_Dust_Accumulation" },
        { "Mis-aligned": "Flower_Bed_Condition_Mis_aligned" },
        { "Drainage issues": "Flower_Bed_Condition_Drainage_issues" },
        { "Decay": "Flower_Bed_Condition_Decay" },
        { "Others": "Flower_Bed_Condition_Others" }
      ]
    },
    "Fountain": {
      "CONDITION": [
        { "Wrong location": "Fountain_Condition_Wrong_location" },
        { "Damage": "Fountain_Condition_Damage" },
        { "Non-functioning washdown system": "Fountain_Condition_Non_functioning_washdown_system" },
        { "Reduced water pressure": "Fountain_Condition_Reduced_water_pressure" },
        { "Waste cleaning after Washing": "Fountain_Condition_Waste_cleaning_after_Washing" },
        { "Electrical": "Fountain_Condition_Electrical" },
        { "Mechanical issues with water pump": "Fountain_Condition_Mechanical_issues_with_water_pump" },
        { "COMMS/network issues": "Fountain_Condition_COMMS_network_issues" },
        { "Songs not playing": "Fountain_Condition_Songs_not_playing" },
        { "System not flushed": "Fountain_Condition_System_not_flushed" },
        { "Equipment calibration issues": "Fountain_Condition_Equipment_calibration_issues" },
        { "Others": "Fountain_Condition_Others" }
      ]
    },
    "Garden": {
      "CONDITION": [
        { "Wrong location": "Garden_Condition_Wrong_location" },
        { "Damage": "Garden_Condition_Damage" },
        { "Aesthetic Issues": "Garden_Condition_Aesthetic_Issues" },
        { "Decay": "Garden_Condition_Decay" },
        { "Drainage issues": "Garden_Condition_Drainage_issues" },
        { "Others": "Garden_Condition_Others" }
      ]
    },
    "Gravel Area": {
      "CONDITION": [
        { "Wrong location": "Gravel_Area_Condition_Wrong_location" },
        { "Scattered": "Gravel_Area_Condition_Scattered" },
        { "Compaction issues": "Gravel_Area_Condition_Compaction_issues" },
        { "Vegetation Growth": "Gravel_Area_Condition_Vegetation_Growth" },
        { "Others": "Gravel_Area_Condition_Others" }
      ]
    },
    "Hedge": {
      "CONDITION": [
        { "Wrong location": "Hedge_Condition_Wrong_location" },
        { "Damaged": "Hedge_Condition_Damaged" },
        { "Mis-aligned": "Hedge_Condition_Mis_aligned" },
        { "Not Maintained": "Hedge_Condition_Not_Maintained" },
        { "Others": "Hedge_Condition_Others" }
      ]
    },
    "Hoarding": {
      "CONDITION": [
        { "Wrong location": "Hoarding_Condition_Wrong_location" },
        { "Damaged": "Hoarding_Condition_Damaged" },
        { "Broken": "Hoarding_Condition_Broken" },
        { "Wear and tear": "Hoarding_Condition_Wear_and_tear" },
        { "Mis-aligned": "Hoarding_Condition_Mis_aligned" },
        { "Paint issues": "Hoarding_Condition_Paint_issues" },
        { "Foundation Issues": "Hoarding_Condition_Foundation_Issues" },
        { "Others": "Hoarding_Condition_Others" }
      ]
    },
    "Interlock Area": {
      "CONDITION": [
        { "Damaged": "Interlock_Area_Condition_Damaged" },
        { "Instability": "Interlock_Area_Condition_Instability" },
        { "Uneven Surface": "Interlock_Area_Condition_Uneven_Surface" },
        { "Shifting Pavers": "Interlock_Area_Condition_Shifting_Pavers" },
        { "Others": "Interlock_Area_Condition_Others" }
      ]
    },
    "Jogger Track": {
      "CONDITION": [
        { "Joint-Seal failed": "Jogger_Track_Condition_Joint_Seal_failed" },
        { "Joint-Opening": "Jogger_Track_Condition_Joint_Opening" },
        { "Loss of material": "Jogger_Track_Condition_Loss_of_material" },
        { "Joint-Stepping": "Jogger_Track_Condition_Joint_Stepping" },
        { "Debris & Litter": "Jogger_Track_Condition_Debris_Litter" },
        { "Loose / Rocking": "Jogger_Track_Condition_Loose_Rocking" },
        { "Settled": "Jogger_Track_Condition_Settled" },
        { "Manhole Issues": "Jogger_Track_Condition_Manhole_Issues" },
        { "Others": "Jogger_Track_Condition_Others" },
        { "Edge Drop-off": "Jogger_Track_Condition_Edge_Drop_off" },
        { "Faded Lines": "Jogger_Track_Condition_Faded_Lines" },
        { "Crack": "Jogger_Track_Condition_Crack" },
        { "Gravel Deposit": "Jogger_Track_Condition_Gravel_Deposit" },
        { "Holes": "Jogger_Track_Condition_Holes" },
        { "Depression": "Jogger_Track_Condition_Depression" },
        { "Damaged": "Jogger_Track_Condition_Damaged" },
        { "Foundation Failure": "Jogger_Track_Condition_Foundation_Failure" },
        { "Overgrown by Vegetation": "Jogger_Track_Condition_Overgrown_by_Vegetation" },
        { "Patch repair failing": "Jogger_Track_Condition_Patch_repair_failing" },
        { "Slip": "Jogger_Track_Condition_Slip" },
        { "Ponding/drainage issues": "Jogger_Track_Condition_Ponding_drainage_issues" }
      ]
    },
    "Kerbstone": {
      "CONDITION": [
        { "Joint widening": "Kerbstone_Condition_Joint_widening" },
        { "Loose/Rocking": "Kerbstone_Condition_Loose_Rocking" },
        { "Others": "Kerbstone_Condition_Others" },
        { "Damaged": "Kerbstone_Condition_Damaged" },
        { "Edge Drop-off": "Kerbstone_Condition_Edge_Drop_off" },
        { "Surface spalling": "Kerbstone_Condition_Surface_spalling" },
        { "Loss of joint material": "Kerbstone_Condition_Loss_of_joint_material" },
        { "Projecting horizontally": "Kerbstone_Condition_Projecting_horizontally" },
        { "Projecting vertically": "Kerbstone_Condition_Projecting_vertically" },
        { "Crack": "Kerbstone_Condition_Crack" },
        { "Foundation Failure": "Kerbstone_Condition_Foundation_Failure" },
        { "Overgrown by Vegetation": "Kerbstone_Condition_Overgrown_by_Vegetation" },
        { "Mis-aligned": "Kerbstone_Condition_Mis_aligned" }
      ]
    },
    "Landscape Light": {
      "CONDITION": [
        { "Wrong location": "Landscape_Light_Condition_Wrong_location" },
        { "Damage": "Landscape_Light_Condition_Damage" },
        { "Light Off": "Landscape_Light_Condition_Light_Off" },
        { "Electrical Issues": "Landscape_Light_Condition_Electrical_Issues" },
        { "Cable Exposed": "Landscape_Light_Condition_Cable_Exposed" },
        { "Mis-aligned": "Landscape_Light_Condition_Mis_aligned" },
        { "Rust": "Landscape_Light_Condition_Rust" },
        { "Visibility Issues": "Landscape_Light_Condition_Visibility_Issues" },
        { "Others": "Landscape_Light_Condition_Others" }
      ]
    },
    "Natural Grass": {
      "CONDITION": [
        { "Wrong location": "Natural_Grass_Condition_Wrong_location" },
        { "Damage": "Natural_Grass_Condition_Damage" },
        { "Aesthetic Issues": "Natural_Grass_Condition_Aesthetic_Issues" },
        { "Dust Accumulation": "Natural_Grass_Condition_Dust_Accumulation" },
        { "Mis-aligned": "Natural_Grass_Condition_Mis_aligned" },
        { "Drainage issues": "Natural_Grass_Condition_Drainage_issues" },
        { "Decay": "Natural_Grass_Condition_Decay" },
        { "Others": "Natural_Grass_Condition_Others" }
      ]
    },
    "Planter Pot": {
      "CONDITION": [
        { "Wrong location": "Planter_Pot_Condition_Wrong_location" },
        { "Damage": "Planter_Pot_Condition_Damage" },
        { "Drainage issues": "Planter_Pot_Condition_Drainage_issues" },
        { "Weakening": "Planter_Pot_Condition_Weakening" },
        { "Decay": "Planter_Pot_Condition_Decay" },
        { "Poor Tree Form": "Planter_Pot_Condition_Poor_Tree_Form" },
        { "Dead Wood": "Planter_Pot_Condition_Dead_Wood" },
        { "Dust Accumulation": "Planter_Pot_Condition_Dust_Accumulation" },
        { "Others": "Planter_Pot_Condition_Others" }
      ]
    },
    "Recessed Light": {
      "CONDITION": [
        { "Wrong location": "Recessed_Light_Condition_Wrong_location" },
        { "Damage": "Recessed_Light_Condition_Damage" },
        { "Flickering": "Recessed_Light_Condition_Flickering" },
        { "Dimming": "Recessed_Light_Condition_Dimming" },
        { "Overheating": "Recessed_Light_Condition_Overheating" },
        { "Light Off": "Recessed_Light_Condition_Light_Off" },
        { "Inconsistent Lighting": "Recessed_Light_Condition_Inconsistent_Lighting" },
        { "Others": "Recessed_Light_Condition_Others" }
      ]
    },
    "Road Batter": {
      "CONDITION": [
        { "Damaged": "Road_Batter_Condition_Damaged" },
        { "Foundation Failure": "Road_Batter_Condition_Foundation_Failure" },
        { "Overgrown by Vegetation": "Road_Batter_Condition_Overgrown_by_Vegetation" },
        { "Instability": "Road_Batter_Condition_Instability" },
        { "Erosion": "Road_Batter_Condition_Erosion" },
        { "Damage from Vehicles or Debris": "Road_Batter_Condition_Damage_from_Vehicles_or_Debris" },
        { "Others": "Road_Batter_Condition_Others" }
      ]
    },
    "Sand Area": {
      "CONDITION": [
        { "Wrong location": "Sand_Area_Condition_Wrong_location" },
        { "Scattered": "Sand_Area_Condition_Scattered" },
        { "Compaction issues": "Sand_Area_Condition_Compaction_issues" },
        { "Vegetation Growth": "Sand_Area_Condition_Vegetation_Growth" },
        { "Others": "Sand_Area_Condition_Others" }
      ]
    },
    "Tree": {
      "CONDITION": [
        { "Wrong location": "Tree_Condition_Wrong_location" },
        { "Damage": "Tree_Condition_Damage" },
        { "Dust Accumulation": "Tree_Condition_Dust_Accumulation" },
        { "Drainage issues": "Tree_Condition_Drainage_issues" },
        { "Weakening": "Tree_Condition_Weakening" },
        { "Decay": "Tree_Condition_Decay" },
        { "Poor Tree Form": "Tree_Condition_Poor_Tree_Form" },
        { "Dead Wood": "Tree_Condition_Dead_Wood" },
        { "Others": "Tree_Condition_Others" }
      ]
    },
    "Treeguard": {
      "CONDITION": [
        { "Rust of the element": "Treeguard_Condition_Rust_of_the_element" },
        { "Others": "Treeguard_Condition_Others" },
        { "Wrong location": "Treeguard_Condition_Wrong_location" },
        { "Damaged": "Treeguard_Condition_Damaged" },
        { "Fence broken": "Treeguard_Condition_Fence_broken" },
        { "Wear and tear": "Treeguard_Condition_Wear_and_tear" },
        { "Mis-aligned": "Treeguard_Condition_Mis_aligned" },
        { "Paint issues": "Treeguard_Condition_Paint_issues" },
        { "Foundation Issues": "Treeguard_Condition_Foundation_Issues" }
      ]
    }
  }
};
