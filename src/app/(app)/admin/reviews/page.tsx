import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import { requireAdmin } from "@/lib/auth";
import { stars } from "@/lib/public-pages";
import { createAdminClient } from "@/lib/supabase/admin";
import { setReviewHidden } from "../../coaches/review-actions";

export const metadata: Metadata = { title: "Reviews" };

type Review = {
  id: string;
  rating: number;
  body: string;
  hidden: boolean;
  created_at: string;
  coach: {
    id: string;
    display_name: string;
    public_slug: string | null;
  } | null;
  member: { display_name: string } | null;
};

export default async function AdminReviewsPage() {
  await requireAdmin();
  const { data } = await createAdminClient()
    .from("coach_reviews")
    .select(
      "id, rating, body, hidden, created_at, coach:profiles!coach_id(id, display_name, public_slug), member:profiles!member_id(display_name)",
    )
    .order("created_at", { ascending: false })
    .limit(300);
  const reviews = (data ?? []) as unknown as Review[];

  return (
    <div className="space-y-6">
      <Link href="/admin" className="text-link text-sm">
        Back to admin
      </Link>
      <div>
        <h1 className="text-5xl">Reviews</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Members review coaches they joined, and reviews appear on
          coaches&apos; public pages. Hide anything abusive, off-topic or fake.
          The member can still see it, marked as hidden.
        </p>
      </div>
      {reviews.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          No reviews yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {reviews.map((review) => (
            <li
              key={review.id}
              className={`flex flex-col gap-3 rounded-lg border bg-surface p-4 text-sm sm:flex-row sm:items-start sm:justify-between ${
                review.hidden ? "border-danger opacity-75" : "border-border"
              }`}
            >
              <div className="space-y-1">
                <p>
                  <span className="text-accent">{stars(review.rating)}</span>{" "}
                  {review.member?.display_name ?? "Former member"} on{" "}
                  {review.coach?.public_slug ? (
                    <Link
                      href={`/c/${review.coach.public_slug}`}
                      className="text-link"
                    >
                      {review.coach.display_name}
                    </Link>
                  ) : (
                    review.coach?.display_name
                  )}
                  {review.hidden && (
                    <span className="ml-2 font-semibold text-danger">
                      Hidden
                    </span>
                  )}
                </p>
                {review.body && (
                  <p className="whitespace-pre-line">{review.body}</p>
                )}
                <p className="text-xs text-muted">
                  {new Date(review.created_at).toLocaleDateString("en-US")}
                </p>
              </div>
              <ActionForm
                action={setReviewHidden}
                className="shrink-0 space-y-1"
              >
                <input type="hidden" name="review_id" value={review.id} />
                <input
                  type="hidden"
                  name="hidden"
                  value={review.hidden ? "false" : "true"}
                />
                <SubmitButton
                  pendingText="Saving..."
                  className="btn-secondary px-3 py-2 text-sm"
                >
                  {review.hidden ? "Show again" : "Hide"}
                </SubmitButton>
                <FormStatus />
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
