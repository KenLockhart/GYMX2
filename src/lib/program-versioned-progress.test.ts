import { describe, expect, it } from "vitest";
import {
  calculateProgramAccessCeilings,
  parseProgramVersionedProgress,
} from "./program-versioned-progress";
import { canReadProgramVersionedLesson } from "./programs";

const required = [
  { id: "lesson-1", source_day_id: "day-1", lesson_ordinal: 1, timeline_day_number: 1, title: "First", pillar: "body" },
  { id: "lesson-2", source_day_id: "day-10", lesson_ordinal: 2, timeline_day_number: 10, title: "Second", pillar: "mind" },
  { id: "lesson-3", source_day_id: "day-20", lesson_ordinal: 3, timeline_day_number: 20, title: "Third", pillar: "spirit" },
];

function payload(overrides: Record<string, unknown> = {}) {
  return {
    program_id: "program-1",
    member_id: "member-1",
    program_title: "Three steps",
    program_uses_versions: true,
    mode: "paid_order",
    access_authorized: true,
    enrollment_id: null,
    content_version_id: "version-1",
    started_on: null,
    access_started_on: "2026-11-01",
    eastern_today: "2026-11-10",
    timeline_ceiling: 2,
    paid_ceiling: 2,
    lesson_ceiling: 2,
    cleared_installments: 2,
    installment_count: 3,
    fully_funded: false,
    required_count: 3,
    current_completed_count: 1,
    lifetime_completed_count: 1,
    required_lessons: required,
    accessible_lessons: [
      { ...required[0], instructions: "Step one" },
      { ...required[1], instructions: "Step two" },
    ],
    accessible_lesson_ids: ["lesson-1", "lesson-2"],
    current_completed_lesson_ids: ["lesson-1"],
    completed_once: [
      {
        lesson_identity_id: "day-1",
        first_completed_at: "2026-11-01T15:00:00.000Z",
        title: "First",
        pillar: "body",
      },
    ],
    history: [
      {
        version_id: "version-1",
        lesson_id: "lesson-1",
        lesson_identity_id: "day-1",
        lesson_ordinal: 1,
        timeline_day_number: 1,
        title: "First",
        pillar: "body",
        state: "completed",
        event_sequence: 1,
        occurred_at: "2026-11-01T15:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("Program versioned progress parsing", () => {
  it("keeps required metadata separate from accessible lesson instructions", () => {
    const parsed = parseProgramVersionedProgress(payload());
    expect(parsed?.requiredLessons).toHaveLength(3);
    expect(parsed?.accessibleLessons.map((lesson) => lesson.id)).toEqual([
      "lesson-1",
      "lesson-2",
    ]);
    expect(canReadProgramVersionedLesson(parsed, "lesson-2")).toBe(true);
    expect(canReadProgramVersionedLesson(parsed, "lesson-3")).toBe(false);
  });

  it("does not turn coach/history-only metadata into accessible content", () => {
    const parsed = parseProgramVersionedProgress(
      payload({ mode: "history_only", access_authorized: false, accessible_lessons: [], accessible_lesson_ids: [] }),
    );
    expect(parsed).not.toBeNull();
    expect(canReadProgramVersionedLesson(parsed, "lesson-1")).toBe(false);
  });

  it("rejects accessible instructions for an ID outside the immutable required lesson set", () => {
    const invalid = payload({
      accessible_lessons: [
        { id: "foreign-lesson", source_day_id: null, lesson_ordinal: 99, timeline_day_number: 99, title: "Private", pillar: "body", instructions: "secret" },
      ],
      accessible_lesson_ids: ["foreign-lesson"],
    });
    expect(parseProgramVersionedProgress(invalid)).toBeNull();
  });

  it("rejects malformed counts and client-shaped completion facts", () => {
    expect(parseProgramVersionedProgress(payload({ current_completed_count: -1 }))).toBeNull();
    expect(
      parseProgramVersionedProgress(
        payload({ completed_once: [{ lesson_identity_id: "day-1", first_completed_at: "today" }] }),
      ),
    ).toBeNull();
  });
});

describe("versioned timeline and payment ceilings", () => {
  it("uses sparse immutable timeline day numbers, not dense ordinals", () => {
    const result = calculateProgramAccessCeilings({
      lessons: required.map((lesson) => ({
        id: lesson.id,
        lessonOrdinal: lesson.lesson_ordinal,
        timelineDayNumber: lesson.timeline_day_number,
      })),
      startedOn: "2026-11-01",
      today: "2026-11-10",
      paidCeiling: 2,
    });
    expect(result.timelineCeiling).toBe(2);
    expect(result.paidCeiling).toBe(2);
    expect(result.lessonCeiling).toBe(2);
    expect(result.accessibleLessonIds).toEqual(["lesson-1", "lesson-2"]);
  });

  it("keeps later timeline lessons locked when the daily timeline is behind the paid stage", () => {
    const result = calculateProgramAccessCeilings({
      lessons: required.map((lesson) => ({
        id: lesson.id,
        lessonOrdinal: lesson.lesson_ordinal,
        timelineDayNumber: lesson.timeline_day_number,
      })),
      startedOn: "2026-11-01",
      today: "2026-11-03",
      paidCeiling: 3,
    });
    expect(result.paidCeiling).toBe(3);
    expect(result.timelineCeiling).toBe(1);
    expect(result.lessonCeiling).toBe(1);
    expect(result.accessibleLessonIds).toEqual(["lesson-1"]);
  });

  it("fails closed when a pinned paid timeline has no trusted start date", () => {
    const result = calculateProgramAccessCeilings({
      lessons: required.map((lesson) => ({
        id: lesson.id,
        lessonOrdinal: lesson.lesson_ordinal,
        timelineDayNumber: lesson.timeline_day_number,
      })),
      startedOn: null,
      today: "2026-11-20",
      paidCeiling: 3,
    });
    expect(result.lessonCeiling).toBe(0);
    expect(result.accessibleLessonIds).toEqual([]);
  });
});
