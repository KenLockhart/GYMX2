export type ApparelOptionVariant = Readonly<{
  id: string;
  name: string;
  color: string | null;
  size: string | null;
  available: boolean;
}>;

export type ApparelSelection = Readonly<{
  mode: "facets" | "exact" | "unavailable";
  variants: readonly ApparelOptionVariant[];
  colors: readonly string[];
  sizes: readonly string[];
  color: string;
  size: string;
  variant: ApparelOptionVariant | null;
}>;

const LOCAL_VARIANT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isLocalVariantUuid(value: unknown): value is string {
  return typeof value === "string" && LOCAL_VARIANT_UUID.test(value);
}

function optionLabel(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function unavailableSelection(): ApparelSelection {
  return { mode: "unavailable", variants: [], colors: [], sizes: [], color: "", size: "", variant: null };
}

export function deriveApparelSelection(
  input: readonly ApparelOptionVariant[],
  requested: Readonly<{ color?: string; size?: string; variantId?: string }> = {},
): ApparelSelection {
  const variants = input.filter((variant) =>
    variant.available === true && isLocalVariantUuid(variant.id),
  );
  if (variants.length === 0 || new Set(variants.map((variant) => variant.id)).size !== variants.length) {
    return unavailableSelection();
  }

  const pairs = new Set<string>();
  let facetsAreUnambiguous = true;
  for (const variant of variants) {
    const color = optionLabel(variant.color);
    const size = optionLabel(variant.size);
    if (!color || !size) {
      facetsAreUnambiguous = false;
      break;
    }
    const pair = JSON.stringify([color, size]);
    if (pairs.has(pair)) {
      facetsAreUnambiguous = false;
      break;
    }
    pairs.add(pair);
  }

  if (!facetsAreUnambiguous) {
    const selected = variants.find((variant) => variant.id === requested.variantId) ?? variants[0];
    return {
      mode: "exact",
      variants,
      colors: [],
      sizes: [],
      color: "",
      size: "",
      variant: selected,
    };
  }

  const colors = [...new Set(variants.map((variant) => optionLabel(variant.color) as string))];
  const color = colors.includes(requested.color ?? "") ? requested.color as string : colors[0];
  if (!color) return unavailableSelection();
  const colorVariants = variants.filter((variant) => optionLabel(variant.color) === color);
  const sizes = [...new Set(colorVariants.map((variant) => optionLabel(variant.size) as string))];
  const size = sizes.includes(requested.size ?? "") ? requested.size as string : sizes[0];
  if (!size) return unavailableSelection();
  const variant = colorVariants.find((candidate) => optionLabel(candidate.size) === size) ?? null;

  return { mode: "facets", variants, colors, sizes, color, size, variant };
}

export function parsePublicApparelVariants(value: unknown): readonly ApparelOptionVariant[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((raw): ApparelOptionVariant[] => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const row = raw as Record<string, unknown>;
    const color = row.color;
    const size = row.size;
    if (!isLocalVariantUuid(row.id) || typeof row.name !== "string" || !row.name.trim() || row.available !== true ||
        !(color === null || typeof color === "string") ||
        !(size === null || typeof size === "string")) return [];
    return [{ id: row.id, name: row.name, color, size, available: true }];
  });
}
