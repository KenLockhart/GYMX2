import { describe, expect, it } from "vitest";
import {
  canGoLive,
  isLiveRoomActive,
  isLiveSnapshotCurrent,
  liveState,
  mergeLiveMessages,
  nextLiveWindowBoundary,
} from "./live";

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

  it("provides the next window edge so an open page can unlock on time", () => {
    expect(nextLiveWindowBoundary(session, at("2026-11-10T13:00:00Z"))).toBe(
      at("2026-11-10T13:30:00Z").getTime(),
    );
    expect(nextLiveWindowBoundary(session, at("2026-11-10T14:00:00Z"))).toBe(
      at("2026-11-10T16:00:00.001Z").getTime(),
    );
    expect(nextLiveWindowBoundary(session, at("2026-11-10T16:01:00Z"))).toBe(
      null,
    );
  });

  it("ignores an older room, chat, or private snapshot when a newer refresh starts", () => {
    const pollRevision = 4;
    const actionRefreshRevision = 5;
    expect(isLiveSnapshotCurrent(actionRefreshRevision, actionRefreshRevision)).toBe(true);
    expect(isLiveSnapshotCurrent(pollRevision, actionRefreshRevision)).toBe(false);
  });

  it("merges realtime and optimistic chat messages once, in timestamp order", () => {
    const current = [
      { id: "later", body: "later", created_at: "2026-11-10T14:01:00Z" },
      { id: "early", body: "old", created_at: "2026-11-10T14:00:00Z" },
    ];
    const merged = mergeLiveMessages(current, [
      { id: "early", body: "confirmed", created_at: "2026-11-10T14:00:00Z" },
      { id: "middle", body: "middle", created_at: "2026-11-10T14:00:30Z" },
    ]);
    expect(merged.map(({ id }) => id)).toEqual(["early", "middle", "later"]);
    expect(merged[0].body).toBe("confirmed");
  });

  it("keeps the newest 200 messages when a chat snapshot exceeds history", () => {
    const messages = Array.from({ length: 201 }, (_, index) => ({
      id: `message-${index}`,
      created_at: new Date(Date.UTC(2026, 10, 10, 14, index)).toISOString(),
    }));

    const recent = mergeLiveMessages([], messages);

    expect(recent).toHaveLength(200);
    expect(recent[0].id).toBe("message-1");
    expect(recent.at(-1)?.id).toBe("message-200");
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

  it("keeps an end control available while the server still marks a room live", () => {
    expect(
      isLiveRoomActive({
        live_started_at: "2026-11-10T14:00:00Z",
        live_ended_at: null,
      }),
    ).toBe(true);
    expect(
      isLiveRoomActive({
        live_started_at: "2026-11-10T14:00:00Z",
        live_ended_at: "2026-11-10T15:00:00Z",
      }),
    ).toBe(false);
    expect(isLiveRoomActive(null)).toBe(false);
  });
});
