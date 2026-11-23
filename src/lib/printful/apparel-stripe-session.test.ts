import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { createOrRecoverPrintfulApparelStripeSession, type ApparelStripeSessionSnapshot } from "./apparel-stripe-session";

const ORDER_ID = "123e4567-e89b-42d3-a456-426614174000";
const STATUS_TOKEN = "a".repeat(43);
const SNAPSHOT: ApparelStripeSessionSnapshot = {
  status: "quoted",
  sessionId: null,
  expiresAt: "2026-11-22T13:00:00.000Z",
  email: "buyer@example.test",
  priceCents: 5000,
  productTitle: "GymX Shirt",
  variantLabel: "Blue / M",
};

describe("Printful apparel Stripe Checkout session recovery", () => {
  it("recovers an unknown created session on duplicate submit with the same idempotency key and params", async () => {
    const persisted = new Map<string, { params: Stripe.Checkout.SessionCreateParams; session: Stripe.Checkout.Session }>();
    const calls: Array<{ key: string; params: Stripe.Checkout.SessionCreateParams }> = [];
    const session = { id: "cs_synthetic12345678", url: "https://checkout.stripe.test/session", status: "open" } as Stripe.Checkout.Session;
    let first = true;
    const create = vi.fn(async (params: Stripe.Checkout.SessionCreateParams, options: { idempotencyKey: string }) => {
      calls.push({ key: options.idempotencyKey, params: structuredClone(params) });
      const old = persisted.get(options.idempotencyKey);
      if (old) return old.session;
      persisted.set(options.idempotencyKey, { params: structuredClone(params), session });
      if (first) {
        first = false;
        throw new Error("synthetic response lost after create");
      }
      return session;
    });
    const stripe = {
      checkout: { sessions: { create, retrieve: vi.fn() } },
    } as unknown as Parameters<typeof createOrRecoverPrintfulApparelStripeSession>[0]["stripe"];
    const bind = vi.fn(async () => true);
    const input = {
      stripe,
      snapshot: SNAPSHOT,
      orderId: ORDER_ID,
      statusToken: STATUS_TOKEN,
      siteUrl: "https://gymx2.example.test",
      bind,
      now: () => Date.parse("2026-11-22T12:20:00.000Z"),
    };

    expect(await createOrRecoverPrintfulApparelStripeSession(input)).toMatchObject({ ok: false, reason: "session_unavailable" });
    expect(bind).not.toHaveBeenCalled();
    expect(await createOrRecoverPrintfulApparelStripeSession(input)).toMatchObject({ ok: true, sessionId: session.id, url: session.url });
    expect(create).toHaveBeenCalledTimes(2);
    expect(calls[0].key).toBe(calls[1].key);
    expect(calls[0].params).toEqual(calls[1].params);
    expect(calls[0].params.expires_at).toBe(Math.floor(Date.parse(SNAPSHOT.expiresAt) / 1000));
    expect(bind).toHaveBeenCalledTimes(1);
  });

  it("returns an already bound open session instead of creating another one", async () => {
    const session = { id: "cs_synthetic12345678", url: "https://checkout.stripe.test/session", status: "open" } as Stripe.Checkout.Session;
    const create = vi.fn();
    const retrieve = vi.fn(async () => session);
    const stripe = { checkout: { sessions: { create, retrieve } } } as unknown as Parameters<typeof createOrRecoverPrintfulApparelStripeSession>[0]["stripe"];
    const result = await createOrRecoverPrintfulApparelStripeSession({
      stripe,
      snapshot: { ...SNAPSHOT, status: "checkout_open", sessionId: session.id },
      orderId: ORDER_ID,
      statusToken: STATUS_TOKEN,
      siteUrl: "https://gymx2.example.test",
      bind: vi.fn(),
      now: () => Date.parse("2026-11-22T12:20:00.000Z"),
    });
    expect(result).toMatchObject({ ok: true, sessionId: session.id });
    expect(retrieve).toHaveBeenCalledWith(session.id);
    expect(create).not.toHaveBeenCalled();
  });
});
