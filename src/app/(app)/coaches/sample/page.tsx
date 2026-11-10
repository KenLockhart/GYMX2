import type { Metadata } from "next";
import Link from "next/link";
import { CoachProfile } from "@/components/coach-profile/coach-profile-view";
import { requireAccount } from "@/lib/auth";
import { SAMPLE_COACH } from "@/lib/coach-sample";

export const metadata: Metadata = {
  title: "Sample coach profile",
  robots: { index: false, follow: false },
};

// Coach Jasmine: the labeled design sample for coach profiles. Not a real coach, never in search
// results, and booking and saving are switched off.
export default async function SampleCoachPage() {
  const { profile } = await requireAccount();
  return (
    <div className="space-y-4">
      <Link
        href={profile.role === "member" ? "/coaches" : "/dashboard"}
        className="text-link text-sm"
      >
        {profile.role === "member" ? "Back to coaches" : "Back to dashboard"}
      </Link>
      <CoachProfile profile={SAMPLE_COACH} />
    </div>
  );
}
