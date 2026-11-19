-- Reusable staff-authored content, Eastern-day publications, and exact member grants.
-- Provider-backed videos stay server-signed; this schema never exposes cloudflare_uid.

alter table public.videos
  add column daily_content_deletion_pending boolean not null default false;

create table public.daily_content_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  owner_role text not null check (owner_role in ('coach', 'admin')),
  kind text not null check (kind in ('video', 'quote', 'affirmation')),
  title text not null check (char_length(trim(title)) between 1 and 120),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, kind)
);
create index daily_content_items_owner_idx
  on public.daily_content_items (owner_id, kind, updated_at desc);
create trigger daily_content_items_set_updated_at
before update on public.daily_content_items
for each row execute function public.set_updated_at();

create table public.daily_content_revisions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.daily_content_items (id) on delete cascade,
  kind text not null check (kind in ('video', 'quote', 'affirmation')),
  revision_number integer not null check (revision_number > 0),
  title_snapshot text not null check (char_length(trim(title_snapshot)) between 1 and 120),
  video_id uuid references public.videos (id) on delete set null,
  quote_text text,
  quote_attribution text,
  affirmation_text text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (item_id, revision_number),
  unique (item_id, id),
  check (
    -- A privacy deletion may tombstone the provider video while retaining the
    -- immutable content revision/history. New video revisions are validated by
    -- save_daily_content_item and must always reference a ready, non-null video.
    (kind = 'video' and quote_text is null and quote_attribution is null and affirmation_text is null)
    or (kind = 'quote' and video_id is null and char_length(trim(coalesce(quote_text, ''))) between 1 and 500 and char_length(coalesce(quote_attribution, '')) <= 120 and affirmation_text is null)
    or (kind = 'affirmation' and video_id is null and quote_text is null and quote_attribution is null and char_length(trim(coalesce(affirmation_text, ''))) between 1 and 500)
  )
);
create index daily_content_revisions_video_idx
  on public.daily_content_revisions (video_id) where video_id is not null;

create table public.daily_content_slots (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  revision_id uuid not null,
  content_kind text not null check (content_kind in ('video', 'quote', 'affirmation')),
  coach_id uuid references public.profiles (id) on delete cascade,
  day date not null,
  status text not null check (status in ('scheduled', 'published', 'cancelled')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (item_id, content_kind)
    references public.daily_content_items (id, kind) on delete cascade,
  foreign key (item_id, revision_id)
    references public.daily_content_revisions (item_id, id) on delete cascade
);
create unique index daily_content_slots_coach_day_kind_idx
  on public.daily_content_slots (coach_id, day, content_kind)
  where coach_id is not null and status in ('scheduled', 'published');
create unique index daily_content_slots_global_day_kind_idx
  on public.daily_content_slots (day, content_kind)
  where coach_id is null and status in ('scheduled', 'published');
create index daily_content_slots_member_lookup_idx
  on public.daily_content_slots (day, coach_id, content_kind)
  where status in ('scheduled', 'published');
create trigger daily_content_slots_set_updated_at
before update on public.daily_content_slots
for each row execute function public.set_updated_at();

create table public.member_daily_content_video_grants (
  member_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  video_id uuid not null references public.videos (id) on delete cascade,
  slot_id uuid references public.daily_content_slots (id) on delete set null,
  revision_id uuid references public.daily_content_revisions (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (member_id, day, video_id)
);
create index member_daily_content_video_grants_video_idx
  on public.member_daily_content_video_grants (video_id, member_id, day);

create table public.member_daily_content_acknowledgments (
  member_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  revision_id uuid not null references public.daily_content_revisions (id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  primary key (member_id, day, revision_id)
);

alter table public.daily_content_items enable row level security;
alter table public.daily_content_revisions enable row level security;
alter table public.daily_content_slots enable row level security;
alter table public.member_daily_content_video_grants enable row level security;
alter table public.member_daily_content_acknowledgments enable row level security;

revoke all on public.daily_content_items, public.daily_content_revisions,
  public.daily_content_slots, public.member_daily_content_video_grants,
  public.member_daily_content_acknowledgments from public, anon, authenticated;
grant select on public.daily_content_items, public.daily_content_revisions,
  public.daily_content_slots, public.member_daily_content_video_grants,
  public.member_daily_content_acknowledgments to authenticated;
grant all on public.daily_content_items, public.daily_content_revisions,
  public.daily_content_slots, public.member_daily_content_video_grants,
  public.member_daily_content_acknowledgments to service_role;

create policy "Staff read only their own Daily Content items"
on public.daily_content_items for select to authenticated
using (
  owner_id = (select auth.uid())
  and (
    (owner_role = 'coach' and (select private.has_role((select auth.uid()), 'coach')))
    or (owner_role = 'admin' and (select private.is_admin()))
  )
);
create policy "Staff read revisions of their own Daily Content items"
on public.daily_content_revisions for select to authenticated
using (
  exists (
    select 1 from public.daily_content_items i
    where i.id = item_id and i.owner_id = (select auth.uid())
      and (
        (i.owner_role = 'coach' and (select private.has_role((select auth.uid()), 'coach')))
        or (i.owner_role = 'admin' and (select private.is_admin()))
      )
  )
);
create policy "Staff read only their own Daily Content slots"
on public.daily_content_slots for select to authenticated
using (
  exists (
    select 1 from public.daily_content_items i
    where i.id = item_id and i.owner_id = (select auth.uid())
      and (
        (i.owner_role = 'coach' and (select private.has_role((select auth.uid()), 'coach')))
        or (i.owner_role = 'admin' and (select private.is_admin()))
      )
  )
);
create policy "Members read only their own saved Daily Content grants"
on public.member_daily_content_video_grants for select to authenticated
using (
  member_id = (select auth.uid())
  and (select private.has_role((select auth.uid()), 'member'))
);
create policy "Members read only their own Daily Content acknowledgments"
on public.member_daily_content_acknowledgments for select to authenticated
using (
  member_id = (select auth.uid())
  and (select private.has_role((select auth.uid()), 'member'))
);

create function public.save_daily_content_item(
  target_item_id uuid,
  target_kind text,
  target_title text,
  target_video_id uuid,
  target_quote_text text,
  target_quote_attribution text,
  target_affirmation_text text
)
returns table (item_id uuid, revision_id uuid, revision_number integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  caller_role text;
  resolved_item_id uuid;
  next_revision integer;
  normalized_title text := trim(coalesce(target_title, ''));
  normalized_quote text := trim(coalesce(target_quote_text, ''));
  normalized_affirmation text := trim(coalesce(target_affirmation_text, ''));
  normalized_attribution text := trim(coalesce(target_quote_attribution, ''));
  video_owner uuid;
  video_ready boolean;
  video_visibility text;
  video_delete_pending boolean;
  new_revision_id uuid;
begin
  if caller is null then raise exception 'Staff access required' using errcode = '42501'; end if;
  select p.role::text into caller_role from public.profiles p where p.id = caller for share;
  if caller_role is null or caller_role not in ('coach', 'admin') then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  if target_kind is null or target_kind not in ('video', 'quote', 'affirmation')
     or char_length(normalized_title) not between 1 and 120 then
    raise exception 'Daily Content title and type are required' using errcode = '22023';
  end if;
  if target_kind = 'quote' then
    if char_length(normalized_quote) not between 1 and 500 or char_length(normalized_attribution) > 120
       or target_video_id is not null or nullif(normalized_affirmation, '') is not null then
      raise exception 'Quote text is invalid' using errcode = '22023';
    end if;
  elsif target_kind = 'affirmation' then
    if char_length(normalized_affirmation) not between 1 and 500
       or target_video_id is not null or nullif(normalized_quote, '') is not null
       or nullif(normalized_attribution, '') is not null then
      raise exception 'Affirmation text is invalid' using errcode = '22023';
    end if;
  elsif target_video_id is null or nullif(normalized_quote, '') is not null
     or nullif(normalized_affirmation, '') is not null or nullif(normalized_attribution, '') is not null then
    raise exception 'Choose one ready video' using errcode = '22023';
  end if;

  if target_kind = 'video' then
    select v.coach_id, v.status::text = 'ready', v.visibility, v.daily_content_deletion_pending
      into video_owner, video_ready, video_visibility, video_delete_pending
    from public.videos v where v.id = target_video_id for update;
    if not found or not coalesce(video_ready, false) then
      raise exception 'A ready video is required' using errcode = '22023';
    end if;
    if video_owner <> caller then
      raise exception 'Daily Content can use only your own video' using errcode = '42501';
    end if;
    if video_visibility not in ('members', 'private') then
      raise exception 'This video visibility is not supported for Daily Content' using errcode = '42501';
    end if;
    if coalesce(video_delete_pending, false) then
      raise exception 'This video is being deleted and cannot be published' using errcode = '55000';
    end if;
  end if;

  if target_item_id is null then
    insert into public.daily_content_items (owner_id, owner_role, kind, title, status)
    values (caller, caller_role, target_kind, normalized_title, 'draft')
    returning id into resolved_item_id;
  else
    select i.id into resolved_item_id
    from public.daily_content_items i
    where i.id = target_item_id and i.owner_id = caller
      and i.owner_role = caller_role and i.kind = target_kind and i.status <> 'archived'
    for update;
    if not found then
      raise exception 'Daily Content item was not found' using errcode = '42501';
    end if;
    update public.daily_content_items set title = normalized_title where id = resolved_item_id;
  end if;

  select coalesce(max(r.revision_number), 0) + 1 into next_revision
  from public.daily_content_revisions r where r.item_id = resolved_item_id;
  insert into public.daily_content_revisions (
    item_id, kind, revision_number, title_snapshot, video_id,
    quote_text, quote_attribution, affirmation_text, created_by
  ) values (
    resolved_item_id, target_kind, next_revision, normalized_title,
    case when target_kind = 'video' then target_video_id end,
    case when target_kind = 'quote' then normalized_quote end,
    case when target_kind = 'quote' then nullif(normalized_attribution, '') end,
    case when target_kind = 'affirmation' then normalized_affirmation end,
    caller
  ) returning id into new_revision_id;
  return query select resolved_item_id, new_revision_id, next_revision;
end;
$$;

create function public.archive_daily_content_item(target_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  caller_role text;
begin
  select p.role::text into caller_role from public.profiles p where p.id = caller for share;
  if caller is null or caller_role is null or caller_role not in ('coach', 'admin') then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  update public.daily_content_items i set status = 'archived'
  where i.id = target_item_id and i.owner_id = caller and i.owner_role = caller_role
    and i.status <> 'archived';
  if not found then raise exception 'Daily Content item was not found' using errcode = 'P0002'; end if;
  return true;
end;
$$;

create function public.publish_daily_content_slot(
  target_item_id uuid,
  target_revision_id uuid,
  target_day date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  caller_role text;
  content_item public.daily_content_items%rowtype;
  content_revision public.daily_content_revisions%rowtype;
  today date := (select private.current_daily_checkin_day());
  slot_id uuid;
  video_owner uuid;
  video_ready boolean;
  video_visibility text;
  video_delete_pending boolean;
begin
  select p.role::text into caller_role from public.profiles p where p.id = caller for share;
  if caller is null or caller_role is null or caller_role not in ('coach', 'admin') then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  if target_day is null or target_day < today or target_day > today + 365 then
    raise exception 'Choose today or a date within the next year' using errcode = '22023';
  end if;
  select i.* into content_item from public.daily_content_items i
  where i.id = target_item_id and i.owner_id = caller and i.owner_role = caller_role
    and i.status <> 'archived';
  if not found then raise exception 'Daily Content item was not found' using errcode = '42501'; end if;
  select r.* into content_revision from public.daily_content_revisions r
  where r.id = target_revision_id and r.item_id = content_item.id and r.kind = content_item.kind;
  if not found then raise exception 'Daily Content revision was not found' using errcode = '22023'; end if;

  if content_item.kind = 'video' then
    select v.coach_id, v.status::text = 'ready', v.visibility, v.daily_content_deletion_pending
      into video_owner, video_ready, video_visibility, video_delete_pending
    from public.videos v where v.id = content_revision.video_id for update;
    if not found or not coalesce(video_ready, false) then
      raise exception 'A ready video is required' using errcode = '22023';
    end if;
    if video_owner <> caller then
      raise exception 'Daily Content can publish only your own video' using errcode = '42501';
    end if;
    if video_visibility not in ('members', 'private') then
      raise exception 'This video visibility is not supported for Daily Content' using errcode = '42501';
    end if;
    if coalesce(video_delete_pending, false) then
      raise exception 'This video is being deleted and cannot be published' using errcode = '55000';
    end if;
  end if;

  -- Keep the lock order video -> item, matching save and deletion reservation. This
  -- prevents a publish/save/delete race from deadlocking while serializing provider use.
  select i.* into content_item from public.daily_content_items i
  where i.id = target_item_id and i.owner_id = caller and i.owner_role = caller_role
    and i.status <> 'archived'
  for update;
  if not found then raise exception 'Daily Content item was not found' using errcode = '42501'; end if;
  select r.* into content_revision from public.daily_content_revisions r
  where r.id = target_revision_id and r.item_id = content_item.id and r.kind = content_item.kind;
  if not found then raise exception 'Daily Content revision was not found' using errcode = '22023'; end if;

  update public.daily_content_items set status = 'active' where id = content_item.id;
  if caller_role = 'coach' then
    insert into public.daily_content_slots (
      item_id, revision_id, content_kind, coach_id, day, status, created_by
    ) values (
      content_item.id, content_revision.id, content_item.kind, caller, target_day,
      case when target_day = today then 'published' else 'scheduled' end, caller
    )
    on conflict (coach_id, day, content_kind)
      where coach_id is not null and status in ('scheduled', 'published')
    do update set item_id = excluded.item_id, revision_id = excluded.revision_id,
      status = excluded.status, created_by = caller, updated_at = now()
    returning id into slot_id;
  else
    insert into public.daily_content_slots (
      item_id, revision_id, content_kind, coach_id, day, status, created_by
    ) values (
      content_item.id, content_revision.id, content_item.kind, null, target_day,
      case when target_day = today then 'published' else 'scheduled' end, caller
    )
    on conflict (day, content_kind)
      where coach_id is null and status in ('scheduled', 'published')
    do update set item_id = excluded.item_id, revision_id = excluded.revision_id,
      status = excluded.status, created_by = caller, updated_at = now()
    returning id into slot_id;
  end if;
  return slot_id;
end;
$$;

create function public.cancel_daily_content_slot(target_slot_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  caller_role text;
begin
  select p.role::text into caller_role from public.profiles p where p.id = caller for share;
  if caller is null or caller_role is null or caller_role not in ('coach', 'admin') then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  update public.daily_content_slots s set status = 'cancelled'
  from public.daily_content_items i
  where s.id = target_slot_id and i.id = s.item_id
    and i.owner_id = caller and i.owner_role = caller_role
    and s.status in ('scheduled', 'published');
  if not found then raise exception 'Daily Content publication was not found' using errcode = 'P0002'; end if;
  return true;
end;
$$;

create function public.resolve_member_daily_content()
returns table (
  day date,
  video_id uuid,
  video_source text,
  video_slot_id uuid,
  video_revision_id uuid,
  video_title text,
  video_coach_name text,
  quote_text text,
  quote_attribution text,
  quote_revision_id uuid,
  affirmation_text text,
  affirmation_revision_id uuid,
  affirmation_acknowledged boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  today date := (select private.current_daily_checkin_day());
  selected_coach uuid;
  selected_video uuid;
  selected_video_source text;
  selected_video_slot uuid;
  selected_video_revision uuid;
  selected_video_title text;
  selected_video_credit text;
  selected_quote text;
  selected_quote_credit text;
  selected_quote_revision uuid;
  selected_affirmation text;
  selected_affirmation_revision uuid;
begin
  if caller is null or coalesce(not (select private.has_role(caller, 'member')), true) then
    raise exception 'Member access required' using errcode = '42501';
  end if;

  select cm.coach_id into selected_coach
  from public.coach_members cm
  join public.profiles c on c.id = cm.coach_id and c.role::text = 'coach'
  where cm.member_id = caller
  order by cm.created_at desc, cm.coach_id asc
  limit 1;

  select a.video_id into selected_video
  from public.member_daily_fuel_assignments a
  where a.member_id = caller and a.day = today;
  if found then
    selected_video_source := 'legacy';
  else
    selected_video := null;
  end if;

  if selected_video is null then
    select s.id, r.id, r.video_id
      into selected_video_slot, selected_video_revision, selected_video
    from public.daily_content_slots s
    join public.daily_content_items i on i.id = s.item_id
    join public.daily_content_revisions r on r.item_id = s.item_id and r.id = s.revision_id
    join public.videos v on v.id = r.video_id
    where s.coach_id = selected_coach and s.day = today
      and s.content_kind = 'video' and s.status in ('published', 'scheduled')
      and i.owner_id = selected_coach and i.owner_role = 'coach'
      and i.kind = 'video' and i.status = 'active'
      and v.status::text = 'ready' and v.visibility in ('members', 'private')
      and not v.daily_content_deletion_pending
    limit 1;
    if selected_video is not null then selected_video_source := 'coach'; end if;
  end if;
  if selected_video is null then
    selected_video_slot := null;
    selected_video_revision := null;
    select s.id, r.id, r.video_id
      into selected_video_slot, selected_video_revision, selected_video
    from public.daily_content_slots s
    join public.daily_content_items i on i.id = s.item_id
    join public.daily_content_revisions r on r.item_id = s.item_id and r.id = s.revision_id
    join public.videos v on v.id = r.video_id
    where s.coach_id is null and s.day = today
      and s.content_kind = 'video' and s.status in ('published', 'scheduled')
      and i.owner_role = 'admin' and i.kind = 'video' and i.status = 'active'
      and v.coach_id = i.owner_id and v.status::text = 'ready'
      and v.visibility in ('members', 'private') and not v.daily_content_deletion_pending
    limit 1;
    if selected_video is not null then selected_video_source := 'admin'; end if;
  end if;

  if selected_video is not null then
    select v.title, p.display_name into selected_video_title, selected_video_credit
    from public.videos v join public.profiles p on p.id = v.coach_id
    where v.id = selected_video and v.status::text = 'ready'
      and v.visibility in ('members', 'private') and not v.daily_content_deletion_pending;
    if not found then
      selected_video := null;
      selected_video_source := null;
      selected_video_slot := null;
      selected_video_revision := null;
    end if;
  end if;

  select r.quote_text, r.quote_attribution, r.id
    into selected_quote, selected_quote_credit, selected_quote_revision
  from public.daily_content_slots s
  join public.daily_content_items i on i.id = s.item_id
  join public.daily_content_revisions r on r.item_id = s.item_id and r.id = s.revision_id
  where s.coach_id = selected_coach and s.day = today and s.content_kind = 'quote'
    and s.status in ('published', 'scheduled') and i.owner_id = selected_coach
    and i.owner_role = 'coach' and i.kind = 'quote' and i.status = 'active'
  limit 1;
  if selected_quote_revision is null then
    select r.quote_text, r.quote_attribution, r.id
      into selected_quote, selected_quote_credit, selected_quote_revision
    from public.daily_content_slots s
    join public.daily_content_items i on i.id = s.item_id
    join public.daily_content_revisions r on r.item_id = s.item_id and r.id = s.revision_id
    where s.coach_id is null and s.day = today and s.content_kind = 'quote'
      and s.status in ('published', 'scheduled') and i.owner_role = 'admin'
      and i.kind = 'quote' and i.status = 'active'
    limit 1;
  end if;

  select r.affirmation_text, r.id
    into selected_affirmation, selected_affirmation_revision
  from public.daily_content_slots s
  join public.daily_content_items i on i.id = s.item_id
  join public.daily_content_revisions r on r.item_id = s.item_id and r.id = s.revision_id
  where s.coach_id = selected_coach and s.day = today and s.content_kind = 'affirmation'
    and s.status in ('published', 'scheduled') and i.owner_id = selected_coach
    and i.owner_role = 'coach' and i.kind = 'affirmation' and i.status = 'active'
  limit 1;
  if selected_affirmation_revision is null then
    select r.affirmation_text, r.id
      into selected_affirmation, selected_affirmation_revision
    from public.daily_content_slots s
    join public.daily_content_items i on i.id = s.item_id
    join public.daily_content_revisions r on r.item_id = s.item_id and r.id = s.revision_id
    where s.coach_id is null and s.day = today and s.content_kind = 'affirmation'
      and s.status in ('published', 'scheduled') and i.owner_role = 'admin'
      and i.kind = 'affirmation' and i.status = 'active'
    limit 1;
  end if;

  return query select
    today, selected_video, selected_video_source, selected_video_slot,
    selected_video_revision, selected_video_title, selected_video_credit,
    selected_quote, selected_quote_credit, selected_quote_revision,
    selected_affirmation, selected_affirmation_revision,
    exists (
      select 1 from public.member_daily_content_acknowledgments a
      where a.member_id = caller and a.day = today
        and a.revision_id = selected_affirmation_revision
    );
end;
$$;

create function public.set_member_daily_content_acknowledgment(
  target_expected_day date,
  target_revision_id uuid,
  target_acknowledged boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  today date := (select private.current_daily_checkin_day());
  current_revision uuid;
begin
  if caller is null or coalesce(not (select private.has_role(caller, 'member')), true) then
    raise exception 'Member access required' using errcode = '42501';
  end if;
  if target_expected_day is distinct from today then
    raise exception 'Daily Content day changed' using errcode = 'P0001';
  end if;
  if target_acknowledged is null then
    raise exception 'Acknowledgment value is required' using errcode = '22023';
  end if;
  select r.affirmation_revision_id into current_revision
  from public.resolve_member_daily_content() r;
  if current_revision is null or current_revision is distinct from target_revision_id then
    raise exception 'This affirmation is no longer current' using errcode = 'P0001';
  end if;
  if target_acknowledged then
    insert into public.member_daily_content_acknowledgments (member_id, day, revision_id)
    values (caller, today, target_revision_id)
    on conflict (member_id, day, revision_id)
    do update set acknowledged_at = now();
  else
    delete from public.member_daily_content_acknowledgments a
    where a.member_id = caller and a.day = today and a.revision_id = target_revision_id;
  end if;
  return target_acknowledged;
end;
$$;

create or replace function public.set_member_daily_fuel_bookmark(
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
  current_day date := (select private.current_daily_checkin_day());
  current_video uuid;
  current_source text;
  current_slot uuid;
  current_revision uuid;
  video_delete_pending boolean;
begin
  if caller is null or coalesce(not (select private.has_role(caller, 'member')), true) then
    raise exception 'Member access required' using errcode = '42501';
  end if;
  if target_saved is null or target_video_id is null then
    raise exception 'A video and save value are required' using errcode = '22023';
  end if;
  if target_saved then
    select v.daily_content_deletion_pending into video_delete_pending
    from public.videos v where v.id = target_video_id for share;
    if not found or coalesce(video_delete_pending, false) then
      raise exception 'This video is being deleted and cannot be saved' using errcode = '55000';
    end if;
    select r.video_id, r.video_source, r.video_slot_id, r.video_revision_id
      into current_video, current_source, current_slot, current_revision
    from public.resolve_member_daily_content() r;
    if current_video is distinct from target_video_id then
      raise exception 'Only today’s featured video can be saved' using errcode = '42501';
    end if;
    if current_source in ('coach', 'admin') then
      insert into public.member_daily_content_video_grants (
        member_id, day, video_id, slot_id, revision_id
      ) values (caller, current_day, target_video_id, current_slot, current_revision)
      on conflict (member_id, day, video_id) do nothing;
    elsif current_source <> 'legacy' then
      raise exception 'Only today’s featured video can be saved' using errcode = '42501';
    end if;
    insert into public.member_daily_fuel_bookmarks (member_id, video_id)
    values (caller, target_video_id)
    on conflict (member_id, video_id) do nothing;
  else
    delete from public.member_daily_content_video_grants g
    where g.member_id = caller and g.video_id = target_video_id;
    delete from public.member_daily_fuel_bookmarks b
    where b.member_id = caller and b.video_id = target_video_id;
  end if;
  return target_saved;
end;
$$;

create function public.reserve_daily_content_video_delete(target_video_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  caller_role text;
  video_owner uuid;
begin
  select p.role::text into caller_role from public.profiles p where p.id = caller for share;
  if caller is null or caller_role is null or caller_role not in ('coach', 'admin') then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  select v.coach_id into video_owner from public.videos v
  where v.id = target_video_id for update;
  if not found then raise exception 'Video was not found' using errcode = 'P0002'; end if;
  if caller_role <> 'admin' and video_owner is distinct from caller then
    raise exception 'Only the video owner or an admin can delete it' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.daily_content_revisions r
    join public.daily_content_items i on i.id = r.item_id
    where r.video_id = target_video_id and i.status <> 'archived'
  ) or exists (
    select 1 from public.daily_content_slots s
    join public.daily_content_revisions r on r.id = s.revision_id
    where r.video_id = target_video_id and s.day >= (select private.current_daily_checkin_day())
      and s.status in ('scheduled', 'published')
  ) or exists (
    select 1 from public.member_daily_content_video_grants g where g.video_id = target_video_id
  ) or exists (
    select 1 from public.member_daily_fuel_bookmarks b where b.video_id = target_video_id
  ) then
    raise exception 'Video is used by Daily Content or is still saved by a member'
      using errcode = '23503';
  end if;
  if exists (
    select 1 from public.member_daily_fuel_assignments a
    where a.video_id = target_video_id
      and a.day >= (select private.current_daily_checkin_day())
  ) then
    raise exception 'Video is assigned in Daily Fuel' using errcode = '23503';
  end if;
  if exists (select 1 from public.tasks t where t.video_id = target_video_id) then
    raise exception 'Video is still used by a Task' using errcode = '23503';
  end if;
  update public.videos set daily_content_deletion_pending = true where id = target_video_id;
  return true;
end;
$$;

create function public.guard_daily_content_video_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() = 'service_role' then return old; end if;
  -- Supabase Auth Admin may execute the profile/video FK cascade without a
  -- PostgREST JWT. Permit only the nested cascade after this video's owner
  -- profile has disappeared; a direct no-JWT DELETE still has depth 1 and
  -- requires the explicit reservation, while a nested unrelated delete keeps
  -- the live owner profile and is rejected below.
  if auth.uid() is null and pg_trigger_depth() > 1 and not exists (
    select 1 from public.profiles p where p.id = old.coach_id
  ) then
    return old;
  end if;
  if exists (
    select 1 from public.daily_content_revisions r
    join public.daily_content_items i on i.id = r.item_id
    where r.video_id = old.id and i.status <> 'archived'
  ) or exists (
    select 1 from public.daily_content_slots s
    join public.daily_content_revisions r on r.id = s.revision_id
    where r.video_id = old.id and s.day >= (select private.current_daily_checkin_day())
      and s.status in ('scheduled', 'published')
  ) or exists (
    select 1 from public.member_daily_content_video_grants g where g.video_id = old.id
  ) or exists (
    select 1 from public.member_daily_fuel_bookmarks b where b.video_id = old.id
  ) then
    raise exception 'Video is used by Daily Content or is still saved by a member'
      using errcode = '23503';
  end if;
  if exists (
    select 1 from public.member_daily_fuel_assignments a
    where a.video_id = old.id
      and a.day >= (select private.current_daily_checkin_day())
  ) then
    raise exception 'Video is assigned in Daily Fuel' using errcode = '23503';
  end if;
  if exists (select 1 from public.tasks t where t.video_id = old.id) then
    raise exception 'Video is still used by a Task' using errcode = '23503';
  end if;
  if not old.daily_content_deletion_pending then
    raise exception 'Reserve video deletion through the Library action first' using errcode = '42501';
  end if;
  return old;
end;
$$;
create trigger videos_guard_daily_content_delete
before delete on public.videos
for each row execute function public.guard_daily_content_video_delete();

create function public.guard_daily_content_video_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pending boolean;
begin
  if auth.role() = 'service_role' then return new; end if;
  select v.daily_content_deletion_pending into pending
  from public.videos v where v.id = new.video_id for share;
  if coalesce(pending, false) then
    raise exception 'This video is being deleted and cannot be assigned' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger tasks_guard_daily_content_video_reference
before insert or update of video_id on public.tasks
for each row execute function public.guard_daily_content_video_reference();
create trigger daily_fuel_assignments_guard_daily_content_video_reference
before insert or update of video_id on public.member_daily_fuel_assignments
for each row execute function public.guard_daily_content_video_reference();

revoke all on function public.save_daily_content_item(uuid, text, text, uuid, text, text, text),
  public.archive_daily_content_item(uuid), public.publish_daily_content_slot(uuid, uuid, date),
  public.cancel_daily_content_slot(uuid), public.resolve_member_daily_content(),
  public.set_member_daily_content_acknowledgment(date, uuid, boolean),
  public.set_member_daily_fuel_bookmark(uuid, boolean),
  public.reserve_daily_content_video_delete(uuid), public.guard_daily_content_video_delete()
from public, anon, authenticated;
grant execute on function public.save_daily_content_item(uuid, text, text, uuid, text, text, text),
  public.archive_daily_content_item(uuid), public.publish_daily_content_slot(uuid, uuid, date),
  public.cancel_daily_content_slot(uuid), public.resolve_member_daily_content(),
  public.set_member_daily_content_acknowledgment(date, uuid, boolean),
  public.set_member_daily_fuel_bookmark(uuid, boolean),
  public.reserve_daily_content_video_delete(uuid)
to authenticated;
