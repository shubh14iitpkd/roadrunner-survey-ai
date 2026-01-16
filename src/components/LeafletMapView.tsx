import { useEffect, useRef, useState } from "react";
import L, { canvas } from "leaflet";
import "leaflet/dist/leaflet.css";
import { api, API_BASE } from "@/lib/api";

// Fix for default marker icons in Leaflet with Vite
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import FramePopupContent from "@/components/FramePopupContent";
import { createRoot } from "react-dom/client";
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

type GpxTrack = {
  path: L.LatLngExpression[];
  title: string;
  color: string;
  routeId: number;
  roadName: string;
};

// Frame with detection data
interface FrameWithDetection {
  timestamp: number;
  latitude?: number;
  longitude?: number;
  detections: Array<{ class_name: string; confidence: number }>;
}

interface LeafletMapViewProps {
  selectedRoadNames?: string[];
  roads?: any[];
  selectedAssetTypes?: string[];
}

async function fetchAndParseGpx(url: string): Promise<L.LatLngExpression[] | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Failed to fetch GPX: ${res.status} ${res.statusText}`);
      return null;
    }
    const text = await res.text();

    // console.log(`GPX response preview (${url}):`, text.substring(0, 200));

    const dom = new DOMParser().parseFromString(text, "application/xml");

    const parseError = dom.querySelector("parsererror");
    if (parseError) {
      console.error("XML parse error:", parseError.textContent);
      return null;
    }

    const pts = Array.from(dom.getElementsByTagName("trkpt"));
    if (pts.length === 0) {
      console.warn("No trkpt elements found in GPX file");
      return null;
    }

    const path = pts.map((pt) => [
      parseFloat(pt.getAttribute("lat") || "0"),
      parseFloat(pt.getAttribute("lon") || "0"),
    ] as L.LatLngExpression);

    return path.filter((p) => {
      const [lat, lng] = p as [number, number];
      return !Number.isNaN(lat) && !Number.isNaN(lng);
    });
  } catch (err) {
    console.error("Error fetching/parsing GPX:", err);
    return null;
  }
}

export default function LeafletMapView({ selectedRoadNames = [], roads = [], selectedAssetTypes = [] }: LeafletMapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polylinesRef = useRef<L.Polyline[]>([]);
  const markersRef = useRef<L.Marker[]>([]);
  const [tracks, setTracks] = useState<GpxTrack[]>([]);
  const [framesWithDetections, setFramesWithDetections] = useState<Map<number, FrameWithDetection[]>>(new Map());
  const [popupState, setPopupState] = useState<{
    isOpen: boolean;
    frameData: any;
    trackTitle: string;
    pointIndex: number;
    totalPoints: number;
  } | null>(null);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Create map instance centered on Doha, Qatar
    // Using zoom 8 since offline tiles only go up to zoom 9
    const map = L.map(containerRef.current).setView([25.2854, 51.5310], 9);

    // TILE CONFIGURATION: Multiple providers with fallback
    const baseUrl = API_BASE;
    const useOfflineTiles = false; // Set to true when you have correct SQLite tiles for Qatar

    if (useOfflineTiles) {
      // Offline tiles from SQLite database via backend
      L.tileLayer(`${baseUrl}/api/tiles/{z}/{x}/{y}.png`, {
        attribution: 'Offline Map Data © OpenStreetMap contributors | Tiles: MOBAC',
        maxZoom: 9,
        minZoom: 4,
        errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      }).addTo(map);

      console.log('Using offline tiles from SQLite database');
    } else {
      // Try multiple tile providers for better reliability
      try {
        // Option 1: Esri World Imagery (Satellite)
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
          maxZoom: 19,
          minZoom: 1,
          crossOrigin: true,
        }).addTo(map);

        console.log('Using online tiles from Esri World Imagery (Satellite)');
      } catch (error) {
        console.error('Failed to load tiles:', error);

        // Fallback: Try Humanitarian OpenStreetMap
        L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors, Tiles style by Humanitarian OpenStreetMap Team',
          maxZoom: 19,
        }).addTo(map);

        console.log('Using fallback tiles from HOT OSM');
      }
    }

    mapRef.current = map;

    // Cleanup
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Load tracks from roads and videos (with GPX files)
  useEffect(() => {
    if (!mapRef.current || roads.length === 0) return;

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
          // console.log(`Fetching GPX for ${road.road_name} from ${url}`);

          const path = await fetchAndParseGpx(url);
          if (!path || path.length < 2) {
            console.warn(`Failed to load or parse GPX for ${road.road_name}`);
            continue;
          }

          // console.log(`Successfully loaded ${path.length} points for ${road.road_name}`);
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

            const road = roads.find(r => r.route_id === video.route_id);
            if (!road) continue;

            const url = `${baseUrl}${video.gpx_file_url}`;
            const path = await fetchAndParseGpx(url);
            if (!path || path.length < 2) continue;

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
  }, [roads]);

  // Fetch frames with detections for each track's route
  useEffect(() => {
    if (tracks.length === 0) return;

    (async () => {
      const framesMap = new Map<number, FrameWithDetection[]>();

      for (const track of tracks) {
        try {
          const framesResp = await api.frames.withDetections({ route_id: track.routeId, limit: 3000 });
          if (framesResp?.items) {
            framesMap.set(track.routeId, framesResp.items);
          }
        } catch (err) {
          console.error(`Failed to fetch frames for route ${track.routeId}:`, err);
        }
      }

      setFramesWithDetections(framesMap);
      console.log(`Loaded frames with detections for ${framesMap.size} routes`);
    })();
  }, [tracks]);

  // Filter and render tracks based on selected roads
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear existing polylines and markers
    polylinesRef.current.forEach((poly) => poly.remove());
    markersRef.current.forEach((marker) => marker.remove());
    polylinesRef.current = [];
    markersRef.current = [];

    // Filter tracks based on selected roads
    const filteredTracks = selectedRoadNames.length === 0
      ? tracks
      : tracks.filter((t) => selectedRoadNames.includes(t.roadName));

    if (filteredTracks.length === 0) return;

    // Calculate bounds for all filtered tracks
    const allPoints: L.LatLngExpression[] = [];
    filteredTracks.forEach((t) => allPoints.push(...t.path));

    if (allPoints.length > 0) {
      const bounds = L.latLngBounds(allPoints as L.LatLngTuple[]);
      mapRef.current.fitBounds(bounds, { padding: [50, 50] });
    }

    // Draw dots/markers along the route instead of lines
    filteredTracks.forEach(async (t) => {
      const videosResp = await api.videos.list();
      const video = videosResp.items.find((v: any) => v.route_id === t.routeId);

      // Get frames with detections for this route
      const routeFrames = framesWithDetections.get(t.routeId) || [];

      // Sample points along the route (every Nth point to avoid overcrowding)
      const samplingRate = Math.max(1, Math.floor(t.path.length / 100)); // Show ~100 dots per route

      t.path.forEach(async (point, index) => {
        // Only show every Nth point to avoid too many markers
        if (index % samplingRate !== 0 && index !== 0 && index !== t.path.length - 1) {
          return;
        }

        // if (!video) {
        //   console.log(`No video found for route ${t.routeId}`);
        // }

        // Calculate the timestamp for this point
        const progress = t.path.length > 1 ? index / (t.path.length - 1) : 0;
        const videoDuration = video?.duration_seconds || 60;
        const pointTimestamp = progress * videoDuration;

        // Filter based on selectedAssetTypes
        if (selectedAssetTypes.length > 0) {
          // Find the closest frame to this point's timestamp
          let closestFrame: FrameWithDetection | null = null;
          let minDiff = Infinity;

          for (const frame of routeFrames) {
            const diff = Math.abs(frame.timestamp - pointTimestamp);
            if (diff < minDiff) {
              minDiff = diff;
              closestFrame = frame;
            }
          }

          // Check if this frame has any of the selected asset types
          if (closestFrame && closestFrame.detections) {
            const hasSelectedAssetType = closestFrame.detections.some(detection =>
              selectedAssetTypes.includes(detection.class_name)
            );

            if (!hasSelectedAssetType) {
              return; // Skip this marker - doesn't have any of the selected asset types
            }
          } else {
            return; // Skip - no frame data or detections for this point
          }
        }

        const latLng = point as L.LatLngTuple;

        // Create circle marker (dot) for each point
        const circleMarker = L.circleMarker(latLng, {
          radius: 4, // Size of the dot
          fillColor: t.color,
          color: '#ffffff', // White border
          weight: 1,
          opacity: 1,
          fillOpacity: 0.8,
        }).addTo(mapRef.current!);

        // Add popup on click with frame image
        circleMarker.on('click', async () => {
          const baseUrl = API_BASE;

          try {
            if (video && video._id) {
              const progress = t.path.length > 1 ? index / (t.path.length - 1) : 0;
              const videoDuration = video.duration_seconds || 60;
              const timestamp = progress * videoDuration;
              const video_id_real = video._id.$oid || video._id;

              // Fetch frame data
              const frameData = await api.videos.getFrameWithDetections(
                video_id_real,
                timestamp.toFixed(1)
              );

              // Open custom React popup instead of HTML string
              setPopupState({
                isOpen: true,
                frameData: {
                  ...frameData,
                  videoId: video_id_real,
                  timestamp: timestamp.toFixed(1),
                  baseUrl,
                },
                trackTitle: t.title,
                pointIndex: index,
                totalPoints: t.path.length,
              });

              // Create a custom Leaflet popup with a container
              const popupContainer = L.popup({
                maxWidth: 780,
                minWidth: 750,
                className: 'custom-popup',
              })
                .setLatLng(latLng)
                .setContent('<div id="popup-root"></div>')
                .openOn(mapRef.current!);

              // Render React component into popup
              setTimeout(() => {
                const popupElement = document.getElementById('popup-root');
                if (popupElement) {
                  const root = createRoot(popupElement);
                  root.render(
                    <FramePopupContent
                      frameData={{
                        ...frameData,
                        videoId: video_id_real,
                        timestamp: timestamp.toFixed(1),
                        baseUrl,
                      }}
                      trackTitle={t.title}
                      pointIndex={index}
                      totalPoints={t.path.length}
                      onClose={() => {
                        if (mapRef.current) {
                          mapRef.current.closePopup();
                        }
                        root.unmount();
                      }}
                    />
                  );
                }
              }, 50);
            }
          } catch (err) {
            console.error('Error loading video frame:', err);
            // circleMarker.bindPopup(`
            //   <div style="font-weight:600">${t.title}</div>
            //   <div style="font-size:11px;color:#666;">Point ${index + 1} of ${t.path.length}</div>
            //   <div style="font-size:11px;color:#ff6b6b;margin-top:4px;">Failed to load frame</div>
            // `).openPopup();
          }
        });

        markersRef.current.push(circleMarker as any);
      });

      // Add a larger marker at the start point with label
      const start = t.path[0] as L.LatLngTuple;
      const startMarker = L.circleMarker(start, {
        radius: 8,
        fillColor: t.color,
        color: '#ffffff',
        weight: 2,
        opacity: 1,
        fillOpacity: 1,
      }).addTo(mapRef.current!);

      startMarker.bindPopup(`
        <div style="font-weight:600">${t.title}</div>
        <div style="font-size:11px;color:#666;">Start Point</div>
      `);
      startMarker.bindTooltip(t.title, {
        permanent: false,
        direction: 'top',
        offset: [0, -10]
      });

      markersRef.current.push(startMarker as any);
    });
  }, [tracks, selectedRoadNames, selectedAssetTypes, framesWithDetections]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 12,
        overflow: "hidden"
      }}
    />
  );
}
