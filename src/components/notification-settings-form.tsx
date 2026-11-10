"use client";

import { useState, useTransition } from "react";
import { saveNotificationSettings } from "@/app/(app)/notifications/actions";
import {
  NOTIFICATION_SETTINGS,
  type NotificationType,
} from "@/lib/notifications";

export type SettingValue = {
  type: NotificationType;
  inApp: boolean;
  push: boolean;
  email: boolean;
};

export function NotificationSettingsForm({
  initial,
}: {
  initial: SettingValue[];
}) {
  const [settings, setSettings] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function change(
    type: NotificationType,
    field: "inApp" | "push" | "email",
    value: boolean,
  ) {
    setMessage(null);
    setSettings((current) =>
      current.map((s) => (s.type === type ? { ...s, [field]: value } : s)),
    );
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    start(async () => {
      const result = await saveNotificationSettings(settings);
      if (result.error) return setError(result.error);
      setMessage("Saved.");
    });
  }

  return (
    <form onSubmit={save} className="max-w-xl space-y-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted">
            <th className="py-2 font-medium">Notify me about</th>
            <th className="w-20 py-2 text-center font-medium">In app</th>
            <th className="w-20 py-2 text-center font-medium">Phone</th>
            <th className="w-20 py-2 text-center font-medium">Email</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {NOTIFICATION_SETTINGS.map((meta) => {
            const value = settings.find((s) => s.type === meta.type)!;
            return (
              <tr key={meta.type}>
                <td className="py-2 pr-3">
                  {meta.label}
                  {meta.hint && (
                    <span className="block text-xs text-muted">
                      {meta.hint}
                    </span>
                  )}
                </td>
                <td className="py-2 text-center">
                  {meta.inApp ? (
                    <input
                      type="checkbox"
                      aria-label={`${meta.label}: in app`}
                      checked={value.inApp}
                      onChange={(event) =>
                        change(meta.type, "inApp", event.target.checked)
                      }
                    />
                  ) : (
                    <span
                      className="text-muted"
                      aria-label="Not in the notification center"
                    >
                      —
                    </span>
                  )}
                </td>
                <td className="py-2 text-center">
                  <input
                    type="checkbox"
                    aria-label={`${meta.label}: phone`}
                    checked={value.push}
                    onChange={(event) =>
                      change(meta.type, "push", event.target.checked)
                    }
                  />
                </td>
                <td className="py-2 text-center">
                  <input
                    type="checkbox"
                    aria-label={`${meta.label}: email`}
                    checked={value.email}
                    onChange={(event) =>
                      change(meta.type, "email", event.target.checked)
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Saving..." : "Save notification settings"}
        </button>
        {message && (
          <p role="status" className="text-sm text-accent">
            {message}
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
