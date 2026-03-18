import L from "leaflet";
import type { ResolvedMap } from "@/contexts/LabelMapContext";
import { API_BASE } from "@/lib/api";

// Static fallback map (used when labelMap data is not available)
const FALLBACK_ICONS: Record<string, { iconUrl: string; iconSize: [number, number]; iconAnchor: [number, number] }> = {
    // "type_asset_73":  { iconUrl: '/asset-map-icons/traffic-light.png',      iconSize: [32, 32], iconAnchor: [16, 24] },
    // "type_asset_74":  { iconUrl: '/asset-map-icons/traffic-light.png',      iconSize: [32, 32], iconAnchor: [16, 24] },
    // "type_asset_75":  { iconUrl: '/asset-map-icons/traffic-light.png',      iconSize: [32, 32], iconAnchor: [16, 24] },
    // "type_asset_135": { iconUrl: '/asset-map-icons/road-marking-filled.png', iconSize: [28, 28], iconAnchor: [16, 24] },
    // "type_asset_136": { iconUrl: '/asset-map-icons/road-marking-filled.png', iconSize: [28, 28], iconAnchor: [16, 24] },
    // "type_asset_169": { iconUrl: '/asset-map-icons/street-lamp-edited.png',  iconSize: [36, 36], iconAnchor: [16, 24] },
    // "type_asset_125": { iconUrl: '/asset-map-icons/KerbIcon.svg',           iconSize: [24, 24], iconAnchor: [14, 14] },
    // "type_asset_126": { iconUrl: '/asset-map-icons/KerbIcon.svg',           iconSize: [24, 24], iconAnchor: [14, 14] },
    // "type_asset_127": { iconUrl: '/asset-map-icons/KerbIcon.svg',           iconSize: [24, 24], iconAnchor: [14, 14] },
};

const DEFAULT_ICON_CONFIG = { iconUrl: '/asset-map-icons/box.png', iconSize: [32, 32] as [number, number], iconAnchor: [16, 24] as [number, number] };

// Icon cache to avoid recreating L.Icon objects
const iconCache = new Map<string, L.Icon>();

function getOrCreateIcon(key: string, url: string, size: [number, number], anchor: [number, number]): L.Icon {
    const cacheKey = `${key}-${url}-${size[0]}x${size[1]}`;
    let icon = iconCache.get(cacheKey);
    if (!icon) {
        icon = L.icon({ iconUrl: url, iconSize: size, iconAnchor: anchor });
        iconCache.set(cacheKey, icon);
    }
    return icon;
}

/**
 * Check if an asset has a configured icon (from backend labelMap or static fallback).
 */
export const isAssetIconExist = (asset_id: string, labelMap?: ResolvedMap | null): boolean => {
    // Check backend-configured icon first
    if (labelMap?.labels?.[asset_id]?.icon_url) return true;
    // Fall back to static map
    return asset_id in FALLBACK_ICONS;
}

/**
 * Get a Leaflet icon for an asset ID. Reads from backend labelMap first, then static fallback.
 */
export const getAssetIconFromId = (asset_id: string, labelMap?: ResolvedMap | null): L.Icon => {
    // Check backend-configured icon
    const label = labelMap?.labels?.[asset_id];
    if (label?.icon_url) {
        return getOrCreateIcon(
            asset_id,
            `${API_BASE}${label.icon_url}`,
            label.icon_size || DEFAULT_ICON_CONFIG.iconSize,
            label.icon_anchor || DEFAULT_ICON_CONFIG.iconAnchor,
        );
    }

    // Fall back to static map
    const fallback = FALLBACK_ICONS[asset_id];
    if (fallback) {
        return getOrCreateIcon(asset_id, fallback.iconUrl, fallback.iconSize, fallback.iconAnchor);
    }

    // Default icon
    return getOrCreateIcon("default", DEFAULT_ICON_CONFIG.iconUrl, DEFAULT_ICON_CONFIG.iconSize, DEFAULT_ICON_CONFIG.iconAnchor);
}
