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

interface Detection {
  class_name: string;
  confidence: number;
  // Box can be array format: [x1, y1, x2, y2]
  box?: number[];
  // Or bbox can be object format: { x1, y1, x2, y2 }
  bbox?: { x1: number; y1: number; x2: number; y2: number };
  // Or coordinates object
  coordinates?: { x1: number; y1: number; x2: number; y2: number };
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
  };
  trackTitle: string;
  pointIndex: number;
  totalPoints: number;
  onClose: () => void;
}
function normalizeClassName(input) {
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
  onClose,
}: FramePopupContentProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [colorMap, setColorMap] = useState<Record<string, string>>({});

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
    console.log(frameData.detections)
    // Draw all detections
    frameData.detections.forEach((d) => {
      console.log(frameData.frame_number)
      const isSelected = selectedClass === null || selectedClass === d.class_name;
      const alpha = isSelected ? 1 : 0;

      // Get normalized bounding box (handles both array and object formats)
      const box = getBoundingBox(d);
      if (!box) {
        console.warn('Detection has no valid bounding box:', d);
        return; // Skip detections without valid bounding boxes
      }

      // Scale coordinates to canvas size
      const x = box[0] * (canvas.width / frameData.width);
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
        // const label = `${normalizeClassName(d.class_name)} (${(d.confidence * 100).toFixed(0)}%)`;
        const label = `${normalizeClassName(d.class_name)}`;
        const textMetrics = ctx.measureText(label);
        ctx.fillRect(x, y - 20, textMetrics.width + 12, 20);

        // Draw label text
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px Arial';
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
  const classCount = frameData.detections?.reduce(
    (acc, d) => ({
      ...acc,
      [d.class_name]: (acc[d.class_name] || 0) + 1,
    }),
    {} as Record<string, number>
  );

  return (
    <div className="w-full text-[13px]">
      {/* Header */}
      <div className="mb-3">
        <div className="font-semibold text-sm mb-1 text-foreground">
          {trackTitle}
        </div>
        <div className="text-[11px] text-muted-foreground">
          Point {pointIndex + 1} of {totalPoints} | {frameData.timestamp}s
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-2 mb-2.5 items-center">
        <Button
          size="sm"
          className='rounded-full'
          variant={showLabels ? 'default' : 'secondary'}
          onClick={() => setShowLabels(!showLabels)}
        >
          {showLabels ? 'Hide' : 'Show'} Labels
        </Button>

        <Select
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
            {uniqueClasses.map((className) => (
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
                    {normalizeClassName(className)} ({classCount?.[className] || 0})
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Image Container */}
      <div className="flex gap-2.5 justify-center">
        <div>
          <img
            //   ref={imgRef}
            src={frameData.image_data}
            alt="Road frame"
            className='w-[380px] h-auto block rounded-sm'
          />
        </div>
        <div className="relative w-[380px] mb-2.5">
          <img
            ref={imgRef}
            src={frameData.image_data}
            alt="Road frame"
            className='w-[380px] h-auto block rounded-sm'
          />
          <canvas
            ref={canvasRef}
            className="absolute top-0 left-0 w-full h-full rounded cursor-pointer"
          />
          <div className="absolute top-1 right-1 z-[999] bg-blue-500/90 text-white px-2 py-1 rounded text-[10px] font-semibold">
            AI Detected
          </div>
        </div>
      </div>

      {/* Detection Summary */}
      {/* {frameData.detections && frameData.detections.length > 0 && (
        <div
          style={{
            background: '#f9fafb',
            padding: '8px',
            borderRadius: '4px',
            fontSize: '11px',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: '6px' }}>Detections:</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
            {uniqueClasses.map((className) => (
              <div key={className} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '2px',
                    backgroundColor: colorMap[className],
                  }}
                />
                <span>
                  {className}: <strong>{classCount?.[className] || 0}</strong>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {frameData.detections?.length === 0 && (
        <div style={{ textAlign: 'center', color: '#999', padding: '16px' }}>
          No detections found in this frame
        </div>
      )} */}
    </div>
  );
}