import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { getLocale, getT } from "@/i18n/server";
import { requireAccount } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Memo } from "@/lib/types";
import { deleteMemo } from "./actions";
import { MemoForm } from "./memo-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).memos.title };
}

export default async function MemosPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { profile } = await requireAccount();
  const { edit } = await searchParams;
  const t = (await getT()).memos;
  const locale = await getLocale();

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
        <h1 className="text-5xl">{t.title}</h1>
        <p className="mt-2 max-w-xl text-muted">
          {t.intro} {canShare ? t.introShare : t.introPrivate}
        </p>
      </div>

      <MemoForm memo={editing} canShare={canShare} />
      {editing && (
        <Link href="/memos" className="text-link inline-block text-sm">
          {t.cancelEditing}
        </Link>
      )}

      {error ? (
        <p role="alert" className="text-danger">
          {t.loadError}
        </p>
      ) : memos.length === 0 ? (
        <p className="text-muted">{t.none}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {memos.map((memo) => (
            <li key={memo.id} className="space-y-2 p-4">
              <p className="text-sm text-muted">
                {formatDate(memo.memo_date, locale)}
                {memo.shared_with_coaches && t.shared}
              </p>
              <p className="whitespace-pre-line">{memo.body}</p>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <Link href={`/memos?edit=${memo.id}`} className="text-link">
                  {t.edit}
                </Link>
                <ActionForm
                  action={deleteMemo}
                  confirmMessage={t.confirmDelete}
                  className="flex flex-wrap items-center gap-3"
                >
                  <input type="hidden" name="id" value={memo.id} />
                  <SubmitButton
                    pendingText={t.deleting}
                    className="cursor-pointer font-medium text-muted hover:text-foreground"
                  >
                    {t.delete}
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
