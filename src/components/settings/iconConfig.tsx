import L from "leaflet";

export const assetIconMap = {
    "type_asset_73": L.icon({
        iconUrl: '/asset-map-icons/traffic-light.png',
        iconSize: [32, 32],
        iconAnchor: [16, 24]
    }),
    "type_asset_74": L.icon({
        iconUrl: '/asset-map-icons/traffic-light.png',
        iconSize: [32, 32],
        iconAnchor: [16, 24]
    }),
    "type_asset_75": L.icon({
        iconUrl: '/asset-map-icons/traffic-light.png',
        iconSize: [32, 32],
        iconAnchor: [16, 24]
    }),
    "type_asset_135": L.icon({
        iconUrl: '/asset-map-icons/road-marking-filled.png',
        iconSize: [28, 28],
        iconAnchor: [16, 24]
    }),
    "type_asset_136": L.icon({
        iconUrl: '/asset-map-icons/road-marking-filled.png',
        iconSize: [28, 28],
        iconAnchor: [16, 24]
    }),
    "type_asset_169": L.icon({
        iconUrl: '/asset-map-icons/street-lamp-edited.png',
        iconSize: [36, 36],
        iconAnchor: [16, 24]
    }),
    "type_asset_125": L.icon({
        iconUrl: '/asset-map-icons/KerbIcon.svg',
        iconSize: [24, 24],
        iconAnchor: [14, 14]
    }),
    "type_asset_126": L.icon({
        iconUrl: '/asset-map-icons/KerbIcon.svg',
        iconSize: [24, 24],
        iconAnchor: [14, 14]
    }),
    "type_asset_127": L.icon({
        iconUrl: '/asset-map-icons/KerbIcon.svg',
        iconSize: [24, 24],
        iconAnchor: [14, 14]
    }),
    "default": L.icon({
        iconUrl: '/asset-map-icons/box.png',
        iconSize: [32, 32],
        iconAnchor: [16, 24]
    })
}

export const isAssetIconExist = (asset_id: string): boolean => {
    return Object.keys(assetIconMap).includes(asset_id)
}

export const getAssetIconFromId = (asset_id: string): L.Icon => {
    if (isAssetIconExist(asset_id)) {
        return assetIconMap[asset_id]
    } 
    return assetIconMap["default"]
}