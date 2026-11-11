import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IntroBooking } from "@/components/intro-booking";
import { requireAccount } from "@/lib/auth";
import { loadMyIntroWithCoach, loadOpenSlots } from "@/lib/intros-server";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";
import { T } from "@/i18n/t";
import { getTr } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTr())("Book a free intro") };
}

export default async function BookIntroPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await requireAccount();
  const id = idSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const supabase = await createClient();
  const [{ data: coach }, { data: published }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name")
      .eq("id", id.data)
      .eq("role", "coach")
      .maybeSingle(),
    supabase
      .from("coach_profiles_public")
      .select("coach_id")
      .eq("coach_id", id.data)
      .maybeSingle(),
  ]);
  if (!coach || !published) notFound();
  const isMember = profile.role === "member";
  const [slots, existing] = await Promise.all([
    loadOpenSlots(coach.id as string),
    isMember
      ? loadMyIntroWithCoach(profile.id, coach.id as string)
      : Promise.resolve(null),
  ]);
  const name = coach.display_name as string;
  const firstName = name.replace(/^Coach\s+/i, "").split(/\s+/)[0] || name;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href={`/coaches/${coach.id}`} className="text-link text-sm">
          Back to {name}
        </Link>
        <p className="mt-3 text-xs font-semibold uppercase tracking-widest text-accent">
          <T>Free intro session</T>
        </p>
        <h1 className="mt-1 text-5xl">Meet {firstName}</h1>
        <p className="mt-2 text-muted">
          <T>
            A short, free call or meeting to see if you&apos;re a good fit.
            Booking doesn&apos;t start a membership, and you can cancel any time
            before it starts.
          </T>
        </p>
      </div>
      <IntroBooking
        coach={{ id: coach.id as string, name, firstName }}
        slots={slots}
        existing={existing}
        canBook={isMember}
      />
    </div>
  );
}
