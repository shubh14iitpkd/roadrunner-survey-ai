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
  label?: string;  // flat charts
  value?: number;
  // stacked bar item variants
  x?: string;
  y?: number;
}

interface StackedSeries {
  name?: string;   // our designed format
  label?: string;  // LLM sometimes produces this instead of name
  color?: string;
  data: ChartDataItem[];
}

interface VisualizationData {
  type: "pie" | "bar" | "doughnut" | "stacked_bar";
  title?: string;
  // flat data for pie / bar / doughnut
  data?: ChartDataItem[];
  // series data for stacked_bar
  series?: StackedSeries[];
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

// Stacked bar uses semantic colors: Good=emerald, Damaged=rose, rest cycle
const STACKED_SERIES_COLORS: Record<string, string> = {
  good: "#10b981",
  Good: "#10b981",
  damaged: "#f43f5e",
  Damaged: "#f43f5e",
};

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
  const entry = payload[0];
  const label = entry.payload?.label ?? entry.name;
  return (
    <div className="rounded-lg border bg-background/95 backdrop-blur-sm px-3 py-2 shadow-lg">
      <p className="text-sm font-medium">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-xs text-muted-foreground">
          <span style={{ color: p.fill }} className="font-semibold">■ </span>
          {p.name}: <span className="font-semibold text-foreground">{p.value?.toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
}

/** Normalize a series item to a canonical name string. */
function seriesName(s: StackedSeries): string {
  return s.name ?? s.label ?? "Series";
}

/** Convert series [{name/label, data: [{label/x, value/y}]}] → [{label, SeriesA: val, SeriesB: val}] */
function pivotSeriesData(series: StackedSeries[]): Record<string, any>[] {
  const labelMap: Record<string, Record<string, number>> = {};
  for (const s of series) {
    const key = seriesName(s);
    for (const item of s.data) {
      // Accept both {label, value} and {x, y} variants
      const labelKey = item.label ?? item.x ?? "";
      const val = item.value ?? item.y ?? 0;
      if (!labelMap[labelKey]) labelMap[labelKey] = {};
      labelMap[labelKey][key] = val;
    }
  }
  return Object.entries(labelMap).map(([label, vals]) => ({ label, ...vals }));
}

export const VisualizationBlock = memo(function VisualizationBlock({ jsonString }: { jsonString: string }) {
  const chartData = useMemo<VisualizationData | null>(() => {
    try {
      const parsed = JSON.parse(jsonString);
      if (!parsed.type) return null;
      // stacked_bar uses `series`; others use `data`
      if (parsed.type === "stacked_bar") {
        if (!Array.isArray(parsed.series)) return null;
      } else {
        if (!Array.isArray(parsed.data)) return null;
      }
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

  const { type, title } = chartData;

  return (
    <Card className="p-5 my-3 bg-card/50 border border-border/60">
      {title && (
        <h3 className="text-base font-semibold mb-4 text-center">{title}</h3>
      )}

      <ResponsiveContainer width="100%" height={300}>
        {type === "bar" ? (
          <BarChart data={chartData.data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]}>
              {chartData.data!.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        ) : type === "stacked_bar" ? (
          <BarChart
            data={pivotSeriesData(chartData.series!)}
            margin={{ top: 5, right: 20, left: 0, bottom: 60 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              angle={-35}
              textAnchor="end"
              interval={0}
            />
            <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              verticalAlign="top"
              iconType="circle"
              iconSize={10}
              formatter={(value: string) => (
                <span className="text-sm text-foreground">{value}</span>
              )}
            />
            {chartData.series!.map((s, i) => (
              <Bar
                key={seriesName(s) || i}
                dataKey={seriesName(s)}
                stackId="stack"
                fill={STACKED_SERIES_COLORS[seriesName(s)] ?? COLORS[i % COLORS.length]}
                radius={i === chartData.series!.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
              />
            ))}
          </BarChart>
        ) : (
          <PieChart>
            <Pie
              data={chartData.data}
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
              {chartData.data!.map((_, i) => (
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
