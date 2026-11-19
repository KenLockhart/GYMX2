import "./member-dashboard.css";
import Link from "next/link";
import {
  ArrowUpRight,
  CalendarDays,
  ClipboardCheck,
  Dumbbell,
  Flame,
  Search,
  Utensils,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { SessionTime } from "@/components/calendar-parts";
import { MemberDailyFuel } from "@/components/member-daily-fuel";
import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import { formatDate } from "@/lib/format";
import { dailyFuelStateKey } from "@/lib/daily-fuel";
import type { MemberDashboardData } from "@/lib/member-dashboard-data";
import type { MemberDailyFuelData } from "@/lib/member-daily-fuel-data";
import type { Progress } from "@/lib/achievements";
import type { Profile } from "@/lib/types";
import { MemberDashboardPhoto } from "./member-dashboard-photo";

type DashboardCopy = Messages["dashboard"];
type TaskCopy = Messages["tasks"];
type LibraryCopy = Messages["library"];

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
      className={`member-action ${primary ? "is-primary" : ""}`}
      data-action={href}
    >
      <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
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
  const percentage = Math.max(0, Math.min(100, Math.round(progress.level.progress * 100)));

  return (
    <Link href="/progress" className="progressCard">
      <div className="progressStat progressLevel">
        <p className="statLabel">{copy.level(progress.level.number)}</p>
        <p className="statValue">{levels[progress.level.name] ?? progress.level.name}</p>
        <div
          className="levelProgress"
          role="progressbar"
          aria-label={`${copy.level(progress.level.number)} XP`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentage}
        >
          <span style={{ width: `${percentage}%` }} />
        </div>
      </div>
      <div className="progressStat">
        <p className="statLabel">{copy.streak}</p>
        <p className="statValue streakValue">
          <Flame aria-hidden="true" size={22} strokeWidth={1.8} />
          {copy.days(progress.streak.current)}
        </p>
      </div>
      <div className="progressStat">
        <p className="statLabel">{copy.thisWeek}</p>
        <p className="statValue">
          {copy.challenges(finishedChallenges, progress.challenges.length)}
        </p>
        {progress.newKeys.length > 0 && (
          <span className="newBadges">{copy.newBadges(progress.newKeys.length)}</span>
        )}
      </div>
    </Link>
  );
}

export function MemberDashboard({
  profile,
  data,
  dailyFuel,
  progress,
  tasksCopy,
  libraryCopy,
  locale,
  copy,
  roleLabel,
  levels,
  weeklyCheckinDue,
  intakeBanner,
}: {
  profile: Profile;
  data: MemberDashboardData;
  dailyFuel: MemberDailyFuelData;
  progress: (Progress & { newKeys: string[] }) | null;
  tasksCopy: TaskCopy;
  libraryCopy: LibraryCopy;
  locale: Locale;
  copy: DashboardCopy;
  roleLabel: string;
  levels: Record<string, string>;
  weeklyCheckinDue: boolean;
  intakeBanner?: ReactNode;
}) {
  return (
    <div className="member-dashboard">
      <div className="member-dashboard-top">
        <aside className="portraitCard" aria-label={copy.memberProfile}>
          <MemberDashboardPhoto
            photoUrl={data.photoUrl}
            photoAlt={copy.photoAlt(profile.display_name)}
            missingLabel={copy.memberPhotoMissing}
          />
          <div className="portraitCaption">
            <p className="portraitRole">{roleLabel}</p>
            <p className="memberName">{profile.display_name}</p>
          </div>
        </aside>

        <div className="rightColumn">
          <header className="member-greeting">
            <p className="greeting-eyebrow">{roleLabel}</p>
            <h1 className="welcomeTitle">{copy.memberWelcome(profile.display_name)}</h1>
            <p className="greeting-subtitle">{copy.memberIntro}</p>
            {intakeBanner}
          </header>

          <section aria-labelledby="member-quick-actions">
            <h2 id="member-quick-actions" className="panelTitle">
              {copy.quickActions}
            </h2>
            <div className="actions">
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
            </div>
            {(data.coachSelection === "missing" || data.armoryPurchase === "missing") && (
              <div className="first-use-actions">
                {data.coachSelection === "missing" && (
                  <ActionCard href="/coaches" label={copy.findCoach} icon={Search} />
                )}
                {data.armoryPurchase === "missing" && (
                  <ActionCard href="/armory" label={copy.visitArmory} icon={Dumbbell} />
                )}
              </div>
            )}
          </section>

          {data.coachSelection === "error" && (
            <RefreshError message={copy.coachSelectionError} retry={copy.retryDashboard} />
          )}
          {data.armoryPurchase === "error" && (
            <RefreshError message={copy.purchaseHistoryError} retry={copy.retryDashboard} />
          )}

          {weeklyCheckinDue && (
            <Link href="/checkin" className="weekly-checkin">
              <span>
                <span className="weekly-checkin-title">{copy.checkinTitle}</span>
                <span className="weekly-checkin-copy">{copy.checkinBody}</span>
              </span>
              <span className="weekly-checkin-link">{copy.weeklyCheckinButton}</span>
            </Link>
          )}

          {profile.coach_requested && (
            <p className="coach-request-pending">{copy.coachRequestPending}</p>
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
                        <ArrowUpRight size={14} className="listArrow" aria-hidden="true" />
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

      <MemberDailyFuel
        key={dailyFuelStateKey(dailyFuel.day, dailyFuel.video?.id ?? null)}
        data={dailyFuel}
        copy={copy.dailyFuel}
        categories={libraryCopy.categories}
        libraryHref="/library"
      />
    </div>
  );
}
