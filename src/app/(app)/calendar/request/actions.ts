"use server";

import { redirect } from "next/navigation";
import { getLocale, getT } from "@/i18n/server";
import { LOCALE_TAG } from "@/i18n/config";
import { requireAccount } from "@/lib/auth";
import { localSessionRequestToIso, sessionRequestSchema } from "@/lib/session-request";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";
import { sendMessage } from "@/app/(app)/messages/actions";

export async function sendSessionRequest(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await requireAccount();
  const copy = (await getT()).calendar.request;
  if (profile.role !== "member") return { error: copy.memberOnly };

  const parsed = sessionRequestSchema.safeParse({
    coach_id: formData.get("coach_id"),
    day: formData.get("day"),
    time: formData.get("time"),
    time_zone: formData.get("time_zone"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { error: copy.invalid };

  const requestedAt = localSessionRequestToIso(
    parsed.data.day,
    parsed.data.time,
    parsed.data.time_zone,
  );
  if (!requestedAt) return { error: copy.invalidTime };

  const supabase = await createClient();
  const { data: connection, error: connectionError } = await supabase
    .from("coach_members")
    .select("coach_id")
    .eq("member_id", profile.id)
    .eq("coach_id", parsed.data.coach_id)
    .maybeSingle();
  if (connectionError) return { error: copy.lookupError };
  if (!connection) return { error: copy.coachUnavailable };

  const locale = await getLocale();
  const preferredTime = new Date(requestedAt).toLocaleString(LOCALE_TAG[locale], {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: parsed.data.time_zone,
  });
  const body = copy.messageBody(
    preferredTime,
    parsed.data.time_zone,
    parsed.data.note,
  );
  const result = await sendMessage(parsed.data.coach_id, body);
  if (result.error) return { error: result.error };

  const confirmation = result.message?.id
    ? `?session_request=sent&request_id=${encodeURIComponent(result.message.id)}`
    : "";
  redirect(`/messages/${parsed.data.coach_id}${confirmation}`);
}
