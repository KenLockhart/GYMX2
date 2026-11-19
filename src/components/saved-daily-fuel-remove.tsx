"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  setMemberDailyFuelBookmark,
  type DailyFuelActionResult,
} from "@/app/(app)/dashboard/fuel-actions";

type RemoveBookmark = (
  videoId: string,
  saved: boolean,
) => Promise<DailyFuelActionResult>;

export type SavedDailyFuelRemoveCopy = {
  remove: string;
  removing: string;
  confirm: string;
  removed: string;
  error: string;
};

export type SavedDailyFuelRemoveOutcome = "cancelled" | "removed" | "failed";

export async function removeSavedDailyFuelBookmark(
  videoId: string,
  confirmRemoval: () => boolean,
  removeBookmark: RemoveBookmark = setMemberDailyFuelBookmark,
): Promise<SavedDailyFuelRemoveOutcome> {
  try {
    if (!confirmRemoval()) return "cancelled";
    const result = await removeBookmark(videoId, false);
    return result.ok ? "removed" : "failed";
  } catch {
    return "failed";
  }
}

export function SavedDailyFuelRemove({
  videoId,
  copy,
  redirectAfterRemove = false,
}: {
  videoId: string;
  copy: SavedDailyFuelRemoveCopy;
  redirectAfterRemove?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleRemove() {
    if (pending || removed) return;
    setFailed(false);
    setPending(true);
    try {
      const outcome = await removeSavedDailyFuelBookmark(
        videoId,
        () => window.confirm(copy.confirm),
      );
      if (outcome === "cancelled") return;
      if (outcome === "failed") {
        setFailed(true);
        return;
      }

      setRemoved(true);
      if (redirectAfterRemove) router.replace("/library/saved");
      else router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-3">
      {removed ? (
        <p role="status" className="text-sm text-muted">
          {copy.removed}
        </p>
      ) : (
        <button
          type="button"
          className="btn-secondary min-h-11 w-full justify-center"
          onClick={handleRemove}
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? copy.removing : copy.remove}
        </button>
      )}
      {failed && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {copy.error}
        </p>
      )}
    </div>
  );
}
