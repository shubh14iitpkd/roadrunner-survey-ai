import { useState, useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface Detection {
  class_name: string;
  confidence: number;
  bbox: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
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

    // Draw all detections
    frameData.detections.forEach((d) => {
      const isSelected = selectedClass === null || selectedClass === d.class_name;
      const alpha = isSelected ? 1 : 0;

      // Scale coordinates to canvas size
      const x = d.bbox.x1 * (canvas.width / frameData.width);
      const y = d.bbox.y1 * (canvas.height / frameData.height);
      const w = (d.bbox.x2 - d.bbox.x1) * (canvas.width / frameData.width);
      const h = (d.bbox.y2 - d.bbox.y1) * (canvas.height / frameData.height);

      const color = colorMap[d.class_name] || '#ffffff';

      // Draw bounding box
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      // Draw label background
      if (showLabels) {
        ctx.fillStyle = color;
        const label = `${d.class_name} (${(d.confidence * 100).toFixed(0)}%)`;
        const textMetrics = ctx.measureText(label);
        ctx.fillRect(x, y - 20, textMetrics.width + 6, 20);

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
    <div style={{ width: '100%', fontSize: '13px' }}>
      {/* Header */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
          {trackTitle}
        </div>
        <div style={{ fontSize: '11px', color: '#666' }}>
          Point {pointIndex + 1} of {totalPoints} | {frameData.timestamp}s
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <Button
          size="sm"
          className='rounded-full'
          variant={showLabels ? 'default' : 'secondary'}
          onClick={() => setShowLabels(!showLabels)}
        >
          {showLabels ? 'Hide' : 'Show'} Labels
        </Button>
        <Button
          size="sm"
          className='rounded-full ghost:text-white'
          variant={selectedClass === null ? 'default' : 'secondary'}
          onClick={() => setSelectedClass(null)}
        >
          Show All ({frameData.detections?.length || 0})
        </Button>
      </div>

      {/* Class Filter Buttons */}
      {uniqueClasses.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
          {uniqueClasses.map((detectedClassName) => (
            <Button
              key={detectedClassName}
              size="sm"
              className='rounded-full'
              variant={selectedClass === detectedClassName ? 'default' : 'outline'}
              onClick={() => setSelectedClass(selectedClass === detectedClassName ? null : detectedClassName)}
              style={{
                borderColor: colorMap[detectedClassName],
                backgroundColor: selectedClass === detectedClassName ? colorMap[detectedClassName] : 'transparent',
                color: selectedClass === detectedClassName ? '#ffffff' : colorMap[detectedClassName],
              }}
            >
              {detectedClassName} ({classCount?.[detectedClassName] || 0})
            </Button>
          ))}
        </div>
      )}

      {/* Image Container */}
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
        <div>
          <img
            //   ref={imgRef}
            src={frameData.image_data}
            alt="Road frame"
            className='w-[380px] h-auto block rounded-sm'
          />
        </div>
        <div style={{ position: 'relative', width: '380px', marginBottom: '10px' }}>
          <img
            ref={imgRef}
            src={frameData.image_data}
            alt="Road frame"
            className='w-[380px] h-auto block rounded-sm'
          />
          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: '4px',
              zIndex: 999,
              right: '4px',
              background: 'rgba(59, 130, 246, 0.9)',
              color: 'white',
              padding: '4px 8px',
              borderRadius: '3px',
              fontSize: '10px',
              fontWeight: 600,
            }}
          >
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