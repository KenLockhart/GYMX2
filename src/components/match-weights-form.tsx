"use client";

import { useState, useTransition } from "react";
import { saveMatchWeights } from "@/app/(app)/admin/matching/actions";
import { MATCH_CATEGORIES } from "@/lib/coach-profile";
import { DEFAULT_WEIGHTS, type MatchWeights } from "@/lib/matching";

export function MatchWeightsForm({ initial }: { initial: MatchWeights }) {
  const [weights, setWeights] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const total = MATCH_CATEGORIES.reduce(
    (sum, c) => sum + (Number(weights[c.key]) || 0),
    0,
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setMessage(null);
        start(async () => {
          const result = await saveMatchWeights(weights);
          if (result.error) return setError(result.error);
          setMessage("Saved. New scores apply right away.");
        });
      }}
      className="space-y-4 rounded-2xl border border-border bg-surface p-5"
    >
      {MATCH_CATEGORIES.map((category) => (
        <label
          key={category.key}
          className="flex items-center justify-between gap-4"
        >
          <span>
            {category.label}
            <span className="block text-xs text-muted">
              Starting value: {DEFAULT_WEIGHTS[category.key]}%
            </span>
          </span>
          <span className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={weights[category.key]}
              onChange={(e) =>
                setWeights({
                  ...weights,
                  [category.key]: Math.round(Number(e.target.value) || 0),
                })
              }
              className="field-input w-24 text-right"
            />
            %
          </span>
        </label>
      ))}
      <p
        className={`text-sm font-semibold ${total === 100 ? "text-success" : "text-danger"}`}
      >
        Total: {total}% {total === 100 ? "" : "(must add up to 100)"}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending || total !== 100}
          className="btn-primary"
        >
          {pending ? "Saving..." : "Save weights"}
        </button>
        <button
          type="button"
          onClick={() => setWeights(DEFAULT_WEIGHTS)}
          className="btn-secondary"
        >
          Reset to starting values
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
