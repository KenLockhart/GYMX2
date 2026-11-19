import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CoachIntakeSummary } from "@/components/coach-intake-summary";
import { getT } from "@/i18n/server";
import { requireAccount } from "@/lib/auth";
import {
  loadCoachSessionIntakes,
  loadMyPendingIntakeBookings,
} from "@/lib/member-intake-server";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).intake.title };
}

type SessionPageData = {
  id: string;
  coach_id: string;
  title: string;
  session_invites: { member_id: string; response: string; member: { display_name: string } | null }[];
};

export default async function SessionIntakePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await requireAccount();
  const { id: rawId } = await params;
  const sessionId = idSchema.safeParse(rawId);
  if (!sessionId.success) notFound();
  const supabase = await createClient();
  const { data } = await supabase
    .from("calendar_sessions")
    .select("id, coach_id, title, session_invites(member_id, response, member:profiles!member_id(display_name))")
    .eq("id", sessionId.data)
    .maybeSingle();
  const session = data as unknown as SessionPageData | null;
  if (!session) notFound();
  const intakeCopy = (await getT()).intake;
  const isCoachOwner = profile.role === "coach" && session.coach_id === profile.id;
  const ownInvite = session.session_invites.find((invite) => invite.member_id === profile.id);

  if (isCoachOwner) {
    const result = await loadCoachSessionIntakes(session.id);
    const byMember = new Map(result.rows.map((row) => [row.memberId, row]));
    const confirmed = session.session_invites.filter((invite) => invite.response === "going");
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <Link href={`/calendar/${session.id}`} className="text-link text-sm">{session.title}</Link>
        <nav aria-label="Session tabs" className="flex gap-2 border-b border-border">
          <Link href={`/calendar/${session.id}`} className="border-b-2 border-transparent px-3 py-2 text-sm text-muted">{(await getT()).calendar.session.title}</Link>
          <Link href={`/calendar/${session.id}/intake`} aria-current="page" className="border-b-2 border-accent px-3 py-2 text-sm font-semibold">{intakeCopy.title}</Link>
        </nav>
        <header>
          <h1 className="text-4xl">{session.title} · {intakeCopy.title}</h1>
          <p className="mt-2 text-sm text-muted">{intakeCopy.medicalDisclaimer}</p>
        </header>
        {result.error ? (
          <p role="alert" className="rounded-lg border border-border bg-surface p-4 text-muted">{intakeCopy.statusUnavailable}</p>
        ) : confirmed.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-muted">{intakeCopy.introNoBooking}</p>
        ) : (
          <div className="space-y-6">
            {confirmed.map((invite) => {
              const intake = byMember.get(invite.member_id);
              return (
                <section key={invite.member_id} className="space-y-3 border-b border-border pb-6 last:border-0">
                  <h2 className="text-2xl">{invite.member?.display_name ?? "A member"}</h2>
                  {intake?.status === "complete" && intake.answers ? (
                    <CoachIntakeSummary answers={intake.answers} completedAt={intake.completedAt} />
                  ) : (
                    <p className="rounded-lg border border-border bg-surface p-4 text-muted">{intakeCopy.statusPending}</p>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (profile.role === "member" && ownInvite) {
    if (ownInvite.response !== "going") {
      return (
        <div className="mx-auto max-w-2xl space-y-6">
          <Link href={`/calendar/${session.id}`} className="text-link text-sm">{session.title}</Link>
          <h1 className="text-4xl">{intakeCopy.title}</h1>
          <p className="rounded-xl border border-border bg-surface p-4 text-sm">{intakeCopy.introNoBooking}</p>
        </div>
      );
    }
    const pending = await loadMyPendingIntakeBookings();
    const ownStatus = pending.error
      ? "unavailable"
      : pending.bookings.some((booking) => booking.coachId === session.coach_id)
        ? "pending"
        : "complete";
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Link href={`/calendar/${session.id}`} className="text-link text-sm">{session.title}</Link>
        <h1 className="text-4xl">{intakeCopy.title}</h1>
        <p className="rounded-xl border border-border bg-surface p-4 text-sm">
          {ownStatus === "complete" ? intakeCopy.statusComplete : ownStatus === "pending" ? intakeCopy.statusPending : intakeCopy.statusUnavailable}
        </p>
        {ownStatus !== "unavailable" && (
          <Link href={`/intake?coach=${session.coach_id}`} className="btn-primary">{intakeCopy.buttons.openIntake}</Link>
        )}
      </div>
    );
  }

  notFound();
}
