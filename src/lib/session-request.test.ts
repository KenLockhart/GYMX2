import { describe, expect, it } from "vitest";
import {
  localSessionRequestToIso,
  sessionRequestSchema,
} from "./session-request";

describe("session request input", () => {
  it("validates the coach, local date/time, timezone and bounded note", () => {
    expect(
      sessionRequestSchema.safeParse({
        coach_id: "11111111-1111-4111-8111-111111111111",
        day: "2026-11-20",
        time: "18:30",
        time_zone: "America/New_York",
        note: "Please focus on my squat form.",
      }).success,
    ).toBe(true);
    expect(
      sessionRequestSchema.safeParse({
        coach_id: "not-a-uuid",
        day: "2026-11-20",
        time: "18:30",
        time_zone: "America/New_York",
        note: "",
      }).success,
    ).toBe(false);
  });

  it("converts a future local preference using its selected timezone", () => {
    expect(
      localSessionRequestToIso(
        "2026-11-20",
        "18:30",
        "America/New_York",
        new Date("2026-11-17T18:00:00Z"),
      ),
    ).toBe("2026-11-20T23:30:00.000Z");
  });

  it("rejects dates/times in the past and local times skipped by daylight saving", () => {
    const now = new Date("2026-11-17T18:00:00Z");
    expect(
      localSessionRequestToIso("2026-11-17", "10:00", "America/New_York", now),
    ).toBeNull();
    expect(
      localSessionRequestToIso(
        "2026-03-08",
        "02:30",
        "America/New_York",
        new Date("2026-03-07T12:00:00Z"),
      ),
    ).toBeNull();
  });

  it("chooses the earlier occurrence in DST folds, including half-hour zones", () => {
    expect(
      localSessionRequestToIso(
        "2027-10-31",
        "02:30",
        "Europe/Berlin",
        new Date("2027-10-30T00:00:00Z"),
      ),
    ).toBe("2027-10-31T00:30:00.000Z");
    expect(
      localSessionRequestToIso(
        "2026-11-01",
        "01:30",
        "America/New_York",
        new Date("2026-10-31T00:00:00Z"),
      ),
    ).toBe("2026-11-01T05:30:00.000Z");
    expect(
      localSessionRequestToIso(
        "2026-04-05",
        "01:45",
        "Australia/Lord_Howe",
        new Date("2026-04-04T00:00:00Z"),
      ),
    ).toBe("2026-04-04T14:45:00.000Z");
  });

  it("rejects invalid calendar values and unknown timezones", () => {
    const now = new Date("2026-11-17T18:00:00Z");
    expect(
      localSessionRequestToIso("2026-02-30", "18:00", "UTC", now),
    ).toBeNull();
    expect(
      localSessionRequestToIso(
        "2026-11-20",
        "18:00",
        "not/a-timezone",
        now,
      ),
    ).toBeNull();
  });
});
