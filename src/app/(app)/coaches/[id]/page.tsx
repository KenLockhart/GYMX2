import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { requireAccount } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { idSchema } from "@/lib/validation";
import { joinCoach, leaveCoach } from "../actions";

export const metadata: Metadata = { title: "Coach" };

type CoachProfile = Pick<
  Profile,
  "id" | "display_name" | "bio" | "instagram_url" | "tiktok_url" | "youtube_url" | "x_url" | "website_url"
>;

const SOCIAL_LINKS: { key: keyof CoachProfile; label: string }[] = [
  { key: "instagram_url", label: "Instagram" },
  { key: "tiktok_url", label: "TikTok" },
  { key: "youtube_url", label: "YouTube" },
  { key: "x_url", label: "X" },
  { key: "website_url", label: "Website" },
];

export default async function CoachPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireAccount();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();

  const supabase = await createClient();
  const [coachResult, joinedResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, bio, instagram_url, tiktok_url, youtube_url, x_url, website_url")
      .eq("id", id)
      .eq("role", "coach")
      .maybeSingle<CoachProfile>(),
    supabase
      .from("coach_members")
      .select("coach_id")
      .eq("coach_id", id)
      .eq("member_id", profile.id)
      .maybeSingle(),
  ]);
  const coach = coachResult.data;
  if (!coach) notFound();

  const isMember = profile.role === "member";
  const isJoined = Boolean(joinedResult.data);
  const links = SOCIAL_LINKS.flatMap(({ key, label }) => {
    const url = coach[key];
    return typeof url === "string" && url ? [{ label, url }] : [];
  });

  return (
    <div className="space-y-6">
      {isMember && (
        <Link href="/coaches" className="text-link text-sm">
          Back to coaches
        </Link>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-accent">Coach</p>
          <h1 className="mt-1 text-5xl">{coach.display_name}</h1>
          {coach.bio && <p className="mt-3 max-w-2xl whitespace-pre-line text-muted">{coach.bio}</p>}
        </div>
        {isMember && (
          <div className="flex shrink-0 flex-wrap items-start gap-2">
            {isJoined && (
              <Link href={`/messages/${coach.id}`} className="btn-primary">
                Message
              </Link>
            )}
            <ActionForm
              action={isJoined ? leaveCoach : joinCoach}
              confirmMessage={
                isJoined
                  ? `Leave ${coach.display_name}? Your unfinished Tasks and upcoming sessions with them will be removed.`
                  : undefined
              }
              className="space-y-2"
            >
              <input type="hidden" name="coach_id" value={coach.id} />
              <SubmitButton
                pendingText={isJoined ? "Leaving..." : "Joining..."}
                className={isJoined ? "btn-secondary" : "btn-primary"}
              >
                {isJoined ? "Leave" : "Join"}
              </SubmitButton>
              <FormStatus />
            </ActionForm>
          </div>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-2xl">Find {coach.display_name} online</h2>
        {links.length === 0 ? (
          <p className="text-muted">
            {profile.id === coach.id ? (
              <>
                You haven&apos;t added any links yet.{" "}
                <Link href="/profile" className="text-link">
                  Add them on your profile
                </Link>
                .
              </>
            ) : (
              "No links added yet."
            )}
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {links.map((link) => (
              <li key={link.label}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="btn-secondary px-4 py-2 text-sm"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
