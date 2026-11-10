drop function if exists public.clear_post_flag(uuid);
drop function if exists public.flagged_posts(integer);
drop function if exists public.moderation_flags(uuid[]);
grant select on public.posts to authenticated;
drop policy if exists "Reporters, moderators, coaches and admins see reports" on public.content_reports;
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
-- community_feed: re-run section 10 of 20261109200434_community.sql to restore the original body.
