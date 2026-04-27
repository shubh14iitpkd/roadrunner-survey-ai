/** Shared record shape used by Anomaly Library and Asset Library pages */
export interface AssetRecord {
  id?: string;
  surveyId?: string;
  condition?: string;
  assetDisplayId?: string;
  markerColor?: string;
  defectId: string;
  assetId: string;
  assetType: string;
  assetCategory: string;
  lat: number;
  lng: number;
  roadName: string;
  roadSide?: string;
  routeId?: number;
  side: string;
  zone?: string;
  lastSurveyDate: string;
  issue: string;
  description?: Record<string, string>;
  severity: string;
  videoId?: string;
  frameNumber?: number;
  asset_id?: string;
  category_id?: string;
  groupId?: string;
  box?: { x: number; y: number; width: number; height: number };
  /** Linear-asset fields (optional, populated for kind === "line") */
  kind?: "point" | "line";
  classification?: "point" | "linear_sided" | "linear_unsided";
  geometry?: { type: "LineString"; coordinates: [number, number][] }; // GeoJSON [lng,lat]
  keypoints?: {
    frame: number;
    lat: number;
    lng: number;
    side?: string | null;
    box?: { x: number; y: number; width: number; height: number };
  }[];
  /** UI-only: true when this asset has been marked as good in this session */
  isGood?: boolean;
  /** Cross-survey timeline from master_assets.survey_history */
  surveyHistory?: {
    survey_display_id?: string;
    survey_date?: string;
    condition?: string;
    confidence?: number;
    asset_display_id?: string;
    match_confidence?: number;
    location?: { type: string; coordinates: number[] };
    video_id?: string;
    frame_number?: number;
    box?: { x: number; y: number; width: number; height: number };
    created_at: string;
  }[];
  totalSurveysDetected?: number;
  masterDisplayId?: string;
}

/** Columnar map-points payload — parallel arrays of equal length `count`,
 *  consumed by LibraryMapView without per-row object allocations. The
 *  /master/map-points endpoint returns this shape verbatim (after
 *  api.ts builds the `idIndex` and `lineSet` helpers). */
export interface MapData {
  count: number;
  ids: string[];
  asset_ids: string[];
  lats: number[];
  lngs: number[];
  conditions: string[];
  group_ids: (string | null)[];
  sides: string[];
  zones: string[];
  route_ids: (number | null)[];
  category_ids: string[];
  /** Present only when /master/map-points was called with include_defect=1. */
  defect_ids?: string[];
  /** Present only when /master/map-points was called with include_defect=1. */
  issues?: string[];
  /** master_display_id values that are linear (kind === "line"). */
  lineSet: Set<string>;
  /** master_display_id → index in the parallel arrays. O(1) lookup for
   *  click handlers, optimistic mutations, and FlyToSelected. */
  idIndex: Map<string, number>;
  /** route_id (stringified) → route_name, deduplicated server-side. */
  routeDict: Record<string, string>;
  /** Linear-asset extras keyed by master_display_id. Only populated for
   *  IDs in lineSet. */
  line_extras: Record<string, {
    classification?: string;
    geometry?: { type: "LineString"; coordinates: [number, number][] };
  }>;
}

/** Single empty MapData used as a stable placeholder before the first
 *  /master/map-points response lands — saves a fresh allocation per render
 *  in pages that want a non-null default. */
export const EMPTY_MAP_DATA: MapData = {
  count: 0,
  ids: [],
  asset_ids: [],
  lats: [],
  lngs: [],
  conditions: [],
  group_ids: [],
  sides: [],
  zones: [],
  route_ids: [],
  category_ids: [],
  lineSet: new Set(),
  idIndex: new Map(),
  routeDict: {},
  line_extras: {},
};
