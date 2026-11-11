import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { profileCompletion, readDraft } from "@/lib/coach-draft";
import { signedCoachPhoto } from "@/lib/coach-profile-server";
import { createClient } from "@/lib/supabase/server";
import {
  CoachProfilesGallery,
  type CoachGalleryItem,
} from "@/components/admin-coach-profiles-gallery";

export const metadata: Metadata = { title: "Coach profiles" };

export default async function CoachProfilesAdminPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: drafts, error: draftsError }, { data: published, error: publishedError }] =
    await Promise.all([
      supabase
        .from("coach_profile_drafts")
        .select(
          "coach_id, data, photo_path, status, submitted_at, updated_at, coach:profiles!coach_id(display_name)",
        )
        .order("submitted_at", { ascending: true, nullsFirst: false }),
      supabase.from("coach_profiles_public").select("coach_id, published_at"),
    ]);

  if (draftsError || publishedError) {
    return <CoachProfilesGallery loadError />;
  }

  const live = new Map(
    (published ?? []).map((row) => [
      row.coach_id as string,
      row.published_at as string,
    ]),
  );
  const rows = (
    (drafts ?? []) as unknown as {
      coach_id: string;
      data: unknown;
      photo_path: string | null;
      status: string;
      submitted_at: string | null;
      updated_at: string;
      coach: { display_name: string } | null;
    }[]
  ).sort(
    (a, b) =>
      Number(b.status === "submitted") - Number(a.status === "submitted"),
  );

  const coaches: CoachGalleryItem[] = await Promise.all(
    rows.map(async (row) => {
      const draft = readDraft(row.data);
      const completion = profileCompletion(draft, Boolean(row.photo_path));
      return {
        id: row.coach_id,
        name: row.coach?.display_name ?? "Coach",
        status: row.status,
        publishedAt: live.get(row.coach_id) ?? null,
        submittedAt: row.submitted_at,
        updatedAt: row.updated_at,
        photoUrl: await signedCoachPhoto(row.photo_path).catch(() => null),
        headline: draft.headline,
        specialties: draft.specialties.slice(0, 3),
        location: draft.location,
        formats: draft.formats,
        completion: completion.percent,
      };
    }),
  );

  return <CoachProfilesGallery coaches={coaches} />;
}
