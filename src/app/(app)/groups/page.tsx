import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth";
import { loadGroups } from "@/lib/groups";
import { preview } from "@/lib/messages";

export const metadata: Metadata = { title: "Groups" };

export default async function GroupsPage() {
  const { profile } = await requireAccount();
  // A coach has exactly one group.
  if (profile.role === "coach") redirect(`/groups/${profile.id}`);

  const groups = await loadGroups(profile);
  const isAdmin = profile.role === "admin";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-5xl">Groups</h1>
        <p className="mt-2 max-w-xl text-muted">
          {isAdmin
            ? "Every coach's group chat. You can read them but not post."
            : "Each coach you join has a group chat with all of their members. Cheer each other on."}
        </p>
      </div>
      {groups.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          {isAdmin ? (
            "No coaches yet."
          ) : (
            <>
              Join a coach to get into their group.{" "}
              <Link href="/coaches" className="text-link">
                Find a coach
              </Link>
              .
            </>
          )}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {groups.map((group) => (
            <li key={group.coachId}>
              <Link
                href={`/groups/${group.coachId}`}
                className="block p-4 hover:bg-surface-raised"
              >
                <p className="font-semibold">
                  {group.coachName}&apos;s group{" "}
                  <span className="text-sm font-normal text-muted">
                    · {group.memberCount}{" "}
                    {group.memberCount === 1 ? "member" : "members"}
                  </span>
                </p>
                <p className="truncate text-sm text-muted">
                  {group.lastPost
                    ? preview(group.lastPost.body)
                    : "No posts yet"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
