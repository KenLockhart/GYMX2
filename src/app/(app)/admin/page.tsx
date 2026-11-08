import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AdminUser } from "@/lib/types";
import { RoleForm } from "./role-form";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  await requireAdmin();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_users");
  const users = (data ?? []) as AdminUser[];
  const requests = users.filter((user) => user.coach_requested).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-5xl">Admin</h1>
        <p className="mt-2 text-muted">
          {users.length} {users.length === 1 ? "person" : "people"}, {requests} coach{" "}
          {requests === 1 ? "request" : "requests"} waiting
        </p>
      </div>
        <Link href="/admin/messages" className="btn-secondary">
          Review conversations
        </Link>
      </div>

      {error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load the user list. Please refresh and try again.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {users.map((user) => (
            <li
              key={user.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-semibold">
                  {user.display_name}
                  {user.coach_requested && (
                    <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-xs font-semibold text-accent-foreground">
                      Coach request
                    </span>
                  )}
                </p>
                <p className="truncate text-sm text-muted">{user.email}</p>
              </div>
              <RoleForm user={user} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
