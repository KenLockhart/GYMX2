import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth";
import { preview, summarizeConversations } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import type { Message } from "@/lib/types";
import { loadContacts } from "./contacts";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage() {
  const { profile } = await requireAccount();

  if (profile.role === "admin") redirect("/admin/messages");

  const supabase = await createClient();
  const [{ contacts, error: contactError }, messageResult] = await Promise.all([
    loadContacts(profile),
    // Row security limits this to the viewer's own conversations.
    supabase
      .from("messages")
      .select(
        "coach_id, member_id, sender_id, body, read_at, created_at, coach:profiles!coach_id(display_name), member:profiles!member_id(display_name)",
      )
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const rows = (messageResult.data ?? []) as unknown as (Pick<
    Message,
    "coach_id" | "member_id" | "sender_id" | "body" | "read_at" | "created_at"
  > & { coach: { display_name: string } | null; member: { display_name: string } | null })[];

  // Names for people the viewer has messaged before but is no longer connected with.
  const formerNames = new Map<string, string>();
  for (const row of rows) {
    if (row.coach?.display_name) formerNames.set(row.coach_id, row.coach.display_name);
    if (row.member?.display_name) formerNames.set(row.member_id, row.member.display_name);
  }
  const conversations = summarizeConversations(contacts, rows, profile.id, formerNames);
  const isCoach = profile.role === "coach";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-5xl">Messages</h1>
        <p className="mt-2 max-w-xl text-muted">
          {isCoach ? "Conversations with your members." : "Conversations with your coaches."} Only the
          two of you and GYMX2 admins can read them. Admins may review conversations to keep coaches
          and members safe.
        </p>
      </div>

      {contactError || messageResult.error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load your messages. Please refresh and try again.
        </p>
      ) : conversations.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          {isCoach ? (
            "When members join you, you can message them here."
          ) : (
            <>
              <Link href="/coaches" className="text-link">
                Join a coach
              </Link>{" "}
              to start a conversation.
            </>
          )}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <Link
                href={`/messages/${conversation.id}`}
                className="flex items-center justify-between gap-4 p-4 hover:bg-surface-raised"
              >
                <div className="min-w-0">
                  <p className={conversation.unread ? "font-bold" : "font-semibold"}>
                    {conversation.display_name}
                    {!conversation.connected && <span className="ml-2 text-xs font-normal text-muted">Not connected</span>}
                  </p>
                  <p className="mt-1 truncate text-sm text-muted">
                    {conversation.last
                      ? `${conversation.last.sender_id === profile.id ? "You: " : ""}${preview(conversation.last.body)}`
                      : "No messages yet"}
                  </p>
                </div>
                {conversation.unread > 0 && (
                  <span className="shrink-0 rounded-full bg-accent px-2.5 py-0.5 text-xs font-bold text-accent-foreground">
                    {conversation.unread}
                    <span className="sr-only"> unread</span>
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
