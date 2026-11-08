import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Message } from "@/lib/types";
import { idSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Review conversation" };

// Times are shown in UTC with the zone named, so screenshots shared between admins agree.
function formatUtc(iso: string) {
  return `${new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  })} UTC`;
}

export default async function ReviewConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ coachId: string; memberId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireAdmin();
  const { coachId, memberId } = await params;
  if (!idSchema.safeParse(coachId).success || !idSchema.safeParse(memberId).success) notFound();
  const query = (await searchParams).q;
  const highlight = typeof query === "string" ? query.trim().toLowerCase() : "";

  const supabase = await createClient();
  const [messageResult, peopleResult, connectionResult] = await Promise.all([
    supabase
      .from("messages")
      .select("id, coach_id, member_id, sender_id, body, read_at, created_at")
      .eq("coach_id", coachId)
      .eq("member_id", memberId)
      .order("created_at")
      .limit(2000),
    supabase.from("profiles").select("id, display_name").in("id", [coachId, memberId]),
    supabase
      .from("coach_members")
      .select("coach_id")
      .eq("coach_id", coachId)
      .eq("member_id", memberId)
      .maybeSingle(),
  ]);

  const messages = (messageResult.data ?? []) as Message[];
  if (!messageResult.error && messages.length === 0) notFound();
  const names = new Map((peopleResult.data ?? []).map((person) => [person.id as string, person.display_name as string]));
  const coachName = names.get(coachId) ?? "Unknown coach";
  const memberName = names.get(memberId) ?? "Unknown member";

  return (
    <div className="space-y-6">
      <Link href={`/admin/messages${highlight ? `?q=${encodeURIComponent(highlight)}` : ""}`} className="text-link text-sm">
        Back to conversations
      </Link>
      <div>
        <h1 className="text-4xl">
          {coachName} · {memberName}
        </h1>
        <p className="mt-2 text-sm text-muted">
          Coach: {coachName} · Member: {memberName} ·{" "}
          {connectionResult.data ? "Still connected" : "No longer connected"} · {messages.length} messages ·
          Read-only
        </p>
      </div>

      {messageResult.error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load this conversation. Please refresh and try again.
        </p>
      ) : (
        <ol className="space-y-3 rounded-lg border border-border bg-surface p-4">
          {messages.map((message) => {
            const fromCoach = message.sender_id === coachId;
            const matches = highlight && message.body.toLowerCase().includes(highlight);
            return (
              <li key={message.id} className={`flex flex-col ${fromCoach ? "items-start" : "items-end"}`}>
                <span className="mb-1 text-xs text-muted">
                  {fromCoach ? `${coachName} (coach)` : `${memberName} (member)`} · {formatUtc(message.created_at)}
                </span>
                <p
                  className={`max-w-[85%] whitespace-pre-line break-words rounded-2xl px-4 py-2 sm:max-w-[70%] ${
                    matches ? "bg-accent text-accent-foreground" : "bg-surface-raised"
                  }`}
                >
                  {message.body}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
