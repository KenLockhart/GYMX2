import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizePricingCandidate, pricingCandidateDigest } from "@/lib/form-coach/pricing-admin-server";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  adminDb: { from: vi.fn() },
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { grantFeatureComp, revokeFeatureComp, saveFeaturePricingRevision, searchFeatureCompRecipients } from "./actions";

const uuid = "2e03ea57-5212-4f2e-8a48-e421d2c959c3";
const adminId = "1f03ea57-5212-4f2e-8a48-e421d2c959c3";
const candidateInput = {
  status: "pricing_pending",
  payer: "coach",
  currency: "USD",
  display_name: "Form Coach",
  description: "",
  marketing_copy: "",
  trial_days: 0,
  trial_assessments: 0,
  billing_model: null,
  price_options: [],
};
const candidate = normalizePricingCandidate(candidateInput);

function pricingForm(overrides: { requestId?: string; expectedRevision?: number; candidate?: unknown } = {}) {
  const form = new FormData();
  form.set("request_id", overrides.requestId ?? uuid);
  form.set("expected_revision", String(overrides.expectedRevision ?? 1));
  form.set("candidate_json", JSON.stringify(overrides.candidate ?? candidate));
  return form;
}

function setLookupQueue(queue: Array<Record<string, unknown> | null>) {
  mocks.adminDb.from.mockImplementation(() => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data: queue.shift() ?? null, error: null }),
    };
    return builder;
  });
}

function setAdminUserPages(users: Array<Record<string, unknown>>, serverRowCap = 500) {
  mocks.rpc.mockImplementation(() => {
    let start = 0;
    let end = 0;
    type Builder = {
      order: () => Builder;
      range: (from: number, to: number) => Builder;
      then: (resolve: (value: unknown) => unknown) => Promise<unknown>;
    };
    const builder: Builder = {
      order: () => builder,
      range: (from, to) => {
        start = from;
        end = Math.min(to, from + serverRowCap - 1);
        return builder;
      },
      then: (resolve) => Promise.resolve({ data: users.slice(start, end + 1), error: null, count: users.length }).then(resolve),
    };
    return builder;
  });
}

function savedRequest(overrides: Record<string, unknown> = {}) {
  return {
    request_id: uuid,
    feature_key: "form_coach",
    expected_revision: 1,
    requested_by: adminId,
    request_digest: pricingCandidateDigest(candidate),
    candidate_payload: candidate,
    state: "reserved",
    published_revision: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ profile: { id: adminId, role: "admin" } });
  mocks.createAdminClient.mockReturnValue(mocks.adminDb);
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
});

describe("Form Coach pricing actions", () => {
  it("reconciles a lost publish response through the exact existing request", async () => {
    setLookupQueue([savedRequest({ state: "cas_applied", published_revision: 2 })]);
    mocks.rpc.mockResolvedValue({ data: [{ outcome: "already_applied", published_revision: 2 }], error: null });

    await expect(saveFeaturePricingRevision({}, pricingForm())).resolves.toEqual({ status: "already_applied" });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("admin_publish_feature_pricing_sync", {
      p_request_id: uuid,
      p_expected_revision: 1,
    });
  });

  it("reports an already applied live request from its persisted revision without reserving again", async () => {
    const live = normalizePricingCandidate({
      ...candidateInput,
      status: "live",
      billing_model: "per_assessment",
      price_options: [{ price_key: "pack_3", amount_cents: 500, currency: "USD", interval: null, credits_per_pack: 3 }],
    });
    const liveRow = savedRequest({
      request_digest: pricingCandidateDigest(live),
      candidate_payload: live,
      state: "cas_applied",
      published_revision: 2,
    });
    setLookupQueue([liveRow]);

    await expect(saveFeaturePricingRevision({}, pricingForm({ candidate: live }))).resolves.toEqual({ status: "already_applied" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a request UUID reused with changed candidate or another admin identity", async () => {
    setLookupQueue([savedRequest()]);
    const changed = { ...candidateInput, description: "Changed after reserve" };
    await expect(saveFeaturePricingRevision({}, pricingForm({ candidate: changed }))).resolves.toMatchObject({ status: "error", errorCode: "request_id_reused" });
    expect(mocks.rpc).not.toHaveBeenCalled();

    setLookupQueue([savedRequest({ requested_by: uuid })]);
    await expect(saveFeaturePricingRevision({}, pricingForm())).resolves.toMatchObject({ status: "error", errorCode: "request_id_reused" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("reconciles an exact concurrent request after a CAS result instead of creating another UUID", async () => {
    setLookupQueue([null, savedRequest()]);
    mocks.rpc
      .mockResolvedValueOnce({ data: [{ outcome: "cas_stale" }], error: null })
      .mockResolvedValueOnce({ data: [{ outcome: "applied", published_revision: 2 }], error: null });

    await expect(saveFeaturePricingRevision({}, pricingForm())).resolves.toEqual({ status: "saved" });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "admin_reserve_feature_pricing_sync",
      "admin_publish_feature_pricing_sync",
    ]);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_request_id: uuid, p_expected_revision: 1 });
    expect(mocks.rpc.mock.calls[1][1]).toMatchObject({ p_request_id: uuid, p_expected_revision: 1 });
  });

  it("reserves a live candidate without publishing it or calling a provider", async () => {
    setLookupQueue([null]);
    const live = {
      ...candidateInput,
      status: "live",
      billing_model: "per_assessment",
      price_options: [{ price_key: "pack_3", amount_cents: 500, currency: "USD", interval: null, credits_per_pack: 3 }],
    };
    mocks.rpc.mockResolvedValue({ data: [{ outcome: "reserved", request_id: uuid, state: "reserved" }], error: null });
    await expect(saveFeaturePricingRevision({}, pricingForm({ candidate: live }))).resolves.toEqual({ status: "reserved" });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("admin_reserve_feature_pricing_sync", expect.objectContaining({ p_request_id: uuid }));
  });

  it("rejects invalid cents and client-supplied provider IDs before touching the database", async () => {
    const bad = {
      ...candidateInput,
      status: "live",
      billing_model: "per_assessment",
      price_options: [{ price_key: "pack_3", amount_cents: 2_147_483_648, currency: "USD", interval: null, credits_per_pack: 3, stripe_price_id: "price_client" }],
    };
    await expect(saveFeaturePricingRevision({}, pricingForm({ candidate: bad }))).resolves.toMatchObject({ status: "error", errorCode: "invalid_input" });
    expect(mocks.adminDb.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("searches recipients by name or email and returns only matching allowlisted fields", async () => {
    setAdminUserPages([
        { id: uuid, display_name: "Rae Coach", email: "rae@example.test", role: "coach", created_at: "private", access_token: "private" },
        { id: adminId, display_name: "Other User", email: "other@example.test", role: "member" },
    ]);
    const form = new FormData();
    form.set("query", "RAE example.test");

    await expect(searchFeatureCompRecipients({}, form)).resolves.toEqual({
      status: "searched",
      recipients: [{ id: uuid, displayName: "Rae Coach", email: "rae@example.test", role: "coach" }],
    });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_list_users", {}, { count: "exact" });
  });

  it("caps recipient results at twenty and rejects a short query before reading users", async () => {
    setAdminUserPages(Array.from({ length: 25 }, (_, index) => ({
        id: `${index.toString().padStart(8, "0")}-0000-4000-8000-000000000000`,
        display_name: `Coach ${index}`,
        email: `coach${index}@example.test`,
        role: "coach",
      })));
    const query = new FormData();
    query.set("query", "coach");
    await expect(searchFeatureCompRecipients({}, query)).resolves.toMatchObject({ status: "searched", recipients: { length: 20 } });

    const short = new FormData();
    short.set("query", "x");
    await expect(searchFeatureCompRecipients({}, short)).resolves.toEqual({ status: "error", errorCode: "invalid_search", recipients: [] });
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("finds a recipient beyond the first thousand server rows", async () => {
    const users = Array.from({ length: 1_205 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
      display_name: index === 1_100 ? "Rae Far Down" : `Coach ${index}`,
      email: index === 1_100 ? "rae.deep@example.test" : `coach${index}@example.test`,
      role: "coach",
    }));
    setAdminUserPages(users, 100);
    const form = new FormData();
    form.set("query", "Rae deep");

    await expect(searchFeatureCompRecipients({}, form)).resolves.toEqual({
      status: "searched",
      recipients: [{ id: users[1_100].id, displayName: "Rae Far Down", email: "rae.deep@example.test", role: "coach" }],
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(13);
  });
});

describe("Form Coach comp actions", () => {
  it("normalizes explicit offset timestamps and keeps a repeated request id idempotent", async () => {
    const requestId = "3e03ea57-5212-4f2e-8a48-e421d2c959c3";
    const existing = {
      id: "4e03ea57-5212-4f2e-8a48-e421d2c959c3",
      feature_key: "form_coach",
      grant_kind: "comp",
      user_id: uuid,
      starts_at: "2026-11-19T17:00:00+00:00",
      expires_at: null,
      reason: "Access review",
      request_id: requestId,
    };
    const form = new FormData();
    form.set("request_id", requestId);
    form.set("user_id", uuid);
    form.set("starts_at", "2026-11-19T12:00:00-05:00");
    form.set("expires_at", "");
    form.set("reason", "Access review");

    setLookupQueue([null]);
    mocks.rpc.mockResolvedValueOnce({ data: existing.id, error: null });
    await expect(grantFeatureComp({}, form)).resolves.toEqual({ status: "granted" });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_grant_feature_comp", expect.objectContaining({
      p_user_id: uuid,
      p_starts_at: "2026-11-19T17:00:00.000Z",
      p_expires_at: null,
      p_reason: "Access review",
      p_request_id: requestId,
    }));

    setLookupQueue([existing]);
    await expect(grantFeatureComp({}, form)).resolves.toEqual({ status: "granted" });
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("rejects ambiguous timestamps and does not create a grant", async () => {
    const form = new FormData();
    form.set("request_id", uuid);
    form.set("user_id", adminId);
    form.set("starts_at", "2026-11-19T12:00:00");
    form.set("expires_at", "");
    form.set("reason", "Review");
    await expect(grantFeatureComp({}, form)).resolves.toMatchObject({ status: "error", errorCode: "invalid_comp" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("prevents the Form Coach revoke action from accepting another feature grant", async () => {
    setLookupQueue([{ id: uuid, feature_key: "other_feature", grant_kind: "comp" }]);
    const form = new FormData();
    form.set("grant_id", uuid);
    await expect(revokeFeatureComp({}, form)).resolves.toMatchObject({ status: "error", errorCode: "comp_not_found" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rechecks admin authorization independently in pricing, search, grant, and revoke actions", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("redirect"));
    const empty = new FormData();
    await expect(saveFeaturePricingRevision({}, empty)).rejects.toThrow("redirect");
    await expect(searchFeatureCompRecipients({}, empty)).rejects.toThrow("redirect");
    await expect(grantFeatureComp({}, empty)).rejects.toThrow("redirect");
    await expect(revokeFeatureComp({}, empty)).rejects.toThrow("redirect");
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(4);
    expect(mocks.adminDb.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
