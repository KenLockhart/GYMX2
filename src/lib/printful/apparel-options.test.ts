import { describe, expect, it } from "vitest";
import { deriveApparelSelection, parsePublicApparelVariants, type ApparelOptionVariant } from "./apparel-options";

const blackM: ApparelOptionVariant = {
  id: "123e4567-e89b-42d3-a456-426614174001",
  name: "Black / M",
  color: "Black",
  size: "M",
  available: true,
};
const blueM: ApparelOptionVariant = {
  id: "123e4567-e89b-42d3-a456-426614174002",
  name: "Blue / M",
  color: "Blue",
  size: "M",
  available: true,
};

describe("deriveApparelSelection", () => {
  it("keeps same-size colors mapped to their exact local variant UUIDs", () => {
    const initial = deriveApparelSelection([blackM, blueM]);
    expect(initial).toMatchObject({ mode: "facets", color: "Black", size: "M", variant: blackM });
    const blue = deriveApparelSelection([blackM, blueM], { color: "Blue", size: "M" });
    expect(blue.variant?.id).toBe(blueM.id);
  });

  it("replaces stale or unavailable color and size requests from current availability", () => {
    const unavailableRed = { ...blackM, id: "123e4567-e89b-42d3-a456-426614174003", color: "Red", available: false };
    const current = deriveApparelSelection([blackM, blueM, unavailableRed], { color: "Red", size: "XL" });
    expect(current.colors).toEqual(["Black", "Blue"]);
    expect(current).toMatchObject({ mode: "facets", color: "Black", size: "M", variant: blackM });
  });

  it("uses exact-variant fallback for null/default option attributes", () => {
    const defaultOption = { ...blackM, name: "Default option", color: null, size: null };
    const selection = deriveApparelSelection([defaultOption]);
    expect(selection.mode).toBe("exact");
    expect(selection.variant).toEqual(defaultOption);
    expect(selection.variants).toEqual([defaultOption]);
  });

  it("passes explicit null option attributes through the public parser but rejects missing or invalid fields", () => {
    const defaultOption = { ...blackM, name: "One size", color: null, size: null };
    const parsed = parsePublicApparelVariants([
      defaultOption,
      { ...blackM, id: undefined },
      { ...blackM, size: undefined },
      { ...blackM, id: "provider-sync-variant-id" },
      { ...blackM, available: false },
    ]);
    expect(parsed).toEqual([defaultOption]);
    expect(deriveApparelSelection(parsed ?? []).mode).toBe("exact");
  });

  it("uses exact-variant fallback when color and size pairs are duplicated", () => {
    const duplicate = { ...blueM, name: "Blue / M - alternate", color: "Black", id: "123e4567-e89b-42d3-a456-426614174004" };
    const selection = deriveApparelSelection([blackM, duplicate], { variantId: duplicate.id });
    expect(selection.mode).toBe("exact");
    expect(selection.variant?.id).toBe(duplicate.id);
    expect(selection.variants.map(({ id }) => id)).toEqual([blackM.id, duplicate.id]);
  });

  it("fails closed when there are no available local UUID variants", () => {
    expect(deriveApparelSelection([{ ...blackM, available: false }]).mode).toBe("unavailable");
    expect(deriveApparelSelection([{ ...blackM, id: "provider-sync-variant-id" }]).mode).toBe("unavailable");
  });
});
