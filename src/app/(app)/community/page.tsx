import type { Metadata } from "next";
import Link from "next/link";
import { FeedList } from "@/components/feed-list";
import { PostComposer } from "@/components/post-composer";
import { allBadges } from "@/lib/achievements";
import { requireAccount } from "@/lib/auth";
import { loadFeed, postableCommunities } from "@/lib/community-server";
import { loadProgressPhotoById } from "@/lib/photos";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Community" };

export default async function CommunityPage({
  searchParams,
}: {
  searchParams: Promise<{ photo?: string; badge?: string }>;
}) {
  const { profile } = await requireAccount();
  const { photo, badge } = await searchParams;
  const supabase = await createClient();

  // Sharing from Track (a progress photo) or Progress (an earned badge) starts a draft here.
  const progressPhoto =
    photo && idSchema.safeParse(photo).success
      ? await loadProgressPhotoById(profile.id, photo)
      : null;
  let sharedBadge: { name: string; description: string } | null = null;
  if (badge && /^[a-z0-9_-]{1,60}$/.test(badge)) {
    const { data: earned } = await supabase
      .from("user_badges")
      .select("badge")
      .eq("user_id", profile.id)
      .eq("badge", badge)
      .maybeSingle();
    if (earned)
      sharedBadge = allBadges().find((item) => item.key === badge) ?? null;
  }
  const initialBody = sharedBadge
    ? `I just earned the ${sharedBadge.name} badge on GYMX2: ${sharedBadge.description}`
    : "";

  const [feed, communities, { data: prefs }] = await Promise.all([
    loadFeed(profile.id),
    postableCommunities(profile),
    supabase
      .from("feed_preferences")
      .select("mode")
      .eq("user_id", profile.id)
      .maybeSingle(),
  ]);
  const personalized = prefs?.mode === "personalized";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-5xl">Community</h1>
        <p className="mt-2 text-muted">
          Workouts, wins and motivation from GYMX2 members and coaches. Showing
          the{" "}
          <span className="font-semibold text-foreground">
            {personalized ? "personalized" : "standard GYMX2"}
          </span>{" "}
          feed.{" "}
          <Link href="/community/preferences" className="text-link">
            Newsfeed preferences
          </Link>
        </p>
      </div>
      <PostComposer
        key={`${progressPhoto?.id ?? ""}${sharedBadge ? badge : ""}`}
        role={profile.role}
        communities={communities}
        initialBody={initialBody}
        initialKind={
          progressPhoto ? "progress" : sharedBadge ? "achievement" : "general"
        }
        progressPhoto={progressPhoto}
      />
      {feed.error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger bg-surface p-4 text-sm"
        >
          We couldn&apos;t load the feed. Refresh to try again.
        </p>
      ) : (
        <FeedList
          initialPosts={feed.posts}
          initialMore={feed.more}
          viewerRole={profile.role}
          emptyText="No posts yet. Be the first to share a workout or a win."
        />
      )}
    </div>
  );
}
