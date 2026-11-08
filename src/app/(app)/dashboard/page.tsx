import type { Metadata } from "next";
import Link from "next/link";
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

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">{profile.role}</p>
        <h1 className="mt-1 text-5xl">Welcome, {profile.display_name}</h1>
        <p className="mt-3 max-w-xl text-muted">{roleIntro[profile.role]}</p>
      </div>

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
