import type { Metadata } from "next";
import { ModerationQueue, type QueueItem } from "@/components/moderation-queue";
import { requireModerator } from "@/lib/auth";
import { loadAuthors } from "@/lib/community-server";
import { summarizeReasons } from "@/lib/reports";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Reports" };

type PostRow = {
  id: string;
  author_id: string;
  body: string;
  audience: string;
  coach_id: string | null;
  created_at: string;
  removed_at: string | null;
  flag_reasons: string;
};
type CommentRow = {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at: string;
  removed_at: string | null;
};
type ReportRow = {
  id: string;
  reporter_id: string;
  post_id: string | null;
  comment_id: string | null;
  reason: string;
  details: string;
  created_at: string;
};

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// Everything here is read with the moderator's own permissions: moderators see reports on the
// shared feed, admins see reports anywhere except "Only me" posts. Private messages are never here.
export default async function ModerationPage() {
  const { profile } = await requireModerator();
  const isAdmin = profile.role === "admin";
  const supabase = await createClient();

  const since = daysAgo(14);
  const [{ data: reportData }, { data: flaggedData }] = await Promise.all([
    supabase
      .from("content_reports")
      .select(
        "id, reporter_id, post_id, comment_id, reason, details, created_at",
      )
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .limit(500),
    supabase
      .from("posts")
      .select(
        "id, author_id, body, audience, coach_id, created_at, removed_at, flag_reasons",
      )
      .neq("flag_reasons", "")
      .neq("audience", "only_me")
      .is("removed_at", null)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const reports = (reportData ?? []) as ReportRow[];
  const flagged = (flaggedData ?? []) as PostRow[];

  const commentIds = [
    ...new Set(reports.flatMap((r) => (r.comment_id ? [r.comment_id] : []))),
  ];
  const { data: commentData } = commentIds.length
    ? await supabase
        .from("post_comments")
        .select("id, post_id, author_id, body, created_at, removed_at")
        .in("id", commentIds)
    : { data: [] };
  const comments = new Map(
    ((commentData ?? []) as CommentRow[]).map((c) => [c.id, c]),
  );

  const postIds = [
    ...new Set([
      ...reports.flatMap((r) => (r.post_id ? [r.post_id] : [])),
      ...[...comments.values()].map((c) => c.post_id),
      ...flagged.map((p) => p.id),
    ]),
  ];
  const [{ data: postData }, { data: mediaData }] = postIds.length
    ? await Promise.all([
        supabase
          .from("posts")
          .select(
            "id, author_id, body, audience, coach_id, created_at, removed_at, flag_reasons",
          )
          .in("id", postIds),
        supabase
          .from("post_media")
          .select("post_id, path, position")
          .in("post_id", postIds)
          .order("position"),
      ])
    : [{ data: [] }, { data: [] }];
  const posts = new Map(((postData ?? []) as PostRow[]).map((p) => [p.id, p]));

  const media = (mediaData ?? []) as { post_id: string; path: string }[];
  const { data: signed } = media.length
    ? await createAdminClient()
        .storage.from("community-media")
        .createSignedUrls(
          media.map((m) => m.path),
          60 * 60,
        )
    : { data: [] };
  const signedByPath = new Map(
    (signed ?? []).map((s) => [s.path, s.signedUrl]),
  );
  const photosFor = (postId: string) =>
    media
      .filter((m) => m.post_id === postId)
      .flatMap((m) => {
        const url = signedByPath.get(m.path);
        return url ? [url] : [];
      })
      .slice(0, 4);

  const people = await loadAuthors([
    ...[...posts.values()].flatMap((p) => [
      p.author_id,
      ...(p.coach_id ? [p.coach_id] : []),
    ]),
    ...[...comments.values()].map((c) => c.author_id),
    ...(isAdmin ? reports.map((r) => r.reporter_id) : []),
  ]);
  const nameOf = (id: string | null) =>
    (id && people.get(id)?.name) || "Former member";
  const where = (post: PostRow) =>
    post.audience === "everyone"
      ? "Everyone on GYMX2"
      : `${nameOf(post.coach_id)}'s community`;

  // One queue item per reported post or comment, oldest report first.
  const groups = new Map<string, ReportRow[]>();
  for (const report of reports) {
    const key = report.post_id
      ? `post:${report.post_id}`
      : `comment:${report.comment_id}`;
    groups.set(key, [...(groups.get(key) ?? []), report]);
  }
  const queue: QueueItem[] = [];
  for (const [key, group] of groups) {
    const [kind, targetId] = key.split(":") as ["post" | "comment", string];
    const comment = kind === "comment" ? comments.get(targetId) : undefined;
    const post = posts.get(
      kind === "post" ? targetId : (comment?.post_id ?? ""),
    );
    if (!post || (kind === "comment" && !comment)) continue;
    const target = comment ?? post;
    queue.push({
      key,
      kind,
      targetId,
      postId: post.id,
      authorName: nameOf(target.author_id),
      body: target.body,
      photos: kind === "post" ? photosFor(post.id) : [],
      where: where(post),
      createdAt: target.created_at,
      alreadyRemoved: Boolean(target.removed_at),
      summary: summarizeReasons(group.map((r) => r.reason)),
      details: group.flatMap((r) =>
        r.details
          ? [isAdmin ? `${nameOf(r.reporter_id)}: ${r.details}` : r.details]
          : [],
      ),
      autoFlag: post.flag_reasons || null,
      reportIds: group.map((r) => r.id),
      reportedAt: group[0].created_at,
    });
  }

  const flaggedItems: QueueItem[] = flagged
    .filter((post) => !groups.has(`post:${post.id}`))
    .map((post) => ({
      key: `flag:${post.id}`,
      kind: "post",
      targetId: post.id,
      postId: post.id,
      authorName: nameOf(post.author_id),
      body: post.body,
      photos: photosFor(post.id),
      where: where(post),
      createdAt: post.created_at,
      alreadyRemoved: false,
      summary: "Flagged automatically",
      details: [],
      autoFlag: post.flag_reasons,
      reportIds: [],
      reportedAt: post.created_at,
    }));

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-5xl">Reports</h1>
        <p className="mt-2 text-muted">
          {isAdmin
            ? "Reported posts and comments from the shared feed and every coach community."
            : "Reported posts and comments from the shared feed. Coach communities are moderated by their coaches and GYMX2 admins."}{" "}
          Removing something hides it from everyone and tells the author, with
          your reason if you give one. Direct messages are never shown here.
        </p>
      </div>
      <ModerationQueue
        title="Open reports"
        empty="No open reports. Nice."
        items={queue}
      />
      <ModerationQueue
        title="Flagged automatically"
        empty="Nothing flagged in the last 14 days."
        hint="Posts mentioning phone numbers, emails or payment apps. Nobody reported these; remove one only if it breaks the guidelines."
        items={flaggedItems}
      />
    </div>
  );
}
