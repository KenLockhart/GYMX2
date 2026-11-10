import { describe, expect, it } from "vitest";
import {
  introErrorMessage,
  introSlotsSchema,
  repeatWeekly,
  slotsByDay,
} from "./intros";

describe("introSlotsSchema", () => {
  const base = {
    starts: ["2026-12-01T23:00:00.000Z"],
    minutes: "20",
    format: "online",
    location: "",
    meetingUrl: "",
  };
  it("accepts an online time without a place", () => {
    expect(introSlotsSchema.safeParse(base).success).toBe(true);
  });
  it("needs a place for in-person times", () => {
    const result = introSlotsSchema.safeParse({ ...base, format: "in_person" });
    expect(result.success).toBe(false);
  });
  it("rejects odd lengths and non-https links", () => {
    expect(introSlotsSchema.safeParse({ ...base, minutes: "25" }).success).toBe(
      false,
    );
    expect(
      introSlotsSchema.safeParse({ ...base, meetingUrl: "http://x.com" })
        .success,
    ).toBe(false);
  });
  it("limits how many times are added at once", () => {
    const starts = Array.from({ length: 41 }, (_, i) =>
      new Date(Date.UTC(2026, 11, 1, i)).toISOString(),
    );
    expect(introSlotsSchema.safeParse({ ...base, starts }).success).toBe(false);
  });
});

describe("repeatWeekly", () => {
  it("repeats the same time each week, capped at 12 weeks", () => {
    const list = repeatWeekly(new Date("2026-12-01T18:00:00"), 3);
    expect(list).toHaveLength(3);
    expect(new Date(list[2]).getDate()).toBe(15);
    expect(repeatWeekly(new Date(), 50)).toHaveLength(12);
  });
});

describe("slotsByDay", () => {
  it("groups in time order by local day", () => {
    const days = slotsByDay(
      [
        {
          id: "b",
          startsAt: "2026-12-02T15:00:00Z",
          minutes: 20,
          format: "online",
        },
        {
          id: "a",
          startsAt: "2026-12-01T15:00:00Z",
          minutes: 20,
          format: "online",
        },
        {
          id: "c",
          startsAt: "2026-12-01T16:00:00Z",
          minutes: 20,
          format: "online",
        },
      ],
      "UTC",
    );
    expect(days.map((d) => d.slots.map((s) => s.id))).toEqual([
      ["a", "c"],
      ["b"],
    ]);
  });
});

describe("introErrorMessage", () => {
  it("passes through known database messages only", () => {
    expect(
      introErrorMessage("ERROR: You already have an intro with this coach."),
    ).toBe("You already have an intro with this coach.");
    expect(introErrorMessage("relation does not exist")).toBe(
      "That didn't work. Please try again.",
    );
  });
});
