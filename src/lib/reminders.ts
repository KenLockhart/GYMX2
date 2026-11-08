// When reminder emails go out and who gets them. Days follow Eastern time, like streaks.
import { dayKey } from "./achievements";

function shiftDay(key: string, days: number) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function todayKey(now = new Date()) {
  return dayKey(now.toISOString());
}

export function tomorrowKey(now = new Date()) {
  return shiftDay(todayKey(now), 1);
}

export function isMonday(now = new Date()) {
  return new Date(`${todayKey(now)}T12:00:00Z`).getUTCDay() === 1;
}

// Sessions starting tomorrow, grouped by invited member. Members who said they can't go are skipped.
export function sessionsTomorrowByMember<
  S extends { id: string; starts_at: string; invites: { member_id: string; response: string }[] },
>(sessions: S[], now = new Date()) {
  const tomorrow = tomorrowKey(now);
  const byMember = new Map<string, S[]>();
  for (const session of sessions) {
    if (dayKey(session.starts_at) !== tomorrow) continue;
    for (const invite of session.invites) {
      if (invite.response === "not_going") continue;
      byMember.set(invite.member_id, [...(byMember.get(invite.member_id) ?? []), session]);
    }
  }
  for (const list of byMember.values()) list.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return byMember;
}

// Unfinished Tasks due tomorrow, grouped by member.
export function tasksDueTomorrowByMember<A extends { member_id: string; due_on: string | null; completed_at: string | null }>(
  assignments: A[],
  now = new Date(),
) {
  const tomorrow = tomorrowKey(now);
  const byMember = new Map<string, A[]>();
  for (const assignment of assignments) {
    if (assignment.completed_at || assignment.due_on !== tomorrow) continue;
    byMember.set(assignment.member_id, [...(byMember.get(assignment.member_id) ?? []), assignment]);
  }
  return byMember;
}

// Worth a nudge: a streak of 3 or more days that ends tonight unless they do something.
export function streakAtRisk(streak: { current: number; activeToday: boolean }) {
  return streak.current >= 3 && !streak.activeToday;
}
