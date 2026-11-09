import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccount } from "@/lib/auth";
import { loadGroups } from "@/lib/groups";
import { preview } from "@/lib/messages";

export const metadata: Metadata = { title: "Coach communities" };

export default async function GroupsPage() {
  const { profile } = await requireAccount();
  // A coach has exactly one group.
  if (profile.role === "coach") redirect(`/groups/${profile.id}`);

  const groups = await loadGroups(profile);
  const isAdmin = profile.role === "admin";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-5xl">Coach communities</h1>
        <p className="mt-2 max-w-xl text-muted">
          {isAdmin
            ? "Every coach's community: posts and chat. You can read them but not post."
            : "Each coach you join has a community with all of their members: announcements, challenges, posts and a group chat."}
        </p>
      </div>
      {groups.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-muted">
          {isAdmin ? (
            "No coaches yet."
          ) : (
            <>
              Join a coach to get into their community.{" "}
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
                  {group.coachName}&apos;s community{" "}
                  <span className="text-sm font-normal text-muted">
                    · {group.memberCount}{" "}
                    {group.memberCount === 1 ? "member" : "members"}
                  </span>
                </p>
                <p className="truncate text-sm text-muted">
                  {group.lastPost
                    ? preview(group.lastPost.body)
                    : "No chat messages yet"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
