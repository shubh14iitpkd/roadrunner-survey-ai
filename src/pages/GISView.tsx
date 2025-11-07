import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { mockDetectedAssets } from "@/data/mockAssetData";
import { assetCategories } from "@/data/assetCategories";
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

export default function GISView() {
  const [selectedRoads, setSelectedRoads] = useState<string[]>([]);
  const [selectedConditions, setSelectedConditions] = useState<string[]>(["Good", "Fair", "Poor"]);
  const [selectedAssetTypes, setSelectedAssetTypes] = useState<string[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<typeof mockDetectedAssets[0] | null>(null);
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [roadSelectorOpen, setRoadSelectorOpen] = useState(false);
  const [assetSearchQuery, setAssetSearchQuery] = useState("");

  // Get unique roads with their route IDs from assets
  const availableRoads = useMemo(() => {
    const roadMap = new Map<string, string>();
    mockDetectedAssets.forEach(asset => {
      if (!roadMap.has(asset.roadName)) {
        roadMap.set(asset.roadName, asset.routeId);
      }
    });
    return Array.from(roadMap.entries())
      .map(([name, routeId]) => ({ name, routeId }))
      .sort((a, b) => a.routeId.localeCompare(b.routeId));
  }, []);

  const filteredAssets = mockDetectedAssets.filter(asset => {
    const matchesRoad = selectedRoads.length === 0 || selectedRoads.includes(asset.roadName);
    const matchesCondition = selectedConditions.includes(asset.condition);
    const matchesType = selectedAssetTypes.length === 0 || selectedAssetTypes.includes(asset.type);
    return matchesRoad && matchesCondition && matchesType;
  });

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
    const grouped: Record<string, typeof mockDetectedAssets> = {};
    filteredAssets.forEach(asset => {
      if (!grouped[asset.roadName]) {
        grouped[asset.roadName] = [];
      }
      grouped[asset.roadName].push(asset);
    });
    return grouped;
  }, [filteredAssets]);

  // Get asset types by category
  const getAssetTypesByCategory = (category: string) => {
    return Array.from(new Set(mockDetectedAssets
      .filter(a => a.category === category)
      .map(a => a.type)));
  };

  // Filter categories and asset types based on search query
  const filteredCategories = useMemo(() => {
    if (!assetSearchQuery.trim()) {
      return assetCategories.map(category => ({
        category,
        assetTypes: getAssetTypesByCategory(category)
      }));
    }

    const query = assetSearchQuery.toLowerCase().trim();
    return assetCategories
      .map(category => {
        const assetTypes = getAssetTypesByCategory(category).filter(type =>
          type.toLowerCase().includes(query)
        );
        return { category, assetTypes };
      })
      .filter(item => 
        item.category.toLowerCase().includes(query) || 
        item.assetTypes.length > 0
      );
  }, [assetSearchQuery]);


  return (
    <div className="flex h-screen">
      {/* Left Sidebar - Filters */}
      <Card className="w-96 rounded-none border-r shadow-elevated overflow-hidden flex flex-col bg-gradient-to-b from-background to-muted/20">
        <div className="p-6 border-b bg-gradient-to-br from-primary/10 via-primary/5 to-background backdrop-blur-sm">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Filter className="h-5 w-5 text-primary" />
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
                  <MapPin className="h-4 w-4 text-primary" />
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
                          const assetCount = mockDetectedAssets.filter(a => a.roadName === road.name).length;
                          
                          return (
                            <CommandItem
                              key={road.name}
                              value={`${road.routeId} ${road.name}`}
                              onSelect={() => {
                                toggleRoad(road.name);
                              }}
                              className="cursor-pointer"
                            >
                              <div className="flex items-center gap-2 flex-1">
                                <div
                                  className={cn(
                                    "mr-2 flex h-4 w-4 items-center justify-center rounded border border-primary",
                                    isSelected
                                      ? "bg-primary text-primary-foreground"
                                      : "opacity-50"
                                  )}
                                >
                                  {isSelected && <Check className="h-3 w-3" />}
                                </div>
                                <div className="flex-1 flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="font-mono text-xs">
                                      {road.routeId}
                                    </Badge>
                                    <span className="text-sm">{road.name}</span>
                                  </div>
                                  <Badge variant="secondary" className="text-xs">
                                    {assetCount}
                                  </Badge>
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

            <div className="border-t pt-6">
              {/* Condition Filter */}
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
                      No asset types found
                    </div>
                  ) : (
                    filteredCategories.map(({ category, assetTypes }) => {
                      const isExpanded = expandedCategories.includes(category);
                      
                      return (
                        <Collapsible key={category} open={isExpanded} onOpenChange={() => toggleCategory(category)}>
                          <CollapsibleTrigger className="flex items-center justify-between w-full p-3 rounded-lg hover:bg-muted transition-colors border bg-card">
                            <span className="text-sm font-medium text-left">{category}</span>
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary" className="text-xs font-mono">
                                {assetTypes.length}
                              </Badge>
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-primary" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </div>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="pl-4 pt-2 pb-2 space-y-2 bg-muted/30 rounded-b-lg">
                              {assetTypes.map((assetType) => (
                                <div key={assetType} className="flex items-start space-x-3 py-1.5 px-2 rounded hover:bg-background/50 transition-colors">
                                  <Checkbox
                                    id={`asset-${assetType}`}
                                    checked={selectedAssetTypes.includes(assetType)}
                                    onCheckedChange={() => toggleAssetType(assetType)}
                                    className="mt-0.5"
                                  />
                                  <label
                                    htmlFor={`asset-${assetType}`}
                                    className="text-xs leading-relaxed cursor-pointer hover:text-primary transition-colors flex-1"
                                  >
                                    {assetType}
                                  </label>
                                </div>
                              ))}
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

      {/* Mock Map Container */}
      <div className="flex-1 relative">
        {/* Mock Map Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-100 via-slate-50 to-blue-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
          {/* Fine grid pattern */}
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAwIDEwIEwgMjAgMTAgTSAxMCAwIEwgMTAgMjAiIGZpbGw9Im5vbmUiIHN0cm9rZT0iY3VycmVudENvbG9yIiBvcGFjaXR5PSIwLjAzIiBzdHJva2Utd2lkdGg9IjAuNSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmlkKSIvPjwvc3ZnPg==')] opacity-100"></div>
          
          {/* Road Network */}
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <filter id="roadShadow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur in="SourceAlpha" stdDeviation="0.3"/>
                <feOffset dx="0" dy="0.2" result="offsetblur"/>
                <feComponentTransfer>
                  <feFuncA type="linear" slope="0.3"/>
                </feComponentTransfer>
                <feMerge>
                  <feMergeNode/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
            </defs>
            
            {/* Render only selected roads or all if none selected */}
            {Object.entries(roadPaths).map(([roadName, path]) => {
              const shouldShow = selectedRoads.length === 0 || selectedRoads.includes(roadName);
              if (!shouldShow) return null;
              
              return (
                <g key={roadName}>
                  {/* Road outline */}
                  <path
                    d={path}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    className="opacity-20 dark:opacity-30"
                    filter="url(#roadShadow)"
                  />
                  {/* Road center line */}
                  <path
                    d={path}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="0.3"
                    strokeLinecap="round"
                    strokeDasharray="2,2"
                    className="opacity-10 dark:opacity-20"
                  />
                </g>
              );
            })}
          </svg>

          {/* Asset Markers - positioned along roads */}
          {Object.entries(assetsByRoad).map(([roadName, assets]) => {
            return assets.map((asset, index) => {
              const { x, y } = getPositionOnRoad(roadName, index, assets.length);
              const color = getConditionColor(asset.condition);
              
              return (
                <button
                  key={asset.id}
                  className="absolute transform -translate-x-1/2 -translate-y-1/2 transition-all hover:scale-125 hover:z-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-full animate-fade-in group"
                  style={{
                    left: `${x}%`,
                    top: `${y}%`,
                    animationDelay: `${index * 20}ms`
                  }}
                  onClick={() => {
                    setSelectedAsset(asset);
                    setIsDetailDialogOpen(true);
                  }}
                >
                  <div
                    className="w-4 h-4 rounded-full border-[2.5px] border-white dark:border-slate-900 shadow-lg cursor-pointer relative"
                    style={{ backgroundColor: color }}
                  >
                    <div 
                      className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ 
                        backgroundColor: color,
                        filter: 'blur(8px)',
                        transform: 'scale(2)'
                      }}
                    />
                  </div>
                  {/* Tooltip on hover */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-background/95 backdrop-blur-sm border rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap text-xs">
                    <div className="font-semibold">{asset.type}</div>
                    <div className="text-muted-foreground">{asset.roadName}</div>
                  </div>
                </button>
              );
            });
          })}
        </div>
        
        {/* Mock Map Label */}
        <div className="absolute top-4 left-4 bg-background/95 backdrop-blur-sm px-4 py-2 rounded-lg shadow-lg border">
          <p className="text-sm font-semibold">Doha Road Network</p>
          <p className="text-xs text-muted-foreground">Mock Map Visualization</p>
        </div>
        
        {/* Legend */}
        <Card className="absolute top-4 right-4 p-4 shadow-elevated border-0 gradient-card">
          <h3 className="font-semibold text-sm mb-3">Legend</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <div className="w-4 h-4 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: "#10b981" }} />
              <span>Good Condition</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <div className="w-4 h-4 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: "#f59e0b" }} />
              <span>Fair Condition</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <div className="w-4 h-4 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: "#ef4444" }} />
              <span>Poor Condition</span>
            </div>
          </div>
        </Card>
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

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
