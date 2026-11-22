import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticatedAccount: vi.fn(),
  requireCoach: vi.fn(),
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireAuthenticatedAccount: mocks.requireAuthenticatedAccount,
  requireCoach: mocks.requireCoach,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import {
  createFormCoachReferenceReadUrl,
  getFormCoachWorkflowDetail,
  listCoachFormCoachAssessments,
  listMyFormCoachAssessments,
} from "./workflow-server";
import {
  FORM_COACH_REFERENCE_SIGNED_URL_MAX_TTL_SECONDS,
  FORM_COACH_REFERENCE_SIGNING_RESERVE_SECONDS,
} from "./workflow-contracts";

const coachId = "f1000000-0000-4000-8000-000000000001";
const memberId = "f1000000-0000-4000-8000-000000000002";
const assessmentId = "f1000000-0000-4000-8000-000000000003";
const itemId = "f1000000-0000-4000-8000-000000000004";
const versionId = "f1000000-0000-4000-8000-000000000006";
const assetId = "f1000000-0000-4000-8000-000000000007";

function queuePage(page = 1) {
  return {
    rows: [{
      assessment_id: assessmentId,
      member_id: memberId,
      source_kind: "manual",
      program_title: null,
      sent_at: "2026-11-20T12:00:00.000Z",
      due_at: "2026-11-27T12:00:00.000Z",
      status: "sent",
      item_count: 1,
      finished_attempt_count: 0,
      allow_member_clip: false,
    }],
    page,
    has_more: false,
  };
}

function memberPage() {
  return {
    rows: [{
      assessment_id: assessmentId,
      source_kind: "manual",
      program_title: null,
      sent_at: "2026-11-20T12:00:00.000Z",
      due_at: "2026-11-27T12:00:00.000Z",
      status: "sent",
      item_count: 1,
      finished_attempt_count: 0,
    }],
    page: 1,
    has_more: false,
  };
}

function detail() {
  return {
    assessment_id: assessmentId,
    source_kind: "manual",
    program_title: null,
    sent_at: "2026-11-20T12:00:00.000Z",
    due_at: "2026-11-27T12:00:00.000Z",
    status: "sent",
    payer_role: "coach",
    can_attempt: false,
    allow_member_clip: true,
    member_id: memberId,
    items: [{
      item_id: itemId,
      ordinal: 1,
      item_key: "exercise_1",
      title: "Curl",
      exercise_key: "dumbbell_curl",
      required_reps: 8,
      pass_threshold: 75,
      cues_enabled: false,
      max_attempts: 2,
      can_start_new: false,
      can_resume: false,
      resume_clip_opt_in: null,
      attempts: [],
      latest_review: null,
      template: null,
    }],
  };
}

function asset(overrides: Record<string, unknown> = {}) {
  return {
    authorized_actor_id: coachId,
    authorized_role: "coach",
    assessment_id: assessmentId,
    item_id: itemId,
    template_id: "f1000000-0000-4000-8000-000000000005",
    template_version_id: versionId,
    asset_id: assetId,
    asset_owner_id: coachId,
    asset_key: "reference",
    bucket_id: "form-coach-reference",
    storage_path: `${coachId}/${versionId}/${assetId}.mp4`,
    content_sha256: "a".repeat(64),
    byte_size: 100,
    authorized_until: null,
    authorized_ttl_seconds: 600,
    ...overrides,
  };
}

function createUserClient(rpc: ReturnType<typeof vi.fn>) {
  return { rpc };
}

function createAdminDb(rpc: ReturnType<typeof vi.fn>, createSignedUrl = vi.fn()) {
  const from = vi.fn(() => ({ createSignedUrl }));
  return { rpc, storage: { from }, from, createSignedUrl };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCoach.mockResolvedValue({ profile: { id: coachId, role: "coach" } });
  mocks.requireAuthenticatedAccount.mockResolvedValue({ profile: { id: coachId, role: "coach" } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Form Coach workflow server boundary", () => {
  it("uses the authenticated coach RPC and validates its bounded page", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: queuePage(2), error: null });
    mocks.createClient.mockResolvedValue(createUserClient(rpc));

    await expect(listCoachFormCoachAssessments({ page: 2, pageSize: 50, status: "sent" }))
      .resolves.toMatchObject({ kind: "ready", value: queuePage(2) });
    expect(rpc).toHaveBeenCalledWith("list_coach_form_coach_assessments", {
      target_page: 2,
      target_page_size: 20,
      target_status: "sent",
    });
  });

  it("rejects invalid list parameters before auth or database work", async () => {
    await expect(listCoachFormCoachAssessments({ page: 0, pageSize: 10 }))
      .resolves.toEqual({ kind: "unavailable" });
    expect(mocks.requireCoach).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("uses the authenticated member list RPC with a bounded page size", async () => {
    mocks.requireAuthenticatedAccount.mockResolvedValue({ profile: { id: memberId, role: "member" } });
    const rpc = vi.fn().mockResolvedValue({ data: memberPage(), error: null });
    mocks.createClient.mockResolvedValue(createUserClient(rpc));

    await expect(listMyFormCoachAssessments({ page: 1, pageSize: 50 })).resolves.toMatchObject({
      kind: "ready",
      value: memberPage(),
    });
    expect(rpc).toHaveBeenCalledWith("list_my_form_coach_assessments", {
      target_page: 1,
      target_page_size: 20,
    });
    expect(mocks.requireAuthenticatedAccount).toHaveBeenCalledOnce();
  });

  it("rejects non-member inbox reads before database work and validates the member projection", async () => {
    await expect(listMyFormCoachAssessments()).resolves.toEqual({ kind: "not_authorized" });
    expect(mocks.createClient).not.toHaveBeenCalled();

    mocks.requireAuthenticatedAccount.mockResolvedValue({ profile: { id: memberId, role: "member" } });
    const rpc = vi.fn().mockResolvedValue({
      data: { ...memberPage(), rows: [{ ...memberPage().rows[0], member_email: "private@example.test" }] },
      error: null,
    });
    mocks.createClient.mockResolvedValue(createUserClient(rpc));
    await expect(listMyFormCoachAssessments()).resolves.toEqual({ kind: "unavailable" });
  });

  it("fails closed when the coach RPC errors or returns a widened DTO", async () => {
    const failedRpc = vi.fn().mockResolvedValue({ data: null, error: new Error("db unavailable") });
    mocks.createClient.mockResolvedValue(createUserClient(failedRpc));
    await expect(listCoachFormCoachAssessments()).resolves.toEqual({ kind: "unavailable" });

    const widenedRpc = vi.fn().mockResolvedValue({
      data: { ...queuePage(), rows: [{ ...queuePage().rows[0], payer_role: "admin" }] },
      error: null,
    });
    mocks.createClient.mockResolvedValue(createUserClient(widenedRpc));
    await expect(listCoachFormCoachAssessments()).resolves.toEqual({ kind: "unavailable" });
  });

  it("returns member or coach detail from only the authenticated detail RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: detail(), error: null });
    mocks.createClient.mockResolvedValue(createUserClient(rpc));

    await expect(getFormCoachWorkflowDetail(assessmentId)).resolves.toMatchObject({
      kind: "ready",
      value: { assessment_id: assessmentId, allow_member_clip: true, can_attempt: false },
    });
    expect(rpc).toHaveBeenCalledWith("get_form_coach_workflow_detail", {
      target_assessment_id: assessmentId,
    });
    expect(mocks.requireCoach).toHaveBeenCalledOnce();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("keeps authenticated member history available without an entitlement check", async () => {
    mocks.requireAuthenticatedAccount.mockResolvedValue({ profile: { id: memberId, role: "member" } });
    const { member_id: omittedMemberId, ...memberDetail } = detail();
    expect(omittedMemberId).toBe(memberId);
    const rpc = vi.fn().mockResolvedValue({ data: memberDetail, error: null });
    mocks.createClient.mockResolvedValue(createUserClient(rpc));

    await expect(getFormCoachWorkflowDetail(assessmentId, "member")).resolves.toMatchObject({
      kind: "ready",
      value: { assessment_id: assessmentId },
    });
    await expect(getFormCoachWorkflowDetail(assessmentId)).resolves.toMatchObject({ kind: "ready" });
    expect(mocks.requireAuthenticatedAccount).toHaveBeenCalledTimes(2);
    expect(mocks.requireCoach).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenNthCalledWith(1, "get_form_coach_workflow_detail", {
      target_assessment_id: assessmentId,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "get_form_coach_workflow_detail", {
      target_assessment_id: assessmentId,
    });
  });

  it.each([
    { actorRole: "member", expectedRole: "coach" },
    { actorRole: "coach", expectedRole: "member" },
  ] as const)("rejects a $actorRole actor on a $expectedRole detail route before RPC", async ({ actorRole, expectedRole }) => {
    mocks.requireAuthenticatedAccount.mockResolvedValue({
      profile: { id: actorRole === "member" ? memberId : coachId, role: actorRole },
    });

    await expect(getFormCoachWorkflowDetail(assessmentId, expectedRole)).resolves.toEqual({ kind: "not_authorized" });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.requireCoach).not.toHaveBeenCalled();
  });

  it("does not call a detail RPC for invalid IDs or an admin actor", async () => {
    await expect(getFormCoachWorkflowDetail("not-a-uuid")).resolves.toEqual({ kind: "not_authorized" });
    expect(mocks.requireAuthenticatedAccount).not.toHaveBeenCalled();

    mocks.requireAuthenticatedAccount.mockResolvedValue({ profile: { id: coachId, role: "admin" } });
    await expect(getFormCoachWorkflowDetail(assessmentId)).resolves.toEqual({ kind: "not_authorized" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("preserves not-found for an authorized ID while treating RPC and parse errors as unavailable", async () => {
    const missingRpc = vi.fn().mockResolvedValue({ data: null, error: null });
    mocks.createClient.mockResolvedValue(createUserClient(missingRpc));
    await expect(getFormCoachWorkflowDetail(assessmentId)).resolves.toEqual({ kind: "not_found" });

    const invalidRpc = vi.fn().mockResolvedValue({ data: { assessment_id: assessmentId }, error: null });
    mocks.createClient.mockResolvedValue(createUserClient(invalidRpc));
    await expect(getFormCoachWorkflowDetail(assessmentId)).resolves.toEqual({ kind: "unavailable" });

    const mismatchedRpc = vi.fn().mockResolvedValue({
      data: { ...detail(), assessment_id: "f1000000-0000-4000-8000-000000000099" },
      error: null,
    });
    mocks.createClient.mockResolvedValue(createUserClient(mismatchedRpc));
    await expect(getFormCoachWorkflowDetail(assessmentId)).resolves.toEqual({ kind: "unavailable" });
  });

  it("signs only the authorized descriptor's fixed bucket and exact database path", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: asset(), error: null });
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://storage.test/sign/private-reference?token=synthetic" },
      error: null,
    });
    const db = createAdminDb(rpc, createSignedUrl);
    mocks.createAdminClient.mockReturnValue(db);

    await expect(createFormCoachReferenceReadUrl(assessmentId, itemId)).resolves.toMatchObject({
      kind: "ready",
      value: { templateVersionId: versionId },
    });
    expect(rpc).toHaveBeenCalledWith("service_read_form_coach_reference_asset", {
      target_actor_id: coachId,
      target_assessment_id: assessmentId,
      target_item_id: itemId,
    });
    expect(db.from).toHaveBeenCalledOnce();
    expect(db.from).toHaveBeenCalledWith("form-coach-reference");
    expect(createSignedUrl).toHaveBeenCalledOnce();
    const ttlSeconds = createSignedUrl.mock.calls[0]?.[1];
    expect(ttlSeconds).toBeGreaterThan(0);
    expect(ttlSeconds).toBeLessThanOrEqual(600);
    expect(ttlSeconds).toBeLessThanOrEqual(FORM_COACH_REFERENCE_SIGNED_URL_MAX_TTL_SECONDS);
  });

  it.each([
    { wallClock: "1970-01-01T00:00:00.000Z", shiftMs: -7 * 24 * 60 * 60 * 1_000 },
    { wallClock: "2099-12-31T23:59:59.000Z", shiftMs: 7 * 24 * 60 * 60 * 1_000 },
  ])("uses the DB remaining-time budget when application wall-clock jumps from $wallClock", async ({
    wallClock,
    shiftMs,
  }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(wallClock));
    mocks.requireAuthenticatedAccount.mockResolvedValue({ profile: { id: memberId, role: "member" } });
    const createSignedUrl = vi.fn().mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(250);
      return { data: { signedUrl: "https://storage.test/signed" }, error: null };
    });
    const rpc = vi.fn().mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(1_250);
      vi.setSystemTime(new Date(Date.parse(wallClock) + shiftMs));
      return {
      data: asset({
        authorized_actor_id: memberId,
        authorized_role: "member",
        authorized_until: new Date(Date.parse(wallClock) + 30_000).toISOString(),
        authorized_ttl_seconds: 30,
      }),
      error: null,
      };
    });
    mocks.createAdminClient.mockReturnValue(createAdminDb(rpc, createSignedUrl));

    await expect(createFormCoachReferenceReadUrl(assessmentId, itemId)).resolves.toMatchObject({
      kind: "ready",
      value: { templateVersionId: versionId },
    });
    expect(createSignedUrl).toHaveBeenCalledWith(
      `${coachId}/${versionId}/${assetId}.mp4`,
      30 - 2 - FORM_COACH_REFERENCE_SIGNING_RESERVE_SECONDS,
    );
  });

  it("returns a URL after ordinary RPC and Storage latency when conservative budget remains", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T12:00:00.000Z"));
    mocks.requireAuthenticatedAccount.mockResolvedValue({ profile: { id: memberId, role: "member" } });
    const createSignedUrl = vi.fn().mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(1_200);
      return { data: { signedUrl: "https://storage.test/signed" }, error: null };
    });
    const rpc = vi.fn().mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(120);
      return {
        data: asset({
          authorized_actor_id: memberId,
          authorized_role: "member",
          authorized_until: "2026-11-20T12:10:00.000Z",
          authorized_ttl_seconds: 600,
        }),
        error: null,
      };
    });
    mocks.createAdminClient.mockReturnValue(createAdminDb(rpc, createSignedUrl));

    await expect(createFormCoachReferenceReadUrl(assessmentId, itemId)).resolves.toMatchObject({
      kind: "ready",
      value: { templateVersionId: versionId },
    });
    expect(createSignedUrl).toHaveBeenCalledWith(
      `${coachId}/${versionId}/${assetId}.mp4`,
      600 - 1 - FORM_COACH_REFERENCE_SIGNING_RESERVE_SECONDS,
    );
  });

  it("returns a coach URL after ordinary RPC and Storage latency with the shared signing reserve", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T12:00:00.000Z"));
    const createSignedUrl = vi.fn().mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(1_200);
      return { data: { signedUrl: "https://storage.test/signed" }, error: null };
    });
    const rpc = vi.fn().mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(120);
      return { data: asset({ authorized_ttl_seconds: 600 }), error: null };
    });
    mocks.createAdminClient.mockReturnValue(createAdminDb(rpc, createSignedUrl));

    await expect(createFormCoachReferenceReadUrl(assessmentId, itemId)).resolves.toMatchObject({
      kind: "ready",
      value: { templateVersionId: versionId },
    });
    expect(createSignedUrl).toHaveBeenCalledWith(
      `${coachId}/${versionId}/${assetId}.mp4`,
      600 - 1 - FORM_COACH_REFERENCE_SIGNING_RESERVE_SECONDS,
    );
  });

  it("does not return a signed URL when signing latency consumes the response-time budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T12:00:00.000Z"));
    mocks.requireAuthenticatedAccount.mockResolvedValue({ profile: { id: memberId, role: "member" } });
    const createSignedUrl = vi.fn().mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
      return { data: { signedUrl: "https://storage.test/signed" }, error: null };
    });
    const rpc = vi.fn().mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(100);
      return {
        data: asset({
          authorized_actor_id: memberId,
          authorized_role: "member",
          authorized_until: "2026-11-20T12:00:10.000Z",
          authorized_ttl_seconds: 10,
        }),
        error: null,
      };
    });
    mocks.createAdminClient.mockReturnValue(createAdminDb(rpc, createSignedUrl));

    await expect(createFormCoachReferenceReadUrl(assessmentId, itemId)).resolves.toEqual({ kind: "not_authorized" });
    expect(createSignedUrl).toHaveBeenCalledWith(`${coachId}/${versionId}/${assetId}.mp4`, 4);
  });

  it("refuses a near-zero DB budget before calling Storage", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T12:00:00.000Z"));
    const createSignedUrl = vi.fn();
    const rpc = vi.fn().mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(1);
      return { data: asset({ authorized_ttl_seconds: 1 }), error: null };
    });
    mocks.createAdminClient.mockReturnValue(createAdminDb(rpc, createSignedUrl));

    await expect(createFormCoachReferenceReadUrl(assessmentId, itemId)).resolves.toEqual({ kind: "not_authorized" });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("reserves signing margin for a zero-latency coach link under the 600-second maximum", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T12:00:00.000Z"));
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: "https://storage.test/signed" }, error: null });
    const rpc = vi.fn().mockResolvedValue({ data: asset(), error: null });
    mocks.createAdminClient.mockReturnValue(createAdminDb(rpc, createSignedUrl));

    await expect(createFormCoachReferenceReadUrl(assessmentId, itemId)).resolves.toMatchObject({
      kind: "ready",
    });
    expect(createSignedUrl).toHaveBeenCalledWith(
      `${coachId}/${versionId}/${assetId}.mp4`,
      FORM_COACH_REFERENCE_SIGNED_URL_MAX_TTL_SECONDS - FORM_COACH_REFERENCE_SIGNING_RESERVE_SECONDS,
    );
  });

  it("does not sign mismatched actors, malformed descriptors, or service RPC failures", async () => {
    const createSignedUrl = vi.fn();
    const rpc = vi.fn().mockResolvedValue({ data: asset({ authorized_actor_id: memberId }), error: null });
    mocks.createAdminClient.mockReturnValue(createAdminDb(rpc, createSignedUrl));
    await expect(createFormCoachReferenceReadUrl(assessmentId, itemId)).resolves.toEqual({ kind: "not_authorized" });
    expect(createSignedUrl).not.toHaveBeenCalled();

    rpc.mockResolvedValue({ data: asset({ storage_path: `${coachId}/${versionId}/../outside.mp4` }), error: null });
    await expect(createFormCoachReferenceReadUrl(assessmentId, itemId)).resolves.toEqual({ kind: "not_authorized" });
    expect(createSignedUrl).not.toHaveBeenCalled();

    rpc.mockResolvedValue({ data: null, error: new Error("no authorized asset") });
    await expect(createFormCoachReferenceReadUrl(assessmentId, itemId)).resolves.toEqual({ kind: "unavailable" });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("does not construct a service client for malformed IDs or admin accounts", async () => {
    await expect(createFormCoachReferenceReadUrl("bad", itemId)).resolves.toEqual({ kind: "not_authorized" });
    expect(mocks.requireAuthenticatedAccount).not.toHaveBeenCalled();

    mocks.requireAuthenticatedAccount.mockResolvedValue({ profile: { id: coachId, role: "admin" } });
    await expect(createFormCoachReferenceReadUrl(assessmentId, itemId)).resolves.toEqual({ kind: "not_authorized" });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
