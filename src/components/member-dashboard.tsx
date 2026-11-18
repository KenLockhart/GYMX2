import "./member-dashboard.css";
import Link from "next/link";
import {
  ArrowUpRight,
  CalendarDays,
  ClipboardCheck,
  Dumbbell,
  Search,
  Utensils,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SessionTime } from "@/components/calendar-parts";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import { formatDate } from "@/lib/format";
import type { MemberDashboardData } from "@/lib/member-dashboard-data";
import type { Progress } from "@/lib/achievements";
import type { Profile } from "@/lib/types";
import { MemberDashboardPhoto } from "./member-dashboard-photo";

type DashboardCopy = Messages["dashboard"];
type TaskCopy = Messages["tasks"];

function ActionCard({
  href,
  label,
  icon: Icon,
  primary,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`${primary ? "btn-primary" : "btn-secondary"} gap-2 px-3 py-2 text-sm`}
      data-action={href}
    >
      <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
      {label}
    </Link>
  );
}

function RefreshError({
  message,
  retry,
}: {
  message: string;
  retry: string;
}) {
  return (
    <p className="statusError" role="alert">
      {message} <Link href="/dashboard">{retry}</Link>
    </p>
  );
}

function ProgressCard({
  progress,
  copy,
  levels,
}: {
  progress: (Progress & { newKeys: string[] }) | null;
  copy: DashboardCopy;
  levels: Record<string, string>;
}) {
  if (!progress) return null;
  const finishedChallenges = progress.challenges.filter(
    (challenge) => challenge.done >= challenge.goal,
  ).length;

  return (
    <Link href="/progress" className="progressCard">
      <div>
        <p className="text-sm text-muted">{copy.level(progress.level.number)}</p>
        <p className="text-2xl font-bold uppercase">
          {levels[progress.level.name] ?? progress.level.name}
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-raised">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${Math.round(progress.level.progress * 100)}%` }}
          />
        </div>
      </div>
      <div>
        <p className="text-sm text-muted">{copy.streak}</p>
        <p className="text-2xl font-bold">
          <span aria-hidden="true">🔥</span> {copy.days(progress.streak.current)}
        </p>
      </div>
      <div>
        <p className="text-sm text-muted">{copy.thisWeek}</p>
        <p className="text-2xl font-bold">
          {copy.challenges(finishedChallenges, progress.challenges.length)}
        </p>
        {progress.newKeys.length > 0 && (
          <p className="text-sm font-semibold text-accent">
            {copy.newBadges(progress.newKeys.length)}
          </p>
        )}
      </div>
    </Link>
  );
}

export function MemberDashboard({
  profile,
  data,
  progress,
  tasksCopy,
  locale,
  copy,
  roleLabel,
  levels,
  weeklyCheckinDue,
}: {
  profile: Profile;
  data: MemberDashboardData;
  progress: (Progress & { newKeys: string[] }) | null;
  tasksCopy: TaskCopy;
  locale: Locale;
  copy: DashboardCopy;
  roleLabel: string;
  levels: Record<string, string>;
  weeklyCheckinDue: boolean;
}) {
  return (
    <div className="member-dashboard">
      <aside className="portraitCard" aria-label={copy.memberProfile}>
        <MemberDashboardPhoto
          photoUrl={data.photoUrl}
          photoAlt={copy.photoAlt(profile.display_name)}
          missingLabel={copy.memberPhotoMissing}
        />
        <div className="portraitCaption">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
              {roleLabel}
            </p>
            <p className="memberName mt-1 font-display text-2xl font-bold leading-tight">
              {profile.display_name}
            </p>
          </div>
        </div>
      </aside>

      <div className="rightColumn">
        <header>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent">
            {roleLabel}
          </p>
          <h1 className="welcomeTitle mt-1 text-4xl leading-tight sm:text-5xl">
            {copy.memberWelcome(profile.display_name)}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            {copy.memberIntro}
          </p>
        </header>

        <section aria-labelledby="member-quick-actions">
          <h2 id="member-quick-actions" className="panelTitle">
            {copy.quickActions}
          </h2>
          <div className="actions mt-3">
            <ActionCard
              href="/checkin/daily"
              label={copy.dailyCheckin}
              icon={ClipboardCheck}
              primary
            />
            <ActionCard
              href="/calendar/request"
              label={copy.requestSession}
              icon={CalendarDays}
            />
            <ActionCard
              href="/track#nutrition"
              label={copy.logNutrition}
              icon={Utensils}
            />
            {data.coachSelection === "missing" && (
              <ActionCard
                href="/coaches"
                label={copy.findCoach}
                icon={Search}
              />
            )}
            {data.armoryPurchase === "missing" && (
              <ActionCard
                href="/armory"
                label={copy.visitArmory}
                icon={Dumbbell}
              />
            )}
          </div>
        </section>

        {data.coachSelection === "error" && (
          <RefreshError message={copy.coachSelectionError} retry={copy.retryDashboard} />
        )}
        {data.armoryPurchase === "error" && (
          <RefreshError message={copy.purchaseHistoryError} retry={copy.retryDashboard} />
        )}

        {weeklyCheckinDue && (
          <Link
            href="/checkin"
            className="flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-lg border border-accent bg-surface p-5 transition hover:bg-surface-raised"
          >
            <span>
              <span className="block text-lg font-semibold">
                {copy.checkinTitle}
              </span>
              <span className="text-sm text-muted">{copy.checkinBody}</span>
            </span>
            <span className="btn-secondary">{copy.weeklyCheckinButton}</span>
          </Link>
        )}

        {profile.coach_requested && (
          <p className="rounded-lg border border-border bg-surface p-4 text-sm">
            {copy.coachRequestPending}
          </p>
        )}

        <ProgressCard progress={progress} copy={copy} levels={levels} />

        <div className="panels">
          <section className="panel" aria-labelledby="member-upcoming-sessions">
            <div className="panelHeader">
              <h2 id="member-upcoming-sessions" className="panelTitle">
                {copy.upcomingSessions}
              </h2>
              <Link className="panelLink" href="/calendar">
                {copy.viewCalendar}
              </Link>
            </div>
            {data.sessions.error ? (
              <p className="panelError" role="alert">
                {copy.sessionsLoadError} <Link href="/dashboard">{copy.retryDashboard}</Link>
              </p>
            ) : data.sessions.items.length === 0 ? (
              <p className="empty">{copy.noMemberSessions}</p>
            ) : (
              <ul className="panelList">
                {data.sessions.items.map((session) => (
                  <li key={session.id}>
                    <Link className="listLink" href={`/calendar/${session.id}`}>
                      <CalendarDays size={17} className="listIcon" aria-hidden="true" />
                      <span className="listMain">
                        <span className="listTitle">{session.title}</span>
                        <span className="listMeta">
                          <SessionTime startsAt={session.starts_at} endsAt={session.ends_at} />
                          {session.coach?.display_name && <> · {session.coach.display_name}</>}
                          {session.location && <> · {session.location}</>}
                        </span>
                      </span>
                      <ArrowUpRight size={14} className="text-muted" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel" aria-labelledby="member-tasks">
            <div className="panelHeader">
              <h2 id="member-tasks" className="panelTitle">
                {copy.tasks}
              </h2>
              <Link className="panelLink" href="/tasks">
                {copy.viewTasks}
              </Link>
            </div>
            {data.tasks.error ? (
              <p className="panelError" role="alert">
                {copy.tasksLoadError} <Link href="/dashboard">{copy.retryDashboard}</Link>
              </p>
            ) : data.tasks.items.length === 0 ? (
              <p className="empty">{copy.noMemberTasks}</p>
            ) : (
              <ul className="panelList">
                {data.tasks.items.map((task) => (
                  <li key={task.id}>
                    <div className="listLink">
                      <ClipboardCheck size={17} className="listIcon" aria-hidden="true" />
                      <span className="listMain">
                        <span className="listTitle">{task.title}</span>
                        {task.due_on && (
                          <span className="listMeta">
                            {tasksCopy.due(formatDate(task.due_on, locale))}
                          </span>
                        )}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
