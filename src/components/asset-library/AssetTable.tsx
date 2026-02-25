import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, X, RefreshCw, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssetRecord } from "@/types/asset";

export interface ColumnDef {
  key: string;
  header: string;
  render: (item: AssetRecord) => React.ReactNode;
  className?: string;
}

interface AssetTableProps {
  items: AssetRecord[];
  loading: boolean;
  loadError: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedId: string | null;
  onRowClick: (item: AssetRecord) => void;
  onRetry: () => void;
  onClearFilters: () => void;
  columns: ColumnDef[];
  /** Key field used for row IDs and selection. Defaults to "anomalyId" */
  idField?: keyof AssetRecord;
}

export default function AssetTable({
  items,
  loading,
  loadError,
  searchQuery,
  onSearchChange,
  selectedId,
  onRowClick,
  onRetry,
  onClearFilters,
  columns,
  idField = "anomalyId",
}: AssetTableProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Reset page when items or search change
  useEffect(() => { setPage(1); }, [items.length, searchQuery]);

  const totalPages = Math.ceil(items.length / pageSize);
  const pagedItems = useMemo(
    () => items.slice((page - 1) * pageSize, page * pageSize),
    [items, page, pageSize]
  );

  // Auto-scroll to selected row
  useEffect(() => {
    if (!selectedId) return;
    const idx = items.findIndex((a) => a[idField] === selectedId);
    if (idx === -1) return;
    const targetPage = Math.floor(idx / pageSize) + 1;
    if (targetPage !== page) setPage(targetPage);
    setTimeout(() => {
      document.getElementById(`asset-row-${selectedId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  }, [selectedId]);

  return (
    <div className="border-t border-border bg-card flex flex-col" style={{ flex: "1 1 45%", minHeight: 0 }}>
      <div className="gradient-table-line" />
      {/* Search bar */}
      <div className="px-3 py-1.5 border-b border-border/50 shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Search by Asset ID, Road, Type, Issue..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-7 pl-7 text-[11px] bg-muted/30 border-border/50"
          />
        </div>
      </div>
      <div className="overflow-auto" style={{ flex: 1, minHeight: 0 }}>
        {loading ? (
          <div className="p-3 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex gap-3 items-center">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-10" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center">
              <AlertCircle className="h-10 w-10 mx-auto mb-2 text-destructive/40" />
              <p className="text-sm font-medium text-foreground mb-1">Something went wrong</p>
              <p className="text-[11px] text-muted-foreground mb-3">Failed to load data. Please try again.</p>
              <Button variant="outline" size="sm" className="gap-1.5 text-[11px]" onClick={onRetry}>
                <RefreshCw className="h-3 w-3" />
                Retry
              </Button>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center">
              <Search className="h-10 w-10 mx-auto mb-2 text-muted-foreground/30" />
              <p className="text-sm font-medium text-foreground mb-1">No results found</p>
              <p className="text-[11px] text-muted-foreground mb-3">No results match the current filters or search.</p>
              <Button variant="outline" size="sm" className="gap-1.5 text-[11px]" onClick={onClearFilters}>
                <X className="h-3 w-3" />
                Reset Filters
              </Button>
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow className="border-b border-border hover:bg-transparent">
                {columns.map((col) => (
                  <TableHead
                    key={col.key}
                    className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground px-1.5 py-1 whitespace-nowrap text-center"
                  >
                    {col.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedItems.map((item) => {
                const rowId = item[idField] as string;
                return (
                  <TableRow
                    id={`asset-row-${rowId}`}
                    key={rowId}
                    className={cn(
                      "cursor-pointer hover:bg-muted/40 border-b border-border/50",
                      selectedId === rowId && "bg-primary/5"
                    )}
                    onClick={() => onRowClick(item)}
                  >
                    {columns.map((col) => (
                      <TableCell key={col.key} className={col.className}>
                        {col.render(item)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
      {items.length > 0 && (
        <div className="flex items-center justify-between px-4 py-1 border-t border-border text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="tabular-nums">
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, items.length)} of {items.length}
            </span>
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
              <SelectTrigger className="h-5 w-14 text-[10px] border-border bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card z-50">
                {[5, 10, 25, 50].map((n) => (
                  <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[9px] text-muted-foreground">per page</span>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-6 w-6" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
