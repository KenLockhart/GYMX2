"use server";

import { after } from "next/server";
import { z } from "zod";
import { syncProgressQuietly } from "@/lib/achievements-data";
import { requireAccount, requireCoach } from "@/lib/auth";
import { canGoLive, LIVE_CHAT_MAX } from "@/lib/live";
import { notifyLiveNow } from "@/lib/notify";
import {
  createLiveInput,
  deleteLiveInput,
  getLiveIngestUrl,
  isLiveStreamConfigured,
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
    .select("id, coach_id, title, starts_at, ends_at, live_mode")
    .eq("id", id.data)
    .eq("coach_id", profile.id)
    .maybeSingle();
  return data;
}

const GROUP_ROOM_CONFLICT =
  "A coaching circle is open or closing. End it before using the broadcast controls.";

async function hasActiveGroupRoom(
  admin: ReturnType<typeof createAdminClient>,
  sessionId: string,
) {
  const { data, error } = await admin
    .from("group_critique_rooms")
    .select("generation")
    .eq("session_id", sessionId)
    .in("state", ["provisioning", "open", "ending"])
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

// Step 1 of going live: hand the coach's browser the secret broadcast address.
export async function prepareBroadcast(
  sessionId: string,
): Promise<{ error?: string; ingestUrl?: string }> {
  const session = await ownSession(sessionId);
  if (!session) return { error: "We couldn't find that session." };
  if (session.live_mode === "one_on_one")
    return { error: "Use the private one-on-one live controls for this session." };
  if (!canGoLive(session))
    return {
      error:
        "You can go live from 30 minutes before the start until an hour after the end.",
    };
  if (!isLiveStreamConfigured()) return { error: "Live video isn't set up yet." };

  const admin = createAdminClient();
  try {
    if (await hasActiveGroupRoom(admin, session.id))
      return { error: GROUP_ROOM_CONFLICT };
    const { data: room, error: roomReadError } = await admin
      .from("session_live")
      .select("input_uid")
      .eq("session_id", session.id)
      .maybeSingle();
    if (roomReadError) throw roomReadError;
    let uid = room?.input_uid as string | undefined;
    if (!uid) {
      const input = await createLiveInput(
        `GYMX2 · ${session.title}`.slice(0, 120),
      );
      const { error } = await admin.from("session_live").insert({
        session_id: session.id,
        input_uid: input.uid,
        playback_url: input.playbackUrl,
      });
      if (error) {
        // Concurrent requests can both create provider inputs after seeing no row. A unique
        // conflict means this request's input was not stored, so delete that exact orphan and
        // reuse the winner's row. For any insert error, only delete this input after a reread
        // confirms it is not referenced; if the reread fails, preserve it for reconciliation.
        const { data: existing, error: readError } = await admin
          .from("session_live")
          .select("input_uid")
          .eq("session_id", session.id)
          .maybeSingle();
        if (existing?.input_uid === input.uid) {
          uid = input.uid;
        } else if (existing?.input_uid) {
          try {
            await deleteLiveInput(input.uid);
          } catch (cleanupError) {
            console.error("Couldn't remove an unused live input", cleanupError);
          }
          uid = existing.input_uid as string;
        } else {
          if (!readError) {
            try {
              await deleteLiveInput(input.uid);
            } catch (cleanupError) {
              console.error("Couldn't remove an unused live input", cleanupError);
            }
          } else {
            console.error("Couldn't verify whether the live input was stored", readError);
          }
          throw error;
        }
      } else {
        uid = input.uid;
      }
    }
    const ingestUrl = await getLiveIngestUrl(uid);
    // Session mode/ownership can change while Cloudflare is answering. Revalidate before
    // returning the ingest URL to the browser so group credentials never escape a private room.
    const currentSession = await ownSession(sessionId);
    if (
      !currentSession ||
      currentSession.live_mode === "one_on_one" ||
      !canGoLive(currentSession)
    )
      return { error: "We couldn't open the live room. Please try again." };
    if (await hasActiveGroupRoom(admin, session.id))
      return { error: GROUP_ROOM_CONFLICT };
    return { ingestUrl };
  } catch (error) {
    console.error("Couldn't prepare a live room", error);
    return { error: "We couldn't open the live room. Please try again." };
  }
}

// Step 2: the browser is connected, so members can watch. Emails go out the first time only.
export async function markLive(sessionId: string): Promise<{ error?: string }> {
  const session = await ownSession(sessionId);
  if (!session) return { error: "We couldn't find that session." };
  if (session.live_mode === "one_on_one")
    return { error: "Use the private one-on-one live controls for this session." };
  if (!canGoLive(session))
    return {
      error:
        "You can go live from 30 minutes before the start until an hour after the end.",
    };

  try {
    const admin = createAdminClient();
    if (await hasActiveGroupRoom(admin, session.id))
      return { error: GROUP_ROOM_CONFLICT };
    const { data: started, error: startError } = await admin
      .from("session_live")
      .update({ live_started_at: new Date().toISOString(), live_ended_at: null })
      .eq("session_id", session.id)
      .is("live_started_at", null)
      .select("session_id")
      .maybeSingle();
    if (startError) throw startError;

    // Only the request that atomically sets the first start time sends the notification.
    // Reconnects keep the original timestamp and simply clear the previous end time.
    if (!started) {
      const { data: restarted, error: restartError } = await admin
        .from("session_live")
        .update({ live_ended_at: null })
        .eq("session_id", session.id)
        .not("live_started_at", "is", null)
        .select("session_id")
        .maybeSingle();
      if (restartError) throw restartError;
      if (!restarted) return { error: "The live room isn't ready." };
    } else {
      after(() => notifyLiveNow(session.id));
    }
    return {};
  } catch (error) {
    console.error("Couldn't mark a live session as started", error);
    return {
      error: "We couldn't mark the session as live. Please try again.",
    };
  }
}

export async function endLive(sessionId: string): Promise<{ error?: string }> {
  const session = await ownSession(sessionId);
  if (!session) return { error: "We couldn't find that session." };
  if (session.live_mode === "one_on_one")
    return { error: "Use the private one-on-one live controls for this session." };
  try {
    const admin = createAdminClient();
    if (await hasActiveGroupRoom(admin, session.id))
      return { error: GROUP_ROOM_CONFLICT };
    const { data: ended, error } = await admin
      .from("session_live")
      .update({ live_ended_at: new Date().toISOString() })
      .eq("session_id", session.id)
      .not("live_started_at", "is", null)
      .select("session_id")
      .maybeSingle();
    if (error) throw error;
    if (ended) return {};

    // Ending a room that never started (or is already ended) is intentionally idempotent.
    // If the row still says live, however, a zero-row update must not be reported as success.
    const { data: room, error: readError } = await admin
      .from("session_live")
      .select("live_started_at, live_ended_at")
      .eq("session_id", session.id)
      .maybeSingle();
    if (readError) throw readError;
    if (room?.live_started_at && !room.live_ended_at)
      return { error: "We couldn't end the live session. Please try again." };
    return {};
  } catch (error) {
    console.error("Couldn't mark a live session as ended", error);
    return { error: "We couldn't end the live session. Please try again." };
  }
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
