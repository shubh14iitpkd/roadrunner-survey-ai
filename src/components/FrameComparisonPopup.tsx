import { useState, useEffect, useRef, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ANNOTATION_CATEGORIES } from '@/services/demoDataService';
import { Layers, Eye, EyeOff, ZoomIn, ZoomOut } from 'lucide-react';
import { getCategoryColorCode } from '@/components/CategoryBadge';

interface Detection {
  class_name: string;
  confidence: number;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  condition?: string;
  category?: string;
  category_id?: string;
}

interface FrameComparisonPopupProps {
  frameData: {
    raw_image_url?: string;
    ai_image_url?: string;
    image_data?: string;
    detections: Detection[];
    width: number;
    height: number;
    frame_number: number;
    timestamp: string;
    videoId: string;
    baseUrl: string;
    is_demo?: boolean;
    gpx_point?: { lat: number; lon: number };
  };
  trackTitle: string;
  pointIndex: number;
  totalPoints: number;
  onClose: () => void;
  onNavigate?: (direction: 'prev' | 'next') => void;
}

export default function FrameComparisonPopup({
  frameData,
  trackTitle,
  pointIndex,
  totalPoints,
  onClose,
  onNavigate,
}: FrameComparisonPopupProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [activeTab, setActiveTab] = useState<'comparison' | 'detections'>('comparison');
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set(Object.values(ANNOTATION_CATEGORIES)));
  const [showLabels, setShowLabels] = useState(true);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [zoom, setZoom] = useState(1);

  // Draw bounding boxes on canvas
  useEffect(() => {
    if (!canvasRef.current || !imgRef.current || !imageLoaded) return;

    const canvas = canvasRef.current;
    const img = imgRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Match canvas size to displayed image size
    canvas.width = img.clientWidth;
    canvas.height = img.clientHeight;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Draw bounding boxes for visible categories
    frameData.detections?.forEach((d) => {
      const color = getCategoryColorCode(d.category_id || 'Other');
      // Scale bbox coordinates to canvas size
      // bbox values are in percentage (0-100)
      const x = d.bbox.x * canvas.width / frameData.width;
      const y = d.bbox.y * canvas.height / frameData.height;
      const w = d.bbox.width * canvas.width / frameData.width;
      const h = d.bbox.height * canvas.height / frameData.height;

      // Draw bounding box
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      // Draw semi-transparent fill
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.1;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;

      // Draw label
      if (showLabels) {
        const label = `${d.class_name} ${(d.confidence * 100).toFixed(0)}%`;
        ctx.font = 'bold 10px Arial';
        const textMetrics = ctx.measureText(label);
        
        // Label background
        ctx.fillStyle = color;
        ctx.fillRect(x, y - 16, textMetrics.width + 8, 16);
        
        // Label text
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, x + 4, y - 4);
      }
    });
  }, [frameData.detections, selectedCategories, showLabels, imageLoaded, zoom]);

  // Count total visible detections
  const visibleDetections = frameData.detections?.filter(d => 
    selectedCategories.has(d.category || 'Other')
  ).length || 0;

  // Determine image source
  const imageUrl = frameData.image_data || frameData.ai_image_url || frameData.raw_image_url;

  return (
    <div className="p-2" style={{ width: '100%', fontSize: '13px' }}>
      {/* Header */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'flex-start',
        marginBottom: '12px',
        paddingBottom: '8px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
      }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
            {trackTitle}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            Point {pointIndex + 1} of {totalPoints} • Frame #{frameData.frame_number} • {frameData.timestamp}s
          </div>
          {frameData.gpx_point && (
            <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>
             {frameData.gpx_point.lat.toFixed(5)}, {frameData.gpx_point.lon.toFixed(5)}
            </div>
          )}
        </div>
        
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {onNavigate && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onNavigate('prev')}
                disabled={pointIndex === 0}
                className="h-7 px-2"
              >
                ←
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onNavigate('next')}
                disabled={pointIndex >= totalPoints - 1}
                className="h-7 px-2"
              >
                →
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          <Button
            size="sm"
            variant={showLabels ? 'default' : 'secondary'}
            onClick={() => setShowLabels(!showLabels)}
            className="h-7"
          >
            {showLabels ? <Eye className="h-3 w-3 mr-1" /> : <EyeOff className="h-3 w-3 mr-1" />}
            Labels
          </Button>
        </div>
      </div>

      {/* Frame Comparison View */}
      <Tabs value={activeTab} className='w-full' onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList className="mb-3">
          <TabsTrigger value="comparison">Side by Side</TabsTrigger>
          <TabsTrigger value="detections">AI Analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="comparison">
          <div style={{ display: 'flex', gap: '10px' }}>
            {/* Raw Frame */}
            <div style={{ flex: 1 }}>
              <div style={{ 
                fontSize: '10px', 
                fontWeight: 600, 
                marginBottom: '4px',
                color: '#94a3b8',
                textTransform: 'uppercase',
              }}>
                Raw Frame
              </div>
              <div style={{ 
                background: '#0f172a', 
                borderRadius: '6px', 
                overflow: 'hidden',
                aspectRatio: '16/9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt="Raw frame"
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                ) : (
                  <div style={{ color: '#64748b', fontSize: '12px' }}>
                    Frame not available
                  </div>
                )}
              </div>
            </div>

            {/* AI Analyzed Frame */}
            <div style={{ flex: 1 }}>
              <div style={{ 
                fontSize: '10px', 
                fontWeight: 600, 
                marginBottom: '4px',
                color: '#3b82f6',
                textTransform: 'uppercase',
              }}>
                AI Analyzed
              </div>
              <div style={{ 
                position: 'relative',
                background: '#0f172a', 
                borderRadius: '6px', 
                overflow: 'hidden',
                aspectRatio: '16/9',
              }}>
                {imageUrl ? (
                  <>
                    <img
                      ref={imgRef}
                      src={imageUrl}
                      alt="AI analyzed frame"
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      onLoad={() => setImageLoaded(true)}
                    />
                    <canvas
                      ref={canvasRef}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        pointerEvents: 'none',
                      }}
                    />
                  </>
                ) : (
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    height: '100%',
                    color: '#64748b', 
                    fontSize: '12px',
                  }}>
                    Frame not available
                  </div>
                )}
                <div style={{
                  position: 'absolute',
                  top: '6px',
                  right: '6px',
                  background: 'rgba(59, 130, 246, 0.9)',
                  color: 'white',
                  padding: '2px 6px',
                  borderRadius: '3px',
                  fontSize: '9px',
                  fontWeight: 600,
                }}>
                  AI DETECTED
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="detections">
          <div style={{ 
            position: 'relative',
            background: '#0f172a', 
            borderRadius: '6px', 
            overflow: 'hidden',
          }}>
            {imageUrl ? (
              <>
                <img
                  ref={imgRef}
                  src={imageUrl}
                  alt="AI analyzed frame"
                  style={{ width: '100%', height: 'auto' }}
                  onLoad={() => setImageLoaded(true)}
                />
                <canvas
                  ref={canvasRef}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                  }}
                />
              </>
            ) : (
              <div style={{ 
                aspectRatio: '16/9',
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                color: '#64748b', 
                fontSize: '12px',
              }}>
                Frame not available
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
