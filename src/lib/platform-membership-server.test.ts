import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import {
  cancelAllPlatformMemberships,
  confirmPlatformCheckout,
  createPlatformCheckoutSession,
  reconcilePlatformMembership,
  syncPlatformSubscriptionById,
} from "./platform-membership-server";

const mocks = vi.hoisted(() => ({
  tableResults: {} as Record<string, Array<{ data: unknown; error: unknown }>>,
  rpcResults: {} as Record<string, Array<{ data: unknown; error: unknown }>>,
  subscriptionResults: [] as unknown[],
  checkoutSessionResults: [] as unknown[],
  operations: [] as Array<Record<string, unknown>>,
  stripe: {
    prices: { retrieve: vi.fn() },
    subscriptions: { retrieve: vi.fn(), cancel: vi.fn() },
    checkout: {
      sessions: { create: vi.fn(), retrieve: vi.fn(), expire: vi.fn(), list: vi.fn() },
    },
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const result = mocks.tableResults[table]?.shift() ?? {
        data: null,
        error: null,
      };
      const promise = Promise.resolve(result);
      const query = Object.assign(promise, {
        select: (columns?: string) => {
          mocks.operations.push({ kind: "select", table, columns });
          return query;
        },
        eq: (column: string, value: unknown) => {
          mocks.operations.push({ kind: "filter", table, column, value });
          return query;
        },
        is: (column: string, value: unknown) => {
          mocks.operations.push({ kind: "filter", table, column, value });
          return query;
        },
        gt: (column: string, value: unknown) => {
          mocks.operations.push({ kind: "filter", table, column, value });
          return query;
        },
        order: (column: string, options: unknown) => {
          mocks.operations.push({ kind: "order", table, column, options });
          return query;
        },
        limit: (count: number) => {
          mocks.operations.push({ kind: "limit", table, count });
          return query;
        },
        in: (column: string, values: unknown[]) => {
          mocks.operations.push({ kind: "filter-in", table, column, values });
          return query;
        },
        delete: () => {
          mocks.operations.push({ kind: "delete", table });
          return query;
        },
        maybeSingle: () => Promise.resolve(result),
      });
      mocks.operations.push({ kind: "from", table });
      return query;
    },
    rpc: (name: string, args: unknown) => {
      mocks.operations.push({ kind: "rpc", name, args });
      return Promise.resolve(
        mocks.rpcResults[name]?.shift() ?? { data: null, error: null },
      );
    },
  }),
}));
vi.mock("@/lib/supabase/env", () => ({
  getSiteUrl: () => "https://gymx2.example",
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => mocks.stripe,
  isStripeConfigured: () => true,
}));

const MEMBER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_MEMBER_ID = "00000000-0000-4000-8000-000000000003";
const REQUEST_ID = "00000000-0000-4000-8000-000000000002";
const NEXT_REQUEST_ID = "00000000-0000-4000-8000-000000000004";
const REGULAR_PRICE_ID = "price_Regular";
const PREMIUM_PRICE_ID = "price_Premium";

function ok(data: unknown) {
  return { data, error: null };
}

function queueTable(table: string, ...results: Array<{ data: unknown; error: unknown }>) {
  mocks.tableResults[table] = results;
}

function appendTable(
  table: string,
  ...results: Array<{ data: unknown; error: unknown }>
) {
  mocks.tableResults[table] = [...(mocks.tableResults[table] ?? []), ...results];
}

function checkoutAttempt(
  expiresAt: string,
  sessionId: string | null = null,
  requestId = REQUEST_ID,
) {
  return {
    member_id: MEMBER_ID,
    tier: "regular",
    request_id: requestId,
    stripe_session_id: sessionId,
    stripe_customer_id: null,
    customer_email: "synthetic@example.test",
    expires_at: expiresAt,
    created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  };
}

function createdCheckoutSession(
  expiresAt: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "cs_created_synthetic",
    mode: "subscription",
    status: "open",
    payment_status: "unpaid",
    subscription: null,
    client_reference_id: MEMBER_ID,
    metadata: {
      kind: "platform_membership",
      member_id: MEMBER_ID,
      tier: "regular",
      checkout_request_id: REQUEST_ID,
    },
    url: "https://checkout.example/synthetic",
    expires_at: Math.floor(Date.parse(expiresAt) / 1000),
    ...overrides,
  };
}

function queueRpc(name: string, ...results: Array<{ data: unknown; error: unknown }>) {
  mocks.rpcResults[name] = results;
}

function queueStripeSubscriptions(...results: unknown[]) {
  mocks.subscriptionResults.push(...results);
}

function queueCheckoutSessions(...results: unknown[]) {
  mocks.checkoutSessionResults.push(...results);
}

function price(tier: "regular" | "premium") {
  return {
    id: tier === "regular" ? REGULAR_PRICE_ID : PREMIUM_PRICE_ID,
    active: true,
    currency: "usd",
    unit_amount: tier === "regular" ? 800 : 2495,
    recurring: { interval: "month", interval_count: 1 },
  };
}

function subscription(
  tier: "regular" | "premium" = "premium",
  status: string = "active",
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "sub_synthetic_platform",
    customer: "cus_synthetic_platform",
    status,
    cancel_at_period_end: false,
    metadata: {
      kind: "platform_membership",
      member_id: MEMBER_ID,
      checkout_request_id: REQUEST_ID,
    },
    items: {
      data: [
        {
          id: "si_synthetic_platform",
          quantity: 1,
          current_period_end: 4_102_444_800,
          price: price(tier),
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function billingRow(
  tier: "regular" | "premium" = "premium",
  status: string = "active",
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "row_synthetic_platform",
    member_id: MEMBER_ID,
    tier,
    stripe_subscription_id: "sub_synthetic_platform",
    stripe_customer_id: "cus_synthetic_platform",
    stripe_price_id: tier === "regular" ? REGULAR_PRICE_ID : PREMIUM_PRICE_ID,
    status,
    current_period_end: "2099-12-31T00:00:00.000Z",
    cancel_at_period_end: false,
    last_event_created: null,
    last_event_id: null,
    state_revision: 7,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function queueRevision(revision: number, ...more: number[]) {
  queueTable(
    "platform_memberships",
    ...[revision, ...more].map((state_revision) =>
      ok({ state_revision, last_event_created: 9_999_999_999 }),
    ),
  );
}

function queueNotDeleting(count = 1) {
  queueTable(
    "platform_membership_deletion_locks",
    ...Array.from({ length: count }, () => ok(null)),
  );
  queueTable(
    "profiles",
    ...Array.from({ length: count }, () => ok({ id: MEMBER_ID })),
  );
}

function queueEmptyBillingState() {
  queueTable("platform_memberships", ok([]));
  queueTable("platform_test_entitlements", ok([]));
  queueTable("platform_checkout_attempts", ok(null));
  queueTable("platform_membership_deletion_locks", ok(null));
}

function reservationExpiry() {
  return new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
}

function syncCalls() {
  return mocks.operations
    .filter((operation) => operation.kind === "rpc" && operation.name === "sync_platform_membership")
    .map((operation) => operation.args as Record<string, unknown>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_PLATFORM_REGULAR_PRICE_ID", REGULAR_PRICE_ID);
  vi.stubEnv("STRIPE_PLATFORM_PREMIUM_PRICE_ID", PREMIUM_PRICE_ID);
  mocks.tableResults = {};
  mocks.rpcResults = {};
  mocks.subscriptionResults = [];
  mocks.checkoutSessionResults = [];
  mocks.operations = [];
  mocks.stripe.prices.retrieve.mockImplementation(async () => {
    mocks.operations.push({ kind: "stripe", name: "prices.retrieve" });
    return price("regular");
  });
  mocks.stripe.subscriptions.retrieve.mockImplementation(async () => {
    mocks.operations.push({ kind: "stripe", name: "subscriptions.retrieve" });
    const result = mocks.subscriptionResults.shift();
    if (result instanceof Error) throw result;
    if (!result) throw new Error("No synthetic subscription was queued.");
    return result;
  });
  mocks.stripe.subscriptions.cancel.mockResolvedValue({});
  mocks.stripe.checkout.sessions.create.mockImplementation(async () =>
    createdCheckoutSession(reservationExpiry()),
  );
  mocks.stripe.checkout.sessions.retrieve.mockImplementation(async () => {
    mocks.operations.push({ kind: "stripe", name: "checkout.sessions.retrieve" });
    const result = mocks.checkoutSessionResults.shift();
    if (result instanceof Error) throw result;
    if (!result) throw new Error("No synthetic checkout session was queued.");
    return result;
  });
  mocks.stripe.checkout.sessions.expire.mockImplementation(async (sessionId: string) => ({
    id: sessionId,
    status: "expired",
    url: null,
  }));
  mocks.stripe.checkout.sessions.list.mockResolvedValue({ data: [], has_more: false });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("platform subscription compare-and-swap orchestration", () => {
  it("reads each revision before retrieving fresh Stripe state and retries a CAS conflict", async () => {
    queueRevision(7, 8);
    queueNotDeleting(2);
    queueStripeSubscriptions(
      subscription("premium", "active"),
      subscription("regular", "canceled"),
    );
    queueRpc(
      "sync_platform_membership",
      ok("conflict"),
      ok("applied"),
    );

    const result = await syncPlatformSubscriptionById(
      "sub_synthetic_platform",
      { id: "evt_signed_synthetic", created: 1_800_000_000 },
    );

    expect(result).toBe(true);
    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(syncCalls().map((args) => args.target_expected_revision)).toEqual([7, 8]);
    expect(syncCalls().map((args) => [args.target_tier, args.target_status])).toEqual([
      ["premium", "active"],
      ["regular", "canceled"],
    ]);
    expect(syncCalls().every((args) => args.target_event_created === 1_800_000_000)).toBe(true);
    const operations = mocks.operations;
    const revisionReads = operations
      .map((operation, index) => ({ operation, index }))
      .filter(({ operation }) => operation.kind === "from" && operation.table === "platform_memberships");
    const stripeReads = operations
      .map((operation, index) => ({ operation, index }))
      .filter(({ operation }) => operation.kind === "stripe" && operation.name === "subscriptions.retrieve");
    expect(revisionReads.map(({ index }) => index)).toEqual(
      expect.arrayContaining([expect.any(Number), expect.any(Number)]),
    );
    expect(revisionReads[0]?.index).toBeLessThan(stripeReads[0]?.index ?? -1);
    expect(revisionReads[1]?.index).toBeLessThan(stripeReads[1]?.index ?? -1);
  });

  it("applies the current canceled snapshot even when the signed event timestamp is older", async () => {
    queueTable(
      "platform_memberships",
      ok({ state_revision: 12, last_event_created: 1_900_000_000 }),
    );
    queueNotDeleting();
    queueStripeSubscriptions(subscription("regular", "canceled"));
    queueRpc("sync_platform_membership", ok("applied"));

    const result = await syncPlatformSubscriptionById(
      "sub_synthetic_platform",
      { id: "evt_late_signed_synthetic", created: 1_700_000_000 },
    );

    expect(result).toBe(true);
    expect(syncCalls()).toHaveLength(1);
    expect(syncCalls()[0]).toMatchObject({
      target_tier: "regular",
      target_status: "canceled",
      target_event_created: 1_700_000_000,
      target_expected_revision: 12,
    });
  });

  it("handles duplicate webhook deliveries by syncing the current Stripe state again", async () => {
    queueRevision(4, 5);
    queueNotDeleting(2);
    queueStripeSubscriptions(
      subscription("regular", "active"),
      subscription("regular", "active"),
    );
    queueRpc("sync_platform_membership", ok("applied"), ok("applied"));

    const event = { id: "evt_duplicate_synthetic", created: 1_800_000_000 };
    await expect(syncPlatformSubscriptionById("sub_synthetic_platform", event)).resolves.toBe(true);
    await expect(syncPlatformSubscriptionById("sub_synthetic_platform", event)).resolves.toBe(true);

    expect(mocks.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(2);
    expect(syncCalls().map((args) => args.target_expected_revision)).toEqual([4, 5]);
    expect(syncCalls().every((args) => args.target_event_id === event.id)).toBe(true);
  });

  it("fails closed when Stripe returns a subscription owned by another member", async () => {
    queueRevision(5);
    queueStripeSubscriptions(
      subscription("premium", "active", {
        metadata: {
          kind: "platform_membership",
          member_id: OTHER_MEMBER_ID,
          checkout_request_id: REQUEST_ID,
        },
      }),
    );

    await expect(
      syncPlatformSubscriptionById("sub_synthetic_platform", null, {
        memberId: MEMBER_ID,
      }),
    ).rejects.toMatchObject({ code: "invalid_subscription" });
    expect(syncCalls()).toHaveLength(0);
  });

  it("fails closed when a subscription uses an unconfigured Stripe price", async () => {
    queueRevision(5);
    queueNotDeleting();
    queueStripeSubscriptions(
      subscription("premium", "active", {
        items: {
          data: [
            {
              id: "si_synthetic_platform",
              quantity: 1,
              current_period_end: 4_102_444_800,
              price: {
                ...price("premium"),
                id: "price_Unconfigured",
              },
            },
          ],
        },
      }),
    );
    queueTable("platform_memberships", ok(null));

    await expect(
      syncPlatformSubscriptionById("sub_synthetic_platform", null),
    ).rejects.toMatchObject({ code: "invalid_price" });
    expect(syncCalls()).toHaveLength(0);
  });

  it("cancels a late platform subscription when account deletion is locked", async () => {
    queueRevision(6);
    queueStripeSubscriptions(subscription("regular", "active"));
    queueTable("platform_membership_deletion_locks", ok({ member_id: MEMBER_ID }));
    queueTable("profiles", ok(null));
    queueTable("platform_checkout_attempts", ok(null));
    queueRpc("sync_platform_membership", ok("deleting"));
    queueRpc("release_platform_checkout_attempt", ok(null));

    await expect(
      syncPlatformSubscriptionById("sub_synthetic_platform", {
        id: "evt_after_deletion_synthetic",
        created: 1_800_000_000,
      }),
    ).resolves.toBe(false);

    expect(mocks.stripe.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_synthetic_platform",
    );
    expect(syncCalls()).toHaveLength(0);
    expect(
      mocks.operations.filter(
        (operation) => operation.kind === "rpc" && operation.name === "release_platform_checkout_attempt",
      ),
    ).toEqual([
      {
        kind: "rpc",
        name: "release_platform_checkout_attempt",
        args: {
          target_member_id: MEMBER_ID,
          target_request_id: REQUEST_ID,
          target_session_id: null,
          target_require_session_match: false,
        },
      },
    ]);
  });
});

describe("confirmation and portal reconciliation", () => {
  it("verifies checkout ownership before synchronizing the returned subscription", async () => {
    const session = {
      id: "cs_platform_synthetic",
      mode: "subscription",
      status: "complete",
      payment_status: "paid",
      subscription: "sub_synthetic_platform",
      client_reference_id: MEMBER_ID,
      metadata: {
        kind: "platform_membership",
        member_id: MEMBER_ID,
        checkout_request_id: REQUEST_ID,
      },
    };
    queueCheckoutSessions(session);
    queueRevision(3);
    queueNotDeleting();
    queueStripeSubscriptions(subscription("premium", "active"));
    queueRpc("sync_platform_membership", ok("applied"));

    await expect(confirmPlatformCheckout(session.id, MEMBER_ID)).resolves.toBe(true);
    expect(mocks.stripe.checkout.sessions.retrieve).toHaveBeenCalledWith(session.id);
    expect(syncCalls()[0]).toMatchObject({
      target_member_id: MEMBER_ID,
      target_checkout_request_id: REQUEST_ID,
      target_event_created: null,
      target_event_id: null,
    });
    const operations = mocks.operations;
    const baselineIndex = operations.findIndex(
      (operation) => operation.kind === "from" && operation.table === "platform_memberships",
    );
    const subscriptionReadIndex = operations.findIndex(
      (operation) => operation.kind === "stripe" && operation.name === "subscriptions.retrieve",
    );
    expect(baselineIndex).toBeGreaterThanOrEqual(0);
    expect(baselineIndex).toBeLessThan(subscriptionReadIndex);
  });

  it("does not confirm a session whose client reference belongs to someone else", async () => {
    queueCheckoutSessions({
      id: "cs_platform_synthetic",
      mode: "subscription",
      status: "complete",
      payment_status: "paid",
      subscription: "sub_synthetic_platform",
      client_reference_id: OTHER_MEMBER_ID,
      metadata: {
        kind: "platform_membership",
        member_id: MEMBER_ID,
        checkout_request_id: REQUEST_ID,
      },
    });

    await expect(confirmPlatformCheckout("cs_platform_synthetic", MEMBER_ID)).resolves.toBe(false);
    expect(mocks.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(syncCalls()).toHaveLength(0);
  });

  it("reconciles portal state from a fresh subscription after a CAS conflict", async () => {
    queueTable(
      "platform_memberships",
      ok([billingRow("premium", "active")]),
      ok({ state_revision: 9 }),
      ok({ state_revision: 10 }),
    );
    queueTable("platform_test_entitlements", ok([]));
    queueTable("platform_checkout_attempts", ok(null));
    queueTable("platform_membership_deletion_locks", ok(null), ok(null), ok(null));
    queueTable("profiles", ok({ id: MEMBER_ID }), ok({ id: MEMBER_ID }));
    queueStripeSubscriptions(
      subscription("premium", "active"),
      subscription("regular", "canceled"),
    );
    queueRpc("sync_platform_membership", ok("conflict"), ok("applied"));

    await expect(reconcilePlatformMembership(MEMBER_ID)).resolves.toBe(true);
    expect(syncCalls().map((args) => args.target_expected_revision)).toEqual([9, 10]);
    expect(syncCalls().map((args) => args.target_status)).toEqual(["active", "canceled"]);
    expect(syncCalls().every((args) => args.target_event_created === null)).toBe(true);
    const operations = mocks.operations;
    const baselineIndex = operations.findIndex(
      (operation, index) =>
        index > 3 && operation.kind === "from" && operation.table === "platform_memberships",
    );
    const retrieveIndex = operations.findIndex(
      (operation) => operation.kind === "stripe" && operation.name === "subscriptions.retrieve",
    );
    expect(baselineIndex).toBeGreaterThanOrEqual(0);
    expect(baselineIndex).toBeLessThan(retrieveIndex);
  });
});

describe("platform checkout lifecycle", () => {
  it("returns a valid existing pending checkout instead of creating a duplicate", async () => {
    const expiresAt = reservationExpiry();
    queueEmptyBillingState();
    appendTable(
      "platform_checkout_attempts",
      ok(checkoutAttempt(expiresAt, "cs_existing_synthetic")),
    );
    queueRpc(
      "reserve_platform_checkout",
      ok({
        outcome: "pending",
        request_id: REQUEST_ID,
        stripe_session_id: "cs_existing_synthetic",
        expires_at: expiresAt,
        existing_tier: "regular",
      }),
    );
    queueCheckoutSessions({
      id: "cs_existing_synthetic",
      mode: "subscription",
      status: "open",
      url: "https://checkout.example/existing",
      client_reference_id: MEMBER_ID,
      metadata: {
        kind: "platform_membership",
        member_id: MEMBER_ID,
        tier: "regular",
        checkout_request_id: REQUEST_ID,
      },
    });

    await expect(
      createPlatformCheckoutSession({ id: MEMBER_ID, email: "synthetic@example.test" }, "regular"),
    ).resolves.toBe("https://checkout.example/existing");
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("expires a verified owned Stripe URL when the database rejects attachment", async () => {
    const expiresAt = reservationExpiry();
    queueEmptyBillingState();
    appendTable("platform_checkout_attempts", ok(checkoutAttempt(expiresAt)));
    appendTable("platform_checkout_attempts", ok(null));
    appendTable("platform_membership_deletion_locks", ok(null));
    queueTable("profiles", ok({ id: MEMBER_ID }));
    queueRpc(
      "reserve_platform_checkout",
      ok({
        outcome: "reserved",
        request_id: REQUEST_ID,
        stripe_session_id: null,
        expires_at: expiresAt,
      }),
    );
    queueRpc("attach_platform_checkout_session", ok(false));
    queueRpc("release_platform_checkout_attempt", ok(null));
    queueCheckoutSessions({
      id: "cs_created_synthetic",
      mode: "subscription",
      status: "open",
      url: "https://checkout.example/owned",
      client_reference_id: MEMBER_ID,
      metadata: {
        kind: "platform_membership",
        member_id: MEMBER_ID,
        checkout_request_id: REQUEST_ID,
      },
      expires_at: Math.floor(Date.parse(expiresAt) / 1000),
    });
    mocks.stripe.checkout.sessions.create.mockResolvedValueOnce(
      createdCheckoutSession(expiresAt),
    );

    await expect(createPlatformCheckoutSession(
      { id: MEMBER_ID, email: "synthetic@example.test" },
      "regular",
    )).rejects.toMatchObject({ code: "checkout_pending" });

    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith(
      "cs_created_synthetic",
    );
    expect(
      mocks.operations.filter(
        (operation) => operation.kind === "rpc" && operation.name === "release_platform_checkout_attempt",
      ),
    ).toEqual([
      {
        kind: "rpc",
        name: "release_platform_checkout_attempt",
        args: {
          target_member_id: MEMBER_ID,
          target_request_id: REQUEST_ID,
          target_session_id: "cs_created_synthetic",
          target_require_session_match: true,
        },
      },
    ]);
    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        expires_at: Math.floor(Date.parse(expiresAt) / 1000),
        metadata: expect.objectContaining({
          kind: "platform_membership",
          member_id: MEMBER_ID,
          checkout_request_id: REQUEST_ID,
        }),
      }),
      { idempotencyKey: `platform-membership-${MEMBER_ID}-${REQUEST_ID}` },
    );
  });

  it("expires a verified session when Stripe returns an expiry beyond the reservation", async () => {
    const expiresAt = reservationExpiry();
    queueEmptyBillingState();
    appendTable("platform_checkout_attempts", ok(checkoutAttempt(expiresAt)));
    queueRpc(
      "reserve_platform_checkout",
      ok({
        outcome: "reserved",
        request_id: REQUEST_ID,
        stripe_session_id: null,
        expires_at: expiresAt,
      }),
    );
    queueRpc("release_platform_checkout_session", ok(null));
    queueCheckoutSessions({
      id: "cs_created_synthetic",
      mode: "subscription",
      status: "open",
      url: "https://checkout.example/overlong",
      client_reference_id: MEMBER_ID,
      metadata: {
        kind: "platform_membership",
        member_id: MEMBER_ID,
        checkout_request_id: REQUEST_ID,
      },
    });
    mocks.stripe.checkout.sessions.create.mockResolvedValueOnce(
      createdCheckoutSession(expiresAt, {
        url: "https://checkout.example/overlong",
        expires_at: Math.floor(Date.parse(expiresAt) / 1000) + 60 * 60,
      }),
    );

    await expect(
      createPlatformCheckoutSession({ id: MEMBER_ID, email: "synthetic@example.test" }, "regular"),
    ).rejects.toMatchObject({ code: "checkout_failed" });
    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith(
      "cs_created_synthetic",
    );
    expect(mocks.operations.some((operation) => operation.kind === "rpc" && operation.name === "attach_platform_checkout_session")).toBe(false);
  });

  it("does not return a payable URL when deletion wins during Stripe session creation", async () => {
    const expiresAt = reservationExpiry();
    queueEmptyBillingState();
    appendTable("platform_checkout_attempts", ok(checkoutAttempt(expiresAt)));
    appendTable("platform_checkout_attempts", ok([checkoutAttempt(expiresAt)]));
    appendTable("platform_checkout_attempts", ok(null));
    appendTable("platform_memberships", ok([]));
    queueRpc(
      "reserve_platform_checkout",
      ok({
        outcome: "reserved",
        request_id: REQUEST_ID,
        stripe_session_id: null,
        expires_at: expiresAt,
      }),
    );
    queueRpc("lock_platform_membership_account_for_deletion", ok(null));
    queueRpc("attach_platform_checkout_session", ok(false));
    queueRpc("release_platform_checkout_session", ok(null));

    let startStripeCreate: (() => void) | undefined;
    let resolveStripeCreate: ((session: unknown) => void) | undefined;
    const stripeCreateStarted = new Promise<void>((resolve) => {
      startStripeCreate = resolve;
    });
    mocks.stripe.checkout.sessions.create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStripeCreate = resolve;
          startStripeCreate?.();
        }),
    );

    const createPromise = createPlatformCheckoutSession(
      { id: MEMBER_ID, email: "synthetic@example.test" },
      "regular",
    );
    await stripeCreateStarted;
    await expect(cancelAllPlatformMemberships(MEMBER_ID)).rejects.toMatchObject({
      code: "checkout_pending",
    });
    queueCheckoutSessions({
      id: "cs_created_synthetic",
      mode: "subscription",
      status: "open",
      url: "https://checkout.example/must-expire",
      client_reference_id: MEMBER_ID,
      metadata: {
        kind: "platform_membership",
        member_id: MEMBER_ID,
        checkout_request_id: REQUEST_ID,
      },
    });
    resolveStripeCreate?.(
      createdCheckoutSession(expiresAt, { url: "https://checkout.example/must-expire" }),
    );

    await expect(createPromise).rejects.toMatchObject({ code: "account_deleting" });
    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith(
      "cs_created_synthetic",
    );
    expect(mocks.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(
      mocks.operations.some(
        (operation) => operation.kind === "rpc" && operation.name === "unlock_platform_membership_account_for_deletion",
      ),
    ).toBe(false);
    const operations = mocks.operations;
    const deletionLock = operations.findIndex(
      (operation) => operation.kind === "rpc" && operation.name === "lock_platform_membership_account_for_deletion",
    );
    const attach = operations.findIndex(
      (operation) => operation.kind === "rpc" && operation.name === "attach_platform_checkout_session",
    );
    expect(deletionLock).toBeGreaterThanOrEqual(0);
    expect(deletionLock).toBeLessThan(attach);
  });

  it("cancels live subscriptions and releases only the attached session during account deletion", async () => {
    queueRpc("lock_platform_membership_account_for_deletion", ok(null));
    queueTable("platform_checkout_attempts", ok([
      checkoutAttempt(
        new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        "cs_old_synthetic",
      ),
      checkoutAttempt(
        new Date(Date.now() - 60 * 1000).toISOString(),
        null,
        NEXT_REQUEST_ID,
      ),
    ]));
    queueTable("platform_memberships", ok([
      {
        stripe_subscription_id: "sub_synthetic_platform",
        stripe_customer_id: "cus_synthetic_platform",
        status: "active",
      },
    ]));
    queueCheckoutSessions({
      id: "cs_old_synthetic",
      mode: "subscription",
      status: "open",
      client_reference_id: MEMBER_ID,
      metadata: {
        kind: "platform_membership",
        member_id: MEMBER_ID,
        checkout_request_id: REQUEST_ID,
        tier: "regular",
      },
    });
    queueStripeSubscriptions(subscription("premium", "active"));
    queueRpc(
      "release_platform_checkout_attempt",
      ok(true),
      ok(true),
    );

    await expect(cancelAllPlatformMemberships(MEMBER_ID)).resolves.toBeUndefined();

    expect(mocks.stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_old_synthetic");
    expect(mocks.stripe.subscriptions.cancel).toHaveBeenCalledWith(
      "sub_synthetic_platform",
    );
    expect(
      mocks.operations.filter(
        (operation) => operation.kind === "rpc" && operation.name === "release_platform_checkout_attempt",
      ),
    ).toEqual([
      {
        kind: "rpc",
        name: "release_platform_checkout_attempt",
        args: {
          target_member_id: MEMBER_ID,
          target_request_id: REQUEST_ID,
          target_session_id: "cs_old_synthetic",
          target_require_session_match: true,
        },
      },
      {
        kind: "rpc",
        name: "release_platform_checkout_attempt",
        args: {
          target_member_id: MEMBER_ID,
          target_request_id: NEXT_REQUEST_ID,
          target_session_id: null,
          target_require_session_match: true,
        },
      },
    ]);
  });

  it("fails closed when Stripe returns a price that does not match the configured tier", async () => {
    mocks.stripe.prices.retrieve.mockResolvedValueOnce({
      ...price("regular"),
      unit_amount: 100,
    });

    await expect(
      createPlatformCheckoutSession({ id: MEMBER_ID, email: "synthetic@example.test" }, "regular"),
    ).rejects.toMatchObject({ code: "invalid_price" });
    expect(mocks.operations.some((operation) => operation.kind === "rpc")).toBe(false);
    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

describe("completed checkout race recovery", () => {
  it("reconciles an expired bound Checkout that completed before expiration instead of opening another", async () => {
    const expiredAt = new Date(Date.now() - 60 * 1000).toISOString();
    queueEmptyBillingState();
    appendTable(
      "platform_checkout_attempts",
      ok(checkoutAttempt(expiredAt, "cs_expired_bound_synthetic")),
    );
    appendTable("platform_checkout_attempts", ok(null));
    appendTable("platform_memberships", ok({ state_revision: 11 }));
    appendTable("platform_memberships", ok([billingRow("regular", "active")]));
    appendTable("platform_test_entitlements", ok([]));
    appendTable("platform_checkout_attempts", ok(null));
    appendTable("platform_membership_deletion_locks", ok(null), ok(null));
    queueTable("profiles", ok({ id: MEMBER_ID }));
    queueRpc(
      "reserve_platform_checkout",
      ok({
        outcome: "pending",
        request_id: REQUEST_ID,
        stripe_session_id: "cs_expired_bound_synthetic",
        expires_at: expiredAt,
        existing_tier: "regular",
      }),
    );
    queueRpc("sync_platform_membership", ok("applied"));
    const paidSession = {
      id: "cs_expired_bound_synthetic",
      created: Math.floor(Date.parse(expiredAt) / 1000) - 60 * 60,
      mode: "subscription",
      status: "complete",
      payment_status: "paid",
      subscription: "sub_synthetic_platform",
      client_reference_id: MEMBER_ID,
      metadata: {
        kind: "platform_membership",
        member_id: MEMBER_ID,
        tier: "regular",
        checkout_request_id: REQUEST_ID,
      },
      expires_at: Math.floor(Date.parse(expiredAt) / 1000),
      url: null,
    };
    queueCheckoutSessions(paidSession, paidSession);
    queueStripeSubscriptions(subscription("regular", "active"));

    await expect(
      createPlatformCheckoutSession(
        { id: MEMBER_ID, email: "synthetic@example.test" },
        "regular",
      ),
    ).rejects.toMatchObject({ code: "active_membership" });

    expect(mocks.stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(syncCalls()).toHaveLength(1);
    expect(syncCalls()[0]).toMatchObject({
      target_member_id: MEMBER_ID,
      target_checkout_request_id: REQUEST_ID,
      target_tier: "regular",
      target_status: "active",
    });
  });

  it("preserves a paid shared session when a delayed idempotent create loses attachment to the webhook", async () => {
    const expiresAt = reservationExpiry();
    queueEmptyBillingState();
    appendTable("platform_memberships", ok([]));
    appendTable("platform_memberships", ok({ state_revision: 7 }));
    appendTable("platform_memberships", ok({ state_revision: 8 }));
    appendTable("platform_memberships", ok({ state_revision: 9 }));
    appendTable("platform_memberships", ok([billingRow("regular", "active")]));
    appendTable("platform_test_entitlements", ok([]), ok([]), ok([]));
    appendTable(
      "platform_checkout_attempts",
      ok(checkoutAttempt(expiresAt)),
      ok(null),
      ok(checkoutAttempt(expiresAt)),
      ok(null),
      ok(null),
      ok(null),
    );
    appendTable(
      "platform_membership_deletion_locks",
      ok(null),
      ok(null),
      ok(null),
      ok(null),
      ok(null),
      ok(null),
    );
    queueTable(
      "profiles",
      ok({ id: MEMBER_ID }),
      ok({ id: MEMBER_ID }),
      ok({ id: MEMBER_ID }),
      ok({ id: MEMBER_ID }),
    );
    queueRpc(
      "reserve_platform_checkout",
      ok({
        outcome: "reserved",
        request_id: REQUEST_ID,
        stripe_session_id: null,
        expires_at: expiresAt,
      }),
      ok({
        outcome: "pending",
        request_id: REQUEST_ID,
        stripe_session_id: null,
        expires_at: expiresAt,
        existing_tier: "regular",
      }),
    );
    queueRpc(
      "attach_platform_checkout_session",
      ok(true),
      ok(false),
    );
    queueRpc(
      "sync_platform_membership",
      ok("applied"),
      ok("applied"),
      ok("applied"),
    );
    const openSession = {
      id: "cs_shared_idempotent_synthetic",
      mode: "subscription",
      status: "open",
      payment_status: "unpaid",
      subscription: null,
      client_reference_id: MEMBER_ID,
      metadata: {
        kind: "platform_membership",
        member_id: MEMBER_ID,
        tier: "regular",
        checkout_request_id: REQUEST_ID,
      },
      expires_at: Math.floor(Date.parse(expiresAt) / 1000),
      url: "https://checkout.example/shared-session",
    };
    const paidSession = {
      ...openSession,
      status: "complete",
      payment_status: "paid",
      subscription: "sub_synthetic_platform",
    };
    queueStripeSubscriptions(
      subscription("regular", "active"),
      subscription("regular", "active"),
      subscription("regular", "active"),
    );
    queueCheckoutSessions(paidSession, paidSession);

    let startFirstCreate: (() => void) | undefined;
    let startDelayedCreate: (() => void) | undefined;
    let resolveFirstCreate: ((session: unknown) => void) | undefined;
    let resolveDelayedCreate: ((session: unknown) => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      startFirstCreate = resolve;
    });
    const delayedStarted = new Promise<void>((resolve) => {
      startDelayedCreate = resolve;
    });
    mocks.stripe.checkout.sessions.create
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstCreate = resolve;
            startFirstCreate?.();
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveDelayedCreate = resolve;
            startDelayedCreate?.();
          }),
      );

    const firstRequest = createPlatformCheckoutSession(
      { id: MEMBER_ID, email: "synthetic@example.test" },
      "regular",
    );
    await Promise.race([
      firstStarted,
      firstRequest.then(
        () => Promise.reject(new Error("First create finished before its Stripe call started.")),
        (error: unknown) => Promise.reject(error),
      ),
    ]);
    const delayedRequest = createPlatformCheckoutSession(
      { id: MEMBER_ID, email: "synthetic@example.test" },
      "regular",
    );
    await Promise.race([
      delayedStarted,
      delayedRequest.then(
        () => Promise.reject(new Error("Delayed create finished before its Stripe call started.")),
        (error: unknown) => Promise.reject(error),
      ),
    ]);

    resolveFirstCreate?.(openSession);
    await expect(firstRequest).resolves.toBe(openSession.url);

    // This sync models the signed paid subscription event. Applying it removes the exact pending
    // checkout attempt before the second idempotent create response reaches its attach step.
    await expect(
      syncPlatformSubscriptionById("sub_synthetic_platform", {
        id: "evt_paid_shared_synthetic",
        created: 1_800_000_000,
      }),
    ).resolves.toBe(true);

    // Stripe returns the original open idempotency response to B even though the paid webhook has
    // completed this same session. Its subsequent fresh retrieve must observe the completed state.
    resolveDelayedCreate?.(openSession);
    await expect(delayedRequest).rejects.toMatchObject({
      code: "active_membership",
    });

    expect(mocks.stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
    const idempotencyKeys = mocks.stripe.checkout.sessions.create.mock.calls.map(
      ([, options]) => options.idempotencyKey,
    );
    expect(idempotencyKeys).toEqual([
      `platform-membership-${MEMBER_ID}-${REQUEST_ID}`,
      `platform-membership-${MEMBER_ID}-${REQUEST_ID}`,
    ]);
    expect(
      mocks.operations.filter(
        (operation) => operation.kind === "rpc" && operation.name === "attach_platform_checkout_session",
      ),
    ).toHaveLength(2);
    expect(syncCalls().length).toBeGreaterThanOrEqual(2);
    expect(syncCalls().every((args) => args.target_status === "active")).toBe(true);
    expect(mocks.stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    expect(mocks.stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });
});
