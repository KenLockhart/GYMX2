import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCoachOrAdmin: vi.fn(),
  createAdminClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ requireCoachOrAdmin: mocks.requireCoachOrAdmin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import {
  createProgramPromotion,
  isProgramPaidAuthoringEnabled,
  loadProgramAuthoringSnapshot,
  publishProgramAuthoringDraft,
  publishProgramOfferPrice,
  saveProgramAuthoringDraft,
} from "./program-authoring-server";

const actorId = "f1000000-0000-4000-8000-000000000001";
const programId = "f2000000-0000-4000-8000-000000000002";
const contentId = "f3000000-0000-4000-8000-000000000003";
const offerId = "f4000000-0000-4000-8000-000000000004";
const draftId = "f5000000-0000-4000-8000-000000000005";
const requestId = "f6000000-0000-4000-8000-000000000006";
const videoId = "f7000000-0000-4000-8000-000000000007";

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    status: "ready",
    program_id: programId,
    published: false,
    platform_owned: false,
    current_content_version_id: contentId,
    current_offer_version_id: offerId,
    current_revision_kind: "current",
    current_lesson_count: 0,
    offer_kind: "free",
    list_price_cents: 0,
    currency: "usd",
    max_installments: 1,
    payout_ready: true,
    draft_id: null,
    draft_revision: null,
    draft_stale: false,
    lessons: [],
    ...overrides,
  };
}

function published(overrides: Record<string, unknown> = {}) {
  return {
    status: "published",
    program_id: programId,
    content_version_id: contentId,
    offer_version_id: offerId,
    free_snapshot_id: null,
    revision_number: 2,
    offer_number: 2,
    list_price_cents: 5000,
    currency: "usd",
    max_installments: 1,
    published: true,
    replayed: false,
    ...overrides,
  };
}

function saved(overrides: Record<string, unknown> = {}) {
  return {
    status: "saved",
    program_id: programId,
    draft_id: draftId,
    draft_revision: 1,
    base_content_version_id: contentId,
    base_offer_version_id: offerId,
    lesson_count: 1,
    ...overrides,
  };
}

function readyRpc(data: unknown) {
  mocks.rpc.mockResolvedValue({ data, error: null });
  mocks.createAdminClient.mockReturnValue({ rpc: mocks.rpc });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PROGRAM_PAID_AUTHORING_ENABLED;
  mocks.requireCoachOrAdmin.mockResolvedValue({ profile: { id: actorId, role: "coach" } });
});

describe("Program authoring server adapter", () => {
  it("keeps paid writes disabled by default and creates no privileged client", async () => {
    expect(isProgramPaidAuthoringEnabled()).toBe(false);
    await expect(saveProgramAuthoringDraft({})).resolves.toEqual({
      ok: false,
      reason: "feature_disabled",
    });
    await expect(publishProgramAuthoringDraft({})).resolves.toEqual({
      ok: false,
      reason: "feature_disabled",
    });
    await expect(publishProgramOfferPrice({})).resolves.toEqual({
      ok: false,
      reason: "feature_disabled",
    });
    await expect(createProgramPromotion({})).resolves.toEqual({
      ok: false,
      reason: "feature_disabled",
    });
    expect(mocks.requireCoachOrAdmin).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("authenticates an eligible owner before reading with the service client", async () => {
    readyRpc(snapshot());
    await expect(loadProgramAuthoringSnapshot({ programId })).resolves.toEqual({
      ok: true,
      value: {
        programId,
        published: false,
        platformOwned: false,
        currentContentVersionId: contentId,
        currentOfferVersionId: offerId,
        currentRevisionKind: "current",
        currentLessonCount: 0,
        offerKind: "free",
        listPriceCents: 0,
        currency: "usd",
        maxInstallments: 1,
        payoutReady: true,
        draftId: null,
        draftRevision: null,
        draftStale: false,
        lessons: [],
      },
    });
    expect(mocks.requireCoachOrAdmin).toHaveBeenCalledOnce();
    expect(mocks.createAdminClient).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("get_program_authoring_draft", {
      target_program_id: programId,
      target_actor_id: actorId,
    });
  });

  it("does not create a service client when owner authorization fails", async () => {
    mocks.requireCoachOrAdmin.mockRejectedValue(new Error("redirect"));
    await expect(loadProgramAuthoringSnapshot({ programId })).rejects.toThrow("redirect");
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects client supplied actor, seller, media proof, and unexpected fields", async () => {
    process.env.PROGRAM_PAID_AUTHORING_ENABLED = "true";
    const result = await saveProgramAuthoringDraft({
      programId,
      actorId,
      connectedAccountId: "acct_forged",
      lessons: [{
        lessonOrdinal: 1,
        timelineDayNumber: 1,
        title: "Lesson",
        instructions: "",
        pillar: "body",
        videoId: null,
        signedUrlsVerified: true,
      }],
    });
    expect(result).toEqual({ ok: false, reason: "invalid_request" });
    expect(mocks.requireCoachOrAdmin).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("maps an explicit candidate video without treating it as verified media", async () => {
    process.env.PROGRAM_PAID_AUTHORING_ENABLED = "true";
    readyRpc(saved());
    const result = await saveProgramAuthoringDraft({
      programId,
      draftId: null,
      expectedDraftRevision: 0,
      expectedContentVersionId: contentId,
      expectedOfferVersionId: offerId,
      lessons: [{
        lessonOrdinal: 1,
        timelineDayNumber: 3,
        title: "Lesson",
        instructions: "Do the work",
        pillar: "body",
        videoId,
      }],
    });
    expect(result).toMatchObject({ ok: true, value: { status: "saved", draftId } });
    expect(mocks.rpc).toHaveBeenCalledWith("save_program_authoring_draft", {
      target_program_id: programId,
      target_actor_id: actorId,
      target_draft_id: null,
      target_expected_draft_revision: 0,
      target_expected_content_version_id: contentId,
      target_expected_offer_version_id: offerId,
      target_lessons: [{
        lesson_ordinal: 1,
        timeline_day_number: 3,
        title: "Lesson",
        instructions: "Do the work",
        pillar: "body",
        video_id: videoId,
      }],
    });
  });

  it("maps a content publication to the reviewed CAS and never accepts posted seller facts", async () => {
    process.env.PROGRAM_PAID_AUTHORING_ENABLED = "true";
    readyRpc(published({ free_snapshot_id: contentId }));
    const result = await publishProgramAuthoringDraft({
      programId,
      draftId,
      expectedDraftRevision: 3,
      expectedContentVersionId: contentId,
      expectedOfferVersionId: offerId,
      requestId,
      listPriceCents: 5_000,
      maxInstallments: 1,
    });
    expect(result).toMatchObject({ ok: true, value: { status: "published", listPriceCents: 5_000 } });
    expect(mocks.rpc).toHaveBeenCalledWith("publish_program_authoring_draft", {
      target_program_id: programId,
      target_actor_id: actorId,
      target_draft_id: draftId,
      target_expected_draft_revision: 3,
      target_expected_content_version_id: contentId,
      target_expected_offer_version_id: offerId,
      target_request_id: requestId,
      target_list_price_cents: 5_000,
      target_max_installments: 1,
    });
  });

  it("passes price and promotion terms only as authored values, leaving seller identity to SQL", async () => {
    process.env.PROGRAM_PAID_AUTHORING_ENABLED = "true";
    readyRpc(published());
    const price = await publishProgramOfferPrice({
      programId,
      expectedContentVersionId: contentId,
      expectedOfferVersionId: offerId,
      requestId,
      listPriceCents: 8_000,
      maxInstallments: 2,
    });
    expect(price).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith("publish_program_offer_price", {
      target_program_id: programId,
      target_actor_id: actorId,
      target_expected_content_version_id: contentId,
      target_expected_offer_version_id: offerId,
      target_request_id: requestId,
      target_list_price_cents: 8_000,
      target_max_installments: 2,
    });

    mocks.rpc.mockResolvedValue({
      data: {
        status: "published",
        program_id: programId,
        content_version_id: contentId,
        offer_version_id: offerId,
        promotion_id: draftId,
        code: "WELCOME",
        discount_kind: "percent",
        discount_value: 10_000,
        starts_at: "2026-11-20T12:00:00.000Z",
        ends_at: null,
        max_redemptions: 10,
        published: true,
        replayed: false,
      },
      error: null,
    });
    const promo = await createProgramPromotion({
      programId,
      expectedContentVersionId: contentId,
      expectedOfferVersionId: offerId,
      requestId,
      code: " welcome ",
      discountKind: "percent",
      discountValue: 10_000,
      startsAt: "2026-11-20T12:00:00.000Z",
      endsAt: null,
      maxRedemptions: 10,
    });
    expect(promo).toMatchObject({ ok: true, value: { code: "WELCOME", discountValue: 10_000 } });
    expect(mocks.rpc).toHaveBeenLastCalledWith("create_program_promotion", {
      target_program_id: programId,
      target_actor_id: actorId,
      target_expected_content_version_id: contentId,
      target_expected_offer_version_id: offerId,
      target_request_id: requestId,
      target_code: "WELCOME",
      target_discount_kind: "percent",
      target_discount_value: 10_000,
      target_starts_at: "2026-11-20T12:00:00.000Z",
      target_ends_at: null,
      target_max_redemptions: 10,
    });
  });

  it("rejects impossible schedules and malformed server snapshots", async () => {
    process.env.PROGRAM_PAID_AUTHORING_ENABLED = "true";
    const invalidSchedule = await saveProgramAuthoringDraft({
      programId,
      draftId: null,
      expectedDraftRevision: 0,
      expectedContentVersionId: contentId,
      expectedOfferVersionId: offerId,
      lessons: [
        { lessonOrdinal: 1, timelineDayNumber: 3, title: "One", instructions: "", pillar: "body", videoId: null },
        { lessonOrdinal: 2, timelineDayNumber: 3, title: "Two", instructions: "", pillar: "mind", videoId: null },
      ],
    });
    expect(invalidSchedule).toEqual({ ok: false, reason: "invalid_request" });
    expect(mocks.requireCoachOrAdmin).not.toHaveBeenCalled();

    const invalidCalendarDate = await createProgramPromotion({
      programId,
      expectedContentVersionId: contentId,
      expectedOfferVersionId: offerId,
      requestId,
      code: "DATECHECK",
      discountKind: "percent",
      discountValue: 500,
      startsAt: "2026-02-31T12:00:00.000Z",
      endsAt: null,
      maxRedemptions: 1,
    });
    expect(invalidCalendarDate).toEqual({ ok: false, reason: "invalid_request" });
    expect(mocks.requireCoachOrAdmin).not.toHaveBeenCalled();

    readyRpc(snapshot({ connected_account_id: "acct_secret", seller_profile_id: actorId }));
    const malformed = await loadProgramAuthoringSnapshot({ programId });
    expect(malformed).toEqual({ ok: false, reason: "unavailable" });
  });

  it("fails closed on RPC errors and malformed mutation results", async () => {
    process.env.PROGRAM_PAID_AUTHORING_ENABLED = "true";
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "database detail" } });
    mocks.createAdminClient.mockReturnValue({ rpc: mocks.rpc });
    await expect(publishProgramOfferPrice({
      programId,
      expectedContentVersionId: contentId,
      expectedOfferVersionId: offerId,
      requestId,
      listPriceCents: 5_000,
      maxInstallments: 1,
    })).resolves.toEqual({ ok: false, reason: "unavailable" });

    readyRpc({ ...published(), connected_account_id: "acct_forged" });
    await expect(publishProgramAuthoringDraft({
      programId,
      draftId,
      expectedDraftRevision: 1,
      expectedContentVersionId: contentId,
      expectedOfferVersionId: offerId,
      requestId,
      listPriceCents: 5_000,
      maxInstallments: 1,
    })).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});
