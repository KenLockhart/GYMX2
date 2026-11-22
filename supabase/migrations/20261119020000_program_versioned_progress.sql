-- Gate 2: version-aware Program enrollment, lesson progress, and conversion fencing.
-- Checkout and media playback remain disabled until the later provider/media gates ship.

-- Acquire policy/ACL targets at their strongest migration-time mode before any FK DDL. Policy
-- changes need ACCESS EXCLUSIVE; taking this with NOWAIT avoids a later lock upgrade cycle with
-- a reader that itself needs to write. The remaining FK/backfill parents use the compatible
-- write-fence mode. A busy relation aborts this whole migration quickly for a clean retry.
set local lock_timeout = '5s';
lock table public.program_day_completions, public.program_days,
  public.program_enrollments, public.programs in access exclusive mode nowait;
lock table public.profiles, public.program_commerce_state,
  public.program_content_versions, public.program_offer_versions
  in share row exclusive mode nowait;

create table public.program_versioning_fences (
  program_id uuid primary key references public.programs (id) on delete cascade,
  source_content_version_id uuid not null,
  snapshot_content_version_id uuid not null,
  phase text not null default 'awaiting_publication'
    check (phase in ('awaiting_publication')),
  created_at timestamptz not null default now(),
  created_by uuid
);
alter table public.program_versioning_fences enable row level security;
revoke all on public.program_versioning_fences from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.program_versioning_fences to service_role;

-- The subject UUID is an immutable fact, not an FK. owner_member_id is the nullable live
-- ownership link; profile deletion clears it without deleting the progress audit.
create table public.program_lesson_progress_events (
  id uuid primary key default gen_random_uuid(),
  subject_member_id uuid not null,
  owner_member_id uuid references public.profiles (id) on delete set null,
  program_id uuid not null,
  program_owner_id uuid,
  program_title_snapshot text not null check (char_length(program_title_snapshot) between 1 and 120),
  content_version_id uuid not null,
  lesson_id uuid not null,
  lesson_identity_id uuid not null,
  source_enrollment_id uuid,
  source_day_id uuid,
  order_id uuid,
  lesson_ordinal smallint not null check (lesson_ordinal between 1 and 365),
  timeline_day_number smallint not null check (timeline_day_number between 1 and 365),
  lesson_title text not null check (char_length(lesson_title) between 1 and 120),
  lesson_pillar public.pillar not null,
  event_sequence integer not null check (event_sequence > 0),
  operation_id uuid not null,
  operation_digest text not null check (operation_digest ~ '^[0-9a-f]{32}$'),
  event_state text not null check (event_state in ('completed', 'undone')),
  occurred_at timestamptz not null default now(),
  check ((source_enrollment_id is null) = (source_day_id is null)),
  check (owner_member_id is null or owner_member_id = subject_member_id),
  unique (subject_member_id, program_id, operation_id),
  unique (subject_member_id, program_id, event_sequence)
);
create unique index program_lesson_progress_source_once_idx
  on public.program_lesson_progress_events (
    subject_member_id, program_id, content_version_id, source_enrollment_id, source_day_id
  ) where source_enrollment_id is not null and source_day_id is not null;
create index program_lesson_progress_subject_program_idx
  on public.program_lesson_progress_events (subject_member_id, program_id, content_version_id, lesson_id, event_sequence desc);
alter table public.program_lesson_progress_events enable row level security;
revoke all on public.program_lesson_progress_events from public, anon, authenticated, service_role;
grant select, insert on public.program_lesson_progress_events to service_role;

-- Preserve the current completion facts for the legacy free path before raw mutations are closed.
insert into public.program_lesson_progress_events (
  subject_member_id, owner_member_id, program_id, program_owner_id, program_title_snapshot,
  content_version_id, lesson_id, lesson_identity_id, source_enrollment_id, source_day_id,
  lesson_ordinal, timeline_day_number, lesson_title, lesson_pillar, event_sequence,
  operation_id, operation_digest, event_state, occurred_at
)
select completion.member_id, completion.member_id, enrollment.program_id, program.coach_id,
       program.title, coalesce(enrollment.content_version_id, state.current_content_version_id),
       case when enrollment.content_version_id is null then day.id else lesson.id end,
       case when enrollment.content_version_id is null then day.id else coalesce(lesson.source_day_id, lesson.id) end,
       enrollment.id, day.id,
       case when enrollment.content_version_id is null then (
         select count(*)::smallint from public.program_days ordered_day
         where ordered_day.program_id = enrollment.program_id
           and (ordered_day.day_number, ordered_day.id) <= (day.day_number, day.id)
       ) else lesson.lesson_ordinal end,
       case when enrollment.content_version_id is null then day.day_number else lesson.timeline_day_number end,
       case when enrollment.content_version_id is null then day.title else lesson.title end,
       case when enrollment.content_version_id is null then day.pillar else lesson.pillar end,
       row_number() over (
         partition by completion.member_id, enrollment.program_id
         order by completion.completed_at, completion.day_id
       )::integer,
       gen_random_uuid(),
       md5(concat_ws('|', enrollment.program_id::text, enrollment.id::text,
                     completion.day_id::text, completion.completed_at::text, 'completed')),
       'completed', completion.completed_at
from public.program_day_completions completion
join public.program_enrollments enrollment on enrollment.id = completion.enrollment_id
join public.programs program on program.id = enrollment.program_id
join public.program_commerce_state state on state.program_id = enrollment.program_id
join public.program_days day on day.id = completion.day_id and day.program_id = enrollment.program_id
left join public.program_content_version_lessons lesson
  on lesson.program_id = state.program_id
 and lesson.content_version_id = coalesce(enrollment.content_version_id, state.current_content_version_id)
 and lesson.source_day_id = day.id;

create function private.program_uses_versioned_lessons(target_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.program_commerce_state state
    join public.program_content_versions version
      on version.program_id = state.program_id and version.id = state.current_content_version_id
    where state.program_id = target_program_id and version.revision_kind <> 'current'
  ) or exists (
    select 1 from public.program_enrollments enrollment
    where enrollment.program_id = target_program_id and enrollment.content_version_id is not null
  ) or exists (
    select 1 from public.program_versioning_fences fence
    where fence.program_id = target_program_id
  ) or exists (
    select 1 from public.program_orders orders where orders.program_id = target_program_id
  );
$$;
revoke all on function private.program_uses_versioned_lessons(uuid) from public, anon;
grant execute on function private.program_uses_versioned_lessons(uuid) to authenticated, service_role;

create or replace function private.program_legacy_days_are_visible(target_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not private.program_uses_versioned_lessons(target_program_id);
$$;
revoke all on function private.program_legacy_days_are_visible(uuid) from public, anon;
grant execute on function private.program_legacy_days_are_visible(uuid) to authenticated, service_role;

-- A single advisory lock is always acquired before any Program, enrollment, day, or completion
-- row is changed. User-facing mutation RPCs and snapshot conversion use the same key.
create function private.lock_program_mutation(target_program_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_program_id is null then
    raise exception 'Program is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_program_id::text, 7142026));
end;
$$;
revoke all on function private.lock_program_mutation(uuid) from public, anon, authenticated;
grant execute on function private.lock_program_mutation(uuid) to service_role;

-- The legacy owns_program helper does not validate the actor's current role or the
-- platform_owned boundary. Use this helper for new management and cross-member reads.
create function private.can_manage_program(target_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.programs program
    where program.id = target_program_id
      and program.coach_id = auth.uid()
      and (
        (program.platform_owned and private.is_admin())
        or (
          not program.platform_owned
          and program.coach_id = auth.uid()
          and private.has_role(auth.uid(), 'coach'::public.user_role)
        )
      )
  );
$$;
revoke all on function private.can_manage_program(uuid) from public, anon;
grant execute on function private.can_manage_program(uuid) to authenticated, service_role;

-- Explicit target-member eligibility is usable by both authenticated RPCs and service
-- readers; it never impersonates auth.uid() for a service-role request.
create function private.can_member_access_program(target_program_id uuid, target_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_program_id is not null and target_member_id is not null
    and private.has_role(target_member_id, 'member'::public.user_role)
    and private.has_platform_tier(target_member_id, 'regular')
    and exists (
      select 1 from public.programs program
      where program.id = target_program_id and program.published
        and (
          program.platform_owned
          or exists (
            select 1 from public.coach_members coach_member
            where coach_member.coach_id = program.coach_id
              and coach_member.member_id = target_member_id
          )
        )
    )
    and not exists (
      select 1 from public.platform_membership_deletion_locks deletion_lock
      where deletion_lock.member_id = target_member_id
    );
$$;
revoke all on function private.can_member_access_program(uuid, uuid) from public, anon;
grant execute on function private.can_member_access_program(uuid, uuid) to authenticated, service_role;

drop policy if exists "People who see a program see its days" on public.program_days;
create policy "People see unconverted free program days"
on public.program_days for select to authenticated
using (
  (select private.can_manage_program(program_id))
  or (
    (select private.program_legacy_days_are_visible(program_id))
    and (select private.can_member_access_program(program_id, auth.uid()))
  )
);
drop policy if exists "Coaches add days" on public.program_days;
drop policy if exists "Coaches change days" on public.program_days;
drop policy if exists "Coaches remove days" on public.program_days;

drop policy if exists "Members start programs they can see" on public.program_enrollments;
drop policy if exists "Members leave programs" on public.program_enrollments;
drop policy if exists "Members see their enrollments; coaches see their programs' members"
  on public.program_enrollments;
create policy "Members see their enrollments; coaches see their programs' members"
on public.program_enrollments for select to authenticated
using (member_id = (select auth.uid()) or (select private.can_manage_program(program_id)) or (select private.is_admin()));

drop policy if exists "Members complete their own days" on public.program_day_completions;
drop policy if exists "Members undo their own days" on public.program_day_completions;
drop policy if exists "Members see their progress; coaches see their programs' progress"
  on public.program_day_completions;
create policy "People see unconverted free program progress"
on public.program_day_completions for select to authenticated
using (
  (member_id = (select auth.uid()) or exists (
    select 1 from public.program_enrollments enrollment
    where enrollment.id = enrollment_id
      and ((select private.can_manage_program(enrollment.program_id)) or (select private.is_admin()))
  ))
  and exists (
    select 1 from public.program_enrollments enrollment
    where enrollment.id = enrollment_id
      and (select private.program_legacy_days_are_visible(enrollment.program_id))
  )
);

revoke insert, update, delete on public.program_days from authenticated;
revoke insert, update, delete on public.program_enrollments from authenticated;
revoke insert, delete on public.program_day_completions from authenticated;
revoke delete on public.programs from authenticated;
grant select on public.program_days to authenticated;
grant select on public.program_enrollments, public.program_day_completions to authenticated;

create or replace function public.snapshot_program_free_content(target_program_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  program_owner uuid;
  platform_owned boolean;
  existing_offer_kind text;
  current_version uuid;
  next_revision integer;
  next_offer_number integer;
  day_count integer;
  content_version uuid;
  offer_version uuid;
  profile_member_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program conversion is server managed' using errcode = '42501';
  end if;
  perform set_config('lock_timeout', '5s', true);
  perform set_config('statement_timeout', '2min', true);
  perform private.lock_program_mutation(target_program_id);
  select p.coach_id, p.platform_owned, offer.offer_kind,
         state.current_content_version_id
    into program_owner, platform_owned, existing_offer_kind, current_version
  from public.programs p
  join public.program_commerce_state state on state.program_id = p.id
  join public.program_offer_versions offer
    on offer.program_id = state.program_id and offer.id = state.current_offer_version_id
  where p.id = target_program_id
  for update of p, state;
  if not found then
    raise exception 'Program conversion state is missing' using errcode = 'P0002';
  end if;
  if existing_offer_kind <> 'free'
    or exists (select 1 from public.program_orders orders where orders.program_id = target_program_id)
    or exists (select 1 from public.program_versioning_fences fence where fence.program_id = target_program_id)
  then
    raise exception 'Only an unfenced free Program can begin conversion' using errcode = '23514';
  end if;

  -- Account deletion can hold a member profile while cascading their enrollment row. Lock the
  -- referenced profile parents before touching enrollments/events, but fail fast if deletion
  -- already owns one so the two transactions cannot deadlock.
  for profile_member_id in
    select distinct enrollment.member_id
    from public.program_enrollments enrollment
    where enrollment.program_id = target_program_id
    order by enrollment.member_id
  loop
    begin
      perform 1 from public.profiles profile
      where profile.id = profile_member_id
      for key share nowait;
    exception when lock_not_available then
      raise exception 'Program conversion is waiting for account cleanup' using errcode = '55P03';
    end;
    if not found then
      raise exception 'Program conversion is waiting for account cleanup' using errcode = '55P03';
    end if;
  end loop;

  select count(*)::integer into day_count
  from public.program_days d where d.program_id = target_program_id;
  if day_count > 365 then
    raise exception 'Program lesson count exceeds the supported limit' using errcode = '23514';
  end if;
  select coalesce(max(v.revision_number), 0) + 1 into next_revision
  from public.program_content_versions v where v.program_id = target_program_id;
  insert into public.program_content_versions (
    program_id, revision_number, revision_kind, lesson_count, created_by
  ) values (target_program_id, next_revision, 'free_snapshot', day_count, caller)
  returning id into content_version;

  insert into public.program_content_version_lessons (
    program_id, content_version_id, lesson_ordinal, timeline_day_number, source_day_id,
    title, instructions, pillar, video_id, video_creator_id, cloudflare_uid,
    cloudflare_signed_urls_verified
  )
  select d.program_id, content_version,
         row_number() over (order by d.day_number, d.id)::smallint,
         d.day_number::smallint, d.id, d.title, d.instructions, d.pillar,
         d.video_id, video.coach_id, video.cloudflare_uid, false
  from public.program_days d
  left join public.videos video on video.id = d.video_id
  where d.program_id = target_program_id
  order by d.day_number, d.id;

  select coalesce(max(o.offer_number), 0) + 1 into next_offer_number
  from public.program_offer_versions o where o.program_id = target_program_id;
  insert into public.program_offer_versions (
    program_id, offer_number, content_version_id, offer_kind, list_price_cents,
    currency, max_installments, platform_owned, seller_profile_id, connected_account_id, created_by
  ) values (
    target_program_id, next_offer_number, content_version, 'free', 0, 'usd', 1,
    platform_owned, program_owner, null, caller
  ) returning id into offer_version;

  -- Capture only legacy completions that still exist at the exact source day. Facts have no
  -- mutable-day/version FK, so later editing or deleting a source day cannot erase this history.
  insert into public.program_lesson_progress_events (
    subject_member_id, owner_member_id, program_id, program_owner_id, program_title_snapshot,
    content_version_id, lesson_id,
    lesson_identity_id, source_enrollment_id, source_day_id, lesson_ordinal,
    timeline_day_number, lesson_title, lesson_pillar, event_sequence, operation_id,
    operation_digest, event_state, occurred_at
  )
  select completion.member_id, completion.member_id, target_program_id, program_owner,
         (select program.title from public.programs program where program.id = target_program_id), content_version,
         lesson.id, coalesce(lesson.source_day_id, lesson.id), enrollment.id, completion.day_id,
         lesson.lesson_ordinal, lesson.timeline_day_number, lesson.title, lesson.pillar,
         (select coalesce(max(existing_event.event_sequence), 0)
            from public.program_lesson_progress_events existing_event
            where existing_event.subject_member_id = completion.member_id
              and existing_event.program_id = target_program_id)
           + row_number() over (
             partition by completion.member_id
             order by completion.completed_at, completion.day_id
           )::integer,
         gen_random_uuid(),
         md5(concat_ws('|', target_program_id::text, enrollment.id::text,
                       completion.day_id::text, completion.completed_at::text, 'completed')),
         'completed', completion.completed_at
  from public.program_enrollments enrollment
  join public.program_day_completions completion on completion.enrollment_id = enrollment.id
  join public.program_content_version_lessons lesson
    on lesson.program_id = target_program_id
   and lesson.content_version_id = content_version
   and lesson.source_day_id = completion.day_id
  where enrollment.program_id = target_program_id and enrollment.content_version_id is null;

  update public.program_enrollments enrollment
  set content_version_id = content_version
  where enrollment.program_id = target_program_id and enrollment.content_version_id is null;

  update public.program_commerce_state state
  set current_content_version_id = content_version,
      current_offer_version_id = offer_version,
      updated_at = now()
  where state.program_id = target_program_id;

  -- This fence commits with the snapshot. New enrollments remain blocked until a later paid
  -- publication releases it atomically, or a reviewed service recovery aborts to the free offer.
  insert into public.program_versioning_fences (
    program_id, source_content_version_id, snapshot_content_version_id, created_by
  ) values (target_program_id, current_version, content_version, caller);
  return content_version;
end;
$$;
revoke all on function public.snapshot_program_free_content(uuid) from public, anon, authenticated;
grant execute on function public.snapshot_program_free_content(uuid) to service_role;

create function public.abort_program_free_snapshot_conversion(
  target_program_id uuid,
  target_snapshot_version_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  state_row public.program_commerce_state%rowtype;
  fence_row public.program_versioning_fences%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program conversion recovery is server managed' using errcode = '42501';
  end if;
  perform set_config('lock_timeout', '5s', true);
  perform private.lock_program_mutation(target_program_id);
  select * into state_row from public.program_commerce_state state
  where state.program_id = target_program_id for update;
  if not found then return false; end if;
  select * into fence_row from public.program_versioning_fences fence
  where fence.program_id = target_program_id for update;
  if not found or fence_row.snapshot_content_version_id <> target_snapshot_version_id
    or state_row.current_content_version_id <> target_snapshot_version_id
    or not exists (
      select 1 from public.program_offer_versions offer
      where offer.program_id = target_program_id
        and offer.id = state_row.current_offer_version_id
        and offer.content_version_id = target_snapshot_version_id
        and offer.offer_kind = 'free'
    )
    or exists (select 1 from public.program_orders orders where orders.program_id = target_program_id)
  then return false; end if;
  delete from public.program_versioning_fences fence where fence.program_id = target_program_id;
  return true;
end;
$$;
revoke all on function public.abort_program_free_snapshot_conversion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.abort_program_free_snapshot_conversion(uuid, uuid) to service_role;

create function public.release_program_versioning_fence(
  target_program_id uuid,
  target_snapshot_version_id uuid,
  target_paid_version_id uuid,
  target_paid_offer_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  state_row public.program_commerce_state%rowtype;
  fence_row public.program_versioning_fences%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program publication recovery is server managed' using errcode = '42501';
  end if;
  perform set_config('lock_timeout', '5s', true);
  perform private.lock_program_mutation(target_program_id);
  select * into state_row from public.program_commerce_state state
  where state.program_id = target_program_id for update;
  if not found then return false; end if;
  select * into fence_row from public.program_versioning_fences fence
  where fence.program_id = target_program_id for update;
  if not found or fence_row.snapshot_content_version_id <> target_snapshot_version_id
    or state_row.current_content_version_id <> target_paid_version_id
    or state_row.current_offer_version_id <> target_paid_offer_id
    or not exists (
      select 1 from public.program_offer_versions offer
      join public.program_content_versions version
        on version.program_id = offer.program_id and version.id = offer.content_version_id
      where offer.program_id = target_program_id and offer.id = target_paid_offer_id
        and offer.offer_kind = 'paid' and offer.content_version_id = target_paid_version_id
        and version.revision_kind = 'paid'
    )
  then return false; end if;
  delete from public.program_versioning_fences fence where fence.program_id = target_program_id;
  return true;
end;
$$;
revoke all on function public.release_program_versioning_fence(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_program_versioning_fence(uuid, uuid, uuid, uuid) to service_role;

create or replace function private.validate_program_enrollment_content_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed_pin_member text := current_setting('app.program_enrollment_pin_member', true);
begin
  if auth.role() = 'authenticated' then
    if new.content_version_id is not null
      and allowed_pin_member is distinct from auth.uid()::text
    then
      raise exception 'Enrollment content snapshots are server managed' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.content_version_id is distinct from old.content_version_id
      and allowed_pin_member is distinct from auth.uid()::text
    then
      raise exception 'Enrollment content snapshots are server managed' using errcode = '42501';
    end if;
  end if;

  if new.content_version_id is not null and not exists (
    select 1 from public.program_content_versions version
    where version.id = new.content_version_id and version.program_id = new.program_id
  ) then
    raise exception 'Enrollment content version belongs to another Program' using errcode = '23514';
  end if;
  if new.content_version_id is not null then
    perform 1 from public.program_content_versions version
    where version.id = new.content_version_id and version.program_id = new.program_id
    for update;
    if not found or not exists (
      select 1 from public.program_offer_versions offer
      where offer.program_id = new.program_id
        and offer.content_version_id = new.content_version_id and offer.offer_kind = 'free'
    ) then
      raise exception 'Enrollment content version must be sealed by a matching free offer' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_program_enrollment_content_version() from public, anon, authenticated;

create function public.save_owned_program_day(
  target_program_id uuid,
  target_day_id uuid,
  target_day_number smallint,
  target_title text,
  target_instructions text,
  target_pillar public.pillar,
  target_video_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_day_result uuid;
  offer_kind text;
  version_kind text;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null then
    raise exception 'Only the program owner can edit lessons' using errcode = '42501';
  end if;
  if target_day_number not between 1 and 365
    or target_title is null or char_length(btrim(target_title)) not between 1 and 120
    or target_instructions is null or char_length(target_instructions) > 2000
    or target_pillar is null
  then raise exception 'Program day details are invalid' using errcode = '22023'; end if;

  perform set_config('lock_timeout', '5s', true);
  perform 1 from public.profiles profile where profile.id = auth.uid() for share;
  if not found then raise exception 'Program owner profile is unavailable' using errcode = '42501'; end if;
  perform private.lock_program_mutation(target_program_id);
  perform 1 from public.programs program where program.id = target_program_id for update;
  if not found then raise exception 'Program was not found' using errcode = 'P0002'; end if;
  if not private.can_manage_program(target_program_id) then
    raise exception 'Only the current program owner can edit lessons' using errcode = '42501';
  end if;
  if exists (select 1 from public.program_versioning_fences fence where fence.program_id = target_program_id) then
    raise exception 'Program conversion is in progress' using errcode = '55P03';
  end if;
  select offer.offer_kind, version.revision_kind into offer_kind, version_kind
  from public.program_commerce_state state
  join public.program_offer_versions offer
    on offer.program_id = state.program_id and offer.id = state.current_offer_version_id
  join public.program_content_versions version
    on version.program_id = state.program_id and version.id = state.current_content_version_id
  where state.program_id = target_program_id for update of state;
  if not found or offer_kind <> 'free' or version_kind <> 'current'
    or exists (select 1 from public.program_enrollments enrollment
      where enrollment.program_id = target_program_id and enrollment.content_version_id is not null)
    or exists (select 1 from public.program_orders orders where orders.program_id = target_program_id)
  then
    raise exception 'Lessons for a versioned Program cannot be edited directly' using errcode = '55000';
  end if;
  if target_video_id is not null and not exists (
    select 1 from public.videos video
    join public.programs program on program.coach_id = video.coach_id
    where program.id = target_program_id and video.id = target_video_id
      and video.status = 'ready'
  ) then
    raise exception 'Choose a ready video owned by the program creator' using errcode = '42501';
  end if;

  if target_day_id is null then
    insert into public.program_days (program_id, day_number, title, instructions, pillar, video_id)
    values (target_program_id, target_day_number, btrim(target_title), target_instructions, target_pillar, target_video_id)
    returning id into target_day_result;
  else
    update public.program_days day
    set day_number = target_day_number, title = btrim(target_title),
        instructions = target_instructions, pillar = target_pillar, video_id = target_video_id
    where day.id = target_day_id and day.program_id = target_program_id
    returning day.id into target_day_result;
    if not found then raise exception 'Program day was not found' using errcode = 'P0002'; end if;
  end if;
  return target_day_result;
end;
$$;
revoke all on function public.save_owned_program_day(uuid, uuid, smallint, text, text, public.pillar, uuid)
  from public, anon;
grant execute on function public.save_owned_program_day(uuid, uuid, smallint, text, text, public.pillar, uuid)
  to authenticated;

create function public.delete_owned_program_day(target_program_id uuid, target_day_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null then
    raise exception 'Only the program owner can remove lessons' using errcode = '42501';
  end if;
  perform set_config('lock_timeout', '5s', true);
  perform 1 from public.profiles profile where profile.id = auth.uid() for share;
  if not found then raise exception 'Program owner profile is unavailable' using errcode = '42501'; end if;
  perform private.lock_program_mutation(target_program_id);
  perform 1 from public.programs program where program.id = target_program_id for update;
  if not found then return false; end if;
  if not private.can_manage_program(target_program_id) then
    raise exception 'Only the current program owner can remove lessons' using errcode = '42501';
  end if;
  if exists (select 1 from public.program_versioning_fences fence where fence.program_id = target_program_id)
    or exists (select 1 from public.program_enrollments enrollment
      where enrollment.program_id = target_program_id and enrollment.content_version_id is not null)
    or exists (select 1 from public.program_orders orders where orders.program_id = target_program_id)
  then raise exception 'Lessons for a versioned Program cannot be removed directly' using errcode = '55000'; end if;
  delete from public.program_days day
  where day.id = target_day_id and day.program_id = target_program_id;
  return found;
end;
$$;
revoke all on function public.delete_owned_program_day(uuid, uuid) from public, anon;
grant execute on function public.delete_owned_program_day(uuid, uuid) to authenticated;

create function public.delete_owned_program(target_program_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null then
    raise exception 'Only the program owner can delete the Program' using errcode = '42501';
  end if;
  perform set_config('lock_timeout', '5s', true);
  perform 1 from public.profiles profile where profile.id = auth.uid() for share;
  if not found then raise exception 'Program owner profile is unavailable' using errcode = '42501'; end if;
  perform private.lock_program_mutation(target_program_id);
  perform 1 from public.programs program where program.id = target_program_id for update;
  if not found then return false; end if;
  if not private.can_manage_program(target_program_id) then
    raise exception 'Only the current program owner can delete the Program' using errcode = '42501';
  end if;
  delete from public.programs program where program.id = target_program_id;
  return found;
end;
$$;
revoke all on function public.delete_owned_program(uuid) from public, anon;
grant execute on function public.delete_owned_program(uuid) to authenticated;

create function public.start_my_program_enrollment(target_program_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_member_id uuid := (select auth.uid());
  program_row public.programs%rowtype;
  state_row public.program_commerce_state%rowtype;
  version_kind text;
  offer_kind text;
  start_date date := (now() at time zone 'America/New_York')::date;
  enrollment public.program_enrollments%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or actor_member_id is null
    or not private.can_member_access_program(target_program_id, actor_member_id)
  then raise exception 'An active member account is required' using errcode = '42501'; end if;
  -- Take the nullable history-owner FK lock before the Program lock. Account deletion may hold
  -- the profile row while cascading enrollment cleanup; this prevents a reverse lock cycle.
  perform 1 from public.profiles profile where profile.id = actor_member_id for share;
  if not found then raise exception 'Member profile is unavailable' using errcode = '42501'; end if;
  perform set_config('lock_timeout', '5s', true);
  perform private.lock_program_mutation(target_program_id);
  select * into program_row from public.programs program where program.id = target_program_id for update;
  if not found or not program_row.published
    or not private.can_member_access_program(target_program_id, actor_member_id) then
    raise exception 'Program is not available to this member' using errcode = '42501';
  end if;
  if exists (select 1 from public.program_versioning_fences fence where fence.program_id = target_program_id) then
    raise exception 'Program enrollment is paused during conversion' using errcode = '55P03';
  end if;
  select state.* into state_row from public.program_commerce_state state
  where state.program_id = target_program_id for update;
  select offer.offer_kind, version.revision_kind into offer_kind, version_kind
  from public.program_offer_versions offer
  join public.program_content_versions version
    on version.program_id = offer.program_id and version.id = offer.content_version_id
  where offer.program_id = target_program_id and offer.id = state_row.current_offer_version_id;
  if not found or offer_kind <> 'free' then
    raise exception 'A paid Program requires a verified purchase' using errcode = '42501';
  end if;
  select * into enrollment from public.program_enrollments existing
  where existing.program_id = target_program_id and existing.member_id = actor_member_id;
  if found then
    return jsonb_build_object('enrollment_id', enrollment.id, 'started_on', enrollment.started_on,
                              'content_version_id', enrollment.content_version_id, 'existing', true);
  end if;

  if version_kind = 'free_snapshot' then
    perform set_config('app.program_enrollment_pin_member', actor_member_id::text, true);
  end if;
  insert into public.program_enrollments (program_id, member_id, started_on, content_version_id)
  values (target_program_id, actor_member_id, start_date,
          case when version_kind = 'free_snapshot' then state_row.current_content_version_id else null end)
  returning * into enrollment;
  perform set_config('app.program_enrollment_pin_member', '', true);
  return jsonb_build_object('enrollment_id', enrollment.id, 'started_on', enrollment.started_on,
                            'content_version_id', enrollment.content_version_id, 'existing', false);
end;
$$;
revoke all on function public.start_my_program_enrollment(uuid) from public, anon;
grant execute on function public.start_my_program_enrollment(uuid) to authenticated;

create function public.leave_my_program_enrollment(target_enrollment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_member_id uuid := (select auth.uid());
  target_program_id uuid;
begin
  if auth.role() is distinct from 'authenticated' or actor_member_id is null then
    raise exception 'Sign in to leave a Program' using errcode = '42501';
  end if;
  select enrollment.program_id into target_program_id
  from public.program_enrollments enrollment
  where enrollment.id = target_enrollment_id and enrollment.member_id = actor_member_id;
  if not found then return true; end if;
  perform set_config('lock_timeout', '5s', true);
  perform private.lock_program_mutation(target_program_id);
  perform 1 from public.programs program where program.id = target_program_id for update;
  select enrollment.program_id into target_program_id
  from public.program_enrollments enrollment
  where enrollment.id = target_enrollment_id and enrollment.member_id = actor_member_id
  for update;
  if not found then return true; end if;
  delete from public.program_enrollments enrollment
  where enrollment.id = target_enrollment_id and enrollment.member_id = actor_member_id;
  return true;
end;
$$;
revoke all on function public.leave_my_program_enrollment(uuid) from public, anon;
grant execute on function public.leave_my_program_enrollment(uuid) to authenticated;

create function public.set_my_program_lesson_state(
  target_program_id uuid,
  target_lesson_id uuid,
  target_done boolean,
  target_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_member_id uuid := (select auth.uid());
  program_row public.programs%rowtype;
  state_row public.program_commerce_state%rowtype;
  enrollment public.program_enrollments%rowtype;
  paid_order public.program_orders%rowtype;
  order_state public.program_order_state%rowtype;
  current_offer_kind text;
  version_kind text;
  selected_version uuid;
  selected_lesson uuid;
  lesson_row public.program_content_version_lessons%rowtype;
  day_row public.program_days%rowtype;
  access jsonb;
  prior_event public.program_lesson_progress_events%rowtype;
  current_state text;
  event_sequence integer;
  operation_digest text;
  operation_event_id uuid;
  operation_state text;
  completed boolean := false;
  legacy_ordinal integer;
  today date := (now() at time zone 'America/New_York')::date;
begin
  if auth.role() is distinct from 'authenticated' or actor_member_id is null
    or target_program_id is null or target_lesson_id is null
    or target_operation_id is null or target_done is null
  then raise exception 'Program lesson update is invalid' using errcode = '22023'; end if;
  if not private.has_role(actor_member_id, 'member'::public.user_role) then
    raise exception 'Only members can update Program progress' using errcode = '42501';
  end if;

  -- Match the FK lock order used by account deletion before taking the Program/enrollment locks.
  perform 1 from public.profiles profile where profile.id = actor_member_id for share;
  if not found then raise exception 'Member profile is unavailable' using errcode = '42501'; end if;
  perform set_config('lock_timeout', '5s', true);
  perform private.lock_program_mutation(target_program_id);
  select * into program_row from public.programs program
  where program.id = target_program_id for update;
  if not found then raise exception 'Program was not found' using errcode = 'P0002'; end if;

  operation_digest := md5(concat_ws('|', target_program_id::text, target_lesson_id::text,
                                    case when target_done then 'completed' else 'undone' end));
  select event.* into prior_event from public.program_lesson_progress_events event
  where event.subject_member_id = actor_member_id and event.program_id = target_program_id
    and event.operation_id = target_operation_id;
  if found then
    if prior_event.operation_digest <> operation_digest then
      raise exception 'Program progress operation ID was reused' using errcode = '23505';
    end if;
    select event.event_state into current_state
    from public.program_lesson_progress_events event
    where event.subject_member_id = actor_member_id and event.program_id = target_program_id
      and event.content_version_id = prior_event.content_version_id
      and event.lesson_id = prior_event.lesson_id
    order by event.event_sequence desc limit 1;
    return jsonb_build_object(
      'accepted', true,
      'replayed', true,
      'operation_event_id', prior_event.id,
      'operation_completed', prior_event.event_state = 'completed',
      'current_completed', current_state = 'completed'
    );
  end if;

  if not program_row.published
    or not private.can_member_access_program(target_program_id, actor_member_id)
  then raise exception 'Program progress is not available' using errcode = '42501'; end if;
  if exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = actor_member_id) then
    raise exception 'Account access is being closed' using errcode = '42501';
  end if;
  select state.* into state_row from public.program_commerce_state state
  where state.program_id = target_program_id for update;
  if not found then raise exception 'Program access state is missing' using errcode = 'P0002'; end if;
  select offer.offer_kind into current_offer_kind
  from public.program_offer_versions offer
  where offer.program_id = target_program_id and offer.id = state_row.current_offer_version_id;

  select * into enrollment from public.program_enrollments existing
  where existing.program_id = target_program_id and existing.member_id = actor_member_id
  for update;
  if found and enrollment.content_version_id is null then
    if current_offer_kind <> 'free'
      or exists (select 1 from public.program_versioning_fences fence where fence.program_id = target_program_id)
    then raise exception 'Free Program progress is temporarily unavailable' using errcode = '42501'; end if;
    select version.revision_kind into version_kind
    from public.program_content_versions version
    where version.program_id = target_program_id and version.id = state_row.current_content_version_id;
    if version_kind <> 'current' then
      raise exception 'Legacy enrollment cannot access versioned lessons' using errcode = '42501';
    end if;
    select day.* into day_row from public.program_days day
    where day.id = target_lesson_id and day.program_id = target_program_id for update;
    if not found or day_row.day_number > (today - enrollment.started_on + 1) then
      raise exception 'That day has not unlocked yet' using errcode = '42501';
    end if;
    select count(*)::integer into legacy_ordinal
    from public.program_days ordered_day
    where ordered_day.program_id = target_program_id
      and (ordered_day.day_number, ordered_day.id) <= (day_row.day_number, day_row.id);
    if target_done then
      insert into public.program_day_completions (enrollment_id, day_id, member_id)
      values (enrollment.id, day_row.id, actor_member_id)
      on conflict (enrollment_id, day_id) do nothing;
    else
      delete from public.program_day_completions completion
      where completion.enrollment_id = enrollment.id and completion.day_id = day_row.id;
    end if;
    selected_version := state_row.current_content_version_id;
    selected_lesson := day_row.id;
    lesson_row.id := day_row.id;
    lesson_row.source_day_id := day_row.id;
    lesson_row.lesson_ordinal := legacy_ordinal;
    lesson_row.timeline_day_number := day_row.day_number;
    lesson_row.title := day_row.title;
    lesson_row.pillar := day_row.pillar;
  elsif found and enrollment.content_version_id is not null then
    selected_version := enrollment.content_version_id;
    if not exists (
      select 1 from public.program_content_versions version
      where version.program_id = target_program_id and version.id = selected_version
        and version.revision_kind = 'free_snapshot'
    ) or not exists (
      select 1 from public.program_offer_versions offer
      where offer.program_id = target_program_id
        and offer.content_version_id = selected_version and offer.offer_kind = 'free'
    )
    then raise exception 'Grandfathered free Program snapshot is not valid' using errcode = '42501'; end if;
    select lesson.* into lesson_row
    from public.program_content_version_lessons lesson
    where lesson.program_id = target_program_id and lesson.content_version_id = selected_version
      and lesson.id = target_lesson_id;
    if not found or lesson_row.timeline_day_number > (today - enrollment.started_on + 1) then
      raise exception 'That versioned lesson has not unlocked yet' using errcode = '42501'; end if;
    selected_lesson := lesson_row.id;
  else
    select orders.* into paid_order from public.program_orders orders
    where orders.program_id = target_program_id and orders.buyer_id = actor_member_id;
    if not found then raise exception 'A Program enrollment or purchase is required' using errcode = '42501'; end if;
    select ordstate.* into order_state from public.program_order_state ordstate
    where ordstate.order_id = paid_order.id for share;
    if not found then raise exception 'Program payment state is unavailable' using errcode = '42501'; end if;
    access := private.program_order_lesson_access_for_member(paid_order.id, actor_member_id, today);
    if access is null or not exists (
      select 1 from jsonb_array_elements_text(access->'lesson_ids') lesson_id
      where lesson_id.value = target_lesson_id::text
    ) then raise exception 'That paid lesson is not currently unlocked' using errcode = '42501'; end if;
    selected_version := paid_order.content_version_id;
    select lesson.* into lesson_row
    from public.program_content_version_lessons lesson
    where lesson.program_id = target_program_id and lesson.content_version_id = selected_version
      and lesson.id = target_lesson_id;
    if not found then raise exception 'Program lesson is missing' using errcode = 'P0002'; end if;
    selected_lesson := lesson_row.id;
  end if;

  select event.event_state into current_state
  from public.program_lesson_progress_events event
  where event.subject_member_id = actor_member_id and event.program_id = target_program_id
    and event.content_version_id = selected_version and event.lesson_id = selected_lesson
  order by event.event_sequence desc limit 1;
  if current_state is distinct from (case when target_done then 'completed' else 'undone' end) then
    select coalesce(max(event.event_sequence), 0) + 1 into event_sequence
    from public.program_lesson_progress_events event
    where event.subject_member_id = actor_member_id and event.program_id = target_program_id;
    insert into public.program_lesson_progress_events (
      subject_member_id, owner_member_id, program_id, program_owner_id, program_title_snapshot,
      content_version_id, lesson_id, lesson_identity_id, order_id,
      lesson_ordinal, timeline_day_number, lesson_title, lesson_pillar,
      event_sequence, operation_id, operation_digest, event_state
    ) values (
      actor_member_id, actor_member_id, target_program_id, program_row.coach_id, program_row.title,
      selected_version, selected_lesson, coalesce(lesson_row.source_day_id, lesson_row.id),
      case when paid_order.id is not null then paid_order.id else null end,
      lesson_row.lesson_ordinal, lesson_row.timeline_day_number, lesson_row.title, lesson_row.pillar,
      event_sequence, target_operation_id, operation_digest,
      case when target_done then 'completed' else 'undone' end
    ) returning id into operation_event_id;
    operation_state := case when target_done then 'completed' else 'undone' end;
  else
    -- Store a no-op request as an event too, so its operation UUID cannot be replayed after an
    -- intervening opposite transition to manufacture a new state change.
    select coalesce(max(event.event_sequence), 0) + 1 into event_sequence
    from public.program_lesson_progress_events event
    where event.subject_member_id = actor_member_id and event.program_id = target_program_id;
    insert into public.program_lesson_progress_events (
      subject_member_id, owner_member_id, program_id, program_owner_id, program_title_snapshot,
      content_version_id, lesson_id, lesson_identity_id, order_id,
      lesson_ordinal, timeline_day_number, lesson_title, lesson_pillar,
      event_sequence, operation_id, operation_digest, event_state
    ) values (
      actor_member_id, actor_member_id, target_program_id, program_row.coach_id, program_row.title,
      selected_version, selected_lesson, coalesce(lesson_row.source_day_id, lesson_row.id),
      case when paid_order.id is not null then paid_order.id else null end,
      lesson_row.lesson_ordinal, lesson_row.timeline_day_number, lesson_row.title, lesson_row.pillar,
      event_sequence, target_operation_id, operation_digest, current_state
    ) returning id into operation_event_id;
    operation_state := current_state;
  end if;
  select event.event_state = 'completed' into completed
  from public.program_lesson_progress_events event
  where event.subject_member_id = actor_member_id and event.program_id = target_program_id
    and event.content_version_id = selected_version and event.lesson_id = selected_lesson
  order by event.event_sequence desc limit 1;
  return jsonb_build_object(
    'accepted', true,
    'replayed', false,
    'operation_event_id', operation_event_id,
    'operation_completed', operation_state = 'completed',
    'current_completed', coalesce(completed, false)
  );
end;
$$;
revoke all on function public.set_my_program_lesson_state(uuid, uuid, boolean, uuid) from public, anon;
grant execute on function public.set_my_program_lesson_state(uuid, uuid, boolean, uuid) to authenticated;

create function private.build_program_versioned_progress(
  target_program_id uuid,
  target_member_id uuid,
  target_eastern_today date,
  target_include_content boolean,
  target_history_owner_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  program_row public.programs%rowtype;
  state_row public.program_commerce_state%rowtype;
  enrollment public.program_enrollments%rowtype;
  paid_order public.program_orders%rowtype;
  order_state public.program_order_state%rowtype;
  current_offer_kind text;
  current_version_kind text;
  selected_version uuid;
  selected_started_on date;
  selected_access_started_on date;
  mode_name text := 'not_enrolled';
  eligible boolean := false;
  payment_access jsonb;
  required_lessons jsonb := '[]'::jsonb;
  accessible_lessons jsonb := '[]'::jsonb;
  accessible_ids jsonb := '[]'::jsonb;
  completed_ids jsonb := '[]'::jsonb;
  completed_once jsonb := '[]'::jsonb;
  history jsonb := '[]'::jsonb;
  required_count integer := 0;
  timeline_ceiling integer := 0;
  paid_ceiling integer := 0;
  lesson_ceiling integer := 0;
  cleared_installments integer := 0;
  installment_count integer := 0;
  fully_funded boolean := false;
  current_completion_count integer := 0;
  timeline_day integer := 0;
  has_history boolean := false;
  program_exists boolean := false;
begin
  if target_program_id is null or target_member_id is null or target_eastern_today is null then
    return null;
  end if;
  select * into program_row from public.programs program where program.id = target_program_id;
  program_exists := found;
  select coalesce(bool_or(event.owner_member_id is not null), false) into has_history
  from public.program_lesson_progress_events event
  where event.subject_member_id = target_member_id and event.program_id = target_program_id
    and (target_history_owner_id is null or event.program_owner_id = target_history_owner_id);

  mode_name := case when not program_exists and has_history then 'history_only' else 'not_enrolled' end;

  if program_exists then
    select * into state_row from public.program_commerce_state state
    where state.program_id = target_program_id;
    if found then
      select offer.offer_kind, version.revision_kind into current_offer_kind, current_version_kind
      from public.program_offer_versions offer
      join public.program_content_versions version
        on version.program_id = offer.program_id and version.id = offer.content_version_id
      where offer.program_id = target_program_id and offer.id = state_row.current_offer_version_id;
    end if;
    select * into enrollment from public.program_enrollments existing
    where existing.program_id = target_program_id and existing.member_id = target_member_id;
    if found and enrollment.content_version_id is not null then
      selected_version := enrollment.content_version_id;
      selected_started_on := enrollment.started_on;
      mode_name := 'free_snapshot';
    else
      select * into paid_order from public.program_orders orders
      where orders.program_id = target_program_id and orders.buyer_id = target_member_id;
      if found then
        selected_version := paid_order.content_version_id;
        mode_name := 'paid_order';
        select ordstate.* into order_state from public.program_order_state ordstate
        where ordstate.order_id = paid_order.id;
        if found then selected_access_started_on := order_state.access_started_on; end if;
      elsif current_offer_kind = 'free' and current_version_kind = 'free_snapshot' then
        selected_version := state_row.current_content_version_id;
        mode_name := 'free_snapshot';
      elsif current_offer_kind = 'free' and current_version_kind = 'current' then
        mode_name := 'legacy_free';
        if enrollment.id is not null then selected_started_on := enrollment.started_on; end if;
      elsif has_history then
        mode_name := 'history_only';
      end if;
    end if;

    eligible := private.can_member_access_program(target_program_id, target_member_id);

    if mode_name = 'paid_order' and paid_order.id is not null then
      select count(*)::integer into required_count
      from public.program_content_version_lessons lesson
      where lesson.program_id = target_program_id and lesson.content_version_id = selected_version;
      payment_access := private.program_order_lesson_access_for_member(
        paid_order.id, target_member_id, target_eastern_today
      );
      if payment_access is not null then
        eligible := eligible and true;
        timeline_ceiling := coalesce((payment_access->>'timeline_lesson_ceiling')::integer, 0);
        paid_ceiling := coalesce((payment_access->>'paid_lesson_ceiling')::integer, 0);
        lesson_ceiling := coalesce((payment_access->>'lesson_ceiling')::integer, 0);
        cleared_installments := coalesce((payment_access->>'cleared_installments')::integer, 0);
        fully_funded := coalesce((payment_access->>'fully_funded')::boolean, false);
        installment_count := paid_order.installment_count;
      else
        eligible := false;
      end if;
    elsif mode_name in ('free_snapshot', 'legacy_free') then
      if mode_name = 'free_snapshot' and selected_version is not null then
        select count(*)::integer into required_count
        from public.program_content_version_lessons lesson
        where lesson.program_id = target_program_id and lesson.content_version_id = selected_version;
        if selected_started_on is null then
          -- A published free snapshot has safe catalog metadata but no lesson access until the
          -- member starts through the trusted RPC. In particular, conversion does not create
          -- an arbitrary pre-start timeline for an un-enrolled member.
          timeline_ceiling := 0;
        else
          timeline_day := greatest((target_eastern_today - selected_started_on + 1), 0);
          select coalesce(max(lesson.lesson_ordinal), 0)::integer into timeline_ceiling
          from public.program_content_version_lessons lesson
          where lesson.program_id = target_program_id and lesson.content_version_id = selected_version
            and lesson.timeline_day_number <= timeline_day;
        end if;
        paid_ceiling := required_count;
        lesson_ceiling := least(paid_ceiling, timeline_ceiling);
      elsif mode_name = 'legacy_free' then
        select count(*)::integer into required_count
        from public.program_days day where day.program_id = target_program_id;
        if enrollment.id is null then
          timeline_ceiling := required_count;
        else
          timeline_day := greatest((target_eastern_today - enrollment.started_on + 1), 0);
          select coalesce(max(ordered.lesson_ordinal), 0)::integer into timeline_ceiling
          from (
            select day.day_number,
              row_number() over (order by day.day_number, day.id)::integer as lesson_ordinal
            from public.program_days day where day.program_id = target_program_id
          ) ordered
          where ordered.day_number <= timeline_day;
        end if;
        paid_ceiling := required_count;
        lesson_ceiling := least(paid_ceiling, timeline_ceiling);
      end if;
    end if;
  end if;

  if selected_version is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', lesson.id, 'source_day_id', lesson.source_day_id,
      'lesson_ordinal', lesson.lesson_ordinal, 'timeline_day_number', lesson.timeline_day_number,
      'title', lesson.title, 'pillar', lesson.pillar
    ) order by lesson.lesson_ordinal), '[]'::jsonb)
    into required_lessons
    from public.program_content_version_lessons lesson
    where lesson.program_id = target_program_id and lesson.content_version_id = selected_version;

    if eligible then
      if mode_name = 'paid_order' and payment_access is not null then
        accessible_ids := coalesce(payment_access->'lesson_ids', '[]'::jsonb);
      else
        select coalesce(jsonb_agg(lesson.id order by lesson.lesson_ordinal), '[]'::jsonb)
        into accessible_ids
        from public.program_content_version_lessons lesson
        where lesson.program_id = target_program_id and lesson.content_version_id = selected_version
          and lesson.timeline_day_number <= timeline_day;
      end if;
      if target_include_content then
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', lesson.id, 'source_day_id', lesson.source_day_id,
        'lesson_ordinal', lesson.lesson_ordinal, 'timeline_day_number', lesson.timeline_day_number,
        'title', lesson.title, 'pillar', lesson.pillar, 'instructions', lesson.instructions
      ) order by lesson.lesson_ordinal), '[]'::jsonb)
      into accessible_lessons
      from public.program_content_version_lessons lesson
      where lesson.program_id = target_program_id and lesson.content_version_id = selected_version
        and accessible_ids @> jsonb_build_array(lesson.id);
      end if;
    end if;
  elsif program_exists and mode_name = 'legacy_free' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', ordered.id, 'source_day_id', ordered.id,
      'lesson_ordinal', ordered.lesson_ordinal,
      'timeline_day_number', ordered.day_number, 'title', ordered.title, 'pillar', ordered.pillar
    ) order by ordered.lesson_ordinal), '[]'::jsonb)
    into required_lessons
    from (
      select day.id, day.day_number, day.title, day.pillar,
        row_number() over (order by day.day_number, day.id)::integer as lesson_ordinal
      from public.program_days day where day.program_id = target_program_id
    ) ordered;
    if eligible then
      select coalesce(jsonb_agg(ordered.id order by ordered.lesson_ordinal), '[]'::jsonb)
      into accessible_ids
      from (
        select day.id, day.day_number,
          row_number() over (order by day.day_number, day.id)::integer as lesson_ordinal
        from public.program_days day where day.program_id = target_program_id
      ) ordered
      where enrollment.id is null or ordered.day_number <= greatest((target_eastern_today - enrollment.started_on + 1), 0);
      -- Normalize the legacy array into the same safe accessible-lesson object shape.
      if target_include_content then
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', ordered.id, 'source_day_id', ordered.id, 'lesson_ordinal', ordered.lesson_ordinal,
          'timeline_day_number', ordered.day_number, 'title', ordered.title, 'pillar', ordered.pillar,
          'instructions', ordered.instructions
        ) order by ordered.lesson_ordinal), '[]'::jsonb)
        into accessible_lessons
        from (
          select day.id, day.day_number, day.title, day.instructions, day.pillar,
            row_number() over (order by day.day_number, day.id)::integer as lesson_ordinal
          from public.program_days day where day.program_id = target_program_id
        ) ordered
        where enrollment.id is null or ordered.day_number <= greatest((target_eastern_today - enrollment.started_on + 1), 0);
      end if;
    end if;
    if enrollment.id is not null then
      select coalesce(jsonb_agg(completion.day_id order by day.day_number, day.id), '[]'::jsonb)
      into completed_ids
      from public.program_day_completions completion
      join public.program_days day on day.id = completion.day_id
      where completion.enrollment_id = enrollment.id;
    end if;
  end if;

  if selected_version is not null then
    select coalesce(jsonb_agg(latest.lesson_id order by latest.lesson_ordinal), '[]'::jsonb)
    into completed_ids
    from (
      select distinct on (event.lesson_id)
        event.lesson_id, event.lesson_ordinal, event.event_state
      from public.program_lesson_progress_events event
      where event.subject_member_id = target_member_id and event.owner_member_id = target_member_id
        and event.program_id = target_program_id and event.content_version_id = selected_version
        and (target_history_owner_id is null or event.program_owner_id = target_history_owner_id)
      order by event.lesson_id, event.event_sequence desc
    ) latest
    where latest.event_state = 'completed';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'lesson_identity_id', first_event.lesson_identity_id,
    'first_completed_at', first_event.occurred_at,
    'title', first_event.lesson_title,
    'pillar', first_event.lesson_pillar
  ) order by first_event.occurred_at, first_event.lesson_identity_id), '[]'::jsonb)
  into completed_once
  from (
    select distinct on (event.lesson_identity_id)
      event.lesson_identity_id, event.occurred_at, event.lesson_title, event.lesson_pillar
    from public.program_lesson_progress_events event
    where event.subject_member_id = target_member_id and event.owner_member_id = target_member_id
      and event.program_id = target_program_id and event.event_state = 'completed'
      and (target_history_owner_id is null or event.program_owner_id = target_history_owner_id)
    order by event.lesson_identity_id, event.occurred_at, event.event_sequence
  ) first_event;

  select coalesce(jsonb_agg(jsonb_build_object(
    'version_id', event.content_version_id,
    'lesson_id', event.lesson_id,
    'lesson_identity_id', event.lesson_identity_id,
    'lesson_ordinal', event.lesson_ordinal,
    'timeline_day_number', event.timeline_day_number,
    'title', event.lesson_title,
    'pillar', event.lesson_pillar,
    'state', event.event_state,
    'event_sequence', event.event_sequence,
    'occurred_at', event.occurred_at
  ) order by event.event_sequence), '[]'::jsonb)
  into history
  from public.program_lesson_progress_events event
  where event.subject_member_id = target_member_id and event.owner_member_id = target_member_id
    and event.program_id = target_program_id
    and (target_history_owner_id is null or event.program_owner_id = target_history_owner_id);

  current_completion_count := jsonb_array_length(completed_ids);
  -- Unpinned legacy courses are still mutable by their creator. A former member may retain
  -- their own completion facts, but must not learn current lesson titles, counts, or IDs after
  -- they lose program visibility. Pinned and paid versions are immutable snapshots.
  if not eligible and mode_name = 'legacy_free' then
    required_lessons := '[]'::jsonb;
    accessible_lessons := '[]'::jsonb;
    accessible_ids := '[]'::jsonb;
    completed_ids := '[]'::jsonb;
    required_count := current_completion_count;
    timeline_ceiling := 0;
    paid_ceiling := 0;
    lesson_ceiling := 0;
  end if;

  if mode_name = 'not_enrolled' and jsonb_array_length(history) > 0 then mode_name := 'history_only'; end if;
  return jsonb_build_object(
    'program_id', target_program_id,
    'member_id', target_member_id,
    'program_title', case when program_exists then program_row.title
      else coalesce((select event.program_title_snapshot
        from public.program_lesson_progress_events event
        where event.subject_member_id = target_member_id and event.program_id = target_program_id
          and event.owner_member_id = target_member_id
          and (target_history_owner_id is null or event.program_owner_id = target_history_owner_id)
        order by event.event_sequence desc limit 1), '') end,
    'program_uses_versions', program_exists and private.program_uses_versioned_lessons(target_program_id),
    'mode', mode_name,
    'access_authorized', eligible,
    'enrollment_id', case when enrollment.id is not null then enrollment.id else null end,
    'content_version_id', selected_version,
    'started_on', selected_started_on,
    'access_started_on', selected_access_started_on,
    'eastern_today', target_eastern_today,
    'timeline_ceiling', timeline_ceiling,
    'paid_ceiling', paid_ceiling,
    'lesson_ceiling', lesson_ceiling,
    'cleared_installments', cleared_installments,
    'installment_count', installment_count,
    'fully_funded', fully_funded,
    'required_count', required_count,
    'current_completed_count', current_completion_count,
    'lifetime_completed_count', jsonb_array_length(completed_once),
    'required_lessons', required_lessons,
    'accessible_lessons', accessible_lessons,
    'accessible_lesson_ids', accessible_ids,
    'current_completed_lesson_ids', completed_ids,
    'completed_once', completed_once,
    'history', history
  );
end;
$$;
revoke all on function private.build_program_versioned_progress(uuid, uuid, date, boolean, uuid) from public, anon, authenticated;
grant execute on function private.build_program_versioned_progress(uuid, uuid, date, boolean, uuid) to service_role;

create function public.get_program_versioned_progress(
  target_program_id uuid,
  target_member_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  viewer_id uuid := (select auth.uid());
  subject_id uuid := coalesce(target_member_id, (select auth.uid()));
  include_content boolean := false;
  program_exists boolean;
  can_view_history boolean := false;
  history_owner_id uuid;
begin
  if auth.role() = 'service_role' then
    if target_program_id is null or target_member_id is null then
      raise exception 'Service progress reads require explicit Program and member IDs' using errcode = '22023';
    end if;
  elsif auth.role() = 'authenticated' then
    if viewer_id is null or target_program_id is null or subject_id is null then return null; end if;
    select exists(select 1 from public.programs program where program.id = target_program_id)
      into program_exists;
    if subject_id = viewer_id then
      -- Knowing an ID is not enough to browse a Program. Keep ordinary visibility aligned
      -- with current member eligibility, while allowing only the caller's own retained
      -- enrollment/order/event facts after access expires or the coach link is removed.
      can_view_history := private.can_member_access_program(target_program_id, viewer_id)
        or exists (
          select 1 from public.program_enrollments enrollment
          where enrollment.program_id = target_program_id and enrollment.member_id = viewer_id
        )
        or exists (
          select 1 from public.program_orders orders
          where orders.program_id = target_program_id and orders.buyer_id = viewer_id
        )
        or exists (
          select 1 from public.program_lesson_progress_events event
          where event.program_id = target_program_id
            and event.subject_member_id = viewer_id and event.owner_member_id = viewer_id
        );
      include_content := private.has_role(viewer_id, 'member'::public.user_role)
        and private.can_member_access_program(target_program_id, viewer_id);
    elsif program_exists and (
      private.is_admin() or private.can_manage_program(target_program_id)
    ) then
      can_view_history := true;
      if not private.is_admin() then history_owner_id := viewer_id; end if;
    end if;
    if not can_view_history then return null; end if;
  else
    return null;
  end if;
  return private.build_program_versioned_progress(
    target_program_id, subject_id,
    (now() at time zone 'America/New_York')::date,
    include_content,
    history_owner_id
  );
end;
$$;
revoke all on function public.get_program_versioned_progress(uuid, uuid) from public, anon;
grant execute on function public.get_program_versioned_progress(uuid, uuid) to authenticated, service_role;

create function public.list_program_progress_summaries(
  target_page integer default 1,
  target_page_size integer default 50,
  target_program_id uuid default null,
  target_member_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  fixed_subject uuid;
  history_owner uuid;
  coach_view boolean := false;
  staff_view boolean := false;
  summary_row record;
  subject_summary jsonb;
  summary jsonb;
  rows jsonb := '[]'::jsonb;
  row_count integer := 0;
  has_more boolean := false;
  skip_count integer;
begin
  if target_page is null or target_page < 1 or target_page_size is null
    or target_page_size not between 1 and 100 then
    raise exception 'Program summary page is invalid' using errcode = '22023';
  end if;
  skip_count := (target_page - 1) * target_page_size;

  if auth.role() = 'service_role' then
    if target_member_id is null then
      raise exception 'Service summaries require an explicit member ID' using errcode = '22023';
    end if;
    fixed_subject := target_member_id;
  elsif auth.role() = 'authenticated' then
    if actor is null then return null; end if;
    if target_member_id is null and target_program_id is null then
      fixed_subject := actor;
    elsif target_member_id is null and target_program_id is not null then
      if not private.is_admin() and not private.can_manage_program(target_program_id) then return null; end if;
      staff_view := true;
      coach_view := not private.is_admin();
      if coach_view then history_owner := actor; end if;
    elsif target_member_id = actor then
      fixed_subject := actor;
    else
      if target_program_id is null then
        raise exception 'Coach or admin summaries must be scoped to a Program' using errcode = '42501';
      end if;
      if not private.is_admin() and not private.can_manage_program(target_program_id) then return null; end if;
      fixed_subject := target_member_id;
      staff_view := true;
      coach_view := not private.is_admin();
      if coach_view then history_owner := actor; end if;
    end if;
  else
    return null;
  end if;

  for summary_row in
    select candidates.member_id, candidates.program_id,
      max(candidates.last_activity_at) as last_activity_at
    from (
      select event.subject_member_id as member_id, event.program_id, max(event.occurred_at) as last_activity_at
      from public.program_lesson_progress_events event
      where fixed_subject is not null
        and event.subject_member_id = fixed_subject and event.owner_member_id = fixed_subject
        and (target_program_id is null or event.program_id = target_program_id)
        and (not coach_view or event.program_owner_id = history_owner)
        and (not staff_view or exists (
          select 1 from public.program_enrollments enrollment
          where enrollment.program_id = event.program_id and enrollment.member_id = event.subject_member_id
          union all
          select 1 from public.program_orders orders
          where orders.program_id = event.program_id and orders.buyer_id = event.subject_member_id
        ))
      group by event.subject_member_id, event.program_id
      union all
      select enrollment.member_id, enrollment.program_id, max(enrollment.created_at)
      from public.program_enrollments enrollment
      where (fixed_subject is null or enrollment.member_id = fixed_subject)
        and (not staff_view or target_program_id = enrollment.program_id)
        and (target_program_id is null or enrollment.program_id = target_program_id)
        and (not coach_view or exists (
          select 1 from public.programs program
          where program.id = enrollment.program_id and program.coach_id = history_owner
        ))
      group by enrollment.member_id, enrollment.program_id
      union all
      select orders.buyer_id, orders.program_id, max(orders.created_at)
      from public.program_orders orders
      where (fixed_subject is null or orders.buyer_id = fixed_subject)
        and (not staff_view or target_program_id = orders.program_id)
        and (target_program_id is null or orders.program_id = target_program_id)
        and (not coach_view or exists (
          select 1 from public.programs program
          where program.id = orders.program_id and program.coach_id = history_owner
        ))
      group by orders.buyer_id, orders.program_id
    ) candidates
    where not coach_view or exists (
      select 1 from public.programs program
      where program.id = candidates.program_id and program.coach_id = history_owner
    )
    group by candidates.member_id, candidates.program_id
    order by max(candidates.last_activity_at) desc nulls last, candidates.member_id, candidates.program_id
    offset skip_count limit target_page_size + 1
  loop
    row_count := row_count + 1;
    if row_count > target_page_size then
      has_more := true;
      exit;
    end if;
    summary := private.build_program_versioned_progress(
      summary_row.program_id, summary_row.member_id,
      (now() at time zone 'America/New_York')::date,
      false, history_owner
    );
    if summary is not null then
      subject_summary := jsonb_build_object(
        'member_id', summary_row.member_id,
        'program_id', summary_row.program_id,
        'program_title', summary->>'program_title',
        'program_exists', exists (
          select 1 from public.programs program where program.id = summary_row.program_id
        ),
        'mode', summary->>'mode',
        'content_version_id', summary->'content_version_id',
        'started_on', summary->'started_on',
        'enrollment_id', summary->'enrollment_id',
        'required_count', coalesce((summary->>'required_count')::integer, 0),
        'current_completed_count', coalesce((summary->>'current_completed_count')::integer, 0),
        'completed_once_count', coalesce((summary->>'lifetime_completed_count')::integer, 0),
        'timeline_ceiling', coalesce((summary->>'timeline_ceiling')::integer, 0),
        'paid_ceiling', coalesce((summary->>'paid_ceiling')::integer, 0),
        'lesson_ceiling', coalesce((summary->>'lesson_ceiling')::integer, 0)
      );
      rows := rows || jsonb_build_array(subject_summary);
    end if;
  end loop;
  return jsonb_build_object('rows', rows, 'has_more', has_more,
                            'page', target_page, 'page_size', target_page_size);
end;
$$;
revoke all on function public.list_program_progress_summaries(integer, integer, uuid, uuid) from public, anon;
grant execute on function public.list_program_progress_summaries(integer, integer, uuid, uuid) to authenticated, service_role;

create function public.list_program_completed_once_activity(
  target_from timestamptz,
  target_to timestamptz,
  target_member_ids uuid[] default null,
  target_program_id uuid default null,
  target_offset integer default 0,
  target_limit integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result_rows jsonb;
  more_rows boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program activity aggregation is service only' using errcode = '42501';
  end if;
  if target_to is null or (target_from is not null and target_to <= target_from)
    or target_offset is null or target_offset < 0
    or target_limit is null or target_limit not between 1 and 200
    or (target_member_ids is not null and cardinality(target_member_ids) > 200)
  then raise exception 'Program activity page is invalid' using errcode = '22023'; end if;

  with first_completion as (
    select distinct on (event.subject_member_id, event.program_id, event.lesson_identity_id)
      event.subject_member_id as member_id,
      event.program_id,
      event.lesson_identity_id,
      event.occurred_at as first_completed_at,
      event.lesson_pillar as pillar
    from public.program_lesson_progress_events event
    where event.owner_member_id is not null
      and event.event_state = 'completed'
      and (target_member_ids is null or event.owner_member_id = any(target_member_ids))
      and (target_program_id is null or event.program_id = target_program_id)
    order by event.subject_member_id, event.program_id, event.lesson_identity_id,
      event.occurred_at, event.event_sequence
  ), selected as (
    select * from first_completion
    where (target_from is null or first_completed_at >= target_from)
      and first_completed_at < target_to
    order by first_completed_at, member_id, program_id, lesson_identity_id
    offset target_offset limit target_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'member_id', page.member_id,
    'program_id', page.program_id,
    'lesson_identity_id', page.lesson_identity_id,
    'first_completed_at', page.first_completed_at,
    'pillar', page.pillar
  ) order by page.first_completed_at, page.member_id, page.program_id, page.lesson_identity_id), '[]'::jsonb),
  count(*) > target_limit
  into result_rows, more_rows
  from selected page;
  if more_rows then
    result_rows := result_rows - (jsonb_array_length(result_rows) - 1);
  end if;
  return jsonb_build_object('rows', result_rows, 'has_more', more_rows,
    'next_offset', target_offset + least(jsonb_array_length(result_rows), target_limit));
end;
$$;
revoke all on function public.list_program_completed_once_activity(timestamptz, timestamptz, uuid[], uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_program_completed_once_activity(timestamptz, timestamptz, uuid[], uuid, integer, integer)
  to service_role;

create function public.get_program_reminder_candidates(
  target_member_ids uuid[],
  target_eastern_today date,
  target_offset integer default 0,
  target_limit integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  candidate record;
  progress jsonb;
  required_lesson jsonb;
  selected_lesson jsonb;
  timeline_today integer;
  current_completed jsonb;
  accessible_ids jsonb;
  rows jsonb := '[]'::jsonb;
  row_number integer := 0;
  has_more boolean := false;
  start_date date;
  version_id text;
  dedup_ref text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program reminder candidates are service only' using errcode = '42501';
  end if;
  if target_member_ids is null or cardinality(target_member_ids) not between 1 and 200
    or target_eastern_today is null or target_offset is null or target_offset < 0
    or target_limit is null or target_limit not between 1 and 200
  then raise exception 'Program reminder page is invalid' using errcode = '22023'; end if;
  perform set_config('statement_timeout', '15s', true);

  for candidate in
    select distinct source.member_id, source.program_id
    from (
      select enrollment.member_id, enrollment.program_id
      from public.program_enrollments enrollment
      where enrollment.member_id = any(target_member_ids)
      union all
      select orders.buyer_id, orders.program_id
      from public.program_orders orders
      where orders.buyer_id = any(target_member_ids)
    ) source
    order by source.member_id, source.program_id
  loop
    progress := private.build_program_versioned_progress(
      candidate.program_id, candidate.member_id, target_eastern_today, false, null
    );
    if progress is null or coalesce((progress->>'access_authorized')::boolean, false) is not true
      or progress->>'mode' not in ('legacy_free', 'free_snapshot', 'paid_order')
    then continue; end if;
    start_date := coalesce((progress->>'started_on')::date, (progress->>'access_started_on')::date);
    if start_date is null then continue; end if;
    timeline_today := greatest(target_eastern_today - start_date + 1, 0);
    accessible_ids := coalesce(progress->'accessible_lesson_ids', '[]'::jsonb);
    current_completed := coalesce(progress->'current_completed_lesson_ids', '[]'::jsonb);
    selected_lesson := null;
    for required_lesson in
      select lesson.value from jsonb_array_elements(progress->'required_lessons') lesson(value)
      order by (lesson.value->>'lesson_ordinal')::integer
    loop
      if (required_lesson->>'timeline_day_number')::integer = timeline_today
        and accessible_ids @> jsonb_build_array(required_lesson->'id')
        and not (current_completed @> jsonb_build_array(required_lesson->'id')) then
        selected_lesson := required_lesson;
        exit;
      end if;
    end loop;
    if selected_lesson is null then continue; end if;
    row_number := row_number + 1;
    if row_number <= target_offset then continue; end if;
    if row_number > target_offset + target_limit then
      has_more := true;
      exit;
    end if;
    version_id := coalesce(progress->>'content_version_id', 'legacy');
    dedup_ref := md5(concat_ws('|', candidate.member_id::text, candidate.program_id::text,
      version_id, coalesce(progress->>'enrollment_id', 'paid'), required_lesson->>'id', target_eastern_today::text));
    rows := rows || jsonb_build_array(jsonb_build_object(
      'member_id', candidate.member_id,
      'program_id', candidate.program_id,
      'program_title', progress->>'program_title',
      'enrollment_id', progress->'enrollment_id',
      'content_version_id', progress->'content_version_id',
      'lesson_id', required_lesson->'id',
      'lesson_title', required_lesson->'title',
      'lesson_ordinal', required_lesson->'lesson_ordinal',
      'timeline_day_number', required_lesson->'timeline_day_number',
      'reminder_key', dedup_ref
    ));
  end loop;
  return jsonb_build_object('rows', rows, 'has_more', has_more,
    'next_offset', target_offset + jsonb_array_length(rows));
end;
$$;
revoke all on function public.get_program_reminder_candidates(uuid[], date, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_program_reminder_candidates(uuid[], date, integer, integer)
  to service_role;
