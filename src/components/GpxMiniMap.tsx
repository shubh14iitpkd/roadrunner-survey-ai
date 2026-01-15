import { useEffect, useState, useRef } from "react";
import { MapPin, Navigation } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface GpxPoint {
  lat: number;
  lon: number;
}

interface GpxMiniMapProps {
  gpxUrl: string;
  className?: string;
  onMapClick?: () => void;
}

export default function GpxMiniMap({ gpxUrl, className = "", onMapClick }: GpxMiniMapProps) {
  const [points, setPoints] = useState<GpxPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const fetchAndParseGpx = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(gpxUrl);
        if (!response.ok) {
          throw new Error("Failed to load GPX file");
        }
        
        const gpxText = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(gpxText, "text/xml");
        
        const trkpts = xmlDoc.getElementsByTagName("trkpt");
        const parsedPoints: GpxPoint[] = [];
        
        for (let i = 0; i < trkpts.length; i++) {
          const lat = parseFloat(trkpts[i].getAttribute("lat") || "0");
          const lon = parseFloat(trkpts[i].getAttribute("lon") || "0");
          if (lat && lon) {
            parsedPoints.push({ lat, lon });
          }
        }
        
        setPoints(parsedPoints);
      } catch (err) {
        console.error("Error parsing GPX:", err);
        setError("Failed to load route");
      } finally {
        setLoading(false);
      }
    };

    if (gpxUrl) {
      fetchAndParseGpx();
    }
  }, [gpxUrl]);

  if (loading) {
    return (
      <div className={`flex items-center justify-center bg-muted/50 rounded-lg ${className}`}>
        <div className="animate-pulse text-muted-foreground text-xs">Loading route...</div>
      </div>
    );
  }

  if (error || points.length === 0) {
    return (
      <div className={`flex items-center justify-center bg-muted/30 rounded-lg ${className}`}>
        <div className="text-muted-foreground text-xs flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          No GPS data
        </div>
      </div>
    );
  }

  // Calculate bounds
  const lats = points.map(p => p.lat);
  const lons = points.map(p => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  
  // Add padding
  const latPadding = (maxLat - minLat) * 0.15 || 0.001;
  const lonPadding = (maxLon - minLon) * 0.15 || 0.001;
  
  const viewMinLat = minLat - latPadding;
  const viewMaxLat = maxLat + latPadding;
  const viewMinLon = minLon - lonPadding;
  const viewMaxLon = maxLon + lonPadding;
  
  // Convert to SVG coordinates (flip Y because SVG y increases downward)
  const toSvgCoords = (point: GpxPoint): { x: number; y: number } => {
    const x = ((point.lon - viewMinLon) / (viewMaxLon - viewMinLon)) * 100;
    const y = (1 - (point.lat - viewMinLat) / (viewMaxLat - viewMinLat)) * 100;
    return { x, y };
  };

  // Create path
  const pathPoints = points.map(p => toSvgCoords(p));
  const pathD = pathPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  
  const startPoint = toSvgCoords(points[0]);
  const endPoint = toSvgCoords(points[points.length - 1]);

  return (
    <div 
      className={`relative bg-gradient-to-br from-blue-50 to-teal-50 dark:from-blue-950/30 dark:to-teal-950/30 rounded-lg overflow-hidden border border-blue-200 dark:border-blue-800 cursor-pointer hover:ring-2 hover:ring-primary transition-all ${className}`}
      onClick={onMapClick}
    >
      {/* SVG Map */}
      <svg 
        ref={svgRef}
        viewBox="0 0 100 100" 
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Background grid */}
        <defs>
          <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5"/>
          </pattern>
        </defs>
        <rect width="100" height="100" fill="url(#grid)" className="text-blue-500" />
        
        {/* Route path */}
        <path 
          d={pathD} 
          fill="none" 
          stroke="url(#routeGradient)" 
          strokeWidth="3" 
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        {/* Gradient for route */}
        <defs>
          <linearGradient id="routeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
        </defs>
        
        {/* Start point marker (green) */}
        <circle 
          cx={startPoint.x} 
          cy={startPoint.y} 
          r="5" 
          fill="#22c55e" 
          stroke="white" 
          strokeWidth="2"
        />
        <circle 
          cx={startPoint.x} 
          cy={startPoint.y} 
          r="2" 
          fill="white"
        />
        
        {/* End point marker (blue) */}
        <circle 
          cx={endPoint.x} 
          cy={endPoint.y} 
          r="5" 
          fill="#3b82f6" 
          stroke="white" 
          strokeWidth="2"
        />
        <circle 
          cx={endPoint.x} 
          cy={endPoint.y} 
          r="2" 
          fill="white"
        />
      </svg>
      
      {/* Legend */}
      <div className="absolute bottom-1 left-1 right-1 flex justify-between text-[9px]">
        <Badge variant="outline" className="bg-white/80 dark:bg-black/50 px-1 py-0 gap-0.5 text-[9px]">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
          Start
        </Badge>
        <Badge variant="outline" className="bg-white/80 dark:bg-black/50 px-1 py-0 gap-0.5 text-[9px]">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          End
        </Badge>
      </div>
      
      {/* Click hint */}
      <div className="absolute top-1 right-1">
        <Badge variant="secondary" className="bg-white/80 dark:bg-black/50 px-1 py-0 gap-0.5 text-[8px]">
          <Navigation className="h-2 w-2" />
          View
        </Badge>
      </div>
    </div>
  );
}
