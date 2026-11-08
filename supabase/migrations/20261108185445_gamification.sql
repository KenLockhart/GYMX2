-- Gamification. Coaches tag each Task Mind, Body or Spirit, and earned badges are kept here.
-- Points, levels, streaks and challenges are worked out from activity, so they need no storage.

create type public.pillar as enum ('mind', 'body', 'spirit');
alter table public.tasks add column pillar public.pillar;

-- create_task takes an optional pillar. Older callers without it still work.
drop function public.create_task(uuid, text, text, date, uuid[]);

create function public.create_task(
  target_video_id uuid,
  task_title text,
  task_instructions text,
  task_due_on date,
  target_member_ids uuid[],
  task_pillar public.pillar default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  new_task_id uuid;
begin
  if not private.has_role(caller, 'coach') then
    raise exception 'Coach access required' using errcode = '42501';
  end if;

  if coalesce(cardinality(target_member_ids), 0) = 0 then
    raise exception 'Choose at least one member' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.videos
    where id = target_video_id and coach_id = caller and status = 'ready'
  ) then
    raise exception 'Choose one of your videos that has finished processing' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from unnest(target_member_ids) as m (id)
    where not exists (
      select 1 from public.coach_members cm
      where cm.coach_id = caller and cm.member_id = m.id
    )
  ) then
    raise exception 'Tasks can only go to members who joined you' using errcode = 'P0001';
  end if;

  insert into public.tasks (coach_id, video_id, title, instructions, pillar)
  values (caller, target_video_id, task_title, task_instructions, task_pillar)
  returning id into new_task_id;

  insert into public.task_assignments (task_id, member_id, due_on)
  select distinct new_task_id, m.id, task_due_on
  from unnest(target_member_ids) as m (id);

  return new_task_id;
end;
$$;

revoke all on function public.create_task(uuid, text, text, date, uuid[], public.pillar) from public, anon;
grant execute on function public.create_task(uuid, text, text, date, uuid[], public.pillar) to authenticated;

-- Earned badges. Anyone signed in can see who earned what; only the server awards them.
create table public.user_badges (
  user_id uuid not null references public.profiles (id) on delete cascade,
  badge text not null check (char_length(badge) between 1 and 40),
  earned_at timestamptz not null default now(),
  primary key (user_id, badge)
);

alter table public.user_badges enable row level security;

create policy "Signed-in users can see earned badges"
on public.user_badges for select to authenticated
using (true);

revoke all on public.user_badges from public, anon, authenticated;
grant select on public.user_badges to authenticated;
grant select, insert on public.user_badges to service_role;
