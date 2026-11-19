-- Members can only change tracking dated today (Eastern time). Coaches/admins retain
-- the existing database write policies; server actions keep coaches on the existing 7-day window.
create function private.can_write_tracking_day(target_day date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    not (select private.has_role((select auth.uid()), 'member'))
    or target_day = (select private.current_daily_checkin_day());
$$;
revoke all on function private.can_write_tracking_day(date) from public, anon;
grant execute on function private.can_write_tracking_day(date) to authenticated;

drop policy "People check off their own habits" on public.habit_logs;
create policy "People check off their own habits"
on public.habit_logs for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select private.can_write_tracking_day(day))
  and exists (
    select 1 from public.habits h
    where h.id = habit_id and h.user_id = (select auth.uid())
  )
);

drop policy "People undo their own check-ins" on public.habit_logs;
create policy "People undo their own check-ins"
on public.habit_logs for delete to authenticated
using (
  user_id = (select auth.uid())
  and (select private.can_write_tracking_day(day))
);

drop policy "People add to their own body log" on public.body_logs;
create policy "People add to their own body log"
on public.body_logs for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select private.can_write_tracking_day(day))
);

drop policy "People change their own body log" on public.body_logs;
create policy "People change their own body log"
on public.body_logs for update to authenticated
using (
  user_id = (select auth.uid())
  and (select private.can_write_tracking_day(day))
)
with check (
  user_id = (select auth.uid())
  and (select private.can_write_tracking_day(day))
);

drop policy "People remove from their own body log" on public.body_logs;
create policy "People remove from their own body log"
on public.body_logs for delete to authenticated
using (
  user_id = (select auth.uid())
  and (select private.can_write_tracking_day(day))
);

drop policy "People add to their own nutrition log" on public.nutrition_logs;
create policy "People add to their own nutrition log"
on public.nutrition_logs for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select private.can_write_tracking_day(day))
);

drop policy "People change their own nutrition log" on public.nutrition_logs;
create policy "People change their own nutrition log"
on public.nutrition_logs for update to authenticated
using (
  user_id = (select auth.uid())
  and (select private.can_write_tracking_day(day))
)
with check (
  user_id = (select auth.uid())
  and (select private.can_write_tracking_day(day))
);

drop policy "People add their own photos" on public.progress_photos;
create policy "People add their own photos"
on public.progress_photos for insert to authenticated
with check (
  user_id = (select auth.uid())
  and split_part(path, '/', 1) = (select auth.uid())::text
  and (select private.can_write_tracking_day(day))
);

drop policy "People remove their own photos" on public.progress_photos;
create policy "People remove their own photos"
on public.progress_photos for delete to authenticated
using (
  user_id = (select auth.uid())
  and (select private.can_write_tracking_day(day))
);
