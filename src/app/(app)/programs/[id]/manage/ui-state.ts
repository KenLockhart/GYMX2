import type {
  ProgramAuthoringLesson,
  ProgramAuthoringPromotion,
  ProgramAuthoringPublished,
  ProgramAuthoringSavedDraft,
  ProgramAuthoringSnapshot,
} from "@/lib/program-authoring-contracts";

export type PublishContentInput = {
  programId: string;
  draftId: string;
  expectedDraftRevision: number;
  expectedContentVersionId: string;
  expectedOfferVersionId: string;
  listPriceCents: number;
  maxInstallments: number;
};

export type PublishPriceInput = {
  programId: string;
  expectedContentVersionId: string;
  expectedOfferVersionId: string;
  listPriceCents: number;
  maxInstallments: number;
};

export type CreatePromotionInput = {
  programId: string;
  expectedContentVersionId: string;
  expectedOfferVersionId: string;
  code: string;
  discountKind: "fixed" | "percent";
  discountValue: number;
  startsAt: string;
  endsAt: string | null;
  maxRedemptions: number;
};

export type RetryableMutation =
  | { operation: "publish"; requestId: string; input: PublishContentInput }
  | { operation: "price"; requestId: string; input: PublishPriceInput }
  | { operation: "promotion"; requestId: string; input: CreatePromotionInput };

export type RequestKind = RetryableMutation["operation"];
export type RequestMemo = { fingerprint: string; requestId: string };
export type RequestMemos = Record<RequestKind, RequestMemo | null>;

export type ProgramAuthoringEditorState = {
  snapshot: ProgramAuthoringSnapshot;
  lessons: ProgramAuthoringLesson[];
  savedLessons: ProgramAuthoringLesson[];
  publishPriceText: string;
  publishInstallments: number;
  priceOnlyText: string;
  priceOnlyInstallments: number;
  promotionCode: string;
  promotionKind: "fixed" | "percent";
  promotionValueText: string;
  promotionStartsAt: string;
  promotionEndsAt: string;
  promotionMaxRedemptions: string;
  pending: boolean;
  error: string | null;
  status: string | null;
  needsReload: boolean;
  uncertain: RetryableMutation | null;
  recentPromotions: ProgramAuthoringPromotion[];
};

type TextEditorField =
  | "publishPriceText"
  | "priceOnlyText"
  | "promotionCode"
  | "promotionKind"
  | "promotionValueText"
  | "promotionStartsAt"
  | "promotionEndsAt"
  | "promotionMaxRedemptions";

export type EditorAction =
  | { type: "lesson_changed"; index: number; field: keyof ProgramAuthoringLesson; value: string }
  | { type: "lesson_added" }
  | { type: "lesson_removed"; index: number }
  | { type: "field_changed"; field: TextEditorField; value: string }
  | { type: "installments_changed"; field: "publishInstallments" | "priceOnlyInstallments"; value: number }
  | { type: "pending" }
  | { type: "failure"; message: string; uncertain?: RetryableMutation; needsReload?: boolean }
  | { type: "draft_saved"; value: ProgramAuthoringSavedDraft; lessons: ProgramAuthoringLesson[] }
  | { type: "price_published"; value: ProgramAuthoringPublished }
  | { type: "content_published"; value: ProgramAuthoringPublished; lessons: ProgramAuthoringLesson[] }
  | { type: "promotion_created"; value: ProgramAuthoringPromotion }
  | { type: "reloaded"; snapshot: ProgramAuthoringSnapshot }
  | { type: "clear_message" };

function blankLesson(lessonOrdinal: number, timelineDayNumber: number): ProgramAuthoringLesson {
  return {
    lessonOrdinal,
    timelineDayNumber: Math.min(365, timelineDayNumber),
    title: "",
    instructions: "",
    pillar: "body",
    videoId: null,
  };
}

function normalizeOrdinals(lessons: ProgramAuthoringLesson[]): ProgramAuthoringLesson[] {
  return lessons.map((lesson, index) => ({ ...lesson, lessonOrdinal: index + 1 }));
}

function centsInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function createInitialEditorState(snapshot: ProgramAuthoringSnapshot): ProgramAuthoringEditorState {
  const savedLessons = snapshot.lessons.map((lesson) => ({ ...lesson }));
  const lessons = savedLessons.length ? savedLessons : [blankLesson(1, 1)];
  const currentPrice = snapshot.offerKind === "paid" ? centsInput(snapshot.listPriceCents) : "";
  return {
    snapshot,
    lessons,
    savedLessons,
    publishPriceText: currentPrice,
    publishInstallments: Math.max(1, Math.min(snapshot.maxInstallments, installmentChoices(lessons.length).at(-1) ?? 1)),
    priceOnlyText: currentPrice,
    priceOnlyInstallments: Math.max(1, Math.min(snapshot.maxInstallments, installmentChoices(snapshot.currentLessonCount).at(-1) ?? 1)),
    promotionCode: "",
    promotionKind: "percent",
    promotionValueText: "100",
    promotionStartsAt: "",
    promotionEndsAt: "",
    promotionMaxRedemptions: "100",
    pending: false,
    error: null,
    status: null,
    needsReload: false,
    uncertain: null,
    recentPromotions: [],
  };
}

export function isLessonDraftDirty(state: ProgramAuthoringEditorState): boolean {
  return JSON.stringify(state.lessons) !== JSON.stringify(state.savedLessons);
}

export function installmentChoices(lessonCount: number): number[] {
  if (!Number.isInteger(lessonCount) || lessonCount <= 0) return [];
  const boundedCount = lessonCount;
  const maximum = Math.min(12, boundedCount);
  return Array.from({ length: maximum }, (_, index) => index + 1);
}

export function usdInputToCents(value: string): number | null {
  const match = /^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const [wholeText, fractionText = ""] = value.trim().split(".");
  const whole = Number(wholeText);
  const fraction = Number(fractionText.padEnd(2, "0"));
  const cents = whole * 100 + fraction;
  return Number.isSafeInteger(cents) ? cents : null;
}

export function percentInputToBasisPoints(value: string): number | null {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) return null;
  const percent = Number(normalized);
  if (!Number.isFinite(percent) || percent < 0.01 || percent > 100) return null;
  const basisPoints = Math.round(percent * 100);
  return Number.isInteger(basisPoints) ? basisPoints : null;
}

export function localDateTimeToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function createRequestMemo(
  current: RequestMemos,
  operation: RequestKind,
  payload: object,
  makeId: () => string,
): { memos: RequestMemos; requestId: string } {
  const fingerprint = JSON.stringify(payload);
  const existing = current[operation];
  if (existing?.fingerprint === fingerprint) return { memos: current, requestId: existing.requestId };
  const requestId = makeId();
  return {
    memos: { ...current, [operation]: { fingerprint, requestId } },
    requestId,
  };
}

function replaceSnapshot(
  state: ProgramAuthoringEditorState,
  snapshot: ProgramAuthoringSnapshot,
): ProgramAuthoringEditorState {
  const fresh = createInitialEditorState(snapshot);
  return { ...fresh, recentPromotions: state.recentPromotions };
}

export function editorReducer(
  state: ProgramAuthoringEditorState,
  action: EditorAction,
): ProgramAuthoringEditorState {
  switch (action.type) {
    case "lesson_changed": {
      const lessons = state.lessons.map((lesson, index) => {
        if (index !== action.index) return lesson;
        let updated: ProgramAuthoringLesson = lesson;
        switch (action.field) {
          case "videoId":
            updated = { ...lesson, videoId: action.value || null };
            break;
          case "lessonOrdinal":
            break;
          case "pillar":
            if (action.value === "mind" || action.value === "body" || action.value === "spirit") {
              updated = { ...lesson, pillar: action.value };
            }
            break;
          case "timelineDayNumber":
            updated = { ...lesson, timelineDayNumber: action.value === "" ? 0 : Number(action.value) };
            break;
          case "title":
            updated = { ...lesson, title: action.value };
            break;
          case "instructions":
            updated = { ...lesson, instructions: action.value };
            break;
        }
        return updated;
      });
      return { ...state, lessons, error: null, status: null };
    }
    case "lesson_added": {
      if (state.lessons.length >= 365) return state;
      const lastDay = state.lessons.at(-1)?.timelineDayNumber ?? 0;
      if (lastDay >= 365) return state;
      return {
        ...state,
        lessons: normalizeOrdinals([...state.lessons, blankLesson(state.lessons.length + 1, lastDay + 1)]),
        error: null,
        status: null,
      };
    }
    case "lesson_removed": {
      if (state.lessons.length <= 1) return state;
      return {
        ...state,
        lessons: normalizeOrdinals(state.lessons.filter((_, index) => index !== action.index)),
        error: null,
        status: null,
      };
    }
    case "field_changed":
      return { ...state, [action.field]: action.value, error: null, status: null };
    case "installments_changed":
      return { ...state, [action.field]: action.value, error: null, status: null };
    case "pending":
      return { ...state, pending: true, error: null, status: null };
    case "failure":
      return {
        ...state,
        pending: false,
        error: action.message,
        status: null,
        uncertain: action.needsReload === false
          ? action.uncertain ?? null
          : action.uncertain ?? state.uncertain,
        needsReload: action.needsReload ?? state.needsReload,
      };
    case "draft_saved": {
      const lessons = normalizeOrdinals(action.lessons);
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          currentContentVersionId: action.value.baseContentVersionId,
          currentOfferVersionId: action.value.baseOfferVersionId,
          draftId: action.value.draftId,
          draftRevision: action.value.draftRevision,
          draftStale: false,
          lessons,
        },
        lessons,
        savedLessons: lessons,
        publishInstallments: Math.max(1, Math.min(state.publishInstallments, 12, lessons.length)),
        pending: false,
        error: null,
        status: "Lesson draft saved.",
        needsReload: false,
        uncertain: null,
      };
    }
    case "price_published": {
      const needsAuthoritativeReload = action.value.replayed || state.snapshot.draftId !== null;
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          currentContentVersionId: action.value.contentVersionId,
          currentOfferVersionId: action.value.offerVersionId,
          offerKind: "paid",
          listPriceCents: action.value.listPriceCents,
          maxInstallments: action.value.maxInstallments,
          published: action.value.published,
        },
        pending: false,
        error: null,
        status: needsAuthoritativeReload
          ? `Price updated to ${formatUsd(action.value.listPriceCents)}. Reload saved values before continuing.`
          : `Price updated to ${formatUsd(action.value.listPriceCents)}.`,
        uncertain: null,
        needsReload: needsAuthoritativeReload,
      };
    }
    case "content_published": {
      const lessons = normalizeOrdinals(action.lessons);
      return {
        ...state,
        snapshot: {
          ...state.snapshot,
          published: action.value.published,
          currentContentVersionId: action.value.contentVersionId,
          currentOfferVersionId: action.value.offerVersionId,
          currentRevisionKind: "paid",
          currentLessonCount: lessons.length,
          offerKind: "paid",
          listPriceCents: action.value.listPriceCents,
          maxInstallments: action.value.maxInstallments,
          draftId: null,
          draftRevision: null,
          draftStale: false,
          lessons,
        },
        lessons,
        savedLessons: lessons,
        publishPriceText: centsInput(action.value.listPriceCents),
        publishInstallments: action.value.maxInstallments,
        priceOnlyText: centsInput(action.value.listPriceCents),
        priceOnlyInstallments: action.value.maxInstallments,
        pending: false,
        error: null,
        status: action.value.replayed
          ? "The earlier publication was confirmed. Reload the current saved values before continuing."
          : "Paid Program content published.",
        needsReload: action.value.replayed,
        uncertain: null,
      };
    }
    case "promotion_created":
      return {
        ...state,
        pending: false,
        error: null,
        status: action.value.replayed
          ? `Promotion ${action.value.code} was already created.`
          : `Promotion ${action.value.code} created.`,
        recentPromotions: [action.value, ...state.recentPromotions].slice(0, 5),
        uncertain: null,
        needsReload: action.value.replayed,
      };
    case "reloaded":
      return replaceSnapshot(state, action.snapshot);
    case "clear_message":
      return { ...state, error: null, status: null };
  }
}
