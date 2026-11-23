import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { printfulCommonDesignIdentity } from "./design-identity";
import { createPrintfulStoreCatalogReader } from "./catalog-provider";

const base = {
  syncVariantId: "5635838147",
  catalogVariantId: "12345",
  files: [
    { id: 8, hash: "a".repeat(32), type: "front", url: "https://volatile.example/file" },
    { type: "preview", url: "https://volatile.example/preview" },
  ],
  options: [{ id: "color", value: "black" }],
};

function fileIdentity(fileOptions: unknown[]) {
  return printfulCommonDesignIdentity({
    ...base,
    files: [{ ...base.files[0], options: fileOptions }],
  });
}

async function readRawConfiguration(fileOptions: unknown[]) {
  const detail = {
    sync_product: { id: "492658691", name: "Synthetic Shirt", variants: 1, synced: 1, is_ignored: false },
    sync_variants: [{
      id: "5635838147",
      sync_product_id: "492658691",
      variant_id: "7854",
      name: "Black / M",
      color: "Black",
      size: "M",
      synced: true,
      is_ignored: false,
      availability_status: "active",
      files: [{ id: 8, hash: "a".repeat(32), type: "front", options: fileOptions }],
      options: [{ id: "color", value: "black" }],
    }],
  };
  const fetcher = vi.fn(async (input: URL | RequestInfo) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body = url.pathname === "/stores"
      ? { code: 200, result: [{ id: "19050731", name: "GYMX2", type: "native" }] }
      : { code: 200, result: detail };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  });
  const reader = createPrintfulStoreCatalogReader({ enabled: true, token: "synthetic-test-token", fetcher });
  const result = await reader.readProduct("492658691");
  if (result.status !== "complete") throw new Error("Synthetic catalog detail did not parse");
  return result.product.variants[0];
}

describe("cross-API Printful design identity", () => {
  it("ignores volatile URLs and preview files but binds exact native variant and production file facts", () => {
    const original = printfulCommonDesignIdentity(base);
    expect(original).toMatch(/^[0-9a-f]{64}$/);
    expect(printfulCommonDesignIdentity({
      ...base,
      files: [
        { ...base.files[0], url: "https://volatile.example/rotated" },
        { type: "preview", url: "https://volatile.example/new-preview" },
      ],
    })).toBe(original);
    expect(printfulCommonDesignIdentity({ ...base, syncVariantId: "5635838148" })).not.toBe(original);
    expect(printfulCommonDesignIdentity({ ...base, catalogVariantId: "12346" })).not.toBe(original);
    expect(printfulCommonDesignIdentity({ ...base, files: [{ ...base.files[0], hash: "b".repeat(32) }] })).not.toBe(original);
    expect(printfulCommonDesignIdentity({ ...base, options: [{ id: "color", value: "red" }] })).not.toBe(original);
    expect(printfulCommonDesignIdentity({
      ...base,
      files: [{ ...base.files[0], options: [{ id: "placement", value: "left_chest" }] }],
    })).not.toBe(original);
  });

  it("fails closed when the provider omits production files, options, or stable file identity", () => {
    expect(printfulCommonDesignIdentity({ ...base, files: [] })).toBeNull();
    expect(printfulCommonDesignIdentity({ ...base, files: [{ type: "preview" }] })).toBeNull();
    expect(printfulCommonDesignIdentity({ ...base, files: [{ type: "front" }] })).toBeNull();
    expect(printfulCommonDesignIdentity({ ...base, options: undefined })).toBeNull();
    expect(printfulCommonDesignIdentity({ ...base, syncVariantId: 9007199254740993 })).toBeNull();
    expect(printfulCommonDesignIdentity({ ...base, syncVariantId: "9223372036854775808" })).toBeNull();
  });

  it("does not collapse oversized option arrays into an actual null value", () => {
    const actualNull = printfulCommonDesignIdentity({ ...base, options: [{ id: "color", value: null }] });
    const oversized = printfulCommonDesignIdentity({
      ...base,
      options: [{ id: "color", value: Array.from({ length: 33 }, (_, index) => index) }],
    });
    expect(actualNull).toMatch(/^[0-9a-f]{64}$/);
    expect(oversized).toBeNull();
  });

  it("preserves an own __proto__ option key as JSON data", () => {
    const ordinary = printfulCommonDesignIdentity({
      ...base,
      options: [{ id: "custom", value: {} }],
    });
    const withProtoKey = printfulCommonDesignIdentity({
      ...base,
      options: [{ id: "custom", value: JSON.parse('{"__proto__":{"x":1}}') }],
    });

    expect(ordinary).toMatch(/^[0-9a-f]{64}$/);
    expect(withProtoKey).toMatch(/^[0-9a-f]{64}$/);
    expect(withProtoKey).not.toBe(ordinary);
  });

  it("collapses only an exact equal boolean full_color/fullColor file-option pair", () => {
    for (const value of [true, false]) {
      expect(fileIdentity([
        { id: "full_color", value },
        { id: "fullColor", value },
      ])).toBe(fileIdentity([{ id: "full_color", value }]));
    }

    expect(fileIdentity([{ id: "fullColor", value: true }]))
      .not.toBe(fileIdentity([{ id: "full_color", value: true }]));
    expect(fileIdentity([
      { id: "full_color", value: true },
      { id: "fullColor", value: false },
    ])).not.toBe(fileIdentity([{ id: "full_color", value: true }]));
  });

  it("keeps malformed, duplicate, mistyped, and extended alias pairs distinct", () => {
    const canonical = fileIdentity([{ id: "full_color", value: true }]);
    const nonCanonicalPairs = [
      [{ id: "full_color", value: true }, { id: "fullColor", value: true }, { id: "fullColor", value: true }],
      [{ id: "full_color", value: true }, { id: "full_color", value: true }, { id: "fullColor", value: true }],
      [{ id: "full_color", value: true }, { id: "full_color", value: true }, { id: "fullColor", value: true }, { id: "fullColor", value: true }],
      [{ id: "full_color", value: "true" }, { id: "fullColor", value: true }],
      [{ id: "full_color", value: true }, { id: "fullColor", value: 1 }],
      [{ id: "full_color", value: 1 }, { id: "fullColor", value: 1 }],
      [{ id: "full_color", value: null }, { id: "fullColor", value: null }],
      [{ id: "full_color", value: true, extra: "kept" }, { id: "fullColor", value: true }],
      [{ id: "full_color", value: true }, { id: "fullColor", value: true, extra: "kept" }],
    ];

    for (const options of nonCanonicalPairs) {
      expect(fileIdentity(options)).not.toBe(canonical);
    }
  });

  it("continues hashing canonical values, unrelated file options, and file facts", () => {
    const paired = [
      { id: "full_color", value: true },
      { id: "fullColor", value: true },
      { id: "artwork_mode", value: "spot" },
    ];
    const baseIdentity = fileIdentity(paired);
    expect(fileIdentity([
      { id: "full_color", value: false },
      { id: "fullColor", value: false },
      { id: "artwork_mode", value: "spot" },
    ])).not.toBe(baseIdentity);
    expect(fileIdentity([
      { id: "full_color", value: true },
      { id: "fullColor", value: true },
      { id: "artwork_mode", value: "embroidery" },
    ])).not.toBe(baseIdentity);
    expect(printfulCommonDesignIdentity({
      ...base,
      files: [{ ...base.files[0], id: 9, options: paired }],
    })).not.toBe(baseIdentity);
    expect(printfulCommonDesignIdentity({
      ...base,
      files: [{ ...base.files[0], type: "back", options: paired }],
    })).not.toBe(baseIdentity);
    expect(printfulCommonDesignIdentity({
      ...base,
      files: [{ ...base.files[0], hash: "b".repeat(32), options: paired }],
    })).not.toBe(baseIdentity);
  });

  it("keeps the raw native configuration fingerprint bound to both aliases", async () => {
    const paired = await readRawConfiguration([
      { id: "full_color", value: true },
      { id: "fullColor", value: true },
    ]);
    const canonicalOnly = await readRawConfiguration([{ id: "full_color", value: true }]);

    expect(paired.configurationComplete).toBe(true);
    expect(canonicalOnly.configurationComplete).toBe(true);
    expect(paired.designIdentityFingerprint).toBe(canonicalOnly.designIdentityFingerprint);
    expect(paired.configurationFingerprint).not.toBe(canonicalOnly.configurationFingerprint);
  });
});
