import { useState, useEffect, useRef, useCallback } from 'react';
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
    <div className="video-marker-popup" style={{ width: '100%', maxWidth: '700px', fontSize: '13px', color: '#1e293b' }}>
      {/* Header with Navigation */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '12px',
        paddingBottom: '10px',
        borderBottom: '1px solid #e2e8f0',
      }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '15px', color: '#0f172a' }}>{trackTitle}</div>
          <div style={{ fontSize: '12px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
            <span>📍 Point {pointIndex + 1} / {totalPoints}</span>
            <span>•</span>
            <span>⏱ {timestamp.toFixed(1)}s</span>
          </div>
        </div>

        {/* Navigation Controls */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button
            onClick={() => handleNavigate('prev')}
            disabled={pointIndex === 0}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: pointIndex === 0 ? '#f1f5f9' : '#ffffff',
              cursor: pointIndex === 0 ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: pointIndex === 0 ? '#94a3b8' : '#334155',
            }}
          >
            <ChevronLeft style={{ width: '20px', height: '20px' }} />
          </button>
          <button
            onClick={togglePlay}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              border: '1px solid #3b82f6',
              background: '#3b82f6',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
            }}
          >
            {isPlaying ? <Pause style={{ width: '18px', height: '18px' }} /> : <Play style={{ width: '18px', height: '18px' }} />}
          </button>
          <button
            onClick={() => handleNavigate('next')}
            disabled={pointIndex >= totalPoints - 1}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: pointIndex >= totalPoints - 1 ? '#f1f5f9' : '#ffffff',
              cursor: pointIndex >= totalPoints - 1 ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: pointIndex >= totalPoints - 1 ? '#94a3b8' : '#334155',
            }}
          >
            <ChevronRight style={{ width: '20px', height: '20px' }} />
          </button>
        </div>
      </div>

      {/* GPS Coordinates */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '8px',
        marginBottom: '12px',
        padding: '8px 12px',
        background: '#f1f5f9',
        borderRadius: '6px',
        fontSize: '12px',
        color: '#475569',
      }}>
        <MapPin style={{ width: '14px', height: '14px', color: '#3b82f6' }} />
        <span style={{ fontFamily: 'monospace' }}>{gpxPoint.lat.toFixed(6)}, {gpxPoint.lon.toFixed(6)}</span>
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

        {/* Video Controls Overlay */}
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          right: '10px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}>
          {/* Left: Bounding box toggle */}
          <button
            onClick={() => setShowBboxes(!showBboxes)}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              background: 'rgba(0,0,0,0.75)',
              border: 'none',
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Layers style={{ width: '14px', height: '14px' }} />
            {showBboxes ? 'Hide Boxes' : 'Show Boxes'}
          </button>
          
          {/* Right: Detection count */}
          <div style={{
            padding: '6px 12px',
            borderRadius: '6px',
            background: '#3b82f6',
            color: '#ffffff',
            fontSize: '12px',
            fontWeight: 600,
          }}>
            {visibleDetections} detections
          </div>
        </div>
      </div>

      {/* Category Filters */}
      <div style={{ 
        display: 'flex', 
        gap: '6px', 
        flexWrap: 'wrap',
        marginBottom: '10px',
        padding: '10px',
        background: '#f8fafc',
        borderRadius: '8px',
        border: '1px solid #e2e8f0',
      }}>
        <div style={{ width: '100%', marginBottom: '6px', fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
          <Layers style={{ width: '12px', height: '12px', display: 'inline', marginRight: '4px' }} />
          Category Filters
        </div>
        {Object.entries(CATEGORY_COLORS).map(([category, color]) => {
          const count = detectionsByCategory[category]?.length || 0;
          const isActive = selectedCategories.has(category);
          return (
            <button
              key={category}
              onClick={() => toggleCategory(category)}
              style={{
                padding: '4px 10px',
                borderRadius: '16px',
                border: `2px solid ${color}`,
                background: isActive ? color : 'transparent',
                color: isActive ? '#ffffff' : color,
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                opacity: count === 0 ? 0.5 : 1,
                transition: 'all 0.2s ease',
              }}
            >
              {category} ({count})
            </button>
          );
        })}
      </div>

      {/* Detection List */}
      {detections?.length > 0 && (
        <div style={{ 
          maxHeight: '120px',
          overflowY: 'auto',
          background: '#f8fafc',
          borderRadius: '8px',
          padding: '10px',
          border: '1px solid #e2e8f0',
        }}>
          <div style={{ marginBottom: '6px', fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
            Detected Assets
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {detections
              .filter(d => selectedCategories.has(d.category || 'Other'))
              .map((d, i) => (
              <span
                key={i}
                style={{ 
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: `1px solid ${CATEGORY_COLORS[d.category || 'Other']}`,
                  background: 'white',
                  color: CATEGORY_COLORS[d.category || 'Other'],
                  fontSize: '11px',
                  fontWeight: 500,
                }}
              >
                {d.class_name} • {(d.confidence * 100).toFixed(0)}%
                {d.condition && ` • ${d.condition}`}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
