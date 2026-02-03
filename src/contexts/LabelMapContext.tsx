import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "./AuthContext";

interface ResolvedItem {
  category_id?: string;
  asset_id?: string;
  display_name: string;
  original_display_name: string;
}

interface ResolvedMap {
  categories: Record<string, ResolvedItem>;
  labels: Record<string, ResolvedItem>;
}

interface LabelMapContextType {
  data: ResolvedMap | null;
  loading: boolean;
  error: Error | null;
  updateCategoryLabel: (categoryId: string, displayName: string) => Promise<void>;
  updateAssetLabel: (assetId: string, displayName: string) => Promise<void>;
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
    if (!user?.id) throw new Error("User not authenticated");

    await api.user.updateCategoryPreference(user.id, categoryId, displayName);

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

  const updateAssetLabel = async (assetId: string, displayName: string) => {
    if (!user?.id) throw new Error("User not authenticated");

    await api.user.updateLabelPreference(user.id, assetId, displayName);

    // Update local state
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        labels: {
          ...prev.labels,
          [assetId]: {
            ...prev.labels[assetId],
            display_name: displayName,
          },
        },
      };
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
