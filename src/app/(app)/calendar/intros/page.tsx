import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { IntroTimes } from "@/components/intro-times";
import { getT } from "@/i18n/server";
import { requireAccount } from "@/lib/auth";
import { loadCoachIntroSlots } from "@/lib/intros-server";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).calendar.introTimes };
}

// Coaches publish free intro times. Members book them from the coach's profile.
export default async function IntroTimesPage() {
  const { profile } = await requireAccount();
  if (profile.role !== "coach") redirect("/calendar");
  const t = (await getT()).calendar;
  const supabase = await createClient();
  const [slots, { data: published }] = await Promise.all([
    loadCoachIntroSlots(profile.id),
    supabase
      .from("coach_profiles_public")
      .select("coach_id")
      .eq("coach_id", profile.id)
      .maybeSingle(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/calendar" className="text-link text-sm">
          {t.new.back}
        </Link>
        <h1 className="mt-2 text-5xl">{t.introTimes}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t.intros.body}</p>
        {!published && (
          <p className="mt-3 rounded-xl border border-dashed border-accent/60 bg-accent/5 px-4 py-3 text-sm">
            {t.intros.notApproved}{" "}
            <Link href="/profile/coach" className="text-link">
              {t.intros.finish}
            </Link>
          </p>
        )}
      </div>
      <IntroTimes slots={slots} />
    </div>
  );
}
