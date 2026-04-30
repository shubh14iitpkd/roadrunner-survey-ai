import { useState, useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TableBody, TableCell, TableHead, TableHeader, TableRow,
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
  /** When true, virtualize the entire item list with @tanstack/react-virtual
   * and hide pagination. Use for large in-memory datasets (>1000 rows). */
  virtualized?: boolean;
  /** Row height in pixels for virtualized mode (default 32). */
  virtualRowHeight?: number;
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
  virtualized = false,
  virtualRowHeight = 32,
}: AssetTableProps) {
  const isServerPaginated = serverPage != null && !virtualized;

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

  // ── Sticky header — captured as a ref purely so scroll-into-view can
  // skip the header's height. Plain ref, read on demand inside the scroll
  // effect — no state, no ResizeObserver, no extra renders. Callback ref
  // because the element type differs across virtualized (div) vs
  // non-virtualized (thead) layouts.
  const headerElRef = useRef<HTMLElement | null>(null);
  const headerRef = (el: HTMLElement | null) => { headerElRef.current = el; };

  const parentRef = useRef<HTMLDivElement>(null);

  // Scroll any row by ID into view, accounting for the sticky header.
  // Reads layout once (offsetTop/clientHeight/scrollTop) and only scrolls
  // when the row is actually outside the visible band — same as
  // scrollIntoView({block:"nearest"}), but with explicit header-height
  // padding that the browser's native impl handles inconsistently when
  // the header is `position: sticky` inside the same scroll container.
  const scrollRowIntoView = (rowId: string) => {
    const parent = parentRef.current;
    const row = document.getElementById(`asset-row-${rowId}`);
    if (!parent || !row) return;
    const headerH = headerElRef.current?.offsetHeight ?? 0;
    const rowTop = row.offsetTop;
    const rowBottom = rowTop + row.offsetHeight;
    const viewTop = parent.scrollTop + headerH;
    const viewBottom = parent.scrollTop + parent.clientHeight;
    if (rowTop < viewTop) {
      parent.scrollTo({ top: rowTop - headerH, behavior: "smooth" });
    } else if (rowBottom > viewBottom) {
      parent.scrollTo({ top: rowBottom - parent.clientHeight, behavior: "smooth" });
    }
  };

  // Non-virtualized scroll. `pagedItems` in deps so the scroll re-runs once
  // the page-jump refetch resolves and the row actually exists in the DOM.
  useEffect(() => {
    if (virtualized || !selectedId) return;
    const timer = setTimeout(() => scrollRowIntoView(selectedId), 50);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, page, virtualized, pagedItems]);

  // ── Virtualization (used when `virtualized` prop is true) ──
  const virtualizer = useVirtualizer({
    count: virtualized ? items.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => virtualRowHeight,
    overscan: 10,
  });

  // Virtualized scroll. Rows below the current window aren't in the DOM
  // (virtualizer renders only the visible band), so we compute the target
  // offset directly: idx * rowHeight, minus the header. virtualizer.scrollToOffset
  // sets parent.scrollTop AND notifies the virtualizer to re-render.
  useEffect(() => {
    if (!virtualized || !selectedId) return;
    const idx = items.findIndex((a) => (a[idField] as string) === selectedId);
    const parent = parentRef.current;
    if (idx < 0 || !parent) return;
    const headerH = headerElRef.current?.offsetHeight ?? 0;
    const rowTop = idx * virtualRowHeight;
    const rowBottom = rowTop + virtualRowHeight;
    const viewTop = parent.scrollTop + headerH;
    const viewBottom = parent.scrollTop + parent.clientHeight;
    if (rowTop < viewTop) {
      virtualizer.scrollToOffset(rowTop - headerH, { behavior: "smooth" });
    } else if (rowBottom > viewBottom) {
      virtualizer.scrollToOffset(rowBottom - parent.clientHeight, { behavior: "smooth" });
    }
  }, [selectedId, virtualized, items, idField, virtualRowHeight, virtualizer]);

  // Grid template shared by virtualized header + rows so columns align.
  const gridTemplateColumns = useMemo(
    () => `repeat(${columns.length}, minmax(0, 1fr))`,
    [columns.length],
  );

  return (
    <div className="border-t border-border bg-card flex flex-col" style={{ flex: "1 1 45%", minHeight: 0 }}>
      <div className="gradient-table-line" />
      {/* Search bar */}
      <div className="px-3 py-1.5 border-b border-border/50 shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Search by Asset ID, Route, Type, Issue..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-7 pl-7 text-[11px] bg-muted/30 border-border/50"
          />
        </div>
      </div>
      <div
        ref={parentRef}
        className="overflow-auto w-full"
        style={{ flex: 1, minHeight: 0 }}
      >
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
        ) : virtualized ? (
          <div>
            {/* Sticky header — uses the same grid template as the rows. */}
            <div
              ref={headerRef}
              className="sticky top-0 z-10 bg-card border-b border-border"
              style={{ display: "grid", gridTemplateColumns }}
            >
              {columns.map((col) => {
                const sortable = !!col.getValue;
                const isActive = propSortKey === col.key;
                return (
                  <div
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
                  </div>
                );
              })}
            </div>
            {/* Virtualized row container — total-height spacer with
                 absolutely positioned rendered rows. */}
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                position: "relative",
                width: "100%",
              }}
            >
              {virtualizer.getVirtualItems().map((vRow) => {
                const item = items[vRow.index];
                if (!item) return null;
                const rowId = item[idField] as string;
                return (
                  <div
                    key={rowId ?? vRow.index}
                    id={`asset-row-${rowId}`}
                    className={cn(
                      "cursor-pointer hover:bg-muted/40 border-b border-border/50",
                      selectedId === rowId && "bg-primary/5 dark:bg-muted-secondary/20"
                    )}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${vRow.size}px`,
                      transform: `translateY(${vRow.start}px)`,
                      display: "grid",
                      gridTemplateColumns,
                      alignItems: "center",
                    }}
                    onClick={() => onRowClick(item)}
                  >
                    {columns.map((col) => (
                      <div key={col.key} className={cn("overflow-hidden", col.className)}>
                        {col.render(item)}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          // Raw <table> instead of shadcn <Table> on purpose. shadcn's wrapper
          // adds its own `overflow-auto` div that hugs the table content, so
          // when the row count is small the horizontal scrollbar appears just
          // below the last row instead of at the bottom of the parent scroll
          // container. With a bare table, the outer parentRef div owns both
          // axes and the scrollbar lands at the container's bottom edge.
          <table className="w-full caption-bottom text-sm">
            <TableHeader ref={headerRef} className="sticky top-0 z-10 bg-card">
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
          </table>
        )}
      </div>
      {totalCount > 0 && virtualized ? (
        <div className="flex items-center justify-between px-4 py-1 border-t border-border text-[11px] text-muted-foreground">
          <span className="tabular-nums">{totalCount.toLocaleString()} total</span>
        </div>
      ) : totalCount > 0 ? (
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
      ) : null}
    </div>
  );
}
