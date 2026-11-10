import {
  ArrowRight,
  BadgeCheck,
  ChevronRight,
  Handshake,
  type LucideIcon,
  ShoppingCart,
  Star,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { RangeSelect } from "@/components/range-select";
import {
  type Activity,
  type RangeDays,
  sparklinePoints,
  timeAgo,
} from "@/lib/admin-console";

type Kpi = {
  label: string;
  icon: LucideIcon;
  href: string;
  total: number;
  added: number;
  changePct: number | null;
  series: number[];
};
type QuickAction = {
  label: string;
  icon: LucideIcon;
  href: string;
  primary?: boolean;
};
type Task = {
  label: string;
  detail: string;
  count: number;
  icon: LucideIcon;
  href: string;
};

// The Admin Console's Platform overview, drawn from numbers the page has already worked out.
export function AdminOverview({
  range,
  rangeLabel,
  kpis,
  rating,
  reviewCount,
  quickActions,
  sortedTasks,
  waiting,
  activity,
}: {
  range: RangeDays;
  rangeLabel: string;
  kpis: Kpi[];
  rating: number | null;
  reviewCount: number;
  quickActions: QuickAction[];
  sortedTasks: Task[];
  waiting: number;
  activity: Activity[];
}) {
  const activityStyle = {
    signup: { icon: UserPlus, tone: "bg-accent text-accent-foreground" },
    profile: { icon: BadgeCheck, tone: "bg-[#2f7d32] text-white" },
    review: { icon: Star, tone: "bg-[#6d4fd8] text-white" },
    sale: { icon: ShoppingCart, tone: "bg-[#2563c9] text-white" },
    affiliate: { icon: Handshake, tone: "bg-[#0f8a86] text-white" },
  } as const;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-accent">
            Admin
          </p>
          <h1 className="mt-1 text-4xl normal-case sm:text-5xl">
            Platform overview
          </h1>
          <p className="mt-2 text-muted">
            Manage coaches, affiliates, communities and how the platform is
            doing.
          </p>
        </div>
        <RangeSelect value={range} />
      </div>

      <section
        aria-label="Key numbers"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {kpis.map((kpi) => (
          <Link
            key={kpi.label}
            href={kpi.href}
            className="group rounded-2xl border border-border bg-surface p-4 transition-colors hover:border-accent/60"
          >
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
                <kpi.icon aria-hidden className="size-6" strokeWidth={1.8} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-3xl font-bold leading-none tabular-nums">
                  {kpi.total.toLocaleString("en-US")}
                </p>
                <p className="mt-1 text-sm text-muted">{kpi.label}</p>
              </div>
              {kpi.added > 0 && (
                <span
                  className="shrink-0 text-xs font-semibold text-accent"
                  title={`${kpi.added} new in the ${rangeLabel}`}
                >
                  ▲{" "}
                  {kpi.changePct === null
                    ? `+${kpi.added}`
                    : `+${kpi.changePct}%`}
                </span>
              )}
            </div>
            <div className="mt-3 flex items-end justify-between gap-3">
              <p className="text-xs text-muted">
                {kpi.added > 0 ? `${kpi.added} new` : "None new"} · {rangeLabel}
              </p>
              <svg
                aria-hidden
                viewBox="0 0 96 32"
                className="h-8 w-24 shrink-0 text-accent"
              >
                <polyline
                  points={sparklinePoints(kpi.series)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </Link>
        ))}
        <Link
          href="/admin/reviews"
          className="rounded-2xl border border-border bg-surface p-4 transition-colors hover:border-accent/60"
        >
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
              <Star aria-hidden className="size-6" strokeWidth={1.8} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-3xl font-bold leading-none tabular-nums">
                {rating ?? "—"}
              </p>
              <p className="mt-1 text-sm text-muted">Average review rating</p>
            </div>
          </div>
          <div className="mt-3 flex items-end justify-between gap-3">
            <p className="text-xs text-muted">
              {reviewCount} {reviewCount === 1 ? "review" : "reviews"}
            </p>
            {rating !== null && (
              <span
                role="img"
                aria-label={`${rating} out of 5`}
                className="flex gap-0.5 text-accent"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    aria-hidden
                    className="size-4"
                    fill={rating >= n - 0.25 ? "currentColor" : "none"}
                    strokeWidth={1.8}
                  />
                ))}
              </span>
            )}
          </div>
        </Link>
      </section>

      <section aria-labelledby="quick-actions" className="space-y-3">
        <h2 id="quick-actions" className="text-2xl normal-case">
          Quick actions
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
          {quickActions.map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className={`flex flex-col items-center justify-center gap-2 rounded-2xl border px-2 py-4 text-center text-sm font-semibold transition-colors ${
                action.primary
                  ? "border-accent bg-accent/10 text-foreground hover:bg-accent/15"
                  : "border-border bg-surface hover:border-accent/60"
              }`}
            >
              <action.icon
                aria-hidden
                className={`size-6 ${action.primary ? "text-accent" : ""}`}
                strokeWidth={1.8}
              />
              {action.label}
            </Link>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section
          aria-labelledby="tasks-title"
          className="rounded-2xl border border-border bg-surface"
        >
          <div className="flex items-center gap-3 border-b border-border px-5 py-4">
            <h2 id="tasks-title" className="text-2xl normal-case">
              Requests and tasks
            </h2>
            {waiting > 0 && (
              <span className="rounded-full bg-danger px-2 text-sm font-bold leading-6 text-background">
                {waiting}
                <span className="sr-only"> waiting</span>
              </span>
            )}
          </div>
          <ul className="divide-y divide-border">
            {sortedTasks.map((task) => (
              <li key={task.label}>
                <Link
                  href={task.href}
                  className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface-raised"
                >
                  <task.icon
                    aria-hidden
                    className={`size-5 shrink-0 ${task.count ? "text-foreground" : "text-muted"}`}
                    strokeWidth={1.8}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block font-semibold ${task.count ? "" : "text-muted"}`}
                    >
                      {task.label}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {task.detail}
                    </span>
                  </span>
                  {task.count > 0 ? (
                    <span className="min-w-7 rounded-full bg-danger/90 px-2 text-center text-sm font-bold leading-6 text-background">
                      {task.count}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">All clear</span>
                  )}
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 text-muted"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="activity-title"
          className="rounded-2xl border border-border bg-surface"
        >
          <div className="border-b border-border px-5 py-4">
            <h2 id="activity-title" className="text-2xl normal-case">
              Recent activity
            </h2>
          </div>
          {activity.length === 0 ? (
            <p className="p-5 text-muted">
              Nothing yet. Sign-ups, approvals, reviews and sales will show
              here.
            </p>
          ) : (
            <ol className="relative px-5 py-2">
              <span
                aria-hidden
                className="absolute bottom-6 left-[2.45rem] top-6 w-px bg-border"
              />
              {activity.map((event, i) => {
                const style = activityStyle[event.kind];
                return (
                  <li key={`${event.kind}-${event.at}-${i}`}>
                    <Link
                      href={event.href}
                      className="relative flex items-center gap-4 rounded-xl py-2.5 hover:bg-surface-raised/60"
                    >
                      <span
                        className={`relative grid size-9 shrink-0 place-items-center rounded-full ${style.tone}`}
                      >
                        <style.icon
                          aria-hidden
                          className="size-[18px]"
                          strokeWidth={2}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">
                          {event.title}
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {event.detail} · {timeAgo(event.at)}
                        </span>
                      </span>
                      <ArrowRight
                        aria-hidden
                        className="size-4 shrink-0 text-muted"
                      />
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
