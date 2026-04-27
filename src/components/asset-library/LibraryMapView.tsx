import { useEffect, useRef, useMemo, useCallback } from "react";
import {
  MapContainer,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import Supercluster from "supercluster";
import type { MapData } from "@/types/asset";
import { useLabelMap, type ResolvedMap } from "@/contexts/LabelMapContext";
import { isAssetIconExist, getAssetIconFromId } from "@/components/settings/iconConfig";

/* ── Constants ──────────────────────────────────────────── */
const SELECTED_COLOR = "#3b82f6"; // blue-500
const DEFAULT_RADIUS = 6;
const SELECTED_RADIUS = 10;
const LINE_SIDED_COLOR = "#22d3ee";    // cyan-400
const LINE_UNSIDED_COLOR = "#f59e0b";  // amber-500

// Supercluster tuning. radius is screen-pixel grouping distance; maxZoom is
// the zoom past which clustering stops — points render individually so
// singletons can be highlighted on selection without forcing a deeper zoom.
const CLUSTER_RADIUS_PX = 10;
const CLUSTER_MAX_ZOOM = 13;
const CLUSTER_MIN_POINTS = 3;

const DAMAGED_CONDITIONS = new Set([
  'overgrown', 'fadedpaint', 'dirty', 'missing', 'broken', 'bent', 'damaged',
]);

function conditionToColor(condition: string | undefined): string {
  const c = (condition ?? '').toLowerCase();
  if (DAMAGED_CONDITIONS.has(c)) return '#ef4444'; // red-500
  if (c === 'good') return '#22c55e'; // green-500
  return '#f59e0b'; // amber for unknown
}

/* ── Helper: metres between two lat/lngs (Haversine) ────── */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Helper: deterministic per-route colour (medium vibrancy) ── */
function routeColor(key: string, selected: boolean): string {
  let hash = 4321;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 33) ^ key.charCodeAt(i);
  }
  const hue = Math.abs(hash) % 360;
  const sat = selected ? 70 : 60;
  const lit = selected ? 55 : 50;
  return `hsl(${hue}, ${sat}%, ${lit}%)`;
}

/* ── Line keypoint type (fetched on-demand via /master/<id>/keypoints) ── */
type LineKeypoint = {
  frame: number;
  lat: number;
  lng: number;
  side?: string | null;
  box?: { x: number; y: number; width: number; height: number };
};

/** Per-row override that flows out of a click. Lines forward the snap
 *  point (lat/lng/frame/box of the nearest keypoint) so the page can show
 *  the right frame in the sidebar. */
export interface MapClickOverrides {
  frameNumber?: number;
  box?: { x: number; y: number; width: number; height: number };
  lat?: number;
  lng?: number;
}

/* ── Supercluster property shape ─────────────────────────── */
type ClusterProps = {
  id: string;
  condition: string;
  // Accumulated condition counts so reduce() can pick the dominant.
  conds: Record<string, number>;
};

interface LibraryMapViewProps {
  /** Columnar map-points payload. LibraryMapView indexes into the parallel
   *  arrays by position; it never materializes one AssetRecord per row. */
  data: MapData;
  selectedId: string | null;
  /** Called with the master_display_id of the clicked asset. Lines also
   *  pass `overrides` carrying the nearest-keypoint snap (lat/lng/frame/box)
   *  so the sidebar shows the right observation frame. */
  onSelect: (id: string, overrides?: MapClickOverrides) => void;
  /** Display name resolver, used in tooltips. Pages already hold a
   *  labelMap-aware version of this — passing it down avoids touching
   *  labelMap inside the map view. */
  getAssetDisplayName: (a: { asset_id?: string; assetId?: string }) => string;
  /** Fetch keypoints for a line asset on-demand. */
  onFetchLineKeypoints?: (masterDisplayId: string) => Promise<LineKeypoint[]>;
  /** Fetch the full (un-simplified) geometry for a line on-demand. */
  onFetchLineGeometry?: (masterDisplayId: string) => Promise<{
    type: "LineString";
    coordinates: [number, number][];
  } | null>;
}

/* ── Fast unmount: bypass per-layer teardown on unmount.
 * Leaflet's map.remove() iterates every layer synchronously — with tens of
 * thousands of CircleMarkers this stalls the main thread for seconds when
 * navigating away. Stubbing _layers leaves nothing for remove() to walk. */
function FastUnmount() {
  const map = useMap();
  useEffect(() => {
    return () => {
      try { (map as unknown as { _layers: Record<string, unknown> })._layers = {}; } catch { /* noop */ }
    };
  }, [map]);
  return null;
}

/* ── Fits bounds whenever data first appears ───────────── */
function FitBounds({ data }: { data: MapData }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current || data.count === 0) return;
    // Sample up to 5000 points for fit — fitting on 1M lat/lngs is wasteful
    // and the bounds computation result is identical at any reasonable
    // sample size (we already cap zoom at 16).
    const stride = Math.max(1, Math.floor(data.count / 5000));
    const latlngs: [number, number][] = [];
    for (let i = 0; i < data.count; i += stride) {
      latlngs.push([data.lats[i], data.lngs[i]]);
    }
    // Lines: include first coord of each line geometry so a route-only
    // dataset still fits.
    for (const id of data.lineSet) {
      const g = data.line_extras[id]?.geometry;
      if (g?.coordinates?.length) {
        const c = g.coordinates[0];
        latlngs.push([c[1], c[0]]);
      }
    }
    if (!latlngs.length) return;
    const bounds = L.latLngBounds(latlngs);
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [10, 10], maxZoom: 16 });
      fitted.current = true;
    }
  }, [data, map]);

  return null;
}

/* ── Flies to selected asset; jumps past CLUSTER_MAX_ZOOM so the asset is
 * never hidden inside a cluster cell when highlighted. */
function FlyToSelected({
  data,
  selectedId,
}: {
  data: MapData;
  selectedId: string | null;
}) {
  const map = useMap();
  const prevId = useRef(selectedId);

  useEffect(() => {
    if (selectedId === prevId.current) return;
    prevId.current = selectedId;
    if (!selectedId) return;
    const idx = data.idIndex.get(selectedId);
    if (idx === undefined) return;
    let lat = data.lats[idx];
    let lng = data.lngs[idx];
    if (data.lineSet.has(selectedId)) {
      const g = data.line_extras[selectedId]?.geometry;
      if (g?.coordinates?.[0]) {
        lng = g.coordinates[0][0];
        lat = g.coordinates[0][1];
      }
    }
    map.setView([lat, lng], Math.max(map.getZoom(), CLUSTER_MAX_ZOOM + 1), { animate: false });
  }, [selectedId, data, map]);

  return null;
}

/* ── Client-side cluster + line render layer ─────────────
 * Supercluster builds a kdbush index over the point indices once per
 * dataset. On every move/zoom we ask the index for the cells in the current
 * viewport and render each cell as one marker — visually identical to a
 * singleton, so the user can't tell a cluster from a real asset. Clicking
 * a cluster zooms in to its expansion zoom; clicking a singleton fires
 * onSelect(id). Lines bypass clustering entirely. */
function ClusterLayer({
  data,
  selectedId,
  onSelect,
  wantsIcons,
  labelMapData,
  getAssetDisplayName,
  onFetchLineKeypoints,
  onFetchLineGeometry,
}: {
  data: MapData;
  selectedId: string | null;
  onSelect: (id: string, overrides?: MapClickOverrides) => void;
  wantsIcons: boolean;
  labelMapData: ResolvedMap | null;
  getAssetDisplayName: (a: { asset_id?: string }) => string;
  onFetchLineKeypoints?: (masterDisplayId: string) => Promise<LineKeypoint[]>;
  onFetchLineGeometry?: (masterDisplayId: string) => Promise<{
    type: "LineString";
    coordinates: [number, number][];
  } | null>;
}) {
  const map = useMap();

  // Layer groups: separate so we can blow away markers on every render
  // without disturbing the line diff state.
  const markerLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const lineLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const tooltipRef = useRef<L.Tooltip>(L.tooltip({ direction: "top", offset: [0, -8], opacity: 0.95 }));
  // Per-line caches (keypoints for nearest-frame snap, full geometry).
  const lineKeypointsCacheRef = useRef<Map<string, LineKeypoint[]>>(new Map());
  const lineFullGeomCacheRef = useRef<Map<string, [number, number][]>>(new Map());
  const lineMapRef = useRef<Map<string, L.Polyline>>(new Map());
  // Latest fetcher refs so click closures stay stable.
  const fetchKeypointsRef = useRef(onFetchLineKeypoints);
  fetchKeypointsRef.current = onFetchLineKeypoints;
  const fetchGeometryRef = useRef(onFetchLineGeometry);
  fetchGeometryRef.current = onFetchLineGeometry;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const dataRef = useRef(data);
  dataRef.current = data;
  const getNameRef = useRef(getAssetDisplayName);
  getNameRef.current = getAssetDisplayName;

  // ── Build supercluster index when data changes ────
  // Features are seeded from POINT indices (anything not in lineSet that has
  // valid coords). Lines are diff-rendered separately below.
  const indexRef = useRef<Supercluster<ClusterProps> | null>(null);
  useEffect(() => {
    type Feat = GeoJSON.Feature<GeoJSON.Point, ClusterProps>;
    const features: Feat[] = [];
    for (let i = 0; i < data.count; i++) {
      const id = data.ids[i];
      if (!id) continue;
      if (data.lineSet.has(id)) continue;
      const cond = (data.conditions[i] ?? 'unknown').toLowerCase();
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [data.lngs[i], data.lats[i]] },
        properties: {
          id,
          condition: cond,
          conds: { [cond]: 1 },
        },
      });
    }
    const idx = new Supercluster<ClusterProps>({
      radius: CLUSTER_RADIUS_PX,
      maxZoom: CLUSTER_MAX_ZOOM,
      minPoints: CLUSTER_MIN_POINTS,
      // map() runs on each leaf's properties to seed cluster aggregation.
      // reduce() merges accumulated cluster props pairwise.
      map: (props) => ({
        id: props.id,
        condition: props.condition,
        conds: { ...props.conds },
      }),
      reduce: (acc, props) => {
        for (const k in props.conds) {
          acc.conds[k] = (acc.conds[k] || 0) + props.conds[k];
        }
        let best = acc.condition;
        let bestN = -1;
        for (const k in acc.conds) {
          if (acc.conds[k] > bestN) { bestN = acc.conds[k]; best = k; }
        }
        acc.condition = best;
      },
    });
    idx.load(features);
    indexRef.current = idx;
  }, [data]);

  // ── Mount layer groups on the map ─────────────────────
  useEffect(() => {
    const ml = markerLayerRef.current;
    const ll = lineLayerRef.current;
    ml.addTo(map);
    ll.addTo(map);
    return () => {
      try { map.removeLayer(ml); } catch { /* noop */ }
      try { map.removeLayer(ll); } catch { /* noop */ }
    };
  }, [map]);

  // ── Tooltip helper. Builds content from MapData by index — no per-row
  // AssetRecord allocation. ────────────────────────
  const attachHover = useCallback((marker: L.Layer, id: string) => {
    marker.on('mouseover', (e: L.LeafletMouseEvent) => {
      const d = dataRef.current;
      const i = d.idIndex.get(id);
      if (i === undefined) return;
      const tooltip = tooltipRef.current;
      const name = getNameRef.current({ asset_id: d.asset_ids[i] }) || '';
      const lat = d.lats[i];
      const lng = d.lngs[i];
      tooltip.setLatLng(e.latlng);
      tooltip.setContent(
        `<div class="text-xs leading-tight">` +
        `<div class="font-semibold">${name}</div>` +
        `<div class="text-[10px] text-muted-foreground font-mono">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>` +
        `</div>`
      );
      if (!map.hasLayer(tooltip)) tooltip.addTo(map);
    });
    marker.on('mouseout', () => {
      const tooltip = tooltipRef.current;
      if (map.hasLayer(tooltip)) map.removeLayer(tooltip);
    });
  }, [map]);

  // ── Render markers (clusters + singletons) on every viewport change ──
  const renderMarkers = useCallback(() => {
    const idx = indexRef.current;
    const layer = markerLayerRef.current;
    layer.clearLayers();
    if (!idx) return;

    const bounds = map.getBounds();
    const bbox: [number, number, number, number] = [
      bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(),
    ];
    const zoom = Math.min(map.getZoom(), CLUSTER_MAX_ZOOM + 1);
    const features = idx.getClusters(bbox, Math.floor(zoom));
    const selId = selectedId;
    const d = dataRef.current;

    for (const f of features) {
      const [lng, lat] = f.geometry.coordinates as [number, number];
      const props = f.properties as unknown as (ClusterProps & { cluster?: boolean; cluster_id?: number; point_count?: number });
      const isCluster = !!props.cluster;
      const cond = props.condition ?? 'unknown';
      const id = props.id;
      const isSelected = !isCluster && id === selId;
      const fillColor = isSelected ? SELECTED_COLOR : conditionToColor(cond);
      const radius = isSelected ? SELECTED_RADIUS : DEFAULT_RADIUS;
      const weight = isSelected ? 1.8 : 1.5;
      const fillOpacity = isSelected ? 0.9 : 0.7;

      // Singleton with a known asset_id and an icon mapping → render as icon.
      if (!isCluster) {
        const i = d.idIndex.get(id);
        if (i === undefined) continue;
        const assetKey = d.asset_ids[i];
        const useIcon = wantsIcons && assetKey && isAssetIconExist(assetKey, labelMapData);
        if (useIcon && !isSelected) {
          const icon = getAssetIconFromId(assetKey, labelMapData);
          const m = L.marker([lat, lng], { icon });
          m.on('click', () => onSelectRef.current(id));
          attachHover(m, id);
          layer.addLayer(m);
          continue;
        }
        // Selected icon-marker: draw the icon AND a highlight circle on top.
        if (useIcon && isSelected) {
          const icon = getAssetIconFromId(assetKey, labelMapData);
          const m = L.marker([lat, lng], { icon });
          m.on('click', () => onSelectRef.current(id));
          attachHover(m, id);
          layer.addLayer(m);
          const hi = L.circleMarker([lat, lng], {
            radius: SELECTED_RADIUS,
            color: SELECTED_COLOR,
            fillColor: SELECTED_COLOR,
            fillOpacity: 0.3,
            weight: 2,
          });
          layer.addLayer(hi);
          continue;
        }
        const marker = L.circleMarker([lat, lng], {
          radius, color: '#fff', weight, fillColor, fillOpacity,
        });
        marker.on('click', () => onSelectRef.current(id));
        attachHover(marker, id);
        layer.addLayer(marker);
        if (isSelected) marker.bringToFront();
        continue;
      }

      // Cluster cell — drawn as one plain circle marker.
      const marker = L.circleMarker([lat, lng], {
        radius: DEFAULT_RADIUS,
        color: '#fff',
        weight: 1.5,
        fillColor: conditionToColor(cond),
        fillOpacity: 0.7,
      });
      marker.on('click', () => {
        // Jump past CLUSTER_MAX_ZOOM in one go — supercluster stops clustering
        // beyond it, so the click resolves directly to individual markers.
        const targetZoom = Math.max(map.getZoom() + 1, CLUSTER_MAX_ZOOM + 1);
        map.setView([lat, lng], Math.min(targetZoom, 18), { animate: false });
      });
      layer.addLayer(marker);
    }
  }, [map, selectedId, wantsIcons, labelMapData, attachHover]);

  // Re-render markers on viewport / data / selection changes.
  useEffect(() => {
    renderMarkers();
    const onMove = () => renderMarkers();
    map.on('moveend', onMove);
    map.on('zoomend', onMove);
    return () => {
      map.off('moveend', onMove);
      map.off('zoomend', onMove);
    };
  }, [map, renderMarkers, data, selectedId]);

  // ── Lines: diff render driven by data.lineSet ────
  useEffect(() => {
    const layer = lineLayerRef.current;
    const tooltip = tooltipRef.current;
    const lineMap = lineMapRef.current;

    // Drop polylines that are no longer in the dataset.
    for (const [id, line] of lineMap) {
      if (!data.lineSet.has(id)) {
        layer.removeLayer(line);
        lineMap.delete(id);
      }
    }

    // Add / update polylines for current line ids.
    for (const id of data.lineSet) {
      const i = data.idIndex.get(id);
      if (i === undefined) continue;
      const extras = data.line_extras[id];
      const cachedFull = lineFullGeomCacheRef.current.get(id);
      const coords = extras?.geometry?.coordinates ?? [];
      const positions: [number, number][] = cachedFull
        ? cachedFull
        : coords.map((c) => [c[1], c[0]]);
      if (positions.length < 2) continue;

      const isSelected = id === selectedId;
      const rid = data.route_ids[i];
      const routeKey = String(rid ?? id);
      const classification = extras?.classification;
      const baseColor = classification === 'linear_sided'
        ? LINE_SIDED_COLOR
        : classification === 'linear_unsided'
          ? LINE_UNSIDED_COLOR
          : routeColor(routeKey, isSelected);
      const color = isSelected ? SELECTED_COLOR : baseColor;
      const weight = isSelected ? 7 : 5;
      const opacity = isSelected ? 1 : 0.85;

      let line = lineMap.get(id);
      if (!line) {
        line = L.polyline(positions, { color, weight, opacity, lineCap: 'round', lineJoin: 'round' });

        line.on('click', async (e: L.LeafletMouseEvent) => {
          const { lat, lng } = e.latlng ?? {};
          if (lat == null || lng == null) {
            onSelectRef.current(id);
            return;
          }

          if (
            !lineFullGeomCacheRef.current.has(id) &&
            fetchGeometryRef.current
          ) {
            fetchGeometryRef.current(id)
              .then((geom) => {
                const fullCoords = geom?.coordinates;
                if (!fullCoords || fullCoords.length < 2) return;
                const fullPositions: [number, number][] = fullCoords.map(
                  (c) => [c[1], c[0]]
                );
                lineFullGeomCacheRef.current.set(id, fullPositions);
                const liveLine = lineMap.get(id);
                if (liveLine) liveLine.setLatLngs(fullPositions);
              })
              .catch(() => { /* fall back to simplified geometry */ });
          }

          let kps = lineKeypointsCacheRef.current.get(id);
          if (!kps && fetchKeypointsRef.current) {
            try {
              kps = await fetchKeypointsRef.current(id);
              lineKeypointsCacheRef.current.set(id, kps);
            } catch {
              kps = [];
            }
          }
          if (kps && kps.length > 0) {
            let best = kps[0];
            let bestD = haversineM(lat, lng, best.lat, best.lng);
            for (let j = 1; j < kps.length; j++) {
              const dist = haversineM(lat, lng, kps[j].lat, kps[j].lng);
              if (dist < bestD) { bestD = dist; best = kps[j]; }
            }
            onSelectRef.current(id, {
              frameNumber: best.frame,
              box: best.box,
              lat: best.lat,
              lng: best.lng,
            });
            return;
          }
          onSelectRef.current(id);
        });

        line.on('mouseover', (e) => {
          const d = dataRef.current;
          const ii = d.idIndex.get(id);
          if (ii === undefined) return;
          const name = getNameRef.current({ asset_id: d.asset_ids[ii] }) || '';
          // const cls = d.line_extras[id]?.classification ?? 'line';
          const sd = d.sides[ii];
          tooltip.setLatLng(e.latlng);
          tooltip.setContent(
            `<div class="text-xs leading-tight">` +
            `<div class="font-semibold">${name}` +
            `<span class="text-[11px] pl-1 text-muted-foreground">` +
            (sd ? `${sd}` : "") + `</span></div>` +
            `</div>`
          );
          if (!map.hasLayer(tooltip)) tooltip.addTo(map);
        });
        line.on('mouseout', () => {
          if (map.hasLayer(tooltip)) map.removeLayer(tooltip);
        });

        layer.addLayer(line);
        lineMap.set(id, line);
      } else {
        line.setLatLngs(positions);
        line.setStyle({ color, weight, opacity });
      }
    }

    return () => {
      if (map.hasLayer(tooltip)) map.removeLayer(tooltip);
    };
  }, [data, selectedId, map]);

  return null;
}

/* ── Main component ─────────────────────────────────────── */
export default function LibraryMapView({
  data,
  selectedId,
  onSelect,
  getAssetDisplayName,
  onFetchLineKeypoints,
  onFetchLineGeometry,
}: LibraryMapViewProps) {
  const { data: labelMapData } = useLabelMap();
  const wantsIcons = localStorage.getItem('wants_icons') === 'true';

  // Initial center: first row's lat/lng (or first line's start), with
  // Doha fallback when the dataset is empty.
  const center = useMemo<[number, number]>(() => {
    if (data.count === 0) return [25.3548, 51.1839];
    const firstId = data.ids[0];
    if (firstId && data.lineSet.has(firstId)) {
      const c = data.line_extras[firstId]?.geometry?.coordinates?.[0];
      if (c) return [c[1], c[0]];
    }
    return [data.lats[0], data.lngs[0]];
  }, [data]);

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const stableOnSelect = useCallback((id: string, overrides?: MapClickOverrides) => {
    onSelectRef.current(id, overrides);
  }, []);

  return (
    <MapContainer
      center={center}
      zoom={9}
      className="h-full w-full"
      style={{ minHeight: 200 }}
      zoomControl={true}
      scrollWheelZoom={true}
      preferCanvas={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      />

      <FitBounds data={data} />
      <FlyToSelected data={data} selectedId={selectedId} />
      <FastUnmount />

      <ClusterLayer
        data={data}
        selectedId={selectedId}
        onSelect={stableOnSelect}
        wantsIcons={wantsIcons}
        labelMapData={labelMapData}
        getAssetDisplayName={getAssetDisplayName}
        onFetchLineKeypoints={onFetchLineKeypoints}
        onFetchLineGeometry={onFetchLineGeometry}
      />
    </MapContainer>
  );
}
