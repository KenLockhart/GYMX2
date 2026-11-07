import { describe, expect, it } from "vitest";
import { formatDate, formatDuration } from "./format";

describe("formatDate", () => {
  it("keeps the calendar day", () => {
    expect(formatDate("2026-12-01")).toBe("Tue, Dec 1, 2026");
  });
});

describe("formatDuration", () => {
  it("shows minutes and seconds", () => {
    expect(formatDuration(125.4)).toBe("2:05");
  });

  it.each([null, 0, -1])("hides %s", (seconds) => {
    expect(formatDuration(seconds)).toBeNull();
  });
});
