import { describe, expect, it } from "vitest";
import { isMonday, sessionsTomorrowByMember, streakAtRisk, tasksDueTomorrowByMember, tomorrowKey } from "./reminders";

// Monday Nov 9, 2026, 9 AM Eastern.
const now = new Date("2026-11-09T14:00:00Z");

describe("days", () => {
  it("knows tomorrow and Mondays in Eastern time", () => {
    expect(tomorrowKey(now)).toBe("2026-11-10");
    expect(isMonday(now)).toBe(true);
    // 11 PM Sunday Eastern is still Sunday, though it's Monday in UTC.
    expect(isMonday(new Date("2026-11-09T04:00:00Z"))).toBe(false);
  });
});

describe("sessionsTomorrowByMember", () => {
  const sessions = [
    {
      id: "late",
      starts_at: "2026-11-11T00:30:00Z", // Tue 7:30 PM Eastern
      invites: [
        { member_id: "ana", response: "going" },
        { member_id: "ben", response: "not_going" },
      ],
    },
    { id: "early", starts_at: "2026-11-10T12:00:00Z", invites: [{ member_id: "ana", response: "pending" }] },
    { id: "today", starts_at: "2026-11-09T22:00:00Z", invites: [{ member_id: "ana", response: "going" }] },
  ];

  it("groups tomorrow's sessions per member, in time order, skipping can't-go replies", () => {
    const grouped = sessionsTomorrowByMember(sessions, now);
    expect(grouped.get("ana")?.map((session) => session.id)).toEqual(["early", "late"]);
    expect(grouped.has("ben")).toBe(false);
  });
});

describe("tasksDueTomorrowByMember", () => {
  it("finds unfinished Tasks due tomorrow", () => {
    const grouped = tasksDueTomorrowByMember(
      [
        { member_id: "ana", due_on: "2026-11-10", completed_at: null },
        { member_id: "ana", due_on: "2026-11-10", completed_at: "2026-11-09T12:00:00Z" },
        { member_id: "ben", due_on: "2026-11-11", completed_at: null },
      ],
      now,
    );
    expect(grouped.get("ana")).toHaveLength(1);
    expect(grouped.has("ben")).toBe(false);
  });
});

describe("streakAtRisk", () => {
  it.each([
    [{ current: 5, activeToday: false }, true],
    [{ current: 5, activeToday: true }, false],
    [{ current: 2, activeToday: false }, false],
  ])("%o", (streak, risk) => {
    expect(streakAtRisk(streak)).toBe(risk);
  });
});
