import { describe, expect, it } from "vitest";
import {
  chooseDailyContent,
  chooseTextDailyContent,
  dailyContentItemInputSchema,
  isDailyContentVideoVisibility,
  isValidDailyContentScheduleDay,
} from "./daily-content";

const videoId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("Daily Content input and selection rules", () => {
  it("accepts each bounded content kind and preserves a blank item id for new drafts", () => {
    expect(dailyContentItemInputSchema.safeParse({
      itemId: "",
      kind: "video",
      title: "Movement Basics",
      videoId,
      quoteText: "",
      quoteAttribution: "",
      affirmationText: "",
    })).toMatchObject({ success: true, data: { itemId: null, videoId } });

    expect(dailyContentItemInputSchema.safeParse({
      itemId: null,
      kind: "quote",
      title: "Quote",
      videoId: null,
      quoteText: "A steady practice builds strength.",
      quoteAttribution: "Coach Lee",
      affirmationText: "",
    }).success).toBe(true);

    expect(dailyContentItemInputSchema.safeParse({
      itemId: null,
      kind: "affirmation",
      title: "Daily reminder",
      videoId: null,
      quoteText: "",
      quoteAttribution: "",
      affirmationText: "I can take one useful step today.",
    }).success).toBe(true);
  });

  it("rejects empty or mixed content and enforces the text limits", () => {
    const base = {
      itemId: null,
      kind: "quote",
      title: "Quote",
      videoId: null,
      quoteText: "",
      quoteAttribution: "",
      affirmationText: "",
    };
    expect(dailyContentItemInputSchema.safeParse(base).success).toBe(false);
    expect(dailyContentItemInputSchema.safeParse({ ...base, quoteText: "q".repeat(501) }).success).toBe(false);
    expect(dailyContentItemInputSchema.safeParse({
      ...base,
      quoteText: "Valid quote",
      affirmationText: "Mixed field",
    }).success).toBe(false);
    expect(dailyContentItemInputSchema.safeParse({
      ...base,
      quoteText: "Valid quote",
      quoteAttribution: "a".repeat(121),
    }).success).toBe(false);
  });

  it("uses a legacy video first, otherwise the coach slot before admin fallback", () => {
    const legacy = { id: "legacy" };
    const coach = { value: { id: "coach" }, slotId: "coach-slot" };
    const admin = { value: { id: "admin" }, slotId: "admin-slot" };
    expect(chooseDailyContent({ legacyVideo: legacy, coach, admin })).toEqual({ value: legacy });
    expect(chooseDailyContent({ coach, admin })).toBe(coach);
    expect(chooseDailyContent({ coach: null, admin })).toBe(admin);
  });

  it("uses coach text before admin text and accepts only current member/private video visibility", () => {
    const coach = { value: "coach text", revisionId: "c" };
    const admin = { value: "admin text", revisionId: "a" };
    expect(chooseTextDailyContent({ coach, admin })).toBe(coach);
    expect(chooseTextDailyContent({ coach: null, admin })).toBe(admin);
    expect(isDailyContentVideoVisibility("members")).toBe(true);
    expect(isDailyContentVideoVisibility("private")).toBe(true);
    expect(isDailyContentVideoVisibility("program_only")).toBe(false);
    expect(isDailyContentVideoVisibility(undefined)).toBe(false);
  });

  it("allows today and future Eastern dates only within one year", () => {
    expect(isValidDailyContentScheduleDay("2026-11-19", "2026-11-19")).toBe(true);
    expect(isValidDailyContentScheduleDay("2026-11-20", "2026-11-19")).toBe(true);
    expect(isValidDailyContentScheduleDay("2026-11-18", "2026-11-19")).toBe(false);
    expect(isValidDailyContentScheduleDay("2027-11-20", "2026-11-19")).toBe(false);
    expect(isValidDailyContentScheduleDay("2026-02-30", "2026-02-01")).toBe(false);
  });
});
