import { useState } from "react";
import { useLabelMap } from "@/contexts/LabelMapContext";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Pencil, Check, X, Tag, Search, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function AssetLabelSettings() {
  const { data, loading, updateCategoryLabel, updateAssetLabel } = useLabelMap();
  const { toast } = useToast();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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

  const handleSaveLabel = async (assetId: string) => {
    if (!editValue.trim()) return;

    setSaving(true);
    try {
      await updateAssetLabel(assetId, editValue.trim());

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
  const labels = Object.values(data.labels).filter(label => 
    label.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    label.original_display_name.toLowerCase().includes(searchQuery.toLowerCase())
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
                className={`group flex items-center justify-between p-3 rounded-lg border bg-card transition-all duration-200 hover:shadow-sm hover:border-primary/20 ${isEditing ? 'ring-2 ring-primary/20 border-primary' : ''}`}
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
            <h3 className="text-base font-semibold tracking-tight">Assets</h3>
            <Badge variant="secondary" className="font-normal">
              {labels.length}
            </Badge>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search assets..." 
              className="h-9 pl-9 w-[200px] lg:w-[300px] text-sm bg-muted/30"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <ScrollArea className="h-[400px] border rounded-lg bg-muted/10 p-1">
          <div className="p-2 space-y-1">
            {labels.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <Tag className="h-8 w-8 mb-2 opacity-20" />
                <p className="text-sm">No assets found</p>
              </div>
            ) : (
              <Accordion type="single" collapsible className="space-y-1">
              {labels.map((label) => {
                const id = label.asset_id!;
                const isEditing = editingId === `label-${id}`;

                return (
                  <AccordionItem 
                    key={id} 
                    value={id} 
                    className={`border rounded-md px-3 bg-card transition-colors hover:bg-accent/5 ${isEditing ? 'border-primary/50 ring-1 ring-primary/20 bg-accent/10' : ''}`}
                  >
                    <div className="flex items-center justify-between py-2.5">
                      {isEditing ? (
                        <div className="flex items-center gap-2 flex-1 animate-in fade-in zoom-in-95 duration-200">
                          <Input
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="h-8 text-sm"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveLabel(id);
                              if (e.key === "Escape") handleCancel();
                            }}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 hover:bg-green-500/10 hover:text-green-600"
                            onClick={() => handleSaveLabel(id)}
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
                          <div className="flex-1 min-w-0 pr-4">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{label.display_name}</span>
                              {label.display_name !== label.original_display_name && (
                                <Badge variant="outline" className="text-xs h-5 px-1.5 font-normal text-muted-foreground">
                                  Default: {label.original_display_name}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEdit(`label-${id}`, label.display_name);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </AccordionItem>
                );
              })}
            </Accordion>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
