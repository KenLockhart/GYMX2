import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { profileCompletion, readDraft } from "@/lib/coach-draft";
import { signedCoachPhoto } from "@/lib/coach-profile-server";
import { createClient } from "@/lib/supabase/server";
import {
  CoachProfilesGallery,
  type CoachGalleryItem,
  type FeaturedCoachGalleryItem,
} from "@/components/admin-coach-profiles-gallery";
import { loadFeaturedCoachInputs } from "@/lib/featured-coach-data";
import { rankFeaturedCoaches, readExactPages } from "@/lib/featured-coach";

export const metadata: Metadata = { title: "Coach profiles" };

export default async function CoachProfilesAdminPage() {
  await requireAdmin();
  const supabase = await createClient();
  type PublishedRow = {
    coach_id: string;
    published_at: string;
    data: unknown;
    photo_path: string | null;
  };

  const draftsPromise = supabase
    .from("coach_profile_drafts")
    .select(
      "coach_id, data, photo_path, status, submitted_at, updated_at, coach:profiles!coach_id(display_name)",
    )
    .order("submitted_at", { ascending: true, nullsFirst: false });

  let galleryData: {
    coaches: CoachGalleryItem[];
    featuredCoach: FeaturedCoachGalleryItem | null;
    eligibleLiveCount: number;
    featuredMetricsError: boolean;
  } | null = null;
  try {
    const [draftResult, publishedRows] = await Promise.all([
      draftsPromise,
      readExactPages(
        (from, to) =>
          supabase
            .from("coach_profiles_public")
            .select("coach_id, published_at, data, photo_path", { count: "exact" })
            .order("coach_id", { ascending: true })
            .range(from, to),
        (row) => row.coach_id,
      ),
    ]);
    if (draftResult.error) throw new Error("Coach profiles could not be read.");
    const drafts = draftResult.data;
    const published = publishedRows as PublishedRow[];
    const publishedById = new Map(published.map((row) => [row.coach_id, row]));

    const now = new Date();
    let featuredCoach: FeaturedCoachGalleryItem | null = null;
    let featuredMetricsError = false;
    try {
      const featuredInputs = await loadFeaturedCoachInputs(
        published.map((row) => row.coach_id),
        now,
      );
      const ranked = rankFeaturedCoaches(
        published.map((row) => ({
          id: row.coach_id,
          name: featuredInputs.coachNames.get(row.coach_id) ?? "",
          publishedAt: row.published_at,
        })),
        featuredInputs,
        now,
      );
      const winner = ranked.winner;
      const winnerSource = winner ? publishedById.get(winner.id) : undefined;
      if (winner && winnerSource) {
        const profile = readDraft(winnerSource.data);
        featuredCoach = {
          id: winnerSource.coach_id,
          name: winner.name,
          status: "approved",
          publishedAt: winnerSource.published_at,
          submittedAt: null,
          updatedAt: winnerSource.published_at,
          photoUrl: await signedCoachPhoto(winnerSource.photo_path).catch(() => null),
          headline: profile.headline,
          specialties: profile.specialties.slice(0, 3),
          location: profile.location,
          formats: profile.formats,
          completion: profileCompletion(profile, Boolean(winnerSource.photo_path)).percent,
          metrics: winner.metrics,
        };
      }
    } catch {
      featuredMetricsError = true;
    }

    const draftRows = ((drafts ?? []) as unknown as {
      coach_id: string;
      data: unknown;
      photo_path: string | null;
      status: string;
      submitted_at: string | null;
      updated_at: string;
      coach: { display_name: string } | null;
    }[]).sort(
      (a, b) => Number(b.status === "submitted") - Number(a.status === "submitted"),
    );
    const coaches: CoachGalleryItem[] = await Promise.all(
      draftRows.map(async (row) => {
        const draft = readDraft(row.data);
        const completion = profileCompletion(draft, Boolean(row.photo_path));
        return {
          id: row.coach_id,
          name: row.coach?.display_name ?? "Coach",
          status: row.status,
          publishedAt: publishedById.get(row.coach_id)?.published_at ?? null,
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

    galleryData = {
      coaches,
      featuredCoach,
      eligibleLiveCount: published.length,
      featuredMetricsError,
    };
  } catch {
    galleryData = null;
  }

  if (!galleryData) return <CoachProfilesGallery loadError />;
  return <CoachProfilesGallery {...galleryData} />;
}
