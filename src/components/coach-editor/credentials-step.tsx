"use client";

import { useRef, useState, useTransition } from "react";
import {
  addCredential,
  attachCredentialDocument,
  deleteCredential,
  prepareCredentialDocument,
  requestVerification,
} from "@/app/(app)/profile/coach/credential-actions";
import {
  CREDENTIAL_KINDS,
  type CredentialKind,
  DISPLAY_LABEL,
  KNOWN_ORGANIZATIONS,
  kindLabel,
} from "@/lib/credentials";
import type { OwnCredential } from "@/lib/credentials-server";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { Note, SelectInput, TextInput } from "./fields";
import { T, useTr } from "@/i18n/t";

const EMPTY = {
  kind: "certification" as CredentialKind,
  organization: "",
  title: "",
  credentialNumber: "",
  issuedOn: "",
  expiresOn: "",
};

const TONE = {
  verified: "border-success/50 text-success",
  pending: "border-border text-foreground",
  unverified: "border-border text-muted",
  expired: "border-border text-muted",
} as const;

export function CredentialsStep({
  credentials,
  onChange,
}: {
  credentials: OwnCredential[];
  onChange: (credentials: OwnCredential[]) => void;
}) {
  const tr = useTr();
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(credentials.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadFor, setUploadFor] = useState<string | null>(null);

  function run(
    action: () => Promise<{ error?: string; credentials?: OwnCredential[] }>,
    after?: () => void,
  ) {
    setError(null);
    start(async () => {
      const result = await action();
      if (result.error) return setError(result.error);
      if (result.credentials) onChange(result.credentials);
      after?.();
    });
  }

  function upload(file: File | undefined) {
    const id = uploadFor;
    if (!file || !id) return;
    run(async () => {
      const prepared = await prepareCredentialDocument({
        name: file.name,
        size: file.size,
      });
      if (!prepared.path || !prepared.token)
        return { error: prepared.error ?? tr("Upload failed.") };
      const { error: uploadError } = await createBrowserSupabase()
        .storage.from("credential-docs")
        .uploadToSignedUrl(prepared.path, prepared.token, file, {
          contentType: file.type,
        });
      if (uploadError)
        return { error: "The document didn't upload. Please try again." };
      return attachCredentialDocument(id, prepared.path);
    });
  }

  return (
    <div className="space-y-5">
      <Note>
        <T>
          Add each certification, then upload the certificate and ask GYMX2 to
          verify it. An admin checks it with the organization that issued it.
          Members see only the name, organization and status: never your ID
          number or documents. Only GYMX2 can mark a credential Verified, and
          expired ones never show as verified.
        </T>
      </Note>

      {credentials.length > 0 && (
        <ul className="space-y-3">
          {credentials.map((c) => (
            <li
              key={c.id}
              className="space-y-3 rounded-xl border border-border p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{c.title}</p>
                  <p className="text-sm text-muted">
                    {c.organization} ·{" "}
                    <T>
                      <T>{kindLabel(c.kind)}</T>
                    </T>
                    {c.expiresOn && ` · expires ${c.expiresOn}`}
                  </p>
                </div>
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${c.shown ? TONE[c.shown] : "border-danger/60 text-danger"}`}
                >
                  <T>
                    {c.shown
                      ? DISPLAY_LABEL[c.shown]
                      : "Not verified: see note"}
                  </T>
                </span>
              </div>
              {c.status === "rejected" && c.adminNote && (
                <p className="rounded-lg bg-surface-raised p-3 text-sm">
                  <span className="font-semibold">
                    <T>GYMX2 note:</T>
                  </span>{" "}
                  {c.adminNote}
                </p>
              )}
              <div className="flex flex-wrap gap-2 text-sm">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setUploadFor(c.id);
                    fileInput.current?.click();
                  }}
                  className="btn-secondary px-3 py-1.5 text-sm"
                >
                  {c.hasDocument
                    ? tr("Replace document")
                    : tr("Upload certificate")}
                </button>
                {(c.status === "unverified" || c.status === "rejected") && (
                  <button
                    type="button"
                    disabled={pending || !c.hasDocument}
                    title={
                      c.hasDocument
                        ? undefined
                        : tr("Upload the certificate first")
                    }
                    onClick={() => run(() => requestVerification(c.id))}
                    className="btn-primary px-3 py-1.5 text-sm"
                  >
                    <T>Ask GYMX2 to verify</T>
                  </button>
                )}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (
                      window.confirm(tr("Remove {title}?", { title: c.title }))
                    )
                      run(() => deleteCredential(c.id));
                  }}
                  className="cursor-pointer px-2 text-muted hover:text-danger"
                >
                  <T>Remove</T>
                </button>
              </div>
              {c.hasDocument && c.status !== "verified" && (
                <p className="text-xs text-muted">
                  <T>
                    Certificate uploaded. Changing any detail sends it back for
                    checking.
                  </T>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        hidden
        onChange={(event) => {
          upload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      {adding ? (
        <div className="space-y-4 rounded-xl border border-dashed border-border p-4">
          <p className="font-semibold">
            <T>Add a credential</T>
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectInput
              label={tr("Type")}
              value={form.kind}
              options={CREDENTIAL_KINDS}
              onChange={(v) => v && setForm({ ...form, kind: v })}
            />
            <div className="space-y-1.5">
              <TextInput
                label={tr("Organization")}
                value={form.organization}
                onChange={(v) => setForm({ ...form, organization: v })}
                max={100}
                placeholder={tr("NASM")}
                hint={tr("Who issued it")}
              />
              <div className="flex flex-wrap gap-1">
                {KNOWN_ORGANIZATIONS.slice(0, 6).map((org) => (
                  <button
                    key={org}
                    type="button"
                    onClick={() => setForm({ ...form, organization: org })}
                    className="cursor-pointer rounded-full border border-border px-2 py-0.5 text-xs text-muted hover:text-foreground"
                  >
                    {org}
                  </button>
                ))}
              </div>
            </div>
            <TextInput
              label={tr("Credential name")}
              value={form.title}
              onChange={(v) => setForm({ ...form, title: v })}
              max={120}
              placeholder={tr("Certified Personal Trainer")}
            />
            <TextInput
              label={tr("Certificate or license number (private)")}
              value={form.credentialNumber}
              onChange={(v) => setForm({ ...form, credentialNumber: v })}
              max={80}
              hint={tr("Only GYMX2 admins see this, to look it up.")}
            />
            <label className="block space-y-1.5">
              <span className="block text-sm font-semibold">
                <T>Issued</T>
              </span>
              <input
                type="date"
                value={form.issuedOn}
                onChange={(e) => setForm({ ...form, issuedOn: e.target.value })}
                className="field-input"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="block text-sm font-semibold">
                <T>Expires</T>
              </span>
              <input
                type="date"
                value={form.expiresOn}
                onChange={(e) =>
                  setForm({ ...form, expiresOn: e.target.value })
                }
                className="field-input"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  () => addCredential(form),
                  () => {
                    setForm(EMPTY);
                    setAdding(false);
                  },
                )
              }
              className="btn-primary"
            >
              {pending ? tr("Adding...") : tr("Add credential")}
            </button>
            {credentials.length > 0 && (
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="btn-secondary"
              >
                <T>Cancel</T>
              </button>
            )}
          </div>
        </div>
      ) : (
        credentials.length < 20 && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="btn-secondary px-4 py-2 text-sm"
          >
            <T>Add another credential</T>
          </button>
        )
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {tr(error)}
        </p>
      )}
    </div>
  );
}
