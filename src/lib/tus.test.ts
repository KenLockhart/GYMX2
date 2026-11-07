import { describe, expect, it } from "vitest";
import { encodeUploadMetadata, parseUploadMetadata } from "./tus";

describe("parseUploadMetadata", () => {
  it("decodes values, including non-English text", () => {
    const header = encodeUploadMetadata({ title: "Sentadillas ñ", description: "" });
    expect(parseUploadMetadata(header)).toEqual({ title: "Sentadillas ñ", description: "" });
  });

  it("treats a missing header as empty", () => {
    expect(parseUploadMetadata(null)).toEqual({});
  });
});

describe("encodeUploadMetadata", () => {
  it("writes flags without a value", () => {
    expect(encodeUploadMetadata({ requiresignedurls: null, name: "A" })).toBe(
      "requiresignedurls,name QQ==",
    );
  });
});
