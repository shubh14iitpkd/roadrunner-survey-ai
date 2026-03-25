import { useMemo, memo, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Sector,
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
  x_axis_label?: string;
  y_axis_label?: string;
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

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Truncate a string for axis labels */
function truncateLabel(text: string, maxLen = 14): string {
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
}

/** Custom tick renderer that truncates long labels */
function TruncatedTick({ x, y, payload, angle, textAnchor, maxLen }: any) {
  const label = truncateLabel(String(payload?.value ?? ""), maxLen);
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={10}
        textAnchor={textAnchor || "end"}
        fill="hsl(var(--muted-foreground))"
        fontSize={11}
        transform={`rotate(${angle || 0})`}
      >
        <title>{payload?.value}</title>
        {label}
      </text>
    </g>
  );
}

/** Compute dynamic chart height and min-width based on data count */
function useBarChartDimensions(dataLength: number) {
  const BAR_SLOT = 60; // px per bar category when scrolling
  const SCROLL_THRESHOLD = 8;

  const needsScroll = dataLength > SCROLL_THRESHOLD;
  const minWidth = needsScroll ? dataLength * BAR_SLOT : undefined;
  // Scale height with data count so bars have breathing room
  const height = needsScroll
    ? 460
    : Math.max(420, dataLength * 38 + 100);
  return { height, minWidth, needsScroll };
}

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

  // if (percent < 0.05) return null;

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
  // console.log("Tooltip payload:", payload);
  return (
    <div className="rounded-lg border bg-background/95 px-3 py-2 shadow-lg">
      <p className="text-sm font-medium">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-xs text-muted-foreground">
          <span style={{ color: p.fill }} className="font-semibold">■ </span>
          {p.dataKey || p.name}: <span className="font-semibold text-foreground">{p.value?.toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
}

const renderLegend = (props: any) => {
  const { payload } = props;

  return (
    <div className="flex flex-wrap justify-center gap-3 mt-2">
      {payload.map((entry: any, index: number) => (
        <div key={`item-${index}`} className="flex items-center gap-1">
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              backgroundColor: entry.color,
            }}
          />
          <span className="text-sm text-foreground">{entry.value}</span>
        </div>
      ))}
    </div>
  );
};

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

// ── Component ────────────────────────────────────────────────────────────────

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

  // ── Bar chart ──
  if (type === "bar") {
    const dataLen = chartData.data?.length ?? 0;
    const { height, minWidth, needsScroll } = useBarChartDimensions(dataLen);
    const xLabel = chartData.x_axis_label;
    const yLabel = chartData.y_axis_label;
    const yAxisWidth = yLabel ? 75 : 45;

    const chart = (
      <ResponsiveContainer width="100%" height={height} minWidth={minWidth}>
        <BarChart
          data={chartData.data}
          margin={{ top: 5, right: 20, left: yLabel ? 25 : 0, bottom: xLabel ? 100 : 80 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="label"
            tick={<TruncatedTick angle={-40} textAnchor="end" maxLen={14} />}
            interval={0}
            height={xLabel ? 100 : 80}
            label={xLabel ? { value: xLabel, position: "insideBottom", offset: 0, fontSize: 12, fill: "hsl(var(--muted-foreground))" } : undefined}
          />
          <YAxis
            width={yAxisWidth}
            tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
            label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", offset: 20, fontSize: 12, fill: "hsl(var(--muted-foreground))", style: { textAnchor: "middle" } } : undefined}
          />
          <Tooltip 
            content={<CustomTooltip />} 
            cursor={{ fill: "hsl(var(--muted) / 0.5)" }}
           />
          <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={60}>
            {chartData.data!.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );

    return (
      <Card className="p-5 my-3 bg-card/50 border border-border/60 viz-chart-card">
        {title && (
          <h3 className="text-base font-semibold mb-4 text-center">{title}</h3>
        )}
        {needsScroll ? (
          <div className="viz-scroll-container">{chart}</div>
        ) : (
          chart
        )}
      </Card>
    );
  }

  // ── Stacked bar chart ──
  if (type === "stacked_bar") {
    const pivoted = pivotSeriesData(chartData.series!);
    const dataLen = pivoted.length;
    const { height, minWidth, needsScroll } = useBarChartDimensions(dataLen);
    const xLabel = chartData.x_axis_label;
    const yLabel = chartData.y_axis_label;
    const yAxisWidth = yLabel ? 75 : 45;

    const chart = (
      <ResponsiveContainer width="100%" height={height} minWidth={minWidth}>
        <BarChart
          data={pivoted}
          margin={{ top: 5, right: 20, left: yLabel ? 25 : 0, bottom: xLabel ? 100 : 80 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="label"
            tick={<TruncatedTick angle={-40} textAnchor="end" maxLen={14} />}
            interval={0}
            height={xLabel ? 100 : 80}
            label={xLabel ? { value: xLabel, position: "insideBottom", offset: 0, fontSize: 12, fill: "hsl(var(--muted-foreground))" } : undefined}
          />
          <YAxis
            width={yAxisWidth}
            tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
            label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", offset: 20, fontSize: 12, fill: "hsl(var(--muted-foreground))", style: { textAnchor: "middle" } } : undefined}
          />
          <Tooltip 
            content={<CustomTooltip />} 
            cursor={{ fill: "hsl(var(--muted) / 0.5)" }}
          />
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
              maxBarSize={60}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );

    return (
      <Card className="p-5 my-3 bg-card/50 border border-border/60 viz-chart-card">
        {title && (
          <h3 className="text-base font-semibold mb-4 text-center">{title}</h3>
        )}
        {needsScroll ? (
          <div className="viz-scroll-container">{chart}</div>
        ) : (
          chart
        )}
      </Card>
    );
  }

  // ── Pie / Doughnut chart ──
  const [activePieIndex, setActivePieIndex] = useState<number | undefined>(undefined);
  const innerR = type === "doughnut" ? 75 : 0;
  const outerR = 120;

  const activeShape = (props: any) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
    return (
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 5}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        style={{ filter: "brightness(1)", cursor: "pointer" }}
      />
    );
  };

  return (
    <Card className="p-5 my-3 bg-card/50 border border-border/60 viz-chart-card">
      {title && (
        <h3 className="text-base font-semibold mb-4 text-center">{title}</h3>
      )}
      <ResponsiveContainer width="100%" height={340}>
        <PieChart>
          <Pie
            data={chartData.data}
            dataKey="value"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius={innerR}
            outerRadius={outerR}
            strokeWidth={2}
            stroke="hsl(var(--card))"
            labelLine={false}
            label={renderCustomLabel}
            activeIndex={activePieIndex}
            activeShape={activeShape}
            onMouseEnter={(_, index) => setActivePieIndex(index)}
            onMouseLeave={() => setActivePieIndex(undefined)}
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
            content={renderLegend}
            iconSize={10}
            formatter={(value: string) => (
              <span className="text-sm text-foreground">{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </Card>
  );
});
