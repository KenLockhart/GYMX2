import Link from "next/link";
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ClipboardPlus,
  Dumbbell,
  MessageCircle,
  Video,
} from "lucide-react";
import { SessionTime } from "@/components/calendar-parts";
import { LocalDateTime } from "@/components/coach-profile/profile-client";
import type { Messages } from "@/i18n/messages";
import type { Profile } from "@/lib/types";
import type {
  CoachDashboardActivity,
  CoachDashboardSession,
} from "@/lib/coach-dashboard-data";
import { CoachDashboardPhoto } from "./coach-dashboard-photo";
import styles from "./coach-dashboard.module.css";

type DashboardCopy = Messages["dashboard"];

function ActionCard({
  href,
  label,
  icon: Icon,
  primary,
}: {
  href: string;
  label: string;
  icon: typeof ClipboardPlus;
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

function SessionRow({
  session,
}: {
  session: CoachDashboardSession;
}) {
  return (
    <li>
      <Link className={styles.listLink} href={`/calendar/${session.id}`}>
        <CalendarDays size={17} className={styles.listIcon} aria-hidden="true" />
        <span className={styles.listMain}>
          <span className={styles.listTitle}>{session.title}</span>
          <span className={styles.listMeta}>
            <SessionTime startsAt={session.starts_at} endsAt={session.ends_at} />
            {session.location && <> · {session.location}</>}
          </span>
        </span>
        <ArrowUpRight size={14} className="text-muted" aria-hidden="true" />
      </Link>
    </li>
  );
}

function ActivityRow({
  item,
  copy,
}: {
  item: CoachDashboardActivity;
  copy: DashboardCopy;
}) {
  const isCheckin = item.kind === "checkin";
  const Icon = isCheckin ? CheckCircle2 : MessageCircle;
  return (
    <li>
      <Link className={`${styles.listLink} ${styles.activityLink}`} href={isCheckin ? "/checkins" : `/messages/${item.memberId}`}>
        <Icon size={17} className={styles.listIcon} aria-hidden="true" />
        <span className={styles.listMain}>
          <span className={styles.listTitle}>{item.memberName}</span>
          <span className={styles.listMeta}>
            {isCheckin ? copy.activityCheckin : copy.activityMessage}
          </span>
          <span className={styles.listDate}>
            <LocalDateTime iso={item.createdAt} />
          </span>
        </span>
      </Link>
    </li>
  );
}

export function CoachDashboard({
  profile,
  photoUrl,
  sessions,
  sessionsError,
  activity,
  activityError,
  goals,
  copy,
  roleLabel,
}: {
  profile: Profile;
  photoUrl: string | null;
  sessions: CoachDashboardSession[];
  sessionsError: boolean;
  activity: CoachDashboardActivity[];
  activityError: boolean;
  goals: Record<string, string>;
  copy: DashboardCopy;
  roleLabel: string;
}) {
  const specialties = profile.specialties.map((specialty) => goals[specialty] ?? specialty);

  return (
    <div className={styles.layout}>
      <aside className={styles.portraitCard} aria-label={copy.coachProfile}>
        <CoachDashboardPhoto
          photoUrl={photoUrl}
          photoAlt={copy.photoAlt(profile.display_name)}
          missingLabel={copy.photoMissing}
          addPhotoLabel={copy.addPhoto}
        />
        <div className={styles.portraitCaption}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
              {roleLabel}
            </p>
            <p className={`${styles.coachName} mt-1 font-display text-2xl font-bold leading-tight`}>
              {profile.display_name}
            </p>
          </div>
          {specialties.length > 0 && (
            <ul className={styles.specialties} aria-label={copy.specialties}>
              {specialties.map((specialty) => (
                <li className={styles.specialty} key={specialty}>
                  {specialty}
                </li>
              ))}
            </ul>
          )}
          <Link className={styles.link} href="/profile">
            {copy.editProfile} <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </aside>

      <div className={styles.rightColumn}>
        <header>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent">
            {roleLabel}
          </p>
          <h1 className={`${styles.welcomeTitle} mt-1 text-4xl leading-tight sm:text-5xl`}>
            {copy.coachWelcome(profile.display_name)}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            {copy.coachIntro}
          </p>
        </header>

        <section aria-labelledby="coach-quick-actions">
          <h2 id="coach-quick-actions" className={`${styles.panelTitle} normal-case`}>
            {copy.quickActions}
          </h2>
          <div className={`${styles.actions} mt-3`}>
            <ActionCard href="/tasks/new" label={copy.giveTask} icon={ClipboardPlus} primary />
            <ActionCard href="/library/upload" label={copy.uploadVideo} icon={Video} />
            <ActionCard href="/calendar/new" label={copy.scheduleSession} icon={CalendarDays} />
            <ActionCard href="/armory/new" label={copy.addToArmory} icon={Dumbbell} />
          </div>
        </section>

        <div className={styles.panels}>
          <section className={styles.panel} aria-labelledby="coach-upcoming-sessions">
            <div className={styles.panelHeader}>
              <h2 id="coach-upcoming-sessions" className={`${styles.panelTitle} normal-case`}>
                {copy.upcomingSessions}
              </h2>
              <Link className={styles.panelLink} href="/calendar">
                {copy.viewCalendar}
              </Link>
            </div>
            {sessionsError ? (
              <p className={styles.panelError} role="alert">{copy.dashboardLoadError}</p>
            ) : sessions.length === 0 ? (
              <p className={styles.empty}>{copy.noUpcomingSessions}</p>
            ) : (
              <ul className={styles.panelList}>
                {sessions.map((session) => (
                  <SessionRow key={session.id} session={session} />
                ))}
              </ul>
            )}
          </section>

          <section className={styles.panel} aria-labelledby="coach-member-activity">
            <div className={styles.panelHeader}>
              <h2 id="coach-member-activity" className={`${styles.panelTitle} normal-case`}>
                {copy.memberActivity}
              </h2>
              <Link className={styles.panelLink} href="/members">
                {copy.viewMembers}
              </Link>
            </div>
            {activity.length === 0 && !activityError ? (
              <p className={styles.empty}>{copy.noMemberActivity}</p>
            ) : (
              <ul className={styles.panelList}>
                {activity.map((item) => (
                  <ActivityRow key={item.id} item={item} copy={copy} />
                ))}
              </ul>
            )}
            {activityError && (
              <p className={styles.panelError} role="alert">{copy.dashboardLoadError}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
