// Road survey summary data
// Aggregates detected assets by road/route

import { mockDetectedAssets } from "./mockAssetData";
import { roadRegister } from "./roadRegister";

export interface RoadSurveySummary {
  routeId: string;
  roadName: string;
  lengthKm: number;
  surveyorName: string;
  surveyDate: string;
  totalAssets: number;
  goodCondition: number;
  averageCondition: number;
  poorCondition: number;
  surveys: SurveyHistory[];
}

export interface SurveyHistory {
  surveyDate: string;
  surveyorName: string;
  totalAssets: number;
}

export interface DetailedRoadAssets {
  routeId: string;
  roadName: string;
  surveyDate: string;
  surveyorName: string;
  assets: typeof mockDetectedAssets;
}

// Generate road survey summaries
export const generateRoadSurveySummaries = (): RoadSurveySummary[] => {
  const summaries: Map<string, RoadSurveySummary> = new Map();

  // Group assets by route
  mockDetectedAssets.forEach(asset => {
    const road = roadRegister.find(r => r.route_id.toString() === asset.routeId.replace('R', '').replace(/^0+/, ''));
    
    if (!summaries.has(asset.routeId)) {
      // Find all unique surveys for this route
      const routeAssets = mockDetectedAssets.filter(a => a.routeId === asset.routeId);
      const uniqueSurveys = Array.from(new Set(routeAssets.map(a => a.surveyDate)))
        .map(date => {
          const surveysOnDate = routeAssets.filter(a => a.surveyDate === date);
          return {
            surveyDate: date,
            surveyorName: surveysOnDate[0]?.surveyorName || "Unknown",
            totalAssets: surveysOnDate.length
          };
        })
        .sort((a, b) => new Date(b.surveyDate).getTime() - new Date(a.surveyDate).getTime());

      summaries.set(asset.routeId, {
        routeId: asset.routeId,
        roadName: asset.roadName,
        lengthKm: road?.estimated_distance_km || Math.random() * 15 + 5,
        surveyorName: asset.surveyorName,
        surveyDate: asset.surveyDate,
        totalAssets: 0,
        goodCondition: 0,
        averageCondition: 0,
        poorCondition: 0,
        surveys: uniqueSurveys
      });
    }

    const summary = summaries.get(asset.routeId)!;
    summary.totalAssets++;
    
    if (asset.condition === "Good") summary.goodCondition++;
    else if (asset.condition === "Fair") summary.averageCondition++;
    else if (asset.condition === "Poor") summary.poorCondition++;

    // Update to latest survey date if newer
    if (new Date(asset.surveyDate) > new Date(summary.surveyDate)) {
      summary.surveyDate = asset.surveyDate;
      summary.surveyorName = asset.surveyorName;
    }
  });

  return Array.from(summaries.values()).sort((a, b) => 
    parseInt(a.routeId.replace('R', '')) - parseInt(b.routeId.replace('R', ''))
  );
};

// Get detailed assets for a specific road
export const getDetailedRoadAssets = (routeId: string, surveyDate?: string): DetailedRoadAssets => {
  let assets = mockDetectedAssets.filter(a => a.routeId === routeId);
  
  if (surveyDate) {
    assets = assets.filter(a => a.surveyDate === surveyDate);
  } else {
    // Get latest survey
    const latestDate = assets.reduce((latest, asset) => {
      return new Date(asset.surveyDate) > new Date(latest) ? asset.surveyDate : latest;
    }, assets[0]?.surveyDate || '');
    assets = assets.filter(a => a.surveyDate === latestDate);
  }

  return {
    routeId,
    roadName: assets[0]?.roadName || "Unknown Road",
    surveyDate: assets[0]?.surveyDate || "",
    surveyorName: assets[0]?.surveyorName || "Unknown",
    assets
  };
};

export const roadSurveySummaries = generateRoadSurveySummaries();
