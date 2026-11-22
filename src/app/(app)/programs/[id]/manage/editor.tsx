"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import {
  createProgramPromotionAction,
  discardProgramAuthoringDraftAction,
  loadProgramAuthoringSnapshotAction,
  publishProgramAuthoringDraftAction,
  publishProgramOfferPriceAction,
  saveProgramAuthoringDraftAction,
} from "./actions";
import type {
  ProgramAuthoringDiscarded,
  ProgramAuthoringLesson,
  ProgramAuthoringPromotion,
  ProgramAuthoringPublished,
  ProgramAuthoringResult,
  ProgramAuthoringSnapshot,
} from "@/lib/program-authoring-contracts";
import {
  createInitialEditorState,
  createRequestMemo,
  editorReducer,
  formatUsd,
  installmentChoices,
  isLessonDraftDirty,
  localDateTimeToIso,
  percentInputToBasisPoints,
  usdInputToCents,
  type CreatePromotionInput,
  type PublishContentInput,
  type PublishPriceInput,
  type ProgramAuthoringEditorState,
  type RequestMemos,
  type RetryableMutation,
} from "./ui-state";

type ReadyVideo = { id: string; title: string };
type DiscardInput = {
  programId: string;
  draftId: string;
  expectedDraftRevision: number;
  expectedContentVersionId: string;
  expectedOfferVersionId: string;
};

type ProgramAuthoringEditorProps = {
  initialSnapshot: ProgramAuthoringSnapshot;
  readyVideos: ReadyVideo[];
};

type MutationOutcome =
  | { operation: "publish"; result: ProgramAuthoringResult<ProgramAuthoringPublished> }
  | { operation: "price"; result: ProgramAuthoringResult<ProgramAuthoringPublished> }
  | { operation: "promotion"; result: ProgramAuthoringResult<ProgramAuthoringPromotion> };

const emptyMemos = (): RequestMemos => ({ publish: null, price: null, promotion: null });

function makeRequestId(): string {
  if (!globalThis.crypto?.randomUUID) throw new Error("Secure request IDs are unavailable in this browser.");
  return globalThis.crypto.randomUUID();
}

function requestError(reason: "feature_disabled" | "invalid_request" | "unavailable" | "conflict"): string {
  if (reason === "feature_disabled") return "Program authoring is currently unavailable. Reload this page later.";
  if (reason === "invalid_request") return "Some values are invalid. Review the fields and try again.";
  if (reason === "conflict") return "This saved draft changed. Reload saved values before discarding it.";
  return "We couldn't confirm the result. Retry this same change or reload saved values.";
}

function validateLessons(lessons: ProgramAuthoringLesson[]): string | null {
  if (lessons.length < 1 || lessons.length > 365) return "Add between 1 and 365 lessons.";
  let priorDay = 0;
  for (const [index, lesson] of lessons.entries()) {
    if (lesson.lessonOrdinal !== index + 1) return "Lesson order must remain continuous.";
    if (!Number.isInteger(lesson.timelineDayNumber) || lesson.timelineDayNumber < 1 || lesson.timelineDayNumber > 365) {
      return `Lesson ${index + 1} needs a timeline day from 1 to 365.`;
    }
    if (lesson.timelineDayNumber <= priorDay) return "Timeline days must increase for each lesson.";
    if (!lesson.title.trim() || lesson.title.trim().length > 120) return `Lesson ${index + 1} needs a title of 1–120 characters.`;
    if (lesson.instructions.length > 2_000) return `Lesson ${index + 1} instructions must be 2,000 characters or fewer.`;
    priorDay = lesson.timelineDayNumber;
  }
  return null;
}

function discountValue(state: ProgramAuthoringEditorState): number | null {
  return state.promotionKind === "percent"
    ? percentInputToBasisPoints(state.promotionValueText)
    : usdInputToCents(state.promotionValueText);
}

export default function ProgramAuthoringEditor({
  initialSnapshot,
  readyVideos,
}: ProgramAuthoringEditorProps) {
  const [state, dispatch] = useReducer(editorReducer, initialSnapshot, createInitialEditorState);
  const memos = useRef<RequestMemos>(emptyMemos());
  const pendingRef = useRef(false);
  const mountedRef = useRef(false);
  const sequenceRef = useRef(0);
  const [discardRetryInput, setDiscardRetryInput] = useState<DiscardInput | null>(null);
  const [discardStatus, setDiscardStatus] = useState<"idle" | "confirming" | "pending" | "uncertain" | "refresh_failed">("idle");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sequenceRef.current += 1;
    };
  }, []);

  const request = async (mutation: RetryableMutation): Promise<MutationOutcome> => {
    switch (mutation.operation) {
      case "publish":
        return {
          operation: "publish",
          result: await publishProgramAuthoringDraftAction({ ...mutation.input, requestId: mutation.requestId }),
        };
      case "price":
        return {
          operation: "price",
          result: await publishProgramOfferPriceAction({ ...mutation.input, requestId: mutation.requestId }),
        };
      case "promotion":
        return {
          operation: "promotion",
          result: await createProgramPromotionAction({ ...mutation.input, requestId: mutation.requestId }),
        };
    }
  };

  const performRequest = async (mutation: RetryableMutation) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    const sequence = ++sequenceRef.current;
    dispatch({ type: "pending" });
    try {
      const outcome = await request(mutation);
      if (!mountedRef.current || sequence !== sequenceRef.current) return;
      if (!outcome.result.ok) {
        const uncertain = outcome.result.reason === "unavailable" ? mutation : undefined;
        dispatch({
          type: "failure",
          message: requestError(outcome.result.reason),
          ...(uncertain ? { uncertain } : {}),
          needsReload: outcome.result.reason !== "invalid_request",
        });
        return;
      }
      if (outcome.operation === "publish") {
        dispatch({ type: "content_published", value: outcome.result.value, lessons: state.savedLessons });
      } else if (outcome.operation === "price") {
        dispatch({ type: "price_published", value: outcome.result.value });
      } else {
        dispatch({ type: "promotion_created", value: outcome.result.value });
      }
    } catch {
      if (mountedRef.current && sequence === sequenceRef.current) {
        dispatch({
          type: "failure",
          message: "The response was interrupted. Retry this exact request or reload saved values.",
          uncertain: mutation,
          needsReload: true,
        });
      }
    } finally {
      pendingRef.current = false;
    }
  };

  const startRequest = (operation: RetryableMutation["operation"], input: object) => {
    const memo = createRequestMemo(memos.current, operation, input, makeRequestId);
    memos.current = memo.memos;
    if (operation === "publish") {
      void performRequest({ operation, requestId: memo.requestId, input: input as PublishContentInput });
    } else if (operation === "price") {
      void performRequest({ operation, requestId: memo.requestId, input: input as PublishPriceInput });
    } else {
      void performRequest({ operation, requestId: memo.requestId, input: input as CreatePromotionInput });
    }
  };

  const handleSaveDraft = async () => {
    if (pendingRef.current || state.needsReload) return;
    const lessonError = validateLessons(state.lessons);
    if (lessonError) {
      dispatch({ type: "failure", message: lessonError });
      return;
    }
    pendingRef.current = true;
    const sequence = ++sequenceRef.current;
    const normalizedLessons = state.lessons.map((lesson) => ({ ...lesson, title: lesson.title.trim() }));
    dispatch({ type: "pending" });
    try {
      const result = await saveProgramAuthoringDraftAction({
        programId: state.snapshot.programId,
        draftId: state.snapshot.draftId,
        expectedDraftRevision: state.snapshot.draftRevision ?? 0,
        expectedContentVersionId: state.snapshot.currentContentVersionId,
        expectedOfferVersionId: state.snapshot.currentOfferVersionId,
        lessons: normalizedLessons,
      });
      if (!mountedRef.current || sequence !== sequenceRef.current) return;
      if (!result.ok) {
        dispatch({
          type: "failure",
          message: requestError(result.reason),
          needsReload: result.reason !== "invalid_request",
        });
      } else {
        dispatch({ type: "draft_saved", value: result.value, lessons: normalizedLessons });
      }
    } catch {
      if (mountedRef.current && sequence === sequenceRef.current) {
        dispatch({
          type: "failure",
          message: "The save response was interrupted. Reload saved values before trying again.",
          needsReload: true,
        });
      }
    } finally {
      pendingRef.current = false;
    }
  };

  const handleReload = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    const sequence = ++sequenceRef.current;
    dispatch({ type: "pending" });
    try {
      const result = await loadProgramAuthoringSnapshotAction({ programId: state.snapshot.programId });
      if (!mountedRef.current || sequence !== sequenceRef.current) return;
      if (!result.ok || result.value.programId !== state.snapshot.programId) {
        dispatch({
          type: "failure",
          message: result.ok ? "The returned Program did not match this page." : requestError(result.reason),
          needsReload: true,
        });
      } else {
        setDiscardRetryInput(null);
        setDiscardStatus("idle");
        dispatch({ type: "reloaded", snapshot: result.value });
      }
    } catch {
      if (mountedRef.current && sequence === sequenceRef.current) {
        dispatch({ type: "failure", message: "Saved values could not be reloaded.", needsReload: true });
      }
    } finally {
      pendingRef.current = false;
    }
  };

  const performDiscard = async (input: DiscardInput) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setDiscardStatus("pending");
    const sequence = ++sequenceRef.current;
    dispatch({ type: "pending" });
    let result: ProgramAuthoringResult<ProgramAuthoringDiscarded>;
    try {
      result = await discardProgramAuthoringDraftAction(input);
    } catch {
      if (mountedRef.current && sequence === sequenceRef.current) {
        setDiscardRetryInput(input);
        setDiscardStatus("uncertain");
        dispatch({
          type: "failure",
          message: "We couldn't confirm whether the saved draft was removed. Retry the same discard or reload saved values.",
          uncertain: undefined,
          needsReload: true,
        });
      }
      pendingRef.current = false;
      return;
    }
    if (!mountedRef.current || sequence !== sequenceRef.current) {
      pendingRef.current = false;
      return;
    }
    if (!result.ok) {
      const uncertain = result.reason === "unavailable";
      setDiscardRetryInput(uncertain ? input : null);
      setDiscardStatus(uncertain ? "uncertain" : "refresh_failed");
      dispatch({
        type: "failure",
        message: uncertain
          ? "We couldn't confirm whether the saved draft was removed. Retry the same discard or reload saved values."
          : requestError(result.reason),
        needsReload: true,
      });
      pendingRef.current = false;
      return;
    }

    // The mutation is confirmed; a later read failure must not turn it into an uncertain delete.
    setDiscardRetryInput(null);
    try {
      const snapshotResult = await loadProgramAuthoringSnapshotAction({ programId: input.programId });
      if (!mountedRef.current || sequence !== sequenceRef.current) return;
      if (!snapshotResult.ok || snapshotResult.value.programId !== input.programId) {
        setDiscardStatus("refresh_failed");
        dispatch({
          type: "failure",
          message: "The saved draft was removed, but current values could not be reloaded. Reload before editing.",
          needsReload: true,
        });
      } else {
        setDiscardStatus("idle");
        dispatch({ type: "reloaded", snapshot: snapshotResult.value });
      }
    } catch {
      if (mountedRef.current && sequence === sequenceRef.current) {
        setDiscardStatus("refresh_failed");
        dispatch({
          type: "failure",
          message: "The saved draft was removed, but current values could not be reloaded. Reload before editing.",
          needsReload: true,
        });
      }
    } finally {
      pendingRef.current = false;
    }
  };

  const confirmDiscard = () => {
    const { draftId, draftRevision } = state.snapshot;
    if (!draftId || draftRevision === null) return;
    const input: DiscardInput = {
      programId: state.snapshot.programId,
      draftId,
      expectedDraftRevision: draftRevision,
      expectedContentVersionId: state.snapshot.currentContentVersionId,
      expectedOfferVersionId: state.snapshot.currentOfferVersionId,
    };
    setDiscardRetryInput(input);
    void performDiscard(input);
  };

  const handlePublishContent = () => {
    if (pendingRef.current || state.needsReload) return;
    if (isLessonDraftDirty(state)) {
      dispatch({ type: "failure", message: "Save your lesson changes before publishing them." });
      return;
    }
    const draftId = state.snapshot.draftId;
    const draftRevision = state.snapshot.draftRevision;
    if (!draftId || draftRevision === null || state.snapshot.draftStale) {
      dispatch({ type: "failure", message: "Save a current lesson draft before publishing." });
      return;
    }
    const count = state.snapshot.lessons.length;
    const cents = usdInputToCents(state.publishPriceText);
    if (cents === null || cents < 50) {
      dispatch({ type: "failure", message: "Enter a USD price of at least $0.50." });
      return;
    }
    if (state.publishInstallments < 1 || state.publishInstallments > Math.min(12, count)) {
      dispatch({ type: "failure", message: "Installments cannot exceed the saved lesson count." });
      return;
    }
    const input: PublishContentInput = {
      programId: state.snapshot.programId,
      draftId,
      expectedDraftRevision: draftRevision,
      expectedContentVersionId: state.snapshot.currentContentVersionId,
      expectedOfferVersionId: state.snapshot.currentOfferVersionId,
      listPriceCents: cents,
      maxInstallments: state.publishInstallments,
    };
    startRequest("publish", input);
  };

  const handlePublishPrice = () => {
    if (pendingRef.current || state.needsReload) return;
    const count = state.snapshot.currentLessonCount;
    const cents = usdInputToCents(state.priceOnlyText);
    if (state.snapshot.offerKind !== "paid" || count < 1) {
      dispatch({ type: "failure", message: "A price-only update requires current paid Program content." });
      return;
    }
    if (cents === null || cents < 50) {
      dispatch({ type: "failure", message: "Enter a USD price of at least $0.50." });
      return;
    }
    if (state.priceOnlyInstallments < 1 || state.priceOnlyInstallments > Math.min(12, count)) {
      dispatch({ type: "failure", message: "Installments cannot exceed the current lesson count." });
      return;
    }
    const input: PublishPriceInput = {
      programId: state.snapshot.programId,
      expectedContentVersionId: state.snapshot.currentContentVersionId,
      expectedOfferVersionId: state.snapshot.currentOfferVersionId,
      listPriceCents: cents,
      maxInstallments: state.priceOnlyInstallments,
    };
    startRequest("price", input);
  };

  const handleCreatePromotion = () => {
    if (pendingRef.current || state.needsReload) return;
    if (state.snapshot.offerKind !== "paid") {
      dispatch({ type: "failure", message: "Publish a paid offer before creating a promotion." });
      return;
    }
    const value = discountValue(state);
    const startsAt = localDateTimeToIso(state.promotionStartsAt);
    const endsAt = state.promotionEndsAt ? localDateTimeToIso(state.promotionEndsAt) : null;
    const redemptions = Number(state.promotionMaxRedemptions);
    if (value === null || value < 1) {
      dispatch({ type: "failure", message: state.promotionKind === "percent"
        ? "Enter a discount from 0.01% to 100%."
        : "Enter a fixed discount of at least $0.01." });
      return;
    }
    if (!startsAt || (state.promotionEndsAt && !endsAt) || !Number.isSafeInteger(redemptions) || redemptions < 1) {
      dispatch({ type: "failure", message: "Enter valid promotion dates and a redemption limit." });
      return;
    }
    if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
      dispatch({ type: "failure", message: "The end date must be after the start date." });
      return;
    }
    const input: CreatePromotionInput = {
      programId: state.snapshot.programId,
      expectedContentVersionId: state.snapshot.currentContentVersionId,
      expectedOfferVersionId: state.snapshot.currentOfferVersionId,
      code: state.promotionCode.trim().toUpperCase(),
      discountKind: state.promotionKind,
      discountValue: value,
      startsAt,
      endsAt,
      maxRedemptions: redemptions,
    };
    startRequest("promotion", input);
  };

  const isLocked = state.pending || state.needsReload || discardStatus === "confirming" || discardStatus === "pending";
  const hasPaidOffer = state.snapshot.offerKind === "paid";
  const savedDraftCount = state.snapshot.draftId && !state.snapshot.draftStale
    ? state.snapshot.lessons.length
    : 0;
  const canSaveDraft = state.snapshot.draftId === null || isLessonDraftDirty(state);
  const publishChoices = installmentChoices(savedDraftCount);
  const priceChoices = installmentChoices(state.snapshot.currentLessonCount);
  const payoutReady = state.snapshot.platformOwned || state.snapshot.payoutReady;
  const canDiscardDraft = state.snapshot.draftId !== null
    && state.snapshot.draftRevision !== null
    && !state.pending
    && discardStatus === "idle"
    && state.uncertain === null
    && (!state.needsReload || state.snapshot.draftStale);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border p-5">
        <h2 className="text-xl font-semibold">Current offer</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div><dt className="text-sm text-muted">Access</dt><dd>{hasPaidOffer ? "Paid" : "Free"}</dd></div>
          <div><dt className="text-sm text-muted">Current price</dt><dd>{hasPaidOffer ? formatUsd(state.snapshot.listPriceCents) : "Free"}</dd></div>
          <div><dt className="text-sm text-muted">Saved lessons</dt><dd>{state.snapshot.currentLessonCount}</dd></div>
          <div><dt className="text-sm text-muted">Payout setup</dt><dd>{state.snapshot.platformOwned ? "Platform sale" : state.snapshot.payoutReady ? "Ready" : "Setup needed before paid publishing"}</dd></div>
        </dl>
        {state.snapshot.draftStale ? (
          <p role="alert" className="mt-4 text-sm">This lesson draft is out of date. Reload saved values before continuing.</p>
        ) : null}
      </section>

      <section className="space-y-4 rounded-xl border border-border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Lesson content</h2>
            <p className="text-sm text-muted">Lesson order controls installment limits. Timeline day is a separate schedule value.</p>
          </div>
            <div className="flex items-center gap-3">
              <p className="text-sm">{state.snapshot.draftId ? "Lesson draft saved" : "No saved draft"}</p>
              {canDiscardDraft ? <button type="button" className="btn-secondary" onClick={() => setDiscardStatus("confirming")}>Discard saved draft</button> : null}
            </div>
        </div>
        {discardStatus === "confirming" ? (
          <div role="alertdialog" aria-labelledby="discard-draft-title" aria-describedby="discard-draft-description" className="space-y-3 rounded-lg border border-danger/40 p-4">
            <h3 id="discard-draft-title" className="font-semibold">Discard this saved draft?</h3>
            <p id="discard-draft-description" className="text-sm text-muted">This also removes the unsaved edits shown here. Published lessons, current price, and promotions stay as they are.</p>
            <div className="flex flex-wrap gap-3">
              <button type="button" className="btn-secondary" onClick={() => setDiscardStatus("idle")}>Keep the draft</button>
              <button type="button" className="btn-secondary" onClick={confirmDiscard}>Discard saved and unsaved changes</button>
            </div>
          </div>
        ) : null}
        <div className="space-y-4">
          {state.lessons.map((lesson, index) => {
            const selectedVideo = readyVideos.find((video) => video.id === lesson.videoId);
            const selectedIsUnavailable = lesson.videoId !== null && !selectedVideo;
            return (
              <fieldset key={`${lesson.lessonOrdinal}-${index}`} className="space-y-3 rounded-lg border border-border p-4" disabled={isLocked}>
                <legend className="px-1 font-medium">Lesson {index + 1}</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span>Title</span>
                    <input className="field-input w-full" maxLength={120} value={lesson.title} onChange={(event) => dispatch({ type: "lesson_changed", index, field: "title", value: event.target.value })} />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>Lesson order</span>
                    <input className="field-input w-full" value={index + 1} readOnly aria-readonly="true" />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>Timeline day</span>
                    <input className="field-input w-full" type="number" min={1} max={365} value={lesson.timelineDayNumber || ""} onChange={(event) => dispatch({ type: "lesson_changed", index, field: "timelineDayNumber", value: event.target.value })} />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>Pillar</span>
                    <select className="field-input w-full" value={lesson.pillar} onChange={(event) => dispatch({ type: "lesson_changed", index, field: "pillar", value: event.target.value })}>
                      <option value="mind">Mind</option><option value="body">Body</option><option value="spirit">Spirit</option>
                    </select>
                  </label>
                </div>
                <label className="block space-y-1 text-sm">
                  <span>Instructions</span>
                  <textarea className="field-input w-full" rows={3} maxLength={2_000} value={lesson.instructions} onChange={(event) => dispatch({ type: "lesson_changed", index, field: "instructions", value: event.target.value })} />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>Lesson video (optional)</span>
                  <span className="block text-xs text-muted">Ready private or Program-only videos are listed. Availability is checked again when you publish.</span>
                  <select className="field-input w-full" value={lesson.videoId ?? ""} onChange={(event) => dispatch({ type: "lesson_changed", index, field: "videoId", value: event.target.value })}>
                    <option value="">Text lesson / no video</option>
                    {selectedIsUnavailable ? <option value={lesson.videoId!} disabled>Selected video unavailable — replace or clear explicitly</option> : null}
                    {readyVideos.map((video) => <option key={video.id} value={video.id}>{video.title}</option>)}
                  </select>
                  {selectedVideo ? <span className="block text-xs text-muted">Selected: {selectedVideo.title}</span> : null}
                  {selectedIsUnavailable ? <span role="alert" className="block text-xs">The saved video is no longer available. Replace it or choose “Text lesson / no video” explicitly.</span> : null}
                </label>
                <button type="button" className="btn-secondary" disabled={isLocked || state.lessons.length <= 1} onClick={() => dispatch({ type: "lesson_removed", index })}>Remove lesson</button>
              </fieldset>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn-secondary" disabled={isLocked || state.lessons.length >= 365 || (state.lessons.at(-1)?.timelineDayNumber ?? 365) >= 365} onClick={() => dispatch({ type: "lesson_added" })}>Add lesson</button>
          <button type="button" className="btn-primary" disabled={isLocked || !canSaveDraft} onClick={() => void handleSaveDraft()}>{state.pending ? "Saving…" : state.snapshot.draftId ? "Save lesson draft" : "Create lesson draft"}</button>
        </div>
        <p className="text-sm text-muted">Paid publishing requires a ready Program intro. Choose it in the existing Program details editor.</p>
      </section>

      <section className="space-y-4 rounded-xl border border-border p-5">
        <h2 className="text-xl font-semibold">{hasPaidOffer ? "Publish a new lesson version" : "Publish a paid offer"}</h2>
        <p className="text-sm text-muted">{hasPaidOffer
          ? "Publish your saved lesson draft as a new version with a new price and payment plan."
          : "This publishes the saved lesson draft as a new paid version. Free learners keep the content they joined with."}</p>
        {!payoutReady ? <p role="status" className="text-sm">Complete payout setup before publishing a paid offer.</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm"><span>Total price (USD)</span><input className="field-input w-full" inputMode="decimal" value={state.publishPriceText} disabled={isLocked} onChange={(event) => dispatch({ type: "field_changed", field: "publishPriceText", value: event.target.value })} placeholder="49.00" /></label>
          <label className="space-y-1 text-sm"><span>Maximum installments</span><select className="field-input w-full" value={state.publishInstallments} disabled={isLocked || publishChoices.length === 0} onChange={(event) => dispatch({ type: "installments_changed", field: "publishInstallments", value: Number(event.target.value) })}>
            {publishChoices.length === 0 ? <option value={1}>Save a lesson draft first</option> : publishChoices.map((count) => <option key={count} value={count}>{count === 1 ? "Pay in full" : `${count} installments`}</option>)}
          </select></label>
        </div>
        <button type="button" className="btn-primary" disabled={isLocked || !payoutReady || isLessonDraftDirty(state) || !state.snapshot.draftId || state.snapshot.draftStale} onClick={handlePublishContent}>{hasPaidOffer ? "Publish new content and price" : "Publish paid version"}</button>
      </section>
      {hasPaidOffer ? (
        <>
          <section className="space-y-4 rounded-xl border border-border p-5">
            <h2 className="text-xl font-semibold">Update price</h2>
            <p className="text-sm text-muted">This keeps the current lesson version. The current paid content has {state.snapshot.currentLessonCount} {state.snapshot.currentLessonCount === 1 ? "lesson" : "lessons"}, which sets the installment limit.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm"><span>Total price (USD)</span><input className="field-input w-full" inputMode="decimal" value={state.priceOnlyText} disabled={isLocked} onChange={(event) => dispatch({ type: "field_changed", field: "priceOnlyText", value: event.target.value })} /></label>
              <label className="space-y-1 text-sm"><span>Maximum installments</span><select className="field-input w-full" value={state.priceOnlyInstallments} disabled={isLocked || priceChoices.length === 0} onChange={(event) => dispatch({ type: "installments_changed", field: "priceOnlyInstallments", value: Number(event.target.value) })}>
                {priceChoices.map((count) => <option key={count} value={count}>{count === 1 ? "Pay in full" : `${count} installments`}</option>)}
              </select></label>
            </div>
            <button type="button" className="btn-primary" disabled={isLocked || !state.snapshot.published || !payoutReady || priceChoices.length === 0} onClick={handlePublishPrice}>Publish price update</button>
          </section>
          <section className="space-y-4 rounded-xl border border-border p-5">
            <h2 className="text-xl font-semibold">Create a promotion</h2>
            <p className="text-sm text-muted">A 100% promotion offers a free redemption without changing the published price.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm"><span>Code</span><input className="field-input w-full" maxLength={64} value={state.promotionCode} disabled={isLocked} onChange={(event) => dispatch({ type: "field_changed", field: "promotionCode", value: event.target.value.toUpperCase() })} /></label>
              <label className="space-y-1 text-sm"><span>Discount type</span><select className="field-input w-full" value={state.promotionKind} disabled={isLocked} onChange={(event) => dispatch({ type: "field_changed", field: "promotionKind", value: event.target.value as "fixed" | "percent" })}><option value="percent">Percent</option><option value="fixed">Fixed USD amount</option></select></label>
              <label className="space-y-1 text-sm"><span>{state.promotionKind === "percent" ? "Discount percent (up to 100)" : "Discount amount (USD)"}</span><input className="field-input w-full" inputMode="decimal" value={state.promotionValueText} disabled={isLocked} onChange={(event) => dispatch({ type: "field_changed", field: "promotionValueText", value: event.target.value })} /></label>
              <label className="space-y-1 text-sm"><span>Maximum redemptions</span><input className="field-input w-full" type="number" min={1} max={1_000_000} value={state.promotionMaxRedemptions} disabled={isLocked} onChange={(event) => dispatch({ type: "field_changed", field: "promotionMaxRedemptions", value: event.target.value })} /></label>
              <label className="space-y-1 text-sm"><span>Starts (your local time)</span><input className="field-input w-full" type="datetime-local" value={state.promotionStartsAt} disabled={isLocked} onChange={(event) => dispatch({ type: "field_changed", field: "promotionStartsAt", value: event.target.value })} /></label>
              <label className="space-y-1 text-sm"><span>Ends (optional)</span><input className="field-input w-full" type="datetime-local" value={state.promotionEndsAt} disabled={isLocked} onChange={(event) => dispatch({ type: "field_changed", field: "promotionEndsAt", value: event.target.value })} /></label>
            </div>
            <button type="button" className="btn-primary" disabled={isLocked || !state.snapshot.published} onClick={handleCreatePromotion}>Create promotion</button>
            {state.recentPromotions.length ? <ul aria-label="Recently created promotions" className="list-disc pl-5 text-sm">{state.recentPromotions.map((promotion) => <li key={promotion.promotionId}>{promotion.code}: {promotion.discountKind === "percent" ? `${promotion.discountValue / 100}%` : formatUsd(promotion.discountValue)}</li>)}</ul> : null}
          </section>
        </>
      ) : null}

      {state.error ? <p role="alert" className="rounded-lg border border-danger p-3 text-sm">{state.error}</p> : null}
      {state.status ? <p role="status" className="rounded-lg border border-border p-3 text-sm">{state.status}</p> : null}
      {discardStatus === "uncertain" && discardRetryInput ? <div className="flex flex-wrap gap-3"><button type="button" className="btn-secondary" disabled={state.pending} onClick={() => void performDiscard(discardRetryInput)}>Retry discard</button><button type="button" className="btn-secondary" disabled={state.pending} onClick={() => void handleReload()}>Reload saved values</button></div> : null}
      {state.uncertain ? <div className="flex flex-wrap gap-3"><button type="button" className="btn-secondary" disabled={state.pending} onClick={() => void performRequest(state.uncertain!)}>Retry this change</button><button type="button" className="btn-secondary" disabled={state.pending} onClick={() => void handleReload()}>Reload saved values (discard edits)</button></div> : null}
      {state.needsReload && !state.uncertain && discardStatus !== "uncertain" ? <button type="button" className="btn-secondary" disabled={state.pending} onClick={() => void handleReload()}>Reload saved values (discard edits)</button> : null}
      {state.pending ? <p role="status" className="text-sm">Saving your changes…</p> : null}
    </div>
  );
}
