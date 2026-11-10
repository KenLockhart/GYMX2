import "server-only";
import type { CoachDraft } from "@/lib/coach-draft";
import type { MatchSummary } from "@/lib/coach-profile";
import { readAnswers, type MatchAnswers } from "@/lib/match-questions";
import {
  computeMatch,
  DEFAULT_WEIGHTS,
  type MatchWeights,
  validWeights,
} from "@/lib/matching";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function loadMatchWeights(): Promise<MatchWeights> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("match_settings")
    .select("weights")
    .maybeSingle();
  const weights = data?.weights as Record<string, unknown> | undefined;
  return weights && validWeights(weights) ? weights : DEFAULT_WEIGHTS;
}

// The viewer's own answers (row security: nobody else's), or null if they haven't started.
export async function loadMyAnswers(
  memberId: string,
): Promise<MatchAnswers | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("member_match_preferences")
    .select("answers")
    .eq("member_id", memberId)
    .maybeSingle();
  if (!data) return null;
  const answers = readAnswers(data.answers);
  return Object.keys(answers).length ? answers : null;
}

export function toMatchSummary(
  answers: MatchAnswers,
  coach: CoachDraft,
  weights: MatchWeights,
): MatchSummary {
  const result = computeMatch(answers, coach, weights);
  if (!result.eligible)
    return {
      total: null,
      categories: {
        goals: null,
        personality: null,
        schedule: null,
        communication: null,
        experience: null,
        budget: null,
      },
      reasons: [],
      discuss: [],
      blockers: result.blockers,
    };
  return {
    total: result.total,
    categories: result.categories,
    reasons: result.reasons,
    discuss: result.discuss,
  };
}

// Coaches' optional identity answers, kept out of the published profile so members can't read them.
// Only the server reads them, only to apply a member's coach-preference filter.
export async function loadCoachIdentities(coachIds: string[]) {
  if (!coachIds.length) return new Map<string, "woman" | "man" | "nonbinary">();
  const { data } = await createAdminClient()
    .from("coach_profiles_public")
    .select("coach_id, identity")
    .in("coach_id", coachIds)
    .not("identity", "is", null);
  return new Map(
    (data ?? []).map((row) => [
      row.coach_id as string,
      row.identity as "woman" | "man" | "nonbinary",
    ]),
  );
}
