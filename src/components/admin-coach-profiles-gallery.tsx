"use client";

import Link from "next/link";
import { useState } from "react";

const styles = {
  backLink: "backLink",
  badge: "badge",
  badgeDot: "badgeDot",
  card: "card",
  cardAction: "cardAction",
  cardBody: "cardBody",
  cardImage: "cardImage",
  cardLink: "cardLink",
  cardScrim: "cardScrim",
  cardSlot: "cardSlot",
  cardTitle: "cardTitle",
  chip: "chip",
  chips: "chips",
  completion: "completion",
  completionLabel: "completionLabel",
  emptyMark: "emptyMark",
  emptyState: "emptyState",
  eyebrow: "eyebrow",
  featured: "featured",
  featuredAction: "featuredAction",
  featuredContent: "featuredContent",
  featuredEyebrow: "featuredEyebrow",
  featuredHeadline: "featuredHeadline",
  featuredScrim: "featuredScrim",
  featuredStatus: "featuredStatus",
  intro: "intro",
  liveBadge: "liveBadge",
  metaLine: "metaLine",
  meter: "meter",
  page: "page",
  pageHeading: "pageHeading",
  percent: "percent",
  photo: "photo",
  photoFallback: "photoFallback",
  photoImage: "photoImage",
  rail: "rail",
  railCount: "railCount",
  railHeading: "railHeading",
  rails: "rails",
  reviewBadge: "reviewBadge",
  reviewNote: "reviewNote",
  stat: "stat",
  stats: "stats",
  statusLine: "statusLine",
  statValue: "statValue",
  track: "track",
};

export type CoachGalleryItem = {
  id: string;
  name: string;
  status: string;
  publishedAt: string | null;
  submittedAt: string | null;
  updatedAt: string;
  photoUrl: string | null;
  headline: string;
  specialties: string[];
  location: string;
  formats: ("online" | "in_person")[];
  completion: number;
};

const profileUrl = (id: string) => `/admin/coach-profiles/${id}`;

function statusText(coach: CoachGalleryItem) {
  const isLive = Boolean(coach.publishedAt);
  if (coach.status === "submitted") {
    return isLive
      ? "Review submitted · live version remains published"
      : "Submitted for review";
  }
  if (coach.status === "changes_requested") {
    return isLive
      ? "Changes requested · live version remains published"
      : "Changes requested";
  }
  if (isLive && coach.status === "draft") {
    return "Draft in progress · live version remains published";
  }
  if (isLive) return coach.status === "approved" ? "Approved · Live" : "Live";
  if (coach.status === "approved") return "Approved · not yet live";
  if (coach.status === "draft") return "In progress";
  return coach.status;
}

function badgeText(coach: CoachGalleryItem) {
  if (coach.status === "submitted") return "Ready for review";
  if (coach.status === "changes_requested") return "Changes requested";
  if (coach.publishedAt) return "Live";
  if (coach.status === "approved") return "Approved · not live";
  return "In progress";
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function CoachPhoto({
  coach,
  featured = false,
}: {
  coach: CoachGalleryItem;
  featured?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const showPhoto = coach.photoUrl && !failed;

  return (
    <div
      className={styles.photo}
      aria-hidden="true"
    >
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived, access-checked coach photo URL
        <img
          src={coach.photoUrl ?? undefined}
          alt=""
          loading={featured ? "eager" : "lazy"}
          ref={(image) => {
            if (image?.complete && image.naturalWidth === 0) setFailed(true);
          }}
          onError={() => setFailed(true)}
          className={styles.photoImage}
        />
      ) : (
        <div className={styles.photoFallback}>
          <span>{initials(coach.name) || "G"}</span>
        </div>
      )}
    </div>
  );
}

function Completion({ percent }: { percent: number }) {
  return (
    <div className={styles.completion}>
      <div className={styles.completionLabel}>
        <span>Profile complete</span>
        <span className={styles.percent}>{percent}%</span>
      </div>
      <div
        className={styles.meter}
        role="progressbar"
        aria-label="Profile completion"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function CoachCard({ coach }: { coach: CoachGalleryItem }) {
  const isSubmitted = coach.status === "submitted";
  const isLive = Boolean(coach.publishedAt);
  const specialties = coach.specialties.slice(0, 2);

  return (
    <li className={styles.cardSlot}>
      <article className={styles.card}>
        <Link
          href={profileUrl(coach.id)}
          className={styles.cardLink}
          aria-label={`${isSubmitted ? "Review" : "View"} ${coach.name}'s profile`}
        >
          <div className={styles.cardImage}>
            <CoachPhoto coach={coach} />
            <span
              className={`${styles.badge} ${isSubmitted ? styles.reviewBadge : isLive ? styles.liveBadge : ""}`}
            >
              <span className={styles.badgeDot} />
              {badgeText(coach)}
            </span>
            <div className={styles.cardScrim} />
            <div className={styles.cardTitle}>
              <h3>{coach.name}</h3>
              {coach.headline && <p>{coach.headline}</p>}
            </div>
          </div>
          <div className={styles.cardBody}>
            <p className={styles.statusLine}>{statusText(coach)}</p>
            <div className={styles.metaLine}>
              {coach.location && <span>{coach.location}</span>}
              {coach.formats.length > 0 && (
                <span>
                  {coach.formats
                    .map((format) => (format === "online" ? "Online" : "In person"))
                    .join(" · ")}
                </span>
              )}
            </div>
            {specialties.length > 0 && (
              <div className={styles.chips} aria-label="Specialties">
                {specialties.map((specialty) => (
                  <span className={styles.chip} key={specialty}>
                    {specialty}
                  </span>
                ))}
              </div>
            )}
            <Completion percent={coach.completion} />
            <span className={styles.cardAction}>
              {isSubmitted ? "Review profile" : "View profile"}
              <span aria-hidden="true">→</span>
            </span>
          </div>
        </Link>
      </article>
    </li>
  );
}

function Rail({
  title,
  note,
  coaches,
  id,
}: {
  title: string;
  note: string;
  coaches: CoachGalleryItem[];
  id: string;
}) {
  if (!coaches.length) return null;

  return (
    <section className={styles.rail} aria-labelledby={id}>
      <div className={styles.railHeading}>
        <div>
          <h2 id={id}>{title}</h2>
          <p>{note}</p>
        </div>
        <span className={styles.railCount} aria-label={`${coaches.length} coaches`}>
          {coaches.length}
        </span>
      </div>
      <ul className={styles.track}>
        {coaches.map((coach) => (
          <CoachCard key={coach.id} coach={coach} />
        ))}
      </ul>
    </section>
  );
}

export function CoachProfilesGallery({
  coaches = [],
  loadError = false,
}: {
  coaches?: CoachGalleryItem[];
  loadError?: boolean;
}) {
  const review = coaches.filter((coach) => coach.status === "submitted");
  const live = coaches.filter(
    (coach) => coach.status !== "submitted" && Boolean(coach.publishedAt),
  );
  const inProgress = coaches.filter(
    (coach) => coach.status !== "submitted" && !coach.publishedAt,
  );
  const featured = review[0] ?? live[0] ?? inProgress[0];
  const publishedCount = coaches.filter((coach) => coach.publishedAt).length;

  return (
    <div className="coach-profiles-gallery">
      <div className={styles.page}>
      <Link href="/admin" className={styles.backLink}>
        <span aria-hidden="true">←</span> Back to Admin
      </Link>
      <header className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>GYMX2 · ADMIN CONSOLE</p>
          <h1>Coach profiles</h1>
          <p className={styles.intro}>
            Review submissions and keep the live coach roster up to date.
          </p>
        </div>
        {!loadError && coaches.length > 0 && (
          <div className={styles.stats} aria-label="Coach profile counts">
            <div className={styles.stat}>
              <span className={styles.statValue}>{coaches.length}</span>
              <span>Profiles</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{review.length}</span>
              <span>In review</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{publishedCount}</span>
              <span>Live</span>
            </div>
          </div>
        )}
      </header>

      {loadError ? (
        <div className={styles.emptyState} role="alert">
          <span className={styles.emptyMark} aria-hidden="true">
            !
          </span>
          <h2>Coach profiles are unavailable</h2>
          <p>We couldn’t load the current roster. Refresh the page to try again.</p>
        </div>
      ) : coaches.length === 0 ? (
        <div className={styles.emptyState}>
          <span className={styles.emptyMark} aria-hidden="true">
            G
          </span>
          <h2>The roster is ready for its first profile</h2>
          <p>No coach has started a profile yet.</p>
        </div>
      ) : (
        <>
          {featured && (
            <section className={styles.featured} aria-label="Featured coach profile">
              <CoachPhoto coach={featured} featured />
              <div className={styles.featuredScrim} />
              <div className={styles.featuredContent}>
                <span
                  className={`${styles.badge} ${featured.status === "submitted" ? styles.reviewBadge : featured.publishedAt ? styles.liveBadge : ""}`}
                >
                  <span className={styles.badgeDot} />
                  {badgeText(featured)}
                </span>
                <p className={styles.featuredEyebrow}>COACH PROFILE</p>
                <h2>{featured.name}</h2>
                {featured.headline && (
                  <p className={styles.featuredHeadline}>{featured.headline}</p>
                )}
                <p className={styles.featuredStatus}>{statusText(featured)}</p>
                <Completion percent={featured.completion} />
                <Link href={profileUrl(featured.id)} className={styles.featuredAction}>
                  {featured.status === "submitted" ? "Review profile" : "View profile"}
                  <span aria-hidden="true">→</span>
                </Link>
              </div>
            </section>
          )}

          <div className={styles.rails}>
            <Rail
              id="ready-for-review"
              title="Ready for review"
              note="New submissions awaiting your review"
              coaches={review}
            />
            <Rail
              id="live-roster"
              title="Live roster"
              note="Published profiles visible to members"
              coaches={live}
            />
            <Rail
              id="in-progress"
              title="In progress"
              note="Profiles still being prepared or awaiting publication"
              coaches={inProgress}
            />
          </div>

          <p className={styles.reviewNote}>
            Approving publishes exactly what you reviewed. Later edits wait for another
            review.
          </p>
        </>
      )}
      </div>
    </div>
  );
}
