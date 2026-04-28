// Centralized React Query key factories. Stable, structured keys make
// invalidation predictable across mutation handlers — invalidating
// `qk.assets.all` wipes every assets-scoped query in one call.

export const qk = {
  assets: {
    all: ["assets"] as const,
    mapPoints: (filters: Record<string, unknown>) =>
      ["assets", "map", filters] as const,
    paginated: (params: {
      filters: Record<string, unknown>;
      page: number;
      limit: number;
      sort_key: string;
      sort_dir: string;
    }) => ["assets", "paginated", params] as const,
    list: (params: {
      filters: Record<string, unknown>;
      sort: string;
      q: string;
    }) => ["assets", "list", params] as const,
    search: (q: string) => ["assets", "search", q] as const,
    detail: (masterDisplayId: string) =>
      ["assets", "detail", masterDisplayId] as const,
    facets: (filters: Record<string, unknown>) =>
      ["assets", "facets", filters] as const,
    // Page-of resolves which paginated page a given master_display_id sits on.
    // Sort + filters drive the answer, so they belong in the key.
    pageOf: (
      masterDisplayId: string,
      params: {
        filters: Record<string, unknown>;
        limit: number;
        sort_key: string;
        sort_dir: string;
      },
    ) => ["assets", "pageOf", masterDisplayId, params] as const,
    // Neighbor (prev/next) walks the server-sorted result set — direction +
    // sort + filters are part of identity.
    neighbor: (
      masterDisplayId: string,
      direction: "prev" | "next",
      params: {
        filters: Record<string, unknown>;
        sort_key: string;
        sort_dir: string;
      },
    ) => ["assets", "neighbor", masterDisplayId, direction, params] as const,
    keypoints: (masterDisplayId: string) =>
      ["assets", "keypoints", masterDisplayId] as const,
    geometry: (masterDisplayId: string) =>
      ["assets", "geometry", masterDisplayId] as const,
    conditionLogs: (mongoId: string) =>
      ["assets", "conditionLogs", mongoId] as const,
    labelClassifications: () =>
      ["assets", "labelClassifications"] as const,
  },
  roads: {
    all: ["roads"] as const,
    list: () => ["roads", "list"] as const,
  },
};
