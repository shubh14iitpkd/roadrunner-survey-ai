/**
 * Demo Data Service
 * Provides pre-processed annotation data for the 3 demo videos
 * Maps Label Studio annotations + GPX data to detection markers
 */

// Demo video names mapping
export const DEMO_VIDEOS = {
  '2025_0817_115147_F': {
    videoName: '2025_0817_115147_F.mp4',
    gpxFile: '/demo-data/gpx/2025_0817_115147_F.gpx',
    duration: 300, // 5 minutes
    fps: 30,
  },
  '2025_0817_115647_F': {
    videoName: '2025_0817_115647_F.mp4',
    gpxFile: '/demo-data/gpx/2025_0817_115647_F.gpx',
    duration: 300,
    fps: 30,
  },
  '2025_0817_120147_F': {
    videoName: '2025_0817_120147_F.mp4',
    gpxFile: '/demo-data/gpx/2025_0817_120147_F.gpx',
    duration: 300,
    fps: 30,
  },
};

// Annotation file categories - each file maps to a specific asset category
export const ANNOTATION_CATEGORIES = {
  OIA: 'OIA',
  ITS: 'ITS',
  ROADWAY_LIGHTING: 'Roadway Lighting',
  STRUCTURES: 'Structures',
  DIRECTIONAL_SIGNAGE: 'Directional Signage',
  CORRIDOR_PAVEMENT: 'Corridor & Pavement',
};

const ANNOTATION_FILES = [
  { file: '/demo-data/annotations/oia.json', category: ANNOTATION_CATEGORIES.OIA },
  { file: '/demo-data/annotations/its.json', category: ANNOTATION_CATEGORIES.ITS },
  { file: '/demo-data/annotations/roadway-lighting.json', category: ANNOTATION_CATEGORIES.ROADWAY_LIGHTING },
  { file: '/demo-data/annotations/corridor-structures.json', category: ANNOTATION_CATEGORIES.STRUCTURES },
  { file: '/demo-data/annotations/directional-signage.json', category: ANNOTATION_CATEGORIES.DIRECTIONAL_SIGNAGE },
  { file: '/demo-data/annotations/corridor-pavement.json', category: ANNOTATION_CATEGORIES.CORRIDOR_PAVEMENT },
];

// Asset condition mapping from annotation choices
const CONDITION_MAPPING: Record<string, string> = {
  'Good': 'good',
  'Fair': 'fair',
  'Poor': 'poor',
  'Damaged': 'poor',
  'Missing': 'poor',
};

export interface GpxPoint {
  lat: number;
  lon: number;
  timestamp: string;
  speed?: number;
}

export interface Detection {
  id: string;
  className: string;
  condition: string;
  confidence: number;
  frame: number;
  timestamp: number;
  bbox: { x: number; y: number; width: number; height: number };
  lat?: number;
  lon?: number;
  category: string;
}

export interface ProcessedVideoData {
  videoName: string;
  totalDetections: number;
  detections: Detection[];
  gpxPoints: GpxPoint[];
  summary: {
    byCategory: Record<string, number>;
    byCondition: Record<string, number>;
    byClass: Record<string, { count: number; good: number; fair: number; poor: number }>;
  };
}

// Parse GPX file to extract points with timestamps
async function parseGpxFile(gpxUrl: string): Promise<GpxPoint[]> {
  try {
    const response = await fetch(gpxUrl);
    if (!response.ok) return [];
    
    const text = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'application/xml');
    
    const trackPoints = doc.getElementsByTagName('trkpt');
    const points: GpxPoint[] = [];
    
    for (let i = 0; i < trackPoints.length; i++) {
      const pt = trackPoints[i];
      const lat = parseFloat(pt.getAttribute('lat') || '0');
      const lon = parseFloat(pt.getAttribute('lon') || '0');
      const timestamp = pt.getAttribute('timestamp') || '';
      const speed = parseFloat(pt.getAttribute('speed') || '0');
      
      if (!isNaN(lat) && !isNaN(lon)) {
        points.push({ lat, lon, timestamp, speed });
      }
    }
    
    return points;
  } catch (err) {
    console.error('Error parsing GPX:', err);
    return [];
  }
}

// Extract condition from annotation choices
function extractCondition(result: any[]): string {
  for (const r of result) {
    if (r.type === 'choices' && r.value?.choices) {
      for (const choice of r.value.choices) {
        // Parse choices like "Guardrail-AssetCondition-Good"
        const parts = choice.split('-');
        const lastPart = parts[parts.length - 1];
        if (CONDITION_MAPPING[lastPart]) {
          return CONDITION_MAPPING[lastPart];
        }
      }
    }
  }
  return 'good'; // default
}

// Extract video key from S3 path like "s3://sauditech/Sabah Al HAmad Corridor/2025_0817_115147_F.MP4"
function extractVideoKeyFromPath(path: string): string | null {
  if (!path) return null;
  // Get filename without extension
  const match = path.match(/\/([^\/]+)\.(mp4|MP4)$/i);
  if (match) {
    return match[1];
  }
  return null;
}

// Parse Label Studio annotation format, filtering by video key
function parseAnnotations(data: any[], category: string, videoKey: string): Detection[] {
  const detections: Detection[] = [];
  
  for (const task of data) {
    // Check if this task belongs to the specified video
    const taskVideoPath = task.data?.video || '';
    const taskVideoKey = extractVideoKeyFromPath(taskVideoPath);
    
    // Skip if this annotation doesn't belong to the requested video
    if (taskVideoKey !== videoKey) {
      continue;
    }
    
    for (const annotation of task.annotations || []) {
      const results = annotation.result || [];
      
      // Group results by ID (bbox and choices share same ID)
      const resultGroups: Record<string, any[]> = {};
      for (const r of results) {
        if (!resultGroups[r.id]) resultGroups[r.id] = [];
        resultGroups[r.id].push(r);
      }
      
      for (const [id, group] of Object.entries(resultGroups)) {
        // Find the bbox result
        const bboxResult = group.find(r => r.type === 'videorectangle');
        if (!bboxResult || !bboxResult.value?.sequence || !bboxResult.value?.labels) continue;
        
        const labels = bboxResult.value.labels;
        const sequence = bboxResult.value.sequence;
        const condition = extractCondition(group);
        const fps = 30; // Assuming 30fps
        
        // Extract key frames from sequence
        for (const seq of sequence) {
          if (!seq.enabled && sequence.length > 1) continue; // Skip disabled frames unless it's the only one
          
          const frame = seq.frame || 0;
          const timestamp = seq.time || (frame / fps);
          
          for (const label of labels) {
            detections.push({
              id: `${id}_${frame}`,
              className: label,
              condition,
              confidence: 0.85 + Math.random() * 0.14, // 85-99% confidence
              frame,
              timestamp,
              bbox: {
                x: seq.x || 0,
                y: seq.y || 0,
                width: seq.width || 0,
                height: seq.height || 0,
              },
              category,
            });
          }
        }
      }
    }
  }
  
  return detections;
}

// Link detections to GPS coordinates based on timestamp
function linkDetectionsToGps(detections: Detection[], gpxPoints: GpxPoint[], videoDuration: number): Detection[] {
  if (gpxPoints.length === 0) return detections;
  
  return detections.map(detection => {
    // Calculate progress through video
    const progress = videoDuration > 0 ? detection.timestamp / videoDuration : 0;
    
    // Find corresponding GPS point
    const gpxIndex = Math.min(
      Math.floor(progress * gpxPoints.length),
      gpxPoints.length - 1
    );
    
    const gpsPoint = gpxPoints[gpxIndex];
    
    return {
      ...detection,
      lat: gpsPoint?.lat,
      lon: gpsPoint?.lon,
    };
  });
}

// Generate summary statistics
function generateSummary(detections: Detection[]) {
  const byCategory: Record<string, number> = {};
  const byCondition: Record<string, number> = { good: 0, fair: 0, poor: 0 };
  const byClass: Record<string, { count: number; good: number; fair: number; poor: number }> = {};
  
  for (const d of detections) {
    // By category
    byCategory[d.category] = (byCategory[d.category] || 0) + 1;
    
    // By condition
    byCondition[d.condition] = (byCondition[d.condition] || 0) + 1;
    
    // By class
    if (!byClass[d.className]) {
      byClass[d.className] = { count: 0, good: 0, fair: 0, poor: 0 };
    }
    byClass[d.className].count++;
    byClass[d.className][d.condition as 'good' | 'fair' | 'poor']++;
  }
  
  return { byCategory, byCondition, byClass };
}

// Check if a video name matches a demo video
export function isDemoVideo(videoName: string): string | null {
  const normalizedName = videoName.replace(/\.[^/.]+$/, ''); // Remove extension
  
  for (const key of Object.keys(DEMO_VIDEOS)) {
    if (normalizedName.includes(key) || videoName.includes(key)) {
      return key;
    }
  }
  
  return null;
}

// Load and process demo data for a specific video
export async function loadDemoData(videoKey: string): Promise<ProcessedVideoData | null> {
  const videoConfig = DEMO_VIDEOS[videoKey as keyof typeof DEMO_VIDEOS];
  if (!videoConfig) return null;
  
  console.log(`Loading demo data for ${videoKey}...`);
  
  // Load GPX points
  const gpxPoints = await parseGpxFile(videoConfig.gpxFile);
  console.log(`Loaded ${gpxPoints.length} GPX points`);
  
  // Load all annotation files and parse
  const allDetections: Detection[] = [];
  
  for (const annotationFile of ANNOTATION_FILES) {
    try {
      const response = await fetch(annotationFile.file);
      if (!response.ok) {
        console.warn(`Failed to load ${annotationFile.file}`);
        continue;
      }
      
      const data = await response.json();
      // Pass videoKey to filter annotations for this specific video
      const detections = parseAnnotations(data, annotationFile.category, videoKey);
      console.log(`Parsed ${detections.length} detections from ${annotationFile.category} for video ${videoKey}`);
      allDetections.push(...detections);
    } catch (err) {
      console.error(`Error loading ${annotationFile.file}:`, err);
    }
  }
  
  // Link detections to GPS coordinates
  const linkedDetections = linkDetectionsToGps(allDetections, gpxPoints, videoConfig.duration);
  
  // Generate summary
  const summary = generateSummary(linkedDetections);
  
  console.log(`Total detections for ${videoKey}: ${linkedDetections.length}`);
  console.log('Summary:', summary);
  
  return {
    videoName: videoConfig.videoName,
    totalDetections: linkedDetections.length,
    detections: linkedDetections,
    gpxPoints,
    summary,
  };
}

// Get all demo data for reports
export async function getAllDemoData(): Promise<Map<string, ProcessedVideoData>> {
  const allData = new Map<string, ProcessedVideoData>();
  
  for (const key of Object.keys(DEMO_VIDEOS)) {
    const data = await loadDemoData(key);
    if (data) {
      allData.set(key, data);
    }
  }
  
  return allData;
}

// Convert processed data to the format expected by the existing components
export function convertToFrameDetections(data: ProcessedVideoData, routeId: number) {
  return data.detections.map((d, index) => ({
    _id: `demo_${routeId}_${index}`,
    route_id: routeId,
    timestamp: d.timestamp,
    latitude: d.lat,
    longitude: d.lon,
    frame_number: d.frame,
    detections: [{
      class_name: d.className,
      confidence: d.confidence,
      bbox: [d.bbox.x, d.bbox.y, d.bbox.width, d.bbox.height],
      condition: d.condition,
      category: d.category,
    }],
  }));
}

// Convert to asset format for AssetRegister
export function convertToAssets(data: ProcessedVideoData, routeId: number, surveyId: string) {
  return data.detections.map((d, index) => ({
    _id: `demo_asset_${routeId}_${index}`,
    route_id: routeId,
    survey_id: surveyId,
    asset_type: d.className,    // The specific asset label (e.g., "Guardrail", "Light Pole")
    category: d.category,       // The annotation category (e.g., "OIA", "ITS", "Roadway Lighting")
    type: d.className,
    condition: d.condition,
    confidence: d.confidence,
    lat: d.lat,
    lng: d.lon,
    detected_at: new Date().toISOString(),
    image_url: undefined,
    description: `${d.className} - ${d.condition} condition`,
  }));
}
