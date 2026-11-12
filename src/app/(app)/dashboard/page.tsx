import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { syncProgress } from "@/lib/achievements-data";
import { requireAccount } from "@/lib/auth";
import { CoachDashboard } from "@/components/coach-dashboard";
import { loadCoachDashboardData } from "@/lib/coach-dashboard-data";
import { weekStart } from "@/lib/checkins";
import { todayKey } from "@/lib/reminders";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).dashboard.title };
}

export default async function DashboardPage() {
  const { profile } = await requireAccount();
  const t = await getT();
  const d = t.dashboard;
  // New members answer a few questions first (they can skip).
  if (profile.role === "member" && !profile.onboarded_at) redirect("/welcome");
  // Visiting the dashboard also catches up on any badges earned elsewhere (messages, sales).
  const progress = await syncProgress(profile).catch(() => null);

  if (profile.role === "coach") {
    const data = await loadCoachDashboardData(profile.id);
    return (
      <CoachDashboard
        profile={profile}
        photoUrl={data.photoUrl}
        sessions={data.sessions.items}
        sessionsError={data.sessions.error}
        activity={data.activity.items}
        activityError={data.activity.error}
        goals={t.options.goals}
        copy={d}
        roleLabel={t.common.roles.coach}
      />
    );
  }

  // From Thursday on, members with a coach see a nudge until they check in for the week.
  let checkinDue = false;
  const today = todayKey();
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (profile.role === "member" && (weekday === 0 || weekday >= 4)) {
    const supabase = await createClient();
    const [{ count: coaches }, { count: done }] = await Promise.all([
      supabase
        .from("coach_members")
        .select("coach_id", { count: "exact", head: true })
        .eq("member_id", profile.id),
      supabase
        .from("checkins")
        .select("id", { count: "exact", head: true })
        .eq("member_id", profile.id)
        .eq("week_start", weekStart(today)),
    ]);
    checkinDue = (coaches ?? 0) > 0 && (done ?? 0) === 0;
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">
          {t.common.roles[profile.role] ?? profile.role}
        </p>
        <h1 className="mt-1 text-5xl">{d.welcome(profile.display_name)}</h1>
        <p className="mt-3 max-w-xl text-muted">{d.intro[profile.role]}</p>
      </div>

      {checkinDue && (
        <Link
          href="/checkin"
          className="flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-lg border border-accent bg-surface p-5 transition hover:bg-surface-raised"
        >
          <span>
            <span className="block text-lg font-semibold">
              {d.checkinTitle}
            </span>
            <span className="text-sm text-muted">{d.checkinBody}</span>
          </span>
          <span className="btn-primary">{d.checkinButton}</span>
        </Link>
      )}

      {progress && (
        <Link
          href="/progress"
          className="grid max-w-3xl gap-4 rounded-lg border border-border bg-surface p-5 transition hover:border-accent sm:grid-cols-3"
        >
          <div>
            <p className="text-sm text-muted">
              {d.level(progress.level.number)}
            </p>
            <p className="text-2xl font-bold uppercase">
              {t.options.levels[progress.level.name] ?? progress.level.name}
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-raised">
              <div
                className="h-full rounded-full bg-accent"
                style={{
                  width: `${Math.round(progress.level.progress * 100)}%`,
                }}
              />
            </div>
          </div>
          <div>
            <p className="text-sm text-muted">{d.streak}</p>
            <p className="text-2xl font-bold">
              <span aria-hidden="true">🔥</span>{" "}
              {d.days(progress.streak.current)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted">{d.thisWeek}</p>
            <p className="text-2xl font-bold">
              {d.challenges(
                progress.challenges.filter(
                  (challenge) => challenge.done >= challenge.goal,
                ).length,
                progress.challenges.length,
              )}
            </p>
            {progress.newKeys.length > 0 && (
              <p className="text-sm font-semibold text-accent">
                {d.newBadges(progress.newKeys.length)}
              </p>
            )}
          </div>
        </Link>
      )}

      {profile.coach_requested && (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm">
          {d.coachRequestPending}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {profile.role === "member" && (
          <>
            <Link href="/tasks" className="btn-primary">
              {d.seeTasks}
            </Link>
            <Link href="/calendar" className="btn-secondary">
              {d.openCalendar}
            </Link>
            <Link href="/armory" className="btn-secondary">
              {d.visitArmory}
            </Link>
            <Link href="/coaches" className="btn-secondary">
              {d.findCoach}
            </Link>
          </>
        )}
        <Link
          href="/profile"
          className={profile.role === "admin" ? "btn-primary" : "btn-secondary"}
        >
          {d.editProfile}
        </Link>
        {profile.role === "admin" && (
          <Link href="/admin" className="btn-secondary">
            {d.openAdmin}
          </Link>
        )}
      </div>
    </div>
  );
}
