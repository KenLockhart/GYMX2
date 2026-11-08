import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const PHOTO_POSES = [
  { value: "front", label: "Front" },
  { value: "side", label: "Side" },
  { value: "back", label: "Back" },
  { value: "other", label: "Other" },
] as const;

export const PHOTO_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export type ProgressPhoto = { id: string; day: string; pose: string; url: string | null };

// The photos the signed-in person may see for this user (row security decides), each with a link
// that works for one hour.
export async function loadProgressPhotos(userId: string, limit = 60): Promise<ProgressPhoto[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("progress_photos")
    .select("id, day, pose, path")
    .eq("user_id", userId)
    .order("day", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as { id: string; day: string; pose: string; path: string }[];
  if (rows.length === 0) return [];

  const { data: signed } = await createAdminClient()
    .storage.from("progress-photos")
    .createSignedUrls(
      rows.map((row) => row.path),
      60 * 60,
    );
  const urls = new Map((signed ?? []).map((item) => [item.path, item.signedUrl]));
  return rows.map((row) => ({ id: row.id, day: row.day, pose: row.pose, url: urls.get(row.path) ?? null }));
}
