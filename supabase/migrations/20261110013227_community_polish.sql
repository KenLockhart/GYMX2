-- Community follow-ups from the launch testing report.

-- 1. Who sees reports. Coaches now see reports on their own community's posts and comments.
--    Nobody but admins sees reports about their own posts or comments, so a reported coach or
--    moderator never learns who reported them.
drop policy "Reporters, moderators and admins see reports" on public.content_reports;
create policy "Reporters, moderators, coaches and admins see reports"
on public.content_reports for select to authenticated
using (
  reporter_id = (select auth.uid())
  or (select private.is_admin())
  or exists (
    select 1
    from public.posts p
    left join public.post_comments c on c.id = content_reports.comment_id
    where p.id = coalesce(content_reports.post_id, c.post_id)
      and coalesce(c.author_id, p.author_id) <> (select auth.uid())
      and (
        (p.audience = 'everyone' and (select private.is_moderator()))
        or (p.audience = 'coach_community' and p.coach_id = (select auth.uid()))
      )
  )
);

-- 2. Automatic flag reasons are for moderators only. Members could read them on any post they
--    could see; now the column is left out of what signed-in users can select, and moderators
--    read it through the functions below.
revoke select on public.posts from authenticated;
grant select (id, author_id, kind, body, audience, coach_id, pillar, like_count, comment_count,
  edited_at, removed_at, removed_by, removed_reason, created_at) on public.posts to authenticated;

-- The feed returns rows shaped like posts, with the flag column always empty.
create or replace function public.community_feed(page_offset integer default 0, page_size integer default 20, only_coach uuid default null)
returns setof public.posts
language sql
stable
security invoker
set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as id
  ),
  prefs as (
    select
      coalesce(f.mode, 'standard') as mode,
      coalesce(f.sort, 'newest') as sort,
      coalesce(f.topic_weights, '{}'::jsonb) as weights,
      coalesce(f.preferred_coaches, '{}') as coaches
    from me left join public.feed_preferences f on f.user_id = me.id
  ),
  visible as (
    select p.id, p.author_id, p.kind, p.body, p.audience, p.coach_id, p.pillar, p.like_count,
           p.comment_count, p.edited_at, p.removed_at, p.removed_by, p.removed_reason, p.created_at
    from public.posts p, me
    where p.removed_at is null
      and (only_coach is null or p.coach_id = only_coach)
      and (p.audience <> 'only_me' or p.author_id = me.id)
      -- The main feed shows communities you belong to; admins open other coaches' explicitly.
      and (p.audience <> 'coach_community' or only_coach is not null or p.coach_id = me.id
           or exists (select 1 from public.coach_members cm where cm.member_id = me.id and cm.coach_id = p.coach_id))
      and not exists (select 1 from public.hidden_posts h where h.user_id = me.id and h.post_id = p.id)
      and not exists (select 1 from public.mutes m where m.user_id = me.id and m.muted_id = p.author_id)
  ),
  scored as (
    select v.*,
      extract(epoch from v.created_at) / 3600.0
      -- Standard: a one-hour lift for workouts, motivation and announcements.
      + case when v.kind in ('workout', 'motivation', 'announcement') then 1 else 0 end
      -- Your own coaches' announcements stay on top for 48 hours.
      + case when v.kind = 'announcement' and v.created_at > now() - interval '48 hours'
               and exists (select 1 from public.coach_members cm, me where cm.member_id = me.id and cm.coach_id = v.author_id)
             then 1000 else 0 end
      + case when prefs.mode = 'personalized' then
          (case when exists (select 1 from public.follows fo, me where fo.follower_id = me.id and fo.followed_id = v.author_id) then 12 else 0 end)
          + (case when v.author_id = any (prefs.coaches) or v.coach_id = any (prefs.coaches) then 12 else 0 end)
          -- Topic weight 0 to 3 (default 1): each step moves a post about four hours.
          + 4 * (least(3, greatest(0, coalesce((prefs.weights ->> v.kind)::numeric, 1))) - 1)
          + case when prefs.sort = 'personalized' then 2 * ln(1 + v.like_count + 2 * v.comment_count) else 0 end
        else 0 end as score
    from visible v, prefs
  )
  select id, author_id, kind, body, audience, coach_id, pillar, like_count, comment_count, ''::text,
         edited_at, removed_at, removed_by, removed_reason, created_at
  from scored
  order by score desc, created_at desc, id
  offset greatest(0, page_offset)
  limit least(greatest(1, page_size), 50);
$$;

-- Flag reasons for posts the caller may moderate (and didn't write).
create function public.moderation_flags(post_ids uuid[])
returns table (post_id uuid, flag_reasons text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.flag_reasons
  from public.posts p
  where p.id = any (post_ids)
    and p.flag_reasons <> ''
    and p.author_id <> (select auth.uid())
    and private.can_moderate(p.audience, p.coach_id);
$$;

-- Recently flagged posts waiting for a look, newest first.
create function public.flagged_posts(max_age_days integer default 14)
returns table (post_id uuid, flag_reasons text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.flag_reasons
  from public.posts p
  where p.flag_reasons <> ''
    and p.removed_at is null
    and p.created_at > now() - make_interval(days => least(greatest(max_age_days, 1), 90))
    and p.author_id <> (select auth.uid())
    and private.can_moderate(p.audience, p.coach_id)
  order by p.created_at desc
  limit 50;
$$;

-- 3. "Looks fine": clears an automatic flag without removing the post.
create function public.clear_post_flag(target_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.posts%rowtype;
begin
  select * into target from public.posts where id = target_post_id;
  if not found or target.author_id = (select auth.uid())
     or not private.can_moderate(target.audience, target.coach_id) then
    raise exception 'You can''t review this post' using errcode = '42501';
  end if;
  update public.posts set flag_reasons = '' where id = target_post_id;
end;
$$;

revoke all on function public.moderation_flags(uuid[]), public.flagged_posts(integer),
  public.clear_post_flag(uuid) from public, anon;
grant execute on function public.moderation_flags(uuid[]), public.flagged_posts(integer),
  public.clear_post_flag(uuid) to authenticated;
