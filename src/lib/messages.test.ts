import { describe, expect, it } from "vitest";
import { groupForReview, otherPerson, preview, summarizeConversations } from "./messages";

const me = "coach";
const message = (overrides: Partial<{
  coach_id: string;
  member_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
}>) => ({
  coach_id: "coach",
  member_id: "ana",
  sender_id: "ana",
  body: "Hi",
  created_at: "2026-11-08T10:00:00Z",
  read_at: null,
  ...overrides,
});

describe("otherPerson", () => {
  it("finds the member when the viewer is the coach", () => {
    expect(otherPerson({ coach_id: "coach", member_id: "ana" }, "coach")).toBe("ana");
  });

  it("finds the coach when the viewer is the member", () => {
    expect(otherPerson({ coach_id: "coach", member_id: "ana" }, "ana")).toBe("coach");
  });
});

describe("summarizeConversations", () => {
  const contacts = [
    { id: "ana", display_name: "Ana", connected: true },
    { id: "ben", display_name: "Ben", connected: true },
    { id: "cy", display_name: "Cy", connected: true },
  ];

  const rows = summarizeConversations(
    contacts,
    [
      message({ member_id: "ana", sender_id: "ana", body: "First", created_at: "2026-11-08T10:00:00Z" }),
      message({ member_id: "ana", sender_id: "coach", body: "Reply", created_at: "2026-11-08T11:00:00Z" }),
      message({ member_id: "ben", sender_id: "ben", body: "Newest", created_at: "2026-11-08T12:00:00Z" }),
      message({ member_id: "ben", sender_id: "ben", body: "Read", created_at: "2026-11-08T09:00:00Z", read_at: "2026-11-08T09:30:00Z" }),
    ],
    me,
  );

  it("puts the newest conversation first and people without messages last", () => {
    expect(rows.map((row) => row.id)).toEqual(["ben", "ana", "cy"]);
  });

  it("shows the latest message", () => {
    expect(rows[1].last?.body).toBe("Reply");
  });

  it("counts only unread messages from the other person", () => {
    expect(rows.find((row) => row.id === "ana")?.unread).toBe(1);
    expect(rows.find((row) => row.id === "ben")?.unread).toBe(1);
  });

  it("keeps past conversations with people no longer connected", () => {
    const [former] = summarizeConversations(
      [],
      [message({ member_id: "dee" })],
      me,
      new Map([["dee", "Dee"]]),
    );
    expect(former).toMatchObject({ id: "dee", display_name: "Dee", connected: false, unread: 1 });
  });
});

describe("preview", () => {
  it("keeps short messages on one line", () => {
    expect(preview("See you\nat 9")).toBe("See you at 9");
  });

  it("shortens long messages", () => {
    expect(preview("a".repeat(100), 10)).toBe(`${"a".repeat(9)}…`);
  });
});

describe("groupForReview", () => {
  const rows = groupForReview([
    { ...message({ member_id: "ana", body: "Old", created_at: "2026-11-08T08:00:00Z" }), coach: { display_name: "Coach" }, member: { display_name: "Ana" } },
    { ...message({ member_id: "ben", body: "Newest", created_at: "2026-11-08T12:00:00Z" }), coach: { display_name: "Coach" }, member: { display_name: "Ben" } },
    { ...message({ member_id: "ana", body: "Later", created_at: "2026-11-08T09:00:00Z" }), coach: { display_name: "Coach" }, member: { display_name: "Ana" } },
  ]);

  it("makes one row per coach and member pair, most recent first", () => {
    expect(rows.map((row) => row.member_name)).toEqual(["Ben", "Ana"]);
  });

  it("counts messages and keeps the latest", () => {
    expect(rows[1]).toMatchObject({ count: 2, last: { body: "Later" } });
  });
});

describe("groupForReview flags", () => {
  const messages = [
    { ...message({ member_id: "ana", body: "Venmo me", created_at: "2026-11-08T08:00:00Z" }), member: { display_name: "Ana" } },
    { ...message({ member_id: "ana", body: "Nice work", created_at: "2026-11-08T13:00:00Z" }), member: { display_name: "Ana" } },
    { ...message({ member_id: "ben", body: "Text me at 404-555-0123", created_at: "2026-11-08T10:00:00Z" }), member: { display_name: "Ben" } },
    { ...message({ member_id: "cy", body: "Leg day", created_at: "2026-11-08T14:00:00Z" }), member: { display_name: "Cy" } },
  ];

  it("counts flagged messages and the kinds found", () => {
    const ana = groupForReview(messages).find((row) => row.member_name === "Ana");
    expect(ana).toMatchObject({ count: 2, flagged: 1, flags: ["payment"], last_flagged_at: "2026-11-08T08:00:00Z" });
  });

  it("keeps only flagged pairs, most recently flagged first", () => {
    const rows = groupForReview(messages, { flaggedOnly: true });
    expect(rows.map((row) => row.member_name)).toEqual(["Ben", "Ana"]);
    expect(rows[0].flags).toEqual(["phone", "off_platform"]);
  });
});
