import { useEffect, useRef, useState } from "react";
import { api, API_BASE } from "@/lib/api";

type GpxTrack = {
  path: google.maps.LatLngLiteral[];
  title: string;
  color: string;
  routeId: number;
  roadName: string;
};

interface GoogleMapViewProps {
  selectedRoadNames?: string[];
  roads?: any[];
}

function loadGoogleMaps(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).google?.maps?.importLibrary) return resolve();

    // Create a global callback function
    (window as any).initGoogleMaps = () => {
      resolve();
    };

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&loading=async&callback=initGoogleMaps`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });
}

async function fetchAndParseGpx(url: string): Promise<google.maps.LatLngLiteral[] | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Failed to fetch GPX: ${res.status} ${res.statusText}`);
      return null;
    }
    const text = await res.text();

    // Debug: Log first 200 characters of response
    console.log(`GPX response preview (${url}):`, text.substring(0, 200));

    const dom = new DOMParser().parseFromString(text, "application/xml");

    // Check for XML parsing errors
    const parseError = dom.querySelector("parsererror");
    if (parseError) {
      console.error("XML parse error:", parseError.textContent);
      console.error("Response was:", text.substring(0, 500));
      return null;
    }

    const pts = Array.from(dom.getElementsByTagName("trkpt"));
    if (pts.length === 0) {
      console.warn("No trkpt elements found in GPX file");
      return null;
    }

    const path = pts.map((pt) => ({
      lat: parseFloat(pt.getAttribute("lat") || "0"),
      lng: parseFloat(pt.getAttribute("lon") || "0"),
    }));
    return path.filter((p) => !Number.isNaN(p.lat) && !Number.isNaN(p.lng));
  } catch (err) {
    console.error("Error fetching/parsing GPX:", err);
    return null;
  }
}

export default function GoogleMapView({ selectedRoadNames = [], roads = [] }: GoogleMapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const markersRef = useRef<any[]>([]);
  const [ready, setReady] = useState(false);
  const [tracks, setTracks] = useState<GpxTrack[]>([]);

  useEffect(() => {
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "AIzaSyAhKF8UGgJInOqimWMNUGvoY_s8sXPFi4k";
    if (!key) return; // user will add their key
    loadGoogleMaps(key)
      .then(() => setReady(true))
      .catch(() => {});
  }, []);

  // Initialize map
  useEffect(() => {
    if (!ready || !containerRef.current) return;
    if (!mapRef.current) {
      (async () => {
        try {
          const { Map } = await google.maps.importLibrary("maps") as google.maps.MapsLibrary;
          mapRef.current = new Map(containerRef.current!, {
            center: { lat: 25.2854, lng: 51.5310 },
            zoom: 10,
            mapId: "roadmap",
          });
        } catch (err) {
          console.error("Failed to initialize Google Map:", err);
        }
      })();
    }
  }, [ready]);

  // Load tracks from roads and videos (with GPX files)
  useEffect(() => {
    if (!ready || !mapRef.current || roads.length === 0) return;

    (async () => {
      try {
        const baseUrl = API_BASE;
        const colors = ["#e11d48", "#0ea5e9", "#22c55e", "#f59e0b", "#8b5cf6", "#ef4444", "#ec4899", "#06b6d4"];
        const loadedTracks: GpxTrack[] = [];

        console.log(`Loading GPX tracks for ${roads.length} roads from ${baseUrl}`);

        // Load GPX from roads
        for (let i = 0; i < roads.length; i++) {
          const road = roads[i];
          if (!road.gpx_file_url) {
            console.log(`Road ${road.road_name} has no GPX file`);
            continue;
          }

          const url = `${baseUrl}${road.gpx_file_url}`;
          console.log(`Fetching GPX for ${road.road_name} from ${url}`);

          const path = await fetchAndParseGpx(url);
          if (!path || path.length < 2) {
            console.warn(`Failed to load or parse GPX for ${road.road_name}`);
            continue;
          }

          console.log(`Successfully loaded ${path.length} points for ${road.road_name}`);
          loadedTracks.push({
            path,
            title: road.road_name,
            color: colors[i % colors.length],
            routeId: road.route_id,
            roadName: road.road_name,
          });
        }

        // Also load GPX from videos
        try {
          const videosResp = await api.videos.list();
          const videos = videosResp.items as any[];

          for (const video of videos) {
            if (!video.gpx_file_url) continue;

            // Find the road for this video
            const road = roads.find(r => r.route_id === video.route_id);
            if (!road) continue;

            const url = `${baseUrl}${video.gpx_file_url}`;
            const path = await fetchAndParseGpx(url);
            if (!path || path.length < 2) continue;

            // Check if we already have a track for this road
            const existingTrack = loadedTracks.find(t => t.routeId === road.route_id);
            if (!existingTrack) {
              const colorIndex = loadedTracks.length % colors.length;
              loadedTracks.push({
                path,
                title: `${road.road_name} (Video)`,
                color: colors[colorIndex],
                routeId: road.route_id,
                roadName: road.road_name,
              });
            }
          }
        } catch (err) {
          console.error("Failed to load GPX from videos:", err);
        }

        setTracks(loadedTracks);
        console.log(`Loaded ${loadedTracks.length} road tracks from GPX files (roads and videos)`);
      } catch (err) {
        console.error("Failed to load tracks:", err);
      }
    })();
  }, [ready, roads]);

  // Filter and render tracks based on selected roads
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear existing polylines and markers
    polylinesRef.current.forEach((poly) => poly.setMap(null));
    markersRef.current.forEach((marker) => {
      if (marker.setMap) marker.setMap(null);
      else if (marker.map) marker.map = null;
    });
    polylinesRef.current = [];
    markersRef.current = [];

    // Filter tracks based on selected roads
    const filteredTracks = selectedRoadNames.length === 0
      ? tracks
      : tracks.filter((t) => selectedRoadNames.includes(t.roadName));

    if (filteredTracks.length === 0) return;

    // Draw polylines and markers for filtered tracks
    (async () => {
      try {
        const { LatLngBounds } = await google.maps.importLibrary("core") as google.maps.CoreLibrary;
        const { AdvancedMarkerElement } = await google.maps.importLibrary("marker") as google.maps.MarkerLibrary;

        // Fit bounds to show all filtered tracks
        const bounds = new LatLngBounds();
        filteredTracks.forEach((t) => t.path.forEach((p) => bounds.extend(p)));
        if (!bounds.isEmpty()) mapRef.current?.fitBounds(bounds);

        // Draw polylines and markers
        for (const t of filteredTracks) {
          const poly = new google.maps.Polyline({
            path: t.path,
            strokeColor: t.color,
            strokeOpacity: 0.9,
            strokeWeight: 4,
            map: mapRef.current!,
          });
          polylinesRef.current.push(poly);

          const start = t.path[0];
          const marker = new AdvancedMarkerElement({
            position: start,
            map: mapRef.current!,
            title: t.title,
          });
          markersRef.current.push(marker);

          const info = new google.maps.InfoWindow({
            content: `<div style="font-weight:600">${t.title}</div>`,
          });
          marker.addListener("click", () => info.open({ map: mapRef.current!, anchor: marker }));
        }
      } catch (err) {
        console.error("Failed to render map tracks:", err);
      }
    })();
  }, [tracks, selectedRoadNames]);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", borderRadius: 12, overflow: "hidden" }} />
  );
}


