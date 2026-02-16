import L from "leaflet";

export const assetIconMap = {
    "type_asset_169": L.icon({
        iconUrl: '/asset-map-icons/traffic-light.png',
        iconSize: [32, 32],
        iconAnchor: [16, 24]
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