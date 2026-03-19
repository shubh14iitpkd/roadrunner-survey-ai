import { useState } from "react";
import { useLabelMap } from "@/contexts/LabelMapContext";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { API_BASE } from "@/lib/api";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Pencil, Check, X, Tag, Search, AlertCircle, ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import AssetIconEditDialog from "./AssetIconEditDialog";

export default function AssetLabelSettings() {
  const { data, loading, updateCategoryLabel, updateAssetLabel, updateAssetIcon, updateAssetCategory } = useLabelMap();
  const { toast } = useToast();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Icon edit dialog state
  const [iconEditTarget, setIconEditTarget] = useState<{
    displayName: string;
    originalDisplayName: string;
    assetIds: string[];
    iconUrl?: string;
    iconSize?: [number, number];
    iconAnchor?: [number, number];
    categoryId?: string;
  } | null>(null);

  const handleEdit = (id: string, currentValue: string) => {
    setEditingId(id);
    setEditValue(currentValue);
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditValue("");
  };

  const handleSaveCategory = async (categoryId: string) => {
    if (!editValue.trim()) return;

    setSaving(true);
    try {
      await updateCategoryLabel(categoryId, editValue.trim());
      
      toast({
        title: "Saved",
        description: "Category name updated successfully",
      });
      setEditingId(null);
    } catch (err) {
      console.error("Failed to save category:", err);
      toast({
        title: "Error",
        description: "Failed to save category name",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveLabel = async (assetIds: string[]) => {
    if (!editValue.trim()) return;

    setSaving(true);
    try {
      await updateAssetLabel(assetIds, editValue.trim());

      toast({
        title: "Saved",
        description: "Asset label updated successfully",
      });
      setEditingId(null);
    } catch (err) {
      console.error("Failed to save label:", err);
      toast({
        title: "Error",
        description: "Failed to save asset label",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex gap-4">
          <Skeleton className="h-10 w-1/3" />
          <Skeleton className="h-10 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center bg-muted/30 rounded-lg border border-dashed">
        <AlertCircle className="h-8 w-8 text-muted-foreground mb-2" />
        <p className="text-sm font-medium">Unable to load asset labels</p>
        <p className="text-xs text-muted-foreground mt-1">Please try refreshing the page</p>
      </div>
    );
  }

  const categories = Object.values(data.categories);
  const allLabels = Object.values(data.labels);

  // Group labels by group_id; labels without group_id stay individual
  const groupedLabels: { groupKey: string; displayName: string; groupId: string | null; assetIds: string[]; originalDisplayName: string; iconUrl?: string; iconSize?: [number, number]; iconAnchor?: [number, number]; categoryId?: string }[] = [];
  const groupMap = new Map<string, { displayName: string; groupId: string; assetIds: string[]; originalDisplayName: string; iconUrl?: string; iconSize?: [number, number]; iconAnchor?: [number, number]; categoryId?: string }>();

  for (const label of allLabels) {
    const gid = (label as any).group_id as string | undefined;
    if (gid) {
      if (!groupMap.has(gid)) {
        groupMap.set(gid, {
          displayName: label.display_name,
          groupId: gid,
          assetIds: [],
          originalDisplayName: label.original_display_name,
          iconUrl: label.icon_url,
          iconSize: label.icon_size,
          iconAnchor: label.icon_anchor,
          categoryId: label.category_id,
        });
      }
      groupMap.get(gid)!.assetIds.push(label.asset_id!);
    } else {
      groupedLabels.push({
        groupKey: label.asset_id!,
        displayName: label.display_name,
        groupId: null,
        assetIds: [label.asset_id!],
        originalDisplayName: label.original_display_name,
        iconUrl: label.icon_url,
        iconSize: label.icon_size,
        iconAnchor: label.icon_anchor,
        categoryId: label.category_id,
      });
    }
  }
  for (const [gid, group] of groupMap) {
    groupedLabels.push({
      groupKey: `group-${gid}`,
      displayName: group.displayName,
      groupId: gid,
      assetIds: group.assetIds,
      originalDisplayName: group.originalDisplayName,
      iconUrl: group.iconUrl,
      iconSize: group.iconSize,
      iconAnchor: group.iconAnchor,
      categoryId: group.categoryId,
    });
  }

  // Filter by search query
  const filteredGroups = groupedLabels.filter((g) =>
    g.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (g.groupId || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
    g.originalDisplayName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-8">
      {/* Categories Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold tracking-tight">Categories</h3>
          <Badge variant="outline" className="font-normal">
            {categories.length} Total
          </Badge>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {categories.map((cat) => {
            const id = cat.category_id!;
            const isEditing = editingId === `cat-${id}`;

            return (
              <div
                key={id}
                className={`dark:hover:border-muted-secondary group flex items-center justify-between p-3 rounded-lg border bg-card transition-all duration-200 hover:shadow-sm hover:border-primary/20 ${isEditing ? 'ring-2 ring-primary/20 border-primary' : ''}`}
              >
                {isEditing ? (
                  <div className="flex items-center gap-2 flex-1 animate-in fade-in zoom-in-95 duration-200">
                    <Input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="h-8 text-sm"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveCategory(id);
                        if (e.key === "Escape") handleCancel();
                      }}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 hover:bg-green-500/10 hover:text-green-600"
                      onClick={() => handleSaveCategory(id)}
                      disabled={saving}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive"
                      onClick={handleCancel}
                      disabled={saving}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium text-sm truncate">{cat.display_name}</span>
                      {cat.display_name !== cat.original_display_name && (
                        <span className="text-xs text-muted-foreground truncate">
                          Default: {cat.original_display_name}
                        </span>
                      )}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleEdit(`cat-${id}`, cat.display_name)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Assets Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold tracking-tight">Asset Types</h3>
            <Badge variant="secondary" className="font-normal">
              {filteredGroups.length}
            </Badge>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search asset types..." 
              className="h-9 pl-9 w-[200px] lg:w-[300px] text-sm bg-muted/30"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <ScrollArea className="h-[400px] rounded-lg p-1 !overscroll-none">
          <div className="p-2 space-y-1">
            {filteredGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <Tag className="h-8 w-8 mb-2 opacity-20" />
                <p className="text-sm">No assets found</p>
              </div>
            ) : (
              <Accordion type="single" collapsible className="space-y-1 !overscroll-none">
              {filteredGroups.map((group) => {
                const key = group.groupKey;
                const isEditing = editingId === `label-${key}`;
                // Real label Item
                return (
                  <AccordionItem
                    key={key} 
                    value={key} 
                    className={`border overscroll-none dark:hover:border-muted-secondary rounded-md px-3 bg-card transition-colors hover:bg-accent/5 ${isEditing ? 'border-primary/50 ring-1 ring-primary/20 bg-accent/10' : ''}`}
                  >
                    <div className="flex items-center dark:hover:border-muted-secondary justify-between py-2.5">
                      {isEditing ? (
                        <div className="flex items-center gap-2 flex-1 animate-in fade-in zoom-in-95 duration-200">
                          <Input
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="h-8 text-sm"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveLabel(group.assetIds);
                              if (e.key === "Escape") handleCancel();
                            }}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 hover:bg-green-500/10 hover:text-green-600"
                            onClick={() => handleSaveLabel(group.assetIds)}
                            disabled={saving}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive"
                            onClick={handleCancel}
                            disabled={saving}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <>
                        {/* Label Item */}
                          <div className="flex items-center gap-2 dark:hover:border-muted-secondary flex-1 min-w-0 pr-4">
                            {/* Icon preview */}
                            {group.iconUrl ? (
                              <img src={`${API_BASE}${group.iconUrl}`} alt="" className="w-5 h-5 object-contain shrink-0" />
                            ) : (
                              <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center shrink-0">
                                <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                              </div>
                            )}
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium text-sm">{group.displayName}</span>
                              {group.displayName !== group.originalDisplayName && (
                                <Badge variant="outline" className="text-xs h-5 px-1.5 font-normal text-muted-foreground">
                                  Default: {group.originalDisplayName}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-0.5">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              title="Edit icon & display name"
                              onClick={(e) => {
                                e.stopPropagation();
                                setIconEditTarget({
                                  displayName: group.displayName,
                                  originalDisplayName: group.originalDisplayName,
                                  assetIds: group.assetIds,
                                  iconUrl: group.iconUrl,
                                  iconSize: group.iconSize,
                                  iconAnchor: group.iconAnchor,
                                  categoryId: group.categoryId,
                                });
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            {/* <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              title="Edit display name"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEdit(`label-${key}`, group.displayName);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button> */}
                          </div>
                        </>
                      )}
                    </div>
                  </AccordionItem>
                );
              })}
              <div className="pointer-events-none sticky bottom-0 h-6 w-full 
                    bg-gradient-to-b from-transparent to-black/20" />
            </Accordion>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Icon Edit Dialog */}
      <AssetIconEditDialog
        open={!!iconEditTarget}
        onOpenChange={(open) => { if (!open) setIconEditTarget(null); }}
        displayName={iconEditTarget?.displayName ?? ""}
        originalDisplayName={iconEditTarget?.originalDisplayName ?? ""}
        assetIds={iconEditTarget?.assetIds ?? []}
        currentIconUrl={iconEditTarget?.iconUrl}
        currentIconSize={iconEditTarget?.iconSize}
        currentIconAnchor={iconEditTarget?.iconAnchor}
        currentCategoryId={iconEditTarget?.categoryId}
        categories={categories.map((c) => ({ category_id: c.category_id!, display_name: c.display_name }))}
        onSave={async (assetIds, config) => {
          const { category_id, ...iconConfig } = config;
          const hasIconChanges = Object.keys(iconConfig).length > 0;
          if (hasIconChanges) {
            await updateAssetIcon(assetIds, iconConfig);
          }
          if (category_id) {
            await updateAssetCategory(assetIds, category_id);
          }
          toast({ title: "Saved", description: "Asset configuration updated" });
          setIconEditTarget(null);
        }}
      />
    </div>
  );
}
