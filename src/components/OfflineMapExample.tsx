import { useState } from 'react';
import OfflineMap from './OfflineMap';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

const OfflineMapExample = () => {
  const [markers, setMarkers] = useState([
    {
      id: '1',
      lat: 28.6139,
      lng: 77.2090,
      title: 'New Delhi',
      description: 'Capital of India',
    },
    {
      id: '2',
      lat: 28.7041,
      lng: 77.1025,
      title: 'Old Delhi',
      description: 'Historic area',
    },
  ]);

  const handleMapClick = (lat: number, lng: number) => {
    const newMarker = {
      id: Date.now().toString(),
      lat,
      lng,
      title: `Marker ${markers.length + 1}`,
      description: `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`,
    };
    setMarkers([...markers, newMarker]);
  };

  const handleMarkerClick = (marker: any) => {
    console.log('Marker clicked:', marker);
    alert(`Clicked on: ${marker.title}`);
  };

  const clearMarkers = () => {
    setMarkers([]);
  };

  return (
    <div className="container mx-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle>Offline Map with Markers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 mb-4">
            <Button onClick={clearMarkers} variant="outline">
              Clear All Markers
            </Button>
            <Button
              onClick={() => {
                const randomLat = 28.6139 + (Math.random() - 0.5) * 0.2;
                const randomLng = 77.2090 + (Math.random() - 0.5) * 0.2;
                handleMapClick(randomLat, randomLng);
              }}
              variant="secondary"
            >
              Add Random Marker
            </Button>
          </div>

          <OfflineMap
            center={[28.6139, 77.2090]}
            zoom={12}
            markers={markers}
            onMarkerClick={handleMarkerClick}
            onMapClick={handleMapClick}
            style={{ height: '600px', width: '100%' }}
          />

          <div className="mt-4">
            <h3 className="font-semibold mb-2">Markers ({markers.length}):</h3>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {markers.map((marker) => (
                <div
                  key={marker.id}
                  className="p-2 border rounded text-sm hover:bg-gray-50 cursor-pointer"
                  onClick={() => handleMarkerClick(marker)}
                >
                  <strong>{marker.title}</strong> - {marker.description}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default OfflineMapExample;
