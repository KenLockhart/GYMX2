import type { Metadata } from "next";
import Link from "next/link";
import {
  CalendarMonth,
  ResponseButtons,
  SessionTime,
  type CalendarItem,
} from "@/components/calendar-parts";
import { getLocale, getT } from "@/i18n/server";
import { requireAccount } from "@/lib/auth";
import {
  monthParam,
  monthRange,
  monthTitle,
  parseMonth,
  shiftMonth,
  type SessionResponse,
} from "@/lib/calendar";
import { createClient } from "@/lib/supabase/server";
import type { CalendarSession } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).calendar.title };
}

type SessionRow = Pick<
  CalendarSession,
  "id" | "title" | "starts_at" | "ends_at" | "location"
> & {
  coach: { display_name: string } | null;
  session_invites: { member_id: string; response: SessionResponse }[];
};

const SESSION_FIELDS =
  "id, title, starts_at, ends_at, location, coach:profiles!coach_id(display_name), session_invites(member_id, response)";

function goingCount(session: SessionRow) {
  return session.session_invites.filter((invite) => invite.response === "going")
    .length;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { profile } = await requireAccount();
  const t = (await getT()).calendar;
  const locale = await getLocale();
  const month = parseMonth((await searchParams).month);
  const range = monthRange(month);
  const isCoach = profile.role === "coach";
  const isMember = profile.role === "member";

  // Row security limits these to sessions the viewer runs or was invited to (or all, for admins).
  const supabase = await createClient();
  const [monthResult, upcomingResult, taskResult] = await Promise.all([
    supabase
      .from("calendar_sessions")
      .select(SESSION_FIELDS)
      .lt("starts_at", range.to)
      .gt("ends_at", range.from)
      .order("starts_at"),
    supabase
      .from("calendar_sessions")
      .select(SESSION_FIELDS)
      .gt("ends_at", new Date().toISOString())
      .order("starts_at")
      .limit(5),
    isMember
      ? supabase
          .from("task_assignments")
          .select("id, due_on, completed_at, task:tasks(title)")
          .eq("member_id", profile.id)
          .gte("due_on", range.firstDay)
          .lte("due_on", range.lastDay)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const loadFailed =
    monthResult.error || upcomingResult.error || taskResult.error;
  const monthSessions = (monthResult.data ?? []) as unknown as SessionRow[];
  const upcoming = (upcomingResult.data ?? []) as unknown as SessionRow[];
  const tasks = (taskResult.data ?? []) as unknown as {
    id: string;
    due_on: string;
    completed_at: string | null;
    task: { title: string } | null;
  }[];

  const myResponse = (session: SessionRow) =>
    session.session_invites.find((invite) => invite.member_id === profile.id)
      ?.response ?? "pending";

  const items: CalendarItem[] = [
    ...monthSessions.map((session) => ({
      kind: "session" as const,
      id: session.id,
      title: session.title,
      starts_at: session.starts_at,
      ends_at: session.ends_at,
      note: isMember
        ? t.responses[myResponse(session)]
        : t.going(goingCount(session), session.session_invites.length),
    })),
    ...tasks.map((row) => ({
      kind: "task" as const,
      id: row.id,
      title: row.task?.title ?? t.task,
      due_on: row.due_on,
      done: row.completed_at !== null,
    })),
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-5xl">{t.title}</h1>
          <p className="mt-2 max-w-xl text-muted">
            {isCoach ? t.introCoach : isMember ? t.introMember : t.introOther}
          </p>
        </div>
        {isCoach && (
          <div className="flex flex-wrap gap-2">
            <Link href="/calendar/intros" className="btn-secondary">
              {t.introTimes}
            </Link>
            <Link href="/calendar/new" className="btn-primary">
              {t.schedule}
            </Link>
          </div>
        )}
      </div>

      {loadFailed ? (
        <p role="alert" className="text-danger">
          {t.loadError}
        </p>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-2xl">{t.comingUp}</h2>
            {upcoming.length === 0 ? (
              <p className="rounded-lg border border-border bg-surface p-4 text-muted">
                {isMember ? t.noSessionsMember : t.noSessions}
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
                {upcoming.map((session) => (
                  <li
                    key={session.id}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/calendar/${session.id}`}
                        className="text-link font-semibold"
                      >
                        {session.title}
                      </Link>
                      <p className="mt-1 text-sm text-muted">
                        <SessionTime
                          startsAt={session.starts_at}
                          endsAt={session.ends_at}
                        />
                        {[
                          !isCoach && session.coach?.display_name,
                          session.location,
                          !isMember &&
                            t.going(
                              goingCount(session),
                              session.session_invites.length,
                            ),
                        ]
                          .filter(Boolean)
                          .map((part) => ` · ${part}`)
                          .join("")}
                      </p>
                    </div>
                    {isMember && (
                      <ResponseButtons
                        sessionId={session.id}
                        response={myResponse(session)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl">{monthTitle(month, locale)}</h2>
              <nav className="flex gap-2 text-sm" aria-label={t.changeMonth}>
                <Link
                  href={`/calendar?month=${monthParam(shiftMonth(month, -1))}`}
                  className="btn-secondary px-3 py-2 text-sm"
                >
                  {t.previous}
                </Link>
                <Link
                  href="/calendar"
                  className="btn-secondary px-3 py-2 text-sm"
                >
                  {t.today}
                </Link>
                <Link
                  href={`/calendar?month=${monthParam(shiftMonth(month, 1))}`}
                  className="btn-secondary px-3 py-2 text-sm"
                >
                  {t.next}
                </Link>
              </nav>
            </div>
            <CalendarMonth month={month} items={items} />
          </section>
        </>
      )}
    </div>
  );
}
