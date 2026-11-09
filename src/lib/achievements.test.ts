import { describe, expect, it } from "vitest";
import {
  coachProgress,
  levelFor,
  memberChallenges,
  memberProgress,
  streaks,
  weekStartKey,
  type MemberActivity,
} from "./achievements";

// Wednesday Nov 11, 2026, 3 PM Eastern.
const now = new Date("2026-11-11T20:00:00Z");
const at = (day: string, hour = 15) =>
  `${day}T${String(hour + 5).padStart(2, "0")}:00:00Z`; // Eastern afternoon

describe("streaks", () => {
  it("counts days in a row up to today", () => {
    expect(
      streaks(["2026-11-09", "2026-11-10", "2026-11-11"], now),
    ).toMatchObject({ current: 3, activeToday: true });
  });

  it("keeps a streak alive until today ends", () => {
    expect(streaks(["2026-11-09", "2026-11-10"], now)).toMatchObject({
      current: 2,
      activeToday: false,
    });
  });

  it("breaks after a missed day but remembers the best run", () => {
    expect(
      streaks(
        ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-09"],
        now,
      ),
    ).toMatchObject({
      current: 0,
      best: 4,
    });
  });

  it("handles no activity", () => {
    expect(streaks([], now)).toEqual({
      current: 0,
      best: 0,
      activeToday: false,
    });
  });
});

describe("weekStartKey", () => {
  it("starts weeks on Monday in Eastern time", () => {
    expect(weekStartKey(now)).toBe("2026-11-09");
    // Late Sunday night Eastern is still the previous week, even though it's Monday in UTC.
    expect(weekStartKey(new Date("2026-11-16T03:00:00Z"))).toBe("2026-11-09");
    expect(weekStartKey(new Date("2026-11-16T15:00:00Z"))).toBe("2026-11-16");
  });
});

describe("levelFor", () => {
  it.each([
    [0, "Rookie", 50],
    [49, "Rookie", 1],
    [50, "Contender", 100],
    [400, "Elite", 600],
    [3000, "Legend", 0],
  ])("%i points is %s", (points, name, toNext) => {
    expect(levelFor(points)).toMatchObject({ name, toNext });
  });

  it("shows progress through the level", () => {
    expect(levelFor(100).progress).toBeCloseTo(0.5);
    expect(levelFor(5000).progress).toBe(1);
  });
});

const member: MemberActivity = {
  completions: [
    { at: at("2026-11-09"), pillar: "mind" },
    { at: at("2026-11-10"), pillar: "body" },
    { at: at("2026-11-11"), pillar: "spirit" },
    { at: at("2026-11-02"), pillar: "body" },
  ],
  memoDays: ["2026-11-09", "2026-11-10", "2026-11-11"],
  going: [at("2026-11-10")],
  messages: [at("2026-11-05")],
  purchases: 1,
  coaches: 1,
  habits: [
    { day: "2026-11-08", pillar: "mind" },
    { day: "2026-11-08", pillar: "body" },
    { day: "2026-11-08", pillar: "spirit" },
  ],
};

describe("memberChallenges", () => {
  it("counts only this week's activity", () => {
    expect(
      memberChallenges(member, now).map((c) => [c.key, c.done, c.goal]),
    ).toEqual([
      ["tasks", 3, 3],
      ["pillars", 3, 3],
      ["memos", 3, 3],
      ["sessions", 1, 1],
    ]);
  });
});

describe("memberProgress", () => {
  const progress = memberProgress(member, now);

  it("scores points like the leaderboard", () => {
    // 4 tasks x3 + 1 session x2 + 1 message + 3 memos + 3 habit check-ins = 21
    expect(progress.points).toBe(21);
    expect(progress.level.name).toBe("Rookie");
  });

  it("tracks the streak across all kinds of activity", () => {
    // Nov 8 (habits) through Nov 11.
    expect(progress.streak).toMatchObject({ current: 4, activeToday: true });
  });

  it("awards the badges that were earned", () => {
    expect(progress.earnedKeys).toEqual(
      expect.arrayContaining([
        "joined_coach",
        "first_task",
        "first_session",
        "first_purchase",
        "week_complete",
      ]),
    );
    expect(progress.earnedKeys).not.toContain("tasks_10");
    expect(progress.earnedKeys).not.toContain("balanced");
  });
});

describe("coachProgress", () => {
  it("scores coaches and awards coach badges", () => {
    const progress = coachProgress(
      {
        videos: [at("2026-11-10")],
        given: [
          { at: at("2026-11-10"), pillar: "mind" },
          { at: at("2026-11-10"), pillar: "body" },
          { at: at("2026-11-11"), pillar: "spirit" },
        ],
        sessions: [at("2026-11-11")],
        messages: [],
        members: 5,
        sales: 1,
      },
      now,
    );
    // 1 video x3 + 5 members x3 + 1 session x2 + 3 tasks x1 = 23
    expect(progress.points).toBe(23);
    expect(progress.earnedKeys).toEqual(
      expect.arrayContaining([
        "first_video",
        "members_5",
        "whole_athlete",
        "first_sale",
      ]),
    );
    expect(progress.earnedKeys).not.toContain("week_complete");
    expect(progress.streak.current).toBe(2);
  });
});

describe("allBadges", () => {
  it("lists every badge once, with a name and description to share", async () => {
    const { allBadges } = await import("./achievements");
    const badges = allBadges();
    expect(badges.length).toBeGreaterThan(0);
    expect(new Set(badges.map((badge) => badge.key)).size).toBe(badges.length);
    for (const badge of badges) {
      expect(badge.name).toBeTruthy();
      expect(badge.description).toBeTruthy();
    }
  });
});
