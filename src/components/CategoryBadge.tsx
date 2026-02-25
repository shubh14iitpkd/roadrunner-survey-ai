const BADGE_STYLES = [
  "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  "bg-pink-500/15 text-pink-700 dark:text-pink-300",
  "bg-red-500/15 text-red-700 dark:text-red-300",
];
const cid = []

const getCategoryColour = (category_id: string) => {
  if (!category_id) return "bg-gray-500"
  if (!cid.includes(category_id)) {
    cid.push(category_id)
  }
  const idx =  cid.indexOf(category_id)
  return BADGE_STYLES[idx % BADGE_STYLES.length];
}


export function getCategoryBadgeStyle(category_id: string): string {
  if (!category_id) return "bg-gray-500"
  if (!cid.includes(category_id)) {
    cid.push(category_id)
  }
  const idx =  cid.indexOf(category_id)
  return BADGE_STYLES[idx % BADGE_STYLES.length];
}

const DOT_COLORS = [
  "bg-blue-500",
  "bg-cyan-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-purple-500",
  "bg-pink-500",
];

const COLORS = [
  "#3B82F6", // blue-500
  "#06B6D4", // cyan-500
  "#10B981", // emerald-500
  "#F59E0B", // amber-500
  "#A855F7", // purple-500
  "#EC4899"  // pink-500
];

export function getCategoryDotColor(category_id: string): string {
  if (!category_id) return "bg-gray-500"
  if (!cid.includes(category_id)) {
    cid.push(category_id)
  }
  const idx =  cid.indexOf(category_id)
  return DOT_COLORS[idx % DOT_COLORS.length];
}

export function getCategoryColorCode(category_id: string): string {
  if (!category_id) return "#000000"
  if (!cid.includes(category_id)) {
    cid.push(category_id)
  }
  const idx =  cid.indexOf(category_id)
  return COLORS[idx % COLORS.length];
}

export function CategoryBadge({ category, categoryId }: { category: string, categoryId?: string }) {
  const style = getCategoryColour(categoryId ?? category);
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${style}`}>
      {category}
    </span>
  );
}

