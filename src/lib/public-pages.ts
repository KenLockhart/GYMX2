// Public coach pages (gymx2.com/c/<slug>) and member reviews.

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;
export const REVIEW_MAX = 1000;

// "Coach Ken Lockhart!" -> "coach-ken-lockhart"
export function suggestSlug(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function isValidSlug(slug: string) {
  return SLUG_PATTERN.test(slug) && !slug.includes("--");
}

export function ratingSummary(ratings: number[]) {
  if (ratings.length === 0) return null;
  const average =
    ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
  return { average: Math.round(average * 10) / 10, count: ratings.length };
}

// Reviews show the reviewer's first name and last initial: "Ken L."
export function reviewerName(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "A member";
  return parts.length === 1
    ? parts[0]
    : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export function stars(rating: number) {
  const full = Math.round(rating);
  return "★".repeat(full) + "☆".repeat(5 - full);
}
