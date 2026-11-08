// Armory helpers shared by the server and the browser.

export const ARMORY_CATEGORIES = [
  { value: "ebook", label: "Ebooks" },
  { value: "gear", label: "Gear" },
  { value: "program", label: "Programs" },
  { value: "other", label: "Other" },
] as const;

export type ArmoryCategory = (typeof ARMORY_CATEGORIES)[number]["value"];
export type ArmoryKind = "link" | "download" | "paid" | "product";

export function categoryLabel(category: string) {
  return ARMORY_CATEGORIES.find((item) => item.value === category)?.label ?? "Other";
}

// Gear is shipped, never downloaded, so digital items can't use the Gear category.
export function categoriesFor(kind: ArmoryKind) {
  return kind === "download" || kind === "paid"
    ? ARMORY_CATEGORIES.filter((category) => category.value !== "gear")
    : ARMORY_CATEGORIES;
}

export function isCategory(value: unknown): value is ArmoryCategory {
  return ARMORY_CATEGORIES.some((item) => item.value === value);
}

export function formatPrice(cents: number | null) {
  if (cents === null) return null;
  if (cents === 0) return "Free";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

// "24.99", "$24.99", "24" or "" (no price shown). Returns cents, null for blank, or NaN if unreadable.
export function parsePrice(value: string) {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return Number.NaN;
  return Math.round(Number(cleaned) * 100);
}

export const DOWNLOAD_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  epub: "application/epub+zip",
  zip: "application/zip",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

export const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function fileExtension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

// Keeps a readable name for the stored file without characters that cause trouble in links.
export function safeFileName(name: string) {
  const extension = fileExtension(name);
  const base = (extension ? name.slice(0, -(extension.length + 1)) : name)
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .slice(0, 80)
    .toLowerCase();
  return `${base || "file"}${extension ? `.${extension}` : ""}`;
}

export function publicImageUrl(supabaseUrl: string, path: string | null) {
  if (!path) return null;
  return `${supabaseUrl}/storage/v1/object/public/armory-images/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function describeSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// GYMX2 keeps 10% of each coach sale. Sales of GYMX2's own items have no split.
export const PLATFORM_FEE_PERCENT = 10;

export function platformFeeCents(amountCents: number) {
  return Math.round((amountCents * PLATFORM_FEE_PERCENT) / 100);
}

export const MIN_PAID_PRICE_CENTS = 100;

// Money amounts in reports, where zero shows as $0.00 rather than "Free".
export function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export const DEFAULT_SIZES = "S, M, L, XL, 2XL";

// "S, M, L" or one per line, into a clean list. Repeats and blanks are dropped.
export function parseSizes(text: string) {
  const seen = new Set<string>();
  const sizes: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const size = raw.trim().slice(0, 20);
    const key = size.toLowerCase();
    if (!size || seen.has(key)) continue;
    seen.add(key);
    sizes.push(size);
  }
  return sizes;
}

export type ShippingAddress = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
};

export function addressLines(address: ShippingAddress | null) {
  if (!address) return [];
  const cityLine = [address.city, [address.state, address.postal_code].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [address.line1, address.line2, cityLine, address.country === "US" ? null : address.country].filter(
    (line): line is string => Boolean(line),
  );
}

export const fulfillmentLabel: Record<string, string> = {
  not_needed: "Digital",
  to_ship: "To ship",
  shipped: "Shipped",
};
