import { useMemo, memo, useEffect, useState, useRef, useCallback } from "react";
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
  popup?: string;
  frame_url?: string;
  video_id?: string;
  frame_number?: number;
  box?: { x: number; y: number; w: number; h: number };
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


// ---------- lazy frame loader ----------

function FrameImage({ videoId, frameNumber, defectBox }: { videoId: string; frameNumber: number; defectBox?: { x: number; y: number; w: number; h: number } }) {
  const [src, setSrc] = useState<string | null>(null);
  const [frameDims, setFrameDims] = useState({ w: 1, h: 1 });
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const DISPLAY_W = 360;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { apiFetch } = await import("@/lib/api");
        const data = await apiFetch(
          `/api/videos/${videoId}/frame_annotated?frame_number=${frameNumber}`
        );
        if (!cancelled && data?.image_data) {
          setSrc(data.image_data);
          setFrameDims({ w: data.width || 1920, h: data.height || 1080 });
        }
      } catch (e) {
        console.error("Frame load error:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [videoId, frameNumber]);

  const drawAnnotation = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !src) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      const scale = DISPLAY_W / frameDims.w;
      const displayH = frameDims.h * scale;
      canvas.width = DISPLAY_W;
      canvas.height = displayH;
      ctx.drawImage(img, 0, 0, DISPLAY_W, displayH);

      // Draw only the defect bounding box
      if (defectBox) {
        const sx = defectBox.x * scale;
        const sy = defectBox.y * scale;
        const sw = defectBox.w * scale;
        const sh = defectBox.h * scale;

        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 2.5;
        ctx.strokeRect(sx, sy, sw, sh);
      }
    };
    img.src = src;
  }, [src, defectBox, frameDims]);

  useEffect(() => {
    if (src) drawAnnotation();
  }, [src, drawAnnotation]);

  if (loading) {
    return <div style={{ padding: "12px 0", textAlign: "center", fontSize: "12px", color: "#999" }}>Loading frame...</div>;
  }
  if (!src) return null;
  return <canvas ref={canvasRef} style={{ width: "100%", borderRadius: "6px", marginTop: "4px" }} />;
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
                <Popup minWidth={m.video_id ? 320 : 120} maxWidth={400}>
                  <div>
                    {m.label && <div style={{ fontWeight: 600, fontSize: "13px", marginBottom: "4px" }}>{m.label}</div>}
                    {m.popup && <div style={{ fontSize: "12px", color: "#666", marginBottom: m.frame_url ? "8px" : "0" }}>{m.popup}</div>}
                    {m.info && <div style={{ fontSize: "12px", color: "#666" }}>{m.info}</div>}
                    {m.video_id && m.frame_number != null && (
                      <FrameImage videoId={m.video_id} frameNumber={m.frame_number} defectBox={m.box} />
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            ) : (
              <Marker key={i} position={[m.lat, m.lng]} icon={makeColoredIcon(m.color || "blue")}>
                <Popup minWidth={m.video_id ? 320 : 120} maxWidth={400}>
                  <div>
                    {m.label && <div style={{ fontWeight: 600, fontSize: "13px", marginBottom: "4px" }}>{m.label}</div>}
                    {m.popup && <div style={{ fontSize: "12px", color: "#666", marginBottom: m.frame_url ? "8px" : "0" }}>{m.popup}</div>}
                    {m.info && <div style={{ fontSize: "12px", color: "#666" }}>{m.info}</div>}
                    {m.video_id && m.frame_number != null && (
                      <FrameImage videoId={m.video_id} frameNumber={m.frame_number} defectBox={m.box} />
                    )}
                  </div>
                </Popup>
              </Marker>
            )
          )}
        </MapContainer>
      </div>
    </Card>
  );
});
