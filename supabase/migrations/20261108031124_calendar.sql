-- GYMX2 Calendar: coaches schedule sessions, invite their members, and members reply Going or Can't go.
-- Like Tasks, sessions are only written through functions that check who is calling.

create type public.session_response as enum ('pending', 'going', 'not_going');

create table public.calendar_sessions (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  notes text not null default '' check (char_length(notes) <= 2000),
  location text not null default '' check (char_length(location) <= 200),
  meeting_url text check (meeting_url ~ '^https://' and char_length(meeting_url) <= 500),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at <= starts_at + interval '24 hours')
);

create index calendar_sessions_coach_idx on public.calendar_sessions (coach_id, starts_at);
create index calendar_sessions_starts_idx on public.calendar_sessions (starts_at);

create trigger calendar_sessions_set_updated_at
before update on public.calendar_sessions
for each row execute function public.set_updated_at();

create table public.session_invites (
  session_id uuid not null references public.calendar_sessions (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  response public.session_response not null default 'pending',
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (session_id, member_id)
);

create index session_invites_member_idx on public.session_invites (member_id);

-- Reads invites without row security, so the session and invite rules can't loop back on each other.
create function private.is_session_invitee(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.session_invites
    where session_id = target_session_id and member_id = (select auth.uid())
  );
$$;

alter table public.calendar_sessions enable row level security;
alter table public.session_invites enable row level security;

create policy "People can read sessions they run or were invited to"
on public.calendar_sessions for select to authenticated
using (
  coach_id = (select auth.uid())
  or (select private.is_admin())
  or private.is_session_invitee(id)
);

create policy "Coaches can cancel their own sessions"
on public.calendar_sessions for delete to authenticated
using (coach_id = (select auth.uid()));

create policy "People can read invites they sent or received"
on public.session_invites for select to authenticated
using (
  member_id = (select auth.uid())
  or (select private.is_admin())
  or exists (
    select 1 from public.calendar_sessions s
    where s.id = session_invites.session_id and s.coach_id = (select auth.uid())
  )
);

-- Checks shared by creating and editing a session. Raises a readable message for anything wrong.
create function private.check_session_input(
  caller uuid,
  session_title text,
  session_starts_at timestamptz,
  session_ends_at timestamptz,
  target_member_ids uuid[]
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_role(caller, 'coach') then
    raise exception 'Coach access required' using errcode = '42501';
  end if;

  if char_length(trim(coalesce(session_title, ''))) = 0 then
    raise exception 'Enter a title' using errcode = 'P0001';
  end if;

  if session_ends_at <= session_starts_at then
    raise exception 'The session must end after it starts' using errcode = 'P0001';
  end if;

  if session_ends_at > session_starts_at + interval '24 hours' then
    raise exception 'A session can last up to 24 hours' using errcode = 'P0001';
  end if;

  if coalesce(cardinality(target_member_ids), 0) = 0 then
    raise exception 'Invite at least one member' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from unnest(target_member_ids) as m (id)
    where not exists (
      select 1 from public.coach_members cm
      where cm.coach_id = caller and cm.member_id = m.id
    )
  ) then
    raise exception 'You can only invite members who joined you' using errcode = 'P0001';
  end if;
end;
$$;

create function public.create_session(
  session_title text,
  session_notes text,
  session_location text,
  session_meeting_url text,
  session_starts_at timestamptz,
  session_ends_at timestamptz,
  target_member_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  new_session_id uuid;
begin
  perform private.check_session_input(
    caller, session_title, session_starts_at, session_ends_at, target_member_ids
  );

  if session_starts_at < now() then
    raise exception 'Choose a start time in the future' using errcode = 'P0001';
  end if;

  insert into public.calendar_sessions (coach_id, title, notes, location, meeting_url, starts_at, ends_at)
  values (
    caller,
    trim(session_title),
    coalesce(session_notes, ''),
    coalesce(session_location, ''),
    nullif(session_meeting_url, ''),
    session_starts_at,
    session_ends_at
  )
  returning id into new_session_id;

  insert into public.session_invites (session_id, member_id)
  select distinct new_session_id, m.id
  from unnest(target_member_ids) as m (id);

  return new_session_id;
end;
$$;

-- Members kept on the guest list keep their reply. Anyone newly invited starts as pending.
-- Moving a session to a new time resets replies, since "Going" was an answer about the old time.
create function public.update_session(
  target_session_id uuid,
  session_title text,
  session_notes text,
  session_location text,
  session_meeting_url text,
  session_starts_at timestamptz,
  session_ends_at timestamptz,
  target_member_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  old_starts_at timestamptz;
  old_ends_at timestamptz;
begin
  perform private.check_session_input(
    caller, session_title, session_starts_at, session_ends_at, target_member_ids
  );

  select starts_at, ends_at into old_starts_at, old_ends_at
  from public.calendar_sessions
  where id = target_session_id and coach_id = caller
  for update;

  if not found then
    raise exception 'Session not found' using errcode = 'P0002';
  end if;

  update public.calendar_sessions
  set title = trim(session_title),
      notes = coalesce(session_notes, ''),
      location = coalesce(session_location, ''),
      meeting_url = nullif(session_meeting_url, ''),
      starts_at = session_starts_at,
      ends_at = session_ends_at
  where id = target_session_id;

  delete from public.session_invites
  where session_id = target_session_id
    and member_id <> all (target_member_ids);

  insert into public.session_invites (session_id, member_id)
  select distinct target_session_id, m.id
  from unnest(target_member_ids) as m (id)
  on conflict (session_id, member_id) do nothing;

  if session_starts_at <> old_starts_at or session_ends_at <> old_ends_at then
    update public.session_invites
    set response = 'pending', responded_at = null
    where session_id = target_session_id;
  end if;
end;
$$;

-- The time is set here, not by the browser.
create function public.respond_to_session(target_session_id uuid, new_response public.session_response)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new_response = 'pending' then
    raise exception 'Choose Going or Can''t go' using errcode = 'P0001';
  end if;

  update public.session_invites
  set response = new_response, responded_at = now()
  where session_id = target_session_id and member_id = (select auth.uid());

  if not found then
    raise exception 'Session not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Leaving a coach removes invites to that coach's upcoming sessions. Past ones stay as history.
create function private.clear_upcoming_invites()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.session_invites i
  using public.calendar_sessions s
  where i.session_id = s.id
    and s.coach_id = old.coach_id
    and i.member_id = old.member_id
    and s.starts_at > now();
  return old;
end;
$$;

create trigger coach_members_clear_upcoming_invites
after delete on public.coach_members
for each row execute function private.clear_upcoming_invites();

revoke all on public.calendar_sessions from public, anon, authenticated;
revoke all on public.session_invites from public, anon, authenticated;

grant select, delete on public.calendar_sessions to authenticated;
grant select on public.session_invites to authenticated;

revoke all on function private.is_session_invitee(uuid) from public, anon;
revoke all on function private.check_session_input(uuid, text, timestamptz, timestamptz, uuid[]) from public, anon, authenticated;
revoke all on function private.clear_upcoming_invites() from public, anon, authenticated;
revoke all on function public.create_session(text, text, text, text, timestamptz, timestamptz, uuid[]) from public, anon;
revoke all on function public.update_session(uuid, text, text, text, text, timestamptz, timestamptz, uuid[]) from public, anon;
revoke all on function public.respond_to_session(uuid, public.session_response) from public, anon;

grant execute on function private.is_session_invitee(uuid) to authenticated;
grant execute on function public.create_session(text, text, text, text, timestamptz, timestamptz, uuid[]) to authenticated;
grant execute on function public.update_session(uuid, text, text, text, text, timestamptz, timestamptz, uuid[]) to authenticated;
grant execute on function public.respond_to_session(uuid, public.session_response) to authenticated;
