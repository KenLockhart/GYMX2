"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { bookIntro, cancelIntro } from "@/app/(app)/calendar/intro-actions";
import { LocalDateTime } from "@/components/coach-profile/profile-client";
import { timeLabel, useLocalZone } from "@/components/intro-times";
import { INTRO_FORMAT_LABEL, type OpenSlot, slotsByDay } from "@/lib/intros";
import type { MemberIntro } from "@/lib/intros-server";

export function IntroBooking({
  coach,
  slots,
  existing,
  canBook,
}: {
  coach: { id: string; name: string; firstName: string };
  slots: OpenSlot[];
  existing: MemberIntro | null;
  canBook: boolean;
}) {
  const router = useRouter();
  const zone = useLocalZone();
  const days = slotsByDay(slots, zone);
  const [dayKey, setDayKey] = useState(days[0]?.key ?? "");
  const [slotId, setSlotId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const day = days.find((d) => d.key === dayKey) ?? days[0];
  const chosen = slots.find((s) => s.id === slotId) ?? null;

  if (existing) {
    const past = existing.past;
    return (
      <div className="space-y-4 rounded-2xl border border-accent/60 bg-surface p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">
          {past ? "Your intro" : "You're booked"}
        </p>
        <p className="font-display text-3xl font-bold uppercase leading-tight">
          <LocalDateTime iso={existing.startsAt} />
        </p>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Length</dt>
            <dd>{existing.minutes} minutes</dd>
          </div>
          <div>
            <dt className="text-muted">How</dt>
            <dd>{INTRO_FORMAT_LABEL[existing.format]}</dd>
          </div>
          {existing.location && (
            <div className="sm:col-span-2">
              <dt className="text-muted">Where</dt>
              <dd>{existing.location}</dd>
            </div>
          )}
          {existing.meetingUrl && (
            <div className="sm:col-span-2">
              <dt className="text-muted">Video link</dt>
              <dd>
                <a
                  href={existing.meetingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-link break-all"
                >
                  {existing.meetingUrl}
                </a>
              </dd>
            </div>
          )}
          {existing.message && (
            <div className="sm:col-span-2">
              <dt className="text-muted">Your message</dt>
              <dd className="whitespace-pre-line">{existing.message}</dd>
            </div>
          )}
        </dl>
        {past ? (
          <p className="text-sm text-muted">
            You&apos;ve had your free intro with {coach.firstName}. Ready to
            start?{" "}
            <Link href={`/coaches/${coach.id}`} className="text-link">
              See plans
            </Link>
          </p>
        ) : (
          <>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {existing.sessionId && (
                <Link
                  href={`/calendar/${existing.sessionId}`}
                  className="btn-primary"
                >
                  Open in your calendar
                </Link>
              )}
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (!window.confirm(`Cancel your intro with ${coach.name}?`))
                    return;
                  setError(null);
                  start(async () => {
                    const result = await cancelIntro(existing.id);
                    if (result.error) setError(result.error);
                    else router.refresh();
                  });
                }}
                className="btn-secondary"
              >
                {pending ? "Cancelling..." : "Cancel intro"}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  if (!slots.length)
    return (
      <p className="rounded-2xl border border-border bg-surface p-6 text-muted">
        {coach.firstName} has no open intro times right now. Save them from{" "}
        <Link href="/coaches" className="text-link">
          the coaches page
        </Link>{" "}
        and check back soon.
      </p>
    );

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!chosen) return setError("Pick a time first.");
        setError(null);
        start(async () => {
          const result = await bookIntro(chosen.id, message);
          if (result.error) {
            setError(result.error);
            setSlotId(null);
            router.refresh();
          } else router.refresh();
        });
      }}
    >
      <fieldset className="space-y-3">
        <legend className="text-lg font-semibold">1. Pick a day</legend>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {days.map((d) => (
            <button
              key={d.key}
              type="button"
              aria-pressed={d.key === day?.key}
              onClick={() => {
                setDayKey(d.key);
                setSlotId(null);
              }}
              className={`shrink-0 rounded-xl border px-4 py-2 text-sm ${d.key === day?.key ? "border-accent bg-accent font-semibold text-accent-foreground" : "border-border hover:border-accent/60"}`}
            >
              {d.label}
              <span className="block text-xs opacity-80">
                {d.slots.length} {d.slots.length === 1 ? "time" : "times"}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      {day && (
        <fieldset className="space-y-3">
          <legend className="text-lg font-semibold">2. Pick a time</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {day.slots.map((slot) => (
              <label
                key={slot.id}
                className={`cursor-pointer rounded-xl border px-3 py-2.5 text-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${slot.id === slotId ? "border-accent bg-accent/10" : "border-border hover:border-accent/60"}`}
              >
                <input
                  type="radio"
                  name="slot"
                  value={slot.id}
                  checked={slot.id === slotId}
                  onChange={() => setSlotId(slot.id)}
                  className="sr-only"
                />
                <span className="block font-semibold tabular-nums">
                  {timeLabel(slot.startsAt, zone)}
                </span>
                <span className="block text-xs text-muted">
                  {slot.minutes} min · {INTRO_FORMAT_LABEL[slot.format]}
                </span>
              </label>
            ))}
          </div>
          {zone === undefined && (
            <p className="text-xs text-muted">
              Times are in your time zone (
              {Intl.DateTimeFormat()
                .resolvedOptions()
                .timeZone.replace(/_/g, " ")}
              ).
            </p>
          )}
        </fieldset>
      )}

      <label className="block space-y-2">
        <span className="text-lg font-semibold">3. Say hello (optional)</span>
        <span className="block text-sm text-muted">
          One message for {coach.firstName}: your goal, your schedule, anything
          they should know. They&apos;ll see it with the booking.
        </span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          maxLength={1000}
          className="field-input"
          placeholder={`Hi ${coach.firstName}, I'd like to…`}
        />
        <span className="block text-right text-xs text-muted">
          {message.length}/1000
        </span>
      </label>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {canBook ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending || !chosen}
            className="btn-primary"
          >
            {pending
              ? "Booking..."
              : chosen
                ? `Book ${timeLabel(chosen.startsAt, zone)} on ${new Date(chosen.startsAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: zone })}`
                : "Pick a time to book"}
          </button>
          <p className="text-xs text-muted">
            Free. It doesn&apos;t start a membership.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted">
          Only members can book intros. This is how they see your times.
        </p>
      )}
    </form>
  );
}
