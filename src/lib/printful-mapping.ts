import { parseSizes } from "@/lib/armory";

export type PrintfulVariantMapping = {
  option: string;
  sku: string;
  sync_variant_id: string | null;
};

export type PrintfulMappingFields = {
  printful_sku: string | null;
  printful_sync_variant_id: string | null;
  printful_variant_mappings: PrintfulVariantMapping[];
};

export type PrintfulMappingError =
  | "invalid_printful_sku"
  | "invalid_sync_variant_id"
  | "invalid_variant_mappings"
  | "variant_mappings_without_sizes"
  | "base_mapping_with_sizes"
  | "unknown_variant_option"
  | "duplicate_variant_option"
  | "incomplete_variant_mapping"
  | "printful_mapping_not_supported_for_category";

export type PrintfulMappingValidation =
  | { success: true; value: PrintfulMappingFields }
  | { success: false; error: PrintfulMappingError };

const MAX_SKU_LENGTH = 128;
const MAX_RAW_SKU_LENGTH = 160;
const MAX_SYNC_VARIANT_ID_LENGTH = 19;
const MAX_RAW_SYNC_VARIANT_ID_LENGTH = 64;
const MAX_MAPPINGS_JSON_LENGTH = 64 * 1024;
const MAX_SIZES_LENGTH = 4096;
const MAX_VARIANT_OPTIONS = 100;
const MAX_SYNC_VARIANT_ID = BigInt("9223372036854775807");

function isPhysicalKind(kind: string) {
  return kind === "product" || kind === "preview";
}

function parseSku(value: unknown): { success: true; value: string | null } | { success: false } {
  if (value === null || value === undefined) return { success: true, value: null };
  if (typeof value !== "string") return { success: false };
  if (value.length > MAX_RAW_SKU_LENGTH) return { success: false };
  const sku = value.trim();
  if (sku.length > MAX_SKU_LENGTH || /[\u0000-\u001f\u007f]/.test(sku)) {
    return { success: false };
  }
  return { success: true, value: sku || null };
}

function parseSyncVariantId(
  value: unknown,
): { success: true; value: string | null } | { success: false } {
  if (value === null || value === undefined) return { success: true, value: null };
  if (typeof value !== "string") return { success: false };
  if (value.length > MAX_RAW_SYNC_VARIANT_ID_LENGTH) return { success: false };
  const id = value.trim();
  if (!id) return { success: true, value: null };
  if (id.length > MAX_SYNC_VARIANT_ID_LENGTH || !/^\d+$/.test(id)) {
    return { success: false };
  }
  try {
    const numericId = BigInt(id);
    if (numericId <= BigInt(0) || numericId > MAX_SYNC_VARIANT_ID) {
      return { success: false };
    }
  } catch {
    return { success: false };
  }
  // Keep IDs as decimal strings; converting to Number would lose precision.
  return { success: true, value: id };
}

function emptyFields(): PrintfulMappingFields {
  return {
    printful_sku: null,
    printful_sync_variant_id: null,
    printful_variant_mappings: [],
  };
}

function parseMappingsJson(value: unknown):
  | { success: true; value: unknown[] }
  | { success: false } {
  if (value === null || value === undefined || value === "") {
    return { success: true, value: [] };
  }
  if (typeof value !== "string" || value.length > MAX_MAPPINGS_JSON_LENGTH) {
    return { success: false };
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? { success: true, value: parsed }
      : { success: false };
  } catch {
    return { success: false };
  }
}

function readMapping(value: unknown):
  | { success: true; value: PrintfulVariantMapping }
  | { success: false; error: "invalid_variant_mappings" | "invalid_printful_sku" | "invalid_sync_variant_id" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { success: false, error: "invalid_variant_mappings" };
  }
  const mapping = value as Record<string, unknown>;
  const option = typeof mapping.option === "string" ? mapping.option.trim() : "";
  if (!option) return { success: false, error: "invalid_variant_mappings" };
  const sku = parseSku(mapping.sku);
  if (!sku.success) return { success: false, error: "invalid_printful_sku" };
  const syncVariantId = parseSyncVariantId(mapping.sync_variant_id);
  if (!syncVariantId.success) {
    return { success: false, error: "invalid_sync_variant_id" };
  }
  return {
    success: true,
    value: {
      option,
      sku: sku.value ?? "",
      sync_variant_id: syncVariantId.value,
    },
  };
}

/**
 * Rebuild UI rows in the exact order of the currently declared sizes. Matching
 * old rows case-insensitively lets edits to a size's capitalization preserve
 * its SKU while the submitted option remains the canonical parsed size.
 */
export function buildPrintfulVariantRows(
  sizes: string,
  existing: readonly PrintfulVariantMapping[] | null | undefined,
): PrintfulVariantMapping[] {
  const byOption = new Map<string, PrintfulVariantMapping>();
  for (const mapping of existing ?? []) {
    if (typeof mapping.option !== "string") continue;
    const key = mapping.option.trim().toLowerCase();
    if (!key || byOption.has(key)) continue;
    byOption.set(key, {
      option: mapping.option.trim(),
      sku: typeof mapping.sku === "string" ? mapping.sku : "",
      sync_variant_id:
        typeof mapping.sync_variant_id === "string" && mapping.sync_variant_id.trim()
          ? mapping.sync_variant_id
          : null,
    });
  }

  return parseSizes(sizes).map((option) => {
    const existingMapping = byOption.get(option.toLowerCase());
    return existingMapping
      ? { ...existingMapping, option }
      : { option, sku: "", sync_variant_id: null };
  });
}

/** Serialize only configured mappings; an all-empty grid remains manual fulfillment. */
export function serializePrintfulVariantMappings(
  sizes: string,
  mappings: readonly PrintfulVariantMapping[],
): string {
  const rows = buildPrintfulVariantRows(sizes, mappings).map((mapping) => ({
    option: mapping.option,
    sku: mapping.sku.trim(),
    sync_variant_id: mapping.sync_variant_id?.trim() || null,
  }));
  if (!rows.some((mapping) => mapping.sku || mapping.sync_variant_id)) return "";
  return JSON.stringify(rows);
}

/** Exact option lookup. Never fall back to the product-level SKU for a size. */
export function findPrintfulVariantMapping(
  mappings: readonly PrintfulVariantMapping[] | null | undefined,
  option: string,
): PrintfulVariantMapping | null {
  return mappings?.find((mapping) => mapping.option === option) ?? null;
}

/**
 * Validate the untrusted values sent by the Armory form. `sizes` is the exact
 * comma/newline text used by the existing size parser; mappings must match its
 * parsed options exactly. Nonphysical kinds are cleared so toggling an item to
 * digital cannot retain stale Printful references.
 */
export function validatePrintfulMappingInput(input: {
  kind: string;
  category: string;
  sizes: unknown;
  printful_sku: unknown;
  printful_sync_variant_id: unknown;
  printful_variant_mappings: unknown;
}): PrintfulMappingValidation {
  if (!isPhysicalKind(input.kind)) {
    return { success: true, value: emptyFields() };
  }

  if (typeof input.sizes !== "string") {
    return { success: false, error: "invalid_variant_mappings" };
  }
  if (input.sizes.length > MAX_SIZES_LENGTH) {
    return { success: false, error: "invalid_variant_mappings" };
  }

  const sku = parseSku(input.printful_sku);
  if (!sku.success) return { success: false, error: "invalid_printful_sku" };
  const syncVariantId = parseSyncVariantId(input.printful_sync_variant_id);
  if (!syncVariantId.success) {
    return { success: false, error: "invalid_sync_variant_id" };
  }
  const rawMappings = parseMappingsJson(input.printful_variant_mappings);
  if (!rawMappings.success) {
    return { success: false, error: "invalid_variant_mappings" };
  }
  if (rawMappings.value.length > MAX_VARIANT_OPTIONS) {
    return { success: false, error: "invalid_variant_mappings" };
  }
  const mappings: PrintfulVariantMapping[] = [];
  for (const rawMapping of rawMappings.value) {
    const mapping = readMapping(rawMapping);
    if (!mapping.success) return mapping;
    mappings.push(mapping.value);
  }

  const printfulCategory = input.category === "gear" || input.category === "accessories";
  if (!printfulCategory) {
    if (sku.value || syncVariantId.value || rawMappings.value.length > 0) {
      return { success: false, error: "printful_mapping_not_supported_for_category" };
    }
    return { success: true, value: emptyFields() };
  }

  const options = parseSizes(input.sizes);
  if (options.length > MAX_VARIANT_OPTIONS) {
    return { success: false, error: "invalid_variant_mappings" };
  }
  if (options.length === 0) {
    if (mappings.length > 0) {
      return { success: false, error: "variant_mappings_without_sizes" };
    }
    return {
      success: true,
      value: {
        printful_sku: sku.value,
        printful_sync_variant_id: syncVariantId.value,
        printful_variant_mappings: [],
      },
    };
  }

  // Sized listings use the exact per-option map. A base SKU or variant ID is
  // intentionally rejected here so it cannot act as an ambiguous fallback.
  if (sku.value || syncVariantId.value) {
    return { success: false, error: "base_mapping_with_sizes" };
  }

  const optionSet = new Set(options);
  const seen = new Set<string>();
  for (const mapping of mappings) {
    const key = mapping.option.toLowerCase();
    if (seen.has(key)) {
      return { success: false, error: "duplicate_variant_option" };
    }
    seen.add(key);
    if (!optionSet.has(mapping.option)) {
      return { success: false, error: "unknown_variant_option" };
    }
  }

  const configured = mappings.some(
    (mapping) => mapping.sku !== "" || mapping.sync_variant_id !== null,
  );
  if (!configured) {
    return { success: true, value: emptyFields() };
  }
  if (
    mappings.length !== options.length ||
    options.some((option) => !seen.has(option.toLowerCase())) ||
    mappings.some((mapping) => !mapping.sku)
  ) {
    return { success: false, error: "incomplete_variant_mapping" };
  }

  const byOption = new Map(mappings.map((mapping) => [mapping.option, mapping]));
  return {
    success: true,
    value: {
      printful_sku: null,
      printful_sync_variant_id: null,
      printful_variant_mappings: options.map((option) => byOption.get(option)!),
    },
  };
}
