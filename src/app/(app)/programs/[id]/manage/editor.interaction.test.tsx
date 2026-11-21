// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProgramAuthoringLesson,
  ProgramAuthoringPublished,
  ProgramAuthoringSnapshot,
  ProgramAuthoringResult,
} from "@/lib/program-authoring-contracts";

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
const OTHER_PROGRAM_ID = "10000000-0000-4000-8000-000000000002";
const CONTENT_ID = "20000000-0000-4000-8000-000000000001";
const OFFER_ID = "30000000-0000-4000-8000-000000000001";
const DRAFT_ID = "40000000-0000-4000-8000-000000000001";

function lesson(ordinal: number, prefix = "Saved"): ProgramAuthoringLesson {
  return {
    lessonOrdinal: ordinal,
    timelineDayNumber: ordinal * 10,
    title: `${prefix} lesson ${ordinal}`,
    instructions: `Instructions for ${prefix} lesson ${ordinal}`,
    pillar: "body",
    videoId: null,
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
    currentLessonCount: 3,
    offerKind: "paid",
    listPriceCents: 4_900,
    currency: "usd",
    maxInstallments: 3,
    payoutReady: true,
    draftId: DRAFT_ID,
    draftRevision: 2,
    draftStale: false,
    lessons: [lesson(1), lesson(2), lesson(3)],
    ...overrides,
  };
}

function published(
  programId: string,
  overrides: Partial<ProgramAuthoringPublished> = {},
): ProgramAuthoringPublished {
  return {
    status: "published",
    programId,
    contentVersionId: "20000000-0000-4000-8000-000000000009",
    offerVersionId: "30000000-0000-4000-8000-000000000009",
    freeSnapshotId: null,
    revisionNumber: 9,
    offerNumber: 10,
    listPriceCents: 5_500,
    currency: "usd",
    maxInstallments: 1,
    published: true,
    replayed: false,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function editorButton(host: HTMLElement, label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
}

function buttons(host: HTMLElement, label: string): HTMLButtonElement[] {
  return [...host.querySelectorAll("button")]
    .filter((candidate) => candidate.textContent?.trim() === label);
}

function field(host: HTMLElement, labelText: string, sectionHeading?: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const match = [...host.querySelectorAll("label")].find((label) => {
    const caption = label.querySelector("span")?.textContent?.trim();
    const section = label.closest("section");
    const heading = section?.querySelector("h2")?.textContent?.trim();
    return caption === labelText && (!sectionHeading || heading === sectionHeading);
  });
  const control = match?.querySelector("input, textarea, select");
  if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) {
    throw new Error(`Missing field: ${labelText}`);
  }
  return control;
}

function setFieldValue(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = control instanceof HTMLInputElement
    ? HTMLInputElement.prototype
    : control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLSelectElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!valueSetter) throw new Error("The browser DOM value setter is unavailable.");
  act(() => {
    valueSetter.call(control, value);
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    if (!(control instanceof HTMLSelectElement)) {
      control.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
}

async function click(host: HTMLElement, label: string) {
  await act(async () => {
    editorButton(host, label).click();
    await Promise.resolve();
  });
}

async function clickTwice(host: HTMLElement, label: string) {
  await act(async () => {
    const button = editorButton(host, label);
    button.click();
    button.click();
    await Promise.resolve();
  });
}

function saveResult(programId: string, draftId: string, draftRevision: number, lessons: ProgramAuthoringLesson[]) {
  return {
    ok: true as const,
    value: {
      status: "saved" as const,
      programId,
      draftId,
      draftRevision,
      baseContentVersionId: CONTENT_ID,
      baseOfferVersionId: OFFER_ID,
      lessonCount: lessons.length,
    },
  };
}

function defaultActionMocks() {
  actionMocks.publish.mockImplementation(async (input: { programId: string; listPriceCents: number; maxInstallments: number }) => ({
    ok: true as const,
    value: published(input.programId, {
      listPriceCents: input.listPriceCents,
      maxInstallments: input.maxInstallments,
    }),
  }));
  actionMocks.price.mockImplementation(async (input: { programId: string; listPriceCents: number; maxInstallments: number }) => ({
    ok: true as const,
    value: published(input.programId, {
      listPriceCents: input.listPriceCents,
      maxInstallments: input.maxInstallments,
    }),
  }));
  actionMocks.save.mockImplementation(async (input: {
    programId: string;
    draftId: string | null;
    expectedDraftRevision: number;
    lessons: ProgramAuthoringLesson[];
  }) => saveResult(input.programId, input.draftId ?? DRAFT_ID, input.expectedDraftRevision + 1, input.lessons));
  actionMocks.load.mockImplementation(async ({ programId }: { programId: string }) => ({
    ok: true as const,
    value: snapshot({ programId }),
  }));
  actionMocks.discard.mockImplementation(async (input: {
    programId: string;
    draftId: string;
    expectedDraftRevision: number;
  }) => ({
    ok: true as const,
    value: {
      status: "discarded" as const,
      programId: input.programId,
      draftId: input.draftId,
      draftRevision: input.expectedDraftRevision,
    },
  }));
  actionMocks.createPromotion.mockResolvedValue({ ok: false, reason: "unavailable" });
}

let host: HTMLDivElement;
let root: Root;

async function mount(initialSnapshot: ProgramAuthoringSnapshot) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<ProgramAuthoringEditor key={initialSnapshot.programId} initialSnapshot={initialSnapshot} readyVideos={[]} />);
  });
  return host;
}

async function rerender(nextSnapshot: ProgramAuthoringSnapshot) {
  await act(async () => {
    root.render(<ProgramAuthoringEditor key={nextSnapshot.programId} initialSnapshot={nextSnapshot} readyVideos={[]} />);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  defaultActionMocks();
});

afterEach(async () => {
  if (root) {
    await act(async () => root.unmount());
  }
  host?.remove();
});

describe("mounted Program authoring interactions (synthetic actions, jsdom)", () => {
  it("keeps paid content publishing visible and ignores rapid duplicate clicks", async () => {
    const pending = deferred<ProgramAuthoringResult<ProgramAuthoringPublished>>();
    actionMocks.publish.mockReturnValue(pending.promise);
    await mount(snapshot());

    expect(buttons(host, "Publish new content and price")).toHaveLength(1);
    await clickTwice(host, "Publish new content and price");
    expect(actionMocks.publish).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Saving your changes");

    await act(async () => {
      pending.resolve({ ok: true, value: published(PROGRAM_ID) });
      await pending.promise;
    });
    expect(host.textContent).toContain("Paid Program content published.");
  });

  it("retries an uncertain publication with the same request id and exact payload", async () => {
    await mount(snapshot());
    actionMocks.publish
      .mockResolvedValueOnce({ ok: false, reason: "unavailable" })
      .mockResolvedValueOnce({ ok: true, value: published(PROGRAM_ID) });

    await click(host, "Publish new content and price");
    expect(actionMocks.publish).toHaveBeenCalledTimes(1);
    const firstPayload = actionMocks.publish.mock.calls[0]?.[0];
    expect(host.textContent).toContain("Retry this change");
    await click(host, "Retry this change");

    expect(actionMocks.publish).toHaveBeenCalledTimes(2);
    expect(actionMocks.publish.mock.calls[1]?.[0]).toEqual(firstPayload);
    expect(firstPayload).toMatchObject({
      programId: PROGRAM_ID,
      draftId: DRAFT_ID,
      expectedDraftRevision: 2,
      expectedContentVersionId: CONTENT_ID,
      expectedOfferVersionId: OFFER_ID,
    });
    expect((firstPayload as { requestId?: string }).requestId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("retries a rejected transport with the same request and keeps entered price fields", async () => {
    await mount(snapshot());
    setFieldValue(field(host, "Total price (USD)", "Publish a new lesson version"), "59.50");
    setFieldValue(field(host, "Maximum installments", "Publish a new lesson version"), "2");
    actionMocks.publish
      .mockRejectedValueOnce(new Error("Synthetic transport interruption"))
      .mockResolvedValueOnce({ ok: true, value: published(PROGRAM_ID, {
        listPriceCents: 5_950,
        maxInstallments: 2,
      }) });

    await click(host, "Publish new content and price");
    expect(actionMocks.publish).toHaveBeenCalledTimes(1);
    const firstPayload = actionMocks.publish.mock.calls[0]?.[0];
    expect(host.textContent).toContain("Retry this exact request");
    expect((field(host, "Total price (USD)", "Publish a new lesson version") as HTMLInputElement).value).toBe("59.50");
    expect((field(host, "Maximum installments", "Publish a new lesson version") as HTMLSelectElement).value).toBe("2");

    await click(host, "Retry this change");
    expect(actionMocks.publish).toHaveBeenCalledTimes(2);
    expect(actionMocks.publish.mock.calls[1]?.[0]).toEqual(firstPayload);
    expect(firstPayload).toMatchObject({ listPriceCents: 5_950, maxInstallments: 2 });
    expect((firstPayload as { requestId?: string }).requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect((field(host, "Total price (USD)", "Publish a new lesson version") as HTMLInputElement).value).toBe("59.50");
  });

  it("preserves same-Program edits on prop refresh, then requires authoritative CAS after price rebase", async () => {
    const initial = snapshot();
    await mount(initial);
    setFieldValue(field(host, "Title"), "Unsaved title survives refresh");
    await rerender(snapshot({ listPriceCents: 5_100, lessons: [lesson(1, "New server props"), lesson(2, "New server props"), lesson(3, "New server props")] }));
    expect((field(host, "Title") as HTMLInputElement).value).toBe("Unsaved title survives refresh");

    const currentPrice = field(host, "Total price (USD)", "Update price");
    setFieldValue(currentPrice, "55.00");
    const rebased = snapshot({
      currentOfferVersionId: "30000000-0000-4000-8000-000000000008",
      draftRevision: 3,
      listPriceCents: 5_500,
      lessons: [lesson(1), lesson(2), lesson(3)],
    });
    actionMocks.price.mockResolvedValueOnce({ ok: true, value: published(PROGRAM_ID, {
      contentVersionId: CONTENT_ID,
      offerVersionId: rebased.currentOfferVersionId,
      listPriceCents: 5_500,
      maxInstallments: 3,
    }) });
    actionMocks.load.mockResolvedValueOnce({ ok: true, value: rebased });

    await click(host, "Publish price update");
    expect(actionMocks.price).toHaveBeenCalledTimes(1);
    expect(actionMocks.price.mock.calls[0]?.[0]).toMatchObject({
      expectedContentVersionId: CONTENT_ID,
      expectedOfferVersionId: OFFER_ID,
    });
    expect(host.textContent).toContain("Reload saved values");
    expect((field(host, "Title") as HTMLInputElement).value).toBe("Unsaved title survives refresh");
    expect(editorButton(host, "Publish new content and price").disabled).toBe(true);
    expect(actionMocks.publish).not.toHaveBeenCalled();

    await click(host, "Reload saved values (discard edits)");
    expect((field(host, "Title") as HTMLInputElement).value).toBe("Saved lesson 1");
    await click(host, "Publish new content and price");
    expect(actionMocks.publish).toHaveBeenCalledTimes(1);
    expect(actionMocks.publish.mock.calls[0]?.[0]).toMatchObject({
      expectedDraftRevision: 3,
      expectedContentVersionId: CONTENT_ID,
      expectedOfferVersionId: rebased.currentOfferVersionId,
    });
  });

  it("clamps installments when a saved lesson draft shrinks from three lessons to one", async () => {
    await mount(snapshot());
    setFieldValue(field(host, "Maximum installments", "Publish a new lesson version"), "3");
    for (let remaining = 2; remaining >= 1; remaining -= 1) {
      const removeButtons = buttons(host, "Remove lesson");
      await act(async () => removeButtons.at(-1)!.click());
    }
    expect(buttons(host, "Remove lesson")).toHaveLength(1);
    actionMocks.save.mockResolvedValueOnce(saveResult(PROGRAM_ID, DRAFT_ID, 3, [lesson(1)]));

    await click(host, "Save lesson draft");
    const installments = field(host, "Maximum installments", "Publish a new lesson version") as HTMLSelectElement;
    expect(installments.value).toBe("1");
    expect([...installments.options].map((option) => option.value)).toEqual(["1"]);
  });

  it("discards only after confirmation and retries the exact saved target after a lost reply", async () => {
    await mount(snapshot());
    setFieldValue(field(host, "Title"), "Unsaved edit for discard confirmation");
    actionMocks.discard
      .mockResolvedValueOnce({ ok: false, reason: "unavailable" })
      .mockResolvedValueOnce({ ok: true, value: {
        status: "discarded",
        programId: PROGRAM_ID,
        draftId: DRAFT_ID,
        draftRevision: 2,
      } });
    actionMocks.load.mockResolvedValueOnce({ ok: true, value: snapshot({ draftId: null, draftRevision: null }) });

    await click(host, "Discard saved draft");
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain("unsaved edits");
    await click(host, "Keep the draft");
    expect(actionMocks.discard).not.toHaveBeenCalled();

    await click(host, "Discard saved draft");
    await click(host, "Discard saved and unsaved changes");
    expect(actionMocks.discard).toHaveBeenCalledTimes(1);
    const target = actionMocks.discard.mock.calls[0]?.[0];
    expect(host.textContent).toContain("Retry discard");
    await click(host, "Retry discard");

    expect(actionMocks.discard).toHaveBeenCalledTimes(2);
    expect(actionMocks.discard.mock.calls[1]?.[0]).toEqual(target);
    expect(target).toEqual({
      programId: PROGRAM_ID,
      draftId: DRAFT_ID,
      expectedDraftRevision: 2,
      expectedContentVersionId: CONTENT_ID,
      expectedOfferVersionId: OFFER_ID,
    });
    expect((field(host, "Title") as HTMLInputElement).value).toBe("Saved lesson 1");
  });

  it("keeps the editor locked and values visible when a confirmed discard cannot reload", async () => {
    await mount(snapshot());
    setFieldValue(field(host, "Title"), "Keep visible until fresh read");
    actionMocks.discard.mockResolvedValueOnce({ ok: true, value: {
      status: "discarded",
      programId: PROGRAM_ID,
      draftId: DRAFT_ID,
      draftRevision: 2,
    } });
    actionMocks.load
      .mockResolvedValueOnce({ ok: false, reason: "unavailable" })
      .mockResolvedValueOnce({ ok: true, value: snapshot({ draftId: null, draftRevision: null }) });

    await click(host, "Discard saved draft");
    await click(host, "Discard saved and unsaved changes");
    const title = field(host, "Title") as HTMLInputElement;
    expect(title.value).toBe("Keep visible until fresh read");
    expect(title.matches(":disabled")).toBe(true);
    expect(host.textContent).toContain("The saved draft was removed, but current values could not be reloaded.");

    await click(host, "Reload saved values (discard edits)");
    expect((field(host, "Title") as HTMLInputElement).value).toBe("Saved lesson 1");
    expect((field(host, "Title") as HTMLInputElement).matches(":disabled")).toBe(false);
  });

  it("reloads on a replacement conflict without retrying a stale discard target", async () => {
    await mount(snapshot());
    actionMocks.discard.mockResolvedValueOnce({ ok: false, reason: "conflict" });
    actionMocks.load.mockResolvedValueOnce({ ok: true, value: snapshot({
      draftId: "40000000-0000-4000-8000-000000000002",
      draftRevision: 1,
      lessons: [lesson(1, "Replacement"), lesson(2, "Replacement")],
    }) });

    await click(host, "Discard saved draft");
    await click(host, "Discard saved and unsaved changes");
    expect(host.textContent).toContain("This saved draft changed. Reload saved values before discarding it.");
    expect(buttons(host, "Retry discard")).toHaveLength(0);
    await click(host, "Reload saved values (discard edits)");
    expect((field(host, "Title") as HTMLInputElement).value).toBe("Replacement lesson 1");
    expect(actionMocks.discard).toHaveBeenCalledTimes(1);
  });

  it("fences a delayed prior-Program publication after keyed navigation", async () => {
    const delayed = deferred<ProgramAuthoringResult<ProgramAuthoringPublished>>();
    actionMocks.publish.mockReturnValueOnce(delayed.promise);
    await mount(snapshot());
    await click(host, "Publish new content and price");
    expect(actionMocks.publish).toHaveBeenCalledOnce();

    await rerender(snapshot({
      programId: OTHER_PROGRAM_ID,
      currentContentVersionId: "20000000-0000-4000-8000-000000000002",
      currentOfferVersionId: "30000000-0000-4000-8000-000000000002",
      draftId: "40000000-0000-4000-8000-000000000002",
      lessons: [lesson(1, "Program B"), lesson(2, "Program B")],
      currentLessonCount: 2,
      maxInstallments: 2,
    }));
    await act(async () => {
      delayed.resolve({ ok: true, value: published(PROGRAM_ID) });
      await delayed.promise;
    });

    expect((field(host, "Title") as HTMLInputElement).value).toBe("Program B lesson 1");
    expect(host.textContent).not.toContain("Paid Program content published.");
    expect(actionMocks.publish).toHaveBeenCalledOnce();
  });
});
