import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { mayDeleteArmoryFile } from "./armory-file-retention";

describe("Armory upload retention", () => {
  it("keeps an old file while a pending or paid intent references its snapshot", () => {
    expect(mayDeleteArmoryFile({ referenceCheckSucceeded: true, referenceCount: 1 })).toBe(false);
  });

  it("deletes only after a successful check finds no pending or paid references", () => {
    expect(mayDeleteArmoryFile({ referenceCheckSucceeded: true, referenceCount: 0 })).toBe(true);
  });

  it("fails closed when the private intent lookup fails or has no count", () => {
    expect(mayDeleteArmoryFile({ referenceCheckSucceeded: false, referenceCount: 0 })).toBe(false);
    expect(mayDeleteArmoryFile({ referenceCheckSucceeded: true, referenceCount: -1 })).toBe(false);
  });
});
