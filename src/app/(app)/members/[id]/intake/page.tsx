import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CoachIntakeSummary } from "@/components/coach-intake-summary";
import { getT } from "@/i18n/server";
import { requireCoach } from "@/lib/auth";
import { loadCoachMemberIntake } from "@/lib/member-intake-server";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).intake.title };
}

export default async function CoachMemberIntakePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await requireCoach();
  const { id: rawId } = await params;
  const memberId = idSchema.safeParse(rawId);
  if (!memberId.success) notFound();
  const t = (await getT()).intake;
  const supabase = await createClient();
  const { data: connection } = await supabase
    .from("coach_members")
    .select("member_id, member:profiles!member_id(display_name)")
    .eq("coach_id", profile.id)
    .eq("member_id", memberId.data)
    .maybeSingle();
  if (!connection) notFound();

  const memberName = (
    connection as unknown as { member: { display_name: string } | null }
  ).member?.display_name ?? "A member";
  const intake = await loadCoachMemberIntake(memberId.data);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href={`/members/${memberId.data}`} className="text-link text-sm">{memberName}</Link>
      <nav aria-label="Member profile tabs" className="flex gap-2 border-b border-border">
        <Link href={`/members/${memberId.data}`} className="border-b-2 border-transparent px-3 py-2 text-sm text-muted">Overview</Link>
        <Link href={`/members/${memberId.data}/intake`} aria-current="page" className="border-b-2 border-accent px-3 py-2 text-sm font-semibold">{t.title}</Link>
      </nav>
      <header>
        <h1 className="text-4xl">{memberName} · {t.title}</h1>
      </header>
      {intake.status === "complete" && intake.answers ? (
        <CoachIntakeSummary answers={intake.answers} completedAt={intake.completedAt} />
      ) : (
        <p className="rounded-xl border border-border bg-surface p-5 text-muted">
          {intake.status === "pending" ? t.statusPending : t.noAnswers}
        </p>
      )}
    </div>
  );
}
