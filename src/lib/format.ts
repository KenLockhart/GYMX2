// Calendar dates have no time zone, so they're read and shown as UTC to keep the same day everywhere.
export function formatDate(date: string) {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDuration(seconds: number | null) {
  if (!seconds || seconds <= 0) return null;
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

// A coach can only delete a video once no Task uses it, so the message says how many to remove.
export function videoInUseError(taskCount: number) {
  if (taskCount <= 0) return "This video is still used by a Task. Delete that Task first, then try again.";
  const tasks = taskCount === 1 ? "1 Task" : `${taskCount} Tasks`;
  const those = taskCount === 1 ? "that Task" : "those Tasks";
  return `This video is used by ${tasks}. Delete ${those} on the Tasks page first, then try again.`;
}
