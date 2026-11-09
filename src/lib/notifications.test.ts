import { describe, expect, it } from "vitest";
import {
  describeNotification,
  groupByDay,
  NOTIFICATION_SETTINGS,
  safeLink,
} from "./notifications";

describe("describeNotification", () => {
  it("groups people who did the same thing", () => {
    expect(
      describeNotification({ type: "like", actorName: "Jordan", count: 1 }),
    ).toBe("Jordan liked your post");
    expect(
      describeNotification({ type: "like", actorName: "Jordan", count: 2 }),
    ).toBe("Jordan and 1 other liked your post");
    expect(
      describeNotification({ type: "comment", actorName: "Sam", count: 4 }),
    ).toBe("Sam and 3 others commented on your post");
  });

  it("words each type", () => {
    expect(
      describeNotification({ type: "reply", actorName: "Ana", count: 1 }),
    ).toBe("Ana replied to your comment");
    expect(
      describeNotification({
        type: "progress_reply",
        actorName: "Ana",
        count: 1,
      }),
    ).toContain("progress post");
    expect(
      describeNotification({
        type: "announcement",
        actorName: "Coach Lee",
        count: 1,
      }),
    ).toBe("Coach Lee posted an announcement");
    expect(
      describeNotification({
        type: "removed",
        actorName: "Coach Lee",
        count: 1,
      }),
    ).not.toContain("Coach Lee");
  });
});

describe("groupByDay", () => {
  it("labels today, yesterday and older dates, keeping order", () => {
    const now = new Date("2026-11-09T18:00:00");
    const groups = groupByDay(
      [
        { id: "a", updatedAt: "2026-11-09T09:00:00" },
        { id: "b", updatedAt: "2026-11-09T08:00:00" },
        { id: "c", updatedAt: "2026-11-08T20:00:00" },
        { id: "d", updatedAt: "2026-10-30T10:00:00" },
        { id: "e", updatedAt: "2025-12-30T10:00:00" },
      ],
      now,
    );
    expect(groups.map((group) => group.label)).toEqual([
      "Today",
      "Yesterday",
      "October 30",
      "December 30, 2025",
    ]);
    expect(groups[0].items.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("safeLink", () => {
  it("keeps in-app links and refuses anything else", () => {
    expect(safeLink("/community/post/abc#comments")).toBe(
      "/community/post/abc#comments",
    );
    expect(safeLink("//evil.example")).toBe("/community");
    expect(safeLink("https://evil.example")).toBe("/community");
    expect(safeLink('/x"onmouseover=alert(1)')).toBe("/community");
  });
});

describe("notification settings", () => {
  it("lists each type once, with likes off for push by default", () => {
    const types = NOTIFICATION_SETTINGS.map((s) => s.type);
    expect(new Set(types).size).toBe(types.length);
    expect(
      NOTIFICATION_SETTINGS.find((s) => s.type === "like")?.defaultPush,
    ).toBe(false);
  });
});
