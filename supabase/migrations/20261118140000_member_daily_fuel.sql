-- Daily Fuel is an explicit, one-member-per-Eastern-day assignment. Service-side
-- playback signs only the video currently assigned to the authenticated member.
create table public.member_daily_fuel_assignments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  coach_id uuid not null references public.profiles (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  day date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, day)
);
create index member_daily_fuel_assignments_video_idx
  on public.member_daily_fuel_assignments (video_id, member_id);
create trigger member_daily_fuel_assignments_set_updated_at
before update on public.member_daily_fuel_assignments
for each row execute function public.set_updated_at();

alter table public.member_daily_fuel_assignments enable row level security;
revoke all on public.member_daily_fuel_assignments from public, anon, authenticated;
grant select on public.member_daily_fuel_assignments to authenticated;
grant all on public.member_daily_fuel_assignments to service_role;
create policy "Members and their connected coach read daily fuel assignments"
on public.member_daily_fuel_assignments for select to authenticated
using (
  (
    member_id = (select auth.uid())
    and (select private.has_role((select auth.uid()), 'member'))
  )
  or (
    coach_id = (select auth.uid())
    and (select private.has_role((select auth.uid()), 'coach'))
    and (select private.coaches_member(member_id))
  )
  or (select private.is_admin())
);

-- Only this authenticated RPC can assign. It checks the current Eastern day, current roles,
-- video readiness/ownership and coach-member relationship inside the same database operation.
create function public.assign_member_daily_fuel_video(
  target_member_id uuid,
  target_video_id uuid,
  target_expected_day date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  today date := (select private.current_daily_checkin_day());
  caller_role public.user_role;
  target_member_role public.user_role;
  video_owner uuid;
  video_ready boolean;
  video_visibility text;
  saved_id uuid;
begin
  if caller is null then
    raise exception 'Coach or admin access required' using errcode = '42501';
  end if;
  select p.role into caller_role
  from public.profiles p
  where p.id = caller
  for share;
  if caller_role is null or caller_role not in ('coach', 'admin') then
    raise exception 'Coach or admin access required' using errcode = '42501';
  end if;
  if target_expected_day is distinct from today then
    raise exception 'Daily Fuel day changed' using errcode = 'P0001';
  end if;

  select v.coach_id, v.status = 'ready', v.visibility
    into video_owner, video_ready, video_visibility
  from public.videos v
  where v.id = target_video_id
  for share;
  if not found or not coalesce(video_ready, false) then
    raise exception 'A ready video is required' using errcode = '22023';
  end if;
  if video_visibility is null
     or video_visibility not in ('members', 'private') then
    raise exception 'Only member-visible videos can be featured' using errcode = '42501';
  end if;
  select p.role into target_member_role
  from public.profiles p
  where p.id = target_member_id
  for share;
  if target_member_role is distinct from 'member' then
    raise exception 'A member account is required' using errcode = '42501';
  end if;
  if caller_role = 'coach' then
    if video_owner <> caller then
      raise exception 'Coaches can feature only their own videos' using errcode = '42501';
    end if;
    perform 1 from public.coach_members cm
    where cm.coach_id = caller and cm.member_id = target_member_id
    for share;
    if not found then
      raise exception 'A current coach-member connection is required' using errcode = '42501';
    end if;
  end if;

  insert into public.member_daily_fuel_assignments (
    member_id, coach_id, video_id, assigned_by, day
  ) values (
    target_member_id, video_owner, target_video_id, caller, today
  )
  on conflict (member_id, day) do update
    set coach_id = excluded.coach_id,
        video_id = excluded.video_id,
        assigned_by = excluded.assigned_by,
        updated_at = now()
    where caller_role = 'admin'
       or public.member_daily_fuel_assignments.coach_id = caller
  returning id into saved_id;

  if saved_id is null then
    raise exception 'Another coach already featured today’s video' using errcode = '42501';
  end if;
  return saved_id;
end;
$$;
revoke all on function public.assign_member_daily_fuel_video(uuid, uuid, date)
  from public, anon, authenticated;
grant execute on function public.assign_member_daily_fuel_video(uuid, uuid, date)
  to authenticated;

create table public.member_daily_fuel_bookmarks (
  member_id uuid not null references public.profiles (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, video_id)
);
alter table public.member_daily_fuel_bookmarks enable row level security;
revoke all on public.member_daily_fuel_bookmarks from public, anon, authenticated;
grant select on public.member_daily_fuel_bookmarks to authenticated;
grant all on public.member_daily_fuel_bookmarks to service_role;
create policy "Members read their own Daily Fuel bookmarks"
on public.member_daily_fuel_bookmarks for select to authenticated
using (
  member_id = (select auth.uid())
  and (select private.has_role((select auth.uid()), 'member'))
);

create function public.set_member_daily_fuel_bookmark(
  target_video_id uuid,
  target_saved boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null or not (select private.has_role(caller, 'member')) then
    raise exception 'Member access required' using errcode = '42501';
  end if;

  if target_saved then
    if not exists (
      select 1 from public.member_daily_fuel_assignments a
      where a.member_id = caller and a.video_id = target_video_id
    ) then
      raise exception 'Only a featured video can be saved' using errcode = '42501';
    end if;
    insert into public.member_daily_fuel_bookmarks (member_id, video_id)
    values (caller, target_video_id)
    on conflict (member_id, video_id) do nothing;
  else
    delete from public.member_daily_fuel_bookmarks b
    where b.member_id = caller and b.video_id = target_video_id;
  end if;
  return target_saved;
end;
$$;
revoke all on function public.set_member_daily_fuel_bookmark(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.set_member_daily_fuel_bookmark(uuid, boolean)
  to authenticated;

create table public.member_daily_affirmations (
  member_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  affirmed_at timestamptz not null default now(),
  primary key (member_id, day)
);
alter table public.member_daily_affirmations enable row level security;
revoke all on public.member_daily_affirmations from public, anon, authenticated;
grant select on public.member_daily_affirmations to authenticated;
grant all on public.member_daily_affirmations to service_role;
create policy "Members read their own Daily Fuel affirmations"
on public.member_daily_affirmations for select to authenticated
using (
  member_id = (select auth.uid())
  and (select private.has_role((select auth.uid()), 'member'))
);

create function public.set_member_daily_affirmation(
  target_expected_day date,
  target_affirmed boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  today date := (select private.current_daily_checkin_day());
begin
  if caller is null or not (select private.has_role(caller, 'member')) then
    raise exception 'Member access required' using errcode = '42501';
  end if;
  if target_expected_day is distinct from today then
    raise exception 'Daily Fuel day changed' using errcode = 'P0001';
  end if;

  if target_affirmed then
    insert into public.member_daily_affirmations (member_id, day, affirmed_at)
    values (caller, today, now())
    on conflict (member_id, day) do update set affirmed_at = excluded.affirmed_at;
  else
    delete from public.member_daily_affirmations a
    where a.member_id = caller and a.day = today;
  end if;
  return target_affirmed;
end;
$$;
revoke all on function public.set_member_daily_affirmation(date, boolean)
  from public, anon, authenticated;
grant execute on function public.set_member_daily_affirmation(date, boolean)
  to authenticated;
