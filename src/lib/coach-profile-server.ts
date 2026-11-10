import "server-only";
import {
  type CoachDraft,
  emptyDraft,
  readDraft,
  toCoachView,
} from "@/lib/coach-draft";
import type { CoachProfileView } from "@/lib/coach-profile";
import {
  type DisplayStatus,
  kindLabel,
  overallVerification,
} from "@/lib/credentials";
import { reviewerName } from "@/lib/public-pages";
import { categoryAverages, type ReviewCategoryColumn } from "@/lib/reviews";
import {
  loadCoachIdentities,
  loadMatchWeights,
  loadMyAnswers,
  toMatchSummary,
} from "@/lib/matching-server";
import { formatIntroFormats } from "@/lib/intros";
import { loadOpenSlots } from "@/lib/intros-server";
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

// Ratings, category averages and the latest reviews, shown with the reviewer's first name and
// last initial, and the coach's reply.
export async function loadCoachReviews(coachId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("coach_reviews")
    .select(
      "id, rating, body, created_at, reply, rating_communication, rating_knowledge, rating_motivation, rating_results, rating_value, member:profiles!member_id(display_name)",
    )
    .eq("coach_id", coachId)
    .eq("hidden", false)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as unknown as ({
    id: string;
    rating: number;
    body: string;
    created_at: string;
    reply: string | null;
    member: { display_name: string } | null;
  } & Record<ReviewCategoryColumn, number | null>)[];
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
      id: row.id,
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
      reply: row.reply,
    }));
  return { rating, items, categories: categoryAverages(rows) };
}

function monthYear(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// The credentials members may see, through the database function that leaves out ID numbers,
// documents and notes and never shows an expired credential as verified.
export async function loadPublicCredentials(coachId: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("public_coach_credentials", {
    target_coach_id: coachId,
  });
  const rows = (data ?? []) as {
    kind: string;
    organization: string;
    title: string;
    display_status: DisplayStatus;
    expires_on: string | null;
    verified_at: string | null;
  }[];
  const credentials: CoachProfileView["credentials"] = rows.map((row) => ({
    title: row.title,
    organization: row.organization,
    status: row.display_status,
    detail: [
      kindLabel(row.kind),
      row.display_status === "verified" && row.verified_at
        ? `checked by GYMX2 in ${monthYear(row.verified_at)}`
        : null,
      row.expires_on
        ? `${row.display_status === "expired" ? "expired" : "valid until"} ${monthYear(row.expires_on)}`
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));
  return {
    credentials,
    verification: overallVerification(
      rows.map((row) => ({ kind: row.kind, status: row.display_status })),
    ),
  };
}

export async function buildView(
  coach: { id: string; display_name: string },
  draft: CoachDraft,
  photoPath: string | null,
  // A member viewing the profile gets their match, computed fresh from their own answers.
  viewer?: { id: string; role: string },
) {
  const isMember = viewer?.role === "member" && viewer.id !== coach.id;
  const [photoUrl, reviews, creds, answers, weights, slots, saved] =
    await Promise.all([
      signedCoachPhoto(photoPath),
      loadCoachReviews(coach.id),
      loadPublicCredentials(coach.id),
      isMember ? loadMyAnswers(viewer!.id) : Promise.resolve(null),
      isMember ? loadMatchWeights() : Promise.resolve(null),
      viewer ? loadOpenSlots(coach.id) : Promise.resolve([]),
      isMember
        ? createClient().then((db) =>
            db
              .from("coach_favorites")
              .select("coach_id")
              .eq("member_id", viewer!.id)
              .eq("coach_id", coach.id)
              .maybeSingle()
              .then(({ data }) => Boolean(data)),
          )
        : Promise.resolve(undefined),
    ]);
  const view = toCoachView(draft, {
    id: coach.id,
    name: coach.display_name,
    photoUrl,
    rating: reviews.rating,
    reviews: reviews.items,
    reviewCategories: reviews.categories,
    credentials: creds.credentials,
    verification: creds.verification,
  });
  if (slots.length) {
    view.intro = {
      title: "Free intro session",
      priceCents: 0,
      minutes: slots[0].minutes,
      formats: formatIntroFormats(slots.map((slot) => slot.format)),
      cancellation:
        "Free to cancel from your calendar any time before it starts.",
      questions: [],
      nextSlot: slots[0].startsAt,
    };
  }
  if (saved !== undefined) view.saved = saved;
  if (isMember) {
    if (answers && weights)
      view.match = toMatchSummary(answers, draft, weights);
    else view.matchPrompt = true;
  }
  return view;
}

// The approved profile members see, or null when the coach has none published.
export async function loadPublishedView(
  coach: { id: string; display_name: string },
  viewer?: { id: string; role: string },
) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("coach_profiles_public")
    .select("data, photo_path")
    .eq("coach_id", coach.id)
    .maybeSingle();
  if (!data) return null;
  // The identity answer isn't in the published copy; the server adds it back only for matching.
  const draft = readDraft(data.data);
  if (viewer?.role === "member")
    draft.identity =
      (await loadCoachIdentities([coach.id])).get(coach.id) ?? null;
  return buildView(
    coach,
    draft,
    (data.photo_path as string | null) ?? null,
    viewer,
  );
}
