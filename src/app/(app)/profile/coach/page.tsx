import type { Metadata } from "next";
import Link from "next/link";
import { CoachProfileEditor } from "@/components/coach-editor/editor";
import { requireCoach } from "@/lib/auth";
import { loadDraft, signedCoachPhoto } from "@/lib/coach-profile-server";
import { loadOwnCredentials } from "@/lib/credentials-server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Your coach profile" };

export default async function CoachProfileEditorPage() {
  const { profile } = await requireCoach();
  const supabase = await createClient();
  const [draft, { data: published }] = await Promise.all([
    loadDraft(profile.id, profile.bio),
    supabase
      .from("coach_profiles_public")
      .select("coach_id")
      .eq("coach_id", profile.id)
      .maybeSingle(),
  ]);
  const [photoUrl, credentials] = await Promise.all([
    signedCoachPhoto(draft.photoPath),
    loadOwnCredentials(profile.id),
  ]);
  return (
    <>
      <nav
        aria-label="Coach profile tools"
        className="mb-6 flex flex-wrap gap-2 text-sm"
      >
        <Link href="/profile/coach/reviews" className="btn-secondary px-4 py-2">
          Your reviews
        </Link>
        <Link href="/calendar/intros" className="btn-secondary px-4 py-2">
          Intro times
        </Link>
      </nav>
      <CoachProfileEditor
        coachId={profile.id}
        coachName={profile.display_name}
        initial={draft.draft}
        initialPhotoUrl={photoUrl}
        initialStatus={draft.status}
        reviewNote={draft.reviewNote}
        published={Boolean(published)}
        initialCredentials={credentials}
      />
    </>
  );
}
