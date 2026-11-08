import "server-only";
import {
  badgeInfo,
  coachProgress,
  isPillar,
  memberProgress,
  type Badge,
  type CoachActivity,
  type MemberActivity,
  type Progress,
} from "@/lib/achievements";
import { createAdminClient } from "@/lib/supabase/admin";

// Reads one person's activity with the server key: only IDs and dates, never what they wrote.
// Callers decide who may see the result (the person themselves, or an admin).

export async function loadMemberActivity(
  userId: string,
): Promise<MemberActivity> {
  const db = createAdminClient();
  const [
    completions,
    memos,
    going,
    messages,
    purchases,
    coaches,
    habits,
    programDays,
  ] = await Promise.all([
    db
      .from("task_assignments")
      .select("completed_at, task:tasks(pillar)")
      .eq("member_id", userId)
      .not("completed_at", "is", null)
      .limit(5000),
    db.from("memos").select("memo_date").eq("user_id", userId).limit(5000),
    db
      .from("session_invites")
      .select("responded_at")
      .eq("member_id", userId)
      .eq("response", "going")
      .not("responded_at", "is", null)
      .limit(5000),
    db
      .from("messages")
      .select("created_at")
      .eq("sender_id", userId)
      .limit(5000),
    db
      .from("purchases")
      .select("id", { count: "exact", head: true })
      .eq("member_id", userId)
      .is("refunded_at", null),
    db
      .from("coach_members")
      .select("coach_id", { count: "exact", head: true })
      .eq("member_id", userId),
    db
      .from("habit_logs")
      .select("day, habit:habits(pillar)")
      .eq("user_id", userId)
      .limit(10000),
    db
      .from("program_day_completions")
      .select("completed_at, day:program_days(pillar)")
      .eq("member_id", userId)
      .limit(5000),
  ]);

  return {
    habits: (
      (habits.data ?? []) as unknown as {
        day: string;
        habit: { pillar: string } | null;
      }[]
    ).flatMap((row) =>
      isPillar(row.habit?.pillar)
        ? [{ day: row.day, pillar: row.habit.pillar }]
        : [],
    ),
    completions: (
      (completions.data ?? []) as unknown as {
        completed_at: string;
        task: { pillar: string | null } | null;
      }[]
    )
      .map((row) => ({
        at: row.completed_at,
        pillar: isPillar(row.task?.pillar) ? row.task.pillar : null,
      }))
      // Finished program days count like finished tasks.
      .concat(
        (
          (programDays.data ?? []) as unknown as {
            completed_at: string;
            day: { pillar: string | null } | null;
          }[]
        ).map((row) => ({
          at: row.completed_at,
          pillar: isPillar(row.day?.pillar) ? row.day.pillar : null,
        })),
      ),
    memoDays: (memos.data ?? []).map((row) => row.memo_date as string),
    going: (going.data ?? []).map((row) => row.responded_at as string),
    messages: (messages.data ?? []).map((row) => row.created_at as string),
    purchases: purchases.count ?? 0,
    coaches: coaches.count ?? 0,
  };
}

export async function loadCoachActivity(
  userId: string,
): Promise<CoachActivity> {
  const db = createAdminClient();
  const [videos, given, sessions, messages, members, sales] = await Promise.all(
    [
      db
        .from("videos")
        .select("created_at")
        .eq("coach_id", userId)
        .eq("status", "ready")
        .limit(5000),
      db
        .from("task_assignments")
        .select("created_at, task:tasks!inner(coach_id, pillar)")
        .eq("task.coach_id", userId)
        .limit(5000),
      db
        .from("calendar_sessions")
        .select("created_at")
        .eq("coach_id", userId)
        .limit(5000),
      db
        .from("messages")
        .select("created_at")
        .eq("sender_id", userId)
        .limit(5000),
      db
        .from("coach_members")
        .select("member_id", { count: "exact", head: true })
        .eq("coach_id", userId),
      db
        .from("purchases")
        .select("id", { count: "exact", head: true })
        .eq("seller_id", userId)
        .is("refunded_at", null),
    ],
  );

  return {
    videos: (videos.data ?? []).map((row) => row.created_at as string),
    given: (
      (given.data ?? []) as unknown as {
        created_at: string;
        task: { pillar: string | null } | null;
      }[]
    ).map((row) => ({
      at: row.created_at,
      pillar: isPillar(row.task?.pillar) ? row.task.pillar : null,
    })),
    sessions: (sessions.data ?? []).map((row) => row.created_at as string),
    messages: (messages.data ?? []).map((row) => row.created_at as string),
    members: members.count ?? 0,
    sales: sales.count ?? 0,
  };
}

export type EarnedBadge = Badge & { earned_at: string };

// Saves any badges newly earned and returns the person's full progress. Badges, once earned,
// are kept even if the activity behind them later disappears.
export async function syncProgress(person: {
  id: string;
  role: string;
}): Promise<(Progress & { earned: EarnedBadge[]; newKeys: string[] }) | null> {
  if (person.role !== "member" && person.role !== "coach") return null;

  const progress =
    person.role === "coach"
      ? coachProgress(await loadCoachActivity(person.id))
      : memberProgress(await loadMemberActivity(person.id));

  const db = createAdminClient();
  const { data: saved } = await db
    .from("user_badges")
    .select("badge, earned_at")
    .eq("user_id", person.id);
  const have = new Set((saved ?? []).map((row) => row.badge as string));
  const newKeys = progress.earnedKeys.filter((key) => !have.has(key));
  let added: { badge: string; earned_at: string }[] = [];
  if (newKeys.length) {
    const { data } = await db
      .from("user_badges")
      .upsert(
        newKeys.map((badge) => ({ user_id: person.id, badge })),
        { onConflict: "user_id,badge", ignoreDuplicates: true },
      )
      .select("badge, earned_at");
    added = (data ?? []) as typeof added;
  }

  const earned = [...(saved ?? []), ...added]
    .flatMap((row) => {
      const info = badgeInfo(row.badge as string);
      return info ? [{ ...info, earned_at: row.earned_at as string }] : [];
    })
    .sort((a, b) => b.earned_at.localeCompare(a.earned_at));
  const earnedKeys = new Set(earned.map((badge) => badge.key));

  return {
    ...progress,
    // A badge kept from before (say, last week's Weekly Warrior) still shows as earned.
    badges: progress.badges.map((badge) => ({
      ...badge,
      earned: badge.earned || earnedKeys.has(badge.key),
    })),
    earned,
    newKeys,
  };
}

// Runs a sync without letting a failure affect the action that triggered it.
export async function syncProgressQuietly(person: {
  id: string;
  role: string;
}) {
  try {
    await syncProgress(person);
  } catch (error) {
    console.error("Badge sync failed", error);
  }
}

// Earned badges for several people at once, for showing next to names.
export async function loadBadges(userIds: string[]) {
  const byUser = new Map<string, EarnedBadge[]>();
  if (userIds.length === 0) return byUser;
  const { data } = await createAdminClient()
    .from("user_badges")
    .select("user_id, badge, earned_at")
    .in("user_id", userIds)
    .order("earned_at", { ascending: false });
  for (const row of data ?? []) {
    const info = badgeInfo(row.badge as string);
    if (!info) continue;
    const list = byUser.get(row.user_id as string) ?? [];
    list.push({ ...info, earned_at: row.earned_at as string });
    byUser.set(row.user_id as string, list);
  }
  return byUser;
}
