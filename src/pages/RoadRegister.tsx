import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Upload, MapPin, Search, FileJson, FileSpreadsheet, Pencil, Check, X, Map, Route, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

const ROAD_TYPES = [
  "National/Expressway",
  "Municipal/Urban Road",
  "Local Access Road",
  "Special Zone"
];

const ROAD_SIDES = ["LHS", "RHS"];

const CHART_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))"];

export default function RoadRegister() {
  const [roads, setRoads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [editingRoadId, setEditingRoadId] = useState<number | null>(null);
  const [editingRoadName, setEditingRoadName] = useState("");

  // Form state for Add Road dialog
  const [startLat, setStartLat] = useState("");
  const [startLng, setStartLng] = useState("");
  const [endLat, setEndLat] = useState("");
  const [endLng, setEndLng] = useState("");
  const [distance, setDistance] = useState("");
  const [isMapLoaded, setIsMapLoaded] = useState(false);

  // Refs for autocomplete inputs
  const startInputRef = useRef<HTMLInputElement>(null);
  const endInputRef = useRef<HTMLInputElement>(null);
  const startAutocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const endAutocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  // Refs for map
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const startMarkerRef = useRef<google.maps.Marker | null>(null);
  const endMarkerRef = useRef<google.maps.Marker | null>(null);

  const loadRoads = async () => {
    try {
      setLoading(true);
      const resp = await api.roads.list();
      if (resp?.items) {
        setRoads(resp.items);
      }
    } catch (err: any) {
      toast.error("Failed to load roads: " + (err?.message || "Unknown error"));
      setRoads([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoads();
    // setLoading(false);
  }, []);

  // Initialize Google Places Autocomplete when dialog opens
  useEffect(() => {
    if (!isAddDialogOpen) return;

    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;
    if (!apiKey) {
      toast.error("Google Maps API key not configured");
      return;
    }

    // Load Google Maps script if not already loaded
    const loadGoogleMaps = () => {
      return new Promise<void>((resolve, reject) => {
        // Check if Google Maps and Places library are fully loaded
        if ((window as any).google?.maps?.places?.Autocomplete) {
          console.log("Google Maps already loaded");
          return resolve();
        }

        const existingScript = document.querySelector(`script[src*="maps.googleapis.com"]`);
        if (existingScript) {
          console.log("Google Maps script exists, waiting for it to load...");

          // Add a polling mechanism to check when Places API is ready
          const checkPlacesLoaded = () => {
            if ((window as any).google?.maps?.places?.Autocomplete) {
              console.log("Places API is now ready");
              resolve();
            } else {
              setTimeout(checkPlacesLoaded, 100);
            }
          };

          existingScript.addEventListener("load", checkPlacesLoaded);
          checkPlacesLoaded(); // Also check immediately in case it's already loaded
          return;
        }

        console.log("Loading Google Maps script...");
        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
        script.async = true;
        script.defer = true;
        script.onload = () => {
          console.log("Google Maps script loaded");
          // Wait a bit for Places library to initialize
          setTimeout(() => {
            if ((window as any).google?.maps?.places?.Autocomplete) {
              resolve();
            } else {
              reject(new Error("Places library not available after script load"));
            }
          }, 500);
        };
        script.onerror = () => reject(new Error("Failed to load Google Maps"));
        document.head.appendChild(script);
      });
    };

    const initializeAutocomplete = () => {
      console.log("Initializing autocomplete...");

      // Initialize start point autocomplete
      if (startInputRef.current && !startAutocompleteRef.current) {
        try {
          console.log("Creating start point autocomplete");
          const autocomplete = new google.maps.places.Autocomplete(startInputRef.current, {
            fields: ["formatted_address", "geometry", "name", "place_id"],
            types: ["geocode", "establishment"]
          });

          startAutocompleteRef.current = autocomplete;

          // Listen for place selection
          autocomplete.addListener("place_changed", () => {
            const place = autocomplete.getPlace();

            if (!place || !place.geometry || !place.geometry.location) {
              console.log("No place details available for start point");
              return;
            }

            const lat = place.geometry.location.lat();
            const lng = place.geometry.location.lng();

            console.log("Start place selected:", place.formatted_address || place.name);
            console.log("Start coordinates:", lat, lng);

            setStartLat(lat.toFixed(6));
            setStartLng(lng.toFixed(6));
          });

          // Prevent form submission only when autocomplete dropdown is visible
          google.maps.event.addDomListener(startInputRef.current, 'keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              const predictions = document.querySelector('.pac-container');
              if (predictions && predictions.classList.contains('pac-container')) {
                e.preventDefault();
              }
            }
          });

          console.log("Start point autocomplete initialized successfully");
        } catch (error) {
          console.error("Error initializing start autocomplete:", error);
        }
      }

      // Initialize end point autocomplete
      if (endInputRef.current && !endAutocompleteRef.current) {
        try {
          console.log("Creating end point autocomplete");
          const autocomplete = new google.maps.places.Autocomplete(endInputRef.current, {
            fields: ["formatted_address", "geometry", "name", "place_id"],
            types: ["geocode", "establishment"]
          });

          endAutocompleteRef.current = autocomplete;

          // Listen for place selection
          autocomplete.addListener("place_changed", () => {
            const place = autocomplete.getPlace();

            if (!place || !place.geometry || !place.geometry.location) {
              console.log("No place details available for end point");
              return;
            }

            const lat = place.geometry.location.lat();
            const lng = place.geometry.location.lng();

            console.log("End place selected:", place.formatted_address || place.name);
            console.log("End coordinates:", lat, lng);

            setEndLat(lat.toFixed(6));
            setEndLng(lng.toFixed(6));
          });

          // Prevent form submission only when autocomplete dropdown is visible
          google.maps.event.addDomListener(endInputRef.current, 'keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              const predictions = document.querySelector('.pac-container');
              if (predictions && predictions.classList.contains('pac-container')) {
                e.preventDefault();
              }
            }
          });

          console.log("End point autocomplete initialized successfully");
        } catch (error) {
          console.error("Error initializing end autocomplete:", error);
        }
      }
    };

    loadGoogleMaps()
      .then(() => {
        console.log("Google Maps loaded, initializing autocomplete fields");
        // Add a small delay to ensure DOM elements are ready
        setTimeout(initializeAutocomplete, 200);
      })
      .catch((err) => {
        console.error("Failed to load Google Maps:", err);
        toast.error("Failed to load Google Maps autocomplete");
      });

    return () => {
      console.log("Cleaning up autocomplete listeners");
      if (startAutocompleteRef.current) {
        google.maps.event.clearInstanceListeners(startAutocompleteRef.current);
      }
      if (endAutocompleteRef.current) {
        google.maps.event.clearInstanceListeners(endAutocompleteRef.current);
      }
    };
  }, [isAddDialogOpen]);

  // Initialize map when dialog opens
  useEffect(() => {
    if (!isAddDialogOpen) return;

    const initMap = () => {
      // Wait for both the map ref and Google Maps API to be ready
      if (!mapRef.current || !(window as any).google?.maps) {
        console.log('Map ref or Google Maps not ready yet, retrying...');
        return false;
      }

      // Don't reinitialize if already exists
      if (mapInstanceRef.current) {
        return true;
      }

      try {
        console.log('Initializing map...');
        const map = new google.maps.Map(mapRef.current, {
          center: { lat: 25.2048, lng: 55.2708 }, // Dubai default
          zoom: 12,
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: false,
        });

        mapInstanceRef.current = map;

        const directionsRenderer = new google.maps.DirectionsRenderer({
          map: map,
          suppressMarkers: false,
          polylineOptions: {
            strokeColor: '#3B82F6',
            strokeWeight: 5,
            strokeOpacity: 0.7,
          },
        });

        directionsRendererRef.current = directionsRenderer;
        setIsMapLoaded(true);
        console.log('Map initialized successfully');
        return true;
      } catch (error) {
        console.error('Error initializing map:', error);
        return false;
      }
    };

    // Try to initialize immediately, then retry if needed
    let attempts = 0;
    const maxAttempts = 10;
    const retryInterval = 300;

    const attemptInit = () => {
      attempts++;
      const success = initMap();

      if (!success && attempts < maxAttempts) {
        setTimeout(attemptInit, retryInterval);
      }
    };

    // Start after a small delay to let dialog render
    const timer = setTimeout(attemptInit, 100);

    return () => {
      clearTimeout(timer);
    };
  }, [isAddDialogOpen]);

  // Auto-calculate distance and update map when both coordinates are available
  useEffect(() => {
    if (startLat && startLng && endLat && endLng) {
      const lat1 = parseFloat(startLat);
      const lng1 = parseFloat(startLng);
      const lat2 = parseFloat(endLat);
      const lng2 = parseFloat(endLng);

      // Calculate distance
      calculateDistance(lat1, lng1, lat2, lng2);

      // Update map with route
      if (mapInstanceRef.current && (window as any).google?.maps) {
        const directionsService = new google.maps.DirectionsService();

        directionsService.route(
          {
            origin: { lat: lat1, lng: lng1 },
            destination: { lat: lat2, lng: lng2 },
            travelMode: google.maps.TravelMode.DRIVING,
          },
          (result, status) => {
            if (status === google.maps.DirectionsStatus.OK && result) {
              directionsRendererRef.current?.setDirections(result);
            } else {
              console.error('Directions request failed:', status);
              // If directions fail, show markers instead
              if (startMarkerRef.current) startMarkerRef.current.setMap(null);
              if (endMarkerRef.current) endMarkerRef.current.setMap(null);

              startMarkerRef.current = new google.maps.Marker({
                position: { lat: lat1, lng: lng1 },
                map: mapInstanceRef.current,
                label: 'A',
                title: 'Start Point',
              });

              endMarkerRef.current = new google.maps.Marker({
                position: { lat: lat2, lng: lng2 },
                map: mapInstanceRef.current,
                label: 'B',
                title: 'End Point',
              });

              // Fit bounds to show both markers
              const bounds = new google.maps.LatLngBounds();
              bounds.extend({ lat: lat1, lng: lng1 });
              bounds.extend({ lat: lat2, lng: lng2 });
              mapInstanceRef.current?.fitBounds(bounds);
            }
          }
        );
      }
    } else if (startLat && startLng && mapInstanceRef.current) {
      // Only start point selected
      const lat1 = parseFloat(startLat);
      const lng1 = parseFloat(startLng);

      if (startMarkerRef.current) startMarkerRef.current.setMap(null);
      if (endMarkerRef.current) endMarkerRef.current.setMap(null);
      directionsRendererRef.current?.setDirections({ routes: [] } as any);

      startMarkerRef.current = new google.maps.Marker({
        position: { lat: lat1, lng: lng1 },
        map: mapInstanceRef.current,
        label: 'A',
        title: 'Start Point',
      });

      mapInstanceRef.current.setCenter({ lat: lat1, lng: lng1 });
      mapInstanceRef.current.setZoom(14);
    } else if (endLat && endLng && mapInstanceRef.current) {
      // Only end point selected
      const lat2 = parseFloat(endLat);
      const lng2 = parseFloat(endLng);

      if (endMarkerRef.current) endMarkerRef.current.setMap(null);
      if (startMarkerRef.current) startMarkerRef.current.setMap(null);
      directionsRendererRef.current?.setDirections({ routes: [] } as any);

      endMarkerRef.current = new google.maps.Marker({
        position: { lat: lat2, lng: lng2 },
        map: mapInstanceRef.current,
        label: 'B',
        title: 'End Point',
      });

      mapInstanceRef.current.setCenter({ lat: lat2, lng: lng2 });
      mapInstanceRef.current.setZoom(14);
    } else if (mapInstanceRef.current) {
      // No coordinates - clear everything
      if (startMarkerRef.current) startMarkerRef.current.setMap(null);
      if (endMarkerRef.current) endMarkerRef.current.setMap(null);
      directionsRendererRef.current?.setDirections({ routes: [] } as any);

      // Reset to default view
      mapInstanceRef.current.setCenter({ lat: 25.2048, lng: 55.2708 });
      mapInstanceRef.current.setZoom(12);
    }
  }, [startLat, startLng, endLat, endLng]);

  // Calculate distance between two points using Haversine formula
  const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    setDistance(distance.toFixed(2));
  };

  const filteredRoads = roads.filter((road) =>
    road.road_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    road.route_id?.toString().includes(searchQuery.toLowerCase())
  );

  // Calculate KPIs
  const totalRoads = roads.length;
  const totalLength = roads.reduce((sum, road) => sum + (road.estimated_distance_km || 0), 0);
  const roadsByType = roads.reduce((acc, road) => {
    const type = road.road_type || "Unknown";
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const chartData = Object.entries(roadsByType).map(([name, value]) => ({
    name,
    value
  }));

  const handleAddRoad = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    const payload = {
      road_name: formData.get("road_name") as string,
      start_point_name: formData.get("start_point_name") as string,
      start_lat: parseFloat(startLat || (formData.get("start_lat") as string)),
      start_lng: parseFloat(startLng || (formData.get("start_lng") as string)),
      end_point_name: formData.get("end_point_name") as string,
      end_lat: parseFloat(endLat || (formData.get("end_lat") as string)),
      end_lng: parseFloat(endLng || (formData.get("end_lng") as string)),
      estimated_distance_km: parseFloat(distance || (formData.get("estimated_distance_km") as string)),
      road_type: formData.get("road_type") as string,
      road_side: formData.get("road_side") as string,
    };

    try {
      await api.roads.create(payload);

      // Reset form state
      setStartLat("");
      setStartLng("");
      setEndLat("");
      setEndLng("");
      setDistance("");
      setIsMapLoaded(false);

      // Clear autocomplete inputs
      if (startInputRef.current) startInputRef.current.value = "";
      if (endInputRef.current) endInputRef.current.value = "";

      // Clear map and refs
      if (startMarkerRef.current) startMarkerRef.current.setMap(null);
      if (endMarkerRef.current) endMarkerRef.current.setMap(null);
      if (directionsRendererRef.current) directionsRendererRef.current.setDirections({ routes: [] } as any);

      startAutocompleteRef.current = null;
      endAutocompleteRef.current = null;
      mapInstanceRef.current = null;

      setIsAddDialogOpen(false);

      toast.success("Road added successfully!");
      await loadRoads(); // Reload from backend
    } catch (err: any) {
      toast.error(err?.message || "Failed to add road");
    }
  };

  const handleImportFile = (type: string) => {
    toast.info(`${type} import will be implemented in the backend integration phase`);
    setIsImportDialogOpen(false);
  };

  const startEditingRoadName = (road: typeof roads[0]) => {
    setEditingRoadId(road.route_id);
    setEditingRoadName(road.road_name);
  };

  const saveRoadName = async (routeId: number) => {
    try {
      await api.roads.update(routeId, { road_name: editingRoadName });
      setEditingRoadId(null);
      setEditingRoadName("");
      toast.success("Road name updated!");
      await loadRoads(); // Reload from backend
    } catch (err: any) {
      toast.error(err?.message || "Failed to update road");
    }
  };

  const cancelEditingRoadName = () => {
    setEditingRoadId(null);
    setEditingRoadName("");
  };

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <div className="relative overflow-hidden gradient-primary p-8 shadow-elevated">
        <div className="absolute inset-0 bg-primary"></div>
        <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold mb-2 text-white drop-shadow-lg">
              Road Register
            </h1>
            <p className="text-white/90 text-lg">
              Comprehensive road network management system
            </p>
          </div>
          <div className="flex gap-3">
            <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="secondary" className="gap-2 bg-white/20 hover:bg-white/30 text-white border-white/30 backdrop-blur-sm">
                  <Upload className="h-4 w-4" />
                  Import Data
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Import Road Data</DialogTitle>
                  <DialogDescription>
                    Choose your import format. Backend integration coming soon.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <Button
                    variant="outline"
                    className="gap-2 h-20"
                    onClick={() => handleImportFile("CSV")}
                  >
                    <FileSpreadsheet className="h-5 w-5" />
                    <div className="text-left">
                      <div className="font-semibold">Import CSV</div>
                      <div className="text-xs text-muted-foreground">Spreadsheet format</div>
                    </div>
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2 h-20"
                    onClick={() => handleImportFile("JSON")}
                  >
                    <FileJson className="h-5 w-5" />
                    <div className="text-left">
                      <div className="font-semibold">Import JSON</div>
                      <div className="text-xs text-muted-foreground">JavaScript Object Notation</div>
                    </div>
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2 h-20"
                    onClick={() => handleImportFile("XML")}
                  >
                    <FileJson className="h-5 w-5" />
                    <div className="text-left">
                      <div className="font-semibold">Import XML</div>
                      <div className="text-xs text-muted-foreground">Extensible Markup Language</div>
                    </div>
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={isAddDialogOpen} onOpenChange={(open) => {
              // Prevent closing when clicking on Google Places autocomplete
              const pacContainer = document.querySelector('.pac-container');
              if (!open && pacContainer && pacContainer.offsetParent !== null) {
                // Autocomplete is visible, don't close
                return;
              }

              // Cleanup when closing dialog
              if (!open) {
                setStartLat("");
                setStartLng("");
                setEndLat("");
                setEndLng("");
                setDistance("");
                setIsMapLoaded(false);

                if (startInputRef.current) startInputRef.current.value = "";
                if (endInputRef.current) endInputRef.current.value = "";

                if (startMarkerRef.current) startMarkerRef.current.setMap(null);
                if (endMarkerRef.current) endMarkerRef.current.setMap(null);
                if (directionsRendererRef.current) directionsRendererRef.current.setDirections({ routes: [] } as any);

                startAutocompleteRef.current = null;
                endAutocompleteRef.current = null;
                mapInstanceRef.current = null;
              }

              setIsAddDialogOpen(open);
            }}>
              <DialogTrigger asChild>
                <Button className="gap-2 bg-white text-primary hover:bg-white/90 shadow-lg">
                  <Plus className="h-4 w-4" />
                  Add Road
                </Button>
              </DialogTrigger>
              <DialogContent
                className="max-w-[1200px] max-h-[90vh] overflow-y-auto"
                onPointerDownOutside={(e) => {
                  // Prevent closing when clicking on autocomplete dropdown
                  const target = e.target as HTMLElement;
                  if (target.closest('.pac-container')) {
                    e.preventDefault();
                  }
                }}
                onInteractOutside={(e) => {
                  // Prevent closing when interacting with autocomplete
                  const target = e.target as HTMLElement;
                  if (target.closest('.pac-container')) {
                    e.preventDefault();
                  }
                }}
              >
                <DialogHeader>
                  <DialogTitle>Add New Road</DialogTitle>
                  <DialogDescription>
                    Enter the details for the new road entry. The map will show the route between selected points.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Left column - Form */}
                  <form onSubmit={handleAddRoad} className="grid gap-4 py-4" id="add-road-form">
                    <div className="grid gap-2">
                      <Label htmlFor="road_name">Road Name *</Label>
                      <Input id="road_name" name="road_name" placeholder="e.g., Al Corniche Street" required />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor="start_point_name">Start Point Name *</Label>
                        <input
                          ref={startInputRef}
                          id="start_point_name"
                          name="start_point_name"
                          type="text"
                          placeholder="e.g., IIT Delhi"
                          required
                          onChange={() => {
                            // Clear coordinates when user types manually
                            setStartLat("");
                            setStartLng("");
                            setDistance("");
                          }}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <p className="text-xs text-muted-foreground">Start typing for suggestions</p>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="end_point_name">End Point Name *</Label>
                        <input
                          ref={endInputRef}
                          id="end_point_name"
                          name="end_point_name"
                          type="text"
                          placeholder="e.g., India Gate"
                          required
                          onChange={() => {
                            // Clear coordinates when user types manually
                            setEndLat("");
                            setEndLng("");
                            setDistance("");
                          }}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <p className="text-xs text-muted-foreground">Start typing for suggestions</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor="start_lat">Start Latitude *</Label>
                        <Input
                          id="start_lat"
                          name="start_lat"
                          type="number"
                          step="any"
                          placeholder="25.3212"
                          value={startLat}
                          onChange={(e) => setStartLat(e.target.value)}
                          required
                          className={startLat ? "border-green-500" : ""}
                        />
                        {startLat && (
                          <p className="text-xs text-green-600">Auto-filled from selected location</p>
                        )}
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="start_lng">Start Longitude *</Label>
                        <Input
                          id="start_lng"
                          name="start_lng"
                          type="number"
                          step="any"
                          placeholder="51.5241"
                          value={startLng}
                          onChange={(e) => setStartLng(e.target.value)}
                          required
                          className={startLng ? "border-green-500" : ""}
                        />
                        {startLng && (
                          <p className="text-xs text-green-600">Auto-filled from selected location</p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor="end_lat">End Latitude *</Label>
                        <Input
                          id="end_lat"
                          name="end_lat"
                          type="number"
                          step="any"
                          placeholder="25.3548"
                          value={endLat}
                          onChange={(e) => setEndLat(e.target.value)}
                          required
                          className={endLat ? "border-green-500" : ""}
                        />
                        {endLat && (
                          <p className="text-xs text-green-600">Auto-filled from selected location</p>
                        )}
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="end_lng">End Longitude *</Label>
                        <Input
                          id="end_lng"
                          name="end_lng"
                          type="number"
                          step="any"
                          placeholder="51.5310"
                          value={endLng}
                          onChange={(e) => setEndLng(e.target.value)}
                          required
                          className={endLng ? "border-green-500" : ""}
                        />
                        {endLng && (
                          <p className="text-xs text-green-600">Auto-filled from selected location</p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor="estimated_distance_km">
                          Distance (km) *
                          {distance && (
                            <span className="text-xs font-normal text-green-600 ml-2">
                              (Auto-calculated - editable)
                            </span>
                          )}
                        </Label>
                        <Input
                          id="estimated_distance_km"
                          name="estimated_distance_km"
                          type="number"
                          step="0.1"
                          placeholder="8.5"
                          value={distance}
                          onChange={(e) => setDistance(e.target.value)}
                          required
                          className={distance ? "border-green-500" : ""}
                        />
                        {!distance && (
                          <p className="text-xs text-muted-foreground">
                            Select both start and end points to auto-calculate
                          </p>
                        )}
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="road_side">Road Side *</Label>
                        <Select name="road_side" required>
                          <SelectTrigger>
                            <SelectValue placeholder="Select side" />
                          </SelectTrigger>
                          <SelectContent>
                            {ROAD_SIDES.map((side) => (
                              <SelectItem key={side} value={side}>
                                {side}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Label htmlFor="road_type">Road Type *</Label>
                      <Select name="road_type" required>
                        <SelectTrigger>
                          <SelectValue placeholder="Select road type" />
                        </SelectTrigger>
                        <SelectContent>
                          {ROAD_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                              {type}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex justify-end gap-2 pt-4">
                      <Button type="button" variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button type="submit">Add Road</Button>
                    </div>
                  </form>

                  {/* Right column - Map */}
                  <div className="relative">
                    <div className="sticky top-0">
                      <div className="rounded-lg overflow-hidden border-2 border-border shadow-lg bg-gray-100 dark:bg-gray-800 relative">
                        {/* Loading placeholder - shown until map loads */}
                        {!isMapLoaded && (
                          <div className="absolute inset-0 w-full h-[600px] flex items-center justify-center z-10 bg-gray-100 dark:bg-gray-800">
                            <div className="text-center">
                              <MapPin className="h-12 w-12 text-gray-400 mx-auto mb-2 animate-pulse" />
                              <p className="text-sm text-gray-500">Loading map...</p>
                            </div>
                          </div>
                        )}
                        {/* Map container - always rendered for Google Maps to attach to */}
                        <div
                          ref={mapRef}
                          className="w-full h-[600px]"
                          style={{ minHeight: '600px' }}
                        />
                      </div>
                      {startLat && startLng && endLat && endLng && distance && (
                        <div className="mt-4 p-4 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
                          <div className="flex items-center gap-2 text-sm">
                            <Route className="h-4 w-4 text-blue-600" />
                            <span className="font-semibold text-blue-900 dark:text-blue-100">
                              Route Distance: {distance} km
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      <div className="px-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="p-6 shadow-elevated border-0 bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/20 dark:to-card">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Total Roads</p>
                <p className="text-5xl font-bold bg-gradient-to-br from-blue-600 to-blue-400 bg-clip-text text-transparent">{totalRoads}</p>
              </div>
              <div className="p-3 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg">
                <Map className="h-6 w-6 text-white" />
              </div>
            </div>
          </Card>

          <Card className="p-6 shadow-elevated border-0 bg-gradient-to-br from-green-50 to-white dark:from-green-950/20 dark:to-card">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide">Total Length</p>
                <p className="text-5xl font-bold bg-gradient-to-br from-green-600 to-green-400 bg-clip-text text-transparent">{Number(totalLength.toFixed(1)).toLocaleString("en-IN")}<span className="text-2xl ml-1">km</span></p>
              </div>
              <div className="p-3 rounded-xl bg-gradient-to-br from-green-500 to-green-600 shadow-lg">
                <Route className="h-6 w-6 text-white" />
              </div>
            </div>
          </Card>

          <Card className="p-6 shadow-elevated border-0 bg-gradient-to-br from-purple-50 to-white dark:from-purple-950/20 dark:to-card">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide">Average Length</p>
                <p className="text-5xl font-bold bg-gradient-to-br from-purple-600 to-purple-400 bg-clip-text text-transparent">
                  {totalRoads > 0 ? (totalLength / totalRoads).toFixed(1) : 0}<span className="text-2xl ml-1">km</span>
                </p>
              </div>
              <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 shadow-lg">
                <TrendingUp className="h-6 w-6 text-white" />
              </div>
            </div>
          </Card>
        </div>

        <Card className="p-8 shadow-elevated border-0 gradient-card">
          <h3 className="font-bold text-xl mb-6">Road Types Distribution</h3>
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}
                  outerRadius={90}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend
                  layout="vertical"
                  verticalAlign="middle"
                  align="right"
                  iconType="circle"
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-3">
              {Object.entries(roadsByType).map(([type, count], idx) => (
                <div key={type} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full" style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }} />
                    <span className="font-medium">{type}</span>
                  </div>
                  <Badge variant="secondary" className="font-bold">{count}</Badge>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Search */}
      <Card className="p-4 shadow-elevated border-0 gradient-card animate-fade-in">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            placeholder="Search by road name or route ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-11 h-12"
          />
        </div>
      </Card>

      {/* Roads Table */}
      <Card className="shadow-elevated border-0 gradient-card overflow-hidden animate-fade-in">
        {loading ? (
          <div className="p-12 text-center text-muted-foreground">
            Loading roads...
          </div>
        ) : roads.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            No roads found. Add your first road to get started!
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1400px]">
              <thead className="bg-gradient-to-r from-primary/5 via-accent/5 to-primary/5 border-b-2 border-primary/20">
                <tr>
                  <th className="text-left p-4 font-semibold text-sm whitespace-nowrap">Route ID</th>
                  <th className="text-left p-4 font-semibold text-sm whitespace-nowrap">Road Name</th>
                  <th className="text-left p-4 font-semibold text-sm whitespace-nowrap">Start Point</th>
                  <th className="text-left p-4 font-semibold text-sm whitespace-nowrap">End Point</th>
                  <th className="text-left p-4 font-semibold text-sm whitespace-nowrap">Distance</th>
                  <th className="text-left p-4 font-semibold text-sm whitespace-nowrap">Type</th>
                  <th className="text-left p-4 font-semibold text-sm whitespace-nowrap">Side</th>
                  <th className="text-left p-4 font-semibold text-sm whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRoads.map((road, idx) => (
                  <tr
                    key={road.route_id}
                    className="border-b border-border hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition-colors"
                  >
                    <td className="p-4">
                      <Badge variant="outline" className="font-mono">
                        #{road.route_id}
                      </Badge>
                    </td>
                    <td className="p-4">
                      {editingRoadId === road.route_id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={editingRoadName}
                            onChange={(e) => setEditingRoadName(e.target.value)}
                            className="h-8"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveRoadName(road.route_id);
                              if (e.key === "Escape") cancelEditingRoadName();
                            }}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => saveRoadName(road.route_id)}
                          >
                            <Check className="h-4 w-4 text-green-600" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={cancelEditingRoadName}
                          >
                            <X className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 group">
                          <span className="font-medium whitespace-nowrap">{road.road_name}</span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => startEditingRoadName(road)}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="space-y-1">
                        <div className="font-medium text-sm">{road.start_point_name || "—"}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {road.start_lat && road.start_lng
                            ? `${road.start_lat.toFixed(4)}, ${road.start_lng.toFixed(4)}`
                            : "—"}
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="space-y-1">
                        <div className="font-medium text-sm">{road.end_point_name || "—"}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {road.end_lat && road.end_lng
                            ? `${road.end_lat.toFixed(4)}, ${road.end_lng.toFixed(4)}`
                            : "—"}
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <Badge variant="secondary" className="font-semibold">
                        {road.estimated_distance_km || "—"} km
                      </Badge>
                    </td>
                    <td className="p-4">
                      <span className="text-sm">{road.road_type || "—"}</span>
                    </td>
                    <td className="p-4">
                      <Badge variant="outline" className="font-mono">
                        {road.road_side || "—"}
                      </Badge>
                    </td>
                    <td className="p-4">
                      <Link to={`/gis?road=${encodeURIComponent(road.road_name)}`}>
                        <Button variant="ghost" size="sm" className="gap-2">
                          <MapPin className="h-4 w-4" />
                          View Map
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
