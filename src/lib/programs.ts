// Program rules: one day unlocks each day after a member starts. Days follow Eastern time.

export { canReadProgramVersionedLesson } from "./program-versioned-progress";

function dayNumberSince(startedOn: string, today: string) {
  const start = new Date(`${startedOn}T12:00:00Z`).getTime();
  const now = new Date(`${today}T12:00:00Z`).getTime();
  return Math.floor((now - start) / (24 * 60 * 60 * 1000)) + 1;
}

// The highest day number open to the member today (day 1 on the day they start).
export function unlockedThrough(startedOn: string, today: string) {
  return Math.max(0, dayNumberSince(startedOn, today));
}

export function weeksLabel(dayCount: number) {
  if (dayCount === 0) return "No days yet";
  const weeks = Math.ceil(dayCount / 7);
  return dayCount < 7 ? `${dayCount} ${dayCount === 1 ? "day" : "days"}` : `${weeks} ${weeks === 1 ? "week" : "weeks"} · ${dayCount} days`;
}

export function progressPercent(done: number, total: number) {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

export type ProgramIntroVideo = {
  id: string;
  creatorId: string;
  status: string;
};

export function canUseProgramIntroVideo(
  video: ProgramIntroVideo | null | undefined,
  creatorId: string,
) {
  return Boolean(
    video &&
      video.id &&
      video.creatorId === creatorId &&
      video.status === "ready",
  );
}

export function canPreviewProgramIntro(input: {
  isOwner: boolean;
  isPublished: boolean;
  programIsVisible: boolean;
  video: ProgramIntroVideo | null | undefined;
  creatorId: string;
}) {
  return (
    input.programIsVisible &&
    (input.isOwner || input.isPublished) &&
    canUseProgramIntroVideo(input.video, input.creatorId)
  );
}

export type ProgramDayEnrollmentAccess = {
  id: string;
  programId: string;
  memberId: string;
  startedOn: string;
};

// requireAccount and the user-scoped Programs RLS queries must succeed before this check.
// Keep day eligibility centralized so later staged unlock rules can extend this decision.
export function canWatchProgramDay(input: {
  viewerId: string;
  viewerRole: "member" | "coach" | "moderator" | "admin";
  program: { id: string; creatorId: string; published: boolean };
  day: { programId: string; dayNumber: number; videoId: string | null };
  enrollment?: ProgramDayEnrollmentAccess | null;
  today: string;
}) {
  if (
    input.day.programId !== input.program.id ||
    !input.day.videoId ||
    !Number.isInteger(input.day.dayNumber) ||
    input.day.dayNumber < 1
  ) {
    return false;
  }

  if (
    input.viewerRole === "admin" ||
    (input.viewerRole === "coach" && input.viewerId === input.program.creatorId)
  ) {
    return true;
  }

  const enrollment = input.enrollment;
  return Boolean(
    input.viewerRole === "member" &&
      input.program.published &&
      enrollment &&
      enrollment.programId === input.program.id &&
      enrollment.memberId === input.viewerId &&
      input.day.dayNumber <= unlockedThrough(enrollment.startedOn, input.today),
  );
}

export function canUseProgramDayVideo(
  video: ProgramIntroVideo | null | undefined,
  input: { dayVideoId: string; creatorId: string },
) {
  return (
    video?.id === input.dayVideoId &&
    canUseProgramIntroVideo(video, input.creatorId)
  );
}

// Where a member is: the first unlocked day they haven't finished, or null if they're caught up.
export function nextDay<D extends { id: string; day_number: number }>(
  days: D[],
  completedIds: Set<string>,
  unlocked: number,
) {
  return days.find((day) => day.day_number <= unlocked && !completedIds.has(day.id)) ?? null;
}
