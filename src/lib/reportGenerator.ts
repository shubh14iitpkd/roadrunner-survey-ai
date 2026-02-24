// Report generation utilities for anomaly/asset reports
// Generates formatted Excel files with specified formats

import { assetTypes, assetCategories } from "@/data/assetCategories";
import { exportToExcel } from "@/lib/excelExport";

// Deterministic seeded random helper
function seededRandom(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

const ROADS = [
  "Al Shamal Road", "Al Corniche Street", "West Bay Road", "Salwa Road",
  "C Ring Road", "Lusail Expressway", "Dukhan Highway", "Al Wakra Road",
  "Industrial Area Road", "Airport Road",
];

const DIRECTIONS = ["LHS", "RHS"] as const;
const SIDES = ["Shoulder", "Median", "Pavement", "Overhead"] as const;
const ISSUE_TYPES = [
  "Faded text", "Structural crack", "Corrosion", "Missing component",
  "Concrete spalling", "Paint peeling", "Tilt/Lean", "Obstruction",
  "Electrical fault", "Surface damage", "Deformation", "Vandalism",
];

interface AnomalyRecord {
  anomalyId: string;
  assetId: string;
  assetType: string;
  assetCategory: string;
  lat: number;
  lon: number;
  roadName: string;
  direction: string;
  side: string;
  lastSurveyDate: string;
  issueType: string;
}

// Generate deterministic demo anomaly records
function generateAnomalyRecords(): AnomalyRecord[] {
  const records: AnomalyRecord[] = [];
  let idx = 0;
  
  for (const at of assetTypes) {
    const anomalyCount = ((idx * 23 + 7) % 15);
    for (let j = 0; j < anomalyCount; j++) {
      const seed = idx * 100 + j;
      const road = ROADS[Math.floor(seededRandom(seed) * ROADS.length)];
      const dir = DIRECTIONS[Math.floor(seededRandom(seed + 1) * 2)];
      const side = SIDES[Math.floor(seededRandom(seed + 2) * SIDES.length)];
      const issue = ISSUE_TYPES[Math.floor(seededRandom(seed + 3) * ISSUE_TYPES.length)];
      const lat = 25.2 + seededRandom(seed + 4) * 0.3;
      const lon = 51.4 + seededRandom(seed + 5) * 0.2;
      const dayOffset = Math.floor(seededRandom(seed + 6) * 60);
      const date = new Date(2025, 10 - Math.floor(dayOffset / 30), 28 - (dayOffset % 28));

      records.push({
        anomalyId: `ANO-${String(records.length + 1).padStart(5, "0")}`,
        assetId: `AST-${at.code}-${String(j + 1).padStart(3, "0")}`,
        assetType: at.type,
        assetCategory: at.category,
        lat: parseFloat(lat.toFixed(6)),
        lon: parseFloat(lon.toFixed(6)),
        roadName: road,
        direction: dir,
        side: side,
        lastSurveyDate: date.toISOString().split("T")[0],
        issueType: issue,
      });
    }
    idx++;
  }
  return records;
}

/**
 * Report 1: Per Asset-Type
 */
export function exportAnomalyByAssetTypeReport(filterAssetType?: string) {
  const records = generateAnomalyRecords();
  const filtered = filterAssetType
    ? records.filter(r => r.assetType === filterAssetType)
    : records;

  const headers = [
    "Anomaly ID", "Asset ID", "Latitude", "Longitude",
    "Road Name", "Direction (LHS/RHS)", "Side", "Last Survey Date", "Issue Type",
  ];

  const rows = filtered.map(r => [
    r.anomalyId, r.assetId, r.lat, r.lon,
    r.roadName, r.direction, r.side, r.lastSurveyDate, r.issueType,
  ]);

  const suffix = filterAssetType ? filterAssetType.replace(/\s+/g, "_") : "All_Types";
  exportToExcel({
    filename: `Anomaly_Report_AssetType_${suffix}.xlsx`,
    sheetName: "By Asset Type",
    title: "RoadSight AI — Anomaly Report by Asset Type",
    subtitle: `Filter: ${filterAssetType || "All Types"} | Generated: ${new Date().toLocaleDateString()} | ${filtered.length} records`,
    headers,
    rows,
  });
}

/**
 * Report 2: Per Road
 */
export function exportAnomalyByRoadReport(filterRoad?: string) {
  const records = generateAnomalyRecords();
  const filtered = filterRoad
    ? records.filter(r => r.roadName === filterRoad)
    : records;

  const headers = [
    "Anomaly ID", "Asset ID", "Asset Type", "Asset Category",
    "Latitude", "Longitude", "Direction (LHS/RHS)", "Side",
    "Last Survey Date", "Issue Type",
  ];

  const rows = filtered.map(r => [
    r.anomalyId, r.assetId, r.assetType, r.assetCategory,
    r.lat, r.lon, r.direction, r.side,
    r.lastSurveyDate, r.issueType,
  ]);

  const suffix = filterRoad ? filterRoad.replace(/\s+/g, "_") : "All_Roads";
  exportToExcel({
    filename: `Anomaly_Report_Road_${suffix}.xlsx`,
    sheetName: "By Road",
    title: "RoadSight AI — Anomaly Report by Road",
    subtitle: `Filter: ${filterRoad || "All Roads"} | Generated: ${new Date().toLocaleDateString()} | ${filtered.length} records`,
    headers,
    rows,
  });
}

/**
 * Report 3: Road-wise Asset-Type
 */
export function exportRoadWiseAssetTypeReport() {
  const records = generateAnomalyRecords();
  const sorted = [...records].sort((a, b) => {
    const roadCmp = a.roadName.localeCompare(b.roadName);
    if (roadCmp !== 0) return roadCmp;
    return a.assetType.localeCompare(b.assetType);
  });

  const headers = [
    "Road Name", "Asset Type", "Asset Category", "Anomaly ID", "Asset ID",
    "Latitude", "Longitude", "Direction (LHS/RHS)", "Side",
    "Last Survey Date", "Issue Type",
  ];

  const rows = sorted.map(r => [
    r.roadName, r.assetType, r.assetCategory, r.anomalyId, r.assetId,
    r.lat, r.lon, r.direction, r.side,
    r.lastSurveyDate, r.issueType,
  ]);

  exportToExcel({
    filename: "Anomaly_Report_RoadWise_AssetType.xlsx",
    sheetName: "Road × Asset Type",
    title: "RoadSight AI — Road-wise Asset Type Report",
    subtitle: `Generated: ${new Date().toLocaleDateString()} | ${sorted.length} records | Sorted by Road → Asset Type`,
    headers,
    rows,
  });
}
