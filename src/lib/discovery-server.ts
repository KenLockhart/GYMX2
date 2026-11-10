import "server-only";
import { readDraft } from "@/lib/coach-draft";
import { PHOTO_BUCKET } from "@/lib/coach-profile-server";
import { startingMonthlyPrice } from "@/lib/coach-profile";
import type { CoachCard } from "@/lib/discovery";
import { computeMatch } from "@/lib/matching";
import { loadMatchWeights, loadMyAnswers } from "@/lib/matching-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Every coach as a discovery card. Reads use the viewer's own permissions; only photo links are
// signed by the server, and only for coaches with an approved profile.
export async function loadDiscoveryCards(viewer: {
  id: string;
  role: string;
}): Promise<CoachCard[]> {
  const supabase = await createClient();
  const isMember = viewer.role === "member";
  const [
    { data: coaches },
    { data: published },
    { data: reviews },
    { data: plans },
    { data: verified },
    { data: joined },
    { data: saved },
    { data: passed },
    answers,
    weights,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, bio")
      .eq("role", "coach"),
    supabase.from("coach_profiles_public").select("coach_id, data, photo_path"),
    supabase
      .from("coach_reviews")
      .select("coach_id, rating")
      .eq("hidden", false),
    supabase
      .from("coach_plans")
      .select("coach_id, price_cents")
      .eq("active", true)
      .not("stripe_price_id", "is", null),
    supabase.rpc("verified_coaches"),
    supabase
      .from("coach_members")
      .select("coach_id")
      .eq("member_id", viewer.id),
    isMember
      ? supabase
          .from("coach_favorites")
          .select("coach_id")
          .eq("member_id", viewer.id)
      : Promise.resolve({ data: [] }),
    isMember
      ? supabase
          .from("coach_passes")
          .select("coach_id")
          .eq("member_id", viewer.id)
      : Promise.resolve({ data: [] }),
    isMember ? loadMyAnswers(viewer.id) : Promise.resolve(null),
    isMember ? loadMatchWeights() : Promise.resolve(null),
  ]);

  const profileByCoach = new Map(
    (published ?? []).map((row) => [row.coach_id as string, row]),
  );
  const ratings = new Map<string, { sum: number; count: number }>();
  for (const r of reviews ?? []) {
    const entry = ratings.get(r.coach_id as string) ?? { sum: 0, count: 0 };
    entry.sum += r.rating as number;
    entry.count += 1;
    ratings.set(r.coach_id as string, entry);
  }
  const cheapestPlan = new Map<string, number>();
  for (const p of plans ?? []) {
    const current = cheapestPlan.get(p.coach_id as string);
    if (current === undefined || (p.price_cents as number) < current)
      cheapestPlan.set(p.coach_id as string, p.price_cents as number);
  }
  const verifiedSet = new Set(
    ((verified ?? []) as { coach_id: string }[]).map((r) => r.coach_id),
  );
  const joinedSet = new Set((joined ?? []).map((r) => r.coach_id as string));
  const savedSet = new Set((saved ?? []).map((r) => r.coach_id as string));
  const passedSet = new Set((passed ?? []).map((r) => r.coach_id as string));

  const photoPaths = (published ?? []).flatMap((r) =>
    r.photo_path ? [r.photo_path as string] : [],
  );
  const { data: signed } = photoPaths.length
    ? await createAdminClient()
        .storage.from(PHOTO_BUCKET)
        .createSignedUrls(photoPaths, 60 * 60)
    : { data: [] };
  const photoUrl = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  return (coaches ?? []).map((coach) => {
    const id = coach.id as string;
    const row = profileByCoach.get(id);
    const draft = row ? readDraft(row.data) : null;
    const rating = ratings.get(id);
    const match =
      draft && answers && weights
        ? (() => {
            const result = computeMatch(answers, draft, weights);
            return {
              total: result.eligible ? result.total : null,
              eligible: result.eligible,
            };
          })()
        : null;
    const profilePrice = draft
      ? startingMonthlyPrice(draft.packages.map((p) => ({ ...p, billing: "" })))
      : null;
    return {
      id,
      name: coach.display_name as string,
      photoUrl: row?.photo_path
        ? (photoUrl.get(row.photo_path as string) ?? null)
        : null,
      headline: draft?.headline || ((coach.bio as string) ?? "").slice(0, 160),
      specialties: draft?.specialties ?? [],
      location: draft?.location ?? "",
      formats: draft?.formats.length ? draft.formats : ["online"],
      rating: rating
        ? {
            average: Math.round((rating.sum / rating.count) * 10) / 10,
            count: rating.count,
          }
        : null,
      experienceYears: draft?.experienceYears ?? null,
      startingPriceCents: profilePrice ?? cheapestPlan.get(id) ?? null,
      match,
      verified: verifiedSet.has(id),
      acceptingClients: draft ? draft.acceptingClients : true,
      hasProfile: Boolean(draft),
      populations: draft?.populations.map((p) => p.label) ?? [],
      languages: draft?.availability.languages ?? "",
      motivation: draft?.style.motivation.primary ?? null,
      accountability: draft?.style.accountability.primary ?? null,
      accessibility: Boolean(
        draft &&
        (draft.availability.accessibility ||
          draft.populations.some(
            (p) => p.label === "People with disabilities",
          )),
      ),
      joined: joinedSet.has(id),
      saved: savedSet.has(id),
      passed: passedSet.has(id),
    } satisfies CoachCard;
  });
}
