import "server-only";
import {
  type CoachDraft,
  emptyDraft,
  readDraft,
  toCoachView,
} from "@/lib/coach-draft";
import type { CoachProfileView } from "@/lib/coach-profile";
import { reviewerName } from "@/lib/public-pages";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const PHOTO_BUCKET = "coach-photos";

export type DraftStatus =
  "draft" | "submitted" | "approved" | "changes_requested";

// A short-lived link to a coach photo. Photos are private files; the server signs them only for
// profiles the viewer is allowed to see.
export async function signedCoachPhoto(path: string | null) {
  if (!path) return null;
  const { data } = await createAdminClient()
    .storage.from(PHOTO_BUCKET)
    .createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

// The coach's own draft (row security: only the coach and admins can read it).
export async function loadDraft(coachId: string, seedBio = "") {
  const supabase = await createClient();
  const { data } = await supabase
    .from("coach_profile_drafts")
    .select(
      "data, photo_path, status, review_note, submitted_at, reviewed_at, updated_at",
    )
    .eq("coach_id", coachId)
    .maybeSingle();
  return {
    exists: Boolean(data),
    draft: data ? readDraft(data.data) : emptyDraft({ bio: seedBio }),
    photoPath: (data?.photo_path as string | null) ?? null,
    status: ((data?.status as DraftStatus) ?? "draft") as DraftStatus,
    reviewNote: (data?.review_note as string) ?? "",
    submittedAt: (data?.submitted_at as string | null) ?? null,
    reviewedAt: (data?.reviewed_at as string | null) ?? null,
  };
}

// Ratings and the latest reviews, shown with the reviewer's first name and last initial.
export async function loadCoachReviews(coachId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("coach_reviews")
    .select("rating, body, created_at, member:profiles!member_id(display_name)")
    .eq("coach_id", coachId)
    .eq("hidden", false)
    .order("created_at", { ascending: false })
    .limit(50);
  const rows = (data ?? []) as unknown as {
    rating: number;
    body: string;
    created_at: string;
    member: { display_name: string } | null;
  }[];
  const rating = rows.length
    ? {
        average:
          Math.round(
            (rows.reduce((sum, r) => sum + r.rating, 0) / rows.length) * 10,
          ) / 10,
        count: rows.length,
      }
    : null;
  const items: CoachProfileView["reviews"]["items"] = rows
    .slice(0, 10)
    .map((row) => ({
      author: reviewerName(row.member?.display_name ?? "A member"),
      date: new Date(row.created_at).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "America/New_York",
      }),
      format: "Member",
      goal: "",
      rating: row.rating,
      body: row.body,
      reply: null,
    }));
  return { rating, items };
}

export async function buildView(
  coach: { id: string; display_name: string },
  draft: CoachDraft,
  photoPath: string | null,
) {
  const [photoUrl, reviews] = await Promise.all([
    signedCoachPhoto(photoPath),
    loadCoachReviews(coach.id),
  ]);
  return toCoachView(draft, {
    id: coach.id,
    name: coach.display_name,
    photoUrl,
    rating: reviews.rating,
    reviews: reviews.items,
  });
}

// The approved profile members see, or null when the coach has none published.
export async function loadPublishedView(coach: {
  id: string;
  display_name: string;
}) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("coach_profiles_public")
    .select("data, photo_path")
    .eq("coach_id", coach.id)
    .maybeSingle();
  if (!data) return null;
  return buildView(
    coach,
    readDraft(data.data),
    (data.photo_path as string | null) ?? null,
  );
}
