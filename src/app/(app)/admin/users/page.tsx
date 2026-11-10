import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AdminUser } from "@/lib/types";
import { RoleForm } from "../role-form";

export const metadata: Metadata = { title: "Members and roles" };

const FILTERS = [
  { key: "all", label: "Everyone" },
  { key: "requests", label: "Coach requests" },
  { key: "member", label: "Members" },
  { key: "coach", label: "Coaches" },
  { key: "moderator", label: "Moderators" },
  { key: "admin", label: "Admins" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

// Everyone on GYMX2, with the controls to make someone a coach, moderator or admin.
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; q?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const show: Filter = FILTERS.some((f) => f.key === params.show)
    ? (params.show as Filter)
    : "all";
  const query = (params.q ?? "").trim().slice(0, 100);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_users");
  const everyone = ((data ?? []) as AdminUser[]).toSorted(
    (a, b) =>
      Number(b.coach_requested) - Number(a.coach_requested) ||
      b.created_at.localeCompare(a.created_at),
  );
  const isRequest = (u: AdminUser) => u.coach_requested && u.role === "member";
  const counts: Record<Filter, number> = {
    all: everyone.length,
    requests: everyone.filter(isRequest).length,
    member: everyone.filter((u) => u.role === "member").length,
    coach: everyone.filter((u) => u.role === "coach").length,
    moderator: everyone.filter((u) => u.role === "moderator").length,
    admin: everyone.filter((u) => u.role === "admin").length,
  };
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const users = everyone
    .filter((u) =>
      show === "all"
        ? true
        : show === "requests"
          ? isRequest(u)
          : u.role === show,
    )
    .filter((u) =>
      words.every((w) =>
        `${u.display_name} ${u.email}`.toLowerCase().includes(w),
      ),
    );
  const href = (key: Filter) => {
    const next = new URLSearchParams();
    if (key !== "all") next.set("show", key);
    if (query) next.set("q", query);
    const s = next.toString();
    return `/admin/users${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-accent">
          People
        </p>
        <h1 className="mt-1 text-4xl sm:text-5xl">Members and roles</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Approve coach requests and set who is a member, coach, moderator or
          admin. Making someone a coach lets them build a profile, which you
          approve under Coach profiles before members can find them.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav
          aria-label="Filter people"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
        >
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={href(f.key)}
              aria-current={show === f.key ? "page" : undefined}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${
                show === f.key
                  ? "border-accent bg-accent font-semibold text-accent-foreground"
                  : "border-border text-muted hover:text-foreground"
              }`}
            >
              {f.label} ({counts[f.key]})
            </Link>
          ))}
        </nav>
        <form action="/admin/users" className="flex gap-2">
          {show !== "all" && <input type="hidden" name="show" value={show} />}
          <label htmlFor="people-search" className="sr-only">
            Search by name or email
          </label>
          <input
            id="people-search"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Name or email"
            className="field-input w-full sm:w-56"
          />
          <button type="submit" className="btn-secondary">
            Search
          </button>
        </form>
      </div>

      {error ? (
        <p role="alert" className="text-danger">
          We couldn&apos;t load the user list. Please refresh and try again.
        </p>
      ) : users.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface p-6 text-center text-muted">
          {query
            ? `No one matches “${query}”.`
            : show === "requests"
              ? "No coach requests waiting."
              : "No one here yet."}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {users.map((user) => (
            <li
              key={user.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-semibold">
                  {user.display_name}
                  {isRequest(user) && (
                    <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-xs font-semibold text-accent-foreground">
                      Coach request
                    </span>
                  )}
                </p>
                <p className="truncate text-sm text-muted">
                  {user.email} · {user.role} · joined{" "}
                  {new Date(user.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    timeZone: "UTC",
                  })}
                </p>
              </div>
              <RoleForm user={user} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
