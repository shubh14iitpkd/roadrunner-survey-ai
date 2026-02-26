import { useEffect, useRef, useMemo, useCallback } from "react";
import { isAssetIconExist, getAssetIconFromId } from "@/components/settings/iconConfig";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  useMap,
  Marker,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { AssetRecord } from "@/types/asset";

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

const SELECTED_COLOR = "#3b82f6"; // blue-500
const DEFAULT_RADIUS = 6;
const SELECTED_RADIUS = 10;

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

/* ── Sub-component: flies to selected marker ────────────── */
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
    const asset = assets.find((a) => a.defectId === selectedId);
    if (!asset) return;
    map.flyTo([asset.lat, asset.lng], Math.max(map.getZoom(), 15), {
      duration: 0.6,
    });
  }, [selectedId, assets, map]);

  return null;
}

/* ── Main component ─────────────────────────────────────── */
export default function LibraryMapView({
  assets,
  selectedId,
  onSelect,
}: LibraryMapViewProps) {
  /* Default centre (will be overridden by FitBounds) */
  const center = useMemo<[number, number]>(() => {
    if (assets.length === 0) return [25.2, 55.27]; // Dubai fallback
    return [assets[0].lat, assets[0].lng];
  }, [assets]);
  const wantsIcons = localStorage.getItem('wants_icons') !== 'false';
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

      {assets.map((asset) => {
        const isSelected = asset.id === selectedId;
        const useIcon = wantsIcons && isAssetIconExist(asset.assetId);

        if (useIcon) {
          const baseIcon = getAssetIconFromId(asset.assetId);
          const icon = isSelected ? getSelectedIcon(baseIcon) : baseIcon;
          return (
            <Marker
              key={asset.id}
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
            key={asset.defectId}
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
