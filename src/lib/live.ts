// When a coach may go live, and what members see, for a calendar session.

export const LIVE_EARLY_MS = 30 * 60 * 1000; // doors open 30 minutes before the start
export const LIVE_LATE_MS = 60 * 60 * 1000; // and close an hour after the scheduled end
export const LIVE_CHAT_MAX = 500;

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
  if (room?.live_started_at && !room.live_ended_at) return "live";
  if (room?.live_ended_at) return "ended";
  const { opensAt, closesAt } = liveWindow(session.starts_at, session.ends_at);
  if (now < opensAt) return "not_yet";
  if (now > closesAt) return "closed";
  return "open";
}

// A coach can start (or restart, after a dropped connection) inside the window.
export function canGoLive(
  session: { starts_at: string; ends_at: string },
  now = new Date(),
) {
  const { opensAt, closesAt } = liveWindow(session.starts_at, session.ends_at);
  return now >= opensAt && now <= closesAt;
}
