export const GROUP_CRITIQUE_MEMBER_LIMIT = 30;
export const GROUP_CRITIQUE_TOTAL_PARTICIPANT_LIMIT =
  GROUP_CRITIQUE_MEMBER_LIMIT + 1;
export const GROUP_CRITIQUE_MOBILE_PAGE_SIZE = 6;

/** Require the published preset to supply capacity for the coach and 30 members. */
export function hasGroupCritiqueCapacity(maxActiveParticipantsCount: unknown): boolean {
  return maxActiveParticipantsCount === GROUP_CRITIQUE_TOTAL_PARTICIPANT_LIMIT;
}

export type CirclePosition = {
  x: number;
  y: number;
  diameter: number;
  ring: "inner" | "outer";
};

/** Keep server and browser CSS values identical during hydration. */
export function groupCritiqueCircleStyle(
  position: Pick<CirclePosition, "x" | "y" | "diameter">,
) {
  return {
    left: `${(position.x - position.diameter / 2).toFixed(4)}%`,
    top: `${(position.y - position.diameter / 2).toFixed(4)}%`,
    width: `${position.diameter.toFixed(4)}%`,
  };
}

/** Center-based percentage layout for the coach-led circle stage. */
export function groupCritiqueCirclePositions(count: number): CirclePosition[] {
  const safeCount = Math.max(
    0,
    Math.min(GROUP_CRITIQUE_MEMBER_LIMIT, Math.floor(count)),
  );
  if (safeCount === 0) return [];

  const innerCount = safeCount <= 6 ? safeCount : Math.min(10, safeCount);
  const outerCount = safeCount - innerCount;
  const innerRadius = safeCount <= 6 ? 34 : 25;
  const diameter = safeCount <= 6 ? 17 : 9;
  const positions: CirclePosition[] = [];

  for (let index = 0; index < innerCount; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / innerCount;
    positions.push({
      x: 50 + Math.cos(angle) * innerRadius,
      y: 50 + Math.sin(angle) * innerRadius,
      diameter,
      ring: "inner",
    });
  }

  for (let index = 0; index < outerCount; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / outerCount;
    positions.push({
      x: 50 + Math.cos(angle) * 43,
      y: 50 + Math.sin(angle) * 43,
      diameter,
      ring: "outer",
    });
  }

  return positions;
}

export function groupCritiqueMobilePage<T>(
  members: readonly T[],
  page: number,
): T[] {
  const pageCount = Math.max(
    1,
    Math.ceil(members.length / GROUP_CRITIQUE_MOBILE_PAGE_SIZE),
  );
  const safePage = Math.min(Math.max(0, Math.floor(page)), pageCount - 1);
  const start = safePage * GROUP_CRITIQUE_MOBILE_PAGE_SIZE;
  return members.slice(start, start + GROUP_CRITIQUE_MOBILE_PAGE_SIZE);
}

export function groupCritiqueParticipantEpochMatches(
  customParticipantId: string,
  participantEpoch: number,
): boolean {
  const separator = customParticipantId.lastIndexOf(":");
  if (separator <= 0) return false;
  const epoch = Number(customParticipantId.slice(separator + 1));
  return Number.isSafeInteger(epoch) && epoch === participantEpoch;
}

export function partitionGroupCritiquePeers<T extends {
  customParticipantId?: string | null;
}>(
  peers: readonly T[],
  coachCustomParticipantId: string | null | undefined,
): { coach: T | null; members: T[] } {
  const hasCoachIdentity =
    typeof coachCustomParticipantId === "string" &&
    coachCustomParticipantId.length > 0;
  const isCoach = (peer: T) =>
    hasCoachIdentity &&
    typeof peer.customParticipantId === "string" &&
    peer.customParticipantId.length > 0 &&
    peer.customParticipantId === coachCustomParticipantId;

  return {
    coach: peers.find(isCoach) ?? null,
    members: peers.filter((peer) => !isCoach(peer)),
  };
}

export function countUniqueLiveParticipants(
  remoteUserIds: readonly string[],
  ownUserId: string,
  ownParticipantJoined: boolean,
): number {
  const remoteParticipants = new Set(
    remoteUserIds.filter((userId) => userId.length > 0 && userId !== ownUserId),
  );
  return remoteParticipants.size + Number(ownParticipantJoined);
}

export function shouldLeaveGroupMeeting(
  roomOpen: boolean,
  credentialGeneration: number,
  currentGeneration: number,
  expiresAt: string,
  now: number,
): boolean {
  const expiry = Date.parse(expiresAt);
  return (
    !roomOpen ||
    credentialGeneration !== currentGeneration ||
    !Number.isFinite(expiry) ||
    expiry <= now
  );
}

export async function enableMediaOnlyWhileCurrent(options: {
  isCurrent: () => boolean;
  authorize: () => Promise<boolean>;
  enable: () => Promise<void>;
  isEnabled: () => boolean;
  disable: () => Promise<void>;
}): Promise<boolean> {
  const { isCurrent, authorize, enable, isEnabled, disable } = options;
  if (!isCurrent() || !(await authorize()) || !isCurrent()) return false;
  try {
    await enable();
  } catch (error) {
    await disable().catch(() => {});
    throw error;
  }
  if (!isCurrent()) {
    await disable().catch(() => {});
    return false;
  }
  try {
    if (!isEnabled()) throw new Error("media-enable-not-confirmed");
    if (!(await authorize()) || !isCurrent()) {
      await disable().catch(() => {});
      return false;
    }
    if (!isEnabled()) throw new Error("media-enable-not-confirmed");
  } catch (error) {
    await disable().catch(() => {});
    throw error;
  }
  return true;
}

export type GroupCritiqueMediaKind = "audio" | "video";

export function getGroupCritiqueMediaEligibility(options: {
  roomOpen: boolean;
  snapshotFresh: boolean;
  hasConsented: boolean;
  membershipEligible: boolean;
  publisherReady: boolean;
  canPublishAudio: boolean;
  canPublishVideo: boolean;
  isCoach: boolean;
  memberIsMuted: boolean;
}): { audio: boolean; video: boolean } {
  const canUseDevices =
    options.roomOpen &&
    options.snapshotFresh &&
    (options.isCoach ||
      (options.hasConsented && options.membershipEligible));
  const mayEnable = canUseDevices && options.publisherReady;
  return {
    audio:
      mayEnable &&
      options.canPublishAudio &&
      (options.isCoach || !options.memberIsMuted),
    video: mayEnable && options.canPublishVideo,
  };
}

export type GroupCritiqueMediaEligibility = {
  update: (next: { audio: boolean; video: boolean }) => void;
  revision: (kind: GroupCritiqueMediaKind) => number;
  isCurrent: (kind: GroupCritiqueMediaKind, revision: number) => boolean;
};

/** Track current per-media eligibility and invalidate in-flight enable attempts on policy changes. */
export function createGroupCritiqueMediaEligibility(): GroupCritiqueMediaEligibility {
  let current = { audio: false, video: false };
  const revisions = { audio: 0, video: 0 };

  return {
    update(next) {
      if (next.audio !== current.audio) revisions.audio += 1;
      if (next.video !== current.video) revisions.video += 1;
      current = next;
    },
    revision(kind) {
      return revisions[kind];
    },
    isCurrent(kind, revision) {
      return current[kind] && revisions[kind] === revision;
    },
  };
}

export function isGroupCritiqueMediaOperationCurrent(options: {
  mounted: boolean;
  meetingMatches: boolean;
  currentJoinRevision: number;
  joinRevision: number;
  currentIntentRevision: number;
  intentRevision: number;
}): boolean {
  return (
    options.mounted &&
    options.meetingMatches &&
    options.currentJoinRevision === options.joinRevision &&
    options.currentIntentRevision === options.intentRevision
  );
}

export type GroupMutePolicy = {
  requestedKey: string | null;
  appliedKey: string | null;
  pendingKey: string | null;
  queue: Promise<void>;
};

export function createGroupMutePolicy(): GroupMutePolicy {
  return {
    requestedKey: null,
    appliedKey: null,
    pendingKey: null,
    queue: Promise.resolve(),
  };
}

/** Reconcile a participant's latest public media state when a persisted mute policy is unchanged. */
export function getGroupMutePolicyKey(options: {
  participantEpoch: number;
  membershipState: string;
  shouldMuteAudio: boolean;
  audioCurrentlyOn: boolean;
  videoCurrentlyOn: boolean;
}): string {
  const shouldMuteVideo = options.membershipState !== "eligible";
  return [
    options.participantEpoch,
    options.membershipState,
    options.shouldMuteAudio,
    options.shouldMuteAudio && options.audioCurrentlyOn,
    shouldMuteVideo && options.videoCurrentlyOn,
  ].join(":");
}

/** A selected allow only updates app policy; it never turns a participant's device on. */
export async function applyGroupPeerMediaMutePolicy(options: {
  shouldMuteAudio: boolean;
  shouldMuteVideo: boolean;
  disableAudio: () => Promise<void>;
  disableVideo: () => Promise<void>;
}): Promise<void> {
  let failed = false;
  let firstError: unknown;
  if (options.shouldMuteAudio) {
    try {
      await options.disableAudio();
    } catch (error) {
      failed = true;
      firstError = error;
    }
  }
  if (options.shouldMuteVideo) {
    try {
      await options.disableVideo();
    } catch (error) {
      if (!failed) firstError = error;
      failed = true;
    }
  }
  if (failed) throw firstError;
}

/** Await a public peer disable, then confirm public state and track are off. */
export async function disableGroupPeerMediaAndConfirm(options: {
  disable: () => Promise<void>;
  isDisabled: () => boolean;
  subscribe: (onUpdate: () => void) => () => void;
  isCancelled?: () => boolean;
  timeoutMs?: number;
}): Promise<void> {
  if (options.isCancelled?.() || options.isDisabled()) return;

  const timeoutMs = options.timeoutMs ?? 2_000;
  await new Promise<void>((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    let cleanupRequested = false;
    let settled = false;
    let disableStarted = false;
    let disableCompleted = false;
    let confirmedDisabled = false;
    const timeout = setTimeout(() => {
      finish(new Error("group-critique-media-off-confirmation-timeout"));
    }, timeoutMs);

    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch {
          // Cleanup errors must not hide the media policy result.
        }
        unsubscribe = null;
      } else {
        cleanupRequested = true;
      }
      if (error) reject(error);
      else resolve();
    };

    const onUpdate = () => {
      if (settled) return;
      try {
        if (options.isCancelled?.()) {
          finish();
          return;
        }
        confirmedDisabled = options.isDisabled();
        if (disableStarted && disableCompleted && confirmedDisabled) finish();
      } catch (error) {
        finish(error);
      }
    };
    const onPublicMediaUpdate = () => {
      onUpdate();
      queueMicrotask(onUpdate);
    };

    try {
      unsubscribe = options.subscribe(onPublicMediaUpdate);
      if (cleanupRequested) {
        try {
          unsubscribe();
        } catch {
          // The listener has already settled and cannot affect policy state.
        }
        unsubscribe = null;
      }
      onUpdate();
      if (settled) return;
      if (options.isCancelled?.() || confirmedDisabled) {
        finish();
        return;
      }
      disableStarted = true;
      Promise.resolve(options.disable()).then(
        () => {
          if (settled) return;
          disableCompleted = true;
          onUpdate();
        },
        (error) => finish(error),
      );
    } catch (error) {
      finish(error);
    }
  });
}

/** Serialize mute-policy changes and always queue the newest desired policy behind in-flight work. */
export function queueGroupMutePolicy(
  policy: GroupMutePolicy,
  key: string,
  apply: () => Promise<void>,
  onFailure: () => void,
): boolean {
  if (
    policy.pendingKey === key ||
    (policy.appliedKey === key && policy.pendingKey === null)
  )
    return false;

  policy.requestedKey = key;
  policy.pendingKey = key;
  policy.queue = policy.queue
    .catch(() => {})
    .then(async () => {
      if (policy.requestedKey !== key) return;
      await apply();
      if (policy.requestedKey === key) {
        policy.appliedKey = key;
        policy.pendingKey = null;
      }
    })
    .catch(() => {
      if (policy.requestedKey === key) {
        policy.pendingKey = null;
        onFailure();
      }
    });
  return true;
}

export function toggleSessionMemberSelection(
  selected: ReadonlySet<string>,
  memberId: string,
  checked: boolean,
): Set<string> {
  const next = new Set(selected);
  if (checked) {
    if (!next.has(memberId) && next.size >= GROUP_CRITIQUE_MEMBER_LIMIT)
      return next;
    next.add(memberId);
  } else {
    next.delete(memberId);
  }
  return next;
}

export function canSelectSessionMember(
  selected: ReadonlySet<string>,
  memberId: string,
) {
  return selected.has(memberId) || selected.size < GROUP_CRITIQUE_MEMBER_LIMIT;
}
