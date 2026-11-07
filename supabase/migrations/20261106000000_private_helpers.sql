-- GYMX2: move the RLS helper functions out of the API-exposed public schema.
-- They were callable as /rest/v1/rpc/..., which let any signed-in user probe another user's role.
-- Policies point at functions by OID, so they follow the move; plpgsql bodies name them, so those are redefined.

create schema private;

-- Policies run as the signed-in user, so that role needs to reach the helpers, just not through the API.
revoke all on schema private from public;
grant usage on schema private to authenticated;

alter function public.is_admin() set schema private;
alter function public.has_role(uuid, public.user_role) set schema private;
alter function public.is_assigned_task(uuid) set schema private;
alter function public.is_assigned_video(uuid) set schema private;

create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  display_name text,
  role public.user_role,
  coach_requested boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  return query
  select p.id, u.email::text, p.display_name, p.role, p.coach_requested, p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  order by p.coach_requested desc, p.created_at desc;
end;
$$;

create or replace function public.admin_set_user_role(target_user_id uuid, new_role public.user_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_role_value public.user_role;
begin
  if not private.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  -- Lock every admin row so two simultaneous demotions can't remove the last admin.
  perform 1 from public.profiles where role = 'admin' for update;

  select role into current_role_value
  from public.profiles
  where id = target_user_id
  for update;

  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  if current_role_value = 'admin' and new_role <> 'admin'
    and (select count(*) from public.profiles where role = 'admin') = 1 then
    raise exception 'GYMX2 must keep at least one admin' using errcode = 'P0001';
  end if;

  update public.profiles
  set role = new_role, coach_requested = false
  where id = target_user_id;
end;
$$;

create or replace function public.create_task(
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

  insert into public.tasks (coach_id, video_id, title, instructions)
  values (caller, target_video_id, task_title, task_instructions)
  returning id into new_task_id;

  insert into public.task_assignments (task_id, member_id, due_on)
  select distinct new_task_id, m.id, task_due_on
  from unnest(target_member_ids) as m (id);

  return new_task_id;
end;
$$;
