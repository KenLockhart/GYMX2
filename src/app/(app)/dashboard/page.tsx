import type { Metadata } from "next";
import Link from "next/link";
import { syncProgress } from "@/lib/achievements-data";
import { requireAccount } from "@/lib/auth";
import type { UserRole } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard" };

const roleIntro: Record<UserRole, string> = {
  member:
    "You're in. Join a coach to start getting Tasks and sessions, and keep daily notes in your Memos.",
  coach:
    "You're set up as a coach. Upload videos to your library, give Tasks to your members and schedule sessions.",
  admin: "You manage GYMX2. Review coach requests and member roles from the admin area.",
};

export default async function DashboardPage() {
  const { profile } = await requireAccount();
  // Visiting the dashboard also catches up on any badges earned elsewhere (messages, sales).
  const progress = await syncProgress(profile).catch(() => null);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">{profile.role}</p>
        <h1 className="mt-1 text-5xl">Welcome, {profile.display_name}</h1>
        <p className="mt-3 max-w-xl text-muted">{roleIntro[profile.role]}</p>
      </div>

      {progress && (
        <Link
          href="/progress"
          className="grid max-w-3xl gap-4 rounded-lg border border-border bg-surface p-5 transition hover:border-accent sm:grid-cols-3"
        >
          <div>
            <p className="text-sm text-muted">Level {progress.level.number}</p>
            <p className="text-2xl font-bold uppercase">{progress.level.name}</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-raised">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.round(progress.level.progress * 100)}%` }}
              />
            </div>
          </div>
          <div>
            <p className="text-sm text-muted">Streak</p>
            <p className="text-2xl font-bold">
              <span aria-hidden="true">🔥</span> {progress.streak.current}{" "}
              {progress.streak.current === 1 ? "day" : "days"}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted">This week</p>
            <p className="text-2xl font-bold">
              {progress.challenges.filter((challenge) => challenge.done >= challenge.goal).length} /{" "}
              {progress.challenges.length} challenges
            </p>
            {progress.newKeys.length > 0 && (
              <p className="text-sm font-semibold text-accent">
                New badge{progress.newKeys.length > 1 ? "s" : ""}! See your progress
              </p>
            )}
          </div>
        </Link>
      )}

      {profile.coach_requested && (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm">
          Your coach request is waiting for admin review.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {profile.role === "member" && (
          <>
            <Link href="/tasks" className="btn-primary">
              See your Tasks
            </Link>
            <Link href="/calendar" className="btn-secondary">
              Open your calendar
            </Link>
            <Link href="/armory" className="btn-secondary">
              Visit the Armory
            </Link>
            <Link href="/coaches" className="btn-secondary">
              Find a coach
            </Link>
          </>
        )}
        {profile.role === "coach" && (
          <>
            <Link href="/tasks/new" className="btn-primary">
              Give a Task
            </Link>
            <Link href="/library/upload" className="btn-secondary">
              Upload a video
            </Link>
            <Link href="/calendar/new" className="btn-secondary">
              Schedule a session
            </Link>
            <Link href="/armory/new" className="btn-secondary">
              Add to the Armory
            </Link>
          </>
        )}
        <Link
          href="/profile"
          className={profile.role === "admin" ? "btn-primary" : "btn-secondary"}
        >
          Edit your profile
        </Link>
        {profile.role === "admin" && (
          <Link href="/admin" className="btn-secondary">
            Open admin
          </Link>
        )}
      </div>
    </div>
  );
}
