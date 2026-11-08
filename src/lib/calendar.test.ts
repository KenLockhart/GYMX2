import { describe, expect, it } from "vitest";
import {
  formatEmailSessionTime,
  formatSessionTime,
  planSessionEmails,
  localDayKey,
  monthGrid,
  monthParam,
  monthRange,
  monthTitle,
  parseMonth,
  shiftMonth,
} from "./calendar";

describe("parseMonth", () => {
  it("reads a YYYY-MM value", () => {
    expect(parseMonth("2026-12")).toEqual({ year: 2026, month: 12 });
  });

  it.each([undefined, "", "2026-13", "2026-1", "next", ["2026-12"]])(
    "falls back to the current month for %s",
    (value) => {
      expect(parseMonth(value, new Date("2026-11-08T03:00:00Z"))).toEqual({ year: 2026, month: 11 });
    },
  );
});

describe("shiftMonth", () => {
  it("crosses into the next year", () => {
    expect(monthParam(shiftMonth({ year: 2026, month: 12 }, 1))).toBe("2027-01");
  });

  it("crosses into the previous year", () => {
    expect(monthParam(shiftMonth({ year: 2026, month: 1 }, -1))).toBe("2025-12");
  });
});

describe("monthTitle", () => {
  it("names the month", () => {
    expect(monthTitle({ year: 2026, month: 11 })).toBe("November 2026");
  });
});

describe("monthGrid", () => {
  const weeks = monthGrid({ year: 2026, month: 11 });

  it("starts on a Sunday and fills whole weeks", () => {
    expect(weeks[0][0]).toBe("2026-11-01");
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });

  it("ends on the Saturday after the last day", () => {
    expect(weeks.at(-1)?.at(-1)).toBe("2026-12-05");
  });

  it("includes days from the previous month", () => {
    expect(monthGrid({ year: 2026, month: 12 })[0][0]).toBe("2026-11-29");
  });
});

describe("monthRange", () => {
  it("covers the grid with a day to spare on each side", () => {
    expect(monthRange({ year: 2026, month: 11 })).toEqual({
      from: "2026-10-31T00:00:00.000Z",
      to: "2026-12-07T00:00:00.000Z",
      firstDay: "2026-11-01",
      lastDay: "2026-12-05",
    });
  });
});

describe("localDayKey", () => {
  it("uses the viewer's time zone", () => {
    expect(localDayKey("2026-11-09T02:00:00Z", "America/New_York")).toBe("2026-11-08");
    expect(localDayKey("2026-11-09T02:00:00Z", "UTC")).toBe("2026-11-09");
  });
});

describe("formatSessionTime", () => {
  it("shows a same-day session", () => {
    expect(formatSessionTime("2026-11-10T14:00:00Z", "2026-11-10T15:30:00Z", "America/New_York")).toBe(
      "Tue, Nov 10, 9:00 AM – 10:30 AM",
    );
  });

  it("shows the end date when a session runs past midnight", () => {
    expect(formatSessionTime("2026-11-11T03:00:00Z", "2026-11-11T06:00:00Z", "America/New_York")).toBe(
      "Tue, Nov 10, 10:00 PM – Nov 11, 1:00 AM",
    );
  });
});

describe("planSessionEmails", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  const details = {
    starts_at: "2026-11-10T18:00:00Z",
    ends_at: "2026-11-10T19:00:00Z",
    location: "Main gym",
    meeting_url: null,
  };

  it("invites everyone on a new session", () => {
    expect(planSessionEmails(null, { details, memberIds: ["a", "b"] }, now)).toEqual({
      invited: ["a", "b"],
      updated: [],
    });
  });

  it("invites only new members when nothing else changed", () => {
    expect(
      planSessionEmails({ details, memberIds: ["a"] }, { details: { ...details, location: " Main gym " }, memberIds: ["a", "b"] }, now),
    ).toEqual({ invited: ["b"], updated: [] });
  });

  it("tells existing members when the time moves", () => {
    expect(
      planSessionEmails(
        { details, memberIds: ["a", "b"] },
        { details: { ...details, starts_at: "2026-11-10T17:30:00Z" }, memberIds: ["a", "b", "c"] },
        now,
      ),
    ).toEqual({ invited: ["c"], updated: ["a", "b"] });
  });

  it("treats the same moment written differently as unchanged", () => {
    expect(
      planSessionEmails(
        { details: { ...details, starts_at: "2026-11-10T18:00:00+00:00" }, memberIds: ["a"] },
        { details, memberIds: ["a"] },
        now,
      ).updated,
    ).toEqual([]);
  });

  it("sends nothing for a past session", () => {
    expect(
      planSessionEmails(null, { details: { ...details, ends_at: "2026-11-01T19:00:00Z" }, memberIds: ["a"] }, now),
    ).toEqual({ invited: [], updated: [] });
  });
});

describe("formatEmailSessionTime", () => {
  it("shows Eastern time with its label", () => {
    expect(formatEmailSessionTime("2026-11-10T23:00:00Z", "2026-11-11T00:00:00Z")).toBe(
      "Tue, Nov 10, 6:00 PM – 7:00 PM EST",
    );
  });
});
