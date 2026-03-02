/** Shared record shape used by Anomaly Library and Asset Library pages */
export interface AssetRecord {
  id?: string;
  surveyId?: string;
  condition?: string;
  markerColor?: string;
  defectId: string;
  assetId: string;
  assetType: string;
  assetCategory: string;
  lat: number;
  lng: number;
  roadName: string;
  routeId?: number;
  side: string;
  zone?: string;
  lastSurveyDate: string;
  issue: string;
  severity: string;
  videoId?: string;
  frameNumber?: number;
  asset_id?: string;
  category_id?: string;
  box?: { x: number; y: number; width: number; height: number };
}
