export function quoteIndexForDay(day: string, count: number): number {
  if (!Number.isInteger(count) || count < 1) return 0;
  let hash = 0;
  for (const character of day) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash % count;
}

export function dailyFuelStateKey(day: string, videoId: string | null): string {
  return `${day}:${videoId ?? "no-video"}`;
}

export function formatMediaTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function mediaProgress(currentTime: number, duration: number): number {
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0)
    return 0;
  return Math.max(0, Math.min(100, (currentTime / duration) * 100));
}
