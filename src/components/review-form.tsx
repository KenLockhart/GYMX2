"use client";

import { deleteReview, saveReview } from "@/app/(app)/coaches/review-actions";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { REVIEW_MAX } from "@/lib/public-pages";

export function ReviewForm({
  coachId,
  coachName,
  existing,
}: {
  coachId: string;
  coachName: string;
  existing: { rating: number; body: string; hidden: boolean } | null;
}) {
  return (
    <div className="max-w-xl space-y-3">
      <ActionForm action={saveReview} className="space-y-3">
        <input type="hidden" name="coach_id" value={coachId} />
        <fieldset>
          <legend className="text-sm font-medium">Your rating</legend>
          <div className="mt-1 flex gap-1">
            {[1, 2, 3, 4, 5].map((value) => (
              <label key={value} className="cursor-pointer">
                <input
                  type="radio"
                  name="rating"
                  value={value}
                  required
                  defaultChecked={existing?.rating === value}
                  className="peer sr-only"
                />
                <span className="grid size-10 place-items-center rounded-lg border border-border bg-surface text-lg peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-accent">
                  {value}★
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">
            What&apos;s it like training with {coachName}? (optional)
          </span>
          <textarea
            name="body"
            rows={3}
            maxLength={REVIEW_MAX}
            defaultValue={existing?.body}
            className="field-input"
          />
        </label>
        <p className="text-xs text-muted">
          Shown on {coachName}&apos;s public page with your first name and last
          initial.
          {existing?.hidden &&
            " A GYMX2 admin has hidden this review from public pages."}
        </p>
        <div className="flex items-center gap-3">
          <SubmitButton pendingText="Saving..." className="btn-primary">
            {existing ? "Update review" : "Post review"}
          </SubmitButton>
          <FormStatus />
        </div>
      </ActionForm>
      {existing && (
        <ActionForm action={deleteReview} confirmMessage="Remove your review?">
          <input type="hidden" name="coach_id" value={coachId} />
          <SubmitButton
            pendingText="Removing..."
            className="text-sm text-muted hover:text-danger"
          >
            Remove my review
          </SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
