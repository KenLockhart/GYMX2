"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  DOWNLOAD_TYPES,
  IMAGE_TYPES,
  MAX_DOWNLOAD_BYTES,
  MAX_IMAGE_BYTES,
  fileExtension,
  parsePrice,
  safeFileName,
} from "@/lib/armory";
import { requireCoachOrAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActionState, ArmoryItem } from "@/lib/types";
import { armoryItemSchema, idSchema, uploadRequestSchema } from "@/lib/validation";

// Gives the browser a one-time address to upload a file straight to storage, inside the owner's folder.
// Large ebooks never pass through the server this way.
export async function prepareArmoryUpload(input: {
  bucket: "armory-files" | "armory-images";
  file_name: string;
  size: number;
}): Promise<{ error?: string; path?: string; token?: string }> {
  const { profile } = await requireCoachOrAdmin();
  const parsed = uploadRequestSchema.safeParse(input);
  if (!parsed.success) return { error: "Choose a file to upload." };

  const isImage = parsed.data.bucket === "armory-images";
  const allowed = isImage ? IMAGE_TYPES : DOWNLOAD_TYPES;
  const limit = isImage ? MAX_IMAGE_BYTES : MAX_DOWNLOAD_BYTES;
  if (!(fileExtension(parsed.data.file_name) in allowed)) {
    return {
      error: isImage
        ? "Use a PNG, JPG or WebP image."
        : "Use a PDF, EPUB, ZIP, MP3, MP4, PNG or JPG file.",
    };
  }
  if (parsed.data.size > limit) {
    return { error: isImage ? "Images can be up to 5 MB." : "Files can be up to 50 MB." };
  }

  const path = `${profile.id}/${randomUUID().slice(0, 8)}-${safeFileName(parsed.data.file_name)}`;
  const { data, error } = await createAdminClient()
    .storage.from(parsed.data.bucket)
    .createSignedUploadUrl(path);
  if (error || !data) return { error: "We couldn't start the upload. Please try again." };
  return { path: data.path, token: data.token };
}

async function removeFiles(paths: { bucket: string; path: string | null }[]) {
  const admin = createAdminClient();
  for (const { bucket, path } of paths) {
    if (!path) continue;
    const { error } = await admin.storage.from(bucket).remove([path]);
    if (error) console.error(error);
  }
}

export async function saveArmoryItem(_: ActionState, formData: FormData): Promise<ActionState> {
  const { profile } = await requireCoachOrAdmin();
  const kind = formData.get("kind");
  const price_cents = kind === "download" ? null : parsePrice(String(formData.get("price") ?? ""));
  if (Number.isNaN(price_cents)) {
    return { error: kind === "paid" ? "Enter the price like 24.99." : "Enter the price like 24.99, or leave it blank." };
  }

  const parsed = armoryItemSchema.safeParse({
    kind,
    id: formData.get("id") ?? "",
    category: formData.get("category"),
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    price_cents,
    buy_url: formData.get("buy_url") ?? "",
    file_path: formData.get("file_path") ?? "",
    file_name: formData.get("file_name") ?? "",
    image_path: formData.get("image_path") ?? "",
    visible_to_all: formData.get("visible_to_all") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const item = parsed.data;

  // Uploads must sit in the owner's own folder. The database checks this too.
  const ownPath = (path: string | null) => !path || path.startsWith(`${profile.id}/`);
  if (!ownPath(item.image_path) || (item.kind !== "link" && !ownPath(item.file_path))) {
    return { error: "That upload didn't work. Please try again." };
  }

  const fields = {
    kind: item.kind,
    category: item.category,
    title: item.title,
    description: item.description,
    price_cents: item.kind === "download" ? null : item.price_cents,
    buy_url: item.kind === "link" ? item.buy_url : null,
    file_path: item.kind === "link" ? null : item.file_path,
    file_name: item.kind === "link" ? null : item.file_name,
    image_path: item.image_path,
    visible_to_all: item.visible_to_all,
  };

  const supabase = await createClient();
  let itemId = item.id;
  if (itemId) {
    const { data: before } = await supabase
      .from("armory_items")
      .select("file_path, image_path")
      .eq("id", itemId)
      .eq("coach_id", profile.id)
      .maybeSingle<Pick<ArmoryItem, "file_path" | "image_path">>();
    if (!before) return { error: "We couldn't find that item." };

    const { error } = await supabase.from("armory_items").update(fields).eq("id", itemId).eq("coach_id", profile.id);
    if (error) return { error: "We couldn't save that item. Please try again." };

    // Files that were replaced or removed are deleted, so storage doesn't fill with old copies.
    await removeFiles([
      { bucket: "armory-files", path: before.file_path !== fields.file_path ? before.file_path : null },
      { bucket: "armory-images", path: before.image_path !== fields.image_path ? before.image_path : null },
    ]);
  } else {
    const { data, error } = await supabase
      .from("armory_items")
      .insert({ coach_id: profile.id, ...fields })
      .select("id")
      .single();
    if (error || !data) return { error: "We couldn't save that item. Please try again." };
    itemId = data.id as string;
  }

  revalidatePath("/armory");
  redirect(`/armory/${itemId}`);
}

export async function removeArmoryItem(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireCoachOrAdmin();
  const itemId = idSchema.safeParse(formData.get("item_id"));
  if (!itemId.success) return { error: "Choose an item." };

  // Row security decides who may remove it: the owner or an admin.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("armory_items")
    .delete()
    .eq("id", itemId.data)
    .select("file_path, image_path");
  if (error) return { error: "We couldn't remove that item. Please try again." };
  const removed = (data ?? [])[0] as Pick<ArmoryItem, "file_path" | "image_path"> | undefined;
  if (!removed) return { error: "We couldn't find that item." };

  await removeFiles([
    { bucket: "armory-files", path: removed.file_path },
    { bucket: "armory-images", path: removed.image_path },
  ]);

  revalidatePath("/armory");
  redirect("/armory");
}
