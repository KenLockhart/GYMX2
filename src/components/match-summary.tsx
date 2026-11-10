"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteMatchAnswers } from "@/app/(app)/coaches/match/actions";
import { loveLanguage, type LoveLanguage } from "@/lib/coach-profile";
import {
  answerLabel,
  coreAnswered,
  type MatchAnswers,
  QUESTIONS,
} from "@/lib/match-questions";

export function MatchSummary({ answers }: { answers: MatchAnswers }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const primary = answers.love_primary
    ? loveLanguage(answers.love_primary as LoveLanguage)
    : null;
  const secondary = answers.love_secondary
    ? loveLanguage(answers.love_secondary as LoveLanguage)
    : null;
  const core = coreAnswered(answers);

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-3xl border border-accent/60 bg-surface p-6 sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">
          My Coaching Love Language
        </p>
        {primary ? (
          <>
            <h1 className="text-4xl leading-none [overflow-wrap:anywhere] sm:text-5xl">
              {primary.label}
            </h1>
            <p className="text-muted">{primary.description}</p>
            {secondary && (
              <p>
                <span className="text-muted">Also: </span>
                <span className="font-semibold">{secondary.label}</span>
              </p>
            )}
          </>
        ) : (
          <h1 className="text-4xl leading-tight">Your answers are saved</h1>
        )}
        <p className="text-sm text-muted">
          A guide to how you like to be coached, not a personality test. Your
          answers are private: coaches never see them.
        </p>
      </section>

      <section className="space-y-3 rounded-3xl border border-border bg-surface p-6">
        <h2 className="text-2xl">What you told us</h2>
        <p className="text-sm text-muted">
          {core.done} of {core.total} main questions answered. Your match score
          shows on each coach&apos;s profile; the more you answer, the more it
          can tell you.
        </p>
        <dl className="divide-y divide-border">
          {QUESTIONS.map((q) => {
            const label = answerLabel(q.key, answers[q.key]);
            return label ? (
              <div
                key={q.key}
                className="grid gap-0.5 py-2.5 sm:grid-cols-[1fr_1fr] sm:gap-4"
              >
                <dt className="text-sm text-muted">{q.title}</dt>
                <dd className="font-medium">{label}</dd>
              </div>
            ) : null;
          })}
        </dl>
      </section>

      <div className="flex flex-wrap gap-2">
        <Link href="/coaches/match?edit=1" className="btn-primary">
          Change my answers
        </Link>
        <Link href="/coaches" className="btn-secondary">
          Browse coaches
        </Link>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Delete all your questionnaire answers?"))
              return;
            start(async () => {
              const result = await deleteMatchAnswers();
              if (result.error) return setError(result.error);
              router.refresh();
            });
          }}
          className="px-3 text-sm text-muted hover:text-danger"
        >
          Delete my answers
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
