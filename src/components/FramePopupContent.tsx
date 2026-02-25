import { useState, useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ResolvedMap, useLabelMap } from '@/contexts/LabelMapContext';
import { MapPin, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from "@/hooks/use-toast";
import { getCategoryBadgeStyle, getCategoryDotColor } from "./CategoryBadge";

interface Detection {
  class_name: string;
  asset_id: string;
  zone: string | undefined;
  side: string | undefined;
  confidence: number;
  // Box can be array format: [x1, y1, x2, y2]
  box?: number[];
  // Or bbox can be object format: { x1, y1, x2, y2 }
  bbox?: { x1: number; y1: number; x2: number; y2: number };
  // Or coordinates object
  coordinates?: { x1: number; y1: number; x2: number; y2: number };
  location?: {
    type: 'Point',
    coordinates: [number, number]
  },
}

// Helper function to normalize bounding box to [x1, y1, x2, y2] format
function getBoundingBox(detection: Detection): [number, number, number, number] | null {
  // Handle array format: box: [x1, y1, x2, y2]
  if (detection.box && Array.isArray(detection.box) && detection.box.length >= 4) {
    return [detection.box[0], detection.box[1], detection.box[2], detection.box[3]];
  }

  // Handle object format: bbox: { x1, y1, x2, y2 }
  if (detection.bbox && typeof detection.bbox === 'object') {
    return [detection.bbox.x1, detection.bbox.y1, detection.bbox.x2, detection.bbox.y2];
  }

  // Handle coordinates format
  if (detection.coordinates && typeof detection.coordinates === 'object') {
    return [detection.coordinates.x1, detection.coordinates.y1, detection.coordinates.x2, detection.coordinates.y2];
  }

  return null;
}

interface FramePopupContentProps {
  frameData: {
    image_data: string;
    detections: Detection[];
    width: number;
    height: number;
    frame_number: number;
    videoId: string;
    timestamp: string;
    baseUrl: string;
    // GPX point data
    gpxLatitude?: number;
    gpxLongitude?: number;
    gpxTimestamp?: string;
  };
  trackTitle: string;
  pointIndex: number;
  labelMapData: ResolvedMap;
  totalPoints: number;
  onClose: () => void;
}

// Fallback function to normalize class names if context data is not available
function normalizeClassName(input: string): string {
  if (typeof input !== "string") return "";

  // Remove AssetCondition and anything after it
  const namePart = input.split("_AssetCondition_")[0];

  return namePart
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
export default function FramePopupContent({
  frameData,
  trackTitle,
  pointIndex,
  totalPoints,
  labelMapData,
  onClose,
}: FramePopupContentProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const { toast } = useToast();
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [colorMap, setColorMap] = useState<Record<string, string>>({});
  const [isDownloading, setIsDownloading] = useState(0);
  const idRef = useRef<string>(crypto.randomUUID());


  // Helper function to get display name from context or fallback to normalized name
  const getDisplayName = (assetId: string, className: string): string => {
    // Try to get custom display name from context
    if (labelMapData?.labels?.[assetId]) {
      return labelMapData.labels[assetId].display_name;
    }
    // Fallback to normalized class name
    return normalizeClassName(className);
  };

  // Generate consistent colors for each class
  useEffect(() => {
    const colors: Record<string, string> = {};
    frameData.detections?.forEach((d) => {
      if (!colors[d.class_name]) {
        const hue = Math.floor(Math.random() * 360);
        colors[d.class_name] = `hsl(${hue}, 90%, 30%)`;
      }
    });
    setColorMap(colors);
  }, [frameData.detections]);

  // Draw detections on canvas
  useEffect(() => {
    if (!canvasRef.current || !imgRef.current || !frameData.detections?.length) return;
    
    const canvas = canvasRef.current;
    const img = imgRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = img.clientWidth;
    canvas.height = img.clientHeight;
    // console.log(frameData.detections)
    // Draw all detections
    frameData.detections.forEach((d) => {
      // console.log(frameData.frame_number)
      const isSelected = selectedClass === null || selectedClass === d.class_name;
      const alpha = isSelected ? 1 : 0;

      // Get normalized bounding box (handles both array and object formats)
      const box = getBoundingBox(d);
      if (!box) {
        console.warn('Detection has no valid bounding box:', d);
        return; // Skip detections without valid bounding boxes
      }

      // Scale coordinates to canvas size
      const x = (box[0] * (canvas.width / frameData.width));
      const y = box[1] * (canvas.height / frameData.height);
      const w = (box[2] - box[0]) * (canvas.width / frameData.width);
      const h = (box[3] - box[1]) * (canvas.height / frameData.height);

      const color = colorMap[d.class_name] || '#ffffff';

      // Draw bounding box
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      // Draw label background
      if (showLabels) {
        ctx.fillStyle = color;
        const label = getDisplayName(d.asset_id, d.class_name);
        const textMetrics = ctx.measureText(label);
        ctx.fillRect(x, y - 20, textMetrics.width + 12, 20);

        // Draw label text
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px Arial';
        // ctx.globalAlpha = 1;
        ctx.fillText(label, x + 3, y - 6);
      }
    });

    ctx.globalAlpha = 1;
  }, [frameData, selectedClass, showLabels, colorMap]);

  // Get unique classes
  const uniqueClasses = Array.from(
    new Set(frameData.detections?.map((d) => d.class_name) || [])
  );

  // Count detections per class

  const handleDownload = async (draw: boolean = false) => {
    if (!frameData || !frameData.image_data) return;
    if (isDownloading!=0) return;

    setIsDownloading(draw ? 2 : 1);
    toast({
      title: "Preparing Download",
      description: "Fetching high-resolution image and generating annotations...",
    });

    let imageToUse = frameData.image_data;
    let widthToUse = frameData.width;
    let heightToUse = frameData.height;

    // If drawing annotations, try to fetch high-res image first
    try {
      const response = await api.videos.getFrameWithDetections(
        frameData.videoId, 
        undefined, 
        frameData.frame_number, 
        undefined, 
        false // resize=false for high res
      );
      if (response && response.image_data) {
        imageToUse = response.image_data;
        // Use dimensions from response if available, though they should match
        if (response.width) widthToUse = response.width;
        if (response.height) heightToUse = response.height;
      }
    } catch (e) {
      console.error("Failed to fetch high-res frame, falling back to current image", e);
      toast({
        variant: "destructive",
        title: "High-Res Fetch Failed",
        description: "Falling back to standard resolution image.",
      });
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imageToUse;

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = widthToUse;
      canvas.height = heightToUse;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
          setIsDownloading(0);
          return;
      }

      // Draw the original image
      ctx.drawImage(img, 0, 0, widthToUse, heightToUse);

      // Draw detections
      if (frameData.detections && draw) {
        frameData.detections.forEach((d) => {
          // Respect filter
          if (selectedClass && d.class_name !== selectedClass) return;

          const box = getBoundingBox(d);
          if (!box) return;

          // Scale for full resolution
          // Base scale on image width, e.g., 1920px -> line width 4-5px, font 24px
          const scale = Math.max(1, widthToUse / 1000); 
          const lineWidth = 3 * scale;
          const fontSize = 14 * scale;
          const padding = 4 * scale;

          const color = colorMap[d.class_name] || '#ffffff';

          ctx.strokeStyle = color;
          ctx.lineWidth = lineWidth;
          
          const x = box[0];
          const y = box[1];
          const w = box[2] - box[0];
          const h = box[3] - box[1];

          // Draw box
          ctx.strokeRect(x, y, w, h);

          if (showLabels) {
            const label = getDisplayName(d.asset_id, d.class_name);
            
            ctx.font = `bold ${fontSize}px Arial`;
            const textMetrics = ctx.measureText(label);
            
            // Draw label background
            ctx.fillStyle = color;
            ctx.fillRect(
              x, 
              y - fontSize - padding * 2, 
              textMetrics.width + padding * 2, 
              fontSize + padding * 2
            );

            // Draw label text
            ctx.fillStyle = '#ffffff';
            ctx.fillText(label, x + padding, y - padding);
          }
        });
      }

      // Trigger download
      try {
        const dataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `frame-${idRef.current}${draw ? "_annotated": ""}.png`;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast({
          title: "Download Complete",
          description: "The image has been saved to your downloads.",
        });
      } catch (err) {
        console.error('Error creating download link:', err);
         toast({
          variant: "destructive",
          title: "Download Failed",
          description: "Could not create download link.",
        });
      } finally {
        setIsDownloading(0);
      }
    };

    img.onerror = (err) => {
      console.error('Failed to load image for download:', err);
       toast({
        variant: "destructive",
        title: "Download Failed",
        description: "Failed to load image data.",
      });
      setIsDownloading(0);
    };
  };


  return (
    <div className="w-full text-[13px]">
      {/* Header */}
      <div className="mb-3">
        <div className="font-semibold text-sm mb-1 text-foreground">
          {trackTitle}
        </div>
        <div className="text-[11px] text-muted-foreground">
          Click on an image to download.
          {frameData.detections.map((d) => (
            <div key={d.asset_id}>
              {d.side} - {d.zone}
            </div>
          ))}
        </div>
        {/* GPX Location Info */}
      </div>

      {/* Controls */}
      <div className="flex gap-2 mb-2.5 items-center">
        <Button
          size="sm"
          className='rounded-full'
          variant={showLabels ? 'default' : 'secondary'}
          onClick={() => setShowLabels(!showLabels)}
        >
          {showLabels ? 'Hide' : 'Show'} Label
        </Button>

        {/* <Select
          value={selectedClass || "all"}
          onValueChange={(value) => setSelectedClass(value === "all" ? null : value)}
        >
          <SelectTrigger className="w-[200px] h-9 rounded-full outline-none focus:outline-none focus:ring-0 focus:ring-offset-0 bg-background [&>span]:flex [&>span]:items-center [&>span]:justify-center [&>span]:text-center [&>span_div]:w-full [&>span_div]:justify-center [&>span_div_span]:truncate [&>span_div_span]:block [&>span_div_span]:max-w-[130px]">
            <SelectValue placeholder="Filter by class" />
          </SelectTrigger>
          <SelectContent className="z-[10000]">
            <SelectItem value="all">
              <div className="flex items-center gap-2">
                <div
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    flexShrink: 0,
                  }}
                  className="bg-gray-400"
                />
                All ({frameData.detections?.length || 0})
              </div>
            </SelectItem>
            {uniqueClasses.map((className) => {
              // Find the first detection with this class name to get the asset_id
              const detection = frameData.detections?.find(d => d.class_name === className);
              const displayName = detection ? getDisplayName(detection.asset_id, className) : normalizeClassName(className);
              
              return (
                <SelectItem key={className} value={className}>
                  <div className="flex items-center gap-2">
                    <div
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: colorMap[className],
                        flexShrink: 0,
                      }}
                    />
                    <span>
                      {displayName} ({classCount?.[className] || 0})
                    </span>
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select> */}
      </div>

      {/* Image Container */}
      <div className="flex gap-2.5 justify-center">
        <div className="relative">
          {isDownloading==1 && (
            <div className="absolute inset-0 z-[1000] bg-background/50 backdrop-blur-[1px] flex flex-col items-center justify-center rounded-sm">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
               <span className="text-xs font-medium mt-2 text-foreground bg-background/80 px-2 py-1 rounded">Downloading...</span>
            </div>
          )}
          <img
            //   ref={imgRef}
            src={frameData.image_data}
            alt="Road frame"
            onClick={() => handleDownload(false)}
            className={`w-[380px] h-auto block rounded-sm cursor-pointer ${isDownloading!=0 ? 'pointer-events-none' : ''}`}
          />
        </div>
        <div className="relative w-[380px] mb-2.5">
          {isDownloading==2 && (
            <div className="absolute inset-0 z-[1000] bg-background/50 backdrop-blur-[1px] flex flex-col items-center justify-center rounded-sm">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-xs font-medium mt-2 text-foreground bg-background/80 px-2 py-1 rounded">Downloading...</span>
            </div>
          )}
          <img
            ref={imgRef}
            src={frameData.image_data}
            alt="Road frame"
            className={`w-[380px] h-auto block rounded-sm ${isDownloading!=0 ? 'pointer-events-none' : ''}`}
          />
          <canvas
            ref={canvasRef}
            onClick={() => handleDownload(true)}
            className="absolute top-0 left-0 w-full h-full rounded cursor-pointer"
          />
          <div className="absolute top-1 right-1 z-[999] bg-blue-500/90 text-white px-2 py-1 rounded text-[10px] font-semibold">
            AI Detected
          </div>
        </div>
      </div>

      {/* Detection Summary */}
      {frameData.detections && frameData.detections.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <div className="font-semibold text-xs mb-2 flex items-center justify-between">
            <span>Detections ({frameData.detections.length})</span>
          </div>
          <div className="space-y-2 max-h-[150px] overflow-y-auto pr-1 custom-scrollbar">
            {frameData.detections.map((d, i) => {
              const displayName = getDisplayName(d.asset_id, d.class_name);
              const color = colorMap[d.class_name] || '#888';
              const hasLocation = d.location?.coordinates &&
                Array.isArray(d.location.coordinates) &&
                d.location.coordinates.length === 2;
              return (
                <div
                  key={`${d.asset_id}-${i}`}
                  className="bg-secondary/30 rounded p-2 text-xs border border-transparent dark:bg-secondary/40 hover:border-border transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="font-medium text-xs truncate max-w-[200px]" title={displayName}>
                        {displayName}
                      </span>
                    </div>
                    {/* {typeof d.confidence === 'number' && (
                      <Badge variant="secondary" className="h-4 px-1 text-xs font-normal">
                        {Math.round(d.confidence * 100)}%
                      </Badge>
                    )} */}
                  </div>

                  {hasLocation ? (
                    <div className="pl-4 text-xs flex items-center gap-1">
                      <MapPin className='w-3' />
                      <span className="font-mono">
                        {/* GeoJSON is [lon, lat], display as Lat, Lon */}
                        {d.location!.coordinates[1].toFixed(4)}, {d.location!.coordinates[0].toFixed(4)}
                      </span>
                    </div>
                  ) : (
                    <div className="pl-4 text-xs italic">
                      Location unavailable
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}