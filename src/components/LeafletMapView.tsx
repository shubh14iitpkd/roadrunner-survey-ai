import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api, API_BASE } from "@/lib/api";

// Fix for default marker icons in Leaflet with Vite
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import FramePopupContent from "@/components/FramePopupContent";
import { Button } from "@/components/ui/button";
import { createRoot, Root } from "react-dom/client";
import { useLabelMap } from "@/contexts/LabelMapContext";
import { getAssetIconFromId, isAssetIconExist } from "@/components/settings/iconConfig";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

// Asset from the backend
interface MapAsset {
  _id: string;
  asset_id?: string;
  category_id?: string;
  asset_type?: string;
  type?: string;
  class_name?: string;
  condition: string;
  confidence?: number;
  route_id?: number;
  survey_id?: string;
  video_id?: string;
  video_key?: string;
  frame_number?: number;
  timestamp?: number;
  location?: { type: string; coordinates: [number, number] };
  box?: { x: number; y: number; w?: number; h?: number; width?: number; height?: number };
}

interface LeafletMapViewProps {
  selectedRoadNames?: string[];
  roads?: any[];
  selectedAssetTypes?: string[]; // Array of asset_id values from labelMapData
  selectedCategories?: string[]; // Array of category_id values from labelMapData
}

const PopupLoader = () => (
  <div className="flex flex-col items-center justify-center p-12 min-h-[300px] w-full">
    <div className="relative w-16 h-16">
      <div className="absolute top-0 left-0 w-full h-full border-4 border-primary/20 rounded-full"></div>
      <div className="absolute top-0 left-0 w-full h-full border-4 border-primary border-t-transparent dark:text-muted-foreground rounded-full animate-spin"></div>
    </div>
    <div className="mt-4 text-primary dark:text-primary-foreground font-medium animate-pulse">Loading frame data...</div>
    <div className="mt-1 text-xs text-muted-foreground">Fetching detections and coordinates</div>
  </div>
);

export default function LeafletMapView({ selectedRoadNames = [], roads = [], selectedAssetTypes = [], selectedCategories = [] }: LeafletMapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  // const markersRef = useRef<L.CircleMarker[]>([]);
  const [allAssets, setAllAssets] = useState<MapAsset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const { data: labelMapData } = useLabelMap();

  const frameDataCacheRef = useRef<Map<string, any>>(new Map());
  const canvasRendererRef = useRef<L.Canvas | null>(null);
  const popupRootRef = useRef<Root | null>(null);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Create map instance centered on Doha, Qatar
    const map = L.map(containerRef.current).setView([25.2854, 51.5310], 9);

    // TILE CONFIGURATION
    const baseUrl = API_BASE;
    const useOfflineTiles = false;

    if (useOfflineTiles) {
      L.tileLayer(`${baseUrl}/api/tiles/{z}/{x}/{y}.png`, {
        attribution: 'Offline Map Data © OpenStreetMap contributors | Tiles: MOBAC',
        maxZoom: 9,
        minZoom: 4,
        errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      }).addTo(map);
    } else {
      try {
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          attribution: 'Tiles &copy; Esri &mdash | Click on a marker to view the detected asset image.',
          maxZoom: 19,
          minZoom: 1,
          crossOrigin: true,
        }).addTo(map);
      } catch (error) {
        console.error('Failed to load tiles:', error);
        L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors, Tiles style by Humanitarian OpenStreetMap Team',
          maxZoom: 19,
        }).addTo(map);
      }
    }

    mapRef.current = map;
    canvasRendererRef.current = L.canvas({ padding: 0.5 });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Fetch assets: get latest survey per route → fetch assets for each survey
  useEffect(() => {
    if (!mapRef.current || roads.length === 0) return;

    (async () => {
      try {
        setLoadingAssets(true);

        // 1. Fetch latest surveys
        const surveysResp = await api.Surveys.list({ latest_only: true });
        const surveys = (surveysResp?.items || []) as any[];

        // Normalize IDs
        const normalizedSurveys = surveys.map((s: any) => ({
          ...s,
          _id: typeof s._id === 'object' && s._id.$oid ? s._id.$oid : String(s._id),
        }));

        // Get latest survey per route
        const latestByRoute: Record<number, any> = {};
        normalizedSurveys.forEach((s: any) => {
          const rid = s.route_id;
          if (!latestByRoute[rid] || new Date(s.survey_date) > new Date(latestByRoute[rid].survey_date)) {
            latestByRoute[rid] = s;
          }
        });

        const latestSurveys = Object.values(latestByRoute);

        // 2. Fetch assets for each latest survey in parallel
        const assetPromises = latestSurveys.map(async (survey: any) => {
          try {
            const resp = await api.assets.list({ survey_id: survey._id });
            return (resp?.items || []).map((a: any) => ({
              ...a,
              _id: typeof a._id === 'object' && a._id.$oid ? a._id.$oid : String(a._id),
            }));
          } catch (err) {
            console.warn(`Failed to fetch assets for survey ${survey._id}:`, err);
            return [];
          }
        });

        const assetArrays = await Promise.all(assetPromises);
        const assets: MapAsset[] = assetArrays.flat();

        console.log(`Loaded ${assets.length} assets from ${latestSurveys.length} latest surveys`);
        setAllAssets(assets);
      } catch (err) {
        console.error("Failed to load assets for map:", err);
      } finally {
        setLoadingAssets(false);
      }
    })();
  }, [roads]);

  // Render markers based on assets and filters
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear existing markers
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    if (allAssets.length === 0) return;

    // Build a road name lookup from route_id
    const roadNameByRouteId: Record<number, string> = {};
    roads.forEach(r => {
      roadNameByRouteId[r.route_id] = r.road_name;
    });

    // Filter assets
    const filtered = allAssets.filter(asset => {
      // Must have a location
      if (!asset.location?.coordinates || asset.location.coordinates.length < 2) return false;

      // Road filter
      if (selectedRoadNames.length > 0) {
        const roadName = roadNameByRouteId[asset.route_id || 0];
        if (!roadName || !selectedRoadNames.includes(roadName)) return false;
      }

      // Asset type / category filter
      if (selectedAssetTypes.length > 0 || selectedCategories.length > 0) {
        const matchesAssetType = selectedAssetTypes.length > 0 && asset.asset_id && selectedAssetTypes.includes(asset.asset_id);
        const matchesCategory = selectedCategories.length > 0 && asset.category_id && selectedCategories.includes(asset.category_id);
        if (!matchesAssetType && !matchesCategory) return false;
      }

      return true;
    });

    if (filtered.length === 0) return;

    // Fit map bounds to filtered assets
    const boundsPoints: L.LatLngTuple[] = filtered.map(a => [
      a.location!.coordinates[1], // lat
      a.location!.coordinates[0], // lng
    ]);
    const bounds = L.latLngBounds(boundsPoints);
    mapRef.current.fitBounds(bounds, { padding: [50, 50] });

    // Condition-based colors
    const getMarkerColor = (condition: string) => {
      switch (condition?.toLowerCase()) {
        case 'good': return '#22c55e';
        case 'damaged': return '#ef4444';
        default: return '#f59e0b';
      }
    };

    // Place markers
    filtered.forEach((asset) => {
      const lat = asset.location!.coordinates[1];
      const lng = asset.location!.coordinates[0];
      const latLng: L.LatLngTuple = [lat, lng];
      const color = getMarkerColor(asset.condition);

      console.log(getAssetIconFromId(asset.asset_id))
      let circleMarker;
      if (isAssetIconExist(asset.asset_id)) {
        circleMarker = L.marker(latLng, {
          icon: getAssetIconFromId(asset.asset_id)
        }).addTo(mapRef.current!);
      } else {
        circleMarker = L.circleMarker(latLng, {
          radius: 5,
          fillColor: color,
          color: '#ffffff',
          weight: 1,
          opacity: 1,
          fillOpacity: 0.85,
          renderer: canvasRendererRef.current || undefined,
        }).addTo(mapRef.current!);
      }



      // const circleMarker = L.circleMarker(latLng, {
      //   radius: 5,
      //   fillColor: color,
      //   color: '#ffffff',
      //   weight: 1,
      //   opacity: 1,
      //   fillOpacity: 0.85,
      //   renderer: canvasRendererRef.current || undefined,
      // }).addTo(mapRef.current!);

      // On click: load frame popup using asset.video_id + asset.frame_number
      circleMarker.on('click', async () => {
        const baseUrl = API_BASE;
        const popupId = `popup-root-${Date.now()}`;

        // Find the road name for this asset
        const roadName = roadNameByRouteId[asset.route_id || 0] || `Route ${asset.route_id}`;

        // Resolve video_id: use video_id from asset, fall back to video_key for demo assets
        const rawVideoId = asset.video_id
          ? (typeof asset.video_id === 'object' && (asset.video_id as any)?.$oid
            ? (asset.video_id as any).$oid
            : asset.video_id)
          : asset.video_key; // Demo assets use video_key instead of video_id
        const videoId = rawVideoId ? String(rawVideoId) : undefined;

        // Open popup with loader
        const popupContainer = L.popup({
          maxWidth: 780,
          minWidth: 750,
          className: 'custom-popup',
        })
          .setLatLng(latLng)
          .setContent(`<div id="${popupId}"></div>`)
          .openOn(mapRef.current!);

        // Render loader
        const popupElement = document.getElementById(popupId);
        if (popupElement) {
          const root = createRoot(popupElement);
          popupRootRef.current = root;
          root.render(<PopupLoader />);
        }

        try {
          console.log('Loading frame popup for asset:', asset);
          if (videoId && asset.frame_number != null) {
            // Check cache
            const cacheKey = asset._id;
            let frameData = frameDataCacheRef.current.get(cacheKey);

            if (!frameData) {
              const rawFrameData = await api.videos.getFrameWithDetections(
                videoId,
                undefined,
                asset.frame_number
              );

              // Build a single detection from the clicked asset's box
              // Asset box is in percentage: { x, y, w/width, h/height }
              // Convert to pixel coords [x1, y1, x2, y2] for FramePopupContent
              const assetDetections: any[] = [];
              if (asset.box && rawFrameData.width && rawFrameData.height) {
                const bw = asset.box.w ?? asset.box.width ?? 0;
                const bh = asset.box.h ?? asset.box.height ?? 0;
                const x1 = asset.box.x
                const y1 = asset.box.y
                const x2 = asset.box.x + bw
                const y2 = asset.box.y + bh

                assetDetections.push({
                  class_name: asset.class_name || asset.asset_type || asset.type || 'Unknown',
                  asset_id: asset.asset_id || '',
                  confidence: asset.confidence ?? 0,
                  box: [x1, y1, x2, y2],
                  location: asset.location,
                });
              }

              frameData = {
                ...rawFrameData,
                detections: assetDetections,
              };

              frameDataCacheRef.current.set(cacheKey, frameData);
            }

            // Render frame popup
            if (popupRootRef.current) {
              popupRootRef.current.render(
                <FramePopupContent
                  frameData={{
                    ...frameData,
                    videoId: videoId,
                    timestamp: (asset.timestamp || 0).toFixed(1),
                    baseUrl,
                    gpxLatitude: lat,
                    gpxLongitude: lng,
                  }}
                  trackTitle={roadName}
                  labelMapData={labelMapData}
                  pointIndex={0}
                  totalPoints={1}
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
          } else {
            // No video_id or frame_number — show basic info
            if (popupRootRef.current) {
              popupRootRef.current.render(
                <div className="p-6 text-center">
                  <div className="font-semibold text-lg mb-2">{roadName}</div>
                  <div className="text-sm text-muted-foreground mb-1">
                    {asset.asset_type || asset.type || asset.asset_id || 'Unknown Asset'}
                  </div>
                  <div className="text-xs text-muted-foreground mb-3">
                    Condition: <span className="font-semibold capitalize">{asset.condition}</span>
                    {asset.confidence != null && ` • Confidence: ${(asset.confidence * 100).toFixed(0)}%`}
                  </div>
                  <div className="text-xs font-mono text-muted-foreground">
                    {lat.toFixed(5)}, {lng.toFixed(5)}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => mapRef.current?.closePopup()}
                  >
                    Close
                  </Button>
                </div>
              );
            }
          }
        } catch (err) {
          console.error('Error loading frame for asset:', err);
          if (popupRootRef.current) {
            popupRootRef.current.render(
              <div className="p-12 text-center">
                <div className="text-destructive font-semibold">Error Loading Frame</div>
                <div className="text-sm text-muted-foreground mt-2">Could not retrieve frame data from server.</div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => mapRef.current?.closePopup()}
                >
                  Close
                </Button>
              </div>
            );
          }
        }
      });

      markersRef.current.push(circleMarker);
    });
  }, [allAssets, selectedRoadNames, selectedAssetTypes, selectedCategories, roads, labelMapData]);

  return (
    <div
      ref={containerRef}
      className="relative"
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 12,
        overflow: "hidden"
      }}
    >
      {loadingAssets && (
        <div className="absolute inset-0 z-[1000] bg-background/60 backdrop-blur-[2px] flex flex-col items-center justify-center">
          <div className="bg-background/90 p-6 rounded-xl shadow-elevated border flex flex-col items-center gap-4 max-w-[280px] text-center">
            <div className="relative w-12 h-12">
              <div className="absolute top-0 left-0 w-full h-full border-4 border-primary/20 rounded-full"></div>
              <div className="absolute top-0 left-0 w-full h-full border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
            </div>
            <div>
              <div className="font-semibold text-primary">Loading Map Data</div>
              <p className="text-xs text-muted-foreground mt-1">Fetching asset locations for visualization</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
