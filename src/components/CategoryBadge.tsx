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

const getCategoryColour = (category: string) => {
  if (Object.keys(CATEGORY_COLORS_MAP).includes(category)) {
    return CATEGORY_COLORS_MAP[category];
  }
  const color = BADGE_STYLES[Math.floor(Math.random() * BADGE_STYLES.length)];
  CATEGORY_COLORS_MAP[category] = color;
  return color;
}

export function CategoryBadge({ category }: { category: string }) {
  const style = getCategoryColour(category);
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${style}`}>
      {category}
    </span>
  );
}

export function getCategoryBadgeStyle(category: string): string {
  return CATEGORY_COLORS_MAP[category] || "bg-muted text-muted-foreground";
}

const DOT_COLORS = [
  "bg-blue-500",
  "bg-cyan-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-purple-500",
  "bg-pink-500",
];

export function getCategoryDotColor(category: string): string {
  return DOT_COLORS[Math.floor(Math.random() * DOT_COLORS.length)];
}