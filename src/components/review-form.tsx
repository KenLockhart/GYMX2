"use client";

import { deleteReview, saveReview } from "@/app/(app)/coaches/review-actions";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { REVIEW_MAX } from "@/lib/public-pages";
import { REVIEW_CATEGORIES } from "@/lib/reviews";

export function ReviewForm({
  coachId,
  coachName,
  existing,
}: {
  coachId: string;
  coachName: string;
  existing:
    | ({ rating: number; body: string; hidden: boolean } & Partial<
        Record<string, number | null | string | boolean>
      >)
    | null;
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
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            Rate the details (optional)
          </legend>
          <div className="space-y-1.5">
            {REVIEW_CATEGORIES.map((category) => (
              <div
                key={category.column}
                className="grid gap-1 sm:grid-cols-[9rem_1fr] sm:items-center"
              >
                <span id={`${category.column}-label`} className="text-sm">
                  {category.label}
                </span>
                <div
                  role="radiogroup"
                  aria-labelledby={`${category.column}-label`}
                  className="flex gap-1"
                >
                  <label className="cursor-pointer">
                    <input
                      type="radio"
                      name={category.column}
                      value=""
                      defaultChecked={!existing?.[category.column]}
                      className="peer sr-only"
                    />
                    <span className="grid h-8 place-items-center rounded-md border border-border px-2 text-xs text-muted peer-checked:border-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent">
                      Skip
                    </span>
                  </label>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <label key={value} className="cursor-pointer">
                      <input
                        type="radio"
                        name={category.column}
                        value={value}
                        defaultChecked={existing?.[category.column] === value}
                        aria-label={`${value} out of 5`}
                        className="peer sr-only"
                      />
                      <span className="grid size-8 place-items-center rounded-md border border-border text-sm peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-accent">
                        {value}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
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
