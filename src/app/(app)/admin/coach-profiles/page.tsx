import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { profileCompletion, readDraft } from "@/lib/coach-draft";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Coach profiles" };

const LABEL: Record<string, string> = {
  submitted: "Waiting for review",
  changes_requested: "Changes requested",
  approved: "Approved",
  draft: "Draft",
};

export default async function CoachProfilesAdminPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: drafts }, { data: published }] = await Promise.all([
    supabase
      .from("coach_profile_drafts")
      .select(
        "coach_id, data, photo_path, status, submitted_at, updated_at, coach:profiles!coach_id(display_name)",
      )
      .order("submitted_at", { ascending: true, nullsFirst: false }),
    supabase.from("coach_profiles_public").select("coach_id, published_at"),
  ]);
  const live = new Map(
    (published ?? []).map((row) => [
      row.coach_id as string,
      row.published_at as string,
    ]),
  );
  const rows = (
    (drafts ?? []) as unknown as {
      coach_id: string;
      data: unknown;
      photo_path: string | null;
      status: string;
      submitted_at: string | null;
      updated_at: string;
      coach: { display_name: string } | null;
    }[]
  ).sort(
    (a, b) =>
      Number(b.status === "submitted") - Number(a.status === "submitted"),
  );
  const waiting = rows.filter((row) => row.status === "submitted").length;

  return (
    <div className="space-y-6">
      <Link href="/admin" className="text-link text-sm">
        Back to Admin
      </Link>
      <div>
        <h1 className="text-5xl">Coach profiles</h1>
        <p className="mt-2 text-muted">
          {waiting === 0
            ? "Nothing waiting for review."
            : `${waiting} ${waiting === 1 ? "profile is" : "profiles are"} waiting for review.`}{" "}
          Approving publishes exactly what you reviewed; later edits wait for
          another review.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          No coach has started a profile yet.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {rows.map((row) => {
            const completion = profileCompletion(
              readDraft(row.data),
              Boolean(row.photo_path),
            );
            return (
              <li
                key={row.coach_id}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div>
                  <Link
                    href={`/admin/coach-profiles/${row.coach_id}`}
                    className="text-link font-semibold"
                  >
                    {row.coach?.display_name ?? "Coach"}
                  </Link>
                  <p className="text-sm text-muted">
                    {LABEL[row.status] ?? row.status} · {completion.percent}%
                    complete
                    {live.has(row.coach_id) ? " · Live" : ""}
                  </p>
                </div>
                {row.status === "submitted" && (
                  <Link
                    href={`/admin/coach-profiles/${row.coach_id}`}
                    className="btn-primary px-4 py-2 text-sm"
                  >
                    Review
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
