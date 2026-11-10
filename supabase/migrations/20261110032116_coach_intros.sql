-- Coach Discovery PR 7: free intro sessions. Coaches publish times; members book one with an
-- optional message. A booking also becomes a normal calendar session, so it shows on both
-- calendars and gets the usual reminders.

create table public.coach_intro_slots (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles (id) on delete cascade,
  starts_at timestamptz not null,
  minutes integer not null check (minutes in (15, 20, 30, 45, 60)),
  format text not null check (format in ('online', 'in_person')),
  -- Shared with the member only once they book.
  location text not null default '' check (char_length(location) <= 200),
  meeting_url text check (meeting_url ~ '^https://' and char_length(meeting_url) <= 500),
  created_at timestamptz not null default now(),
  unique (coach_id, starts_at)
);
create index coach_intro_slots_coach_idx on public.coach_intro_slots (coach_id, starts_at);

create table public.coach_intro_bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.coach_intro_slots (id) on delete cascade,
  coach_id uuid not null references public.profiles (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  session_id uuid references public.calendar_sessions (id) on delete set null,
  message text not null default '' check (char_length(message) <= 1000),
  status text not null default 'booked' check (status in ('booked', 'cancelled')),
  cancelled_by uuid references public.profiles (id) on delete set null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  check (member_id <> coach_id)
);
-- One booking per time, and one free intro per member and coach (a cancelled one doesn't count).
create unique index coach_intro_bookings_slot_idx
  on public.coach_intro_bookings (slot_id) where status = 'booked';
create unique index coach_intro_bookings_pair_idx
  on public.coach_intro_bookings (coach_id, member_id) where status = 'booked';
create index coach_intro_bookings_member_idx on public.coach_intro_bookings (member_id);
create index coach_intro_bookings_session_idx on public.coach_intro_bookings (session_id);

alter table public.coach_intro_slots enable row level security;
alter table public.coach_intro_bookings enable row level security;
revoke all on public.coach_intro_slots, public.coach_intro_bookings from anon, authenticated;

-- Slots: the coach manages their own. Members see open times only through open_intro_slots().
create policy "Coaches read their intro times"
on public.coach_intro_slots for select to authenticated
using (coach_id = (select auth.uid()) or (select private.is_admin()));

create policy "Coaches add future intro times"
on public.coach_intro_slots for insert to authenticated
with check (
  coach_id = (select auth.uid())
  and private.has_role(coach_id, 'coach')
  and starts_at > now()
  and starts_at < now() + interval '120 days'
);

create policy "Coaches remove intro times nobody has booked"
on public.coach_intro_slots for delete to authenticated
using (
  coach_id = (select auth.uid())
  and not exists (
    select 1 from public.coach_intro_bookings b
    where b.slot_id = coach_intro_slots.id and b.status = 'booked'
  )
);

grant select, delete on public.coach_intro_slots to authenticated;
grant insert (coach_id, starts_at, minutes, format, location, meeting_url)
  on public.coach_intro_slots to authenticated;

-- Bookings: the two people involved (and admins) can read them. Writes go through functions.
create policy "People read their own intro bookings"
on public.coach_intro_bookings for select to authenticated
using (
  member_id = (select auth.uid())
  or coach_id = (select auth.uid())
  or (select private.is_admin())
);
grant select on public.coach_intro_bookings to authenticated;
grant all on public.coach_intro_slots, public.coach_intro_bookings to service_role;

-- Open future times for a coach with an approved profile. No location or link until booked.
create function public.open_intro_slots(target_coach_id uuid)
returns table (id uuid, starts_at timestamptz, minutes integer, format text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.starts_at, s.minutes, s.format
  from public.coach_intro_slots s
  where s.coach_id = target_coach_id
    and s.starts_at > now() + interval '1 hour'
    and exists (select 1 from public.coach_profiles_public p where p.coach_id = s.coach_id)
    and not exists (
      select 1 from public.coach_intro_bookings b where b.slot_id = s.id and b.status = 'booked'
    )
  order by s.starts_at
  limit 200;
$$;
revoke all on function public.open_intro_slots(uuid) from public, anon;
grant execute on function public.open_intro_slots(uuid) to authenticated;

-- A member books a free intro. Also adds it to both calendars, already marked Going.
create function public.book_intro(target_slot_id uuid, intro_message text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  slot public.coach_intro_slots;
  member_name text;
  new_session uuid;
  booking uuid;
  clean_message text := btrim(coalesce(intro_message, ''));
begin
  if caller is null or not private.has_role(caller, 'member') then
    raise exception 'Only members can book an intro.' using errcode = '42501';
  end if;
  if char_length(clean_message) > 1000 then
    raise exception 'Keep your message to 1,000 characters.' using errcode = '22023';
  end if;

  select * into slot from public.coach_intro_slots where id = target_slot_id for update;
  if slot.id is null
     or slot.starts_at <= now() + interval '1 hour'
     or not exists (select 1 from public.coach_profiles_public p where p.coach_id = slot.coach_id)
  then
    raise exception 'That time isn''t available any more.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.coach_intro_bookings where slot_id = slot.id and status = 'booked') then
    raise exception 'Someone just booked that time. Please pick another.' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.coach_intro_bookings
    where coach_id = slot.coach_id and member_id = caller and status = 'booked'
  ) then
    raise exception 'You already have an intro with this coach.' using errcode = '23505';
  end if;
  if (
    select count(*) from public.coach_intro_bookings b
    join public.coach_intro_slots s on s.id = b.slot_id
    where b.member_id = caller and b.status = 'booked' and s.starts_at > now()
  ) >= 3 then
    raise exception 'You can have up to 3 upcoming intros at a time.' using errcode = '54000';
  end if;

  select display_name into member_name from public.profiles where id = caller;
  insert into public.calendar_sessions (coach_id, title, notes, location, meeting_url, starts_at, ends_at)
  values (
    slot.coach_id,
    left('Free intro: ' || coalesce(member_name, 'New member'), 120),
    'A free intro session booked from your GYMX2 profile.',
    slot.location,
    slot.meeting_url,
    slot.starts_at,
    slot.starts_at + make_interval(mins => slot.minutes)
  )
  returning id into new_session;
  insert into public.session_invites (session_id, member_id, response, responded_at)
  values (new_session, caller, 'going', now());

  insert into public.coach_intro_bookings (slot_id, coach_id, member_id, session_id, message)
  values (slot.id, slot.coach_id, caller, new_session, clean_message)
  returning id into booking;
  return booking;
end;
$$;
revoke all on function public.book_intro(uuid, text) from public, anon;
grant execute on function public.book_intro(uuid, text) to authenticated;

-- Either person cancels a future intro. The time opens up again.
create function public.cancel_intro(target_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  b public.coach_intro_bookings;
begin
  select * into b from public.coach_intro_bookings where id = target_booking_id for update;
  if b.id is null or caller is null or caller not in (b.member_id, b.coach_id) then
    raise exception 'Intro not found.' using errcode = 'P0002';
  end if;
  if b.status <> 'booked' then
    raise exception 'This intro was already cancelled.' using errcode = '22023';
  end if;
  if (select starts_at from public.coach_intro_slots where id = b.slot_id) <= now() then
    raise exception 'This intro has already started.' using errcode = '22023';
  end if;
  update public.coach_intro_bookings
  set status = 'cancelled', cancelled_by = caller, cancelled_at = now()
  where id = b.id;
  if b.session_id is not null then
    delete from public.calendar_sessions where id = b.session_id;
  end if;
end;
$$;
revoke all on function public.cancel_intro(uuid) from public, anon;
grant execute on function public.cancel_intro(uuid) to authenticated;

-- A coach who cancels the session from their calendar cancels the intro too.
create function private.cancel_intro_with_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.coach_intro_bookings
  set status = 'cancelled', cancelled_by = (select auth.uid()), cancelled_at = now()
  where session_id = old.id and status = 'booked';
  return old;
end;
$$;
create trigger calendar_sessions_cancel_intro
before delete on public.calendar_sessions
for each row execute function private.cancel_intro_with_session();
