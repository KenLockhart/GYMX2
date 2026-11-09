import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Chat } from "@/components/chat";
import { requireAccount } from "@/lib/auth";
import { attachPhotos } from "@/lib/message-photos";
import { createClient } from "@/lib/supabase/server";
import type { Message } from "@/lib/types";
import { idSchema } from "@/lib/validation";
import { loadContacts } from "../contacts";

export const metadata: Metadata = { title: "Conversation" };

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { profile } = await requireAccount();
  if (profile.role === "admin") redirect("/admin/messages");
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();

  const isCoach = profile.role === "coach";
  const pair = isCoach
    ? { coach_id: profile.id, member_id: id }
    : { coach_id: id, member_id: profile.id };

  const supabase = await createClient();
  const [{ contacts }, messageResult] = await Promise.all([
    loadContacts(profile),
    supabase
      .from("messages")
      .select(
        "id, coach_id, member_id, sender_id, body, read_at, created_at, other:profiles!" +
          (isCoach ? "member_id" : "coach_id") +
          "(display_name)",
      )
      .eq("coach_id", pair.coach_id)
      .eq("member_id", pair.member_id)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const contact = contacts.find((person) => person.id === id);
  const rows = (messageResult.data ?? []) as unknown as (Message & {
    other: { display_name: string } | null;
  })[];
  const displayName =
    contact?.display_name ??
    rows[0]?.other?.display_name ??
    (rows.length > 0 ? "Former contact" : undefined);
  // Only people the viewer is connected with, or has talked to before, have a conversation page.
  if (!displayName) notFound();

  // Opening the conversation marks what the other person sent as read.
  if (rows.some((row) => row.sender_id === id && row.read_at === null)) {
    await supabase.rpc("mark_conversation_read", { other_user_id: id });
  }

  const plain: Message[] = rows.reverse().map((row) => ({
    id: row.id,
    coach_id: row.coach_id,
    member_id: row.member_id,
    sender_id: row.sender_id,
    body: row.body,
    read_at: row.read_at,
    created_at: row.created_at,
  }));
  const messages = await attachPhotos(plain);

  return (
    <div className="space-y-6">
      <Link href="/messages" className="text-link text-sm">
        Back to messages
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-4xl">{displayName}</h1>
        {contact && (
          <Link
            href={isCoach ? `/members/${id}` : `/coaches/${id}`}
            className="text-link text-sm"
          >
            {isCoach ? "Member details" : "Coach profile"}
          </Link>
        )}
      </div>
      {messageResult.error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load this conversation. Please refresh and try again.
        </p>
      ) : (
        <Chat
          me={profile.id}
          other={{ id, display_name: displayName }}
          pair={pair}
          initialMessages={messages}
          canSend={Boolean(contact)}
        />
      )}
    </div>
  );
}
