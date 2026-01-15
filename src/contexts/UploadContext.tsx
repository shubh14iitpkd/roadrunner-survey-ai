import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { api, API_BASE } from "@/lib/api";
import { isDemoVideo, loadDemoData, convertToAssets, type ProcessedVideoData } from "@/services/demoDataService";

export type VideoStatus = "queue" | "uploading" | "uploaded" | "processing" | "completed" | "error" | "failed";

// Store demo data globally so it can be accessed by other components
export const demoDataCache = new Map<string, ProcessedVideoData>();

export interface VideoFile {
    id: string;
    backendId?: string; // _id from backend
    name: string;
    size: number;
    duration: number;
    status: VideoStatus;
    progress: number;
    eta?: string;
    routeId: number;
    surveyDate: string;
    surveyorName: string;
    gpxFile?: string;
    surveyId?: string; // backend survey _id
    thumbnailUrl?: string; // thumbnail URL
}

export interface LibraryVideoItem {
    name: string;
    video_path: string;
    video_url: string;
    thumb_path?: string;
    thumb_url?: string;
    size_bytes?: number;
    last_modified?: string;
}

interface UploadContextType {
    videos: VideoFile[];
    isUploading: boolean;
    uploadFiles: (files: File[], routeId: string, surveyDate: string, surveyorName: string, selectedGpxFile: File | null) => Promise<void>;
    uploadFromLibrary: (videoPath: string, filesize: number, routeId: string, surveyDate: string, surveyorName: string, thumbPath?: string) => Promise<string>;
    retryUpload: (videoId: string) => Promise<void>;
    removeVideo: (videoId: string) => void;
    uploadGpxForVideo: (file: File, videoId: string) => Promise<void>;
    processWithAI: (videoId: string) => Promise<void>;
    resetVideoStatus: (videoId: string) => void;
}



const UploadContext = createContext<UploadContextType | undefined>(undefined);

// Utility function to extract thumbnail from video at 5 seconds
const extractThumbnail = (videoFile: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        if (!context) {
            reject(new Error('Could not get canvas context'));
            return;
        }

        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;

        video.onloadedmetadata = () => {
            // Set canvas dimensions to video dimensions
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            // Seek to 5 seconds or video duration if shorter
            const seekTime = Math.min(5, video.duration);
            video.currentTime = seekTime;
        };

        video.onseeked = () => {
            // Draw the current frame to canvas
            context.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Convert canvas to blob
            canvas.toBlob((blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('Failed to create thumbnail blob'));
                }
                // Clean up
                URL.revokeObjectURL(video.src);
            }, 'image/jpeg', 0.85);
        };

        video.onerror = () => {
            reject(new Error('Error loading video'));
            URL.revokeObjectURL(video.src);
        };

        video.src = URL.createObjectURL(videoFile);
    });
};

export const UploadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [videos, setVideos] = useState<VideoFile[]>([]);
    const [isUploading, setIsUploading] = useState(false);

    // Ref to keep track of active uploads to prevent duplicates if effect re-runs
    const activeUploads = useRef<Set<string>>(new Set());

    // Load initial videos from API
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [videosResp, surveysResp] = await Promise.all([
                    api.videos.list(),
                    api.Surveys.list(),
                ]);

                if (cancelled) return;

                const videoItems = videosResp.items as any[];
                const surveyItems = surveysResp.items as any[];

                // Helper to extract string from MongoDB ObjectId
                const getIdString = (id: any): string => {
                    if (!id) return '';
                    if (typeof id === 'string') return id;
                    if (id.$oid) return id.$oid;
                    return String(id);
                };

                // Create a map of surveys by ID for easy lookup
                const surveyMap = new Map<string, any>();
                surveyItems.forEach(s => {
                    const surveyIdStr = getIdString(s._id);
                    surveyMap.set(surveyIdStr, s);
                });

                // Map backend videos to frontend format
                const mappedVideos: VideoFile[] = videoItems.map(v => {
                    const videoIdStr = getIdString(v._id);
                    const surveyIdStr = getIdString(v.survey_id);
                    const survey = surveyMap.get(surveyIdStr);

                    return {
                        id: videoIdStr,
                        backendId: videoIdStr,
                        name: v.title || 'Untitled Video',
                        size: v.size_bytes || 0,
                        duration: v.duration_seconds || 0,
                        status: (v.status || 'queue') as VideoStatus,
                        progress: v.progress || 0,
                        eta: v.eta,
                        routeId: v.route_id,
                        surveyDate: survey?.survey_date || '',
                        surveyorName: survey?.surveyor_name || '',
                        gpxFile: v.gpx_file_url ? v.gpx_file_url.split('/').pop() : undefined,
                        surveyId: surveyIdStr,
                        thumbnailUrl: v.thumbnail_url,
                    };
                });

                setVideos(mappedVideos);
            } catch (err: any) {
                console.error("Failed to load videos:", err);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Auto-poll videos that are in processing or uploading state
    useEffect(() => {
        const pollInterval = setInterval(async () => {
            // Find videos that need polling (processing or uploading)
            // Note: We might want to be careful about polling "uploading" if we are the ones uploading it locally.
            // But if it's uploading from another session or stuck, it might be good.
            // However, for local uploads, we update state directly. 
            // Let's only poll "processing" or "uploading" if we don't have an active local upload for it?
            // For simplicity, we'll poll everything that looks active on backend.

            const activeVideos = videos.filter(v =>
                (v.status === "processing" || v.status === "uploading") && v.backendId
            );
            // console.log(activeVideos)
            if (activeVideos.length === 0) return;

            // Poll all active videos
            for (const video of activeVideos) {
                // Skip polling if we are currently uploading this video locally
                if (activeUploads.current.has(video.id)) continue;

                try {
                    // console.log('[POLL] Checking video:', video.backendId, 'Status:', video.status);
                    // console.log('[POLL] Updating video:', video);
                    const videoData = await api.videos.get(video.backendId!);

                    setVideos((prev) =>
                        prev.map((v) =>
                            v.id === video.id
                                ? {
                                    ...v,
                                    status: videoData.status as VideoStatus,
                                    progress: videoData.progress || 0,
                                    eta: videoData.eta,
                                }
                                : v
                        )
                    );

                    if (videoData.status === "completed" && video.status !== "completed") {
                        toast.success(`AI processing completed for ${video.name}!`);
                    } else if (videoData.status === "failed" && video.status !== "failed") {
                        toast.error(`Processing failed: ${videoData.error || "Unknown error"}`);
                    }
                } catch (pollError) {
                    console.error("Error polling video status:", pollError);
                }
            }
        }, 2000); // Poll every 2 seconds

        return () => clearInterval(pollInterval);
    }, [videos]);

    const uploadSingleVideo = async (file: File, videoObj: VideoFile, backendId: string, selectedGpxFile: File | null) => {
        const id = videoObj.id;
        activeUploads.current.add(id);

        try {
            // Update status to uploading
            setVideos(prev => prev.map(v => v.id === id ? { ...v, status: "uploading", progress: 0 } : v));
            await api.videos.updateStatus(backendId, { status: "uploading", progress: 0 });

            // Upload video with progress tracking
            await new Promise<void>((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                const form = new FormData();
                form.append("file", file);
                form.append("video_id", backendId);

                xhr.upload.addEventListener("progress", (e) => {
                    if (e.lengthComputable) {
                        const percentComplete = Math.round((e.loaded / e.total) * 100);
                        setVideos(prev => prev.map(v => v.id === id ? { ...v, progress: percentComplete } : v));
                    }
                });

                xhr.addEventListener("load", () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        const responseData = JSON.parse(xhr.responseText);
                        setVideos(prev => prev.map(v => v.id === id ? { ...v, gpxFile: responseData.gpx_created } : v));
                        resolve();
                    } else {
                        reject(new Error(`Upload failed with status ${xhr.status}`));
                    }
                });

                xhr.addEventListener("error", () => reject(new Error("Upload failed")));
                xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));

                const tokens = localStorage.getItem("auth_tokens");
                const access = tokens ? JSON.parse(tokens).access_token : "";

                xhr.open("POST", `${API_BASE}/api/videos/upload`);
                if (access) {
                    xhr.setRequestHeader("Authorization", `Bearer ${access}`);
                }
                xhr.send(form);
            });

            // Update status to uploaded
            // setVideos(prev => prev.map(v => v.id === id ? { ...v, status: "uploaded", progress: 100 } : v));
            // await api.videos.updateStatus(backendId, { status: "uploaded", progress: 100 });

            // Generate and upload thumbnail at 5 seconds
            try {
                // toast.info(`Generating thumbnail for ${file.name}...`);
                const thumbnailBlob = await extractThumbnail(file);
                const thumbnailFile = new File([thumbnailBlob], `${file.name.replace(/\.[^/.]+$/, "")}_thumb.jpg`, { type: 'image/jpeg' });

                const thumbForm = new FormData();
                thumbForm.append("file", thumbnailFile);
                thumbForm.append("video_id", backendId);
                const tokens = localStorage.getItem("auth_tokens");
                const access = tokens ? JSON.parse(tokens).access_token : "";
                const thumbResponse = await fetch(`${API_BASE}/api/videos/thumbnail-upload`, {
                    method: "POST",
                    headers: access ? { Authorization: `Bearer ${access}` } : undefined,
                    body: thumbForm,
                });

                if (thumbResponse.ok) {
                    const thumbData = await thumbResponse.json();
                    setVideos(prev => prev.map(v => v.id === id ? { ...v, thumbnailUrl: thumbData.thumbnail_url } : v));
                }
            } catch (thumbError) {
                console.error("Failed to generate thumbnail:", thumbError);
            }

            // Upload GPX file if selected and associate with this video
            if (selectedGpxFile) {
                const gpxForm = new FormData();
                gpxForm.append("file", selectedGpxFile);
                gpxForm.append("video_id", backendId);
                const tokens = localStorage.getItem("auth_tokens");
                const access = tokens ? JSON.parse(tokens).access_token : "";
                await fetch(`${API_BASE}/api/videos/gpx-upload`, {
                    method: "POST",
                    headers: access ? { Authorization: `Bearer ${access}` } : undefined,
                    body: gpxForm,
                });
                setVideos(prev => prev.map(v => v.id === id ? { ...v, gpxFile: selectedGpxFile.name } : v));
            }
        } catch (e) {
            console.error("Upload error:", e);
            setVideos(prev => prev.map(v => v.id === id ? { ...v, status: "error" } : v));
            toast.error(`Failed to upload ${file.name}`);
        } finally {
            activeUploads.current.delete(id);
        }
    };

    const uploadFromLibrary = async (videoPath: string, filesize: number = 7, routeId: string, surveyDate: string, surveyorName: string, thumbPath?: string) => {
        setIsUploading(true);
        try {
            console.log("Uploading from library:", videoPath, routeId, surveyDate, surveyorName);
            const surveyResp = await api.Surveys.create({
                route_id: parseInt(routeId),
                survey_date: surveyDate,
                surveyor_name: surveyorName,
                status: "uploaded",
                gpx_file_url: undefined,
            });

            const surveyId: string = surveyResp.item._id;
            const id = `video-${Date.now()}`;
            // activeUploads.current.add(id); // for skipping polling 
            const filename = videoPath.split('/').pop() || `${id}.mp4`;
            const duration = Math.floor(Math.random() * 600) + 60; // until we can probe

            // create DB row
            const videoResp = await api.videos.create({
                survey_id: surveyId,
                route_id: parseInt(routeId),
                title: filename,
                size_bytes: filesize,
                duration_seconds: duration,
                status: "queue",
                progress: 0,
            });

            const backendId: string = typeof videoResp.item._id === 'object' && videoResp.item._id.$oid
                ? videoResp.item._id.$oid
                : String(videoResp.item._id);

            // Create initial video object in queue
            const videoObj: VideoFile = {
                id,
                backendId,
                name: filename,
                size: filesize,
                duration,
                status: "uploading",
                progress: 0,
                routeId: parseInt(routeId),
                surveyDate: surveyDate,
                surveyorName: surveyorName,
                surveyId,
                gpxFile: undefined,
                thumbnailUrl: thumbPath ? `${thumbPath}` : undefined,
            };
            console.log(videoObj.thumbnailUrl)
            setVideos(prev => [videoObj, ...prev]);
            await api.videos.updateStatus(backendId, { status: "uploading", progress: 0 });

            // no need to await upload
            const uploadRes = await api.videos.postFromLibrary(videoPath, backendId, surveyId, routeId, thumbPath).catch(err => {
                console.error("Failed to upload from library:", err);
            });

            console.log("Upload from library response:", uploadRes);
            // await api.videos.updateStatus(backendId, { status: "uploaded", progress: 100 });
            setVideos(prev => prev.map(v => v.id === id ? { ...v, gpxFile: uploadRes.gpx_created } : v));
            return id
        } catch (err) {
            console.error("Failed to upload from library:", err);
        }
        setIsUploading(false);
    }

    const uploadFiles = async (files: File[], routeId: string, surveyDate: string, surveyorName: string, selectedGpxFile: File | null) => {
        setIsUploading(true);
        try {
            // 1) Create a survey record for this batch
            let gpxFileUrl: string | undefined = undefined;
            // Note: We are not uploading GPX for survey here as per original code logic which was a bit mixed.
            // Original code had a TODO for survey GPX upload or just associating it.
            // We will stick to the video association for now as that seemed to be the main path.

            const surveyResp = await api.Surveys.create({
                route_id: parseInt(routeId),
                survey_date: surveyDate,
                surveyor_name: surveyorName,
                status: "uploaded",
                gpx_file_url: gpxFileUrl,
            });
            const surveyId: string = surveyResp.item._id;

            // 2) Seed local queue and create video rows in backend
            const newVideos: { file: File, videoObj: VideoFile, backendId: string }[] = [];

            for (let idx = 0; idx < files.length; idx++) {
                const file = files[idx];
                const id = `video-${Date.now()}-${idx}`;
                const duration = Math.floor(Math.random() * 600) + 60; // until we can probe

                toast.info(`Queuing ${file.name}...`);

                // create DB row
                const videoResp = await api.videos.create({
                    survey_id: surveyId,
                    route_id: parseInt(routeId),
                    title: file.name,
                    size_bytes: file.size,
                    duration_seconds: duration,
                    status: "queue",
                    progress: 0,
                });

                const backendId: string = typeof videoResp.item._id === 'object' && videoResp.item._id.$oid
                    ? videoResp.item._id.$oid
                    : String(videoResp.item._id);

                // Create initial video object in queue
                const videoObj: VideoFile = {
                    id,
                    backendId,
                    name: file.name,
                    size: file.size,
                    duration,
                    status: "queue",
                    progress: 0,
                    routeId: parseInt(routeId),
                    surveyDate: surveyDate,
                    surveyorName: surveyorName,
                    surveyId,
                    gpxFile: undefined,
                    thumbnailUrl: undefined,
                };

                setVideos(prev => [videoObj, ...prev]);
                newVideos.push({ file, videoObj, backendId });
            }

            // 3) Start uploads in parallel (or sequential if preferred, but parallel is usually fine for a few files)
            // We'll do them concurrently
            const uploadPromises = newVideos.map(({ file, videoObj, backendId }) =>
                uploadSingleVideo(file, videoObj, backendId, selectedGpxFile)
            );

            // Don't await uploads to allow background processing
            // Just log errors if they occur in the background
            Promise.all(uploadPromises).catch(err => {
                console.error("Background upload batch error:", err);
            });

            toast.success(`${files.length} video(s) uploaded successfully`);

            // We set isUploading to false immediately so the UI is unblocked
            // The individual videos will show "uploading" status
            setIsUploading(false);

        } catch (err: any) {
            toast.error(err?.message || "Failed to create survey/videos");
            setIsUploading(false);
        }
    };

    const retryUpload = async (videoId: string) => {
        // This would require us to have the File object again, which we might not have if the user refreshed.
        // For now, we can only retry if we still have the file in memory or if we implement a way to re-select it.
        // Since we don't store File objects in the `videos` state (only metadata), we can't easily retry without re-selection.
        // For this MVP, we'll just show a toast.
        toast.error("Retry not implemented yet. Please re-upload the file.");
    };

    const removeVideo = (videoId: string) => {
        setVideos(prev => prev.filter(v => v.id !== videoId));
    };

    const uploadGpxForVideo = async (file: File, videoId: string) => {
        const video = videos.find(v => v.id === videoId);
        if (!video?.backendId) {
            toast.error("Video not found or not uploaded yet");
            return;
        }

        try {
            const form = new FormData();
            form.append("file", file);
            form.append("video_id", video.backendId);
            const tokens = localStorage.getItem("auth_tokens");
            const access = tokens ? JSON.parse(tokens).access_token : "";

            const response = await fetch(`${API_BASE}/api/videos/gpx-upload`, {
                method: "POST",
                headers: access ? { Authorization: `Bearer ${access}` } : undefined,
                body: form,
            });

            if (response.ok) {
                setVideos((prev) =>
                    prev.map((v) =>
                        v.id === videoId ? { ...v, gpxFile: file.name } : v
                    )
                );
                toast.success(`GPX file ${file.name} uploaded successfully`);
            } else {
                toast.error("Failed to upload GPX file");
            }
        } catch (err) {
            toast.error("Failed to upload GPX file");
        }
    };

    const processWithAI = async (videoId: string) => {
        const video = videos.find((v) => v.id === videoId);
        if (!video || !video.backendId) {
            toast.error("Video not found or not uploaded yet");
            return;
        }

        // Check if this is a demo video
        const demoKey = isDemoVideo(video.name);

        if (demoKey) {
            // Handle demo video with pre-loaded data
            console.log(`Processing demo video: ${video.name} (key: ${demoKey})`);

            try {
                setVideos((prev) =>
                    prev.map((v) =>
                        v.id === videoId ? { ...v, status: "processing" as VideoStatus, progress: 0 } : v
                    )
                );

                // Call backend to start processing (backend also handles demo mode)
                try {
                    await api.videos.processWithAI(video.backendId);
                } catch (err) {
                    console.warn('Backend process call failed, continuing with frontend demo processing:', err);
                }

                toast.info(`Loading pre-processed AI data for ${video.name}...`);

                // Simulate processing time for demo effect
                const progressSteps = [10, 25, 45, 65, 80, 95, 100];
                for (let i = 0; i < progressSteps.length; i++) {
                    await new Promise(resolve => setTimeout(resolve, 400));
                    setVideos((prev) =>
                        prev.map((v) =>
                            v.id === videoId ? { ...v, progress: progressSteps[i] } : v
                        )
                    );
                }

                // Load demo data
                const demoData = await loadDemoData(demoKey);

                if (demoData) {
                    // Cache the demo data for use in Maps and Reports
                    demoDataCache.set(video.backendId, demoData);

                    // Convert to assets and store (for reports)
                    const assets = convertToAssets(demoData, video.routeId, video.surveyId || '');

                    // Try to bulk insert assets to backend
                    try {
                        await api.assets.bulkInsert(assets);
                        console.log(`Inserted ${assets.length} demo assets for route ${video.routeId}`);
                    } catch (err) {
                        console.warn('Could not insert demo assets to backend (may already exist):', err);
                    }

                    toast.success(`AI processing completed for ${video.name}! Found ${demoData.totalDetections} detections.`);

                    setVideos((prev) =>
                        prev.map((v) =>
                            v.id === videoId ? { ...v, status: "completed" as VideoStatus, progress: 100 } : v
                        )
                    );

                    // Also update backend status
                    try {
                        await api.videos.updateStatus(video.backendId, { status: "completed", progress: 100 });
                    } catch (err) {
                        console.warn('Could not update backend status:', err);
                    }
                } else {
                    throw new Error('Failed to load demo data');
                }
            } catch (error: any) {
                console.error("Error processing demo video:", error);
                toast.error(`Failed to process: ${error.message}`);

                setVideos((prev) =>
                    prev.map((v) =>
                        v.id === videoId ? { ...v, status: "error" as VideoStatus, progress: 0 } : v
                    )
                );
            }
            return;
        }

        // Regular video processing via backend
        // console.log("Starting AI processing for video:", videoId, video);
        try {
            setVideos((prev) =>
                prev.map((v) =>
                    v.id === videoId ? { ...v, status: "queue" as VideoStatus, progress: 0 } : v
                )
            );

            // Call backend to start processing
            const response = await api.videos.processWithAI(video.backendId);

            if (response.ok) {
                toast.success(`AI processing started for ${video.name} with SageMaker`);
            } else {
                throw new Error(response.message || "Failed to start processing");
            }

            // Update local state to processing
            setVideos((prev) =>
                prev.map((v) =>
                    v.id === videoId ? { ...v, status: "processing" as VideoStatus, progress: 0 } : v
                )
            );
        } catch (error: any) {
            console.error("Error starting AI processing:", error);
            toast.error(`Failed to start processing: ${error.message}`);

            // Revert to uploaded status on error
            setVideos((prev) =>
                prev.map((v) =>
                    v.id === videoId ? { ...v, status: "uploaded" as VideoStatus, progress: 0 } : v
                )
            );
        }
    };

    const resetVideoStatus = (videoId: string) => {
        setVideos((prev) =>
            prev.map((v) =>
                v.id === videoId ? { ...v, status: "uploaded" as VideoStatus, progress: 0 } : v
            )
        );
    };

    return (
        <UploadContext.Provider value={{ videos, isUploading, uploadFiles, uploadFromLibrary, retryUpload, removeVideo, uploadGpxForVideo, processWithAI, resetVideoStatus }}>
            {children}
        </UploadContext.Provider>
    );
};

export const useUpload = () => {
    const context = useContext(UploadContext);
    if (context === undefined) {
        throw new Error("useUpload must be used within an UploadProvider");
    }
    return context;
};
