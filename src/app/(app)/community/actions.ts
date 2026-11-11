"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireAccount } from "@/lib/auth";
import {
  COMMENT_MAX,
  type CommentDTO,
  MAX_PHOTO_BYTES,
  MAX_POST_PHOTOS,
  PHOTO_TYPES,
  POST_BODY_MAX,
  POST_KIND_VALUES,
  type PostDTO,
} from "@/lib/community";
import { loadAuthors, loadFeed } from "@/lib/community-server";
import { communityMembers, notifyCommunity } from "@/lib/community-notify";
import { REPORT_DETAILS_MAX, REPORT_REASONS } from "@/lib/reports";
import { describeFlags, detectFlags } from "@/lib/message-flags";
import { deleteVideo, getVideoCreator } from "@/lib/stream";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

const BUCKET = "community-media";
const RECENT_POST_LIMIT = 10; // posts per 10 minutes

function extensionOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

// Step 1 for photos: one-time upload links into the person's own folder. Nothing is posted yet.
export async function preparePhotoUploads(
  files: { name: string; size: number }[],
): Promise<{ error?: string; uploads?: { path: string; token: string }[] }> {
  const { profile } = await requireAccount();
  if (!Array.isArray(files) || files.length === 0)
    return { error: "Choose a photo." };
  if (files.length > MAX_POST_PHOTOS)
    return { error: `Up to ${MAX_POST_PHOTOS} photos per post.` };
  for (const file of files) {
    if (!(extensionOf(file.name) in PHOTO_TYPES))
      return { error: "Use JPG, PNG or WebP photos." };
    if (!(file.size > 0) || file.size > MAX_PHOTO_BYTES)
      return { error: "Each photo can be up to 10 MB." };
  }
  const draft = randomUUID();
  const storage = createAdminClient().storage.from(BUCKET);
  const uploads = [];
  for (const [index, file] of files.entries()) {
    const { data, error } = await storage.createSignedUploadUrl(
      `${profile.id}/${draft}/${index}.${extensionOf(file.name)}`,
    );
    if (error || !data)
      return { error: "We couldn't start the upload. Please try again." };
    uploads.push({ path: data.path, token: data.token });
  }
  return { uploads };
}

const photoSchema = z.object({
  path: z.string().max(300),
  width: z.number().int().min(1).max(20000).nullable(),
  height: z.number().int().min(1).max(20000).nullable(),
});

const postSchema = z
  .object({
    kind: z.enum(POST_KIND_VALUES),
    body: z
      .string()
      .trim()
      .max(
        POST_BODY_MAX,
        `Keep posts under ${POST_BODY_MAX.toLocaleString()} characters`,
      ),
    audience: z.enum(["everyone", "coach_community", "only_me"]),
    coachId: idSchema.nullable(),
    photos: z.array(photoSchema).max(MAX_POST_PHOTOS),
    videoUid: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .nullable(),
    // A Track progress photo to share. The original stays private; a copy is posted.
    progressPhotoId: idSchema.nullable().optional(),
  })
  .refine(
    (post) =>
      post.body.length > 0 ||
      post.photos.length > 0 ||
      post.videoUid ||
      post.progressPhotoId,
    {
      message: "Write something or add a photo or video",
    },
  )
  .refine((post) => !(post.photos.length && post.videoUid), {
    message: "Add photos or one video, not both",
  })
  .refine((post) => !(post.progressPhotoId && post.videoUid), {
    message: "Add photos or one video, not both",
  })
  .refine(
    (post) =>
      post.photos.length + (post.progressPhotoId ? 1 : 0) <= MAX_POST_PHOTOS,
    { message: `Up to ${MAX_POST_PHOTOS} photos per post.` },
  )
  .refine(
    (post) => (post.audience === "coach_community") === Boolean(post.coachId),
    {
      message: "Choose which coach community",
    },
  );

// Step 2: save the post once uploads are done. The database decides whether this person may post
// this kind of post to this audience.
export async function createPost(
  input: unknown,
): Promise<{ error?: string; id?: string }> {
  const { profile } = await requireAccount();
  const parsed = postSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const post = parsed.data;

  const supabase = await createClient();
  const { count } = await supabase
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("author_id", profile.id)
    .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
  if ((count ?? 0) >= RECENT_POST_LIMIT)
    return {
      error:
        "You're posting a lot. Take a breather and try again in a few minutes.",
    };

  // Uploaded photos must be this person's, and really there.
  const admin = createAdminClient();
  for (const photo of post.photos) {
    const parts = photo.path.split("/");
    if (parts.length !== 3 || parts[0] !== profile.id)
      return { error: "That upload didn't work. Please try again." };
  }
  if (post.photos.length) {
    const folder = post.photos[0].path.split("/").slice(0, 2).join("/");
    if (post.photos.some((photo) => !photo.path.startsWith(`${folder}/`)))
      return { error: "That upload didn't work. Please try again." };
    const { data: files } = await admin.storage.from(BUCKET).list(folder);
    const present = new Set(
      (files ?? []).map((file) => `${folder}/${file.name}`),
    );
    if (post.photos.some((photo) => !present.has(photo.path)))
      return { error: "A photo didn't finish uploading. Please try again." };
  }
  if (post.videoUid && (await getVideoCreator(post.videoUid)) !== profile.id) {
    return { error: "That video upload didn't work. Please try again." };
  }
  const photos = [...post.photos];
  if (post.progressPhotoId) {
    const copy = await copyProgressPhoto(profile.id, post.progressPhotoId);
    if (!copy) return { error: "We couldn't share that progress photo." };
    photos.unshift(copy);
  }

  const { data: created, error } = await supabase
    .from("posts")
    .insert({
      author_id: profile.id,
      kind: post.kind,
      body: post.body,
      audience: post.audience,
      coach_id: post.coachId,
    })
    .select("id")
    .single();
  if (error || !created) {
    return {
      error:
        error?.code === "42501"
          ? post.kind === "announcement" || post.kind === "challenge"
            ? "Only coaches can post announcements and challenges."
            : "You can't post there."
          : "We couldn't post that. Please try again.",
    };
  }

  const media = [
    ...photos.map((photo, position) => ({
      post_id: created.id,
      kind: "photo",
      path: photo.path,
      position,
      width: photo.width,
      height: photo.height,
    })),
    ...(post.videoUid
      ? [
          {
            post_id: created.id,
            kind: "video",
            video_uid: post.videoUid,
            position: 0,
          },
        ]
      : []),
  ];
  if (media.length) {
    const { error: mediaError } = await supabase
      .from("post_media")
      .insert(media);
    if (mediaError) {
      await supabase.from("posts").delete().eq("id", created.id);
      const copies = photos
        .filter((photo) => photo.path.split("/")[1]?.startsWith("progress-"))
        .map((photo) => photo.path);
      if (copies.length) await admin.storage.from(BUCKET).remove(copies);
      return { error: "We couldn't attach your media. Please try again." };
    }
  }

  // Contact details and payment apps are flagged for moderators, never blocked.
  const flags = detectFlags(post.body);
  if (flags.length)
    await admin
      .from("posts")
      .update({ flag_reasons: describeFlags(flags).slice(0, 200) })
      .eq("id", created.id);

  if (post.kind === "announcement" && post.audience !== "only_me") {
    const coachId = post.coachId ?? profile.id;
    after(async () => {
      if (coachId !== profile.id) return;
      notifyCommunity({
        recipients: await communityMembers(coachId),
        type: "announcement",
        actorId: profile.id,
        actorName: profile.display_name,
        postId: created.id,
        link: `/community/post/${created.id}`,
        groupKey: `announcement:${created.id}`,
        title: {
          text: "{name} posted an announcement",
          vars: { name: profile.display_name },
        },
        body: post.body.slice(0, 120) || { text: "Tap to read it." },
        snippet: post.body,
      });
    });
  }

  revalidatePath("/community");
  return { id: created.id };
}

// Copies one of the person's own progress photos into their community folder, so deleting the
// post never touches the private original (and deleting the original never breaks the post).
async function copyProgressPhoto(userId: string, photoId: string) {
  const supabase = await createClient();
  const { data: photo } = await supabase
    .from("progress_photos")
    .select("path")
    .eq("id", photoId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!photo) return null;
  const admin = createAdminClient();
  const { data: file } = await admin.storage
    .from("progress-photos")
    .download(photo.path as string);
  if (!file) return null;
  const extension = extensionOf(photo.path as string);
  const contentType = PHOTO_TYPES[extension];
  if (!contentType) return null;
  const path = `${userId}/progress-${randomUUID()}/0.${extension}`;
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, file, { contentType });
  if (error) return null;
  return { path, width: null, height: null };
}

const editSchema = z.object({
  id: idSchema,
  body: z.string().trim().max(POST_BODY_MAX),
  kind: z.enum(POST_KIND_VALUES),
});

export async function updatePost(input: unknown): Promise<{ error?: string }> {
  await requireAccount();
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .update({
      body: parsed.data.body,
      kind: parsed.data.kind,
      edited_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.id)
    .select("id");
  if (error || !data?.length) return { error: "You can't edit that post." };
  revalidatePath("/community");
  return {};
}

// Deletes the post and its files. Only the author can.
export async function deletePost(postId: string): Promise<{ error?: string }> {
  const { profile } = await requireAccount();
  const id = idSchema.safeParse(postId);
  if (!id.success) return { error: "That post wasn't found." };
  const supabase = await createClient();
  const { data: media } = await supabase
    .from("post_media")
    .select("path, video_uid, post:posts!inner(author_id)")
    .eq("post_id", id.data)
    .eq("post.author_id", profile.id);
  const { data, error } = await supabase
    .from("posts")
    .delete()
    .eq("id", id.data)
    .eq("author_id", profile.id)
    .select("id");
  if (error || !data?.length) return { error: "You can't delete that post." };

  const rows = (media ?? []) as {
    path: string | null;
    video_uid: string | null;
  }[];
  const paths = rows.flatMap((row) => (row.path ? [row.path] : []));
  if (paths.length)
    await createAdminClient().storage.from(BUCKET).remove(paths);
  await Promise.all(
    rows.flatMap((row) =>
      row.video_uid ? [deleteVideo(row.video_uid).catch(console.error)] : [],
    ),
  );
  revalidatePath("/community");
  return {};
}

export async function loadMorePosts(
  offset: number,
  coachId: string | null = null,
): Promise<{ posts: PostDTO[]; more: boolean }> {
  const { profile } = await requireAccount();
  const safeOffset =
    Number.isInteger(offset) && offset >= 0 && offset <= 10000 ? offset : 0;
  const coach = coachId && idSchema.safeParse(coachId).success ? coachId : null;
  const { posts, more } = await loadFeed(profile.id, safeOffset, coach);
  return { posts, more };
}

// Likes ---------------------------------------------------------------------------------------

export async function toggleLike(
  postId: string,
): Promise<{ error?: string; liked?: boolean; count?: number }> {
  const { profile } = await requireAccount();
  const id = idSchema.safeParse(postId);
  if (!id.success) return { error: "That post wasn't found." };
  const supabase = await createClient();
  // Row security: you can only see, and so like, posts you're allowed to see.
  const { data: post } = await supabase
    .from("posts")
    .select("id, author_id")
    .eq("id", id.data)
    .maybeSingle();
  if (!post) return { error: "That post wasn't found." };

  const { data: removed } = await supabase
    .from("post_likes")
    .delete()
    .eq("post_id", id.data)
    .eq("user_id", profile.id)
    .select("post_id");
  let liked = false;
  if (!removed?.length) {
    const { error } = await supabase
      .from("post_likes")
      .insert({ post_id: id.data, user_id: profile.id });
    if (error && error.code !== "23505")
      return { error: "That didn't work. Please try again." };
    liked = true;
  }
  const { data: fresh } = await supabase
    .from("posts")
    .select("like_count")
    .eq("id", id.data)
    .maybeSingle();

  if (liked)
    after(() =>
      notifyCommunity({
        recipients: [post.author_id as string],
        type: "like",
        actorId: profile.id,
        actorName: profile.display_name,
        postId: id.data,
        link: `/community/post/${id.data}`,
        groupKey: `like:${id.data}`,
        title: { text: "New like" },
        body: {
          text: "{name} liked your post.",
          vars: { name: profile.display_name },
        },
      }),
    );
  return {
    liked,
    count: (fresh?.like_count as number | undefined) ?? undefined,
  };
}

// Comments ------------------------------------------------------------------------------------

const RECENT_COMMENT_LIMIT = 30; // comments per 5 minutes

const commentSchema = z.object({
  postId: idSchema,
  parentId: idSchema.nullable(),
  body: z
    .string()
    .trim()
    .min(1, "Write something first")
    .max(
      COMMENT_MAX,
      `Keep comments under ${COMMENT_MAX.toLocaleString()} characters`,
    ),
});

const COMMENT_COLUMNS =
  "id, post_id, parent_id, author_id, body, created_at, edited_at";

export async function addComment(
  input: unknown,
): Promise<{ error?: string; comment?: CommentDTO }> {
  const { profile } = await requireAccount();
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { postId, parentId, body } = parsed.data;
  const supabase = await createClient();

  const { count } = await supabase
    .from("post_comments")
    .select("id", { count: "exact", head: true })
    .eq("author_id", profile.id)
    .gte("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString());
  if ((count ?? 0) >= RECENT_COMMENT_LIMIT)
    return { error: "You're commenting a lot. Try again in a few minutes." };

  // Row security decides whether this person can see (and so comment on) the post.
  const { data: post } = await supabase
    .from("posts")
    .select("id, author_id, kind")
    .eq("id", postId)
    .maybeSingle();
  if (!post) return { error: "That post wasn't found." };

  let parentAuthor: string | null = null;
  if (parentId) {
    const { data: parent } = await supabase
      .from("post_comments")
      .select("author_id, parent_id")
      .eq("id", parentId)
      .eq("post_id", postId)
      .maybeSingle();
    if (!parent || parent.parent_id)
      return { error: "You can reply to a comment, not to a reply." };
    parentAuthor = parent.author_id as string;
  }

  const { data: row, error } = await supabase
    .from("post_comments")
    .insert({
      post_id: postId,
      author_id: profile.id,
      parent_id: parentId,
      body,
    })
    .select(COMMENT_COLUMNS)
    .single();
  if (error || !row)
    return {
      error:
        error?.code === "42501"
          ? "You can't comment on that post."
          : "We couldn't post that comment. Please try again.",
    };

  const link = `/community/post/${postId}#comments`;
  const preview = body.slice(0, 120);
  after(async () => {
    const postAuthor = post.author_id as string;
    if (postAuthor !== parentAuthor)
      await notifyCommunity({
        recipients: [postAuthor],
        type: post.kind === "progress" ? "progress_reply" : "comment",
        actorId: profile.id,
        actorName: profile.display_name,
        postId,
        commentId: row.id as string,
        link,
        groupKey: `comment:${postId}`,
        title: {
          text: "{name} commented on your post",
          vars: { name: profile.display_name },
        },
        body: preview,
        snippet: body,
      });
    if (parentAuthor)
      await notifyCommunity({
        recipients: [parentAuthor],
        type: "reply",
        actorId: profile.id,
        actorName: profile.display_name,
        postId,
        commentId: row.id as string,
        link,
        groupKey: `reply:${parentId}`,
        title: {
          text: "{name} replied to you",
          vars: { name: profile.display_name },
        },
        body: preview,
        snippet: body,
      });
  });

  return {
    comment: {
      id: row.id as string,
      postId: row.post_id as string,
      parentId: row.parent_id as string | null,
      body: row.body as string,
      author: {
        id: profile.id,
        name: profile.display_name,
        role: profile.role,
      },
      createdAt: row.created_at as string,
      editedAt: row.edited_at as string | null,
      mine: true,
    },
  };
}

export async function updateComment(
  commentId: string,
  body: string,
): Promise<{ error?: string }> {
  const { profile } = await requireAccount();
  const id = idSchema.safeParse(commentId);
  const text = commentSchema.shape.body.safeParse(body);
  if (!id.success) return { error: "That comment wasn't found." };
  if (!text.success) return { error: text.error.issues[0].message };
  const supabase = await createClient();
  const { data } = await supabase
    .from("post_comments")
    .update({ body: text.data, edited_at: new Date().toISOString() })
    .eq("id", id.data)
    .eq("author_id", profile.id)
    .select("id");
  return data?.length ? {} : { error: "You can't edit that comment." };
}

export async function deleteComment(
  commentId: string,
): Promise<{ error?: string }> {
  const { profile } = await requireAccount();
  const id = idSchema.safeParse(commentId);
  if (!id.success) return { error: "That comment wasn't found." };
  const supabase = await createClient();
  const { data } = await supabase
    .from("post_comments")
    .delete()
    .eq("id", id.data)
    .eq("author_id", profile.id)
    .select("id");
  return data?.length ? {} : { error: "You can't delete that comment." };
}

// Names for comments that arrive live. Only display names and roles, which every member sees.
export async function commentAuthors(
  ids: string[],
): Promise<Record<string, { id: string; name: string; role: string }>> {
  await requireAccount();
  const valid = (Array.isArray(ids) ? ids : [])
    .slice(0, 50)
    .filter((id) => idSchema.safeParse(id).success);
  return Object.fromEntries(await loadAuthors(valid));
}

// A coach removing a post from their own community. The database checks the right to do it
// (private.can_moderate) and closes any open reports on the post.
export async function removePost(
  postId: string,
  reason: string,
): Promise<{ error?: string }> {
  const { profile } = await requireAccount();
  const id = idSchema.safeParse(postId);
  const why = z
    .string()
    .trim()
    .max(500)
    .safeParse(reason ?? "");
  if (!id.success) return { error: "That post wasn't found." };
  if (!why.success) return { error: "Keep the reason under 500 characters." };
  const supabase = await createClient();
  const { data: post } = await supabase
    .from("posts")
    .select("id, author_id")
    .eq("id", id.data)
    .maybeSingle();
  if (!post) return { error: "That post wasn't found." };
  const { error } = await supabase.rpc("remove_post", {
    target_post_id: id.data,
    reason: why.data,
  });
  if (error)
    return {
      error:
        error.code === "42501"
          ? "You can't remove this post."
          : "We couldn't remove that post. Please try again.",
    };
  after(() =>
    notifyCommunity({
      recipients: [post.author_id as string],
      type: "removed",
      actorId: profile.id,
      actorName: profile.display_name,
      postId: id.data,
      link: "/community",
      groupKey: `removed:${id.data}`,
      title: { text: "A post of yours was removed" },
      body: why.data
        ? { text: "Reason: {reason}", vars: { reason: why.data } }
        : { text: "It broke the community guidelines." },
      snippet: why.data,
    }),
  );
  revalidatePath("/community");
  revalidatePath("/moderation");
  return {};
}

// Reports ---------------------------------------------------------------------------------------

const reportSchema = z
  .object({
    postId: idSchema.nullable(),
    commentId: idSchema.nullable(),
    reason: z.enum(
      REPORT_REASONS.map((item) => item.value) as [string, ...string[]],
      "Choose a reason",
    ),
    details: z
      .string()
      .trim()
      .max(REPORT_DETAILS_MAX, "Keep the details under 1,000 characters"),
  })
  .refine((report) => Boolean(report.postId) !== Boolean(report.commentId), {
    message: "Choose a post or a comment to report",
  });

const REPORTS_PER_DAY = 20;

export async function reportContent(
  input: unknown,
): Promise<{ error?: string }> {
  const { profile } = await requireAccount();
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { count } = await supabase
    .from("content_reports")
    .select("id", { count: "exact", head: true })
    .eq("reporter_id", profile.id)
    .gte(
      "created_at",
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    );
  if ((count ?? 0) >= REPORTS_PER_DAY)
    return { error: "You've sent a lot of reports today. Try again tomorrow." };
  // Row security: people can only report posts and comments they can see.
  const { error } = await supabase.from("content_reports").insert({
    reporter_id: profile.id,
    post_id: parsed.data.postId,
    comment_id: parsed.data.commentId,
    reason: parsed.data.reason,
    details: parsed.data.details,
  });
  if (error?.code === "23505") return {}; // Already reported and still open.
  if (error)
    return { error: "We couldn't send that report. Please try again." };
  return {};
}

// Moderators (shared feed), admins (any shared post) and coaches (their own community).
export async function removeComment(
  commentId: string,
  reason: string,
): Promise<{ error?: string }> {
  const { profile } = await requireAccount();
  const id = idSchema.safeParse(commentId);
  const why = z
    .string()
    .trim()
    .max(500)
    .safeParse(reason ?? "");
  if (!id.success) return { error: "That comment wasn't found." };
  if (!why.success) return { error: "Keep the reason under 500 characters." };
  const supabase = await createClient();
  const { data: comment } = await supabase
    .from("post_comments")
    .select("id, author_id, post_id")
    .eq("id", id.data)
    .maybeSingle();
  if (!comment) return { error: "That comment wasn't found." };
  const { error } = await supabase.rpc("remove_comment", {
    target_comment_id: id.data,
    reason: why.data,
  });
  if (error)
    return {
      error:
        error.code === "42501"
          ? "You can't remove this comment."
          : "We couldn't remove that comment. Please try again.",
    };
  after(() =>
    notifyCommunity({
      recipients: [comment.author_id as string],
      type: "removed",
      actorId: profile.id,
      actorName: profile.display_name,
      postId: comment.post_id as string,
      commentId: id.data,
      link: `/community/post/${comment.post_id}`,
      groupKey: `removed:${id.data}`,
      title: { text: "A comment of yours was removed" },
      body: why.data
        ? { text: "Reason: {reason}", vars: { reason: why.data } }
        : { text: "It broke the community guidelines." },
      snippet: why.data,
    }),
  );
  revalidatePath("/moderation");
  return {};
}

export async function dismissReports(
  reportIds: string[],
): Promise<{ error?: string }> {
  await requireAccount();
  const ids = (Array.isArray(reportIds) ? reportIds : [])
    .slice(0, 100)
    .filter((id) => idSchema.safeParse(id).success);
  if (ids.length === 0) return { error: "Nothing to dismiss." };
  const supabase = await createClient();
  for (const id of ids) {
    // The database checks the right to handle each report.
    const { error } = await supabase.rpc("dismiss_report", {
      target_report_id: id,
    });
    if (error)
      return {
        error:
          error.code === "42501"
            ? "You can't handle this report."
            : "We couldn't dismiss that. Please try again.",
      };
  }
  revalidatePath("/moderation");
  return {};
}

// "Looks fine" on an automatically flagged post. The database checks the right to review it.
export async function clearPostFlag(
  postId: string,
): Promise<{ error?: string }> {
  await requireAccount();
  const id = idSchema.safeParse(postId);
  if (!id.success) return { error: "That post wasn't found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("clear_post_flag", {
    target_post_id: id.data,
  });
  if (error)
    return {
      error:
        error.code === "42501"
          ? "You can't review this post."
          : "That didn't work. Please try again.",
    };
  revalidatePath("/moderation");
  return {};
}
