"use client";

import { Bookmark, Check, Heart, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { setMemberDailyAffirmation, setMemberDailyFuelBookmark } from "@/app/(app)/dashboard/fuel-actions";
import type { Messages } from "@/i18n/messages";
import type { MemberDailyFuelData } from "@/lib/member-daily-fuel-data";
import { quoteIndexForDay } from "@/lib/daily-fuel";
import { MemberDailyFuelPlayer } from "./member-daily-fuel-player";

type Copy = Messages["dashboard"]["dailyFuel"];

export function MemberDailyFuel({
  data,
  copy,
  categories,
  libraryHref,
}: {
  data: MemberDailyFuelData;
  copy: Copy;
  categories: Record<string, string>;
  libraryHref: string;
}) {
  const quotes = copy.quotes;
  const [quoteIndex, setQuoteIndex] = useState(() =>
    quoteIndexForDay(data.day, quotes.length),
  );
  const [affirmed, setAffirmed] = useState(data.affirmed);
  const [affirmationError, setAffirmationError] = useState(false);
  const [saved, setSaved] = useState(Boolean(data.video?.saved));
  const [bookmarkError, setBookmarkError] = useState(data.bookmarkError);
  const [pending, startTransition] = useTransition();
  const quote = quotes[quoteIndex] ?? quotes[0];

  function toggleAffirmation() {
    if (pending) return;
    const next = !affirmed;
    setAffirmationError(false);
    startTransition(async () => {
      const result = await setMemberDailyAffirmation(data.day, next);
      if (result.ok) setAffirmed(result.value);
      else setAffirmationError(true);
    });
  }

  function toggleSaved() {
    if (!data.video || pending) return;
    const next = !saved;
    setBookmarkError(false);
    startTransition(async () => {
      const result = await setMemberDailyFuelBookmark(data.video!.id, next);
      if (result.ok) setSaved(result.value);
      else setBookmarkError(true);
    });
  }

  return (
    <section className="member-daily-fuel" aria-labelledby="daily-fuel-heading">
      <div className="daily-fuel-section-heading">
        <h2 id="daily-fuel-heading">{copy.section}</h2>
        <span className="daily-fuel-divider" aria-hidden="true" />
        <p>{copy.tagline}</p>
      </div>

      <div className="daily-fuel-layout">
        <section className="daily-fuel-video-card" aria-labelledby="daily-fuel-video-heading">
          <div className="daily-fuel-card-heading">
            <h3 id="daily-fuel-video-heading">{copy.videoTitle}</h3>
            <Link href={libraryHref}>{copy.viewLibrary}</Link>
          </div>

          {data.videoError ? (
            <p className="daily-fuel-empty" role="alert">{copy.videoLoadError}</p>
          ) : data.video ? (
            <>
              <MemberDailyFuelPlayer
                key={data.video.id}
                title={data.video.title}
                playerUrl={data.video.playerUrl}
                thumbnailUrl={data.video.thumbnailUrl}
                totalDuration={data.video.durationSeconds}
                todayLabel={copy.today}
                playLabel={copy.playVideo}
                pauseLabel={copy.pauseVideo}
                loadingLabel={copy.loadingPlayer}
                unavailableLabel={copy.playerUnavailable}
                retryLabel={copy.retryPlayer}
              />
              <div className="daily-fuel-video-meta">
                <div className="daily-fuel-video-title">
                  <h4>{data.video.title}</h4>
                  <p>
                    {data.video.coachName && <>{data.video.coachName} · </>}
                    {categories[data.video.category] ?? data.video.category}
                  </p>
                </div>
                <button
                  type="button"
                  className={`daily-fuel-save ${saved ? "is-saved" : ""}`}
                  onClick={toggleSaved}
                  disabled={pending}
                  aria-pressed={saved}
                >
                  <Bookmark size={17} strokeWidth={1.8} aria-hidden="true" />
                  {saved ? copy.savedForLater : copy.saveForLater}
                </button>
              </div>
              {bookmarkError && <p className="daily-fuel-feedback" role="alert">{copy.saveFailed}</p>}
            </>
          ) : (
            <p className="daily-fuel-empty">{copy.noVideo}</p>
          )}
        </section>

        <div className="daily-fuel-side-column">
          <section className="daily-fuel-quote-card" aria-labelledby="daily-fuel-quote-heading">
            <div className="daily-fuel-card-heading">
              <h3 id="daily-fuel-quote-heading">{copy.quoteTitle}</h3>
              <button
                type="button"
                className="daily-fuel-icon-button"
                onClick={() => setQuoteIndex((current) => (current + 1) % quotes.length)}
                aria-label={copy.anotherQuote}
              >
                <RefreshCw size={18} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
            <span className="daily-fuel-quote-mark" aria-hidden="true">“</span>
            <blockquote>{quote.text}</blockquote>
            <p className="daily-fuel-attribution">— {quote.author}</p>
          </section>

          <section className="daily-fuel-affirmation-card" aria-labelledby="daily-fuel-affirmation-heading">
            <h3 id="daily-fuel-affirmation-heading">
              <Heart size={19} strokeWidth={2} aria-hidden="true" />
              {copy.affirmationTitle}
            </h3>
            <p>{copy.affirmationText}</p>
            <button
              type="button"
              className={`daily-fuel-affirmation-toggle ${affirmed ? "is-affirmed" : ""}`}
              onClick={toggleAffirmation}
              disabled={pending}
              aria-pressed={affirmed}
            >
              <Check size={17} strokeWidth={2} aria-hidden="true" />
              {affirmed ? copy.affirmationOn : copy.affirmationOff}
            </button>
            {affirmationError && <p className="daily-fuel-affirmation-error" role="alert">{copy.affirmationFailed}</p>}
          </section>
        </div>
      </div>
    </section>
  );
}
