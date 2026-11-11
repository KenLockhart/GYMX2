"use client";

import { savePublicPage } from "@/app/(app)/profile/public-page-actions";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { useT } from "@/i18n/client";

export function PublicPageForm({ slug, on }: { slug: string; on: boolean }) {
  const t = useT();
  const p = t.profile.publicPage;
  return (
    <ActionForm action={savePublicPage} className="max-w-xl space-y-3">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{p.address}</span>
        <span className="flex items-center rounded-lg border border-border bg-surface focus-within:border-accent">
          <span className="pl-3 text-sm text-muted">gymx2.com/c/</span>
          <input
            name="public_slug"
            defaultValue={slug}
            required
            minLength={3}
            maxLength={40}
            pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
            className="min-w-0 flex-1 bg-transparent px-1 py-2 outline-none"
          />
        </span>
      </label>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="public_page"
          defaultChecked={on}
          className="mt-0.5 size-4 accent-accent"
        />
        <span>
          {p.on}
          <span className="block text-muted">{p.onHint}</span>
        </span>
      </label>
      <div className="flex items-center gap-3">
        <SubmitButton pendingText={t.common.saving} className="btn-secondary">
          {p.save}
        </SubmitButton>
        <FormStatus />
      </div>
    </ActionForm>
  );
}
