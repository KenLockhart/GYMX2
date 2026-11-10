import type { Metadata } from "next";
import Link from "next/link";
import { MatchWeightsForm } from "@/components/match-weights-form";
import { requireAdmin } from "@/lib/auth";
import { MATCH_VERSION } from "@/lib/matching";
import { loadMatchWeights } from "@/lib/matching-server";

export const metadata: Metadata = { title: "Match weights" };

export default async function MatchingAdminPage() {
  await requireAdmin();
  const weights = await loadMatchWeights();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/admin" className="text-link text-sm">
        Back to Admin
      </Link>
      <div>
        <h1 className="text-5xl">Match weights</h1>
        <p className="mt-2 text-muted">
          How much each category counts in the compatibility score members see.
          Scores are recalculated every time a page loads, so changes apply
          right away. Hard rules (format, language, waitlist and the
          member&apos;s coach preference) always apply, whatever the weights.
        </p>
        <p className="mt-1 text-xs text-muted">
          Algorithm version {MATCH_VERSION}
        </p>
      </div>
      <MatchWeightsForm initial={weights} />
    </div>
  );
}
