import type { Metadata } from "next";
import { FeedList } from "@/components/feed-list";
import { PostComposer } from "@/components/post-composer";
import { requireAccount } from "@/lib/auth";
import { loadFeed, postableCommunities } from "@/lib/community-server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Community" };

export default async function CommunityPage() {
  const { profile } = await requireAccount();
  const supabase = await createClient();
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
          feed, newest first.
        </p>
      </div>
      <PostComposer role={profile.role} communities={communities} />
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
