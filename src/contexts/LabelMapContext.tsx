import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "./AuthContext";

interface ResolvedItem {
  category_id?: string;
  asset_id?: string;
  group_id?: string;
  default_name: string;
  default_group_id?: string;
  display_name: string;
  original_display_name: string;
  icon_url?: string;
  icon_size?: [number, number];
  icon_anchor?: [number, number];
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

    // Update local state for all member IDs
    setData((prev) => {
      if (!prev) return prev;
      const updatedLabels = { ...prev.labels };
      for (const aid of assetIds) {
        if (updatedLabels[aid]) {
          updatedLabels[aid] = {
            ...updatedLabels[aid],
            display_name: newGroupId,
            ...(newGroupId ? { group_id: newGroupId } : {}),
          };
        }
      }
      return { ...prev, labels: updatedLabels };
    });
  };

  const updateAssetIcon = async (assetIds: string[], iconConfig: { icon_url?: string; icon_size?: [number, number]; icon_anchor?: [number, number]; group_id?: string; reset?: boolean }) => {
    await api.user.updateAssetIconConfig(assetIds, iconConfig);

    // Update local state
    setData((prev) => {
      if (!prev) return prev;
      const updatedLabels = { ...prev.labels };
      for (const aid of assetIds) {
        if (updatedLabels[aid]) {
          if (iconConfig.reset) {
            const { icon_url: _a, icon_size: _b, icon_anchor: _c, ...rest } = updatedLabels[aid];
            updatedLabels[aid] = { ...rest, display_name: rest.default_group_id };
          } else {
            updatedLabels[aid] = {
              ...updatedLabels[aid],
              ...(iconConfig.icon_url !== undefined && { icon_url: iconConfig.icon_url }),
              ...(iconConfig.icon_size !== undefined && { icon_size: iconConfig.icon_size }),
              ...(iconConfig.icon_anchor !== undefined && { icon_anchor: iconConfig.icon_anchor }),
              ...(iconConfig.group_id !== undefined && { group_id: iconConfig.group_id, display_name: iconConfig.group_id }),
            };
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
