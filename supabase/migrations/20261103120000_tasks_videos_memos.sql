-- GYMX2 phase 2: coach connections, the video library, assigned Tasks and daily Memos.
-- Videos and Tasks are only created through trusted paths: the server for videos, create_task for Tasks.

create type public.video_status as enum ('uploading', 'processing', 'ready', 'failed');

create table public.coach_members (
  coach_id uuid not null references public.profiles (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (coach_id, member_id),
  check (coach_id <> member_id)
);

create index coach_members_member_idx on public.coach_members (member_id);

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles (id) on delete cascade,
  cloudflare_uid text not null unique,
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  status public.video_status not null default 'uploading',
  duration_seconds numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index videos_coach_idx on public.videos (coach_id, created_at desc);

create trigger videos_set_updated_at
before update on public.videos
for each row execute function public.set_updated_at();

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles (id) on delete cascade,
  video_id uuid not null references public.videos (id),
  title text not null check (char_length(title) between 1 and 120),
  instructions text not null default '' check (char_length(instructions) <= 2000),
  created_at timestamptz not null default now()
);

create index tasks_coach_idx on public.tasks (coach_id, created_at desc);
create index tasks_video_idx on public.tasks (video_id);

create table public.task_assignments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  due_on date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (task_id, member_id)
);

create index task_assignments_member_idx on public.task_assignments (member_id);

create table public.memos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  memo_date date not null,
  body text not null check (char_length(body) between 1 and 5000),
  shared_with_coaches boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index memos_user_date_idx on public.memos (user_id, memo_date desc, created_at desc);

create trigger memos_set_updated_at
before update on public.memos
for each row execute function public.set_updated_at();

create function public.has_role(target_user_id uuid, expected_role public.user_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = target_user_id and role = expected_role
  );
$$;

-- These two read assignments without row security, so Task and video rules can't loop back on themselves.
create function public.is_assigned_task(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.task_assignments
    where task_id = target_task_id and member_id = (select auth.uid())
  );
$$;

create function public.is_assigned_video(target_video_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.task_assignments a
    join public.tasks t on t.id = a.task_id
    where t.video_id = target_video_id and a.member_id = (select auth.uid())
  );
$$;

-- Leaving a coach clears that coach's unfinished Tasks. Finished ones stay as the member's history.
create function public.clear_unfinished_tasks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.task_assignments a
  using public.tasks t
  where a.task_id = t.id
    and t.coach_id = old.coach_id
    and a.member_id = old.member_id
    and a.completed_at is null;
  return old;
end;
$$;

create trigger coach_members_clear_unfinished_tasks
after delete on public.coach_members
for each row execute function public.clear_unfinished_tasks();

create function public.disconnect_former_coach()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.coach_members where coach_id = new.id;
  return new;
end;
$$;

create trigger profiles_disconnect_former_coach
after update of role on public.profiles
for each row
when (old.role = 'coach' and new.role <> 'coach')
execute function public.disconnect_former_coach();

alter table public.coach_members enable row level security;
alter table public.videos enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignments enable row level security;
alter table public.memos enable row level security;

create policy "Coaches can read members who joined them"
on public.profiles for select to authenticated
using (
  exists (
    select 1 from public.coach_members cm
    where cm.member_id = profiles.id and cm.coach_id = (select auth.uid())
  )
);

create policy "People can read their own connections"
on public.coach_members for select to authenticated
using (
  member_id = (select auth.uid())
  or coach_id = (select auth.uid())
  or (select public.is_admin())
);

create policy "Members can join a coach"
on public.coach_members for insert to authenticated
with check (
  member_id = (select auth.uid())
  and public.has_role(member_id, 'member')
  and public.has_role(coach_id, 'coach')
);

create policy "Members can leave a coach"
on public.coach_members for delete to authenticated
using (member_id = (select auth.uid()));

create policy "Viewers can read the videos open to them"
on public.videos for select to authenticated
using (
  coach_id = (select auth.uid())
  or (select public.is_admin())
  or (
    status = 'ready'
    and (
      exists (
        select 1 from public.coach_members cm
        where cm.coach_id = videos.coach_id and cm.member_id = (select auth.uid())
      )
      or public.is_assigned_video(id)
    )
  )
);

create policy "Coaches can edit their own videos"
on public.videos for update to authenticated
using (coach_id = (select auth.uid()))
with check (coach_id = (select auth.uid()));

create policy "Coaches and admins can delete videos"
on public.videos for delete to authenticated
using (coach_id = (select auth.uid()) or (select public.is_admin()));

create policy "People can read Tasks they gave or received"
on public.tasks for select to authenticated
using (
  coach_id = (select auth.uid())
  or (select public.is_admin())
  or public.is_assigned_task(id)
);

create policy "Coaches can delete their own Tasks"
on public.tasks for delete to authenticated
using (coach_id = (select auth.uid()));

create policy "People can read assignments they gave or received"
on public.task_assignments for select to authenticated
using (
  member_id = (select auth.uid())
  or (select public.is_admin())
  or exists (
    select 1 from public.tasks t
    where t.id = task_assignments.task_id and t.coach_id = (select auth.uid())
  )
);

create policy "People manage their own Memos"
on public.memos for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- Admins deliberately have no Memo policy, so a private Memo stays private from them too.
create policy "Coaches can read Memos shared by their members"
on public.memos for select to authenticated
using (
  shared_with_coaches
  and exists (
    select 1 from public.coach_members cm
    where cm.member_id = memos.user_id and cm.coach_id = (select auth.uid())
  )
);

create function public.create_task(
  target_video_id uuid,
  task_title text,
  task_instructions text,
  task_due_on date,
  target_member_ids uuid[]
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
  if not public.has_role(caller, 'coach') then
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

  insert into public.tasks (coach_id, video_id, title, instructions)
  values (caller, target_video_id, task_title, task_instructions)
  returning id into new_task_id;

  insert into public.task_assignments (task_id, member_id, due_on)
  select distinct new_task_id, m.id, task_due_on
  from unnest(target_member_ids) as m (id);

  return new_task_id;
end;
$$;

-- The time is set here, not by the browser, so a completion date can't be backdated.
create function public.set_assignment_completed(target_assignment_id uuid, is_done boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.task_assignments
  set completed_at = case when is_done then coalesce(completed_at, now()) end
  where id = target_assignment_id and member_id = (select auth.uid());

  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on public.coach_members from public, anon, authenticated;
revoke all on public.videos from public, anon, authenticated;
revoke all on public.tasks from public, anon, authenticated;
revoke all on public.task_assignments from public, anon, authenticated;
revoke all on public.memos from public, anon, authenticated;

grant select, delete on public.coach_members to authenticated;
grant insert (coach_id, member_id) on public.coach_members to authenticated;

-- cloudflare_uid is left out so it can only be read on the server, after an access check.
grant select (id, coach_id, title, description, status, duration_seconds, created_at, updated_at)
on public.videos to authenticated;
grant update (title, description) on public.videos to authenticated;
grant delete on public.videos to authenticated;
-- The server records uploads, reads cloudflare_uid and keeps each video's status current.
grant select, insert, update on public.videos to service_role;

grant select, delete on public.tasks to authenticated;
grant select on public.task_assignments to authenticated;
grant select, insert, update, delete on public.memos to authenticated;

revoke all on function public.has_role(uuid, public.user_role) from public, anon;
revoke all on function public.is_assigned_task(uuid) from public, anon;
revoke all on function public.is_assigned_video(uuid) from public, anon;
revoke all on function public.clear_unfinished_tasks() from public, anon, authenticated;
revoke all on function public.disconnect_former_coach() from public, anon, authenticated;
revoke all on function public.create_task(uuid, text, text, date, uuid[]) from public, anon;
revoke all on function public.set_assignment_completed(uuid, boolean) from public, anon;
grant execute on function public.has_role(uuid, public.user_role) to authenticated;
grant execute on function public.is_assigned_task(uuid) to authenticated;
grant execute on function public.is_assigned_video(uuid) to authenticated;
grant execute on function public.create_task(uuid, text, text, date, uuid[]) to authenticated;
grant execute on function public.set_assignment_completed(uuid, boolean) to authenticated;
