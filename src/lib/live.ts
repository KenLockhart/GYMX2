// When a coach may go live, and what members see, for a calendar session.

export const LIVE_EARLY_MS = 30 * 60 * 1000; // doors open 30 minutes before the start
export const LIVE_LATE_MS = 60 * 60 * 1000; // and close an hour after the scheduled end
export const LIVE_CHAT_MAX = 500;
export const LIVE_CHAT_HISTORY = 200;

export type LiveRoom = {
  live_started_at: string | null;
  live_ended_at: string | null;
} | null;
export type LiveState = "not_yet" | "open" | "live" | "ended" | "closed";

export function liveWindow(startsAt: string, endsAt: string) {
  return {
    opensAt: new Date(new Date(startsAt).getTime() - LIVE_EARLY_MS),
    closesAt: new Date(new Date(endsAt).getTime() + LIVE_LATE_MS),
  };
}

export function liveState(
  session: { starts_at: string; ends_at: string },
  room: LiveRoom,
  now = new Date(),
): LiveState {
  if (isLiveRoomActive(room)) return "live";
  if (room?.live_ended_at) return "ended";
  const { opensAt, closesAt } = liveWindow(session.starts_at, session.ends_at);
  if (now < opensAt) return "not_yet";
  if (now > closesAt) return "closed";
  return "open";
}

export function isLiveRoomActive(room: LiveRoom) {
  return Boolean(room?.live_started_at && !room.live_ended_at);
}

// A coach can start (or restart, after a dropped connection) inside the window.
export function canGoLive(
  session: { starts_at: string; ends_at: string },
  now = new Date(),
) {
  const { opensAt, closesAt } = liveWindow(session.starts_at, session.ends_at);
  return now >= opensAt && now <= closesAt;
}

// The client schedules one eligibility refresh at the next time-window edge.
export function nextLiveWindowBoundary(
  session: { starts_at: string; ends_at: string },
  now = new Date(),
) {
  const { opensAt, closesAt } = liveWindow(session.starts_at, session.ends_at);
  if (now < opensAt) return opensAt.getTime();
  if (now <= closesAt) return closesAt.getTime() + 1;
  return null;
}

// Realtime events arriving after a snapshot starts must win over that older snapshot.
export function isLiveSnapshotCurrent(
  requestedRevision: number,
  currentRevision: number,
) {
  return requestedRevision === currentRevision;
}

export function mergeLiveMessages<T extends { id: string; created_at: string }>(
  current: readonly T[],
  incoming: readonly T[],
  limit = LIVE_CHAT_HISTORY,
) {
  const messages = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .slice(-limit);
}
