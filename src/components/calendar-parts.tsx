"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { respondToSession } from "@/app/(app)/calendar/actions";
import {
  ActionForm,
  Field,
  FormStatus,
  SubmitButton,
} from "@/components/form-parts";
import {
  formatSessionTime,
  localDayKey,
  monthGrid,
  type MonthKey,
  type SessionResponse,
} from "@/lib/calendar";
import { useLocale, useT } from "@/i18n/client";
import { LOCALE_TAG, type Locale } from "@/i18n/config";
import type { ActionState } from "@/lib/types";

const subscribe = () => () => {};

// The server can't know the viewer's time zone, so it renders UTC and the browser redraws in local time.
function useTimeZone() {
  const isClient = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return isClient ? undefined : "UTC";
}

export function SessionTime({
  startsAt,
  endsAt,
}: {
  startsAt: string;
  endsAt: string;
}) {
  const timeZone = useTimeZone();
  const locale = useLocale();
  return (
    <time dateTime={startsAt}>
      {formatSessionTime(startsAt, endsAt, timeZone, locale)}
      {timeZone === "UTC" && " UTC"}
    </time>
  );
}

export type CalendarItem =
  | {
      kind: "session";
      id: string;
      title: string;
      starts_at: string;
      ends_at: string;
      note?: string;
    }
  | { kind: "task"; id: string; title: string; due_on: string; done: boolean };

function itemDay(item: CalendarItem, timeZone: string | undefined) {
  return item.kind === "task"
    ? item.due_on
    : localDayKey(item.starts_at, timeZone);
}

function itemTime(
  item: CalendarItem,
  timeZone: string | undefined,
  locale: Locale,
  due: string,
) {
  if (item.kind === "task") return due;
  return new Date(item.starts_at).toLocaleTimeString(LOCALE_TAG[locale], {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}

function ItemLink({
  item,
  timeZone,
}: {
  item: CalendarItem;
  timeZone: string | undefined;
}) {
  const locale = useLocale();
  const t = useT().calendar;
  const href = item.kind === "task" ? "/tasks" : `/calendar/${item.id}`;
  return (
    <Link
      href={href}
      className={`block truncate rounded px-1.5 py-0.5 text-xs hover:brightness-110 ${
        item.kind === "task"
          ? item.done
            ? "bg-surface-raised text-muted line-through"
            : "bg-surface-raised text-foreground"
          : "bg-accent text-accent-foreground"
      }`}
      title={item.title}
    >
      {itemTime(item, timeZone, locale, t.due)} {item.title}
    </Link>
  );
}

// Short weekday names, Sunday first, in the viewer's language. (Jan 4, 1970 was a Sunday.)
function weekdays(locale: Locale) {
  return Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(1970, 0, 4 + i)).toLocaleDateString(LOCALE_TAG[locale], {
      weekday: "short",
      timeZone: "UTC",
    }),
  );
}

export function CalendarMonth({
  month,
  items,
}: {
  month: MonthKey;
  items: CalendarItem[];
}) {
  const timeZone = useTimeZone();
  const locale = useLocale();
  const t = useT().calendar;
  const weeks = useMemo(() => monthGrid(month), [month]);
  const monthPrefix = `${month.year}-${String(month.month).padStart(2, "0")}`;
  const today = localDayKey(new Date().toISOString(), timeZone);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    const sorted = [...items].sort((a, b) => {
      const at = a.kind === "task" ? `${a.due_on}T00` : a.starts_at;
      const bt = b.kind === "task" ? `${b.due_on}T00` : b.starts_at;
      return at.localeCompare(bt);
    });
    for (const item of sorted) {
      const day = itemDay(item, timeZone);
      map.set(day, [...(map.get(day) ?? []), item]);
    }
    return map;
  }, [items, timeZone]);

  const daysThisMonth = [...byDay.keys()]
    .filter((day) => day.startsWith(monthPrefix))
    .sort();

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-7 border-b border-border bg-surface text-center text-xs font-semibold uppercase tracking-wide text-muted">
          {weekdays(locale).map((day) => (
            <div key={day} className="py-2">
              {day}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div
            key={week[0]}
            className="grid grid-cols-7 border-b border-border last:border-b-0"
          >
            {week.map((day) => {
              const dayItems = byDay.get(day) ?? [];
              const inMonth = day.startsWith(monthPrefix);
              return (
                <div
                  key={day}
                  className={`min-h-16 border-r border-border p-1 last:border-r-0 sm:min-h-24 ${
                    inMonth ? "bg-background" : "bg-surface/60 text-muted"
                  }`}
                >
                  <div
                    className={`mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs ${
                      day === today
                        ? "bg-accent font-bold text-accent-foreground"
                        : ""
                    }`}
                  >
                    {Number(day.slice(8))}
                  </div>
                  <div className="hidden space-y-1 sm:block">
                    {dayItems.slice(0, 3).map((item) => (
                      <ItemLink
                        key={`${item.kind}-${item.id}`}
                        item={item}
                        timeZone={timeZone}
                      />
                    ))}
                    {dayItems.length > 3 && (
                      <p className="px-1.5 text-xs text-muted">
                        {t.more(dayItems.length - 3)}
                      </p>
                    )}
                  </div>
                  {dayItems.length > 0 && (
                    <div className="flex gap-0.5 sm:hidden" aria-hidden="true">
                      {dayItems.slice(0, 4).map((item) => (
                        <span
                          key={`${item.kind}-${item.id}`}
                          className={`size-1.5 rounded-full ${item.kind === "task" ? "bg-muted" : "bg-accent"}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="text-2xl">{t.thisMonth}</h2>
        {daysThisMonth.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-muted">
            {t.nothingThisMonth}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {daysThisMonth.map((day) => (
              <li
                key={day}
                className="flex flex-col gap-2 p-4 sm:flex-row sm:gap-6"
              >
                <p className="w-28 shrink-0 text-sm font-semibold">
                  {new Date(`${day}T00:00:00Z`).toLocaleDateString(
                    LOCALE_TAG[locale],
                    {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    },
                  )}
                </p>
                <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
                  {(byDay.get(day) ?? []).map((item) => (
                    <li
                      key={`${item.kind}-${item.id}`}
                      className="flex flex-wrap gap-x-2"
                    >
                      <span className="w-20 shrink-0 text-muted">
                        {itemTime(item, timeZone, locale, t.due)}
                      </span>
                      <Link
                        href={
                          item.kind === "task"
                            ? "/tasks"
                            : `/calendar/${item.id}`
                        }
                        className={`text-link ${item.kind === "task" && item.done ? "line-through" : ""}`}
                      >
                        {item.kind === "task"
                          ? t.taskItem(item.title)
                          : item.title}
                      </Link>
                      {item.kind === "session" && item.note && (
                        <span className="text-muted">· {item.note}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function ResponseButtons({
  sessionId,
  response,
}: {
  sessionId: string;
  response: SessionResponse;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-start gap-2">
      {(["going", "not_going"] as const).map((choice) => (
        <ActionForm
          key={choice}
          action={respondToSession}
          className="space-y-1"
        >
          <input type="hidden" name="session_id" value={sessionId} />
          <input type="hidden" name="response" value={choice} />
          <SubmitButton
            pendingText={t.common.saving}
            className={`${response === choice ? "btn-primary" : "btn-secondary"} px-3 py-2 text-sm`}
          >
            {t.calendar.responses[choice]}
          </SubmitButton>
          <FormStatus />
        </ActionForm>
      ))}
    </div>
  );
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function localDateValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localTimeValue(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Turns the coach's local date and times into exact moments. An end time at or before the start
// means the session runs past midnight, so it ends the next day.
function toMoments(date: string, start: string, end: string) {
  if (!date || !start || !end) return { startsAt: "", endsAt: "" };
  const startsAt = new Date(`${date}T${start}`);
  const endsAt = new Date(`${date}T${end}`);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()))
    return { startsAt: "", endsAt: "" };
  if (endsAt <= startsAt) endsAt.setDate(endsAt.getDate() + 1);
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
}

export type SessionFormValues = {
  id: string;
  title: string;
  notes: string;
  location: string;
  meeting_url: string;
  starts_at: string | null;
  ends_at: string | null;
  member_ids: string[];
};

function SessionFields({
  members,
  initial,
}: {
  members: { id: string; display_name: string }[];
  initial: SessionFormValues;
}) {
  const f = useT().calendar.form;
  const [date, setDate] = useState(() => {
    if (initial.starts_at) return localDateValue(new Date(initial.starts_at));
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return localDateValue(tomorrow);
  });
  const [start, setStart] = useState(() =>
    initial.starts_at ? localTimeValue(new Date(initial.starts_at)) : "09:00",
  );
  const [end, setEnd] = useState(() =>
    initial.ends_at ? localTimeValue(new Date(initial.ends_at)) : "10:00",
  );
  const moments = toMoments(date, start, end);
  const overnight = moments.startsAt !== "" && end <= start;
  const zoneName = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <>
      <input type="hidden" name="id" value={initial.id} />
      <input type="hidden" name="starts_at" value={moments.startsAt} />
      <input type="hidden" name="ends_at" value={moments.endsAt} />
      <Field
        label={f.title}
        name="title"
        maxLength={120}
        required
        defaultValue={initial.title}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label={f.date}
          type="date"
          required
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <Field
          label={f.starts}
          type="time"
          required
          value={start}
          onChange={(event) => setStart(event.target.value)}
        />
        <Field
          label={f.ends}
          type="time"
          required
          value={end}
          onChange={(event) => setEnd(event.target.value)}
        />
      </div>
      <p className="text-xs text-muted">
        {f.zone(zoneName)}
        {overnight && f.overnight}
      </p>
      <Field
        label={f.location}
        name="location"
        maxLength={200}
        defaultValue={initial.location}
      />
      <Field
        label={f.videoLink}
        name="meeting_url"
        type="url"
        maxLength={500}
        placeholder="https://"
        defaultValue={initial.meeting_url}
      />
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{f.notes}</span>
        <textarea
          name="notes"
          rows={3}
          maxLength={2000}
          className="field-input"
          defaultValue={initial.notes}
        />
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{f.invite}</legend>
        {members.map((member) => (
          <label key={member.id} className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="member_ids"
              value={member.id}
              defaultChecked={initial.member_ids.includes(member.id)}
              className="size-4 accent-accent"
            />
            {member.display_name}
          </label>
        ))}
      </fieldset>
    </>
  );
}

export function SessionForm({
  action,
  members,
  initial,
  submitLabel,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  members: { id: string; display_name: string }[];
  initial: SessionFormValues;
  submitLabel: string;
}) {
  // The date and time fields need the browser's time zone, so the form is drawn in the browser.
  const timeZone = useTimeZone();
  const t = useT();
  if (timeZone === "UTC")
    return <p className="text-muted">{t.calendar.form.loading}</p>;

  return (
    <ActionForm action={action} className="max-w-xl space-y-5">
      <SessionFields members={members} initial={initial} />
      <FormStatus />
      <SubmitButton pendingText={t.common.saving} className="btn-primary">
        {submitLabel}
      </SubmitButton>
    </ActionForm>
  );
}
