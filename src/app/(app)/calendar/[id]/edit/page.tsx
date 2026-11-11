import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SessionForm } from "@/components/calendar-parts";
import { getT } from "@/i18n/server";
import { requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { CalendarSession } from "@/lib/types";
import { saveSession } from "../../actions";
import { loadCoachMembers } from "../../members";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).calendar.edit.title };
}

export default async function EditSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await requireCoach();
  const { id } = await params;

  const supabase = await createClient();
  const { data } = await supabase
    .from("calendar_sessions")
    .select(
      "id, coach_id, title, notes, location, meeting_url, starts_at, ends_at, session_invites(member_id)",
    )
    .eq("id", id)
    .eq("coach_id", profile.id)
    .maybeSingle();
  const session = data as unknown as
    (CalendarSession & { session_invites: { member_id: string }[] }) | null;
  if (!session) notFound();

  const { members, error } = await loadCoachMembers(profile.id);
  const t = (await getT()).calendar;

  return (
    <div className="space-y-6">
      <Link href={`/calendar/${session.id}`} className="text-link text-sm">
        {t.edit.back}
      </Link>
      <h1 className="text-5xl">{t.edit.title}</h1>
      <p className="max-w-xl text-sm text-muted">{t.edit.note}</p>

      {error ? (
        <p role="alert" className="text-danger">
          {t.new.membersError}
        </p>
      ) : (
        <SessionForm
          action={saveSession}
          members={members}
          submitLabel={t.edit.submit}
          initial={{
            id: session.id,
            title: session.title,
            notes: session.notes,
            location: session.location,
            meeting_url: session.meeting_url ?? "",
            starts_at: session.starts_at,
            ends_at: session.ends_at,
            member_ids: session.session_invites.map(
              (invite) => invite.member_id,
            ),
          }}
        />
      )}
    </div>
  );
}
