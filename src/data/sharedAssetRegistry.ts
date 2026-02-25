/**
 * Shared Asset Registry
 * 
 * DATA MODEL PRINCIPLES:
 * 1. Every asset has a persistent ID (AST-XXXXX) that remains constant across surveys
 * 2. Every anomaly has a unique ID (ANM-XXXX) linked to a specific asset ID
 * 3. One asset has only ONE best frame per survey — no duplicate annotations
 * 4. Only one asset is annotated per frame (background assets are ignored)
 * 5. GIS markers are placed at the physical asset location, offset by side
 *    (e.g. shoulder-left assets are offset to the left of the road centreline)
 * 6. All colors use design system tokens — no hardcoded hex/rgb values
 */

import { assetTypes } from "./assetCategories";

// ─── Types ───────────────────────────────────────────────────────────
export interface AssetRecord {
  assetId: string;
  assetType: string;
  assetCategory: string;
  lat: number;
  lng: number;
  roadName: string;
  direction: "LHS" | "RHS";
  side: "Shoulder" | "Median" | "Pavement" | "Overhead";
  /** Survey in which this asset was first detected */
  firstSurveyId: string;
  /** Best frame URL for the most recent survey (one frame per asset per survey) */
  bestFrameUrl?: string;
  /** Most recent survey date */
  lastSurveyDate: string;
  condition: "Good" | "Fair" | "Poor";
  imageUrl?: string;
}

export interface AnomalyRecord {
  anomalyId: string;
  /** References an existing AssetRecord.assetId */
  assetId: string;
  assetType: string;
  assetCategory: string;
  /** Inherited from the parent asset — same physical location */
  lat: number;
  lng: number;
  roadName: string;
  direction: "LHS" | "RHS";
  side: "Shoulder" | "Median" | "Pavement" | "Overhead";
  lastSurveyDate: string;
  issue: string;
  severity: "High" | "Medium" | "Low";
  imageUrl?: string;
}

// ─── Constants ───────────────────────────────────────────────────────
const ROADS = [
  "Al Corniche Street", "West Bay Road", "Salwa Road", "C Ring Road",
  "Lusail Expressway", "Dukhan Highway", "Al Shamal Road", "Orbital Highway",
];

const DIRECTIONS: ("LHS" | "RHS")[] = ["LHS", "RHS"];
const SIDES: ("Shoulder" | "Median" | "Pavement" | "Overhead")[] = [
  "Shoulder", "Median", "Pavement", "Overhead",
];

const SURVEY_IDS = ["SRV-2025-Q3-01", "SRV-2025-Q3-02", "SRV-2025-Q4-01"];

const ISSUES_BY_CATEGORY: Record<string, string[]> = {
  "DIRECTIONAL SIGNAGE": ["Faded text/symbol", "Sign face damaged", "Post tilted >15°", "Sign missing", "Reflectivity below standard", "Graffiti/vandalism"],
  "ITS": ["Device offline", "Lens obscured", "Power supply failure", "Communication loss", "Housing damaged", "Sensor malfunction"],
  "OTHER INFRASTRUCTURE ASSETS": ["Guardrail deformed", "End terminal missing", "Surface cracking >5mm", "Reflector missing", "Bolt/anchor loose", "Corrosion >30%"],
  "ROADWAY LIGHTING": ["Lamp not operational", "Pole leaning >5°", "Cable exposed", "Luminaire damaged", "Feeder pillar door open", "Foundation cracking"],
  "STRUCTURES": ["Concrete spalling", "Expansion joint damaged", "Bearing displacement", "Drainage blocked", "Rebar exposed", "Crack width >2mm"],
  "BEAUTIFICATION": ["Tree dead/dying", "Irrigation leak", "Planter damaged", "Fence broken", "Turf bare patches >1m²", "Light fixture broken"],
};

// ─── Seeded random (deterministic) ──────────────────────────────────
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ─── GIS offset by side ─────────────────────────────────────────────
// Offsets the marker from the road centreline to approximate the
// physical location on shoulder, median, pavement, or overhead.
function applyGisOffset(
  baseLat: number, baseLng: number,
  side: "Shoulder" | "Median" | "Pavement" | "Overhead",
  direction: "LHS" | "RHS"
): { lat: number; lng: number } {
  // ~15m offset in degrees (≈ 0.00013°)
  const offsetDeg = 0.00013;
  const sign = direction === "LHS" ? -1 : 1;

  switch (side) {
    case "Shoulder":
      return { lat: baseLat, lng: baseLng + sign * offsetDeg * 2 };
    case "Median":
      return { lat: baseLat, lng: baseLng - sign * offsetDeg };
    case "Pavement":
      return { lat: baseLat, lng: baseLng + sign * offsetDeg * 0.5 };
    case "Overhead":
      return { lat: baseLat, lng: baseLng }; // directly above road
  }
}

// ─── Build master asset list (stable, deterministic) ─────────────────
let _assets: AssetRecord[] | null = null;

export function getMasterAssets(): AssetRecord[] {
  if (_assets) return _assets;

  const rand = seededRandom(42);
  const assets: AssetRecord[] = [];

  assetTypes.forEach((at, idx) => {
    const count = Math.floor(rand() * 5) + 1;
    for (let j = 0; j < count; j++) {
      const direction = DIRECTIONS[Math.floor(rand() * 2)];
      const side = SIDES[Math.floor(rand() * 4)];
      const baseLat = 25.2854 + (rand() - 0.5) * 0.15;
      const baseLng = 51.531 + (rand() - 0.5) * 0.15;
      const { lat, lng } = applyGisOffset(baseLat, baseLng, side, direction);

      const conditionRoll = rand();
      const condition: "Good" | "Fair" | "Poor" = conditionRoll < 0.5 ? "Good" : conditionRoll < 0.85 ? "Fair" : "Poor";

      assets.push({
        assetId: `AST-${String(assets.length + 1).padStart(5, "0")}`,
        assetType: at.type,
        assetCategory: at.category,
        lat,
        lng,
        roadName: ROADS[Math.floor(rand() * ROADS.length)],
        direction,
        side,
        firstSurveyId: SURVEY_IDS[Math.floor(rand() * SURVEY_IDS.length)],
        bestFrameUrl: undefined,
        lastSurveyDate: `2025-${String(Math.floor(rand() * 3) + 9).padStart(2, "0")}-${String(Math.floor(rand() * 28) + 1).padStart(2, "0")}`,
        condition,
      });
    }
  });

  _assets = assets;
  return assets;
}

// ─── Build anomaly list (each anomaly references an existing asset) ──
let _anomalies: AnomalyRecord[] | null = null;

export function getAnomalies(): AnomalyRecord[] {
  if (_anomalies) return _anomalies;

  const rand = seededRandom(99);
  const assets = getMasterAssets();
  const anomalies: AnomalyRecord[] = [];

  // Pick a subset of assets that have anomalies (~30%)
  const anomalyAssets = assets.filter(() => rand() < 0.3);

  anomalyAssets.forEach((asset) => {
    const categoryIssues = ISSUES_BY_CATEGORY[asset.assetCategory] || ["Damaged"];
    const issueCount = Math.floor(rand() * 2) + 1; // 1-2 anomalies per affected asset

    for (let j = 0; j < issueCount; j++) {
      const severityRoll = rand();
      const severity: "High" | "Medium" | "Low" = severityRoll < 0.3 ? "High" : severityRoll < 0.65 ? "Medium" : "Low";
      anomalies.push({
        anomalyId: `ANM-${String(anomalies.length + 1).padStart(4, "0")}`,
        assetId: asset.assetId,
        assetType: asset.assetType,
        assetCategory: asset.assetCategory,
        lat: asset.lat,
        lng: asset.lng,
        roadName: asset.roadName,
        direction: asset.direction,
        side: asset.side,
        lastSurveyDate: asset.lastSurveyDate,
        issue: categoryIssues[Math.floor(rand() * categoryIssues.length)],
        severity,
      });
    }
  });

  _anomalies = anomalies;
  return anomalies;
}