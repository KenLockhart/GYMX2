import { describe, expect, it } from "vitest";
import type { ProgramAuthoringSnapshot } from "@/lib/program-authoring-contracts";
import {
  createInitialEditorState,
  createRequestMemo,
  editorReducer,
  installmentChoices,
  localDateTimeToIso,
  percentInputToBasisPoints,
  usdInputToCents,
  type RequestMemos,
} from "./ui-state";

const PROGRAM_ID = "10000000-0000-4000-8000-000000000001";
const CONTENT_ID = "20000000-0000-4000-8000-000000000002";
const OFFER_ID = "30000000-0000-4000-8000-000000000003";
const DRAFT_ID = "40000000-0000-4000-8000-000000000004";
const VIDEO_ID = "50000000-0000-4000-8000-000000000005";

function lesson(lessonOrdinal: number, videoId: string | null = null) {
  return {
    lessonOrdinal,
    timelineDayNumber: lessonOrdinal * 10,
    title: `Lesson ${lessonOrdinal}`,
    instructions: "Instructions",
    pillar: "body" as const,
    videoId,
  };
}

function snapshot(overrides: Partial<ProgramAuthoringSnapshot> = {}): ProgramAuthoringSnapshot {
  return {
    programId: PROGRAM_ID,
    published: true,
    platformOwned: false,
    currentContentVersionId: CONTENT_ID,
    currentOfferVersionId: OFFER_ID,
    currentRevisionKind: "paid",
    currentLessonCount: 2,
    offerKind: "paid",
    listPriceCents: 4_900,
    currency: "usd",
    maxInstallments: 2,
    payoutReady: true,
    draftId: null,
    draftRevision: null,
    draftStale: false,
    lessons: [lesson(1), lesson(2)],
    ...overrides,
  };
}

describe("Program authoring editor state", () => {
  it("bounds installment choices by lesson count, not timeline day", () => {
    expect(installmentChoices(3)).toEqual([1, 2, 3]);
    expect(installmentChoices(30)).toHaveLength(12);
    expect(installmentChoices(0)).toEqual([]);
    expect(snapshot({ lessons: [lesson(1), lesson(2)], currentLessonCount: 2 }).lessons.at(-1)?.timelineDayNumber).toBe(20);
  });

  it("parses USD cents, percent basis points, and explicit local dates", () => {
    expect(usdInputToCents("0.50")).toBe(50);
    expect(usdInputToCents("1.999")).toBeNull();
    expect(percentInputToBasisPoints("100")).toBe(10_000);
    expect(percentInputToBasisPoints("100.01")).toBeNull();
    expect(localDateTimeToIso("2026-11-21T09:30")).toMatch(/^2026-11-21T\d\d:30:00\.000Z$/);
  });

  it("reuses an id only for the exact same mutation payload", () => {
    const initial: RequestMemos = { publish: null, price: null, promotion: null };
    const payload = { programId: PROGRAM_ID, listPriceCents: 4_900, maxInstallments: 2 };
    const first = createRequestMemo(initial, "price", payload, () => "request-one");
    const retry = createRequestMemo(first.memos, "price", payload, () => "request-two");
    const changed = createRequestMemo(first.memos, "price", { ...payload, listPriceCents: 5_000 }, () => "request-two");
    expect(retry.requestId).toBe("request-one");
    expect(changed.requestId).toBe("request-two");
  });

  it("keeps edited values after a stale failure and replaces them only on explicit reload", () => {
    const initial = createInitialEditorState(snapshot({ draftId: DRAFT_ID, draftRevision: 1 }));
    const edited = editorReducer(initial, {
      type: "lesson_changed",
      index: 0,
      field: "title",
      value: "Unsaved title",
    });
    const blocked = editorReducer(edited, {
      type: "failure",
      message: "Reload required",
      needsReload: true,
      uncertain: {
        operation: "price",
        requestId: "request-one",
        input: {
          programId: PROGRAM_ID,
          expectedContentVersionId: CONTENT_ID,
          expectedOfferVersionId: OFFER_ID,
          listPriceCents: 5_000,
          maxInstallments: 2,
        },
      },
    });
    expect(blocked.lessons[0]?.title).toBe("Unsaved title");
    expect(blocked.needsReload).toBe(true);
    const reloaded = editorReducer(blocked, { type: "reloaded", snapshot: snapshot({ draftId: DRAFT_ID, draftRevision: 2 }) });
    expect(reloaded.lessons[0]?.title).toBe("Lesson 1");
    expect(reloaded.uncertain).toBeNull();
    expect(reloaded.needsReload).toBe(false);
  });

  it("clamps full-publication installments after a saved draft shrinks", () => {
    const initial = createInitialEditorState(snapshot({
      maxInstallments: 3,
      draftId: DRAFT_ID,
      draftRevision: 3,
      lessons: [lesson(1), lesson(2), lesson(3)],
    }));
    expect(initial.publishInstallments).toBe(3);
    const saved = editorReducer(initial, {
      type: "draft_saved",
      value: {
        status: "saved",
        programId: PROGRAM_ID,
        draftId: DRAFT_ID,
        draftRevision: 4,
        baseContentVersionId: CONTENT_ID,
        baseOfferVersionId: OFFER_ID,
        lessonCount: 1,
      },
      lessons: [lesson(1)],
    });
    expect(saved.publishInstallments).toBe(1);
  });

  it("does not invent a draft revision after a price update and requires an authoritative reload", () => {
    const initial = editorReducer(createInitialEditorState(snapshot({
      draftId: DRAFT_ID,
      draftRevision: 7,
      lessons: [lesson(1), lesson(2), lesson(3)],
    })), {
      type: "lesson_changed",
      index: 0,
      field: "title",
      value: "Unsaved content edit",
    });
    const updated = editorReducer(initial, {
      type: "price_published",
      value: {
        status: "published",
        programId: PROGRAM_ID,
        contentVersionId: CONTENT_ID,
        offerVersionId: "60000000-0000-4000-8000-000000000006",
        freeSnapshotId: null,
        revisionNumber: 2,
        offerNumber: 3,
        listPriceCents: 5_000,
        currency: "usd",
        maxInstallments: 2,
        published: true,
        replayed: false,
      },
    });
    expect(updated.snapshot.draftRevision).toBe(7);
    expect(updated.needsReload).toBe(true);
    expect(updated.lessons[0]?.title).toBe("Unsaved content edit");
    expect(updated.error).toBeNull();
  });

  it("retains a selected video id when that video is no longer available", () => {
    const state = createInitialEditorState(snapshot({
      lessons: [lesson(1, VIDEO_ID)],
      currentLessonCount: 1,
      maxInstallments: 1,
    }));
    expect(state.lessons[0]?.videoId).toBe(VIDEO_ID);
    expect(editorReducer(state, { type: "lesson_changed", index: 0, field: "videoId", value: "" }).lessons[0]?.videoId).toBeNull();
  });
});
