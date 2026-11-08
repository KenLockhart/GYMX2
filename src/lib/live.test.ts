import { describe, expect, it } from "vitest";
import { canGoLive, liveState } from "./live";

const session = {
  starts_at: "2026-11-10T14:00:00Z",
  ends_at: "2026-11-10T15:00:00Z",
};
const at = (iso: string) => new Date(iso);

describe("live sessions", () => {
  it("opens 30 minutes early and closes an hour after the end", () => {
    expect(canGoLive(session, at("2026-11-10T13:29:00Z"))).toBe(false);
    expect(canGoLive(session, at("2026-11-10T13:30:00Z"))).toBe(true);
    expect(canGoLive(session, at("2026-11-10T16:00:00Z"))).toBe(true);
    expect(canGoLive(session, at("2026-11-10T16:01:00Z"))).toBe(false);
  });

  it("reports the room's state", () => {
    expect(liveState(session, null, at("2026-11-10T10:00:00Z"))).toBe(
      "not_yet",
    );
    expect(liveState(session, null, at("2026-11-10T14:05:00Z"))).toBe("open");
    expect(liveState(session, null, at("2026-11-11T10:00:00Z"))).toBe("closed");
    expect(
      liveState(
        session,
        { live_started_at: "2026-11-10T14:00:00Z", live_ended_at: null },
        at("2026-11-10T14:05:00Z"),
      ),
    ).toBe("live");
    expect(
      liveState(
        session,
        {
          live_started_at: "2026-11-10T14:00:00Z",
          live_ended_at: "2026-11-10T15:00:00Z",
        },
        at("2026-11-10T15:05:00Z"),
      ),
    ).toBe("ended");
  });
});
