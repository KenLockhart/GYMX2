import type { Metadata } from "next";
import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage() {
  const { profile } = await requireCoach();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("coach_members")
    .select("member:profiles!member_id(id, display_name, bio)")
    .eq("coach_id", profile.id);
  const members = ((data ?? []) as unknown as {
    member: { id: string; display_name: string; bio: string } | null;
  }[])
    .flatMap((row) => (row.member ? [row.member] : []))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-5xl">Members</h1>
        <p className="mt-2 max-w-xl text-muted">People who chose you as their coach.</p>
      </div>

      {error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load your members. Please refresh and try again.
        </p>
      ) : members.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          No members have joined you yet. They can join from their Coaches page.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {members.map((member) => (
            <li key={member.id} className="p-4">
              <Link href={`/members/${member.id}`} className="text-link font-semibold">
                {member.display_name}
              </Link>
              {member.bio && <p className="mt-1 text-sm text-muted">{member.bio}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
