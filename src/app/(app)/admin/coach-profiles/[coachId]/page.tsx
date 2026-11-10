import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CoachProfile } from "@/components/coach-profile/coach-profile-view";
import { CoachReviewForm } from "@/components/coach-review-form";
import { requireAdmin } from "@/lib/auth";
import { profileCompletion, profileWarnings } from "@/lib/coach-draft";
import { buildView, loadDraft } from "@/lib/coach-profile-server";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Review coach profile" };

export default async function ReviewCoachProfilePage({
  params,
}: {
  params: Promise<{ coachId: string }>;
}) {
  await requireAdmin();
  const { coachId } = await params;
  if (!idSchema.safeParse(coachId).success) notFound();
  const supabase = await createClient();
  const [{ data: coach }, { data: published }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name")
      .eq("id", coachId)
      .eq("role", "coach")
      .maybeSingle(),
    supabase
      .from("coach_profiles_public")
      .select("published_at")
      .eq("coach_id", coachId)
      .maybeSingle(),
  ]);
  if (!coach) notFound();
  const draft = await loadDraft(coachId);
  if (!draft.exists) notFound();
  const view = await buildView(
    { id: coach.id as string, display_name: coach.display_name as string },
    draft.draft,
    draft.photoPath,
  );
  const completion = profileCompletion(draft.draft, Boolean(draft.photoPath));
  // Admins can read every credential, so the certification check sees what the coach submitted.
  const { data: credentialRows } = await supabase
    .from("coach_credentials")
    .select("status")
    .eq("coach_id", coachId);
  const warnings = profileWarnings(
    draft.draft,
    (credentialRows ?? []) as { status: string }[],
  );

  return (
    <div className="space-y-6">
      <Link href="/admin/coach-profiles" className="text-link text-sm">
        Back to coach profiles
      </Link>
      <div className="space-y-4 rounded-2xl border border-border bg-surface p-5">
        <h1 className="text-4xl">Review {coach.display_name as string}</h1>
        <p className="text-sm text-muted">
          Status: {draft.status.replace("_", " ")} · {completion.percent}%
          complete
          {published ? " · A previous version is live" : " · Not live yet"}
        </p>
        {warnings.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-danger">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Check the photo is a real, appropriate photo of the coach.</li>
          <li>
            Look for guaranteed results, medical claims or titles they may not
            hold.
          </li>
          <li>Prices and policies should be clear and match their Plans.</li>
          <li>No phone numbers, outside payment links or contact details.</li>
        </ul>
        <CoachReviewForm
          coachId={coachId}
          canReview={draft.status === "submitted"}
          isLive={Boolean(published)}
        />
      </div>
      <div className="rounded-2xl border border-dashed border-border p-3 sm:p-5">
        <p className="mb-4 text-xs uppercase tracking-widest text-muted">
          The draft as members would see it
        </p>
        <CoachProfile profile={view} />
      </div>
    </div>
  );
}
