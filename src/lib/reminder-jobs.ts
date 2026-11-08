import "server-only";
import {
  coachChallenges,
  coachProgress,
  memberChallenges,
  memberProgress,
  type Challenge,
} from "@/lib/achievements";
import { loadCoachActivity, loadMemberActivity } from "@/lib/achievements-data";
import { formatEmailSessionTime } from "@/lib/calendar";
import { loadRecipient, sendEmail } from "@/lib/email";
import {
  sessionReminderEmail,
  streakReminderEmail,
  taskDueEmail,
  weeklyDigestEmail,
  type Email,
} from "@/lib/email-templates";
import {
  isMonday,
  sessionsTomorrowByMember,
  streakAtRisk,
  tasksDueTomorrowByMember,
  todayKey,
  tomorrowKey,
} from "@/lib/reminders";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/supabase/env";

type Kind = "session" | "task" | "streak" | "weekly";

// Sends one reminder at most once: the log row is claimed first, and only the run that claims it
// sends. People who turned off message and session emails get no reminders.
async function sendOnce(
  userId: string,
  kind: Kind,
  ref: string,
  build: (name: string) => Email | null,
) {
  const person = await loadRecipient(userId);
  if (!person?.wantsUpdates) return false;
  const email = build(person.name);
  if (!email) return false;
  const { data, error } = await createAdminClient()
    .from("reminder_log")
    .upsert(
      { user_id: userId, kind, ref },
      { onConflict: "user_id,kind,ref", ignoreDuplicates: true },
    )
    .select("user_id");
  if (error || !data?.length) return false;
  return sendEmail(person.email, email);
}

async function remindSessions(now: Date) {
  const db = createAdminClient();
  const { data } = await db
    .from("calendar_sessions")
    .select(
      "id, title, starts_at, ends_at, location, coach:profiles!coach_id(display_name), invites:session_invites(member_id, response)",
    )
    .gte("starts_at", now.toISOString())
    .lte(
      "starts_at",
      new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(),
    )
    .limit(2000);
  const sessions = (data ?? []) as unknown as {
    id: string;
    title: string;
    starts_at: string;
    ends_at: string;
    location: string;
    coach: { display_name: string } | null;
    invites: { member_id: string; response: string }[];
  }[];

  let sent = 0;
  for (const [memberId, list] of sessionsTomorrowByMember(sessions, now)) {
    const ok = await sendOnce(memberId, "session", tomorrowKey(now), (name) =>
      sessionReminderEmail({
        siteUrl: getSiteUrl(),
        name,
        sessions: list.map((session) => ({
          id: session.id,
          title: session.title,
          when: formatEmailSessionTime(session.starts_at, session.ends_at),
          where: session.location,
          coachName: session.coach?.display_name ?? "your coach",
        })),
      }),
    );
    if (ok) sent += 1;
  }
  return sent;
}

async function remindTasks(now: Date) {
  const { data } = await createAdminClient()
    .from("task_assignments")
    .select(
      "member_id, due_on, completed_at, task:tasks(title, coach:profiles!coach_id(display_name))",
    )
    .eq("due_on", tomorrowKey(now))
    .is("completed_at", null)
    .limit(5000);
  const rows = (data ?? []) as unknown as {
    member_id: string;
    due_on: string | null;
    completed_at: string | null;
    task: { title: string; coach: { display_name: string } | null } | null;
  }[];

  let sent = 0;
  for (const [memberId, list] of tasksDueTomorrowByMember(rows, now)) {
    const ok = await sendOnce(memberId, "task", tomorrowKey(now), (name) =>
      taskDueEmail({
        siteUrl: getSiteUrl(),
        name,
        tasks: list.map((row) => ({
          title: row.task?.title ?? "A Task",
          coachName: row.task?.coach?.display_name ?? "your coach",
        })),
      }),
    );
    if (ok) sent += 1;
  }
  return sent;
}

async function people(role: "member" | "coach") {
  const { data } = await createAdminClient()
    .from("profiles")
    .select("id")
    .eq("role", role)
    .limit(10000);
  return (data ?? []).map((row) => row.id as string);
}

// The week ahead: sessions (and, for members, Tasks due), soonest first, at most five.
async function upcomingFor(
  userId: string,
  role: "member" | "coach",
  now: Date,
) {
  const db = createAdminClient();
  const until = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const lines: { at: string; text: string }[] = [];
  if (role === "coach") {
    const { data } = await db
      .from("calendar_sessions")
      .select("title, starts_at, ends_at")
      .eq("coach_id", userId)
      .gte("starts_at", now.toISOString())
      .lte("starts_at", until)
      .order("starts_at")
      .limit(5);
    for (const row of data ?? []) {
      lines.push({
        at: row.starts_at,
        text: `${row.title} · ${formatEmailSessionTime(row.starts_at, row.ends_at)}`,
      });
    }
  } else {
    const [{ data: invites }, { data: tasks }] = await Promise.all([
      db
        .from("session_invites")
        .select(
          "response, session:calendar_sessions!inner(title, starts_at, ends_at)",
        )
        .eq("member_id", userId)
        .neq("response", "not_going")
        .gte("session.starts_at", now.toISOString())
        .lte("session.starts_at", until)
        .limit(5),
      db
        .from("task_assignments")
        .select("due_on, task:tasks(title)")
        .eq("member_id", userId)
        .is("completed_at", null)
        .gte("due_on", todayKey(now))
        .lte("due_on", until.slice(0, 10))
        .limit(5),
    ]);
    for (const row of (invites ?? []) as unknown as {
      session: { title: string; starts_at: string; ends_at: string };
    }[]) {
      lines.push({
        at: row.session.starts_at,
        text: `${row.session.title} · ${formatEmailSessionTime(row.session.starts_at, row.session.ends_at)}`,
      });
    }
    for (const row of (tasks ?? []) as unknown as {
      due_on: string;
      task: { title: string } | null;
    }[]) {
      lines.push({
        at: `${row.due_on}T23:59:00Z`,
        text: `Task due ${row.due_on.slice(5).replace("-", "/")}: ${row.task?.title ?? "a Task"}`,
      });
    }
  }
  return lines
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, 5)
    .map((line) => line.text);
}

function challengeLines(challenges: Challenge[]) {
  return challenges.map(
    (challenge) => `${challenge.title} (goal ${challenge.goal})`,
  );
}

// Monday morning: how last week went, and what's ahead.
async function sendWeeklyDigests(now: Date) {
  const lastWeek = new Date(now.getTime() - 12 * 60 * 60 * 1000); // Sunday evening
  const weekAgo = new Date(
    now.getTime() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const db = createAdminClient();
  let sent = 0;

  for (const role of ["member", "coach"] as const) {
    for (const userId of await people(role)) {
      try {
        let progress;
        let previous: Challenge[];
        if (role === "member") {
          const activity = await loadMemberActivity(userId);
          progress = memberProgress(activity, now);
          previous = memberChallenges(activity, lastWeek);
        } else {
          const activity = await loadCoachActivity(userId);
          progress = coachProgress(activity, now);
          previous = coachChallenges(activity, lastWeek);
        }
        const { data: recentBadges } = await db
          .from("user_badges")
          .select("badge")
          .eq("user_id", userId)
          .gte("earned_at", weekAgo);
        const upcoming = await upcomingFor(userId, role, now);
        const newBadges = progress.badges
          .filter((badge) =>
            (recentBadges ?? []).some((row) => row.badge === badge.key),
          )
          .map((badge) => `${badge.icon} ${badge.name}`);

        const ok = await sendOnce(userId, "weekly", todayKey(now), (name) =>
          weeklyDigestEmail({
            siteUrl: getSiteUrl(),
            name,
            level: progress.level.name,
            points: progress.points,
            toNext: progress.level.toNext,
            nextLevel: progress.level.next,
            streak: progress.streak.current,
            lastWeekDone: previous.filter(
              (challenge) => challenge.done >= challenge.goal,
            ).length,
            challengeCount: previous.length,
            newBadges,
            challenges: challengeLines(progress.challenges),
            upcoming,
          }),
        );
        if (ok) sent += 1;
      } catch (error) {
        console.error("Weekly digest failed", userId, error);
      }
    }
  }
  return sent;
}

// Evening: anyone whose streak of 3+ days ends tonight unless they do something.
async function remindStreaks(now: Date) {
  let sent = 0;
  for (const role of ["member", "coach"] as const) {
    for (const userId of await people(role)) {
      try {
        const progress =
          role === "member"
            ? memberProgress(await loadMemberActivity(userId), now)
            : coachProgress(await loadCoachActivity(userId), now);
        if (!streakAtRisk(progress.streak)) continue;
        const ok = await sendOnce(userId, "streak", todayKey(now), (name) =>
          streakReminderEmail({
            siteUrl: getSiteUrl(),
            name,
            days: progress.streak.current,
            coach: role === "coach",
          }),
        );
        if (ok) sent += 1;
      } catch (error) {
        console.error("Streak reminder failed", userId, error);
      }
    }
  }
  return sent;
}

export async function runMorningReminders(now = new Date()) {
  const result = {
    sessions: await remindSessions(now),
    tasks: await remindTasks(now),
    weekly: 0,
  };
  if (isMonday(now)) result.weekly = await sendWeeklyDigests(now);
  return result;
}

export async function runEveningReminders(now = new Date()) {
  return { streaks: await remindStreaks(now) };
}
