import { describe, expect, it } from "vitest";
import { createGuestArmoryToken, verifyGuestArmoryToken } from "./guest-armory-token";

const secret = "test-only-guest-download-secret-at-least-32-bytes";
const claim = {
  purchaseId: "a1111111-1111-4111-8111-111111111111",
  sessionId: "cs_test_guest_checkout_12345678",
  itemId: "b2222222-2222-4222-8222-222222222222",
};

describe("guest Armory download token", () => {
  it("signs an expiring claim bound to one purchase, Checkout session, and item", () => {
    const token = createGuestArmoryToken(claim, secret, 1_000, 86_400);
    expect(verifyGuestArmoryToken(token, secret, 1_001)).toEqual({
      ...claim,
      expiresAt: 87_400,
    });
    expect(verifyGuestArmoryToken(token, `${secret}x`, 1_001)).toBeNull();
  });

  it("rejects tampering and malformed/ID-only values", () => {
    const token = createGuestArmoryToken(claim, secret, 1_000, 86_400);
    const [payload, signature] = token.split(".");
    const alteredPayload = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}`;
    expect(verifyGuestArmoryToken(`${alteredPayload}.${signature}`, secret, 1_001)).toBeNull();
    expect(verifyGuestArmoryToken(claim.purchaseId, secret, 1_001)).toBeNull();
    expect(verifyGuestArmoryToken(`${token}.extra`, secret, 1_001)).toBeNull();
  });

  it("rejects expired claims and does not issue tokens beyond seven days", () => {
    const token = createGuestArmoryToken(claim, secret, 1_000, 86_400);
    expect(verifyGuestArmoryToken(token, secret, 87_400)).toBeNull();
    expect(() => createGuestArmoryToken(claim, secret, 1_000, 604_801)).toThrow();
  });

  it("requires a dedicated sufficiently long signing key and valid bindings", () => {
    expect(() => createGuestArmoryToken(claim, "short", 1_000)).toThrow();
    expect(() => createGuestArmoryToken({ ...claim, sessionId: "session-id" }, secret, 1_000)).toThrow();
  });
});
