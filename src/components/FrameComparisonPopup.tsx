import { useState, useEffect, useRef, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ANNOTATION_CATEGORIES } from '@/services/demoDataService';
import { Layers, Eye, EyeOff, ZoomIn, ZoomOut } from 'lucide-react';

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

// Category colors for bounding boxes
const CATEGORY_COLORS: Record<string, string> = {
  [ANNOTATION_CATEGORIES.OIA]: '#22c55e',           // Green
  [ANNOTATION_CATEGORIES.ITS]: '#3b82f6',           // Blue
  [ANNOTATION_CATEGORIES.ROADWAY_LIGHTING]: '#f59e0b', // Amber
  [ANNOTATION_CATEGORIES.STRUCTURES]: '#8b5cf6',    // Purple
  [ANNOTATION_CATEGORIES.DIRECTIONAL_SIGNAGE]: '#ec4899', // Pink
  [ANNOTATION_CATEGORIES.CORRIDOR_PAVEMENT]: '#06b6d4', // Cyan
};

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

  // Group detections by category
  const detectionsByCategory = frameData.detections?.reduce((acc, d) => {
    const category = d.category || 'Other';
    if (!acc[category]) acc[category] = [];
    acc[category].push(d);
    return acc;
  }, {} as Record<string, Detection[]>) || {};

  // Toggle category visibility
  const toggleCategory = useCallback((category: string) => {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

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
      const category = d.category || 'Other';
      if (!selectedCategories.has(category)) return;

      const color = CATEGORY_COLORS[category] || '#ffffff';

      // Scale bbox coordinates to canvas size
      // bbox values are in percentage (0-100)
      const x = (d.bbox.x / 100) * canvas.width;
      const y = (d.bbox.y / 100) * canvas.height;
      const w = (d.bbox.width / 100) * canvas.width;
      const h = (d.bbox.height / 100) * canvas.height;

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
    <div style={{ width: '100%', maxWidth: '800px', fontSize: '13px' }}>
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
              📍 {frameData.gpx_point.lat.toFixed(5)}, {frameData.gpx_point.lon.toFixed(5)}
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

      {/* Category Filters */}
      <div style={{ 
        display: 'flex', 
        gap: '6px', 
        marginBottom: '12px', 
        flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        <Layers className="h-4 w-4 text-muted-foreground" />
        {Object.entries(CATEGORY_COLORS).map(([category, color]) => {
          const count = detectionsByCategory[category]?.length || 0;
          const isActive = selectedCategories.has(category);
          return (
            <Button
              key={category}
              size="sm"
              variant={isActive ? 'default' : 'outline'}
              onClick={() => toggleCategory(category)}
              className="h-7 px-2 text-xs rounded-full"
              style={{
                borderColor: color,
                backgroundColor: isActive ? color : 'transparent',
                color: isActive ? '#ffffff' : color,
                opacity: count > 0 ? 1 : 0.5,
              }}
            >
              {category} ({count})
            </Button>
          );
        })}
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
        
        <Badge variant="secondary" className="bg-primary/20">
          {visibleDetections} detections visible
        </Badge>
      </div>

      {/* Frame Comparison View */}
      {frameData.is_demo ? (
        // Demo mode - Show detection summary
        <div style={{ 
          background: 'linear-gradient(135deg, #1e3a5f 0%, #0d1b2a 100%)',
          padding: '20px',
          borderRadius: '8px',
        }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px', 
            marginBottom: '16px',
            color: '#60a5fa',
          }}>
            <Layers className="h-5 w-5" />
            <span style={{ fontWeight: 600 }}>Detection Summary</span>
          </div>
          
          {Object.entries(detectionsByCategory).length > 0 ? (
            <div style={{ display: 'grid', gap: '8px' }}>
              {Object.entries(detectionsByCategory)
                .filter(([cat]) => selectedCategories.has(cat))
                .map(([category, detections]) => (
                <div key={category} style={{ 
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: '8px',
                  padding: '12px',
                  borderLeft: `3px solid ${CATEGORY_COLORS[category] || '#fff'}`,
                }}>
                  <div style={{ 
                    fontWeight: 600, 
                    color: CATEGORY_COLORS[category] || '#fff',
                    marginBottom: '8px',
                    fontSize: '12px',
                  }}>
                    {category}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {detections.map((d, i) => (
                      <Badge 
                        key={i}
                        variant="secondary"
                        className="text-xs"
                        style={{ 
                          backgroundColor: `${CATEGORY_COLORS[category]}20`,
                          color: CATEGORY_COLORS[category],
                        }}
                      >
                        {d.class_name} • {(d.confidence * 100).toFixed(0)}%
                        {d.condition && ` • ${d.condition}`}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: '#94a3b8', padding: '16px' }}>
              No detections at this location
            </div>
          )}
        </div>
      ) : (
        // Real mode - Show frame comparison with bounding boxes
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
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
      )}

      {/* Detection Details Table */}
      {frameData.detections?.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          <div style={{ 
            fontSize: '11px', 
            fontWeight: 600, 
            marginBottom: '6px',
            color: '#94a3b8',
          }}>
            Detection Details
          </div>
          <div style={{ 
            background: 'rgba(255,255,255,0.05)', 
            borderRadius: '6px',
            maxHeight: '120px',
            overflowY: 'auto',
          }}>
            <table style={{ width: '100%', fontSize: '10px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: '#94a3b8' }}>Asset</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: '#94a3b8' }}>Category</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: '#94a3b8' }}>Confidence</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', color: '#94a3b8' }}>Condition</th>
                </tr>
              </thead>
              <tbody>
                {frameData.detections
                  .filter(d => selectedCategories.has(d.category || 'Other'))
                  .map((d, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '4px 8px', color: '#e2e8f0' }}>{d.class_name}</td>
                    <td style={{ padding: '4px 8px' }}>
                      <span style={{ 
                        color: CATEGORY_COLORS[d.category || 'Other'],
                        fontWeight: 500,
                      }}>
                        {d.category || 'Other'}
                      </span>
                    </td>
                    <td style={{ padding: '4px 8px', color: '#e2e8f0' }}>
                      {(d.confidence * 100).toFixed(0)}%
                    </td>
                    <td style={{ padding: '4px 8px' }}>
                      <span style={{
                        color: d.condition === 'good' ? '#22c55e' : 
                               d.condition === 'fair' ? '#f59e0b' : '#e2e8f0',
                      }}>
                        {d.condition || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
