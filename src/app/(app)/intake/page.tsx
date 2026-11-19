import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MemberIntakeWizard } from "@/components/member-intake-wizard";
import { getT } from "@/i18n/server";
import { requireAccount } from "@/lib/auth";
import {
  loadMyIntakeRecord,
  loadMyPendingIntakeBookings,
} from "@/lib/member-intake-server";
import { createClient } from "@/lib/supabase/server";
import { safeMemberIntakeReturnPath } from "@/lib/member-intake-form";
import { idSchema } from "@/lib/validation";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).intake.title };
}

export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { profile } = await requireAccount();
  if (profile.role !== "member") redirect("/dashboard");
  const query = await searchParams;
  const requestedCoach = idSchema.safeParse(
    Array.isArray(query.coach) ? query.coach[0] : query.coach,
  );
  const returnTo = safeMemberIntakeReturnPath(
    Array.isArray(query.returnTo) ? query.returnTo[0] : query.returnTo,
  );
  const [record, pendingResult] = await Promise.all([
    loadMyIntakeRecord(),
    loadMyPendingIntakeBookings(),
  ]);
  const t = (await getT()).intake;
  const coach = requestedCoach.success
    ? pendingResult.bookings.find((item) => item.coachId === requestedCoach.data) ?? null
    : null;
  const selectedCoach = coach ?? pendingResult.bookings[0] ?? null;

  if (query.completed === "1") {
    let coachName = "";
    if (requestedCoach.success) {
      const supabase = await createClient();
      const { data: access } = await supabase
        .from("intake_coach_access")
        .select("coach_id")
        .eq("coach_id", requestedCoach.data)
        .maybeSingle();
      const { data } = access ? await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", requestedCoach.data)
        .eq("role", "coach")
        .maybeSingle() : { data: null };
      coachName = (data?.display_name as string | undefined) ?? "";
    }
    return (
      <section className="mx-auto max-w-2xl space-y-5 rounded-2xl border border-border bg-surface p-6">
        <h1 className="text-4xl">{t.completeTitle}</h1>
        <p className="text-muted">
          {coachName ? t.completeBody(coachName) : t.completeUpdateBody}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/calendar" className="btn-primary">{t.buttons.openCalendar}</Link>
          {pendingResult.bookings.length > 0 && (
            <Link href="/intake" className="btn-secondary">{t.buttons.openIntake}</Link>
          )}
        </div>
      </section>
    );
  }

  if (pendingResult.error && !selectedCoach) {
    return (
      <section className="mx-auto max-w-2xl space-y-4 rounded-2xl border border-border bg-surface p-6">
        <h1 className="text-4xl">{t.title}</h1>
        <p role="alert" className="text-danger">{t.errors.save_failed}</p>
        <Link href="/calendar" className="btn-secondary">{t.buttons.openCalendar}</Link>
      </section>
    );
  }

  if (!selectedCoach && record?.status === "completed" && query.edit !== "1") {
    return (
      <section className="mx-auto max-w-2xl space-y-5 rounded-2xl border border-border bg-surface p-6">
        <h1 className="text-4xl">{t.completeTitle}</h1>
        <p className="text-muted">{t.completeUpdateBody}</p>
        <p className="text-sm text-muted">{t.privacyNote}</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/intake?edit=1" className="btn-primary">{t.buttons.edit}</Link>
          <Link href="/calendar" className="btn-secondary">{t.buttons.openCalendar}</Link>
        </div>
      </section>
    );
  }

  if (!selectedCoach && !record) {
    return (
      <section className="mx-auto max-w-2xl space-y-5 rounded-2xl border border-border bg-surface p-6">
        <h1 className="text-4xl">{t.title}</h1>
        <p className="text-muted">{t.introNoBooking}</p>
        <Link href="/calendar" className="btn-primary">{t.buttons.openCalendar}</Link>
      </section>
    );
  }

  const rawStep = Number(Array.isArray(query.step) ? query.step[0] : query.step);
  const maxStep = record?.status === "completed" ? 8 : (record?.currentStep ?? 1);
  const defaultStep = record?.status === "draft" ? record.currentStep : 1;
  const step = Number.isInteger(rawStep) && rawStep >= 1 && rawStep <= maxStep
    ? rawStep
    : defaultStep;

  return (
    <MemberIntakeWizard
      initialAnswers={record?.answers ?? {}}
      step={step}
      coach={selectedCoach}
      returnTo={returnTo}
    />
  );
}
