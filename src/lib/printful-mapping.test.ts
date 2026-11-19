import { describe, expect, it } from "vitest";
import {
  buildPrintfulVariantRows,
  findPrintfulVariantMapping,
  serializePrintfulVariantMappings,
  validatePrintfulMappingInput,
  type PrintfulVariantMapping,
} from "./printful-mapping";

const baseInput = {
  kind: "product",
  category: "gear",
  sizes: "",
  printful_sku: "",
  printful_sync_variant_id: "",
  printful_variant_mappings: "",
};

function mappingJson(rows: PrintfulVariantMapping[]) {
  return JSON.stringify(rows);
}

describe("Printful mapping validation", () => {
  it("accepts legacy physical items with no Printful mapping", () => {
    expect(validatePrintfulMappingInput(baseInput)).toEqual({
      success: true,
      value: {
        printful_sku: null,
        printful_sync_variant_id: null,
        printful_variant_mappings: [],
      },
    });
  });

  it("preserves SKU case, leading zeroes, and bigint variant IDs", () => {
    const result = validatePrintfulMappingInput({
      ...baseInput,
      printful_sku: "  Shirt-Blue-01  ",
      printful_sync_variant_id: " 0009007199254740993 ",
    });
    expect(result).toEqual({
      success: true,
      value: {
        printful_sku: "Shirt-Blue-01",
        printful_sync_variant_id: "0009007199254740993",
        printful_variant_mappings: [],
      },
    });
  });

  it.each(["0", "-1", "1.5", "9223372036854775808", "abc"])(
    "rejects invalid sync variant ID %s",
    (id) => {
      expect(
        validatePrintfulMappingInput({ ...baseInput, printful_sync_variant_id: id }),
      ).toEqual({ success: false, error: "invalid_sync_variant_id" });
    },
  );

  it("bounds leading-zero IDs before bigint parsing", () => {
    const result = validatePrintfulMappingInput({
      ...baseInput,
      printful_sync_variant_id: `${"0".repeat(19)}1`,
    });
    expect(result).toEqual({ success: false, error: "invalid_sync_variant_id" });
  });

  it("round-trips decimal IDs as strings without losing precision", () => {
    const variantId = "0009007199254740993";
    const parsed = validatePrintfulMappingInput({
      ...baseInput,
      printful_sync_variant_id: variantId,
    });
    expect(parsed.success && parsed.value.printful_sync_variant_id).toBe(variantId);
    const serialized = serializePrintfulVariantMappings("S, M", [
      { option: "S", sku: "S-SKU", sync_variant_id: variantId },
      { option: "M", sku: "M-SKU", sync_variant_id: null },
    ]);
    expect(serialized).toContain(variantId);
    expect(
      validatePrintfulMappingInput({
        ...baseInput,
        sizes: "S, M",
        printful_variant_mappings: serialized,
      }),
    ).toMatchObject({
      success: true,
      value: {
        printful_variant_mappings: [
          { option: "S", sync_variant_id: variantId },
          { option: "M", sync_variant_id: null },
        ],
      },
    });
  });

  it("rejects SKUs with control characters or more than 128 characters", () => {
    expect(
      validatePrintfulMappingInput({ ...baseInput, printful_sku: "sku\u0000bad" }),
    ).toEqual({ success: false, error: "invalid_printful_sku" });
    expect(
      validatePrintfulMappingInput({ ...baseInput, printful_sku: "x".repeat(129) }),
    ).toEqual({ success: false, error: "invalid_printful_sku" });
  });

  it("requires a complete exact map for sized items", () => {
    expect(
      validatePrintfulMappingInput({
        ...baseInput,
        sizes: "S, M",
        printful_variant_mappings: mappingJson([
          { option: "S", sku: "GYM-S", sync_variant_id: null },
        ]),
      }),
    ).toEqual({ success: false, error: "incomplete_variant_mapping" });
  });

  it("bounds option mappings at the supported hundred-option ceiling", () => {
    const sizes = Array.from({ length: 101 }, (_, index) => `Size${index + 1}`).join(", ");
    const mappings = Array.from({ length: 101 }, (_, index) => ({
      option: `Size${index + 1}`,
      sku: `SKU-${index + 1}`,
      sync_variant_id: null,
    }));
    expect(validatePrintfulMappingInput({
      ...baseInput,
      sizes,
      printful_variant_mappings: mappingJson(mappings),
    })).toEqual({ success: false, error: "invalid_variant_mappings" });
  });

  it("accepts complete maps and returns options in the existing parsed size order", () => {
    const result = validatePrintfulMappingInput({
      ...baseInput,
      sizes: "S, M",
      printful_variant_mappings: mappingJson([
        { option: "M", sku: "gym-M", sync_variant_id: "9007199254740993" },
        { option: "S", sku: "GYM-001-S", sync_variant_id: null },
      ]),
    });
    expect(result).toEqual({
      success: true,
      value: {
        printful_sku: null,
        printful_sync_variant_id: null,
        printful_variant_mappings: [
          { option: "S", sku: "GYM-001-S", sync_variant_id: null },
          { option: "M", sku: "gym-M", sync_variant_id: "9007199254740993" },
        ],
      },
    });
  });

  it("rejects base SKU fallback and mappings for options not listed", () => {
    expect(
      validatePrintfulMappingInput({
        ...baseInput,
        sizes: "S, M",
        printful_sku: "BASE-SKU",
      }),
    ).toEqual({ success: false, error: "base_mapping_with_sizes" });
    expect(
      validatePrintfulMappingInput({
        ...baseInput,
        sizes: "S, M",
        printful_variant_mappings: mappingJson([
          { option: "S", sku: "S-SKU", sync_variant_id: null },
          { option: "L", sku: "L-SKU", sync_variant_id: null },
        ]),
      }),
    ).toEqual({ success: false, error: "unknown_variant_option" });
  });

  it("rejects duplicate options even when duplicate casing differs", () => {
    expect(
      validatePrintfulMappingInput({
        ...baseInput,
        sizes: "S, M",
        printful_variant_mappings: mappingJson([
          { option: "S", sku: "S-1", sync_variant_id: null },
          { option: "s", sku: "S-2", sync_variant_id: null },
          { option: "M", sku: "M-1", sync_variant_id: null },
        ]),
      }),
    ).toEqual({ success: false, error: "duplicate_variant_option" });
  });

  it("rejects duplicate options and partial IDs without a SKU", () => {
    expect(
      validatePrintfulMappingInput({
        ...baseInput,
        sizes: "S, M",
        printful_variant_mappings: mappingJson([
          { option: "S", sku: "S-1", sync_variant_id: null },
          { option: "S", sku: "S-2", sync_variant_id: null },
          { option: "M", sku: "M-1", sync_variant_id: null },
        ]),
      }),
    ).toEqual({ success: false, error: "duplicate_variant_option" });
    expect(
      validatePrintfulMappingInput({
        ...baseInput,
        sizes: "S, M",
        printful_variant_mappings: mappingJson([
          { option: "S", sku: "S-1", sync_variant_id: null },
          { option: "M", sku: "", sync_variant_id: "123" },
        ]),
      }),
    ).toEqual({ success: false, error: "incomplete_variant_mapping" });
  });

  it("bounds sizes, variant count, and JSON before parsing", () => {
    expect(
      validatePrintfulMappingInput({ ...baseInput, sizes: "x".repeat(4097) }),
    ).toEqual({ success: false, error: "invalid_variant_mappings" });
    expect(
      validatePrintfulMappingInput({
        ...baseInput,
        printful_variant_mappings: " ".repeat(65_537),
      }),
    ).toEqual({ success: false, error: "invalid_variant_mappings" });
    const options = Array.from({ length: 101 }, (_, index) => `X${index}`);
    expect(
      validatePrintfulMappingInput({
        ...baseInput,
        sizes: options.join(", "),
        printful_variant_mappings: "[]",
      }),
    ).toEqual({ success: false, error: "invalid_variant_mappings" });
    const mappingOptions = options.slice(0, 100);
    const oversizedMap = mappingOptions.map((option) => ({
      option,
      sku: `SKU-${option}`,
      sync_variant_id: null,
    }));
    oversizedMap.push({ option: "EXTRA", sku: "EXTRA", sync_variant_id: null });
    expect(
      validatePrintfulMappingInput({
        ...baseInput,
        sizes: mappingOptions.join(", "),
        printful_variant_mappings: mappingJson(oversizedMap),
      }),
    ).toEqual({ success: false, error: "invalid_variant_mappings" });
  });

  it("limits mappings to merchandise categories and clears digital references", () => {
    expect(
      validatePrintfulMappingInput({ ...baseInput, category: "supplements" }),
    ).toEqual({ success: true, value: { printful_sku: null, printful_sync_variant_id: null, printful_variant_mappings: [] } });
    expect(
      validatePrintfulMappingInput({
        ...baseInput,
        category: "doctor_network",
        printful_sku: "MEDICAL-SKU",
      }),
    ).toEqual({ success: false, error: "printful_mapping_not_supported_for_category" });
    expect(
      validatePrintfulMappingInput({ ...baseInput, kind: "download", printful_sku: "OLD-SKU" }),
    ).toEqual({ success: true, value: { printful_sku: null, printful_sync_variant_id: null, printful_variant_mappings: [] } });
  });
});

describe("Printful variant helpers", () => {
  it("keeps exact option rows when size text is normalized and edits are made", () => {
    const rows = buildPrintfulVariantRows(" S, M, s ", [
      { option: "S", sku: "001-s", sync_variant_id: "0009" },
    ]);
    expect(rows).toEqual([
      { option: "S", sku: "001-s", sync_variant_id: "0009" },
      { option: "M", sku: "", sync_variant_id: null },
    ]);
  });

  it("serializes configured rows but leaves all-blank rows in manual mode", () => {
    const blankRows = buildPrintfulVariantRows("S, M", []);
    expect(serializePrintfulVariantMappings("S, M", blankRows)).toBe("");
    expect(
      serializePrintfulVariantMappings("S, M", [
        { option: "S", sku: "  SKU-S ", sync_variant_id: null },
        { option: "M", sku: "SKU-M", sync_variant_id: "0012" },
      ]),
    ).toBe(
      '[{"option":"S","sku":"SKU-S","sync_variant_id":null},{"option":"M","sku":"SKU-M","sync_variant_id":"0012"}]',
    );
  });

  it("uses exact lookup without case-insensitive fallback", () => {
    const mappings = [{ option: "Small", sku: "sku-small", sync_variant_id: null }];
    expect(findPrintfulVariantMapping(mappings, "Small")).toBe(mappings[0]);
    expect(findPrintfulVariantMapping(mappings, "small")).toBeNull();
  });
});
