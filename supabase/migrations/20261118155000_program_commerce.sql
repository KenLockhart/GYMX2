-- Program commerce foundation only. This adds immutable content/offer snapshots and pure access
-- helpers; it does not enable checkout, webhooks, schedules, promotions, or paid-content routes.

create table public.program_content_versions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,
  revision_number integer not null check (revision_number > 0),
  revision_kind text not null check (revision_kind in ('current', 'free_snapshot', 'paid')),
  lesson_count smallint not null check (lesson_count between 0 and 365),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (program_id, revision_number),
  unique (program_id, id)
);
create index program_content_versions_program_idx
  on public.program_content_versions (program_id, revision_number desc);

create table public.program_content_version_lessons (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null,
  content_version_id uuid not null,
  lesson_ordinal smallint not null check (lesson_ordinal between 1 and 365),
  timeline_day_number smallint not null check (timeline_day_number between 1 and 365),
  source_day_id uuid,
  title text not null check (char_length(title) between 1 and 120),
  instructions text not null default '' check (char_length(instructions) <= 2000),
  pillar public.pillar not null,
  video_id uuid,
  video_creator_id uuid,
  cloudflare_uid text,
  cloudflare_signed_urls_verified boolean not null default false,
  created_at timestamptz not null default now(),
  unique (content_version_id, lesson_ordinal),
  unique (program_id, content_version_id, lesson_ordinal),
  foreign key (program_id, content_version_id)
    references public.program_content_versions (program_id, id) on delete cascade,
  check ((video_id is null) = (cloudflare_uid is null)),
  check (video_id is not null or video_creator_id is null),
  check (not cloudflare_signed_urls_verified or cloudflare_uid is not null),
  check (cloudflare_uid is null or char_length(cloudflare_uid) between 1 and 200)
);
create index program_content_version_lessons_program_idx
  on public.program_content_version_lessons (program_id, content_version_id, lesson_ordinal);
create index program_content_version_lessons_uid_idx
  on public.program_content_version_lessons (cloudflare_uid)
  where cloudflare_uid is not null;

create table public.program_offer_versions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,
  offer_number integer not null check (offer_number > 0),
  content_version_id uuid not null,
  offer_kind text not null check (offer_kind in ('free', 'paid')),
  list_price_cents integer not null check (list_price_cents between 0 and 2147483647),
  currency text not null default 'usd' check (currency = 'usd'),
  max_installments smallint not null default 1 check (max_installments between 1 and 12),
  platform_owned boolean not null,
  seller_profile_id uuid not null,
  connected_account_id text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (program_id, offer_number),
  unique (program_id, id),
  foreign key (program_id, content_version_id)
    references public.program_content_versions (program_id, id) on delete cascade,
  check (
    (offer_kind = 'free' and list_price_cents = 0 and max_installments = 1 and connected_account_id is null)
    or (
      offer_kind = 'paid'
      and list_price_cents >= 50
      and ((platform_owned and connected_account_id is null)
        or (not platform_owned and connected_account_id is not null))
    )
  )
);
create index program_offer_versions_program_idx
  on public.program_offer_versions (program_id, offer_number desc);

-- A separate state row avoids changing existing Program rows or updated_at during the backfill.
create table public.program_commerce_state (
  program_id uuid primary key references public.programs (id) on delete cascade,
  current_content_version_id uuid not null,
  current_offer_version_id uuid not null,
  updated_at timestamptz not null default now()
);

alter table public.program_enrollments
  add column content_version_id uuid references public.program_content_versions (id) on delete set null;
revoke insert on public.program_enrollments from authenticated;
grant insert (id, program_id, member_id, started_on, completed_at, created_at)
  on public.program_enrollments to authenticated;
grant update (content_version_id) on public.program_enrollments to service_role;
create index program_enrollments_content_version_idx
  on public.program_enrollments (program_id, content_version_id)
  where content_version_id is not null;

alter table public.program_content_versions enable row level security;
alter table public.program_content_version_lessons enable row level security;
alter table public.program_offer_versions enable row level security;
alter table public.program_commerce_state enable row level security;
revoke all on public.program_content_versions, public.program_content_version_lessons,
  public.program_offer_versions, public.program_commerce_state
  from public, anon, authenticated, service_role;
grant select, insert on public.program_content_versions,
  public.program_content_version_lessons, public.program_offer_versions to service_role;
grant select, insert, update on public.program_commerce_state to service_role;

-- Backfill immutable current snapshots without pinning normal free enrollments. Their pointer
-- remains NULL, so existing free Program day reads and daily-unlock behavior are unchanged.
insert into public.program_content_versions (
  program_id, revision_number, revision_kind, lesson_count, created_by
)
select p.id, 1, 'current',
       (select count(*)::smallint from public.program_days d where d.program_id = p.id),
       p.coach_id
from public.programs p;

insert into public.program_content_version_lessons (
  program_id, content_version_id, lesson_ordinal, timeline_day_number, source_day_id,
  title, instructions, pillar, video_id, video_creator_id, cloudflare_uid,
  cloudflare_signed_urls_verified
)
select d.program_id,
       v.id,
       row_number() over (partition by d.program_id order by d.day_number, d.id)::smallint,
       d.day_number::smallint,
       d.id,
       d.title,
       d.instructions,
       d.pillar,
       d.video_id,
       video.coach_id,
       video.cloudflare_uid,
       false
from public.program_days d
join public.program_content_versions v
  on v.program_id = d.program_id and v.revision_number = 1
left join public.videos video on video.id = d.video_id;

insert into public.program_offer_versions (
  program_id, offer_number, content_version_id, offer_kind, list_price_cents,
  currency, max_installments, platform_owned, seller_profile_id, connected_account_id, created_by
)
select p.id, 1, v.id, 'free', 0, 'usd', 1, p.platform_owned, p.coach_id, null, p.coach_id
from public.programs p
join public.program_content_versions v
  on v.program_id = p.id and v.revision_number = 1;

insert into public.program_commerce_state (
  program_id, current_content_version_id, current_offer_version_id
)
select p.id, v.id, o.id
from public.programs p
join public.program_content_versions v
  on v.program_id = p.id and v.revision_number = 1
join public.program_offer_versions o
  on o.program_id = p.id and o.offer_number = 1;

create function private.program_paid_lesson_ceiling(
  target_lesson_count integer,
  target_installment_count integer,
  target_cleared_installments integer
)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when target_lesson_count is null
      or target_installment_count is null
      or target_cleared_installments is null
      or target_lesson_count not between 1 and 365
      or target_installment_count not between 1 and least(12, target_lesson_count)
      or target_cleared_installments not between 0 and target_installment_count
      then 0
    when target_cleared_installments = target_installment_count
      then target_lesson_count
    when target_cleared_installments = 0 or target_installment_count = 1
      then 0
    else ((target_lesson_count::bigint * target_cleared_installments::bigint)
          / target_installment_count::bigint)::integer
  end;
$$;
revoke all on function private.program_paid_lesson_ceiling(integer, integer, integer)
  from public, anon;
grant execute on function private.program_paid_lesson_ceiling(integer, integer, integer)
  to authenticated, service_role;

-- This is only the active-membership/visibility prerequisite for a paid buyer. It is not a
-- purchase entitlement; future paid reads must also prove the immutable order and lesson stage.
create function private.is_eligible_paid_program_buyer(target_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.programs p
    join public.program_commerce_state state on state.program_id = p.id
    join public.program_offer_versions offer
      on offer.program_id = state.program_id and offer.id = state.current_offer_version_id
    where p.id = target_program_id
      and p.published
      and offer.offer_kind = 'paid'
      and private.has_role((select auth.uid()), 'member')
      and private.has_platform_tier((select auth.uid()), 'regular')
      and (
        p.platform_owned
        or exists (
          select 1 from public.coach_members cm
          where cm.coach_id = p.coach_id and cm.member_id = (select auth.uid())
        )
      )
  );
$$;
revoke all on function private.is_eligible_paid_program_buyer(uuid) from public, anon;
grant execute on function private.is_eligible_paid_program_buyer(uuid) to authenticated, service_role;

-- A read-only lookup used by the later provider-deletion enforcement phase. It does not itself
-- serialize Cloudflare deletes; every external delete call site must adopt the UID barrier first.
create function private.program_paid_media_uid_is_retained(target_cloudflare_uid text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_cloudflare_uid is not null and exists (
    select 1
    from public.program_content_version_lessons lesson
    join public.program_content_versions version
      on version.id = lesson.content_version_id
     and version.program_id = lesson.program_id
    where version.revision_kind = 'paid'
      and lesson.cloudflare_uid = target_cloudflare_uid
  );
$$;
revoke all on function private.program_paid_media_uid_is_retained(text) from public, anon, authenticated;
grant execute on function private.program_paid_media_uid_is_retained(text) to service_role;

create function private.validate_program_content_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  latest_revision integer;
begin
  select coalesce(max(v.revision_number), 0) into latest_revision
  from public.program_content_versions v
  where v.program_id = new.program_id;
  if new.revision_number <> latest_revision + 1 then
    raise exception 'Program content revision must increase by one' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_program_content_version() from public, anon, authenticated;
create trigger program_content_versions_validate_insert
before insert on public.program_content_versions
for each row execute function private.validate_program_content_version();

create function private.validate_program_commerce_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.program_content_versions v
    where v.program_id = new.program_id and v.id = new.current_content_version_id
  ) or not exists (
    select 1 from public.program_offer_versions o
    where o.program_id = new.program_id
      and o.id = new.current_offer_version_id
      and o.content_version_id = new.current_content_version_id
  ) then
    raise exception 'Program commerce state must point to matching immutable versions' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_program_commerce_state() from public, anon, authenticated;
create trigger program_commerce_state_validate
before insert or update on public.program_commerce_state
for each row execute function private.validate_program_commerce_state();

create function private.validate_program_enrollment_content_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() = 'authenticated' then
    if tg_op = 'INSERT' and new.content_version_id is not null then
      raise exception 'Enrollment content snapshots are server managed' using errcode = '42501';
    elsif tg_op = 'UPDATE' and new.content_version_id is distinct from old.content_version_id then
      raise exception 'Enrollment content snapshots are server managed' using errcode = '42501';
    end if;
  end if;

  if new.content_version_id is not null and not exists (
    select 1 from public.program_content_versions v
    where v.id = new.content_version_id and v.program_id = new.program_id
  ) then
    raise exception 'Enrollment content version belongs to another Program' using errcode = '23514';
  end if;
  if new.content_version_id is not null then
    perform 1 from public.program_content_versions v
    where v.id = new.content_version_id and v.program_id = new.program_id
    for update;
    if not found or not exists (
      select 1 from public.program_offer_versions o
      where o.program_id = new.program_id and o.content_version_id = new.content_version_id
    ) then
      raise exception 'Enrollment content version must be sealed by a matching offer' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_program_enrollment_content_version() from public, anon, authenticated;
create trigger program_enrollments_validate_content_version
before insert or update of program_id, content_version_id on public.program_enrollments
for each row execute function private.validate_program_enrollment_content_version();

create function private.validate_program_offer_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  program_owner uuid;
  is_platform_owned boolean;
  version_kind text;
  version_lesson_count integer;
  stored_lesson_count bigint;
  smallest_ordinal integer;
  largest_ordinal integer;
  latest_offer integer;
begin
  select p.coach_id, p.platform_owned
    into program_owner, is_platform_owned
  from public.programs p where p.id = new.program_id;
  if not found then
    raise exception 'Program offer requires an existing Program' using errcode = '23503';
  end if;
  if new.seller_profile_id is distinct from program_owner
    or new.platform_owned is distinct from is_platform_owned
  then
    raise exception 'Program offer seller snapshot does not match Program ownership' using errcode = '23514';
  end if;

  select v.revision_kind, v.lesson_count into version_kind, version_lesson_count
  from public.program_content_versions v
  where v.program_id = new.program_id and v.id = new.content_version_id
  for update;
  if not found then
    raise exception 'Program offer requires a content version from the same Program' using errcode = '23503';
  end if;

  select coalesce(max(o.offer_number), 0) into latest_offer
  from public.program_offer_versions o where o.program_id = new.program_id;
  if new.offer_number <> latest_offer + 1 then
    raise exception 'Program offer version must increase by one' using errcode = '23514';
  end if;

  select count(*), min(l.lesson_ordinal), max(l.lesson_ordinal)
    into stored_lesson_count, smallest_ordinal, largest_ordinal
  from public.program_content_version_lessons l
  where l.program_id = new.program_id and l.content_version_id = new.content_version_id;
  if stored_lesson_count <> version_lesson_count
    or (version_lesson_count > 0 and (smallest_ordinal <> 1 or largest_ordinal <> version_lesson_count))
    or exists (
      select 1
      from (
        select lesson_ordinal, timeline_day_number,
               lag(timeline_day_number) over (order by lesson_ordinal) as previous_timeline_day
        from public.program_content_version_lessons
        where program_id = new.program_id and content_version_id = new.content_version_id
      ) ordered_lessons
      where previous_timeline_day is not null
        and timeline_day_number <= previous_timeline_day
    )
  then
    raise exception 'Program offer content version is incomplete' using errcode = '23514';
  end if;

  if new.offer_kind = 'free' then
    if version_kind not in ('current', 'free_snapshot')
      or new.list_price_cents <> 0
      or new.max_installments <> 1
      or new.connected_account_id is not null
    then
      raise exception 'Free Program offer terms are invalid' using errcode = '23514';
    end if;
  elsif new.offer_kind = 'paid' then
    if version_kind <> 'paid'
      or version_lesson_count < 1
      or new.max_installments > version_lesson_count
      or (new.platform_owned and new.connected_account_id is not null)
      or (not new.platform_owned and (new.connected_account_id is null or new.connected_account_id !~ '^acct_[A-Za-z0-9]+$'))
      or exists (
        select 1 from public.program_content_version_lessons l
        where l.program_id = new.program_id
          and l.content_version_id = new.content_version_id
          and l.video_id is not null
          and not l.cloudflare_signed_urls_verified
      )
    then
      raise exception 'Paid Program offer requires a valid price, lesson count, seller snapshot, and verified media' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_program_offer_version() from public, anon, authenticated;
create trigger program_offer_versions_validate_insert
before insert on public.program_offer_versions
for each row execute function private.validate_program_offer_version();

create function private.validate_program_paid_lesson_media()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  version_kind text;
  version_lesson_count integer;
  program_owner uuid;
  video_owner uuid;
  video_uid text;
  video_status public.video_status;
  video_visibility text;
begin
  select version.revision_kind, version.lesson_count, program.coach_id
    into version_kind, version_lesson_count, program_owner
  from public.program_content_versions version
  join public.programs program on program.id = version.program_id
  where version.program_id = new.program_id and version.id = new.content_version_id
  for update of version;
  if not found then
    raise exception 'Program lesson requires an existing content version' using errcode = '23503';
  end if;
  if new.lesson_ordinal > version_lesson_count then
    raise exception 'Program lesson ordinal exceeds its declared version count' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.program_offer_versions offer
    where offer.program_id = new.program_id and offer.content_version_id = new.content_version_id
  ) or exists (
    select 1 from public.program_enrollments enrollment
    where enrollment.program_id = new.program_id and enrollment.content_version_id = new.content_version_id
  ) then
    raise exception 'A sealed Program content version cannot accept more lessons' using errcode = '23514';
  end if;
  if version_kind <> 'paid' or new.video_id is null then
    return new;
  end if;

  if not new.cloudflare_signed_urls_verified or new.cloudflare_uid is null then
    raise exception 'Paid media requires verified Cloudflare signed-only protection' using errcode = '23514';
  end if;
  if new.video_creator_id is distinct from program_owner then
    raise exception 'Paid media snapshot creator must match the Program creator' using errcode = '23514';
  end if;
  select video.coach_id, video.cloudflare_uid, video.status, video.visibility
    into video_owner, video_uid, video_status, video_visibility
  from public.videos video where video.id = new.video_id;
  if found then
    if video_owner is distinct from program_owner
      or video_uid is distinct from new.cloudflare_uid
      or video_status is distinct from 'ready'
      or video_visibility not in ('private', 'program_only')
    then
      raise exception 'Paid media must be a ready private Program asset owned by the Program creator' using errcode = '23514';
    end if;
  elsif not exists (
    select 1
    from public.program_content_version_lessons prior_lesson
    join public.program_content_versions prior_version
      on prior_version.program_id = prior_lesson.program_id
     and prior_version.id = prior_lesson.content_version_id
    where prior_version.revision_kind = 'paid'
      and prior_lesson.program_id = new.program_id
      and prior_lesson.video_id = new.video_id
      and prior_lesson.video_creator_id = program_owner
      and prior_lesson.cloudflare_uid = new.cloudflare_uid
      and prior_lesson.cloudflare_signed_urls_verified
  ) then
    raise exception 'Paid media must be a ready private Program asset owned by the Program creator' using errcode = '23514';
  end if;
  if private.program_paid_media_uid_is_retained(new.cloudflare_uid)
    and (
      not exists (
        select 1
        from public.program_content_version_lessons prior_lesson
        join public.program_content_versions prior_version
          on prior_version.program_id = prior_lesson.program_id
         and prior_version.id = prior_lesson.content_version_id
        where prior_version.revision_kind = 'paid'
          and prior_lesson.program_id = new.program_id
          and prior_lesson.cloudflare_uid = new.cloudflare_uid
          and prior_lesson.video_id = new.video_id
          and prior_lesson.video_creator_id = program_owner
          and prior_lesson.cloudflare_signed_urls_verified
      )
      or exists (
        select 1
        from public.program_content_version_lessons prior_lesson
        join public.program_content_versions prior_version
          on prior_version.program_id = prior_lesson.program_id
         and prior_version.id = prior_lesson.content_version_id
        where prior_version.revision_kind = 'paid'
          and prior_lesson.cloudflare_uid = new.cloudflare_uid
          and (
            prior_lesson.program_id <> new.program_id
            or prior_lesson.video_id is distinct from new.video_id
            or prior_lesson.video_creator_id is distinct from program_owner
            or not prior_lesson.cloudflare_signed_urls_verified
          )
      )
    )
    or exists (
      select 1 from public.programs p join public.videos intro on intro.id = p.intro_video_id
      where intro.cloudflare_uid = new.cloudflare_uid
    )
    or exists (
      select 1 from public.program_days d join public.videos used on used.id = d.video_id
      where used.cloudflare_uid = new.cloudflare_uid
    )
    or exists (
      select 1 from public.tasks task join public.videos used on used.id = task.video_id
      where used.cloudflare_uid = new.cloudflare_uid
    )
    or exists (
      select 1 from public.member_daily_fuel_assignments fuel
      join public.videos used on used.id = fuel.video_id
      where used.cloudflare_uid = new.cloudflare_uid
    )
    or exists (
      select 1 from public.member_daily_fuel_bookmarks bookmark
      join public.videos used on used.id = bookmark.video_id
      where used.cloudflare_uid = new.cloudflare_uid
    )
  then
    raise exception 'Paid Program media cannot reuse an intro, free lesson, Task, or Daily Fuel video' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_program_paid_lesson_media() from public, anon, authenticated;
create trigger program_content_version_lessons_validate_paid_media
before insert on public.program_content_version_lessons
for each row execute function private.validate_program_paid_lesson_media();

create function private.guard_program_media_uid_reuse()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if private.program_paid_media_uid_is_retained(new.cloudflare_uid) then
      raise exception 'A retained paid Program media UID cannot be reused' using errcode = '23514';
    end if;
  elsif old.cloudflare_uid is distinct from new.cloudflare_uid
    and (private.program_paid_media_uid_is_retained(old.cloudflare_uid)
      or private.program_paid_media_uid_is_retained(new.cloudflare_uid))
  then
    raise exception 'A retained paid Program media UID cannot be changed or reassigned' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_program_media_uid_reuse() from public, anon, authenticated;
create trigger videos_guard_program_media_uid_reuse
before insert or update of cloudflare_uid on public.videos
for each row execute function private.guard_program_media_uid_reuse();

create function private.guard_unavailable_paid_video_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  assigned_uid text;
  assigned_visibility text;
begin
  select video.cloudflare_uid, video.visibility
    into assigned_uid, assigned_visibility
  from public.videos video where video.id = new.video_id;
  if not found then
    return new;
  end if;
  if assigned_visibility = 'program_only'
    or private.program_paid_media_uid_is_retained(assigned_uid)
  then
    raise exception 'Paid Program media cannot be assigned through Library, Task, or Daily Fuel' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_unavailable_paid_video_assignment() from public, anon, authenticated;

create trigger tasks_guard_program_media
before insert or update of video_id on public.tasks
for each row execute function private.guard_unavailable_paid_video_assignment();
create trigger daily_fuel_assignments_guard_program_media
before insert or update of video_id on public.member_daily_fuel_assignments
for each row execute function private.guard_unavailable_paid_video_assignment();
create trigger daily_fuel_bookmarks_guard_program_media
before insert or update of video_id on public.member_daily_fuel_bookmarks
for each row execute function private.guard_unavailable_paid_video_assignment();

create trigger program_days_guard_paid_video
before insert or update of video_id on public.program_days
for each row execute function private.guard_unavailable_paid_video_assignment();

create or replace function private.validate_program_intro_video()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  video_owner uuid;
  video_ready boolean;
  video_uid text;
  video_visibility text;
begin
  if new.intro_video_id is null then
    return new;
  end if;

  select v.coach_id, v.status = 'ready', v.cloudflare_uid, v.visibility
    into video_owner, video_ready, video_uid, video_visibility
  from public.videos v
  where v.id = new.intro_video_id;
  if not found or video_owner is distinct from new.coach_id or not coalesce(video_ready, false)
    or video_visibility = 'program_only'
  then
    raise exception 'Choose a ready creator-owned video that is not protected Program media'
      using errcode = '23514';
  end if;
  if private.program_paid_media_uid_is_retained(video_uid) then
    raise exception 'An intro video cannot reuse retained paid Program media'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_program_intro_video() from public, anon, authenticated;

create function private.validate_paid_program_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.program_content_versions v
    where v.program_id = old.id and v.revision_kind = 'paid'
  ) or exists (
    select 1 from public.program_offer_versions o
    where o.program_id = old.id and o.offer_kind = 'paid'
  ) then
    raise exception 'A Program with paid content history cannot be hard-deleted' using errcode = '23503';
  end if;
  return old;
end;
$$;
revoke all on function private.validate_paid_program_deletion() from public, anon, authenticated;
create trigger programs_prevent_paid_history_delete
before delete on public.programs
for each row execute function private.validate_paid_program_deletion();

create function private.prevent_program_commerce_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Program content and offer versions are immutable' using errcode = '55000';
  end if;
  if pg_trigger_depth() <= 1 then
    raise exception 'Program content and offer versions are append-only' using errcode = '55000';
  end if;
  return old;
end;
$$;
revoke all on function private.prevent_program_commerce_mutation() from public, anon, authenticated;
create trigger program_content_versions_append_only
before update or delete on public.program_content_versions
for each row execute function private.prevent_program_commerce_mutation();
create trigger program_content_version_lessons_append_only
before update or delete on public.program_content_version_lessons
for each row execute function private.prevent_program_commerce_mutation();
create trigger program_offer_versions_append_only
before update or delete on public.program_offer_versions
for each row execute function private.prevent_program_commerce_mutation();

create function private.initialize_program_commerce_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  content_version uuid;
  offer_version uuid;
begin
  insert into public.program_content_versions (
    program_id, revision_number, revision_kind, lesson_count, created_by
  ) values (new.id, 1, 'current', 0, new.coach_id)
  returning id into content_version;
  insert into public.program_offer_versions (
    program_id, offer_number, content_version_id, offer_kind, list_price_cents,
    currency, max_installments, platform_owned, seller_profile_id, connected_account_id, created_by
  ) values (
    new.id, 1, content_version, 'free', 0, 'usd', 1,
    new.platform_owned, new.coach_id, null, new.coach_id
  ) returning id into offer_version;
  insert into public.program_commerce_state (
    program_id, current_content_version_id, current_offer_version_id
  ) values (new.id, content_version, offer_version);
  return new;
end;
$$;
revoke all on function private.initialize_program_commerce_state() from public, anon, authenticated;
create trigger programs_initialize_commerce_state
 after insert on public.programs
 for each row execute function private.initialize_program_commerce_state();

create function public.snapshot_program_free_content(target_program_id uuid)
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
  next_revision integer;
  next_offer_number integer;
  day_count integer;
  content_version uuid;
  offer_version uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program conversion is server managed' using errcode = '42501';
  end if;
  perform set_config('lock_timeout', '5s', true);
  perform set_config('statement_timeout', '2min', true);
  select p.coach_id, p.platform_owned, o.offer_kind
    into program_owner, platform_owned, existing_offer_kind
  from public.programs p
  join public.program_commerce_state state on state.program_id = p.id
  join public.program_offer_versions o
    on o.program_id = state.program_id and o.id = state.current_offer_version_id
  where p.id = target_program_id
  for update of p, state;
  if not found then
    raise exception 'Program conversion state is missing' using errcode = 'P0002';
  end if;
  if existing_offer_kind <> 'free' then
    raise exception 'Only an existing free Program can be converted from a free snapshot' using errcode = '23514';
  end if;

  lock table public.program_days in share row exclusive mode;
  select count(*)::integer into day_count from public.program_days d where d.program_id = target_program_id;
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

  update public.program_enrollments e
  set content_version_id = content_version
  where e.program_id = target_program_id and e.content_version_id is null;
  update public.program_commerce_state state
  set current_content_version_id = content_version,
      current_offer_version_id = offer_version,
      updated_at = now()
  where state.program_id = target_program_id;
  return content_version;
end;
$$;
revoke all on function public.snapshot_program_free_content(uuid) from public, anon, authenticated;
grant execute on function public.snapshot_program_free_content(uuid) to service_role;
