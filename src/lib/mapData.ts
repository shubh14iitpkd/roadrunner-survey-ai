// Helpers for the columnar /master/map-points payload (`MapData`). The
// goal is to never allocate one AssetRecord per row at 1M scale — pages
// now hand `MapData` straight to LibraryMapView, and only build a full
// AssetRecord when a row is actually selected.

import type { AssetRecord, MapData } from "@/types/asset";

const DAMAGED_CONDITIONS = new Set([
  "overgrown", "fadedpaint", "dirty", "missing", "broken", "bent", "damaged",
]);

/** Marker color for a condition string. Mirrors the per-page helpers but
 *  centralized so the lazy-built AssetRecord matches whatever the
 *  full-row constructors would have produced. */
export function conditionToColor(condition: string | undefined): string {
  const c = (condition ?? "").toLowerCase();
  if (DAMAGED_CONDITIONS.has(c)) return "#ef4444"; // red-500
  if (c === "good") return "#22c55e"; // green-500
  return "#f59e0b"; // amber-500
}

export interface AssetBuildHelpers {
  getAssetDisplayName: (a: { asset_id?: string; assetId?: string }) => string;
  getCategoryDisplayName: (categoryId: string) => string;
}

/** Materialize a single AssetRecord from the columnar MapData at the
 *  given index. Used on click handlers, neighbor merges, and table-row
 *  jumps — once per user interaction, not once per row in the dataset. */
export function buildAssetFromMapData(
  data: MapData,
  idx: number,
  helpers: AssetBuildHelpers,
): AssetRecord {
  const id = data.ids[idx];
  const asset_id = data.asset_ids[idx] ?? "";
  const condition = data.conditions[idx] ?? "unknown";
  const rid = data.route_ids[idx];
  const isLine = data.lineSet.has(id);
  const extras = isLine ? data.line_extras[id] : undefined;
  const rec: AssetRecord = {
    id,
    assetDisplayId: id,
    masterDisplayId: id,
    assetId: asset_id,
    asset_id,
    assetType: helpers.getAssetDisplayName({ asset_id }) || "",
    assetCategory: helpers.getCategoryDisplayName(data.category_ids[idx] ?? ""),
    defectId: data.defect_ids?.[idx] ?? "",
    lat: data.lats[idx] ?? 0,
    lng: data.lngs[idx] ?? 0,
    condition,
    markerColor: conditionToColor(condition),
    groupId: data.group_ids[idx] ?? undefined,
    routeId: rid ?? undefined,
    side: data.sides[idx] || "Unknown",
    zone: data.zones[idx] || "Unknown",
    category_id: data.category_ids[idx] ?? "",
    roadName: rid != null ? (data.routeDict[String(rid)] ?? "") : "",
    // Filled by the detail fetch when the sidebar opens.
    lastSurveyDate: "",
    issue: data.issues?.[idx] ?? "",
    severity: "Low",
    kind: isLine ? "line" : "point",
  };
  if (extras) {
    if (extras.classification) rec.classification = extras.classification as AssetRecord["classification"];
    if (extras.geometry) rec.geometry = extras.geometry;
  }
  return rec;
}

/** Optimistic in-place flip of `conditions[idx]` for a given master
 *  display id. Returns a NEW MapData reference so React Query's
 *  setQueryData triggers a re-render, but reuses the underlying arrays
 *  except for `conditions` (one shallow slice — at 1M that's 8 MB of
 *  refs, much cheaper than recreating row objects). */
export function withConditionPatch(
  data: MapData,
  masterDisplayId: string,
  newCondition: string,
): MapData {
  const idx = data.idIndex.get(masterDisplayId);
  if (idx === undefined) return data;
  const conditions = data.conditions.slice();
  conditions[idx] = newCondition;
  return { ...data, conditions };
}

/** Same idea for the issue field — used by the Defect Library "edit
 *  issue" flow. No-op when issues column is absent (asset library). */
export function withIssuePatch(
  data: MapData,
  masterDisplayId: string,
  newIssue: string,
): MapData {
  if (!data.issues) return data;
  const idx = data.idIndex.get(masterDisplayId);
  if (idx === undefined) return data;
  const issues = data.issues.slice();
  issues[idx] = newIssue;
  return { ...data, issues };
}
