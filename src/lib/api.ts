import { get } from "http";

// Use environment variable, fallback to production URL
const API_BASE = import.meta.env.VITE_API_URL || "https://roadsightai.roadvision.ai";

// Export API_BASE so it can be used in other files
export { API_BASE };

function getAccessToken(): string | null {
	try {
		const tokens = localStorage.getItem("auth_tokens");
		if (!tokens) return null;
		const parsed = JSON.parse(tokens);
		return parsed.access_token || null;
	} catch {
		return null;
	}
}

export async function apiFetch(path: string, options: RequestInit = {}) {
	const headers = new Headers(options.headers || {});
	headers.set("Content-Type", "application/json");
	const token = getAccessToken();
	if (token) headers.set("Authorization", `Bearer ${token}`);
	const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
	if (!res.ok) {
		let message = `HTTP ${res.status}`;
		try {
			const data = await res.json();
			message = data.error || data.message || message;
		} catch { }
		throw new Error(message);
	}
	try {
		return await res.json();
	} catch {
		return null;
	}
}

export const api = {
	auth: {
		login: (email: string, password: string) => apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
		signup: (payload: { name: string; email: string; password: string; role?: string; first_name?: string; last_name?: string; organisation?: string; }) => apiFetch("/api/auth/signup", { method: "POST", body: JSON.stringify(payload) }),
		refresh: (refresh_token: string) => apiFetch("/api/auth/refresh", { method: "POST", headers: { Authorization: `Bearer ${refresh_token}` } as any }),
		me: () => apiFetch("/api/auth/me"),
	},
	roads: {
		list: (query: string = "") => apiFetch(`/api/roads/${query}`),
		get: (route_id: number) => apiFetch(`/api/roads/${route_id}`),
		create: (payload: any) => apiFetch("/api/roads/", { method: "POST", body: JSON.stringify(payload) }),
		update: (route_id: number, payload: any) => apiFetch(`/api/roads/${route_id}`, { method: "PUT", body: JSON.stringify(payload) }),
		delete: (route_id: number) => apiFetch(`/api/roads/${route_id}`, { method: "DELETE" }),
	},
	ai: {
		createChat: (title: string, videoId?: string, routeId?: number | string) => 
			apiFetch("/api/ai/chats", { method: "POST", body: JSON.stringify({ title, video_id: videoId, route_id: Number(routeId) }) }),
		listChats: () => apiFetch("/api/ai/chats"),
		listMessages: (chatId: string) => apiFetch(`/api/ai/chats/${chatId}/messages`),
		addMessage: (chatId: string, role: "user" | "assistant", content: string) =>
			apiFetch(`/api/ai/chats/${chatId}/messages`, { method: "POST", body: JSON.stringify({ role, content }) }),
		sendMessage: (chatId: string, role: "user" | "assistant", content: string, videoId?: string, routeId?: number | string) =>
			apiFetch(`/api/ai/chats/${chatId}/messages`, { method: "POST", body: JSON.stringify({ role, content, video_id: videoId, route_id: Number(routeId) }) }),
		deleteChat: (chatId: string) => apiFetch(`/api/ai/chats/${chatId}`, { method: "DELETE" }),
		renameChat: (chatId: string, title: string) => apiFetch(`/api/ai/chats/${chatId}`, { method: "PATCH", body: JSON.stringify({ title }) }),
	},
	Surveys: {
		list: (params?: { route_id?: number; status?: string; latest_only?: boolean }) => {
			const qs = new URLSearchParams();
			if (params?.route_id != null) qs.set("route_id", String(params.route_id));
			if (params?.status) qs.set("status", params.status);
			if (params?.latest_only != null) qs.set("latest_only", String(params.latest_only));
			const q = qs.toString();
			return apiFetch(`/api/surveys/${q ? `?${q}` : ""}`);
		},
		get: (survey_id: string) => apiFetch(`/api/surveys/${survey_id}`),
		create: (payload: { route_id: number; survey_date: string; surveyor_name: string; status?: string; gpx_file_url?: string }) =>
			apiFetch("/api/surveys/", { method: "POST", body: JSON.stringify(payload) }),
		attachGpx: (survey_id: string, gpx_file_url: string) =>
			apiFetch(`/api/surveys/${survey_id}/attach-gpx`, { method: "POST", body: JSON.stringify({ gpx_file_url }) }),
		getHistory: (route_id: number) => apiFetch(`/api/surveys/route/${route_id}/history`),
		delete: (survey_id: string) => apiFetch(`/api/surveys/${survey_id}`, { method: "DELETE" }),
	},
	videos: {
		list: (params?: { route_id?: number; survey_id?: string; status?: string }) => {
			const qs = new URLSearchParams();
			if (params?.route_id != null) qs.set("route_id", String(params.route_id));
			if (params?.survey_id) qs.set("survey_id", params.survey_id);
			if (params?.status) qs.set("status", params.status);
			const q = qs.toString();
			return apiFetch(`/api/videos/${q ? `?${q}` : ""}`);
		},
		get: (video_id: string) => apiFetch(`/api/videos/${video_id}`),
		create: (payload: { survey_id: string; route_id: number; title: string; storage_url?: string; thumbnail_url?: string; size_bytes?: number; duration_seconds?: number; status?: string; progress?: number; eta?: string; }) =>
			apiFetch("/api/videos/", { method: "POST", body: JSON.stringify(payload) }),
		updateStatus: (video_id: string, update: { status?: string; progress?: number; eta?: string; storage_url?: string; thumbnail_url?: string }) =>
			apiFetch(`/api/videos/${video_id}/status`, { method: "PUT", body: JSON.stringify(update) }),
		processWithAI: (video_id: string) =>
			apiFetch(`/api/videos/${video_id}/process`, { method: "POST" }),
		getMetadata: (video_id: string) => apiFetch(`/api/videos/${video_id}/metadata`),
		getLibrary: (bucket: string, path: string | null) => apiFetch(`/api/videos/library?bucket=${bucket}&path=${path || ""}`),
		postFromLibrary: (video_key: string, video_id: string, survey_id: string, route_id: string, thumb_path?: string) =>
			apiFetch("/api/videos/library", { method: "POST", body: JSON.stringify({ video_key, video_id, survey_id, route_id, thumb_path }) }),
		getFrameWithDetections: (video_id: string, timestamp?: number | string, frame_number?: number, width?: number, resize?: boolean) =>
			apiFetch(`/api/videos/${video_id}/frame_annotated?${timestamp != null ? `timestamp=${timestamp}` : ""}${frame_number != null ? `&frame_number=${frame_number}` : ""}${width != null ? `&width=${width}` : ""}${resize != null ? `&resize=${resize}` : ""}`),
		getAllFrames: (video_id: string, has_detections?: boolean) => {
			const qs = new URLSearchParams();
			if (has_detections) qs.set("has_detections", "true");
			const q = qs.toString();
			return apiFetch(`/api/videos/${video_id}/frames${q ? `?${q}` : ""}`);
		},
		upload: async (file: File, videoId: string, surveyId: string, routeId: number, title: string, onProgress?: (progress: number) => void) => {
			const formData = new FormData();
			formData.append("file", file);
			formData.append("video_id", videoId);
			if (surveyId) formData.append("survey_id", surveyId);
			formData.append("route_id", String(routeId));
			formData.append("title", title);

			const token = getAccessToken();
			return new Promise((resolve, reject) => {
				const xhr = new XMLHttpRequest();

				if (onProgress) {
					xhr.upload.addEventListener("progress", (e) => {
						if (e.lengthComputable) {
							const progress = (e.loaded / e.total) * 100;
							onProgress(progress);
						}
					});
				}

				xhr.addEventListener("load", () => {
					if (xhr.status >= 200 && xhr.status < 300) {
						try {
							resolve(JSON.parse(xhr.responseText));
						} catch {
							resolve(xhr.responseText);
						}
					} else {
						// Parse error response
						try {
							const errorData = JSON.parse(xhr.responseText);
							reject(new Error(errorData.error || errorData.message || xhr.statusText));
						} catch {
							reject(new Error(xhr.statusText || `HTTP ${xhr.status}`));
						}
					}
				});

				xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
				xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));

				xhr.open("POST", `${API_BASE}/api/videos/upload`);
				if (token) {
					xhr.setRequestHeader("Authorization", `Bearer ${token}`);
				}
				xhr.send(formData);
			});
		},
	},
	assets: {
		list: (params?: { survey_id?: string; route_id?: number; category?: string; condition?: string; zone?: string; side?: string }) => {
			const qs = new URLSearchParams();
			if (params?.survey_id) qs.set("survey_id", params.survey_id);
			if (params?.route_id != null) qs.set("route_id", String(params.route_id));
			if (params?.category) qs.set("category", params.category);
			if (params?.condition) qs.set("condition", params.condition);
			if (params?.zone) qs.set("zone", params.zone);
			if (params?.side) qs.set("side", params.side);
			const q = qs.toString();
			return apiFetch(`/api/assets/all${q ? `?${q}` : ""}`);
		},
		listPaginated: (params?: { survey_id?: string; route_id?: number; category?: string; condition?: string; zone?: string; side?: string; page?: number; limit?: number }) => {
			const qs = new URLSearchParams();
			if (params?.survey_id) qs.set("survey_id", params.survey_id);
			if (params?.route_id != null) qs.set("route_id", String(params.route_id));
			if (params?.category) qs.set("category", params.category);
			if (params?.condition) qs.set("condition", params.condition);
			if (params?.zone) qs.set("zone", params.zone);
			if (params?.side) qs.set("side", params.side);
			if (params?.page != null) qs.set("page", String(params.page));
			if (params?.limit != null) qs.set("limit", String(params.limit));
			const q = qs.toString();
			return apiFetch(`/api/assets/${q ? `?${q}` : ""}`);
		},
		getMaster: (params?: { survey_id?: string; route_id?: number; category?: string; condition?: string; zone?: string; side?: string }) => {
			const qs = new URLSearchParams();
			if (params?.survey_id) qs.set("survey_id", params.survey_id);
			if (params?.route_id != null) qs.set("route_id", String(params.route_id));
			if (params?.category) qs.set("category", params.category);
			if (params?.condition) qs.set("condition", params.condition);
			if (params?.zone) qs.set("zone", params.zone);
			if (params?.side) qs.set("side", params.side);
			const q = qs.toString();
			return apiFetch(`/api/assets/master${q ? `?${q}` : ""}`, { method: "POST" });
		},
		get: (asset_id: string) => apiFetch(`/api/assets/${asset_id}`),
		bulkInsert: (assets: any[]) => apiFetch("/api/assets/bulk", { method: "POST", body: JSON.stringify({ assets }) }),
		update: (asset_id: string, payload: any) => apiFetch(`/api/assets/${asset_id}`, { method: "PUT", body: JSON.stringify(payload) }),
	},
	categories: {
		list: () => apiFetch("/api/categories/"),
		create: (payload: { key: string; name: string }) => apiFetch("/api/categories/", { method: "POST", body: JSON.stringify(payload) }),
		update: (key: string, payload: any) => apiFetch(`/api/categories/${key}`, { method: "PUT", body: JSON.stringify(payload) }),
		delete: (key: string) => apiFetch(`/api/categories/${key}`, { method: "DELETE" }),
	},
	dashboard: {
		kpis: (timeframe: string = "week") => apiFetch(`/api/dashboard/kpis?timeframe=${timeframe}`),
		assetsByCategory: () => apiFetch("/api/dashboard/charts/assets-by-category"),
		anomaliesByCategory: () => apiFetch("/api/dashboard/charts/anomalies-by-category"),
		topAnomalyRoads: () => apiFetch("/api/dashboard/tables/top-anomaly-roads"),
		topAssetTypes: (page: number = 1, limit: number = 5, categoryId?: string, condition?: string) => {
			const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
			if (categoryId) qs.set("category_id", categoryId);
			if (condition) qs.set("condition", condition);
			return apiFetch(`/api/dashboard/tables/top-asset-types?${qs.toString()}`);
		},
		recentSurveys: () => apiFetch("/api/dashboard/recent-surveys"),
	},
	user: {
		getResolvedLabelMap: (userId: string) => apiFetch(`/api/assets/${userId}/resolved-map`),
		updateLabelPreference: (userId: string, assetId: string, displayName: string) =>
			apiFetch(`/api/users/${userId}/preferences/label`, { method: "PUT", body: JSON.stringify({ asset_id: assetId, display_name: displayName }) }),
		updateCategoryPreference: (userId: string, categoryId: string, displayName: string) =>
			apiFetch(`/api/users/${userId}/preferences/category`, { method: "PUT", body: JSON.stringify({ category_id: categoryId, display_name: displayName }) }),
	},
	frames: {
		list: (params?: { video_id?: string; survey_id?: string; route_id?: number; has_detections?: boolean; limit?: number; offset?: number }) => {
			const qs = new URLSearchParams();
			if (params?.video_id) qs.set("video_id", params.video_id);
			if (params?.survey_id) qs.set("survey_id", params.survey_id);
			if (params?.route_id !== undefined) qs.set("route_id", params.route_id.toString());
			if (params?.has_detections !== undefined) qs.set("has_detections", params.has_detections.toString());
			if (params?.limit) qs.set("limit", params.limit.toString());
			if (params?.offset) qs.set("offset", params.offset.toString());
			const q = qs.toString();
			return apiFetch(`/api/frames/${q ? `?${q}` : ""}`);
		},
		withDetections: (params?: { route_id?: number; video_id?: string; limit?: number }) => {
			const qs = new URLSearchParams();
			if (params?.route_id !== undefined) qs.set("route_id", params.route_id.toString());
			if (params?.video_id) qs.set("video_id", params.video_id);
			if (params?.limit) qs.set("limit", params.limit.toString());
			const q = qs.toString();
			return apiFetch(`/api/frames/with-detections${q ? `?${q}` : ""}`);
		},
		get: (frame_id: string) => apiFetch(`/api/frames/${frame_id}`),
		getByVideo: (video_id: string) => apiFetch(`/api/frames/video/${video_id}`),
		getByRoute: (route_id: number, params?: { limit?: number; offset?: number }) => {
			const qs = new URLSearchParams();
			if (params?.limit) qs.set("limit", params.limit.toString());
			if (params?.offset) qs.set("offset", params.offset.toString());
			const q = qs.toString();
			return apiFetch(`/api/frames/route/${route_id}${q ? `?${q}` : ""}`);
		},
		getVideoStats: (video_id: string) => apiFetch(`/api/frames/stats/video/${video_id}`),
	},
};
