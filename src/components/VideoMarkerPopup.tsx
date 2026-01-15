import { useState, useEffect, useRef, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ANNOTATION_CATEGORIES } from '@/services/demoDataService';
import { ChevronLeft, ChevronRight, Layers, Play, Pause, MapPin } from 'lucide-react';

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

interface VideoMarkerPopupProps {
  videoUrl: string;
  timestamp: number;
  detections: Detection[];
  trackTitle: string;
  pointIndex: number;
  totalPoints: number;
  gpxPoint: { lat: number; lon: number };
  onNavigate: (direction: 'prev' | 'next') => void;
  onClose: () => void;
}

// Category colors for bounding boxes
const CATEGORY_COLORS: Record<string, string> = {
  [ANNOTATION_CATEGORIES.OIA]: '#22c55e',
  [ANNOTATION_CATEGORIES.ITS]: '#3b82f6',
  [ANNOTATION_CATEGORIES.ROADWAY_LIGHTING]: '#f59e0b',
  [ANNOTATION_CATEGORIES.STRUCTURES]: '#8b5cf6',
  [ANNOTATION_CATEGORIES.DIRECTIONAL_SIGNAGE]: '#ec4899',
  [ANNOTATION_CATEGORIES.CORRIDOR_PAVEMENT]: '#06b6d4',
};

export default function VideoMarkerPopup({
  videoUrl,
  timestamp,
  detections,
  trackTitle,
  pointIndex,
  totalPoints,
  gpxPoint,
  onNavigate,
  onClose,
}: VideoMarkerPopupProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [showBboxes, setShowBboxes] = useState(true);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    new Set(Object.values(ANNOTATION_CATEGORIES))
  );

  // Group detections by category
  const detectionsByCategory = detections?.reduce((acc, d) => {
    const category = d.category || 'Other';
    if (!acc[category]) acc[category] = [];
    acc[category].push(d);
    return acc;
  }, {} as Record<string, Detection[]>) || {};

  // Seek video to timestamp when ready
  useEffect(() => {
    if (videoRef.current && videoReady) {
      videoRef.current.currentTime = timestamp;
      videoRef.current.pause();
      setIsPlaying(false);
    }
  }, [timestamp, videoReady]);

  // Draw bounding boxes on canvas overlay
  const drawBoundingBoxes = useCallback(() => {
    if (!canvasRef.current || !videoRef.current || !showBboxes) return;

    const canvas = canvasRef.current;
    const video = videoRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Match canvas to video display size
    const rect = video.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw bounding boxes
    detections?.forEach((d) => {
      const category = d.category || 'Other';
      if (!selectedCategories.has(category)) return;

      const color = CATEGORY_COLORS[category] || '#ffffff';

      // bbox values are in percentage (0-100)
      const x = (d.bbox.x / 100) * canvas.width;
      const y = (d.bbox.y / 100) * canvas.height;
      const w = (d.bbox.width / 100) * canvas.width;
      const h = (d.bbox.height / 100) * canvas.height;

      // Draw box
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      // Semi-transparent fill
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.15;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;

      // Label
      const label = `${d.class_name}`;
      ctx.font = 'bold 11px Arial';
      const textMetrics = ctx.measureText(label);
      ctx.fillStyle = color;
      ctx.fillRect(x, y - 18, textMetrics.width + 8, 18);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, x + 4, y - 5);
    });
  }, [detections, selectedCategories, showBboxes]);

  // Redraw boxes on video time update
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      if (!isPlaying) {
        drawBoundingBoxes();
      }
    };

    const handleSeeked = () => {
      drawBoundingBoxes();
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('seeked', handleSeeked);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('seeked', handleSeeked);
    };
  }, [drawBoundingBoxes, isPlaying]);

  // Initial draw when video is ready
  useEffect(() => {
    if (videoReady) {
      setTimeout(drawBoundingBoxes, 100);
    }
  }, [videoReady, drawBoundingBoxes]);

  const toggleCategory = (category: string) => {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleNavigate = (direction: 'prev' | 'next') => {
    // Pause video before navigation
    if (videoRef.current) {
      videoRef.current.pause();
      setIsPlaying(false);
    }
    onNavigate(direction);
  };

  const visibleDetections = detections?.filter(d => 
    selectedCategories.has(d.category || 'Other')
  ).length || 0;

  return (
    <div style={{ width: '100%', maxWidth: '700px', fontSize: '13px' }}>
      {/* Header with Navigation */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '10px',
        paddingBottom: '8px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
      }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '14px' }}>{trackTitle}</div>
          <div style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>Point {pointIndex + 1} / {totalPoints}</span>
            <span>•</span>
            <span>{timestamp.toFixed(1)}s</span>
          </div>
        </div>

        {/* Navigation Controls */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleNavigate('prev')}
            disabled={pointIndex === 0}
            className="h-8 w-8 p-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={togglePlay}
            className="h-8 w-8 p-0"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleNavigate('next')}
            disabled={pointIndex >= totalPoints - 1}
            className="h-8 w-8 p-0"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* GPS Coordinates */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '6px',
        marginBottom: '10px',
        fontSize: '11px',
        color: '#64748b',
      }}>
        <MapPin className="h-3 w-3" />
        <span>{gpxPoint.lat.toFixed(6)}, {gpxPoint.lon.toFixed(6)}</span>
      </div>

      {/* Video Container */}
      <div 
        ref={containerRef}
        style={{ 
          position: 'relative',
          background: '#000',
          borderRadius: '8px',
          overflow: 'hidden',
          marginBottom: '10px',
        }}
      >
        <video
          ref={videoRef}
          src={videoUrl}
          style={{ width: '100%', height: 'auto', display: 'block' }}
          onLoadedMetadata={() => setVideoReady(true)}
          onPlay={() => setIsPlaying(true)}
          onPause={() => {
            setIsPlaying(false);
            drawBoundingBoxes();
          }}
          muted
          playsInline
        />
        {showBboxes && (
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
        )}

        {/* Detection count badge */}
        <div style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          display: 'flex',
          gap: '6px',
        }}>
          <Badge 
            variant="secondary" 
            className="bg-black/70 text-white text-xs cursor-pointer"
            onClick={() => setShowBboxes(!showBboxes)}
          >
            {showBboxes ? 'Hide' : 'Show'} Boxes
          </Badge>
          <Badge variant="secondary" className="bg-primary/90 text-white text-xs">
            {visibleDetections} detections
          </Badge>
        </div>
      </div>

      {/* Category Filters */}
      <div style={{ 
        display: 'flex', 
        gap: '4px', 
        flexWrap: 'wrap',
        marginBottom: '8px',
      }}>
        {Object.entries(CATEGORY_COLORS).map(([category, color]) => {
          const count = detectionsByCategory[category]?.length || 0;
          const isActive = selectedCategories.has(category);
          if (count === 0) return null;
          return (
            <Button
              key={category}
              size="sm"
              variant={isActive ? 'default' : 'ghost'}
              onClick={() => toggleCategory(category)}
              className="h-6 px-2 text-[10px] rounded-full"
              style={{
                borderColor: color,
                backgroundColor: isActive ? color : 'transparent',
                color: isActive ? '#ffffff' : color,
                border: `1px solid ${color}`,
              }}
            >
              {category} ({count})
            </Button>
          );
        })}
      </div>

      {/* Detection List */}
      {detections?.length > 0 && (
        <div style={{ 
          maxHeight: '100px',
          overflowY: 'auto',
          background: 'rgba(0,0,0,0.3)',
          borderRadius: '6px',
          padding: '8px',
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {detections
              .filter(d => selectedCategories.has(d.category || 'Other'))
              .map((d, i) => (
              <Badge 
                key={i}
                variant="outline"
                className="text-[10px]"
                style={{ 
                  borderColor: CATEGORY_COLORS[d.category || 'Other'],
                  color: CATEGORY_COLORS[d.category || 'Other'],
                }}
              >
                {d.class_name} • {(d.confidence * 100).toFixed(0)}%
                {d.condition && ` • ${d.condition}`}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
