import { assetCategories } from "@/data/assetCategories";

// Fixed color map — each of the 6 categories gets a permanent color
const CATEGORY_COLORS_MAP: Record<string, string> = {};
const BADGE_STYLES = [
  "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  "bg-pink-500/15 text-pink-700 dark:text-pink-300",
];

assetCategories.forEach((cat, i) => {
  CATEGORY_COLORS_MAP[cat] = BADGE_STYLES[i % BADGE_STYLES.length];
});

export function CategoryBadge({ category }: { category: string }) {
  const style = CATEGORY_COLORS_MAP[category] || "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${style}`}>
      {category}
    </span>
  );
}

export function getCategoryBadgeStyle(category: string): string {
  return CATEGORY_COLORS_MAP[category] || "bg-muted text-muted-foreground";
}
