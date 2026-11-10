"use client";

import { useState, useTransition } from "react";
import { setSaved } from "@/app/(app)/coaches/discovery-actions";
import { useLocalZone } from "@/components/intro-times";

// The member's own Save button on a real coach profile.
export function SaveCoachButton({
  coachId,
  initial,
}: {
  coachId: string;
  initial: boolean;
}) {
  const [saved, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        aria-pressed={saved}
        disabled={pending}
        onClick={() => {
          const next = !saved;
          setState(next);
          setError(null);
          start(async () => {
            const result = await setSaved(coachId, next);
            if (result.error) {
              setState(!next);
              setError(result.error);
            }
          });
        }}
        className={`btn-secondary ${saved ? "border-accent text-accent" : ""}`}
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill={saved ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mr-2 size-4"
        >
          <path d="M6 3h12v18l-6-4-6 4V3Z" />
        </svg>
        {saved ? "Saved" : "Save coach"}
      </button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </>
  );
}

// A date and time in the viewer's own time zone.
export function LocalDateTime({ iso }: { iso: string }) {
  const timeZone = useLocalZone();
  const date = new Date(iso);
  return (
    <time dateTime={iso}>
      {date.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone,
      })}
      ,{" "}
      {date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone,
      })}
      {timeZone === "UTC" && " UTC"}
    </time>
  );
}
