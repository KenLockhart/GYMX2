"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  blockCoach,
  reportCoach,
  unblockCoach,
} from "@/app/(app)/coaches/safety-actions";
import {
  replyToReview,
  reportReview,
} from "@/app/(app)/coaches/review-actions";
import { COACH_REPORT_REASONS, REVIEW_REPORT_REASONS } from "@/lib/reviews";
import { T, useTr } from "@/i18n/t";

type Reason = { value: string; label: string };

function ReportDialog({
  title,
  intro,
  reasons,
  onSubmit,
  onClose,
}: {
  title: string;
  intro: string;
  reasons: readonly Reason[];
  onSubmit: (input: {
    reason: string;
    details: string;
  }) => Promise<{ error?: string }>;
  onClose: (sent: boolean) => void;
}) {
  const tr = useTr();
  const dialog = useRef<HTMLDialogElement>(null);
  const sent = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => dialog.current?.showModal(), []);

  return (
    <dialog
      ref={dialog}
      onClose={() => onClose(sent.current)}
      aria-labelledby="report-title"
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface p-0 text-foreground backdrop:bg-black/70"
    >
      {done ? (
        <div className="space-y-4 p-5">
          <h2 id="report-title" className="text-3xl">
            <T>Thanks for telling us</T>
          </h2>
          <p className="text-muted">
            <T>
              A GYMX2 admin will look at this. We don&apos;t tell anyone who
              sent a report.
            </T>
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="btn-primary"
            >
              <T>Close</T>
            </button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            setError(null);
            start(async () => {
              const result = await onSubmit({
                reason: String(data.get("reason") ?? ""),
                details: String(data.get("details") ?? ""),
              });
              if (result.error) return setError(result.error);
              sent.current = true;
              setDone(true);
            });
          }}
        >
          <h2 id="report-title" className="text-3xl">
            {title}
          </h2>
          <p className="text-sm text-muted">{intro}</p>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              <T>What&apos;s wrong?</T>
            </legend>
            {reasons.map((reason, i) => (
              <label
                key={reason.value}
                className="flex items-center gap-2 text-sm"
              >
                <input
                  type="radio"
                  name="reason"
                  value={reason.value}
                  required
                  defaultChecked={i === 0}
                  className="accent-[var(--accent)]"
                />
                <T>{reason.label}</T>
              </label>
            ))}
          </fieldset>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">
              <T>Anything else we should know? (optional)</T>
            </span>
            <textarea
              name="details"
              rows={3}
              maxLength={1000}
              className="field-input"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {tr(error)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="btn-secondary"
            >
              <T>Cancel</T>
            </button>
            <button type="submit" disabled={pending} className="btn-primary">
              {pending ? tr("Sending...") : tr("Send report")}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

export function ReportReviewButton({ reviewId }: { reviewId: string }) {
  const tr = useTr();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  return (
    <>
      <button
        type="button"
        disabled={sent}
        onClick={() => setOpen(true)}
        className="text-xs text-muted hover:text-danger disabled:hover:text-muted"
      >
        {sent ? tr("Reported") : tr("Report review")}
      </button>
      {open && (
        <ReportDialog
          title={tr("Report this review")}
          intro={tr(
            "Reviews must come from real clients and follow the community guidelines.",
          )}
          reasons={REVIEW_REPORT_REASONS}
          onSubmit={(input) => reportReview(reviewId, input)}
          onClose={(done) => {
            setOpen(false);
            if (done) setSent(true);
          }}
        />
      )}
    </>
  );
}

// Report and block links at the foot of a coach profile.
export function CoachSafetyLinks({
  coachId,
  firstName,
  canBlock,
  blocked,
  joined,
}: {
  coachId: string;
  firstName: string;
  canBlock: boolean;
  blocked: boolean;
  joined: boolean;
}) {
  const tr = useTr();
  const router = useRouter();
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <button
          type="button"
          disabled={reported}
          onClick={() => setReporting(true)}
          className="text-muted hover:text-danger disabled:hover:text-muted"
        >
          {reported ? tr("Report sent") : `Report ${firstName}`}
        </button>
        {canBlock && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (blocked) {
                start(async () => {
                  const result = await unblockCoach(coachId);
                  if (result.error) setError(result.error);
                  else router.refresh();
                });
                return;
              }
              if (joined) {
                setError(
                  tr(
                    "Leave {firstName} first (at the top of this page), then block them.",
                    { firstName },
                  ),
                );
                return;
              }
              if (
                !window.confirm(
                  tr(
                    "Block {firstName}? They'll disappear from your coach search, you won't be able to join them or book an intro, and any upcoming intro with them is cancelled. {firstName} isn't told. You can unblock any time.",
                    { firstName },
                  ),
                )
              )
                return;
              setError(null);
              start(async () => {
                const result = await blockCoach(coachId);
                if (result.error) setError(result.error);
                else router.refresh();
              });
            }}
            className="text-muted hover:text-danger"
          >
            {blocked
              ? tr("Unblock {firstName}", { firstName })
              : `Block ${firstName}`}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {tr(error)}
        </p>
      )}
      {reporting && (
        <ReportDialog
          title={tr("Report {firstName}", { firstName })}
          intro={tr(
            "Tell GYMX2's admins what happened. {firstName} won't see who reported them.",
            { firstName },
          )}
          reasons={COACH_REPORT_REASONS}
          onSubmit={(input) => reportCoach(coachId, input)}
          onClose={(done) => {
            setReporting(false);
            if (done) setReported(true);
          }}
        />
      )}
    </div>
  );
}

// The coach's public reply to one review.
export function ReviewReplyForm({
  reviewId,
  initial,
}: {
  reviewId: string;
  initial: string | null;
}) {
  const tr = useTr();
  const router = useRouter();
  const [editing, setEditing] = useState(!initial);
  const [text, setText] = useState(initial ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save(value: string) {
    setError(null);
    start(async () => {
      const result = await replyToReview(reviewId, value);
      if (result.error) return setError(result.error);
      setEditing(!value.trim());
      router.refresh();
    });
  }

  if (!editing && initial)
    return (
      <div className="space-y-2">
        <p className="whitespace-pre-line rounded-xl border-l-2 border-accent bg-surface-raised p-3 text-sm">
          <span className="font-semibold">
            <T>Your reply:</T>
          </span>{" "}
          {initial}
        </p>
        <div className="flex gap-4 text-sm">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-link"
          >
            <T>Edit reply</T>
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (window.confirm(tr("Remove your reply?"))) {
                setText("");
                save("");
              }
            }}
            className="text-muted hover:text-danger"
          >
            <T>Remove</T>
          </button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {tr(error)}
          </p>
        )}
      </div>
    );

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) save(text);
      }}
    >
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">
          <T>Public reply</T>
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder={tr(
            "Thank them, or add context. Everyone who reads the review sees your reply.",
          )}
          className="field-input"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {tr(error)}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || !text.trim()}
          className="btn-primary px-4 py-2 text-sm"
        >
          {pending ? tr("Saving...") : tr("Post reply")}
        </button>
        {initial && (
          <button
            type="button"
            onClick={() => {
              setText(initial);
              setEditing(false);
            }}
            className="text-sm text-muted"
          >
            <T>Cancel</T>
          </button>
        )}
      </div>
    </form>
  );
}
