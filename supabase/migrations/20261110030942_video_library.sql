-- Video library: each video gets a category (for the library rows) and a visibility setting.
-- Private videos are only for the coach (and admins), unless the coach assigns one in a Task.

alter table public.videos
  add column category text not null default 'Other'
    check (category in ('Upper Body', 'Lower Body', 'Core', 'Full Body', 'Cardio', 'Mobility',
                        'Warm-up', 'Recovery', 'Technique', 'Nutrition', 'Other')),
  add column visibility text not null default 'members'
    check (visibility in ('members', 'private'));

drop policy "Viewers can read the videos open to them" on public.videos;
create policy "Viewers can read the videos open to them"
on public.videos for select to authenticated
using (
  coach_id = (select auth.uid())
  or (select private.is_admin())
  or (
    status = 'ready'
    and (
      (
        visibility = 'members'
        and exists (
          select 1 from public.coach_members cm
          where cm.coach_id = videos.coach_id and cm.member_id = (select auth.uid())
        )
      )
      or private.is_assigned_video(id)
    )
  )
);

grant select (category, visibility) on public.videos to authenticated;
grant update (category, visibility) on public.videos to authenticated;
