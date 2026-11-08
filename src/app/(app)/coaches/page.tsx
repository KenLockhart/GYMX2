import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { requireAccount } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { joinCoach, leaveCoach } from "./actions";
import { BadgeRow } from "@/components/game-parts";
import { loadBadges } from "@/lib/achievements-data";

export const metadata: Metadata = { title: "Coaches" };

export default async function CoachesPage() {
  const { profile } = await requireAccount();
  if (profile.role !== "member") redirect("/dashboard");

  const supabase = await createClient();
  const [coachResult, joinedResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, bio")
      .eq("role", "coach")
      .order("display_name"),
    supabase.from("coach_members").select("coach_id").eq("member_id", profile.id),
  ]);
  const coaches = (coachResult.data ?? []) as Pick<Profile, "id" | "display_name" | "bio">[];
  const joined = new Set((joinedResult.data ?? []).map((row) => row.coach_id as string));
  const badges = await loadBadges(coaches.map((coach) => coach.id));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-5xl">Coaches</h1>
        <p className="mt-2 max-w-xl text-muted">
          Join a coach to watch their videos, get Tasks and sessions from them, and message them. They&apos;ll see your name and
          bio, but never your email.
        </p>
      </div>

      {coachResult.error || joinedResult.error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load the coaches. Please refresh and try again.
        </p>
      ) : coaches.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          No coaches have joined GYMX2 yet.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {coaches.map((coach) => {
            const isJoined = joined.has(coach.id);
            return (
              <li
                key={coach.id}
                className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/coaches/${coach.id}`} className="text-link font-semibold">
                      {coach.display_name}
                    </Link>
                    <BadgeRow badges={badges.get(coach.id) ?? []} max={5} />
                  </div>
                  {coach.bio && <p className="mt-1 text-sm text-muted">{coach.bio}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap items-start gap-2">
                {isJoined && (
                  <Link href={`/messages/${coach.id}`} className="btn-secondary">
                    Message
                  </Link>
                )}
                <ActionForm
                  action={isJoined ? leaveCoach : joinCoach}
                  confirmMessage={
                    isJoined
                      ? `Leave ${coach.display_name}? Your unfinished Tasks and upcoming sessions with them will be removed.`
                      : undefined
                  }
                  className="space-y-2"
                >
                  <input type="hidden" name="coach_id" value={coach.id} />
                  <SubmitButton
                    pendingText={isJoined ? "Leaving..." : "Joining..."}
                    className={isJoined ? "btn-secondary" : "btn-primary"}
                  >
                    {isJoined ? "Leave" : "Join"}
                  </SubmitButton>
                  <FormStatus />
                </ActionForm>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
