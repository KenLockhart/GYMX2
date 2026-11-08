import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { describeFlags } from "@/lib/message-flags";
import { groupForReview, preview } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import type { Message } from "@/lib/types";

export const metadata: Metadata = { title: "Review conversations" };

export default async function ReviewConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const query = params.q;
  const search = typeof query === "string" ? query.trim().slice(0, 100) : "";
  const flaggedOnly = params.show === "flagged";

  // Admins can read every conversation. Searching narrows to messages that mention a word,
  // such as a phone number, "Venmo" or another app, to spot coaches moving members off GYMX2.
  const supabase = await createClient();
  let request = supabase
    .from("messages")
    .select(
      "coach_id, member_id, sender_id, body, created_at, coach:profiles!coach_id(display_name), member:profiles!member_id(display_name)",
    )
    .order("created_at", { ascending: false })
    .limit(2000);
  if (search)
    request = request.ilike(
      "body",
      `%${search.replace(/[%_\\]/g, (char) => `\\${char}`)}%`,
    );
  const { data, error } = await request;

  const conversations = groupForReview(
    (data ?? []) as unknown as (Pick<
      Message,
      "coach_id" | "member_id" | "sender_id" | "body" | "created_at"
    > & {
      coach: { display_name: string } | null;
      member: { display_name: string } | null;
    })[],
    { flaggedOnly },
  );
  const filterLink = (flagged: boolean) => {
    const query = new URLSearchParams();
    if (search) query.set("q", search);
    if (flagged) query.set("show", "flagged");
    const text = query.toString();
    return `/admin/messages${text ? `?${text}` : ""}`;
  };
  const tabClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-semibold ${active ? "bg-accent text-accent-foreground" : "border border-border hover:bg-surface-raised"}`;

  return (
    <div className="space-y-6">
      <Link href="/admin" className="text-link text-sm">
        Back to admin
      </Link>
      <div>
        <h1 className="text-5xl">Review conversations</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Read-only. Coaches and members are told admins may review their
          messages. Opening a conversation here doesn&apos;t mark anything as
          read.
        </p>
      </div>

      <nav aria-label="Filter conversations" className="flex gap-2">
        <Link
          href={filterLink(false)}
          className={tabClass(!flaggedOnly)}
          aria-current={!flaggedOnly ? "page" : undefined}
        >
          All
        </Link>
        <Link
          href={filterLink(true)}
          className={tabClass(flaggedOnly)}
          aria-current={flaggedOnly ? "page" : undefined}
        >
          Flagged
        </Link>
      </nav>
      <p className="max-w-2xl text-sm text-muted">
        Flagged means a message mentions a phone number, an email address, a
        payment app such as Venmo or Cash App, or talking somewhere else.
        It&apos;s a reason to look, not proof.
      </p>

      <form className="flex max-w-xl gap-2" role="search">
        {flaggedOnly && <input type="hidden" name="show" value="flagged" />}
        <label htmlFor="review-search" className="sr-only">
          Search messages
        </label>
        <input
          id="review-search"
          name="q"
          defaultValue={search}
          placeholder="Search messages, e.g. phone, Venmo, WhatsApp"
          className="field-input"
        />
        <button type="submit" className="btn-secondary">
          Search
        </button>
      </form>

      {error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load conversations. Please refresh and try again.
        </p>
      ) : conversations.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          {search
            ? `No ${flaggedOnly ? "flagged " : ""}messages mention "${search}".`
            : flaggedOnly
              ? "Nothing flagged. No message mentions phone numbers, emails, payment apps or talking elsewhere."
              : "No conversations yet."}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {conversations.map((conversation) => (
            <li key={`${conversation.coach_id}:${conversation.member_id}`}>
              <Link
                href={`/admin/messages/${conversation.coach_id}/${conversation.member_id}${
                  search ? `?q=${encodeURIComponent(search)}` : ""
                }`}
                className="block p-4 hover:bg-surface-raised"
              >
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
                  <span>
                    {conversation.coach_name}{" "}
                    <span className="text-muted">(coach)</span> ·{" "}
                    {conversation.member_name}{" "}
                    <span className="text-muted">(member)</span>
                  </span>
                  {conversation.flagged > 0 && (
                    <span className="rounded-full border border-danger px-2 py-0.5 text-xs font-semibold text-danger">
                      {conversation.flagged} flagged ·{" "}
                      {describeFlags(conversation.flags)}
                    </span>
                  )}
                </p>
                <p className="mt-1 truncate text-sm text-muted">
                  {search
                    ? `${conversation.count} matching · `
                    : `${conversation.count} messages · `}
                  {preview(conversation.last.body)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
