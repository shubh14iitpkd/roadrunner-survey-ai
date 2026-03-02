// Report generation utilities for anomaly/asset reports
// Generates formatted Excel files with actual data from the API

import { exportToExcel } from "@/lib/excelExport";
import { apiFetch } from "@/lib/api";
import type { ResolvedMap } from "@/contexts/LabelMapContext";
import capitalize from "@/helpers/capitalize";
// ── helpers ──────────────────────────────────────────────────────────────────

/** Fetch ALL damaged assets from the master endpoint (no pagination). */
async function fetchDamagedAssets(filterAssetType?: string): Promise<any[]> {
  const qs = new URLSearchParams({ condition: "damaged" });
  const resp = await apiFetch(`/api/assets/master?${qs.toString()}`, { method: "POST" });

  // The master endpoint may return an array or { items: [] }
  const items: any[] = Array.isArray(resp) ? resp : (resp?.items ?? resp?.assets ?? []);
  if (filterAssetType) {
    return items.filter(
      (a: any) =>
        (a.asset_id || "").toLowerCase() === filterAssetType.toLowerCase()
    );
  }
  return items;
}

/** Fetch top anomaly roads from the dashboard endpoint. */
async function fetchTopAnomalyRoads(): Promise<any[]> {
  const resp = await apiFetch("/api/dashboard/tables/top-anomaly-roads");
  return Array.isArray(resp) ? resp : (resp?.items ?? []);
}

/** Map a raw asset record to a normalised row, resolving category_id via labelMap. */
function assetToRow(asset: any, labelMap?: ResolvedMap | null) {
  const mongoId = asset._id
    ? (typeof asset._id === 'object' && (asset._id as any).$oid ? (asset._id as any).$oid : String(asset._id))
    : "—";

  const categoryId: string | undefined = asset.category_id ?? asset.category;
  const categoryName =
    (categoryId && labelMap?.categories?.[categoryId]?.display_name) ||
    (categoryId && labelMap?.categories?.[categoryId]?.default_name) ||
    categoryId ||
    "—";

  const assetIdKey: string | undefined = asset.asset_id;
  const assetTypeName =
    (assetIdKey && labelMap?.labels?.[assetIdKey]?.display_name) ||
    (assetIdKey && labelMap?.labels?.[assetIdKey]?.default_name) ||
    asset.display_name ||
    asset.type ||
    "—";

  return {
    id: mongoId.toUpperCase(),
    anomalyId: asset.defect_id ?? mongoId,
    assetId: asset.asset_id ?? asset.id ?? "—",
    assetType: assetTypeName,
    assetCategory: categoryName,
    lat: asset?.location?.coordinates[1] ?? "—",
    lon: asset?.location?.coordinates[0] ?? "—",
    roadName: asset.road_name ?? asset.road ?? asset.route_name ?? "—",
    side: asset.side ?? "—",
    zone: asset.zone ?? "—",
    lastSurveyDate: asset.survey_date ?? asset.last_survey_date ?? asset.date ?? "—",
    issueType: asset.issue ?? asset.condition_detail ?? asset.condition ?? "damaged",
  };
}

export async function exportDefectByAssetTypeReport(filterAssetType?: string, labelMap?: ResolvedMap | null) {
  const assets = await fetchDamagedAssets(filterAssetType);
  const rows = assets.map(a => assetToRow(a, labelMap));

  const headers = [
    "Defect ID", "Asset ID", "Latitude", "Longitude",
    "Road Name", "Side", "Zone", "Last Survey Date", "Issue Type",
  ];

  const data = rows.map(r => [
    r.anomalyId, r.id, r.lat, r.lon,
    r.roadName, capitalize(r.side), capitalize(r.zone), r.lastSurveyDate, capitalize(r.issueType),
  ]);

  const suffix = labelMap?.labels?.[filterAssetType]?.display_name || "All_Types";
  exportToExcel({
    filename: `Defect_Report_AssetType_${suffix}.xlsx`,
    sheetName: "By Asset Type",
    title: "RoadSight AI — Defect Report by Asset Type",
    subtitle: `Filter: ${suffix} | Generated: ${new Date().toLocaleDateString()} | ${data.length} records`,
    headers,
    rows: data,
  });
}

export async function exportDefectByRoadReport(filterRoad?: string, labelMap?: ResolvedMap | null) {
  const assets = await fetchDamagedAssets();
  const all = assets.map(a => assetToRow(a, labelMap));

  const filtered = filterRoad
    ? all.filter(r => r.roadName === filterRoad)
    : all;

  const headers = [
    "Defect ID", "Asset ID", "Asset Type", "Asset Category",
    "Latitude", "Longitude", "Side", "Zone",
    "Last Survey Date", "Issue Type",
  ];

  const data = filtered.map(r => [
    r.anomalyId, r.id, r.assetType, r.assetCategory,
    r.lat, r.lon, capitalize(r.side), capitalize(r.zone),
    r.lastSurveyDate, capitalize(r.issueType),
  ]);

  const suffix = filterRoad ? filterRoad.replace(/\s+/g, "_") : "All_Roads";
  exportToExcel({
    filename: `Defect_Report_Road_${suffix}.xlsx`,
    sheetName: "By Road",
    title: "RoadSight AI — Defect Report by Road",
    subtitle: `Filter: ${filterRoad || "All Roads"} | Generated: ${new Date().toLocaleDateString()} | ${data.length} records`,
    headers,
    rows: data,
  });
}

// ── Report 3: Road-wise Asset-Type ────────────────────────────────────────────

export async function exportRoadWiseAssetTypeReport(labelMap?: ResolvedMap | null) {
  const assets = await fetchDamagedAssets();
  const rows = assets.map(a => assetToRow(a, labelMap)).sort((a, b) => {
    const roadCmp = a.roadName.localeCompare(b.roadName);
    if (roadCmp !== 0) return roadCmp;
    return a.assetType.localeCompare(b.assetType);
  });

  const headers = [
    "Road Name", "Asset Type", "Asset Category", "Anomaly ID", "Asset ID",
    "Latitude", "Longitude", "Side", "Zone",
    "Last Survey Date", "Issue Type",
  ];

  const data = rows.map(r => [
    r.roadName, r.assetType, r.assetCategory, r.anomalyId, r.id,
    r.lat, r.lon, capitalize(r.side), capitalize(r.zone),
    r.lastSurveyDate, capitalize(r.issueType),
  ]);

  exportToExcel({
    filename: "Defect_Report_RoadWise_AssetType.xlsx",
    sheetName: "Road × Asset Type",
    title: "RoadSight AI — Road-wise Asset Type Report",
    subtitle: `Generated: ${new Date().toLocaleDateString()} | ${data.length} records | Sorted by Road → Asset Type`,
    headers,
    rows: data,
  });
}
