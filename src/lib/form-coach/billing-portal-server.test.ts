import { describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/env", () => ({ getSiteUrl: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn(), isStripeConfigured: vi.fn() }));

import {
  createFormCoachBillingPortal,
  stripeCustomerBelongsToFormCoachPayer,
} from "./billing-portal-server";

const payerId = "f1000000-0000-4000-8000-000000000001";
const attemptId = "f3000000-0000-4000-8000-000000000003";
const customerId = "cus_synthetic";

function ownedCustomer(metadata: Record<string, string> = {
  feature_namespace: "form_coach",
  feature_key: "form_coach",
  payer_id: payerId,
  customer_create_attempt_id: attemptId,
}) {
  return { id: customerId, deleted: false, metadata } as unknown as Stripe.Customer;
}

describe("Form Coach billing portal", () => {
  it("does no lookup or provider work when Stripe is unavailable", async () => {
    const readCustomer = vi.fn();
    const retrieveCustomer = vi.fn();
    const createPortal = vi.fn();
    await expect(createFormCoachBillingPortal(payerId, {
      configured: false,
      siteUrl: "https://gymx2.com",
      readCustomer,
      retrieveCustomer,
      createPortal,
    })).resolves.toEqual({ kind: "unavailable" });
    expect(readCustomer).not.toHaveBeenCalled();
    expect(retrieveCustomer).not.toHaveBeenCalled();
    expect(createPortal).not.toHaveBeenCalled();
  });

  it("requires an exact verified customer mapping for this payer before retrieving Stripe", async () => {
    const readCustomer = vi.fn().mockResolvedValue(null);
    const retrieveCustomer = vi.fn();
    const createPortal = vi.fn();
    await expect(createFormCoachBillingPortal(payerId, {
      configured: true,
      siteUrl: "https://gymx2.com",
      readCustomer,
      retrieveCustomer,
      createPortal,
    })).resolves.toEqual({ kind: "not_owned" });
    expect(retrieveCustomer).not.toHaveBeenCalled();
    expect(createPortal).not.toHaveBeenCalled();
  });

  it("creates a portal only after current Stripe metadata confirms the exact payer and attempt", async () => {
    const readCustomer = vi.fn().mockResolvedValue({ customerId, attemptId });
    const retrieveCustomer = vi.fn().mockResolvedValue(ownedCustomer());
    const createPortal = vi.fn().mockResolvedValue({ url: "https://billing.stripe.com/p/session/synthetic" });
    await expect(createFormCoachBillingPortal(payerId, {
      configured: true,
      siteUrl: "https://gymx2.com",
      readCustomer,
      retrieveCustomer,
      createPortal,
    })).resolves.toEqual({ kind: "redirect", url: "https://billing.stripe.com/p/session/synthetic" });
    expect(readCustomer).toHaveBeenCalledWith(payerId);
    expect(retrieveCustomer).toHaveBeenCalledWith(customerId);
    expect(createPortal).toHaveBeenCalledWith({
      customer: customerId,
      returnUrl: "https://gymx2.com/billing/form-coach?portal=returned",
    });
  });

  it("rejects a customer owned by another payer and rejects an untrusted portal URL", async () => {
    const readCustomer = vi.fn().mockResolvedValue({ customerId, attemptId });
    const retrieveCustomer = vi.fn().mockResolvedValue(ownedCustomer({
      feature_namespace: "form_coach",
      feature_key: "form_coach",
      payer_id: "f9000000-0000-4000-8000-000000000009",
      customer_create_attempt_id: attemptId,
    }));
    const createPortal = vi.fn();
    await expect(createFormCoachBillingPortal(payerId, {
      configured: true,
      siteUrl: "https://gymx2.com",
      readCustomer,
      retrieveCustomer,
      createPortal,
    })).resolves.toEqual({ kind: "not_owned" });
    expect(createPortal).not.toHaveBeenCalled();

    await expect(createFormCoachBillingPortal(payerId, {
      configured: true,
      siteUrl: "https://attacker.test",
      readCustomer: vi.fn().mockResolvedValue({ customerId, attemptId }),
      retrieveCustomer: vi.fn().mockResolvedValue(ownedCustomer()),
      createPortal: vi.fn(),
    })).resolves.toEqual({ kind: "unavailable" });
  });

  it("uses only the feature namespace, payer, and attempt as Stripe ownership proof", () => {
    expect(stripeCustomerBelongsToFormCoachPayer(ownedCustomer(), payerId, attemptId)).toBe(true);
    expect(stripeCustomerBelongsToFormCoachPayer(ownedCustomer({ feature_key: "armory" }), payerId, attemptId)).toBe(false);
    expect(stripeCustomerBelongsToFormCoachPayer({ id: customerId, deleted: true } as Stripe.DeletedCustomer, payerId, attemptId)).toBe(false);
  });
});
