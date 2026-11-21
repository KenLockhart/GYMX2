import "server-only";

import Stripe from "stripe";
import { getSiteUrl } from "@/lib/supabase/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { FORM_COACH_FEATURE_KEY } from "@/lib/form-coach/types";
import { formCoachReturnUrl, isStripePortalUrl } from "@/lib/form-coach/checkout-server";

type Raw = Record<string, unknown>;

function record(value: unknown): Raw | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Raw
    : null;
}

export type OwnedFormCoachCustomer = Readonly<{
  customerId: string;
  attemptId: string;
}>;

export type BillingPortalResult =
  | Readonly<{ kind: "redirect"; url: string }>
  | Readonly<{ kind: "unavailable" | "not_owned" }>;

async function readOwnedCustomer(payerId: string): Promise<OwnedFormCoachCustomer | null> {
  const db = createAdminClient();
  const { data: mapping, error: mappingError } = await db.from("feature_payer_customer_mappings")
    .select("feature_key,payer_id,stripe_customer_id,create_attempt_id")
    .eq("feature_key", FORM_COACH_FEATURE_KEY).eq("payer_id", payerId).maybeSingle();
  const mapped = record(mapping);
  if (mappingError || mapped?.feature_key !== FORM_COACH_FEATURE_KEY || mapped?.payer_id !== payerId) return null;
  const customerId = typeof mapped.stripe_customer_id === "string" ? mapped.stripe_customer_id : null;
  const attemptId = typeof mapped.create_attempt_id === "string" ? mapped.create_attempt_id : null;
  if (!customerId || !attemptId) return null;
  const [{ data: attempt, error: attemptError }, { data: providerObject, error: providerError }] = await Promise.all([
    db.from("feature_customer_create_attempts")
      .select("feature_key,payer_id,state,stripe_customer_id")
      .eq("id", attemptId).maybeSingle(),
    db.from("feature_provider_objects")
      .select("feature_key,object_type,object_id,payer_id")
      .eq("feature_key", FORM_COACH_FEATURE_KEY).eq("object_type", "customer").eq("object_id", customerId).maybeSingle(),
  ]);
  const attemptRow = record(attempt);
  const objectRow = record(providerObject);
  if (attemptError || providerError || attemptRow?.feature_key !== FORM_COACH_FEATURE_KEY
    || attemptRow?.payer_id !== payerId || attemptRow?.state !== "verified"
    || attemptRow?.stripe_customer_id !== customerId
    || objectRow?.feature_key !== FORM_COACH_FEATURE_KEY || objectRow?.object_type !== "customer"
    || objectRow?.object_id !== customerId || objectRow?.payer_id !== payerId) return null;
  return { customerId, attemptId };
}

export async function hasOwnedFormCoachCustomer(payerId: string): Promise<boolean> {
  try {
    return Boolean(await readOwnedCustomer(payerId));
  } catch {
    return false;
  }
}

export function stripeCustomerBelongsToFormCoachPayer(
  customer: Stripe.Customer | Stripe.DeletedCustomer,
  payerId: string,
  attemptId: string,
): customer is Stripe.Customer {
  if ("deleted" in customer && customer.deleted) return false;
  return customer.metadata?.feature_namespace === FORM_COACH_FEATURE_KEY
    && customer.metadata?.feature_key === FORM_COACH_FEATURE_KEY
    && customer.metadata?.payer_id === payerId
    && customer.metadata?.customer_create_attempt_id === attemptId;
}

export async function createFormCoachBillingPortal(
  payerId: string,
  dependencies: Readonly<{
    configured: boolean;
    siteUrl: string;
    readCustomer: (payerId: string) => Promise<OwnedFormCoachCustomer | null>;
    retrieveCustomer: (customerId: string) => Promise<Stripe.Customer | Stripe.DeletedCustomer>;
    createPortal: (input: { customer: string; returnUrl: string }) => Promise<{ url: string | null }>;
  }>,
): Promise<BillingPortalResult> {
  if (!dependencies.configured) return { kind: "unavailable" };
  const owned = await dependencies.readCustomer(payerId);
  if (!owned) return { kind: "not_owned" };
  const returnUrl = formCoachReturnUrl(dependencies.siteUrl, "?portal=returned");
  if (!returnUrl) return { kind: "unavailable" };
  let customer: Stripe.Customer | Stripe.DeletedCustomer;
  try {
    customer = await dependencies.retrieveCustomer(owned.customerId);
  } catch {
    return { kind: "unavailable" };
  }
  if (!stripeCustomerBelongsToFormCoachPayer(customer, payerId, owned.attemptId)) {
    return { kind: "not_owned" };
  }
  let session: { url: string | null };
  try {
    session = await dependencies.createPortal({ customer: owned.customerId, returnUrl });
  } catch {
    return { kind: "unavailable" };
  }
  return isStripePortalUrl(session.url) ? { kind: "redirect", url: session.url } : { kind: "unavailable" };
}

export async function createFormCoachBillingPortalForPayer(payerId: string): Promise<BillingPortalResult> {
  if (!isStripeConfigured()) return { kind: "unavailable" };
  const stripe = getStripe();
  return createFormCoachBillingPortal(payerId, {
    configured: true,
    siteUrl: getSiteUrl(),
    readCustomer: readOwnedCustomer,
    retrieveCustomer: (customerId) => stripe.customers.retrieve(customerId),
    createPortal: async ({ customer, returnUrl }) => {
      const session = await stripe.billingPortal.sessions.create({ customer, return_url: returnUrl });
      return { url: session.url };
    },
  });
}
