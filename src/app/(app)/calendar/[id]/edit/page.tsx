import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SessionForm } from "@/components/calendar-parts";
import { requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { CalendarSession } from "@/lib/types";
import { saveSession } from "../../actions";
import { loadCoachMembers } from "../../members";

export const metadata: Metadata = { title: "Edit session" };

export default async function EditSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireCoach();
  const { id } = await params;

  const supabase = await createClient();
  const { data } = await supabase
    .from("calendar_sessions")
    .select("id, coach_id, title, notes, location, meeting_url, starts_at, ends_at, session_invites(member_id)")
    .eq("id", id)
    .eq("coach_id", profile.id)
    .maybeSingle();
  const session = data as unknown as (CalendarSession & { session_invites: { member_id: string }[] }) | null;
  if (!session) notFound();

  const { members, error } = await loadCoachMembers(profile.id);

  return (
    <div className="space-y-6">
      <Link href={`/calendar/${session.id}`} className="text-link text-sm">
        Back to the session
      </Link>
      <h1 className="text-5xl">Edit session</h1>
      <p className="max-w-xl text-sm text-muted">
        If you change the date or time, everyone invited is asked to reply again.
      </p>

      {error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load your members. Please refresh and try again.
        </p>
      ) : (
        <SessionForm
          action={saveSession}
          members={members}
          submitLabel="Save changes"
          initial={{
            id: session.id,
            title: session.title,
            notes: session.notes,
            location: session.location,
            meeting_url: session.meeting_url ?? "",
            starts_at: session.starts_at,
            ends_at: session.ends_at,
            member_ids: session.session_invites.map((invite) => invite.member_id),
          }}
        />
      )}
    </div>
  );
}
