import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LEVELS } from "@/lib/achievements";
import { syncProgress } from "@/lib/achievements-data";
import { requireAccount } from "@/lib/auth";

export const metadata: Metadata = { title: "Your progress" };

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function ProgressPage() {
  const { profile } = await requireAccount();
  if (profile.role === "admin") redirect("/admin/leaderboard");

  const progress = await syncProgress(profile);
  if (!progress) redirect("/dashboard");
  const { level, streak, challenges, badges, earned, points } = progress;
  const earnedAt = new Map(earned.map((badge) => [badge.key, badge.earned_at]));
  const earnedCount = badges.filter((badge) => badge.earned).length;
  const weekDone = challenges.filter((challenge) => challenge.done >= challenge.goal).length;
  const isCoach = profile.role === "coach";

  return (
    <div className="space-y-10">
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">
          Mind <span aria-hidden="true">•</span> Body <span aria-hidden="true">•</span> Spirit
        </p>
        <h1 className="mt-1 text-5xl">Your progress</h1>
        <p className="mt-2 max-w-xl text-muted">
          Only you and GYMX2 admins see your points, level and streak. Everyone can see your badges.
        </p>
      </div>

      {progress.newKeys.length > 0 && (
        <p role="status" className="rounded-lg border border-accent bg-surface p-4 font-semibold">
          New badge{progress.newKeys.length > 1 ? "s" : ""}:{" "}
          {badges
            .filter((badge) => progress.newKeys.includes(badge.key))
            .map((badge) => `${badge.icon} ${badge.name}`)
            .join(", ")}
        </p>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface p-5 md:col-span-2">
          <p className="text-sm text-muted">Level {level.number}</p>
          <p className="mt-1 text-4xl font-bold uppercase">{level.name}</p>
          <div
            className="mt-4 h-3 overflow-hidden rounded-full bg-surface-raised"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(level.progress * 100)}
            aria-label="Progress to the next level"
          >
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(level.progress * 100)}%` }} />
          </div>
          <p className="mt-2 text-sm text-muted">
            {points} points ·{" "}
            {level.next ? `${level.toNext} to ${level.next}` : "Top level reached"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-5">
          <p className="text-sm text-muted">Streak</p>
          <p className="mt-1 text-4xl font-bold">
            <span aria-hidden="true">🔥</span> {streak.current} {streak.current === 1 ? "day" : "days"}
          </p>
          <p className="mt-2 text-sm text-muted">
            Best: {streak.best} {streak.best === 1 ? "day" : "days"}
            {!streak.activeToday && streak.current > 0 && " · Do something today to keep it going"}
          </p>
          <p className="mt-1 text-xs text-muted">
            {isCoach
              ? "Counts days you publish videos, give Tasks, schedule sessions or message members."
              : "Counts days you finish a Task, write a Memo, RSVP to a session or message your coach."}
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-2xl">This week&apos;s challenges</h2>
          <p className="text-sm text-muted">
            {weekDone} of {challenges.length} done · Resets Monday · Finish all four for ⚔️ Weekly Warrior
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {challenges.map((challenge) => {
            const complete = challenge.done >= challenge.goal;
            const shown = Math.min(challenge.done, challenge.goal);
            return (
              <li
                key={challenge.key}
                className={`rounded-lg border bg-surface p-4 ${complete ? "border-accent" : "border-border"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">{challenge.title}</p>
                  <p className={`text-sm tabular-nums ${complete ? "font-semibold text-accent" : "text-muted"}`}>
                    {complete ? "Done ✓" : `${shown} / ${challenge.goal}`}
                  </p>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-raised">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(shown / challenge.goal) * 100}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-2xl">Badges</h2>
          <p className="text-sm text-muted">
            {earnedCount} of {badges.length} earned
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {badges
            .toSorted((a, b) => Number(b.earned) - Number(a.earned))
            .map((badge) => (
              <li
                key={badge.key}
                className={`flex items-center gap-3 rounded-lg border p-4 ${
                  badge.earned ? "border-accent bg-surface" : "border-border bg-background opacity-60"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex size-12 shrink-0 items-center justify-center rounded-full text-2xl ${
                    badge.earned ? "bg-surface-raised" : "bg-surface grayscale"
                  }`}
                >
                  {badge.earned ? badge.icon : "🔒"}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold">{badge.name}</p>
                  <p className="text-sm text-muted">{badge.description}</p>
                  {badge.earned && earnedAt.get(badge.key) && (
                    <p className="text-xs text-accent">Earned {formatDay(earnedAt.get(badge.key) as string)}</p>
                  )}
                </div>
              </li>
            ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-2xl">How points work</h2>
        <p className="max-w-2xl text-sm text-muted">
          {isCoach
            ? "Video published 3 · new member joins you 3 · session scheduled 2 · Task given 1 · message sent 1."
            : "Task finished 3 · session RSVP 2 · message sent 1 · Memo written 1."}{" "}
          Levels: {LEVELS.map((item) => `${item.name} ${item.from}`).join(" · ")}.
        </p>
        {!isCoach && (
          <Link href="/tasks" className="text-link text-sm">
            Go to your Tasks
          </Link>
        )}
      </section>
    </div>
  );
}
