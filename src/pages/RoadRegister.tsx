import { useState } from "react";
import { roadRegister } from "@/data/roadRegister";
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

const ROAD_TYPES = [
  "National/Expressway",
  "Municipal/Urban Road",
  "Local Access Road",
  "Special Zone"
];

const ROAD_SIDES = ["LHS", "RHS"];

const CHART_COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))"];

export default function RoadRegister() {
  const [roads, setRoads] = useState(roadRegister);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [editingRoadId, setEditingRoadId] = useState<number | null>(null);
  const [editingRoadName, setEditingRoadName] = useState("");

  const filteredRoads = roads.filter((road) =>
    road.road_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    road.route_id.toString().includes(searchQuery.toLowerCase())
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

  const handleAddRoad = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const newRoad = {
      route_id: roads.length + 1,
      road_name: formData.get("road_name") as string,
      start_point_name: formData.get("start_point_name") as string,
      start_lat: parseFloat(formData.get("start_lat") as string),
      start_lng: parseFloat(formData.get("start_lng") as string),
      end_point_name: formData.get("end_point_name") as string,
      end_lat: parseFloat(formData.get("end_lat") as string),
      end_lng: parseFloat(formData.get("end_lng") as string),
      estimated_distance_km: parseFloat(formData.get("estimated_distance_km") as string),
      road_type: formData.get("road_type") as string,
      road_side: formData.get("road_side") as string,
    };

    setRoads([...roads, newRoad]);
    setIsAddDialogOpen(false);
    toast.success("Road added successfully!");
  };

  const handleImportFile = (type: string) => {
    toast.info(`${type} import will be implemented in the backend integration phase`);
    setIsImportDialogOpen(false);
  };

  const startEditingRoadName = (road: typeof roads[0]) => {
    setEditingRoadId(road.route_id);
    setEditingRoadName(road.road_name);
  };

  const saveRoadName = (routeId: number) => {
    setRoads(roads.map(road => 
      road.route_id === routeId 
        ? { ...road, road_name: editingRoadName }
        : road
    ));
    setEditingRoadId(null);
    setEditingRoadName("");
    toast.success("Road name updated!");
  };

  const cancelEditingRoadName = () => {
    setEditingRoadId(null);
    setEditingRoadName("");
  };

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <div className="relative overflow-hidden gradient-primary p-8 rounded-2xl shadow-elevated">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS1vcGFjaXR5PSIwLjEiIHN0cm9rZS13aWR0aD0iMSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmlkKSIvPjwvc3ZnPg==')] opacity-30"></div>
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

            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 bg-white text-primary hover:bg-white/90 shadow-lg">
                  <Plus className="h-4 w-4" />
                  Add Road
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Add New Road</DialogTitle>
                  <DialogDescription>
                    Enter the details for the new road entry.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleAddRoad} className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="road_name">Road Name *</Label>
                    <Input id="road_name" name="road_name" placeholder="e.g., Al Corniche Street" required />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="start_point_name">Start Point Name *</Label>
                      <Input id="start_point_name" name="start_point_name" placeholder="e.g., West Bay" required />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="end_point_name">End Point Name *</Label>
                      <Input id="end_point_name" name="end_point_name" placeholder="e.g., Katara" required />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="start_lat">Start Latitude *</Label>
                      <Input id="start_lat" name="start_lat" type="number" step="any" placeholder="25.3212" required />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="start_lng">Start Longitude *</Label>
                      <Input id="start_lng" name="start_lng" type="number" step="any" placeholder="51.5241" required />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="end_lat">End Latitude *</Label>
                      <Input id="end_lat" name="end_lat" type="number" step="any" placeholder="25.3548" required />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="end_lng">End Longitude *</Label>
                      <Input id="end_lng" name="end_lng" type="number" step="any" placeholder="51.5310" required />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="estimated_distance_km">Distance (km) *</Label>
                      <Input id="estimated_distance_km" name="estimated_distance_km" type="number" step="0.1" placeholder="8.5" required />
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
                <p className="text-5xl font-bold bg-gradient-to-br from-green-600 to-green-400 bg-clip-text text-transparent">{totalLength.toFixed(1)}<span className="text-2xl ml-1">km</span></p>
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1400px]">
            <thead className="bg-gradient-to-r from-primary/5 via-accent/5 to-primary/5 border-b-2 border-primary/20">
              <tr>
                <th className="text-left p-4 font-semibold text-sm whitespace-nowrap">Route ID</th>
                <th className="text-left p-4 font-semibold text-sm whitespace-nowrap">Road Name</th>
                <th className="text-left p-4 font-semibold text-sm whitespace-nowrap">Start → End</th>
                <th className="text-left p-4 font-semibold text-sm whitespace-nowrap">Coordinates</th>
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
                      <div className="text-xs text-muted-foreground">↓</div>
                      <div className="font-medium text-sm">{road.end_point_name || "—"}</div>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="space-y-1 font-mono text-xs text-muted-foreground">
                      <div>
                        {road.start_lat && road.start_lng 
                          ? `${road.start_lat.toFixed(4)}, ${road.start_lng.toFixed(4)}`
                          : "—"}
                      </div>
                      <div>
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
                    <Link to="/gis">
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
      </Card>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
