"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireAccount } from "@/lib/auth";
import { attachPhotos, loadMessagePhotos } from "@/lib/message-photos";
import { notifyNewMessage } from "@/lib/notify";
import { MAX_PHOTO_BYTES, PHOTO_TYPES } from "@/lib/community";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Message } from "@/lib/types";
import {
  idSchema,
  messageSchema,
  messageWithPhotosSchema,
} from "@/lib/validation";

const BUCKET = "community-media";
const MAX_MESSAGE_PHOTOS = 4;

const extensionOf = (name: string) =>
  name.split(".").pop()?.toLowerCase() ?? "";

// Step 1 for photos: one-time upload links into the sender's own folder. Nothing is sent yet.
export async function prepareMessagePhotos(
  files: { name: string; size: number }[],
): Promise<{ error?: string; uploads?: { path: string; token: string }[] }> {
  const { profile } = await requireAccount();
  if (profile.role === "admin") return { error: "Admins can't send messages." };
  if (!Array.isArray(files) || files.length === 0)
    return { error: "Choose a photo." };
  if (files.length > MAX_MESSAGE_PHOTOS)
    return { error: `Up to ${MAX_MESSAGE_PHOTOS} photos per message.` };
  for (const file of files) {
    if (!(extensionOf(file.name) in PHOTO_TYPES))
      return { error: "Use JPG, PNG or WebP photos." };
    if (!(file.size > 0) || file.size > MAX_PHOTO_BYTES)
      return { error: "Each photo can be up to 10 MB." };
  }
  const folder = `${profile.id}/msg-${randomUUID()}`;
  const storage = createAdminClient().storage.from(BUCKET);
  const uploads = [];
  for (const [index, file] of files.entries()) {
    const { data, error } = await storage.createSignedUploadUrl(
      `${folder}/${index}.${extensionOf(file.name)}`,
    );
    if (error || !data)
      return { error: "We couldn't start the upload. Please try again." };
    uploads.push({ path: data.path, token: data.token });
  }
  return { uploads };
}

const photoPathsSchema = z
  .array(z.string().max(300))
  .max(MAX_MESSAGE_PHOTOS, `Up to ${MAX_MESSAGE_PHOTOS} photos per message.`);

export async function sendMessage(
  otherUserId: string,
  body: string,
  photoPaths: string[] = [],
): Promise<{ error?: string; message?: Message }> {
  const { profile } = await requireAccount();
  const photos = photoPathsSchema.safeParse(photoPaths);
  if (!photos.success) return { error: photos.error.issues[0].message };
  const parsed = (
    photos.data.length ? messageWithPhotosSchema : messageSchema
  ).safeParse({ other_user_id: otherUserId, body });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  let result;
  if (photos.data.length) {
    // The photos must really be uploaded, all in one of the sender's own folders.
    const folder = photos.data[0].split("/").slice(0, 2).join("/");
    if (
      !folder.startsWith(`${profile.id}/msg-`) ||
      photos.data.some((path) => !path.startsWith(`${folder}/`))
    )
      return { error: "That photo upload didn't work. Please try again." };
    const { data: files } = await createAdminClient()
      .storage.from(BUCKET)
      .list(folder);
    const present = new Set(
      (files ?? []).map((file) => `${folder}/${file.name}`),
    );
    if (photos.data.some((path) => !present.has(path)))
      return { error: "A photo didn't finish uploading. Please try again." };
    result = await supabase.rpc("send_message_with_photos", {
      other_user_id: parsed.data.other_user_id,
      message_body: parsed.data.body,
      photo_paths: photos.data,
    });
  } else {
    result = await supabase.rpc("send_message", {
      other_user_id: parsed.data.other_user_id,
      message_body: parsed.data.body,
    });
  }
  const { data: id, error } = result;
  if (error) {
    return {
      error:
        error.code === "P0001"
          ? `${error.message}.`
          : "We couldn't send that. Please try again.",
    };
  }

  const messageId = id as string;
  after(() => notifyNewMessage(messageId));

  const { data } = await supabase
    .from("messages")
    .select("id, coach_id, member_id, sender_id, body, read_at, created_at")
    .eq("id", messageId)
    .single<Message>();
  const withPhotos = data ? (await attachPhotos([data]))[0] : undefined;

  revalidatePath("/messages");
  return { message: withPhotos };
}

// Photo links for messages that arrived live. Row security limits this to the viewer's
// conversations (and admins, who review messages for safety).
export async function messagePhotos(
  messageIds: string[],
): Promise<Record<string, string[]>> {
  await requireAccount();
  const ids = (Array.isArray(messageIds) ? messageIds : [])
    .slice(0, 50)
    .filter((id) => idSchema.safeParse(id).success);
  return loadMessagePhotos(ids);
}

export async function markConversationRead(otherUserId: string) {
  await requireAccount();
  const id = idSchema.safeParse(otherUserId);
  if (!id.success) return;

  const supabase = await createClient();
  await supabase.rpc("mark_conversation_read", { other_user_id: id.data });
  revalidatePath("/", "layout");
}
