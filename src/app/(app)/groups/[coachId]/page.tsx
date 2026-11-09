import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FeedList } from "@/components/feed-list";
import { GroupChat } from "@/components/group-chat";
import { PostComposer } from "@/components/post-composer";
import { requireAccount } from "@/lib/auth";
import { loadFeed } from "@/lib/community-server";
import { loadGroupRoster, type GroupPost } from "@/lib/groups";
import { describeFlags, detectFlags } from "@/lib/message-flags";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Coach community" };

// One coach's community: posts (announcements, challenges and member posts) and the group chat.
export default async function CoachCommunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ coachId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { profile } = await requireAccount();
  const { coachId } = await params;
  const { tab: requested } = await searchParams;
  if (!idSchema.safeParse(coachId).success) notFound();

  const roster = await loadGroupRoster(coachId);
  if (!roster) notFound();
  const isAdmin = profile.role === "admin";
  const isCoach = profile.id === coachId;
  const inGroup = isCoach || profile.id in roster.names;
  if (!inGroup && !isAdmin) notFound();
  const tab = requested === "chat" ? "chat" : "posts";

  const title = isCoach ? "Your community" : `${roster.coachName}'s community`;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {!isCoach && (
        <Link href="/groups" className="text-link text-sm">
          All coach communities
        </Link>
      )}
      <div>
        <h1 className="text-5xl">{title}</h1>
        <p className="mt-2 text-muted">
          {roster.memberCount} {roster.memberCount === 1 ? "member" : "members"}
          {isCoach
            ? " · Everyone who joins you is in here. You can remove any post or chat message."
            : isAdmin
              ? " · You can read this community but not post."
              : " · Only you, your coach and their members see what's posted here."}
        </p>
      </div>

      <nav
        aria-label="Community sections"
        className="flex gap-1 border-b border-border"
      >
        {(
          [
            { key: "posts", label: "Posts" },
            { key: "chat", label: "Chat" },
          ] as const
        ).map((item) => (
          <Link
            key={item.key}
            href={
              item.key === "posts"
                ? `/groups/${coachId}`
                : `/groups/${coachId}?tab=chat`
            }
            aria-current={tab === item.key ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2 font-semibold ${
              tab === item.key
                ? "border-accent text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "posts" ? (
        <PostsTab
          viewer={profile}
          coachId={coachId}
          coachName={roster.coachName}
          canPost={inGroup}
        />
      ) : (
        <ChatTab
          viewerId={profile.id}
          coachId={coachId}
          names={roster.names}
          canPost={inGroup}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}

async function PostsTab({
  viewer,
  coachId,
  coachName,
  canPost,
}: {
  viewer: { id: string; role: string };
  coachId: string;
  coachName: string;
  canPost: boolean;
}) {
  // Row security still decides every post; this only narrows the feed to this community.
  const feed = await loadFeed(viewer.id, 0, coachId);
  const isCoach = viewer.id === coachId;
  return (
    <div className="space-y-4">
      {canPost && (
        <PostComposer
          role={viewer.role}
          communities={[{ id: coachId, name: coachName }]}
          defaultAudience="coach_community"
          defaultCoachId={coachId}
        />
      )}
      {feed.error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger bg-surface p-4 text-sm"
        >
          We couldn&apos;t load the posts. Refresh to try again.
        </p>
      ) : (
        <FeedList
          initialPosts={feed.posts}
          initialMore={feed.more}
          viewerRole={viewer.role}
          coachId={coachId}
          emptyText={
            isCoach
              ? "Nothing here yet. Post an announcement or a challenge to get your members going."
              : "No posts yet. Share a workout or a win with the group."
          }
        />
      )}
    </div>
  );
}

async function ChatTab({
  viewerId,
  coachId,
  names,
  canPost,
  isAdmin,
}: {
  viewerId: string;
  coachId: string;
  names: Record<string, string>;
  canPost: boolean;
  isAdmin: boolean;
}) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("group_messages")
    .select("id, coach_id, sender_id, body, created_at")
    .eq("coach_id", coachId)
    .order("created_at", { ascending: false })
    .limit(200);
  const posts = ((data ?? []) as GroupPost[]).reverse();

  // Admins see the same contact and payment flags as in direct messages.
  const flagged: Record<string, string> = {};
  if (isAdmin) {
    for (const post of posts) {
      const flags = detectFlags(post.body);
      if (flags.length) flagged[post.id] = describeFlags(flags);
    }
  }
  return (
    <GroupChat
      me={viewerId}
      coachId={coachId}
      names={names}
      initialPosts={posts}
      canPost={canPost}
      flagged={flagged}
    />
  );
}
