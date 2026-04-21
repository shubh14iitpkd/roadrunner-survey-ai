import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/*
 * AssetPreviewMap.tsx — drop-in preview for the JSON produced by
 * extract_kml.py --json-output.
 *
 * Usage:
 *   1. Copy assets.json into your React app's public/ folder.
 *   2. Import this component and render it on a route / page:
 *        <AssetPreviewMap src="/assets.json" apiBase="http://localhost:5050" />
 *   3. Ensure `react-leaflet` and `leaflet` are installed.
 *   4. Auth token is read from localStorage["auth_tokens"].access_token
 *      (same key the main app uses).
 */

type Category = "point" | "linear_sided" | "linear_unsided";

interface Box { x: number; y: number; w: number; h: number; }

interface Keypoint {
  lat: number;
  lng: number;
  frame: number;
  box: Box;
  side?: "LHS" | "RHS" | null;
}

interface PointAsset {
  label: string;
  category: Category;
  lat: number;
  lng: number;
  video: string;         // stem (matches Video.title on backend)
  frame: number;
  side: string | null;
  json: string;
  box: Box | null;
  iw: number;            // original frame width
  ih: number;            // original frame height
  keypoints?: Keypoint[];
}

interface LineAsset {
  label: string;
  category: Category;
  coords: [number, number][];
  video: string;
  frames: string;
  first_frame: number | null;
  side: string | null;
  json: string;
  box: Box | null;
  iw: number;
  ih: number;
  keypoints?: Keypoint[];
}

interface Route {
  name: string;
  color: string;
  points: PointAsset[];
  lines: LineAsset[];
}

interface AssetPayload {
  stats: { routes: number; points: number; lines: number };
  routes: Route[];
}

interface Props {
  src?: string;
  data?: AssetPayload;
  height?: number | string;
  apiBase?: string;      // backend (default http://localhost:5050)
}

const DEFAULT_CENTER: [number, number] = [25.3548, 51.1839];
const DEFAULT_ZOOM = 11;

/* ── Auth + API ─────────────────────────────────────────── */
function getAccessToken(): string | null {
  try {
    const raw = localStorage.getItem("auth_tokens");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed.access_token || null;
  } catch {
    return null;
  }
}

async function apiGet(apiBase: string, path: string): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const tok = getAccessToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const res = await fetch(`${apiBase}${path}`, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/* ── Geometry: nearest keypoint to a click latlng ────────── */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestKeypoint(
  kps: Keypoint[] | undefined,
  lat: number,
  lng: number,
): Keypoint | null {
  if (!kps || kps.length === 0) return null;
  let best = kps[0];
  let bestD = haversineMeters(lat, lng, best.lat, best.lng);
  for (let i = 1; i < kps.length; i++) {
    const d = haversineMeters(lat, lng, kps[i].lat, kps[i].lng);
    if (d < bestD) {
      bestD = d;
      best = kps[i];
    }
  }
  return best;
}

/* ── Frame fetcher (by video_key via /api/videos/test/frame_by_key) ─── */
async function fetchFrameByKey(
  apiBase: string,
  videoKey: string,
  frameNumber: number,
): Promise<{ imageData: string; width: number; height: number } | null> {
  const qs = `video_key=${encodeURIComponent(videoKey)}&frame_number=${frameNumber}&resize=true`;
  const data = await apiGet(apiBase, `/api/videos/test/frame_by_key?${qs}`);
  if (!data?.image_data) return null;
  return { imageData: data.image_data, width: data.width, height: data.height };
}

/* ── Popup content builder ──────────────────────────────── */
interface PopupAsset {
  label: string;
  route: string;
  video: string;
  frame: number;
  side: string | null;
  category: Category;
  box: Box | null;
  iw: number;
  ih: number;
  color: string;
  json: string;
}

function buildPopupElement(apiBase: string, a: PopupAsset): HTMLElement {
  const root = document.createElement("div");
  root.style.cssText = "font: 11px sans-serif; width: 360px;";
  root.innerHTML =
    `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(a.label)} · ${a.category}</div>` +
    `<div style="color:#555;margin-bottom:6px">` +
    `${escapeHtml(a.route)} · ${escapeHtml(a.video)} @ f${a.frame}` +
    (a.side ? ` · ${a.side}` : "") +
    `</div>` +
    `<div style="position:relative;width:100%;aspect-ratio:${a.iw || 16}/${a.ih || 9};background:#eee;border-radius:4px;overflow:hidden">` +
      `<div class="__status" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#666">Loading…</div>` +
      `<img class="__img" style="display:none;position:absolute;inset:0;width:100%;height:100%;object-fit:contain"/>` +
      `<canvas class="__cv" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"></canvas>` +
    `</div>` +
    `<div style="margin-top:6px;color:#888;font-size:10px">${escapeHtml(a.json)}</div>`;

  const img = root.querySelector(".__img") as HTMLImageElement;
  const cv = root.querySelector(".__cv") as HTMLCanvasElement;
  const status = root.querySelector(".__status") as HTMLDivElement;

  function drawBox() {
    if (!a.box || !a.iw || !a.ih) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const cw = img.clientWidth;
    const ch = img.clientHeight;
    if (!cw || !ch) return;
    cv.width = cw;
    cv.height = ch;
    ctx.clearRect(0, 0, cw, ch);

    // object-contain math (letterbox)
    const imgAspect = a.iw / a.ih;
    const boxAspect = cw / ch;
    let rw: number, rh: number, ox: number, oy: number;
    if (imgAspect > boxAspect) {
      rw = cw; rh = cw / imgAspect; ox = 0; oy = (ch - rh) / 2;
    } else {
      rh = ch; rw = ch * imgAspect; oy = 0; ox = (cw - rw) / 2;
    }
    const sx = rw / a.iw, sy = rh / a.ih;
    const x = a.box.x * sx + ox;
    const y = a.box.y * sy + oy;
    const w = a.box.w * sx;
    const h = a.box.h * sy;

    ctx.strokeStyle = a.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    const label = a.label;
    const fontSize = Math.max(10, Math.round(rw / 50));
    ctx.font = `bold ${fontSize}px sans-serif`;
    const tm = ctx.measureText(label);
    const labelH = fontSize + 6;
    const labelY = y > labelH + 2 ? y - labelH - 2 : y + h + 2;
    ctx.fillStyle = a.color;
    ctx.fillRect(x, labelY, tm.width + 8, labelH);
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + 4, labelY + labelH / 2);
  }

  (async () => {
    try {
      const frm = await fetchFrameByKey(apiBase, a.video, a.frame);
      if (!frm) {
        status.textContent = "Frame fetch failed";
        return;
      }
      img.onload = () => {
        status.style.display = "none";
        img.style.display = "block";
        drawBox();
      };
      img.src = frm.imageData;
    } catch (e: any) {
      status.textContent = `Error: ${e?.message ?? e}`;
    }
  })();

  return root;
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ── Fit bounds on first data load ──────────────────────── */
function FitBounds({ routes }: { routes: Route[] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current) return;
    const latlngs: [number, number][] = [];
    for (const r of routes) {
      for (const p of r.points) latlngs.push([p.lat, p.lng]);
      for (const l of r.lines) for (const c of l.coords) latlngs.push([c[0], c[1]]);
    }
    if (!latlngs.length) return;
    const bounds = L.latLngBounds(latlngs);
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 18 });
      fitted.current = true;
    }
  }, [routes, map]);
  return null;
}

/* ── Asset layer ────────────────────────────────────────── */
function AssetLayer({
  routes,
  visibleRoutes,
  visibleCats,
  apiBase,
}: {
  routes: Route[];
  visibleRoutes: Set<string>;
  visibleCats: Set<Category>;
  apiBase: string;
}) {
  const map = useMap();
  const groupRef = useRef<L.LayerGroup>(L.layerGroup());
  const tooltipRef = useRef<L.Tooltip>(
    L.tooltip({ direction: "top", offset: [0, -6], opacity: 0.95 })
  );

  useEffect(() => {
    const group = groupRef.current;
    const tooltip = tooltipRef.current;
    group.clearLayers();

    for (const r of routes) {
      if (!visibleRoutes.has(r.name)) continue;

      if (visibleCats.has("point")) {
        for (const p of r.points) {
          const m = L.circleMarker([p.lat, p.lng], {
            radius: 5,
            color: "#ffffff",
            weight: 1,
            fillColor: r.color,
            fillOpacity: 0.9,
          });
          m.on("mouseover", (e) => {
            tooltip.setLatLng(e.latlng);
            tooltip.setContent(
              `<div style="font: 11px sans-serif; line-height: 1.3">` +
                `<b>${escapeHtml(p.label)}</b><br/>` +
                `Route: ${escapeHtml(r.name)}<br/>` +
                `Video: ${escapeHtml(p.video)} @ f${p.frame}<br/>` +
                `Side: ${p.side ?? "-"}<br/>` +
                `JSON: ${escapeHtml(p.json)}` +
                `</div>`
            );
            if (!map.hasLayer(tooltip)) tooltip.addTo(map);
          });
          m.on("mouseout", () => {
            if (map.hasLayer(tooltip)) map.removeLayer(tooltip);
          });
          m.on("click", () => {
            if (map.hasLayer(tooltip)) map.removeLayer(tooltip);
            const content = buildPopupElement(apiBase, {
              label: p.label, route: r.name, video: p.video, frame: p.frame,
              side: p.side, category: p.category, box: p.box,
              iw: p.iw, ih: p.ih, color: r.color, json: p.json,
            });
            L.popup({ maxWidth: 400, autoPan: true })
              .setLatLng([p.lat, p.lng])
              .setContent(content)
              .openOn(map);
          });
          group.addLayer(m);
        }
      }

      for (const l of r.lines) {
        if (!visibleCats.has(l.category)) continue;
        const positions: [number, number][] = l.coords;
        if (positions.length < 2) continue;
        const line = L.polyline(positions, {
          color: r.color,
          weight: l.category === "linear_sided" ? 4 : 3,
          opacity: 0.85,
          lineCap: "round",
          lineJoin: "round",
        });
        line.on("mouseover", (e) => {
          tooltip.setLatLng(e.latlng);
          tooltip.setContent(
            `<div style="font: 11px sans-serif; line-height: 1.3">` +
              `<b>${escapeHtml(l.label)}</b> (${l.category})<br/>` +
              `Route: ${escapeHtml(r.name)}<br/>` +
              `Video: ${escapeHtml(l.video)}<br/>` +
              `Frames: ${escapeHtml(l.frames)}<br/>` +
              `Side: ${l.side ?? "-"}<br/>` +
              `JSON: ${escapeHtml(l.json)}` +
              `</div>`
          );
          if (!map.hasLayer(tooltip)) tooltip.addTo(map);
        });
        line.on("mouseout", () => {
          if (map.hasLayer(tooltip)) map.removeLayer(tooltip);
        });
        line.on("click", (e) => {
          if (map.hasLayer(tooltip)) map.removeLayer(tooltip);
          const { lat, lng } = (e as any).latlng;
          const kp = nearestKeypoint(l.keypoints, lat, lng);
          const frame = kp ? kp.frame : l.first_frame;
          if (frame == null) return;
          const box = kp ? kp.box : l.box;
          const popupLat = lat;
          const popupLng = lng;
          const content = buildPopupElement(apiBase, {
            label: l.label, route: r.name, video: l.video,
            frame, side: kp?.side ?? l.side, category: l.category,
            box, iw: l.iw, ih: l.ih, color: r.color, json: l.json,
          });
          L.popup({ maxWidth: 400, autoPan: true })
            .setLatLng([popupLat, popupLng])
            .setContent(content)
            .openOn(map);
        });
        group.addLayer(line);
      }
    }

    if (!map.hasLayer(group)) group.addTo(map);
    return () => {
      if (map.hasLayer(tooltip)) map.removeLayer(tooltip);
    };
  }, [routes, visibleRoutes, visibleCats, map, apiBase]);

  return null;
}

/* ── Main component ─────────────────────────────────────── */
export default function AssetPreviewMap({
  src = "/assets.json",
  data,
  height = "100vh",
  apiBase = "http://34.93.136.128:5050",
}: Props) {
  const [payload, setPayload] = useState<AssetPayload | null>(data ?? null);
  const [loading, setLoading] = useState<boolean>(!data);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (data) return;
    let cancelled = false;
    setLoading(true);
    fetch(src)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((p) => {
        if (!cancelled) {
          setPayload(p);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setErr(String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [src, data]);

  const routes = useMemo<Route[]>(() => payload?.routes ?? [], [payload]);
  const [visibleRoutes, setVisibleRoutes] = useState<Set<string>>(new Set());
  const [visibleCats, setVisibleCats] = useState<Set<Category>>(
    new Set(["point", "linear_sided", "linear_unsided"])
  );

  useEffect(() => {
    if (routes.length === 0) return;
    setVisibleRoutes(new Set(routes.map((r) => r.name)));
  }, [routes]);

  const stats = payload?.stats;

  const routesSorted = useMemo(
    () => [...routes].sort((a, b) => a.name.localeCompare(b.name)),
    [routes]
  );

  return (
    <div style={{ display: "flex", height, width: "100%", fontFamily: "sans-serif" }}>
      <div
        style={{
          width: 280,
          borderRight: "1px solid #ddd",
          padding: 12,
          overflowY: "auto",
          background: "#fafafa",
          fontSize: 12,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Asset Preview</div>
        {loading && <div>Loading {src} …</div>}
        {err && <div style={{ color: "crimson" }}>Error: {err}</div>}
        {stats && (
          <div style={{ marginBottom: 8 }}>
            {stats.routes} routes · {stats.points} points · {stats.lines} lines
          </div>
        )}

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Category</div>
          {(["point", "linear_sided", "linear_unsided"] as Category[]).map((c) => (
            <label key={c} style={{ display: "block" }}>
              <input
                type="checkbox"
                checked={visibleCats.has(c)}
                onChange={(e) => {
                  const next = new Set(visibleCats);
                  if (e.target.checked) next.add(c);
                  else next.delete(c);
                  setVisibleCats(next);
                }}
              />{" "}
              {c}
            </label>
          ))}
        </div>

        <div style={{ fontWeight: 600, marginBottom: 4 }}>Routes</div>
        <div style={{ marginBottom: 6 }}>
          <button style={{ marginRight: 4 }} onClick={() => setVisibleRoutes(new Set(routes.map((r) => r.name)))}>All</button>
          <button onClick={() => setVisibleRoutes(new Set())}>None</button>
        </div>

        {routesSorted.map((r) => {
          const on = visibleRoutes.has(r.name);
          return (
            <label
              key={r.name}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={(e) => {
                  const next = new Set(visibleRoutes);
                  if (e.target.checked) next.add(r.name);
                  else next.delete(r.name);
                  setVisibleRoutes(next);
                }}
              />
              <span style={{ display: "inline-block", width: 10, height: 10, background: r.color, border: "1px solid #8888" }} />
              <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.name}
              </span>
              <span style={{ color: "#888" }}>
                {r.points.length}/{r.lines.length}
              </span>
            </label>
          );
        })}
      </div>

      <div style={{ flex: 1, position: "relative" }}>
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          maxZoom={21}
          style={{ width: "100%", height: "100%" }}
          scrollWheelZoom
          preferCanvas
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            maxNativeZoom={19}
            maxZoom={21}
          />
          <FitBounds routes={routes} />
          <AssetLayer
            routes={routes}
            visibleRoutes={visibleRoutes}
            visibleCats={visibleCats}
            apiBase={apiBase}
          />
        </MapContainer>
      </div>
    </div>
  );
}
