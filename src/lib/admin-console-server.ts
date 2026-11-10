import "server-only";
import { createClient } from "@/lib/supabase/server";

// How much is waiting in each admin queue. Admins can read every row, so plain counts work.
export async function loadAdminCounts() {
  const supabase = await createClient();
  const count = (q: PromiseLike<{ count: number | null }>) =>
    Promise.resolve(q).then((r) => r.count ?? 0);
  const head = { count: "exact" as const, head: true };
  const [
    coachRequests,
    profilesToReview,
    credentialsPending,
    reviewReports,
    coachReports,
    communityReports,
    affiliateApplications,
  ] = await Promise.all([
    count(
      supabase
        .from("profiles")
        .select("id", head)
        .eq("coach_requested", true)
        .eq("role", "member"),
    ),
    count(
      supabase
        .from("coach_profile_drafts")
        .select("coach_id", head)
        .eq("status", "submitted"),
    ),
    count(
      supabase
        .from("coach_credentials")
        .select("id", head)
        .eq("status", "pending"),
    ),
    count(
      supabase.from("review_reports").select("id", head).eq("status", "open"),
    ),
    count(
      supabase.from("coach_reports").select("id", head).eq("status", "open"),
    ),
    count(
      supabase.from("content_reports").select("id", head).eq("status", "open"),
    ),
    count(
      supabase
        .from("affiliates")
        .select("user_id", head)
        .eq("status", "pending"),
    ),
  ]);
  return {
    coachRequests,
    profilesToReview,
    credentialsPending,
    reports: reviewReports + coachReports,
    communityReports,
    affiliateApplications,
  };
}
export type AdminCounts = Awaited<ReturnType<typeof loadAdminCounts>>;

// Sidebar badges, by link.
export function sidebarBadges(counts: AdminCounts): Record<string, number> {
  return {
    "/admin/users": counts.coachRequests,
    "/admin/affiliates": counts.affiliateApplications,
    "/admin/coach-profiles": counts.profilesToReview,
    "/admin/credentials": counts.credentialsPending,
    "/admin/reports": counts.reports,
    "/moderation": counts.communityReports,
  };
}
