import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmailEditor } from "@/components/email-editor";
import { requireAdmin } from "@/lib/auth";
import { catalogEntry } from "@/lib/email-catalog";
import { loadEmailCopy } from "@/lib/email";
import { getSiteUrl } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Edit email" };

export default async function EditEmailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { email } = await requireAdmin();
  const entry = catalogEntry((await params).key);
  if (!entry) notFound();
  const saved = (await loadEmailCopy(true)).get(entry.key) ?? null;
  const sample = entry.sample(getSiteUrl());
  const defaultIntro =
    sample.parts?.blocks[0]?.kind === "p" ? sample.parts.blocks[0].text : "";

  return (
    <div className="space-y-6">
      <Link href="/admin/emails" className="text-link text-sm">
        All emails
      </Link>
      <div>
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">
          {entry.group}
        </p>
        <h1 className="mt-1 text-4xl">{entry.name}</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Sent to {entry.to.toLowerCase()} when:{" "}
          {entry.when.charAt(0).toLowerCase() + entry.when.slice(1)}.
          {!entry.optional &&
            " This one always sends because people rely on it."}
        </p>
      </div>
      <EmailEditor
        entryKey={entry.key}
        optional={entry.optional}
        sample={{
          subject: sample.subject,
          html: sample.html,
          text: sample.text,
          key: sample.key,
          vars: sample.vars,
          parts: sample.parts,
        }}
        defaults={{
          subject: sample.parts?.subject ?? sample.subject,
          heading: sample.parts?.heading ?? "",
          intro: defaultIntro,
          button_label: sample.parts?.button.label ?? "",
        }}
        saved={saved}
        adminEmail={email}
      />
    </div>
  );
}
