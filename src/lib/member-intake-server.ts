import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { MemberIntakeAnswers, MemberIntakeDraft } from "@/lib/member-intake";
import { memberIntakeAnswersSchema, memberIntakeDraftSchema } from "@/lib/member-intake";
import { idSchema } from "@/lib/validation";

type UserClient = Awaited<ReturnType<typeof createClient>>;

export type MemberCoachIntakeClearance =
  | "cleared"
  | "needs_intake"
  | "needs_booking"
  | "unavailable";

export async function memberCoachIntakeFailure(
  user: UserClient,
  coachId: string,
): Promise<"not_allowed" | "temporarily_unavailable" | null> {
  const clearance = await getMemberCoachIntakeClearance(user, coachId);
  if (clearance === "cleared") return null;
  return clearance === "unavailable" ? "temporarily_unavailable" : "not_allowed";
}

/**
 * Checks only the member's exact coach grant and submission state. It never reads or returns
 * questionnaire answers, and fails closed if any of the required RLS-backed reads fail.
 */
export async function getMemberCoachIntakeClearance(
  user: UserClient,
  coachId: string,
): Promise<MemberCoachIntakeClearance> {
  if (!idSchema.safeParse(coachId).success) return "unavailable";
  try {
    const { data: access, error: accessError } = await user
      .from("intake_coach_access")
      .select("intake_id")
      .eq("coach_id", coachId)
      .maybeSingle();
    if (accessError) return "unavailable";

    if (access?.intake_id) {
      const { data: intake, error: intakeError } = await user
        .from("member_intakes")
        .select("id, status")
        .eq("id", access.intake_id)
        .maybeSingle();
      if (intakeError || !intake) return "unavailable";
      if (intake.status === "completed") return "cleared";

      const { count, error: historyError } = await user
        .from("member_intake_history")
        .select("id", { count: "exact", head: true })
        .eq("intake_id", access.intake_id);
      if (historyError) return "unavailable";
      if ((count ?? 0) > 0) return "cleared";
    }

    const { data: pending, error: pendingError } = await user.rpc(
      "my_pending_intake_bookings",
    );
    if (pendingError || !Array.isArray(pending)) return "unavailable";
    return pending.some(
      (row) =>
        typeof row === "object" &&
        row !== null &&
        "coach_id" in row &&
        row.coach_id === coachId,
    )
      ? "needs_intake"
      : "needs_booking";
  } catch {
    return "unavailable";
  }
}

export type PendingIntakeBooking = {
  coachId: string;
  coachName: string;
  bookingId: string;
  sessionId: string;
  startsAt: string;
  source: "session" | "intro";
  state: "new" | "review";
};

type PendingBookingRow = {
  coach_id: string;
  coach_name: string;
  booking_id: string;
  session_id: string;
  starts_at: string;
  booking_source: string;
  intake_status: string;
};

export async function loadMyPendingIntakeBookings(): Promise<{
  bookings: PendingIntakeBooking[];
  error: boolean;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_pending_intake_bookings");
  if (error) return { bookings: [], error: true };
  return {
    bookings: ((data ?? []) as PendingBookingRow[])
      .filter(
        (row) =>
          row.booking_source === "session" || row.booking_source === "intro",
      )
      .map((row) => ({
        coachId: row.coach_id,
        coachName: row.coach_name,
        bookingId: row.booking_id,
        sessionId: row.session_id,
        startsAt: row.starts_at,
        source: row.booking_source as "session" | "intro",
        state: row.intake_status === "review" ? "review" : "new",
      })),
    error: false,
  };
}

export async function loadMemberIntakeBanner() {
  const result = await loadMyPendingIntakeBookings();
  return {
    coaches: result.bookings.map(({ coachName, startsAt }) => ({
      coachName,
      startsAt,
    })),
    error: result.error,
  };
}

export type OwnerIntakeRecord = {
  id: string;
  status: "draft" | "completed";
  currentStep: number;
  answers: MemberIntakeDraft;
  completedAt: string | null;
  hasSubmittedHistory: boolean;
};

export async function loadMyIntakeRecord(): Promise<OwnerIntakeRecord | null> {
  const supabase = await createClient();
  const [{ data: intake }, { count: historyCount }] = await Promise.all([
    supabase
      .from("member_intakes")
      .select("id, status, current_step, answers, completed_at")
      .maybeSingle(),
    supabase
      .from("member_intake_history")
      .select("id", { count: "exact", head: true }),
  ]);
  if (!intake) return null;
  const parsed = memberIntakeDraftSchema.safeParse(intake.answers);
  if (!parsed.success) return null;
  return {
    id: intake.id as string,
    status: intake.status === "completed" ? "completed" : "draft",
    currentStep: Math.min(8, Math.max(1, Number(intake.current_step) || 1)),
    answers: parsed.data,
    completedAt: (intake.completed_at as string | null) ?? null,
    hasSubmittedHistory: (historyCount ?? 0) > 0,
  };
}

export type CoachIntakeView = {
  status: "pending" | "complete" | "unavailable";
  answers: MemberIntakeAnswers | null;
  completedAt: string | null;
};

function parseCoachAnswers(value: unknown): MemberIntakeAnswers | null {
  const parsed = memberIntakeAnswersSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function loadCoachMemberIntake(
  memberId: string,
): Promise<CoachIntakeView> {
  const supabase = await createClient();
  const { data: status, error: statusError } = await supabase.rpc(
    "coach_member_intake_status",
    { p_member_id: memberId },
  );
  if (statusError) return { status: "unavailable", answers: null, completedAt: null };
  if (status === null) return { status: "unavailable", answers: null, completedAt: null };
  if (status === "pending") return { status: "pending", answers: null, completedAt: null };

  const { data: current, error: currentError } = await supabase
    .from("member_intakes")
    .select("answers, completed_at")
    .eq("member_id", memberId)
    .eq("status", "completed")
    .maybeSingle();
  if (currentError) return { status: "unavailable", answers: null, completedAt: null };
  if (current) {
    return {
      status: "complete",
      answers: parseCoachAnswers(current.answers),
      completedAt: (current.completed_at as string | null) ?? null,
    };
  }

  const { data: history, error: historyError } = await supabase
    .from("member_intake_history")
    .select("answers, completed_at")
    .eq("member_id", memberId)
    .order("snapshot_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (historyError || !history) {
    return { status: "unavailable", answers: null, completedAt: null };
  }
  return {
    status: "complete",
    answers: parseCoachAnswers(history.answers),
    completedAt: (history.completed_at as string | null) ?? null,
  };
}

export type CoachSessionIntakeRow = {
  memberId: string;
  status: "pending" | "complete";
  answers: MemberIntakeAnswers | null;
  completedAt: string | null;
};

export async function loadCoachSessionIntakes(
  sessionId: string,
): Promise<{ rows: CoachSessionIntakeRow[]; error: boolean }> {
  const supabase = await createClient();
  const { data: statuses, error: statusError } = await supabase.rpc(
    "coach_session_intake_status",
    { p_session_id: sessionId },
  );
  if (statusError) return { rows: [], error: true };
  const statusRows = (statuses ?? []) as { member_id: string; intake_status: string }[];
  const completeIds = statusRows
    .filter((row) => row.intake_status === "complete")
    .map((row) => row.member_id);
  if (!completeIds.length) {
    return {
      rows: statusRows.map((row) => ({
        memberId: row.member_id,
        status: "pending",
        answers: null,
        completedAt: null,
      })),
      error: false,
    };
  }

  const [{ data: current, error: currentError }, { data: history, error: historyError }] =
    await Promise.all([
      supabase
        .from("member_intakes")
        .select("member_id, answers, completed_at")
        .in("member_id", completeIds)
        .eq("status", "completed"),
      supabase
        .from("member_intake_history")
        .select("member_id, answers, completed_at, snapshot_at")
        .in("member_id", completeIds)
        .order("snapshot_at", { ascending: false }),
    ]);
  if (currentError || historyError) return { rows: [], error: true };

  const byMember = new Map<string, { answers: unknown; completedAt: string | null }>();
  for (const row of current ?? []) {
    byMember.set(row.member_id as string, {
      answers: row.answers,
      completedAt: (row.completed_at as string | null) ?? null,
    });
  }
  for (const row of history ?? []) {
    const memberId = row.member_id as string;
    if (!byMember.has(memberId)) {
      byMember.set(memberId, {
        answers: row.answers,
        completedAt: (row.completed_at as string | null) ?? null,
      });
    }
  }

  return {
    rows: statusRows.map((row) => {
      if (row.intake_status !== "complete") {
        return { memberId: row.member_id, status: "pending", answers: null, completedAt: null };
      }
      const submitted = byMember.get(row.member_id);
      return {
        memberId: row.member_id,
        status: "complete",
        answers: submitted ? parseCoachAnswers(submitted.answers) : null,
        completedAt: submitted?.completedAt ?? null,
      };
    }),
    error: false,
  };
}
