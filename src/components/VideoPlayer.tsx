import { useEffect, useRef, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Loader2, Maximize, Minimize, Play, Pause } from "lucide-react";

interface VideoPlayerProps {
  videoSrc: string;
  title?: string;
  badge?: string;
  description?: string;
}

export default function VideoPlayer({
  videoSrc,
  title = "Original Survey Video",
  badge = "Raw Footage",
  description = "Unprocessed video from survey",
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  /* ── Sync controls state with video events ── */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTimeUpdate = () => setCurrentTime(v.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    const onLoadedMetadata = () => {
      setDuration(v.duration || 0);
      setIsLoading(false);
    };
    const onWaiting = () => setIsLoading(true);
    const onCanPlay = () => setIsLoading(false);

    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);
    v.addEventListener("loadedmetadata", onLoadedMetadata);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("canplay", onCanPlay);

    return () => {
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("loadedmetadata", onLoadedMetadata);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("canplay", onCanPlay);
    };
  }, [videoSrc]);

  /* ── Fullscreen state ── */
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Number(e.target.value);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    if (!document.fullscreenElement) c.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }, []);

  const formatTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-3 flex flex-col h-full">
      {/* Header card */}
      <div className="p-4 gradient-card border-0 rounded-lg">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg">{title}</h3>
          <Badge variant="outline">{badge}</Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </div>

      {/* Video container */}
      <div className="flex-1 overflow-hidden gradient-card border-0 rounded-lg flex items-center justify-center min-h-0 relative">
        <div ref={containerRef} className="relative w-full h-full bg-background flex flex-col">
          {/* Video area */}
          <div className="relative flex-1 min-h-0">
            {isLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-white/60" />
              </div>
            )}
            <video
              ref={videoRef}
              key={videoSrc}
              src={videoSrc}
              onClick={togglePlay}
              onDoubleClick={(e) => e.preventDefault()}
              className="absolute inset-0 w-full h-full object-contain"
            />
            {/* Custom controls bar */}
            <div className="absolute left-0 right-0 bottom-0 flex items-center gap-2 px-3 py-2 bg-black/50 text-white text-xs select-none">
              <button onClick={togglePlay} className="p-1 hover:text-blue-400 transition-colors focus:outline-none focus:ring-none focus:border-none">
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>

              <span className="tabular-nums w-[38px] text-center">{formatTime(currentTime)}</span>

              <input
                type="range"
                min={0}
                max={duration || 1}
                step={0.01}
                value={currentTime}
                onChange={handleSeek}
                style = {{
                  background: `linear-gradient(to right, #3b82f6 ${
                    (currentTime / duration) * 100
                  }%, #9ca3af ${(currentTime / duration) * 100}%)`,
                }}
                className="flex-1 h-1 cursor-pointer appearance-none bg-transparent
                          [&::-webkit-slider-runnable-track]:h-1
                          [&::-webkit-slider-thumb]:appearance-none
                          [&::-webkit-slider-thumb]:h-3
                          [&::-webkit-slider-thumb]:w-3
                          [&::-moz-range-thumb]:h-3
                          [&::-moz-range-thumb]:w-3
                          [&::-moz-range-thumb]:rounded-full
                          [&::-webkit-slider-thumb]:rounded-full
                          [&::-webkit-slider-thumb]:bg-blue-500
                          [&::-webkit-slider-thumb]:-mt-1"
              />

              <span className="tabular-nums w-[38px] text-center">{formatTime(duration)}</span>

              <button
                onClick={toggleFullscreen}
                className="p-1 hover:text-blue-400 transition-colors focus:outline-none focus:ring-none focus:border-none"
                title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              >
                {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
