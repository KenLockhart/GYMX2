"use client";

import { useState, useTransition } from "react";
import { reportContent } from "@/app/(app)/community/actions";
import { REPORT_DETAILS_MAX, REPORT_REASONS } from "@/lib/reports";
import { T, useTr } from "@/i18n/t";

// "Report" opens a short form inline. Reports go to GYMX2's moderators; the author isn't told who.
export function ReportButton({
  postId = null,
  commentId = null,
  label,
}: {
  postId?: string | null;
  commentId?: string | null;
  label: string;
}) {
  const tr = useTr();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = `report-${postId ?? commentId}`;

  if (done)
    return (
      <span className="text-xs text-muted">
        <T>Reported. Thanks for telling us.</T>
      </span>
    );
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={tr("Report {label}", { label })}
        className="cursor-pointer text-xs text-muted hover:text-danger"
      >
        <T>Report</T>
      </button>
    );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    start(async () => {
      const result = await reportContent({
        postId,
        commentId,
        reason,
        details,
      });
      if (result.error) return setError(result.error);
      setDone(true);
    });
  }

  return (
    <form
      onSubmit={submit}
      className="basis-full space-y-2 rounded-lg border border-border bg-surface-raised p-3 text-sm"
      aria-label={tr("Report {label}", { label })}
    >
      <label htmlFor={`${id}-reason`} className="block font-semibold">
        <T>Why are you reporting this?</T>
      </label>
      <select
        id={`${id}-reason`}
        required
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        className="field-input py-1.5"
      >
        <option value="" disabled>
          <T>Choose a reason</T>
        </option>
        {REPORT_REASONS.map((item) => (
          <option key={item.value} value={item.value}>
            <T>{item.label}</T>
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-details`} className="sr-only">
        <T>Details (optional)</T>
      </label>
      <textarea
        id={`${id}-details`}
        rows={2}
        maxLength={REPORT_DETAILS_MAX}
        value={details}
        onChange={(event) => setDetails(event.target.value)}
        placeholder={tr("Anything else moderators should know (optional)")}
        className="field-input"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || !reason}
          className="btn-primary px-3 py-1.5 text-sm"
        >
          {pending ? tr("Sending...") : tr("Send report")}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn-secondary px-3 py-1.5 text-sm"
        >
          <T>Cancel</T>
        </button>
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {tr(error)}
        </p>
      )}
      <p className="text-xs text-muted">
        <T>The person won&apos;t see who reported them.</T>
      </p>
    </form>
  );
}
