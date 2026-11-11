import type { Metadata } from "next";
import Link from "next/link";
import { SessionForm } from "@/components/calendar-parts";
import { getT } from "@/i18n/server";
import { requireCoach } from "@/lib/auth";
import { loadCoachMembers } from "../members";
import { saveSession } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).calendar.schedule };
}

export default async function NewSessionPage() {
  const { profile } = await requireCoach();
  const { members, error } = await loadCoachMembers(profile.id);
  const t = (await getT()).calendar;

  return (
    <div className="space-y-6">
      <Link href="/calendar" className="text-link text-sm">
        {t.new.back}
      </Link>
      <h1 className="text-5xl">{t.schedule}</h1>

      {error ? (
        <p role="alert" className="text-danger">
          {t.new.membersError}
        </p>
      ) : members.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          {t.new.noMembers}
        </p>
      ) : (
        <SessionForm
          action={saveSession}
          members={members}
          submitLabel={t.new.submit}
          initial={{
            id: "",
            title: "",
            notes: "",
            location: "",
            meeting_url: "",
            starts_at: null,
            ends_at: null,
            member_ids: members.map((member) => member.id),
          }}
        />
      )}
    </div>
  );
}
