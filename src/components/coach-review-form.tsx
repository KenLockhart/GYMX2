"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  reviewCoachProfile,
  unpublishCoachProfile,
} from "@/app/(app)/admin/coach-profiles/actions";

export function CoachReviewForm({
  coachId,
  canReview,
  isLive,
}: {
  coachId: string;
  canReview: boolean;
  isLive: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function decide(approve: boolean) {
    setError(null);
    start(async () => {
      const result = await reviewCoachProfile({ coachId, approve, note });
      if (result.error) return setError(result.error);
      setMessage(
        approve ? "Approved and published." : "Sent back with your note.",
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {canReview ? (
        <>
          <label htmlFor="review-note" className="block text-sm font-semibold">
            Note to the coach (required when asking for changes)
          </label>
          <textarea
            id="review-note"
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="field-input"
            placeholder="Please remove the phone number from your About me."
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => decide(true)}
              className="btn-primary"
            >
              Approve and publish
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => decide(false)}
              className="btn-secondary"
            >
              Ask for changes
            </button>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">
          This profile isn&apos;t waiting for review.
        </p>
      )}
      {isLive && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (
              !window.confirm(
                "Take this coach's profile down? Members will see their basic coach page.",
              )
            )
              return;
            start(async () => {
              const result = await unpublishCoachProfile(coachId);
              if (result.error) return setError(result.error);
              setMessage("Unpublished.");
              router.refresh();
            });
          }}
          className="text-sm text-muted underline hover:text-danger"
        >
          Unpublish the live profile
        </button>
      )}
      {message && (
        <p role="status" className="text-sm text-accent">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
