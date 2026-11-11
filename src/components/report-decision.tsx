"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  decideCoachReport,
  decideReviewReport,
} from "@/app/(app)/admin/reports/actions";
import { T, useTr } from "@/i18n/t";

export function ReviewReportDecision({ reportId }: { reportId: string }) {
  const tr = useTr();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const decide = (decision: "hidden" | "dismissed") =>
    start(async () => {
      setError(null);
      const result = await decideReviewReport(reportId, decision);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => decide("hidden")}
        className="btn-primary px-3 py-1.5 text-sm"
      >
        <T>Hide review</T>
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => decide("dismissed")}
        className="btn-secondary px-3 py-1.5 text-sm"
      >
        <T>Looks fine</T>
      </button>
      {error && (
        <span role="alert" className="text-sm text-danger">
          {tr(error)}
        </span>
      )}
    </div>
  );
}

export function CoachReportDecision({ reportId }: { reportId: string }) {
  const tr = useTr();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const decide = (decision: "actioned" | "dismissed") =>
    start(async () => {
      setError(null);
      const result = await decideCoachReport(reportId, decision, note);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  return (
    <div className="space-y-2">
      <label className="block space-y-1 text-sm">
        <span className="font-medium">
          <T>What you did (only admins see this)</T>
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder={tr(
            "e.g. Asked the coach to remove the claim; checked their credentials.",
          )}
          className="field-input"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("actioned")}
          className="btn-primary px-3 py-1.5 text-sm"
        >
          <T>Handled</T>
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("dismissed")}
          className="btn-secondary px-3 py-1.5 text-sm"
        >
          <T>No action needed</T>
        </button>
        {error && (
          <span role="alert" className="text-sm text-danger">
            {tr(error)}
          </span>
        )}
      </div>
    </div>
  );
}
