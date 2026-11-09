"use client";

import { useMemo, useState } from "react";
import {
  resetEmailCopy,
  saveEmailCopy,
  sendTestEmail,
} from "@/app/(app)/admin/emails/actions";
import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import {
  customizeEmail,
  type Email,
  type EmailCopy,
} from "@/lib/email-templates";

type Fields = EmailCopy & { enabled: boolean };

const FIELDS: {
  name: keyof EmailCopy;
  label: string;
  max: number;
  rows?: number;
  hint: string;
}[] = [
  {
    name: "subject",
    label: "Subject",
    max: 150,
    hint: "The subject line in the inbox.",
  },
  {
    name: "heading",
    label: "Heading",
    max: 150,
    hint: "The large title at the top of the email.",
  },
  {
    name: "intro",
    label: "Main message",
    max: 2000,
    rows: 4,
    hint: "Replaces the first paragraph.",
  },
  {
    name: "button_label",
    label: "Button",
    max: 60,
    hint: "The button text. Where it links can't change.",
  },
  {
    name: "note",
    label: "Extra note (optional)",
    max: 2000,
    rows: 3,
    hint: "An extra paragraph before the button.",
  },
];

export function EmailEditor({
  entryKey,
  optional,
  sample,
  defaults,
  saved,
  adminEmail,
}: {
  entryKey: string;
  optional: boolean;
  sample: Email;
  defaults: {
    subject: string;
    heading: string;
    intro: string;
    button_label: string;
  };
  saved: (EmailCopy & { enabled: boolean }) | null;
  adminEmail: string;
}) {
  const [fields, setFields] = useState<Fields>({
    subject: saved?.subject ?? "",
    heading: saved?.heading ?? "",
    intro: saved?.intro ?? "",
    button_label: saved?.button_label ?? "",
    note: saved?.note ?? "",
    enabled: saved?.enabled ?? true,
  });
  const preview = useMemo(
    () => customizeEmail(sample, fields),
    [sample, fields],
  );
  const placeholders = Object.entries(sample.vars ?? {});

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-6">
        <ActionForm action={saveEmailCopy} className="space-y-4">
          <input type="hidden" name="key" value={entryKey} />
          {optional && (
            <label className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3 text-sm">
              <input
                type="checkbox"
                name="enabled"
                checked={fields.enabled}
                onChange={(event) =>
                  setFields({ ...fields, enabled: event.target.checked })
                }
                className="mt-0.5 size-4 accent-accent"
              />
              <span>
                Send this email
                <span className="block text-muted">
                  Turn off to stop it for everyone. Push notifications
                  aren&apos;t affected.
                </span>
              </span>
            </label>
          )}
          {FIELDS.map((field) => {
            const fallback =
              field.name === "note"
                ? ""
                : defaults[field.name as keyof typeof defaults];
            return (
              <label key={field.name} className="block space-y-1.5">
                <span className="text-sm font-medium">{field.label}</span>
                {field.rows ? (
                  <textarea
                    name={field.name}
                    rows={field.rows}
                    maxLength={field.max}
                    value={fields[field.name]}
                    onChange={(event) =>
                      setFields({ ...fields, [field.name]: event.target.value })
                    }
                    placeholder={fallback || undefined}
                    className="field-input"
                  />
                ) : (
                  <input
                    name={field.name}
                    maxLength={field.max}
                    value={fields[field.name]}
                    onChange={(event) =>
                      setFields({ ...fields, [field.name]: event.target.value })
                    }
                    placeholder={fallback || undefined}
                    className="field-input"
                  />
                )}
                <span className="block text-xs text-muted">
                  {field.hint}
                  {fallback &&
                    " Leave empty to keep the default shown in grey."}
                </span>
              </label>
            );
          })}
          {placeholders.length > 0 && (
            <div className="space-y-1 text-sm">
              <p className="font-medium">Placeholders</p>
              <p className="text-xs text-muted">
                Type these and GYMX2 fills in the real details for each person.
              </p>
              <ul className="flex flex-wrap gap-2">
                {placeholders.map(([name, example]) => (
                  <li
                    key={name}
                    className="rounded bg-surface-raised px-2 py-1 text-xs"
                  >
                    <code>{`{${name}}`}</code>{" "}
                    <span className="text-muted">
                      e.g. {example || "(empty)"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton pendingText="Saving..." className="btn-primary">
              Save
            </SubmitButton>
            <FormStatus />
          </div>
        </ActionForm>

        <div className="flex flex-wrap gap-3 border-t border-border pt-4">
          <ActionForm action={sendTestEmail} className="space-y-1">
            <input type="hidden" name="key" value={entryKey} />
            <SubmitButton pendingText="Sending..." className="btn-secondary">
              Send saved version to {adminEmail}
            </SubmitButton>
            <FormStatus />
          </ActionForm>
          {saved && (
            <ActionForm
              action={resetEmailCopy}
              confirmMessage="Go back to the default wording and turn this email on?"
              className="space-y-1"
            >
              <input type="hidden" name="key" value={entryKey} />
              <SubmitButton
                pendingText="Resetting..."
                className="btn-secondary"
              >
                Reset to default
              </SubmitButton>
              <FormStatus />
            </ActionForm>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Preview with example details</p>
        <p className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          <span className="text-muted">Subject: </span>
          {preview.subject}
        </p>
        {!fields.enabled && (
          <p className="text-sm text-danger">
            This email is turned off and won&apos;t be sent.
          </p>
        )}
        <iframe
          title="Email preview"
          srcDoc={preview.html}
          sandbox=""
          className="h-[640px] w-full rounded-lg border border-border bg-white"
        />
      </div>
    </div>
  );
}
