import { useEffect, useRef, useMemo, useCallback } from "react";
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
const POLYLINE_GROUP_ID = "Road Marking Line";
const SELECTED_COLOR = "#3b82f6"; // blue-500
const DEFAULT_RADIUS = 6;
const SELECTED_RADIUS = 10;

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

/* ── Helper: Haversine distance (metres) ────────────────── */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Helper: greedy nearest-neighbour spatial sort ─────── */
function nearestNeighborSort(assets: AssetRecord[]): AssetRecord[] {
  if (assets.length <= 1) return [...assets];

  const unvisited = new Set(assets.map((_, i) => i));

  let startIdx = 0;
  let minLat = assets[0].lat;
  for (const i of unvisited) {
    if (assets[i].lat < minLat) { minLat = assets[i].lat; startIdx = i; }
  }

  const sorted: AssetRecord[] = [assets[startIdx]];
  unvisited.delete(startIdx);
  let current = startIdx;

  while (unvisited.size > 0) {
    let nearest = -1;
    let minDist = Infinity;
    for (const i of unvisited) {
      const d = haversineM(assets[current].lat, assets[current].lng, assets[i].lat, assets[i].lng);
      if (d < minDist) { minDist = d; nearest = i; }
    }
    sorted.push(assets[nearest]);
    unvisited.delete(nearest);
    current = nearest;
  }
  return sorted;
}

/* ── Helper: split spatially-sorted assets into segments ── */
const POLYLINE_MAX_GAP_M = 100;

function splitIntoSegments(
  assets: AssetRecord[],
  maxGapM = POLYLINE_MAX_GAP_M
): AssetRecord[][] {
  if (assets.length === 0) return [];
  const sorted = nearestNeighborSort(assets);
  const segments: AssetRecord[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const dist = haversineM(prev.lat, prev.lng, curr.lat, curr.lng);
    if (dist <= maxGapM) {
      segments[segments.length - 1].push(curr);
    } else {
      segments.push([curr]);
    }
  }
  return segments;
}

/* ── Props ──────────────────────────────────────────────── */
interface LibraryMapViewProps {
  assets: AssetRecord[];
  selectedId: string | null;
  onSelect: (asset: AssetRecord) => void;
}

/* ── Sub-component: fits bounds whenever assets change ─── */
function FitBounds({ assets }: { assets: AssetRecord[] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current || assets.length === 0) return;
    const bounds = L.latLngBounds(
      assets.map((a) => [a.lat, a.lng] as [number, number])
    );
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      fitted.current = true;
    }
  }, [assets, map]);

  return null;
}

/* ── Sub-component: flies to selected asset ─────────────── */
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
    map.setView([asset.lat, asset.lng], Math.max(map.getZoom(), 16), {
      animate: false,
    });
  }, [selectedId, assets, map]);

  return null;
}

/* ── Canvas marker layer: renders 70k+ markers without React reconciliation ── */
function CanvasMarkerLayer({
  markerAssets,
  polylineGroups,
  selectedId,
  onSelect,
  wantsIcons,
  labelMapData,
}: {
  markerAssets: AssetRecord[];
  polylineGroups: { key: string; routeId: number | undefined; assets: AssetRecord[] }[];
  selectedId: string | null;
  onSelect: (asset: AssetRecord) => void;
  wantsIcons: boolean;
  labelMapData: ResolvedMap | null;
}) {
  const map = useMap();
  const layerRef = useRef<L.LayerGroup>(L.layerGroup());
  const tooltipRef = useRef<L.Tooltip>(L.tooltip({ direction: "top", offset: [0, -8], opacity: 0.95 }));
  // Map from assetDisplayId → L.CircleMarker for fast selection updates (circle markers only)
  const markerMapRef = useRef<Map<string, L.CircleMarker>>(new Map());
  // Map from assetDisplayId → L.Marker for icon markers
  const iconMarkerMapRef = useRef<Map<string, L.Marker>>(new Map());
  // Selection highlight circle for icon markers
  const iconHighlightRef = useRef<L.CircleMarker | null>(null);
  // Track previous selection to restore style
  const prevSelectedRef = useRef<string | null>(null);
  // Build a lookup from displayId → AssetRecord for click handling
  const assetLookupRef = useRef<Map<string, AssetRecord>>(new Map());

  // Rebuild all markers when assets change
  useEffect(() => {
    const layer = layerRef.current;
    const tooltip = tooltipRef.current;
    const markerMap = markerMapRef.current;
    const iconMarkerMap = iconMarkerMapRef.current;
    const assetLookup = assetLookupRef.current;

    // Clear existing
    layer.clearLayers();
    markerMap.clear();
    iconMarkerMap.clear();
    assetLookup.clear();
    if (iconHighlightRef.current) {
      iconHighlightRef.current = null;
    }

    // Build asset lookup
    for (const a of markerAssets) {
      if (a.assetDisplayId) assetLookup.set(a.assetDisplayId, a);
    }

    // Add markers (icon or circle depending on config)
    for (const asset of markerAssets) {
      const isSelected = asset.assetDisplayId === selectedId;
      const assetKey = asset.asset_id || asset.assetId;
      const useIcon = wantsIcons && assetKey && isAssetIconExist(assetKey, labelMapData);

      if (useIcon) {
        const icon = getAssetIconFromId(assetKey!, labelMapData);
        const marker = L.marker([asset.lat, asset.lng], { icon });

        marker.on("click", () => {
          const a = assetLookup.get(asset.assetDisplayId ?? "");
          if (a) onSelect(a);
        });

        marker.on("mouseover", (e) => {
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

        layer.addLayer(marker);
        if (asset.assetDisplayId) iconMarkerMap.set(asset.assetDisplayId, marker);

        // Add selection highlight ring under icon marker
        if (isSelected) {
          const highlight = L.circleMarker([asset.lat, asset.lng], {
            radius: SELECTED_RADIUS,
            color: SELECTED_COLOR,
            fillColor: SELECTED_COLOR,
            fillOpacity: 0.3,
            weight: 2,
          });
          layer.addLayer(highlight);
          iconHighlightRef.current = highlight;
        }
      } else {
        const marker = L.circleMarker([asset.lat, asset.lng], {
          radius: isSelected ? SELECTED_RADIUS : DEFAULT_RADIUS,
          color: "#fff",
          weight: isSelected ? 1.8 : 1.5,
          fillColor: isSelected ? SELECTED_COLOR : (asset.markerColor ?? "red"),
          fillOpacity: isSelected ? 0.9 : 0.7,
        });

        (marker as any)._assetDisplayId = asset.assetDisplayId;

        marker.on("click", () => {
          const a = assetLookup.get(asset.assetDisplayId ?? "");
          if (a) onSelect(a);
        });

        marker.on("mouseover", (e) => {
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

        layer.addLayer(marker);
        if (asset.assetDisplayId) markerMap.set(asset.assetDisplayId, marker);
      }
    }

    // Add polyline groups
    for (const group of polylineGroups) {
      const hasSelected = group.assets.some((a) => a.assetDisplayId === selectedId);
      const color = routeColor(group.key, hasSelected);

      // Also add polyline assets to lookup
      for (const a of group.assets) {
        if (a.assetDisplayId) assetLookup.set(a.assetDisplayId, a);
      }

      const segments = splitIntoSegments(group.assets);

      for (const seg of segments) {
        if (seg.length === 1) {
          // Single point — draw as small circle
          const a = seg[0];
          const dot = L.circleMarker([a.lat, a.lng], {
            radius: 5,
            color,
            fillColor: color,
            fillOpacity: 0.85,
            weight: 1,
          });
          dot.on("click", () => {
            const rec = assetLookup.get(a.assetDisplayId ?? "");
            if (rec) onSelect(rec);
          });
          dot.on("mouseover", (e) => {
            tooltip.setLatLng(e.latlng);
            tooltip.setContent(`<div class="text-xs leading-tight"><div class="font-semibold">Road Marking Line</div></div>`);
            if (!map.hasLayer(tooltip)) tooltip.addTo(map);
          });
          dot.on("mouseout", () => { if (map.hasLayer(tooltip)) map.removeLayer(tooltip); });
          layer.addLayer(dot);
        } else {
          // Polyline segment
          const positions: [number, number][] = seg.map((a) => [a.lat, a.lng]);
          const line = L.polyline(positions, {
            color,
            weight: hasSelected ? 8 : 6,
            opacity: hasSelected ? 1 : 0.8,
            lineCap: "round",
            lineJoin: "round",
          });
          line.on("click", (e) => {
            // Find nearest asset to click point
            const { lat, lng } = e.latlng;
            let nearest = seg[0];
            let minDist = Infinity;
            for (const a of seg) {
              const d = haversineM(lat, lng, a.lat, a.lng);
              if (d < minDist) { minDist = d; nearest = a; }
            }
            onSelect(nearest);
          });
          line.on("mouseover", (e) => {
            tooltip.setLatLng(e.latlng);
            tooltip.setContent(`<div class="text-xs leading-tight"><div class="font-semibold">Road Marking Line</div></div>`);
            if (!map.hasLayer(tooltip)) tooltip.addTo(map);
          });
          line.on("mouseout", () => { if (map.hasLayer(tooltip)) map.removeLayer(tooltip); });
          layer.addLayer(line);
        }
      }

      // Highlight selected asset in polyline group
      const selectedAsset = group.assets.find((a) => a.assetDisplayId === selectedId);
      if (selectedAsset) {
        const highlight = L.circleMarker([selectedAsset.lat, selectedAsset.lng], {
          radius: SELECTED_RADIUS,
          color: "#fff",
          fillColor: SELECTED_COLOR,
          fillOpacity: 0.95,
          weight: 2,
        });
        layer.addLayer(highlight);
      }
    }

    // Add the layer group to the map
    if (!map.hasLayer(layer)) layer.addTo(map);

    prevSelectedRef.current = selectedId;

    return () => {
      if (map.hasLayer(tooltip)) map.removeLayer(tooltip);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markerAssets, polylineGroups, map, onSelect, wantsIcons, labelMapData]);

  // Fast-path: update only selection styling without rebuilding all markers
  useEffect(() => {
    const markerMap = markerMapRef.current;
    const iconMarkerMap = iconMarkerMapRef.current;
    const layer = layerRef.current;
    const prev = prevSelectedRef.current;

    if (prev === selectedId) return;

    // Remove previous icon highlight
    if (iconHighlightRef.current) {
      layer.removeLayer(iconHighlightRef.current);
      iconHighlightRef.current = null;
    }

    // Restore previous circle marker
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
    }

    // Highlight new marker
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

      // Highlight icon marker with ring underneath
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
  }, [selectedId]);

  return null;
}

/* ── Main component ─────────────────────────────────────── */
export default function LibraryMapView({
  assets,
  selectedId,
  onSelect,
}: LibraryMapViewProps) {
  const { data: labelMapData } = useLabelMap();
  const wantsIcons = localStorage.getItem('wants_icons') === 'true';

  const center = useMemo<[number, number]>(() => {
    if (assets.length === 0) return [25.3548, 51.1839];
    return [assets[0].lat, assets[0].lng];
  }, [assets]);

  /* ── Partition into markers vs polyline groups ──────────── */
  const { markerAssets, polylineGroups } = useMemo(() => {
    const markers: AssetRecord[] = [];
    const groupMap = new Map<string, AssetRecord[]>();

    for (const asset of assets) {
      if (asset.groupId === POLYLINE_GROUP_ID) {
        const key = String(asset.routeId ?? "unknown");
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key)!.push(asset);
      } else {
        markers.push(asset);
      }
    }

    return {
      markerAssets: markers,
      polylineGroups: [...groupMap.entries()].map(([key, list]) => ({
        key,
        routeId: list[0].routeId,
        assets: list,
      })),
    };
  }, [assets]);

  // Stable onSelect ref to avoid rebuilding markers when parent re-renders
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

      <CanvasMarkerLayer
        markerAssets={markerAssets}
        polylineGroups={polylineGroups}
        selectedId={selectedId}
        onSelect={stableOnSelect}
        wantsIcons={wantsIcons}
        labelMapData={labelMapData}
      />
    </MapContainer>
  );
}
