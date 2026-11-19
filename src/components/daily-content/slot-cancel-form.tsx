"use client";

import { useActionState } from "react";
import { cancelDailyContentSlot } from "@/app/(app)/daily-content/actions";
import type {
  DailyContentActionState,
} from "@/lib/daily-content";
import type { Messages } from "@/i18n/messages";

type Copy = Messages["library"]["dailyContent"];
const initialState: DailyContentActionState = { status: "idle" };

export function DailyContentSlotCancelForm({ slotId, copy }: { slotId: string; copy: Copy }) {
  const [state, formAction, pending] = useActionState(cancelDailyContentSlot, initialState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="slot_id" value={slotId} />
      <button type="submit" className="btn-secondary min-h-9 px-3 text-xs" disabled={pending}>
        {pending ? copy.cancelling : copy.cancelSlot}
      </button>
      {state.status === "cancelled" && <span role="status" className="text-xs text-success">{copy.cancelled}</span>}
      {state.status === "error" && <span role="alert" className="text-xs text-danger">{copy.errors[state.reason]}</span>}
    </form>
  );
}
