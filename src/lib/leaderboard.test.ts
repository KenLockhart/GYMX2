import { describe, expect, it } from "vitest";
import { buildLeaderboards, rangeStart, type ActivityRows } from "./leaderboard";

const people = [
  { id: "admin", display_name: "Admin", role: "admin" },
  { id: "ken", display_name: "Ken", role: "coach" },
  { id: "lia", display_name: "Lia", role: "coach" },
  { id: "ana", display_name: "Ana", role: "member" },
  { id: "ben", display_name: "Ben", role: "member" },
  { id: "cy", display_name: "Cy", role: "member" },
];
const sale = { item_id: "shirt", item_title: "Tee", amount_cents: 5000, fee_cents: 500, refunded_at: null };
const rows: ActivityRows = {
  people,
  completions: [{ member_id: "ana" }, { member_id: "ana" }, { member_id: "ben" }],
  assigned: [{ coach_id: "ken" }, { coach_id: "ken" }, { coach_id: "ken" }],
  going: [{ member_id: "ben" }, { member_id: "ben" }],
  sessions: [{ coach_id: "lia" }],
  messages: [{ sender_id: "ana" }, { sender_id: "ken" }, { sender_id: "admin" }],
  memos: [{ user_id: "cy" }],
  videos: [{ coach_id: "ken" }],
  joins: [{ coach_id: "lia", member_id: "ana" }],
  sales: [
    { ...sale, member_id: "ana", seller_id: "ken" },
    { ...sale, member_id: "ana", seller_id: "admin", item_id: "cap", item_title: "Cap", amount_cents: 2000, fee_cents: 2000 },
    { ...sale, member_id: "ben", seller_id: "ken" },
    { ...sale, member_id: "ben", seller_id: "ken", refunded_at: "2026-11-08" },
    { ...sale, member_id: null, seller_id: "lia", item_id: null, item_title: "Old plan", amount_cents: 1000, fee_cents: 100 },
  ],
};

describe("buildLeaderboards", () => {
  const boards = buildLeaderboards(rows);

  it("ranks members by points for tasks, sessions, messages and memos", () => {
    // Ana: 2 tasks (6) + 1 message (1) = 7. Ben: 1 task (3) + 2 sessions (4) = 7. Cy: 1 memo = 1.
    expect(boards.members.map((row) => [row.name, row.score])).toEqual([
      ["Ana", 7],
      ["Ben", 7],
      ["Cy", 1],
    ]);
  });

  it("ranks coaches by videos, new members, sessions, tasks and messages", () => {
    // Ken: 1 video (3) + 3 tasks (3) + 1 message (1) = 7. Lia: 1 new member (3) + 1 session (2) = 5.
    expect(boards.coaches.map((row) => [row.name, row.score])).toEqual([
      ["Ken", 7],
      ["Lia", 5],
    ]);
  });

  it("leaves admins out of the activity boards", () => {
    expect([...boards.members, ...boards.coaches].map((row) => row.id)).not.toContain("admin");
  });

  it("ranks buyers by spend, without refunds or deleted accounts", () => {
    expect(boards.buyers.map((row) => [row.name, row.orders, row.cents])).toEqual([
      ["Ana", 2, 7000],
      ["Ben", 1, 5000],
    ]);
  });

  it("ranks sellers by sales, grouping GYMX2's own items", () => {
    expect(boards.sellers.map((row) => [row.name, row.sales, row.cents, row.earned])).toEqual([
      ["Ken", 2, 10000, 9000],
      ["GYMX2", 1, 2000, 0],
      ["Lia", 1, 1000, 900],
    ]);
  });

  it("ranks items by number sold, keeping removed items by title", () => {
    expect(boards.items.map((row) => [row.title, row.sold])).toEqual([
      ["Tee", 2],
      ["Cap", 1],
      ["Old plan", 1],
    ]);
  });

  it("limits each board", () => {
    expect(buildLeaderboards(rows, 1).members).toHaveLength(1);
  });
});

describe("rangeStart", () => {
  const now = new Date("2026-11-08T12:00:00Z");

  it("defaults to 30 days", () => {
    expect(rangeStart(undefined, now)).toMatchObject({ range: { value: "30" }, since: "2026-10-09T12:00:00.000Z" });
  });

  it("supports all time", () => {
    expect(rangeStart("all", now).since).toBeNull();
  });
});
