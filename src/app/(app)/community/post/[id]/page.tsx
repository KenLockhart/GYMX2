import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CommentThread } from "@/components/comment-thread";
import { PostCard } from "@/components/post-card";
import { requireAccount } from "@/lib/auth";
import { loadComments, loadPost } from "@/lib/community-server";
import { idSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Post" };

export default async function PostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await requireAccount();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  // Row security: a post you're not allowed to see looks the same as one that doesn't exist.
  const post = await loadPost(profile.id, id);
  if (!post) notFound();
  const comments = await loadComments(post.id, profile.id);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/community" className="text-link text-sm">
        Back to Community
      </Link>
      <PostCard post={post} viewerRole={profile.role} linkToPost={false} />
      <CommentThread postId={post.id} initialComments={comments} />
    </div>
  );
}
