"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireAccount, requireCoach } from "@/lib/auth";
import { syncProgressQuietly } from "@/lib/achievements-data";
import { planSessionEmails } from "@/lib/calendar";
import { notifySession, type SessionSnapshot } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";
import {
  idSchema,
  sessionResponseSchema,
  sessionSchema,
} from "@/lib/validation";

// Messages raised by the database for things the coach can fix are shown as they are.
function sessionError(error: { code?: string; message: string }) {
  if (error.code === "P0001") return `${error.message}.`;
  if (error.code === "P0002") return "We couldn't find that session.";
  return "We couldn't save that session. Please try again.";
}

const SESSION_COLUMNS =
  "id, coach_id, title, starts_at, ends_at, location, meeting_url";

// The session and who is invited, as the coach sees it right now.
async function loadSessionSnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sessionId: string,
) {
  const [{ data: session }, { data: invites }] = await Promise.all([
    supabase
      .from("calendar_sessions")
      .select(SESSION_COLUMNS)
      .eq("id", sessionId)
      .maybeSingle<SessionSnapshot>(),
    supabase
      .from("session_invites")
      .select("member_id")
      .eq("session_id", sessionId),
  ]);
  if (!session) return null;
  return {
    session,
    memberIds: (invites ?? []).map((row) => row.member_id as string),
  };
}

export async function saveSession(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await requireCoach();

  const parsed = sessionSchema.safeParse({
    id: formData.get("id") ?? "",
    title: formData.get("title"),
    notes: formData.get("notes") ?? "",
    location: formData.get("location") ?? "",
    meeting_url: formData.get("meeting_url") ?? "",
    starts_at: formData.get("starts_at"),
    ends_at: formData.get("ends_at"),
    member_ids: formData.getAll("member_ids"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const session = parsed.data;
  const fields = {
    session_title: session.title,
    session_notes: session.notes,
    session_location: session.location,
    session_meeting_url: session.meeting_url,
    session_starts_at: session.starts_at,
    session_ends_at: session.ends_at,
    target_member_ids: session.member_ids,
  };

  const supabase = await createClient();
  let sessionId = session.id;
  const before = sessionId
    ? await loadSessionSnapshot(supabase, sessionId)
    : null;
  if (sessionId) {
    const { error } = await supabase.rpc("update_session", {
      target_session_id: sessionId,
      ...fields,
    });
    if (error) return { error: sessionError(error) };
  } else {
    const { data, error } = await supabase.rpc("create_session", fields);
    if (error) return { error: sessionError(error) };
    sessionId = data as string;
  }

  const saved: SessionSnapshot = {
    id: sessionId,
    coach_id: before?.session.coach_id ?? profile.id,
    title: session.title,
    starts_at: session.starts_at,
    ends_at: session.ends_at,
    location: session.location,
    meeting_url: session.meeting_url || null,
  };
  const plan = planSessionEmails(
    before && { details: before.session, memberIds: before.memberIds },
    {
      details: saved,
      memberIds: session.member_ids,
    },
  );
  after(async () => {
    await notifySession("invited", saved, plan.invited);
    await notifySession("updated", saved, plan.updated);
    await syncProgressQuietly(profile);
  });

  revalidatePath("/calendar");
  redirect(`/calendar/${sessionId}`);
}

export async function cancelSession(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireCoach();
  const sessionId = idSchema.safeParse(formData.get("session_id"));
  if (!sessionId.success) return { error: "Choose a session." };

  const supabase = await createClient();
  // Read who was invited first: deleting the session removes its invites.
  const before = await loadSessionSnapshot(supabase, sessionId.data);
  const { data, error } = await supabase
    .from("calendar_sessions")
    .delete()
    .eq("id", sessionId.data)
    .select("id");
  if (error)
    return { error: "We couldn't cancel that session. Please try again." };
  if (!data?.length) return { error: "We couldn't find that session." };

  if (before && new Date(before.session.ends_at) > new Date()) {
    after(() => notifySession("cancelled", before.session, before.memberIds));
  }

  revalidatePath("/calendar");
  redirect("/calendar");
}

export async function respondToSession(
  _: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { profile } = await requireAccount();
  const parsed = sessionResponseSchema.safeParse({
    session_id: formData.get("session_id"),
    response: formData.get("response"),
  });
  if (!parsed.success) return { error: "Choose Going or Can't go." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_to_session", {
    target_session_id: parsed.data.session_id,
    new_response: parsed.data.response,
  });
  if (error) return { error: sessionError(error) };

  after(() => syncProgressQuietly(profile));
  revalidatePath("/calendar");
  revalidatePath(`/calendar/${parsed.data.session_id}`);
  return {
    message:
      parsed.data.response === "going"
        ? "See you there."
        : "Thanks for letting your coach know.",
  };
}
