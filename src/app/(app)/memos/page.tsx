import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { requireAccount } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Memo } from "@/lib/types";
import { deleteMemo } from "./actions";
import { MemoForm } from "./memo-form";

export const metadata: Metadata = { title: "Memos" };

export default async function MemosPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { profile } = await requireAccount();
  const { edit } = await searchParams;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memos")
    .select("id, user_id, memo_date, body, shared_with_coaches")
    .eq("user_id", profile.id)
    .order("memo_date", { ascending: false })
    .order("created_at", { ascending: false });
  const memos = (data ?? []) as Memo[];
  const editing = memos.find((memo) => memo.id === edit);
  const canShare = profile.role === "member";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-5xl">Memos</h1>
        <p className="mt-2 max-w-xl text-muted">
          Keep short notes on your days.{" "}
          {canShare ? "They're private unless you choose to share one with your coaches." : "They're private to you."}
        </p>
      </div>

      <MemoForm memo={editing} canShare={canShare} />
      {editing && (
        <Link href="/memos" className="text-link inline-block text-sm">
          Cancel editing
        </Link>
      )}

      {error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load your Memos. Please refresh and try again.
        </p>
      ) : memos.length === 0 ? (
        <p className="text-muted">You haven&apos;t written a Memo yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {memos.map((memo) => (
            <li key={memo.id} className="space-y-2 p-4">
              <p className="text-sm text-muted">
                {formatDate(memo.memo_date)}
                {memo.shared_with_coaches && " · Shared with your coaches"}
              </p>
              <p className="whitespace-pre-line">{memo.body}</p>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <Link href={`/memos?edit=${memo.id}`} className="text-link">
                  Edit
                </Link>
                <ActionForm
                  action={deleteMemo}
                  confirmMessage="Delete this Memo? This can't be undone."
                  className="flex flex-wrap items-center gap-3"
                >
                  <input type="hidden" name="id" value={memo.id} />
                  <SubmitButton
                    pendingText="Deleting..."
                    className="cursor-pointer font-medium text-muted hover:text-foreground"
                  >
                    Delete
                  </SubmitButton>
                  <FormStatus />
                </ActionForm>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
