-- Weekly check-ins: members rate their week and share wins and struggles; their coaches reply.
-- Private like tracking: the member and the coaches they joined. Admins don't see them.

create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  energy smallint not null check (energy between 1 and 5),
  sleep smallint not null check (sleep between 1 and 5),
  stress smallint not null check (stress between 1 and 5),
  motivation smallint not null check (motivation between 1 and 5),
  wins text not null default '' check (char_length(wins) <= 1000),
  struggles text not null default '' check (char_length(struggles) <= 1000),
  question text not null default '' check (char_length(question) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, week_start)
);
create index checkins_week_idx on public.checkins (week_start);

create table public.checkin_replies (
  id uuid primary key default gen_random_uuid(),
  checkin_id uuid not null references public.checkins (id) on delete cascade,
  coach_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index checkin_replies_checkin_idx on public.checkin_replies (checkin_id, created_at);

-- The Monday of this week, Eastern time.
create function private.current_week_start()
returns date
language sql
stable
set search_path = ''
as $$
  select date_trunc('week', (now() at time zone 'America/New_York'))::date;
$$;

-- True when the signed-in coach coaches this member.
create function private.coaches_member(target_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.coach_members
    where coach_id = (select auth.uid()) and member_id = target_member_id
  );
$$;
revoke all on function private.current_week_start(), private.coaches_member(uuid) from public, anon;
grant execute on function private.current_week_start(), private.coaches_member(uuid) to authenticated;

alter table public.checkins enable row level security;
alter table public.checkin_replies enable row level security;

create policy "Members and their coaches see check-ins"
on public.checkins for select to authenticated
using (member_id = (select auth.uid()) or (select private.coaches_member(member_id)));
create policy "Members check in for this week"
on public.checkins for insert to authenticated
with check (member_id = (select auth.uid()) and week_start = (select private.current_week_start()));
create policy "Members edit this week's check-in"
on public.checkins for update to authenticated
using (member_id = (select auth.uid()) and week_start = (select private.current_week_start()))
with check (member_id = (select auth.uid()) and week_start = (select private.current_week_start()));

create policy "Members and their coaches see replies"
on public.checkin_replies for select to authenticated
using (
  exists (
    select 1 from public.checkins c
    where c.id = checkin_id
      and (c.member_id = (select auth.uid()) or (select private.coaches_member(c.member_id)))
  )
);
create policy "Coaches reply to their members"
on public.checkin_replies for insert to authenticated
with check (
  coach_id = (select auth.uid())
  and exists (select 1 from public.checkins c where c.id = checkin_id and (select private.coaches_member(c.member_id)))
);
create policy "Coaches remove their replies"
on public.checkin_replies for delete to authenticated using (coach_id = (select auth.uid()));

revoke all on public.checkins, public.checkin_replies from public, anon, authenticated;
grant select, insert on public.checkins to authenticated;
grant update (energy, sleep, stress, motivation, wins, struggles, question, updated_at) on public.checkins to authenticated;
grant select, insert, delete on public.checkin_replies to authenticated;
grant select on public.checkins, public.checkin_replies to service_role;

-- Sunday-evening "check in for the week" reminders are logged so each goes out once.
alter table public.reminder_log drop constraint reminder_log_kind_check;
alter table public.reminder_log add constraint reminder_log_kind_check
  check (kind in ('session', 'task', 'streak', 'weekly', 'program', 'checkin'));
