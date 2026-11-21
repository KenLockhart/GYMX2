import { describe, expect, it, vi } from "vitest";
import { loadAllAdminUsers, PricingCandidateSchema, normalizePricingCandidate, pricingCandidateDigest, readVisibleCompRevocationEvents, samePricingCandidate, toPricingAdminDashboard } from "./pricing-admin-server";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const pendingCandidate = {
  status: "pricing_pending" as const,
  payer: "coach" as const,
  currency: "USD",
  display_name: "Form Coach",
  description: "",
  marketing_copy: "",
  trial_days: 0,
  trial_assessments: 0,
  billing_model: null,
  price_options: [],
};

const livePacks = {
  ...pendingCandidate,
  status: "live" as const,
  billing_model: "per_assessment" as const,
  price_options: [
    { price_key: "pack_3", amount_cents: 1200, currency: "USD", interval: null, credits_per_pack: 3 },
    { price_key: "pack_8", amount_cents: 2800, currency: "USD", interval: null, credits_per_pack: 8 },
  ],
};

describe("admin Form Coach pricing candidate", () => {
  it("accepts the safe pending default and provider-free live pack options", () => {
    expect(PricingCandidateSchema.parse(pendingCandidate)).toMatchObject({ status: "pricing_pending", payer: "coach", price_options: [] });
    expect(PricingCandidateSchema.parse(livePacks).price_options).toHaveLength(2);
  });

  it("enforces PostgreSQL integer, pack credit, shape, duplicate-key, and billing compatibility bounds", () => {
    const option = livePacks.price_options[0];
    for (const invalid of [
      { ...livePacks, price_options: [{ ...option, amount_cents: 2_147_483_648 }] },
      { ...livePacks, price_options: [{ ...option, amount_cents: 1.5 }] },
      { ...livePacks, price_options: [{ ...option, credits_per_pack: 1_000_001 }] },
      { ...livePacks, price_options: [{ ...option, currency: "EUR" }] },
      { ...livePacks, price_options: [{ ...option, stripe_price_id: "price_client_supplied" }] },
      { ...livePacks, price_options: [option, { ...option }] },
      { ...pendingCandidate, status: "disabled", billing_model: "subscription", price_options: [] },
      { ...livePacks, billing_model: "subscription" },
    ]) {
      expect(PricingCandidateSchema.safeParse(invalid).success).toBe(false);
    }
    expect(PricingCandidateSchema.safeParse({
      ...livePacks,
      price_options: [{ ...option, amount_cents: 2_147_483_647, credits_per_pack: 1_000_000 }],
    }).success).toBe(true);
  });

  it("normalizes option ordering and produces one digest for an exact retry", () => {
    const forward = normalizePricingCandidate(livePacks);
    const reverse = normalizePricingCandidate({ ...livePacks, price_options: [...livePacks.price_options].reverse() });
    expect(forward.price_options.map((option) => option.price_key)).toEqual(["pack_3", "pack_8"]);
    expect(pricingCandidateDigest(forward)).toBe(pricingCandidateDigest(reverse));
    expect(samePricingCandidate({ ...livePacks, price_options: [...livePacks.price_options].reverse() }, forward)).toBe(true);
    expect(samePricingCandidate({ ...livePacks, payer: "member" }, forward)).toBe(false);
  });
});

describe("admin pricing DTO projection", () => {
  it("keeps only approved admin fields and binds comp revocation to Form Coach grants", () => {
    const dashboard = toPricingAdminDashboard({
      current: { feature_key: "form_coach", revision: 2 },
      revisions: [{ feature_key: "form_coach", revision: 2, status: "live", payer: "coach", billing_model: "per_assessment", currency: "USD", display_name: "Form Coach", description: "", marketing_copy: "", trial_days: 0, trial_assessments: 0, created_at: "2026-11-19T00:00:00Z", stripe_product_id: "prod_secret" }],
      options: [{ revision: 2, price_key: "pack_3", amount_cents: 1500, currency: "USD", interval: null, credits_per_pack: 3, stripe_price_id: "price_secret" }],
      changes: [{ revision: 2, previous_revision: 1, changed_by: "admin-id", recorded_at: "2026-11-19T00:00:00Z", request_digest: "digest_secret" }],
      syncRequests: [{ request_id: "sync-private-id", expected_revision: 1, published_revision: 2, state: "cas_applied", updated_at: "2026-11-19T00:00:00Z", candidate_payload: { stripe_price_id: "payload_secret" }, request_digest: "digest_secret" }],
      syncObjects: [{ request_id: "sync-private-id", object_kind: "price", price_key: "pack_3", state: "verified", provider_object_id: "price_private" }],
      grants: [
        { id: "grant-form", feature_key: "form_coach", grant_kind: "comp", user_id: "user-1", starts_at: "2026-11-19T00:00:00Z", expires_at: null, reason: "Approved review", granted_by: "admin-1", granted_at: "2026-11-19T00:00:00Z", stripe_customer_id: "not-allowed" },
        { id: "grant-other", feature_key: "other_feature", grant_kind: "comp", user_id: "user-2", starts_at: "2026-11-19T00:00:00Z", expires_at: null, reason: "Other", granted_at: "2026-11-19T00:00:00Z" },
      ],
      grantEvents: [{ grant_id: "grant-form", action: "revoked", actor_id: "admin-1", recorded_at: "2026-11-20T00:00:00Z", provider_object_id: "not-allowed" }],
      accounts: [
        { id: "user-1", display_name: "Rae Coach", email: "rae@example.test" },
        { id: "admin-1", display_name: "Site Admin", email: "admin@example.test" },
      ],
      legacyContractCount: 4,
      moveStates: [{ request_id: "move-private-id", state: "reserved", stripe_subscription_id: "sub_private" }],
    });

    expect(dashboard.current?.priceOptions[0]).toEqual({ priceKey: "pack_3", amountCents: 1500, currency: "USD", interval: null, creditsPerPack: 3 });
    expect(dashboard.syncRequests[0]).toMatchObject({ requestId: "sync-private-id", expectedRevision: 1, state: "cas_applied" });
    expect(dashboard.comps).toHaveLength(1);
    expect(dashboard.comps[0]).toMatchObject({ id: "grant-form", recipientName: "Rae Coach", recipientEmail: "rae@example.test", grantedByName: "Site Admin", revoked: true, revokedAt: "2026-11-20T00:00:00Z", revokedByName: "Site Admin" });
    expect(dashboard.moveStateCounts).toEqual({ reserved: 1 });
    const serialized = JSON.stringify(dashboard);
    for (const forbidden of ["prod_secret", "price_secret", "digest_secret", "payload_secret", "price_private", "not-allowed", "move-private-id", "sub_private", "user-1", "admin-1"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("checks authorization before creating the service client for sensitive reads", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("redirect"));
    const { loadPricingAdminDashboard } = await import("./pricing-admin-server");
    await expect(loadPricingAdminDashboard()).rejects.toThrow("redirect");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("does not label comp accounts deleted when the account-label read failed", () => {
    const dashboard = toPricingAdminDashboard({
      current: null,
      revisions: [],
      options: [],
      changes: [],
      syncRequests: [],
      syncObjects: [],
      grants: [{ id: "grant-1", feature_key: "form_coach", grant_kind: "comp", user_id: "user-1", starts_at: "2026-11-19T00:00:00Z", granted_at: "2026-11-19T00:00:00Z", granted_by: "admin-1" }],
      grantEvents: [],
      accounts: null,
      legacyContractCount: 0,
      moveStates: [],
      readErrors: ["comp account labels"],
    });

    expect(dashboard.comps[0]).toMatchObject({ recipientName: "", recipientDeleted: false, grantedByName: "" });
  });

  it("paginates the authorized admin user RPC beyond the API row cap with a stable ID order", async () => {
    const users = Array.from({ length: 1_205 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
      display_name: `User ${index}`,
      email: `user${index}@example.test`,
    }));
    let rpcCalls = 0;
    let orderColumn = "";
    let ascending: boolean | undefined;
    const rpc = () => {
      rpcCalls += 1;
      let start = 0;
      let end = 0;
      type Builder = {
        order: (column: string, options: { ascending?: boolean }) => Builder;
        range: (from: number, to: number) => Builder;
        then: (resolve: (value: unknown) => unknown) => Promise<unknown>;
      };
      const builder: Builder = {
        order: (column, options) => {
          orderColumn = column;
          ascending = options.ascending;
          return builder;
        },
        range: (from, to) => {
          start = from;
          end = Math.min(to, from + 99);
          return builder;
        },
        then: (resolve) => Promise.resolve({ data: users.slice(start, end + 1), error: null, count: users.length }).then(resolve),
      };
      return builder;
    };
    const session = { rpc } as unknown as Parameters<typeof loadAllAdminUsers>[0];

    const result = await loadAllAdminUsers(session);
    expect(result).toHaveLength(1_205);
    expect(result[result.length - 1]?.display_name).toBe("User 1204");
    expect(rpcCalls).toBe(13);
    expect({ orderColumn, ascending }).toEqual({ orderColumn: "id", ascending: true });
  });

  it("fails closed when a paginated user-list response is incomplete", async () => {
    const rpc = () => {
      let start = 0;
      type Builder = {
        order: () => Builder;
        range: (from: number, to: number) => Builder;
        then: (resolve: (value: unknown) => unknown) => Promise<unknown>;
      };
      const builder: Builder = {
        order: () => builder,
        range: (from) => {
          start = from;
          return builder;
        },
        then: (resolve) => Promise.resolve({ data: start === 0 ? [{ id: "00000000-0000-4000-8000-000000000001" }] : [], error: null, count: 1_001 }).then(resolve),
      };
      return builder;
    };
    const session = { rpc } as unknown as Parameters<typeof loadAllAdminUsers>[0];
    await expect(loadAllAdminUsers(session)).rejects.toThrow("incomplete page");
  });

  it("fetches old visible grant revocations even when unrelated events precede them globally", async () => {
    const visibleGrant = { id: "visible-grant", feature_key: "form_coach", grant_kind: "comp" };
    const unrelatedEvents = Array.from({ length: 100 }, (_, index) => ({
      grant_id: `unrelated-${index}`,
      action: "revoked",
      actor_id: "other-admin",
      recorded_at: "2026-11-20T00:00:00Z",
    }));
    const oldVisibleEvent = { grant_id: visibleGrant.id, action: "revoked", actor_id: "admin-1", recorded_at: "2026-11-01T00:00:00Z" };
    let selectedGrantIds: string[] = [];
    const query = {
      select: () => query,
      eq: () => query,
      in: (_column: string, ids: string[]) => {
        selectedGrantIds = ids;
        const result = [oldVisibleEvent, ...unrelatedEvents].filter((event) => ids.includes(event.grant_id));
        return Promise.resolve({ data: result, error: null });
      },
    };
    const db = { from: () => query } as unknown as ReturnType<typeof createAdminClient>;

    const events = await readVisibleCompRevocationEvents(db, [visibleGrant]);
    const dashboard = toPricingAdminDashboard({
      current: null,
      revisions: [],
      options: [],
      changes: [],
      syncRequests: [],
      syncObjects: [],
      grants: [{ ...visibleGrant, user_id: "user-1", starts_at: "2026-11-01T00:00:00Z", granted_at: "2026-11-01T00:00:00Z" }],
      grantEvents: events,
      accounts: [],
      legacyContractCount: 0,
      moveStates: [],
    });

    expect(selectedGrantIds).toEqual([visibleGrant.id]);
    expect(events).toHaveLength(1);
    expect(dashboard.comps[0]).toMatchObject({ revoked: true, revokedAt: oldVisibleEvent.recorded_at });
  });
});
