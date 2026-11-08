"use server";

import { after } from "next/server";
import { z } from "zod";
import { syncProgressQuietly } from "@/lib/achievements-data";
import { requireAccount, requireCoach } from "@/lib/auth";
import { canGoLive, LIVE_CHAT_MAX } from "@/lib/live";
import { notifyLiveNow } from "@/lib/notify";
import {
  createLiveInput,
  getLiveIngestUrl,
  isStreamConfigured,
} from "@/lib/stream";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

export type LiveChatMessage = {
  id: string;
  session_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

// The coach's own session, read with their permissions so nobody else can open the room.
async function ownSession(sessionId: string) {
  const { profile } = await requireCoach();
  const id = idSchema.safeParse(sessionId);
  if (!id.success) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("calendar_sessions")
    .select("id, coach_id, title, starts_at, ends_at")
    .eq("id", id.data)
    .eq("coach_id", profile.id)
    .maybeSingle();
  return data;
}

// Step 1 of going live: hand the coach's browser the secret broadcast address.
export async function prepareBroadcast(
  sessionId: string,
): Promise<{ error?: string; ingestUrl?: string }> {
  const session = await ownSession(sessionId);
  if (!session) return { error: "We couldn't find that session." };
  if (!canGoLive(session))
    return {
      error:
        "You can go live from 30 minutes before the start until an hour after the end.",
    };
  if (!isStreamConfigured()) return { error: "Live video isn't set up yet." };

  const admin = createAdminClient();
  try {
    const { data: room } = await admin
      .from("session_live")
      .select("input_uid")
      .eq("session_id", session.id)
      .maybeSingle();
    let uid = room?.input_uid as string | undefined;
    if (!uid) {
      const input = await createLiveInput(
        `GYMX2 · ${session.title}`.slice(0, 120),
      );
      const { error } = await admin
        .from("session_live")
        .insert({
          session_id: session.id,
          input_uid: input.uid,
          playback_url: input.playbackUrl,
        });
      if (error) throw error;
      uid = input.uid;
    }
    return { ingestUrl: await getLiveIngestUrl(uid) };
  } catch (error) {
    console.error("Couldn't prepare a live room", error);
    return { error: "We couldn't open the live room. Please try again." };
  }
}

// Step 2: the browser is connected, so members can watch. Emails go out the first time only.
export async function markLive(sessionId: string): Promise<{ error?: string }> {
  const session = await ownSession(sessionId);
  if (!session) return { error: "We couldn't find that session." };
  const admin = createAdminClient();
  const { data: room } = await admin
    .from("session_live")
    .select("live_started_at")
    .eq("session_id", session.id)
    .maybeSingle();
  if (!room) return { error: "The live room isn't ready." };
  const firstTime = !room.live_started_at;
  await admin
    .from("session_live")
    .update({
      live_started_at: room.live_started_at ?? new Date().toISOString(),
      live_ended_at: null,
    })
    .eq("session_id", session.id);
  if (firstTime) after(() => notifyLiveNow(session.id));
  return {};
}

export async function endLive(sessionId: string): Promise<{ error?: string }> {
  const session = await ownSession(sessionId);
  if (!session) return { error: "We couldn't find that session." };
  await createAdminClient()
    .from("session_live")
    .update({ live_ended_at: new Date().toISOString() })
    .eq("session_id", session.id)
    .not("live_started_at", "is", null);
  return {};
}

// Members are counted as attending once the video starts playing.
export async function checkIn(sessionId: string): Promise<void> {
  const { profile } = await requireAccount();
  if (profile.role !== "member") return;
  const id = idSchema.safeParse(sessionId);
  if (!id.success) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from("session_attendance")
    .upsert(
      { session_id: id.data, member_id: profile.id },
      { onConflict: "session_id,member_id", ignoreDuplicates: true },
    );
  if (!error) after(() => syncProgressQuietly(profile));
}

const chatSchema = z.object({
  session_id: idSchema,
  body: z
    .string()
    .trim()
    .min(1, "Write something first")
    .max(LIVE_CHAT_MAX, `Keep it under ${LIVE_CHAT_MAX} characters`),
});

export async function postLiveChat(
  sessionId: string,
  body: string,
): Promise<{ error?: string; message?: LiveChatMessage }> {
  const { profile } = await requireAccount();
  const parsed = chatSchema.safeParse({ session_id: sessionId, body });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("live_chat_messages")
    .insert({
      session_id: parsed.data.session_id,
      sender_id: profile.id,
      body: parsed.data.body,
    })
    .select("id, session_id, sender_id, body, created_at")
    .single<LiveChatMessage>();
  if (error)
    return {
      error:
        error.code === "42501"
          ? "Chat opens when the session is live."
          : "We couldn't send that.",
    };
  return { message: data };
}

export async function deleteLiveChat(
  messageId: string,
): Promise<{ error?: string }> {
  await requireAccount();
  const id = idSchema.safeParse(messageId);
  if (!id.success) return { error: "That message wasn't found." };
  const supabase = await createClient();
  const { data } = await supabase
    .from("live_chat_messages")
    .delete()
    .eq("id", id.data)
    .select("id");
  return data?.length ? {} : { error: "You can't remove that message." };
}
