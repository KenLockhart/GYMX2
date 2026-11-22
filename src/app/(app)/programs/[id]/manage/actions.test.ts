import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: false,
  load: vi.fn(),
  save: vi.fn(),
  publish: vi.fn(),
  price: vi.fn(),
  promotion: vi.fn(),
  discard: vi.fn(),
}));

vi.mock("@/lib/program-authoring-server", () => ({
  isProgramPaidAuthoringEnabled: () => mocks.enabled,
  loadProgramAuthoringSnapshot: mocks.load,
  saveProgramAuthoringDraft: mocks.save,
  publishProgramAuthoringDraft: mocks.publish,
  publishProgramOfferPrice: mocks.price,
  createProgramPromotion: mocks.promotion,
  discardProgramAuthoringDraft: mocks.discard,
}));

import {
  loadProgramAuthoringSnapshotAction,
  discardProgramAuthoringDraftAction,
  publishProgramAuthoringDraftAction,
  saveProgramAuthoringDraftAction,
} from "./actions";

const PROGRAM_ID = "10000000-0000-4000-8000-000000000001";
const CONTENT_ID = "20000000-0000-4000-8000-000000000002";
const OFFER_ID = "30000000-0000-4000-8000-000000000003";
const DRAFT_ID = "40000000-0000-4000-8000-000000000004";
const REQUEST_ID = "50000000-0000-4000-8000-000000000005";

describe("Program authoring server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = false;
  });

  it("blocks snapshot reads and mutations before adapters when the flag is off", async () => {
    expect(await loadProgramAuthoringSnapshotAction({ programId: PROGRAM_ID })).toEqual({ ok: false, reason: "feature_disabled" });
    expect(await saveProgramAuthoringDraftAction({})).toEqual({ ok: false, reason: "feature_disabled" });
    expect(await discardProgramAuthoringDraftAction({})).toEqual({ ok: false, reason: "feature_disabled" });
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.discard).not.toHaveBeenCalled();
  });

  it("rejects extra command fields before calling the server adapter", async () => {
    mocks.enabled = true;
    const result = await saveProgramAuthoringDraftAction({
      programId: PROGRAM_ID,
      draftId: null,
      expectedDraftRevision: 0,
      expectedContentVersionId: CONTENT_ID,
      expectedOfferVersionId: OFFER_ID,
      lessons: [{ lessonOrdinal: 1, timelineDayNumber: 1, title: "Lesson", instructions: "", pillar: "body", videoId: null }],
      actorId: "client-controlled",
    });
    expect(result).toEqual({ ok: false, reason: "invalid_request" });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("rejects a snapshot for a different Program even when the adapter succeeds", async () => {
    mocks.enabled = true;
    mocks.load.mockResolvedValue({ ok: true, value: { programId: "90000000-0000-4000-8000-000000000009" } });
    expect(await loadProgramAuthoringSnapshotAction({ programId: PROGRAM_ID })).toEqual({ ok: false, reason: "unavailable" });
  });

  it("forwards only a valid publication command to the existing adapter", async () => {
    mocks.enabled = true;
    mocks.publish.mockResolvedValue({ ok: false, reason: "unavailable" });
    const command = {
      programId: PROGRAM_ID,
      draftId: DRAFT_ID,
      expectedDraftRevision: 1,
      expectedContentVersionId: CONTENT_ID,
      expectedOfferVersionId: OFFER_ID,
      requestId: REQUEST_ID,
      listPriceCents: 4_900,
      maxInstallments: 1,
    };
    expect(await publishProgramAuthoringDraftAction(command)).toEqual({ ok: false, reason: "unavailable" });
    expect(mocks.publish).toHaveBeenCalledWith(command);
  });

  it("strictly scopes draft recovery to the posted Program and returns only a matching result", async () => {
    mocks.enabled = true;
    const command = {
      programId: PROGRAM_ID,
      draftId: DRAFT_ID,
      expectedDraftRevision: 2,
      expectedContentVersionId: CONTENT_ID,
      expectedOfferVersionId: OFFER_ID,
    };
    mocks.discard.mockResolvedValue({ ok: true, value: {
      status: "already_absent",
      programId: PROGRAM_ID,
      draftId: DRAFT_ID,
      draftRevision: 2,
    } });
    expect(await discardProgramAuthoringDraftAction(command)).toEqual({ ok: true, value: {
      status: "already_absent",
      programId: PROGRAM_ID,
      draftId: DRAFT_ID,
      draftRevision: 2,
    } });
    expect(mocks.discard).toHaveBeenCalledWith(command);
    expect(await discardProgramAuthoringDraftAction({ ...command, actorId: "forged" })).toEqual({ ok: false, reason: "invalid_request" });
    expect(mocks.discard).toHaveBeenCalledOnce();
  });
});
