import { describe, expect, it } from "vitest";
import {
  credentialInputSchema,
  displayStatus,
  overallVerification,
} from "./credentials";

describe("credentials", () => {
  it("never shows an expired credential as verified", () => {
    expect(displayStatus("verified", "2026-01-01", "2026-11-10")).toBe(
      "expired",
    );
    expect(displayStatus("verified", "2027-01-01", "2026-11-10")).toBe(
      "verified",
    );
    expect(displayStatus("verified", null, "2026-11-10")).toBe("verified");
    expect(displayStatus("pending", "2025-01-01", "2026-11-10")).toBe(
      "expired",
    );
  });

  it("hides rejected credentials", () => {
    expect(displayStatus("rejected", null)).toBeNull();
  });

  it("only calls a coach verified for a verified certification or license", () => {
    expect(overallVerification([{ kind: "cpr_aed", status: "verified" }])).toBe(
      "unverified",
    );
    expect(
      overallVerification([{ kind: "certification", status: "verified" }]),
    ).toBe("verified");
    expect(
      overallVerification([{ kind: "certification", status: "expired" }]),
    ).toBe("unverified");
    expect(
      overallVerification([{ kind: "certification", status: "pending" }]),
    ).toBe("pending");
    expect(overallVerification([])).toBe("unverified");
  });

  it("checks the form", () => {
    const ok = credentialInputSchema.safeParse({
      kind: "certification",
      organization: "NASM",
      title: "Certified Personal Trainer",
      issuedOn: "2020-05-01",
      expiresOn: "",
    });
    expect(ok.success && ok.data.expiresOn).toBeNull();
    expect(
      credentialInputSchema.safeParse({
        kind: "certification",
        organization: "NASM",
        title: "CPT",
        issuedOn: "2024-01-01",
        expiresOn: "2023-01-01",
      }).success,
    ).toBe(false);
    expect(
      credentialInputSchema.safeParse({
        kind: "wizardry",
        organization: "X",
        title: "Y",
      }).success,
    ).toBe(false);
  });
});
