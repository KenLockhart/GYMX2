import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { printfulCommonDesignIdentity } from "./design-identity";

const base = {
  syncVariantId: "5635838147",
  catalogVariantId: "12345",
  files: [
    { id: 8, hash: "a".repeat(32), type: "front", url: "https://volatile.example/file" },
    { type: "preview", url: "https://volatile.example/preview" },
  ],
  options: [{ id: "color", value: "black" }],
};

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
});
