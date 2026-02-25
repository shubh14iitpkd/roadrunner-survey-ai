/** Shared record shape used by Anomaly Library and Asset Library pages */
export interface AssetRecord {
  anomalyId: string;
  assetId: string;
  assetType: string;
  assetCategory: string;
  lat: number;
  lng: number;
  roadName: string;
  side: string;
  zone?: string;
  lastSurveyDate: string;
  issue: string;
  severity: string;
  videoId?: string;
  frameNumber?: number;
  box?: { x: number; y: number; width: number; height: number };
}
