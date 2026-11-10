-- Coach Discovery PR 8: richer reviews, coach replies, and safety (reporting reviews and coaches,
-- and members blocking coaches).

-- 1. Category ratings and coach replies ---------------------------------------------------------
alter table public.coach_reviews
  add column rating_communication smallint check (rating_communication between 1 and 5),
  add column rating_knowledge smallint check (rating_knowledge between 1 and 5),
  add column rating_motivation smallint check (rating_motivation between 1 and 5),
  add column rating_results smallint check (rating_results between 1 and 5),
  add column rating_value smallint check (rating_value between 1 and 5),
  add column reply text check (char_length(reply) <= 1000),
  add column replied_at timestamptz;

-- Members insert only their own review fields (never hidden, reply or replied_at).
revoke insert on public.coach_reviews from authenticated;
grant insert (coach_id, member_id, rating, body,
              rating_communication, rating_knowledge, rating_motivation, rating_results, rating_value)
  on public.coach_reviews to authenticated;
grant update (rating_communication, rating_knowledge, rating_motivation, rating_results, rating_value)
  on public.coach_reviews to authenticated;
-- Replies are written only through reply_to_review(), so the member can't write one and the coach
-- can't touch the review itself.

create function public.reply_to_review(target_review_id uuid, reply_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  clean text := btrim(coalesce(reply_text, ''));
begin
  if char_length(clean) > 1000 then
    raise exception 'Keep your reply to 1,000 characters.' using errcode = '22023';
  end if;
  update public.coach_reviews
  set reply = nullif(clean, ''), replied_at = case when clean = '' then null else now() end
  where id = target_review_id and coach_id = caller;
  if not found then
    raise exception 'Review not found.' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.reply_to_review(uuid, text) from public, anon;
grant execute on function public.reply_to_review(uuid, text) to authenticated;

-- 2. Reporting reviews ----------------------------------------------------------------------------
create table public.review_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  review_id uuid not null references public.coach_reviews (id) on delete cascade,
  reason text not null check (reason in ('fake', 'harassment', 'inappropriate', 'personal_info', 'spam', 'other')),
  details text not null default '' check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'hidden', 'dismissed')),
  handled_by uuid references public.profiles (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index review_reports_open_idx on public.review_reports (reporter_id, review_id) where status = 'open';
create index review_reports_status_idx on public.review_reports (status, created_at desc);

-- 3. Reporting coaches ----------------------------------------------------------------------------
create table public.coach_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  coach_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (reason in ('misleading', 'harassment', 'inappropriate', 'off_platform', 'safety', 'spam', 'other')),
  details text not null default '' check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  admin_note text not null default '' check (char_length(admin_note) <= 1000),
  handled_by uuid references public.profiles (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  check (reporter_id <> coach_id)
);
create unique index coach_reports_open_idx on public.coach_reports (reporter_id, coach_id) where status = 'open';
create index coach_reports_status_idx on public.coach_reports (status, created_at desc);

-- 4. Blocking coaches -----------------------------------------------------------------------------
create table public.coach_blocks (
  member_id uuid not null references public.profiles (id) on delete cascade,
  coach_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, coach_id),
  check (member_id <> coach_id)
);

-- True when the member has blocked the coach. Reads blocks without row security.
create function private.coach_blocked(target_coach_id uuid, target_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.coach_blocks where coach_id = target_coach_id and member_id = target_member_id
  );
$$;

-- Row security ------------------------------------------------------------------------------------
alter table public.review_reports enable row level security;
alter table public.coach_reports enable row level security;
alter table public.coach_blocks enable row level security;
revoke all on public.review_reports, public.coach_reports, public.coach_blocks from anon, authenticated;

-- Reporters see their own reports (and admins all). The person reported never sees who reported.
create policy "Reporters and admins read review reports"
on public.review_reports for select to authenticated
using (reporter_id = (select auth.uid()) or (select private.is_admin()));
create policy "People report reviews they can see, but not their own"
on public.review_reports for insert to authenticated
with check (
  reporter_id = (select auth.uid())
  and exists (
    select 1 from public.coach_reviews r
    where r.id = review_id and not r.hidden and r.member_id <> (select auth.uid())
  )
);
grant select on public.review_reports to authenticated;
grant insert (reporter_id, review_id, reason, details) on public.review_reports to authenticated;

create policy "Reporters and admins read coach reports"
on public.coach_reports for select to authenticated
using (reporter_id = (select auth.uid()) or (select private.is_admin()));
create policy "People report coaches"
on public.coach_reports for insert to authenticated
with check (reporter_id = (select auth.uid()) and private.has_role(coach_id, 'coach'));
grant select on public.coach_reports to authenticated;
grant insert (reporter_id, coach_id, reason, details) on public.coach_reports to authenticated;

-- Blocks are private to the member: the coach can't see them.
create policy "Members read their blocks"
on public.coach_blocks for select to authenticated
using (member_id = (select auth.uid()));
create policy "Members unblock"
on public.coach_blocks for delete to authenticated
using (member_id = (select auth.uid()));
grant select, delete on public.coach_blocks to authenticated;

grant all on public.review_reports, public.coach_reports, public.coach_blocks to service_role;

-- Blocking: only members, never a coach they're still with (leave first, so memberships and
-- payments end cleanly). Cancels upcoming intros with that coach.
create function public.block_coach(target_coach_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null or not private.has_role(caller, 'member') then
    raise exception 'Only members can block coaches.' using errcode = '42501';
  end if;
  if not private.has_role(target_coach_id, 'coach') then
    raise exception 'Coach not found.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.coach_members where coach_id = target_coach_id and member_id = caller) then
    raise exception 'Leave this coach before blocking them.' using errcode = '22023';
  end if;
  insert into public.coach_blocks (member_id, coach_id) values (caller, target_coach_id)
  on conflict do nothing;
  -- Upcoming intros go away (the calendar trigger marks them cancelled).
  delete from public.calendar_sessions s
  using public.coach_intro_bookings b, public.coach_intro_slots t
  where b.session_id = s.id and t.id = b.slot_id
    and b.member_id = caller and b.coach_id = target_coach_id
    and b.status = 'booked' and t.starts_at > now();
  delete from public.coach_favorites where member_id = caller and coach_id = target_coach_id;
end;
$$;
revoke all on function public.block_coach(uuid) from public, anon;
grant execute on function public.block_coach(uuid) to authenticated;

-- A blocked coach can't be joined again.
drop policy "Members can join a coach" on public.coach_members;
create policy "Members can join a coach"
on public.coach_members for insert to authenticated
with check (
  member_id = (select auth.uid())
  and private.has_role(member_id, 'member')
  and private.has_role(coach_id, 'coach')
  and private.coach_join_mode(coach_id) <> 'paid'
  and not private.coach_blocked(coach_id, member_id)
);

-- Intro times: a member never sees or books times from a coach they blocked.
create or replace function public.open_intro_slots(target_coach_id uuid)
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
    and not private.coach_blocked(s.coach_id, (select auth.uid()))
    and not exists (
      select 1 from public.coach_intro_bookings b where b.slot_id = s.id and b.status = 'booked'
    )
  order by s.starts_at
  limit 200;
$$;

create or replace function public.book_intro(target_slot_id uuid, intro_message text)
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
     or private.coach_blocked(slot.coach_id, caller)
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

-- Admins handle reports. A decision on a review closes every open report on it.
create function public.handle_review_report(target_report_id uuid, decision text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_review uuid;
begin
  if not private.is_admin() then
    raise exception 'Only admins can handle reports.' using errcode = '42501';
  end if;
  if decision not in ('hidden', 'dismissed') then
    raise exception 'Choose hide or dismiss.' using errcode = '22023';
  end if;
  select review_id into target_review from public.review_reports where id = target_report_id;
  if target_review is null then
    raise exception 'Report not found.' using errcode = 'P0002';
  end if;
  if decision = 'hidden' then
    update public.coach_reviews set hidden = true where id = target_review;
    update public.review_reports
    set status = 'hidden', handled_by = (select auth.uid()), handled_at = now()
    where review_id = target_review and status = 'open';
  else
    update public.review_reports
    set status = 'dismissed', handled_by = (select auth.uid()), handled_at = now()
    where review_id = target_review and status = 'open';
  end if;
end;
$$;
revoke all on function public.handle_review_report(uuid, text) from public, anon;
grant execute on function public.handle_review_report(uuid, text) to authenticated;

create function public.handle_coach_report(target_report_id uuid, decision text, note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Only admins can handle reports.' using errcode = '42501';
  end if;
  if decision not in ('actioned', 'dismissed') then
    raise exception 'Choose actioned or dismissed.' using errcode = '22023';
  end if;
  update public.coach_reports
  set status = decision, admin_note = left(btrim(coalesce(note, '')), 1000),
      handled_by = (select auth.uid()), handled_at = now()
  where id = target_report_id;
  if not found then
    raise exception 'Report not found.' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.handle_coach_report(uuid, text, text) from public, anon;
grant execute on function public.handle_coach_report(uuid, text, text) to authenticated;
