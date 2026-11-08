import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GroupChat } from "@/components/group-chat";
import { requireAccount } from "@/lib/auth";
import { loadGroupRoster, type GroupPost } from "@/lib/groups";
import { describeFlags, detectFlags } from "@/lib/message-flags";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Group" };

export default async function GroupPage({
  params,
}: {
  params: Promise<{ coachId: string }>;
}) {
  const { profile } = await requireAccount();
  const { coachId } = await params;
  if (!idSchema.safeParse(coachId).success) notFound();

  const roster = await loadGroupRoster(coachId);
  if (!roster) notFound();
  const isAdmin = profile.role === "admin";
  const inGroup = profile.id === coachId || profile.id in roster.names;
  if (!inGroup && !isAdmin) notFound();

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
    <div className="space-y-6">
      {profile.role !== "coach" && (
        <Link href="/groups" className="text-link text-sm">
          All groups
        </Link>
      )}
      <div>
        <h1 className="text-5xl">
          {profile.id === coachId
            ? "Your group"
            : `${roster.coachName}'s group`}
        </h1>
        <p className="mt-2 text-muted">
          {roster.memberCount} {roster.memberCount === 1 ? "member" : "members"}
          {profile.id === coachId &&
            " · Everyone who joins you is in here. You can remove any post."}
        </p>
      </div>
      <GroupChat
        me={profile.id}
        coachId={coachId}
        names={roster.names}
        initialPosts={posts}
        canPost={inGroup}
        flagged={flagged}
      />
    </div>
  );
}
