import React, { useEffect, useState } from "react";
import { api, API_BASE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, Video, FileVideo } from "lucide-react";
import { toast } from "sonner";
import { LibraryVideoItem } from "@/contexts/UploadContext";
interface LibraryItem {
  name: string;
  path?: string;
  size?: number;
  modified?: string;
  url?: string;
}

/*
Selected routes is not used currently, but will be used to filter the video library based on the selected road.
*/
export const VideoLibraryUpload: React.FC<{ selectedRoute?: string, handleFileSelect: (item: LibraryVideoItem) => void }> = ({ selectedRoute, handleFileSelect }) => {
  const [items, setItems] = useState<LibraryVideoItem[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [bucket, setBucket] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async (bucketName: string, path: string) => {
      setLoading(true);
      try {
        const resp: any = await api.videos.getLibrary(bucketName, path || "");
        if (cancelled) return;

        // Backend returns: { current_path, folders: string[], files: string[] }
        const respPath: string = resp?.current_path || path || "";
        const respFolders: string[] = resp?.folders || [];
        const respItems: LibraryVideoItem[] = resp?.items || [];

        setCurrentPath(respPath);
        setFolders(respFolders.map((f) => f.replace(respPath, "")));

        setItems(respItems);
        for (const item of respItems) {
          console.log(item.name)
          console.log(item.size_bytes / (1024 * 1024), "MB");
        }
      } catch (err: any) {
        console.error("Failed to load library:", err);
        toast.error("Failed to load video library");
      } finally {
        setLoading(false);
      }
    };

    // Only load when a selectedRoute (road selection) is provided
    // if (selectedRoute) {
    //   load(bucket, "Sabah Al HAmad Corridor");
    // } else {
    //   // clear lists when no route selected
    //   setItems([]);
    //   setFolders([]);
    //   setCurrentPath("");
    // }
    load("", "");
    return () => { cancelled = true; };
  }, [bucket, selectedRoute]);

  //   if (!selectedRoute) {
  //     return (
  //       <Card className="p-4">
  //         <div className="flex items-center justify-between mb-4">
  //           <h4 className="font-semibold">Video Library</h4>
  //         </div>
  //         <div className="text-sm text-muted-foreground py-8 text-center">Select a Route to view the video library for that road.</div>
  //       </Card>
  //     );
  //   }

  return (
    <Card className="p-4 bg-muted">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-semibold">Video Library</h4>
      </div>

      {/* Breadcrumb / path */}
      {/* <div className="mb-3 text-sm text-muted-foreground">
        Path: {currentPath || '/'}
      </div> */}

      {/* 
      {folders.length > 0 && (
        <div className="mb-4 flex gap-2 flex-wrap">
          {folders.map((f) => (
            <Button key={f} size="sm" onClick={async () => {
              // navigate into folder
              const trimmed = f.replace(/^\/+|\/+$/g, '');
              try {
                setLoading(true);
                const resp: any = await api.videos.getLibrary(bucket, `${currentPath}${trimmed}`);
                const respPath: string = resp?.current_path || `${currentPath}${trimmed}/`;
                const respFolders: string[] = resp?.folders || [];
                const respFiles: string[] = resp?.files || [];
                setCurrentPath(respPath);
                setFolders(respFolders.map((ff) => ff.replace(respPath, "")));
                setItems(respFiles.map((fn: string) => ({ name: fn, path: `${respPath}${fn}` })));
              } catch (err) {
                toast.error('Failed to open folder');
              } finally { setLoading(false); }
            }}>
              {f.replace(/\/$/, '')}
            </Button>
          ))}
        </div>
      )} */}

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
        <div className="rounded-lg bg-background border border-border">
          <ul className="divide-y">
            {items.map((video, i) => (
              <li key={video.name} className="flex cursor-pointer items-center justify-between p-3" onClick={() => handleFileSelect(video)}>
                <div className="flex items-center gap-3 min-w-0">
                  {video.thumb_url ? (
                    <div className="w-24 h-16 rounded-lg overflow-hidden shadow-md border border-border bg-muted">
                      <img
                        src={`${API_BASE}${video.thumb_url}`}
                        alt={`Thumbnail for ${video.name}`}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="60" viewBox="0 0 100 60"%3E%3Crect fill="%23ddd" width="100" height="60"/%3E%3Ctext x="50%25" y="50%25" fill="%23999" font-family="Arial" font-size="12" text-anchor="middle" dominant-baseline="middle"%3ENo Image%3C/text%3E%3C/svg%3E';
                        }}
                      />
                    </div>) : (
                    <div className="w-24 h-16 rounded-lg flex items-center justify-center bg-muted border border-border">
                      <Video className="w-8 h-8 text-muted-foreground" />
                    </div>
                  )
                  }
                  <div className="min-w-0">
                    <div className="font-medium truncate">{video.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{video.video_path}</div>
                  </div>
                </div>

                {/* <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => {
                    const key = it.path || it.name;
                    navigator.clipboard.writeText(key).then(() => toast.success('S3 key copied'));
                  }}>
                    Copy Key
                  </Button>
                </div> */}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
};

export default VideoLibraryUpload;
