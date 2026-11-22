import Link from "next/link";
import type { FormCoachWorkflowDetail } from "@/lib/form-coach/workflow-contracts";
import type { FormCoachReviewDetail } from "@/lib/form-coach/review-contracts";
import { AssessmentReviewForm, type FormCoachReviewAction } from "./assessment-review-form";

type ViewerRole = "coach" | "member";
type AssessmentItem = FormCoachWorkflowDetail["items"][number] | FormCoachReviewDetail["items"][number];
type ReviewItem = FormCoachReviewDetail["items"][number];
type Attempt = AssessmentItem["attempts"][number];
type FinishedAttempt = Attempt & { state: "finished" };
type AttemptResult = NonNullable<Attempt["result"]>;
type RepResult = AttemptResult["rep_results"][number];
type Fault = RepResult["faults"][number];
const UTC_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const UTC_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "UTC",
});

const STATUS_LABELS = {
  sent: "Sent",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  expired: "Expired",
} as const;

const FAULT_FIXES: Record<Exclude<Fault, "clean_rep">, Readonly<{ label: string; fix: string }>> = {
  elbow_drift: { label: "Elbow drift", fix: "Keep your upper arm steady beside your torso." },
  torso_swing: { label: "Torso swing", fix: "Keep your trunk still as you curl." },
  short_rom_bottom: { label: "Short range at the bottom", fix: "Return to a comfortable full extension." },
  short_rom_top: { label: "Short range at the top", fix: "Finish the curl through its full range." },
  eccentric_too_fast: { label: "Fast lowering phase", fix: "Lower the weight with control." },
  shoulder_shrug: { label: "Shoulder shrug", fix: "Keep your shoulders relaxed and down." },
};

function formatUtcDate(value: string): string {
  return `${UTC_DATE_FORMATTER.format(new Date(value))} UTC`;
}

function formatUtcDateTime(value: string): string {
  return `${UTC_DATE_TIME_FORMATTER.format(new Date(value))} UTC`;
}

function formatScore(value: number): string {
  return `${Math.round(value)}%`;
}

function plural(value: number, singular: string): string {
  return `${value} ${singular}${value === 1 ? "" : "s"}`;
}

function isFinished(attempt: Attempt): attempt is FinishedAttempt {
  return attempt.state === "finished";
}

function resultAttempts(item: AssessmentItem): FinishedAttempt[] {
  return item.attempts.filter(isFinished).filter((attempt) => attempt.result !== null)
    .sort((left, right) => left.attempt_number - right.attempt_number);
}

function bestAttempt(attempts: readonly FinishedAttempt[]): FinishedAttempt | null {
  let best: FinishedAttempt | null = null;
  for (const attempt of attempts) {
    if (attempt.result === null) continue;
    if (best?.result && best.result.average_score >= attempt.result.average_score) continue;
    best = attempt;
  }
  return best;
}

function faultCounts(attempts: readonly FinishedAttempt[]) {
  const counts = new Map<Exclude<Fault, "clean_rep">, number>();
  let cleanRepCount = 0;
  for (const attempt of attempts) {
    for (const rep of attempt.result?.rep_results ?? []) {
      const repFaults = new Set(rep.faults);
      const substantiveFaults = [...repFaults].filter((fault) => fault !== "clean_rep");
      if (substantiveFaults.length === 0) cleanRepCount += 1;
      for (const fault of substantiveFaults) {
        counts.set(fault, (counts.get(fault) ?? 0) + 1);
      }
    }
  }

  return {
    cleanRepCount,
    entries: [...counts.entries()]
    .sort(([leftFault, leftCount], [rightFault, rightCount]) =>
      rightCount - leftCount || leftFault.localeCompare(rightFault),
    )
    .map(([fault, count]) => ({ fault, count })),
  };
}

function topCorrections(
  item: AssessmentItem,
  entries: ReturnType<typeof faultCounts>["entries"],
) {
  return entries.slice(0, 2).map(({ fault, count }) => {
      const templateCue = item.cues_enabled
        ? item.template?.cues.find((cue) => cue.fault === fault)?.text
        : undefined;
      return {
        fault,
        count,
        label: FAULT_FIXES[fault].label,
        fix: templateCue ?? FAULT_FIXES[fault].fix,
      };
    });
}

type SummaryPresentation = Readonly<{
  heading: string;
  description: string;
  compactStatus: string;
}>;

function summaryPresentation(
  result: AttemptResult,
  summaryProviderConfigured: boolean,
): SummaryPresentation {
  if (result.coach_summary) {
    return {
      heading: "Coach summary",
      description: result.coach_summary,
      compactStatus: "written summary available",
    };
  }

  if (result.summary_state === "pending") {
    return summaryProviderConfigured
      ? {
          heading: "Summary pending",
          description: "A numeric result is available while the written summary is pending.",
          compactStatus: "written summary pending",
        }
      : {
          heading: "Written summary unavailable",
          description: "Written summaries are unavailable right now. Your numeric result is still available.",
          compactStatus: "written summary unavailable",
        };
  }

  if (result.summary_state === "unavailable") {
    return {
      heading: "Summary unavailable",
      description: "The numeric result is available; no written summary was returned.",
      compactStatus: "written summary unavailable",
    };
  }

  return {
    heading: "Coach summary",
    description: "No written summary is available for this attempt.",
    compactStatus: "numeric result recorded",
  };
}

function SummaryState({
  result,
  summaryProviderConfigured,
}: {
  result: AttemptResult;
  summaryProviderConfigured: boolean;
}) {
  const presentation = summaryPresentation(result, summaryProviderConfigured);

  return (
    <section className="rounded-lg border border-border bg-surface-raised p-3" aria-label={presentation.heading}>
      <h4 className="text-sm font-semibold">{presentation.heading}</h4>
      <p className="mt-1 text-sm text-muted">{presentation.description}</p>
    </section>
  );
}

function RepScoreTable({ reps }: { reps: readonly RepResult[] }) {
  if (reps.length === 0) {
    return <p className="mt-3 text-sm text-muted">No rep-level scores were recorded.</p>;
  }

  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-border">
      <table className="min-w-[48rem] w-full text-left text-sm">
        <caption className="sr-only">Rep scores, timing and form flags</caption>
        <thead className="bg-surface-raised text-xs uppercase tracking-wide text-muted">
          <tr>
            <th scope="col" className="px-3 py-2">Rep</th>
            <th scope="col" className="px-3 py-2">Score</th>
            <th scope="col" className="px-3 py-2">ROM</th>
            <th scope="col" className="px-3 py-2">Elbow</th>
            <th scope="col" className="px-3 py-2">Torso</th>
            <th scope="col" className="px-3 py-2">Tempo</th>
            <th scope="col" className="px-3 py-2">Shoulders</th>
            <th scope="col" className="px-3 py-2">Arm drift</th>
            <th scope="col" className="px-3 py-2">Torso swing</th>
            <th scope="col" className="px-3 py-2">Shrug</th>
            <th scope="col" className="px-3 py-2">Curve</th>
            <th scope="col" className="px-3 py-2">Timing</th>
            <th scope="col" className="px-3 py-2">Form flags</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {reps.map((rep) => (
            <tr key={rep.rep_number}>
              <th scope="row" className="px-3 py-2 font-medium tabular-nums">{rep.rep_number}</th>
              <td className="px-3 py-2 tabular-nums">{formatScore(rep.score)}</td>
              <td className="px-3 py-2 tabular-nums">{Math.round(rep.rom_min_angle)}°–{Math.round(rep.rom_max_angle)}°</td>
              <td className="px-3 py-2 tabular-nums">{formatScore(rep.elbow_score)}</td>
              <td className="px-3 py-2 tabular-nums">{formatScore(rep.torso_score)}</td>
              <td className="px-3 py-2 tabular-nums">{formatScore(rep.tempo_score)}</td>
              <td className="px-3 py-2 tabular-nums">{formatScore(rep.shoulders_score)}</td>
              <td className="px-3 py-2 tabular-nums">{rep.max_upper_arm_drift.toFixed(1)}°</td>
              <td className="px-3 py-2 tabular-nums">{rep.max_torso_swing.toFixed(1)}°</td>
              <td className="px-3 py-2 tabular-nums">{rep.max_shrug.toFixed(2)}</td>
              <td className="px-3 py-2 tabular-nums">{formatScore(rep.curve_similarity)}</td>
              <td className="px-3 py-2 tabular-nums">{rep.concentric_ms}/{rep.top_pause_ms}/{rep.eccentric_ms} ms</td>
              <td className="px-3 py-2">
                {[...new Set(rep.faults)].filter((fault) => fault !== "clean_rep").length === 0
                  ? "Clean"
                  : [...new Set(rep.faults)].filter((fault) => fault !== "clean_rep").map((fault) => FAULT_FIXES[fault]?.label ?? fault.replaceAll("_", " ")).join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemHistory({
  assessmentId,
  item,
  reviewItem,
  reviewAction,
  summaryProviderConfigured,
}: {
  assessmentId: string;
  item: AssessmentItem;
  reviewItem: ReviewItem | null;
  reviewAction?: FormCoachReviewAction;
  summaryProviderConfigured: boolean;
}) {
  const attempts = resultAttempts(item);
  const best = bestAttempt(attempts);
  const faultSummary = faultCounts(attempts);
  const fixes = topCorrections(item, faultSummary.entries);
  const cueList = item.cues_enabled ? item.template?.cues ?? [] : [];
  const bestSummary = best?.result
    ? summaryPresentation(best.result, summaryProviderConfigured)
    : null;

  return (
    <article className="space-y-5 rounded-2xl border border-border bg-surface p-4 sm:p-6" aria-labelledby={`exercise-${item.ordinal}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">Exercise {item.ordinal}</p>
          <h3 id={`exercise-${item.ordinal}`} className="mt-1 text-3xl">{item.title}</h3>
          <p className="mt-1 text-sm text-muted">Dumbbell curl</p>
        </div>
        <span className="rounded-full border border-border bg-surface-raised px-2.5 py-1 text-xs font-semibold">
          {item.max_attempts} base attempts
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div className="rounded-lg bg-surface-raised p-3">
          <dt className="text-muted">Required reps</dt>
          <dd className="mt-1 font-semibold tabular-nums">{item.required_reps}</dd>
        </div>
        <div className="rounded-lg bg-surface-raised p-3">
          <dt className="text-muted">Pass mark</dt>
          <dd className="mt-1 font-semibold tabular-nums">{formatScore(item.pass_threshold)}</dd>
        </div>
        <div className="rounded-lg bg-surface-raised p-3">
          <dt className="text-muted">Live cues</dt>
          <dd className="mt-1 font-semibold">{item.cues_enabled ? "Enabled" : "Off"}</dd>
        </div>
        <div className="rounded-lg bg-surface-raised p-3">
          <dt className="text-muted">Recorded attempts</dt>
          <dd className="mt-1 font-semibold tabular-nums">{item.attempts.length}</dd>
        </div>
      </dl>

      {item.template && (
        <p className="text-sm text-muted">
          Reference setup: {item.template.cameraView.replaceAll("_", " ")} view · {item.template.arm === "auto" ? "automatic arm selection" : `${item.template.arm} arm`}
        </p>
      )}

      {cueList.length > 0 && (
        <section className="space-y-2" aria-label="Configured coaching cues">
          <h4 className="text-sm font-semibold">Coaching cues</h4>
          <ul className="grid gap-2 sm:grid-cols-2">
            {cueList.map((cue) => (
              <li key={cue.key} className="rounded-lg border border-border bg-surface-raised p-3 text-sm">
                {cue.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {item.latest_review && (
        <section className="rounded-xl border border-accent/40 bg-accent/5 p-4" aria-label="Latest coach feedback">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-semibold">
              Latest coach feedback · {item.latest_review.verdict === "learned" ? "Learned" : "Needs work"}
            </h4>
            <time className="text-xs text-muted" dateTime={item.latest_review.created_at}>
              {formatUtcDate(item.latest_review.created_at)}
            </time>
          </div>
          {item.latest_review.feedback ? <p className="mt-2 whitespace-pre-wrap text-sm">{item.latest_review.feedback}</p> : (
            <p className="mt-2 text-sm text-muted">No written feedback was added.</p>
          )}
        </section>
      )}

      {reviewItem && reviewAction && (
        <section className="space-y-3" aria-label="Coach review controls">
          {reviewItem.can_review ? (
            item.attempts.filter(isFinished).map((attempt) => (
              <AssessmentReviewForm
                key={attempt.attempt_id}
                assessmentId={assessmentId}
                itemId={item.item_id}
                attemptId={attempt.attempt_id}
                attemptNumber={attempt.attempt_number}
                expectedReviewSequence={reviewItem.expected_review_sequence}
                requestId={crypto.randomUUID()}
                canReview={reviewItem.can_review}
                canOpenRetry={reviewItem.can_open_retry}
                maxExtraAttempts={reviewItem.max_extra_attempts}
                action={reviewAction}
              />
            ))
          ) : (
            <p className="rounded-lg border border-border bg-surface-raised p-3 text-sm text-muted">
              Review controls are currently unavailable for this exercise.
            </p>
          )}
        </section>
      )}

      {best?.result && (
        <section className="rounded-xl border border-accent/50 bg-accent/5 p-4" aria-label="Best finished attempt">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-accent">Best finished attempt</p>
              <h4 className="mt-1 text-2xl">Attempt {best.attempt_number}</h4>
            </div>
            <p className="text-3xl font-bold tabular-nums">{formatScore(best.result.average_score)}</p>
          </div>
          <p className="mt-2 text-sm text-muted">
            {plural(best.result.rep_count, "rep")} · {bestSummary?.compactStatus}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <p className="rounded-lg bg-surface p-3">Range <strong className="block tabular-nums">{formatScore(best.result.numeric_summary.rom_average)}</strong></p>
            <p className="rounded-lg bg-surface p-3">Elbow <strong className="block tabular-nums">{formatScore(best.result.numeric_summary.elbow_average)}</strong></p>
            <p className="rounded-lg bg-surface p-3">Tempo <strong className="block tabular-nums">{formatScore(best.result.numeric_summary.tempo_average)}</strong></p>
            <p className="rounded-lg bg-surface p-3">Shoulders <strong className="block tabular-nums">{formatScore(best.result.numeric_summary.shoulders_average)}</strong></p>
          </div>
          <div className="mt-3">
            <SummaryState result={best.result} summaryProviderConfigured={summaryProviderConfigured} />
          </div>
        </section>
      )}

      {(faultSummary.entries.length > 0 || faultSummary.cleanRepCount > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-2" aria-label="Form flag counts">
            <h4 className="text-sm font-semibold">Form flag counts across finished reps</h4>
            {faultSummary.entries.length > 0 ? (
              <ul className="space-y-2">
                {faultSummary.entries.map(({ fault, count }) => (
                  <li key={fault} className="flex justify-between gap-3 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm">
                    <span>{FAULT_FIXES[fault].label}</span><span className="tabular-nums">{count}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="rounded-lg border border-border bg-surface-raised p-3 text-sm text-muted">No form flags were recorded.</p>}
            {faultSummary.cleanRepCount > 0 && <p className="text-xs text-muted">Clean reps: {faultSummary.cleanRepCount}</p>}
          </section>
          <section className="space-y-2" aria-label="Most common form corrections">
            <h4 className="text-sm font-semibold">Top corrections</h4>
            {fixes.length > 0 ? (
              <ol className="grid gap-2">
                {fixes.map((entry) => (
                  <li key={entry.fault} className="rounded-lg border border-border bg-surface-raised p-3">
                    <p className="text-sm font-semibold">{entry.label} <span className="font-normal text-muted">· {plural(entry.count, "rep")}</span></p>
                    <p className="mt-1 text-sm text-muted">{entry.fix}</p>
                  </li>
                ))}
              </ol>
            ) : <p className="rounded-lg border border-border bg-surface-raised p-3 text-sm text-muted">No corrections were recorded.</p>}
          </section>
        </div>
      )}

      {item.attempts.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface-raised p-4 text-sm text-muted">
          No attempts have been recorded for this exercise.
        </p>
      ) : (
        <section className="space-y-3" aria-labelledby={`history-${item.ordinal}`}>
          <div>
            <h4 id={`history-${item.ordinal}`} className="text-xl">Finished attempt history</h4>
            <p className="mt-1 text-sm text-muted">
              {plural(item.attempts.filter((attempt) => attempt.state === "finished").length, "finished attempt")} · {plural(attempts.length, "numeric result")}
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="min-w-[35rem] w-full text-left text-sm">
              <caption className="sr-only">All finished attempts for {item.title}</caption>
              <thead className="bg-surface-raised text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2">Attempt</th>
                  <th scope="col" className="px-3 py-2">Finished</th>
                  <th scope="col" className="px-3 py-2">Score</th>
                  <th scope="col" className="px-3 py-2">Reps</th>
                  <th scope="col" className="px-3 py-2">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {item.attempts.filter(isFinished).sort((left, right) => left.attempt_number - right.attempt_number).map((attempt) => (
                  <tr key={attempt.attempt_id}>
                    <th scope="row" className="px-3 py-2 font-medium">{attempt.attempt_number}</th>
                    <td className="px-3 py-2 tabular-nums">{attempt.finished_at ? <time dateTime={attempt.finished_at}>{formatUtcDate(attempt.finished_at)}</time> : "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{attempt.result ? formatScore(attempt.result.average_score) : "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{attempt.result?.rep_count ?? "—"}</td>
                    <td className="px-3 py-2">
                      {attempt.result
                        ? summaryPresentation(attempt.result, summaryProviderConfigured).compactStatus
                        : "result unavailable"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {attempts.map((attempt) => (
            <details key={attempt.attempt_id} className="rounded-lg border border-border bg-surface-raised p-3">
              <summary className="cursor-pointer rounded-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                Attempt {attempt.attempt_number}: rep scores and form metrics
              </summary>
              <div className="mt-3 space-y-3">
                {attempt.result && (
                  <SummaryState result={attempt.result} summaryProviderConfigured={summaryProviderConfigured} />
                )}
                <RepScoreTable reps={attempt.result?.rep_results ?? []} />
              </div>
            </details>
          ))}
        </section>
      )}
    </article>
  );
}

export function AssessmentDetail({
  role,
  detail,
  reviewAction,
  summaryProviderConfigured = false,
}: {
  role: ViewerRole;
  detail: FormCoachWorkflowDetail | FormCoachReviewDetail;
  reviewAction?: FormCoachReviewAction;
  summaryProviderConfigured?: boolean;
}) {
  const backHref = role === "coach" ? "/form-coach/assessments" : "/form-checks";
  const title = detail.source_kind === "manual" ? "Manual Form Check" : detail.program_title ?? "Program assessment";

  return (
    <div className="space-y-7">
      <Link className="text-link" href={backHref}>← Back to {role === "coach" ? "assessments" : "Form Checks"}</Link>

      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-accent">
              {detail.source_kind === "program" ? "Program assessment" : "Manual Form Check"}
            </p>
            <h1 className="mt-1 text-4xl sm:text-5xl">{title}</h1>
          </div>
          <span className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-semibold">
            {STATUS_LABELS[detail.status]}
          </span>
        </div>

        <dl className="grid gap-3 rounded-xl border border-border bg-surface p-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">Sent</dt>
            <dd className="mt-1 font-medium"><time dateTime={detail.sent_at}>{formatUtcDate(detail.sent_at)}</time></dd>
          </div>
          <div>
            <dt className="text-muted">Due</dt>
            <dd className="mt-1 font-medium"><time dateTime={detail.due_at}>{formatUtcDateTime(detail.due_at)}</time></dd>
          </div>
          <div>
            <dt className="text-muted">Exercises</dt>
            <dd className="mt-1 font-medium">{detail.items.length}</dd>
          </div>
          {role === "coach" && detail.member_id && (
            <div>
              <dt className="text-muted">Member</dt>
              <dd className="mt-1 font-medium">
                <Link className="text-link" href={`/members/${encodeURIComponent(detail.member_id)}`}>
                  Open member profile
                </Link>
              </dd>
            </div>
          )}
        </dl>

        {role === "member" && (
          <p className="rounded-lg border border-border bg-surface p-3 text-sm text-muted">
            This page shows assessment details, results and feedback. Starting attempts and submitting reviews are not available here.
          </p>
        )}
      </header>

      <section className="space-y-4" aria-labelledby="exercise-history-heading">
        <div>
          <h2 id="exercise-history-heading" className="text-3xl">Exercise results and history</h2>
          <p className="mt-1 text-sm text-muted">Scores and form metrics come from finished attempts recorded for this assessment.</p>
        </div>
        {detail.items.map((item) => (
          <ItemHistory
            key={item.ordinal}
            assessmentId={detail.assessment_id}
            item={item}
            reviewItem={role === "coach" && "expected_review_sequence" in item ? item : null}
            reviewAction={reviewAction}
            summaryProviderConfigured={summaryProviderConfigured}
          />
        ))}
      </section>
    </div>
  );
}
