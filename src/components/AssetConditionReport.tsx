import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Eye, Calendar, Download } from "lucide-react";
import { DetailedRoadAssets } from "@/data/roadSurveyData";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import * as XLSX from "xlsx";

interface AssetConditionReportProps {
  data: DetailedRoadAssets;
  roadLength: number;
}

export default function AssetConditionReport({ data, roadLength }: AssetConditionReportProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isImageDialogOpen, setIsImageDialogOpen] = useState(false);

  const handleViewPhoto = (imageUrl: string) => {
    setSelectedImage(imageUrl);
    setIsImageDialogOpen(true);
  };

  const exportToCSV = () => {
    const csvRows = [];
    // Headers
    csvRows.push([
      "Asset ID",
      "GPS Start",
      "GPS End",
      "Asset Name",
      "Asset Type",
      "Anomaly Name",
      "Anomaly Description"
    ].join(","));

    // Data rows
    data.assets.forEach((asset) => {
      const gpsStart = `${asset.lat.toFixed(6)} ${asset.lng.toFixed(6)}`;
      const gpsEnd = `${(asset.lat + 0.0001).toFixed(6)} ${(asset.lng + 0.0001).toFixed(6)}`;
      const anomalyName = asset.condition === "Poor" ? "Deterioration Detected" :
                          asset.condition === "Fair" ? "Minor Wear" : "No defect";
      const anomalyDesc = asset.notes || 
                          (asset.condition === "Poor" ? "Asset shows signs of significant wear and requires maintenance attention" :
                           asset.condition === "Fair" ? "Asset is functioning but showing minor wear" :
                           "Asset in good condition");
      
      csvRows.push([
        asset.id,
        `"${gpsStart}"`,
        `"${gpsEnd}"`,
        `"${asset.type}"`,
        asset.category,
        anomalyName,
        `"${anomalyDesc}"`
      ].join(","));
    });

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `asset-condition-report-${data.routeId}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToExcel = () => {
    const worksheetData = [
      ["Asset Condition Report"],
      ["Road Name:", data.roadName],
      ["Route ID:", data.routeId],
      ["Road Length:", `${roadLength.toFixed(2)} KM`],
      ["Survey Date:", data.surveyDate],
      ["Total Assets:", data.assets.length],
      ["Anomalies Detected:", data.assets.filter(a => a.condition === "Poor" || a.condition === "Fair").length],
      [],
      ["Asset ID", "GPS Start", "GPS End", "Asset Name", "Asset Type", "Anomaly Name", "Anomaly Description"],
    ];

    data.assets.forEach((asset) => {
      const gpsStart = `${asset.lat.toFixed(6)}, ${asset.lng.toFixed(6)}`;
      const gpsEnd = `${(asset.lat + 0.0001).toFixed(6)}, ${(asset.lng + 0.0001).toFixed(6)}`;
      const anomalyName = asset.condition === "Poor" ? "Deterioration Detected" :
                          asset.condition === "Fair" ? "Minor Wear" : "No defect";
      const anomalyDesc = asset.notes || 
                          (asset.condition === "Poor" ? "Asset shows signs of significant wear and requires maintenance attention" :
                           asset.condition === "Fair" ? "Asset is functioning but showing minor wear" :
                           "Asset in good condition");
      
      worksheetData.push([
        asset.id,
        gpsStart,
        gpsEnd,
        asset.type,
        asset.category,
        anomalyName,
        anomalyDesc
      ]);
    });

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Asset Report");
    XLSX.writeFile(workbook, `asset-condition-report-${data.routeId}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="gradient-primary p-6 rounded-xl shadow-elevated">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white mb-1">Asset Condition Report</h2>
            <p className="text-white/90">{data.roadName}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-white/90 bg-white/10 px-4 py-2 rounded-lg">
              <Calendar className="h-4 w-4" />
              <span>{data.surveyDate}</span>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="bg-white/20 hover:bg-white/30 text-white border-white/30">
                  <Download className="h-4 w-4 mr-2" />
                  Download Report
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportToExcel}>
                  <Download className="h-4 w-4 mr-2" />
                  Export as Excel
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportToCSV}>
                  <Download className="h-4 w-4 mr-2" />
                  Export as CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Overview Card */}
      <Card className="p-6 gradient-card border-0 shadow-elevated">
        <h3 className="text-lg font-bold mb-4">Overview</h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Road Name</p>
            <p className="font-semibold">{data.roadName}</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Route ID</p>
            <p className="font-semibold font-mono">{data.routeId}</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Road Length</p>
            <p className="font-semibold">{roadLength.toFixed(2)} KM</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Total Assets</p>
            <Badge variant="secondary" className="font-bold text-lg px-3 py-1">
              {data.assets.length}
            </Badge>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Anomalies Detected</p>
            <Badge variant="destructive" className="font-bold text-lg px-3 py-1">
              {data.assets.filter(asset => asset.condition === "Poor" || asset.condition === "Fair").length}
            </Badge>
          </div>
        </div>
      </Card>

      {/* Statistics Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-6 gradient-card border-0 shadow-elevated">
          <h3 className="text-lg font-bold mb-4">Asset Distribution by Category</h3>
          <div className="h-48">
            <div className="flex items-end justify-around h-full gap-2 pb-8">
              {Object.entries(
                data.assets.reduce((acc, asset) => {
                  acc[asset.category] = (acc[asset.category] || 0) + 1;
                  return acc;
                }, {} as Record<string, number>)
              ).map(([category, count]) => {
                const maxCount = Math.max(...Object.values(
                  data.assets.reduce((acc, asset) => {
                    acc[asset.category] = (acc[asset.category] || 0) + 1;
                    return acc;
                  }, {} as Record<string, number>)
                ));
                const heightPercentage = (count / maxCount) * 100;
                
                return (
                  <div key={category} className="flex-1 flex flex-col items-center gap-2">
                    <div className="text-sm font-bold text-primary">{count}</div>
                    <div 
                      className="w-full bg-gradient-to-t from-primary to-primary/60 rounded-t-lg transition-all duration-500 hover:from-primary hover:to-primary/80"
                      style={{ height: `${heightPercentage}%` }}
                    />
                    <div className="text-xs font-medium text-center text-muted-foreground px-2">{category}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        <Card className="p-6 gradient-card border-0 shadow-elevated md:col-span-2">
          <h3 className="text-lg font-bold mb-4">Distribution of Defects per Chainage</h3>
          <div className="h-48">
            <div className="flex items-end justify-around h-full gap-2 pb-8">
              {(() => {
                // Create chainage segments (0-2km, 2-4km, etc.)
                const chainageSegments = Math.ceil(roadLength / 2);
                const defectsBySegment = Array(chainageSegments).fill(0);
                
                // Count defects (Poor or Fair condition) in each segment
                data.assets.forEach((asset) => {
                  if (asset.condition === "Poor" || asset.condition === "Fair") {
                    // Calculate approximate chainage based on position in array
                    const assetIndex = data.assets.indexOf(asset);
                    const chainageKm = (assetIndex / data.assets.length) * roadLength;
                    const segmentIndex = Math.floor(chainageKm / 2);
                    if (segmentIndex < chainageSegments) {
                      defectsBySegment[segmentIndex]++;
                    }
                  }
                });

                const maxDefects = Math.max(...defectsBySegment, 1);
                
                return defectsBySegment.map((count, index) => {
                  const heightPercentage = (count / maxDefects) * 100;
                  const chainageStart = index * 2;
                  const chainageEnd = chainageStart + 2;
                  
                  return (
                    <div key={index} className="flex-1 flex flex-col items-center gap-2">
                      <div className="text-sm font-bold text-destructive">{count}</div>
                      <div 
                        className="w-full bg-gradient-to-t from-destructive to-destructive/60 rounded-t-lg transition-all duration-500 hover:from-destructive hover:to-destructive/80"
                        style={{ height: `${Math.max(heightPercentage, 5)}%` }}
                      />
                      <div className="text-xs font-medium text-center text-muted-foreground">
                        {chainageStart}-{Math.min(chainageEnd, roadLength)}km
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </Card>
      </div>

      {/* Asset Details Table */}
      <Card className="shadow-elevated border-0 gradient-card overflow-hidden">
        <div className="p-6 border-b bg-gradient-to-r from-primary/5 via-accent/5 to-primary/5">
          <h3 className="text-lg font-bold">Asset Details</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gradient-to-r from-primary/5 via-accent/5 to-primary/5 border-b-2 border-primary/20">
              <tr>
                <th className="text-left p-4 font-bold text-sm uppercase tracking-wide">Asset ID</th>
                <th className="text-left p-4 font-bold text-sm uppercase tracking-wide">Location (GIS)</th>
                <th className="text-left p-4 font-bold text-sm uppercase tracking-wide">Asset Name</th>
                <th className="text-left p-4 font-bold text-sm uppercase tracking-wide">Asset Type</th>
                <th className="text-left p-4 font-bold text-sm uppercase tracking-wide">Anomaly Name</th>
                <th className="text-left p-4 font-bold text-sm uppercase tracking-wide">Anomaly Description</th>
                <th className="text-left p-4 font-bold text-sm uppercase tracking-wide">View Photo</th>
              </tr>
            </thead>
            <tbody>
              {data.assets.map((asset) => {
                const gpsStart = `${asset.lat.toFixed(6)}, ${asset.lng.toFixed(6)}`;
                const gpsEnd = `${(asset.lat + 0.0001).toFixed(6)}, ${(asset.lng + 0.0001).toFixed(6)}`;
                const photoUrl = `https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=800&auto=format&fit=crop`;
                
                return (
                  <tr
                    key={asset.id}
                    className="border-b hover:bg-gradient-to-r hover:from-primary/5 hover:to-transparent transition-all duration-200"
                  >
                    <td className="p-4">
                      <span className="font-mono font-semibold text-primary">{asset.id}</span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-start gap-1 text-sm">
                        <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="font-medium">Start: {gpsStart}</div>
                          <div className="text-muted-foreground text-xs">End: {gpsEnd}</div>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 font-semibold">{asset.type}</td>
                    <td className="p-4">
                      <Badge variant="secondary" className="font-medium">{asset.category}</Badge>
                    </td>
                    <td className="p-4">
                      {asset.condition === "Poor" ? (
                        <span className="font-medium text-red-700 dark:text-red-400">Deterioration Detected</span>
                      ) : asset.condition === "Fair" ? (
                        <span className="font-medium text-amber-700 dark:text-amber-400">Minor Wear</span>
                      ) : (
                        <span className="text-muted-foreground italic">No defect</span>
                      )}
                    </td>
                    <td className="p-4 max-w-xs">
                      {asset.notes ? (
                        <span className="text-sm">{asset.notes}</span>
                      ) : asset.condition === "Poor" ? (
                        <span className="text-sm">Asset shows signs of significant wear and requires maintenance attention</span>
                      ) : asset.condition === "Fair" ? (
                        <span className="text-sm">Asset is functioning but showing minor wear</span>
                      ) : (
                        <span className="text-muted-foreground italic text-sm">Asset in good condition</span>
                      )}
                    </td>
                    <td className="p-4">
                      <Button
                        size="sm"
                        onClick={() => handleViewPhoto(photoUrl)}
                        className="h-9 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white shadow-md"
                      >
                        <Eye className="h-3 w-3 mr-2" />
                        View
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {data.assets.length === 0 && (
          <div className="text-center py-16">
            <p className="text-muted-foreground">No assets found for this survey</p>
          </div>
        )}
      </Card>

      {/* Image Viewer Dialog */}
      <Dialog open={isImageDialogOpen} onOpenChange={setIsImageDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Asset Photo</DialogTitle>
          </DialogHeader>
          {selectedImage && (
            <div className="relative w-full h-[60vh] bg-muted rounded-lg overflow-hidden">
              <img 
                src={selectedImage} 
                alt="Asset location" 
                className="w-full h-full object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
