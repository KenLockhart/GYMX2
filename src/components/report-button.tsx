"use client";

import { useState, useTransition } from "react";
import { reportContent } from "@/app/(app)/community/actions";
import { REPORT_DETAILS_MAX, REPORT_REASONS } from "@/lib/reports";

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
        Reported. Thanks for telling us.
      </span>
    );
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Report ${label}`}
        className="cursor-pointer text-xs text-muted hover:text-danger"
      >
        Report
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
      aria-label={`Report ${label}`}
    >
      <label htmlFor={`${id}-reason`} className="block font-semibold">
        Why are you reporting this?
      </label>
      <select
        id={`${id}-reason`}
        required
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        className="field-input py-1.5"
      >
        <option value="" disabled>
          Choose a reason
        </option>
        {REPORT_REASONS.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-details`} className="sr-only">
        Details (optional)
      </label>
      <textarea
        id={`${id}-details`}
        rows={2}
        maxLength={REPORT_DETAILS_MAX}
        value={details}
        onChange={(event) => setDetails(event.target.value)}
        placeholder="Anything else moderators should know (optional)"
        className="field-input"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || !reason}
          className="btn-primary px-3 py-1.5 text-sm"
        >
          {pending ? "Sending..." : "Send report"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn-secondary px-3 py-1.5 text-sm"
        >
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <p className="text-xs text-muted">
        The person won&apos;t see who reported them.
      </p>
    </form>
  );
}
