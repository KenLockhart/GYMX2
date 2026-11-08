import { describe, expect, it } from "vitest";
import { formatDate, formatDuration, videoInUseError } from "./format";

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

describe("videoInUseError", () => {
  it("names one Task", () => {
    expect(videoInUseError(1)).toBe(
      "This video is used by 1 Task. Delete that Task on the Tasks page first, then try again.",
    );
  });

  it("counts several Tasks", () => {
    expect(videoInUseError(3)).toBe(
      "This video is used by 3 Tasks. Delete those Tasks on the Tasks page first, then try again.",
    );
  });

  it("still explains when the count is unknown", () => {
    expect(videoInUseError(0)).toContain("Delete that Task first");
  });
});
