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
  Calendar, User, Percent, AlertCircle, X, Filter, Check, ChevronsUpDown, Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
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
import { useLabelMap } from "@/contexts/LabelMapContext";

export default function GISView() {
  const [searchParams] = useSearchParams();
  const [selectedRoads, setSelectedRoads] = useState<string[]>([]);
  const [selectedConditions, setSelectedConditions] = useState<string[]>(["Good", "Fair", "Poor"]);
  const [selectedAssetTypes, setSelectedAssetTypes] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<any | null>(null);
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [roadSelectorOpen, setRoadSelectorOpen] = useState(false);
  const [assetSearchQuery, setAssetSearchQuery] = useState("");
  const [roads, setRoads] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Get label map from context
  const { data: labelMapData } = useLabelMap();

  // Load data from API on mount
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [roadsResp, assetsResp] = await Promise.all([
          api.roads.list(),
          api.assets.list(),
        ]);
        if (roadsResp?.items) setRoads(roadsResp.items);
        if (assetsResp?.items) setAssets(assetsResp.items);
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
      
      // Filter by category OR asset type
      const matchesFilter = 
        (selectedCategories.length === 0 && selectedAssetTypes.length === 0) || // No filters
        selectedCategories.includes(asset.category) || // Category is selected
        selectedAssetTypes.includes(asset.asset_id); // Asset type is selected
      
      return matchesRoad && matchesCondition && matchesFilter;
    });
  }, [assets, roads, selectedRoads, selectedConditions, selectedCategories, selectedAssetTypes]);

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

  const toggleAssetType = (assetId: string) => {
    setSelectedAssetTypes(prev =>
      prev.includes(assetId)
        ? prev.filter(t => t !== assetId)
        : [...prev, assetId]
    );
  };

  const toggleCategoryFilter = (categoryId: string) => {
    setSelectedCategories(prev =>
      prev.includes(categoryId)
        ? prev.filter(c => c !== categoryId)
        : [...prev, categoryId]
    );
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

  // Build category tree from label map context
  const categoryTree = useMemo(() => {
    if (!labelMapData) return [];

    // Group asset types by category using the category_id from label data
    const categoriesMap = new Map<string, { categoryId: string; categoryName: string; assetTypes: Array<{ assetId: string; assetName: string }> }>();

    // Process all labels (asset types) and group by their category_id
    Object.entries(labelMapData.labels).forEach(([assetId, labelData]) => {
      // Each label has a category_id field from the backend
      const categoryId = (labelData as any).category_id;
      
      if (!categoryId) return; // Skip if no category mapping

      if (!categoriesMap.has(categoryId)) {
        // Find category display name from labelMapData.categories
        const categoryData = labelMapData.categories[categoryId];
        categoriesMap.set(categoryId, {
          categoryId: categoryId,
          categoryName: categoryData?.display_name || categoryId,
          assetTypes: []
        });
      }

      const category = categoriesMap.get(categoryId)!;
      category.assetTypes.push({
        assetId: assetId,
        assetName: labelData.display_name
      });
    });

    return Array.from(categoriesMap.values()).sort((a, b) => a.categoryName.localeCompare(b.categoryName));
  }, [labelMapData]);

  // Filter categories based on search query
  const filteredCategoryTree = useMemo(() => {
    const query = assetSearchQuery.toLowerCase().trim();

    if (!query) {
      return categoryTree;
    }

    // Filter by category name or asset type name
    return categoryTree
      .map(category => ({
        ...category,
        assetTypes: category.assetTypes.filter(assetType =>
          category.categoryName.toLowerCase().includes(query) ||
          assetType.assetName.toLowerCase().includes(query)
        )
      }))
      .filter(category =>
        category.categoryName.toLowerCase().includes(query) ||
        category.assetTypes.length > 0
      );
  }, [assetSearchQuery, categoryTree]);



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
                    disabled={loading}
                    className="w-full justify-between h-auto min-h-10 py-2"
                  >
                    <span className="truncate text-left flex-1 flex items-center gap-2">
                      {loading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                      {loading ? (
                        "Loading roads..."
                      ) : selectedRoads.length === 0 ? (
                        "Select roads..."
                      ) : selectedRoads.length === 1 ? (
                        selectedRoads[0]
                      ) : (
                        `${selectedRoads.length} roads selected`
                      )}
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
                                    {/* <Badge variant="secondary" className="text-xs">
                                      {assetCount}
                                    </Badge> */}
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
                  {filteredCategoryTree.length === 0 ? (
                    <div className="text-center py-8 text-sm text-muted-foreground">
                      No asset categories found
                    </div>
                  ) : (
                    filteredCategoryTree.map(({ categoryId, categoryName, assetTypes }) => {
                      const isCategoryExpanded = expandedCategories.includes(categoryId);
                      const isCategorySelected = selectedCategories.includes(categoryId);
                      
                      return (
                        <Collapsible 
                          key={categoryId} 
                          open={isCategoryExpanded} 
                          onOpenChange={() => toggleCategory(categoryId)}
                        >
                          {/* Level 1: Category with checkbox */}
                          <div className={cn(
                            "flex items-center gap-2 p-3 rounded-lg border transition-all",
                            isCategorySelected ? "bg-primary/10 border-primary" : "bg-card hover:bg-muted"
                          )}>
                            <Checkbox
                              id={`category-${categoryId}`}
                              checked={isCategorySelected}
                              onCheckedChange={() => toggleCategoryFilter(categoryId)}
                              className="mt-0.5"
                            />
                            <CollapsibleTrigger className="flex items-center justify-between flex-1">
                              <label
                                htmlFor={`category-${categoryId}`}
                                className="text-sm font-semibold text-left cursor-pointer flex-1"
                                onClick={(e) => e.preventDefault()}
                              >
                                {categoryName}
                              </label>
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
                          </div>
                          
                          <CollapsibleContent>
                            <div className="pl-3 pt-2 pb-2 space-y-1.5 bg-muted/10 rounded-b-lg border-l-2 border-primary/20 ml-3">
                              {/* Level 2: Asset Types with checkboxes */}
                              {assetTypes.map(({ assetId, assetName }) => {
                                const isAssetSelected = selectedAssetTypes.includes(assetId);
                                
                                return (
                                  <div 
                                    key={assetId}
                                    className={cn(
                                      "flex items-center space-x-2 p-2 rounded transition-colors",
                                      isAssetSelected ? "bg-primary/5" : "hover:bg-background/80"
                                    )}
                                  >
                                    <Checkbox
                                      id={`asset-${assetId}`}
                                      checked={isAssetSelected}
                                      onCheckedChange={() => toggleAssetType(assetId)}
                                      className="mt-0.5"
                                    />
                                    <label
                                      htmlFor={`asset-${assetId}`}
                                      className="text-xs font-medium cursor-pointer hover:text-primary transition-colors flex-1"
                                    >
                                      {assetName}
                                    </label>
                                  </div>
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
                  setSelectedCategories([]);
                }}
              >
                Reset All Filters
              </Button>
            </div>
          </div>
        </ScrollArea>
      </Card>

      <div className="flex-1 relative">
        <LeafletMapView 
          selectedRoadNames={selectedRoads} 
          roads={roads} 
          selectedAssetTypes={selectedAssetTypes} 
          selectedCategories={selectedCategories}
        />
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

