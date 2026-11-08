"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccount, requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";
import { idSchema, sessionResponseSchema, sessionSchema } from "@/lib/validation";

// Messages raised by the database for things the coach can fix are shown as they are.
function sessionError(error: { code?: string; message: string }) {
  if (error.code === "P0001") return `${error.message}.`;
  if (error.code === "P0002") return "We couldn't find that session.";
  return "We couldn't save that session. Please try again.";
}

export async function saveSession(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireCoach();

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
  if (sessionId) {
    const { error } = await supabase.rpc("update_session", { target_session_id: sessionId, ...fields });
    if (error) return { error: sessionError(error) };
  } else {
    const { data, error } = await supabase.rpc("create_session", fields);
    if (error) return { error: sessionError(error) };
    sessionId = data as string;
  }

  revalidatePath("/calendar");
  redirect(`/calendar/${sessionId}`);
}

export async function cancelSession(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireCoach();
  const sessionId = idSchema.safeParse(formData.get("session_id"));
  if (!sessionId.success) return { error: "Choose a session." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calendar_sessions")
    .delete()
    .eq("id", sessionId.data)
    .select("id");
  if (error) return { error: "We couldn't cancel that session. Please try again." };
  if (!data?.length) return { error: "We couldn't find that session." };

  revalidatePath("/calendar");
  redirect("/calendar");
}

export async function respondToSession(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireAccount();
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

  revalidatePath("/calendar");
  revalidatePath(`/calendar/${parsed.data.session_id}`);
  return { message: parsed.data.response === "going" ? "See you there." : "Thanks for letting your coach know." };
}
