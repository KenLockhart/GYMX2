"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { saveMatchAnswers } from "@/app/(app)/coaches/match/actions";
import {
  answerLabel,
  type MatchAnswers,
  QUESTIONS,
  type QuestionKey,
} from "@/lib/match-questions";
import { T, useTr } from "@/i18n/t";

type Option = { value: string; label: string; hint?: string };

// A dating-app-style questionnaire: one question per screen, large answers, a progress bar, and
// Back, Skip and Next everywhere. Progress saves as the member goes.
export function MatchQuiz({
  initial,
  firstName,
}: {
  initial: MatchAnswers;
  firstName: string;
}) {
  const tr = useTr();
  const router = useRouter();
  const [answers, setAnswers] = useState<MatchAnswers>(initial);
  // -1 is the welcome screen; QUESTIONS.length is the review screen.
  const [index, setIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);
  const total = QUESTIONS.length;
  const question = index >= 0 && index < total ? QUESTIONS[index] : null;

  function go(next: number, latest = answers) {
    if (index >= 0 && index < total) void saveMatchAnswers(latest, false);
    setIndex(Math.max(-1, Math.min(total, next)));
    requestAnimationFrame(() => heading.current?.focus());
  }

  function choose(
    key: QuestionKey,
    value: string,
    multi: boolean,
    max: number,
  ) {
    setError(null);
    if (multi) {
      const current = (answers[key] as string[] | undefined) ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : current.length >= max
          ? current
          : [...current, value];
      if (!current.includes(value) && current.length >= max)
        setError(tr("Pick up to {max}.", { max }));
      setAnswers({ ...answers, [key]: next });
      return;
    }
    const latest = { ...answers, [key]: value };
    // The second love language can't repeat the first.
    if (key === "love_primary" && latest.love_secondary === value)
      delete latest.love_secondary;
    setAnswers(latest);
    setTimeout(() => go(index + 1, latest), 220);
  }

  function skip(key: QuestionKey) {
    const latest = { ...answers };
    delete latest[key];
    setAnswers(latest);
    go(index + 1, latest);
  }

  function finish() {
    setError(null);
    start(async () => {
      const result = await saveMatchAnswers(answers, true);
      if (result.error) return setError(result.error);
      router.replace("/coaches/match");
      router.refresh();
    });
  }

  const progress =
    index < 0 ? 0 : Math.round((Math.min(index, total) / total) * 100);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between text-sm text-muted">
          <span>
            {index < 0
              ? tr("About 2 minutes")
              : index < total
                ? tr("Question {p0} of {total}", { p0: index + 1, total })
                : tr("Review")}
          </span>
          {question && !question.core && (
            <span>
              <T>Optional</T>
            </span>
          )}
        </div>
        <div
          role="progressbar"
          aria-label={tr("Questionnaire progress")}
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-raised"
        >
          <div
            className="h-full rounded-full bg-accent transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {index < 0 && (
        <section className="space-y-5 rounded-3xl border border-border bg-surface p-6 sm:p-8">
          <p className="text-sm font-semibold uppercase tracking-widest text-accent">
            <T>Find your coach match</T>
          </p>
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-4xl leading-none outline-none [overflow-wrap:anywhere] sm:text-5xl"
          >
            <T vars={{ firstName }}>
              {"Hey {firstName}, let's find your kind of coach"}
            </T>
          </h1>
          <p className="text-muted">
            <T>
              A few quick questions about how you like to train. We&apos;ll use
              them to show how well each coach fits you. Skip anything you like,
              and change your answers any time.
            </T>
          </p>
          <ul className="space-y-1.5 text-sm text-muted">
            <li>
              <T>• Your answers are private. Coaches never see them.</T>
            </li>
            <li>
              <T>• Match scores are a guide, not a promise of results.</T>
            </li>
          </ul>
          <button
            type="button"
            onClick={() => go(0)}
            className="btn-primary w-full sm:w-auto"
          >
            <T>Let&apos;s go</T>
          </button>
        </section>
      )}

      {question && (
        <section
          key={question.key}
          aria-labelledby="question-title"
          className="space-y-5 rounded-3xl border border-border bg-surface p-6 motion-safe:animate-[fadeIn_.25s_ease-out] sm:p-8"
        >
          <div className="space-y-2">
            <h1
              id="question-title"
              ref={heading}
              tabIndex={-1}
              className="text-3xl leading-tight outline-none [overflow-wrap:anywhere] sm:text-5xl"
            >
              <T>{question.title}</T>
            </h1>
            {"subtitle" in question && question.subtitle && (
              <p className="text-muted">{question.subtitle}</p>
            )}
          </div>
          <div
            role={question.kind === "multi" ? "group" : "radiogroup"}
            aria-labelledby="question-title"
            className={`grid gap-3 ${question.options.length > 4 ? "sm:grid-cols-2" : ""}`}
          >
            {(question.options as readonly Option[]).map((option) => {
              const value = answers[question.key];
              const selected = Array.isArray(value)
                ? value.includes(option.value)
                : value === option.value;
              const disabled =
                question.key === "love_secondary" &&
                answers.love_primary === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role={question.kind === "multi" ? "checkbox" : "radio"}
                  aria-checked={selected}
                  disabled={disabled}
                  onClick={() =>
                    choose(
                      question.key,
                      option.value,
                      question.kind === "multi",
                      "max" in question ? question.max : 99,
                    )
                  }
                  className={`flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 ${
                    selected
                      ? "border-accent bg-accent text-accent-foreground"
                      : "border-border bg-surface-raised hover:border-accent/60"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`grid size-6 shrink-0 place-items-center border-2 text-xs font-bold ${
                      question.kind === "multi" ? "rounded-md" : "rounded-full"
                    } ${selected ? "border-accent-foreground" : "border-muted"}`}
                  >
                    {selected ? "✓" : ""}
                  </span>
                  <span>
                    <span className="block font-semibold">
                      <T>{option.label}</T>
                    </span>
                    {option.hint && (
                      <span
                        className={`block text-sm ${selected ? "text-accent-foreground/80" : "text-muted"}`}
                      >
                        <T>{option.hint}</T>
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {tr(error)}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => go(index - 1)}
              className="btn-secondary"
            >
              <T>Back</T>
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => skip(question.key)}
                className="px-3 text-sm text-muted hover:text-foreground"
              >
                <T>Skip</T>
              </button>
              <button
                type="button"
                onClick={() => go(index + 1)}
                className="btn-primary"
              >
                <T>Next</T>
              </button>
            </div>
          </div>
        </section>
      )}

      {index >= total && (
        <section className="space-y-5 rounded-3xl border border-border bg-surface p-6 sm:p-8">
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-4xl leading-none outline-none [overflow-wrap:anywhere] sm:text-5xl"
          >
            <T>Look right?</T>
          </h1>
          <dl className="divide-y divide-border">
            {QUESTIONS.map((q, i) => {
              const label = answerLabel(q.key, answers[q.key]);
              return (
                <div
                  key={q.key}
                  className="flex items-start justify-between gap-4 py-3"
                >
                  <div className="min-w-0">
                    <dt className="text-sm text-muted">
                      <T>{q.title}</T>
                    </dt>
                    <dd className={label ? "font-semibold" : "text-muted"}>
                      {label ?? tr("Skipped")}
                    </dd>
                  </div>
                  <button
                    type="button"
                    onClick={() => go(i)}
                    className="shrink-0 text-sm text-accent hover:underline"
                  >
                    <T>Change</T>
                  </button>
                </div>
              );
            })}
          </dl>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {tr(error)}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={finish}
              disabled={pending}
              className="btn-primary"
            >
              {pending ? tr("Saving...") : tr("Save my answers")}
            </button>
            <button
              type="button"
              onClick={() => go(total - 1)}
              className="btn-secondary"
            >
              <T>Back</T>
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
