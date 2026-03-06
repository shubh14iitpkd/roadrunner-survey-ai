import { useEffect, useRef, useMemo, useCallback } from "react";
import { isAssetIconExist, getAssetIconFromId } from "@/components/settings/iconConfig";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  useMap,
  Marker,
  Polyline,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { AssetRecord } from "@/types/asset";

/* ── Constants ──────────────────────────────────────────── */
const POLYLINE_GROUP_ID = "Road Marking Line";
const SELECTED_COLOR = "#3b82f6"; // blue-500
const DEFAULT_RADIUS = 6;
const SELECTED_RADIUS = 10;

/* ── Helper: deterministic per-route colour (medium vibrancy) ── */
function routeColor(key: string, selected: boolean): string {
  // Simple DJB2 hash → hue
  let hash = 4321;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 33) ^ key.charCodeAt(i);
  }
  const hue = Math.abs(hash) % 360;
  // Saturation 55-65 %, Lightness 48-55 % keeps colours vivid but not garish
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
// Reorders assets so consecutive entries are geographically adjacent,
// regardless of the order they arrive from the API.
function nearestNeighborSort(assets: AssetRecord[]): AssetRecord[] {
  if (assets.length <= 1) return [...assets];

  const unvisited = new Set(assets.map((_, i) => i));

  // Start from the southernmost point (min lat) — likely one road end
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
// Gap > POLYLINE_MAX_GAP_M metres between consecutive sorted points
// starts a new segment so far-apart detections aren't linked.
const POLYLINE_MAX_GAP_M = 200;

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

/* ── Helper: build a selected variant of an icon (larger) ── */
function getSelectedIcon(baseIcon: L.Icon): L.Icon {
  const opts = (baseIcon as any).options;
  const [w, h] = opts.iconSize as [number, number];
  const [ax, ay] = opts.iconAnchor as [number, number];
  const scale = 1.45;
  return L.icon({
    ...opts,
    iconSize: [Math.round(w * scale), Math.round(h * scale)] as [number, number],
    iconAnchor: [Math.round(ax * scale), Math.round(ay * scale)] as [number, number],
    className: `${opts.className ?? ''} leaflet-marker-selected`.trim(),
  });
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
    if (assets.length === 0) return;
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

  useEffect(() => {
    if (!selectedId) return;
    const asset = assets.find((a) => a.assetDisplayId === selectedId);
    if (!asset) return;
    map.flyTo([asset.lat, asset.lng], Math.max(map.getZoom(), 16), {
      duration: 0.6,
    });
  }, [selectedId, assets, map]);

  return null;
}

/* ── Sub-component: one polyline per route group ────────── */
interface PolylineGroupProps {
  routeKey: string;
  routeId: number | undefined;
  groupAssets: AssetRecord[];
  selectedId: string | null;
  onSelect: (asset: AssetRecord) => void;
}

function PolylineGroup({ routeKey, routeId: _routeId, groupAssets, selectedId, onSelect }: PolylineGroupProps) {
  // Split into segments so far-apart points aren't joined
  const segments = useMemo<[number, number][][]>(
    () => splitIntoSegments(groupAssets).map((seg) => seg.map((a) => [a.lat, a.lng] as [number, number])),
    [groupAssets]
  );
  // console.log("segments", segments);
  const hasSelected = groupAssets.some((a) => a.assetDisplayId === selectedId);
  const selectedAsset = groupAssets.find((a) => a.assetDisplayId === selectedId);

  const handleClick = useCallback(
    (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      let nearest = groupAssets[0];
      let minDist = Infinity;
      for (const a of groupAssets) {
        const d = haversineM(lat, lng, a.lat, a.lng);
        if (d < minDist) {
          minDist = d;
          nearest = a;
        }
      }
      onSelect(nearest);
    },
    [groupAssets, onSelect]
  );

  return (
    <>
      {/* Shadow — slightly wider invisible line for easier clicking */}
      {/* <Polyline
        positions={positions}
        pathOptions={{
          color: "transparent",
          weight: 14,
          opacity: 0,
        }}
        eventHandlers={{ click: handleClick }}
      /> */}

      {/* One Polyline per contiguous segment; isolated points → CircleMarker */}
      {segments.map((segPositions, idx) =>
        segPositions.length === 1 ? (
          // Single isolated detection: render as a small dot so it's visible
          <CircleMarker
            key={idx}
            center={segPositions[0]}
            radius={5}
            pathOptions={{
              color: routeColor(routeKey, hasSelected),
              fillColor: routeColor(routeKey, hasSelected),
              fillOpacity: 0.85,
              weight: 1,
            }}
            eventHandlers={{ click: handleClick }}
          >
            <Tooltip sticky direction="top" opacity={0.95}>
              <div className="text-xs leading-tight">
                <div className="font-semibold">Road Marking Line</div>
              </div>
            </Tooltip>
          </CircleMarker>
        ) : (
          <Polyline
            key={idx}
            positions={segPositions}
            pathOptions={{
              color: routeColor(routeKey, hasSelected),
              weight: hasSelected ? 8 : 6,
              opacity: hasSelected ? 1 : 0.8,
              dashArray: undefined,
              lineCap: "round",
              lineJoin: "round",
            }}
            eventHandlers={{ click: handleClick }}
          >
            <Tooltip sticky direction="top" opacity={0.95}>
              <div className="text-xs leading-tight">
                <div className="font-semibold">Road Marking Line</div>
              </div>
            </Tooltip>
          </Polyline>
        )
      )}

      {/* Highlight the selected asset with a dot on the polyline */}
      {selectedAsset && (
        <CircleMarker
          center={[selectedAsset.lat, selectedAsset.lng]}
          radius={SELECTED_RADIUS}
          pathOptions={{
            color: "#fff",
            fillColor: SELECTED_COLOR,
            fillOpacity: 0.95,
            weight: 2,
          }}
        >
          <Tooltip direction="top" offset={[0, -8]} opacity={0.95} permanent={false}>
            <div className="text-xs leading-tight">
              <div className="font-semibold">{selectedAsset.assetType}</div>
              <div className="text-[10px] text-muted-foreground font-mono">
                {selectedAsset.lat.toFixed(5)}, {selectedAsset.lng.toFixed(5)}
              </div>
            </div>
          </Tooltip>
        </CircleMarker>
      )}
    </>
  );
}

/* ── Main component ─────────────────────────────────────── */
export default function LibraryMapView({
  assets,
  selectedId,
  onSelect,
}: LibraryMapViewProps) {
  const center = useMemo<[number, number]>(() => {
    if (assets.length === 0) return [25.2, 55.27]; // Dubai fallback
    return [assets[0].lat, assets[0].lng];
  }, [assets]);

  const wantsIcons = localStorage.getItem('wants_icons') === 'true';

  /* ── Partition ─────────────────────────────────────────── */
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

  return (
    <MapContainer
      center={center}
      zoom={12}
      className="h-full w-full"
      style={{ minHeight: 200 }}
      zoomControl={true}
      scrollWheelZoom={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      />

      <FitBounds assets={assets} />
      <FlyToSelected assets={assets} selectedId={selectedId} />

      {/* ── Polyline groups (Road Marking Line) ──────────── */}
      {polylineGroups.map((group) => (
        <PolylineGroup
          key={group.key}
          routeKey={group.key}
          routeId={group.routeId}
          groupAssets={group.assets}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}

      {/* ── Regular marker assets ────────────────────────── */}
      {markerAssets.map((asset) => {
        const isSelected = asset.assetDisplayId === selectedId;
        const useIcon = wantsIcons && isAssetIconExist(asset.assetId);

        if (useIcon) {
          const baseIcon = getAssetIconFromId(asset.assetId);
          const icon = isSelected ? getSelectedIcon(baseIcon) : baseIcon;
          return (
            <Marker
              key={asset.assetDisplayId}
              position={[asset.lat, asset.lng]}
              icon={icon}
              zIndexOffset={isSelected ? 1000 : 0}
              eventHandlers={{
                click: () => onSelect(asset),
              }}
            >
              <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                <div className="text-xs leading-tight">
                  <div className="font-semibold">{asset.assetType}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">
                    {asset.lat.toFixed(5)}, {asset.lng.toFixed(5)}
                  </div>
                </div>
              </Tooltip>
            </Marker>
          );
        }

        return (
          <CircleMarker
            key={asset.assetDisplayId}
            center={[asset.lat, asset.lng]}
            radius={isSelected ? SELECTED_RADIUS : DEFAULT_RADIUS}
            pathOptions={{
              color: "#fff",
              stroke: true,
              fillColor: isSelected ? SELECTED_COLOR : (asset.markerColor ?? "red"),
              fillOpacity: isSelected ? 0.9 : 0.7,
              weight: isSelected ? 1.8 : 1.5,
            }}
            eventHandlers={{
              click: () => onSelect(asset),
            }}
          >
            <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
              <div className="text-xs leading-tight">
                <div className="font-semibold">{asset.assetType}</div>
                <div className="text-[10px] text-muted-foreground font-mono">
                  {asset.lat.toFixed(5)}, {asset.lng.toFixed(5)}
                </div>
              </div>
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
