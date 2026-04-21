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

/* ── Props ──────────────────────────────────────────────── */
interface LibraryMapViewProps {
  assets: AssetRecord[];
  selectedId: string | null;
  onSelect: (asset: AssetRecord) => void;
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
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
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
}: {
  markerAssets: AssetRecord[];
  lineAssets: AssetRecord[];
  selectedId: string | null;
  onSelect: (asset: AssetRecord) => void;
  wantsIcons: boolean;
  labelMapData: ResolvedMap | null;
}) {
  const map = useMap();
  const layerRef = useRef<L.LayerGroup>(L.layerGroup());
  const tooltipRef = useRef<L.Tooltip>(L.tooltip({ direction: "top", offset: [0, -8], opacity: 0.95 }));
  const markerMapRef = useRef<Map<string, L.CircleMarker>>(new Map());
  const iconMarkerMapRef = useRef<Map<string, L.Marker>>(new Map());
  const lineMapRef = useRef<Map<string, L.Polyline>>(new Map());
  const iconHighlightRef = useRef<L.CircleMarker | null>(null);
  const prevSelectedRef = useRef<string | null>(null);
  const assetLookupRef = useRef<Map<string, AssetRecord>>(new Map());

  useEffect(() => {
    const layer = layerRef.current;
    const tooltip = tooltipRef.current;
    const markerMap = markerMapRef.current;
    const iconMarkerMap = iconMarkerMapRef.current;
    const lineMap = lineMapRef.current;
    const assetLookup = assetLookupRef.current;

    layer.clearLayers();
    markerMap.clear();
    iconMarkerMap.clear();
    lineMap.clear();
    assetLookup.clear();
    iconHighlightRef.current = null;

    // Point markers
    for (const a of markerAssets) {
      if (a.assetDisplayId) assetLookup.set(a.assetDisplayId, a);
    }

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

    // Line assets — render straight from geometry.coordinates (GeoJSON
    // [lng,lat] → Leaflet [lat,lng]). No distance-based grouping.
    for (const asset of lineAssets) {
      if (asset.assetDisplayId) assetLookup.set(asset.assetDisplayId, asset);
      const coords = asset.geometry?.coordinates ?? [];
      if (coords.length < 2) continue;
      const positions: [number, number][] = coords.map((c) => [c[1], c[0]]);

      const isSelected = asset.assetDisplayId === selectedId;
      const routeKey = String(asset.routeId ?? asset.assetDisplayId ?? "x");
      const baseColor = asset.classification === "linear_sided"
        ? LINE_SIDED_COLOR
        : asset.classification === "linear_unsided"
          ? LINE_UNSIDED_COLOR
          : routeColor(routeKey, isSelected);
      const color = isSelected ? SELECTED_COLOR : baseColor;

      const line = L.polyline(positions, {
        color,
        weight: isSelected ? 7 : 5,
        opacity: isSelected ? 1 : 0.85,
        lineCap: "round",
        lineJoin: "round",
      });

      line.on("click", (e: any) => {
        const rec = assetLookup.get(asset.assetDisplayId ?? "");
        if (!rec) return;
        // Snap click → nearest keypoint so the sidebar fetches the matching
        // frame + bbox rather than the anchor frame.
        const { lat, lng } = e.latlng ?? {};
        const kps = rec.keypoints ?? [];
        if (lat != null && lng != null && kps.length > 0) {
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
        tooltip.setLatLng(e.latlng);
        tooltip.setContent(
          `<div class="text-xs leading-tight">` +
          `<div class="font-semibold">${asset.assetType}</div>` +
          `<div class="text-[10px] text-muted-foreground">${asset.classification ?? "line"}` +
          (asset.side ? ` · ${asset.side}` : "") + `</div>` +
          `</div>`
        );
        if (!map.hasLayer(tooltip)) tooltip.addTo(map);
      });
      line.on("mouseout", () => {
        if (map.hasLayer(tooltip)) map.removeLayer(tooltip);
      });

      layer.addLayer(line);
      if (asset.assetDisplayId) lineMap.set(asset.assetDisplayId, line);
    }

    if (!map.hasLayer(layer)) layer.addTo(map);

    prevSelectedRef.current = selectedId;

    return () => {
      if (map.hasLayer(tooltip)) map.removeLayer(tooltip);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markerAssets, lineAssets, map, onSelect, wantsIcons, labelMapData]);

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

      <CanvasMarkerLayer
        markerAssets={markerAssets}
        lineAssets={lineAssets}
        selectedId={selectedId}
        onSelect={stableOnSelect}
        wantsIcons={wantsIcons}
        labelMapData={labelMapData}
      />
    </MapContainer>
  );
}
