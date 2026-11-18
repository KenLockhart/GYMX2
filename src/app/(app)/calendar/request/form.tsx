"use client";

import { useSyncExternalStore } from "react";
import { ActionForm, Field, FormStatus, SubmitButton } from "@/components/form-parts";
import type { Messages } from "@/i18n/messages";
import { localDayKey } from "@/lib/calendar";
import { sendSessionRequest } from "./actions";

const subscribe = () => () => {};
const localTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
const serverTimeZone = () => "America/New_York";

type RequestCopy = Pick<
  Messages["calendar"]["request"],
  | "coach"
  | "chooseCoach"
  | "day"
  | "time"
  | "timeZone"
  | "timeZoneHint"
  | "note"
  | "noteHint"
  | "submit"
  | "submitting"
>;

export function SessionRequestForm({
  coaches,
  copy,
}: {
  coaches: { id: string; display_name: string }[];
  copy: RequestCopy;
}) {
  const timeZone = useSyncExternalStore(
    subscribe,
    localTimeZone,
    serverTimeZone,
  );
  const minimumDate = localDayKey(new Date().toISOString(), timeZone);

  return (
    <ActionForm action={sendSessionRequest} className="max-w-2xl space-y-5">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{copy.coach}</span>
        <select name="coach_id" required defaultValue="" className="field-input">
          <option value="" disabled>
            {copy.chooseCoach}
          </option>
          {coaches.map((coach) => (
            <option key={coach.id} value={coach.id}>
              {coach.display_name}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={copy.day} name="day" type="date" min={minimumDate} required />
        <Field label={copy.time} name="time" type="time" step={900} required />
      </div>
      <div className="space-y-1.5">
        <span className="text-sm font-medium">{copy.timeZone}</span>
        <input type="hidden" name="time_zone" value={timeZone} />
        <p className="text-sm text-muted">
          {copy.timeZoneHint.replace("{zone}", timeZone.replaceAll("_", " "))}
        </p>
      </div>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{copy.note}</span>
        <textarea
          name="note"
          rows={4}
          maxLength={1000}
          className="field-input"
          aria-describedby="session-request-note-hint"
        />
        <span id="session-request-note-hint" className="block text-xs text-muted">
          {copy.noteHint}
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingText={copy.submitting} className="btn-primary">
          {copy.submit}
        </SubmitButton>
        <FormStatus />
      </div>
    </ActionForm>
  );
}
