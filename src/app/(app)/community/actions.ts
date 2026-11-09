"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAccount } from "@/lib/auth";
import {
  MAX_PHOTO_BYTES,
  MAX_POST_PHOTOS,
  PHOTO_TYPES,
  POST_BODY_MAX,
  POST_KIND_VALUES,
  type PostDTO,
} from "@/lib/community";
import { loadFeed } from "@/lib/community-server";
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
  })
  .refine(
    (post) => post.body.length > 0 || post.photos.length > 0 || post.videoUid,
    {
      message: "Write something or add a photo or video",
    },
  )
  .refine((post) => !(post.photos.length && post.videoUid), {
    message: "Add photos or one video, not both",
  })
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
    ...post.photos.map((photo, position) => ({
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

  revalidatePath("/community");
  return { id: created.id };
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
