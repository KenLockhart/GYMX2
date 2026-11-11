import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MatchQuiz } from "@/components/match-quiz";
import { MatchSummary } from "@/components/match-summary";
import { requireAccount } from "@/lib/auth";
import { readAnswers } from "@/lib/match-questions";
import { createClient } from "@/lib/supabase/server";
import { T } from "@/i18n/t";
import { getTr } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTr())("Find your coach match") };
}

export default async function MatchPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { profile } = await requireAccount();
  if (profile.role !== "member") redirect("/coaches/sample");
  const { edit } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase
    .from("member_match_preferences")
    .select("answers, completed_at")
    .eq("member_id", profile.id)
    .maybeSingle();
  const answers = readAnswers(data?.answers);
  const completed = Boolean(data?.completed_at);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/coaches" className="text-link text-sm">
        <T>Back to coaches</T>
      </Link>
      {completed && !edit ? (
        <MatchSummary answers={answers} />
      ) : (
        <MatchQuiz
          initial={answers}
          firstName={profile.display_name.split(" ")[0]}
        />
      )}
    </div>
  );
}
