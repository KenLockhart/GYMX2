-- Gate 6 Program authoring contracts.
-- Authoring drafts are not access grants. Published content and seller terms are immutable
-- rows in the existing 1550 commerce schema; this migration adds only narrow service RPCs.

create table private.program_authoring_drafts (
  draft_id uuid primary key default gen_random_uuid(),
  program_id uuid not null unique references public.programs(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  revision bigint not null check (revision > 0),
  base_content_version_id uuid not null,
  base_offer_version_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, draft_id),
  foreign key (program_id, base_content_version_id)
    references public.program_content_versions(program_id, id) on delete cascade,
  foreign key (program_id, base_offer_version_id)
    references public.program_offer_versions(program_id, id) on delete cascade
);

create table private.program_authoring_draft_lessons (
  program_id uuid not null,
  draft_id uuid not null,
  lesson_ordinal smallint not null check (lesson_ordinal between 1 and 365),
  timeline_day_number smallint not null check (timeline_day_number between 1 and 365),
  title text not null check (char_length(title) between 1 and 120),
  instructions text not null default '' check (char_length(instructions) <= 2000),
  pillar public.pillar not null,
  -- Deliberately no FK to videos: deleting a selected candidate must remain visible to the
  -- authoring CAS and fail publication until the author explicitly clears or replaces it.
  video_id uuid,
  primary key (draft_id, lesson_ordinal),
  foreign key (program_id, draft_id)
    references private.program_authoring_drafts(program_id, draft_id) on delete cascade
);

create table private.program_authoring_receipts (
  request_id uuid primary key,
  program_id uuid not null references public.programs(id) on delete cascade,
  actor_id uuid not null,
  operation_kind text not null check (operation_kind in (
    'publish_content', 'publish_price', 'create_promotion'
  )),
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now()
);
create index program_authoring_receipts_program_idx
  on private.program_authoring_receipts(program_id, created_at desc);

alter table private.program_authoring_drafts enable row level security;
alter table private.program_authoring_draft_lessons enable row level security;
alter table private.program_authoring_receipts enable row level security;
revoke all on private.program_authoring_drafts, private.program_authoring_draft_lessons,
  private.program_authoring_receipts from public, anon, authenticated, service_role;

create function private.guard_program_authoring_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 and tg_op = 'DELETE' then return old; end if;
  raise exception 'Program authoring receipts are append-only' using errcode = '55000';
end;
$$;
revoke all on function private.guard_program_authoring_receipt() from public, anon, authenticated, service_role;
create trigger program_authoring_receipts_append_only
before update or delete on private.program_authoring_receipts
for each row execute function private.guard_program_authoring_receipt();

create function private.program_authoring_media_inventory(target_program_id uuid)
returns table (
  source_kind text,
  source_identity text,
  owner_id uuid,
  registry_id uuid,
  raw_uid text
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct inventory.source_kind, inventory.source_identity, inventory.owner_id,
    inventory.registry_id, inventory.raw_uid
  from (
    select 'program_day'::text as source_kind, day.id::text as source_identity,
      video.coach_id as owner_id, video.stream_provider_account_registry_id as registry_id,
      video.cloudflare_uid as raw_uid
    from public.program_days day
    join public.videos video on video.id = day.video_id
    where day.program_id = target_program_id
    union all
    select 'program_intro', program.id::text, video.coach_id,
      video.stream_provider_account_registry_id, video.cloudflare_uid
    from public.programs program
    join public.videos video on video.id = program.intro_video_id
    where program.id = target_program_id
    union all
    select 'program_content_version_lesson', lesson.id::text,
      coalesce(video.coach_id, lesson.video_creator_id),
      coalesce(binding.registry_id, video.stream_provider_account_registry_id),
      lesson.cloudflare_uid
    from public.program_content_version_lessons lesson
    left join public.videos video on video.id = lesson.video_id
    left join public.stream_media_source_bindings binding
      on binding.source_kind = 'program_lesson'
     and binding.source_identity = lesson.id::text
     and binding.raw_provider_uid = lesson.cloudflare_uid
     and binding.binding_state in (
       'legacy_unverified', 'provisional_bound', 'ready_for_publication',
       'active', 'retained', 'quarantined'
     )
    where lesson.program_id = target_program_id
    union all
    select 'program_authoring_draft_lesson',
      draft_lesson.draft_id::text || ':' || draft_lesson.lesson_ordinal::text,
      video.coach_id, video.stream_provider_account_registry_id, video.cloudflare_uid
    from private.program_authoring_draft_lessons draft_lesson
    join public.videos video on video.id = draft_lesson.video_id
    where draft_lesson.program_id = target_program_id
  ) inventory
  where inventory.raw_uid is not null;
$$;
revoke all on function private.program_authoring_media_inventory(uuid)
  from public, anon, authenticated, service_role;

create function private.program_authoring_inventory_digest(target_program_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_array(
      item.source_kind, item.source_identity, item.owner_id, item.registry_id, item.raw_uid
    ) order by item.source_kind, item.source_identity), '[]'::jsonb)::text
  from private.program_authoring_media_inventory(target_program_id) item;
$$;
revoke all on function private.program_authoring_inventory_digest(uuid)
  from public, anon, authenticated, service_role;

create function private.require_program_authoring_actor(
  target_program_id uuid,
  target_actor_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  program_owner_id uuid;
  program_is_platform_owned boolean;
  actor_profile_role text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program authoring is server managed' using errcode = '42501';
  end if;
  if target_program_id is null or target_actor_id is null then
    raise exception 'Program authoring identity is incomplete' using errcode = '22023';
  end if;
  select profile.role::text into actor_profile_role
  from public.profiles profile where profile.id = target_actor_id;
  if not found then raise exception 'Program authoring actor is unavailable' using errcode = '42501'; end if;
  select program.coach_id, program.platform_owned
    into program_owner_id, program_is_platform_owned
  from public.programs program where program.id = target_program_id;
  if not found or program_owner_id is distinct from target_actor_id
    or (program_is_platform_owned and actor_profile_role <> 'admin')
    or (not program_is_platform_owned and actor_profile_role <> 'coach') then
    raise exception 'Program authoring actor no longer manages this Program' using errcode = '42501';
  end if;
  if private.stream_account_is_tombstoned(target_actor_id)
    or private.stream_account_is_tombstoned(program_owner_id) then
    raise exception 'Program authoring account is closing' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.stream_media_parent_fences fence
    where fence.source_kind = 'program'
      and fence.source_identity = target_program_id::text
      and (fence.fence_state <> 'open' or fence.active_operation_id is not null)
  ) or exists (
    select 1 from public.program_versioning_fences fence
    where fence.program_id = target_program_id
  ) then
    raise exception 'Program authoring is blocked by a current media or versioning fence'
      using errcode = '55P03';
  end if;
  return program_owner_id;
end;
$$;
revoke all on function private.require_program_authoring_actor(uuid, uuid)
  from public, anon, authenticated, service_role;

create function private.lock_program_authoring_scope(
  target_program_id uuid,
  target_actor_id uuid,
  target_lock_media boolean
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  preflight_owner_id uuid;
  locked_owner_id uuid;
  preflight_inventory text;
  current_inventory text;
  account_ids uuid[];
  media_owner_id uuid;
  registry_ids uuid[];
  raw_uids text[];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program authoring is server managed' using errcode = '42501';
  end if;
  perform private.require_program_authoring_actor(target_program_id, target_actor_id);
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Program authoring requires READ COMMITTED; retry the complete transaction'
      using errcode = '25001';
  end if;
  select program.coach_id into preflight_owner_id
  from public.programs program where program.id = target_program_id;
  if not found then raise exception 'Program is unavailable' using errcode = '42501'; end if;

  if target_lock_media then
    preflight_inventory := private.program_authoring_inventory_digest(target_program_id);
    select array_agg(accounts.account_id order by accounts.account_id)
      into account_ids
    from (
      select target_actor_id as account_id
      union
      select preflight_owner_id
      union
      select item.owner_id
      from private.program_authoring_media_inventory(target_program_id) item
      where item.owner_id is not null
    ) accounts
    where accounts.account_id is not null;
  else
    account_ids := array[target_actor_id, preflight_owner_id];
  end if;
  perform private.stream_try_lock_accounts(account_ids);
  perform private.lock_program_mutation(target_program_id);
  if not private.stream_try_parent_lock('program', target_program_id::text) then
    raise exception 'Program media is busy; retry the full authoring operation' using errcode = '55P03';
  end if;

  select program.coach_id into locked_owner_id
  from public.programs program where program.id = target_program_id;
  if not found or locked_owner_id is distinct from preflight_owner_id then
    raise exception 'Program owner changed during authoring; retry the whole operation' using errcode = '40001';
  end if;
  if target_lock_media then
    current_inventory := private.program_authoring_inventory_digest(target_program_id);
    if current_inventory is distinct from preflight_inventory then
      raise exception 'Program media changed during authoring; retry the whole operation' using errcode = '40001';
    end if;
    for media_owner_id in
      select distinct item.owner_id
      from private.program_authoring_media_inventory(target_program_id) item
      where item.owner_id is not null
      union
      select locked_owner_id
      order by 1
    loop
      if not private.stream_try_parent_lock('profile', media_owner_id::text) then
        raise exception 'Program media source is busy; retry the whole operation' using errcode = '55P03';
      end if;
    end loop;
    select array_agg(item.registry_id order by coalesce(item.registry_id::text, ''), item.raw_uid),
      array_agg(item.raw_uid order by coalesce(item.registry_id::text, ''), item.raw_uid)
      into registry_ids, raw_uids
    from (
      select distinct inventory.registry_id, inventory.raw_uid
      from private.program_authoring_media_inventory(target_program_id) inventory
      where inventory.raw_uid is not null
    ) item;
    if coalesce(cardinality(raw_uids), 0) > 0 then
      perform private.stream_try_uid_locks(registry_ids, raw_uids);
    end if;
  end if;
  return private.require_program_authoring_actor(target_program_id, target_actor_id);
end;
$$;
revoke all on function private.lock_program_authoring_scope(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

create function private.validate_program_authoring_lessons(target_lessons jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  lesson_count integer;
begin
  if target_lessons is null or jsonb_typeof(target_lessons) <> 'array' then
    raise exception 'Program lesson draft must be an array' using errcode = '22023';
  end if;
  lesson_count := jsonb_array_length(target_lessons);
  if lesson_count < 1 or lesson_count > 365 then
    raise exception 'Program lesson count must be between one and 365' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(target_lessons) with ordinality as lesson(value, position)
    where jsonb_typeof(lesson.value) <> 'object'
      or case when jsonb_typeof(lesson.value) = 'object'
        then (select count(*) from jsonb_object_keys(lesson.value)) <> 6 else true end
      or not (lesson.value ?& array[
        'lesson_ordinal', 'timeline_day_number', 'title', 'instructions', 'pillar', 'video_id'
      ])
      or jsonb_typeof(lesson.value->'lesson_ordinal') is distinct from 'number'
      or jsonb_typeof(lesson.value->'timeline_day_number') is distinct from 'number'
      or jsonb_typeof(lesson.value->'title') is distinct from 'string'
      or jsonb_typeof(lesson.value->'instructions') is distinct from 'string'
      or jsonb_typeof(lesson.value->'pillar') is distinct from 'string'
      or coalesce(lesson.value->>'lesson_ordinal', '') !~ '^[1-9][0-9]*$'
      or (lesson.value->>'lesson_ordinal')::integer <> lesson.position
      or coalesce(lesson.value->>'timeline_day_number', '') !~ '^[1-9][0-9]*$'
      or (lesson.value->>'timeline_day_number')::integer > 365
      or nullif(btrim(lesson.value->>'title'), '') is null
      or char_length(lesson.value->>'title') > 120
      or char_length(coalesce(lesson.value->>'instructions', '')) > 2000
      or lesson.value->>'pillar' not in ('mind', 'body', 'spirit')
      or jsonb_typeof(lesson.value->'video_id') is distinct from 'null'
         and jsonb_typeof(lesson.value->'video_id') is distinct from 'string'
      or (jsonb_typeof(lesson.value->'video_id') = 'string'
          and coalesce(lesson.value->>'video_id', '') !~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  ) then
    raise exception 'Program lesson draft contains an invalid or unexpected field' using errcode = '22023';
  end if;
  if exists (
    select 1 from (
      select (lesson.value->>'timeline_day_number')::integer as timeline_day,
        lag((lesson.value->>'timeline_day_number')::integer)
          over (order by lesson.position) as prior_timeline_day
      from jsonb_array_elements(target_lessons) with ordinality as lesson(value, position)
    ) ordered
    where ordered.prior_timeline_day is not null
      and ordered.timeline_day <= ordered.prior_timeline_day
  ) then
    raise exception 'Program lesson timeline days must increase strictly' using errcode = '22023';
  end if;
  return lesson_count;
end;
$$;
revoke all on function private.validate_program_authoring_lessons(jsonb)
  from public, anon, authenticated, service_role;

create function private.program_authoring_receipt_replay(
  target_request_id uuid,
  target_program_id uuid,
  target_actor_id uuid,
  target_operation_kind text,
  target_request_digest text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  receipt private.program_authoring_receipts%rowtype;
begin
  select * into receipt
  from private.program_authoring_receipts saved
  where saved.request_id = target_request_id
  for update;
  if not found then return null; end if;
  if receipt.program_id is distinct from target_program_id
    or receipt.actor_id is distinct from target_actor_id
    or receipt.operation_kind is distinct from target_operation_kind
    or receipt.request_digest is distinct from target_request_digest then
    raise exception 'Program authoring request ID was reused with different facts'
      using errcode = '23505';
  end if;
  return receipt.result || jsonb_build_object('replayed', true);
end;
$$;
revoke all on function private.program_authoring_receipt_replay(uuid, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;

create function public.get_program_authoring_draft(
  target_program_id uuid,
  target_actor_id uuid
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
  version_row public.program_content_versions%rowtype;
  offer_row public.program_offer_versions%rowtype;
  draft_row private.program_authoring_drafts%rowtype;
  actor_role text;
  payout_ready boolean := false;
  lesson_json jsonb;
  is_stale boolean := false;
begin
  select profile.role::text into actor_role
  from public.profiles profile where profile.id = target_actor_id;
  select * into program_row from public.programs program where program.id = target_program_id;
  if not found then raise exception 'Program is unavailable' using errcode = '42501'; end if;
  perform private.require_program_authoring_actor(target_program_id, target_actor_id);
  select * into state_row from public.program_commerce_state state
  where state.program_id = target_program_id;
  if not found then raise exception 'Program commerce state is unavailable' using errcode = '55000'; end if;
  select * into version_row from public.program_content_versions version
  where version.program_id = target_program_id and version.id = state_row.current_content_version_id;
  select * into offer_row from public.program_offer_versions offer
  where offer.program_id = target_program_id and offer.id = state_row.current_offer_version_id;
  if not found then raise exception 'Program commerce state is inconsistent' using errcode = '55000'; end if;
  select * into draft_row from private.program_authoring_drafts draft
  where draft.program_id = target_program_id;
  if found then
    is_stale := draft_row.base_content_version_id is distinct from state_row.current_content_version_id
      or draft_row.base_offer_version_id is distinct from state_row.current_offer_version_id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'lesson_ordinal', lesson.lesson_ordinal,
      'timeline_day_number', lesson.timeline_day_number,
      'title', lesson.title,
      'instructions', lesson.instructions,
      'pillar', lesson.pillar::text,
      'video_id', lesson.video_id
    ) order by lesson.lesson_ordinal), '[]'::jsonb)
      into lesson_json
    from private.program_authoring_draft_lessons lesson
    where lesson.program_id = target_program_id and lesson.draft_id = draft_row.draft_id;
  elsif version_row.revision_kind = 'paid' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'lesson_ordinal', lesson.lesson_ordinal,
      'timeline_day_number', lesson.timeline_day_number,
      'title', lesson.title,
      'instructions', lesson.instructions,
      'pillar', lesson.pillar::text,
      'video_id', lesson.video_id
    ) order by lesson.lesson_ordinal), '[]'::jsonb)
      into lesson_json
    from public.program_content_version_lessons lesson
    where lesson.program_id = target_program_id
      and lesson.content_version_id = state_row.current_content_version_id;
  else
    -- First conversion starts with a blank paid draft; legacy free days are never copied.
    lesson_json := '[]'::jsonb;
  end if;
  if program_row.platform_owned then
    payout_ready := actor_role = 'admin';
  else
    select exists (
      select 1 from public.payout_accounts account
      where account.coach_id = program_row.coach_id
        and account.charges_enabled
        and account.stripe_account_id ~ '^acct_[A-Za-z0-9]+$'
    ) into payout_ready;
  end if;
  return jsonb_build_object(
    'status', 'ready',
    'program_id', program_row.id,
    'published', program_row.published,
    'platform_owned', program_row.platform_owned,
    'current_content_version_id', state_row.current_content_version_id,
    'current_offer_version_id', state_row.current_offer_version_id,
    'current_revision_kind', version_row.revision_kind,
    'current_lesson_count', version_row.lesson_count,
    'offer_kind', offer_row.offer_kind,
    'list_price_cents', offer_row.list_price_cents,
    'currency', offer_row.currency,
    'max_installments', offer_row.max_installments,
    'payout_ready', payout_ready,
    'draft_id', draft_row.draft_id,
    'draft_revision', draft_row.revision,
    'draft_stale', is_stale,
    'lessons', lesson_json
  );
end;
$$;
revoke all on function public.get_program_authoring_draft(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_program_authoring_draft(uuid, uuid) to service_role;

create function public.save_program_authoring_draft(
  target_program_id uuid,
  target_actor_id uuid,
  target_draft_id uuid,
  target_expected_draft_revision bigint,
  target_expected_content_version_id uuid,
  target_expected_offer_version_id uuid,
  target_lessons jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  program_owner_id uuid;
  state_row public.program_commerce_state%rowtype;
  draft_row private.program_authoring_drafts%rowtype;
  lesson_count integer;
  next_revision bigint;
begin
  if target_expected_draft_revision is null or target_expected_draft_revision < 0
    or target_expected_content_version_id is null or target_expected_offer_version_id is null then
    raise exception 'Program draft revision and base are required' using errcode = '22023';
  end if;
  lesson_count := private.validate_program_authoring_lessons(target_lessons);
  program_owner_id := private.lock_program_authoring_scope(target_program_id, target_actor_id, false);
  select * into state_row from public.program_commerce_state state
  where state.program_id = target_program_id for update;
  if not found or state_row.current_content_version_id is distinct from target_expected_content_version_id
    or state_row.current_offer_version_id is distinct from target_expected_offer_version_id then
    raise exception 'Program content or offer changed; reload before saving' using errcode = '40001';
  end if;
  select * into draft_row from private.program_authoring_drafts draft
  where draft.program_id = target_program_id for update;
  if found then
    if target_draft_id is null or draft_row.draft_id is distinct from target_draft_id
      or draft_row.revision is distinct from target_expected_draft_revision
      or draft_row.base_content_version_id is distinct from state_row.current_content_version_id
      or draft_row.base_offer_version_id is distinct from state_row.current_offer_version_id then
      raise exception 'Program draft revision changed; reload before saving' using errcode = '40001';
    end if;
    next_revision := draft_row.revision + 1;
    update private.program_authoring_drafts draft
    set revision = next_revision, author_id = target_actor_id, updated_at = now()
    where draft.program_id = target_program_id;
  else
    if target_draft_id is not null or target_expected_draft_revision <> 0 then
      raise exception 'Program draft no longer matches the requested revision' using errcode = '40001';
    end if;
    insert into private.program_authoring_drafts(
      program_id, author_id, revision, base_content_version_id, base_offer_version_id
    ) values (
      target_program_id, target_actor_id, 1,
      state_row.current_content_version_id, state_row.current_offer_version_id
    ) returning * into draft_row;
    next_revision := 1;
  end if;
  delete from private.program_authoring_draft_lessons lesson
  where lesson.program_id = target_program_id and lesson.draft_id = draft_row.draft_id;
  insert into private.program_authoring_draft_lessons(
    program_id, draft_id, lesson_ordinal, timeline_day_number, title, instructions, pillar, video_id
  )
  select target_program_id, draft_row.draft_id,
    (lesson.value->>'lesson_ordinal')::smallint,
    (lesson.value->>'timeline_day_number')::smallint,
    lesson.value->>'title',
    lesson.value->>'instructions',
    (lesson.value->>'pillar')::public.pillar,
    nullif(lesson.value->>'video_id', '')::uuid
  from jsonb_array_elements(target_lessons) lesson(value)
  order by (lesson.value->>'lesson_ordinal')::integer;
  return jsonb_build_object(
    'status', 'saved',
    'program_id', target_program_id,
    'draft_id', draft_row.draft_id,
    'draft_revision', next_revision,
    'base_content_version_id', state_row.current_content_version_id,
    'base_offer_version_id', state_row.current_offer_version_id,
    'lesson_count', lesson_count
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Program lesson draft contains an invalid value' using errcode = '22023';
end;
$$;
revoke all on function public.save_program_authoring_draft(uuid, uuid, uuid, bigint, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_program_authoring_draft(uuid, uuid, uuid, bigint, uuid, uuid, jsonb)
  to service_role;

create function public.publish_program_authoring_draft(
  target_program_id uuid,
  target_actor_id uuid,
  target_draft_id uuid,
  target_expected_draft_revision bigint,
  target_expected_content_version_id uuid,
  target_expected_offer_version_id uuid,
  target_request_id uuid,
  target_list_price_cents integer,
  target_max_installments smallint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  program_owner_id uuid;
  actor_role text;
  program_row public.programs%rowtype;
  state_row public.program_commerce_state%rowtype;
  offer_row public.program_offer_versions%rowtype;
  draft_row private.program_authoring_drafts%rowtype;
  intro_video public.videos%rowtype;
  selected_video public.videos%rowtype;
  new_content_version_id uuid;
  offer_version_id uuid;
  free_snapshot_id uuid;
  pointer_content_id uuid;
  pointer_offer_id uuid;
  revision_number integer;
  offer_number integer;
  lesson_count integer;
  connected_account text;
  request_digest text;
  replay_result jsonb;
  result jsonb;
begin
  if target_program_id is null or target_actor_id is null or target_draft_id is null
    or target_expected_draft_revision is null or target_expected_draft_revision < 1
    or target_expected_content_version_id is null or target_expected_offer_version_id is null
    or target_request_id is null or target_list_price_cents is null or target_list_price_cents < 50
    or target_max_installments is null or target_max_installments < 1 or target_max_installments > 12 then
    raise exception 'Program publication request is invalid' using errcode = '22023';
  end if;
  request_digest := private.stream_media_identity_digest(concat_ws(chr(31),
    'publish_content', target_program_id::text, target_actor_id::text, target_draft_id::text,
    target_expected_draft_revision::text, target_expected_content_version_id::text,
    target_expected_offer_version_id::text, target_list_price_cents::text,
    target_max_installments::text
  ));

  program_owner_id := private.lock_program_authoring_scope(target_program_id, target_actor_id, true);
  select profile.role::text into actor_role
  from public.profiles profile where profile.id = target_actor_id;
  replay_result := private.program_authoring_receipt_replay(
    target_request_id, target_program_id, target_actor_id, 'publish_content', request_digest
  );
  if replay_result is not null then return replay_result; end if;

  select * into program_row from public.programs program
  where program.id = target_program_id for update;
  select * into state_row from public.program_commerce_state state
  where state.program_id = target_program_id for update;
  if not found then raise exception 'Program commerce state is unavailable' using errcode = '55000'; end if;
  if state_row.current_content_version_id is distinct from target_expected_content_version_id
    or state_row.current_offer_version_id is distinct from target_expected_offer_version_id then
    raise exception 'Program offer changed; reload before publication' using errcode = '40001';
  end if;
  select * into offer_row from public.program_offer_versions offer
  where offer.program_id = target_program_id and offer.id = state_row.current_offer_version_id;
  if not found then raise exception 'Program offer is unavailable' using errcode = '55000'; end if;
  select * into draft_row from private.program_authoring_drafts draft
  where draft.program_id = target_program_id for update;
  if not found or draft_row.draft_id is distinct from target_draft_id
    or draft_row.revision is distinct from target_expected_draft_revision
    or draft_row.base_content_version_id is distinct from state_row.current_content_version_id
    or draft_row.base_offer_version_id is distinct from state_row.current_offer_version_id then
    raise exception 'Program draft changed; reload before publication' using errcode = '40001';
  end if;
  select count(*)::integer into lesson_count
  from private.program_authoring_draft_lessons lesson
  where lesson.program_id = target_program_id and lesson.draft_id = draft_row.draft_id;
  if lesson_count < 1 or lesson_count > 365
    or target_max_installments > least(12, lesson_count)
    or exists (
      select 1 from (
        select lesson.lesson_ordinal, lesson.timeline_day_number,
          row_number() over (order by lesson.lesson_ordinal) as expected_ordinal,
          lag(lesson.timeline_day_number) over (order by lesson.lesson_ordinal) as prior_day
        from private.program_authoring_draft_lessons lesson
        where lesson.program_id = target_program_id and lesson.draft_id = draft_row.draft_id
      ) ordered
      where ordered.lesson_ordinal <> ordered.expected_ordinal
        or (ordered.prior_day is not null and ordered.timeline_day_number <= ordered.prior_day)
    ) then
    raise exception 'Program draft lesson sequence is incomplete' using errcode = '23514';
  end if;
  if exists (
    select 1
    from private.program_authoring_draft_lessons draft_lesson
    left join public.videos video on video.id = draft_lesson.video_id
    where draft_lesson.program_id = target_program_id
      and draft_lesson.draft_id = draft_row.draft_id
      and draft_lesson.video_id is not null
      and (
        video.id is null
        or video.coach_id is distinct from program_owner_id
        or video.status::text <> 'ready'
        or video.daily_content_deletion_pending
        or video.visibility not in ('private', 'program_only')
        or video.stream_provider_account_registry_id is null
        or video.cloudflare_uid is null
        or not private.stream_account_is_verified(video.stream_provider_account_registry_id)
        or not exists (
          select 1 from public.stream_media_parent_fences source_fence
          where source_fence.source_kind = 'profile'
            and source_fence.source_identity = program_owner_id::text
            and source_fence.owner_id = program_owner_id
            and source_fence.fence_state = 'open'
            and source_fence.active_operation_id is null
        )
        or not (
          private.stream_source_binding_ready(
            'video', video.id::text, program_owner_id,
            video.stream_provider_account_registry_id, video.cloudflare_uid
          )
          or exists (
            select 1
            from public.program_content_version_lessons existing_lesson
            join public.program_content_versions existing_version
              on existing_version.program_id = existing_lesson.program_id
             and existing_version.id = existing_lesson.content_version_id
             and existing_version.revision_kind = 'paid'
            join public.stream_media_source_bindings existing_binding
              on existing_binding.source_kind = 'program_lesson'
             and existing_binding.source_identity = existing_lesson.id::text
             and existing_binding.owner_id = program_owner_id
             and existing_binding.registry_id = video.stream_provider_account_registry_id
             and existing_binding.raw_provider_uid = video.cloudflare_uid
             and existing_binding.binding_state in ('ready_for_publication', 'active', 'retained')
            join public.stream_media_assets existing_asset
              on existing_asset.id = existing_binding.asset_id
             and existing_asset.registry_id = existing_binding.registry_id
             and existing_asset.raw_provider_uid = existing_binding.raw_provider_uid
             and existing_asset.lifecycle_state = 'ready_for_publication'
             and existing_asset.signed_urls_verified
             and existing_asset.ready_to_stream_verified
            where existing_lesson.program_id = target_program_id
              and existing_lesson.video_id = video.id
              and existing_lesson.cloudflare_uid = video.cloudflare_uid
              and existing_lesson.video_creator_id = program_owner_id
          )
        )
        or private.stream_legacy_uid_unresolved(
          video.stream_provider_account_registry_id, video.cloudflare_uid
        )
        or private.stream_media_uid_reserved(
          video.stream_provider_account_registry_id, video.cloudflare_uid
        )
        or private.stream_uid_blocks_new_media_reference(
          video.stream_provider_account_registry_id, video.cloudflare_uid
        )
        -- The Program lock holds the same verified-registry UID mutex used by the
        -- Daily Content source guards. Re-read these rows after that lock so an
        -- existing Daily revision or slot cannot be silently converted to Program-only.
        or exists (
          select 1
          from public.daily_content_revisions daily_revision
          join public.videos daily_video on daily_video.id = daily_revision.video_id
          where daily_revision.video_id = video.id
             or (daily_video.stream_provider_account_registry_id = video.stream_provider_account_registry_id
                 and daily_video.cloudflare_uid = video.cloudflare_uid)
        )
        or exists (
          select 1
          from public.daily_content_slots daily_slot
          join public.daily_content_revisions daily_revision
            on daily_revision.id = daily_slot.revision_id
          join public.videos daily_video on daily_video.id = daily_revision.video_id
          where daily_slot.status in ('scheduled', 'published')
            and (daily_revision.video_id = video.id
              or (daily_video.stream_provider_account_registry_id = video.stream_provider_account_registry_id
                  and daily_video.cloudflare_uid = video.cloudflare_uid))
        )
      )
  ) then
    raise exception 'A selected Program lesson video is missing or not ready for publication'
      using errcode = '23514';
  end if;
  if program_row.intro_video_id is null then
    raise exception 'Choose a ready Program intro before publishing' using errcode = '23514';
  end if;
  select * into intro_video from public.videos video
  where video.id = program_row.intro_video_id;
  if not found or intro_video.coach_id is distinct from program_owner_id
    or intro_video.status::text <> 'ready' or intro_video.daily_content_deletion_pending
    or intro_video.stream_provider_account_registry_id is null
    or intro_video.cloudflare_uid is null
    or private.stream_account_is_tombstoned(intro_video.coach_id)
    or not private.stream_account_is_verified(intro_video.stream_provider_account_registry_id)
    or not exists (
      select 1 from public.stream_media_parent_fences source_fence
      where source_fence.source_kind = 'profile'
        and source_fence.source_identity = program_owner_id::text
        and source_fence.owner_id = program_owner_id
        and source_fence.fence_state = 'open'
        and source_fence.active_operation_id is null
    )
    or private.stream_legacy_uid_unresolved(
      intro_video.stream_provider_account_registry_id, intro_video.cloudflare_uid
    )
    or private.stream_media_uid_reserved(
      intro_video.stream_provider_account_registry_id, intro_video.cloudflare_uid
    )
    or private.stream_uid_blocks_new_media_reference(
      intro_video.stream_provider_account_registry_id, intro_video.cloudflare_uid
    )
    or not exists (
      select 1
      from public.stream_media_source_bindings binding
      join public.stream_media_assets asset
        on asset.id = binding.asset_id
       and asset.registry_id = binding.registry_id
       and asset.raw_provider_uid = binding.raw_provider_uid
      join public.stream_media_parent_fences fence
        on fence.source_kind = 'program'
       and fence.source_identity = target_program_id::text
       and fence.owner_id = program_owner_id
       and fence.fence_state = 'open'
       and fence.active_operation_id is null
      where binding.source_kind = 'program_intro'
        and binding.source_identity = target_program_id::text
        and binding.parent_kind = 'program'
        and binding.parent_identity = target_program_id::text
        and binding.owner_id = program_owner_id
        and binding.registry_id = intro_video.stream_provider_account_registry_id
        and binding.raw_provider_uid = intro_video.cloudflare_uid
        and binding.binding_state in ('ready_for_publication', 'active', 'retained')
        and asset.lifecycle_state = 'ready_for_publication'
        and asset.signed_urls_verified and asset.ready_to_stream_verified
        and exists (
          select 1 from public.stream_media_source_binding_events event
          where event.binding_id = binding.id and event.event_kind = 'attached'
            and event.source_revision = binding.source_revision
            and event.evidence_digest = binding.evidence_digest
        )
    ) then
    raise exception 'The Program intro is not ready for publication' using errcode = '23514';
  end if;

  if program_row.platform_owned then
    if actor_role <> 'admin' then
      raise exception 'A platform Program requires an administrator' using errcode = '42501';
    end if;
    connected_account := null;
  else
    select account.stripe_account_id into connected_account
    from public.payout_accounts account
    where account.coach_id = program_owner_id
      and account.charges_enabled
      and account.stripe_account_id ~ '^acct_[A-Za-z0-9]+$';
    if connected_account is null then
      raise exception 'Coach payouts must be connected and charges enabled before paid publication'
        using errcode = '23514';
    end if;
  end if;

  if offer_row.offer_kind = 'free' then
    if exists (select 1 from public.program_orders order_row
      where order_row.program_id = target_program_id) then
      raise exception 'A Program with existing orders cannot begin free-to-paid conversion'
        using errcode = '23514';
    end if;
    free_snapshot_id := public.snapshot_program_free_content(target_program_id);
    select * into state_row from public.program_commerce_state state
    where state.program_id = target_program_id;
    pointer_content_id := state_row.current_content_version_id;
    pointer_offer_id := state_row.current_offer_version_id;
  elsif offer_row.offer_kind = 'paid' then
    pointer_content_id := state_row.current_content_version_id;
    pointer_offer_id := state_row.current_offer_version_id;
  else
    raise exception 'Current Program offer cannot be published' using errcode = '23514';
  end if;

  select coalesce(max(version.revision_number), 0) + 1 into revision_number
  from public.program_content_versions version where version.program_id = target_program_id;
  insert into public.program_content_versions(
    program_id, revision_number, revision_kind, lesson_count, created_by
  ) values (
    target_program_id, revision_number, 'paid', lesson_count, target_actor_id
  ) returning id into new_content_version_id;

  insert into public.program_content_version_lessons(
    program_id, content_version_id, lesson_ordinal, timeline_day_number,
    title, instructions, pillar, video_id, video_creator_id, cloudflare_uid,
    cloudflare_signed_urls_verified
  )
  select target_program_id, new_content_version_id, draft_lesson.lesson_ordinal,
    draft_lesson.timeline_day_number, draft_lesson.title, draft_lesson.instructions,
    draft_lesson.pillar, draft_lesson.video_id,
    case when draft_lesson.video_id is null then null else video.coach_id end,
    case when draft_lesson.video_id is null then null else video.cloudflare_uid end,
    draft_lesson.video_id is not null
  from private.program_authoring_draft_lessons draft_lesson
  left join public.videos video on video.id = draft_lesson.video_id
  where draft_lesson.program_id = target_program_id
    and draft_lesson.draft_id = draft_row.draft_id
  order by draft_lesson.lesson_ordinal;

  update public.videos video
  set visibility = 'program_only'
  where video.id in (
    select draft_lesson.video_id
    from private.program_authoring_draft_lessons draft_lesson
    where draft_lesson.program_id = target_program_id
      and draft_lesson.draft_id = draft_row.draft_id
      and draft_lesson.video_id is not null
  ) and video.visibility = 'private';

  if exists (
    select 1
    from public.program_content_version_lessons lesson
    join public.videos video on video.id = lesson.video_id
    where lesson.program_id = target_program_id
      and lesson.content_version_id = new_content_version_id
      and lesson.video_id is not null
      and not private.stream_app_paid_lesson_is_exclusive(
        lesson.id, lesson.video_id, video.stream_provider_account_registry_id, lesson.cloudflare_uid
      )
  ) then
    raise exception 'A Program lesson video is shared or no longer exclusive' using errcode = '23514';
  end if;

  select coalesce(max(offer.offer_number), 0) + 1 into offer_number
  from public.program_offer_versions offer where offer.program_id = target_program_id;
  insert into public.program_offer_versions(
    program_id, offer_number, content_version_id, offer_kind, list_price_cents, currency,
    max_installments, platform_owned, seller_profile_id, connected_account_id, created_by
  ) values (
    target_program_id, offer_number, new_content_version_id, 'paid', target_list_price_cents, 'usd',
    target_max_installments, program_row.platform_owned, program_owner_id,
    connected_account, target_actor_id
  ) returning id into offer_version_id;

  update public.program_commerce_state state
  set current_content_version_id = new_content_version_id,
      current_offer_version_id = offer_version_id,
      updated_at = now()
  where state.program_id = target_program_id
    and state.current_content_version_id = pointer_content_id
    and state.current_offer_version_id = pointer_offer_id;
  if not found then
    raise exception 'Program current version changed during publication' using errcode = '40001';
  end if;
  if free_snapshot_id is not null and not public.release_program_versioning_fence(
    target_program_id, free_snapshot_id, new_content_version_id, offer_version_id
  ) then
    raise exception 'Program versioning fence did not match the new paid version' using errcode = '40001';
  end if;
  update public.programs program set published = true
  where program.id = target_program_id and not program.published;

  result := jsonb_build_object(
    'status', 'published',
    'program_id', target_program_id,
    'content_version_id', new_content_version_id,
    'offer_version_id', offer_version_id,
    'free_snapshot_id', free_snapshot_id,
    'revision_number', revision_number,
    'offer_number', offer_number,
    'list_price_cents', target_list_price_cents,
    'currency', 'usd',
    'max_installments', target_max_installments,
    'published', true,
    'replayed', false
  );
  insert into private.program_authoring_receipts(
    request_id, program_id, actor_id, operation_kind, request_digest, result
  ) values (
    target_request_id, target_program_id, target_actor_id, 'publish_content', request_digest,
    result - 'replayed'
  );
  delete from private.program_authoring_drafts draft
  where draft.program_id = target_program_id and draft.draft_id = draft_row.draft_id;
  return result;
end;
$$;
revoke all on function public.publish_program_authoring_draft(uuid, uuid, uuid, bigint, uuid, uuid, uuid, integer, smallint)
  from public, anon, authenticated;
grant execute on function public.publish_program_authoring_draft(uuid, uuid, uuid, bigint, uuid, uuid, uuid, integer, smallint)
  to service_role;

create function public.publish_program_offer_price(
  target_program_id uuid,
  target_actor_id uuid,
  target_expected_content_version_id uuid,
  target_expected_offer_version_id uuid,
  target_request_id uuid,
  target_list_price_cents integer,
  target_max_installments smallint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  program_owner_id uuid;
  actor_role text;
  program_row public.programs%rowtype;
  state_row public.program_commerce_state%rowtype;
  current_offer public.program_offer_versions%rowtype;
  content_version public.program_content_versions%rowtype;
  new_offer_id uuid;
  offer_number integer;
  connected_account text;
  request_digest text;
  replay_result jsonb;
  result jsonb;
begin
  if target_program_id is null or target_actor_id is null
    or target_expected_content_version_id is null or target_expected_offer_version_id is null
    or target_request_id is null or target_list_price_cents is null or target_list_price_cents < 50
    or target_max_installments is null or target_max_installments < 1 or target_max_installments > 12 then
    raise exception 'Program price request is invalid' using errcode = '22023';
  end if;
  request_digest := private.stream_media_identity_digest(concat_ws(chr(31),
    'publish_price', target_program_id::text, target_actor_id::text,
    target_expected_content_version_id::text, target_expected_offer_version_id::text,
    target_list_price_cents::text, target_max_installments::text
  ));
  program_owner_id := private.lock_program_authoring_scope(target_program_id, target_actor_id, false);
  select profile.role::text into actor_role
  from public.profiles profile where profile.id = target_actor_id;
  replay_result := private.program_authoring_receipt_replay(
    target_request_id, target_program_id, target_actor_id, 'publish_price', request_digest
  );
  if replay_result is not null then return replay_result; end if;

  select * into program_row from public.programs program
  where program.id = target_program_id for update;
  select * into state_row from public.program_commerce_state state
  where state.program_id = target_program_id for update;
  if not found or state_row.current_content_version_id is distinct from target_expected_content_version_id
    or state_row.current_offer_version_id is distinct from target_expected_offer_version_id then
    raise exception 'Program offer changed; reload before price publication' using errcode = '40001';
  end if;
  select * into current_offer from public.program_offer_versions offer
  where offer.program_id = target_program_id and offer.id = state_row.current_offer_version_id;
  select * into content_version from public.program_content_versions version
  where version.program_id = target_program_id and version.id = state_row.current_content_version_id;
  if current_offer.offer_kind <> 'paid' or content_version.revision_kind <> 'paid'
    or target_max_installments > least(12, content_version.lesson_count) then
    raise exception 'Price changes require the current paid Program content' using errcode = '23514';
  end if;
  if program_row.platform_owned then
    if actor_role <> 'admin' then raise exception 'Administrator is required' using errcode = '42501'; end if;
    connected_account := null;
  else
    select account.stripe_account_id into connected_account
    from public.payout_accounts account
    where account.coach_id = program_owner_id and account.charges_enabled
      and account.stripe_account_id ~ '^acct_[A-Za-z0-9]+$';
    if connected_account is null then
      raise exception 'Coach charges are not enabled for this Program' using errcode = '23514';
    end if;
  end if;
  select coalesce(max(offer.offer_number), 0) + 1 into offer_number
  from public.program_offer_versions offer where offer.program_id = target_program_id;
  insert into public.program_offer_versions(
    program_id, offer_number, content_version_id, offer_kind, list_price_cents, currency,
    max_installments, platform_owned, seller_profile_id, connected_account_id, created_by
  ) values (
    target_program_id, offer_number, state_row.current_content_version_id, 'paid',
    target_list_price_cents, 'usd', target_max_installments, program_row.platform_owned,
    program_owner_id, connected_account, target_actor_id
  ) returning id into new_offer_id;
  update public.program_commerce_state state
  set current_offer_version_id = new_offer_id, updated_at = now()
  where state.program_id = target_program_id
    and state.current_content_version_id = target_expected_content_version_id
    and state.current_offer_version_id = target_expected_offer_version_id;
  if not found then raise exception 'Program offer changed during price publication' using errcode = '40001'; end if;
  -- Keep an editable draft on the same content base while forcing its editor to refresh CAS state.
  update private.program_authoring_drafts draft
  set base_offer_version_id = new_offer_id,
      revision = draft.revision + 1,
      updated_at = now()
  where draft.program_id = target_program_id
    and draft.base_content_version_id = target_expected_content_version_id
    and draft.base_offer_version_id = target_expected_offer_version_id;
  result := jsonb_build_object(
    'status', 'published',
    'program_id', target_program_id,
    'content_version_id', target_expected_content_version_id,
    'offer_version_id', new_offer_id,
    'offer_number', offer_number,
    'list_price_cents', target_list_price_cents,
    'currency', 'usd',
    'max_installments', target_max_installments,
    'published', program_row.published,
    'replayed', false
  );
  insert into private.program_authoring_receipts(
    request_id, program_id, actor_id, operation_kind, request_digest, result
  ) values (
    target_request_id, target_program_id, target_actor_id, 'publish_price', request_digest,
    result - 'replayed'
  );
  return result;
end;
$$;
revoke all on function public.publish_program_offer_price(uuid, uuid, uuid, uuid, uuid, integer, smallint)
  from public, anon, authenticated;
grant execute on function public.publish_program_offer_price(uuid, uuid, uuid, uuid, uuid, integer, smallint)
  to service_role;

create function public.create_program_promotion(
  target_program_id uuid,
  target_actor_id uuid,
  target_expected_content_version_id uuid,
  target_expected_offer_version_id uuid,
  target_request_id uuid,
  target_code text,
  target_discount_kind text,
  target_discount_value integer,
  target_starts_at timestamptz,
  target_ends_at timestamptz,
  target_max_redemptions integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  program_owner_id uuid;
  program_row public.programs%rowtype;
  state_row public.program_commerce_state%rowtype;
  current_offer public.program_offer_versions%rowtype;
  promotion_id uuid;
  normalized_code text;
  request_digest text;
  replay_result jsonb;
  result jsonb;
begin
  if target_program_id is null or target_actor_id is null
    or target_expected_content_version_id is null or target_expected_offer_version_id is null
    or target_request_id is null or target_code is null or target_discount_kind is null
    or target_discount_value is null or target_starts_at is null
    or target_max_redemptions is null or target_max_redemptions < 1
    or target_max_redemptions > 1000000 then
    raise exception 'Program promotion request is invalid' using errcode = '22023';
  end if;
  normalized_code := upper(btrim(target_code));
  if normalized_code !~ '^[A-Z0-9][A-Z0-9_-]{1,63}$'
    or target_discount_kind not in ('fixed', 'percent')
    or target_discount_value < 1
    or (target_discount_kind = 'percent' and target_discount_value > 10000)
    or (target_ends_at is not null and target_ends_at <= target_starts_at) then
    raise exception 'Program promotion terms are invalid' using errcode = '22023';
  end if;
  request_digest := private.stream_media_identity_digest(concat_ws(chr(31),
    'create_promotion', target_program_id::text, target_actor_id::text,
    target_expected_content_version_id::text, target_expected_offer_version_id::text,
    normalized_code, target_discount_kind, target_discount_value::text,
    to_char(target_starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    case when target_ends_at is null then '' else
      to_char(target_ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') end,
    target_max_redemptions::text
  ));
  program_owner_id := private.lock_program_authoring_scope(target_program_id, target_actor_id, false);
  replay_result := private.program_authoring_receipt_replay(
    target_request_id, target_program_id, target_actor_id, 'create_promotion', request_digest
  );
  if replay_result is not null then return replay_result; end if;

  select * into program_row from public.programs program
  where program.id = target_program_id for update;
  select * into state_row from public.program_commerce_state state
  where state.program_id = target_program_id for update;
  if not found or state_row.current_content_version_id is distinct from target_expected_content_version_id
    or state_row.current_offer_version_id is distinct from target_expected_offer_version_id then
    raise exception 'Program offer changed; reload before creating a promotion' using errcode = '40001';
  end if;
  select * into current_offer from public.program_offer_versions offer
  where offer.program_id = target_program_id and offer.id = state_row.current_offer_version_id;
  if current_offer.offer_kind <> 'paid'
    or (target_discount_kind = 'fixed' and target_discount_value >= current_offer.list_price_cents) then
    raise exception 'Promotion must preserve the paid or supported 100 percent grant terms'
      using errcode = '23514';
  end if;
  if program_row.platform_owned then
    if not exists (select 1 from public.profiles profile
      where profile.id = target_actor_id and profile.role::text = 'admin') then
      raise exception 'Administrator is required' using errcode = '42501';
    end if;
  elsif not exists (
    select 1 from public.payout_accounts account
    where account.coach_id = program_owner_id and account.charges_enabled
      and account.stripe_account_id ~ '^acct_[A-Za-z0-9]+$'
  ) then
    raise exception 'Coach charges are not enabled for this Program' using errcode = '23514';
  end if;
  insert into public.program_promotions(
    program_id, offer_version_id, code, discount_kind, discount_value,
    starts_at, ends_at, max_redemptions, created_by
  ) values (
    target_program_id, target_expected_offer_version_id, normalized_code,
    target_discount_kind, target_discount_value, target_starts_at, target_ends_at,
    target_max_redemptions, target_actor_id
  ) returning id into promotion_id;
  result := jsonb_build_object(
    'status', 'published',
    'program_id', target_program_id,
    'content_version_id', target_expected_content_version_id,
    'offer_version_id', target_expected_offer_version_id,
    'promotion_id', promotion_id,
    'code', normalized_code,
    'discount_kind', target_discount_kind,
    'discount_value', target_discount_value,
    'starts_at', target_starts_at,
    'ends_at', target_ends_at,
    'max_redemptions', target_max_redemptions,
    'published', program_row.published,
    'replayed', false
  );
  insert into private.program_authoring_receipts(
    request_id, program_id, actor_id, operation_kind, request_digest, result
  ) values (
    target_request_id, target_program_id, target_actor_id, 'create_promotion', request_digest,
    result - 'replayed'
  );
  return result;
end;
$$;
revoke all on function public.create_program_promotion(uuid, uuid, uuid, uuid, uuid, text, text, integer, timestamptz, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.create_program_promotion(uuid, uuid, uuid, uuid, uuid, text, text, integer, timestamptz, timestamptz, integer)
  to service_role;
