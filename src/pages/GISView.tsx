import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
// import GoogleMapView from "@/components/GoogleMapView"; // Temporarily commented - using Leaflet instead
import LeafletMapView from "@/components/LeafletMapView";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import {
  MapPin, ChevronDown, ChevronRight, Send,
  Calendar, User, Percent, AlertCircle, X, Filter, Check, ChevronsUpDown
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CATEGORY_ATTRIBUTES } from "@/data/categoryAttributes";

export default function GISView() {
  const [searchParams] = useSearchParams();
  const [selectedRoads, setSelectedRoads] = useState<string[]>([]);
  const [selectedConditions, setSelectedConditions] = useState<string[]>(["Good", "Fair", "Poor"]);
  const [selectedAssetTypes, setSelectedAssetTypes] = useState<string[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<any | null>(null);
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [roadSelectorOpen, setRoadSelectorOpen] = useState(false);
  const [assetSearchQuery, setAssetSearchQuery] = useState("");
  const [roads, setRoads] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Load data from API on mount
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [roadsResp, assetsResp, categoriesResp] = await Promise.all([
          api.roads.list(),
          api.assets.list(),
          api.categories.list(),
        ]);
        if (roadsResp?.items) setRoads(roadsResp.items);
        if (assetsResp?.items) setAssets(assetsResp.items);
        // TODO: This is probably not used, need to verify
        // also, the categories endpoint is always returning an empty list
        if (categoriesResp?.items) setCategories(categoriesResp.items);
      } catch (err: any) {
        console.error("Failed to load GIS data:", err);
        toast.error("Failed to load GIS data from database");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Pre-select road from URL parameter
  useEffect(() => {
    const roadId = searchParams.get('id');
    const roadParam = searchParams.get('road');
    if (roadId && roads.length > 0) {
      console.log(roads, roadId)
      const road = roads.find(r => r.route_id === Number.parseInt(roadId));
      console.log(road);
      if (road && !selectedRoads.includes(road.route_id)) {
        setSelectedRoads([road.road_name]);
        toast.success(`Viewing: ${road.road_name}`);
      }
    } else if (roadParam && roads.length > 0) {
      // Check if this road exists in the loaded roads
      const roadExists = roads.some(r => r.road_name === roadParam);
      if (roadExists && !selectedRoads.includes(roadParam)) {
        setSelectedRoads([roadParam]);
        toast.success(`Viewing: ${roadParam}`);
      }
    }
  }, [searchParams, roads]);

  // Get unique roads with their route IDs from roads data
  const availableRoads = useMemo(() => {
    const sortedRoads = roads.map(road => ({
      name: road.road_name,
      routeId: String(road.route_id),
      hasGpx: Boolean(road.gpx_file_url)
    })).sort((a, b) => a.routeId.localeCompare(b.routeId));

    for (let i = 0; i < sortedRoads.length; i++) {
      if (sortedRoads[i].routeId === '258') {
        const road_needed = sortedRoads[i];
        sortedRoads.splice(i, 1);
        sortedRoads.unshift(road_needed);
      }
    }
    return sortedRoads;
  }, [roads]);

  const filteredAssets = useMemo(() => {
    return assets.filter(asset => {
      // Get road name from route_id
      const road = roads.find(r => r.route_id === asset.route_id);
      const roadName = road?.road_name || "";

      const matchesRoad = selectedRoads.length === 0 || selectedRoads.includes(roadName);
      const matchesCondition = selectedConditions.includes(asset.condition);
      const matchesType = selectedAssetTypes.length === 0 || selectedAssetTypes.includes(asset.category);
      return matchesRoad && matchesCondition && matchesType;
    });
  }, [assets, roads, selectedRoads, selectedConditions, selectedAssetTypes]);

  const toggleRoad = (roadName: string) => {
    setSelectedRoads(prev =>
      prev.includes(roadName)
        ? prev.filter(r => r !== roadName)
        : [...prev, roadName]
    );
  };

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  const toggleCondition = (condition: string) => {
    setSelectedConditions(prev =>
      prev.includes(condition)
        ? prev.filter(c => c !== condition)
        : [...prev, condition]
    );
  };

  const toggleAssetType = (assetType: string) => {
    console.log(assetType)
    setSelectedAssetTypes(prev =>
      prev.includes(assetType)
        ? prev.filter(t => t !== assetType)
        : [...prev, assetType]
    );
  };

  const getConditionColor = (condition: string) => {
    switch (condition) {
      case "Good":
        return "#10b981"; // green
      case "Fair":
        return "#f59e0b"; // yellow/amber
      case "Poor":
        return "#ef4444"; // red
      default:
        return "#6b7280";
    }
  };

  const handleSubmitFeedback = () => {
    if (!feedback.trim()) {
      toast.error("Please enter your feedback");
      return;
    }

    toast.success("Feedback submitted successfully! This will be used for model improvement.");
    setFeedback("");
    setIsDetailDialogOpen(false);
  };

  // Road network paths - SVG path definitions for different roads
  const roadPaths = {
    "Doha Corniche": "M 10,30 Q 30,25 50,30 T 90,35",
    "Salwa Road": "M 5,50 L 95,55",
    "Al Shamal Road": "M 30,5 Q 32,30 35,50 T 40,95",
    "Lusail Expressway": "M 15,15 Q 40,20 60,25 T 90,30",
    "Dukhan Highway": "M 10,70 Q 50,68 90,70",
    "Al Khor Coastal Road": "M 60,10 Q 65,30 70,50 T 80,90",
    "Orbital Highway": "M 20,80 Q 50,75 80,80",
    "Al Rayyan Road": "M 5,40 L 95,45",
    "C-Ring Road": "M 50,10 Q 55,50 50,90",
    "D-Ring Road": "M 65,15 Q 68,50 65,85"
  };

  // Get position along a road path for an asset
  const getPositionOnRoad = (roadName: string, assetIndex: number, totalAssets: number) => {
    const path = roadPaths[roadName as keyof typeof roadPaths];
    if (!path) return { x: 50, y: 50 };

    // For simplicity, distribute assets evenly along the road
    // In a real implementation, you'd calculate actual positions along the SVG path
    const progress = totalAssets > 1 ? assetIndex / (totalAssets - 1) : 0.5;

    // Simple linear interpolation for demonstration
    // Extract start and end points from path
    const matches = path.match(/M\s*([\d.]+),([\d.]+).*?([\d.]+),([\d.]+)/);
    if (matches) {
      const [, x1, y1, x2, y2] = matches.map(Number);
      return {
        x: x1 + (x2 - x1) * progress,
        y: y1 + (y2 - y1) * progress
      };
    }

    return { x: 50, y: 50 };
  };

  // Group assets by road for positioning
  const assetsByRoad = useMemo(() => {
    const grouped: Record<string, any[]> = {};
    filteredAssets.forEach(asset => {
      const road = roads.find(r => r.route_id === asset.route_id);
      const roadName = road?.road_name || "Unknown";
      if (!grouped[roadName]) {
        grouped[roadName] = [];
      }
      grouped[roadName].push(asset);
    });
    return grouped;
  }, [filteredAssets, roads]);

  // Hardcoded asset categories
  const uniqueAssetCategories = useMemo(() => {
    return [
      "DIRECTIONAL STRUCTURE",
      "GANTRY DIRECTIONAL SIGN",
      "POLE DIRECTIONAL SIGN",
      "STREET SIGN",
      "TRAFFIC SIGN",
      "AIR QUALITY MONITORING SYSTEM (AQMS)",
      "CLOSED CIRCUIT TELEVISION (CCTV)",
      "DYNAMIC MESSAGE SIGN (DMS) ( ELECTRONIC SIGNBOARDS)",
      "EMERGENCY PHONE",
      "FIRE EXTINGUISHER",
      "ITS ENCLOSURE",
      "ITS FEEDER PILLAR",
      "ITS STRUCTURE",
      "LANE CONTROL SIGNS (LCS)",
      "OVER-HEIGHT VEHICLE DETECTION SYSTEM (OVDS)",
      "OVDS SPEAKER",
      "ROAD WEATHER INFORMATION SYSTEM (RWIS)",
      "SMALL DYNAMIC MESSAGING SIGN",
      "TRAFFIC SIGNAL",
      "TRAFFIC SIGNAL FEEDER PILLAR",
      "TRAFFIC SIGNAL HEAD",
      "TRAFFIC SIGNAL JUNCTION",
      "VEHICLE RESTRAINT SYSTEM",
      "ANIMAL FENCE",
      "ANIMAL GRID",
      "CRASH CUSHION",
      "FENCE",
      "GUARDRAIL",
      "TRAFFIC BOLLARD",
      "KERB",
      "ROAD MARKING LINE",
      "ROAD MARKING POINT",
      "ROAD MARKING POLYGON",
      "ROAD STUDS",
      "RUMBLE STRIP",
      "SPEED HUMPS",
      "ACCESSWAY",
      "CARRIAGEWAY",
      "CENTRAL ROUNDABOUT ISLAND",
      "FOOTPATH",
      "JUNCTION ISLAND",
      "MEDIAN",
      "PARKING BAY",
      "SEPERATOR ISLAND",
      "SHOULDER",
      "STREET LIGHT FEEDER PILLAR",
      "STREET LIGHT",
      "STREET LIGHT POLE",
      "UNDERPASS LUMINAIRE",
      "BRIDGE",
      "CABLE BRIDGE",
      "CAMEL CROSSING",
      "CULVERT",
      "FLYOVER",
      "FOOTBRIDGE",
      "MONUMENT",
      "OVERPASS OP (ONLY PEDESTRIAN)",
      "OVERPASS OV",
      "PEDESTRAIN UNDERPASS",
      "RETAINING WALL",
      "TOLL GATE",
      "TUNNEL",
      "UNDERPASS",
      "VIADUCT",
      "Street Light",
      "Artificial Grass",
      "Bench",
      "Bike Rack",
      "Bin",
      "Decorative Fence",
      "Fitness Equipment",
      "Flower Bed",
      "Fountain",
      "Garden",
      "Gravel Area",
      "Hedge",
      "Hoarding",
      "Interlock Area",
      "Jogger Track",
      "Kerbstone",
      "Landscape Light",
      "Natural Grass",
      "Planter Pot",
      "Recessed Light",
      "Road Batter",
      "Sand Area",
      "Tree",
      "Treeguard"
    ];
  }, []);

  // Helper function to find which Asset Category an Asset Type belongs to
  const findAssetCategoryForType = (assetType: string): { category: string; attributes: Record<string, Record<string, string>[]> } | null => {
    for (const [categoryName, assetTypes] of Object.entries(CATEGORY_ATTRIBUTES)) {
      if (assetTypes[assetType]) {
        return { category: categoryName, attributes: assetTypes[assetType] };
      }
    }
    return null;
  };

  // Build the hierarchical structure for display: Asset Category -> Asset Types -> Attributes -> Subtypes
  const assetCategoryHierarchy = useMemo(() => {
    const hierarchy: Record<string, { assetTypes: string[]; categoryData: Record<string, Record<string, Record<string, string>[]>> }> = {};

    // Group Asset Types by their Asset Category
    uniqueAssetCategories.forEach(assetType => {
      const result = findAssetCategoryForType(assetType);
      if (result) {
        if (!hierarchy[result.category]) {
          hierarchy[result.category] = {
            assetTypes: [],
            categoryData: {}
          };
        }
        hierarchy[result.category].assetTypes.push(assetType);
        hierarchy[result.category].categoryData[assetType] = result.attributes;
      }
    });

    return hierarchy;
  }, [uniqueAssetCategories]);

  // Filter categories based on search query
  const filteredCategories = useMemo(() => {
    const query = assetSearchQuery.toLowerCase().trim();

    if (!query) {
      return Object.entries(assetCategoryHierarchy).map(([categoryName, data]) => ({
        category: categoryName,
        assetTypes: data.assetTypes,
        categoryData: data.categoryData
      }));
    }

    // Filter by category name or asset type name
    return Object.entries(assetCategoryHierarchy)
      .filter(([categoryName, data]) =>
        categoryName.toLowerCase().includes(query) ||
        data.assetTypes.some(type => type.toLowerCase().includes(query))
      )
      .map(([categoryName, data]) => ({
        category: categoryName,
        assetTypes: data.assetTypes.filter(type =>
          categoryName.toLowerCase().includes(query) || type.toLowerCase().includes(query)
        ),
        categoryData: data.categoryData
      }));
  }, [assetSearchQuery, assetCategoryHierarchy]);



  return (
    <div className="flex h-screen">
      {/* Left Sidebar - Filters */}
      <Card className="w-96 rounded-none border-r shadow-elevated overflow-hidden flex flex-col bg-gradient-to-b from-background to-muted/20">
        <div className="p-6 border-b bg-gradient-to-br from-primary/10 via-primary/5 to-background backdrop-blur-sm">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Filter className="h-5 w-5 text-primary dark:text-foreground" />
              Filters
            </h2>
            <Badge variant="secondary" className="font-mono font-bold">
              {filteredAssets.length}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Assets visible on map
          </p>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-6 space-y-6">
            {/* Road Filter */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2 text-base">
                  <MapPin className="h-4 w-4 text-primary dark:text-foreground" />
                  Select Roads
                </h3>
                {selectedRoads.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedRoads([])}
                    className="h-7 text-xs"
                  >
                    Clear
                  </Button>
                )}
              </div>

              <Popover open={roadSelectorOpen} onOpenChange={setRoadSelectorOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={roadSelectorOpen}
                    className="w-full justify-between h-auto min-h-10 py-2"
                  >
                    <span className="truncate text-left flex-1">
                      {selectedRoads.length === 0
                        ? "Select roads..."
                        : selectedRoads.length === 1
                          ? selectedRoads[0]
                          : `${selectedRoads.length} roads selected`}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0 z-50" align="start">
                  <Command>
                    <CommandInput placeholder="Search roads..." className="h-9" />
                    <CommandList>
                      <CommandEmpty>No road found.</CommandEmpty>
                      <CommandGroup className="max-h-64 overflow-auto">
                        {availableRoads.map((road) => {
                          const isSelected = selectedRoads.includes(road.name);
                          const assetCount = assets.filter(a => a.route_id === parseInt(road.routeId)).length;

                          return (
                            <CommandItem
                              key={road.name}
                              value={`${road.routeId} ${road.name}`}
                              onSelect={() => {
                                toggleRoad(road.name);
                              }}
                              className="cursor-pointer group"
                            >
                              <div className="flex items-center gap-2 flex-1">
                                <div
                                  className={cn(
                                    "mr-2 flex h-4 w-4 items-center justify-center rounded border border-primary",
                                    isSelected
                                      ? "bg-primary text-primary-foreground!"
                                      : "opacity-50"
                                  )}
                                >
                                  {isSelected && <Check className="h-3 w-3" />}
                                </div>
                                <div className="flex-1 flex flex-col gap-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                      <Badge variant="outline" className="font-mono text-xs group-hover:text-accent-foreground data-[selected=true]:text-accent-foreground">
                                        {road.routeId}
                                      </Badge>
                                      <span className="text-sm">{road.name}</span>
                                    </div>
                                    <Badge variant="secondary" className="text-xs">
                                      {assetCount}
                                    </Badge>
                                  </div>
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <span>GPX:</span>
                                    <Badge
                                      variant={road.hasGpx ? "default" : "outline"}
                                      className={cn(
                                        "text-xs h-4 px-1.5",
                                        road.hasGpx && "bg-green-500 hover:bg-green-600 text-white"
                                      )}
                                    >
                                      {road.hasGpx ? "Yes" : "No"}
                                    </Badge>
                                  </div>
                                </div>
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              {selectedRoads.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {selectedRoads.map(roadName => {
                    const road = availableRoads.find(r => r.name === roadName);
                    return (
                      <Badge
                        key={roadName}
                        variant="secondary"
                        className="gap-1.5 pr-1"
                      >
                        <span className="text-xs font-mono">{road?.routeId}</span>
                        <span className="text-xs">{roadName}</span>
                        <button
                          onClick={() => toggleRoad(roadName)}
                          className="ml-1 hover:bg-muted rounded-full p-0.5"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>

            {/* <div className="border-t pt-6">
           
              <div className="space-y-3">
                <h3 className="font-semibold flex items-center gap-2 text-base">
                  <AlertCircle className="h-4 w-4 text-primary" />
                  Condition Type
                </h3>
                <div className="rounded-lg border bg-card p-3 space-y-2">
                  {["Good", "Fair", "Poor"].map((condition) => (
                    <div 
                      key={condition} 
                      className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        id={`condition-${condition}`}
                        checked={selectedConditions.includes(condition)}
                        onCheckedChange={() => toggleCondition(condition)}
                      />
                      <label
                        htmlFor={`condition-${condition}`}
                        className="flex items-center gap-2 text-sm font-medium leading-none cursor-pointer flex-1"
                      >
                        <div
                          className="w-3 h-3 rounded-full border-2 border-white shadow-sm"
                          style={{ backgroundColor: getConditionColor(condition) }}
                        />
                        {condition}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            */}
            <div className="border-t pt-6">
              {/* Asset Type Filter */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-base">Asset Categories</h3>
                  {selectedAssetTypes.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedAssetTypes([])}
                      className="h-7 text-xs"
                    >
                      Clear
                    </Button>
                  )}
                </div>

                {/* Search Input */}
                <div className="relative">
                  <Input
                    placeholder="Search asset types..."
                    value={assetSearchQuery}
                    onChange={(e) => setAssetSearchQuery(e.target.value)}
                    className="pr-8"
                  />
                  {assetSearchQuery && (
                    <button
                      onClick={() => setAssetSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>

                {/* Categories List */}
                <div className="space-y-2">
                  {filteredCategories.length === 0 ? (
                    <div className="text-center py-8 text-sm text-muted-foreground">
                      No asset categories found
                    </div>
                  ) : (
                    filteredCategories.map(({ category, assetTypes, categoryData }) => {
                      const isCategoryExpanded = expandedCategories.includes(category);
                      // console.log(categories, categoryData, assetTypes)
                      return (
                        <Collapsible key={category} open={isCategoryExpanded} onOpenChange={() => toggleCategory(category)}>
                          {/* Level 1: Asset Category */}
                          <CollapsibleTrigger className="flex items-center justify-between w-full p-3 rounded-lg hover:bg-muted transition-colors border bg-card">
                            <span className="text-sm font-semibold text-left">{category}</span>
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary" className="text-xs font-mono">
                                {assetTypes.length}
                              </Badge>
                              {isCategoryExpanded ? (
                                <ChevronDown className="h-4 w-4 text-primary" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </div>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="pl-3 pt-2 pb-2 space-y-2 bg-muted/20 rounded-b-lg">
                              {/* Level 2: Asset Types */}
                              {assetTypes.map((assetType) => {
                                const assetTypeKey = `${category}-${assetType}`;
                                const isAssetTypeExpanded = expandedCategories.includes(assetTypeKey);
                                const attributes = categoryData[assetType] || {};
                                const attributeCount = Object.keys(attributes).length;

                                return (
                                  <Collapsible key={assetType} open={isAssetTypeExpanded} onOpenChange={() => toggleCategory(assetTypeKey)}>
                                    <CollapsibleTrigger className="flex items-center justify-between w-full p-2 rounded hover:bg-background/80 transition-colors border-l-2 border-primary/30 pl-3">
                                      <span className="text-xs font-medium text-left">{assetType}</span>
                                      <div className="flex items-center gap-2">
                                        <Badge variant="outline" className="text-xs">
                                          {attributeCount}
                                        </Badge>
                                        {isAssetTypeExpanded ? (
                                          <ChevronDown className="h-3 w-3" />
                                        ) : (
                                          <ChevronRight className="h-3 w-3" />
                                        )}
                                      </div>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                      <div className="pl-4 pt-1 pb-1 space-y-1">
                                        {/* Level 3: Attributes */}
                                        {Object.entries(attributes).map(([attributeName, subtypes]) => {
                                          const attributeKey = `${category}-${assetType}-${attributeName}`;
                                          const isAttributeExpanded = expandedCategories.includes(attributeKey);
                                          // console.log(attributeKey)
                                          return (
                                            <Collapsible key={attributeName} open={isAttributeExpanded} onOpenChange={() => toggleCategory(attributeKey)}>
                                              <CollapsibleTrigger className="flex items-center justify-between w-full p-2 rounded hover:bg-muted/50 transition-colors">
                                                <span className="text-xs font-medium text-left text-muted-foreground">{attributeName}</span>
                                                <div className="flex items-center gap-2">
                                                  <Badge variant="outline" className="text-xs bg-background">
                                                    {subtypes.length}
                                                  </Badge>
                                                  {isAttributeExpanded ? (
                                                    <ChevronDown className="h-3 w-3" />
                                                  ) : (
                                                    <ChevronRight className="h-3 w-3" />
                                                  )}
                                                </div>
                                              </CollapsibleTrigger>
                                              <CollapsibleContent>
                                                <div className="pl-3 pt-1 pb-1 space-y-1">
                                                  {/* Level 4: Subtypes (Checkboxes) */}
                                                  {subtypes.map((subtype) => {
                                                    // subtype is { "Display Label": "mapping_value" }
                                                    const label = Object.keys(subtype)[0];
                                                    const mappingValue = Object.values(subtype)[0];
                                                    return (
                                                      <div key={mappingValue} className="flex items-start space-x-2 py-1 px-2 rounded hover:bg-background/50 transition-colors">
                                                        <Checkbox
                                                          id={`subtype-${category}-${assetType}-${attributeName}-${mappingValue}`}
                                                          checked={selectedAssetTypes.includes(mappingValue)}
                                                          onCheckedChange={() => toggleAssetType(mappingValue)}
                                                          className="mt-0.5"
                                                        />
                                                        <label
                                                          htmlFor={`subtype-${category}-${assetType}-${attributeName}-${mappingValue}`}
                                                          className="text-xs leading-relaxed cursor-pointer hover:text-primary transition-colors flex-1"
                                                        >
                                                          {label}
                                                        </label>
                                                      </div>
                                                    );
                                                  })}
                                                </div>
                                              </CollapsibleContent>
                                            </Collapsible>
                                          );
                                        })}
                                      </div>
                                    </CollapsibleContent>
                                  </Collapsible>
                                );
                              })}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setSelectedRoads([]);
                  setSelectedConditions(["Good", "Fair", "Poor"]);
                  setSelectedAssetTypes([]);
                }}
              >
                Reset All Filters
              </Button>
            </div>
          </div>
        </ScrollArea>
      </Card>

      {/* Map Container - Using Leaflet (Offline capable) */}
      <div className="flex-1 relative">
        <LeafletMapView selectedRoadNames={selectedRoads} roads={roads} selectedAssetTypes={selectedAssetTypes} />
      </div>

      {/* Asset Detail Dialog */}
      <Dialog open={isDetailDialogOpen} onOpenChange={setIsDetailDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              Asset Details
            </DialogTitle>
            <DialogDescription>
              AI-detected asset with metadata and confidence information
            </DialogDescription>
          </DialogHeader>

          {selectedAsset && (
            <div className="space-y-6">
              {/* Mock Asset Image */}
              <div className="aspect-video bg-gradient-to-br from-muted to-muted/50 rounded-lg flex items-center justify-center relative overflow-hidden">
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAwIDEwIEwgNDAgMTAgTSAxMCAwIEwgMTAgNDAgTSAwIDIwIEwgNDAgMjAgTSAyMCAwIEwgMjAgNDAgTSAwIDMwIEwgNDAgMzAgTSAzMCAwIEwgMzAgNDAiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzAwMCIgb3BhY2l0eT0iMC4wMyIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-50"></div>
                <div className="text-center z-10">
                  <MapPin className="h-16 w-16 mx-auto mb-2 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">AI Survey Image</p>
                  <p className="text-xs text-muted-foreground mt-1">{selectedAsset.type}</p>
                </div>
                <Badge
                  className={cn(
                    "absolute top-4 right-4 font-bold",
                    selectedAsset.condition === "Good" && "bg-green-500 text-white",
                    selectedAsset.condition === "Fair" && "bg-amber-500 text-white",
                    selectedAsset.condition === "Poor" && "bg-red-500 text-white"
                  )}
                >
                  {selectedAsset.condition}
                </Badge>
              </div>

              {/* Metadata */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Asset Code</p>
                  <p className="font-mono font-bold text-primary">{selectedAsset.assetCode}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Asset Type</p>
                  <p className="font-semibold">{selectedAsset.type}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Category</p>
                  <Badge variant="secondary">{selectedAsset.category}</Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <Percent className="h-3 w-3" />
                    AI Confidence
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-primary to-accent"
                        style={{ width: `${selectedAsset.confidence * 100}%` }}
                      />
                    </div>
                    <span className="font-bold text-primary text-sm">
                      {(selectedAsset.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    Location
                  </p>
                  <p className="font-mono text-xs">{selectedAsset.lat.toFixed(5)}, {selectedAsset.lng.toFixed(5)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Route</p>
                  <Badge variant="outline" className="font-mono font-bold">{selectedAsset.routeId}</Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Survey Date
                  </p>
                  <p className="text-sm">{selectedAsset.surveyDate}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <User className="h-3 w-3" />
                    Surveyor
                  </p>
                  <p className="text-sm">{selectedAsset.surveyorName}</p>
                </div>
              </div>

              {/* Category Attributes Section */}
              {selectedAsset.category && (() => {
                const assetTypeData = findAssetCategoryForType(selectedAsset.category);
                return assetTypeData && (
                  <div className="border-t pt-4">
                    <h3 className="text-base font-semibold mb-3">Asset Attributes</h3>
                    <p className="text-xs text-muted-foreground mb-3">
                      Category: {assetTypeData.category} → Type: {selectedAsset.category}
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {Object.entries(assetTypeData.attributes).map(([attributeName, subtypes]) => (
                        <div key={attributeName} className="space-y-2">
                          <Label className="text-sm font-medium">
                            {attributeName}
                          </Label>
                          {subtypes && subtypes.length > 0 ? (
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  className="w-full justify-between h-9"
                                >
                                  <span className="text-muted-foreground text-sm">
                                    Select {attributeName.toLowerCase()}...
                                  </span>
                                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-[300px] p-0" align="start">
                                <Command>
                                  <CommandInput placeholder={`Search ${attributeName.toLowerCase()}...`} />
                                  <CommandEmpty>No option found.</CommandEmpty>
                                  <CommandGroup>
                                    <ScrollArea className="h-[200px]">
                                      {subtypes.map((subtype: Record<string, string>) => {
                                        // subtype is { "Display Label": "mapping_value" }
                                        const label = Object.keys(subtype)[0];
                                        const mappingValue = Object.values(subtype)[0];
                                        return (
                                          <CommandItem
                                            key={mappingValue}
                                            onSelect={() => {
                                              toast.success(`Selected: ${label} (${mappingValue})`);
                                            }}
                                          >
                                            <Check className="mr-2 h-4 w-4 opacity-0" />
                                            {label}
                                          </CommandItem>
                                        );
                                      })}
                                    </ScrollArea>
                                  </CommandGroup>
                                </Command>
                              </PopoverContent>
                            </Popover>
                          ) : (
                            <Input
                              placeholder={`Enter ${attributeName.toLowerCase()}`}
                              className="h-9"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Feedback Section */}
              <div className="border-t pt-4">
                <Label htmlFor="feedback" className="text-base font-semibold mb-2 block">
                  Provide Feedback on AI Inference
                </Label>
                <p className="text-sm text-muted-foreground mb-3">
                  Your feedback helps improve our AI model accuracy
                </p>
                <Textarea
                  id="feedback"
                  placeholder="Enter your feedback or corrections about this asset detection..."
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  className="min-h-[100px] resize-none"
                />
                <Button
                  onClick={handleSubmitFeedback}
                  className="w-full mt-3 gradient-primary text-white"
                >
                  <Send className="h-4 w-4 mr-2" />
                  Submit Feedback
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
