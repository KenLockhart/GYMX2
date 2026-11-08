"use client";

import {
  ActionForm,
  Field,
  FormStatus,
  SubmitButton,
} from "@/components/form-parts";
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
    label: "Website",
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
  return (
    <ActionForm action={updateProfile} className="max-w-xl space-y-6">
      <section className="space-y-4">
        <Field
          label="Name"
          name="display_name"
          defaultValue={profile.display_name}
          maxLength={80}
          required
        />
        <Field label="Email" value={email} disabled readOnly />
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Bio</span>
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
        <h2 className="text-2xl">Social links</h2>
        {socialFields.map((field) => (
          <Field
            key={field.name}
            label={field.label}
            name={field.name}
            type="url"
            placeholder={field.placeholder}
            defaultValue={profile[field.name] ?? ""}
          />
        ))}
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl">Emails</h2>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="email_updates"
            defaultChecked={profile.email_updates}
            className="mt-0.5 size-4 accent-accent"
          />
          <span>
            Email me about messages, sessions and reminders
            <span className="block text-muted">
              Includes session and Task-due reminders, streak nudges and a
              Monday summary. We always email about your orders.
            </span>
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
            I want to coach on GYMX2.
            <span className="block text-muted">
              An admin reviews every coach request.
            </span>
          </span>
        </label>
      )}

      <FormStatus />
      <SubmitButton pendingText="Saving..." className="btn-primary">
        Save profile
      </SubmitButton>
    </ActionForm>
  );
}
