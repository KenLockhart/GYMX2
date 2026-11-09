import "server-only";
import { FEED_PAGE_SIZE, type CommentDTO, type PostDTO } from "@/lib/community";
import { getPlayerUrl, getVideoState } from "@/lib/stream";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type PostRow = {
  id: string;
  author_id: string;
  kind: PostDTO["kind"];
  body: string;
  audience: PostDTO["audience"];
  coach_id: string | null;
  pillar: string | null;
  like_count: number;
  comment_count: number;
  created_at: string;
  edited_at: string | null;
};

const POST_COLUMNS =
  "id, author_id, kind, body, audience, coach_id, pillar, like_count, comment_count, created_at, edited_at";

// Turns rows the person was allowed to read into what the screens show: names (shared by the server,
// since members can't read each other's profiles), photo links that work for an hour, and video players.
export async function toPostDTOs(
  rows: PostRow[],
  viewerId: string,
): Promise<PostDTO[]> {
  if (rows.length === 0) return [];
  const supabase = await createClient();
  const admin = createAdminClient();
  const people = [
    ...new Set(
      rows.flatMap((row) => [
        row.author_id,
        ...(row.coach_id ? [row.coach_id] : []),
      ]),
    ),
  ];

  const [{ data: profiles }, { data: media }, { data: likes }] =
    await Promise.all([
      admin.from("profiles").select("id, display_name, role").in("id", people),
      // Row security: media only for posts this person can see.
      supabase
        .from("post_media")
        .select("post_id, kind, path, video_uid, position, width, height")
        .in(
          "post_id",
          rows.map((row) => row.id),
        )
        .order("position"),
      supabase
        .from("post_likes")
        .select("post_id")
        .eq("user_id", viewerId)
        .in(
          "post_id",
          rows.map((row) => row.id),
        ),
    ]);
  const liked = new Set((likes ?? []).map((like) => like.post_id as string));
  const names = new Map(
    (profiles ?? []).map((person) => [person.id as string, person]),
  );
  const mediaRows = (media ?? []) as {
    post_id: string;
    kind: "photo" | "video";
    path: string | null;
    video_uid: string | null;
    width: number | null;
    height: number | null;
  }[];

  const paths = mediaRows.flatMap((row) => (row.path ? [row.path] : []));
  const { data: signed } = paths.length
    ? await admin.storage
        .from("community-media")
        .createSignedUrls(paths, 60 * 60)
    : { data: [] };
  const urls = new Map(
    (signed ?? []).map((item) => [item.path, item.signedUrl]),
  );

  const videos = new Map<string, PostDTO["video"]>();
  await Promise.all(
    mediaRows
      .filter((row) => row.video_uid)
      .map(async (row) => {
        try {
          const state = await getVideoState(row.video_uid!);
          videos.set(row.post_id, {
            status:
              state.status === "ready"
                ? "ready"
                : state.status === "failed"
                  ? "failed"
                  : "processing",
            url:
              state.status === "ready"
                ? await getPlayerUrl(row.video_uid!)
                : null,
          });
        } catch {
          videos.set(row.post_id, { status: "processing", url: null });
        }
      }),
  );

  return rows.map((row) => {
    const author = names.get(row.author_id);
    const coach = row.coach_id ? names.get(row.coach_id) : null;
    return {
      id: row.id,
      kind: row.kind,
      body: row.body,
      audience: row.audience,
      coach: row.coach_id
        ? { id: row.coach_id, name: (coach?.display_name as string) ?? "Coach" }
        : null,
      pillar: row.pillar,
      author: {
        id: row.author_id,
        name: (author?.display_name as string) ?? "Former member",
        role: (author?.role as string) ?? "member",
      },
      likeCount: row.like_count,
      commentCount: row.comment_count,
      createdAt: row.created_at,
      editedAt: row.edited_at,
      photos: mediaRows
        .filter(
          (media) =>
            media.post_id === row.id && media.path && urls.get(media.path),
        )
        .map((media) => ({
          url: urls.get(media.path!)!,
          width: media.width,
          height: media.height,
        })),
      video: videos.get(row.id) ?? null,
      mine: row.author_id === viewerId,
      likedByMe: liked.has(row.id),
    };
  });
}

// A page of the feed, built by the database with the person's own permissions.
export async function loadFeed(
  viewerId: string,
  offset = 0,
  coachId: string | null = null,
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_feed", {
    page_offset: offset,
    page_size: FEED_PAGE_SIZE + 1,
    only_coach: coachId,
  });
  if (error) {
    console.error("Feed failed", error.message);
    return { posts: [] as PostDTO[], more: false, error: true };
  }
  const rows = (data ?? []) as PostRow[];
  return {
    posts: await toPostDTOs(rows.slice(0, FEED_PAGE_SIZE), viewerId),
    more: rows.length > FEED_PAGE_SIZE,
    error: false,
  };
}

export async function loadPost(viewerId: string, postId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("posts")
    .select(POST_COLUMNS)
    .eq("id", postId)
    .is("removed_at", null)
    .maybeSingle();
  if (!data) return null;
  const [post] = await toPostDTOs([data as PostRow], viewerId);
  return post;
}

// Coaches a person can post to: their own community (coaches) or coaches they joined (members).
export async function postableCommunities(viewer: {
  id: string;
  role: string;
  display_name: string;
}) {
  if (viewer.role === "coach")
    return [{ id: viewer.id, name: viewer.display_name }];
  if (viewer.role !== "member") return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("coach_members")
    .select("coach:profiles!coach_id(id, display_name)")
    .eq("member_id", viewer.id);
  return (
    (data ?? []) as unknown as {
      coach: { id: string; display_name: string } | null;
    }[]
  ).flatMap((row) =>
    row.coach ? [{ id: row.coach.id, name: row.coach.display_name }] : [],
  );
}

// Display names for people in the community. Members can't read each other's profiles, so the
// server shares just the name and role.
export async function loadAuthors(ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0)
    return new Map<string, { id: string; name: string; role: string }>();
  const { data } = await createAdminClient()
    .from("profiles")
    .select("id, display_name, role")
    .in("id", unique);
  return new Map(
    (data ?? []).map((person) => [
      person.id as string,
      {
        id: person.id as string,
        name: person.display_name as string,
        role: person.role as string,
      },
    ]),
  );
}

export async function loadComments(
  postId: string,
  viewerId: string,
): Promise<CommentDTO[]> {
  const supabase = await createClient();
  // Row security: only comments on posts this person can see.
  const { data } = await supabase
    .from("post_comments")
    .select("id, post_id, parent_id, author_id, body, created_at, edited_at")
    .eq("post_id", postId)
    .is("removed_at", null)
    .order("created_at")
    .limit(500);
  const rows = (data ?? []) as {
    id: string;
    post_id: string;
    parent_id: string | null;
    author_id: string;
    body: string;
    created_at: string;
    edited_at: string | null;
  }[];
  const authors = await loadAuthors(rows.map((row) => row.author_id));
  return rows.map((row) => ({
    id: row.id,
    postId: row.post_id,
    parentId: row.parent_id,
    body: row.body,
    author: authors.get(row.author_id) ?? {
      id: row.author_id,
      name: "Former member",
      role: "member",
    },
    createdAt: row.created_at,
    editedAt: row.edited_at,
    mine: row.author_id === viewerId,
  }));
}
