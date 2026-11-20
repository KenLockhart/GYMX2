export type ProgramVersionMode =
  | "legacy_free"
  | "free_snapshot"
  | "paid_order"
  | "history_only"
  | "not_enrolled";

export type ProgramRequiredLesson = {
  id: string;
  sourceDayId: string | null;
  lessonOrdinal: number;
  timelineDayNumber: number;
  title: string;
  pillar: string;
};

export type ProgramAccessibleLesson = ProgramRequiredLesson & {
  instructions: string;
};

export type ProgramCompletionHistoryEntry = {
  versionId: string;
  lessonId: string;
  lessonIdentityId: string;
  lessonOrdinal: number;
  timelineDayNumber: number;
  title: string;
  pillar: string;
  state: "completed" | "undone";
  eventSequence: number;
  occurredAt: string;
};

export type ProgramCompletedOnce = {
  lessonIdentityId: string;
  firstCompletedAt: string;
  title: string;
  pillar: string;
};

export type ProgramVersionedProgress = {
  programId: string;
  memberId: string;
  programTitle: string;
  usesVersionedLessons: boolean;
  mode: ProgramVersionMode;
  accessAuthorized: boolean;
  enrollmentId: string | null;
  contentVersionId: string | null;
  startedOn: string | null;
  accessStartedOn: string | null;
  easternToday: string;
  timelineCeiling: number;
  paidCeiling: number;
  lessonCeiling: number;
  clearedInstallments: number;
  installmentCount: number;
  fullyFunded: boolean;
  requiredCount: number;
  currentCompletedCount: number;
  lifetimeCompletedCount: number;
  requiredLessons: ProgramRequiredLesson[];
  accessibleLessons: ProgramAccessibleLesson[];
  accessibleLessonIds: string[];
  completedLessonIds: string[];
  completedOnce: ProgramCompletedOnce[];
  history: ProgramCompletionHistoryEntry[];
};

export type ProgramAccessCeilings = {
  timelineCeiling: number;
  paidCeiling: number;
  lessonCeiling: number;
  accessibleLessonIds: string[];
};

export function canReadProgramVersionedLesson(
  progress: ProgramVersionedProgress | null,
  lessonId: string,
): boolean {
  return Boolean(
    progress?.accessAuthorized &&
      progress.accessibleLessonIds.includes(lessonId) &&
      progress.accessibleLessons.some((lesson) => lesson.id === lessonId),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function nullableString(value: unknown): value is string | null {
  return value === null || nonEmptyString(value);
}

function isDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseRequiredLesson(value: unknown): ProgramRequiredLesson | null {
  if (!isRecord(value)) return null;
  if (
    !nonEmptyString(value.id) ||
    !nullableString(value.source_day_id) ||
    !positiveInteger(value.lesson_ordinal) ||
    !positiveInteger(value.timeline_day_number) ||
    !nonEmptyString(value.title) ||
    !nonEmptyString(value.pillar)
  ) {
    return null;
  }
  return {
    id: value.id,
    sourceDayId: value.source_day_id,
    lessonOrdinal: value.lesson_ordinal,
    timelineDayNumber: value.timeline_day_number,
    title: value.title,
    pillar: value.pillar,
  };
}

function parseAccessibleLesson(value: unknown): ProgramAccessibleLesson | null {
  if (!isRecord(value) || typeof value.instructions !== "string") return null;
  const required = parseRequiredLesson(value);
  return required ? { ...required, instructions: value.instructions } : null;
}

function parseHistoryEntry(value: unknown): ProgramCompletionHistoryEntry | null {
  if (!isRecord(value)) return null;
  if (
    !nonEmptyString(value.version_id) ||
    !nonEmptyString(value.lesson_id) ||
    !nonEmptyString(value.lesson_identity_id) ||
    !positiveInteger(value.lesson_ordinal) ||
    !positiveInteger(value.timeline_day_number) ||
    !nonEmptyString(value.title) ||
    !nonEmptyString(value.pillar) ||
    (value.state !== "completed" && value.state !== "undone") ||
    !positiveInteger(value.event_sequence) ||
    !nonEmptyString(value.occurred_at)
  ) {
    return null;
  }
  return {
    versionId: value.version_id,
    lessonId: value.lesson_id,
    lessonIdentityId: value.lesson_identity_id,
    lessonOrdinal: value.lesson_ordinal,
    timelineDayNumber: value.timeline_day_number,
    title: value.title,
    pillar: value.pillar,
    state: value.state,
    eventSequence: value.event_sequence,
    occurredAt: value.occurred_at,
  };
}

function parseCompletedOnce(value: unknown): ProgramCompletedOnce | null {
  if (!isRecord(value)) return null;
  if (
    !nonEmptyString(value.lesson_identity_id) ||
    !nonEmptyString(value.first_completed_at) ||
    !nonEmptyString(value.title) ||
    !nonEmptyString(value.pillar)
  ) {
    return null;
  }
  return {
    lessonIdentityId: value.lesson_identity_id,
    firstCompletedAt: value.first_completed_at,
    title: value.title,
    pillar: value.pillar,
  };
}

export function parseProgramVersionedProgress(
  value: unknown,
): ProgramVersionedProgress | null {
  if (!isRecord(value)) return null;
  const modes: ProgramVersionMode[] = [
    "legacy_free",
    "free_snapshot",
    "paid_order",
    "history_only",
    "not_enrolled",
  ];
  if (
    !nonEmptyString(value.program_id) ||
    !nonEmptyString(value.member_id) ||
    typeof value.program_title !== "string" ||
    typeof value.program_uses_versions !== "boolean" ||
    !modes.includes(value.mode as ProgramVersionMode) ||
    typeof value.access_authorized !== "boolean" ||
    !nullableString(value.enrollment_id) ||
    !nullableString(value.content_version_id) ||
    !nullableString(value.started_on) ||
    !nullableString(value.access_started_on) ||
    !isDateKey(value.eastern_today) ||
    !nonNegativeInteger(value.timeline_ceiling) ||
    !nonNegativeInteger(value.paid_ceiling) ||
    !nonNegativeInteger(value.lesson_ceiling) ||
    !nonNegativeInteger(value.cleared_installments) ||
    !nonNegativeInteger(value.installment_count) ||
    !nonNegativeInteger(value.required_count) ||
    !nonNegativeInteger(value.current_completed_count) ||
    !nonNegativeInteger(value.lifetime_completed_count) ||
    typeof value.fully_funded !== "boolean" ||
    !Array.isArray(value.required_lessons) ||
    !Array.isArray(value.accessible_lessons) ||
    !Array.isArray(value.accessible_lesson_ids) ||
    !Array.isArray(value.current_completed_lesson_ids) ||
    !Array.isArray(value.completed_once) ||
    !Array.isArray(value.history)
  ) {
    return null;
  }

  const requiredLessons = value.required_lessons.map(parseRequiredLesson);
  const accessibleLessons = value.accessible_lessons.map(parseAccessibleLesson);
  const completedOnce = value.completed_once.map(parseCompletedOnce);
  const history = value.history.map(parseHistoryEntry);
  if (
    requiredLessons.some((lesson) => lesson === null) ||
    accessibleLessons.some((lesson) => lesson === null) ||
    completedOnce.some((entry) => entry === null) ||
    history.some((entry) => entry === null) ||
    !value.accessible_lesson_ids.every(nonEmptyString) ||
    !value.current_completed_lesson_ids.every(nonEmptyString)
  ) {
    return null;
  }

  const requiredIds = new Set(requiredLessons.map((lesson) => lesson!.id));
  const accessibleIds = new Set(
    accessibleLessons.map((lesson) => lesson!.id),
  );
  if (
    value.accessible_lesson_ids.length !== accessibleIds.size ||
    value.accessible_lesson_ids.some(
      (lessonId) => !requiredIds.has(lessonId) || !accessibleIds.has(lessonId),
    ) ||
    accessibleLessons.some((lesson) => !requiredIds.has(lesson!.id)) ||
    value.current_completed_lesson_ids.some((lessonId) => !requiredIds.has(lessonId))
  ) {
    return null;
  }

  return {
    programId: value.program_id,
    memberId: value.member_id,
    programTitle: value.program_title,
    usesVersionedLessons: value.program_uses_versions,
    mode: value.mode as ProgramVersionMode,
    accessAuthorized: value.access_authorized,
    enrollmentId: value.enrollment_id,
    contentVersionId: value.content_version_id,
    startedOn: value.started_on,
    accessStartedOn: value.access_started_on,
    easternToday: value.eastern_today,
    timelineCeiling: value.timeline_ceiling,
    paidCeiling: value.paid_ceiling,
    lessonCeiling: value.lesson_ceiling,
    clearedInstallments: value.cleared_installments,
    installmentCount: value.installment_count,
    fullyFunded: value.fully_funded,
    requiredCount: value.required_count,
    currentCompletedCount: value.current_completed_count,
    lifetimeCompletedCount: value.lifetime_completed_count,
    requiredLessons: requiredLessons as ProgramRequiredLesson[],
    accessibleLessons: accessibleLessons as ProgramAccessibleLesson[],
    accessibleLessonIds: [...value.accessible_lesson_ids],
    completedLessonIds: [...value.current_completed_lesson_ids],
    completedOnce: completedOnce as ProgramCompletedOnce[],
    history: history as ProgramCompletionHistoryEntry[],
  };
}

export function calculateProgramAccessCeilings(input: {
  lessons: readonly Pick<
    ProgramRequiredLesson,
    "id" | "lessonOrdinal" | "timelineDayNumber"
  >[];
  startedOn: string | null;
  today: string;
  paidCeiling: number;
}): ProgramAccessCeilings {
  const validLessons = [...input.lessons].filter(
    (lesson) =>
      nonEmptyString(lesson.id) &&
      positiveInteger(lesson.lessonOrdinal) &&
      positiveInteger(lesson.timelineDayNumber),
  );
  const dateCeiling = input.startedOn
    ? timelineDay(input.startedOn, input.today)
    : 0;
  const timelineCeiling = validLessons.reduce(
    (ceiling, lesson) =>
      lesson.timelineDayNumber <= dateCeiling
        ? Math.max(ceiling, lesson.lessonOrdinal)
        : ceiling,
    0,
  );
  const totalCount = validLessons.length;
  const paidCeiling = Math.max(
    0,
    Math.min(totalCount, Math.floor(input.paidCeiling)),
  );
  const lessonCeiling = Math.min(timelineCeiling, paidCeiling);
  return {
    timelineCeiling,
    paidCeiling,
    lessonCeiling,
    accessibleLessonIds: validLessons
      .filter(
        (lesson) =>
          lesson.lessonOrdinal <= lessonCeiling &&
          lesson.timelineDayNumber <= dateCeiling,
      )
      .sort((a, b) => a.lessonOrdinal - b.lessonOrdinal)
      .map((lesson) => lesson.id),
  };
}

function timelineDay(startedOn: string, today: string): number {
  if (!isDateKey(startedOn) || !isDateKey(today)) return 0;
  const start = new Date(`${startedOn}T12:00:00Z`).getTime();
  const end = new Date(`${today}T12:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 86_400_000) + 1);
}
