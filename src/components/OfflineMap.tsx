import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons in Leaflet with Vite
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

interface Marker {
  id: string;
  lat: number;
  lng: number;
  title?: string;
  description?: string;
}

interface OfflineMapProps {
  center?: [number, number];
  zoom?: number;
  markers?: Marker[];
  onMarkerClick?: (marker: Marker) => void;
  onMapClick?: (lat: number, lng: number) => void;
  style?: React.CSSProperties;
  offlineTilesPath?: string; // Path to offline tiles
}

const OfflineMap: React.FC<OfflineMapProps> = ({
  center = [28.6139, 77.2090], // Default: New Delhi
  zoom = 13,
  markers = [],
  onMarkerClick,
  onMapClick,
  style = { height: '500px', width: '100%' },
  offlineTilesPath,
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // Create map instance
    const map = L.map(mapRef.current).setView(center, zoom);

    // Add tile layer - using offline tiles or OSM as fallback
    if (offlineTilesPath) {
      // Offline tiles (you need to download tiles and place them in public folder)
      L.tileLayer(offlineTilesPath, {
        attribution: 'Offline Map Data © OpenStreetMap contributors',
        maxZoom: 15,
        minZoom: 8,
      }).addTo(map);
    } else {
      // Check if offline tiles are available in default location
      const defaultOfflinePath = '/tiles/{z}/{x}/{y}.png';
      const useOfflineTiles = false; // Set to true when tiles are downloaded

      if (useOfflineTiles) {
        // Use local offline tiles
        L.tileLayer(defaultOfflinePath, {
          attribution: 'Offline Map Data © OpenStreetMap contributors',
          maxZoom: 15,
          minZoom: 8,
        }).addTo(map);
      } else {
        // Online Esri World Imagery (Satellite) tiles (requires internet)
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
          maxZoom: 19,
        }).addTo(map);
      }
    }

    // Create markers layer
    const markersLayer = L.layerGroup().addTo(map);
    markersLayerRef.current = markersLayer;

    // Add map click handler
    if (onMapClick) {
      map.on('click', (e: L.LeafletMouseEvent) => {
        onMapClick(e.latlng.lat, e.latlng.lng);
      });
    }

    mapInstanceRef.current = map;
    setIsMapReady(true);

    // Cleanup
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [center, zoom, offlineTilesPath, onMapClick]);

  // Update markers
  useEffect(() => {
    if (!isMapReady || !markersLayerRef.current) return;

    // Clear existing markers
    markersLayerRef.current.clearLayers();

    // Add new markers
    markers.forEach((marker) => {
      const leafletMarker = L.marker([marker.lat, marker.lng], {
        title: marker.title,
      });

      // Add popup if title or description exists
      if (marker.title || marker.description) {
        const popupContent = `
          ${marker.title ? `<strong>${marker.title}</strong>` : ''}
          ${marker.description ? `<p>${marker.description}</p>` : ''}
        `;
        leafletMarker.bindPopup(popupContent);
      }

      // Add click handler
      if (onMarkerClick) {
        leafletMarker.on('click', () => {
          onMarkerClick(marker);
        });
      }

      leafletMarker.addTo(markersLayerRef.current!);
    });
  }, [markers, isMapReady, onMarkerClick]);

  return (
    <div className="relative">
      <div ref={mapRef} style={style} className="rounded-lg border" />
    </div>
  );
};

export default OfflineMap;
