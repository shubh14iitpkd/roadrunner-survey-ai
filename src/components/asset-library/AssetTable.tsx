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
import { Search, X, RefreshCw, AlertCircle, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssetRecord } from "@/types/asset";

export interface ColumnDef {
  key: string;
  header: string;
  render: (item: AssetRecord) => React.ReactNode;
  className?: string;
  /** Return a sortable value for this column. If omitted, column is not sortable. */
  getValue?: (item: AssetRecord) => string | number;
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
  /** Current sort column key (from parent) */
  sortKey?: string | null;
  /** Current sort direction (from parent) */
  sortDir?: "asc" | "desc";
  /** Handler called when a sortable column header is clicked */
  onSort?: (colKey: string) => void;
  /** Server-side pagination: current page (1-based) */
  serverPage?: number;
  /** Server-side pagination: total number of pages */
  serverTotalPages?: number;
  /** Server-side pagination: total matching item count */
  serverTotalCount?: number;
  /** Server-side pagination: page size */
  serverPageSize?: number;
  /** Server-side pagination: callback when page changes */
  onPageChange?: (page: number) => void;
  /** Server-side pagination: callback when page size changes */
  onPageSizeChange?: (size: number) => void;
  /** Sorted IDs for map-click page jumping (server-side pagination only) */
  sortedIds?: string[];
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
  idField = "defectId",
  sortKey: propSortKey = null,
  sortDir: propSortDir = "asc",
  onSort: propOnSort = () => {},
  serverPage,
  serverTotalPages,
  serverTotalCount,
  serverPageSize,
  onPageChange,
  onPageSizeChange,
  sortedIds,
}: AssetTableProps) {
  const isServerPaginated = serverPage != null;

  // ── Client-side pagination state (used when NOT server-paginated) ──
  const [localPage, setLocalPage] = useState(1);
  const [localPageSize, setLocalPageSize] = useState(10);

  const page = isServerPaginated ? serverPage : localPage;
  const pageSize = isServerPaginated ? (serverPageSize ?? 10) : localPageSize;
  const totalCount = isServerPaginated ? (serverTotalCount ?? 0) : items.length;
  const totalPages = isServerPaginated ? (serverTotalPages ?? 1) : Math.ceil(items.length / localPageSize);

  const setPage = (p: number | ((prev: number) => number)) => {
    const nextPage = typeof p === "function" ? p(page) : p;
    if (isServerPaginated && onPageChange) {
      onPageChange(nextPage);
    } else {
      setLocalPage(nextPage);
    }
  };

  const setPageSize = (size: number) => {
    if (isServerPaginated && onPageSizeChange) {
      onPageSizeChange(size);
    } else {
      setLocalPageSize(size);
      setLocalPage(1);
    }
  };

  // Reset local page when items or search change (client-side only)
  useEffect(() => {
    if (!isServerPaginated) setLocalPage(1);
  }, [items.length, searchQuery, isServerPaginated]);

  // In server mode, items ARE the current page; in client mode, slice them
  const pagedItems = useMemo(
    () => isServerPaginated ? items : items.slice((localPage - 1) * localPageSize, localPage * localPageSize),
    [items, localPage, localPageSize, isServerPaginated]
  );

  // Jump to the page containing the selected row when selection changes.
  // Server-paginated: parent handles page navigation (handleRowClick / navigateAsset),
  // so we only auto-jump for client-side pagination.
  useEffect(() => {
    if (!selectedId || isServerPaginated) return;
    const idx = items.findIndex((a) => a[idField] === selectedId);
    if (idx === -1) return;
    const targetPage = Math.floor(idx / localPageSize) + 1;
    setLocalPage(targetPage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, isServerPaginated]);

  // Scroll selected row into view after page has rendered
  useEffect(() => {
    if (!selectedId) return;
    const timer = setTimeout(() => {
      document.getElementById(`asset-row-${selectedId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
    return () => clearTimeout(timer);
  }, [selectedId, page]);

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
      <div className="overflow-auto w-full" style={{ flex: 1, minHeight: 0 }}>
        {loading ? (
          <div className="p-3 space-y-2 w-full">
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="flex gap-3 items-center">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
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
        ) : totalCount === 0 ? (
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
                {columns.map((col) => {
                  const sortable = !!col.getValue;
                  const isActive = propSortKey === col.key;
                  return (
                    <TableHead
                      key={col.key}
                      className={cn(
                        "text-[9px] font-semibold uppercase tracking-wider text-muted-foreground px-1.5 py-1 whitespace-nowrap text-center",
                        sortable && "cursor-pointer select-none hover:text-foreground"
                      )}
                      onClick={sortable ? () => { propOnSort(col.key); } : undefined}
                    >
                      <span className="inline-flex items-center gap-0.5 justify-center">
                        {col.header}
                        {sortable && (
                          isActive
                            ? propSortDir === "asc"
                              ? <ArrowUp className="h-2.5 w-2.5" />
                              : <ArrowDown className="h-2.5 w-2.5" />
                            : <ArrowUpDown className="h-2.5 w-2.5 opacity-30" />
                        )}
                      </span>
                    </TableHead>
                  );
                })}
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
                      selectedId === rowId && "bg-primary/5 dark:bg-muted-secondary/20"
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
      {totalCount > 0 && (
        <div className="flex items-center justify-between px-4 py-1 border-t border-border text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="tabular-nums">
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalCount)} of {totalCount}
            </span>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
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
