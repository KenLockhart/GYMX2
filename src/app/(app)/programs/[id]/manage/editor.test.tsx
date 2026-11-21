import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProgramAuthoringSnapshot } from "@/lib/program-authoring-contracts";

const actionMocks = vi.hoisted(() => ({
  createPromotion: vi.fn(),
  discard: vi.fn(),
  load: vi.fn(),
  publish: vi.fn(),
  price: vi.fn(),
  save: vi.fn(),
}));

vi.mock("./actions", () => ({
  createProgramPromotionAction: actionMocks.createPromotion,
  discardProgramAuthoringDraftAction: actionMocks.discard,
  loadProgramAuthoringSnapshotAction: actionMocks.load,
  publishProgramAuthoringDraftAction: actionMocks.publish,
  publishProgramOfferPriceAction: actionMocks.price,
  saveProgramAuthoringDraftAction: actionMocks.save,
}));

import ProgramAuthoringEditor from "./editor";

const PROGRAM_ID = "10000000-0000-4000-8000-000000000001";
const CONTENT_ID = "20000000-0000-4000-8000-000000000002";
const OFFER_ID = "30000000-0000-4000-8000-000000000003";
const DRAFT_ID = "40000000-0000-4000-8000-000000000004";
const LOST_VIDEO_ID = "50000000-0000-4000-8000-000000000005";

function lesson(ordinal: number, videoId: string | null = null) {
  return {
    lessonOrdinal: ordinal,
    timelineDayNumber: ordinal * 8,
    title: `Saved lesson ${ordinal}`,
    instructions: "Saved instructions",
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

function render(snapshotValue: ProgramAuthoringSnapshot) {
  return renderToStaticMarkup(<ProgramAuthoringEditor initialSnapshot={snapshotValue} readyVideos={[]} />);
}

describe("Program authoring editor", () => {
  it("shows current price and keeps a missing selected video visible for explicit replacement or removal", () => {
    const html = render(snapshot({
      lessons: [lesson(1, LOST_VIDEO_ID)],
      currentLessonCount: 1,
      maxInstallments: 1,
    }));
    expect(html).toContain("$49.00");
    expect(html).toContain("Selected video unavailable");
    expect(html).toContain(LOST_VIDEO_ID);
    expect(html).toContain("Text lesson / no video");
    expect(actionMocks.load).not.toHaveBeenCalled();
  });

  it("bounds first paid publication installments by saved draft lessons", () => {
    const html = render(snapshot({
      currentRevisionKind: "free_snapshot",
      currentLessonCount: 1,
      offerKind: "free",
      listPriceCents: 0,
      maxInstallments: 1,
      draftId: DRAFT_ID,
      draftRevision: 2,
      lessons: [lesson(1), lesson(2), lesson(3)],
    }));
    expect(html).toContain("3 installments");
    expect(html).toContain("Lesson draft saved");
  });

  it("lets a free Program create its first draft without forcing a fake edit", () => {
    const html = render(snapshot({
      currentRevisionKind: "free_snapshot",
      currentLessonCount: 2,
      offerKind: "free",
      listPriceCents: 0,
      maxInstallments: 1,
      lessons: [lesson(1), lesson(2)],
    }));
    expect(html).toContain("Create lesson draft</button>");
    expect(html).not.toContain("disabled=\"\">Create lesson draft");
  });

  it("bounds price-only installments by the current published lesson count", () => {
    const html = render(snapshot({
      currentLessonCount: 1,
      maxInstallments: 1,
      draftId: DRAFT_ID,
      draftRevision: 2,
      lessons: [lesson(1), lesson(2), lesson(3)],
    }));
    const priceSectionStart = html.indexOf("Update price</h2>");
    const priceSectionEnd = html.indexOf("</section>", priceSectionStart);
    const priceSection = html.slice(priceSectionStart, priceSectionEnd);
    expect(html).toContain("current paid content has 1 lesson");
    expect(priceSection).not.toContain("2 installments");
    expect(priceSection).not.toContain("3 installments");
  });

  it("keeps full content publishing available for an already-paid Program", () => {
    const html = render(snapshot({
      draftId: DRAFT_ID,
      draftRevision: 2,
      lessons: [lesson(1), lesson(2)],
    }));
    expect(html).toContain("Publish a new lesson version");
    expect(html).toContain("Publish new content and price");
  });
});
