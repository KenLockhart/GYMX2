import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { IntroTimes } from "@/components/intro-times";
import { requireAccount } from "@/lib/auth";
import { loadCoachIntroSlots } from "@/lib/intros-server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Intro times" };

// Coaches publish free intro times. Members book them from the coach's profile.
export default async function IntroTimesPage() {
  const { profile } = await requireAccount();
  if (profile.role !== "coach") redirect("/calendar");
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
          Back to the calendar
        </Link>
        <h1 className="mt-2 text-5xl">Intro times</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Free intro sessions let new members meet you before they commit. Add
          the times you&apos;re free; members book one from your profile, with
          an optional message. Bookings land on both calendars.
        </p>
        {!published && (
          <p className="mt-3 rounded-xl border border-dashed border-accent/60 bg-accent/5 px-4 py-3 text-sm">
            Members can book once your coach profile is approved.{" "}
            <Link href="/profile/coach" className="text-link">
              Finish your profile
            </Link>
          </p>
        )}
      </div>
      <IntroTimes slots={slots} />
    </div>
  );
}
