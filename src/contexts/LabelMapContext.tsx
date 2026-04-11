import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "./AuthContext";

interface ResolvedItem {
  default_name: string;
  display_name: string;

  // category specific
  category_id?: string;

  // asset type specific
  asset_id?: string;
  group_id?: string;
  default_group_id?: string;
  icon_url?: string;
  icon_size?: [number, number];
  icon_anchor?: [number, number];
  attributes?: Record<string, readonly string[]>;
}

export interface ResolvedMap {
  categories: Record<string, ResolvedItem>;
  labels: Record<string, ResolvedItem>;
}

export interface LabelMapContextType {
  data: ResolvedMap | null;
  loading: boolean;
  error: Error | null;
  updateCategoryLabel: (categoryId: string, displayName: string) => Promise<void>;
  updateAssetLabel: (assetIds: string[], displayName: string, oldGroupId?: string) => Promise<void>;
  updateAssetIcon: (assetIds: string[], iconConfig: { icon_url?: string; icon_size?: [number, number]; icon_anchor?: [number, number]; display_name?: string; reset?: boolean }) => Promise<void>;
  updateAssetCategory: (assetIds: string[], newCategoryId: string) => Promise<void>;
  refreshData: () => Promise<void>;
}

const LabelMapContext = createContext<LabelMapContextType | undefined>(undefined);

export function LabelMapProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [data, setData] = useState<ResolvedMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const result = await api.user.getResolvedLabelMap(user.id);
      setData(result);
    } catch (err) {
      console.error("Failed to fetch label map:", err);
      setError(err instanceof Error ? err : new Error("Failed to fetch label map"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user?.id]);

  const updateCategoryLabel = async (categoryId: string, displayName: string) => {
    await api.user.updateGlobalCategory(categoryId, displayName);

    // Update local state
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        categories: {
          ...prev.categories,
          [categoryId]: {
            ...prev.categories[categoryId],
            display_name: displayName,
          },
        },
      };
    });
  };

  const updateAssetLabel = async (assetIds: string[], newGroupId: string, oldGroupId?: string) => {

    await api.user.updateGlobalLabel(newGroupId, oldGroupId);

    // Update local state: group_id is authoritative, display_name kept in sync
    setData((prev) => {
      if (!prev) return prev;
      const updatedLabels = { ...prev.labels };
      for (const aid of assetIds) {
        if (updatedLabels[aid]) {
          updatedLabels[aid] = {
            ...updatedLabels[aid],
            group_id: newGroupId,
            display_name: newGroupId,
          };
        }
      }
      return { ...prev, labels: updatedLabels };
    });
  };

  const updateAssetIcon = async (assetIds: string[], iconConfig: { icon_url?: string; icon_size?: [number, number]; icon_anchor?: [number, number]; group_id?: string; reset?: boolean }) => {
    await api.user.updateAssetIconConfig(assetIds, iconConfig);

    // Update local state: group_id is authoritative, display_name kept in sync
    setData((prev) => {
      if (!prev) return prev;
      const updatedLabels = { ...prev.labels };
      for (const aid of assetIds) {
        if (updatedLabels[aid]) {
          if (iconConfig.reset) {
            const { icon_url: _a, icon_size: _b, icon_anchor: _c, ...rest } = updatedLabels[aid];
            const resetName = rest.default_group_id || rest.default_name;
            updatedLabels[aid] = { ...rest, group_id: resetName, display_name: resetName };
          } else {
            const updates: Partial<ResolvedItem> = {};
            if (iconConfig.icon_url !== undefined) updates.icon_url = iconConfig.icon_url;
            if (iconConfig.icon_size !== undefined) updates.icon_size = iconConfig.icon_size;
            if (iconConfig.icon_anchor !== undefined) updates.icon_anchor = iconConfig.icon_anchor;
            if (iconConfig.group_id !== undefined) {
              updates.group_id = iconConfig.group_id;
              updates.display_name = iconConfig.group_id;
            }
            updatedLabels[aid] = { ...updatedLabels[aid], ...updates };
          }
        }
      }
      return { ...prev, labels: updatedLabels };
    });
  };

  const updateAssetCategory = async (assetIds: string[], newCategoryId: string) => {
    await api.user.moveAssetCategory(assetIds, newCategoryId);

    setData((prev) => {
      if (!prev) return prev;
      const updatedLabels = { ...prev.labels };
      for (const aid of assetIds) {
        if (updatedLabels[aid]) {
          updatedLabels[aid] = { ...updatedLabels[aid], category_id: newCategoryId };
        }
      }
      return { ...prev, labels: updatedLabels };
    });
  };

  const refreshData = async () => {
    await fetchData();
  };

  return (
    <LabelMapContext.Provider
      value={{
        data,
        loading,
        error,
        updateCategoryLabel,
        updateAssetLabel,
        updateAssetIcon,
        updateAssetCategory,
        refreshData,
      }}
    >
      {children}
    </LabelMapContext.Provider>
  );
}

export function useLabelMap() {
  const context = useContext(LabelMapContext);
  if (context === undefined) {
    throw new Error("useLabelMap must be used within a LabelMapProvider");
  }
  return context;
}
