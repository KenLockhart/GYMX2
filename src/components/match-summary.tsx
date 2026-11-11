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
import { T, useTr } from "@/i18n/t";

export function MatchSummary({ answers }: { answers: MatchAnswers }) {
  const tr = useTr();
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
          <T>My Coaching Love Language</T>
        </p>
        {primary ? (
          <>
            <h1 className="text-4xl leading-none [overflow-wrap:anywhere] sm:text-5xl">
              <T>{primary.label}</T>
            </h1>
            <p className="text-muted">
              <T>{primary.description}</T>
            </p>
            {secondary && (
              <p>
                <span className="text-muted">Also: </span>
                <span className="font-semibold">
                  <T>{secondary.label}</T>
                </span>
              </p>
            )}
          </>
        ) : (
          <h1 className="text-4xl leading-tight">
            <T>Your answers are saved</T>
          </h1>
        )}
        <p className="text-sm text-muted">
          <T>
            A guide to how you like to be coached, not a personality test. Your
            answers are private: coaches never see them.
          </T>
        </p>
      </section>

      <section className="space-y-3 rounded-3xl border border-border bg-surface p-6">
        <h2 className="text-2xl">
          <T>What you told us</T>
        </h2>
        <p className="text-sm text-muted">
          <T vars={{ done: core.done, total: core.total }}>
            {
              "{done} of {total} main questions answered. Your match score shows on each coach's profile; the more you answer, the more it can tell you."
            }
          </T>
        </p>
        <dl className="divide-y divide-border">
          {QUESTIONS.map((q) => {
            const label = answerLabel(q.key, answers[q.key]);
            return label ? (
              <div
                key={q.key}
                className="grid gap-0.5 py-2.5 sm:grid-cols-[1fr_1fr] sm:gap-4"
              >
                <dt className="text-sm text-muted">
                  <T>{q.title}</T>
                </dt>
                <dd className="font-medium">{label}</dd>
              </div>
            ) : null;
          })}
        </dl>
      </section>

      <div className="flex flex-wrap gap-2">
        <Link href="/coaches/match?edit=1" className="btn-primary">
          <T>Change my answers</T>
        </Link>
        <Link href="/coaches" className="btn-secondary">
          <T>Browse coaches</T>
        </Link>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(tr("Delete all your questionnaire answers?")))
              return;
            start(async () => {
              const result = await deleteMatchAnswers();
              if (result.error) return setError(result.error);
              router.refresh();
            });
          }}
          className="px-3 text-sm text-muted hover:text-danger"
        >
          <T>Delete my answers</T>
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {tr(error)}
        </p>
      )}
    </div>
  );
}
