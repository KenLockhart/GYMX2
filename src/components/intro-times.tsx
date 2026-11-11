"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import {
  addIntroSlots,
  cancelIntro,
  removeIntroSlot,
} from "@/app/(app)/calendar/intro-actions";
import {
  INTRO_FORMAT_LABEL,
  INTRO_MINUTES,
  repeatWeekly,
  slotsByDay,
} from "@/lib/intros";
import type { CoachIntroSlot } from "@/lib/intros-server";
import { LOCALE_TAG, type Locale } from "@/i18n/config";
import { T, useTr } from "@/i18n/t";

const subscribe = () => () => {};
// The server renders UTC; the browser redraws in the viewer's own time zone.
export function useLocalZone() {
  const client = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return client ? undefined : "UTC";
}

export function timeLabel(
  iso: string,
  timeZone?: string,
  locale: Locale = "en",
) {
  return new Date(iso).toLocaleTimeString(LOCALE_TAG[locale], {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}

function todayValue() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Every start time the form would add: back-to-back times from the first one, repeated weekly.
function plannedStarts(
  date: string,
  time: string,
  count: number,
  minutes: number,
  weeks: number,
) {
  if (!date || !time) return [];
  const first = new Date(`${date}T${time}`);
  if (Number.isNaN(first.getTime())) return [];
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(first);
    d.setMinutes(d.getMinutes() + i * minutes);
    return repeatWeekly(d, weeks);
  })
    .flat()
    .sort();
}

export function IntroTimes({ slots }: { slots: CoachIntroSlot[] }) {
  const tr = useTr();
  const router = useRouter();
  const zone = useLocalZone();
  const [date, setDate] = useState(todayValue);
  const [time, setTime] = useState("18:00");
  const [count, setCount] = useState(1);
  const [weeks, setWeeks] = useState(1);
  const [minutes, setMinutes] = useState(20);
  const [format, setFormat] = useState<"online" | "in_person">("online");
  const [location, setLocation] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [status, setStatus] = useState<{ error?: string; message?: string }>(
    {},
  );
  const [pending, start] = useTransition();

  const planned = useMemo(
    () => plannedStarts(date, time, count, minutes, weeks),
    [date, time, count, minutes, weeks],
  );
  const upcoming = slots.filter((s) => s.upcoming);
  const booked = upcoming.filter((s) => s.booking);
  const days = slotsByDay(
    upcoming.map((s) => ({
      id: s.id,
      startsAt: s.startsAt,
      minutes: s.minutes,
      format: s.format,
    })),
    zone,
  );
  const byId = new Map(slots.map((s) => [s.id, s]));

  function act(
    task: () => Promise<{ error?: string; added?: number }>,
    done?: (r: { added?: number }) => void,
  ) {
    setStatus({});
    start(async () => {
      const result = await task();
      if (result.error) return setStatus({ error: result.error });
      done?.(result);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
      <form
        className="space-y-4 rounded-2xl border border-border bg-surface p-5"
        onSubmit={(e) => {
          e.preventDefault();
          act(
            () =>
              addIntroSlots({
                starts: planned,
                minutes,
                format,
                location,
                meetingUrl,
              }),
            (r) =>
              setStatus({
                message:
                  r.added === 0
                    ? tr("Those times were already on your list.")
                    : r.added === 1
                      ? tr("Added 1 time.")
                      : tr("Added {added} times.", { added: r.added ?? 0 }),
              }),
          );
        }}
      >
        <h2 className="text-2xl">
          <T>Add intro times</T>
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-sm">
            <span className="font-medium">
              <T>Date</T>
            </span>
            <input
              type="date"
              value={date}
              min={todayValue()}
              onChange={(e) => setDate(e.target.value)}
              required
              className="field-input"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">
              <T>First start</T>
            </span>
            <input
              type="time"
              value={time}
              step={300}
              onChange={(e) => setTime(e.target.value)}
              required
              className="field-input"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">
              <T>Length</T>
            </span>
            <select
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="field-input"
            >
              {INTRO_MINUTES.map((m) => (
                <option key={m} value={m}>
                  <T vars={{ m }}>{"{m} minutes"}</T>
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">
              <T>Back to back</T>
            </span>
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="field-input"
            >
              {[1, 2, 3, 4, 6, 8].map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? tr("Just one") : `${n} in a row`}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 space-y-1 text-sm">
            <span className="font-medium">
              <T>Repeat</T>
            </span>
            <select
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
              className="field-input"
            >
              <option value={1}>
                <T>Don&apos;t repeat</T>
              </option>
              {[2, 4, 8, 12].map((n) => (
                <option key={n} value={n}>
                  Same time for {n} weeks
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            <T>How you&apos;ll meet</T>
          </legend>
          <div className="flex gap-2">
            {(["online", "in_person"] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={format === f}
                onClick={() => setFormat(f)}
                className={`flex-1 rounded-md border px-3 py-2 text-sm ${format === f ? "border-accent bg-accent/10 font-semibold text-accent" : "border-border text-muted"}`}
              >
                <T>{INTRO_FORMAT_LABEL[f]}</T>
              </button>
            ))}
          </div>
        </fieldset>
        {format === "online" ? (
          <label className="block space-y-1 text-sm">
            <span className="font-medium">
              <T>Video link (optional)</T>
            </span>
            <input
              type="url"
              value={meetingUrl}
              onChange={(e) => setMeetingUrl(e.target.value)}
              placeholder={tr("https://")}
              className="field-input"
            />
            <span className="block text-xs text-muted">
              <T>Shared only with the member who books.</T>
            </span>
          </label>
        ) : (
          <label className="block space-y-1 text-sm">
            <span className="font-medium">
              <T>Where</T>
            </span>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              maxLength={200}
              placeholder={tr("Gym name and address")}
              className="field-input"
            />
            <span className="block text-xs text-muted">
              <T>Shared only with the member who books.</T>
            </span>
          </label>
        )}
        {status.error && (
          <p role="alert" className="text-sm text-danger">
            {status.error}
          </p>
        )}
        {status.message && (
          <p role="status" className="text-sm text-success">
            {status.message}
          </p>
        )}
        <button
          type="submit"
          disabled={pending || planned.length === 0}
          className="btn-primary w-full"
        >
          {pending
            ? tr("Adding...")
            : planned.length === 1
              ? tr("Add 1 time")
              : tr("Add {length} times", { length: planned.length })}
        </button>
      </form>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
          <div className="rounded-2xl border border-border bg-surface p-4 text-center">
            <p className="font-display text-3xl font-bold">
              {upcoming.length - booked.length}
            </p>
            <p className="text-sm text-muted">
              <T>Open times</T>
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-4 text-center">
            <p className="font-display text-3xl font-bold text-accent">
              {booked.length}
            </p>
            <p className="text-sm text-muted">
              <T>Booked</T>
            </p>
          </div>
        </div>
        {days.length === 0 ? (
          <p className="rounded-2xl border border-border bg-surface p-6 text-muted">
            <T>
              No upcoming intro times. Add some and a &ldquo;Book intro
              session&rdquo; button appears on your profile.
            </T>
          </p>
        ) : (
          days.map((day) => (
            <section key={day.key} aria-label={day.label} className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted [font-family:var(--font-inter)]">
                <T>{day.label}</T>
              </h3>
              <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
                {day.slots.map(({ id }) => {
                  const slot = byId.get(id)!;
                  return (
                    <li
                      key={id}
                      className="flex flex-wrap items-start gap-3 p-4"
                    >
                      <div className="w-24 shrink-0">
                        <p className="font-semibold tabular-nums">
                          {timeLabel(slot.startsAt, zone)}
                        </p>
                        <p className="text-xs text-muted">
                          {slot.minutes} min ·{" "}
                          <T>{INTRO_FORMAT_LABEL[slot.format]}</T>
                        </p>
                      </div>
                      <div className="min-w-0 flex-1">
                        {slot.booking ? (
                          <>
                            <p>
                              <span className="mr-2 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-foreground">
                                <T>Booked</T>
                              </span>
                              <span className="font-semibold">
                                {slot.booking.memberName}
                              </span>
                            </p>
                            {slot.booking.message && (
                              <p className="mt-2 whitespace-pre-line border-l-2 border-accent/50 pl-3 text-sm text-muted">
                                {slot.booking.message}
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="text-sm text-muted">
                            Open{slot.location ? ` · ${slot.location}` : ""}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        {slot.booking?.sessionId && (
                          <Link
                            href={`/calendar/${slot.booking.sessionId}`}
                            className="btn-secondary px-3 py-1.5 text-sm"
                          >
                            <T>Open</T>
                          </Link>
                        )}
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            if (slot.booking) {
                              if (
                                !window.confirm(
                                  tr(
                                    "Cancel {name}'s intro? We'll let them know.",
                                    {
                                      name: slot.booking.memberName,
                                    },
                                  ),
                                )
                              )
                                return;
                              const bookingId = slot.booking.id;
                              act(() => cancelIntro(bookingId));
                            } else act(() => removeIntroSlot(slot.id));
                          }}
                          className="px-2 py-1.5 text-sm text-muted hover:text-danger"
                        >
                          {slot.booking ? tr("Cancel intro") : tr("Remove")}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
