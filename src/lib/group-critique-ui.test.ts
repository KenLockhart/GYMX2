import { describe, expect, it, vi } from "vitest";
import {
  canSelectSessionMember,
  countUniqueLiveParticipants,
  createGroupMutePolicy,
  enableMediaOnlyWhileCurrent,
  groupCritiqueParticipantEpochMatches,
  groupCritiqueCirclePositions,
  groupCritiqueCircleStyle,
  groupCritiqueMobilePage,
  queueGroupMutePolicy,
  shouldLeaveGroupMeeting,
  toggleSessionMemberSelection,
} from "./group-critique-ui";

describe("group critique circle layout", () => {
  it("uses one surrounding ring for six members", () => {
    const positions = groupCritiqueCirclePositions(6);
    expect(positions).toHaveLength(6);
    expect(positions.every((position) => position.ring === "inner")).toBe(true);
    expect(positions[0]).toMatchObject({ x: 50, y: 16, diameter: 17 });
  });

  it("uses two rings for 30 members and bounds every circle in the stage", () => {
    const positions = groupCritiqueCirclePositions(30);
    expect(positions).toHaveLength(30);
    expect(positions.filter((position) => position.ring === "inner")).toHaveLength(10);
    expect(positions.filter((position) => position.ring === "outer")).toHaveLength(20);
    for (const position of positions) {
      expect(position.x - position.diameter / 2).toBeGreaterThanOrEqual(2);
      expect(position.x + position.diameter / 2).toBeLessThanOrEqual(98);
      expect(position.y - position.diameter / 2).toBeGreaterThanOrEqual(2);
      expect(position.y + position.diameter / 2).toBeLessThanOrEqual(98);
    }
  });

  it("caps geometry at 30 and pages mobile attendees in groups of six", () => {
    expect(groupCritiqueCirclePositions(45)).toHaveLength(30);
    const attendees = Array.from({ length: 30 }, (_, index) => index);
    expect(groupCritiqueMobilePage(attendees, 0)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(groupCritiqueMobilePage(attendees, 4)).toEqual([24, 25, 26, 27, 28, 29]);
    expect(groupCritiqueMobilePage(attendees, 99)).toEqual([24, 25, 26, 27, 28, 29]);
  });
});

describe("group critique circle CSS", () => {
  it("uses stable percentage strings for matching server and browser markup", () => {
    const [position] = groupCritiqueCirclePositions(30);
    expect(position).toBeDefined();
    expect(groupCritiqueCircleStyle(position!)).toEqual({
      left: "45.5000%",
      top: "20.5000%",
      width: "9.0000%",
    });
  });
});

describe("session invite cap", () => {
  it("blocks new selections at 30 but allows deselection on an existing over-cap edit", () => {
    const selected30 = new Set(Array.from({ length: 30 }, (_, index) => `m${index}`));
    expect(canSelectSessionMember(selected30, "m0")).toBe(true);
    expect(canSelectSessionMember(selected30, "new")).toBe(false);
    expect(toggleSessionMemberSelection(selected30, "new", true).size).toBe(30);

    const selected31 = new Set(Array.from({ length: 31 }, (_, index) => `m${index}`));
    expect(canSelectSessionMember(selected31, "m0")).toBe(true);
    expect(canSelectSessionMember(selected31, "new")).toBe(false);
    expect(toggleSessionMemberSelection(selected31, "m0", false).size).toBe(30);
  });
});

describe("group participant identity helpers", () => {
  it("requires a provider tag from the current consent epoch", () => {
    expect(groupCritiqueParticipantEpochMatches("opaque-id:4", 4)).toBe(true);
    expect(groupCritiqueParticipantEpochMatches("opaque-id:3", 4)).toBe(false);
    expect(groupCritiqueParticipantEpochMatches("opaque-id:bad", 4)).toBe(false);
    expect(groupCritiqueParticipantEpochMatches("4", 4)).toBe(false);
  });

  it("counts each connected account once and includes the local coach or member", () => {
    expect(
      countUniqueLiveParticipants(
        ["coach", "member-a", "member-a", "self"],
        "self",
        true,
      ),
    ).toBe(3);
    expect(countUniqueLiveParticipants(["coach", "coach"], "self", false)).toBe(1);
  });

  it("keeps a joined meeting during a transient snapshot refresh failure", () => {
    const expiresAt = "2026-11-15T13:00:00.000Z";
    const now = Date.parse("2026-11-15T12:00:00.000Z");

    // Freshness gates actions and local publishing, but does not close an open room.
    expect(shouldLeaveGroupMeeting(true, 4, 4, expiresAt, now)).toBe(false);
    expect(shouldLeaveGroupMeeting(true, 3, 4, expiresAt, now)).toBe(true);
    expect(shouldLeaveGroupMeeting(false, 4, 4, expiresAt, now)).toBe(true);
    expect(
      shouldLeaveGroupMeeting(true, 4, 4, expiresAt, now + 2 * 60 * 60 * 1000),
    ).toBe(true);
  });

  it("does not enable a device when authorization resolves after leaving", async () => {
    let active = true;
    let resolveAuthorization!: (allowed: boolean) => void;
    const authorization = new Promise<boolean>((resolve) => {
      resolveAuthorization = resolve;
    });
    const enable = vi.fn(async () => {});
    const disable = vi.fn(async () => {});
    const operation = enableMediaOnlyWhileCurrent({
      isCurrent: () => active,
      authorize: () => authorization,
      enable,
      disable,
    });

    active = false;
    resolveAuthorization(true);
    await expect(operation).resolves.toBe(false);
    expect(enable).not.toHaveBeenCalled();
    expect(disable).not.toHaveBeenCalled();
  });

  it("stops a device if its permission prompt finishes after leaving", async () => {
    let active = true;
    let resolveEnable!: () => void;
    const enablePromise = new Promise<void>((resolve) => {
      resolveEnable = resolve;
    });
    const enable = vi.fn(() => enablePromise);
    const disable = vi.fn(async () => {});
    const operation = enableMediaOnlyWhileCurrent({
      isCurrent: () => active,
      authorize: async () => true,
      enable,
      disable,
    });

    await vi.waitFor(() => expect(enable).toHaveBeenCalledOnce());
    active = false;
    resolveEnable();
    await expect(operation).resolves.toBe(false);
    expect(disable).toHaveBeenCalledOnce();
  });

  it("cleans up and preserves an enable error when the room closes mid-prompt", async () => {
    let active = true;
    let rejectEnable!: (error: Error) => void;
    const enablePromise = new Promise<void>((_resolve, reject) => {
      rejectEnable = reject;
    });
    const enable = vi.fn(() => enablePromise);
    const disable = vi.fn(async () => {});
    const operation = enableMediaOnlyWhileCurrent({
      isCurrent: () => active,
      authorize: async () => true,
      enable,
      disable,
    });

    await vi.waitFor(() => expect(enable).toHaveBeenCalledOnce());
    active = false;
    rejectEnable(new Error("permission prompt closed"));
    await expect(operation).rejects.toThrow("permission prompt closed");
    expect(disable).toHaveBeenCalledOnce();
  });

  it("reapplies the newest mute policy after an older provider update resolves", async () => {
    const policy = createGroupMutePolicy();
    const failures: string[] = [];
    let effectivePolicy = "unmuted";

    queueGroupMutePolicy(
      policy,
      "muted",
      async () => {
        effectivePolicy = "muted";
      },
      () => failures.push("initial-mute"),
    );
    await policy.queue;

    let releaseUnmute!: () => void;
    let markUnmuteStarted!: () => void;
    const unmuteStarted = new Promise<void>((resolve) => {
      markUnmuteStarted = resolve;
    });
    queueGroupMutePolicy(
      policy,
      "unmuted",
      async () => {
        markUnmuteStarted();
        await new Promise<void>((resolve) => {
          releaseUnmute = resolve;
        });
        effectivePolicy = "unmuted";
      },
      () => failures.push("unmute"),
    );
    await unmuteStarted;

    queueGroupMutePolicy(
      policy,
      "muted",
      async () => {
        effectivePolicy = "muted";
      },
      () => failures.push("remute"),
    );
    releaseUnmute();
    await policy.queue;

    expect(effectivePolicy).toBe("muted");
    expect(policy.appliedKey).toBe("muted");
    expect(policy.pendingKey).toBeNull();
    expect(failures).toEqual([]);
  });
});
