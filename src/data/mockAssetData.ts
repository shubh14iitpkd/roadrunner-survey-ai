// Mock detected assets data for demonstration
// Based on official asset categories

import { assetTypes } from "./assetCategories";

export interface DetectedAsset {
  id: string;
  assetCode: string;
  category: string;
  type: string;
  routeId: string;
  roadName: string;
  condition: "Good" | "Fair" | "Poor";
  confidence: number;
  surveyDate: string;
  lat: number;
  lng: number;
  surveyorName: string;
  notes?: string;
}

// Qatar road names for realistic data
const qatarRoads = [
  "Doha Corniche",
  "Salwa Road",
  "Al Shamal Road",
  "Lusail Expressway",
  "Dukhan Highway",
  "Al Khor Coastal Road",
  "Orbital Highway",
  "Al Rayyan Road",
  "C-Ring Road",
  "D-Ring Road"
];

const surveyors = [
  "Ahmed Al-Kuwari",
  "Fatima Al-Thani",
  "Mohammed Al-Mansoori",
  "Nasser Al-Attiyah",
  "Sara Al-Dosari"
];

const conditions: ("Good" | "Fair" | "Poor")[] = ["Good", "Good", "Good", "Fair", "Fair", "Poor"];

// Generate mock detected assets (120 samples across all categories)
export const mockDetectedAssets: DetectedAsset[] = assetTypes.slice(0, 120 % assetTypes.length ? 120 : assetTypes.length).map((asset, idx) => {
  const actualAsset = assetTypes[idx % assetTypes.length];
  const baseDate = new Date(2025, 0, 1); // January 1, 2025
  const daysAgo = Math.floor(Math.random() * 30);
  const surveyDate = new Date(baseDate.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  
  return {
    id: `asset-${String(idx + 1).padStart(4, "0")}`,
    assetCode: actualAsset.code,
    category: actualAsset.category,
    type: actualAsset.type,
    routeId: `R${String((idx % 10) + 1).padStart(3, "0")}`,
    roadName: qatarRoads[idx % qatarRoads.length],
    condition: conditions[idx % conditions.length],
    confidence: 0.75 + Math.random() * 0.24, // 75-99%
    surveyDate: surveyDate.toISOString().split('T')[0],
    lat: 25.2854 + (Math.random() - 0.5) * 0.2, // Doha area
    lng: 51.531 + (Math.random() - 0.5) * 0.2,
    surveyorName: surveyors[idx % surveyors.length],
    notes: idx % 5 === 0 ? "Requires maintenance attention" : undefined
  };
});

// Get asset statistics by category
export const getAssetStatsByCategory = () => {
  const stats: Record<string, { total: number; good: number; fair: number; poor: number }> = {};
  
  mockDetectedAssets.forEach(asset => {
    if (!stats[asset.category]) {
      stats[asset.category] = { total: 0, good: 0, fair: 0, poor: 0 };
    }
    stats[asset.category].total++;
    if (asset.condition === "Good") stats[asset.category].good++;
    if (asset.condition === "Fair") stats[asset.category].fair++;
    if (asset.condition === "Poor") stats[asset.category].poor++;
  });
  
  return stats;
};

// Get recent detections
export const getRecentDetections = (limit: number = 10) => {
  return [...mockDetectedAssets]
    .sort((a, b) => new Date(b.surveyDate).getTime() - new Date(a.surveyDate).getTime())
    .slice(0, limit);
};
