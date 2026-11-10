drop policy "Viewers can read the videos open to them" on public.videos;
create policy "Viewers can read the videos open to them"
on public.videos for select to authenticated
using (
  coach_id = (select auth.uid())
  or (select private.is_admin())
  or (
    status = 'ready'
    and (
      exists (
        select 1 from public.coach_members cm
        where cm.coach_id = videos.coach_id and cm.member_id = (select auth.uid())
      )
      or private.is_assigned_video(id)
    )
  )
);
revoke update (category, visibility) on public.videos from authenticated;
revoke select (category, visibility) on public.videos from authenticated;
alter table public.videos drop column if exists visibility, drop column if exists category;
