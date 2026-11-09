import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Message } from "@/lib/types";

// Photo links (valid for an hour) for messages, keyed by message id. Which attachments exist is
// read with the person's own permissions, so only their conversations (or, for admins, any
// conversation under review) come back; the server then signs the links.
export async function loadMessagePhotos(
  messageIds: string[],
): Promise<Record<string, string[]>> {
  if (messageIds.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("message_attachments")
    .select("message_id, path, created_at")
    .in("message_id", messageIds)
    .order("path");
  const rows = (data ?? []) as { message_id: string; path: string }[];
  if (rows.length === 0) return {};
  const { data: signed } = await createAdminClient()
    .storage.from("community-media")
    .createSignedUrls(
      rows.map((row) => row.path),
      60 * 60,
    );
  const urls = new Map(
    (signed ?? []).map((item) => [item.path, item.signedUrl]),
  );
  const photos: Record<string, string[]> = {};
  for (const row of rows) {
    const url = urls.get(row.path);
    if (url) (photos[row.message_id] ??= []).push(url);
  }
  return photos;
}

export async function attachPhotos<T extends Message>(messages: T[]) {
  const photos = await loadMessagePhotos(messages.map((m) => m.id));
  return messages.map((message) =>
    photos[message.id] ? { ...message, photos: photos[message.id] } : message,
  );
}
