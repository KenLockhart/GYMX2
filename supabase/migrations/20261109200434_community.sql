-- GYMX2 Community, PR 1: tables, access rules, counters, moderation and the feed function.
-- Approved design: "GYMX2 Community — Stage 2 Architecture". No screens use these yet.

-- 1. Moderator role. Compared as text below, because a new enum value can't be used in the
-- same transaction that adds it.
alter type public.user_role add value if not exists 'moderator';

create function private.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role::text in ('moderator', 'admin')
  );
$$;

create function private.is_coach()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role::text = 'coach');
$$;

-- 2. Posts ----------------------------------------------------------------------------------
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null default 'general'
    check (kind in ('general', 'workout', 'nutrition', 'motivation', 'achievement', 'progress', 'challenge', 'announcement')),
  body text not null default '' check (char_length(body) <= 5000),
  audience text not null default 'everyone' check (audience in ('everyone', 'coach_community', 'only_me')),
  coach_id uuid references public.profiles (id) on delete cascade,
  pillar public.pillar,
  like_count integer not null default 0 check (like_count >= 0),
  comment_count integer not null default 0 check (comment_count >= 0),
  flag_reasons text not null default '' check (char_length(flag_reasons) <= 200),
  edited_at timestamptz,
  removed_at timestamptz,
  removed_by uuid references public.profiles (id) on delete set null,
  removed_reason text not null default '' check (char_length(removed_reason) <= 500),
  created_at timestamptz not null default now(),
  check ((audience = 'coach_community') = (coach_id is not null))
);
create index posts_feed_idx on public.posts (created_at desc) where removed_at is null;
create index posts_coach_idx on public.posts (coach_id, created_at desc) where coach_id is not null;
create index posts_author_idx on public.posts (author_id, created_at desc);

-- Who may see a post. Authors always see their own (even removed, to see why).
create function private.can_see_post(post_author uuid, post_audience text, post_coach uuid, post_removed timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    post_author = (select auth.uid())
    or (
      post_removed is null
      and (
        post_audience = 'everyone'
        or (post_audience = 'coach_community'
            and (post_coach = (select auth.uid()) or private.joined_coach(post_coach)))
      )
    )
    -- Moderation: moderators see shared-feed posts, admins every post except "only me".
    or (post_audience = 'everyone' and private.is_moderator())
    or (post_audience = 'coach_community' and private.is_admin());
$$;

-- What a person may publish where.
create function private.can_write_post(post_author uuid, post_kind text, post_audience text, post_coach uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select post_author = (select auth.uid())
    and case
      when post_audience = 'only_me' then post_kind not in ('announcement', 'challenge')
      when post_audience = 'everyone' then
        post_kind not in ('announcement', 'challenge') or private.is_coach() or private.is_admin()
      when post_audience = 'coach_community' then
        (post_coach = (select auth.uid()) and private.is_coach())
        or (private.joined_coach(post_coach) and post_kind not in ('announcement', 'challenge'))
      else false
    end;
$$;

-- 3. Media, likes, comments ---------------------------------------------------------------
create table public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  kind text not null check (kind in ('photo', 'video')),
  path text check (char_length(path) <= 300),
  video_uid text check (char_length(video_uid) <= 64),
  position smallint not null default 0 check (position between 0 and 5),
  width integer check (width between 1 and 20000),
  height integer check (height between 1 and 20000),
  created_at timestamptz not null default now(),
  unique (post_id, position),
  check ((kind = 'photo' and path is not null and video_uid is null) or (kind = 'video' and video_uid is not null and path is null and position = 0))
);

create table public.post_likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index post_likes_user_idx on public.post_likes (user_id);

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  parent_id uuid references public.post_comments (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  edited_at timestamptz,
  removed_at timestamptz,
  removed_by uuid references public.profiles (id) on delete set null,
  removed_reason text not null default '' check (char_length(removed_reason) <= 500),
  created_at timestamptz not null default now()
);
create index post_comments_post_idx on public.post_comments (post_id, created_at);

-- A post holds up to 6 photos or 1 video, never both; replies are one level deep.
create function private.check_post_media()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.post_media where post_id = new.post_id and kind <> new.kind)
     or (new.kind = 'video' and exists (select 1 from public.post_media where post_id = new.post_id)) then
    raise exception 'A post can have up to 6 photos or one video' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger post_media_mix before insert on public.post_media for each row execute function private.check_post_media();

create function private.check_comment_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from public.post_comments where id = new.parent_id and post_id = new.post_id and parent_id is null
  ) then
    raise exception 'Replies go one level deep, on the same post' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger post_comments_parent before insert on public.post_comments for each row execute function private.check_comment_parent();

-- Counters, kept by the database so nobody can set them.
create function private.count_post_likes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.posts
  set like_count = greatest(0, like_count + case when tg_op = 'INSERT' then 1 else -1 end)
  where id = coalesce(new.post_id, old.post_id);
  return null;
end;
$$;
create trigger post_likes_count after insert or delete on public.post_likes for each row execute function private.count_post_likes();

create function private.count_post_comments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set comment_count = comment_count + 1 where id = new.post_id;
  elsif tg_op = 'DELETE' and old.removed_at is null then
    update public.posts set comment_count = greatest(0, comment_count - 1) where id = old.post_id;
  elsif tg_op = 'UPDATE' and old.removed_at is null and new.removed_at is not null then
    update public.posts set comment_count = greatest(0, comment_count - 1) where id = new.post_id;
  end if;
  return null;
end;
$$;
create trigger post_comments_count after insert or delete or update of removed_at on public.post_comments
  for each row execute function private.count_post_comments();

-- 4. Personal feed choices -------------------------------------------------------------------
create table public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followed_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);

create table public.mutes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  muted_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, muted_id),
  check (user_id <> muted_id)
);

create table public.hidden_posts (
  user_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table public.feed_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  mode text not null default 'standard' check (mode in ('standard', 'personalized')),
  sort text not null default 'newest' check (sort in ('newest', 'personalized')),
  topic_weights jsonb not null default '{}'::jsonb check (jsonb_typeof(topic_weights) = 'object'),
  preferred_coaches uuid[] not null default '{}' check (cardinality(preferred_coaches) <= 50),
  updated_at timestamptz not null default now()
);

-- 5. Notifications ------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('like', 'comment', 'reply', 'announcement', 'message', 'progress_reply', 'removed', 'mention')),
  actor_id uuid references public.profiles (id) on delete set null,
  post_id uuid references public.posts (id) on delete cascade,
  comment_id uuid references public.post_comments (id) on delete cascade,
  link text not null check (link ~ '^/' and char_length(link) <= 300),
  group_key text not null check (char_length(group_key) <= 200),
  count integer not null default 1 check (count >= 1),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index notifications_unread_group_idx on public.notifications (recipient_id, group_key) where read_at is null;
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);

create table public.notification_settings (
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('like', 'comment', 'reply', 'announcement', 'message', 'progress_reply', 'removed', 'mention')),
  in_app boolean not null default true,
  push boolean not null default true,
  email boolean not null default false,
  primary key (user_id, type)
);

-- 6. Reports ---------------------------------------------------------------------------------
create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid references public.posts (id) on delete cascade,
  comment_id uuid references public.post_comments (id) on delete cascade,
  reason text not null check (reason in ('spam', 'harassment', 'inappropriate', 'off_platform', 'other')),
  details text not null default '' check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'removed', 'dismissed')),
  handled_by uuid references public.profiles (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  check ((post_id is null) <> (comment_id is null))
);
create unique index content_reports_post_open_idx on public.content_reports (reporter_id, post_id) where status = 'open' and post_id is not null;
create unique index content_reports_comment_open_idx on public.content_reports (reporter_id, comment_id) where status = 'open' and comment_id is not null;
create index content_reports_status_idx on public.content_reports (status, created_at desc);

-- 7. Photos on direct messages ----------------------------------------------------------------
create table public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  path text not null unique check (char_length(path) <= 300),
  width integer check (width between 1 and 20000),
  height integer check (height between 1 and 20000),
  created_at timestamptz not null default now()
);
create index message_attachments_message_idx on public.message_attachments (message_id);

create function private.check_message_attachments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.message_attachments where message_id = new.message_id) >= 4 then
    raise exception 'Up to 4 photos per message' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger message_attachments_limit before insert on public.message_attachments
  for each row execute function private.check_message_attachments();

-- A message may now be just a photo.
do $$
declare
  existing text;
begin
  for existing in
    select conname from pg_constraint
    where conrelid = 'public.messages'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%char_length(body)%'
  loop
    execute format('alter table public.messages drop constraint %I', existing);
  end loop;
end;
$$;
alter table public.messages add constraint messages_body_check check (char_length(body) <= 4000);

-- 8. Access rules -----------------------------------------------------------------------------
alter table public.posts enable row level security;
alter table public.post_media enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_comments enable row level security;
alter table public.follows enable row level security;
alter table public.mutes enable row level security;
alter table public.hidden_posts enable row level security;
alter table public.feed_preferences enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_settings enable row level security;
alter table public.content_reports enable row level security;
alter table public.message_attachments enable row level security;

create policy "People see posts they're allowed to"
on public.posts for select to authenticated
using ((select private.can_see_post(author_id, audience, coach_id, removed_at)));
create policy "People publish where they're allowed"
on public.posts for insert to authenticated
with check ((select private.can_write_post(author_id, kind, audience, coach_id)));
create policy "Authors edit their posts"
on public.posts for update to authenticated
using (author_id = (select auth.uid()) and removed_at is null)
with check ((select private.can_write_post(author_id, kind, audience, coach_id)) and removed_at is null);
create policy "Authors delete their posts"
on public.posts for delete to authenticated using (author_id = (select auth.uid()));

-- Child rows follow their post: the subquery runs under the post's own rules.
create policy "Media of visible posts"
on public.post_media for select to authenticated
using (exists (select 1 from public.posts p where p.id = post_id));
create policy "Authors attach media"
on public.post_media for insert to authenticated
with check (
  exists (select 1 from public.posts p where p.id = post_id and p.author_id = (select auth.uid()) and p.removed_at is null)
  and (path is null or split_part(path, '/', 1) = (select auth.uid())::text)
);
create policy "Authors remove media"
on public.post_media for delete to authenticated
using (exists (select 1 from public.posts p where p.id = post_id and p.author_id = (select auth.uid())));

create policy "Likes on visible posts"
on public.post_likes for select to authenticated
using (exists (select 1 from public.posts p where p.id = post_id));
create policy "People like as themselves"
on public.post_likes for insert to authenticated
with check (user_id = (select auth.uid()) and exists (select 1 from public.posts p where p.id = post_id and p.removed_at is null));
create policy "People unlike their own likes"
on public.post_likes for delete to authenticated using (user_id = (select auth.uid()));

create policy "Comments on visible posts"
on public.post_comments for select to authenticated
using (
  exists (select 1 from public.posts p where p.id = post_id)
  and (removed_at is null or author_id = (select auth.uid()) or (select private.is_moderator()))
);
create policy "People comment as themselves"
on public.post_comments for insert to authenticated
with check (
  author_id = (select auth.uid())
  and removed_at is null
  and exists (select 1 from public.posts p where p.id = post_id and p.removed_at is null)
);
create policy "Authors edit their comments"
on public.post_comments for update to authenticated
using (author_id = (select auth.uid()) and removed_at is null)
with check (author_id = (select auth.uid()) and removed_at is null);
create policy "Authors delete their comments"
on public.post_comments for delete to authenticated using (author_id = (select auth.uid()));

create policy "Own follows" on public.follows for all to authenticated
using (follower_id = (select auth.uid())) with check (follower_id = (select auth.uid()));
create policy "Own mutes" on public.mutes for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Own hidden posts" on public.hidden_posts for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Own feed preferences" on public.feed_preferences for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Own notification settings" on public.notification_settings for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "Own notifications"
on public.notifications for select to authenticated using (recipient_id = (select auth.uid()));
create policy "Mark own notifications read"
on public.notifications for update to authenticated
using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
create policy "Clear own notifications"
on public.notifications for delete to authenticated using (recipient_id = (select auth.uid()));

create policy "Reporters, moderators and admins see reports"
on public.content_reports for select to authenticated
using (
  reporter_id = (select auth.uid())
  or (select private.is_admin())
  or ((select private.is_moderator()) and exists (
    select 1 from public.posts p
    left join public.post_comments c on c.id = content_reports.comment_id
    where p.id = coalesce(content_reports.post_id, c.post_id) and p.audience = 'everyone'
  ))
);
create policy "People report what they can see"
on public.content_reports for insert to authenticated
with check (
  reporter_id = (select auth.uid())
  and status = 'open'
  and (
    (post_id is not null and exists (select 1 from public.posts p where p.id = post_id))
    or (comment_id is not null and exists (select 1 from public.post_comments c where c.id = comment_id))
  )
);

create policy "Attachments in your conversations"
on public.message_attachments for select to authenticated
using (exists (select 1 from public.messages m where m.id = message_id));
create policy "Senders attach photos"
on public.message_attachments for insert to authenticated
with check (
  split_part(path, '/', 1) = (select auth.uid())::text
  and exists (select 1 from public.messages m where m.id = message_id and m.sender_id = (select auth.uid()))
);

-- Column grants: counters, removal and moderation fields are never set by people directly.
revoke all on public.posts, public.post_media, public.post_likes, public.post_comments, public.follows, public.mutes,
  public.hidden_posts, public.feed_preferences, public.notifications, public.notification_settings,
  public.content_reports, public.message_attachments from public, anon, authenticated;

grant select, delete on public.posts to authenticated;
grant insert (author_id, kind, body, audience, coach_id, pillar) on public.posts to authenticated;
grant update (kind, body, audience, coach_id, pillar, edited_at) on public.posts to authenticated;
grant select, insert, delete on public.post_media to authenticated;
grant select, insert, delete on public.post_likes to authenticated;
grant select, delete on public.post_comments to authenticated;
grant insert (post_id, author_id, parent_id, body) on public.post_comments to authenticated;
grant update (body, edited_at) on public.post_comments to authenticated;
grant select, insert, update, delete on public.follows, public.mutes, public.hidden_posts, public.feed_preferences,
  public.notification_settings to authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select on public.content_reports to authenticated;
grant insert (reporter_id, post_id, comment_id, reason, details) on public.content_reports to authenticated;
grant select, insert on public.message_attachments to authenticated;

grant select, insert, update, delete on public.posts, public.post_media, public.post_likes, public.post_comments,
  public.notifications, public.content_reports, public.message_attachments to service_role;
grant select on public.follows, public.mutes, public.hidden_posts, public.feed_preferences, public.notification_settings to service_role;

-- 9. Moderation -------------------------------------------------------------------------------
-- Who may remove a post: admins (except "only me"), moderators on the shared feed, a coach in
-- their own community.
create function private.can_moderate(post_audience text, post_coach uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (post_audience <> 'only_me' and private.is_admin())
    or (post_audience = 'everyone' and private.is_moderator())
    or (post_audience = 'coach_community' and post_coach = (select auth.uid()));
$$;

create function public.remove_post(target_post_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.posts%rowtype;
begin
  select * into target from public.posts where id = target_post_id;
  if not found or not private.can_moderate(target.audience, target.coach_id) then
    raise exception 'You can''t remove this post' using errcode = '42501';
  end if;
  update public.posts
  set removed_at = now(), removed_by = (select auth.uid()), removed_reason = left(coalesce(reason, ''), 500)
  where id = target_post_id and removed_at is null;
  update public.content_reports
  set status = 'removed', handled_by = (select auth.uid()), handled_at = now()
  where status = 'open' and (post_id = target_post_id
    or comment_id in (select id from public.post_comments where post_id = target_post_id));
end;
$$;

create function public.remove_comment(target_comment_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_post public.posts%rowtype;
begin
  select p.* into target_post
  from public.posts p join public.post_comments c on c.post_id = p.id
  where c.id = target_comment_id;
  if not found or not private.can_moderate(target_post.audience, target_post.coach_id) then
    raise exception 'You can''t remove this comment' using errcode = '42501';
  end if;
  update public.post_comments
  set removed_at = now(), removed_by = (select auth.uid()), removed_reason = left(coalesce(reason, ''), 500)
  where id = target_comment_id and removed_at is null;
  update public.content_reports
  set status = 'removed', handled_by = (select auth.uid()), handled_at = now()
  where status = 'open' and comment_id = target_comment_id;
end;
$$;

create function public.dismiss_report(target_report_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_post public.posts%rowtype;
begin
  select p.* into target_post
  from public.content_reports r
  left join public.post_comments c on c.id = r.comment_id
  join public.posts p on p.id = coalesce(r.post_id, c.post_id)
  where r.id = target_report_id;
  if not found or not private.can_moderate(target_post.audience, target_post.coach_id) then
    raise exception 'You can''t handle this report' using errcode = '42501';
  end if;
  update public.content_reports
  set status = 'dismissed', handled_by = (select auth.uid()), handled_at = now()
  where id = target_report_id and status = 'open';
end;
$$;

-- 10. The feed --------------------------------------------------------------------------------
-- Runs with the caller's own permissions, so it can only return posts the rules above allow.
-- Preferences then re-order or drop those rows; they never add any.
create function public.community_feed(page_offset integer default 0, page_size integer default 20, only_coach uuid default null)
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
    select p.*
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
  select id, author_id, kind, body, audience, coach_id, pillar, like_count, comment_count, flag_reasons,
         edited_at, removed_at, removed_by, removed_reason, created_at
  from scored
  order by score desc, created_at desc, id
  offset greatest(0, page_offset)
  limit least(greatest(1, page_size), 50);
$$;

-- 11. Function permissions --------------------------------------------------------------------
revoke all on function private.is_moderator(), private.is_coach(), private.can_see_post(uuid, text, uuid, timestamptz),
  private.can_write_post(uuid, text, text, uuid), private.can_moderate(text, uuid) from public, anon;
grant execute on function private.is_moderator(), private.is_coach(), private.can_see_post(uuid, text, uuid, timestamptz),
  private.can_write_post(uuid, text, text, uuid), private.can_moderate(text, uuid) to authenticated;
revoke all on function private.check_post_media(), private.check_comment_parent(), private.count_post_likes(),
  private.count_post_comments(), private.check_message_attachments() from public, anon, authenticated;
revoke all on function public.remove_post(uuid, text), public.remove_comment(uuid, text), public.dismiss_report(uuid),
  public.community_feed(integer, integer, uuid) from public, anon;
grant execute on function public.remove_post(uuid, text), public.remove_comment(uuid, text), public.dismiss_report(uuid),
  public.community_feed(integer, integer, uuid) to authenticated;

-- 12. Storage and live updates ----------------------------------------------------------------
-- Private bucket; uploads and downloads go through short-lived signed links made by the server
-- after it checks the post's access rules.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-media', 'community-media', false, 10485760, array['image/png', 'image/jpeg', 'image/webp']);

alter publication supabase_realtime add table public.notifications, public.post_comments;
