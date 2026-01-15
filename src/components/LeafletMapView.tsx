import { useEffect, useRef, useState } from "react";
import L, { canvas } from "leaflet";
import "leaflet/dist/leaflet.css";
import { api, API_BASE } from "@/lib/api";
import { demoDataCache } from "@/contexts/UploadContext";
import { isDemoVideo, type ProcessedVideoData, type Detection, ANNOTATION_CATEGORIES } from "@/services/demoDataService";

// Fix for default marker icons in Leaflet with Vite
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import FrameComparisonPopup from "@/components/FrameComparisonPopup";
import { createRoot } from "react-dom/client";
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

// Category colors for marker visualization
const CATEGORY_COLORS: Record<string, string> = {
  [ANNOTATION_CATEGORIES.OIA]: '#22c55e',           // Green
  [ANNOTATION_CATEGORIES.ITS]: '#3b82f6',           // Blue
  [ANNOTATION_CATEGORIES.ROADWAY_LIGHTING]: '#f59e0b', // Amber
  [ANNOTATION_CATEGORIES.STRUCTURES]: '#8b5cf6',    // Purple
  [ANNOTATION_CATEGORIES.DIRECTIONAL_SIGNAGE]: '#ec4899', // Pink
  [ANNOTATION_CATEGORIES.CORRIDOR_PAVEMENT]: '#06b6d4', // Cyan
};

type GpxTrack = {
  path: L.LatLngExpression[];
  title: string;
  color: string;
  routeId: number;
  roadName: string;
  videoId?: string;
  isDemo?: boolean;
  demoData?: ProcessedVideoData;
};

// Frame with detection data
interface FrameWithDetection {
  timestamp: number;
  latitude?: number;
  longitude?: number;
  detections: Array<{ class_name: string; confidence: number; condition?: string; category?: string; bbox?: any }>;
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

  // Load tracks from videos only (GPX files attached to videos)
  useEffect(() => {
    if (!mapRef.current || roads.length === 0) return;

    (async () => {
      try {
        const baseUrl = API_BASE;
        const colors = ["#e11d48", "#0ea5e9", "#22c55e", "#f59e0b", "#8b5cf6", "#ef4444", "#ec4899", "#06b6d4"];
        const loadedTracks: GpxTrack[] = [];

        console.log(`Loading GPX tracks from videos for ${roads.length} roads from ${baseUrl}`);

        // Load GPX from videos only
        try {
          const videosResp = await api.videos.list();
          const videos = videosResp.items as any[];

          for (let i = 0; i < videos.length; i++) {
            const video = videos[i];
            if (!video.gpx_file_url) continue;

            // Find the matching road for this video (for road name and filtering)
            const road = roads.find(r => r.route_id === video.route_id);
            const roadName = road?.road_name || video.title || `Video ${video._id?.$oid || video._id}`;
            const videoId = video._id?.$oid || video._id;

            // Check if this is a demo video with cached data
            const demoKey = isDemoVideo(video.title || '');
            const cachedDemoData = demoDataCache.get(videoId);

            const url = `${baseUrl}${video.gpx_file_url}`;
            const path = await fetchAndParseGpx(url);
            if (!path || path.length < 2) {
              console.warn(`Failed to load or parse GPX for video ${video.title || video._id}`);
              continue;
            }

            console.log(`Successfully loaded ${path.length} points from video GPX: ${roadName}${demoKey ? ' (DEMO)' : ''}`);
            loadedTracks.push({
              path,
              title: roadName,
              color: colors[i % colors.length],
              routeId: video.route_id,
              roadName: roadName,
              videoId,
              isDemo: !!demoKey || !!cachedDemoData,
              demoData: cachedDemoData,
            });
          }
        } catch (err) {
          console.error("Failed to load GPX from videos:", err);
        }

        setTracks(loadedTracks);
        console.log(`Loaded ${loadedTracks.length} tracks from video GPX files`);
      } catch (err) {
        console.error("Failed to load tracks:", err);
      }
    })();
  }, [roads]);

  // Fetch frames with detections for each track's route (or use demo data)
  useEffect(() => {
    if (tracks.length === 0) return;

    (async () => {
      const framesMap = new Map<number, FrameWithDetection[]>();

      for (const track of tracks) {
        try {
          // Check if we have demo data for this track
          if (track.demoData) {
            // Convert demo detections to frame format
            const demoFrames: FrameWithDetection[] = [];
            const detectionsByTimestamp = new Map<number, Detection[]>();
            
            // Group detections by timestamp (rounded to nearest second)
            for (const detection of track.demoData.detections) {
              const ts = Math.round(detection.timestamp);
              if (!detectionsByTimestamp.has(ts)) {
                detectionsByTimestamp.set(ts, []);
              }
              detectionsByTimestamp.get(ts)!.push(detection);
            }
            
            // Convert to frame format
            for (const [timestamp, detections] of detectionsByTimestamp) {
              const firstDetection = detections[0];
              demoFrames.push({
                timestamp,
                latitude: firstDetection.lat,
                longitude: firstDetection.lon,
                detections: detections.map(d => ({
                  class_name: d.className,
                  confidence: d.confidence,
                  condition: d.condition,
                  category: d.category,
                })),
              });
            }
            
            framesMap.set(track.routeId, demoFrames);
            console.log(`Using ${demoFrames.length} demo frames for route ${track.routeId}`);
          } else {
            // Fetch from API
            const framesResp = await api.frames.withDetections({ route_id: track.routeId, limit: 10000 });
            if (framesResp?.items) {
              framesMap.set(track.routeId, framesResp.items);
            }
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
      console.log(`Route ${t.routeId}: ${t.path.length} GPS points`);
      
      // Get frames with detections for this route
      const routeFrames = framesWithDetections.get(t.routeId) || [];

      // For demo videos, show more points (all GPS points for 5-minute video = 300 points)
      // For non-demo, sample to avoid overcrowding
      const isDemo = t.isDemo || t.demoData;
      const samplingRate = isDemo 
        ? Math.max(1, Math.floor(t.path.length / 150)) // Show ~150 markers for demo
        : Math.max(1, Math.floor(t.path.length / 100)); // Show ~100 for non-demo

      t.path.forEach(async (point, index) => {
        // Only show every Nth point to avoid too many markers
        if (index % samplingRate !== 0 && index !== 0 && index !== t.path.length - 1) {
          return;
        }

        // Calculate the timestamp for this point
        const progress = t.path.length > 1 ? index / (t.path.length - 1) : 0;
        const videoDuration = video?.duration_seconds || 300;
        const pointTimestamp = progress * videoDuration;

        // Find detections at this timestamp for coloring and filtering
        let pointDetections: FrameWithDetection['detections'] = [];
        
        if (t.demoData) {
          // Get demo detections near this timestamp
          pointDetections = t.demoData.detections
            .filter(d => Math.abs(d.timestamp - pointTimestamp) < 2)
            .map(d => ({
              class_name: d.className,
              confidence: d.confidence,
              condition: d.condition,
              category: d.category,
            }));
        } else {
          // Find closest frame from API data
          let closestFrame: FrameWithDetection | null = null;
          let minDiff = Infinity;
          for (const frame of routeFrames) {
            const diff = Math.abs(frame.timestamp - pointTimestamp);
            if (diff < minDiff) {
              minDiff = diff;
              closestFrame = frame;
            }
          }
          if (closestFrame) {
            pointDetections = closestFrame.detections;
          }
        }

        // Filter based on selectedAssetTypes
        if (selectedAssetTypes.length > 0) {
          const hasSelectedAssetType = pointDetections.some(detection =>
            selectedAssetTypes.includes(detection.class_name)
          );
          if (!hasSelectedAssetType) {
            return; // Skip this marker
          }
        }

        const latLng = point as L.LatLngTuple;

        // Determine marker color based on detection categories
        let markerColor = t.color; // Default to track color
        if (pointDetections.length > 0) {
          // Use the color of the first detection's category
          const firstCategory = pointDetections[0]?.category;
          if (firstCategory && CATEGORY_COLORS[firstCategory]) {
            markerColor = CATEGORY_COLORS[firstCategory];
          }
        }

        // Determine marker size based on number of detections
        const detectionCount = pointDetections.length;
        const markerRadius = detectionCount > 5 ? 7 : detectionCount > 2 ? 5 : 4;

        // Create circle marker (dot) for each point
        const circleMarker = L.circleMarker(latLng, {
          radius: markerRadius,
          fillColor: markerColor,
          color: '#ffffff', // White border
          weight: 1,
          opacity: 1,
          fillOpacity: 0.9,
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

              let frameData: any;

              // Check if this track has demo data
              if (t.demoData) {
                // Use demo data - find detections closest to this timestamp
                const nearbyDetections = t.demoData.detections.filter(
                  d => Math.abs(d.timestamp - timestamp) < 2 // within 2 seconds
                );
                
                // Create frame data for demo with proper bbox format
                frameData = {
                  image_data: '', // No image for demo - will show detection summary
                  detections: nearbyDetections.map(d => ({
                    class_name: d.className,
                    confidence: d.confidence,
                    bbox: {
                      x: d.bbox.x,      // Keep as percentage (0-100)
                      y: d.bbox.y,
                      width: d.bbox.width,
                      height: d.bbox.height,
                    },
                    condition: d.condition,
                    category: d.category,
                  })),
                  width: 1920,
                  height: 1080,
                  frame_number: Math.round(timestamp * 30),
                  is_demo: true,
                };
                console.log(`Demo popup at ${timestamp.toFixed(1)}s: ${nearbyDetections.length} detections from ${Object.keys(CATEGORY_COLORS).length} categories`);
              } else {
                // Fetch frame data from API
                frameData = await api.videos.getFrameWithDetections(
                  video_id_real,
                  timestamp.toFixed(1)
                );
              }

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
                maxWidth: 850,
                minWidth: 800,
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
                    <FrameComparisonPopup
                      frameData={{
                        ...frameData,
                        videoId: video_id_real,
                        timestamp: timestamp.toFixed(1),
                        baseUrl,
                        gpx_point: { lat: latLng[0], lon: latLng[1] },
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
