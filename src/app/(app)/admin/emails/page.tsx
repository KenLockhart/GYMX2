import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { EMAIL_CATALOG, EMAIL_GROUPS } from "@/lib/email-catalog";
import { loadEmailCopy } from "@/lib/email";

export const metadata: Metadata = { title: "Emails" };

export default async function AdminEmailsPage() {
  await requireAdmin();
  const copy = await loadEmailCopy(true);

  return (
    <div className="space-y-8">
      <Link href="/admin" className="text-link text-sm">
        Back to admin
      </Link>
      <div>
        <h1 className="text-5xl">Emails</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Every email GYMX2 sends on its own. Open one to change its subject,
          heading, main message and button, add a note, or turn off an optional
          reminder. Order details, addresses, links and quoted messages always
          stay.
        </p>
      </div>

      {EMAIL_GROUPS.map((group) => (
        <section key={group} className="space-y-2">
          <h2 className="text-2xl">{group}</h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {EMAIL_CATALOG.filter((entry) => entry.group === group).map(
              (entry) => {
                const saved = copy.get(entry.key);
                const status = !saved
                  ? "Default"
                  : saved.enabled
                    ? "Customized"
                    : "Off";
                return (
                  <li key={entry.key}>
                    <Link
                      href={`/admin/emails/${entry.key}`}
                      className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-surface-raised"
                    >
                      <span>
                        <span className="font-semibold">{entry.name}</span>
                        <span className="block text-sm text-muted">
                          To {entry.to.toLowerCase()} · {entry.when}
                        </span>
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-semibold ${
                          status === "Customized"
                            ? "bg-accent text-accent-foreground"
                            : status === "Off"
                              ? "bg-danger text-white"
                              : "border border-border text-muted"
                        }`}
                      >
                        {status}
                      </span>
                    </Link>
                  </li>
                );
              },
            )}
          </ul>
        </section>
      ))}

      <section className="space-y-2">
        <h2 className="text-2xl">Sign-in emails</h2>
        <p className="max-w-2xl text-sm text-muted">
          The account confirmation, password reset and email change emails are
          sent by Supabase, so they&apos;re edited in Supabase under
          Authentication → Emails → Templates.
        </p>
        <a
          href="https://supabase.com/dashboard/project/vftmkwwqioysetghbruk/auth/templates"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary inline-block"
        >
          Open Supabase email templates
        </a>
      </section>
    </div>
  );
}
