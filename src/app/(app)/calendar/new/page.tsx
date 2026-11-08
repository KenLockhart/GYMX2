import type { Metadata } from "next";
import Link from "next/link";
import { SessionForm } from "@/components/calendar-parts";
import { requireCoach } from "@/lib/auth";
import { loadCoachMembers } from "../members";
import { saveSession } from "../actions";

export const metadata: Metadata = { title: "Schedule a session" };

export default async function NewSessionPage() {
  const { profile } = await requireCoach();
  const { members, error } = await loadCoachMembers(profile.id);

  return (
    <div className="space-y-6">
      <Link href="/calendar" className="text-link text-sm">
        Back to the calendar
      </Link>
      <h1 className="text-5xl">Schedule a session</h1>

      {error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load your members. Please refresh and try again.
        </p>
      ) : members.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          No members have joined you yet. They can join from their Coaches page.
        </p>
      ) : (
        <SessionForm
          action={saveSession}
          members={members}
          submitLabel="Schedule session"
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
