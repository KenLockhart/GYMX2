import "server-only";

import { randomUUID } from "node:crypto";
import type { Locale } from "@/i18n/config";
import { loadRecipient, sendEmail } from "@/lib/email";
import {
  memberIntakeReminderEmail,
  type MemberIntakeReminderInput,
} from "@/lib/member-intake-reminder-email";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/supabase/env";

type ReminderCandidate = {
  member_id: string;
  coach_id: string;
  coach_name: string;
  booking_id: string;
  session_id: string;
  starts_at: string;
  reminder_phase: "24h" | "2h";
};

export function memberIntakeReminderIdempotencyKey(candidate: ReminderCandidate) {
  return `member-intake-reminder:${candidate.reminder_phase}:${candidate.session_id}:${candidate.member_id}`;
}

export type IntakeReminderRunResult = {
  candidates: number;
  claimed: number;
  sent: number;
  failed: number;
};

async function sendCandidate(candidate: ReminderCandidate): Promise<"sent" | "failed" | "skipped"> {
  const db = createAdminClient();
  const recipient = await loadRecipient(candidate.member_id);
  if (!recipient?.wantsUpdates) return "skipped";

  const leaseToken = randomUUID();
  const { data: claimed, error: claimError } = await db.rpc(
    "claim_member_intake_reminder",
    {
      p_session_id: candidate.session_id,
      p_member_id: candidate.member_id,
      p_phase: candidate.reminder_phase,
      p_lease_token: leaseToken,
    },
  );
  if (claimError || claimed !== true) return "skipped";

  let success = false;
  try {
    const emailInput: MemberIntakeReminderInput = {
      siteUrl: getSiteUrl(),
      memberName: recipient.name,
      coachName: candidate.coach_name,
      coachId: candidate.coach_id,
      sessionId: candidate.session_id,
      startsAt: candidate.starts_at,
      phase: candidate.reminder_phase,
      locale: recipient.locale as Locale,
    };
    success = await sendEmail(
      recipient.email,
      memberIntakeReminderEmail(emailInput),
      { idempotencyKey: memberIntakeReminderIdempotencyKey(candidate) },
    );
  } catch {
    // Release the lease for retry without logging any booking or intake data.
    success = false;
  }

  const { data: completed, error: completeError } = await db.rpc(
    "complete_member_intake_reminder",
    {
      p_session_id: candidate.session_id,
      p_member_id: candidate.member_id,
      p_phase: candidate.reminder_phase,
      p_lease_token: leaseToken,
      p_success: success,
    },
  );
  if (completeError || completed !== true) return "failed";
  return success ? "sent" : "failed";
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (true) {
        const index = next++;
        if (index >= values.length) return;
        results[index] = await map(values[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export async function runMemberIntakeReminders(): Promise<IntakeReminderRunResult> {
  const { data, error } = await createAdminClient()
    .rpc("list_member_intake_reminder_candidates")
    .limit(1000);
  if (error) throw new Error("Unable to load intake reminder candidates.");

  const candidates = (data ?? []) as ReminderCandidate[];
  const results = await mapConcurrent(candidates, 4, async (candidate) => {
    try {
      return await sendCandidate(candidate);
    } catch {
      // Candidate data and health answers are never written to logs.
      return "failed" as const;
    }
  });
  return {
    candidates: candidates.length,
    claimed: results.filter((result) => result !== "skipped").length,
    sent: results.filter((result) => result === "sent").length,
    failed: results.filter((result) => result === "failed").length,
  };
}
