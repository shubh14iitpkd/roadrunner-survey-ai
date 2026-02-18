import { useMemo, memo } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { Card } from "@/components/ui/card";

interface ChartDataItem {
  label: string;
  value: number;
}

interface VisualizationData {
  type: "pie" | "bar" | "doughnut";
  title?: string;
  data: ChartDataItem[];
}

// Premium color palette
const COLORS = [
  "#6366f1", // indigo
  "#f43f5e", // rose
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#14b8a6", // teal
];

const RADIAN = Math.PI / 180;

function renderCustomLabel({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
}: any) {
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  if (percent < 0.05) return null;

  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={13}
      fontWeight={600}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const { label, value } = payload[0].payload;
  return (
    <div className="rounded-lg border bg-background/95 backdrop-blur-sm px-3 py-2 shadow-lg">
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs text-muted-foreground">
        Count: <span className="font-semibold text-foreground">{value.toLocaleString()}</span>
      </p>
    </div>
  );
}

export const VisualizationBlock = memo(function VisualizationBlock({ jsonString }: { jsonString: string }) {
  const chartData = useMemo<VisualizationData | null>(() => {
    try {
      const parsed = JSON.parse(jsonString);
      if (!parsed.type || !Array.isArray(parsed.data)) return null;
      return parsed as VisualizationData;
    } catch {
      return null;
    }
  }, [jsonString]);

  if (!chartData) {
    return (
      <Card className="p-4 text-sm text-muted-foreground italic">
        Could not parse visualization data.
      </Card>
    );
  }

  const { type, title, data } = chartData;

  return (
    <Card className="p-5 my-3 bg-card/50 border border-border/60">
      {title && (
        <h3 className="text-base font-semibold mb-4 text-center">{title}</h3>
      )}

      <ResponsiveContainer width="100%" height={300}>
        {type === "bar" ? (
          <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]}>
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        ) : (
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={type === "doughnut" ? 60 : 0}
              outerRadius={110}
              strokeWidth={2}
              stroke="hsl(var(--background))"
              labelLine={false}
              label={renderCustomLabel}
              animationBegin={0}
              animationDuration={800}
              animationEasing="ease-out"
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend
              verticalAlign="bottom"
              iconType="circle"
              iconSize={10}
              formatter={(value: string) => (
                <span className="text-sm text-foreground">{value}</span>
              )}
            />
          </PieChart>
        )}
      </ResponsiveContainer>
    </Card>
  );
});
