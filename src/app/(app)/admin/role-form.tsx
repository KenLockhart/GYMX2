"use client";

import { ActionForm, FormStatus, SubmitButton } from "@/components/form-parts";
import type { AdminUser } from "@/lib/types";
import { setUserRole } from "./actions";

export function RoleForm({ user }: { user: AdminUser }) {
  return (
    <ActionForm action={setUserRole} className="space-y-2">
      <input type="hidden" name="user_id" value={user.id} />
      <div className="flex flex-wrap items-center gap-2">
        <select
          name="role"
          defaultValue={user.coach_requested ? "coach" : user.role}
          aria-label={`Role for ${user.display_name}`}
          className="field-input w-auto py-2 text-sm"
        >
          <option value="member">Member</option>
          <option value="coach">Coach</option>
          <option value="moderator">Moderator</option>
          <option value="admin">Admin</option>
        </select>
        <SubmitButton
          pendingText="Saving..."
          className="btn-secondary px-3 py-2 text-sm"
        >
          Save
        </SubmitButton>
      </div>
      <FormStatus />
    </ActionForm>
  );
}
