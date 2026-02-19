import { useMemo, memo, useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card } from "@/components/ui/card";

// Fix default marker icons for Leaflet + Vite
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

// ---------- types ----------

interface MapMarker {
  lat: number;
  lng: number;
  label?: string;
  info?: string;
  color?: string;
  radius?: number;
}

interface MapData {
  type: "marker" | "circle";
  title?: string;
  center?: [number, number];
  zoom?: number;
  markers: MapMarker[];
}

// ---------- color helpers ----------

const COLOR_MAP: Record<string, string> = {
  red: "#ef4444",
  green: "#22c55e",
  blue: "#3b82f6",
  orange: "#f59e0b",
  purple: "#8b5cf6",
  cyan: "#06b6d4",
  pink: "#ec4899",
};

function resolveColor(color?: string): string {
  if (!color) return "#3b82f6";
  return COLOR_MAP[color.toLowerCase()] || color;
}

function makeColoredIcon(color: string) {
  const hex = resolveColor(color);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40">
    <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.268 21.732 0 14 0z" fill="${hex}" stroke="#fff" stroke-width="1.5"/>
    <circle cx="14" cy="14" r="5" fill="#fff"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [28, 40],
    iconAnchor: [14, 40],
    popupAnchor: [0, -36],
  });
}

// ---------- auto-fit bounds ----------

function FitBounds({ markers }: { markers: MapMarker[] }) {
  const map = useMap();
  useEffect(() => {
    if (markers.length === 0) return;
    const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng] as L.LatLngTuple));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }, [markers, map]);
  return null;
}

// ---------- component ----------

export const MapBlock = memo(function MapBlock({ jsonString }: { jsonString: string }) {
  const mapData = useMemo<MapData | null>(() => {
    try {
      const parsed = JSON.parse(jsonString);
      if (!Array.isArray(parsed.markers) || parsed.markers.length === 0) return null;
      return parsed as MapData;
    } catch {
      return null;
    }
  }, [jsonString]);

  if (!mapData) {
    return (
      <Card className="p-4 text-sm text-muted-foreground italic">
        Could not parse map data.
      </Card>
    );
  }

  const { type = "marker", title, center, zoom, markers } = mapData;
  const defaultCenter: [number, number] = center || [markers[0].lat, markers[0].lng];
  const defaultZoom = zoom || 13;

  return (
    <Card className="my-3 overflow-hidden border border-border/60 bg-card/50">
      {title && (
        <div className="px-4 py-2 border-b border-border/40">
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
      )}
      <div style={{ height: 350, width: "100%" }}>
        <MapContainer
          center={defaultCenter}
          zoom={defaultZoom}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom
          attributionControl={false}
        >
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            maxZoom={19}
          />
          <FitBounds markers={markers} />

          {markers.map((m, i) =>
            type === "circle" ? (
              <CircleMarker
                key={i}
                center={[m.lat, m.lng]}
                radius={m.radius || 10}
                pathOptions={{
                  fillColor: resolveColor(m.color),
                  color: "#fff",
                  weight: 2,
                  fillOpacity: 0.8,
                }}
              >
                {(m.label || m.info) && (
                  <Popup>
                    {m.label && <div className="font-semibold text-sm">{m.label}</div>}
                    {m.info && <div className="text-xs text-muted-foreground mt-1">{m.info}</div>}
                  </Popup>
                )}
              </CircleMarker>
            ) : (
              <Marker key={i} position={[m.lat, m.lng]} icon={makeColoredIcon(m.color || "blue")}>
                {(m.label || m.info) && (
                  <Popup>
                    {m.label && <div className="font-semibold text-sm">{m.label}</div>}
                    {m.info && <div className="text-xs text-muted-foreground mt-1">{m.info}</div>}
                  </Popup>
                )}
              </Marker>
            )
          )}
        </MapContainer>
      </div>
    </Card>
  );
});
