import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { requireAccount } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { joinCoach, leaveCoach } from "./actions";

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-5xl">Coaches</h1>
        <p className="mt-2 max-w-xl text-muted">
          Join a coach to watch their videos and get Tasks from them. They&apos;ll see your name and
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
                  <p className="font-semibold">{coach.display_name}</p>
                  {coach.bio && <p className="mt-1 text-sm text-muted">{coach.bio}</p>}
                </div>
                <ActionForm
                  action={isJoined ? leaveCoach : joinCoach}
                  confirmMessage={
                    isJoined
                      ? `Leave ${coach.display_name}? Your unfinished Tasks from them will be removed.`
                      : undefined
                  }
                  className="shrink-0 space-y-2"
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
