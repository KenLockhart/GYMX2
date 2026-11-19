"use client";

import { useActionState } from "react";
import { publishDailyContentSlot } from "@/app/(app)/daily-content/actions";
import type {
  DailyContentActionState,
  DailyContentPortalItem,
} from "@/lib/daily-content";
import type { Messages } from "@/i18n/messages";

type Copy = Messages["library"]["dailyContent"];
const initialState: DailyContentActionState = { status: "idle" };

function oneYearFrom(today: string) {
  const parsed = new Date(`${today}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) return today;
  parsed.setUTCDate(parsed.getUTCDate() + 365);
  return parsed.toISOString().slice(0, 10);
}

export function DailyContentPublishForm({
  item,
  today,
  copy,
}: {
  item: DailyContentPortalItem;
  today: string;
  copy: Copy;
}) {
  const [state, formAction, pending] = useActionState(publishDailyContentSlot, initialState);
  const revision = item.latestRevision;

  if (!revision) {
    return <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted">{copy.noRevision}</p>;
  }

  return (
    <div className="rounded-xl border border-border bg-background/60 p-4">
      <h4 className="font-semibold">{copy.scheduleHeading}</h4>
      <p className="mt-1 text-xs leading-5 text-muted">{copy.scheduleHint}</p>
      <form action={formAction} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <input type="hidden" name="item_id" value={item.id} />
        <input type="hidden" name="revision_id" value={revision.id} />
        <label className="block min-w-44 flex-1 space-y-1.5">
          <span className="text-sm font-medium">{copy.scheduleDate}</span>
          <input
            className="field-input min-h-11"
            name="day"
            type="date"
            required
            defaultValue={today}
            min={today}
            max={oneYearFrom(today)}
            disabled={pending}
          />
        </label>
        <button type="submit" className="btn-primary min-h-11" disabled={pending}>
          {pending ? copy.publishing : copy.publish}
        </button>
      </form>
      {state.status === "published" && <p role="status" className="mt-3 text-sm text-success">{copy.published}</p>}
      {state.status === "error" && <p role="alert" className="mt-3 text-sm text-danger">{copy.errors[state.reason]}</p>}
    </div>
  );
}
