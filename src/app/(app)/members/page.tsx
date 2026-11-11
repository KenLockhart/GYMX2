import type { Metadata } from "next";
import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BadgeRow } from "@/components/game-parts";
import { loadBadges } from "@/lib/achievements-data";
import { T } from "@/i18n/t";
import { getTr } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTr())("Members") };
}

export default async function MembersPage() {
  const { profile } = await requireCoach();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("coach_members")
    .select("member:profiles!member_id(id, display_name, bio)")
    .eq("coach_id", profile.id);
  const members = (
    (data ?? []) as unknown as {
      member: { id: string; display_name: string; bio: string } | null;
    }[]
  )
    .flatMap((row) => (row.member ? [row.member] : []))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
  const badges = await loadBadges(members.map((member) => member.id));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-5xl">
          <T>Members</T>
        </h1>
        <p className="mt-2 max-w-xl text-muted">
          <T>People who chose you as their coach.</T>
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-danger">
          <T>
            We couldn&apos;t load your members. Please refresh and try again.
          </T>
        </p>
      ) : members.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          <T>
            No members have joined you yet. They can join from their Coaches
            page.
          </T>
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {members.map((member) => (
            <li
              key={member.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/members/${member.id}`}
                    className="text-link font-semibold"
                  >
                    {member.display_name}
                  </Link>
                  <BadgeRow badges={badges.get(member.id) ?? []} max={5} />
                </div>
                {member.bio && (
                  <p className="mt-1 text-sm text-muted">{member.bio}</p>
                )}
              </div>
              <Link
                href={`/messages/${member.id}`}
                className="btn-secondary shrink-0 px-3 py-2 text-sm"
              >
                <T>Message</T>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
