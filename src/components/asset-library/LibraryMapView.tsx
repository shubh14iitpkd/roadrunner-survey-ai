import { useEffect, useRef, useMemo, useCallback, useState } from "react";
import {
  MapContainer,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { AssetRecord } from "@/types/asset";
import { useLabelMap, type ResolvedMap } from "@/contexts/LabelMapContext";
import { isAssetIconExist, getAssetIconFromId } from "@/components/settings/iconConfig";

/* ── Constants ──────────────────────────────────────────── */
const SELECTED_COLOR = "#3b82f6"; // blue-500
const DEFAULT_RADIUS = 6;
const SELECTED_RADIUS = 10;
const LINE_SIDED_COLOR = "#22d3ee";    // cyan-400
const LINE_UNSIDED_COLOR = "#f59e0b";  // amber-500

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

/* ── Props ──────────────────────────────────────────────── */
interface LibraryMapViewProps {
  assets: AssetRecord[];
  selectedId: string | null;
  onSelect: (asset: AssetRecord) => void;
  /** Fetch keypoints for a line asset on-demand. Keypoints are no longer in
   * the initial map-points payload — they load on first line click. */
  onFetchLineKeypoints?: (masterDisplayId: string) => Promise<LineKeypoint[]>;
  /** Fetch the full (un-simplified) geometry for a line asset on-demand.
   * /map-points ships a Douglas-Peucker simplified polyline to keep the
   * payload small; full geometry is swapped in on click for accurate shape. */
  onFetchLineGeometry?: (masterDisplayId: string) => Promise<{
    type: "LineString";
    coordinates: [number, number][];
  } | null>;
}

/* ── Fast unmount: bypass per-layer teardown on unmount.
 * Leaflet's map.remove() iterates every layer synchronously — with tens of
 * thousands of CircleMarkers this stalls the main thread for seconds when
 * navigating away. Child-effect cleanup runs before MapContainer's own
 * cleanup, so stubbing map._layers here leaves nothing for the subsequent
 * map.remove() to walk. Unreachable markers are collected by GC later.
 * Only runs on true unmount (stable [map] dep), not on re-renders. */
function FastUnmount() {
  const map = useMap();
  useEffect(() => {
    return () => {
      try { (map as any)._layers = {}; } catch { /* noop */ }
    };
  }, [map]);
  return null;
}

/* ── Fits bounds whenever assets change ─────────────────── */
function FitBounds({ assets }: { assets: AssetRecord[] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current || assets.length === 0) return;
    const latlngs: [number, number][] = [];
    for (const a of assets) {
      if (a.kind === "line" && a.geometry?.coordinates?.length) {
        for (const c of a.geometry.coordinates) latlngs.push([c[1], c[0]]);
      } else {
        latlngs.push([a.lat, a.lng]);
      }
    }
    if (!latlngs.length) return;
    const bounds = L.latLngBounds(latlngs);
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [10, 10], maxZoom: 16 });
      fitted.current = true;
    }
  }, [assets, map]);

  return null;
}

/* ── Flies to selected asset ────────────────────────────── */
function FlyToSelected({
  assets,
  selectedId,
}: {
  assets: AssetRecord[];
  selectedId: string | null;
}) {
  const map = useMap();
  const prevId = useRef(selectedId);

  useEffect(() => {
    if (selectedId === prevId.current) return;
    prevId.current = selectedId;
    if (!selectedId) return;
    const asset = assets.find((a) => a.assetDisplayId === selectedId);
    if (!asset) return;
    // For lines centre on first coord; for points use lat/lng.
    let lat = asset.lat;
    let lng = asset.lng;
    if (asset.kind === "line" && asset.geometry?.coordinates?.[0]) {
      lng = asset.geometry.coordinates[0][0];
      lat = asset.geometry.coordinates[0][1];
    }
    map.setView([lat, lng], Math.max(map.getZoom(), 16), { animate: false });
  }, [selectedId, assets, map]);

  return null;
}

/* ── Canvas marker + polyline layer ────────────────────── */
function CanvasMarkerLayer({
  markerAssets,
  lineAssets,
  selectedId,
  onSelect,
  wantsIcons,
  labelMapData,
  onFetchLineKeypoints,
  onFetchLineGeometry,
}: {
  markerAssets: AssetRecord[];
  lineAssets: AssetRecord[];
  selectedId: string | null;
  onSelect: (asset: AssetRecord) => void;
  wantsIcons: boolean;
  labelMapData: ResolvedMap | null;
  onFetchLineKeypoints?: (masterDisplayId: string) => Promise<LineKeypoint[]>;
  onFetchLineGeometry?: (masterDisplayId: string) => Promise<{
    type: "LineString";
    coordinates: [number, number][];
  } | null>;
}) {
  const map = useMap();
  // Viewport bounds — only assets inside this rect are turned into Leaflet
  // objects. Caps marker count regardless of dataset size, so the Leaflet
  // teardown cost on unmount stays bounded. Updates on pan/zoom end (no
  // thrashing during motion).
  const [bounds, setBounds] = useState<L.LatLngBounds | null>(() => {
    try { const b = map.getBounds(); return b.isValid() ? b : null; } catch { return null; }
  });
  useEffect(() => {
    const update = () => {
      try { const b = map.getBounds(); if (b.isValid()) setBounds(b); } catch { /* noop */ }
    };
    map.on("moveend", update);
    map.on("zoomend", update);
    update();
    return () => {
      map.off("moveend", update);
      map.off("zoomend", update);
    };
  }, [map]);

  const visibleMarkerAssets = useMemo(() => {
    // Until the map has reported a valid viewport, render nothing. Earlier
    // we fell back to the full markerAssets list here, which created ~70k
    // Leaflet objects on first mount (before bounds settled) and defeated
    // the whole purpose of the viewport filter.
    if (!bounds) return [];
    const padded = bounds.pad(0.3);
    let filtered: AssetRecord[] = [];
    for (const a of markerAssets) {
      if (padded.contains([a.lat, a.lng] as [number, number])) filtered.push(a);
    }
    // Hard cap regardless of viewport. fitBounds zooms out to fit the whole
    // dataset on first mount, which puts every point inside the viewport;
    // without this cap we'd still create 70k Leaflet markers on overview
    // views. As the user zooms in, the filter narrows naturally and the
    // cap stops mattering. Sampled uniformly so spatial distribution is
    // preserved (vs. truncating to first N which clusters geographically).
    const MAX_VISIBLE = 2000;
    if (filtered.length > MAX_VISIBLE) {
      const stride = filtered.length / MAX_VISIBLE;
      const sampled: AssetRecord[] = [];
      for (let i = 0; i < MAX_VISIBLE; i++) sampled.push(filtered[Math.floor(i * stride)]);
      filtered = sampled;
    }
    // Selected asset must always render so the fast-path restyle can find it,
    // even if it sits outside the current viewport (e.g. table-click before
    // the map pans to it).
    if (selectedId && !filtered.some(a => a.assetDisplayId === selectedId)) {
      const sel = markerAssets.find(a => a.assetDisplayId === selectedId);
      if (sel) filtered.push(sel);
    }
    return filtered;
  }, [markerAssets, bounds, selectedId]);

  const layerRef = useRef<L.LayerGroup>(L.layerGroup());
  const tooltipRef = useRef<L.Tooltip>(L.tooltip({ direction: "top", offset: [0, -8], opacity: 0.95 }));
  const markerMapRef = useRef<Map<string, L.CircleMarker>>(new Map());
  const iconMarkerMapRef = useRef<Map<string, L.Marker>>(new Map());
  const lineMapRef = useRef<Map<string, L.Polyline>>(new Map());
  const iconHighlightRef = useRef<L.CircleMarker | null>(null);
  const prevSelectedRef = useRef<string | null>(null);
  const assetLookupRef = useRef<Map<string, AssetRecord>>(new Map());
  // Per-line keypoints cache so repeated clicks on the same line don't refetch.
  const lineKeypointsCacheRef = useRef<Map<string, LineKeypoint[]>>(new Map());
  // Per-line full-geometry cache (positions in Leaflet [lat,lng] order).
  // When present, takes priority over the simplified geometry from assets.
  const lineFullGeomCacheRef = useRef<Map<string, [number, number][]>>(new Map());
  // Structural deps — when these change we tear down and rebuild (rare).
  const prevStructuralRef = useRef<{ wantsIcons: boolean; labelMapData: ResolvedMap | null } | null>(null);
  // Keep latest fetchers reachable from stable click closures.
  const fetchKeypointsRef = useRef(onFetchLineKeypoints);
  fetchKeypointsRef.current = onFetchLineKeypoints;
  const fetchGeometryRef = useRef(onFetchLineGeometry);
  fetchGeometryRef.current = onFetchLineGeometry;

  useEffect(() => {
    const layer = layerRef.current;
    const tooltip = tooltipRef.current;
    const markerMap = markerMapRef.current;
    const iconMarkerMap = iconMarkerMapRef.current;
    const lineMap = lineMapRef.current;
    const assetLookup = assetLookupRef.current;

    // Structural change (icons toggled or label map swapped) — full teardown.
    const structural = prevStructuralRef.current;
    const structuralChanged = structural === null
      || structural.wantsIcons !== wantsIcons
      || structural.labelMapData !== labelMapData;
    prevStructuralRef.current = { wantsIcons, labelMapData };

    if (structuralChanged) {
      layer.clearLayers();
      markerMap.clear();
      iconMarkerMap.clear();
      lineMap.clear();
      iconHighlightRef.current = null;
    }

    // Rebuild lookup fresh so click handlers resolve to the latest asset data.
    // Only visible markers are rendered (and therefore clickable), so lookup
    // only needs the visible set + all lines.
    assetLookup.clear();
    for (const a of visibleMarkerAssets) if (a.assetDisplayId) assetLookup.set(a.assetDisplayId, a);
    for (const a of lineAssets) if (a.assetDisplayId) assetLookup.set(a.assetDisplayId, a);

    const attachMarkerHover = (marker: L.Layer, asset: AssetRecord) => {
      marker.on("mouseover", (e: any) => {
        tooltip.setLatLng(e.latlng);
        tooltip.setContent(
          `<div class="text-xs leading-tight">` +
          `<div class="font-semibold">${asset.assetType}</div>` +
          `<div class="text-[10px] text-muted-foreground font-mono">${asset.lat.toFixed(5)}, ${asset.lng.toFixed(5)}</div>` +
          `</div>`
        );
        if (!map.hasLayer(tooltip)) tooltip.addTo(map);
      });
      marker.on("mouseout", () => {
        if (map.hasLayer(tooltip)) map.removeLayer(tooltip);
      });
    };

    // ── Point markers: diff ────────────────────────────────
    const newMarkerIds = new Set<string>();
    const newIconIds = new Set<string>();
    for (const a of visibleMarkerAssets) {
      const displayId = a.assetDisplayId;
      if (!displayId) continue;
      const assetKey = a.asset_id || a.assetId;
      const useIcon = wantsIcons && assetKey && isAssetIconExist(assetKey, labelMapData);
      if (useIcon) newIconIds.add(displayId);
      else newMarkerIds.add(displayId);
    }

    for (const [id, marker] of markerMap) {
      if (!newMarkerIds.has(id)) {
        layer.removeLayer(marker);
        markerMap.delete(id);
      }
    }
    for (const [id, marker] of iconMarkerMap) {
      if (!newIconIds.has(id)) {
        layer.removeLayer(marker);
        iconMarkerMap.delete(id);
      }
    }

    for (const asset of visibleMarkerAssets) {
      const displayId = asset.assetDisplayId;
      if (!displayId) continue;
      const isSelected = displayId === selectedId;
      const assetKey = asset.asset_id || asset.assetId;
      const useIcon = wantsIcons && assetKey && isAssetIconExist(assetKey, labelMapData);

      if (useIcon) {
        let marker = iconMarkerMap.get(displayId);
        if (!marker) {
          const icon = getAssetIconFromId(assetKey!, labelMapData);
          marker = L.marker([asset.lat, asset.lng], { icon });
          marker.on("click", () => {
            const a = assetLookupRef.current.get(displayId);
            if (a) onSelect(a);
          });
          attachMarkerHover(marker, asset);
          layer.addLayer(marker);
          iconMarkerMap.set(displayId, marker);
        } else {
          marker.setLatLng([asset.lat, asset.lng]);
        }
      } else {
        const fillColor = isSelected ? SELECTED_COLOR : (asset.markerColor ?? "red");
        const radius = isSelected ? SELECTED_RADIUS : DEFAULT_RADIUS;
        const weight = isSelected ? 1.8 : 1.5;
        const fillOpacity = isSelected ? 0.9 : 0.7;

        let marker = markerMap.get(displayId);
        if (!marker) {
          marker = L.circleMarker([asset.lat, asset.lng], {
            radius, color: "#fff", weight, fillColor, fillOpacity,
          });
          (marker as any)._assetDisplayId = displayId;
          marker.on("click", () => {
            const a = assetLookupRef.current.get(displayId);
            if (a) onSelect(a);
          });
          attachMarkerHover(marker, asset);
          layer.addLayer(marker);
          markerMap.set(displayId, marker);
        } else {
          marker.setLatLng([asset.lat, asset.lng]);
          marker.setRadius(radius);
          marker.setStyle({ fillColor, fillOpacity, weight });
        }
      }
    }

    // ── Line assets: diff ──────────────────────────────────
    const newLineIds = new Set<string>();
    for (const a of lineAssets) if (a.assetDisplayId) newLineIds.add(a.assetDisplayId);

    for (const [id, line] of lineMap) {
      if (!newLineIds.has(id)) {
        layer.removeLayer(line);
        lineMap.delete(id);
      }
    }

    for (const asset of lineAssets) {
      const displayId = asset.assetDisplayId;
      if (!displayId) continue;
      // Prefer cached full geometry (fetched on click) over the simplified
      // geometry that came down in /map-points, so previously-clicked lines
      // keep their accurate shape across diff updates.
      const cachedFull = lineFullGeomCacheRef.current.get(displayId);
      const coords = asset.geometry?.coordinates ?? [];
      const positions: [number, number][] = cachedFull
        ? cachedFull
        : coords.map((c) => [c[1], c[0]]);
      if (positions.length < 2) continue;
      const isSelected = displayId === selectedId;
      const routeKey = String(asset.routeId ?? displayId);
      const baseColor = asset.classification === "linear_sided"
        ? LINE_SIDED_COLOR
        : asset.classification === "linear_unsided"
          ? LINE_UNSIDED_COLOR
          : routeColor(routeKey, isSelected);
      const color = isSelected ? SELECTED_COLOR : baseColor;
      const weight = isSelected ? 7 : 5;
      const opacity = isSelected ? 1 : 0.85;

      let line = lineMap.get(displayId);
      if (!line) {
        line = L.polyline(positions, { color, weight, opacity, lineCap: "round", lineJoin: "round" });

        line.on("click", async (e: any) => {
          const rec = assetLookupRef.current.get(displayId);
          if (!rec) return;
          const { lat, lng } = e.latlng ?? {};
          if (lat == null || lng == null) {
            onSelect(rec);
            return;
          }
          const cacheKey = rec.masterDisplayId ?? displayId;

          // Kick off full-geometry fetch in parallel — the simplified line
          // is fine for snap-to-nearest, but we want the accurate shape in
          // place for when the user looks closer.
          if (
            !lineFullGeomCacheRef.current.has(cacheKey) &&
            fetchGeometryRef.current &&
            rec.masterDisplayId
          ) {
            fetchGeometryRef.current(rec.masterDisplayId)
              .then((geom) => {
                const fullCoords = geom?.coordinates;
                if (!fullCoords || fullCoords.length < 2) return;
                const fullPositions: [number, number][] = fullCoords.map(
                  (c) => [c[1], c[0]]
                );
                lineFullGeomCacheRef.current.set(cacheKey, fullPositions);
                const liveLine = lineMap.get(displayId);
                if (liveLine) liveLine.setLatLngs(fullPositions);
              })
              .catch(() => { /* fall back to simplified geometry */ });
          }

          let kps = lineKeypointsCacheRef.current.get(cacheKey);
          if (!kps && fetchKeypointsRef.current && rec.masterDisplayId) {
            try {
              kps = await fetchKeypointsRef.current(rec.masterDisplayId);
              lineKeypointsCacheRef.current.set(cacheKey, kps);
            } catch {
              kps = [];
            }
          }
          if (kps && kps.length > 0) {
            let best = kps[0];
            let bestD = haversineM(lat, lng, best.lat, best.lng);
            for (let i = 1; i < kps.length; i++) {
              const d = haversineM(lat, lng, kps[i].lat, kps[i].lng);
              if (d < bestD) { bestD = d; best = kps[i]; }
            }
            onSelect({
              ...rec,
              frameNumber: best.frame,
              box: best.box ?? rec.box,
              lat: best.lat,
              lng: best.lng,
            });
            return;
          }
          onSelect(rec);
        });

        line.on("mouseover", (e) => {
          const rec = assetLookupRef.current.get(displayId) ?? asset;
          tooltip.setLatLng(e.latlng);
          tooltip.setContent(
            `<div class="text-xs leading-tight">` +
            `<div class="font-semibold">${rec.assetType}</div>` +
            `<div class="text-[10px] text-muted-foreground">${rec.classification ?? "line"}` +
            (rec.side ? ` · ${rec.side}` : "") + `</div>` +
            `</div>`
          );
          if (!map.hasLayer(tooltip)) tooltip.addTo(map);
        });
        line.on("mouseout", () => {
          if (map.hasLayer(tooltip)) map.removeLayer(tooltip);
        });

        layer.addLayer(line);
        lineMap.set(displayId, line);
      } else {
        line.setLatLngs(positions);
        line.setStyle({ color, weight, opacity });
      }
    }

    if (!map.hasLayer(layer)) layer.addTo(map);

    // Maintain selected highlight for icon markers (icons are images, so we
    // overlay a circleMarker highlight like the old rebuild path did).
    if (iconHighlightRef.current) {
      layer.removeLayer(iconHighlightRef.current);
      iconHighlightRef.current = null;
    }
    if (selectedId) {
      const iconMarker = iconMarkerMap.get(selectedId);
      if (iconMarker) {
        const latlng = iconMarker.getLatLng();
        const highlight = L.circleMarker(latlng, {
          radius: SELECTED_RADIUS,
          color: SELECTED_COLOR,
          fillColor: SELECTED_COLOR,
          fillOpacity: 0.3,
          weight: 2,
        });
        layer.addLayer(highlight);
        iconHighlightRef.current = highlight;
      }
    }

    prevSelectedRef.current = selectedId;

    return () => {
      if (map.hasLayer(tooltip)) map.removeLayer(tooltip);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleMarkerAssets, lineAssets, map, onSelect, wantsIcons, labelMapData]);

  // Fast-path selection restyle without rebuild
  useEffect(() => {
    const markerMap = markerMapRef.current;
    const iconMarkerMap = iconMarkerMapRef.current;
    const lineMap = lineMapRef.current;
    const layer = layerRef.current;
    const prev = prevSelectedRef.current;

    if (prev === selectedId) return;

    if (iconHighlightRef.current) {
      layer.removeLayer(iconHighlightRef.current);
      iconHighlightRef.current = null;
    }

    // Restore previous
    if (prev) {
      const prevMarker = markerMap.get(prev);
      if (prevMarker) {
        const asset = assetLookupRef.current.get(prev);
        prevMarker.setRadius(DEFAULT_RADIUS);
        prevMarker.setStyle({
          fillColor: asset?.markerColor ?? "red",
          fillOpacity: 0.7,
          weight: 1.5,
        });
      }
      const prevLine = lineMap.get(prev);
      if (prevLine) {
        const asset = assetLookupRef.current.get(prev);
        const routeKey = String(asset?.routeId ?? prev);
        const baseColor = asset?.classification === "linear_sided"
          ? LINE_SIDED_COLOR
          : asset?.classification === "linear_unsided"
            ? LINE_UNSIDED_COLOR
            : routeColor(routeKey, false);
        prevLine.setStyle({ color: baseColor, weight: 5, opacity: 0.85 });
      }
    }

    // Highlight new
    if (selectedId) {
      const newCircle = markerMap.get(selectedId);
      if (newCircle) {
        newCircle.setRadius(SELECTED_RADIUS);
        newCircle.setStyle({
          fillColor: SELECTED_COLOR,
          fillOpacity: 0.9,
          weight: 1.8,
        });
        newCircle.bringToFront();
      }

      const iconMarker = iconMarkerMap.get(selectedId);
      if (iconMarker) {
        const latlng = iconMarker.getLatLng();
        const highlight = L.circleMarker(latlng, {
          radius: SELECTED_RADIUS,
          color: SELECTED_COLOR,
          fillColor: SELECTED_COLOR,
          fillOpacity: 0.3,
          weight: 2,
        });
        layer.addLayer(highlight);
        iconHighlightRef.current = highlight;
      }

      const selLine = lineMap.get(selectedId);
      if (selLine) {
        selLine.setStyle({ color: SELECTED_COLOR, weight: 7, opacity: 1 });
        selLine.bringToFront();
      }
    }

    prevSelectedRef.current = selectedId;
  }, [selectedId]);

  return null;
}

/* ── Main component ─────────────────────────────────────── */
export default function LibraryMapView({
  assets,
  selectedId,
  onSelect,
  onFetchLineKeypoints,
  onFetchLineGeometry,
}: LibraryMapViewProps) {
  const { data: labelMapData } = useLabelMap();
  const wantsIcons = localStorage.getItem('wants_icons') === 'true';

  const center = useMemo<[number, number]>(() => {
    if (assets.length === 0) return [25.3548, 51.1839];
    const a = assets[0];
    if (a.kind === "line" && a.geometry?.coordinates?.[0]) {
      const c = a.geometry.coordinates[0];
      return [c[1], c[0]];
    }
    return [a.lat, a.lng];
  }, [assets]);

  // Partition: line vs point. Line = kind==="line" with usable geometry.
  const { markerAssets, lineAssets } = useMemo(() => {
    const markers: AssetRecord[] = [];
    const lines: AssetRecord[] = [];
    for (const a of assets) {
      const hasGeom = (a.geometry?.coordinates?.length ?? 0) >= 2;
      if (a.kind === "line" && hasGeom) lines.push(a);
      else markers.push(a);
    }
    return { markerAssets: markers, lineAssets: lines };
  }, [assets]);

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const stableOnSelect = useCallback((asset: AssetRecord) => {
    onSelectRef.current(asset);
  }, []);

  return (
    <MapContainer
      center={center}
      zoom={14}
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

      <FitBounds assets={assets} />
      <FlyToSelected assets={assets} selectedId={selectedId} />
      <FastUnmount />

      <CanvasMarkerLayer
        markerAssets={markerAssets}
        lineAssets={lineAssets}
        selectedId={selectedId}
        onSelect={stableOnSelect}
        wantsIcons={wantsIcons}
        labelMapData={labelMapData}
        onFetchLineKeypoints={onFetchLineKeypoints}
        onFetchLineGeometry={onFetchLineGeometry}
      />
    </MapContainer>
  );
}
