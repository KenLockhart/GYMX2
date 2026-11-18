import "server-only";
import { idSchema } from "@/lib/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/supabase/env";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import {
  hasCurrentPaidPlatformMembership,
  isPlatformTier,
  platformPlan,
  platformTierForPrice,
  type PlatformPriceShape,
  type PlatformSubscriptionStatus,
  type PlatformTier,
} from "@/lib/platform-memberships";
import type Stripe from "stripe";

const PRICE_ENV: Record<PlatformTier, string> = {
  regular: "STRIPE_PLATFORM_REGULAR_PRICE_ID",
  premium: "STRIPE_PLATFORM_PREMIUM_PRICE_ID",
};

export type PlatformMembershipRow = {
  id: string;
  member_id: string;
  tier: PlatformTier;
  stripe_subscription_id: string;
  stripe_customer_id: string;
  stripe_price_id: string;
  status: PlatformSubscriptionStatus;
  current_period_end: string;
  cancel_at_period_end: boolean;
  last_event_created: number | null;
  last_event_id: string | null;
  state_revision: number;
  created_at: string;
  updated_at: string;
};

export type PlatformTestEntitlementRow = {
  id: string;
  member_id: string;
  tier: PlatformTier;
  source: "manual_test";
  grant_reason: string;
  granted_by: string;
  granted_at: string;
  revoked_by: string | null;
  revoked_at: string | null;
};

export type PlatformCheckoutAttemptRow = {
  member_id: string;
  tier: PlatformTier;
  request_id: string;
  stripe_session_id: string | null;
  stripe_customer_id: string | null;
  customer_email: string | null;
  expires_at: string;
  created_at: string;
};

export type PlatformEntitlement = {
  tier: PlatformTier;
  source: "stripe" | "manual_test";
  currentPeriodEnd: string | null;
};

export type PlatformEntitlementResult =
  | { ok: true; entitlement: PlatformEntitlement | null }
  | { ok: false; error: "lookup" };

export type PlatformBillingState = {
  latestSubscription: PlatformMembershipRow | null;
  activeSubscription: PlatformMembershipRow | null;
  testEntitlement: PlatformTestEntitlementRow | null;
  checkoutAttempt: PlatformCheckoutAttemptRow | null;
};

export class PlatformMembershipError extends Error {
  constructor(
    readonly code:
      | "not_configured"
      | "price_unavailable"
      | "invalid_price"
      | "active_membership"
      | "already_entitled"
      | "checkout_pending"
      | "checkout_failed"
      | "subscription_unavailable"
      | "portal_unavailable"
      | "invalid_subscription"
      | "account_deleting",
  ) {
    super(code);
  }
}

function configuredPriceIds(): Record<PlatformTier, string | null> {
  const ids = {
    regular: process.env[PRICE_ENV.regular] ?? null,
    premium: process.env[PRICE_ENV.premium] ?? null,
  };
  for (const tier of ["regular", "premium"] as const) {
    if (!ids[tier] || !/^price_[A-Za-z0-9]+$/.test(ids[tier] ?? "")) {
      ids[tier] = null;
    }
  }
  if (ids.regular && ids.regular === ids.premium) {
    return { regular: null, premium: null };
  }
  return ids;
}

function configuredPriceId(tier: PlatformTier) {
  const id = configuredPriceIds()[tier];
  if (!id) throw new PlatformMembershipError("not_configured");
  return id;
}

function customerId(customer: Stripe.Subscription["customer"]) {
  return typeof customer === "string" ? customer : customer.id;
}

function firstSubscriptionPrice(subscription: Stripe.Subscription) {
  if (subscription.items.data.length !== 1) return null;
  const item = subscription.items.data[0];
  if (!item || (item.quantity ?? 1) !== 1) return null;
  return item;
}

function stripePriceShape(price: Stripe.Price): PlatformPriceShape {
  return {
    id: price.id,
    active: price.active,
    currency: price.currency,
    unit_amount: price.unit_amount,
    recurring: price.recurring
      ? {
          interval: price.recurring.interval,
          interval_count: price.recurring.interval_count,
        }
      : null,
  };
}

async function verifiedStripePrice(tier: PlatformTier) {
  const priceId = configuredPriceId(tier);
  let price: Stripe.Price;
  try {
    price = await getStripe().prices.retrieve(priceId);
  } catch {
    throw new PlatformMembershipError("price_unavailable");
  }
  const resolved = platformTierForPrice(
    stripePriceShape(price),
    configuredPriceIds(),
  );
  if (resolved !== tier) throw new PlatformMembershipError("invalid_price");
  return price;
}

async function readPlatformRows(memberId: string) {
  const db = createAdminClient();
  const [subscriptions, entitlements, attempts, deletionLock] = await Promise.all([
    db
      .from("platform_memberships")
      .select("*")
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(10),
    db
      .from("platform_test_entitlements")
      .select("*")
      .eq("member_id", memberId)
      .is("revoked_at", null)
      .order("granted_at", { ascending: false })
      .limit(1),
    db
      .from("platform_checkout_attempts")
      .select("*")
      .eq("member_id", memberId)
      .maybeSingle(),
    db
      .from("platform_membership_deletion_locks")
      .select("member_id")
      .eq("member_id", memberId)
      .maybeSingle(),
  ]);
  if (
    subscriptions.error ||
    entitlements.error ||
    attempts.error ||
    deletionLock.error
  ) {
    throw new Error("Platform membership state could not be read.");
  }
  return {
    subscriptions: (subscriptions.data ?? []) as PlatformMembershipRow[],
    testEntitlement: (entitlements.data?.[0] ?? null) as PlatformTestEntitlementRow | null,
    checkoutAttempt: (attempts.data ?? null) as PlatformCheckoutAttemptRow | null,
    accountDeleting: Boolean(deletionLock.data),
  };
}

export async function getPlatformEntitlement(
  memberId: string,
): Promise<PlatformEntitlementResult> {
  try {
    const state = await readPlatformRows(memberId);
    if (state.accountDeleting) return { ok: true, entitlement: null };
    const now = new Date();
    const activeSubscription = state.subscriptions.find((row) =>
      hasCurrentPaidPlatformMembership(row, now),
    );
    const candidates: PlatformEntitlement[] = [];
    if (activeSubscription) {
      candidates.push({
        tier: activeSubscription.tier,
        source: "stripe",
        currentPeriodEnd: activeSubscription.current_period_end,
      });
    }
    if (state.testEntitlement) {
      candidates.push({
        tier: state.testEntitlement.tier,
        source: "manual_test",
        currentPeriodEnd: null,
      });
    }
    const entitlement = candidates.sort((left, right) =>
      left.tier === right.tier ? 0 : left.tier === "premium" ? -1 : 1,
    )[0] ?? null;
    return { ok: true, entitlement };
  } catch {
    return { ok: false, error: "lookup" };
  }
}

export async function getPlatformBillingState(
  memberId: string,
): Promise<{ ok: true; state: PlatformBillingState } | { ok: false; error: "lookup" }> {
  try {
    const rows = await readPlatformRows(memberId);
    if (rows.accountDeleting) return { ok: false, error: "lookup" };
    const activeSubscription = rows.subscriptions.find((row) =>
      hasCurrentPaidPlatformMembership(row),
    ) ?? null;
    return {
      ok: true,
      state: {
        latestSubscription: rows.subscriptions[0] ?? null,
        activeSubscription,
        testEntitlement: rows.testEntitlement,
        checkoutAttempt: rows.checkoutAttempt,
      },
    };
  } catch {
    return { ok: false, error: "lookup" };
  }
}

export async function platformHasTier(memberId: string, tier: PlatformTier) {
  const result = await getPlatformEntitlement(memberId);
  return result.ok && Boolean(result.entitlement &&
    (result.entitlement.tier === "premium" || tier === "regular"));
}

function subscriptionPeriodEnd(subscription: Stripe.Subscription) {
  const end = firstSubscriptionPrice(subscription)?.current_period_end;
  if (!end) throw new PlatformMembershipError("invalid_subscription");
  return new Date(end * 1000).toISOString();
}

async function tierFromSubscriptionPrice(
  subscription: Stripe.Subscription,
  price: Stripe.Price,
) {
  const ids = configuredPriceIds();
  const configuredTier = platformTierForPrice(
    stripePriceShape(price),
    ids,
    false,
  );
  if (configuredTier) return configuredTier;

  // A price can be archived after a member subscribes. Existing rows keep the trusted price/tier
  // pair so signed cancellation and lifecycle events still update the right subscription.
  const { data: existing, error } = await createAdminClient()
    .from("platform_memberships")
    .select("tier, stripe_price_id")
    .eq("stripe_subscription_id", subscription.id)
    .maybeSingle();
  if (error || !existing || existing.stripe_price_id !== price.id) return null;
  const tier = existing.tier;
  if (!isPlatformTier(tier)) return null;
  const plan = platformPlan(tier);
  const recurring = price.recurring;
  if (
    price.currency !== "usd" ||
    price.unit_amount !== plan.priceCents ||
    recurring?.interval !== "month" ||
    recurring.interval_count !== 1
  ) {
    return null;
  }
  return tier;
}

type PlatformSyncOutcome = "applied" | "conflict" | "deleting" | false;

async function platformAccountDeleting(memberId: string) {
  const db = createAdminClient();
  const [lock, profile] = await Promise.all([
    db
      .from("platform_membership_deletion_locks")
      .select("member_id")
      .eq("member_id", memberId)
      .maybeSingle(),
    db.from("profiles").select("id").eq("id", memberId).maybeSingle(),
  ]);
  if (lock.error || profile.error) throw new Error("Account status could not be checked.");
  return Boolean(lock.data) || !profile.data;
}

async function stopDeletedPlatformSubscription(subscription: Stripe.Subscription) {
  if (subscription.status === "canceled" || subscription.status === "incomplete_expired")
    return;
  await getStripe().subscriptions.cancel(subscription.id);
}

async function removeCheckoutReservation(
  memberId: string,
  requestId: string | null,
  sessionId?: string | null,
) {
  if (!requestId) return;
  const { data, error } = await createAdminClient().rpc(
    "release_platform_checkout_attempt",
    {
      target_member_id: memberId,
      target_request_id: requestId,
      target_session_id: sessionId ?? null,
      target_require_session_match: sessionId !== undefined,
    },
  );
  if (error) throw error;
  return data === true;
}

async function readCheckoutAttempt(memberId: string, requestId: string) {
  const { data, error } = await createAdminClient()
    .from("platform_checkout_attempts")
    .select("member_id, tier, request_id, stripe_session_id, stripe_customer_id, customer_email, expires_at, created_at")
    .eq("member_id", memberId)
    .eq("request_id", requestId)
    .maybeSingle();
  if (error) throw error;
  return (data as PlatformCheckoutAttemptRow | null) ?? null;
}

type CheckoutSessionLookup = Pick<
  PlatformCheckoutAttemptRow,
  "stripe_customer_id" | "customer_email" | "created_at"
>;

async function findPlatformCheckoutSession(
  memberId: string,
  requestId: string,
  attempt: CheckoutSessionLookup,
) {
  const createdAt = Date.parse(attempt.created_at);
  if (!Number.isFinite(createdAt)) {
    throw new PlatformMembershipError("subscription_unavailable");
  }
  if (!attempt.stripe_customer_id && !attempt.customer_email) {
    throw new PlatformMembershipError("checkout_pending");
  }
  const filter = attempt.stripe_customer_id
    ? { customer: attempt.stripe_customer_id }
    : { customer_details: { email: attempt.customer_email as string } };
  const created = { gte: Math.floor(createdAt / 1000) - 10 * 60 };
  let startingAfter: string | undefined;
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const page = await getStripe().checkout.sessions.list({
      ...filter,
      created,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const match = page.data.find(
      (session) =>
        session.metadata?.kind === "platform_membership" &&
        session.metadata.member_id === memberId &&
        session.metadata.checkout_request_id === requestId &&
        session.client_reference_id === memberId,
    );
    if (match) return match;
    if (!page.has_more || page.data.length === 0) return null;
    startingAfter = page.data[page.data.length - 1]?.id;
    if (!startingAfter) return null;
  }
  // If pagination is unexpectedly huge, preserve the reservation instead of assuming no paid
  // session exists.
  throw new PlatformMembershipError("checkout_pending");
}

async function readPlatformRevision(subscriptionId: string) {
  const { data, error } = await createAdminClient()
    .from("platform_memberships")
    .select("state_revision")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const revision = Number(data.state_revision);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("Platform membership revision is invalid.");
  }
  return revision;
}

export async function syncPlatformSubscription(
  subscription: Stripe.Subscription,
  event: { id: string; created: number } | null,
  expectedRevision: number | null,
): Promise<PlatformSyncOutcome> {
  const metadata = subscription.metadata ?? {};
  if (metadata.kind !== "platform_membership") return false;
  const member = idSchema.safeParse(metadata.member_id);
  if (!member.success) return false;
  const requestId = metadata.checkout_request_id
    ? idSchema.safeParse(metadata.checkout_request_id)
    : null;
  if (requestId && !requestId.success) {
    throw new PlatformMembershipError("invalid_subscription");
  }
  const checkoutRequestId = requestId?.success ? requestId.data : null;

  // A persistent deletion lock is checked before looking up archived price mappings, which may
  // disappear when the profile and its membership rows have already been removed.
  if (await platformAccountDeleting(member.data)) {
    await stopDeletedPlatformSubscription(subscription);
    await removeCheckoutReservation(member.data, checkoutRequestId);
    return "deleting";
  }

  const item = firstSubscriptionPrice(subscription);
  if (!item) throw new PlatformMembershipError("invalid_subscription");
  const tier = await tierFromSubscriptionPrice(subscription, item.price);
  if (!tier) throw new PlatformMembershipError("invalid_price");
  const customer = customerId(subscription.customer);
  const db = createAdminClient();
  const { data, error } = await db.rpc("sync_platform_membership", {
    target_member_id: member.data,
    target_tier: tier,
    target_subscription_id: subscription.id,
    target_customer_id: customer,
    target_price_id: item.price.id,
    target_status: subscription.status,
    target_current_period_end: subscriptionPeriodEnd(subscription),
    target_cancel_at_period_end: subscription.cancel_at_period_end,
    target_event_created: event?.created ?? null,
    target_event_id: event?.id ?? null,
    target_checkout_request_id: checkoutRequestId,
    target_expected_revision: expectedRevision,
  });
  if (error) throw error;
  if (data === "deleting") {
    await stopDeletedPlatformSubscription(subscription);
    await removeCheckoutReservation(member.data, checkoutRequestId);
  }
  if (data === "applied" || data === "conflict" || data === "deleting") {
    return data;
  }
  throw new Error("Platform membership synchronization returned an unknown result.");
}

export async function syncPlatformSubscriptionById(
  subscriptionId: string,
  event: { id: string; created: number } | null,
  expected?: { memberId?: string; checkoutRequestId?: string; customerId?: string },
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const expectedRevision = await readPlatformRevision(subscriptionId);
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    const metadata = subscription.metadata ?? {};
    if (
      (expected?.memberId && metadata.member_id !== expected.memberId) ||
      (expected?.checkoutRequestId &&
        metadata.checkout_request_id !== expected.checkoutRequestId) ||
      (expected?.customerId && customerId(subscription.customer) !== expected.customerId)
    ) {
      throw new PlatformMembershipError("invalid_subscription");
    }
    const result = await syncPlatformSubscription(
      subscription,
      event,
      expectedRevision,
    );
    if (result !== "conflict") return result === "applied";
  }
  throw new PlatformMembershipError("subscription_unavailable");
}

export async function confirmPlatformCheckout(
  sessionId: string,
  memberId: string,
) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return false;
  let session: Stripe.Checkout.Session;
  try {
    session = await getStripe().checkout.sessions.retrieve(sessionId);
  } catch {
    return false;
  }
  if (
    session.mode !== "subscription" ||
    session.status !== "complete" ||
    session.payment_status !== "paid" ||
    session.metadata?.kind !== "platform_membership" ||
    session.metadata.member_id !== memberId ||
    session.client_reference_id !== memberId
  ) {
    return false;
  }
  const requestId = idSchema.safeParse(session.metadata.checkout_request_id);
  if (!requestId.success) return false;
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;
  if (!subscriptionId) return false;
  try {
    return await syncPlatformSubscriptionById(subscriptionId, null, {
      memberId,
      checkoutRequestId: requestId.data,
    });
  } catch {
    return false;
  }
}

// Used after a Stripe-hosted plan change or cancellation returns to the account page. The database
// revision is read before Stripe is queried and used as a compare-and-swap fence. URL parameters
// only request this check; they never grant access.
export async function reconcilePlatformMembership(memberId: string) {
  const state = await getPlatformBillingState(memberId);
  if (!state.ok) throw new PlatformMembershipError("subscription_unavailable");
  const row = state.state.latestSubscription;
  if (!row) return false;
  return syncPlatformSubscriptionById(row.stripe_subscription_id, null, {
    memberId,
    customerId: row.stripe_customer_id,
  });
}

export async function releasePlatformCheckout(sessionId: string) {
  const { error } = await createAdminClient().rpc(
    "release_platform_checkout_session",
    { target_session_id: sessionId },
  );
  if (error) throw error;
}

async function expireUnattachedPlatformCheckout(
  sessionId: string,
  memberId: string,
  requestId: string,
): Promise<"expired" | "complete" | "open" | "unknown"> {
  try {
    let session = await getStripe().checkout.sessions.retrieve(sessionId);
    if (
      session.mode !== "subscription" ||
      session.metadata?.kind !== "platform_membership" ||
      session.metadata.member_id !== memberId ||
      session.metadata.checkout_request_id !== requestId ||
      session.client_reference_id !== memberId
    ) {
      return "unknown";
    }
    if (session.status === "open") {
      try {
        session = await getStripe().checkout.sessions.expire(session.id);
      } catch {
        session = await getStripe().checkout.sessions.retrieve(session.id);
      }
    }
    if (session.status === "complete") {
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
      if (!subscriptionId) return "unknown";
      const synced = await syncPlatformSubscriptionById(subscriptionId, null, {
        memberId,
        checkoutRequestId: requestId,
      });
      if (!synced && !(await platformAccountDeleting(memberId))) {
        return "unknown";
      }
      return "complete";
    }
    if (session.status === "expired") {
      await removeCheckoutReservation(memberId, requestId, session.id);
      return "expired";
    }
    return "open";
  } catch (error) {
    console.error("Could not close an unattached platform checkout.", error);
    return "unknown";
  }
}

async function finishCompletedPlatformCheckout(
  memberId: string,
  requestId: string,
  session: Stripe.Checkout.Session,
): Promise<never> {
  if (
    session.mode !== "subscription" ||
    session.status !== "complete" ||
    session.metadata?.kind !== "platform_membership" ||
    session.metadata.member_id !== memberId ||
    session.metadata.checkout_request_id !== requestId ||
    session.client_reference_id !== memberId
  ) {
    throw new PlatformMembershipError("invalid_subscription");
  }
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;
  if (!subscriptionId) throw new PlatformMembershipError("invalid_subscription");
  const synced = await syncPlatformSubscriptionById(subscriptionId, null, {
    memberId,
    checkoutRequestId: requestId,
  });
  if (!synced) {
    if (await platformAccountDeleting(memberId)) {
      throw new PlatformMembershipError("account_deleting");
    }
    throw new PlatformMembershipError("subscription_unavailable");
  }
  const state = await getPlatformBillingState(memberId);
  if (!state.ok) throw new PlatformMembershipError("subscription_unavailable");
  if (state.state.activeSubscription) {
    throw new PlatformMembershipError("active_membership");
  }
  // The checkout is complete but the current Stripe state is no longer an active paid plan.
  // Let the member refresh and explicitly start another checkout rather than auto-charging again.
  throw new PlatformMembershipError("subscription_unavailable");
}

type CheckoutReservation = {
  outcome:
    | "reserved"
    | "pending"
    | "subscription_pending"
    | "account_deleting"
    | "active"
    | "already_entitled";
  request_id: string | null;
  stripe_session_id: string | null;
  expires_at: string | null;
  existing_tier: PlatformTier | null;
};

export async function createPlatformCheckoutSession(
  member: { id: string; email: string },
  tier: PlatformTier,
) {
  return createPlatformCheckoutSessionAttempt(member, tier, 0);
}

async function createPlatformCheckoutSessionAttempt(
  member: { id: string; email: string },
  tier: PlatformTier,
  expiryRetries: number,
) {
  const price = await verifiedStripePrice(tier);
  let billing = await getPlatformBillingState(member.id);
  if (!billing.ok) throw new PlatformMembershipError("checkout_failed");
  if (
    billing.state.latestSubscription?.status === "active" &&
    !billing.state.activeSubscription
  ) {
    await reconcilePlatformMembership(member.id);
    billing = await getPlatformBillingState(member.id);
    if (!billing.ok) throw new PlatformMembershipError("checkout_failed");
  }
  if (billing.state.activeSubscription) {
    throw new PlatformMembershipError("active_membership");
  }
  if (
    billing.state.latestSubscription &&
    !["canceled", "incomplete_expired"].includes(
      billing.state.latestSubscription.status,
    )
  ) {
    throw new PlatformMembershipError("subscription_unavailable");
  }
  if (
    billing.state.testEntitlement &&
    (billing.state.testEntitlement.tier === "premium" || tier === "regular")
  ) {
    throw new PlatformMembershipError("already_entitled");
  }

  const db = createAdminClient();
  const existingCustomerId =
    billing.state.latestSubscription?.stripe_customer_id ?? null;
  const customerEmail = existingCustomerId ? null : member.email || null;
  const { data: reservationData, error: reservationError } = await db.rpc(
    "reserve_platform_checkout",
    {
      target_member_id: member.id,
      target_tier: tier,
      target_customer_id: existingCustomerId,
      target_customer_email: customerEmail?.trim().toLowerCase() ?? null,
    },
  );
  if (reservationError) throw new PlatformMembershipError("checkout_failed");
  const reservation = (Array.isArray(reservationData)
    ? reservationData[0]
    : reservationData) as CheckoutReservation | null;
  if (!reservation?.outcome) throw new PlatformMembershipError("checkout_failed");
  if (reservation.outcome === "account_deleting") {
    throw new PlatformMembershipError("account_deleting");
  }
  if (reservation.outcome === "subscription_pending") {
    throw new PlatformMembershipError("subscription_unavailable");
  }
  if (reservation.outcome === "active") {
    throw new PlatformMembershipError("active_membership");
  }
  if (reservation.outcome === "already_entitled") {
    throw new PlatformMembershipError("already_entitled");
  }
  if (
    reservation.outcome === "pending" &&
    reservation.existing_tier !== tier
  ) {
    throw new PlatformMembershipError("checkout_pending");
  }
  if (!reservation.request_id) throw new PlatformMembershipError("checkout_failed");
  const attempt = await readCheckoutAttempt(member.id, reservation.request_id);
  if (!attempt) throw new PlatformMembershipError("checkout_pending");
  const reservationExpiry = reservation.expires_at
    ? Date.parse(reservation.expires_at)
    : Number.NaN;
  if (!Number.isFinite(reservationExpiry)) {
    throw new PlatformMembershipError("checkout_pending");
  }
  let now = Date.now();
  let remainingMs = reservationExpiry - now;
  let session: Stripe.Checkout.Session | null = null;

  if (reservation.stripe_session_id) {
    try {
      session = await getStripe().checkout.sessions.retrieve(
        reservation.stripe_session_id,
      );
    } catch {
      throw new PlatformMembershipError("checkout_failed");
    }
  } else if (remainingMs < 30 * 60 * 1000) {
    // The original create response can be lost after Stripe successfully created or completed a
    // session. Search by the reservation's saved customer/email and request metadata before ever
    // considering a replacement, including after Stripe's idempotency retention window.
    try {
      session = await findPlatformCheckoutSession(
        member.id,
        reservation.request_id,
        attempt,
      );
    } catch (error) {
      if (error instanceof PlatformMembershipError) throw error;
      throw new PlatformMembershipError("checkout_pending");
    }
    if (!session && remainingMs <= 0) {
      const released = await removeCheckoutReservation(
        member.id,
        reservation.request_id,
        null,
      );
      if (released && expiryRetries === 0) {
        return createPlatformCheckoutSessionAttempt(member, tier, 1);
      }
      throw new PlatformMembershipError("checkout_pending");
    }
    if (!session) throw new PlatformMembershipError("checkout_pending");
  }

  if (session) {
    const matchesRequest =
      session.mode === "subscription" &&
      session.metadata?.kind === "platform_membership" &&
      session.metadata.member_id === member.id &&
      session.metadata.tier === tier &&
      session.metadata.checkout_request_id === reservation.request_id &&
      session.client_reference_id === member.id;
    if (!matchesRequest) throw new PlatformMembershipError("checkout_pending");
    if (session.status === "complete") {
      return finishCompletedPlatformCheckout(
        member.id,
        reservation.request_id,
        session,
      );
    }
    if (session.status === "expired") {
      const released = await removeCheckoutReservation(
        member.id,
        reservation.request_id,
        session.id,
      );
      if (released && expiryRetries === 0) {
        return createPlatformCheckoutSessionAttempt(member, tier, 1);
      }
      throw new PlatformMembershipError("checkout_pending");
    }
    if (
      session.status === "open" &&
      (session.expires_at * 1000 <= Date.now() ||
        session.expires_at * 1000 > reservationExpiry ||
        !session.url)
    ) {
      const cleanup = await expireUnattachedPlatformCheckout(
        session.id,
        member.id,
        reservation.request_id,
      );
      if (cleanup === "complete") {
        return finishCompletedPlatformCheckout(
          member.id,
          reservation.request_id,
          await getStripe().checkout.sessions.retrieve(session.id),
        );
      }
      if (cleanup === "expired" && expiryRetries === 0) {
        return createPlatformCheckoutSessionAttempt(member, tier, 1);
      }
      if (await platformAccountDeleting(member.id)) {
        throw new PlatformMembershipError("account_deleting");
      }
      throw new PlatformMembershipError("checkout_pending");
    }
    if (!session.url) throw new PlatformMembershipError("checkout_pending");
    if (attempt.stripe_session_id === session.id) return session.url;

    const { data: attached, error: attachError } = await db.rpc(
      "attach_platform_checkout_session",
      {
        target_member_id: member.id,
        target_request_id: reservation.request_id,
        target_session_id: session.id,
        target_expires_at: new Date(session.expires_at * 1000).toISOString(),
      },
    );
    if (!attachError && attached) return session.url;

    // A concurrent invocation may already have attached this idempotent Session, or the RPC may
    // have committed before its response was lost. Re-read the canonical binding before cleanup.
    let currentAttempt: PlatformCheckoutAttemptRow | null;
    try {
      currentAttempt = await readCheckoutAttempt(member.id, reservation.request_id);
    } catch {
      throw new PlatformMembershipError("checkout_pending");
    }
    if (currentAttempt?.stripe_session_id === session.id) return session.url;
    if (attachError) {
      let latestSession: Stripe.Checkout.Session;
      try {
        latestSession = await getStripe().checkout.sessions.retrieve(session.id);
      } catch {
        throw new PlatformMembershipError("checkout_pending");
      }
      if (latestSession.status === "complete") {
        return finishCompletedPlatformCheckout(
          member.id,
          reservation.request_id,
          latestSession,
        );
      }
      if (latestSession.status === "expired") {
        await removeCheckoutReservation(
          member.id,
          reservation.request_id,
          latestSession.id,
        );
      }
      // An uncertain attach response is not evidence that the session is orphaned. Preserve any
      // still-open URL and let this idempotent request reconcile it on retry.
      throw new PlatformMembershipError("checkout_pending");
    }
    if (currentAttempt?.stripe_session_id) {
      throw new PlatformMembershipError("checkout_pending");
    }
    if (await platformAccountDeleting(member.id)) {
      await expireUnattachedPlatformCheckout(
        session.id,
        member.id,
        reservation.request_id,
      );
      throw new PlatformMembershipError("account_deleting");
    }
    const cleanup = await expireUnattachedPlatformCheckout(
      session.id,
      member.id,
      reservation.request_id,
    );
    if (cleanup === "complete") {
      return finishCompletedPlatformCheckout(
        member.id,
        reservation.request_id,
        await getStripe().checkout.sessions.retrieve(session.id),
      );
    }
    throw new PlatformMembershipError("checkout_pending");
  }

  now = Date.now();
  remainingMs = reservationExpiry - now;
  // Stripe Checkout requires expiration to be at least 30 minutes ahead and no more than 24
  // hours. Near-deadline reservations are reconciled above; never create a second URL while the
  // original operation could still exist.
  if (
    remainingMs < 30 * 60 * 1000 ||
    remainingMs > 24 * 60 * 60 * 1000
  ) {
    throw new PlatformMembershipError("checkout_pending");
  }
  const idempotencyKey = `platform-membership-${member.id}-${reservation.request_id}`;
  const metadata = {
    kind: "platform_membership",
    member_id: member.id,
    tier,
    checkout_request_id: reservation.request_id,
  };
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [{ price: price.id, quantity: 1 }],
    client_reference_id: member.id,
    customer_email: billing.state.latestSubscription?.stripe_customer_id
      ? undefined
      : member.email || undefined,
    ...(billing.state.latestSubscription?.stripe_customer_id
      ? { customer: billing.state.latestSubscription.stripe_customer_id }
      : {}),
    success_url: `${getSiteUrl()}/membership?checkout=complete&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${getSiteUrl()}/membership?checkout=cancelled`,
    expires_at: Math.floor(reservationExpiry / 1000),
    metadata,
    subscription_data: { metadata },
  };

  try {
    session = await getStripe().checkout.sessions.create(params, {
      idempotencyKey,
    });
  } catch {
    throw new PlatformMembershipError("checkout_failed");
  }
  if (
    session.status === "complete" &&
    session.metadata?.kind === "platform_membership" &&
    session.metadata.member_id === member.id &&
    session.metadata.tier === tier &&
    session.metadata.checkout_request_id === reservation.request_id &&
    session.client_reference_id === member.id
  ) {
    return finishCompletedPlatformCheckout(member.id, reservation.request_id, session);
  }
  if (
    session.status !== "open" ||
    session.metadata?.kind !== "platform_membership" ||
    session.metadata.member_id !== member.id ||
    session.metadata.tier !== tier ||
    session.metadata.checkout_request_id !== reservation.request_id ||
    session.client_reference_id !== member.id ||
    !session.url ||
    !Number.isFinite(session.expires_at) ||
    session.expires_at * 1000 <= Date.now() ||
    session.expires_at * 1000 > reservationExpiry
  ) {
    const cleanup = await expireUnattachedPlatformCheckout(
      session.id,
      member.id,
      reservation.request_id,
    );
    if (cleanup === "complete") {
      return finishCompletedPlatformCheckout(
        member.id,
        reservation.request_id,
        await getStripe().checkout.sessions.retrieve(session.id),
      );
    }
    if (cleanup === "expired" && expiryRetries === 0) {
      return createPlatformCheckoutSessionAttempt(member, tier, 1);
    }
    if (await platformAccountDeleting(member.id)) {
      throw new PlatformMembershipError("account_deleting");
    }
    throw new PlatformMembershipError("checkout_pending");
  }
  const { data: attached, error: attachError } = await db.rpc(
    "attach_platform_checkout_session",
    {
      target_member_id: member.id,
      target_request_id: reservation.request_id,
      target_session_id: session.id,
      target_expires_at: new Date(session.expires_at * 1000).toISOString(),
    },
  );
  if (!attachError && attached) return session.url;

  let currentAttempt: PlatformCheckoutAttemptRow | null;
  try {
    currentAttempt = await readCheckoutAttempt(member.id, reservation.request_id);
  } catch {
    throw new PlatformMembershipError("checkout_pending");
  }
  if (currentAttempt?.stripe_session_id === session.id) return session.url;
  if (attachError) {
    let latestSession: Stripe.Checkout.Session;
    try {
      latestSession = await getStripe().checkout.sessions.retrieve(session.id);
    } catch {
      throw new PlatformMembershipError("checkout_pending");
    }
    if (latestSession.status === "complete") {
      return finishCompletedPlatformCheckout(
        member.id,
        reservation.request_id,
        latestSession,
      );
    }
    if (latestSession.status === "expired") {
      await removeCheckoutReservation(
        member.id,
        reservation.request_id,
        latestSession.id,
      );
    }
    throw new PlatformMembershipError("checkout_pending");
  }
  if (currentAttempt?.stripe_session_id) {
    throw new PlatformMembershipError("checkout_pending");
  }
  if (await platformAccountDeleting(member.id)) {
    const cleanup = await expireUnattachedPlatformCheckout(
      session.id,
      member.id,
      reservation.request_id,
    );
    if (cleanup === "complete") {
      return finishCompletedPlatformCheckout(
        member.id,
        reservation.request_id,
        await getStripe().checkout.sessions.retrieve(session.id),
      );
    }
    throw new PlatformMembershipError("account_deleting");
  }
  const cleanup = await expireUnattachedPlatformCheckout(
    session.id,
    member.id,
    reservation.request_id,
  );
  if (cleanup === "complete") {
    return finishCompletedPlatformCheckout(
      member.id,
      reservation.request_id,
      await getStripe().checkout.sessions.retrieve(session.id),
    );
  }
  throw new PlatformMembershipError("checkout_pending");
}

async function getOwnedCurrentStripeSubscription(memberId: string) {
  await reconcilePlatformMembership(memberId);
  const state = await getPlatformBillingState(memberId);
  if (!state.ok) throw new PlatformMembershipError("subscription_unavailable");
  const row = state.state.activeSubscription;
  if (!row) throw new PlatformMembershipError("subscription_unavailable");

  let subscription: Stripe.Subscription;
  try {
    subscription = await getStripe().subscriptions.retrieve(
      row.stripe_subscription_id,
    );
  } catch {
    throw new PlatformMembershipError("subscription_unavailable");
  }
  const metadata = subscription.metadata ?? {};
  if (
    metadata.kind !== "platform_membership" ||
    metadata.member_id !== memberId ||
    customerId(subscription.customer) !== row.stripe_customer_id ||
    subscription.status !== "active"
  ) {
    throw new PlatformMembershipError("invalid_subscription");
  }
  const item = firstSubscriptionPrice(subscription);
  if (!item) throw new PlatformMembershipError("invalid_subscription");
  const tier = await tierFromSubscriptionPrice(subscription, item.price);
  if (!tier || tier !== row.tier) {
    throw new PlatformMembershipError("invalid_subscription");
  }
  return { row, subscription, item, tier };
}

async function getLatestOwnedStripeSubscription(memberId: string) {
  const state = await getPlatformBillingState(memberId);
  if (!state.ok) throw new PlatformMembershipError("subscription_unavailable");
  const row = state.state.latestSubscription;
  if (!row) throw new PlatformMembershipError("subscription_unavailable");

  let subscription: Stripe.Subscription;
  try {
    subscription = await getStripe().subscriptions.retrieve(
      row.stripe_subscription_id,
    );
  } catch {
    throw new PlatformMembershipError("subscription_unavailable");
  }
  if (
    subscription.metadata?.kind !== "platform_membership" ||
    subscription.metadata.member_id !== memberId ||
    customerId(subscription.customer) !== row.stripe_customer_id
  ) {
    throw new PlatformMembershipError("invalid_subscription");
  }
  const item = firstSubscriptionPrice(subscription);
  if (!item) throw new PlatformMembershipError("invalid_subscription");
  const tier = await tierFromSubscriptionPrice(subscription, item.price);
  if (!tier || tier !== row.tier) {
    throw new PlatformMembershipError("invalid_subscription");
  }
  return { row, subscription, item, tier };
}

export async function createPlatformBillingPortalSession(
  memberId: string,
  intent:
    | { type: "manage" }
    | { type: "cancel" }
    | { type: "change"; tier: PlatformTier },
  options: { allowRegularPlan: boolean },
) {
  const current =
    intent.type === "manage"
      ? await getLatestOwnedStripeSubscription(memberId)
      : await getOwnedCurrentStripeSubscription(memberId);
  const returnUrl = `${getSiteUrl()}/membership`;
  let flowData: Stripe.BillingPortal.SessionCreateParams.FlowData | undefined;

  if (intent.type === "cancel") {
    flowData = {
      type: "subscription_cancel",
      after_completion: {
        type: "redirect",
        redirect: { return_url: `${returnUrl}?plan=cancelled` },
      },
      subscription_cancel: { subscription: current.subscription.id },
    };
  } else if (intent.type === "change") {
    if (
      intent.tier === current.tier ||
      (intent.tier === "regular" && !options.allowRegularPlan)
    ) {
      throw new PlatformMembershipError("invalid_subscription");
    }
    const newPrice = await verifiedStripePrice(intent.tier);
    flowData = {
      type: "subscription_update_confirm",
      after_completion: {
        type: "redirect",
        redirect: { return_url: `${returnUrl}?plan=updated` },
      },
      subscription_update_confirm: {
        subscription: current.subscription.id,
        items: [{ id: current.item.id, price: newPrice.id, quantity: 1 }],
        discounts: [],
      },
    };
  }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: current.row.stripe_customer_id,
      return_url: returnUrl,
      ...(flowData ? { flow_data: flowData } : {}),
    });
    return session.url;
  } catch {
    throw new PlatformMembershipError("portal_unavailable");
  }
}

export async function resumePlatformMembership(memberId: string) {
  const current = await getOwnedCurrentStripeSubscription(memberId);
  if (!current.subscription.cancel_at_period_end) {
    return false;
  }
  try {
    await getStripe().subscriptions.update(current.subscription.id, {
      cancel_at_period_end: false,
    });
  } catch {
    throw new PlatformMembershipError("portal_unavailable");
  }
  return true;
}

export async function cancelAllPlatformMemberships(memberId: string) {
  const db = createAdminClient();
  const { error: lockError } = await db.rpc(
    "lock_platform_membership_account_for_deletion",
    { target_member_id: memberId },
  );
  if (lockError) throw lockError;

  const [attempts, memberships] = await Promise.all([
    db
      .from("platform_checkout_attempts")
      .select("request_id, stripe_session_id, stripe_customer_id, customer_email, expires_at, created_at")
      .eq("member_id", memberId),
    db
      .from("platform_memberships")
      .select("stripe_subscription_id, stripe_customer_id, status")
      .eq("member_id", memberId)
      .in("status", [
        "active",
        "past_due",
        "paused",
        "trialing",
        "incomplete",
        "unpaid",
      ]),
  ]);
  if (attempts.error || memberships.error) {
    throw new Error("Platform billing state could not be read for account closure.");
  }
  const needsStripe = Boolean(
    attempts.data?.length || memberships.data?.length,
  );
  if (!needsStripe) return;
  if (!isStripeConfigured()) {
    throw new Error("Stripe is unavailable, so platform billing cannot be stopped.");
  }

  const subscriptionsToCancel = new Map<
    string,
    { customerId?: string; requestId?: string }
  >();
  const completedCheckoutSessions: Array<{
    sessionId: string;
    requestId: string;
  }> = [];
  for (const attempt of attempts.data ?? []) {
    let session = attempt.stripe_session_id
      ? await getStripe().checkout.sessions.retrieve(attempt.stripe_session_id)
      : await findPlatformCheckoutSession(
          memberId,
          attempt.request_id,
          attempt,
        );
    if (!session) {
      const expiresAt = Date.parse(attempt.expires_at);
      if (!Number.isFinite(expiresAt) || expiresAt > Date.now()) {
        // The Stripe create call may still be in flight. Keep the account tombstone and refuse
        // profile deletion until that bounded operation resolves.
        throw new PlatformMembershipError("checkout_pending");
      }
      await removeCheckoutReservation(memberId, attempt.request_id, null);
      continue;
    }
    if (
      session.mode !== "subscription" ||
      session.metadata?.kind !== "platform_membership" ||
      session.metadata.member_id !== memberId ||
      session.metadata.checkout_request_id !== attempt.request_id ||
      session.client_reference_id !== memberId
    ) {
      throw new Error("A platform checkout could not be verified for account closure.");
    }
    if (session.status === "open") {
      try {
        session = await getStripe().checkout.sessions.expire(session.id);
      } catch {
        session = await getStripe().checkout.sessions.retrieve(session.id);
      }
      if (session.status === "open") {
        throw new Error("An open platform checkout could not be closed.");
      }
    }
    if (session.status === "complete") {
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
      if (!subscriptionId) {
        throw new Error("A completed platform checkout has no subscription.");
      }
      const sessionCustomer = session.customer
        ? customerId(session.customer)
        : undefined;
      subscriptionsToCancel.set(subscriptionId, {
        customerId: sessionCustomer,
        requestId: attempt.request_id,
      });
      completedCheckoutSessions.push({
        sessionId: session.id,
        requestId: attempt.request_id,
      });
    } else {
      await removeCheckoutReservation(memberId, attempt.request_id, session.id);
    }
  }
  for (const row of memberships.data ?? []) {
    subscriptionsToCancel.set(row.stripe_subscription_id as string, {
      customerId: row.stripe_customer_id as string,
    });
  }

  for (const [subscriptionId, expected] of subscriptionsToCancel) {
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    if (
      subscription.metadata?.kind !== "platform_membership" ||
      subscription.metadata.member_id !== memberId ||
      (expected.customerId &&
        customerId(subscription.customer) !== expected.customerId) ||
      (expected.requestId &&
        subscription.metadata.checkout_request_id !== expected.requestId)
    ) {
      throw new Error("The platform subscription could not be verified for account deletion.");
    }
    if (subscription.status !== "canceled" && subscription.status !== "incomplete_expired") {
      await getStripe().subscriptions.cancel(subscription.id);
    }
  }
  for (const checkout of completedCheckoutSessions) {
    await removeCheckoutReservation(
      memberId,
      checkout.requestId,
      checkout.sessionId,
    );
  }
}
