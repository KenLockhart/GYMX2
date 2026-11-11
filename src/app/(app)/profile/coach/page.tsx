import type { Metadata } from "next";
import Link from "next/link";
import { CoachProfileEditor } from "@/components/coach-editor/editor";
import { requireCoach } from "@/lib/auth";
import { loadDraft, signedCoachPhoto } from "@/lib/coach-profile-server";
import { loadOwnCredentials } from "@/lib/credentials-server";
import { createClient } from "@/lib/supabase/server";
import { T } from "@/i18n/t";
import { getTr } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTr())("Your coach profile") };
}

export default async function CoachProfileEditorPage() {
  const tr = await getTr();
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
        aria-label={tr("Coach profile tools")}
        className="mb-6 flex flex-wrap gap-2 text-sm"
      >
        <Link href="/profile/coach/reviews" className="btn-secondary px-4 py-2">
          <T>Your reviews</T>
        </Link>
        <Link href="/calendar/intros" className="btn-secondary px-4 py-2">
          <T>Intro times</T>
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
