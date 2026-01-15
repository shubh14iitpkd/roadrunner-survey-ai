import { useEffect, useState } from "react";
import { MapPin, CheckCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface GpxMiniMapProps {
  gpxUrl: string;
  className?: string;
  onMapClick?: () => void;
}

export default function GpxMiniMap({ gpxUrl, className = "", onMapClick }: GpxMiniMapProps) {
  const [hasGps, setHasGps] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkGpxData = async () => {
      try {
        setLoading(true);
        
        // Extract filename from URL for fallback
        const urlParts = gpxUrl.split('/');
        const filename = urlParts[urlParts.length - 1];
        
        // Try primary URL first
        let found = false;
        
        try {
          const response = await fetch(gpxUrl);
          if (response.ok) {
            const gpxText = await response.text();
            // Check if we got valid GPX with track points
            if ((gpxText.includes("<gpx") || gpxText.includes("<trkpt")) && gpxText.includes("lat=")) {
              found = true;
            }
          }
        } catch (primaryErr) {
          console.warn("Primary GPX fetch failed, trying fallback:", primaryErr);
        }
        
        // If primary failed, try local demo files
        if (!found) {
          const localPaths = [
            `/demo-data/gpx/${filename}`,
            `/demo-data/gpx/2025_0817_115147_F.gpx`,
          ];
          
          for (const localPath of localPaths) {
            try {
              const localResponse = await fetch(localPath);
              if (localResponse.ok) {
                const gpxText = await localResponse.text();
                if ((gpxText.includes("<gpx") || gpxText.includes("<trkpt")) && gpxText.includes("lat=")) {
                  found = true;
                  break;
                }
              }
            } catch {
              // Continue to next fallback
            }
          }
        }
        
        setHasGps(found);
      } catch (err) {
        console.error("Error checking GPX:", err);
        setHasGps(false);
      } finally {
        setLoading(false);
      }
    };

    if (gpxUrl) {
      checkGpxData();
    } else {
      setHasGps(false);
      setLoading(false);
    }
  }, [gpxUrl]);

  if (loading) {
    return (
      <Badge variant="outline" className={`text-xs ${className}`}>
        <div className="animate-pulse">Checking...</div>
      </Badge>
    );
  }

  if (hasGps) {
    return (
      <Badge 
        variant="outline" 
        className={`bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800 cursor-pointer hover:bg-green-100 ${className}`}
        onClick={onMapClick}
      >
        <CheckCircle className="h-3 w-3 mr-1" />
        GPS Found
      </Badge>
    );
  }

  return (
    <Badge 
      variant="outline" 
      className={`bg-muted/50 text-muted-foreground ${className}`}
    >
      <MapPin className="h-3 w-3 mr-1" />
      No GPS
    </Badge>
  );
}
