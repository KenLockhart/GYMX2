import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PillarTag } from "@/components/game-parts";
import { formatMoney } from "@/lib/armory";
import { getT } from "@/i18n/server";
import { requireAccount } from "@/lib/auth";
import { matchCoaches } from "@/lib/onboarding";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).welcome.matches.title };
}

type CoachRow = {
  id: string;
  display_name: string;
  bio: string;
  specialties: string[];
  join_mode: string;
};
type ProgramRow = {
  coach_id: string;
  title: string;
  program_days: { count: number }[];
};

export default async function MatchesPage() {
  const { profile } = await requireAccount();
  if (profile.role !== "member") redirect("/dashboard");
  if (profile.goals.length === 0) redirect("/welcome");
  const all = await getT();
  const t = all.welcome.matches;
  const goalLabel = (value: string) => all.options.goals[value] ?? value;

  const supabase = await createClient();
  const [{ data: coachData }, { data: planData }, { data: programData }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, display_name, bio, specialties, join_mode")
        .eq("role", "coach"),
      supabase
        .from("coach_plans")
        .select("coach_id, price_cents")
        .eq("active", true)
        .not("stripe_price_id", "is", null),
      // Members only see programs of coaches they've joined, so the server shares just the published titles.
      createAdminClient()
        .from("programs")
        .select("coach_id, title, program_days(count)")
        .eq("published", true),
    ]);
  const coaches = (coachData ?? []) as CoachRow[];

  const lowestPlan = new Map<string, number>();
  for (const plan of planData ?? []) {
    const current = lowestPlan.get(plan.coach_id as string);
    if (current === undefined || (plan.price_cents as number) < current) {
      lowestPlan.set(plan.coach_id as string, plan.price_cents as number);
    }
  }
  const programs = new Map<string, ProgramRow[]>();
  for (const program of (programData ?? []) as unknown as ProgramRow[]) {
    programs.set(program.coach_id, [
      ...(programs.get(program.coach_id) ?? []),
      program,
    ]);
  }

  const matches = matchCoaches(
    { goals: profile.goals, focus: profile.focus },
    coaches.map((coach) => ({
      id: coach.id,
      specialties: coach.specialties ?? [],
      programs: programs.get(coach.id)?.length ?? 0,
    })),
  );
  const byId = new Map(coaches.map((coach) => [coach.id, coach]));

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">
          {t.title}
        </p>
        <h1 className="mt-1 text-5xl">{matches.length ? t.forYou : t.find}</h1>
        <p className="mt-3 flex max-w-2xl flex-wrap items-center gap-2 text-muted">
          <span>
            {t.youWant(profile.goals.map(goalLabel).join(", ").toLowerCase())}
          </span>
          {profile.focus && (
            <span className="inline-flex items-center gap-2">
              {t.startingWith} <PillarTag pillar={profile.focus} />
            </span>
          )}
        </p>
      </div>

      {matches.length === 0 ? (
        <p className="max-w-xl rounded-lg border border-border bg-surface p-4 text-muted">
          {t.none}
        </p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-3">
          {matches.map((match, index) => {
            const coach = byId.get(match.id)!;
            const plan = lowestPlan.get(coach.id);
            const first = programs.get(coach.id)?.[0];
            return (
              <li
                key={coach.id}
                className={`flex flex-col gap-3 rounded-lg border bg-surface p-5 ${index === 0 ? "border-accent" : "border-border"}`}
              >
                {index === 0 && (
                  <p className="text-xs font-bold uppercase tracking-widest text-accent">
                    {t.best}
                  </p>
                )}
                <p className="text-2xl font-bold">{coach.display_name}</p>
                {coach.bio && (
                  <p className="line-clamp-3 text-sm text-muted">{coach.bio}</p>
                )}
                {match.shared.length > 0 && (
                  <p className="text-sm">
                    <span className="text-muted">{t.helpsWith}</span>
                    {match.shared.map(goalLabel).join(", ")}
                  </p>
                )}
                {first && (
                  <p className="text-sm">
                    <span className="text-muted">{t.startWith}</span>
                    {first.title} (
                    {all.programs.weeks(first.program_days[0]?.count ?? 0)})
                  </p>
                )}
                {coach.join_mode !== "free" && plan !== undefined && (
                  <p className="text-sm font-semibold text-accent">
                    {coach.join_mode === "paid" ? t.subscribersOnly : ""}
                    {t.plansFrom(formatMoney(plan))}
                  </p>
                )}
                <Link
                  href={`/coaches/${coach.id}`}
                  className={`mt-auto text-center ${index === 0 ? "btn-primary" : "btn-secondary"}`}
                >
                  {t.meet(coach.display_name)}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap gap-3">
        <Link href="/coaches" className="btn-secondary">
          {t.seeAll}
        </Link>
        <Link href="/dashboard" className="btn-secondary">
          {t.dashboard}
        </Link>
      </div>
      <p className="text-sm text-muted">
        {t.onceJoinedBefore}{" "}
        <Link href="/programs" className="text-link">
          {t.programs}
        </Link>
        {t.onceJoinedAfter}
      </p>
    </div>
  );
}
