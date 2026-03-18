import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RotateCcw, Loader2, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, API_BASE } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

const DEFAULT_ICON_SIZE: [number, number] = [32, 32];
const DEFAULT_ICON_ANCHOR: [number, number] = [16, 24];

interface AssetIconEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayName: string;
  originalDisplayName: string;
  assetIds: string[];
  currentIconUrl?: string;
  currentIconSize?: [number, number];
  currentIconAnchor?: [number, number];
  currentCategoryId?: string;
  categories?: { category_id: string; display_name: string }[];
  onSave: (assetIds: string[], config: {
    icon_url?: string;
    icon_size?: [number, number];
    icon_anchor?: [number, number];
    display_name?: string;
    reset?: boolean;
    category_id?: string;
  }) => Promise<void>;
}

export default function AssetIconEditDialog({
  open,
  onOpenChange,
  displayName,
  originalDisplayName,
  assetIds,
  currentIconUrl,
  currentIconSize,
  currentIconAnchor,
  currentCategoryId,
  categories,
  onSave,
}: AssetIconEditDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedIconUrl, setSelectedIconUrl] = useState<string | undefined>(currentIconUrl);
  const [editDisplayName, setEditDisplayName] = useState(displayName);
  const [iconSize, setIconSize] = useState<[number, number]>(currentIconSize || DEFAULT_ICON_SIZE);
  const [iconAnchor, setIconAnchor] = useState<[number, number]>(currentIconAnchor || DEFAULT_ICON_ANCHOR);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(currentCategoryId);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Available icons fetched from backend
  const [availableIcons, setAvailableIcons] = useState<{ filename: string; icon_url: string }[]>([]);
  const [loadingIcons, setLoadingIcons] = useState(false);

  useEffect(() => {
    if (open) {
      if (currentIconUrl && !currentIconUrl.startsWith("http")) {
          setSelectedIconUrl(`${API_BASE}${currentIconUrl}`);
      } else {
        setSelectedIconUrl(currentIconUrl);
      }
      setEditDisplayName(displayName);
      setIconSize(currentIconSize || DEFAULT_ICON_SIZE);
      setIconAnchor(currentIconAnchor || DEFAULT_ICON_ANCHOR);
      setSelectedCategoryId(currentCategoryId);

      // Fetch available icons from backend
      setLoadingIcons(true);
      api.assets.getAvailableIcons()
        .then((resp: any) => setAvailableIcons(resp?.icons || []))
        .catch(() => setAvailableIcons([]))
        .finally(() => setLoadingIcons(false));
    }
  }, [open, currentIconUrl, displayName, currentIconSize, currentIconAnchor]);

  const hasChanges =
    selectedIconUrl !== currentIconUrl ||
    editDisplayName !== displayName ||
    iconSize[0] !== (currentIconSize?.[0] ?? DEFAULT_ICON_SIZE[0]) ||
    iconSize[1] !== (currentIconSize?.[1] ?? DEFAULT_ICON_SIZE[1]) ||
    selectedCategoryId !== currentCategoryId;

  const hasCustomization = !!currentIconUrl || displayName !== originalDisplayName;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate client-side
    const allowedTypes = ["image/png", "image/svg+xml", "image/jpeg", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      toast({ title: "Invalid file type", description: "Please upload PNG, SVG, JPG, or WEBP.", variant: "destructive" });
      return;
    }
    if (file.size > 500 * 1024) {
      toast({ title: "File too large", description: "Maximum size is 500KB.", variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const resp = await api.user.uploadAssetIcon(file);
      if (resp?.icon_url) {
        setSelectedIconUrl(resp.icon_url);
        // Add to available icons list if not already present
        setAvailableIcons((prev) => {
          if (prev.some((i) => i.filename === resp.filename)) return prev;
          return [...prev, { filename: resp.filename, icon_url: resp.icon_url }];
        });
        toast({ title: "Icon uploaded", description: resp.filename });
      }
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      // Reset input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const config: any = {};
      if (selectedIconUrl !== currentIconUrl) {
        config.icon_url = selectedIconUrl || null;
        config.icon_size = selectedIconUrl ? iconSize : null;
        config.icon_anchor = selectedIconUrl ? iconAnchor : null;
      }
      if (editDisplayName !== displayName) {
        config.display_name = editDisplayName;
      }
      if (selectedCategoryId !== currentCategoryId) {
        config.category_id = selectedCategoryId;
      }
      await onSave(assetIds, config);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      await onSave(assetIds, { reset: true });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Edit Asset Configuration</DialogTitle>
          <DialogDescription className="text-xs">
            Configure icon and display name for this asset type. Changes apply globally.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Display Name */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Display Name</Label>
            <Input
              value={editDisplayName}
              onChange={(e) => setEditDisplayName(e.target.value)}
              className="h-8 text-sm"
              placeholder={originalDisplayName}
            />
            {editDisplayName !== originalDisplayName && (
              <p className="text-[10px] text-muted-foreground">
                Default: {originalDisplayName}
              </p>
            )}
          </div>

          {/* Category */}
          {categories && categories.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs font-medium">Category</Label>
              <Select value={selectedCategoryId} onValueChange={setSelectedCategoryId}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.category_id} value={cat.category_id}>
                      {cat.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedCategoryId !== currentCategoryId && (
                <p className="text-[10px] text-muted-foreground">
                  Moving this asset type will update all existing records.
                </p>
              )}
            </div>
          )}

          {/* Current Icon Preview */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Current Icon</Label>
            <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/20">
              {selectedIconUrl ? (
                <div className="relative">
                  <img
                    src={selectedIconUrl}
                    alt="Current icon"
                    className="w-10 h-10 object-contain"
                  />
                  <button
                    onClick={() => setSelectedIconUrl(undefined)}
                    className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center hover:bg-destructive/80"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ) : (
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                  <div className="w-4 h-4 rounded-full bg-muted-foreground/30" />
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                {selectedIconUrl
                  ? selectedIconUrl.split("/").pop()
                  : "No custom icon, using default circle marker"}
              </div>
            </div>
          </div>

          {/* Upload New Icon */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Upload Icon</Label>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".png,.svg,.jpg,.jpeg,.webp"
                className="hidden"
                onChange={handleUpload}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                {uploading ? "Uploading..." : "Upload Image"}
              </Button>
              <span className="text-[10px] text-muted-foreground">PNG, SVG, JPG, WEBP (max 500KB)</span>
            </div>
          </div>

          {/* Pick from Existing Icons */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Or Choose Existing</Label>
            {loadingIcons ? (
              <div className="flex items-center gap-2 p-4">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Loading icons...</span>
              </div>
            ) : availableIcons.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No icons available. Upload one above.</p>
            ) : (
              <div className="grid grid-cols-5 gap-2 max-h-[200px] overflow-y-auto px-1 py-4">
                {availableIcons.map((icon) => {
                  const isActive = selectedIconUrl === icon.icon_url;
                  return (
                    <button
                      key={icon.filename}
                      onClick={() => setSelectedIconUrl(`${API_BASE}${icon.icon_url}`)}
                      className={cn(
                        "flex flex-col items-center gap-1 p-2 rounded-lg border transition-all",
                        isActive
                          ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                          : "border-border hover:border-muted-foreground/30 hover:bg-muted/30"
                      )}
                    >
                      <img
                        src={`${API_BASE}${icon.icon_url}`}
                        alt={icon.filename}
                        className="w-7 h-7 object-contain"
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Icon Size (only when icon is selected) */}
          {false && (
            <div className="space-y-2">
              <Label className="text-xs font-medium">Icon Size (px)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={iconSize[0]}
                  onChange={(e) => setIconSize([Number(e.target.value), iconSize[1]])}
                  className="h-8 text-sm w-20"
                  min={12}
                  max={64}
                />
                <span className="text-xs text-muted-foreground">x</span>
                <Input
                  type="number"
                  value={iconSize[1]}
                  onChange={(e) => setIconSize([iconSize[0], Number(e.target.value)])}
                  className="h-8 text-sm w-20"
                  min={12}
                  max={64}
                />
              </div>
            </div>
          )}

          {/* Asset IDs info */}
          {/* <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">
              Applies to {assetIds.length} asset type{assetIds.length > 1 ? "s" : ""}
            </span>
            {assetIds.length > 1 && (
              <Badge variant="secondary" className="text-[9px] h-4 px-1.5">
                {assetIds.length} variants
              </Badge>
            )}
          </div> */}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {hasCustomization && (
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto text-xs gap-1 text-muted-foreground hover:text-destructive"
              onClick={handleReset}
              disabled={saving}
            >
              <RotateCcw className="h-3 w-3" />
              Reset to Default
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !hasChanges}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
