import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ResponseButtons, SessionTime } from "@/components/calendar-parts";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { getT } from "@/i18n/server";
import { requireAccount } from "@/lib/auth";
import type { SessionResponse } from "@/lib/calendar";
import { liveState } from "@/lib/live";
import { createClient } from "@/lib/supabase/server";
import type { CalendarSession } from "@/lib/types";
import { cancelSession } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).calendar.session.title };
}

type SessionDetail = CalendarSession & {
  coach: { display_name: string } | null;
  session_invites: {
    member_id: string;
    response: SessionResponse;
    member: { display_name: string } | null;
  }[];
};

const responseOrder: SessionResponse[] = ["going", "pending", "not_going"];

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await requireAccount();
  const { id } = await params;
  const all = (await getT()).calendar;
  const t = all.session;
  const { formerMember } = (await getT()).tasks;

  // Row security decides who can open a session: its coach, its invited members and admins.
  const supabase = await createClient();
  const { data } = await supabase
    .from("calendar_sessions")
    .select(
      "id, coach_id, title, notes, location, meeting_url, starts_at, ends_at, coach:profiles!coach_id(display_name), session_invites(member_id, response, member:profiles!member_id(display_name))",
    )
    .eq("id", id)
    .maybeSingle();
  const session = data as unknown as SessionDetail | null;
  if (!session) notFound();

  const isOwner = session.coach_id === profile.id;
  const myInvite = session.session_invites.find(
    (invite) => invite.member_id === profile.id,
  );
  const isPast = new Date(session.ends_at) < new Date();
  const guests = [...session.session_invites].sort(
    (a, b) =>
      responseOrder.indexOf(a.response) - responseOrder.indexOf(b.response) ||
      (a.member?.display_name ?? "").localeCompare(
        b.member?.display_name ?? "",
      ),
  );
  const going = guests.filter((invite) => invite.response === "going").length;

  const [{ data: room }, { data: attendance }] = await Promise.all([
    supabase
      .from("session_live")
      .select("live_started_at, live_ended_at")
      .eq("session_id", session.id)
      .maybeSingle(),
    supabase
      .from("session_attendance")
      .select("member_id")
      .eq("session_id", session.id),
  ]);
  const live = liveState(session, room ?? null);
  const attended = new Set(
    (attendance ?? []).map((row) => row.member_id as string),
  );
  const showLive =
    (isOwner || myInvite || profile.role === "admin") &&
    (live === "open" || live === "live" || (isOwner && live === "not_yet"));

  return (
    <div className="space-y-6">
      <Link href="/calendar" className="text-link text-sm">
        {all.new.back}
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-5xl">{session.title}</h1>
          <p className="mt-2 text-lg">
            <SessionTime
              startsAt={session.starts_at}
              endsAt={session.ends_at}
            />
          </p>
          {!isOwner && session.coach && (
            <p className="mt-1 text-muted">
              {t.with(session.coach.display_name)}
            </p>
          )}
          {isPast && <p className="mt-1 text-sm text-muted">{t.finished}</p>}
        </div>
        {isOwner && !isPast && (
          <div className="flex shrink-0 flex-wrap items-start gap-2">
            <Link
              href={`/calendar/${session.id}/edit`}
              className="btn-secondary px-3 py-2 text-sm"
            >
              {t.edit}
            </Link>
            <ActionForm
              action={cancelSession}
              confirmMessage={t.confirmCancel(session.title)}
              className="space-y-2"
            >
              <input type="hidden" name="session_id" value={session.id} />
              <SubmitButton
                pendingText={t.cancelling}
                className="btn-secondary px-3 py-2 text-sm"
              >
                {t.cancel}
              </SubmitButton>
              <FormStatus />
            </ActionForm>
          </div>
        )}
      </div>

      {showLive && (
        <div
          className={`flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-lg border p-4 ${
            live === "live"
              ? "border-danger bg-surface"
              : "border-border bg-surface"
          }`}
        >
          <p className="text-sm">
            {live === "live"
              ? isOwner
                ? t.youreLive
                : t.coachLive
              : isOwner
                ? t.teachLive
                : t.roomOpen}
          </p>
          <Link
            href={`/calendar/${session.id}/live`}
            className={live === "live" ? "btn-primary" : "btn-secondary"}
          >
            {live === "live" && !isOwner ? t.watchLive : t.openRoom}
          </Link>
        </div>
      )}

      {(session.location || session.meeting_url || session.notes) && (
        <dl className="max-w-2xl space-y-3 rounded-lg border border-border bg-surface p-4">
          {session.location && (
            <div>
              <dt className="text-sm text-muted">{t.where}</dt>
              <dd>{session.location}</dd>
            </div>
          )}
          {session.meeting_url && (
            <div>
              <dt className="text-sm text-muted">{t.videoCall}</dt>
              <dd>
                <a
                  href={session.meeting_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-link break-all"
                >
                  {t.joinCall}
                </a>
              </dd>
            </div>
          )}
          {session.notes && (
            <div>
              <dt className="text-sm text-muted">{t.notes}</dt>
              <dd className="whitespace-pre-line">{session.notes}</dd>
            </div>
          )}
        </dl>
      )}

      {myInvite && !isPast && (
        <section className="space-y-3">
          <h2 className="text-2xl">{t.coming}</h2>
          <ResponseButtons
            sessionId={session.id}
            response={myInvite.response}
          />
          {myInvite.response === "pending" && (
            <p className="text-sm text-muted">{t.letCoachKnow}</p>
          )}
        </section>
      )}

      {(isOwner || profile.role === "admin") && (
        <section className="space-y-3">
          <h2 className="text-2xl">{t.invited(going, guests.length)}</h2>
          <ul className="max-w-2xl divide-y divide-border rounded-lg border border-border bg-surface text-sm">
            {guests.map((invite) => (
              <li
                key={invite.member_id}
                className="flex justify-between gap-4 p-3"
              >
                <span>
                  {invite.member?.display_name ?? formerMember}
                  {attended.has(invite.member_id) && (
                    <span className="ml-2 text-xs text-success">
                      {t.watchedLive}
                    </span>
                  )}
                </span>
                <span
                  className={
                    invite.response === "going"
                      ? "text-success"
                      : invite.response === "not_going"
                        ? "text-danger"
                        : "text-muted"
                  }
                >
                  {all.responses[invite.response]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
