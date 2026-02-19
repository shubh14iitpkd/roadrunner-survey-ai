import { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import LeafletMapView from "@/components/LeafletMapView";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import {
  MapPin, X, Filter, Download, Eye, Database,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { assetTypes } from "@/data/assetCategories";

interface AssetRow {
  assetId: string;
  assetType: string;
  assetCategory: string;
  lat: number;
  lng: number;
  roadName: string;
  direction: "LHS" | "RHS";
  side: "Shoulder" | "Median" | "Pavement" | "Overhead";
  lastSurveyDate: string;
  imageUrl?: string;
}

// Generate demo asset data
function generateDemoAssets(): AssetRow[] {
  const roads = [
    "Al Corniche Street", "West Bay Road", "Salwa Road", "C Ring Road",
    "Lusail Expressway", "Dukhan Highway", "Al Shamal Road", "Orbital Highway",
  ];
  const directions: ("LHS" | "RHS")[] = ["LHS", "RHS"];
  const sides: ("Shoulder" | "Median" | "Pavement" | "Overhead")[] = [
    "Shoulder", "Median", "Pavement", "Overhead",
  ];

  const allAssets: AssetRow[] = [];

  assetTypes.forEach((at, idx) => {
    const count = Math.floor(Math.random() * 5) + 1;
    for (let j = 0; j < count; j++) {
      allAssets.push({
        assetId: `AST-${String(allAssets.length + 1).padStart(5, "0")}`,
        assetType: at.type,
        assetCategory: at.category,
        lat: 25.2854 + (Math.random() - 0.5) * 0.15,
        lng: 51.531 + (Math.random() - 0.5) * 0.15,
        roadName: roads[Math.floor(Math.random() * roads.length)],
        direction: directions[Math.floor(Math.random() * 2)],
        side: sides[Math.floor(Math.random() * 4)],
        lastSurveyDate: `2025-${String(Math.floor(Math.random() * 3) + 9).padStart(2, "0")}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, "0")}`,
      });
    }
  });

  return allAssets;
}

export default function AssetRegister() {
  const [searchParams] = useSearchParams();
  const [roads, setRoads] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [selectedAssetTypes, setSelectedAssetTypes] = useState<string[]>([]);
  const [directionFilter, setDirectionFilter] = useState<"all" | "LHS" | "RHS">("all");
  const [sideFilter, setSideFilter] = useState<"all" | "Shoulder" | "Median" | "Pavement" | "Overhead">("all");

  // Selection
  const [selectedAsset, setSelectedAsset] = useState<AssetRow | null>(null);

  // Table pagination
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Demo data
  const [allAssets] = useState<AssetRow[]>(() => generateDemoAssets());

  // Load roads from API
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const roadsResp = await api.roads.list();
        if (roadsResp?.items) setRoads(roadsResp.items);
      } catch (err: any) {
        console.error("Failed to load roads:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Filtered assets
  const filteredAssets = useMemo(() => {
    return allAssets.filter((a) => {
      if (selectedAssetTypes.length > 0 && !selectedAssetTypes.includes(a.assetType)) return false;
      if (directionFilter !== "all" && a.direction !== directionFilter) return false;
      if (sideFilter !== "all" && a.side !== sideFilter) return false;
      return true;
    });
  }, [allAssets, selectedAssetTypes, directionFilter, sideFilter]);

  const totalPages = Math.ceil(filteredAssets.length / pageSize);
  const pagedAssets = filteredAssets.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => { setPage(1); }, [selectedAssetTypes, directionFilter, sideFilter]);

  const mapSelectedRoadNames = useMemo(() => {
    const roadParam = searchParams.get("road");
    return roadParam ? [roadParam] : [];
  }, [searchParams]);

  const handleRowClick = useCallback((asset: AssetRow) => {
    setSelectedAsset(asset);
  }, []);

  const handleExportExcel = () => {
    const headers = [
      "Asset ID", "Asset Type", "Category", "Latitude", "Longitude",
      "Road Name", "Direction", "Side", "Last Survey Date",
    ];
    const rows = filteredAssets.map((a) => [
      a.assetId, a.assetType, a.assetCategory,
      a.lat.toFixed(6), a.lng.toFixed(6), a.roadName, a.direction,
      a.side, a.lastSurveyDate,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "master-assets-library.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Asset library exported");
  };

  // Unique asset type options for filter
  const assetTypeOptions = useMemo(() => {
    const types = [...new Set(allAssets.map((a) => a.assetType))];
    return types.sort();
  }, [allAssets]);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <div className="relative overflow-hidden bg-primary px-6 py-4 shadow-elevated shrink-0">
        <div className="absolute bg-primary inset-0 opacity-30"></div>
        <div className="relative flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white drop-shadow-lg flex items-center gap-2">
              <Database className="h-6 w-6" />
              Master Assets Library
            </h1>
            <p className="text-white/80 text-sm">
              Digital asset register for the entire road network
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-sm font-bold px-3 py-1">
              {filteredAssets.length} assets
            </Badge>
            <Button
              variant="secondary"
              size="sm"
              className="gap-1"
              onClick={handleExportExcel}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="px-4 py-3 border-b bg-card flex flex-wrap items-center gap-3 shrink-0">
        <div className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
          <Filter className="h-4 w-4" />
          Filters:
        </div>

        <Select
          value={selectedAssetTypes[0] || "all"}
          onValueChange={(v) => setSelectedAssetTypes(v === "all" ? [] : [v])}
        >
          <SelectTrigger className="w-56 h-9">
            <SelectValue placeholder="All Asset Types" />
          </SelectTrigger>
          <SelectContent className="bg-background z-50 max-h-64">
            <SelectItem value="all">All Asset Types</SelectItem>
            {assetTypeOptions.map((t) => (
              <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Direction toggle */}
        <div className="flex rounded-md border overflow-hidden">
          {(["all", "LHS", "RHS"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDirectionFilter(d)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition-colors",
                directionFilter === d
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-muted"
              )}
            >
              {d === "all" ? "All" : d}
            </button>
          ))}
        </div>

        {/* Side toggle */}
        <div className="flex rounded-md border overflow-hidden">
          {(["all", "Shoulder", "Median", "Pavement", "Overhead"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSideFilter(s)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition-colors",
                sideFilter === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-muted"
              )}
            >
              {s === "all" ? "All" : s}
            </button>
          ))}
        </div>

        {(selectedAssetTypes.length > 0 || directionFilter !== "all" || sideFilter !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setSelectedAssetTypes([]);
              setDirectionFilter("all");
              setSideFilter("all");
            }}
          >
            <X className="h-3 w-3 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Main Content: Map (left) + Image (right) */}
      <div className="flex-1 flex min-h-0">
        {/* Map */}
        <div className="flex-1 relative min-w-0">
          <LeafletMapView
            selectedRoadNames={mapSelectedRoadNames}
            roads={roads}
            selectedAssetTypes={selectedAssetTypes}
          />
        </div>

        {/* Detail Panel */}
        <div className="w-80 border-l bg-card flex flex-col shrink-0">
          {selectedAsset ? (
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">
                {/* Image placeholder */}
                <div className="aspect-video bg-muted rounded-lg flex items-center justify-center relative overflow-hidden border">
                  {selectedAsset.imageUrl ? (
                    <img
                      src={selectedAsset.imageUrl}
                      alt="Asset"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center">
                      <Eye className="h-10 w-10 mx-auto mb-1 text-muted-foreground/40" />
                      <p className="text-xs text-muted-foreground">Asset Image</p>
                    </div>
                  )}
                </div>

                {/* Metadata */}
                <div className="space-y-3">
                  <h3 className="font-bold text-sm">Asset Details</h3>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Asset ID</p>
                      <p className="font-mono font-bold">{selectedAsset.assetId}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Asset Type</p>
                      <p className="font-medium">{selectedAsset.assetType}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Category</p>
                      <Badge variant="secondary" className="text-xs mt-0.5">
                        {selectedAsset.assetCategory}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Coordinates</p>
                      <p className="font-mono text-xs">
                        {selectedAsset.lat.toFixed(5)}, {selectedAsset.lng.toFixed(5)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Road</p>
                      <p className="font-medium">{selectedAsset.roadName}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Direction</p>
                      <Badge variant="outline">{selectedAsset.direction}</Badge>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Side</p>
                      <Badge variant="outline">{selectedAsset.side}</Badge>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Last Survey</p>
                      <p className="text-xs">{selectedAsset.lastSurveyDate}</p>
                    </div>
                  </div>
                </div>
              </div>
            </ScrollArea>
          ) : (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="text-center text-muted-foreground">
                <MapPin className="h-12 w-12 mx-auto mb-2 opacity-30" />
                <p className="text-sm font-medium">Select an asset</p>
                <p className="text-xs mt-1">Click a row in the table or a point on the map</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Table */}
      <div className="border-t bg-card shrink-0" style={{ maxHeight: "40%" }}>
        <div className="overflow-auto" style={{ maxHeight: "100%" }}>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="font-semibold text-xs">Asset ID</TableHead>
                <TableHead className="font-semibold text-xs">Asset Type</TableHead>
                <TableHead className="font-semibold text-xs">Category</TableHead>
                <TableHead className="font-semibold text-xs">Coordinates</TableHead>
                <TableHead className="font-semibold text-xs">Road</TableHead>
                <TableHead className="font-semibold text-xs">Dir</TableHead>
                <TableHead className="font-semibold text-xs">Side</TableHead>
                <TableHead className="font-semibold text-xs">Survey Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedAssets.map((a) => (
                <TableRow
                  key={a.assetId}
                  className={cn(
                    "cursor-pointer hover:bg-muted/30 text-xs",
                    selectedAsset?.assetId === a.assetId && "bg-primary/10"
                  )}
                  onClick={() => handleRowClick(a)}
                >
                  <TableCell className="font-mono font-bold">{a.assetId}</TableCell>
                  <TableCell className="max-w-32 truncate">{a.assetType}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">{a.assetCategory}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {a.lat.toFixed(4)}, {a.lng.toFixed(4)}
                  </TableCell>
                  <TableCell className="max-w-28 truncate">{a.roadName}</TableCell>
                  <TableCell>{a.direction}</TableCell>
                  <TableCell>{a.side}</TableCell>
                  <TableCell>{a.lastSurveyDate}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-2 border-t text-xs text-muted-foreground">
          <span>
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredAssets.length)} of {filteredAssets.length}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-3 w-3" />
            </Button>
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
