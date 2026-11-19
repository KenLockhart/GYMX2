"use client";

import { useActionState } from "react";
import { assignMemberDailyFuelVideo, type DailyFuelAssignmentState } from "@/app/(app)/library/daily-fuel-actions";
import type { DailyFuelMemberOption } from "@/lib/member-daily-fuel-data";
import type { Messages } from "@/i18n/messages";

const initialState: DailyFuelAssignmentState = { status: "idle" };

export function DailyFuelAssignmentForm({
  videoId,
  members,
  error,
  copy,
}: {
  videoId: string;
  members: DailyFuelMemberOption[];
  error: boolean;
  copy: Messages["library"];
}) {
  const [state, formAction, pending] = useActionState(
    assignMemberDailyFuelVideo,
    initialState,
  );

  return (
    <section className="mt-8 max-w-2xl rounded-xl border border-border bg-surface p-5">
      <h2 className="text-2xl">{copy.dailyFuelAssignmentTitle}</h2>
      <p className="mt-1 text-sm text-muted">{copy.dailyFuelAssignmentHint}</p>
      {state.status === "assigned" && (
        <p className="mt-3 text-sm text-success" role="status">
          {copy.dailyFuelAssigned}
        </p>
      )}
      {state.status === "error" && (
        <p className="mt-3 text-sm text-danger" role="alert">
          {state.reason === "not_ready"
            ? copy.dailyFuelNotReady
            : copy.dailyFuelAssignmentError}
        </p>
      )}
      {error ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {copy.dailyFuelAssignmentError}
        </p>
      ) : members.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{copy.dailyFuelNoMembers}</p>
      ) : (
        <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="video_id" value={videoId} />
          <label className="min-w-[220px] flex-1 space-y-1.5">
            <span className="block text-sm font-semibold">{copy.dailyFuelMember}</span>
            <select
              className="field-input min-h-11"
              name="member_id"
              required
              defaultValue=""
              disabled={pending}
            >
              <option value="" disabled>{copy.dailyFuelChooseMember}</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>{member.name}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn-primary min-h-11" disabled={pending}>
            {pending ? copy.saving : copy.dailyFuelAssign}
          </button>
        </form>
      )}
    </section>
  );
}
