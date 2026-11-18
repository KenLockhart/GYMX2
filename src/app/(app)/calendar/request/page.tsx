import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { requireAccount } from "@/lib/auth";
import { loadContacts } from "@/app/(app)/messages/contacts";
import { SessionRequestForm } from "./form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).calendar.request.title };
}

export default async function SessionRequestPage() {
  const { profile } = await requireAccount();
  if (profile.role !== "member") redirect("/dashboard");

  const t = (await getT()).calendar.request;
  const { contacts, error } = await loadContacts(profile);
  const coaches = contacts.map(({ id, display_name }) => ({ id, display_name }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/calendar" className="text-link text-sm">
          {t.back}
        </Link>
        <h1 className="mt-2 text-5xl">{t.title}</h1>
        <p className="mt-2 max-w-xl text-muted">{t.intro}</p>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-danger p-4 text-danger">
          {t.loadError} <Link href="/calendar/request" className="underline">{t.retry}</Link>
        </p>
      ) : coaches.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          {t.noCoach} <Link href="/coaches" className="text-link">{t.findCoach}</Link>
        </p>
      ) : (
        <>
          <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">
            {t.requestOnly}
          </p>
          <SessionRequestForm
            coaches={coaches}
            copy={{
              coach: t.coach,
              chooseCoach: t.chooseCoach,
              day: t.day,
              time: t.time,
              timeZone: t.timeZone,
              timeZoneHint: t.timeZoneHint,
              note: t.note,
              noteHint: t.noteHint,
              submit: t.submit,
              submitting: t.submitting,
            }}
          />
        </>
      )}
    </div>
  );
}
