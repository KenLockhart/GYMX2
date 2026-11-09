"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  resetPreferences,
  savePreferences,
} from "@/app/(app)/community/preferences/actions";
import { POST_KINDS } from "@/lib/community";
import {
  MAX_PREFERRED_COACHES,
  STANDARD_PREFERENCES,
  WEIGHT_STEPS,
  type FeedPreferences,
} from "@/lib/feed-prefs";

export function PreferencesForm({
  initial,
  coaches,
}: {
  initial: FeedPreferences;
  coaches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [prefs, setPrefs] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const personalized = prefs.mode === "personalized";

  function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    start(async () => {
      const result = await savePreferences(prefs);
      if (result.error) return setError(result.error);
      setMessage("Saved. Your feed now uses these settings.");
      router.refresh();
    });
  }

  function reset() {
    if (
      !window.confirm(
        "Go back to the standard GYMX2 feed? Your topic and coach choices are cleared. Follows and mutes stay.",
      )
    )
      return;
    setError(null);
    setMessage(null);
    start(async () => {
      const result = await resetPreferences();
      if (result.error) return setError(result.error);
      setPrefs(STANDARD_PREFERENCES);
      setMessage("Back to the standard GYMX2 feed.");
      router.refresh();
    });
  }

  function toggleCoach(id: string) {
    setPrefs((current) => {
      const chosen = current.preferredCoaches.includes(id)
        ? current.preferredCoaches.filter((item) => item !== id)
        : [...current.preferredCoaches, id].slice(0, MAX_PREFERRED_COACHES);
      return { ...current, preferredCoaches: chosen };
    });
  }

  return (
    <form
      onSubmit={save}
      className="space-y-6 rounded-lg border border-border bg-surface p-5"
    >
      <fieldset className="space-y-2">
        <legend className="font-semibold">Feed</legend>
        {(
          [
            {
              value: "standard",
              label: "Standard GYMX2 feed",
              hint: "Newest first, with your coaches' announcements on top. The same for everyone.",
            },
            {
              value: "personalized",
              label: "Personalized feed",
              hint: "Uses the people you follow, your favorite coaches and the topics below.",
            },
          ] as const
        ).map((option) => (
          <label key={option.value} className="flex gap-3">
            <input
              type="radio"
              name="mode"
              value={option.value}
              checked={prefs.mode === option.value}
              onChange={() => setPrefs({ ...prefs, mode: option.value })}
              className="mt-1"
            />
            <span>
              <span className="font-medium">{option.label}</span>
              <span className="block text-sm text-muted">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset
        disabled={!personalized}
        className={`space-y-5 ${personalized ? "" : "opacity-50"}`}
      >
        <div className="space-y-2">
          <legend className="font-semibold">Order</legend>
          <select
            aria-label="Order"
            value={prefs.sort}
            onChange={(event) =>
              setPrefs({
                ...prefs,
                sort: event.target.value as FeedPreferences["sort"],
              })
            }
            className="field-input w-auto"
          >
            <option value="newest">Newest first</option>
            <option value="personalized">
              Most relevant (likes and comments count too)
            </option>
          </select>
        </div>

        <div className="space-y-2">
          <p className="font-semibold">Topics</p>
          <p className="text-sm text-muted">
            More moves a kind of post up your feed; Less moves it down. Nothing
            is removed.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {POST_KINDS.map((kind) => (
              <li
                key={kind.value}
                className="flex items-center justify-between gap-3"
              >
                <label htmlFor={`weight-${kind.value}`}>{kind.label}</label>
                <select
                  id={`weight-${kind.value}`}
                  value={prefs.weights[kind.value] ?? 1}
                  onChange={(event) =>
                    setPrefs({
                      ...prefs,
                      weights: {
                        ...prefs.weights,
                        [kind.value]: Number(event.target.value),
                      },
                    })
                  }
                  className="field-input w-auto py-1.5 text-sm"
                >
                  {WEIGHT_STEPS.map((step) => (
                    <option key={step.value} value={step.value}>
                      {step.label}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2">
          <p className="font-semibold">Favorite coaches</p>
          {coaches.length === 0 ? (
            <p className="text-sm text-muted">
              Join or follow a coach to favor their posts.
            </p>
          ) : (
            <ul className="space-y-1">
              {coaches.map((coach) => (
                <li key={coach.id}>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={prefs.preferredCoaches.includes(coach.id)}
                      onChange={() => toggleCoach(coach.id)}
                    />
                    {coach.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Saving..." : "Save preferences"}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="btn-secondary"
        >
          Reset to Standard GYMX2 Feed
        </button>
      </div>
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
    </form>
  );
}
