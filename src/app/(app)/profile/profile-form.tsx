"use client";

import {
  ActionForm,
  Field,
  FormStatus,
  SubmitButton,
} from "@/components/form-parts";
import { useT } from "@/i18n/client";
import type { Profile } from "@/lib/types";
import { updateProfile } from "./actions";

const socialFields = [
  {
    name: "instagram_url",
    label: "Instagram",
    placeholder: "https://instagram.com/yourname",
  },
  {
    name: "tiktok_url",
    label: "TikTok",
    placeholder: "https://tiktok.com/@yourname",
  },
  {
    name: "youtube_url",
    label: "YouTube",
    placeholder: "https://youtube.com/@yourname",
  },
  { name: "x_url", label: "X", placeholder: "https://x.com/yourname" },
  {
    name: "website_url",
    label: "website",
    placeholder: "https://yourwebsite.com",
  },
] as const;

export function ProfileForm({
  profile,
  email,
}: {
  profile: Profile;
  email: string;
}) {
  const t = useT();
  const f = t.profile.form;
  return (
    <ActionForm action={updateProfile} className="max-w-xl space-y-6">
      <section className="space-y-4">
        <Field
          label={t.auth.name}
          name="display_name"
          defaultValue={profile.display_name}
          maxLength={80}
          required
        />
        <Field label={t.auth.email} value={email} disabled readOnly />
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{f.bio}</span>
          <textarea
            name="bio"
            rows={4}
            maxLength={1000}
            defaultValue={profile.bio}
            className="field-input"
          />
        </label>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl">{f.social}</h2>
        {socialFields.map((field) => (
          <Field
            key={field.name}
            label={field.label === "website" ? f.website : field.label}
            name={field.name}
            type="url"
            placeholder={field.placeholder}
            defaultValue={profile[field.name] ?? ""}
          />
        ))}
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl">{f.emails}</h2>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="email_updates"
            defaultChecked={profile.email_updates}
            className="mt-0.5 size-4 accent-accent"
          />
          <span>
            {f.emailUpdates}
            <span className="block text-muted">{f.emailUpdatesHint}</span>
          </span>
        </label>
      </section>

      {profile.role === "member" && (
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="coach_requested"
            defaultChecked={profile.coach_requested}
            className="mt-0.5 size-4 accent-accent"
          />
          <span>
            {t.auth.signup.coach}
            <span className="block text-muted">{t.auth.signup.coachHint}</span>
          </span>
        </label>
      )}

      <FormStatus />
      <SubmitButton pendingText={t.common.saving} className="btn-primary">
        {f.save}
      </SubmitButton>
    </ActionForm>
  );
}
