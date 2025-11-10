import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, Edit } from "lucide-react";
import { DetailedRoadAssets } from "@/data/roadSurveyData";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

interface AssetConditionReportProps {
  data: DetailedRoadAssets;
  roadLength: number;
}

export default function AssetConditionReport({ data, roadLength }: AssetConditionReportProps) {
  // Calculate defect breakdown by type
  const defectBreakdown = data.assets.reduce((acc, asset) => {
    const type = asset.type;
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const totalDefects = data.assets.length;

  // Calculate severity breakdown
  const severityBreakdown = data.assets.reduce((acc, asset) => {
    const condition = asset.condition || "Unknown";
    acc[condition] = (acc[condition] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const severityData = [
    { name: "Good", value: severityBreakdown["Good"] || 0, color: "hsl(142, 76%, 45%)" },
    { name: "Fair", value: severityBreakdown["Fair"] || 0, color: "hsl(38, 92%, 50%)" },
    { name: "Poor", value: severityBreakdown["Poor"] || 0, color: "hsl(0, 84%, 60%)" }
  ].filter(item => item.value > 0);

  // Calculate IRC rating (simplified calculation based on conditions)
  const goodPercent = ((severityBreakdown["Good"] || 0) / totalDefects) * 100;
  const fairPercent = ((severityBreakdown["Fair"] || 0) / totalDefects) * 100;
  const poorPercent = ((severityBreakdown["Poor"] || 0) / totalDefects) * 100;
  
  const ircScore = (goodPercent * 0.9 + fairPercent * 0.5 + poorPercent * 0.1).toFixed(2);
  const ircLevel = parseFloat(ircScore) > 80 ? 1 : parseFloat(ircScore) > 60 ? 2 : parseFloat(ircScore) > 40 ? 3 : 4;

  // Distribution per chainage (simplified - divide road into segments)
  const numSegments = 20;
  const segmentLength = roadLength / numSegments;
  const chainageData = Array.from({ length: numSegments }, (_, i) => {
    const chainageStart = i * segmentLength;
    const chainageEnd = (i + 1) * segmentLength;
    const assetsInSegment = data.assets.filter(asset => {
      // Simplified location-based filtering
      return true; // In real scenario, would use GPS coordinates
    });
    
    return {
      chainage: `${(chainageStart * 1000).toFixed(0)}m`,
      count: Math.floor(Math.random() * 15) + 5, // Simulated for demo
      good: Math.floor(Math.random() * 5),
      fair: Math.floor(Math.random() * 8),
      poor: Math.floor(Math.random() * 10)
    };
  });

  // Split defects into two columns
  const defectEntries = Object.entries(defectBreakdown);
  const midpoint = Math.ceil(defectEntries.length / 2);
  const leftColumn = defectEntries.slice(0, midpoint);
  const rightColumn = defectEntries.slice(midpoint);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b pb-4">
        <h2 className="text-2xl font-bold">RoadVision AI Road Inspection Report</h2>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="h-4 w-4" />
          <span>{new Date().toLocaleDateString('en-GB', { 
            weekday: 'short', 
            day: '2-digit', 
            month: 'short', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'short'
          })}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Overview Card */}
        <Card className="p-6 space-y-4">
          <h3 className="text-lg font-bold border-b pb-2">Overview</h3>
          
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Road Name</p>
                <p className="font-semibold">{data.roadName}</p>
              </div>
              <Edit className="h-4 w-4 text-blue-500 cursor-pointer flex-shrink-0" />
            </div>

            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Starting Point</p>
                <p className="font-semibold">{data.roadName.split(' -> ')[0] || 'N/A'}</p>
              </div>
              <Edit className="h-4 w-4 text-blue-500 cursor-pointer flex-shrink-0" />
            </div>

            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Ending Point</p>
                <p className="font-semibold">{data.roadName.split(' -> ')[1] || 'N/A'}</p>
              </div>
              <Edit className="h-4 w-4 text-blue-500 cursor-pointer flex-shrink-0" />
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Road Length</p>
              <p className="font-semibold">{roadLength.toFixed(2)} KM</p>
            </div>
          </div>
        </Card>

        {/* Defect Breakdown Card */}
        <Card className="p-6 space-y-4">
          <h3 className="text-lg font-bold border-b pb-2">Defect Breakdown</h3>
          
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            {leftColumn.map(([type, count]) => (
              <div key={type} className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{type}</span>
                <Badge variant="secondary" className="font-bold">{count}</Badge>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            {rightColumn.map(([type, count]) => (
              <div key={type} className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{type}</span>
                <Badge variant="secondary" className="font-bold">{count}</Badge>
              </div>
            ))}
          </div>

          <div className="pt-4 border-t mt-4">
            <div className="flex items-center justify-between">
              <span className="text-base font-bold">Total Defect</span>
              <Badge className="text-lg font-bold px-3 py-1">{totalDefects}</Badge>
            </div>
          </div>
        </Card>

        {/* IRC Rating Card */}
        <Card className="p-6 space-y-4">
          <h3 className="text-lg font-bold border-b pb-2">IRC Rating</h3>
          
          <div className="flex items-center justify-center py-4">
            <div className="relative">
              <svg width="200" height="200" viewBox="0 0 200 200">
                <circle
                  cx="100"
                  cy="100"
                  r="80"
                  fill="none"
                  stroke="hsl(var(--muted))"
                  strokeWidth="20"
                />
                <circle
                  cx="100"
                  cy="100"
                  r="80"
                  fill="none"
                  stroke="hsl(38, 92%, 50%)"
                  strokeWidth="20"
                  strokeDasharray={`${(parseFloat(ircScore) / 100) * 502.65} 502.65`}
                  strokeLinecap="round"
                  transform="rotate(-90 100 100)"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-sm font-semibold text-muted-foreground">LEVEL {ircLevel}</p>
                <p className="text-3xl font-bold">{ircScore}</p>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Severity Breakdown */}
        <Card className="p-6 space-y-4">
          <h3 className="text-lg font-bold border-b pb-2">Severity Breakdown</h3>
          
          <div className="flex items-center gap-6">
            <ResponsiveContainer width="60%" height={250}>
              <PieChart>
                <Pie
                  data={severityData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ percent }) => `${(percent * 100).toFixed(1)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {severityData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>

            <div className="space-y-3">
              {severityData.map((item) => (
                <div key={item.name} className="flex items-center gap-2">
                  <div 
                    className="w-3 h-3 rounded-full" 
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-sm font-medium">{item.name}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Distribution per Chainage */}
        <Card className="p-6 space-y-4">
          <h3 className="text-lg font-bold border-b pb-2">Distribution of Defects per Chainage</h3>
          
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chainageData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis 
                dataKey="chainage" 
                angle={-45} 
                textAnchor="end" 
                height={80}
                tick={{ fontSize: 10 }}
              />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="hsl(0, 84%, 60%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}
