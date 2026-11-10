import type { Metadata } from "next";
import Link from "next/link";
import { CredentialDecision } from "@/components/credential-decision";
import { requireAdmin } from "@/lib/auth";
import {
  displayStatus,
  DISPLAY_LABEL,
  kindLabel,
  type CredentialRowStatus,
} from "@/lib/credentials";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Credential verification" };

type Row = {
  id: string;
  coach_id: string;
  kind: string;
  organization: string;
  title: string;
  credential_number: string;
  issued_on: string | null;
  expires_on: string | null;
  document_path: string | null;
  status: CredentialRowStatus;
  verification_source: string;
  verified_at: string | null;
  updated_at: string;
  coach: { display_name: string } | null;
};

export default async function CredentialQueuePage() {
  await requireAdmin();
  const supabase = await createClient();
  const columns =
    "id, coach_id, kind, organization, title, credential_number, issued_on, expires_on, document_path, status, verification_source, verified_at, updated_at, coach:profiles!coach_id(display_name)";
  const [{ data: pendingData }, { data: recentData }] = await Promise.all([
    supabase
      .from("coach_credentials")
      .select(columns)
      .eq("status", "pending")
      .order("updated_at"),
    supabase
      .from("coach_credentials")
      .select(columns)
      .in("status", ["verified", "rejected"])
      .order("updated_at", { ascending: false })
      .limit(20),
  ]);
  const pending = (pendingData ?? []) as unknown as Row[];
  const recent = (recentData ?? []) as unknown as Row[];

  const paths = pending.flatMap((row) =>
    row.document_path ? [row.document_path] : [],
  );
  const { data: signed } = paths.length
    ? await createAdminClient()
        .storage.from("credential-docs")
        .createSignedUrls(paths, 60 * 30)
    : { data: [] };
  const docUrl = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  const { data: events } = pending.length
    ? await supabase
        .from("credential_events")
        .select("credential_id, action, note, created_at")
        .in(
          "credential_id",
          pending.map((row) => row.id),
        )
        .order("created_at")
    : { data: [] };

  return (
    <div className="space-y-8">
      <Link href="/admin" className="text-link text-sm">
        Back to Admin
      </Link>
      <div>
        <h1 className="text-5xl">Credential verification</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Check each certificate with the organization that issued it (most have
          an online lookup by name or certificate number), then record where you
          checked. Never verify from the document alone. Documents and numbers
          are private to admins.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-3xl">Waiting ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-muted">
            Nothing waiting.
          </p>
        ) : (
          <ul className="space-y-4">
            {pending.map((row) => (
              <li
                key={row.id}
                className="space-y-3 rounded-2xl border border-border bg-surface p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-lg font-semibold">
                      {row.title}{" "}
                      <span className="text-muted">· {row.organization}</span>
                    </p>
                    <p className="text-sm text-muted">
                      {kindLabel(row.kind)} for{" "}
                      <Link
                        href={`/admin/coach-profiles/${row.coach_id}`}
                        className="text-link"
                      >
                        {row.coach?.display_name ?? "a coach"}
                      </Link>
                    </p>
                  </div>
                  {row.document_path && docUrl.get(row.document_path) && (
                    <a
                      href={docUrl.get(row.document_path) ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-secondary px-3 py-1.5 text-sm"
                    >
                      Open certificate
                    </a>
                  )}
                </div>
                <dl className="grid gap-2 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-muted">Number</dt>
                    <dd>{row.credential_number || "Not given"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Issued</dt>
                    <dd>{row.issued_on ?? "Not given"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Expires</dt>
                    <dd>
                      {row.expires_on ?? "Not given"}
                      {row.expires_on &&
                        row.expires_on <
                          new Date().toISOString().slice(0, 10) && (
                          <span className="text-danger"> (expired)</span>
                        )}
                    </dd>
                  </div>
                </dl>
                <ol className="space-y-0.5 text-xs text-muted">
                  {(events ?? [])
                    .filter((e) => e.credential_id === row.id)
                    .map((e, i) => (
                      <li key={i}>
                        {new Date(e.created_at as string).toLocaleString(
                          "en-US",
                          { timeZone: "America/New_York" },
                        )}
                        : {e.action as string}
                        {e.note ? ` (${e.note as string})` : ""}
                      </li>
                    ))}
                </ol>
                <CredentialDecision id={row.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {recent.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-3xl">Recently decided</h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {recent.map((row) => {
              const shown = displayStatus(row.status, row.expires_on);
              return (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm"
                >
                  <span>
                    <span className="font-semibold">
                      {row.coach?.display_name}
                    </span>
                    : {row.title} ({row.organization})
                  </span>
                  <span className="text-muted">
                    {shown ? DISPLAY_LABEL[shown] : "Rejected"}
                    {row.verification_source && ` · ${row.verification_source}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
