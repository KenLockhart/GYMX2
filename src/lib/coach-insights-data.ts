import "server-only";
import type {
  ActivityRow,
  AssignmentRow,
  AttendanceRow,
  InviteRow,
  MemberRow,
  ProgramRow,
  SaleRow,
  SubscriptionRow,
} from "@/lib/coach-insights";
import {
  loadProgramCompletedOnceActivity,
  loadProgramProgressSummariesForProgram,
  type ProgramProgressRpcClient,
} from "@/lib/program-progress-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Reads one coach's business with the server key. Callers must check the viewer is that coach or
// an admin. Only what the coach can already see elsewhere: their sales, their members and how
// those members interact with them. Members' private tracking is never read.
export async function loadCoachInsights(coachId: string) {
  const db = createAdminClient();
  const since = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();

  const [
    sales,
    subscriptions,
    links,
    assignments,
    messages,
    posts,
    sessions,
    programs,
  ] = await Promise.all([
    db
      .from("purchases")
      .select(
        "item_id, item_title, amount_cents, fee_cents, kind, refunded_at, created_at",
      )
      .eq("seller_id", coachId)
      .limit(10000),
    db
      .from("subscriptions")
      .select("member_id, price_cents, status, cancel_at_period_end")
      .eq("coach_id", coachId),
    db
      .from("coach_members")
      .select("member_id, created_at, member:profiles!member_id(display_name)")
      .eq("coach_id", coachId),
    db
      .from("task_assignments")
      .select("member_id, completed_at, created_at, task:tasks!inner(coach_id)")
      .eq("task.coach_id", coachId)
      .gte("created_at", since)
      .limit(10000),
    db
      .from("messages")
      .select("sender_id, created_at")
      .eq("coach_id", coachId)
      .neq("sender_id", coachId)
      .gte("created_at", since)
      .limit(10000),
    db
      .from("group_messages")
      .select("sender_id, created_at")
      .eq("coach_id", coachId)
      .neq("sender_id", coachId)
      .gte("created_at", since)
      .limit(10000),
    db
      .from("calendar_sessions")
      .select(
        "id, ends_at, session_invites(member_id, response, responded_at), session_attendance(member_id, joined_at)",
      )
      .eq("coach_id", coachId)
      .gte("ends_at", since)
      .limit(2000),
    db
      .from("programs")
      .select("id, title", { count: "exact" })
      .eq("coach_id", coachId)
      .order("id")
      .limit(200),
  ]);

  const members: MemberRow[] = (
    (links.data ?? []) as unknown as {
      member_id: string;
      created_at: string;
      member: { display_name: string } | null;
    }[]
  ).map((row) => ({
    member_id: row.member_id,
    name: row.member?.display_name ?? "A member",
    joined_at: row.created_at,
  }));

  const sessionRows = (sessions.data ?? []) as unknown as {
    id: string;
    ends_at: string;
    session_invites: {
      member_id: string;
      response: string;
      responded_at: string | null;
    }[];
    session_attendance: { member_id: string; joined_at: string }[];
  }[];
  const programRows = (programs.data ?? []) as unknown as {
    id: string;
    title: string;
  }[];
  if ((programs.count ?? 0) > programRows.length) {
    throw new Error("Program insights exceeded the supported result limit.");
  }
  const assignmentRows = (assignments.data ??
    []) as unknown as (AssignmentRow & { member_id: string })[];

  // Every touchpoint a member has with this coach, for "last active".
  // Weekly check-ins from this coach's members.
  const { data: checkins } = members.length
    ? await db
        .from("checkins")
        .select("member_id, created_at")
        .in(
          "member_id",
          members.map((member) => member.member_id),
        )
        .gte("created_at", since)
        .limit(10000)
    : { data: [] };

  const programProgressClient =
    (await createClient()) as unknown as ProgramProgressRpcClient;
  const programActivity: ActivityRow[] = [];
  const progressByProgram = new Map<
    string,
    Awaited<ReturnType<typeof loadProgramProgressSummariesForProgram>>
  >();
  for (let start = 0; start < programRows.length; start += 8) {
    const batch = programRows.slice(start, start + 8);
    const [summaries, activities] = await Promise.all([
      Promise.all(
        batch.map((program) =>
          loadProgramProgressSummariesForProgram(
            program.id,
            programProgressClient,
          ),
        ),
      ),
      Promise.all(
        batch.map((program) =>
          loadProgramCompletedOnceActivity({
            from: since,
            to: new Date().toISOString(),
            memberIds: members.map((member) => member.member_id),
            programId: program.id,
          }),
        ),
      ),
    ]);
    batch.forEach((program, index) => {
      progressByProgram.set(program.id, summaries[index]);
      programActivity.push(
        ...activities[index].map((row) => ({
          member_id: row.member_id,
          at: row.first_completed_at,
        })),
      );
    });
  }

  const activity: ActivityRow[] = [
    ...(checkins ?? []).map((row) => ({
      member_id: row.member_id as string,
      at: row.created_at as string,
    })),
    ...assignmentRows.flatMap((row) =>
      row.completed_at
        ? [{ member_id: row.member_id, at: row.completed_at }]
        : [],
    ),
    ...(messages.data ?? []).map((row) => ({
      member_id: row.sender_id as string,
      at: row.created_at as string,
    })),
    ...(posts.data ?? []).map((row) => ({
      member_id: row.sender_id as string,
      at: row.created_at as string,
    })),
    ...sessionRows.flatMap((session) => [
      ...session.session_invites.flatMap((invite) =>
        invite.responded_at
          ? [{ member_id: invite.member_id, at: invite.responded_at }]
          : [],
      ),
      ...session.session_attendance.map((row) => ({
        member_id: row.member_id,
        at: row.joined_at,
      })),
    ]),
    ...programActivity,
  ];

  return {
    sales: (sales.data ?? []) as SaleRow[],
    subscriptions: (subscriptions.data ?? []) as SubscriptionRow[],
    members,
    activity,
    assignments: assignmentRows,
    invites: sessionRows.flatMap((session) =>
      session.session_invites.map((invite) => ({
        session_id: session.id,
        member_id: invite.member_id,
        response: invite.response,
        ends_at: session.ends_at,
      })),
    ) satisfies InviteRow[],
    attendance: sessionRows.flatMap((session) =>
      session.session_attendance.map((row) => ({
        session_id: session.id,
        member_id: row.member_id,
      })),
    ) satisfies AttendanceRow[],
    programs: programRows.map((program) => ({
      id: program.id,
      title: program.title,
      enrollments: (progressByProgram.get(program.id) ?? [])
        .filter(
          (row) =>
            row.program_exists &&
            row.mode !== "history_only" &&
            row.mode !== "not_enrolled",
        )
        .map((row) => ({
          done: row.current_completed_count,
          required: row.required_count,
        })),
    })) satisfies ProgramRow[],
  };
}
