import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export type GroupPost = {
  id: string;
  coach_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};
export type GroupSummary = {
  coachId: string;
  coachName: string;
  memberCount: number;
  lastPost: GroupPost | null;
};

export const GROUP_POST_MAX = 2000;

// The groups a person belongs to: a coach's own group, the groups of coaches a member joined,
// or every coach's group for admins (read only).
export async function loadGroups(
  profile: Pick<Profile, "id" | "role">,
): Promise<GroupSummary[]> {
  const admin = createAdminClient();
  let coachIds: string[];
  if (profile.role === "coach") coachIds = [profile.id];
  else if (profile.role === "member") {
    const { data } = await admin
      .from("coach_members")
      .select("coach_id")
      .eq("member_id", profile.id);
    coachIds = (data ?? []).map((row) => row.coach_id as string);
  } else {
    const { data } = await admin
      .from("profiles")
      .select("id")
      .eq("role", "coach");
    coachIds = (data ?? []).map((row) => row.id as string);
  }
  if (coachIds.length === 0) return [];

  const supabase = await createClient();
  const [{ data: coaches }, { data: links }, { data: posts }] =
    await Promise.all([
      admin.from("profiles").select("id, display_name").in("id", coachIds),
      admin.from("coach_members").select("coach_id").in("coach_id", coachIds),
      // Row security limits posts to groups the viewer can read.
      supabase
        .from("group_messages")
        .select("id, coach_id, sender_id, body, created_at")
        .in("coach_id", coachIds)
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

  const counts = new Map<string, number>();
  for (const link of links ?? [])
    counts.set(
      link.coach_id as string,
      (counts.get(link.coach_id as string) ?? 0) + 1,
    );
  const latest = new Map<string, GroupPost>();
  for (const post of (posts ?? []) as GroupPost[])
    if (!latest.has(post.coach_id)) latest.set(post.coach_id, post);

  return (coaches ?? [])
    .map((coach) => ({
      coachId: coach.id as string,
      coachName: coach.display_name as string,
      memberCount: counts.get(coach.id as string) ?? 0,
      lastPost: latest.get(coach.id as string) ?? null,
    }))
    .sort(
      (a, b) =>
        (b.lastPost?.created_at ?? "").localeCompare(
          a.lastPost?.created_at ?? "",
        ) || a.coachName.localeCompare(b.coachName),
    );
}

// Display names for everyone in a coach's group. Members can't read each other's profiles,
// so the server looks them up and only shares names.
export async function loadGroupRoster(coachId: string) {
  const admin = createAdminClient();
  const [{ data: coach }, { data: links }] = await Promise.all([
    admin
      .from("profiles")
      .select("id, display_name, role")
      .eq("id", coachId)
      .maybeSingle(),
    admin
      .from("coach_members")
      .select("member:profiles!member_id(id, display_name)")
      .eq("coach_id", coachId),
  ]);
  if (!coach || coach.role !== "coach") return null;
  const names: Record<string, string> = {
    [coach.id as string]: coach.display_name as string,
  };
  for (const row of (links ?? []) as unknown as {
    member: { id: string; display_name: string } | null;
  }[]) {
    if (row.member) names[row.member.id] = row.member.display_name;
  }
  return {
    coachName: coach.display_name as string,
    names,
    memberCount: Object.keys(names).length - 1,
  };
}
