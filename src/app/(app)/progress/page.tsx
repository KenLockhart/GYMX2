import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LEVELS } from "@/lib/achievements";
import { syncProgress } from "@/lib/achievements-data";
import { LOCALE_TAG, type Locale } from "@/i18n/config";
import { getLocale, getT } from "@/i18n/server";
import { requireAccount } from "@/lib/auth";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).progress.title };
}

function formatDay(iso: string, locale: Locale) {
  return new Date(iso).toLocaleDateString(LOCALE_TAG[locale], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function ProgressPage() {
  const { profile } = await requireAccount();
  if (profile.role === "admin") redirect("/admin/leaderboard");

  const progress = await syncProgress(profile);
  if (!progress) redirect("/dashboard");
  const { level, streak, challenges, badges, earned, points } = progress;
  const earnedAt = new Map(earned.map((badge) => [badge.key, badge.earned_at]));
  const earnedCount = badges.filter((badge) => badge.earned).length;
  const weekDone = challenges.filter(
    (challenge) => challenge.done >= challenge.goal,
  ).length;
  const isCoach = profile.role === "coach";
  const all = await getT();
  const t = all.progress;
  const locale = await getLocale();
  const levelName = (name: string) => all.options.levels[name] ?? name;
  const badgeName = (name: string) => all.options.badges[name]?.name ?? name;

  return (
    <div className="space-y-10">
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">
          {all.track.mindBodySpirit[0]} <span aria-hidden="true">•</span>{" "}
          {all.track.mindBodySpirit[1]} <span aria-hidden="true">•</span>{" "}
          {all.track.mindBodySpirit[2]}
        </p>
        <h1 className="mt-1 text-5xl">{t.title}</h1>
        <p className="mt-2 max-w-xl text-muted">{t.intro}</p>
      </div>

      {progress.newKeys.length > 0 && (
        <p
          role="status"
          className="rounded-lg border border-accent bg-surface p-4 font-semibold"
        >
          {t.newBadges(progress.newKeys.length)}{" "}
          {badges
            .filter((badge) => progress.newKeys.includes(badge.key))
            .map((badge) => `${badge.icon} ${badgeName(badge.name)}`)
            .join(", ")}
        </p>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface p-5 md:col-span-2">
          <p className="text-sm text-muted">{t.level(level.number)}</p>
          <p className="mt-1 text-4xl font-bold uppercase">
            {levelName(level.name)}
          </p>
          <div
            className="mt-4 h-3 overflow-hidden rounded-full bg-surface-raised"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(level.progress * 100)}
            aria-label={t.toNextLevel}
          >
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.round(level.progress * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-muted">
            {t.points(points)} ·{" "}
            {level.next
              ? t.toNext(level.toNext, levelName(level.next))
              : t.topLevel}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-5">
          <p className="text-sm text-muted">{t.streak}</p>
          <p className="mt-1 text-4xl font-bold">
            <span aria-hidden="true">🔥</span> {t.days(streak.current)}
          </p>
          <p className="mt-2 text-sm text-muted">
            {t.best(t.days(streak.best))}
            {!streak.activeToday && streak.current > 0 && t.keepGoing}
          </p>
          <p className="mt-1 text-xs text-muted">
            {isCoach ? t.streakCoach : t.streakMember}
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-2xl">{t.challenges}</h2>
          <p className="text-sm text-muted">
            {t.challengesStatus(weekDone, challenges.length)}
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
                  <p className="font-semibold">
                    {all.options.challenges[challenge.title] ?? challenge.title}
                  </p>
                  <p
                    className={`text-sm tabular-nums ${complete ? "font-semibold text-accent" : "text-muted"}`}
                  >
                    {complete ? t.done : `${shown} / ${challenge.goal}`}
                  </p>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-raised">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${(shown / challenge.goal) * 100}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="text-2xl">{t.badges}</h2>
          <p className="text-sm text-muted">
            {t.earnedCount(earnedCount, badges.length)}
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {badges
            .toSorted((a, b) => Number(b.earned) - Number(a.earned))
            .map((badge) => (
              <li
                key={badge.key}
                className={`flex items-center gap-3 rounded-lg border p-4 ${
                  badge.earned
                    ? "border-accent bg-surface"
                    : "border-border bg-background opacity-60"
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
                  <p className="font-semibold">{badgeName(badge.name)}</p>
                  <p className="text-sm text-muted">
                    {all.options.badges[badge.name]?.description ??
                      badge.description}
                  </p>
                  {badge.earned && earnedAt.get(badge.key) && (
                    <p className="text-xs text-accent">
                      {t.earned(
                        formatDay(earnedAt.get(badge.key) as string, locale),
                      )}{" "}
                      ·{" "}
                      <Link
                        href={`/community?badge=${badge.key}`}
                        className="underline hover:text-foreground"
                      >
                        {t.share}
                      </Link>
                    </p>
                  )}
                </div>
              </li>
            ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-2xl">{t.howPoints}</h2>
        <p className="max-w-2xl text-sm text-muted">
          {isCoach ? t.pointsCoach : t.pointsMember} {t.levels}{" "}
          {LEVELS.map((item) => `${levelName(item.name)} ${item.from}`).join(
            " · ",
          )}
          .
        </p>
        {!isCoach && (
          <Link href="/tasks" className="text-link text-sm">
            {t.goTasks}
          </Link>
        )}
      </section>
    </div>
  );
}
