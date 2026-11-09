import { describe, expect, it } from "vitest";
import { audienceLabel, kindsFor, timeAgo } from "./community";

describe("community helpers", () => {
  it("lets only coaches and admins post announcements and challenges", () => {
    expect(kindsFor("member").map((kind) => kind.value)).not.toContain(
      "announcement",
    );
    expect(kindsFor("coach").map((kind) => kind.value)).toContain(
      "announcement",
    );
    expect(kindsFor("admin").map((kind) => kind.value)).toContain("challenge");
    expect(kindsFor("moderator").map((kind) => kind.value)).not.toContain(
      "challenge",
    );
  });

  it("shows short times", () => {
    const now = new Date("2026-11-09T20:00:00Z");
    expect(timeAgo("2026-11-09T19:59:30Z", now)).toBe("now");
    expect(timeAgo("2026-11-09T19:15:00Z", now)).toBe("45m");
    expect(timeAgo("2026-11-09T15:00:00Z", now)).toBe("5h");
    expect(timeAgo("2026-11-07T20:00:00Z", now)).toBe("2d");
    expect(timeAgo("2026-10-01T20:00:00Z", now)).toBe("Oct 1");
  });

  it("names who can see a post", () => {
    expect(audienceLabel({ audience: "only_me", coach: null })).toBe(
      "Only you",
    );
    expect(
      audienceLabel({
        audience: "coach_community",
        coach: { id: "c", name: "Ken" },
      }),
    ).toBe("Ken's community");
  });
});
