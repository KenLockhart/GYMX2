"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireAccount } from "@/lib/auth";
import { notifyNewMessage } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";
import type { Message } from "@/lib/types";
import { idSchema, messageSchema } from "@/lib/validation";

export async function sendMessage(
  otherUserId: string,
  body: string,
): Promise<{ error?: string; message?: Message }> {
  await requireAccount();
  const parsed = messageSchema.safeParse({ other_user_id: otherUserId, body });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("send_message", {
    other_user_id: parsed.data.other_user_id,
    message_body: parsed.data.body,
  });
  if (error) {
    return {
      error: error.code === "P0001" ? `${error.message}.` : "We couldn't send that. Please try again.",
    };
  }

  const messageId = id as string;
  after(() => notifyNewMessage(messageId));

  const { data } = await supabase
    .from("messages")
    .select("id, coach_id, member_id, sender_id, body, read_at, created_at")
    .eq("id", messageId)
    .single<Message>();

  revalidatePath("/messages");
  return { message: data ?? undefined };
}

export async function markConversationRead(otherUserId: string) {
  await requireAccount();
  const id = idSchema.safeParse(otherUserId);
  if (!id.success) return;

  const supabase = await createClient();
  await supabase.rpc("mark_conversation_read", { other_user_id: id.data });
  revalidatePath("/", "layout");
}
