import * as XLSX from "xlsx-js-style";

interface ExcelExportOptions {
  filename: string;
  sheetName?: string;
  title?: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number)[][];
  columnWidths?: number[];
}

/**
 * Export data as a well-formatted .xlsx Excel file.
 * - Bold header row with blue background
 * - Auto-fit column widths (or custom)
 * - Title & subtitle rows if provided
 */
export function exportToExcel({
  filename,
  sheetName = "Report",
  title,
  subtitle,
  headers,
  rows,
  columnWidths,
}: ExcelExportOptions) {
  const wb = XLSX.utils.book_new();

  const wsData: (string | number)[][] = [];
  let headerRowIdx = 0;

  if (title) {
    wsData.push([title]);
    headerRowIdx++;
  }
  if (subtitle) {
    wsData.push([subtitle]);
    headerRowIdx++;
  }
  if (title || subtitle) {
    wsData.push([]);
    headerRowIdx++;
  }

  wsData.push(headers);
  wsData.push(...rows);

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Style the title row (bold, larger)
  if (title) {
    const titleCell = ws["A1"];
    if (titleCell) {
      titleCell.s = {
        font: { bold: true, sz: 14, color: { rgb: "1C4280" } },
      };
    }
  }

  // Style the subtitle row
  if (subtitle) {
    const subtitleRow = title ? 1 : 0;
    const cell = ws[XLSX.utils.encode_cell({ r: subtitleRow, c: 0 })];
    if (cell) {
      cell.s = {
        font: { italic: true, sz: 10, color: { rgb: "666666" } },
      };
    }
  }

  // Style header row: blue background + white bold text
  for (let c = 0; c < headers.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: headerRowIdx, c });
    const cell = ws[addr];
    if (cell) {
      cell.s = {
        font: { bold: true, sz: 11, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "1C4280" } },
        alignment: { horizontal: "center", vertical: "center", wrapText: true },
        border: {
          bottom: { style: "thin", color: { rgb: "0F2D5A" } },
          right: { style: "thin", color: { rgb: "2A5BA0" } },
        },
      };
    }
  }

  // Style data rows with subtle alternating tint
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < headers.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: headerRowIdx + 1 + r, c });
      const cell = ws[addr];
      if (cell) {
        cell.s = {
          font: { sz: 10 },
          alignment: { vertical: "center" },
          border: {
            bottom: { style: "thin", color: { rgb: "E0E0E0" } },
          },
          ...(r % 2 === 1
            ? { fill: { fgColor: { rgb: "EDF2F9" } } }
            : {}),
        };
      }
    }
  }

  // Column widths
  const colWidths: XLSX.ColInfo[] = headers.map((h, i) => {
    if (columnWidths && columnWidths[i]) return { wch: columnWidths[i] };
    let maxLen = h.length;
    for (const row of rows) {
      const val = String(row[i] ?? "");
      if (val.length > maxLen) maxLen = val.length;
    }
    return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
  });
  ws["!cols"] = colWidths;

  // Freeze header row
  ws["!freeze"] = { xSplit: 0, ySplit: headerRowIdx + 1 };

  // Autofilter
  const lastCol = XLSX.utils.encode_col(headers.length - 1);
  ws["!autofilter"] = { ref: `A${headerRowIdx + 1}:${lastCol}${headerRowIdx + 1 + rows.length}` };

  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const wbOut = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbOut], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
