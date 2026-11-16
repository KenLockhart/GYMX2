"use client";

import type { RTKParticipant } from "@cloudflare/realtimekit";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  acceptGroupCritiqueOffer,
  declineGroupCritiqueOffer,
  endGroupCritiqueRoom,
  joinGroupCritique,
  offerGroupCritiqueCameras,
  openGroupCritique,
  readGroupCritiqueSnapshot,
  setGroupCritiqueMute,
} from "@/app/(app)/calendar/[id]/live/group-actions";
import { LiveFullscreenRegion } from "@/components/live-fullscreen";
import { LiveChat } from "@/components/live-room";
import { useT } from "@/i18n/client";
import {
  GROUP_CRITIQUE_MEMBER_LIMIT,
  GROUP_CRITIQUE_MOBILE_PAGE_SIZE,
  hasGroupCritiqueCapacity,
  countUniqueLiveParticipants,
  createGroupMutePolicy,
  enableMediaOnlyWhileCurrent,
  groupCritiqueCirclePositions,
  groupCritiqueCircleStyle,
  groupCritiqueMobilePage,
  groupCritiqueParticipantEpochMatches,
  queueGroupMutePolicy,
  shouldLeaveGroupMeeting,
  type GroupMutePolicy,
} from "@/lib/group-critique-ui";
import type {
  GroupCritiqueJoinCredential,
  GroupCritiqueSnapshot,
} from "@/lib/group-critique";
import {
  checkIn,
  type LiveChatMessage,
} from "@/app/(app)/calendar/[id]/live/actions";

type RealtimeMeeting = Awaited<
  ReturnType<typeof import("@cloudflare/realtimekit").default.init>
>;
// Numeric values from the SDK's public StreamPermissionType enum.
const STREAM_PERMISSION_NOT_ALLOWED = 2;
const STREAM_PERMISSION_CAN_REQUEST = 3;
type SafeCredentials = Omit<GroupCritiqueJoinCredential, "authToken"> & {
  generation: number;
};
type CircleMember = {
  key: string;
  appMemberId: string | null;
  name: string;
  participant: RTKParticipant | null;
  customParticipantId: string | null;
  coachMuted: boolean;
  consented: boolean;
  membershipState: "eligible" | "removing" | "removed";
};

type GateProps = {
  sessionId: string;
  me: string;
  coachId: string;
  coachName: string;
  canOpen: boolean;
  canChat: boolean;
  invitees: { id: string; name: string }[];
  initialChat: LiveChatMessage[];
  initialSnapshot: GroupCritiqueSnapshot | null;
  featureEnabled: boolean;
  legacyRoomExists: boolean;
  children: ReactNode;
};

function localizeGroupError(
  error: string,
  t: ReturnType<typeof useT>["calendar"]["live"]["groupCritique"],
) {
  switch (error) {
    case "not_allowed":
      return t.notAvailable;
    case "not_found":
    case "not_ready":
      return t.notAvailable;
    case "invalid_request":
    case "temporarily_unavailable":
    default:
      return t.actionError;
  }
}

export function GroupCritiqueGate({
  sessionId,
  me,
  coachId,
  coachName,
  canOpen,
  canChat,
  invitees,
  initialChat,
  initialSnapshot,
  featureEnabled: initialFeatureEnabled,
  legacyRoomExists,
  children,
}: GateProps) {
  const t = useT().calendar.live.groupCritique;
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [featureEnabled, setFeatureEnabled] = useState(initialFeatureEnabled);
  const [snapshotError, setSnapshotError] = useState(false);
  const [snapshotFresh, setSnapshotFresh] = useState(true);
  const [opening, setOpening] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const requestRevision = useRef(0);
  const mounted = useRef(false);

  const refresh = useCallback(async () => {
    const revision = ++requestRevision.current;
    try {
      const result = await readGroupCritiqueSnapshot(sessionId);
      if (!mounted.current || revision !== requestRevision.current) return;
      if (!result.ok) {
        setSnapshotError(true);
        setSnapshotFresh(false);
        if (result.error === "not_allowed" || result.error === "not_found") {
          setSnapshot(null);
          setFeatureEnabled(false);
        }
        return;
      }
      setSnapshotError(false);
      setFeatureEnabled(result.featureEnabled);
      setSnapshotFresh(true);
      setSnapshot(result.snapshot);
    } catch {
      if (!mounted.current || revision !== requestRevision.current) return;
      setSnapshotError(true);
      setSnapshotFresh(false);
    }
  }, [sessionId]);

  useEffect(() => {
    mounted.current = true;
    let fallback: ReturnType<typeof setInterval> | undefined;
    const poll = () => void refresh();
    const startPolling = () => {
      if (!fallback) fallback = setInterval(poll, 5_000);
    };
    const stopPolling = () => {
      if (fallback) clearInterval(fallback);
      fallback = undefined;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") poll();
    };
    startPolling();
    window.addEventListener("focus", poll);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mounted.current = false;
      requestRevision.current += 1;
      stopPolling();
      window.removeEventListener("focus", poll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  async function openRoom() {
    if (opening || legacyRoomExists) return;
    setOpening(true);
    setActionError(null);
    try {
      const result = await openGroupCritique(sessionId);
      if (!result.ok) {
        setActionError(localizeGroupError(result.error, t));
        return;
      }
      await refresh();
    } catch {
      setActionError(t.actionError);
    } finally {
      setOpening(false);
    }
  }

  if (snapshot) {
    return (
      <GroupCritiqueRoom
        key={`${sessionId}:${snapshot.generation}`}
        sessionId={sessionId}
        me={me}
        coachId={coachId}
        coachName={coachName}
        canChat={canChat}
        invitees={invitees}
        initialChat={initialChat}
        snapshot={snapshot}
        featureEnabled={featureEnabled}
        snapshotFresh={snapshotFresh}
        snapshotError={snapshotError}
        onRefresh={refresh}
      />
    );
  }

  return (
    <div className="space-y-5">
      {children}
      {canOpen && (
        <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">{t.roomTitle}</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted">{t.circleHint}</p>
            </div>
            <button
              type="button"
              onClick={() => void openRoom()}
              disabled={!featureEnabled || legacyRoomExists || opening}
              className="btn-primary min-h-11 shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {opening ? t.opening : t.open}
            </button>
          </div>
          {!featureEnabled && (
            <p className="mt-3 text-sm text-muted">{t.disabled}</p>
          )}
          {legacyRoomExists && (
            <p className="mt-3 text-sm text-muted">{t.legacyRoom}</p>
          )}
          {snapshotError && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {t.snapshotError}
            </p>
          )}
          {actionError && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {actionError}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function TrackVideo({
  track,
  label,
  offLabel,
  noVideoLabel,
  onPlaying,
}: {
  track: MediaStreamTrack | null;
  label: string;
  offLabel: string;
  noVideoLabel: string;
  onPlaying?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const usableTrack = track?.readyState === "live" ? track : null;

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const stream = usableTrack ? new MediaStream([usableTrack]) : null;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => {});
    return () => {
      video.srcObject = null;
    };
  }, [usableTrack]);

  return (
    <>
      <video
        ref={ref}
        aria-label={usableTrack ? label : `${label}, ${noVideoLabel}`}
        autoPlay
        playsInline
        muted
        onPlaying={onPlaying}
        className="absolute inset-0 size-full object-cover"
      />
      {!usableTrack && (
        <span className="absolute inset-0 grid place-items-center bg-[#171a17] px-1 text-center text-[10px] font-semibold text-white/75 sm:text-xs">
          {offLabel}
        </span>
      )}
    </>
  );
}

function PeerAudioOutput({
  participant,
  soundOn,
  onBlocked,
}: {
  participant: RTKParticipant;
  soundOn: boolean;
  onBlocked: () => void;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const track =
    participant.audioEnabled && participant.audioTrack?.readyState === "live"
      ? participant.audioTrack
      : null;

  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.muted = !soundOn;
    audio.srcObject = track ? new MediaStream([track]) : null;
    if (track)
      void audio.play().catch(() => {
        if (soundOn) onBlocked();
      });
    return () => {
      audio.srcObject = null;
    };
  }, [onBlocked, soundOn, track]);

  return <audio ref={ref} autoPlay className="sr-only" aria-hidden="true" />;
}

function CircleTile({
  member,
  position,
  large = false,
  onPlaying,
}: {
  member: Pick<CircleMember, "key" | "name" | "participant"> & {
    track: MediaStreamTrack | null;
  };
  position?: { x: number; y: number; diameter: number };
  large?: boolean;
  onPlaying?: () => void;
}) {
  const messages = useT();
  const fullscreenT = messages.common.fullscreen;
  const t = messages.calendar.live.groupCritique;
  const label = large ? `${member.name}, ${fullscreenT.coachVideo}` : member.name;
  const initials = member.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
  const shell = large
    ? "group relative size-full rounded-full border-[7px] border-double border-lime-400 bg-black shadow-[0_0_0_2px_rgba(200,241,53,.65),0_0_34px_rgba(200,241,53,.20)]"
    : "group relative size-full rounded-full border-2 border-lime-300/80 bg-black shadow-[0_0_18px_rgba(200,241,53,.18)]";
  const frame = `absolute ${large ? "inset-[7px]" : "inset-[2px]"} overflow-hidden rounded-full bg-black`;
  const expandedShell =
    "fixed inset-0 z-[120] grid place-items-center bg-black p-4 [&_[data-circle-frame]]:!absolute [&_[data-circle-frame]]:!inset-0 [&_[data-circle-frame]]:!overflow-visible [&_[data-circle-frame]]:!rounded-none [&_video]:!relative [&_video]:!inset-auto [&_video]:!h-[calc(100dvh-5rem)] [&_video]:!max-h-[82dvh] [&_video]:!w-full [&_video]:!max-w-[90vw] [&_video]:!object-contain [&_video]:!object-center [&_span[data-name]]:!bottom-2 [&_span[data-name]]:!left-1/2 [&_span[data-name]]:!-translate-x-1/2 [&_span[data-name]]:!top-auto [&_span[data-name]]:!w-[min(90vw,1000px)]";

  return (
    <div
      className="absolute aspect-square"
      style={
        position
          ? groupCritiqueCircleStyle(position)
          : large
            ? { left: "36%", top: "36%", width: "28%" }
            : undefined
      }
    >
      <LiveFullscreenRegion
        label={label}
        className={shell}
        expandedClassName={expandedShell}
        controlPlacement="outside"
        compactControl
      >
        <div data-circle-frame className={frame}>
          <TrackVideo
            track={member.track}
            label={label}
            offLabel={large ? t.noVideo : initials}
            noVideoLabel={t.noVideo}
            onPlaying={onPlaying}
          />
        </div>
      </LiveFullscreenRegion>
      <span
        data-name
        title={member.name}
        className="pointer-events-none absolute left-1/2 top-full z-10 mt-0.5 w-[calc(100%+clamp(16px,3vw,24px))] -translate-x-1/2 truncate px-1 text-center text-[9px] font-semibold leading-3 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,.95)]"
      >
        {member.name}
      </span>
      {large && (
        <span className="absolute -left-1 -top-1 z-30 rounded-full border border-lime-200/70 bg-black/80 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-lime-200 sm:text-xs">
          {t.coach}
        </span>
      )}
    </div>
  );
}

function GroupCritiqueRoom({
  sessionId,
  me,
  coachId,
  coachName,
  canChat,
  invitees,
  initialChat,
  snapshot,
  featureEnabled,
  snapshotFresh,
  snapshotError,
  onRefresh,
}: {
  sessionId: string;
  me: string;
  coachId: string;
  coachName: string;
  canChat: boolean;
  invitees: { id: string; name: string }[];
  initialChat: LiveChatMessage[];
  snapshot: GroupCritiqueSnapshot;
  featureEnabled: boolean;
  snapshotFresh: boolean;
  snapshotError: boolean;
  onRefresh: () => Promise<void>;
}) {
  const messages = useT();
  const t = messages.calendar.live.groupCritique;
  const youLabel = messages.calendar.live.you;
  const [meeting, setMeeting] = useState<RealtimeMeeting | null>(null);
  const meetingRef = useRef<RealtimeMeeting | null>(null);
  const [credentials, setCredentials] = useState<SafeCredentials | null>(null);
  const credentialsRef = useRef<SafeCredentials | null>(null);
  const [peers, setPeers] = useState<RTKParticipant[]>([]);
  const [joining, setJoining] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [offering, setOffering] = useState(false);
  const [ending, setEnding] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [offerCount, setOfferCount] = useState<number | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [selectedInvitees, setSelectedInvitees] = useState<Set<string>>(
    () => new Set(),
  );
  const [soundOn, setSoundOn] = useState(false);
  const [soundError, setSoundError] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [microphoneBusy, setMicrophoneBusy] = useState(false);
  const [stageStatus, setStageStatus] = useState<string>("OFF_STAGE");
  const [mobile, setMobile] = useState(false);
  const [mobilePage, setMobilePage] = useState(0);
  const joinRevision = useRef(0);
  const cameraIntent = useRef(0);
  const microphoneIntent = useRef(0);
  const cameraBusyRef = useRef(false);
  const microphoneBusyRef = useRef(false);
  const mounted = useRef(false);
  const checkedIn = useRef(false);
  const stageIntent = useRef(false);
  const joiningStage = useRef(false);
  const mutePolicies = useRef(new Map<string, GroupMutePolicy>());
  const [muteRetry, setMuteRetry] = useState(0);
  const ownMember = snapshot.members.find((member) => member.memberId === me) ?? null;
  const roomOpen = snapshot.state === "open" && featureEnabled;
  const joinedOpen = roomOpen && snapshotFresh;
  const isCoach = snapshot.role === "coach";
  const hasConsented = Boolean(
    ownMember?.cameraAllowed && ownMember.microphoneAllowed,
  );
  const canUseDevices = Boolean(
    joinedOpen &&
      (isCoach ||
        (hasConsented && ownMember?.membershipState === "eligible")),
  );
  const memberIsMuted = Boolean(ownMember?.coachMuted);
  const canRequestPublisher = Boolean(
    credentials?.canPublishAudio || credentials?.canPublishVideo,
  );
  const publisherReady = isCoach || stageStatus === "ON_STAGE";

  const leaveMeeting = useCallback(async (client: RealtimeMeeting) => {
    try {
      if (client.self.videoEnabled) await client.self.disableVideo();
      if (client.self.audioEnabled) await client.self.disableAudio();
    } catch {
      // Leaving the room below is the final media cleanup boundary.
    }
    try {
      await client.leave();
    } catch {
      // Ignore teardown errors; don't keep stale media attached in the UI.
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const query = window.matchMedia("(max-width: 700px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => {
      mounted.current = false;
      joinRevision.current += 1;
      query.removeEventListener("change", update);
      const current = meetingRef.current;
      meetingRef.current = null;
      if (current) void leaveMeeting(current);
    };
  }, [leaveMeeting]);

  const leaveRoom = useCallback(async () => {
    joinRevision.current += 1;
    cameraIntent.current += 1;
    microphoneIntent.current += 1;
    cameraBusyRef.current = false;
    microphoneBusyRef.current = false;
    stageIntent.current = false;
    joiningStage.current = false;
    const current = meetingRef.current;
    meetingRef.current = null;
    credentialsRef.current = null;
    setMeeting(null);
    setCredentials(null);
    setPeers([]);
    setStageStatus("OFF_STAGE");
    setSoundOn(false);
    setCameraBusy(false);
    setMicrophoneBusy(false);
    if (current) await leaveMeeting(current);
  }, [leaveMeeting]);

  useEffect(() => {
    if (!meeting || !credentials) return;
    if (
      shouldLeaveGroupMeeting(
        roomOpen,
        credentials.generation,
        snapshot.generation,
        credentials.expiresAt,
        Date.now(),
      ) ||
      credentialsRef.current?.generation !== snapshot.generation
    )
      void leaveRoom();
  }, [credentials, leaveRoom, meeting, roomOpen, snapshot.generation]);

  useEffect(() => {
    if (snapshotFresh || !meeting) return;
    if (meeting.self.videoEnabled) void meeting.self.disableVideo().catch(() => {});
    if (meeting.self.audioEnabled) void meeting.self.disableAudio().catch(() => {});
  }, [meeting, snapshotFresh]);

  useEffect(() => {
    if (!meeting || isCoach || !ownMember) return;
    const noLongerConsented =
      !ownMember.cameraAllowed ||
      !ownMember.microphoneAllowed ||
      ownMember.membershipState !== "eligible";
    if ((memberIsMuted || noLongerConsented) && meeting.self.audioEnabled)
      void meeting.self.disableAudio().catch(() => {});
    if (noLongerConsented && meeting.self.videoEnabled)
      void meeting.self.disableVideo().catch(() => {});
  }, [isCoach, meeting, memberIsMuted, ownMember]);

  useEffect(() => {
    if (!meeting || !credentials || isCoach || !ownMember) return;
    const consentedCustomId = ownMember.cameraAllowed && ownMember.microphoneAllowed
      ? ownMember.customParticipantId
      : null;
    const staleObserver = credentials.preset === "observer" && hasConsented;
    const staleConsent =
      credentials.preset === "consented" &&
      (!ownMember.cameraAllowed ||
        !ownMember.microphoneAllowed ||
        ownMember.membershipState !== "eligible" ||
        !groupCritiqueParticipantEpochMatches(
          credentials.customParticipantId,
          ownMember.participantEpoch,
        ) ||
        (consentedCustomId !== null &&
          credentials.customParticipantId !== consentedCustomId));
    const expectedAudioPermission = ownMember.microphoneAllowed;
    const expectedVideoPermission = ownMember.cameraAllowed;
    const stalePermission =
      credentials.canPublishAudio !== expectedAudioPermission ||
      credentials.canPublishVideo !== expectedVideoPermission;
    if (staleObserver || staleConsent || stalePermission)
      queueMicrotask(() => void leaveRoom());
  }, [credentials, hasConsented, isCoach, leaveRoom, meeting, memberIsMuted, ownMember]);

  useEffect(() => {
    if (!meeting) return;
    let active = true;
    const syncPeers = () => {
      if (active) setPeers(meeting.participants.joined.toArray());
    };
    const onPeerUpdate = () => syncPeers();
    const attachToPeer = (peer: RTKParticipant) => {
      peer.on("videoUpdate", onPeerUpdate);
      peer.on("audioUpdate", onPeerUpdate);
    };
    const onPeerJoined = (peer: RTKParticipant) => {
      attachToPeer(peer);
      syncPeers();
    };
    const onPeerLeft = (peer: RTKParticipant) => {
      peer.off("videoUpdate", onPeerUpdate);
      peer.off("audioUpdate", onPeerUpdate);
      syncPeers();
    };
    const onParticipantsUpdate = () => syncPeers();
    const onRoomLeft = () => {
      if (active && meetingRef.current === meeting) void leaveRoom();
    };
    const onStageUpdate = (status: string) => {
      if (!active) return;
      setStageStatus(status);
      if (status === "ON_STAGE") {
        stageIntent.current = false;
        joiningStage.current = false;
        return;
      }
      if (
        status === "ACCEPTED_TO_JOIN_STAGE" &&
        stageIntent.current &&
        !joiningStage.current
      ) {
        joiningStage.current = true;
        void meeting.stage
          .join()
          .then(() => {
            if (active) setStageStatus(meeting.stage.status);
          })
          .catch(() => {
            if (active) setError(t.actionError);
          })
          .finally(() => {
            joiningStage.current = false;
          });
      }
    };
    meeting.participants.joined.toArray().forEach(attachToPeer);
    meeting.participants.joined.on("participantJoined", onPeerJoined);
    meeting.participants.joined.on("participantLeft", onPeerLeft);
    meeting.participants.joined.on("participantsUpdate", onParticipantsUpdate);
    meeting.stage.on("stageStatusUpdate", onStageUpdate);
    meeting.self.on("videoUpdate", onPeerUpdate);
    meeting.self.on("audioUpdate", onPeerUpdate);
    meeting.self.on("roomLeft", onRoomLeft);
    syncPeers();
    return () => {
      active = false;
      meeting.participants.joined.off("participantJoined", onPeerJoined);
      meeting.participants.joined.off("participantLeft", onPeerLeft);
      meeting.participants.joined.off("participantsUpdate", onParticipantsUpdate);
      meeting.stage.off("stageStatusUpdate", onStageUpdate);
      meeting.self.off("videoUpdate", onPeerUpdate);
      meeting.self.off("audioUpdate", onPeerUpdate);
      meeting.self.off("roomLeft", onRoomLeft);
      meeting.participants.joined.toArray().forEach((peer) => {
        peer.off("videoUpdate", onPeerUpdate);
        peer.off("audioUpdate", onPeerUpdate);
      });
    };
  }, [leaveRoom, meeting, t.actionError]);

  useEffect(() => {
    if (!meeting || !isCoach || snapshot.state !== "open" || !snapshotFresh) return;
    let active = true;
    let granting = false;
    const reconcileRequests = async () => {
      if (granting) return;
      granting = true;
      try {
        const fresh = await readGroupCritiqueSnapshot(sessionId);
        if (
          !fresh.ok ||
          !fresh.featureEnabled ||
          !fresh.snapshot ||
          fresh.snapshot.role !== "coach" ||
          fresh.snapshot.state !== "open" ||
          fresh.snapshot.generation !== snapshot.generation
        ) {
          const { stageRequests } = await meeting.stage.getAccessRequests();
          for (const request of stageRequests) {
            if (!active) return;
            await meeting.stage.denyAccess([request.userId]);
          }
          return;
        }
        const { stageRequests } = await meeting.stage.getAccessRequests();
        for (const request of stageRequests) {
          if (!active) return;
          const participant = meeting.participants.joined.get(request.peerId);
          const consentedParticipant = participant
            ? fresh.snapshot.members.some(
                (member) =>
                  member.membershipState === "eligible" &&
                  member.cameraAllowed &&
                  member.microphoneAllowed &&
                  member.customParticipantId === participant.customParticipantId,
              )
            : false;
          if (consentedParticipant)
            await meeting.stage.grantAccess([request.userId]);
          else await meeting.stage.denyAccess([request.userId]);
        }
      } catch {
        if (active) setError(t.actionError);
      } finally {
        granting = false;
      }
    };
    meeting.stage.on("newStageRequest", reconcileRequests);
    meeting.stage.on("stageAccessRequestUpdate", reconcileRequests);
    void reconcileRequests();
    return () => {
      active = false;
      meeting.stage.off("newStageRequest", reconcileRequests);
      meeting.stage.off("stageAccessRequestUpdate", reconcileRequests);
    };
  }, [isCoach, meeting, sessionId, snapshot.generation, snapshot.state, snapshotFresh, t.actionError]);

  useEffect(() => {
    if (!meeting || !isCoach || !snapshotFresh) return;
    for (const member of snapshot.members) {
      if (
        !member.cameraAllowed ||
        !member.microphoneAllowed ||
        !member.customParticipantId
      )
        continue;
      const peer = peers.find(
        (candidate) =>
          candidate.customParticipantId === member.customParticipantId &&
          member.customParticipantId !== null,
      );
      if (!peer) continue;
      const shouldMute = member.coachMuted || member.membershipState !== "eligible";
      const policyKey = `${member.participantEpoch}:${member.membershipState}:${shouldMute}`;
      const policy = mutePolicies.current.get(peer.id) ?? createGroupMutePolicy();
      mutePolicies.current.set(peer.id, policy);
      const canProduceAudio = shouldMute
        ? STREAM_PERMISSION_NOT_ALLOWED
        : STREAM_PERMISSION_CAN_REQUEST;
      queueGroupMutePolicy(
        policy,
        policyKey,
        async () => {
          await meeting.participants.updatePermissions([peer.id], {
            media: {
              audio: { canProduce: canProduceAudio },
              ...(member.membershipState !== "eligible"
                ? { video: { canProduce: STREAM_PERMISSION_NOT_ALLOWED } }
                : {}),
            },
          });
          if (shouldMute) await peer.disableAudio();
          if (member.membershipState !== "eligible")
            await peer.disableVideo();
        },
        () => {
          setError(t.actionError);
          window.setTimeout(() => {
            if (mounted.current && policy.requestedKey === policyKey)
              setMuteRetry((revision) => revision + 1);
          }, 3_000);
        },
      );
    }
  }, [isCoach, meeting, muteRetry, peers, snapshot.members, snapshotFresh, t.actionError]);

  const ownTrack = meeting?.self.videoEnabled ? meeting.self.videoTrack : null;
  const remoteCoach = peers.find((peer) => peer.isHost) ?? null;
  const centerTile = isCoach
    ? { key: "coach", name: coachName || t.coach, participant: null, track: ownTrack }
    : {
        key: remoteCoach?.id ?? "coach",
        name: remoteCoach?.name || coachName || t.coach,
        participant: remoteCoach,
        track:
          remoteCoach?.videoEnabled && remoteCoach.videoTrack?.readyState === "live"
            ? remoteCoach.videoTrack
            : null,
      };

  const circleMembers: CircleMember[] = useMemo(() => {
    const remoteMembers = peers.filter((peer) => !peer.isHost);
    if (isCoach) {
      return snapshot.members
        .filter((member) => member.membershipState !== "removed")
        .slice(0, GROUP_CRITIQUE_MEMBER_LIMIT)
        .map((member) => {
          const participant = member.customParticipantId
            ? remoteMembers.find(
                (peer) => peer.customParticipantId === member.customParticipantId,
              ) ?? null
            : null;
          return {
            key: member.memberId,
            appMemberId: member.memberId,
            name: member.displayName,
            participant,
            customParticipantId: member.customParticipantId,
            coachMuted: member.coachMuted,
            consented: member.cameraAllowed && member.microphoneAllowed,
            membershipState: member.membershipState,
          };
        });
    }

    const localMember: CircleMember = {
      key: me,
      appMemberId: me,
      name: youLabel,
      participant: null,
      customParticipantId: credentials?.customParticipantId ?? null,
      coachMuted: memberIsMuted,
      consented: hasConsented,
      membershipState: ownMember?.membershipState ?? "eligible",
    };
    const otherMembers = remoteMembers.map((participant) => ({
      key: participant.customParticipantId ?? participant.id,
      appMemberId:
        snapshot.members.find(
          (member) => member.customParticipantId === participant.customParticipantId,
        )?.memberId ?? null,
      name:
        snapshot.members.find(
          (member) => member.customParticipantId === participant.customParticipantId,
        )?.displayName ?? participant.name,
      participant,
      customParticipantId: participant.customParticipantId ?? null,
      coachMuted: false,
      consented: true,
      membershipState: "eligible" as const,
    }));
    return [localMember, ...otherMembers].slice(0, GROUP_CRITIQUE_MEMBER_LIMIT);
  }, [
    credentials?.customParticipantId,
    hasConsented,
    isCoach,
    me,
    memberIsMuted,
    ownMember,
    peers,
    snapshot.members,
    youLabel,
  ]);

  const mobilePageCount = Math.max(
    1,
    Math.ceil(circleMembers.length / GROUP_CRITIQUE_MOBILE_PAGE_SIZE),
  );
  const currentMobilePage = Math.min(mobilePage, mobilePageCount - 1);
  const visibleMembers = mobile
    ? groupCritiqueMobilePage(circleMembers, currentMobilePage)
    : circleMembers.slice(0, GROUP_CRITIQUE_MEMBER_LIMIT);
  const positions = groupCritiqueCirclePositions(visibleMembers.length);
  const joinedCount = countUniqueLiveParticipants(
    peers.map((peer) => peer.userId),
    me,
    Boolean(meeting),
  );
  const ownOffered = Boolean(
    ownMember?.offeredAt && ownMember.membershipState === "eligible",
  );
  const needsConsent = ownOffered && !hasConsented;

  const roomStateLabel =
    snapshot.state === "open"
      ? t.live
      : snapshot.state === "provisioning"
        ? t.preparing
        : snapshot.state === "ending"
          ? t.closing
          : t.ended;

  async function joinRoom() {
    if (!joinedOpen || meetingRef.current || joining) return;
    const revision = ++joinRevision.current;
    setJoining(true);
    setError(null);
    let created: RealtimeMeeting | null = null;
    try {
      const result = await joinGroupCritique(sessionId, snapshot.generation);
      if (!result.ok) {
        if (mounted.current && revision === joinRevision.current)
          setError(localizeGroupError(result.error, t));
        return;
      }
      const { authToken, ...safeCredentials } = result.credentials;
      const sdk = await import("@cloudflare/realtimekit");
      created = await sdk.default.init({
        authToken,
        defaults: { audio: false, video: false },
        modules: { experimentalAudioPlayback: false },
        onError: () => {
          if (mounted.current && revision === joinRevision.current)
            setError(t.connectionError);
        },
      });
      // The pinned SDK setter rejects values above 24; the verified preset supplies 31.
      if (
        !hasGroupCritiqueCapacity(
          created.participants.maxActiveParticipantsCount,
        )
      )
        throw new Error("unsupported_group_critique_capacity");
      await created.participants.setViewMode("ACTIVE_GRID");
      await created.join();
      if (!mounted.current || revision !== joinRevision.current) {
        await leaveMeeting(created);
        return;
      }
      meetingRef.current = created;
      credentialsRef.current = { ...safeCredentials, generation: snapshot.generation };
      setCredentials({ ...safeCredentials, generation: snapshot.generation });
      setMeeting(created);
      setPeers(created.participants.joined.toArray());
      setStageStatus(created.stage.status);
      setSoundOn(false);
      checkedIn.current = false;
      created = null;
    } catch {
      if (created) await leaveMeeting(created);
      if (mounted.current && revision === joinRevision.current)
        setError(t.connectionError);
    } finally {
      if (mounted.current && revision === joinRevision.current) setJoining(false);
    }
  }

  async function requestToGoLive() {
    if (!meeting || !canUseDevices || !canRequestPublisher || isCoach || !joinedOpen) return;
    setError(null);
    stageIntent.current = true;
    try {
      if (meeting.stage.status === "ACCEPTED_TO_JOIN_STAGE") {
        if (joiningStage.current) return;
        joiningStage.current = true;
        await meeting.stage.join();
        joiningStage.current = false;
      } else if (
        meeting.stage.status !== "ON_STAGE" &&
        meeting.stage.status !== "REQUESTED_TO_JOIN_STAGE"
      ) {
        await meeting.stage.requestAccess();
      }
      setStageStatus(meeting.stage.status);
    } catch {
      joiningStage.current = false;
      stageIntent.current = false;
      setError(t.actionError);
    }
  }

  async function hasFreshPublishAuthorization(kind: "audio" | "video") {
    try {
      const result = await readGroupCritiqueSnapshot(sessionId);
      if (!result.ok || !result.featureEnabled || !result.snapshot) {
        await onRefresh();
        return false;
      }
      const current = result.snapshot;
      const currentMember = current.members.find((member) => member.memberId === me);
      const allowed =
        current.generation === snapshot.generation &&
        current.state === "open" &&
        (isCoach
          ? current.role === "coach"
          : current.role === "member" &&
            Boolean(
              currentMember &&
                currentMember.membershipState === "eligible" &&
                currentMember.customParticipantId === credentials?.customParticipantId &&
                groupCritiqueParticipantEpochMatches(
                  credentials?.customParticipantId ?? "",
                  currentMember.participantEpoch,
                ) &&
                (kind === "video"
                  ? currentMember.cameraAllowed
                  : currentMember.microphoneAllowed && !currentMember.coachMuted),
            ));
      if (!allowed) await onRefresh();
      return allowed;
    } catch {
      await onRefresh();
      return false;
    }
  }

  async function toggleCamera() {
    const client = meetingRef.current;
    if (!client || cameraBusyRef.current || !mounted.current) return;
    const sessionRevision = joinRevision.current;
    const intent = ++cameraIntent.current;
    const isCurrent = () =>
      mounted.current &&
      meetingRef.current === client &&
      joinRevision.current === sessionRevision &&
      cameraIntent.current === intent;
    cameraBusyRef.current = true;
    setCameraBusy(true);
    setError(null);
    try {
      if (client.self.videoEnabled) {
        await client.self.disableVideo();
        return;
      }
      if (!publisherReady || !canUseDevices || !credentials?.canPublishVideo)
        return;
      await enableMediaOnlyWhileCurrent({
        isCurrent,
        authorize: () => hasFreshPublishAuthorization("video"),
        enable: () => client.self.enableVideo(),
        disable: () => client.self.disableVideo(),
      });
    } catch {
      if (isCurrent()) setError(t.deviceError);
    } finally {
      if (isCurrent()) {
        cameraBusyRef.current = false;
        setCameraBusy(false);
      }
    }
  }

  async function toggleMicrophone() {
    const client = meetingRef.current;
    if (!client || microphoneBusyRef.current || !mounted.current) return;
    const sessionRevision = joinRevision.current;
    const intent = ++microphoneIntent.current;
    const isCurrent = () =>
      mounted.current &&
      meetingRef.current === client &&
      joinRevision.current === sessionRevision &&
      microphoneIntent.current === intent;
    microphoneBusyRef.current = true;
    setMicrophoneBusy(true);
    setError(null);
    try {
      if (client.self.audioEnabled) {
        await client.self.disableAudio();
        return;
      }
      if (
        !publisherReady ||
        !canUseDevices ||
        !credentials?.canPublishAudio ||
        memberIsMuted
      )
        return;
      await enableMediaOnlyWhileCurrent({
        isCurrent,
        authorize: () => hasFreshPublishAuthorization("audio"),
        enable: () => client.self.enableAudio(),
        disable: () => client.self.disableAudio(),
      });
    } catch {
      if (isCurrent()) setError(t.deviceError);
    } finally {
      if (isCurrent()) {
        microphoneBusyRef.current = false;
        setMicrophoneBusy(false);
      }
    }
  }

  function toggleSound() {
    const next = !soundOn;
    setSoundError(false);
    setSoundOn(next);
  }

  async function consentToOffer() {
    if (!snapshotFresh || !ownOffered || accepting || !consentChecked) return;
    setAccepting(true);
    setError(null);
    try {
      const result = await acceptGroupCritiqueOffer(sessionId, snapshot.generation);
      if (!result.ok) setError(localizeGroupError(result.error, t));
      else {
        setConsentChecked(false);
        await onRefresh();
      }
    } catch {
      setError(t.actionError);
    } finally {
      setAccepting(false);
    }
  }

  async function declineOffer() {
    if (!snapshotFresh) return;
    setError(null);
    try {
      // Stop any local publishing before asking the server to revoke consent.
      if (meetingRef.current) await leaveRoom();
      const result = await declineGroupCritiqueOffer(sessionId, snapshot.generation);
      if (!result.ok) setError(localizeGroupError(result.error, t));
      else await onRefresh();
    } catch {
      setError(t.actionError);
    }
  }

  async function sendOffer(memberId?: string) {
    if (!snapshotFresh || !isCoach || offering || snapshot.state !== "open") return;
    setOffering(true);
    setOfferError(null);
    setOfferCount(null);
    try {
      const result = await offerGroupCritiqueCameras(
        sessionId,
        snapshot.generation,
        memberId,
      );
      if (!result.ok) {
        setOfferError(localizeGroupError(result.error, t));
        return;
      }
      setOfferCount(result.offeredCount);
      setSelectedInvitees(new Set());
      await onRefresh();
    } catch {
      setOfferError(t.offerError);
    } finally {
      setOffering(false);
    }
  }

  async function setMuted(memberId: string | null, muted: boolean) {
    if (!snapshotFresh) return;
    try {
      const result = await setGroupCritiqueMute(
        sessionId,
        snapshot.generation,
        memberId,
        muted,
      );
      if (!result.ok) setError(localizeGroupError(result.error, t));
      else await onRefresh();
    } catch {
      setError(t.actionError);
    }
  }

  async function endRoom() {
    if (!snapshotFresh || !isCoach || ending || snapshot.state !== "open") return;
    if (!window.confirm(t.confirmEnd)) return;
    setEnding(true);
    setError(null);
    try {
      const result = await endGroupCritiqueRoom(sessionId, snapshot.generation);
      if (!result.ok) setError(localizeGroupError(result.error, t));
      await onRefresh();
    } catch {
      setError(t.actionError);
    } finally {
      setEnding(false);
    }
  }

  async function reopenRoom() {
    if (!snapshotFresh || !isCoach || reopening || snapshot.state !== "ended") return;
    setReopening(true);
    setError(null);
    try {
      const result = await openGroupCritique(sessionId);
      if (!result.ok) setError(localizeGroupError(result.error, t));
      await onRefresh();
    } catch {
      setError(t.actionError);
    } finally {
      setReopening(false);
    }
  }

  const onAudioBlocked = useCallback(() => setSoundError(true), []);

  const hostTrack = centerTile.track;
  const hostMember = {
    key: centerTile.key,
    name: centerTile.name,
    participant: centerTile.participant,
    track: hostTrack,
  };

  return (
    <LiveFullscreenRegion
      label={t.roomTitle}
      className="relative rounded-xl border border-border bg-[#0b0d0b] p-3 text-white sm:p-5"
      expandedClassName="fixed inset-0 z-[100] h-dvh overflow-y-auto bg-[#090b09] p-2 text-white sm:p-4 [&_video]:object-contain [&_video]:object-center [&_[data-group-layout]]:gap-2 [&_[data-group-stage-column]]:flex [&_[data-group-stage-column]]:min-h-0 [&_[data-group-stage-column]]:flex-col [&_[data-group-stage]]:max-h-[calc(100dvh-17rem)] [&_[data-group-stage]]:max-w-[min(calc(100dvh-17rem),100%)] [&_[data-group-stage]]:shrink-0 [&_[data-group-header]]:mb-1 [&_[data-group-header]]:gap-2 [&_[data-circle-hint]]:hidden [&_[data-group-disclosure]]:text-[10px] [&_[data-group-controls]]:sticky [&_[data-group-controls]]:bottom-0 [&_[data-group-controls]]:z-30 [&_[data-group-controls]]:mt-2 [&_[data-group-controls]]:bg-[#171a17] [&_[data-group-controls]]:shadow-[0_-10px_18px_rgba(9,11,9,.95)]"
      controlPlacement="inline"
    >
      <div aria-hidden="true" className="sr-only">
        {peers
          .filter((peer) => peer.id !== credentials?.participantId)
          .map((peer) => (
            <PeerAudioOutput
              key={peer.id}
              participant={peer}
              soundOn={soundOn}
              onBlocked={onAudioBlocked}
            />
          ))}
      </div>
      <div data-group-layout className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section data-group-stage-column className="min-w-0">
          <div data-group-header className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-lime-300">
                {roomStateLabel}
              </p>
              <h2 className="mt-1 text-xl font-semibold sm:text-2xl">{t.roomTitle}</h2>
              <p data-circle-hint className="mt-1 text-sm text-white/65">{t.circleHint}</p>
              <p data-group-disclosure className="mt-1 text-xs text-white/50">{t.groupNotRecorded}</p>
            </div>
            <span className="rounded-full border border-lime-300/40 px-3 py-1 text-xs font-semibold text-lime-100">
              {t.joined(joinedCount)}
            </span>
          </div>

          <div data-group-stage className="relative mx-auto aspect-square w-full max-w-[min(78vh,100%)] overflow-visible rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_center,rgba(200,241,53,.09),transparent_48%),linear-gradient(145deg,#151815,#090b09)]">
            <CircleTile
              member={hostMember}
              large
              onPlaying={() => {
                if (!isCoach && !checkedIn.current) {
                  checkedIn.current = true;
                  void checkIn(sessionId).catch(() => {});
                }
              }}
            />
            {visibleMembers.map((member, index) => {
              const point = positions[index];
              const isLocalMember = !isCoach && member.key === me;
              const track = isLocalMember
                ? meeting?.self.videoEnabled
                  ? meeting.self.videoTrack
                  : null
                : member.participant?.videoEnabled &&
                    member.participant.videoTrack?.readyState === "live"
                  ? member.participant.videoTrack
                  : null;
              const name = isCoach
                ? member.name
                : member.name || member.participant?.name || t.members;
              return (
                <CircleTile
                  key={member.key}
                  member={{ ...member, name, track }}
                  position={point}
                />
              );
            })}
          </div>

          {mobile && circleMembers.length > GROUP_CRITIQUE_MOBILE_PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-center gap-3">
              <button
                type="button"
                className="btn-secondary min-h-11"
                disabled={mobilePage === 0}
                onClick={() => setMobilePage((page) => Math.max(0, page - 1))}
              >
                {t.previousPage}
              </button>
              <span className="text-xs text-muted">
                {t.mobilePage(
                  mobilePage + 1,
                  Math.ceil(circleMembers.length / GROUP_CRITIQUE_MOBILE_PAGE_SIZE),
                )}
              </span>
              <button
                type="button"
                className="btn-secondary min-h-11"
                disabled={
                  mobilePage >=
                  Math.ceil(circleMembers.length / GROUP_CRITIQUE_MOBILE_PAGE_SIZE) - 1
                }
                onClick={() => setMobilePage((page) => page + 1)}
              >
                {t.nextPage}
              </button>
            </div>
          )}

          <div data-group-controls className="mt-4 flex flex-wrap items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#171a17] p-3">
            {!meeting ? (
              <button
                type="button"
                onClick={() => void joinRoom()}
                disabled={!joinedOpen || joining}
                className="btn-primary min-h-11 disabled:opacity-50"
              >
                {joining ? t.joining : t.join}
              </button>
            ) : (
              <>
                {!isCoach && canRequestPublisher && stageStatus !== "ON_STAGE" && (
                  <button
                    type="button"
                    onClick={() => void requestToGoLive()}
                    disabled={!canUseDevices || !joinedOpen}
                    className="btn-primary min-h-11"
                  >
                    {stageStatus === "REQUESTED_TO_JOIN_STAGE" ? t.waitingForStage : t.goLive}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void toggleMicrophone()}
                  disabled={Boolean(
                    microphoneBusy ||
                      (!meeting.self.audioEnabled &&
                        (!publisherReady ||
                          !canUseDevices ||
                          !credentials?.canPublishAudio ||
                          memberIsMuted)),
                  )}
                  className="btn-secondary min-h-11"
                  aria-pressed={Boolean(meeting.self.audioEnabled)}
                >
                  {meeting.self.audioEnabled ? t.turnMicrophoneOff : t.turnMicrophoneOn}
                </button>
                <button
                  type="button"
                  onClick={() => void toggleCamera()}
                  disabled={Boolean(
                    cameraBusy ||
                      (!meeting.self.videoEnabled &&
                        (!publisherReady ||
                          !canUseDevices ||
                          !credentials?.canPublishVideo)),
                  )}
                  className="btn-secondary min-h-11"
                  aria-pressed={Boolean(meeting.self.videoEnabled)}
                >
                  {meeting.self.videoEnabled ? t.turnCameraOff : t.turnCameraOn}
                </button>
                <button
                  type="button"
                  onClick={() => void toggleSound()}
                  className="btn-secondary min-h-11"
                  aria-pressed={soundOn}
                >
                  {soundOn ? t.muteSound : t.turnSoundOn}
                </button>
                {memberIsMuted && !isCoach && (
                  <span className="text-xs text-amber-200">{t.memberMuted}</span>
                )}
                <button
                  type="button"
                  onClick={() => void leaveRoom()}
                  className="btn-secondary min-h-11"
                >
                  {t.leave}
                </button>
              </>
            )}
            {isCoach && snapshot.state === "open" && (
              <button
                type="button"
                onClick={() => void endRoom()}
                disabled={ending}
                className="rounded-md border border-danger/70 px-4 py-2 text-sm font-semibold text-red-200 hover:bg-danger/10 disabled:opacity-50"
              >
                {ending ? t.ending : t.end}
              </button>
            )}
          </div>
          {snapshotError && <p role="alert" className="mt-3 text-sm text-amber-200">{t.snapshotError}</p>}
          {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
          {soundError && <p role="status" className="mt-3 text-sm text-muted">{t.soundBlocked}</p>}
          {needsConsent && (
            <section className="mt-4 rounded-xl border border-lime-300/30 bg-lime-300/5 p-4">
              <h3 className="font-semibold text-lime-100">{t.consentTitle}</h3>
              <p className="mt-1 text-sm text-white/75">{t.offered}</p>
              <label className="mt-3 flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(event) => setConsentChecked(event.target.checked)}
                  className="mt-1 size-4 accent-lime-300"
                />
                <span>{t.consentCopy}</span>
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary min-h-11"
                  disabled={!consentChecked || accepting}
                  onClick={() => void consentToOffer()}
                >
                  {accepting ? t.accepting : t.accept}
                </button>
                <button type="button" className="btn-secondary min-h-11" onClick={() => void declineOffer()}>
                  {t.decline}
                </button>
              </div>
            </section>
          )}
          {!isCoach && ownOffered && hasConsented && (
            <p className="mt-3 text-sm text-lime-100">{t.consentAccepted}</p>
          )}
        </section>

        <aside className="min-w-0 space-y-4">
          <LiveChat
            sessionId={sessionId}
            me={me}
            coachId={coachId}
            canChat={canChat}
            names={{ [coachId]: coachName, [me]: youLabel }}
            initialChat={initialChat}
            live={snapshot.state === "open"}
          />
          {isCoach && (
            <CoachRoomManagement
              snapshot={snapshot}
              invitees={invitees}
              selected={selectedInvitees}
              onSelected={setSelectedInvitees}
              onOffer={sendOffer}
              onMute={(memberId, muted) => void setMuted(memberId, muted)}
              offering={offering}
              offeredCount={offerCount}
              offerError={offerError}
            />
          )}
        </aside>
      </div>
      {snapshot.state !== "open" && (
        <p role="status" className="mt-4 rounded-lg border border-border p-3 text-sm text-muted">
          {roomStateLabel}
        </p>
      )}
      {isCoach && snapshot.state === "ended" && (
        <button
          type="button"
          className="btn-primary mt-3 min-h-11"
          disabled={!snapshotFresh || reopening}
          onClick={() => void reopenRoom()}
        >
          {reopening ? t.reopening : t.reopen}
        </button>
      )}
    </LiveFullscreenRegion>
  );
}

function CoachRoomManagement({
  snapshot,
  invitees,
  selected,
  onSelected,
  onOffer,
  onMute,
  offering,
  offeredCount,
  offerError,
}: {
  snapshot: GroupCritiqueSnapshot;
  invitees: { id: string; name: string }[];
  selected: Set<string>;
  onSelected: (next: Set<string>) => void;
  onOffer: (memberId?: string) => Promise<void>;
  onMute: (memberId: string | null, muted: boolean) => void;
  offering: boolean;
  offeredCount: number | null;
  offerError: string | null;
}) {
  const t = useT().calendar.live.groupCritique;
  const liveMembers = snapshot.members.filter(
    (member) => member.membershipState !== "removed",
  );
  const allMuted = snapshot.allMembersMuted;
  return (
    <section className="rounded-xl border border-white/10 bg-[#171a17] p-4">
      <h3 className="font-semibold">{t.offerHeading}</h3>
      {snapshot.state === "open" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary min-h-11"
            disabled={offering || invitees.length === 0}
            onClick={() => void onOffer()}
          >
            {offering ? t.offering : t.selectAll}
          </button>
          <button
            type="button"
            className="btn-primary min-h-11"
            disabled={offering || selected.size !== 1}
            onClick={() => {
              const memberId = selected.size === 1 ? [...selected][0] : undefined;
              void onOffer(memberId);
            }}
          >
            {t.offerSelected}
          </button>
        </div>
      )}
      <div className="mt-3 max-h-64 space-y-2 overflow-y-auto border-t border-white/10 pt-3">
        {invitees.slice(0, GROUP_CRITIQUE_MEMBER_LIMIT).map((invitee) => {
          const member = liveMembers.find((entry) => entry.memberId === invitee.id);
          return (
            <div key={invitee.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={`${t.selectMembers}: ${invitee.name}`}
                checked={selected.has(invitee.id)}
                onChange={(event) => {
                  if (event.target.checked) onSelected(new Set([invitee.id]));
                  else {
                    const next = new Set(selected);
                    next.delete(invitee.id);
                    onSelected(next);
                  }
                }}
                disabled={offering || !member || Boolean(member.cameraAllowed && member.microphoneAllowed)}
                className="size-4 accent-lime-300"
              />
              <span className="min-w-0 flex-1 truncate">{invitee.name}</span>
              <span className="text-[10px] text-white/55">
                {member?.cameraAllowed && member.microphoneAllowed
                  ? t.memberReady
                  : member?.offeredAt
                    ? t.memberWaiting
                    : t.notOffered}
              </span>
              {member && member.cameraAllowed && member.microphoneAllowed && (
                <button
                  type="button"
                  className="rounded border border-white/20 px-2 py-1 text-[10px] text-white/80"
                  disabled={member.membershipState !== "eligible"}
                  onClick={() => onMute(member.memberId, !member.coachMuted)}
                >
                  {member.coachMuted ? t.unmuteMember : t.muteMember}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {snapshot.state === "open" && (
        <button
          type="button"
          className="mt-3 w-full rounded-md border border-white/20 px-3 py-2 text-sm font-semibold hover:border-lime-200/60"
          onClick={() => onMute(null, !allMuted)}
        >
          {allMuted ? t.unmuteAll : t.muteAll}
        </button>
      )}
      {offeredCount !== null && (
        <p role="status" className="mt-2 text-sm text-lime-100">
          {t.offerSent(offeredCount)}
        </p>
      )}
      {offerError && <p role="alert" className="mt-2 text-sm text-danger">{offerError}</p>}
    </section>
  );
}
