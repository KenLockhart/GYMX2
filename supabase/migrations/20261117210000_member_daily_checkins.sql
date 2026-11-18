-- Daily wellbeing answers are separate from the Monday-based weekly check-in.
create table public.member_daily_checkins (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  energy smallint not null check (energy between 1 and 5),
  sleep smallint not null check (sleep between 1 and 5),
  stress smallint not null check (stress between 1 and 5),
  motivation smallint not null check (motivation between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, day)
);
create index member_daily_checkins_day_idx
  on public.member_daily_checkins (member_id, day desc);

create function private.current_daily_checkin_day()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/New_York')::date;
$$;
revoke all on function private.current_daily_checkin_day() from public, anon;
grant execute on function private.current_daily_checkin_day() to authenticated;

alter table public.member_daily_checkins enable row level security;
create policy "Members and their coaches see daily check-ins"
on public.member_daily_checkins for select to authenticated
using (
  (
    member_id = (select auth.uid())
    and (select private.has_role((select auth.uid()), 'member'))
  )
  or (
    (select private.has_role((select auth.uid()), 'coach'))
    and (select private.coaches_member(member_id))
  )
);
create policy "Members save today's daily check-in"
on public.member_daily_checkins for insert to authenticated
with check (
  member_id = (select auth.uid())
  and (select private.has_role((select auth.uid()), 'member'))
  and day = (select private.current_daily_checkin_day())
);
create policy "Members update today's daily check-in"
on public.member_daily_checkins for update to authenticated
using (
  member_id = (select auth.uid())
  and (select private.has_role((select auth.uid()), 'member'))
  and day = (select private.current_daily_checkin_day())
)
with check (
  member_id = (select auth.uid())
  and (select private.has_role((select auth.uid()), 'member'))
  and day = (select private.current_daily_checkin_day())
);

revoke all on public.member_daily_checkins from public, anon, authenticated;
grant select, insert on public.member_daily_checkins to authenticated;
grant update (energy, sleep, stress, motivation, updated_at)
  on public.member_daily_checkins to authenticated;

-- The RPC derives both identity and date from the authenticated request. On conflict it only
-- updates answer columns, so members never need UPDATE permission on the identity/date columns.
create function public.save_member_daily_checkin(
  target_expected_day date,
  target_energy integer,
  target_sleep integer,
  target_stress integer,
  target_motivation integer
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  today date := (select private.current_daily_checkin_day());
  saved_id uuid;
begin
  if caller is null or not (select private.has_role(caller, 'member')) then
    raise exception 'Member access required' using errcode = '42501';
  end if;
  if target_expected_day is distinct from today then
    raise exception 'Daily check-in day changed' using errcode = 'P0001';
  end if;

  insert into public.member_daily_checkins (
    member_id, day, energy, sleep, stress, motivation
  )
  values (
    caller, today, target_energy, target_sleep, target_stress, target_motivation
  )
  on conflict (member_id, day) do update
  set energy = excluded.energy,
      sleep = excluded.sleep,
      stress = excluded.stress,
      motivation = excluded.motivation,
      updated_at = now()
  returning id into saved_id;

  return saved_id;
end;
$$;
revoke all on function public.save_member_daily_checkin(date, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.save_member_daily_checkin(date, integer, integer, integer, integer)
  to authenticated;
