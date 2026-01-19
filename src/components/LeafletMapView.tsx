import { useEffect, useRef, useState } from "react";
import L, { canvas } from "leaflet";
import "leaflet/dist/leaflet.css";
import { api, API_BASE } from "@/lib/api";

// Fix for default marker icons in Leaflet with Vite
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import FramePopupContent from "@/components/FramePopupContent";
import { createRoot, Root } from "react-dom/client";
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
  videoId: string;
  videoDuration: number;
};

// Frame with detection data
interface FrameWithDetection {
  frame_number: number;
  timestamp: number;
  latitude?: number;
  longitude?: number;
  detections: Record<string, Array<{ class_name: string; confidence: number }>>;
  detections_count: number;
}

// Video frames response from API
interface VideoFramesData {
  video_id: string;
  is_demo: boolean;
  items: FrameWithDetection[];
  total: number;
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
  const [videoFramesMap, setVideoFramesMap] = useState<Map<string, VideoFramesData>>(new Map());
  const frameDataCacheRef = useRef<Map<string, any>>(new Map());
  const canvasRendererRef = useRef<L.Canvas | null>(null);
  const popupRootRef = useRef<Root | null>(null);
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
    canvasRendererRef.current = L.canvas({ padding: 0.5 });

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

            const url = `${baseUrl}${video.gpx_file_url}`;
            const path = await fetchAndParseGpx(url);
            if (!path || path.length < 2) {
              console.warn(`Failed to load or parse GPX for video ${video.title || video._id}`);
              continue;
            }

            console.log(`Successfully loaded ${path.length} points from video GPX: ${roadName}`);
            loadedTracks.push({
              path,
              title: roadName,
              color: colors[i % colors.length],
              routeId: video.route_id,
              roadName: roadName,
              videoId: video._id?.$oid || video._id,
              videoDuration: video.duration_seconds || 300,
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

  // Fetch all frames for each video (supports demo videos with key-based lookup)
  useEffect(() => {
    if (tracks.length === 0) return;

    (async () => {
      const framesMap = new Map<string, VideoFramesData>();

      // Parallel fetch all frames data using Promise.all
      const fetchPromises = tracks.map(async (track) => {
        try {
          const framesResp = await api.videos.getAllFrames(track.videoId);
          return { videoId: track.videoId, framesResp };
        } catch (err) {
          console.error(`Failed to fetch frames for video ${track.videoId}:`, err);
          return { videoId: track.videoId, framesResp: null };
        }
      });

      const results = await Promise.all(fetchPromises);

      results.forEach(({ videoId, framesResp }) => {
        if (framesResp) {
          framesMap.set(videoId, framesResp as VideoFramesData);
          console.log(`Loaded ${framesResp.total} frames for video ${videoId} (demo: ${framesResp.is_demo})`);
        }
      });

      setVideoFramesMap(framesMap);
      // console.log(`Loaded frames for ${framesMap.size} videos`);
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

    // Draw dots/markers along the route
    filteredTracks.forEach((t) => {
      // Get frames data for this video
      const videoFramesData = videoFramesMap.get(t.videoId);
      const frames = videoFramesData?.items || [];

      // console.log(`Track ${t.title}: ${t.path.length} GPX points, ${frames.length} frames`);

      // Pre-associate GPX points with frame numbers
      // If more GPX points than frames, extra points use the last frame
      const getFrameForPoint = (pointIndex: number): FrameWithDetection | null => {
        if (frames.length === 0) return null;

        // Map point index to frame index proportionallyhealth
        const progress = t.path.length > 1 ? pointIndex / (t.path.length - 1) : 0;
        let frameIndex = Math.floor(progress * frames.length);

        // Clamp to valid range (use last frame for extra points)
        frameIndex = Math.min(frameIndex, frames.length - 1);

        return frames[frameIndex];
      };

      // Sample points along the route (every Nth point to avoid overcrowding)
      const samplingRate = Math.max(1, Math.floor(t.path.length / 100)); // Show ~100 dots per route

      t.path.forEach((point, index) => {
        // Only show every Nth point to avoid too many markers
        if (index % samplingRate !== 0 && index !== 0 && index !== t.path.length - 1) {
          return;
        }

        // Get the associated frame for this point
        const associatedFrame = getFrameForPoint(index);

        // Filter based on selectedAssetTypes
        if (selectedAssetTypes.length > 0) {
          if (!associatedFrame || !associatedFrame.detections) {
            return; // Skip - no frame data for this point
          }

          // Flatten detections from Record<string, Detection[]> to Detection[]
          const allDetections = Object.values(associatedFrame.detections).flat();

          const hasSelectedAssetType = allDetections.some(detection =>
            selectedAssetTypes.includes(detection.class_name)
          );

          if (!hasSelectedAssetType) {
            return; // Skip this marker - doesn't have any of the selected asset types
          }
        }

        const latLng = point as L.LatLngTuple;

        // Create circle marker (dot) for each point using canvas renderer for performance
        const circleMarker = L.circleMarker(latLng, {
          radius: 4,
          fillColor: t.color,
          color: '#ffffff',
          weight: 1,
          opacity: 1,
          fillOpacity: 0.8,
          renderer: canvasRendererRef.current || undefined,
        }).addTo(mapRef.current!);

        // Add popup on click with frame image
        circleMarker.on('click', async () => {
          const baseUrl = API_BASE;

          try {
            // Use the pre-associated frame number for the API call
            const frameToShow = associatedFrame;

            if (frameToShow) {
              // Check cache first to avoid redundant API calls
              const cacheKey = `${t.videoId}-${frameToShow.frame_number}`;
              let frameData = frameDataCacheRef.current.get(cacheKey);
              // console.log(`Frame data for ${cacheKey}:`, frameData);
              if (!frameData) {
                // Fetch frame data using frame_number (guaranteed to be valid)
                frameData = await api.videos.getFrameWithDetections(
                  t.videoId,
                  undefined, // no timestamp
                  frameToShow.frame_number // use frame_number directly
                );

                let flatDetections: any[] = Object.values(frameData.detections).flat();
                frameData.detections = flatDetections;

                // Cache for future use
                frameDataCacheRef.current.set(cacheKey, frameData);
                // console.log(`Cached frame data for ${cacheKey}`);
                // console.log(`Frame data for ${cacheKey}:`, frameData);
              } else {
                console.log(`Using cached frame data for ${cacheKey}`);
              }

              // Unmount previous root BEFORE opening new popup to avoid conflicts
              if (popupRootRef.current) {
                try {
                  popupRootRef.current.unmount();
                  popupRootRef.current = null;
                } catch (e) {
                  // Ignore unmount errors
                }
              }

              // Open custom React popup
              setPopupState({
                isOpen: true,
                frameData: {
                  ...frameData,
                  videoId: t.videoId,
                  timestamp: frameToShow.timestamp.toFixed(1),
                  baseUrl,
                },
                trackTitle: t.title,
                pointIndex: index,
                totalPoints: t.path.length,
              });

              // Generate unique ID to avoid DOM conflicts between popups
              const popupId = `popup-root-${Date.now()}`;

              // Create a custom Leaflet popup with a container
              const popupContainer = L.popup({
                maxWidth: 780,
                minWidth: 750,
                className: 'custom-popup',
              })
                .setLatLng(latLng)
                .setContent(`<div id="${popupId}"></div>`)
                .openOn(mapRef.current!);

              // Render React component into popup
              setTimeout(() => {
                const popupElement = document.getElementById(popupId);
                if (popupElement) {
                  const root = createRoot(popupElement);
                  popupRootRef.current = root;
                  root.render(
                    <FramePopupContent
                      frameData={{
                        ...frameData,
                        videoId: t.videoId,
                        timestamp: frameToShow.timestamp.toFixed(1),
                        baseUrl,
                      }}
                      trackTitle={t.title}
                      pointIndex={index}
                      totalPoints={t.path.length}
                      onClose={() => {
                        if (mapRef.current) {
                          mapRef.current.closePopup();
                        }
                        if (popupRootRef.current) {
                          popupRootRef.current.unmount();
                          popupRootRef.current = null;
                        }
                      }}
                    />
                  );
                }
              }, 50);
            } // end if (frameToShow)
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
        renderer: canvasRendererRef.current || undefined,
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
  }, [tracks, selectedRoadNames, selectedAssetTypes, videoFramesMap]);

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
