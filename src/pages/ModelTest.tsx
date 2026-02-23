import { useState, useCallback, useRef, useEffect } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "https://roadsightai.roadvision.ai";

type JobStatus = "idle" | "uploading" | "processing" | "completed" | "failed";

interface JobState {
  jobId: string | null;
  status: JobStatus;
  progress: number;
  message: string;
  summary: any | null;
}

const ModelTest = () => {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [job, setJob] = useState<JobState>({
    jobId: null,
    status: "idle",
    progress: 0,
    message: "",
    summary: null,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith("video/") || /\.(mp4|avi|mov|webm|mkv)$/i.test(file.name)) {
        setSelectedFile(file);
      }
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
    }
  }, []);

  const startPolling = useCallback((jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/model-test/status/${jobId}`);
        const data = await res.json();

        setJob((prev) => ({
          ...prev,
          status: data.status as JobStatus,
          progress: data.progress || 0,
          message: data.message || "",
          summary: data.summary || null,
        }));

        if (data.status === "completed" || data.status === "failed") {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 2000);
  }, []);

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;

    setJob({ jobId: null, status: "uploading", progress: 0, message: "Uploading video...", summary: null });

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      // Use XHR for upload progress
      const response = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setJob((prev) => ({ ...prev, progress: pct, message: `Uploading... ${pct}%` }));
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            try {
              const err = JSON.parse(xhr.responseText);
              reject(new Error(err.error || `HTTP ${xhr.status}`));
            } catch {
              reject(new Error(`HTTP ${xhr.status}`));
            }
          }
        });

        xhr.addEventListener("error", () => reject(new Error("Network error")));
        xhr.open("POST", `${API_BASE}/api/model-test/upload`);
        xhr.send(formData);
      });

      const jobId = response.job_id;
      setJob({ jobId, status: "processing", progress: 0, message: "Starting annotation...", summary: null });
      startPolling(jobId);
    } catch (err: any) {
      setJob({ jobId: null, status: "failed", progress: 0, message: err.message || "Upload failed", summary: null });
    }
  }, [selectedFile, startPolling]);

  const handleDownload = useCallback(() => {
    if (!job.jobId) return;
    window.open(`${API_BASE}/api/model-test/download/${job.jobId}`, "_blank");
  }, [job.jobId]);

  const handleReset = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setSelectedFile(null);
    setJob({ jobId: null, status: "idle", progress: 0, message: "", summary: null });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <div className="model-test-page">
      <div className="model-test-container">
        {/* Header */}
        <div className="model-test-header">
          <div className="model-test-logo">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <rect width="40" height="40" rx="10" fill="url(#logo-grad)" />
              <path d="M12 20L18 26L28 14" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              <defs>
                <linearGradient id="logo-grad" x1="0" y1="0" x2="40" y2="40">
                  <stop stopColor="#6366f1" />
                  <stop offset="1" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
            </svg>
            <div>
              <h1>Model Testing</h1>
              <p>RoadSight AI — YOLOv26 Annotation Pipeline</p>
            </div>
          </div>
        </div>

        {/* Upload Zone */}
        {job.status === "idle" && (
          <div
            className={`drop-zone ${dragActive ? "drop-zone--active" : ""} ${selectedFile ? "drop-zone--has-file" : ""}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,.mp4,.avi,.mov,.webm,.mkv"
              onChange={handleFileSelect}
              style={{ display: "none" }}
            />

            {selectedFile ? (
              <div className="file-preview">
                <div className="file-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="file-name">{selectedFile.name}</p>
                <p className="file-size">{formatFileSize(selectedFile.size)}</p>
                <button
                  className="btn btn-primary"
                  onClick={(e) => { e.stopPropagation(); handleUpload(); }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Start Annotation
                </button>
              </div>
            ) : (
              <div className="drop-prompt">
                <div className="drop-icon">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="drop-text">Drag & drop your video here</p>
                <p className="drop-subtext">or click to browse — MP4, AVI, MOV, WebM supported</p>
              </div>
            )}
          </div>
        )}

        {/* Progress Section */}
        {(job.status === "uploading" || job.status === "processing") && (
          <div className="progress-section">
            <div className="progress-header">
              <div className="progress-spinner" />
              <div>
                <h3>{job.status === "uploading" ? "Uploading Video" : "Running Annotation"}</h3>
                <p>{job.message}</p>
              </div>
            </div>
            <div className="progress-bar-container">
              <div className="progress-bar" style={{ width: `${job.progress}%` }} />
            </div>
            <p className="progress-percent">{job.progress}%</p>
          </div>
        )}

        {/* Completed */}
        {job.status === "completed" && (
          <div className="result-section">
            <div className="result-icon result-icon--success">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3>Annotation Complete!</h3>
            <p className="result-message">{job.message}</p>

            {job.summary && (
              <div className="summary-grid">
                <div className="summary-card">
                  <span className="summary-value">{job.summary.total_frames}</span>
                  <span className="summary-label">Total Frames</span>
                </div>
                <div className="summary-card">
                  <span className="summary-value">{job.summary.total_detections}</span>
                  <span className="summary-label">Detections</span>
                </div>
                <div className="summary-card">
                  <span className="summary-value">{Object.keys(job.summary.class_counts || {}).length}</span>
                  <span className="summary-label">Classes Found</span>
                </div>
              </div>
            )}

            {job.summary?.class_counts && Object.keys(job.summary.class_counts).length > 0 && (
              <div className="class-breakdown">
                <h4>Detection Breakdown</h4>
                <div className="class-list">
                  {Object.entries(job.summary.class_counts)
                    .sort(([, a], [, b]) => (b as number) - (a as number))
                    .map(([cls, count]) => (
                      <div key={cls} className="class-item">
                        <span className="class-name">{cls}</span>
                        <span className="class-count">{count as number}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            <div className="result-actions">
              <button className="btn btn-primary" onClick={handleDownload}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Download Annotated Video
              </button>
              <button className="btn btn-secondary" onClick={handleReset}>
                Test Another Video
              </button>
            </div>
          </div>
        )}

        {/* Failed */}
        {job.status === "failed" && (
          <div className="result-section">
            <div className="result-icon result-icon--error">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3>Processing Failed</h3>
            <p className="result-message result-message--error">{job.message}</p>
            <button className="btn btn-secondary" onClick={handleReset}>
              Try Again
            </button>
          </div>
        )}
      </div>

      <style>{`
        .model-test-page {
          min-height: 100vh;
          background: linear-gradient(135deg, #0f0f23 0%, #1a1a3e 50%, #0f0f23 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem;
          font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
          color: #e2e8f0;
        }

        .model-test-container {
          width: 100%;
          max-width: 680px;
          display: flex;
          flex-direction: column;
          gap: 2rem;
        }

        /* Header */
        .model-test-header {
          text-align: center;
        }

        .model-test-logo {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 1rem;
        }

        .model-test-logo h1 {
          font-size: 1.75rem;
          font-weight: 700;
          background: linear-gradient(135deg, #818cf8, #a78bfa);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin: 0;
        }

        .model-test-logo p {
          font-size: 0.85rem;
          color: #64748b;
          margin: 0.15rem 0 0;
          text-align: left;
        }

        /* Drop Zone */
        .drop-zone {
          border: 2px dashed #334155;
          border-radius: 16px;
          padding: 3rem 2rem;
          text-align: center;
          cursor: pointer;
          transition: all 0.3s ease;
          background: rgba(30, 41, 59, 0.5);
          backdrop-filter: blur(10px);
        }

        .drop-zone:hover,
        .drop-zone--active {
          border-color: #6366f1;
          background: rgba(99, 102, 241, 0.08);
          box-shadow: 0 0 30px rgba(99, 102, 241, 0.1);
        }

        .drop-zone--has-file {
          border-color: #6366f1;
          border-style: solid;
        }

        .drop-prompt {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.75rem;
        }

        .drop-icon {
          color: #6366f1;
          opacity: 0.7;
        }

        .drop-text {
          font-size: 1.15rem;
          font-weight: 600;
          color: #cbd5e1;
          margin: 0;
        }

        .drop-subtext {
          font-size: 0.85rem;
          color: #64748b;
          margin: 0;
        }

        /* File Preview */
        .file-preview {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
        }

        .file-icon {
          color: #818cf8;
        }

        .file-name {
          font-size: 1rem;
          font-weight: 600;
          color: #e2e8f0;
          margin: 0;
          word-break: break-all;
        }

        .file-size {
          font-size: 0.85rem;
          color: #64748b;
          margin: 0 0 0.5rem;
        }

        /* Buttons */
        .btn {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1.5rem;
          border-radius: 10px;
          font-size: 0.95rem;
          font-weight: 600;
          border: none;
          cursor: pointer;
          transition: all 0.2s ease;
          font-family: inherit;
        }

        .btn-primary {
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          color: white;
          box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3);
        }

        .btn-primary:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(99, 102, 241, 0.4);
        }

        .btn-secondary {
          background: rgba(51, 65, 85, 0.6);
          color: #cbd5e1;
          border: 1px solid #475569;
        }

        .btn-secondary:hover {
          background: rgba(71, 85, 105, 0.6);
        }

        /* Progress */
        .progress-section {
          background: rgba(30, 41, 59, 0.6);
          backdrop-filter: blur(10px);
          border-radius: 16px;
          padding: 2rem;
          border: 1px solid #334155;
        }

        .progress-header {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 1.5rem;
        }

        .progress-header h3 {
          font-size: 1.1rem;
          margin: 0;
          color: #e2e8f0;
        }

        .progress-header p {
          font-size: 0.85rem;
          color: #94a3b8;
          margin: 0.25rem 0 0;
        }

        .progress-spinner {
          width: 36px;
          height: 36px;
          border: 3px solid #334155;
          border-top-color: #818cf8;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .progress-bar-container {
          width: 100%;
          height: 8px;
          background: #1e293b;
          border-radius: 4px;
          overflow: hidden;
        }

        .progress-bar {
          height: 100%;
          background: linear-gradient(90deg, #6366f1, #8b5cf6, #a78bfa);
          border-radius: 4px;
          transition: width 0.5s ease;
        }

        .progress-percent {
          text-align: right;
          font-size: 0.85rem;
          color: #818cf8;
          font-weight: 600;
          margin: 0.5rem 0 0;
        }

        /* Result */
        .result-section {
          background: rgba(30, 41, 59, 0.6);
          backdrop-filter: blur(10px);
          border-radius: 16px;
          padding: 2.5rem 2rem;
          border: 1px solid #334155;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.75rem;
        }

        .result-icon--success { color: #34d399; }
        .result-icon--error { color: #f87171; }

        .result-section h3 {
          font-size: 1.35rem;
          margin: 0;
        }

        .result-message {
          color: #94a3b8;
          font-size: 0.9rem;
          margin: 0;
        }

        .result-message--error { color: #fca5a5; }

        .result-actions {
          display: flex;
          gap: 1rem;
          margin-top: 1rem;
          flex-wrap: wrap;
          justify-content: center;
        }

        /* Summary Cards */
        .summary-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1rem;
          width: 100%;
          margin-top: 0.5rem;
        }

        .summary-card {
          background: rgba(99, 102, 241, 0.08);
          border: 1px solid rgba(99, 102, 241, 0.2);
          border-radius: 12px;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.25rem;
        }

        .summary-value {
          font-size: 1.5rem;
          font-weight: 700;
          color: #818cf8;
        }

        .summary-label {
          font-size: 0.75rem;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        /* Class Breakdown */
        .class-breakdown {
          width: 100%;
          margin-top: 0.5rem;
        }

        .class-breakdown h4 {
          font-size: 0.85rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #94a3b8;
          margin: 0 0 0.75rem;
        }

        .class-list {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
        }

        .class-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.5rem 0.75rem;
          background: rgba(30, 41, 59, 0.6);
          border-radius: 8px;
        }

        .class-name {
          font-size: 0.9rem;
          color: #cbd5e1;
        }

        .class-count {
          font-size: 0.9rem;
          font-weight: 600;
          color: #818cf8;
        }

        /* Responsive */
        @media (max-width: 640px) {
          .model-test-page { padding: 1rem; }
          .model-test-logo { flex-direction: column; text-align: center; }
          .model-test-logo p { text-align: center; }
          .summary-grid { grid-template-columns: 1fr; }
          .drop-zone { padding: 2rem 1.5rem; }
        }
      `}</style>
    </div>
  );
};

export default ModelTest;
