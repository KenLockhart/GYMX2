import type { Metadata } from "next";
import Link from "next/link";
import { requireAccount } from "@/lib/auth";
import type { UserRole } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard" };

const roleIntro: Record<UserRole, string> = {
  member: "You're in. Set up your profile so coaches can get to know you.",
  coach: "You're set up as a coach. Add your bio and social links so members can find you.",
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
        <Link href="/profile" className="btn-primary">
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
