import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

// ── Types ────────────────────────────────────────────────────────────

export interface RoadReportData {
  road_name: string;
  road_type?: string;
  start_point_name?: string;
  start_lat?: number;
  start_lng?: number;
  end_point_name?: string;
  end_lat?: number;
  end_lng?: number;
  estimated_distance_km?: number;
  road_side?: string;
  total_assets: number;
  good_assets: number;
  damaged_assets: number;
}

export interface AssetRow {
  name: string;
  category: string;
  lat?: number;
  lng?: number;
  confidence: number;
  condition: string;
}

interface RoadReportPDFProps {
  road: RoadReportData;
  assets: AssetRow[];
  generatedDate: string;
}

// ── Colours ──────────────────────────────────────────────────────────

const COLORS = {
  headerBg: "#1E40AF",
  headerText: "#FFFFFF",
  sectionBg: "#2563EB",
  sectionText: "#FFFFFF",
  labelBg: "#EFF6FF",
  labelText: "#1E3A8A",
  valueText: "#1F2937",
  tableHeaderBg: "#1E40AF",
  tableHeaderText: "#FFFFFF",
  rowEven: "#F0F9FF",
  rowOdd: "#FFFFFF",
  goodBg: "#DCFCE7",
  goodText: "#166534",
  damagedBg: "#FEE2E2",
  damagedText: "#991B1B",
  border: "#CBD5E1",
  footerText: "#64748B",
};

// ── Styles ───────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    paddingTop: 30,
    paddingLeft: 30,
    paddingRight: 30,
    paddingBottom: 50,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: COLORS.valueText,
  },

  /* ── Header ─── */
  header: {
    backgroundColor: COLORS.headerBg,
    padding: 20,
    marginBottom: 16,
    borderRadius: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: COLORS.headerText,
    letterSpacing: 1,
  },
  headerSub: {
    fontSize: 9,
    color: "#BFDBFE",
    marginTop: 4,
  },

  /* ── Section heading ─── */
  sectionHeader: {
    backgroundColor: COLORS.sectionBg,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 3,
    marginBottom: 8,
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: COLORS.sectionText,
  },

  /* ── Road info table ─── */
  infoTable: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  infoRowLast: {
    flexDirection: "row",
  },
  infoLabel: {
    width: "35%",
    padding: 7,
    backgroundColor: COLORS.labelBg,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: COLORS.labelText,
  },
  infoValue: {
    width: "65%",
    padding: 7,
    fontSize: 9,
  },

  /* ── KPI strip ─── */
  kpiStrip: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  kpiBox: {
    flex: 1,
    padding: 10,
    borderRadius: 4,
    alignItems: "center",
  },
  kpiCount: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
  },
  kpiLabel: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  /* ── Asset table ─── */
  /* Each row is self-contained with its own borders — no wrapper */
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    borderLeftWidth: 1,
    borderLeftColor: COLORS.border,
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
    alignItems: "center",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: COLORS.tableHeaderBg,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
  },
  th: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    color: COLORS.tableHeaderText,
    paddingVertical: 5,
    paddingHorizontal: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  td: {
    fontSize: 8,
    paddingVertical: 5,
    paddingHorizontal: 6,
  },

  /* column widths */
  colSno:        { width: "6%" },
  colName:       { width: "22%" },
  colCategory:   { width: "18%" },
  colLatLng:     { width: "22%" },
  colConfidence: { width: "14%" },
  colCondition:  { width: "18%" },

  /* badges */
  conditionBadge: {
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 3,
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    textAlign: "center",
  },

  /* ── Footer ─── */
  footer: {
    position: "absolute",
    bottom: 20,
    left: 30,
    right: 30,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 6,
  },
  footerText: {
    fontSize: 7,
    color: COLORS.footerText,
  },
});

// ── Component ────────────────────────────────────────────────────────

export default function RoadReportPDF({ road, assets, generatedDate }: RoadReportPDFProps) {
  const formatCoord = (lat?: number, lng?: number) =>
    lat != null && lng != null ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : "—";

  const infoRows: [string, string][] = [
    ["Route Name", road.road_name],
    ["Route Type", road.road_type || "—"],
    ["Start Point", `${road.start_point_name || "—"}  (${formatCoord(road.start_lat, road.start_lng)})`],
    ["End Point", `${road.end_point_name || "—"}  (${formatCoord(road.end_lat, road.end_lng)})`],
    ["Approx. Road Length", road.estimated_distance_km != null ? `${road.estimated_distance_km} km` : "—"],
    ["Road Side", road.road_side || "—"],
    ["Total Assets", String(road.total_assets)],
    ["Assets in Good Condition", String(road.good_assets)],
    ["Assets in Bad Condition", String(road.damaged_assets)],
  ];

  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        {/* Fixed footer on every page */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>RoadSightAI Report • {road.road_name}</Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

        {/* Header */}
        <View style={styles.header} wrap={false}>
          <View>
            <Text style={styles.headerTitle}>RoadSightAI Report</Text>
            <Text style={styles.headerSub}>Generated on {generatedDate}</Text>
          </View>
        </View>

        {/* Road Information */}
        <View style={styles.sectionHeader} wrap={false}>
          <Text style={styles.sectionTitle}>Road Information &amp; Summary</Text>
        </View>
        <View style={styles.infoTable} wrap={false}>
          {infoRows.map(([label, value], i) => (
            <View
              key={label}
              style={i < infoRows.length - 1 ? styles.infoRow : styles.infoRowLast}
            >
              <Text style={styles.infoLabel}>{label}</Text>
              <Text style={styles.infoValue}>{value}</Text>
            </View>
          ))}
        </View>

        {/* KPI strip */}
        <View style={styles.kpiStrip} wrap={false}>
          <View style={[styles.kpiBox, { backgroundColor: "#DBEAFE" }]}>
            <Text style={[styles.kpiCount, { color: "#1E40AF" }]}>{road.total_assets}</Text>
            <Text style={[styles.kpiLabel, { color: "#1E40AF" }]}>Total Assets</Text>
          </View>
          <View style={[styles.kpiBox, { backgroundColor: COLORS.goodBg }]}>
            <Text style={[styles.kpiCount, { color: COLORS.goodText }]}>{road.good_assets}</Text>
            <Text style={[styles.kpiLabel, { color: COLORS.goodText }]}>Good</Text>
          </View>
          <View style={[styles.kpiBox, { backgroundColor: COLORS.damagedBg }]}>
            <Text style={[styles.kpiCount, { color: COLORS.damagedText }]}>{road.damaged_assets}</Text>
            <Text style={[styles.kpiLabel, { color: COLORS.damagedText }]}>Damaged</Text>
          </View>
        </View>

        {/* Asset Register heading */}
        <View style={styles.sectionHeader} wrap={false}>
          <Text style={styles.sectionTitle}>Asset Register ({assets.length} items)</Text>
        </View>

        {/* Table header — fixed so it repeats on every page */}
        <View style={styles.tableHeader} fixed>
          <Text style={[styles.th, styles.colSno]}>S.No</Text>
          <Text style={[styles.th, styles.colName]}>Asset Name</Text>
          <Text style={[styles.th, styles.colCategory]}>Category</Text>
          <Text style={[styles.th, styles.colLatLng]}>Lat / Long</Text>
          <Text style={[styles.th, styles.colConfidence]}>Confidence</Text>
          <Text style={[styles.th, styles.colCondition]}>Condition</Text>
        </View>

        {/* Each row is independent — no wrapping container */}
        {assets.map((asset, i) => {
          const isEven = i % 2 === 0;
          const isGood = asset.condition?.toLowerCase() === "good";
          const condBg = isGood ? COLORS.goodBg : COLORS.damagedBg;
          const condText = isGood ? COLORS.goodText : COLORS.damagedText;

          return (
            <View
              key={`asset-${i}`}
              style={[
                styles.tableRow,
                { backgroundColor: isEven ? COLORS.rowEven : COLORS.rowOdd },
              ]}
              wrap={false}
            >
              <Text style={[styles.td, styles.colSno]}>{i + 1}</Text>
              <Text style={[styles.td, styles.colName]}>{asset.name}</Text>
              <Text style={[styles.td, styles.colCategory]}>{asset.category}</Text>
              <Text style={[styles.td, styles.colLatLng]}>
                {formatCoord(asset.lat, asset.lng)}
              </Text>
              <Text style={[styles.td, styles.colConfidence]}>
                {(asset.confidence * 100).toFixed(1)}%
              </Text>
              <View style={[styles.td, styles.colCondition]}>
                <Text
                  style={[
                    styles.conditionBadge,
                    { backgroundColor: condBg, color: condText },
                  ]}
                >
                  {asset.condition || "Unknown"}
                </Text>
              </View>
            </View>
          );
        })}
      </Page>
    </Document>
  );
}
