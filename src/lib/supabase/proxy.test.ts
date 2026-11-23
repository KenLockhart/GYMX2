import { describe, expect, it } from "vitest";
import { requiresSignIn } from "./proxy";

describe("public Armory route access", () => {
  it.each([
    "/armory",
    "/armory/checkout-complete",
    "/armory/claim",
    "/armory/apparel",
    "/armory/apparel/order/123e4567-e89b-42d3-a456-426614174000",
    "/armory/123e4567-e89b-42d3-a456-426614174000",
  ])("keeps %s public", (pathname) => {
    expect(requiresSignIn(pathname)).toBe(false);
  });

  it.each([
    "/armory/purchases",
    "/armory/new",
    "/armory/123e4567-e89b-42d3-a456-426614174000/download",
    "/armory/not-a-uuid",
    "/armory/apparel/order/not-a-uuid",
    "/armory/apparel/admin",
  ])("keeps %s behind sign-in", (pathname) => {
    expect(requiresSignIn(pathname)).toBe(true);
  });
});
