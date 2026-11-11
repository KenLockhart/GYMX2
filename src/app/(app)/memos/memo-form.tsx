"use client";

import { useEffect, useRef } from "react";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { useT } from "@/i18n/client";
import type { Memo } from "@/lib/types";
import { saveMemo } from "./actions";

export function MemoForm({
  memo,
  canShare,
}: {
  memo?: Memo;
  canShare: boolean;
}) {
  const t = useT().memos;
  const dateInput = useRef<HTMLInputElement>(null);

  // "Today" depends on where the person is, which only their browser knows.
  useEffect(() => {
    if (memo || !dateInput.current) return;
    const now = new Date();
    const offsetMs = now.getTimezoneOffset() * 60 * 1000;
    dateInput.current.value = new Date(now.getTime() - offsetMs)
      .toISOString()
      .slice(0, 10);
  }, [memo]);

  return (
    <ActionForm
      key={memo?.id ?? "new"}
      action={saveMemo}
      className="space-y-4 rounded-lg border border-border bg-surface p-4"
    >
      <input type="hidden" name="id" value={memo?.id ?? ""} />
      <label className="block space-y-1.5 sm:max-w-48">
        <span className="text-sm font-medium">{t.date}</span>
        <input
          ref={dateInput}
          type="date"
          name="memo_date"
          defaultValue={memo?.memo_date}
          required
          className="field-input"
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">
          {memo ? t.editNote : t.howToday}
        </span>
        <textarea
          name="body"
          rows={4}
          maxLength={5000}
          defaultValue={memo?.body}
          required
          className="field-input"
        />
      </label>
      {canShare && (
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="shared_with_coaches"
            defaultChecked={memo?.shared_with_coaches}
            className="mt-0.5 size-4 accent-accent"
          />
          <span>
            {t.share}
            <span className="block text-muted">{t.shareHint}</span>
          </span>
        </label>
      )}
      <FormStatus />
      <SubmitButton pendingText={t.saving} className="btn-primary">
        {memo ? t.saveChanges : t.save}
      </SubmitButton>
    </ActionForm>
  );
}
