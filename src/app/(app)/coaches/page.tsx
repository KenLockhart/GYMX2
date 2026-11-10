import type { Metadata } from "next";
import Link from "next/link";
import { CoachDiscovery } from "@/components/coach-discovery";
import { requireAccount } from "@/lib/auth";
import { loadDiscoveryCards } from "@/lib/discovery-server";
import { loadMyAnswers } from "@/lib/matching-server";

export const metadata: Metadata = { title: "Coaches" };

// Coach discovery, open to everyone signed in. Saving, passing and match scores are for members.
export default async function CoachesPage() {
  const { profile } = await requireAccount();
  const isMember = profile.role === "member";
  const [cards, answers] = await Promise.all([
    loadDiscoveryCards({ id: profile.id, role: profile.role }).catch(
      () => null,
    ),
    isMember ? loadMyAnswers(profile.id) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-5xl">Find your coach</h1>
        <p className="mt-2 max-w-xl text-muted">
          {isMember
            ? "Browse coaches, save the ones you like and open a profile to join. Coaches see your name and bio when you join, but never your email, and never who saved or passed on them."
            : "Browse the coaches on GYMX2 the way members see them."}
        </p>
        {isMember && (
          <Link
            href="/coaches/match"
            className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-accent bg-accent/10 px-4 py-4 hover:bg-accent/15"
          >
            <span>
              <span className="block font-display text-2xl font-bold uppercase leading-tight">
                {answers ? "Update your coach match" : "Find your coach match"}
              </span>
              <span className="text-sm text-muted">
                {answers
                  ? "Change your answers any time. Your match scores update straight away."
                  : "Two minutes of questions about how you like to train, including your Coaching Love Language."}
              </span>
            </span>
            <span aria-hidden className="text-2xl text-accent">
              →
            </span>
          </Link>
        )}
        <Link
          href="/coaches/sample"
          className="mt-3 inline-block text-sm text-muted hover:text-accent"
        >
          See a sample profile (Coach Jasmine) →
        </Link>
      </div>

      {cards === null ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load the coaches. Please refresh and try again.
        </p>
      ) : cards.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          No coaches have joined GYMX2 yet.
        </p>
      ) : (
        <CoachDiscovery cards={cards} canSave={isMember} />
      )}
    </div>
  );
}
