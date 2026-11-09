import type { Metadata } from "next";
import Link from "next/link";
import { PreferencesForm } from "@/components/feed-preferences-form";
import { PeopleList } from "@/components/feed-people-list";
import { requireAccount } from "@/lib/auth";
import { loadAuthors, postableCommunities } from "@/lib/community-server";
import { readPreferences } from "@/lib/feed-prefs";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Newsfeed preferences" };

export default async function FeedPreferencesPage() {
  const { profile } = await requireAccount();
  const supabase = await createClient();
  const [{ data: row }, { data: follows }, { data: mutes }, joined] =
    await Promise.all([
      supabase
        .from("feed_preferences")
        .select("mode, sort, topic_weights, preferred_coaches")
        .eq("user_id", profile.id)
        .maybeSingle(),
      supabase
        .from("follows")
        .select("followed_id, created_at")
        .eq("follower_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("mutes")
        .select("muted_id, created_at")
        .eq("user_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(200),
      profile.role === "member" ? postableCommunities(profile) : [],
    ]);
  const prefs = readPreferences(row);
  const followedIds = (follows ?? []).map((f) => f.followed_id as string);
  const mutedIds = (mutes ?? []).map((m) => m.muted_id as string);
  const people = await loadAuthors([
    ...followedIds,
    ...mutedIds,
    ...prefs.preferredCoaches,
  ]);

  // Coaches to favor: the ones you've joined and coaches you follow.
  const coachOptions = new Map<string, string>();
  for (const coach of joined) coachOptions.set(coach.id, coach.name);
  for (const id of [...followedIds, ...prefs.preferredCoaches]) {
    const person = people.get(id);
    if (person?.role === "coach") coachOptions.set(id, person.name);
  }

  const named = (ids: string[]) =>
    ids.map((id) => ({ id, name: people.get(id)?.name ?? "Former member" }));

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <Link href="/community" className="text-link text-sm">
          Back to Community
        </Link>
        <h1 className="mt-2 text-5xl">Newsfeed preferences</h1>
        <p className="mt-2 text-muted">
          Choose what you see more of. These settings only change the order of
          posts you can already see; they never show you anything private.
        </p>
      </div>
      <PreferencesForm
        initial={prefs}
        coaches={[...coachOptions].map(([id, name]) => ({ id, name }))}
      />
      <PeopleList
        title="Following"
        empty="You're not following anyone yet. Tap Follow on a post to see more from that person."
        people={named(followedIds)}
        action="unfollow"
      />
      <PeopleList
        title="Muted"
        empty="You haven't muted anyone."
        people={named(mutedIds)}
        action="unmute"
      />
    </div>
  );
}
