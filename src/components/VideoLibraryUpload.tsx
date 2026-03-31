import React, { useEffect, useState, useMemo } from "react";
import { api, API_BASE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, Video, FileVideo, Search } from "lucide-react";
import { toast } from "sonner";
import { LibraryVideoItem } from "@/contexts/UploadContext";

interface VideoLibraryUploadProps {
  selectedRoute?: string;
  surveyorName?: string;
  surveyDate?: string;
  handleFileSelect: (item: LibraryVideoItem) => void;
  uploadingItems?: string[];
}

/** Fuzzy match: returns a score > 0 if all chars of `query` appear in `target` in order.
 *  Higher score = better match (consecutive runs, prefix, etc.) */
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  if (!q) return 1;
  if (t.includes(q)) return 100 + (q.length / t.length) * 50; // exact substring wins

  let score = 0;
  let qi = 0;
  let consecutiveBonus = 0;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      consecutiveBonus = ti > 0 && t[ti - 1] === q[qi - 1] ? consecutiveBonus + 5 : 1;
      score += consecutiveBonus;
      if (ti === 0) score += 10; // prefix bonus
      qi++;
    } else {
      consecutiveBonus = 0;
    }
  }

  return qi === q.length ? score : 0; // 0 = no match
}

export const VideoLibraryUpload: React.FC<VideoLibraryUploadProps> = ({
  selectedRoute,
  surveyorName,
  surveyDate,
  handleFileSelect,
  uploadingItems = [],
}) => {
  const [items, setItems] = useState<LibraryVideoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const isFormComplete = Boolean(selectedRoute && surveyorName?.trim() && surveyDate);
  const missingFields: string[] = [];
  if (!selectedRoute) missingFields.push("Route ID");
  if (!surveyorName?.trim()) missingFields.push("Surveyor Name");
  if (!surveyDate) missingFields.push("Survey Date");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const resp: any = await api.videos.getLibrary();
        if (cancelled) return;
        const respItems: LibraryVideoItem[] = resp?.items || [];
        setItems(respItems);
      } catch (err: any) {
        console.error("Failed to load library:", err);
        toast.error("Failed to load video library");
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Fuzzy-filtered + sorted items derived from `items` and `searchQuery` */
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;

    return items
      .map((video) => ({ video, score: fuzzyScore(searchQuery.trim(), video.name) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ video }) => video);
  }, [items, searchQuery]);

  const handleVideoClick = (video: LibraryVideoItem) => {
    if (!isFormComplete) {
      toast.error(`Please fill required fields: ${missingFields.join(", ")}`);
      return;
    }
    handleFileSelect(video);
  };

  return (
    <Card className="p-4 bg-muted">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-semibold">Video Library</h4>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin h-6 w-6 mr-2" />
          <span>Loading library...</span>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          <FileVideo className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          No videos found in library
        </div>
      ) : (
        <>
          {/* Search input */}
          <div className="relative mb-3">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search videos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-sm bg-background"
            />
          </div>

          {/* Validation warning banner */}
          {!isFormComplete && (
            <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400">
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span className="text-sm font-medium">
                  Please fill required fields before selecting a video:{" "}
                  <strong>{missingFields.join(", ")}</strong>
                </span>
              </div>
            </div>
          )}

          <div className="rounded-lg bg-background border border-border">
            <ul className="divide-y overflow-y-auto max-h-72">
              {filteredItems.length === 0 ? (
                <li className="flex flex-col items-center justify-center py-10 text-sm text-muted-foreground gap-2">
                  <Search className="h-6 w-6" />
                  No videos match &ldquo;{searchQuery}&rdquo;
                </li>
              ) : (
                filteredItems.map((video) => {
                  const isCurrentlyUploading = uploadingItems.includes(video.name);
                  const isClickable = isFormComplete && !isCurrentlyUploading;
                  return (
                    <li
                      key={video.name}
                      className={`flex items-center justify-between p-3 transition-all ${
                        isCurrentlyUploading
                          ? "bg-primary/5 cursor-default"
                          : isClickable
                          ? "cursor-pointer hover:bg-primary/5"
                          : "cursor-not-allowed opacity-60"
                      }`}
                      onClick={() => isClickable && handleVideoClick(video)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {video.thumb_url ? (
                          <div
                            className={`w-24 h-16 rounded-lg overflow-hidden shadow-md border bg-muted relative ${
                              isCurrentlyUploading ? "border-primary" : "border-border"
                            }`}
                          >
                            <img
                              src={`${API_BASE}${video.thumb_url}`}
                              alt={`Thumbnail for ${video.name}`}
                              loading="lazy"
                              className={`w-full h-full object-cover ${isCurrentlyUploading ? "opacity-50" : ""}`}
                              onError={(e) => {
                                e.currentTarget.src =
                                  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="60" viewBox="0 0 100 60"%3E%3Crect fill="%23ddd" width="100" height="60"/%3E%3Ctext x="50%25" y="50%25" fill="%23999" font-family="Arial" font-size="12" text-anchor="middle" dominant-baseline="middle"%3ENo Image%3C/text%3E%3C/svg%3E';
                              }}
                            />
                            {isCurrentlyUploading && (
                              <div className="absolute inset-0 flex items-center justify-center">
                                <Loader2 className="h-6 w-6 text-primary animate-spin" />
                              </div>
                            )}
                          </div>
                        ) : (
                          <div
                            className={`w-24 h-16 rounded-lg flex items-center justify-center bg-muted border ${
                              isCurrentlyUploading ? "border-primary" : "border-border"
                            }`}
                          >
                            {isCurrentlyUploading ? (
                              <Loader2 className="w-6 h-6 text-primary animate-spin" />
                            ) : (
                              <Video className="w-8 h-8 text-muted-foreground" />
                            )}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-medium truncate flex items-center gap-2">
                            {video.name}
                            {isCurrentlyUploading && (
                              <span className="text-xs text-primary font-normal">Uploading...</span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">{video.video_path}</div>
                        </div>
                      </div>
                      {isCurrentlyUploading ? (
                        <div className="ml-2 flex-shrink-0 px-3 py-1.5 text-xs font-medium text-primary bg-primary/10 rounded-md flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Processing
                        </div>
                      ) : isFormComplete ? (
                        <Button size="sm" variant="outline" className="ml-2 flex-shrink-0">
                          Select
                        </Button>
                      ) : null}
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </>
      )}
    </Card>
  );
};

export default VideoLibraryUpload;