import { describe, expect, it, vi } from "vitest";
import {
  canSelectSessionMember,
  applyGroupPeerMediaMutePolicy,
  countUniqueLiveParticipants,
  createGroupCritiqueMediaEligibility,
  createGroupMutePolicy,
  disableGroupPeerMediaAndConfirm,
  enableMediaOnlyWhileCurrent,
  getGroupCritiqueMediaEligibility,
  hasGroupCritiqueCapacity,
  groupCritiqueCirclePositions,
  groupCritiqueCircleStyle,
  groupCritiqueMobilePage,
  groupCritiqueParticipantEpochMatches,
  getGroupMutePolicyKey,
  isGroupCritiqueMediaOperationCurrent,
  partitionGroupCritiquePeers,
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

  it("uses two rings for 25 members and bounds every circle in the stage", () => {
    const positions = groupCritiqueCirclePositions(25);
    expect(positions).toHaveLength(25);
    expect(positions.filter((position) => position.ring === "inner")).toHaveLength(10);
    expect(positions.filter((position) => position.ring === "outer")).toHaveLength(15);
    for (const position of positions) {
      expect(position.x - position.diameter / 2).toBeGreaterThanOrEqual(2);
      expect(position.x + position.diameter / 2).toBeLessThanOrEqual(98);
      expect(position.y - position.diameter / 2).toBeGreaterThanOrEqual(2);
      expect(position.y + position.diameter / 2).toBeLessThanOrEqual(98);
    }
  });

  it("caps geometry at 25 and pages mobile attendees in groups of six", () => {
    expect(groupCritiqueCirclePositions(45)).toHaveLength(25);
    const attendees = Array.from({ length: 25 }, (_, index) => index);
    expect(groupCritiqueMobilePage(attendees, 0)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(groupCritiqueMobilePage(attendees, 4)).toEqual([24]);
    expect(groupCritiqueMobilePage(attendees, 99)).toEqual([24]);
  });
});

describe("group critique SDK capacity", () => {
  it("accepts SDK capacity at or above the 26-person application requirement", () => {
    expect(hasGroupCritiqueCapacity(26)).toBe(true);
    expect(hasGroupCritiqueCapacity(31)).toBe(true);
  });

  it.each([25, 24, undefined, null, Number.NaN, "26"])(
    "fails closed when public SDK capacity is %s",
    (limit) => {
      expect(hasGroupCritiqueCapacity(limit)).toBe(false);
    },
  );
});

describe("group critique media eligibility", () => {
  function createOperationIdentity() {
    return {
      mounted: true,
      meetingMatches: true,
      currentJoinRevision: 4,
      joinRevision: 4,
      currentIntentRevision: 9,
      intentRevision: 9,
    };
  }

  it("maps freshness, consent, stage, and coach mute to independent media eligibility", () => {
    const member = {
      roomOpen: true,
      snapshotFresh: true,
      hasConsented: true,
      membershipEligible: true,
      publisherReady: true,
      canPublishAudio: true,
      canPublishVideo: true,
      isCoach: false,
      memberIsMuted: false,
    };

    expect(getGroupCritiqueMediaEligibility(member)).toEqual({
      audio: true,
      video: true,
    });
    expect(
      getGroupCritiqueMediaEligibility({ ...member, memberIsMuted: true }),
    ).toEqual({ audio: false, video: true });
    expect(
      getGroupCritiqueMediaEligibility({ ...member, snapshotFresh: false }),
    ).toEqual({ audio: false, video: false });
    expect(
      getGroupCritiqueMediaEligibility({ ...member, hasConsented: false }),
    ).toEqual({ audio: false, video: false });
    expect(
      getGroupCritiqueMediaEligibility({ ...member, membershipEligible: false }),
    ).toEqual({ audio: false, video: false });
    expect(
      getGroupCritiqueMediaEligibility({ ...member, publisherReady: false }),
    ).toEqual({ audio: false, video: false });
    expect(
      getGroupCritiqueMediaEligibility({
        ...member,
        isCoach: true,
        hasConsented: false,
        membershipEligible: false,
        memberIsMuted: true,
      }),
    ).toEqual({ audio: true, video: true });
  });

  it("does not start capture when mute arrives during fresh authorization", async () => {
    const eligibility = createGroupCritiqueMediaEligibility();
    eligibility.update({ audio: true, video: true });
    const audioRevision = eligibility.revision("audio");
    const videoRevision = eligibility.revision("video");
    const identity = createOperationIdentity();
    const operationIsCurrent = () =>
      isGroupCritiqueMediaOperationCurrent(identity);
    const isCurrent = () =>
      operationIsCurrent() && eligibility.isCurrent("audio", audioRevision);
    let resolveAuthorization!: (allowed: boolean) => void;
    let markAuthorizationStarted!: () => void;
    const authorizationStarted = new Promise<void>((resolve) => {
      markAuthorizationStarted = resolve;
    });
    const authorization = new Promise<boolean>((resolve) => {
      resolveAuthorization = resolve;
    });
    const enable = vi.fn(async () => {});
    let busy = true;
    const run = async () => {
      try {
        return await enableMediaOnlyWhileCurrent({
          isCurrent,
          authorize: () => {
            markAuthorizationStarted();
            return authorization;
          },
          enable,
          isEnabled: () => false,
          disable: vi.fn(async () => {}),
        });
      } finally {
        if (operationIsCurrent()) busy = false;
      }
    };

    const pending = run();
    await authorizationStarted;
    eligibility.update({ audio: false, video: true });
    resolveAuthorization(true);

    await expect(pending).resolves.toBe(false);
    expect(enable).not.toHaveBeenCalled();
    expect(busy).toBe(false);
    expect(eligibility.isCurrent("video", videoRevision)).toBe(true);
  });

  it("does not revive late capture after mute and unmute, then allows an explicit retry", async () => {
    const eligibility = createGroupCritiqueMediaEligibility();
    eligibility.update({ audio: true, video: true });
    const audioRevision = eligibility.revision("audio");
    const videoRevision = eligibility.revision("video");
    const identity = createOperationIdentity();
    const operationIsCurrent = () =>
      isGroupCritiqueMediaOperationCurrent(identity);
    const isCurrent = () =>
      operationIsCurrent() && eligibility.isCurrent("audio", audioRevision);
    let audioEnabled = false;
    let resolveEnable!: () => void;
    let markEnableStarted!: () => void;
    const enableStarted = new Promise<void>((resolve) => {
      markEnableStarted = resolve;
    });
    const enablePromise = new Promise<void>((resolve) => {
      resolveEnable = resolve;
    });
    const enable = vi.fn(async () => {
      markEnableStarted();
      await enablePromise;
      audioEnabled = true;
    });
    const disable = vi.fn(async () => {
      audioEnabled = false;
    });
    let busy = true;
    const run = async () => {
      try {
        return await enableMediaOnlyWhileCurrent({
          isCurrent,
          authorize: async () => true,
          enable,
          isEnabled: () => audioEnabled,
          disable,
        });
      } finally {
        if (operationIsCurrent()) busy = false;
      }
    };

    const pending = run();
    await enableStarted;
    eligibility.update({ audio: false, video: true });
    eligibility.update({ audio: true, video: true });
    resolveEnable();

    await expect(pending).resolves.toBe(false);
    expect(audioEnabled).toBe(false);
    expect(enable).toHaveBeenCalledOnce();
    expect(disable).toHaveBeenCalledOnce();
    expect(busy).toBe(false);
    expect(eligibility.isCurrent("video", videoRevision)).toBe(true);
    expect(eligibility.isCurrent("audio", audioRevision)).toBe(false);
    expect(eligibility.isCurrent("audio", eligibility.revision("audio"))).toBe(
      true,
    );

    eligibility.update({ audio: true, video: true });
    const retryRevision = eligibility.revision("audio");
    const retry = await enableMediaOnlyWhileCurrent({
      isCurrent: () =>
        operationIsCurrent() && eligibility.isCurrent("audio", retryRevision),
      authorize: async () => true,
      enable: async () => {
        audioEnabled = true;
      },
      isEnabled: () => audioEnabled,
      disable: async () => {
        audioEnabled = false;
      },
    });

    expect(retry).toBe(true);
    expect(audioEnabled).toBe(true);
  });

  it("stops an enabled device when the post-enable backend check denies it", async () => {
    let audioEnabled = false;
    const authorize = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const disable = vi.fn(async () => {
      audioEnabled = false;
    });

    await expect(
      enableMediaOnlyWhileCurrent({
        isCurrent: () => true,
        authorize,
        enable: async () => {
          audioEnabled = true;
        },
        isEnabled: () => audioEnabled,
        disable,
      }),
    ).resolves.toBe(false);

    expect(authorize).toHaveBeenCalledTimes(2);
    expect(disable).toHaveBeenCalledOnce();
    expect(audioEnabled).toBe(false);
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
  it("blocks new selections at 25 but allows deselection on an existing over-cap edit", () => {
    const selected25 = new Set(Array.from({ length: 25 }, (_, index) => `m${index}`));
    expect(canSelectSessionMember(selected25, "m0")).toBe(true);
    expect(canSelectSessionMember(selected25, "new")).toBe(false);
    expect(toggleSessionMemberSelection(selected25, "new", true).size).toBe(25);

    const selected26 = new Set(Array.from({ length: 26 }, (_, index) => `m${index}`));
    expect(canSelectSessionMember(selected26, "m0")).toBe(true);
    expect(canSelectSessionMember(selected26, "new")).toBe(false);
    expect(toggleSessionMemberSelection(selected26, "m0", false).size).toBe(25);
  });
});

describe("group participant identity helpers", () => {
  it("matches and removes a coach with the authoritative tag even when isHost is false", () => {
    const taggedCoach = {
      customParticipantId: "coach-session:3",
      isHost: false,
      name: "Coach",
    };
    const member = {
      customParticipantId: "member-session:1",
      isHost: false,
      name: "Member",
    };

    expect(
      partitionGroupCritiquePeers([taggedCoach, member], "coach-session:3"),
    ).toEqual({ coach: taggedCoach, members: [member] });
  });

  it("does not classify a host-flagged or coach-named peer with the wrong tag", () => {
    const spoofedPeer = {
      customParticipantId: "member-session:1",
      isHost: true,
      name: "Coach",
    };

    expect(
      partitionGroupCritiquePeers([spoofedPeer], "coach-session:3"),
    ).toEqual({ coach: null, members: [spoofedPeer] });
  });

  it.each([null, ""])(
    "leaves all peers in the member set when the coach tag is %s",
    (coachCustomParticipantId) => {
      const peers = [
        { customParticipantId: null },
        { customParticipantId: "" },
        { customParticipantId: "coach-session:3" },
      ];

      expect(
        partitionGroupCritiquePeers(peers, coachCustomParticipantId),
      ).toEqual({ coach: null, members: peers });
    },
  );

  it("selects the peer matching an updated coach tag", () => {
    const oldCoach = { customParticipantId: "coach-session:2", name: "Old" };
    const currentCoach = { customParticipantId: "coach-session:3", name: "Current" };
    const peers = [oldCoach, currentCoach];

    expect(partitionGroupCritiquePeers(peers, "coach-session:2")).toEqual({
      coach: oldCoach,
      members: [currentCoach],
    });
    expect(partitionGroupCritiquePeers(peers, "coach-session:3")).toEqual({
      coach: currentCoach,
      members: [oldCoach],
    });
  });

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
      isEnabled: () => true,
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
      isEnabled: () => true,
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
      isEnabled: () => true,
      disable,
    });

    await vi.waitFor(() => expect(enable).toHaveBeenCalledOnce());
    active = false;
    rejectEnable(new Error("permission prompt closed"));
    await expect(operation).rejects.toThrow("permission prompt closed");
    expect(disable).toHaveBeenCalledOnce();
  });

  it("reports an enable that resolves without activating the device and cleans it up", async () => {
    const enable = vi.fn(async () => {});
    const disable = vi.fn(async () => {});
    const isEnabled = vi.fn(() => false);

    const operation = enableMediaOnlyWhileCurrent({
      isCurrent: () => true,
      authorize: async () => true,
      enable,
      isEnabled,
      disable,
    });

    await expect(operation).rejects.toThrow("media-enable-not-confirmed");
    expect(enable).toHaveBeenCalledOnce();
    expect(isEnabled).toHaveBeenCalledOnce();
    expect(disable).toHaveBeenCalledOnce();
  });

  it("confirms device activation after a successful enable", async () => {
    const enable = vi.fn(async () => {});
    const disable = vi.fn(async () => {});

    await expect(
      enableMediaOnlyWhileCurrent({
        isCurrent: () => true,
        authorize: async () => true,
        enable,
        isEnabled: () => true,
        disable,
      }),
    ).resolves.toBe(true);
    expect(enable).toHaveBeenCalledOnce();
    expect(disable).not.toHaveBeenCalled();
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

  it("subscribes before disabling and waits for the public off event and track state", async () => {
    let audioEnabled = true;
    let audioTrackEnabled = true;
    let onAudioUpdate: (() => void) | null = null;
    const unsubscribe = vi.fn(() => {
      onAudioUpdate = null;
    });
    const disable = vi.fn(async () => {
      expect(onAudioUpdate).toBeTypeOf("function");
      audioEnabled = false;
      audioTrackEnabled = false;
      onAudioUpdate?.();
    });

    await disableGroupPeerMediaAndConfirm({
      disable,
      isDisabled: () => !audioEnabled && !audioTrackEnabled,
      subscribe: (onUpdate) => {
        onAudioUpdate = onUpdate;
        return unsubscribe;
      },
    });

    expect(disable).toHaveBeenCalledOnce();
    expect(audioEnabled).toBe(false);
    expect(audioTrackEnabled).toBe(false);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("rechecks the track after an audio event clears public media state without another event", async () => {
    let audioEnabled = true;
    let audioTrackEnabled = true;
    let onAudioUpdate: (() => void) | null = null;
    const isDisabled = vi.fn(() => !audioEnabled && !audioTrackEnabled);
    const unsubscribe = vi.fn(() => {
      onAudioUpdate = null;
    });
    const disable = vi.fn(async () => {});
    const pending = disableGroupPeerMediaAndConfirm({
      disable,
      isDisabled,
      subscribe: (onUpdate) => {
        onAudioUpdate = onUpdate;
        return unsubscribe;
      },
    });

    await Promise.resolve();
    expect(disable).toHaveBeenCalledOnce();

    audioEnabled = false;
    const update = onAudioUpdate as (() => void) | null;
    update?.();
    expect(isDisabled).toHaveReturnedWith(false);
    audioTrackEnabled = false;

    await expect(pending).resolves.toBeUndefined();
    expect(isDisabled).toHaveReturnedWith(true);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("fails bounded off confirmation and retries the same persisted mute policy", async () => {
    vi.useFakeTimers();
    try {
      const policy = createGroupMutePolicy();
      let audioEnabled = true;
      let audioTrackEnabled = true;
      let onAudioUpdate: (() => void) | null = null;
      let attempts = 0;
      const failures: string[] = [];
      const key = getGroupMutePolicyKey({
        participantEpoch: 8,
        membershipState: "eligible",
        shouldMuteAudio: true,
        audioCurrentlyOn: true,
        videoCurrentlyOn: false,
      });
      const enqueue = () =>
        queueGroupMutePolicy(
          policy,
          key,
          () =>
            disableGroupPeerMediaAndConfirm({
              disable: async () => {
                attempts += 1;
                if (attempts > 1) {
                  audioEnabled = false;
                  audioTrackEnabled = false;
                  onAudioUpdate?.();
                }
              },
              isDisabled: () => !audioEnabled && !audioTrackEnabled,
              subscribe: (onUpdate) => {
                onAudioUpdate = onUpdate;
                return () => {
                  onAudioUpdate = null;
                };
              },
              timeoutMs: 20,
            }),
          () => failures.push("mute"),
        );

      enqueue();
      await vi.advanceTimersByTimeAsync(20);
      await policy.queue;
      expect(attempts).toBe(1);
      expect(failures).toEqual(["mute"]);
      expect(onAudioUpdate).toBeNull();

      enqueue();
      await policy.queue;
      expect(attempts).toBe(2);
      expect(failures).toEqual(["mute"]);
      expect(audioEnabled).toBe(false);
      expect(audioTrackEnabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reapplies an unchanged persisted mute when a peer starts producing again", async () => {
    const policy = createGroupMutePolicy();
    let audioEnabled = false;
    let audioTrackEnabled = false;
    let onAudioUpdate: (() => void) | null = null;
    const disable = vi.fn(async () => {
      audioEnabled = false;
      audioTrackEnabled = false;
      onAudioUpdate?.();
    });
    const applyMute = () =>
      applyGroupPeerMediaMutePolicy({
        shouldMuteAudio: true,
        shouldMuteVideo: false,
        disableAudio: () =>
          disableGroupPeerMediaAndConfirm({
            disable,
            isDisabled: () => !audioEnabled && !audioTrackEnabled,
            subscribe: (onUpdate) => {
              onAudioUpdate = onUpdate;
              return () => {
                onAudioUpdate = null;
              };
            },
          }),
        disableVideo: vi.fn(async () => {}),
      });
    const getKey = (audioCurrentlyOn: boolean) =>
      getGroupMutePolicyKey({
        participantEpoch: 8,
        membershipState: "eligible",
        shouldMuteAudio: true,
        audioCurrentlyOn,
        videoCurrentlyOn: false,
      });

    queueGroupMutePolicy(policy, getKey(false), applyMute, vi.fn());
    await policy.queue;
    expect(disable).not.toHaveBeenCalled();

    audioEnabled = true;
    audioTrackEnabled = true;
    queueGroupMutePolicy(policy, getKey(true), applyMute, vi.fn());
    await policy.queue;

    expect(disable).toHaveBeenCalledOnce();
    expect(audioEnabled).toBe(false);
    expect(audioTrackEnabled).toBe(false);
  });

  it("keeps an audio-only mute scoped to audio and never enables devices on allow", async () => {
    const disableAudio = vi.fn(async () => {});
    const disableVideo = vi.fn(async () => {});

    await applyGroupPeerMediaMutePolicy({
      shouldMuteAudio: true,
      shouldMuteVideo: false,
      disableAudio,
      disableVideo,
    });
    expect(disableAudio).toHaveBeenCalledOnce();
    expect(disableVideo).not.toHaveBeenCalled();

    disableAudio.mockClear();
    await applyGroupPeerMediaMutePolicy({
      shouldMuteAudio: false,
      shouldMuteVideo: false,
      disableAudio,
      disableVideo,
    });
    expect(disableAudio).not.toHaveBeenCalled();
    expect(disableVideo).not.toHaveBeenCalled();
  });

  it("cleans the listener and skips disabling when the peer leaves", async () => {
    let cancelled = false;
    const disable = vi.fn(async () => {});
    const unsubscribe = vi.fn();

    await disableGroupPeerMediaAndConfirm({
      disable,
      isDisabled: () => false,
      isCancelled: () => cancelled,
      subscribe: (onUpdate) => {
        cancelled = true;
        onUpdate();
        return unsubscribe;
      },
    });

    expect(disable).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
