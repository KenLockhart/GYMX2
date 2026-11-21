-- Gate 3.15: private Stream upload transport and application projections.
-- Provider HTTP, fixed-host validation, signing, and live transports remain in the future adapter.

-- Program-only is a protected playback visibility used by the accepted 1550/310 guards.
alter table public.videos drop constraint videos_visibility_check;
alter table public.videos add constraint videos_visibility_check
  check (visibility in ('members','private','program_only'));

create sequence private.stream_media_app_evidence_order_seq;
revoke all on sequence private.stream_media_app_evidence_order_seq
  from public,anon,authenticated,service_role;

create table public.stream_media_create_claims (
  operation_id uuid primary key references public.stream_media_operations(id) on delete restrict,
  request_id uuid not null unique,
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  operation_revision bigint not null check (operation_revision > 0),
  created_at timestamptz not null default now()
);

create table public.stream_media_upload_transport (
  operation_id uuid primary key references public.stream_media_operations(id) on delete restrict,
  request_id uuid not null unique,
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  registry_id uuid not null references public.stream_provider_account_registry(id) on delete restrict,
  request_marker uuid not null,
  provider_uid text,
  tus_location text,
  tus_location_digest text,
  provider_evidence_digest text,
  transport_expires_at timestamptz,
  original_max_duration_seconds integer not null check (original_max_duration_seconds between 1 and 21600),
  original_require_signed_urls boolean not null,
  original_metadata jsonb not null check (jsonb_typeof(original_metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((tus_location is null) = (tus_location_digest is null)),
  check ((tus_location is null) = (transport_expires_at is null)),
  check ((provider_uid is null) = (provider_evidence_digest is null))
);
comment on table public.stream_media_upload_transport is
  'Private, exact transport capability. Never readable as a table; bearer TUS Location is returned only by a same-actor, current-eligibility RPC.';
comment on column public.stream_media_upload_transport.tus_location is
  'Private provider-issued bearer capability. The future adapter validates its host and HTTP response before calling the trusted recording RPC.';

create table public.stream_media_upload_abort_manifests (
  id uuid primary key,
  cleanup_operation_id uuid not null unique references public.stream_media_operations(id) on delete restrict,
  upload_operation_id uuid not null unique references public.stream_media_operations(id) on delete restrict,
  intent_id uuid not null references public.stream_media_upload_intents(id) on delete restrict,
  context_digest text not null check (context_digest ~ '^[0-9a-f]{64}$'),
  observation_id uuid not null references public.stream_media_upload_observations(id) on delete restrict,
  registry_id uuid not null references public.stream_provider_account_registry(id) on delete restrict,
  raw_provider_uid text not null,
  actor_id uuid not null,
  owner_id uuid not null,
  parent_kind text not null,
  parent_identity text not null,
  parent_revision bigint not null check (parent_revision > 0),
  cleanup_reason text not null check (cleanup_reason in ('actor_request','account_cleanup')),
  cancel_request_id uuid not null,
  tombstone_id uuid references public.stream_media_account_tombstones(id) on delete restrict,
  tombstone_request_id uuid,
  tombstone_revision bigint,
  tombstone_state_revision bigint,
  request_id uuid not null unique,
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  check ((tombstone_id is null) = (tombstone_request_id is null)),
  check ((tombstone_id is null) = (tombstone_revision is null)),
  check ((tombstone_id is null) = (tombstone_state_revision is null)),
  check ((cleanup_reason='account_cleanup')=(tombstone_id is not null)),
  unique (cleanup_operation_id,registry_id,raw_provider_uid)
);

create table public.stream_media_upload_cancel_receipts (
  operation_id uuid primary key references public.stream_media_operations(id) on delete restrict,
  request_id uuid not null unique,
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  observation_request_id uuid not null,
  cleanup_operation_id uuid not null references public.stream_media_operations(id) on delete restrict,
  cleanup_manifest_kind text not null check (cleanup_manifest_kind in ('canonical_provisional','unready_abort')),
  abort_manifest_id uuid references public.stream_media_upload_abort_manifests(id) on delete restrict,
  cleanup_reason text not null check (cleanup_reason in ('actor_request','account_cleanup')),
  tombstone_id uuid references public.stream_media_account_tombstones(id) on delete restrict,
  tombstone_request_id uuid,
  tombstone_revision bigint,
  tombstone_state_revision bigint,
  registry_id uuid not null references public.stream_provider_account_registry(id) on delete restrict,
  raw_provider_uid text not null,
  exact_absence_status smallint not null check (exact_absence_status = 404),
  absence_evidence_digest text not null check (absence_evidence_digest ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null,
  owner_id uuid not null,
  parent_kind text not null,
  parent_identity text not null,
  parent_revision bigint not null check (parent_revision > 0),
  created_at timestamptz not null default now(),
  evidence_order_sequence bigint not null unique default nextval('private.stream_media_app_evidence_order_seq'),
  unique (cleanup_operation_id, registry_id, raw_provider_uid),
  check ((cleanup_reason='account_cleanup')=(tombstone_id is not null)),
  check ((tombstone_id is null) = (tombstone_request_id is null)),
  check ((tombstone_id is null) = (tombstone_revision is null)),
  check ((tombstone_id is null) = (tombstone_state_revision is null)),
  check ((cleanup_manifest_kind='unready_abort')=(abort_manifest_id is not null))
);

create table public.stream_media_upload_prehttp_cancel_receipts (
  operation_id uuid primary key references public.stream_media_operations(id) on delete restrict,
  request_id uuid not null unique,
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  cleanup_reason text not null check (cleanup_reason in ('actor_request','account_cleanup')),
  tombstone_id uuid references public.stream_media_account_tombstones(id) on delete restrict,
  tombstone_request_id uuid,
  tombstone_revision bigint,
  tombstone_state_revision bigint,
  created_at timestamptz not null default now(),
  evidence_order_sequence bigint not null unique default nextval('private.stream_media_app_evidence_order_seq'),
  check ((cleanup_reason='account_cleanup')=(tombstone_id is not null)),
  check ((tombstone_id is null) = (tombstone_request_id is null)),
  check ((tombstone_id is null) = (tombstone_revision is null)),
  check ((tombstone_id is null) = (tombstone_state_revision is null))
);

create table public.stream_media_upload_observation_clocks (
  observation_id uuid primary key references public.stream_media_upload_observations(id) on delete restrict,
  order_sequence bigint not null unique default nextval('private.stream_media_app_evidence_order_seq'),
  observed_at timestamptz not null
);

create table public.stream_media_operation_uid_event_clocks (
  event_id uuid primary key references public.stream_media_operation_uid_events(id) on delete restrict,
  order_sequence bigint not null unique default nextval('private.stream_media_app_evidence_order_seq'),
  observed_at timestamptz not null
);

create table public.stream_media_library_requests (
  operation_id uuid primary key references public.stream_media_operations(id) on delete restrict,
  video_id uuid not null unique,
  actor_id uuid not null,
  title text not null check (char_length(title) between 1 and 120),
  description text not null check (char_length(description) <= 2000),
  file_digest text not null check (file_digest ~ '^[0-9a-f]{64}$'),
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

alter table public.stream_media_create_claims enable row level security;
alter table public.stream_media_upload_transport enable row level security;
alter table public.stream_media_upload_cancel_receipts enable row level security;
alter table public.stream_media_upload_prehttp_cancel_receipts enable row level security;
alter table public.stream_media_upload_abort_manifests enable row level security;
alter table public.stream_media_library_requests enable row level security;
alter table public.stream_media_upload_observation_clocks enable row level security;
alter table public.stream_media_operation_uid_event_clocks enable row level security;
revoke all on public.stream_media_create_claims, public.stream_media_upload_transport,
  public.stream_media_upload_cancel_receipts, public.stream_media_library_requests
  ,public.stream_media_upload_prehttp_cancel_receipts
  ,public.stream_media_upload_abort_manifests,public.stream_media_upload_observation_clocks,
  public.stream_media_operation_uid_event_clocks
  from public, anon, authenticated, service_role;
create trigger stream_media_create_claims_immutable
before update or delete on public.stream_media_create_claims
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();
create trigger stream_media_upload_cancel_receipts_immutable
before update or delete on public.stream_media_upload_cancel_receipts
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();
create trigger stream_media_upload_prehttp_cancel_receipts_immutable
before update or delete on public.stream_media_upload_prehttp_cancel_receipts
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();
create trigger stream_media_upload_abort_manifests_immutable
before update or delete on public.stream_media_upload_abort_manifests
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();
create trigger stream_media_upload_observation_clocks_immutable
before update or delete on public.stream_media_upload_observation_clocks
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();
create trigger stream_media_operation_uid_event_clocks_immutable
before update or delete on public.stream_media_operation_uid_event_clocks
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();
create trigger stream_media_library_requests_immutable
before update or delete on public.stream_media_library_requests
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();

create function private.record_stream_media_upload_observation_clock()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.stream_media_upload_observation_clocks(observation_id,observed_at)
  values(new.id,clock_timestamp());
  return new;
end;
$$;
revoke all on function private.record_stream_media_upload_observation_clock()
  from public,anon,authenticated,service_role;
create trigger stream_media_upload_observation_clock_capture
after insert on public.stream_media_upload_observations
for each row execute function private.record_stream_media_upload_observation_clock();

create function private.record_stream_media_operation_uid_event_clock()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.stream_media_operation_uid_event_clocks(event_id,observed_at)
  values(new.id,clock_timestamp());
  return new;
end;
$$;
revoke all on function private.record_stream_media_operation_uid_event_clock()
  from public,anon,authenticated,service_role;
create trigger stream_media_operation_uid_event_clock_capture
after insert on public.stream_media_operation_uid_events
for each row execute function private.record_stream_media_operation_uid_event_clock();

create function private.guard_stream_media_upload_transport()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Stream transport evidence is immutable' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE'
    and new.provider_uid is not null and new.provider_evidence_digest is not null
    and (
      (old.provider_uid is null and old.tus_location is null and old.transport_expires_at is null
        and ((new.tus_location is null and new.tus_location_digest is null and new.transport_expires_at is null)
          or (new.tus_location is not null and new.tus_location_digest is not null and new.transport_expires_at is not null)))
      or (old.provider_uid is not null and old.tus_location is null and old.transport_expires_at is null
        and new.provider_uid=old.provider_uid
        and new.provider_evidence_digest=old.provider_evidence_digest
        and new.tus_location is not null and new.tus_location_digest is not null
        and new.transport_expires_at is not null)
    )
    and (to_jsonb(new) - array['provider_uid','tus_location','tus_location_digest',
      'provider_evidence_digest',
      'transport_expires_at','updated_at']) =
      (to_jsonb(old) - array['provider_uid','tus_location','tus_location_digest',
        'provider_evidence_digest',
        'transport_expires_at','updated_at']) then
    return new;
  end if;
  raise exception 'Stream transport identity cannot be changed' using errcode = '55000';
end;
$$;
revoke all on function private.guard_stream_media_upload_transport() from public, anon, authenticated, service_role;
create trigger stream_media_upload_transport_guard
before update or delete on public.stream_media_upload_transport
for each row execute function private.guard_stream_media_upload_transport();

create function private.stream_app_role_eligible(target_actor_id uuid, target_source_kind text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles profile
    where profile.id = target_actor_id
      and (
        (target_source_kind = 'video' and profile.role::text in ('coach','admin'))
        or (target_source_kind = 'post_media' and profile.role::text in ('member','coach','admin')
          and (profile.role::text <> 'member' or private.has_platform_tier(target_actor_id,'regular')))
      )
  );
$$;
revoke all on function private.stream_app_role_eligible(uuid,text) from public, anon, authenticated, service_role;

-- A fresh result is the only authorization to issue one provider POST. Replays are recovery only.
create function public.claim_stream_media_create(
  target_operation_id uuid, target_request_id uuid, target_request_digest text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  operation_row public.stream_media_operations%rowtype;
  intent_row public.stream_media_upload_intents%rowtype;
  context_row public.stream_media_upload_contexts%rowtype;
  state_row public.stream_media_operation_states%rowtype;
  prior_claim public.stream_media_create_claims%rowtype;
  next_revision bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Stream create claims are service managed' using errcode = '42501';
  end if;
  if target_operation_id is null or target_request_id is null
    or target_request_digest is null or target_request_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'Stream create claim is invalid' using errcode = '22023';
  end if;
  perform private.stream_require_read_committed();
  select operation.* into operation_row from public.stream_media_operations operation
  where operation.id = target_operation_id and operation.operation_kind = 'upload';
  if not found then return jsonb_build_object('outcome','operation_missing'); end if;
  perform private.stream_lock_accounts(array[operation_row.actor_id,operation_row.owner_id]);
  perform pg_advisory_xact_lock(hashtextextended(
    operation_row.parent_kind || ':' || operation_row.parent_identity, 19031002));
  select operation.* into operation_row from public.stream_media_operations operation
  where operation.id = target_operation_id and operation.operation_kind = 'upload' for update;
  if not found then return jsonb_build_object('outcome','operation_missing'); end if;
  select context.* into context_row from public.stream_media_upload_contexts context
  where context.intent_id = operation_row.intent_id;
  select intent.* into intent_row from public.stream_media_upload_intents intent
  where intent.id = operation_row.intent_id;
  if not found or intent_row.id is null or intent_row.provider_account_registry_id <> operation_row.registry_id
    or context_row.owner_id <> operation_row.owner_id then
    return jsonb_build_object('outcome','not_eligible');
  end if;
  if not private.stream_app_role_eligible(operation_row.actor_id,operation_row.source_kind)
    or private.stream_account_is_tombstoned(operation_row.actor_id)
    or private.stream_account_is_tombstoned(operation_row.owner_id)
    or not private.stream_account_is_verified(operation_row.registry_id) then
    return jsonb_build_object('outcome','not_eligible'); end if;
  if target_request_digest <> operation_row.operation_digest then
    return jsonb_build_object('outcome','request_digest_mismatch');
  end if;
  select state.* into state_row from public.stream_media_operation_states state
  where state.operation_id = target_operation_id for update;
  select claim.* into prior_claim from public.stream_media_create_claims claim
  where claim.operation_id = target_operation_id or claim.request_id = target_request_id for update;
  if found then
    if prior_claim.operation_id <> target_operation_id or prior_claim.request_id <> target_request_id
      or prior_claim.request_digest <> target_request_digest then
      return jsonb_build_object('outcome','identity_mismatch');
    end if;
    return jsonb_build_object('outcome','recovery_required','operation_state',state_row.operation_state,
      'create_authorized',false);
  end if;
  if state_row.operation_state <> 'reserved'
    or not exists (select 1 from public.stream_media_parent_fences fence
      where fence.source_kind = operation_row.parent_kind
        and fence.source_identity = operation_row.parent_identity
        and fence.owner_id = operation_row.owner_id
        and fence.source_revision = operation_row.expected_source_revision
        and fence.active_operation_id = target_operation_id and fence.fence_state = 'closing') then
    return jsonb_build_object('outcome','recovery_required','operation_state',state_row.operation_state,
      'create_authorized',false);
  end if;
  insert into public.stream_media_create_claims(operation_id,request_id,request_digest,operation_revision)
  values (target_operation_id,target_request_id,target_request_digest,state_row.state_revision + 1);
  next_revision := private.stream_advance_operation(target_operation_id,'create_started',
    target_request_id,target_request_digest);
  return jsonb_build_object('outcome','create_authorized','create_authorized',true,
    'operation_id',target_operation_id,'operation_revision',next_revision);
exception when unique_violation then
  return jsonb_build_object('outcome','recovery_required','create_authorized',false);
end;
$$;
revoke all on function public.claim_stream_media_create(uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.claim_stream_media_create(uuid,uuid,text) to service_role;

-- The service adapter supplies only an observed provider response tied to this exact claim.
create function public.record_stream_media_upload_transport(
  target_operation_id uuid, target_request_id uuid, target_request_digest text,
  target_provider_uid text, target_tus_location text, target_expires_at timestamptz,
  target_max_duration_seconds integer, target_require_signed_urls boolean,
  target_metadata jsonb, target_evidence_digest text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  operation_row public.stream_media_operations%rowtype;
  intent_row public.stream_media_upload_intents%rowtype;
  prior public.stream_media_upload_transport%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Stream transport observations are service managed' using errcode = '42501';
  end if;
  if target_operation_id is null or target_request_id is null
    or target_request_digest is null or target_request_digest !~ '^[0-9a-f]{64}$'
    or target_provider_uid is null or char_length(target_provider_uid) not between 1 and 200
    or (target_tus_location is null and target_expires_at is not null)
    or (target_tus_location is not null and (char_length(target_tus_location) not between 1 and 4096
      or target_expires_at is null or target_expires_at <= now()))
    or target_max_duration_seconds is null or target_max_duration_seconds not between 1 and 21600
    or target_require_signed_urls is null or target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object'
    or target_evidence_digest is null or target_evidence_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'Stream transport observation is invalid' using errcode = '22023';
  end if;
  select operation.* into operation_row from public.stream_media_operations operation
  where operation.id = target_operation_id and operation.operation_kind = 'upload';
  if not found then return jsonb_build_object('outcome','operation_missing'); end if;
  select intent.* into intent_row from public.stream_media_upload_intents intent
  where intent.id = operation_row.intent_id;
  if not found or not exists (select 1 from public.stream_media_create_claims claim
    where claim.operation_id = target_operation_id and claim.request_digest = target_request_digest)
    or not exists (select 1 from public.stream_media_operation_states state
      where state.operation_id = target_operation_id and state.operation_state in ('create_started','create_unknown'))
    or intent_row.provider_account_registry_id <> operation_row.registry_id then
    return jsonb_build_object('outcome','create_claim_missing_or_stale');
  end if;
  if target_request_digest <> operation_row.operation_digest then
    return jsonb_build_object('outcome','request_digest_mismatch');
  end if;
  if target_metadata ->> 'request_marker' is distinct from intent_row.request_marker::text
    or target_metadata ->> 'source_kind' is distinct from operation_row.source_kind
    or target_metadata ->> 'source_id' is distinct from operation_row.source_identity
    or target_metadata ->> 'actor_id' is distinct from operation_row.actor_id::text then
    return jsonb_build_object('outcome','intent_metadata_mismatch');
  end if;
  select transport.* into prior from public.stream_media_upload_transport transport
  where transport.operation_id = target_operation_id or transport.request_id = target_request_id for update;
  if found then
    if prior.operation_id <> target_operation_id or prior.request_id <> target_request_id
      or prior.request_digest <> target_request_digest or prior.registry_id <> operation_row.registry_id
      or prior.request_marker <> intent_row.request_marker
      or prior.original_max_duration_seconds <> target_max_duration_seconds
      or prior.original_require_signed_urls <> target_require_signed_urls
      or prior.original_metadata <> target_metadata then
      return jsonb_build_object('outcome','identity_mismatch');
    end if;
    if prior.provider_uid is null and prior.tus_location is null then
      update public.stream_media_upload_transport set provider_uid=target_provider_uid,
        tus_location=target_tus_location,
        tus_location_digest=case when target_tus_location is null then null
          else private.stream_media_identity_digest(target_tus_location) end,
        provider_evidence_digest=target_evidence_digest,
        transport_expires_at=target_expires_at,updated_at=now()
      where operation_id=target_operation_id;
      return jsonb_build_object('outcome',case when target_tus_location is null
        then 'known_uid_location_missing' else 'recorded' end,'operation_id',target_operation_id,
        'recovery_required',target_tus_location is null);
    end if;
    if prior.provider_uid=target_provider_uid and prior.provider_evidence_digest=target_evidence_digest
      and prior.tus_location is null and target_tus_location is not null then
      update public.stream_media_upload_transport set tus_location=target_tus_location,
        tus_location_digest=private.stream_media_identity_digest(target_tus_location),
        transport_expires_at=target_expires_at,updated_at=now()
      where operation_id=target_operation_id;
      return jsonb_build_object('outcome','location_recovered','operation_id',target_operation_id,
        'recovery_required',false);
    end if;
    if prior.provider_uid <> target_provider_uid or prior.tus_location is distinct from target_tus_location
      or prior.transport_expires_at is distinct from target_expires_at
      or prior.provider_evidence_digest <> target_evidence_digest
      or prior.tus_location_digest is distinct from (case when target_tus_location is null then null
        else private.stream_media_identity_digest(target_tus_location) end) then
      return jsonb_build_object('outcome','identity_mismatch');
    end if;
    return jsonb_build_object('outcome',case when prior.tus_location is null
      then 'known_uid_location_missing' else 'already_recorded' end,
      'operation_id',target_operation_id,'recovery_required',prior.tus_location is null);
  end if;
  return jsonb_build_object('outcome','transport_spec_missing');
exception when unique_violation then
  return jsonb_build_object('outcome','identity_mismatch');
end;
$$;
revoke all on function public.record_stream_media_upload_transport(uuid,uuid,text,text,text,timestamptz,integer,boolean,jsonb,text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_stream_media_upload_transport(uuid,uuid,text,text,text,timestamptz,integer,boolean,jsonb,text)
  to service_role;

create function public.get_stream_media_upload_status(target_operation_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  operation_row public.stream_media_operations%rowtype;
  state_row public.stream_media_operation_states%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null then
    raise exception 'Signed-in upload status is required' using errcode = '42501';
  end if;
  select operation.* into operation_row from public.stream_media_operations operation
  where operation.id = target_operation_id and operation.operation_kind = 'upload'
    and operation.actor_id = auth.uid();
  if not found then return jsonb_build_object('outcome','unavailable'); end if;
  if not private.stream_app_role_eligible(operation_row.actor_id,operation_row.source_kind)
    or private.stream_account_is_tombstoned(operation_row.actor_id)
    or private.stream_account_is_tombstoned(operation_row.owner_id) then
    return jsonb_build_object('outcome','unavailable');
  end if;
  select state.* into state_row from public.stream_media_operation_states state
  where state.operation_id = target_operation_id;
  return jsonb_build_object('outcome','available','operation_state',state_row.operation_state,
    'operation_revision',state_row.state_revision);
end;
$$;
revoke all on function public.get_stream_media_upload_status(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_stream_media_upload_status(uuid) to authenticated;

-- Bearer capability retrieval is separate from status and is scoped to the initiating actor.
create function public.get_stream_media_upload_tus_location(target_operation_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  operation_row public.stream_media_operations%rowtype;
  context_row public.stream_media_upload_contexts%rowtype;
  transport_row public.stream_media_upload_transport%rowtype;
  state_value text;
begin
  if auth.role() is distinct from 'authenticated' or v_actor_id is null then
    raise exception 'Signed-in upload actor is required' using errcode = '42501';
  end if;
  perform private.stream_require_read_committed();
  select operation.* into operation_row from public.stream_media_operations operation
  where operation.id = target_operation_id and operation.operation_kind = 'upload'
    and operation.actor_id = v_actor_id;
  if not found then return jsonb_build_object('outcome','unavailable'); end if;
  select context.* into context_row from public.stream_media_upload_contexts context
  where context.intent_id = operation_row.intent_id;
  if context_row.intent_id is null then return jsonb_build_object('outcome','unavailable'); end if;
  perform private.stream_lock_accounts(array[v_actor_id,operation_row.owner_id]);
  if not private.stream_try_parent_lock(context_row.parent_kind,context_row.parent_identity) then
    return jsonb_build_object('outcome','unavailable'); end if;
  select operation.* into operation_row from public.stream_media_operations operation
  where operation.id = target_operation_id and operation.operation_kind = 'upload'
    and operation.actor_id = v_actor_id for update;
  if not found or not private.stream_app_role_eligible(operation_row.actor_id,operation_row.source_kind)
    or operation_row.owner_id is distinct from v_actor_id
    or private.stream_account_is_tombstoned(operation_row.actor_id)
    or private.stream_account_is_tombstoned(operation_row.owner_id)
    or not private.stream_account_is_verified(operation_row.registry_id) then
    return jsonb_build_object('outcome','unavailable');
  end if;
  select context.* into context_row from public.stream_media_upload_contexts context
  where context.intent_id = operation_row.intent_id;
  select state.operation_state into state_value from public.stream_media_operation_states state
  where state.operation_id = target_operation_id;
  select transport.* into transport_row from public.stream_media_upload_transport transport
  where transport.operation_id = target_operation_id;
  if context_row.intent_id is null or context_row.owner_id is distinct from operation_row.owner_id
    or context_row.parent_kind is distinct from operation_row.parent_kind
    or context_row.parent_identity is distinct from operation_row.parent_identity
    or context_row.source_revision is distinct from operation_row.expected_source_revision
    or transport_row.operation_id is null
    or transport_row.registry_id <> operation_row.registry_id
    or transport_row.request_digest is distinct from operation_row.operation_digest
    or transport_row.provider_uid is null or transport_row.tus_location is null
    or transport_row.tus_location_digest is null or transport_row.transport_expires_at is null
    or transport_row.request_marker <> (select intent.request_marker
      from public.stream_media_upload_intents intent where intent.id = operation_row.intent_id)
    or transport_row.tus_location_digest <> private.stream_media_identity_digest(transport_row.tus_location)
    or transport_row.transport_expires_at <= now()
    or state_value is null or state_value not in ('create_started','created_unverified','create_unknown','provisional_bound')
    or not exists (select 1 from public.stream_media_parent_fences fence
      where fence.source_kind = context_row.parent_kind and fence.source_identity = context_row.parent_identity
        and fence.owner_id = context_row.owner_id and fence.source_revision = context_row.source_revision
        and fence.active_operation_id = target_operation_id and fence.fence_state = 'closing') then
    return jsonb_build_object('outcome','unavailable');
  end if;
  return jsonb_build_object('outcome','available','tus_location',transport_row.tus_location,
    'expires_at',transport_row.transport_expires_at,'max_duration_seconds',transport_row.original_max_duration_seconds,
    'require_signed_urls',transport_row.original_require_signed_urls,'metadata',transport_row.original_metadata);
end;
$$;
revoke all on function public.get_stream_media_upload_tus_location(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_stream_media_upload_tus_location(uuid) to authenticated;

-- The client chooses a prospective source UUID only. Account, actor, marker, fixed metadata,
-- operation, parent fence, and upload parameters are derived and committed here.
create function public.prepare_stream_library_video_upload(
  target_request_id uuid, target_video_id uuid, target_title text, target_description text,
  target_file_digest text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  registry_id uuid;
  request_marker uuid;
  v_intent_id uuid;
  intent_request_id uuid;
  v_operation_id uuid;
  operation_request_id uuid;
  context_request_id uuid;
  transport_request_id uuid;
  profile_fence public.stream_media_parent_fences%rowtype;
  prior_operation public.stream_media_operations%rowtype;
  prior_request public.stream_media_library_requests%rowtype;
  state_value text;
  v_source_revision bigint;
  payload_digest text;
  operation_digest text;
  metadata jsonb;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null then
    raise exception 'A signed-in coach is required' using errcode = '42501';
  end if;
  if target_request_id is null or target_video_id is null or target_title is null
    or char_length(target_title) not between 1 and 120
    or target_description is null or char_length(target_description) > 2000
    or target_file_digest is null or target_file_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'Library upload request is invalid' using errcode = '22023';
  end if;
  perform private.stream_require_read_committed();
  perform private.stream_lock_accounts(array[actor_id]);
  if not exists (select 1 from public.profiles profile
    where profile.id=actor_id and profile.role::text in ('coach','admin')) then
    raise exception 'Only a coach can upload library media' using errcode='42501'; end if;
  if private.stream_account_is_tombstoned(actor_id) then
    return jsonb_build_object('outcome','account_deleting'); end if;
  payload_digest := private.stream_media_identity_digest(concat_ws('|',
    'library_video',actor_id::text,target_video_id::text,target_title,target_description,target_file_digest));
  request_marker := private.stream_media_request_uuid(target_request_id::text||':library-marker');
  v_intent_id := private.stream_media_request_uuid(target_request_id::text||':library-intent');
  intent_request_id := private.stream_media_request_uuid(target_request_id::text||':library-intent-request');
  v_operation_id := private.stream_media_request_uuid(target_request_id::text||':library-operation');
  operation_request_id := private.stream_media_request_uuid(target_request_id::text||':library-operation-request');
  context_request_id := private.stream_media_request_uuid(target_request_id::text||':library-context');
  transport_request_id := private.stream_media_request_uuid(target_request_id::text||':library-transport');
  operation_digest := private.stream_media_identity_digest(concat_ws('|',
    'stream_library_upload_v1',payload_digest,v_intent_id::text,target_video_id::text,
    actor_id::text,request_marker::text,'vod_primary','7200','true'));
  metadata := jsonb_build_object('request_marker',request_marker::text,
    'source_kind','video','source_id',target_video_id::text,'actor_id',actor_id::text);

  if not private.stream_try_parent_lock('profile',actor_id::text) then
    return jsonb_build_object('outcome','profile_busy');
  end if;
  select registry.id into registry_id from public.stream_provider_account_registry registry
  where registry.credential_slot = 'vod_primary';
  if registry_id is null or not private.stream_account_is_verified(registry_id) then
    return jsonb_build_object('outcome','account_unverified');
  end if;

  select operation.* into prior_operation from public.stream_media_operations operation
  where operation.id = v_operation_id or operation.request_id = operation_request_id for update;
  if found then
    select library_request.* into prior_request from public.stream_media_library_requests library_request
    where library_request.operation_id = v_operation_id;
    if prior_operation.id <> v_operation_id or prior_operation.request_id <> operation_request_id
      or prior_operation.actor_id <> actor_id or prior_operation.owner_id <> actor_id
      or prior_operation.source_identity <> target_video_id::text
      or prior_operation.operation_digest <> operation_digest
      or prior_request.operation_id is null or prior_request.video_id <> target_video_id
      or prior_request.actor_id <> actor_id or prior_request.title <> target_title
      or prior_request.description <> target_description or prior_request.file_digest <> target_file_digest
      or prior_request.request_digest <> payload_digest then
      return jsonb_build_object('outcome','identity_mismatch');
    end if;
    select state.operation_state into state_value from public.stream_media_operation_states state
     where state.operation_id = v_operation_id;
    return jsonb_build_object('outcome','same_operation','operation_id',v_operation_id,
      'operation_state',state_value,'source_id',target_video_id);
  end if;
  if exists (select 1 from public.videos video where video.id = target_video_id)
    or exists (select 1 from public.stream_media_upload_intents intent
      where intent.source_kind = 'video' and intent.source_id = target_video_id) then
    return jsonb_build_object('outcome','source_identity_in_use');
  end if;
  insert into public.stream_media_parent_fences(source_kind,source_identity,owner_id,source_revision)
  values ('profile',actor_id::text,actor_id,1)
  on conflict (source_kind,source_identity) do nothing;
  select fence.* into profile_fence from public.stream_media_parent_fences fence
  where fence.source_kind = 'profile' and fence.source_identity = actor_id::text for update;
  if profile_fence.owner_id is distinct from actor_id or profile_fence.fence_state <> 'open'
    or profile_fence.active_operation_id is not null then
    return jsonb_build_object('outcome','profile_busy');
  end if;
  v_source_revision := profile_fence.source_revision;
  insert into public.stream_media_upload_intents(
    id,request_id,actor_id,purpose,source_kind,source_id,parent_revision,
    provider_account_registry_id,request_marker,payload_digest
  ) values (
    v_intent_id,intent_request_id,actor_id,'library_video','video',target_video_id,v_source_revision,
    registry_id,request_marker,payload_digest
  );
  insert into public.stream_media_upload_contexts(
    intent_id,parent_kind,parent_identity,owner_id,source_revision,context_digest,request_id
  ) values (
    v_intent_id,'profile',actor_id::text,actor_id,v_source_revision,
    private.stream_media_identity_digest(concat_ws('|','profile',actor_id::text,v_source_revision::text,v_intent_id::text)),
    context_request_id
  );
  insert into public.stream_media_upload_account_edges(intent_id,account_id,relation_kind,request_id)
  values (v_intent_id,actor_id,'actor',context_request_id),
    (v_intent_id,actor_id,'source_owner',context_request_id);
  insert into public.stream_media_operations(
    id,request_id,operation_kind,actor_id,owner_id,source_kind,source_identity,
    parent_kind,parent_identity,expected_source_revision,registry_id,intent_id,operation_digest
  ) values (
    v_operation_id,operation_request_id,'upload',actor_id,actor_id,'video',target_video_id::text,
    'profile',actor_id::text,v_source_revision,registry_id,v_intent_id,operation_digest
  );
  insert into public.stream_media_operation_states(operation_id,operation_state)
  values (v_operation_id,'reserved');
  insert into public.stream_media_operation_events(
    operation_id,sequence_number,from_state,to_state,request_id,evidence_digest
  ) values (v_operation_id,1,null,'reserved',operation_request_id,operation_digest);
  insert into public.stream_media_library_requests(
    operation_id,video_id,actor_id,title,description,file_digest,request_digest
  ) values (v_operation_id,target_video_id,actor_id,target_title,target_description,target_file_digest,payload_digest);
  insert into public.stream_media_upload_transport(
    operation_id,request_id,request_digest,registry_id,request_marker,
    original_max_duration_seconds,original_require_signed_urls,original_metadata
  ) values (
    v_operation_id,transport_request_id,operation_digest,registry_id,request_marker,7200,true,metadata
  );
  update public.stream_media_parent_fences as profile_fence_update set fence_state='closing',
    active_operation_id=v_operation_id,state_revision=profile_fence_update.state_revision+1,updated_at=now()
  where profile_fence_update.source_kind='profile' and profile_fence_update.source_identity=actor_id::text
    and profile_fence_update.source_revision=v_source_revision and profile_fence_update.fence_state='open'
    and profile_fence_update.owner_id=actor_id;
  if not found then raise exception 'Profile upload fence changed' using errcode = '40001'; end if;
  return jsonb_build_object('outcome','reserved','operation_id',v_operation_id,
    'source_id',target_video_id,'operation_state','reserved','request_digest',operation_digest,
    'transport_request_id',transport_request_id,'max_duration_seconds',7200,
    'require_signed_urls',true,'metadata',metadata);
exception when unique_violation then
  return jsonb_build_object('outcome','identity_mismatch');
end;
$$;
revoke all on function public.prepare_stream_library_video_upload(uuid,uuid,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.prepare_stream_library_video_upload(uuid,uuid,text,text,text) to authenticated;

-- The prospective video identity, guarded INSERT, ready transition, receipt, and profile-fence
-- release commit together. A caller cannot supply the UID or owner.
create function public.commit_stream_library_video_upload(target_operation_id uuid,target_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  operation_row public.stream_media_operations%rowtype;
  intent_row public.stream_media_upload_intents%rowtype;
  context_row public.stream_media_upload_contexts%rowtype;
  library_request_row public.stream_media_library_requests%rowtype;
  transport_row public.stream_media_upload_transport%rowtype;
  state_row public.stream_media_operation_states%rowtype;
  asset_row public.stream_media_assets%rowtype;
  binding_row public.stream_media_source_bindings%rowtype;
  observation_row public.stream_media_upload_observations%rowtype;
  receipt_row public.stream_media_finalization_receipts%rowtype;
  commit_digest text;
  completion_request_id uuid;
  next_revision bigint;
  final_response jsonb;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null then
    raise exception 'A signed-in library owner is required' using errcode = '42501';
  end if;
  if target_operation_id is null or target_request_id is null then
    raise exception 'Library upload commit is invalid' using errcode = '22023';
  end if;
  perform private.stream_require_read_committed();
  perform private.stream_lock_accounts(array[auth.uid()]);
  select operation.* into operation_row from public.stream_media_operations operation
  where operation.id = target_operation_id and operation.operation_kind = 'upload'
    and operation.source_kind = 'video' and operation.actor_id = auth.uid()
    and operation.owner_id = auth.uid() for update;
  if not found then return jsonb_build_object('outcome','operation_unavailable'); end if;
  if exists (select 1 from public.stream_media_finalization_receipts receipt
      where (receipt.operation_id=target_operation_id and receipt.request_id<>target_request_id)
        or (receipt.request_id=target_request_id and receipt.operation_id<>target_operation_id)) then
    return jsonb_build_object('outcome','identity_mismatch');
  end if;
  select receipt.* into receipt_row from public.stream_media_finalization_receipts receipt
  where receipt.operation_id=target_operation_id and receipt.request_id=target_request_id for update;
  if found then
    if receipt_row.operation_id is distinct from target_operation_id
      or receipt_row.request_id is distinct from target_request_id
      or receipt_row.terminal_state is distinct from 'completed' then
      return jsonb_build_object('outcome','identity_mismatch');
    end if;
    return receipt_row.response;
  end if;
  if not private.stream_try_parent_lock('profile',auth.uid()::text) then
    return jsonb_build_object('outcome','profile_busy');
  end if;
  select operation.* into operation_row from public.stream_media_operations operation
  where operation.id = target_operation_id and operation.operation_kind='upload'
    and operation.source_kind='video' and operation.actor_id=auth.uid()
    and operation.owner_id=auth.uid() for update;
  if not found then return jsonb_build_object('outcome','operation_unavailable'); end if;
  select state.* into state_row from public.stream_media_operation_states state
  where state.operation_id = target_operation_id for update;
  if not private.stream_app_role_eligible(auth.uid(),'video')
    or private.stream_account_is_tombstoned(auth.uid()) then
    return jsonb_build_object('outcome','posting_rights_revoked');
  end if;
  select context.* into context_row from public.stream_media_upload_contexts context
  where context.intent_id=operation_row.intent_id;
  select intent.* into intent_row from public.stream_media_upload_intents intent
  where intent.id=operation_row.intent_id;
  select request_row.* into library_request_row from public.stream_media_library_requests request_row
  where request_row.operation_id=target_operation_id;
  select asset.* into asset_row from public.stream_media_assets asset
  where asset.upload_intent_id=operation_row.intent_id and asset.registry_id=operation_row.registry_id;
  select transport.* into transport_row from public.stream_media_upload_transport transport
  where transport.operation_id=target_operation_id;
  if context_row.intent_id is null or intent_row.id is null or library_request_row.operation_id is null
    or library_request_row.actor_id<>auth.uid()
    or operation_row.source_identity<>library_request_row.video_id::text
    or context_row.parent_kind<>'profile' or context_row.parent_identity<>auth.uid()::text
    or context_row.owner_id<>auth.uid() or operation_row.expected_source_revision<>context_row.source_revision
    or asset_row.id is null or transport_row.provider_uid is distinct from asset_row.raw_provider_uid
    or transport_row.request_marker is distinct from intent_row.request_marker then
    return jsonb_build_object('outcome','upload_not_ready');
  end if;
  select observation.* into observation_row from public.stream_media_upload_observations observation
  join public.stream_media_upload_observation_clocks observation_clock
    on observation_clock.observation_id=observation.id
  where observation.operation_id=target_operation_id and observation.registry_id=operation_row.registry_id
    and observation.raw_provider_uid=asset_row.raw_provider_uid
    and observation.observation_kind='exact_uid_get'
  order by observation_clock.order_sequence desc limit 1;
  if state_row.operation_id is null or state_row.operation_state<>'provisional_bound' or observation_row.id is null
    or observation_row.http_status is distinct from 200
    or observation_row.signed_urls_reported is distinct from true
    or observation_row.creator_marker_matched is distinct from true
    or observation_row.metadata_marker_matched is distinct from true
    or observation_row.ready_to_stream_reported is distinct from true then
    return jsonb_build_object('outcome','upload_not_ready');
  end if;
  commit_digest := private.stream_media_identity_digest(concat_ws('|','stream_library_commit_v1',
    operation_row.operation_digest,observation_row.evidence_digest,library_request_row.request_digest));
  if private.stream_account_is_tombstoned(auth.uid())
    or not private.stream_account_is_verified(operation_row.registry_id)
    or not private.stream_try_uid_lock(operation_row.registry_id,asset_row.raw_provider_uid)
    or not exists (select 1 from public.stream_media_parent_fences fence
      where fence.source_kind='profile' and fence.source_identity=auth.uid()::text
        and fence.owner_id=auth.uid() and fence.source_revision=context_row.source_revision
        and fence.active_operation_id=target_operation_id and fence.fence_state='closing')
    or private.stream_legacy_uid_unresolved(operation_row.registry_id,asset_row.raw_provider_uid) then
    return jsonb_build_object('outcome','source_stale_or_uid_conflict');
  end if;
  select binding.* into binding_row from public.stream_media_source_bindings binding
  where binding.asset_id=asset_row.id and binding.registry_id=operation_row.registry_id
    and binding.raw_provider_uid=asset_row.raw_provider_uid
    and binding.source_kind='video' and binding.source_identity=library_request_row.video_id::text
    and binding.binding_state='provisional_bound' and binding.owner_id=auth.uid();
  if binding_row.id is null or not asset_row.signed_urls_verified
    or not asset_row.ready_to_stream_verified or asset_row.lifecycle_state<>'provisional_bound'
    or exists (select 1 from public.videos video where video.id=library_request_row.video_id) then
    return jsonb_build_object('outcome','provisional_binding_missing');
  end if;
  if exists (select 1 from public.stream_media_source_bindings other_binding
    where other_binding.registry_id=operation_row.registry_id
      and other_binding.raw_provider_uid=asset_row.raw_provider_uid
      and other_binding.id<>binding_row.id
      and other_binding.binding_state in ('legacy_unverified','provisional_bound','ready_for_publication','active','retained','quarantined')) then
    return jsonb_build_object('outcome','source_stale_or_uid_conflict');
  end if;
  perform set_config('app.stream_media_operation_id',target_operation_id::text,true);
  insert into public.videos(
    id,coach_id,cloudflare_uid,title,description,status,visibility,stream_provider_account_registry_id
  ) values (
    library_request_row.video_id,auth.uid(),asset_row.raw_provider_uid,
    library_request_row.title,library_request_row.description,'uploading','private',operation_row.registry_id
  );
  update public.stream_media_assets set lifecycle_state='ready_for_publication',
    asset_revision=asset_revision+1,observed_at=now(),evidence_digest=commit_digest
  where id=asset_row.id returning * into asset_row;
  update public.stream_media_source_bindings as committed_binding set binding_state='ready_for_publication',
    source_revision=committed_binding.source_revision+1,state_revision=committed_binding.state_revision+1,
    updated_at=now(),evidence_digest=commit_digest
  where committed_binding.id=binding_row.id returning * into binding_row;
  insert into public.stream_media_asset_events(asset_id,event_kind,asset_revision,request_id,evidence_digest)
  values (asset_row.id,'ready_readback',asset_row.asset_revision,target_request_id,commit_digest);
  insert into public.stream_media_source_binding_events(binding_id,event_kind,source_revision,request_id,evidence_digest)
  values (binding_row.id,'attached',binding_row.source_revision,target_request_id,commit_digest);
  next_revision := private.stream_advance_operation(target_operation_id,'ready_for_publication',
    target_request_id,commit_digest);
  update public.videos set status='ready'
  where id=library_request_row.video_id and coach_id=auth.uid()
    and cloudflare_uid=asset_row.raw_provider_uid
    and stream_provider_account_registry_id=operation_row.registry_id;
  if not found then raise exception 'Library source changed during commit' using errcode = '40001'; end if;
  completion_request_id := private.stream_media_request_uuid(target_operation_id::text||':'||target_request_id::text||':upload-completed');
  perform private.stream_advance_operation(target_operation_id,'completed',completion_request_id,commit_digest);
  update public.stream_media_parent_fences as committed_fence set fence_state='open',active_operation_id=null,
    source_revision=committed_fence.source_revision+1,state_revision=committed_fence.state_revision+1,updated_at=now()
  where committed_fence.source_kind='profile' and committed_fence.source_identity=auth.uid()::text
    and committed_fence.owner_id=auth.uid() and committed_fence.source_revision=context_row.source_revision
    and committed_fence.active_operation_id=target_operation_id and committed_fence.fence_state='closing';
  if not found then raise exception 'Library profile fence changed during commit' using errcode = '40001'; end if;
  final_response := jsonb_build_object('outcome','ready_for_publication','operation_revision',next_revision,
    'video_id',library_request_row.video_id,'source_revision',context_row.source_revision+1);
  insert into public.stream_media_finalization_receipts(
    operation_id,request_id,request_digest,terminal_state,response
  ) values (target_operation_id,target_request_id,commit_digest,'completed',final_response);
  return final_response;
exception when unique_violation then
  return jsonb_build_object('outcome','identity_mismatch');
end;
$$;
revoke all on function public.commit_stream_library_video_upload(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_stream_library_video_upload(uuid,uuid) to authenticated;

create table public.stream_community_video_submissions (
  id uuid primary key,
  request_id uuid not null unique,
  post_id uuid not null unique,
  media_id uuid not null unique,
  actor_id uuid not null,
  intended_kind text not null check (intended_kind in (
    'general','workout','nutrition','motivation','achievement','progress','challenge','announcement')),
  intended_audience text not null check (intended_audience in ('everyone','coach_community','only_me')),
  intended_coach_id uuid,
  intended_body text not null check (char_length(intended_body) <= 5000),
  file_digest text not null check (file_digest ~ '^[0-9a-f]{64}$'),
  body_digest text not null check (body_digest ~ '^[0-9a-f]{64}$'),
  intent_id uuid not null unique references public.stream_media_upload_intents(id) on delete restrict,
  operation_id uuid not null unique references public.stream_media_operations(id) on delete restrict,
  submission_state text not null check (submission_state in ('processing','published','canceled')),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  check ((intended_audience = 'coach_community') = (intended_coach_id is not null)),
  check ((submission_state = 'published') = (published_at is not null))
);
create table public.stream_community_publication_receipts (
  submission_id uuid primary key references public.stream_community_video_submissions(id) on delete restrict,
  request_id uuid not null unique,
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  post_id uuid not null,
  media_id uuid not null,
  operation_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.stream_community_video_submissions enable row level security;
alter table public.stream_community_publication_receipts enable row level security;
revoke all on public.stream_community_video_submissions,
  public.stream_community_publication_receipts from public,anon,authenticated,service_role;
create trigger stream_community_publication_receipts_immutable
before update or delete on public.stream_community_publication_receipts
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();

create function private.guard_stream_community_video_submission()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  selected_id uuid;
begin
  if tg_op='INSERT' then return new; end if;
  if tg_op='DELETE' then
    raise exception 'Community video submission evidence is immutable' using errcode='55000';
  end if;
  begin
    selected_id := nullif(current_setting('app.stream_community_submission_id',true),'')::uuid;
  exception when invalid_text_representation then
    selected_id := null;
  end;
  if selected_id is distinct from old.id or old.submission_state<>'processing'
    or new.submission_state<>'published' or new.published_at is null
    or (to_jsonb(new) - array['submission_state','published_at']) <>
       (to_jsonb(old) - array['submission_state','published_at']) then
    raise exception 'Only the atomic publication RPC can finish a submission' using errcode='55000';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_stream_community_video_submission() from public,anon,authenticated,service_role;
create trigger stream_community_video_submission_guard
before update or delete on public.stream_community_video_submissions
for each row execute function private.guard_stream_community_video_submission();

create function private.guard_stream_community_submission()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  submission public.stream_community_video_submissions%rowtype;
  selected_id uuid;
  selected_request_id uuid;
  exact_publish_receipt boolean := false;
begin
  if tg_op = 'INSERT' then
    return new;
  end if;
  begin
    selected_id := nullif(current_setting('app.stream_community_submission_id',true),'')::uuid;
  exception when invalid_text_representation then
    selected_id := null;
  end;
  begin
    selected_request_id := nullif(current_setting('app.stream_community_publication_request_id',true),'')::uuid;
  exception when invalid_text_representation then
    selected_request_id := null;
  end;
  select item.* into submission from public.stream_community_video_submissions item
  where item.post_id = old.id;
  if not found or submission.submission_state <> 'processing' then
    return new;
  end if;
  if new.body is distinct from old.body or new.removed_at is distinct from old.removed_at then
    raise exception 'A processing media post is immutable until publication' using errcode = '55000';
  end if;
  if new.kind is distinct from old.kind or new.audience is distinct from old.audience
    or new.coach_id is distinct from old.coach_id then
    select exists (
      select 1 from public.stream_community_publication_receipts receipt
      where receipt.submission_id=submission.id and receipt.operation_id=submission.operation_id
        and receipt.request_id=selected_request_id and receipt.post_id=old.id
        and receipt.media_id=submission.media_id
        and old.kind='general' and old.audience='only_me' and old.coach_id is null
        and old.body=submission.intended_body
        and new.kind=submission.intended_kind and new.audience=submission.intended_audience
        and new.coach_id is not distinct from submission.intended_coach_id
    ) into exact_publish_receipt;
    if selected_id is distinct from submission.id or not coalesce(exact_publish_receipt,false) then
      raise exception 'Only an immutable, validated publication receipt can publish its post' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_stream_community_submission() from public,anon,authenticated,service_role;
create trigger posts_stream_community_submission_guard
before update on public.posts for each row execute function private.guard_stream_community_submission();

create function public.prepare_stream_community_video_submission(
  target_request_id uuid,target_body text,target_file_digest text,target_kind text,
  target_audience text,target_coach_id uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  registry_id uuid;
  submission_id uuid;
  post_id uuid;
  media_id uuid;
  intent_id uuid;
  operation_id uuid;
  marker_id uuid;
  operation_digest text;
  body_digest text;
  metadata jsonb;
  parent_fence public.stream_media_parent_fences%rowtype;
  existing public.stream_community_video_submissions%rowtype;
  state_value text;
  intent_request_id uuid;
  operation_request_id uuid;
  context_request_id uuid;
  transport_request_id uuid;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null then
    raise exception 'A signed-in account is required' using errcode = '42501';
  end if;
  if target_request_id is null or target_body is null or char_length(target_body)>5000
    or target_file_digest is null or target_file_digest !~ '^[0-9a-f]{64}$'
    or target_kind is null
    or target_kind not in ('general','workout','nutrition','motivation','achievement','progress','challenge','announcement')
    or target_audience is null
    or target_audience not in ('everyone','coach_community','only_me')
    or ((target_audience='coach_community') <> (target_coach_id is not null)) then
    raise exception 'Community video submission is invalid' using errcode = '22023';
  end if;
  perform private.stream_require_read_committed();
  perform private.stream_lock_accounts(case when target_coach_id is null
    then array[actor_id] else array[actor_id,target_coach_id] end);
  if not private.stream_app_role_eligible(actor_id,'post_media')
    or private.stream_account_is_tombstoned(actor_id)
    or (target_coach_id is not null and private.stream_account_is_tombstoned(target_coach_id)) then
    return jsonb_build_object('outcome','not_eligible');
  end if;
  if not private.can_write_post(actor_id,target_kind,target_audience,target_coach_id) then
    return jsonb_build_object('outcome','posting_rights_revoked');
  end if;
  body_digest := private.stream_media_identity_digest(concat_ws('|','community_video_body_v1',target_body,target_file_digest));
  submission_id := private.stream_media_request_uuid(target_request_id::text||':community-submission');
  post_id := private.stream_media_request_uuid(target_request_id::text||':community-post');
  media_id := private.stream_media_request_uuid(target_request_id::text||':community-media');
  intent_id := private.stream_media_request_uuid(target_request_id::text||':community-intent');
  operation_id := private.stream_media_request_uuid(target_request_id::text||':community-operation');
  marker_id := private.stream_media_request_uuid(target_request_id::text||':community-marker');
  intent_request_id := private.stream_media_request_uuid(target_request_id::text||':community-intent-request');
  operation_request_id := private.stream_media_request_uuid(target_request_id::text||':community-operation-request');
  context_request_id := private.stream_media_request_uuid(target_request_id::text||':community-context');
  transport_request_id := private.stream_media_request_uuid(target_request_id::text||':community-transport');
  operation_digest := private.stream_media_identity_digest(concat_ws('|',
    'stream_community_submission_v1',body_digest,submission_id::text,post_id::text,media_id::text,
    actor_id::text,target_kind,target_audience,coalesce(target_coach_id::text,''),marker_id::text,
    'vod_primary','600','true'));
  metadata := jsonb_build_object('request_marker',marker_id::text,
    'source_kind','post_media','source_id',media_id::text,'actor_id',actor_id::text);

  if not private.stream_try_parent_lock('post',post_id::text) then
    return jsonb_build_object('outcome','post_busy');
  end if;
  select registry.id into registry_id from public.stream_provider_account_registry registry
  where registry.credential_slot='vod_primary';
  if registry_id is null or not private.stream_account_is_verified(registry_id) then
    return jsonb_build_object('outcome','account_unverified');
  end if;
  select submission.* into existing from public.stream_community_video_submissions submission
  where submission.request_id=target_request_id or submission.id=submission_id for update;
  if found then
    if existing.id<>submission_id or existing.actor_id<>actor_id or existing.post_id<>post_id
      or existing.media_id<>media_id or existing.intended_kind<>target_kind
      or existing.intended_audience<>target_audience
      or existing.intended_coach_id is distinct from target_coach_id
      or existing.intended_body<>target_body or existing.file_digest<>target_file_digest
      or existing.body_digest<>body_digest then
      return jsonb_build_object('outcome','identity_mismatch');
    end if;
    select state.operation_state into state_value from public.stream_media_operation_states state
    where state.operation_id=existing.operation_id;
    return jsonb_build_object('outcome','same_submission','submission_id',existing.id,
      'operation_id',existing.operation_id,'operation_state',state_value,'post_id',existing.post_id);
  end if;
  if exists (select 1 from public.posts post where post.id=post_id)
    or exists (select 1 from public.post_media media where media.id=media_id) then
    return jsonb_build_object('outcome','source_identity_in_use');
  end if;
  insert into public.stream_media_parent_fences(source_kind,source_identity,owner_id,source_revision)
  values ('post',post_id::text,actor_id,1) on conflict (source_kind,source_identity) do nothing;
  select fence.* into parent_fence from public.stream_media_parent_fences fence
  where fence.source_kind='post' and fence.source_identity=post_id::text for update;
  if parent_fence.owner_id is distinct from actor_id or parent_fence.fence_state<>'open'
    or parent_fence.active_operation_id is not null then
    return jsonb_build_object('outcome','post_busy');
  end if;
  insert into public.posts(id,author_id,kind,body,audience,coach_id)
  values (post_id,actor_id,'general',target_body,'only_me',null);
  insert into public.stream_media_upload_intents(
    id,request_id,actor_id,purpose,source_kind,source_id,parent_revision,
    provider_account_registry_id,request_marker,payload_digest
  ) values (
    intent_id,intent_request_id,actor_id,'community_video','post_media',media_id,
    parent_fence.source_revision,registry_id,marker_id,operation_digest
  );
  insert into public.stream_media_upload_contexts(
    intent_id,parent_kind,parent_identity,owner_id,source_revision,context_digest,request_id
  ) values (
    intent_id,'post',post_id::text,actor_id,parent_fence.source_revision,
    private.stream_media_identity_digest(concat_ws('|','post',post_id::text,actor_id::text,
      parent_fence.source_revision::text,intent_id::text)),context_request_id
  );
  insert into public.stream_media_upload_account_edges(intent_id,account_id,relation_kind,request_id)
  values(intent_id,actor_id,'actor',context_request_id),(intent_id,actor_id,'source_owner',context_request_id);
  insert into public.stream_media_operations(
    id,request_id,operation_kind,actor_id,owner_id,source_kind,source_identity,
    parent_kind,parent_identity,expected_source_revision,registry_id,intent_id,operation_digest
  ) values (
    operation_id,operation_request_id,'upload',actor_id,actor_id,'post_media',media_id::text,
    'post',post_id::text,parent_fence.source_revision,registry_id,intent_id,operation_digest
  );
  insert into public.stream_media_operation_states(operation_id,operation_state)
  values(operation_id,'reserved');
  insert into public.stream_media_operation_events(operation_id,sequence_number,from_state,to_state,request_id,evidence_digest)
  values(operation_id,1,null,'reserved',operation_request_id,operation_digest);
  insert into public.stream_community_video_submissions(
    id,request_id,post_id,media_id,actor_id,intended_kind,intended_audience,intended_coach_id,
    intended_body,file_digest,body_digest,intent_id,operation_id,submission_state
  ) values (
    submission_id,target_request_id,post_id,media_id,actor_id,target_kind,target_audience,target_coach_id,
    target_body,target_file_digest,body_digest,intent_id,operation_id,'processing'
  );
  insert into public.stream_media_upload_transport(
    operation_id,request_id,request_digest,registry_id,request_marker,
    original_max_duration_seconds,original_require_signed_urls,original_metadata
  ) values (operation_id,transport_request_id,operation_digest,registry_id,marker_id,600,true,metadata);
  update public.stream_media_parent_fences as community_fence_update
  set fence_state='closing',active_operation_id=operation_id,
    state_revision=community_fence_update.state_revision+1,updated_at=now()
  where community_fence_update.source_kind='post' and community_fence_update.source_identity=post_id::text
    and community_fence_update.owner_id=actor_id
    and community_fence_update.source_revision=parent_fence.source_revision
    and community_fence_update.fence_state='open';
  if not found then raise exception 'Community post fence changed' using errcode='40001'; end if;
  return jsonb_build_object('outcome','processing','submission_id',submission_id,
    'post_id',post_id,'media_id',media_id,'operation_id',operation_id,
    'operation_state','reserved','request_digest',operation_digest,
    'transport_request_id',transport_request_id,'max_duration_seconds',600,
    'require_signed_urls',true,'metadata',metadata);
exception when unique_violation then
  return jsonb_build_object('outcome','identity_mismatch');
end;
$$;
revoke all on function public.prepare_stream_community_video_submission(uuid,text,text,text,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.prepare_stream_community_video_submission(uuid,text,text,text,text,uuid)
  to authenticated;

create function public.publish_stream_community_video_submission(
  target_submission_id uuid,target_request_id uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  submission public.stream_community_video_submissions%rowtype;
  operation_row public.stream_media_operations%rowtype;
  intent_row public.stream_media_upload_intents%rowtype;
  context_row public.stream_media_upload_contexts%rowtype;
  state_row public.stream_media_operation_states%rowtype;
  asset_row public.stream_media_assets%rowtype;
  binding_row public.stream_media_source_bindings%rowtype;
  transport_row public.stream_media_upload_transport%rowtype;
  observation_row public.stream_media_upload_observations%rowtype;
  publication_receipt public.stream_community_publication_receipts%rowtype;
  finalization_receipt public.stream_media_finalization_receipts%rowtype;
  post_row public.posts%rowtype;
  publication_digest text;
  next_revision bigint;
  completed_request uuid;
  response jsonb;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null then
    raise exception 'A signed-in post author is required' using errcode = '42501';
  end if;
  if target_submission_id is null or target_request_id is null then
    raise exception 'Community publication request is invalid' using errcode='22023';
  end if;
  perform private.stream_require_read_committed();
  select item.* into submission from public.stream_community_video_submissions item
  where item.id=target_submission_id and item.actor_id=auth.uid();
  if not found then return jsonb_build_object('outcome','submission_unavailable'); end if;
  perform private.stream_lock_accounts(case when submission.intended_coach_id is null
    then array[auth.uid()] else array[auth.uid(),submission.intended_coach_id] end);
  select item.* into submission from public.stream_community_video_submissions item
  where item.id=target_submission_id and item.actor_id=auth.uid() for update;
  if not found then return jsonb_build_object('outcome','submission_unavailable'); end if;
  if exists (select 1 from public.stream_community_publication_receipts receipt
      where (receipt.submission_id=target_submission_id and receipt.request_id<>target_request_id)
        or (receipt.request_id=target_request_id and receipt.submission_id<>target_submission_id)) then
    return jsonb_build_object('outcome','identity_mismatch');
  end if;
  select receipt.* into publication_receipt from public.stream_community_publication_receipts receipt
  where receipt.submission_id=target_submission_id and receipt.request_id=target_request_id for update;
  if found then
    if publication_receipt.submission_id is distinct from target_submission_id
      or publication_receipt.request_id is distinct from target_request_id
      or publication_receipt.post_id is distinct from submission.post_id
      or publication_receipt.media_id is distinct from submission.media_id
      or publication_receipt.operation_id is distinct from submission.operation_id then
      return jsonb_build_object('outcome','identity_mismatch');
    end if;
    return jsonb_build_object('outcome','published','post_id',publication_receipt.post_id,
      'media_id',publication_receipt.media_id,'replayed',true);
  end if;
  if not private.stream_try_parent_lock('post',submission.post_id::text) then
    return jsonb_build_object('outcome','post_busy');
  end if;
  select item.* into submission from public.stream_community_video_submissions item
  where item.id=target_submission_id and item.actor_id=auth.uid() for update;
  if not found then return jsonb_build_object('outcome','submission_unavailable'); end if;
  select operation.* into operation_row from public.stream_media_operations operation
  where operation.id=submission.operation_id and operation.operation_kind='upload';
  select intent.* into intent_row from public.stream_media_upload_intents intent
  where intent.id=submission.intent_id;
  select context.* into context_row from public.stream_media_upload_contexts context
  where context.intent_id=submission.intent_id;
  select asset.* into asset_row from public.stream_media_assets asset
  where asset.upload_intent_id=submission.intent_id and asset.registry_id=operation_row.registry_id;
  select transport.* into transport_row from public.stream_media_upload_transport transport
  where transport.operation_id=submission.operation_id;
  select observation.* into observation_row from public.stream_media_upload_observations observation
  join public.stream_media_upload_observation_clocks observation_clock
    on observation_clock.observation_id=observation.id
  where observation.operation_id=submission.operation_id and observation.registry_id=operation_row.registry_id
    and observation.raw_provider_uid=asset_row.raw_provider_uid
    and observation.observation_kind='exact_uid_get'
  order by observation_clock.order_sequence desc limit 1;
  if operation_row.id is null or intent_row.id is null or context_row.intent_id is null
    or operation_row.actor_id<>auth.uid() or operation_row.owner_id<>auth.uid()
    or operation_row.source_kind<>'post_media' or operation_row.source_identity<>submission.media_id::text
    or context_row.parent_kind<>'post' or context_row.parent_identity<>submission.post_id::text
    or context_row.owner_id<>auth.uid() or intent_row.source_kind<>'post_media'
    or intent_row.source_id<>submission.media_id or intent_row.actor_id<>auth.uid()
    or asset_row.id is null or transport_row.provider_uid is distinct from asset_row.raw_provider_uid
    or transport_row.request_marker is distinct from intent_row.request_marker
    or observation_row.id is null then
    return jsonb_build_object('outcome','upload_not_ready');
  end if;
  if observation_row.http_status is distinct from 200
    or observation_row.signed_urls_reported is distinct from true
    or observation_row.creator_marker_matched is distinct from true
    or observation_row.metadata_marker_matched is distinct from true
    or observation_row.ready_to_stream_reported is distinct from true then
    return jsonb_build_object('outcome','upload_not_ready');
  end if;
  publication_digest := private.stream_media_identity_digest(concat_ws('|',
    'stream_community_publication_v1',submission.id::text,submission.body_digest,
    operation_row.operation_digest,observation_row.evidence_digest,
    submission.intended_kind,submission.intended_audience,coalesce(submission.intended_coach_id::text,'')));
  if submission.submission_state<>'processing'
    or private.stream_account_is_tombstoned(auth.uid())
    or not private.stream_account_is_verified(operation_row.registry_id)
    or not private.stream_app_role_eligible(auth.uid(),'post_media') then
    return jsonb_build_object('outcome','posting_rights_revoked');
  end if;
  select post.* into post_row from public.posts post
  where post.id=submission.post_id and post.author_id=auth.uid() and post.removed_at is null for update;
  if not found or post_row.kind<>'general' or post_row.body<>submission.intended_body
    or post_row.audience<>'only_me' or post_row.coach_id is not null
    or private.stream_media_identity_digest(concat_ws('|','community_video_body_v1',
      submission.intended_body,submission.file_digest))<>submission.body_digest then
    return jsonb_build_object('outcome','parent_removed_or_changed');
  end if;
  if not private.can_write_post(auth.uid(),submission.intended_kind,
      submission.intended_audience,submission.intended_coach_id) then
    return jsonb_build_object('outcome','posting_rights_revoked');
  end if;
  select state.* into state_row from public.stream_media_operation_states state
  where state.operation_id=operation_row.id for update;
  if state_row.operation_state<>'provisional_bound'
    or context_row.source_revision<>operation_row.expected_source_revision
    or asset_row.lifecycle_state<>'provisional_bound'
    or not asset_row.signed_urls_verified or not asset_row.ready_to_stream_verified
    or not private.stream_try_uid_lock(operation_row.registry_id,asset_row.raw_provider_uid)
    or private.stream_legacy_uid_unresolved(operation_row.registry_id,asset_row.raw_provider_uid)
    or not exists (select 1 from public.stream_media_parent_fences fence
      where fence.source_kind='post' and fence.source_identity=submission.post_id::text
        and fence.owner_id=auth.uid() and fence.source_revision=context_row.source_revision
        and fence.active_operation_id=operation_row.id and fence.fence_state='closing') then
    return jsonb_build_object('outcome','source_stale_or_uid_conflict');
  end if;
  select binding.* into binding_row from public.stream_media_source_bindings binding
  where binding.asset_id=asset_row.id and binding.registry_id=operation_row.registry_id
    and binding.raw_provider_uid=asset_row.raw_provider_uid
    and binding.source_kind='post_media' and binding.source_identity=submission.media_id::text
    and binding.owner_id=auth.uid() and binding.parent_kind='post'
    and binding.parent_identity=submission.post_id::text and binding.binding_state='provisional_bound';
  if binding_row.id is null or exists (select 1 from public.stream_media_source_bindings other_binding
    where other_binding.registry_id=operation_row.registry_id
      and other_binding.raw_provider_uid=asset_row.raw_provider_uid
      and other_binding.id<>binding_row.id
      and other_binding.binding_state in ('legacy_unverified','provisional_bound','ready_for_publication','active','retained','quarantined')) then
    return jsonb_build_object('outcome','provisional_binding_missing');
  end if;
  perform set_config('app.stream_media_operation_id',operation_row.id::text,true);
  insert into public.post_media(id,post_id,kind,video_uid,position)
  values(submission.media_id,submission.post_id,'video',asset_row.raw_provider_uid,0);
  if not private.stream_upload_source_exists('post_media',submission.media_id::text,auth.uid(),
      operation_row.registry_id,asset_row.raw_provider_uid) then
    raise exception 'Community video row did not match its exact provisional source binding' using errcode='23514';
  end if;
  perform set_config('app.stream_community_submission_id',submission.id::text,true);
  perform set_config('app.stream_community_publication_request_id',target_request_id::text,true);
  insert into public.stream_community_publication_receipts(
    submission_id,request_id,request_digest,post_id,media_id,operation_id
  ) values(submission.id,target_request_id,publication_digest,submission.post_id,submission.media_id,operation_row.id);
  update public.posts set kind=submission.intended_kind,audience=submission.intended_audience,
    coach_id=submission.intended_coach_id
  where id=submission.post_id and author_id=auth.uid() and removed_at is null;
  if not found then raise exception 'Community parent changed during publication' using errcode='40001'; end if;
  update public.stream_media_assets set lifecycle_state='ready_for_publication',
    asset_revision=asset_revision+1,observed_at=now(),evidence_digest=publication_digest
  where id=asset_row.id returning * into asset_row;
  update public.stream_media_source_bindings as published_binding set binding_state='ready_for_publication',
    source_revision=published_binding.source_revision+1,state_revision=published_binding.state_revision+1,
    updated_at=now(),evidence_digest=publication_digest
  where published_binding.id=binding_row.id returning * into binding_row;
  insert into public.stream_media_asset_events(asset_id,event_kind,asset_revision,request_id,evidence_digest)
  values(asset_row.id,'ready_readback',asset_row.asset_revision,target_request_id,publication_digest);
  insert into public.stream_media_source_binding_events(binding_id,event_kind,source_revision,request_id,evidence_digest)
  values(binding_row.id,'attached',binding_row.source_revision,target_request_id,publication_digest);
  next_revision := private.stream_advance_operation(operation_row.id,'ready_for_publication',
    target_request_id,publication_digest);
  completed_request := private.stream_media_request_uuid(operation_row.id::text||':'||target_request_id::text||':upload-completed');
  perform private.stream_advance_operation(operation_row.id,'completed',completed_request,publication_digest);
  update public.stream_media_parent_fences as published_fence set fence_state='open',active_operation_id=null,
    source_revision=published_fence.source_revision+1,state_revision=published_fence.state_revision+1,updated_at=now()
  where published_fence.source_kind='post' and published_fence.source_identity=submission.post_id::text
    and published_fence.owner_id=auth.uid() and published_fence.source_revision=context_row.source_revision
    and published_fence.active_operation_id=operation_row.id and published_fence.fence_state='closing';
  if not found then raise exception 'Community post fence changed during publication' using errcode='40001'; end if;
  update public.stream_community_video_submissions set submission_state='published',published_at=now()
  where id=submission.id and submission_state='processing';
  if not found then raise exception 'Community submission changed during publication' using errcode='40001'; end if;
  response := jsonb_build_object('outcome','published','post_id',submission.post_id,
    'media_id',submission.media_id,'operation_revision',next_revision,'source_revision',context_row.source_revision+1);
  insert into public.stream_media_finalization_receipts(
    operation_id,request_id,request_digest,terminal_state,response
  ) values(operation_row.id,target_request_id,publication_digest,'completed',response);
  return response;
exception when unique_violation then
  return jsonb_build_object('outcome','identity_mismatch');
end;
$$;
revoke all on function public.publish_stream_community_video_submission(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.publish_stream_community_video_submission(uuid,uuid) to authenticated;

-- Caller-specific playback lookups return a checked source tuple, never a provider URL,
-- TUS capability, or generic actor-to-UID query. The future server signer owns URL creation.
create function private.stream_record_guarded_context_binding_event(
  target_source_kind text,target_source_identity text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  expected_owner_id uuid;
  expected_parent_kind text;
  expected_parent_identity text;
  expected_video_id uuid;
  expected_uid text;
  video_row public.videos%rowtype;
  binding_row public.stream_media_source_bindings%rowtype;
  asset_row public.stream_media_assets%rowtype;
  fence_row public.stream_media_parent_fences%rowtype;
  event_request_id uuid;
begin
  if target_source_kind='program_intro' then
    select program.coach_id,'program',program.id::text,program.intro_video_id
      into expected_owner_id,expected_parent_kind,expected_parent_identity,expected_video_id
    from public.programs program where program.id::text=target_source_identity
      and program.intro_video_id is not null;
  elsif target_source_kind='program_lesson' then
    select lesson.video_creator_id,'program',lesson.program_id::text,lesson.video_id,lesson.cloudflare_uid
      into expected_owner_id,expected_parent_kind,expected_parent_identity,expected_video_id,expected_uid
    from public.program_content_version_lessons lesson
    join public.programs program on program.id=lesson.program_id
    where lesson.id::text=target_source_identity and lesson.video_id is not null
      and lesson.video_creator_id=program.coach_id;
  elsif target_source_kind='daily_content_slot' then
    select item.owner_id,'daily_content_item',item.id::text,revision.video_id
      into expected_owner_id,expected_parent_kind,expected_parent_identity,expected_video_id
    from public.daily_content_slots slot
    join public.daily_content_revisions revision on revision.id=slot.revision_id
      and revision.item_id=slot.item_id and revision.kind='video'
    join public.daily_content_items item on item.id=slot.item_id and item.kind='video'
      and item.status='active'
    where slot.id::text=target_source_identity and slot.content_kind='video'
      and slot.status in ('scheduled','published');
  elsif target_source_kind='daily_fuel_assignment' then
    select assignment.coach_id,'daily_fuel_assignment',assignment.id::text,assignment.video_id
      into expected_owner_id,expected_parent_kind,expected_parent_identity,expected_video_id
    from public.member_daily_fuel_assignments assignment
    where assignment.id::text=target_source_identity and assignment.video_id is not null
      and exists (select 1 from public.coach_members member_link
        where member_link.coach_id=assignment.coach_id and member_link.member_id=assignment.member_id);
  elsif target_source_kind='daily_fuel_bookmark' then
    select bookmark.member_id,'profile',bookmark.member_id::text,bookmark.video_id
      into expected_owner_id,expected_parent_kind,expected_parent_identity,expected_video_id
    from public.member_daily_fuel_bookmarks bookmark
    where bookmark.member_id::text||':'||bookmark.video_id::text=target_source_identity
      and exists (select 1 from public.videos bookmarked_video
        join public.coach_members member_link on member_link.coach_id=bookmarked_video.coach_id
          and member_link.member_id=bookmark.member_id
        where bookmarked_video.id=bookmark.video_id);
  else
    return;
  end if;
  if expected_owner_id is null or expected_video_id is null then return; end if;
  select video.* into video_row from public.videos video
  where video.id=expected_video_id and video.status::text='ready'
    and not video.daily_content_deletion_pending
    and video.stream_provider_account_registry_id is not null and video.cloudflare_uid is not null
    and (target_source_kind='daily_fuel_bookmark' or video.coach_id=expected_owner_id)
    and (expected_uid is null or video.cloudflare_uid=expected_uid);
  if not found then return; end if;
  expected_uid:=video_row.cloudflare_uid;
  select fence.* into fence_row from public.stream_media_parent_fences fence
  where fence.source_kind=expected_parent_kind and fence.source_identity=expected_parent_identity
    and fence.fence_state='open' and fence.active_operation_id is null;
  if not found then return; end if;
  select binding.* into binding_row from public.stream_media_source_bindings binding
  where binding.source_kind=target_source_kind and binding.source_identity=target_source_identity
    and binding.owner_id=expected_owner_id and binding.parent_kind=expected_parent_kind
    and binding.parent_identity=expected_parent_identity and binding.registry_id=video_row.stream_provider_account_registry_id
    and binding.raw_provider_uid=expected_uid and binding.binding_state='active'
    and binding.source_revision<=fence_row.source_revision
    and binding.evidence_digest=private.stream_media_identity_digest(concat_ws('|',
      binding.source_kind,binding.source_identity,binding.raw_provider_uid,binding.registry_id::text))
  order by binding.source_revision desc limit 2;
  if not found or (select count(*) from public.stream_media_source_bindings binding
      where binding.source_kind=target_source_kind and binding.source_identity=target_source_identity
        and binding.owner_id=expected_owner_id and binding.parent_kind=expected_parent_kind
        and binding.parent_identity=expected_parent_identity
        and binding.registry_id=video_row.stream_provider_account_registry_id
        and binding.raw_provider_uid=expected_uid and binding.binding_state='active'
        and binding.evidence_digest=private.stream_media_identity_digest(concat_ws('|',
          binding.source_kind,binding.source_identity,binding.raw_provider_uid,binding.registry_id::text)))<>1 then
    return;
  end if;
  select asset.* into asset_row from public.stream_media_assets asset
  where asset.id=binding_row.asset_id and asset.registry_id=binding_row.registry_id
    and asset.raw_provider_uid=binding_row.raw_provider_uid
    and asset.lifecycle_state='ready_for_publication'
    and asset.signed_urls_verified and asset.ready_to_stream_verified;
  if not found or not private.stream_account_is_verified(binding_row.registry_id)
    or private.stream_legacy_uid_unresolved(binding_row.registry_id,binding_row.raw_provider_uid)
    or private.stream_media_uid_reserved(binding_row.registry_id,binding_row.raw_provider_uid) then
    return;
  end if;
  event_request_id:=private.stream_media_request_uuid(binding_row.id::text||':app-context-attached:'||
    binding_row.source_revision::text||':'||binding_row.evidence_digest);
  insert into public.stream_media_source_binding_events(
    binding_id,event_kind,source_revision,request_id,evidence_digest
  ) values(binding_row.id,'attached',binding_row.source_revision,event_request_id,binding_row.evidence_digest)
  on conflict (binding_id,request_id) do nothing;
end;
$$;
revoke all on function private.stream_record_guarded_context_binding_event(text,text)
  from public,anon,authenticated,service_role;

create function private.stream_emit_guarded_context_binding_event()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  row_data jsonb := to_jsonb(new);
  source_identity text;
begin
  if tg_argv[0]='daily_fuel_bookmark' then
    source_identity:=(row_data->>'member_id')||':'||(row_data->>'video_id');
  else
    source_identity:=row_data->>'id';
  end if;
  perform private.stream_record_guarded_context_binding_event(tg_argv[0],source_identity);
  return null;
end;
$$;
revoke all on function private.stream_emit_guarded_context_binding_event()
  from public,anon,authenticated,service_role;

create trigger programs_stream_app_binding_event
after insert or update on public.programs
for each row execute function private.stream_emit_guarded_context_binding_event('program_intro');
create trigger program_lessons_stream_app_binding_event
after insert or update on public.program_content_version_lessons
for each row execute function private.stream_emit_guarded_context_binding_event('program_lesson');
create trigger daily_content_slots_stream_app_binding_event
after insert or update on public.daily_content_slots
for each row execute function private.stream_emit_guarded_context_binding_event('daily_content_slot');
create trigger daily_fuel_assignments_stream_app_binding_event
after insert or update on public.member_daily_fuel_assignments
for each row execute function private.stream_emit_guarded_context_binding_event('daily_fuel_assignment');
create trigger daily_fuel_bookmarks_stream_app_binding_event
after insert or update on public.member_daily_fuel_bookmarks
for each row execute function private.stream_emit_guarded_context_binding_event('daily_fuel_bookmark');

do $$
declare source_row record;
begin
  for source_row in select program.id::text as source_identity from public.programs program
    where program.intro_video_id is not null loop
    perform private.stream_record_guarded_context_binding_event('program_intro',source_row.source_identity);
  end loop;
  for source_row in select lesson.id::text as source_identity
    from public.program_content_version_lessons lesson where lesson.video_id is not null loop
    perform private.stream_record_guarded_context_binding_event('program_lesson',source_row.source_identity);
  end loop;
  for source_row in select slot.id::text as source_identity from public.daily_content_slots slot
    where slot.content_kind='video' and slot.status in ('scheduled','published') loop
    perform private.stream_record_guarded_context_binding_event('daily_content_slot',source_row.source_identity);
  end loop;
  for source_row in select assignment.id::text as source_identity
    from public.member_daily_fuel_assignments assignment where assignment.video_id is not null loop
    perform private.stream_record_guarded_context_binding_event('daily_fuel_assignment',source_row.source_identity);
  end loop;
  for source_row in select bookmark.member_id::text||':'||bookmark.video_id::text as source_identity
    from public.member_daily_fuel_bookmarks bookmark loop
    perform private.stream_record_guarded_context_binding_event('daily_fuel_bookmark',source_row.source_identity);
  end loop;
end;
$$;

create function private.stream_app_video_projection(
  target_source_kind text,target_source_identity text,target_owner_id uuid,target_video_id uuid,
  target_expected_uid text default null
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  video_row public.videos%rowtype;
  media_row public.post_media%rowtype;
  binding_row public.stream_media_source_bindings%rowtype;
  asset_row public.stream_media_assets%rowtype;
  source_registry_id uuid;
  source_uid text;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null
    or private.stream_account_is_tombstoned(auth.uid())
    or target_owner_id is null or private.stream_account_is_tombstoned(target_owner_id)
    or target_source_kind not in ('video','post_media','program_intro','program_lesson',
      'daily_content_slot','daily_fuel_assignment','daily_fuel_bookmark')
    or target_source_identity is null
    or (target_source_kind not in ('post_media','program_lesson') and target_video_id is null)
    or (target_source_kind='post_media' and target_video_id is not null) then
    return jsonb_build_object('outcome','unavailable');
  end if;
  if target_source_kind='post_media' then
    select media.* into media_row from public.post_media media
    join public.posts post on post.id=media.post_id
    where media.id::text=target_source_identity and media.kind='video'
      and post.author_id=target_owner_id and post.removed_at is null and media.video_uid is not null;
    if not found then return jsonb_build_object('outcome','unavailable'); end if;
    source_uid:=media_row.video_uid;
    if target_expected_uid is not null then return jsonb_build_object('outcome','unavailable'); end if;
  elsif target_source_kind='program_lesson' then
    -- Program lessons freeze their UID in the immutable content version. Resolve that exact
    -- context binding instead of substituting a mutable Library row's current UID.
    if target_expected_uid is null or char_length(target_expected_uid) not between 1 and 200 then
      return jsonb_build_object('outcome','unavailable'); end if;
    source_uid:=target_expected_uid;
  else
    select video.* into video_row from public.videos video
    where video.id=target_video_id and video.coach_id=target_owner_id
      and video.status::text='ready' and not video.daily_content_deletion_pending
      and video.stream_provider_account_registry_id is not null and video.cloudflare_uid is not null;
    if not found then return jsonb_build_object('outcome','unavailable'); end if;
    source_registry_id:=video_row.stream_provider_account_registry_id;
    source_uid:=video_row.cloudflare_uid;
    if target_expected_uid is not null then return jsonb_build_object('outcome','unavailable'); end if;
  end if;
  select binding.* into binding_row from public.stream_media_source_bindings binding
  where binding.source_kind=target_source_kind and binding.source_identity=target_source_identity
    and binding.owner_id=target_owner_id
    and (source_registry_id is null or binding.registry_id=source_registry_id)
    and binding.raw_provider_uid=source_uid
    and binding.binding_state in ('ready_for_publication','active','retained')
  order by binding.created_at desc limit 2;
  if not found or (select count(*) from public.stream_media_source_bindings binding
       where binding.source_kind=target_source_kind and binding.source_identity=target_source_identity
        and binding.owner_id=target_owner_id
        and (source_registry_id is null or binding.registry_id=source_registry_id)
        and binding.raw_provider_uid=source_uid
        and binding.binding_state in ('ready_for_publication','active','retained'))<>1 then
    return jsonb_build_object('outcome','unavailable'); end if;
  source_registry_id:=binding_row.registry_id;
  select asset.* into asset_row from public.stream_media_assets asset
  where asset.id=binding_row.asset_id and asset.registry_id=binding_row.registry_id
    and asset.raw_provider_uid=binding_row.raw_provider_uid
    and asset.lifecycle_state='ready_for_publication'
    and asset.signed_urls_verified and asset.ready_to_stream_verified;
  if not found or not private.stream_account_is_verified(binding_row.registry_id)
    or private.stream_legacy_uid_unresolved(binding_row.registry_id,binding_row.raw_provider_uid)
    or private.stream_media_uid_reserved(binding_row.registry_id,binding_row.raw_provider_uid)
    or not exists (select 1 from public.stream_media_source_binding_events event
      where event.binding_id=binding_row.id and event.event_kind='attached'
        and event.source_revision=binding_row.source_revision
        and event.evidence_digest=binding_row.evidence_digest)
    or not exists (select 1 from public.stream_media_parent_fences fence
      where fence.source_kind=binding_row.parent_kind and fence.source_identity=binding_row.parent_identity
        and ((fence.fence_state='open' and fence.active_operation_id is null)
          or (target_source_kind='video' and fence.fence_state='closing'
            and exists (select 1 from public.stream_media_operations active_upload
              join public.stream_media_operation_states active_state on active_state.operation_id=active_upload.id
              where active_upload.id=fence.active_operation_id and active_upload.operation_kind='upload'
                and active_upload.source_kind='video' and active_upload.actor_id=target_owner_id
                and active_upload.owner_id=target_owner_id and active_upload.parent_kind='profile'
                and active_upload.parent_identity=target_owner_id::text
                and active_upload.source_identity<>binding_row.source_identity
                and active_state.operation_state in ('reserved','create_started','create_unknown',
                  'created_unverified','provisional_bound'))))
        and fence.owner_id=case when binding_row.parent_kind='daily_fuel_assignment'
          then (select assignment.member_id from public.member_daily_fuel_assignments assignment
            where assignment.id::text=binding_row.source_identity)
          else binding_row.owner_id end) then
    return jsonb_build_object('outcome','unavailable');
  end if;
  return jsonb_build_object('outcome','ready','video_id',case when target_source_kind='post_media'
      then null else target_video_id end,'media_id',case when target_source_kind='post_media'
      then media_row.id else null end,
    'registry_id',binding_row.registry_id,'provider_uid',binding_row.raw_provider_uid,
    'source_kind',target_source_kind,'source_identity',target_source_identity);
end;
$$;
revoke all on function private.stream_app_video_projection(text,text,uuid,uuid,text)
  from public,anon,authenticated,service_role;

create function private.stream_app_paid_lesson_is_exclusive(
  target_lesson_id uuid,target_video_id uuid,target_registry_id uuid,target_uid text
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.program_content_version_lessons lesson
    join public.program_content_versions version
      on version.program_id=lesson.program_id and version.id=lesson.content_version_id
    where lesson.id=target_lesson_id and version.revision_kind='paid'
      and lesson.video_id is not distinct from target_video_id and lesson.cloudflare_uid=target_uid
      and exists (select 1 from public.stream_media_source_bindings lesson_binding
        join public.stream_media_assets lesson_asset on lesson_asset.id=lesson_binding.asset_id
          and lesson_asset.registry_id=lesson_binding.registry_id
          and lesson_asset.raw_provider_uid=lesson_binding.raw_provider_uid
          and lesson_asset.lifecycle_state='ready_for_publication'
          and lesson_asset.signed_urls_verified and lesson_asset.ready_to_stream_verified
        where lesson_binding.source_kind='program_lesson'
          and lesson_binding.source_identity=lesson.id::text
          and lesson_binding.owner_id=lesson.video_creator_id
          and lesson_binding.registry_id=target_registry_id
          and lesson_binding.raw_provider_uid=target_uid
          and lesson_binding.binding_state in ('ready_for_publication','active','retained'))
      and (not exists (select 1 from public.videos paid_video
        where paid_video.stream_provider_account_registry_id=target_registry_id
          and paid_video.cloudflare_uid=target_uid)
        or exists (select 1 from public.videos paid_video
          where paid_video.stream_provider_account_registry_id=target_registry_id
            and paid_video.cloudflare_uid=target_uid and paid_video.visibility='program_only'))
      and not exists (select 1 from public.programs intro_program
        join public.videos intro_video on intro_video.id=intro_program.intro_video_id
        where intro_video.stream_provider_account_registry_id=target_registry_id
          and intro_video.cloudflare_uid=target_uid)
      and not exists (select 1 from public.program_content_version_lessons free_lesson
        join public.program_content_versions free_version
          on free_version.program_id=free_lesson.program_id and free_version.id=free_lesson.content_version_id
        where free_version.revision_kind='free_snapshot' and free_lesson.cloudflare_uid=target_uid)
      and not exists (select 1 from public.videos ordinary_video
        where ordinary_video.cloudflare_uid=target_uid
          and ordinary_video.stream_provider_account_registry_id=target_registry_id
          and ordinary_video.visibility='members')
      and not exists (select 1 from public.post_media media
        join public.posts post on post.id=media.post_id
        where media.kind='video' and media.video_uid=target_uid and post.removed_at is null
          and post.audience<>'only_me')
  );
$$;
revoke all on function private.stream_app_paid_lesson_is_exclusive(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;

create function public.get_my_stream_library_video_playback(target_video_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare video_owner uuid;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null
    or not private.stream_app_role_eligible(auth.uid(),'video')
    or private.stream_account_is_tombstoned(auth.uid()) then
    return jsonb_build_object('outcome','unavailable');
  end if;
  select video.coach_id into video_owner from public.videos video
  where video.id=target_video_id and video.coach_id=auth.uid();
  if video_owner is null then return jsonb_build_object('outcome','unavailable'); end if;
  return private.stream_app_video_projection('video',target_video_id::text,video_owner,target_video_id);
end;
$$;
revoke all on function public.get_my_stream_library_video_playback(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_my_stream_library_video_playback(uuid) to authenticated;

create function public.get_visible_stream_post_video_playback(target_post_id uuid,target_media_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare post_row public.posts%rowtype; media_row public.post_media%rowtype; video_id uuid;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null then
    return jsonb_build_object('outcome','unavailable');
  end if;
  select post.* into post_row from public.posts post
  where post.id=target_post_id and post.removed_at is null
    and private.can_see_post(post.author_id,post.audience,post.coach_id,post.removed_at);
  if not found then return jsonb_build_object('outcome','unavailable'); end if;
  select media.* into media_row from public.post_media media
  where media.id=target_media_id and media.post_id=post_row.id and media.kind='video';
  if not found then return jsonb_build_object('outcome','unavailable'); end if;
  return private.stream_app_video_projection('post_media',media_row.id::text,post_row.author_id,null);
end;
$$;
revoke all on function public.get_visible_stream_post_video_playback(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_visible_stream_post_video_playback(uuid,uuid) to authenticated;

create function public.get_stream_program_intro_playback(target_program_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare program_row public.programs%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null
    or not private.can_member_access_program(target_program_id,auth.uid()) then
    return jsonb_build_object('outcome','unavailable');
  end if;
  select program.* into program_row from public.programs program
  where program.id=target_program_id and program.published and program.intro_video_id is not null;
  if not found then return jsonb_build_object('outcome','unavailable'); end if;
  return private.stream_app_video_projection('program_intro',program_row.id::text,
    program_row.coach_id,program_row.intro_video_id);
end;
$$;
revoke all on function public.get_stream_program_intro_playback(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_stream_program_intro_playback(uuid) to authenticated;



create function public.get_my_stream_program_enrollment_lesson_playback(
  target_enrollment_id uuid,target_lesson_id uuid
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  enrollment public.program_enrollments%rowtype;
  lesson_row public.program_content_version_lessons%rowtype;
  program_owner uuid;
  gate_day integer;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null
    or not private.has_platform_tier(auth.uid(),'regular')
    or exists (select 1 from public.platform_membership_deletion_locks deletion_lock
      where deletion_lock.member_id=auth.uid()) then
    return jsonb_build_object('outcome','unavailable');
  end if;
  select enrollment_row.* into enrollment from public.program_enrollments enrollment_row
  where enrollment_row.id=target_enrollment_id and enrollment_row.member_id=auth.uid();
  select program.coach_id into program_owner from public.programs program
  where program.id=enrollment.program_id and private.can_member_access_program(program.id,auth.uid());
  select lesson.* into lesson_row from public.program_content_version_lessons lesson
  join public.program_content_versions version on version.program_id=lesson.program_id
    and version.id=lesson.content_version_id and version.revision_kind='free_snapshot'
  where lesson.id=target_lesson_id and lesson.program_id=enrollment.program_id
    and lesson.content_version_id=enrollment.content_version_id;
  if not found then return jsonb_build_object('outcome','unavailable'); end if;
  gate_day := greatest((private.current_daily_checkin_day()-enrollment.started_on+1),0);
  if program_owner is null or lesson_row.video_creator_id is distinct from program_owner
    or lesson_row.timeline_day_number>gate_day then
    return jsonb_build_object('outcome','unavailable');
  end if;
  return private.stream_app_video_projection('program_lesson',lesson_row.id::text,
    program_owner,lesson_row.video_id,lesson_row.cloudflare_uid);
end;
$$;
revoke all on function public.get_my_stream_program_enrollment_lesson_playback(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_my_stream_program_enrollment_lesson_playback(uuid,uuid) to authenticated;

create function public.get_my_stream_daily_content_video_playback(
  target_slot_id uuid,target_revision_id uuid
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  current_row record;
  slot_row public.daily_content_slots%rowtype;
  revision_row public.daily_content_revisions%rowtype;
  item_row public.daily_content_items%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null
    or not private.has_role(auth.uid(),'member')
    or not private.has_platform_tier(auth.uid(),'regular') then
    return jsonb_build_object('outcome','unavailable');
  end if;
  select resolved.* into current_row from public.resolve_member_daily_content() resolved;
  if current_row.video_id is null or current_row.video_source='legacy'
    or current_row.video_slot_id is distinct from target_slot_id
    or current_row.video_revision_id is distinct from target_revision_id then
    return jsonb_build_object('outcome','unavailable');
  end if;
  select slot.* into slot_row from public.daily_content_slots slot
  where slot.id=target_slot_id and slot.day=private.current_daily_checkin_day()
    and slot.status in ('scheduled','published') and slot.content_kind='video';
  select revision.* into revision_row from public.daily_content_revisions revision
  where revision.id=target_revision_id and revision.item_id=slot_row.item_id
    and revision.video_id=current_row.video_id and revision.kind='video';
  select item.* into item_row from public.daily_content_items item
  where item.id=slot_row.item_id and item.kind='video' and item.status='active';
  if slot_row.id is null or revision_row.id is null or item_row.id is null
    or (slot_row.coach_id is not null and
      (slot_row.coach_id<>item_row.owner_id or item_row.owner_role<>'coach'))
    or (slot_row.coach_id is null and item_row.owner_role<>'admin') then
    return jsonb_build_object('outcome','unavailable');
  end if;
  return private.stream_app_video_projection('daily_content_slot',slot_row.id::text,
    item_row.owner_id,current_row.video_id);
end;
$$;
revoke all on function public.get_my_stream_daily_content_video_playback(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_my_stream_daily_content_video_playback(uuid,uuid) to authenticated;

create function public.get_my_stream_daily_fuel_assignment_playback(target_assignment_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare assignment_row public.member_daily_fuel_assignments%rowtype; video_owner uuid;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null
    or not private.has_role(auth.uid(),'member')
    or not private.has_platform_tier(auth.uid(),'regular') then
    return jsonb_build_object('outcome','unavailable');
  end if;
  select assignment.* into assignment_row from public.member_daily_fuel_assignments assignment
  where assignment.id=target_assignment_id and assignment.member_id=auth.uid()
    and assignment.day=private.current_daily_checkin_day()
    and exists (select 1 from public.coach_members coach_member
      where coach_member.coach_id=assignment.coach_id and coach_member.member_id=auth.uid());
  if not found then return jsonb_build_object('outcome','unavailable'); end if;
  select video.coach_id into video_owner from public.videos video
  where video.id=assignment_row.video_id and video.coach_id=assignment_row.coach_id;
  if video_owner is null then return jsonb_build_object('outcome','unavailable'); end if;
  return private.stream_app_video_projection('daily_fuel_assignment',assignment_row.id::text,
    video_owner,assignment_row.video_id);
end;
$$;
revoke all on function public.get_my_stream_daily_fuel_assignment_playback(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_my_stream_daily_fuel_assignment_playback(uuid) to authenticated;

create function public.get_my_stream_daily_fuel_bookmark_playback(target_video_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  video_row public.videos%rowtype;
  binding_row public.stream_media_source_bindings%rowtype;
  asset_row public.stream_media_assets%rowtype;
  v_source_identity text;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null
    or not private.has_role(auth.uid(),'member')
    or not private.has_platform_tier(auth.uid(),'regular')
    or private.stream_account_is_tombstoned(auth.uid())
    or not exists (select 1 from public.member_daily_fuel_bookmarks bookmark
      join public.videos bookmarked_video on bookmarked_video.id=bookmark.video_id
      join public.coach_members coach_member on coach_member.coach_id=bookmarked_video.coach_id
        and coach_member.member_id=auth.uid()
      where bookmark.member_id=auth.uid() and bookmark.video_id=target_video_id) then
    return jsonb_build_object('outcome','unavailable');
  end if;
  select video.* into video_row from public.videos video
  where video.id=target_video_id and video.visibility in ('members','private')
    and video.status::text='ready' and not video.daily_content_deletion_pending
    and video.stream_provider_account_registry_id is not null and video.cloudflare_uid is not null;
  if not found then return jsonb_build_object('outcome','unavailable'); end if;
  if private.stream_account_is_tombstoned(video_row.coach_id) then
    return jsonb_build_object('outcome','unavailable'); end if;
  v_source_identity := auth.uid()::text||':'||target_video_id::text;
  select binding.* into binding_row from public.stream_media_source_bindings binding
  where binding.source_kind='daily_fuel_bookmark' and binding.source_identity=v_source_identity
    and binding.owner_id=auth.uid()
    and binding.parent_kind='profile' and binding.parent_identity=auth.uid()::text
    and binding.registry_id=video_row.stream_provider_account_registry_id
    and binding.raw_provider_uid=video_row.cloudflare_uid
    and binding.binding_state in ('ready_for_publication','active','retained')
  order by binding.created_at desc limit 1;
  if not found then return jsonb_build_object('outcome','unavailable'); end if;
  select asset.* into asset_row from public.stream_media_assets asset
  where asset.id=binding_row.asset_id and asset.registry_id=binding_row.registry_id
    and asset.raw_provider_uid=binding_row.raw_provider_uid
    and asset.lifecycle_state='ready_for_publication'
    and asset.signed_urls_verified and asset.ready_to_stream_verified;
  if not found or not private.stream_account_is_verified(binding_row.registry_id)
    or private.stream_legacy_uid_unresolved(binding_row.registry_id,binding_row.raw_provider_uid)
    or private.stream_media_uid_reserved(binding_row.registry_id,binding_row.raw_provider_uid)
    or not exists (select 1 from public.stream_media_source_binding_events event
      where event.binding_id=binding_row.id and event.event_kind='attached'
        and event.source_revision=binding_row.source_revision
        and event.evidence_digest=binding_row.evidence_digest)
    or not exists (select 1 from public.stream_media_parent_fences fence
      where fence.source_kind=binding_row.parent_kind and fence.source_identity=binding_row.parent_identity
        and fence.owner_id=auth.uid()
        and ((fence.fence_state='open' and fence.active_operation_id is null)
          or (binding_row.parent_kind='profile' and fence.fence_state='closing'
            and exists (select 1 from public.stream_media_operations active_upload
              join public.stream_media_operation_states active_state on active_state.operation_id=active_upload.id
              where active_upload.id=fence.active_operation_id and active_upload.operation_kind='upload'
                and active_upload.source_kind='video' and active_upload.actor_id=auth.uid()
                and active_upload.owner_id=auth.uid() and active_upload.parent_kind='profile'
                and active_upload.parent_identity=auth.uid()::text
                and active_upload.source_identity<>target_video_id::text
                and active_state.operation_state in ('reserved','create_started','create_unknown',
                  'created_unverified','provisional_bound'))))) then
    return jsonb_build_object('outcome','unavailable');
  end if;
  return jsonb_build_object('outcome','ready','video_id',video_row.id,
    'registry_id',binding_row.registry_id,'provider_uid',binding_row.raw_provider_uid,
    'source_kind','daily_fuel_bookmark','source_identity',v_source_identity);
end;
$$;
revoke all on function public.get_my_stream_daily_fuel_bookmark_playback(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_my_stream_daily_fuel_bookmark_playback(uuid) to authenticated;

-- A provider UID can be destroyed only from a canonical provisional binding produced by an
-- exact creator/marker readback. A bare text state called canceled is never proof.
alter table public.stream_media_operation_states
  drop constraint stream_media_operation_states_operation_state_check;
alter table public.stream_media_operation_states
  add constraint stream_media_operation_states_operation_state_check
  check (operation_state in (
    'reserved','create_started','create_unknown','created_unverified','provisional_bound',
    'ready_for_publication','cleanup_reserved','delete_started','delete_unknown',
    'source_finalizing','completed','retained','failed','canceled',
    'auth_call_started','auth_result_unknown','auth_confirmed'
  ));

create function private.stream_upload_cancel_receipt_matches(target_upload_operation_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.stream_media_upload_cancel_receipts receipt
    join public.stream_media_operations upload on upload.id=receipt.operation_id and upload.operation_kind='upload'
    join public.stream_media_upload_intents intent on intent.id=upload.intent_id
    join public.stream_media_upload_contexts context on context.intent_id=intent.id
    join public.stream_media_upload_transport transport on transport.operation_id=upload.id
    join public.stream_media_operations cleanup on cleanup.id=receipt.cleanup_operation_id
      and cleanup.operation_kind='cleanup' and cleanup.owner_id=receipt.owner_id
      and cleanup.source_kind=context.parent_kind and cleanup.source_identity=context.parent_identity
      and cleanup.parent_kind=context.parent_kind and cleanup.parent_identity=context.parent_identity
      and cleanup.expected_source_revision=receipt.parent_revision
      and cleanup.operation_digest=private.stream_media_identity_digest(concat_ws('|','stream_upload_cancel_v1',
        upload.id::text,upload.operation_digest,receipt.request_id::text,context.parent_kind,
        context.parent_identity,context.source_revision::text))
    join public.stream_media_operation_states cleanup_state on cleanup_state.operation_id=cleanup.id
      and cleanup_state.operation_state in ('source_finalizing','completed')
    join public.stream_media_operation_uid_state uid_state on uid_state.operation_id=cleanup.id
      and uid_state.registry_id=receipt.registry_id and uid_state.raw_provider_uid=receipt.raw_provider_uid
      and uid_state.uid_state in ('deleted_confirmed','already_absent_confirmed')
    join public.stream_media_operation_uid_events delete_event on delete_event.id=uid_state.last_event_id
      and delete_event.operation_id=cleanup.id and delete_event.registry_id=receipt.registry_id
      and delete_event.raw_provider_uid=receipt.raw_provider_uid
      and delete_event.request_id=receipt.observation_request_id
      and delete_event.outcome=uid_state.uid_state and delete_event.http_status=404
      and delete_event.evidence_digest=receipt.absence_evidence_digest
    join public.stream_media_operation_uid_event_clocks absence_clock
      on absence_clock.event_id=delete_event.id
    where receipt.operation_id=target_upload_operation_id
      and receipt.evidence_order_sequence>absence_clock.order_sequence
      and receipt.registry_id=upload.registry_id and receipt.raw_provider_uid=transport.provider_uid
      and receipt.exact_absence_status=404 and transport.provider_evidence_digest is not null
      and receipt.request_digest=private.stream_media_identity_digest(concat_ws('|',
        'stream_upload_cancel_absence_v1',upload.id::text,upload.operation_digest,receipt.request_id::text,
        cleanup.id::text,receipt.registry_id::text,receipt.raw_provider_uid,context.parent_kind,
        context.parent_identity,context.source_revision::text,delete_event.evidence_digest,receipt.cleanup_reason,
        coalesce(receipt.tombstone_id::text,''),coalesce(receipt.tombstone_request_id::text,''),
        coalesce(receipt.tombstone_revision::text,''),coalesce(receipt.tombstone_state_revision::text,'')))
      and intent.actor_id=receipt.actor_id and upload.actor_id=receipt.actor_id
      and upload.owner_id=receipt.owner_id and context.owner_id=receipt.owner_id
      and context.source_revision=receipt.parent_revision and context.parent_kind=receipt.parent_kind
      and context.parent_identity=receipt.parent_identity and intent.provider_account_registry_id=receipt.registry_id
      and intent.source_kind=upload.source_kind and intent.source_id::text=upload.source_identity
      and intent.source_kind in ('video','post_media')
      and intent.purpose=case when intent.source_kind='video' then 'library_video' else 'community_video' end
      and transport.request_marker=intent.request_marker
      and transport.original_metadata->>'request_marker'=intent.request_marker::text
      and transport.original_metadata->>'source_kind'=upload.source_kind
      and transport.original_metadata->>'source_id'=upload.source_identity
      and transport.original_metadata->>'actor_id'=upload.actor_id::text
      and ((receipt.cleanup_reason='actor_request' and receipt.tombstone_id is null)
        or (receipt.cleanup_reason='account_cleanup' and exists (
          select 1 from public.stream_media_account_tombstones tombstone
          where tombstone.id=receipt.tombstone_id and tombstone.account_id=receipt.owner_id
            and tombstone.request_id=receipt.tombstone_request_id
            and tombstone.revision>=receipt.tombstone_revision
            and tombstone.state_revision>=receipt.tombstone_state_revision)))
      and ((uid_state.uid_state='deleted_confirmed'
          and delete_event.delete_http_status between 200 and 299)
        or (uid_state.uid_state='already_absent_confirmed' and delete_event.delete_http_status is null
          and exists (select 1 from public.stream_media_operation_uid_events started
            where started.operation_id=cleanup.id and started.registry_id=receipt.registry_id
              and started.raw_provider_uid=receipt.raw_provider_uid and started.outcome='delete_started'
              and started.sequence_number<delete_event.sequence_number)))
      and exists (select 1 from public.stream_media_parent_fences parent_fence
        where parent_fence.source_kind=context.parent_kind and parent_fence.source_identity=context.parent_identity
          and parent_fence.owner_id=context.owner_id and parent_fence.source_revision>context.source_revision)
      and (
        (receipt.cleanup_manifest_kind='canonical_provisional' and receipt.abort_manifest_id is null
          and receipt.cleanup_reason='actor_request' and receipt.tombstone_id is null
          and (select count(*) from public.stream_media_manifest_edges canonical_edge
            where canonical_edge.operation_id=cleanup.id)=1
          and exists (select 1 from public.stream_media_manifest_edges manifest
            join public.stream_media_source_bindings binding on binding.id=manifest.binding_id
            join public.stream_media_assets asset on asset.id=binding.asset_id
            where manifest.operation_id=cleanup.id and manifest.edge_number=1
              and manifest.binding_id is not distinct from (
                select prior_binding.id from public.stream_media_source_bindings prior_binding
                join public.stream_media_assets prior_asset on prior_asset.id=prior_binding.asset_id
                where prior_asset.upload_intent_id=intent.id and prior_binding.registry_id=receipt.registry_id
                  and prior_binding.raw_provider_uid=receipt.raw_provider_uid
                order by prior_binding.created_at desc limit 1)
              and manifest.source_kind=upload.source_kind and manifest.source_identity=upload.source_identity
              and manifest.source_revision=receipt.parent_revision and manifest.registry_id=receipt.registry_id
              and manifest.raw_provider_uid=receipt.raw_provider_uid
              and binding.owner_id=receipt.owner_id and binding.parent_kind=context.parent_kind
              and binding.parent_identity=context.parent_identity and binding.source_revision=receipt.parent_revision
              and binding.binding_state='detached' and asset.owner_id=receipt.owner_id
              and asset.lifecycle_state='deleted_confirmed'
              and exists (select 1 from public.stream_media_source_binding_events detached
                where detached.binding_id=binding.id and detached.event_kind='detached'
                  and detached.source_revision=receipt.parent_revision
                  and detached.request_id=private.stream_media_request_uuid(
                    cleanup.id::text||':'||receipt.request_id::text||':upload-cancel-detach')
                  and detached.evidence_digest=receipt.request_digest)
          and exists (select 1 from public.stream_media_source_binding_events attached
                join public.stream_media_upload_observations original_observation
                  on original_observation.operation_id=upload.id and original_observation.registry_id=upload.registry_id
                    and original_observation.raw_provider_uid=receipt.raw_provider_uid
                    and original_observation.observation_kind='exact_uid_get'
                    and original_observation.http_status=200 and original_observation.creator_marker_matched is true
                    and original_observation.metadata_marker_matched is true
                    and original_observation.evidence_digest=attached.evidence_digest
                join public.stream_media_upload_observation_clocks original_observation_clock
                  on original_observation_clock.observation_id=original_observation.id
                where attached.binding_id=binding.id and attached.event_kind='attached'
                  and attached.source_revision=receipt.parent_revision
                  and original_observation_clock.order_sequence<absence_clock.order_sequence)))
        or (receipt.cleanup_manifest_kind='unready_abort' and receipt.abort_manifest_id is not null
          and not exists (select 1 from public.stream_media_manifest_edges canonical_edge
            where canonical_edge.operation_id=cleanup.id)
          and exists (select 1 from public.stream_media_upload_abort_manifests abort_manifest
            join public.stream_media_upload_observations original_observation
              on original_observation.id=abort_manifest.observation_id
            join public.stream_media_upload_observation_clocks original_observation_clock
              on original_observation_clock.observation_id=original_observation.id
            where abort_manifest.id=receipt.abort_manifest_id
              and abort_manifest.cleanup_operation_id=cleanup.id
              and abort_manifest.upload_operation_id=upload.id and abort_manifest.intent_id=intent.id
              and abort_manifest.context_digest=context.context_digest
              and abort_manifest.registry_id=receipt.registry_id
              and abort_manifest.raw_provider_uid=receipt.raw_provider_uid
              and abort_manifest.actor_id=receipt.actor_id and abort_manifest.owner_id=receipt.owner_id
              and abort_manifest.parent_kind=context.parent_kind
              and abort_manifest.parent_identity=context.parent_identity
              and abort_manifest.parent_revision=receipt.parent_revision
              and abort_manifest.cleanup_reason=receipt.cleanup_reason
              and abort_manifest.cancel_request_id=receipt.request_id
              and abort_manifest.tombstone_id is not distinct from receipt.tombstone_id
              and abort_manifest.tombstone_request_id is not distinct from receipt.tombstone_request_id
              and abort_manifest.tombstone_revision is not distinct from receipt.tombstone_revision
              and abort_manifest.tombstone_state_revision is not distinct from receipt.tombstone_state_revision
              and abort_manifest.request_digest=private.stream_media_identity_digest(concat_ws('|',
                'stream_upload_abort_manifest_v1',upload.id::text,upload.operation_digest,intent.id::text,
                intent.payload_digest,context.context_digest,original_observation.id::text,
                original_observation.evidence_digest,receipt.registry_id::text,receipt.raw_provider_uid,
                upload.actor_id::text,upload.owner_id::text,context.parent_kind,context.parent_identity,
                context.source_revision::text,receipt.request_id::text,receipt.cleanup_reason,
                coalesce(receipt.tombstone_id::text,''),coalesce(receipt.tombstone_request_id::text,''),
                coalesce(receipt.tombstone_revision::text,''),coalesce(receipt.tombstone_state_revision::text,'')))
              and abort_manifest.request_id=private.stream_media_request_uuid(
                upload.id::text||':'||receipt.request_id::text||':upload-abort-manifest-request')
              and original_observation.operation_id=upload.id and original_observation.registry_id=receipt.registry_id
              and original_observation.raw_provider_uid=receipt.raw_provider_uid
              and original_observation.observation_kind='exact_uid_get' and original_observation.http_status=200
              and original_observation.creator_marker_matched is true
              and original_observation.metadata_marker_matched is true
              and original_observation_clock.order_sequence<absence_clock.order_sequence
              and original_observation.request_id is not null
              and not exists (select 1 from public.stream_media_assets asset
                where asset.registry_id=receipt.registry_id and asset.raw_provider_uid=receipt.raw_provider_uid)
              and not exists (select 1 from public.stream_media_source_bindings binding
                where binding.registry_id=receipt.registry_id and binding.raw_provider_uid=receipt.raw_provider_uid
                  and binding.binding_state in ('legacy_unverified','provisional_bound','ready_for_publication',
                    'active','retained','quarantined'))))
      )
      and not private.stream_media_has_effective_reference(receipt.registry_id,receipt.raw_provider_uid,cleanup.id)
  );
$$;
revoke all on function private.stream_upload_cancel_receipt_matches(uuid)
  from public,anon,authenticated,service_role;

create function private.stream_upload_cancel_proven(target_upload_operation_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.stream_media_upload_cancel_receipts receipt
    join public.stream_media_operation_states upload_state on upload_state.operation_id=receipt.operation_id
      and upload_state.operation_state='canceled'
    join public.stream_media_operations cleanup on cleanup.id=receipt.cleanup_operation_id
    join public.stream_media_operation_states cleanup_state on cleanup_state.operation_id=cleanup.id
      and cleanup_state.operation_state='completed'
    join public.stream_media_finalization_receipts cleanup_receipt on cleanup_receipt.operation_id=cleanup.id
      and cleanup_receipt.terminal_state='completed'
      and cleanup_receipt.response->>'outcome'='upload_cancel_complete'
      and cleanup_receipt.request_digest=receipt.request_digest
      and cleanup_receipt.response->>'upload_operation_id'=receipt.operation_id::text
      and cleanup_receipt.response->>'raw_provider_uid'=receipt.raw_provider_uid
    where receipt.operation_id=target_upload_operation_id
      and private.stream_upload_cancel_receipt_matches(receipt.operation_id)
      and exists (select 1 from public.stream_media_operation_events canceled_event
        where canceled_event.operation_id=receipt.operation_id
          and canceled_event.request_id=receipt.request_id and canceled_event.to_state='canceled'
          and canceled_event.evidence_digest=receipt.request_digest)
      and not exists (select 1 from public.stream_media_upload_observations late_observation
        join public.stream_media_upload_observation_clocks late_clock
          on late_clock.observation_id=late_observation.id
        where late_observation.operation_id=receipt.operation_id
          and late_observation.registry_id=receipt.registry_id
          and late_observation.raw_provider_uid=receipt.raw_provider_uid
          and late_observation.observation_kind='exact_uid_get'
          and late_observation.http_status=200
          and late_clock.order_sequence>receipt.evidence_order_sequence)
  );
$$;
revoke all on function private.stream_upload_cancel_proven(uuid)
  from public,anon,authenticated,service_role;

create function private.guard_stream_upload_canceled_state()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op='INSERT' and new.operation_state='canceled' then
    raise exception 'Canceled upload state requires an exact absence receipt' using errcode='55000';
  end if;
  if tg_op='UPDATE' and old.operation_state='canceled' and new.operation_state<>'canceled' then
    raise exception 'Canceled upload state is terminal' using errcode='55000';
  end if;
  if tg_op='UPDATE' and new.operation_state='canceled'
    and (not private.stream_upload_cancel_receipt_matches(new.operation_id)
      or not exists (select 1 from public.stream_media_upload_cancel_receipts receipt
        join public.stream_media_operation_events event on event.operation_id=receipt.operation_id
          and event.request_id=receipt.request_id and event.to_state='canceled'
          and event.evidence_digest=receipt.request_digest
        where receipt.operation_id=new.operation_id)) then
    raise exception 'Canceled upload state requires an exact DELETE and absent GET receipt' using errcode='55000';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_stream_upload_canceled_state()
  from public,anon,authenticated,service_role;
create trigger stream_upload_canceled_state_guard
before insert or update on public.stream_media_operation_states
for each row execute function private.guard_stream_upload_canceled_state();

create or replace function private.stream_advance_operation(
  target_operation_id uuid,target_next_state text,target_request_id uuid,target_evidence_digest text
)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  state_row public.stream_media_operation_states%rowtype;
  next_revision bigint;
begin
  if target_operation_id is null or target_request_id is null or target_evidence_digest is null
    or target_evidence_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'Media operation transition is invalid' using errcode='22023';
  end if;
  select state.* into state_row from public.stream_media_operation_states state
  where state.operation_id=target_operation_id for update;
  if not found then raise exception 'Media operation is unavailable' using errcode='P0002'; end if;
  if exists (select 1 from public.stream_media_operation_events event
    where event.operation_id=target_operation_id and event.request_id=target_request_id) then
    if exists (select 1 from public.stream_media_operation_events event
      where event.operation_id=target_operation_id and event.request_id=target_request_id
        and event.to_state=target_next_state and event.evidence_digest=target_evidence_digest) then
      return state_row.state_revision;
    end if;
    raise exception 'Media operation request identity conflicts' using errcode='23505';
  end if;
  if not (
    (state_row.operation_state='reserved' and target_next_state in ('create_started','cleanup_reserved','source_finalizing','failed'))
    or (state_row.operation_state='create_started' and target_next_state in ('create_unknown','created_unverified'))
    or (state_row.operation_state='create_unknown' and target_next_state in ('created_unverified','provisional_bound','canceled'))
    or (state_row.operation_state='created_unverified' and target_next_state in ('provisional_bound','canceled'))
    or (state_row.operation_state='provisional_bound' and target_next_state in ('ready_for_publication','canceled'))
    or (state_row.operation_state='ready_for_publication' and target_next_state='completed')
    or (state_row.operation_state='cleanup_reserved' and target_next_state in ('delete_started','retained','source_finalizing'))
    or (state_row.operation_state='delete_started' and target_next_state in ('delete_unknown','source_finalizing'))
    or (state_row.operation_state='delete_unknown' and target_next_state in ('delete_started','source_finalizing'))
    or (state_row.operation_state='source_finalizing' and target_next_state in ('completed','retained'))
  ) then raise exception 'Media operation transition is not allowed' using errcode='23514'; end if;
  if target_next_state='canceled' and not private.stream_upload_cancel_receipt_matches(target_operation_id) then
    raise exception 'Canceled upload transition requires an exact absence receipt' using errcode='23514'; end if;
  next_revision := state_row.state_revision+1;
  insert into public.stream_media_operation_events(
    operation_id,sequence_number,from_state,to_state,request_id,evidence_digest
  ) values (target_operation_id,next_revision,state_row.operation_state,target_next_state,
    target_request_id,target_evidence_digest);
  update public.stream_media_operation_states set operation_state=target_next_state,
    state_revision=next_revision,updated_at=now() where operation_id=target_operation_id;
  return next_revision;
end;
$$;
revoke all on function private.stream_advance_operation(uuid,text,uuid,text)
  from public,anon,authenticated,service_role;

-- No unready UID is promoted into stream_media_assets or stream_media_source_bindings. A known UID is reserved into the cleanup-only manifest below.

create function public.request_stream_media_upload_cancel(target_operation_id uuid,target_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  upload public.stream_media_operations%rowtype;
  intent_row public.stream_media_upload_intents%rowtype;
  context_row public.stream_media_upload_contexts%rowtype;
  state_value text;
  transport_row public.stream_media_upload_transport%rowtype;
  observation_row public.stream_media_upload_observations%rowtype;
  asset_row public.stream_media_assets%rowtype;
  binding_row public.stream_media_source_bindings%rowtype;
  parent_fence public.stream_media_parent_fences%rowtype;
  cleanup_operation_id uuid;
  cleanup_request_id uuid;
  cleanup_digest text;
  abort_manifest_id uuid;
  abort_manifest_request_id uuid;
  abort_manifest_digest text;
  cleanup_manifest_kind text;
  prior_receipt public.stream_media_upload_cancel_receipts%rowtype;
  prior_abort_manifest public.stream_media_upload_abort_manifests%rowtype;
  prior_cleanup public.stream_media_operations%rowtype;
  active_cleanup public.stream_media_operations%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null then
    raise exception 'Signed-in upload cancellation is required' using errcode='42501'; end if;
  if target_operation_id is null or target_request_id is null then
    raise exception 'Upload cancellation request is invalid' using errcode='22023'; end if;
  perform private.stream_require_read_committed();
  select operation.* into upload from public.stream_media_operations operation
  where operation.id=target_operation_id and operation.operation_kind='upload'
    and operation.actor_id=auth.uid() and operation.owner_id=auth.uid();
  if not found then return jsonb_build_object('outcome','unavailable'); end if;
  select intent.* into intent_row from public.stream_media_upload_intents intent where intent.id=upload.intent_id;
  select context.* into context_row from public.stream_media_upload_contexts context where context.intent_id=upload.intent_id;
  if intent_row.id is null or context_row.intent_id is null or context_row.owner_id<>auth.uid()
    or upload.source_kind not in ('video','post_media')
    or intent_row.source_kind<>upload.source_kind or intent_row.source_id::text<>upload.source_identity
    or intent_row.purpose<>(case when upload.source_kind='video' then 'library_video' else 'community_video' end) then
    return jsonb_build_object('outcome','unsupported_or_unavailable'); end if;
  perform private.stream_lock_accounts(array[auth.uid(),upload.owner_id]);
  if not private.stream_try_parent_lock(context_row.parent_kind,context_row.parent_identity) then
    return jsonb_build_object('outcome','source_busy'); end if;
  select operation.* into upload from public.stream_media_operations operation
  where operation.id=target_operation_id and operation.operation_kind='upload' for update;
  select state.operation_state into state_value from public.stream_media_operation_states state
  where state.operation_id=upload.id for update;
  cleanup_operation_id := private.stream_media_request_uuid(upload.id::text||':'||target_request_id::text||':upload-cancel-operation');
  cleanup_request_id := private.stream_media_request_uuid(upload.id::text||':'||target_request_id::text||':upload-cancel-operation-request');
  cleanup_digest := private.stream_media_identity_digest(concat_ws('|','stream_upload_cancel_v1',
    upload.id::text,upload.operation_digest,target_request_id::text,context_row.parent_kind,
    context_row.parent_identity,context_row.source_revision::text));
  if state_value='canceled' then
    select receipt.* into prior_receipt from public.stream_media_upload_cancel_receipts receipt
    where receipt.operation_id=upload.id;
    if found and prior_receipt.request_id=target_request_id and prior_receipt.cleanup_operation_id=cleanup_operation_id
      and prior_receipt.cleanup_reason='actor_request' and private.stream_upload_cancel_proven(upload.id) then
      return jsonb_build_object('outcome','already_canceled','cleanup_operation_id',prior_receipt.cleanup_operation_id);
    end if;
    if found then return jsonb_build_object('outcome','identity_mismatch'); end if;
    return jsonb_build_object('outcome','cancel_reconciliation_required');
  end if;
  select fence.* into parent_fence from public.stream_media_parent_fences fence
  where fence.source_kind=context_row.parent_kind and fence.source_identity=context_row.parent_identity for update;
  if parent_fence.active_operation_id is not null and parent_fence.active_operation_id<>upload.id then
    select operation.* into active_cleanup from public.stream_media_operations operation
    where operation.id=parent_fence.active_operation_id and operation.operation_kind='cleanup';
    if active_cleanup.id=cleanup_operation_id and active_cleanup.request_id=cleanup_request_id
      and active_cleanup.owner_id=upload.owner_id and active_cleanup.operation_digest=cleanup_digest
      and exists (select 1 from public.stream_media_operation_states state
        where state.operation_id=active_cleanup.id
          and state.operation_state in ('cleanup_reserved','delete_started','delete_unknown','source_finalizing','completed'))
      and (exists (select 1 from public.stream_media_upload_abort_manifests abort_manifest
          where abort_manifest.cleanup_operation_id=active_cleanup.id
            and abort_manifest.upload_operation_id=upload.id and abort_manifest.cleanup_reason='actor_request'
            and abort_manifest.cancel_request_id=target_request_id)
        or exists (select 1 from public.stream_media_manifest_edges edge
          join public.stream_media_source_bindings binding on binding.id=edge.binding_id
          join public.stream_media_assets asset on asset.id=binding.asset_id
          where edge.operation_id=active_cleanup.id and asset.upload_intent_id=upload.intent_id)) then
      return jsonb_build_object('outcome','cancel_in_progress','cleanup_operation_id',cleanup_operation_id,
        'cleanup_manifest_kind',case when exists (select 1 from public.stream_media_upload_abort_manifests abort_manifest
          where abort_manifest.cleanup_operation_id=active_cleanup.id) then 'unready_abort' else 'canonical_provisional' end);
    end if;
    if exists (select 1 from public.stream_media_upload_abort_manifests abort_manifest
        where abort_manifest.upload_operation_id=upload.id)
      or exists (select 1 from public.stream_media_manifest_edges edge
        join public.stream_media_source_bindings binding on binding.id=edge.binding_id
        join public.stream_media_assets asset on asset.id=binding.asset_id
        where edge.operation_id=active_cleanup.id and asset.upload_intent_id=upload.intent_id) then
      return jsonb_build_object('outcome','identity_mismatch');
    end if;
  end if;
  select abort_manifest.* into prior_abort_manifest from public.stream_media_upload_abort_manifests abort_manifest
  where abort_manifest.upload_operation_id=upload.id;
  if found then
    if prior_abort_manifest.cleanup_reason<>'actor_request'
      or prior_abort_manifest.cancel_request_id<>target_request_id
      or prior_abort_manifest.cleanup_operation_id<>cleanup_operation_id then
      return jsonb_build_object('outcome','identity_mismatch'); end if;
    return jsonb_build_object('outcome','cancel_in_progress','cleanup_operation_id',cleanup_operation_id,
      'cleanup_manifest_kind','unready_abort');
  end if;
  if state_value not in ('create_unknown','created_unverified','provisional_bound') then
    return jsonb_build_object('outcome','cancel_reconciliation_required','operation_state',state_value);
  end if;
  if state_value='provisional_bound' then
    cleanup_manifest_kind := 'canonical_provisional';
    select asset.* into asset_row from public.stream_media_assets asset
    where asset.upload_intent_id=upload.intent_id and asset.registry_id=upload.registry_id;
    select binding.* into binding_row from public.stream_media_source_bindings binding
    where binding.asset_id=asset_row.id and binding.registry_id=upload.registry_id
      and binding.raw_provider_uid=asset_row.raw_provider_uid and binding.source_kind=upload.source_kind
      and binding.source_identity=upload.source_identity and binding.owner_id=upload.owner_id
      and binding.parent_kind=context_row.parent_kind and binding.parent_identity=context_row.parent_identity
      and binding.source_revision=context_row.source_revision and binding.binding_state='provisional_bound';
    if asset_row.id is null or binding_row.id is null or asset_row.lifecycle_state<>'provisional_bound'
      or not asset_row.signed_urls_verified or not asset_row.ready_to_stream_verified
      or binding_row.observed_creator is distinct from 'matched_at_exact_readback'
      or binding_row.observed_marker is distinct from 'matched_at_exact_readback' then
      return jsonb_build_object('outcome','unready_canonical_binding_rejected'); end if;
  else
    cleanup_manifest_kind := 'unready_abort';
    select transport.* into transport_row from public.stream_media_upload_transport transport
    where transport.operation_id=upload.id;
    select observation.* into observation_row from public.stream_media_upload_observations observation
    join public.stream_media_upload_observation_clocks observation_clock
      on observation_clock.observation_id=observation.id
    where observation.operation_id=upload.id and observation.registry_id=upload.registry_id
      and observation.observation_kind='exact_uid_get' and observation.http_status=200
      and observation.creator_marker_matched is true and observation.metadata_marker_matched is true
      and (transport_row.provider_uid is null or transport_row.provider_uid=observation.raw_provider_uid)
    order by observation_clock.order_sequence desc limit 1;
    if transport_row.operation_id is null or transport_row.registry_id<>upload.registry_id
      or transport_row.provider_uid is null or transport_row.provider_evidence_digest is null
      or transport_row.request_marker<>intent_row.request_marker
      or observation_row.id is null or observation_row.raw_provider_uid<>transport_row.provider_uid
      or (transport_row.original_metadata->>'request_marker') is distinct from intent_row.request_marker::text
      or (transport_row.original_metadata->>'source_kind') is distinct from upload.source_kind
      or (transport_row.original_metadata->>'source_id') is distinct from upload.source_identity
      or (transport_row.original_metadata->>'actor_id') is distinct from upload.actor_id::text
      or exists (select 1 from public.stream_media_assets asset
        where asset.registry_id=upload.registry_id and asset.raw_provider_uid=transport_row.provider_uid)
      or exists (select 1 from public.stream_media_source_bindings binding
        where binding.registry_id=upload.registry_id and binding.raw_provider_uid=transport_row.provider_uid
          and binding.binding_state in ('legacy_unverified','provisional_bound','ready_for_publication',
            'active','retained','quarantined')) then
      return jsonb_build_object('outcome','known_owned_unready_identity_not_proven'); end if;
    if private.stream_legacy_uid_unresolved(upload.registry_id,transport_row.provider_uid)
      or exists (select 1 from public.stream_media_retention_obligations obligation
        where obligation.raw_provider_uid=transport_row.provider_uid and obligation.obligation_state='active'
          and (obligation.registry_id is null or obligation.registry_id=upload.registry_id)) then
      return jsonb_build_object('outcome','legacy_or_retained_uid_hold'); end if;
    abort_manifest_id := private.stream_media_request_uuid(upload.id::text||':'||target_request_id::text||':upload-abort-manifest');
    abort_manifest_request_id := private.stream_media_request_uuid(upload.id::text||':'||target_request_id::text||':upload-abort-manifest-request');
    abort_manifest_digest := private.stream_media_identity_digest(concat_ws('|','stream_upload_abort_manifest_v1',
      upload.id::text,upload.operation_digest,intent_row.id::text,intent_row.payload_digest,
      context_row.context_digest,observation_row.id::text,observation_row.evidence_digest,
      upload.registry_id::text,transport_row.provider_uid,upload.actor_id::text,upload.owner_id::text,
      context_row.parent_kind,context_row.parent_identity,context_row.source_revision::text,target_request_id::text,
      'actor_request','','','',''));
  end if;
  if (upload.source_kind='video' and exists (select 1 from public.videos video where video.id::text=upload.source_identity))
    or (upload.source_kind='post_media' and exists (select 1 from public.post_media media where media.id::text=upload.source_identity)) then
    return jsonb_build_object('outcome','source_already_committed'); end if;
  if not private.stream_account_is_verified(upload.registry_id) then
    return jsonb_build_object('outcome','account_unverified'); end if;
  if parent_fence.source_kind is null or parent_fence.owner_id<>upload.owner_id
    or parent_fence.source_revision<>context_row.source_revision
    or parent_fence.active_operation_id<>upload.id or parent_fence.fence_state<>'closing' then
    return jsonb_build_object('outcome','source_stale'); end if;
  if exists (select 1 from public.stream_media_operations operation
    where operation.id=cleanup_operation_id or operation.request_id=cleanup_request_id) then
    if not exists (select 1 from public.stream_media_operations operation
      join public.stream_media_operation_states state on state.operation_id=operation.id
      where operation.id=cleanup_operation_id and operation.request_id=cleanup_request_id
        and operation.operation_kind='cleanup' and operation.owner_id=upload.owner_id
        and operation.source_kind=context_row.parent_kind and operation.source_identity=context_row.parent_identity
        and operation.expected_source_revision=context_row.source_revision
        and operation.operation_digest=cleanup_digest and state.operation_state in
          ('cleanup_reserved','delete_started','delete_unknown','source_finalizing','completed')) then
      return jsonb_build_object('outcome','identity_mismatch'); end if;
    return jsonb_build_object('outcome','cancel_in_progress','cleanup_operation_id',cleanup_operation_id,
      'cleanup_manifest_kind',cleanup_manifest_kind);
  end if;
  if not private.stream_try_uid_lock(upload.registry_id,
      case when cleanup_manifest_kind='canonical_provisional' then asset_row.raw_provider_uid else transport_row.provider_uid end) then
    return jsonb_build_object('outcome','uid_busy'); end if;
  insert into public.stream_media_operations(
    id,request_id,operation_kind,actor_id,owner_id,source_kind,source_identity,
    parent_kind,parent_identity,expected_source_revision,registry_id,operation_digest
  ) values(cleanup_operation_id,cleanup_request_id,'cleanup',auth.uid(),upload.owner_id,
    context_row.parent_kind,context_row.parent_identity,context_row.parent_kind,context_row.parent_identity,
    context_row.source_revision,upload.registry_id,cleanup_digest);
  insert into public.stream_media_operation_states(operation_id,operation_state)
  values(cleanup_operation_id,'cleanup_reserved');
  insert into public.stream_media_operation_events(
    operation_id,sequence_number,from_state,to_state,request_id,evidence_digest
  ) values(cleanup_operation_id,1,null,'cleanup_reserved',cleanup_request_id,cleanup_digest);
  if cleanup_manifest_kind='canonical_provisional' then
    insert into public.stream_media_operation_uid_state(operation_id,registry_id,raw_provider_uid,uid_state)
    values(cleanup_operation_id,upload.registry_id,asset_row.raw_provider_uid,'reserved');
    insert into public.stream_media_manifest_edges(
      operation_id,edge_number,binding_id,source_kind,source_identity,source_revision,
      registry_id,raw_provider_uid,detach_allowed
    ) values(cleanup_operation_id,1,binding_row.id,binding_row.source_kind,binding_row.source_identity,
      binding_row.source_revision,binding_row.registry_id,binding_row.raw_provider_uid,false);
    update public.stream_media_assets set lifecycle_state='cleanup_pending',asset_revision=asset_revision+1,
      observed_at=now() where id=asset_row.id and lifecycle_state='provisional_bound';
    if not found then raise exception 'Canonical provisional asset changed during cancel' using errcode='40001'; end if;
  else
    insert into public.stream_media_upload_abort_manifests(
      id,cleanup_operation_id,upload_operation_id,intent_id,context_digest,observation_id,
      registry_id,raw_provider_uid,actor_id,owner_id,parent_kind,parent_identity,parent_revision,
      cleanup_reason,cancel_request_id,request_id,request_digest
    ) values(abort_manifest_id,cleanup_operation_id,upload.id,intent_row.id,context_row.context_digest,
      observation_row.id,upload.registry_id,transport_row.provider_uid,upload.actor_id,upload.owner_id,
      context_row.parent_kind,context_row.parent_identity,context_row.source_revision,'actor_request',target_request_id,
      abort_manifest_request_id,abort_manifest_digest);
    insert into public.stream_media_operation_uid_state(operation_id,registry_id,raw_provider_uid,uid_state)
    values(cleanup_operation_id,upload.registry_id,transport_row.provider_uid,'reserved');
  end if;
  update public.stream_media_parent_fences as cancel_fence set active_operation_id=cleanup_operation_id,
    state_revision=cancel_fence.state_revision+1,updated_at=now()
  where cancel_fence.source_kind=context_row.parent_kind
    and cancel_fence.source_identity=context_row.parent_identity
    and cancel_fence.owner_id=upload.owner_id and cancel_fence.source_revision=context_row.source_revision
    and cancel_fence.active_operation_id=upload.id and cancel_fence.fence_state='closing';
  if not found then raise exception 'Upload cancellation fence changed' using errcode='40001'; end if;
  if private.stream_media_has_effective_reference(upload.registry_id,
      case when cleanup_manifest_kind='canonical_provisional' then asset_row.raw_provider_uid else transport_row.provider_uid end,
      cleanup_operation_id) then
    raise exception 'Upload UID has a competing reference' using errcode='P1C01'; end if;
  return jsonb_build_object('outcome','cancel_reserved','cleanup_operation_id',cleanup_operation_id,
    'cleanup_manifest_kind',cleanup_manifest_kind,'raw_uid_returned',false);
exception when sqlstate 'P1C01' then return jsonb_build_object('outcome','retained_or_shared_uid');
  when unique_violation then return jsonb_build_object('outcome','identity_mismatch');
  when lock_not_available then return jsonb_build_object('outcome','source_busy');
end;
$$;
revoke all on function public.request_stream_media_upload_cancel(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.request_stream_media_upload_cancel(uuid,uuid) to authenticated;

-- Account deletion can reconcile a known unready upload after the actor's session is gone.
-- The only actor and owner values are loaded from the immutable upload intent/operation.
create function public.request_stream_account_media_upload_abort(
  target_tombstone_id uuid,target_upload_operation_id uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  tombstone_row public.stream_media_account_tombstones%rowtype;
  upload_row public.stream_media_operations%rowtype;
  intent_row public.stream_media_upload_intents%rowtype;
  context_row public.stream_media_upload_contexts%rowtype;
  transport_row public.stream_media_upload_transport%rowtype;
  observation_row public.stream_media_upload_observations%rowtype;
  parent_fence public.stream_media_parent_fences%rowtype;
  prior_abort_manifest public.stream_media_upload_abort_manifests%rowtype;
  prior_cleanup public.stream_media_operations%rowtype;
  upload_state text;
  prior_cleanup_state text;
  cancel_request_id uuid;
  cancel_digest text;
  cleanup_operation_id uuid;
  cleanup_request_id uuid;
  abort_manifest_id uuid;
  abort_manifest_request_id uuid;
  abort_manifest_digest text;
  fence_revision bigint;
  prehttp_request_id uuid;
  prehttp_digest text;
  parent_lock_acquired boolean;
  prior_prehttp_receipt public.stream_media_upload_prehttp_cancel_receipts%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Account upload abort is service managed' using errcode='42501'; end if;
  if target_tombstone_id is null or target_upload_operation_id is null then
    raise exception 'Account upload abort request is invalid' using errcode='22023'; end if;
  perform private.stream_require_read_committed();
  select tombstone.* into tombstone_row from public.stream_media_account_tombstones tombstone
  where tombstone.id=target_tombstone_id;
  select upload.* into upload_row from public.stream_media_operations upload
  where upload.id=target_upload_operation_id and upload.operation_kind='upload';
  if tombstone_row.id is null or upload_row.id is null then
    return jsonb_build_object('outcome','operation_or_tombstone_missing'); end if;
  perform pg_advisory_xact_lock(hashtextextended('account:'||tombstone_row.account_id::text,19031003));
  perform private.stream_lock_accounts(array[tombstone_row.account_id]);
  select tombstone.* into tombstone_row from public.stream_media_account_tombstones tombstone
  where tombstone.id=target_tombstone_id for update;
  if tombstone_row.tombstone_state<>'provider_cleanup' or tombstone_row.source_revision_digest is not null
    or upload_row.actor_id<>tombstone_row.account_id or upload_row.owner_id<>tombstone_row.account_id
    or not exists (select 1 from public.stream_media_upload_account_edges account_edge
      where account_edge.intent_id=upload_row.intent_id and account_edge.account_id=tombstone_row.account_id
        and account_edge.relation_kind in ('actor','source_owner')) then
    return jsonb_build_object('outcome','account_or_upload_identity_mismatch'); end if;
  select intent.* into intent_row from public.stream_media_upload_intents intent where intent.id=upload_row.intent_id;
  select context.* into context_row from public.stream_media_upload_contexts context where context.intent_id=upload_row.intent_id;
  if intent_row.id is null or context_row.intent_id is null or context_row.owner_id<>tombstone_row.account_id
    or intent_row.actor_id<>tombstone_row.account_id or intent_row.provider_account_registry_id<>upload_row.registry_id
    or intent_row.source_kind<>upload_row.source_kind or intent_row.source_id::text<>upload_row.source_identity
    or upload_row.source_kind not in ('video','post_media')
    or intent_row.purpose<>(case when upload_row.source_kind='video' then 'library_video' else 'community_video' end) then
    return jsonb_build_object('outcome','upload_context_mismatch'); end if;
  parent_lock_acquired:=private.stream_try_parent_lock(context_row.parent_kind,context_row.parent_identity);
  if not parent_lock_acquired then return jsonb_build_object('outcome','source_busy'); end if;
  select upload.* into upload_row from public.stream_media_operations upload
  where upload.id=target_upload_operation_id and upload.operation_kind='upload' for update;
  select state.operation_state into upload_state from public.stream_media_operation_states state
  where state.operation_id=upload_row.id for update;
  select fence.* into parent_fence from public.stream_media_parent_fences fence
  where fence.source_kind=context_row.parent_kind and fence.source_identity=context_row.parent_identity for update;
  select abort_manifest.* into prior_abort_manifest from public.stream_media_upload_abort_manifests abort_manifest
  where abort_manifest.upload_operation_id=upload_row.id;
  if found and prior_abort_manifest.cleanup_reason='actor_request' then
    cancel_request_id:=prior_abort_manifest.cancel_request_id;
  else
    cancel_request_id:=private.stream_media_request_uuid(
      tombstone_row.request_id::text||':'||upload_row.id::text||':account-cleanup-upload-cancel');
  end if;
  cleanup_operation_id:=private.stream_media_request_uuid(
    upload_row.id::text||':'||cancel_request_id::text||':upload-cancel-operation');
  cleanup_request_id:=private.stream_media_request_uuid(
    upload_row.id::text||':'||cancel_request_id::text||':upload-cancel-operation-request');
  cancel_digest:=private.stream_media_identity_digest(concat_ws('|','stream_upload_cancel_v1',
    upload_row.id::text,upload_row.operation_digest,cancel_request_id::text,context_row.parent_kind,
    context_row.parent_identity,context_row.source_revision::text));
  if found then
    if prior_abort_manifest.cleanup_reason='actor_request' then
      select transport.* into transport_row from public.stream_media_upload_transport transport
      where transport.operation_id=upload_row.id;
      select observation.* into observation_row from public.stream_media_upload_observations observation
      where observation.id=prior_abort_manifest.observation_id;
      abort_manifest_digest:=private.stream_media_identity_digest(concat_ws('|','stream_upload_abort_manifest_v1',
        upload_row.id::text,upload_row.operation_digest,intent_row.id::text,intent_row.payload_digest,
        context_row.context_digest,observation_row.id::text,observation_row.evidence_digest,
        upload_row.registry_id::text,transport_row.provider_uid,upload_row.actor_id::text,upload_row.owner_id::text,
        context_row.parent_kind,context_row.parent_identity,context_row.source_revision::text,cancel_request_id::text,
        'actor_request','','','',''));
      select cleanup.* into prior_cleanup from public.stream_media_operations cleanup
      where cleanup.id=prior_abort_manifest.cleanup_operation_id and cleanup.operation_kind='cleanup';
      select state.operation_state into prior_cleanup_state from public.stream_media_operation_states state
      where state.operation_id=prior_abort_manifest.cleanup_operation_id;
      if prior_abort_manifest.tombstone_id is not null or prior_abort_manifest.tombstone_request_id is not null
        or prior_abort_manifest.tombstone_revision is not null or prior_abort_manifest.tombstone_state_revision is not null
        or prior_abort_manifest.cancel_request_id is distinct from cancel_request_id
        or prior_abort_manifest.cleanup_operation_id is distinct from cleanup_operation_id
        or prior_abort_manifest.upload_operation_id is distinct from upload_row.id
        or prior_abort_manifest.intent_id is distinct from intent_row.id
        or prior_abort_manifest.context_digest is distinct from context_row.context_digest
        or prior_abort_manifest.registry_id is distinct from upload_row.registry_id
        or prior_abort_manifest.raw_provider_uid is distinct from transport_row.provider_uid
        or prior_abort_manifest.actor_id is distinct from upload_row.actor_id
        or prior_abort_manifest.owner_id is distinct from upload_row.owner_id
        or prior_abort_manifest.parent_kind is distinct from context_row.parent_kind
        or prior_abort_manifest.parent_identity is distinct from context_row.parent_identity
        or prior_abort_manifest.parent_revision is distinct from context_row.source_revision
        or observation_row.id is null or observation_row.operation_id is distinct from upload_row.id
        or observation_row.registry_id is distinct from upload_row.registry_id
        or observation_row.raw_provider_uid is distinct from transport_row.provider_uid
        or observation_row.observation_kind is distinct from 'exact_uid_get'
        or observation_row.http_status is distinct from 200
        or observation_row.creator_marker_matched is distinct from true
        or observation_row.metadata_marker_matched is distinct from true
        or prior_abort_manifest.request_digest is distinct from abort_manifest_digest
        or prior_cleanup.id is null or prior_cleanup.request_id is distinct from cleanup_request_id
        or prior_cleanup.actor_id is distinct from upload_row.actor_id
        or prior_cleanup.owner_id is distinct from upload_row.owner_id
        or prior_cleanup.source_kind is distinct from context_row.parent_kind
        or prior_cleanup.source_identity is distinct from context_row.parent_identity
        or prior_cleanup.parent_kind is distinct from context_row.parent_kind
        or prior_cleanup.parent_identity is distinct from context_row.parent_identity
        or prior_cleanup.expected_source_revision is distinct from context_row.source_revision
        or prior_cleanup.registry_id is distinct from upload_row.registry_id
        or prior_cleanup.operation_digest is distinct from cancel_digest
        or prior_cleanup_state not in ('cleanup_reserved','delete_started','delete_unknown','source_finalizing','completed')
        or parent_fence.active_operation_id is distinct from prior_cleanup.id
        or parent_fence.fence_state is distinct from 'closing'
        or parent_fence.source_revision is distinct from context_row.source_revision then
        return jsonb_build_object('outcome','identity_mismatch'); end if;
      if upload_state='canceled' and private.stream_upload_cancel_proven(upload_row.id) then
        return jsonb_build_object('outcome','already_canceled','upload_operation_id',upload_row.id,
          'cleanup_operation_id',prior_cleanup.id,'cancel_request_id',cancel_request_id);
      end if;
      if prior_cleanup_state='completed' then
        return jsonb_build_object('outcome','cleanup_receipt_incomplete'); end if;
      return jsonb_build_object('outcome','account_abort_in_progress','upload_operation_id',upload_row.id,
        'cleanup_operation_id',prior_cleanup.id,'cancel_request_id',cancel_request_id,
        'cleanup_reason','actor_request','tombstone_id',tombstone_row.id,
        'tombstone_revision',tombstone_row.revision);
    end if;
    if prior_abort_manifest.cleanup_reason<>'account_cleanup'
      or prior_abort_manifest.tombstone_id<>tombstone_row.id
      or prior_abort_manifest.tombstone_request_id<>tombstone_row.request_id
      or prior_abort_manifest.cancel_request_id<>cancel_request_id
      or prior_abort_manifest.owner_id<>tombstone_row.account_id
      or tombstone_row.revision<prior_abort_manifest.tombstone_revision then
      return jsonb_build_object('outcome','identity_mismatch'); end if;
    if upload_state='canceled' and private.stream_upload_cancel_proven(upload_row.id) then
      return jsonb_build_object('outcome','already_canceled','upload_operation_id',upload_row.id,
        'cleanup_operation_id',prior_abort_manifest.cleanup_operation_id,'cancel_request_id',cancel_request_id);
    end if;
    return jsonb_build_object('outcome','account_abort_in_progress','upload_operation_id',upload_row.id,
      'cleanup_operation_id',prior_abort_manifest.cleanup_operation_id,'cancel_request_id',cancel_request_id);
  end if;
  if upload_state='failed' then
    select receipt.* into prior_prehttp_receipt from public.stream_media_upload_prehttp_cancel_receipts receipt
    where receipt.operation_id=upload_row.id;
    if found and private.stream_upload_prehttp_cancel_proven(upload_row.id) then
      return jsonb_build_object('outcome','canceled_without_provider_create','upload_operation_id',upload_row.id,
        'cancel_request_id',prior_prehttp_receipt.request_id,'replayed',true);
    end if;
  end if;
  if parent_fence.source_kind is null or parent_fence.owner_id<>tombstone_row.account_id
    or parent_fence.source_revision<>context_row.source_revision then
    return jsonb_build_object('outcome','source_stale'); end if;
  if upload_state='reserved' then
    if parent_fence.active_operation_id<>upload_row.id or parent_fence.fence_state<>'closing'
      or exists (select 1 from public.stream_media_create_claims claim where claim.operation_id=upload_row.id)
      or exists (select 1 from public.stream_media_upload_transport transport
        where transport.operation_id=upload_row.id and (transport.provider_uid is not null or transport.tus_location is not null))
      or exists (select 1 from public.stream_media_assets asset where asset.upload_intent_id=upload_row.intent_id) then
      return jsonb_build_object('outcome','pre_http_absence_not_proven'); end if;
    prehttp_request_id:=cancel_request_id;
    prehttp_digest:=private.stream_media_identity_digest(concat_ws('|','account_pre_http_cancel_v1',
      upload_row.id::text,upload_row.operation_digest,tombstone_row.id::text,tombstone_row.request_id::text,
      tombstone_row.revision::text,tombstone_row.state_revision::text,context_row.context_digest));
    perform private.stream_advance_operation(upload_row.id,'failed',prehttp_request_id,prehttp_digest);
    update public.stream_media_parent_fences fence set fence_state='open',active_operation_id=null,
      source_revision=fence.source_revision+1,state_revision=fence.state_revision+1,updated_at=now()
    where fence.source_kind=context_row.parent_kind and fence.source_identity=context_row.parent_identity
      and fence.owner_id=tombstone_row.account_id and fence.source_revision=context_row.source_revision
      and fence.active_operation_id=upload_row.id and fence.fence_state='closing';
    if not found then raise exception 'Account pre-create cancellation fence changed' using errcode='40001'; end if;
    insert into public.stream_media_upload_prehttp_cancel_receipts(
      operation_id,request_id,request_digest,cleanup_reason,tombstone_id,tombstone_request_id,
      tombstone_revision,tombstone_state_revision
    ) values(upload_row.id,prehttp_request_id,prehttp_digest,'account_cleanup',tombstone_row.id,
      tombstone_row.request_id,tombstone_row.revision,tombstone_row.state_revision);
    if upload_row.source_kind='post_media' then
      perform set_config('app.stream_community_submission_id',(
        select submission.id::text from public.stream_community_video_submissions submission
        where submission.operation_id=upload_row.id and submission.submission_state='processing'),true);
      update public.stream_community_video_submissions set submission_state='canceled'
      where operation_id=upload_row.id and submission_state='processing';
    end if;
    return jsonb_build_object('outcome','canceled_without_provider_create','upload_operation_id',upload_row.id,
      'cancel_request_id',cancel_request_id);
  end if;
  if upload_state not in ('create_unknown','created_unverified') then
    return jsonb_build_object('outcome','upload_reconciliation_required','operation_state',upload_state); end if;
  select transport.* into transport_row from public.stream_media_upload_transport transport
  where transport.operation_id=upload_row.id;
  select observation.* into observation_row from public.stream_media_upload_observations observation
  join public.stream_media_upload_observation_clocks observation_clock
    on observation_clock.observation_id=observation.id
  where observation.operation_id=upload_row.id and observation.registry_id=upload_row.registry_id
    and observation.observation_kind='exact_uid_get' and observation.http_status=200
    and observation.creator_marker_matched is true and observation.metadata_marker_matched is true
    and transport_row.provider_uid=observation.raw_provider_uid
  order by observation_clock.order_sequence desc limit 1;
  if transport_row.operation_id is null or transport_row.registry_id<>upload_row.registry_id
    or transport_row.provider_uid is null or transport_row.provider_evidence_digest is null
    or transport_row.request_marker<>intent_row.request_marker or observation_row.id is null
    or transport_row.original_metadata->>'request_marker'<>intent_row.request_marker::text
    or transport_row.original_metadata->>'source_kind'<>upload_row.source_kind
    or transport_row.original_metadata->>'source_id'<>upload_row.source_identity
    or transport_row.original_metadata->>'actor_id'<>upload_row.actor_id::text
    or parent_fence.active_operation_id<>upload_row.id or parent_fence.fence_state<>'closing'
    or exists (select 1 from public.videos video where video.id::text=upload_row.source_identity)
    or exists (select 1 from public.post_media media where media.id::text=upload_row.source_identity)
    or exists (select 1 from public.stream_media_assets asset
      where asset.registry_id=upload_row.registry_id and asset.raw_provider_uid=transport_row.provider_uid)
    or exists (select 1 from public.stream_media_source_bindings binding
      where binding.registry_id=upload_row.registry_id and binding.raw_provider_uid=transport_row.provider_uid
        and binding.binding_state in ('legacy_unverified','provisional_bound','ready_for_publication',
          'active','retained','quarantined')) then
    return jsonb_build_object('outcome','known_owned_unready_identity_not_proven'); end if;
  if not private.stream_account_is_verified(upload_row.registry_id)
    or private.stream_legacy_uid_unresolved(upload_row.registry_id,transport_row.provider_uid)
    or exists (select 1 from public.stream_media_retention_obligations obligation
      where obligation.raw_provider_uid=transport_row.provider_uid and obligation.obligation_state='active'
        and (obligation.registry_id is null or obligation.registry_id=upload_row.registry_id)) then
    return jsonb_build_object('outcome','legacy_or_retained_uid_hold'); end if;
  if not private.stream_try_uid_lock(upload_row.registry_id,transport_row.provider_uid)
    or private.stream_media_has_effective_reference(upload_row.registry_id,transport_row.provider_uid,cleanup_operation_id) then
    return jsonb_build_object('outcome','retained_or_shared_uid'); end if;
  abort_manifest_id:=private.stream_media_request_uuid(
    upload_row.id::text||':'||cancel_request_id::text||':upload-abort-manifest');
  abort_manifest_request_id:=private.stream_media_request_uuid(
    upload_row.id::text||':'||cancel_request_id::text||':upload-abort-manifest-request');
  abort_manifest_digest:=private.stream_media_identity_digest(concat_ws('|','stream_upload_abort_manifest_v1',
    upload_row.id::text,upload_row.operation_digest,intent_row.id::text,intent_row.payload_digest,
    context_row.context_digest,observation_row.id::text,observation_row.evidence_digest,
    upload_row.registry_id::text,transport_row.provider_uid,upload_row.actor_id::text,upload_row.owner_id::text,
    context_row.parent_kind,context_row.parent_identity,context_row.source_revision::text,cancel_request_id::text,
    'account_cleanup',tombstone_row.id::text,tombstone_row.request_id::text,
    tombstone_row.revision::text,tombstone_row.state_revision::text));
  insert into public.stream_media_operations(
    id,request_id,operation_kind,actor_id,owner_id,source_kind,source_identity,
    parent_kind,parent_identity,expected_source_revision,registry_id,operation_digest
  ) values(cleanup_operation_id,cleanup_request_id,'cleanup',upload_row.actor_id,upload_row.owner_id,
    context_row.parent_kind,context_row.parent_identity,context_row.parent_kind,context_row.parent_identity,
    context_row.source_revision,upload_row.registry_id,cancel_digest);
  insert into public.stream_media_operation_states(operation_id,operation_state)
  values(cleanup_operation_id,'cleanup_reserved');
  insert into public.stream_media_operation_events(
    operation_id,sequence_number,from_state,to_state,request_id,evidence_digest
  ) values(cleanup_operation_id,1,null,'cleanup_reserved',cleanup_request_id,cancel_digest);
  insert into public.stream_media_upload_abort_manifests(
    id,cleanup_operation_id,upload_operation_id,intent_id,context_digest,observation_id,
    registry_id,raw_provider_uid,actor_id,owner_id,parent_kind,parent_identity,parent_revision,
    cleanup_reason,cancel_request_id,tombstone_id,tombstone_request_id,tombstone_revision,tombstone_state_revision,
    request_id,request_digest
  ) values(abort_manifest_id,cleanup_operation_id,upload_row.id,intent_row.id,context_row.context_digest,
    observation_row.id,upload_row.registry_id,transport_row.provider_uid,upload_row.actor_id,upload_row.owner_id,
    context_row.parent_kind,context_row.parent_identity,context_row.source_revision,'account_cleanup',cancel_request_id,
    tombstone_row.id,tombstone_row.request_id,tombstone_row.revision,tombstone_row.state_revision,
    abort_manifest_request_id,abort_manifest_digest);
  insert into public.stream_media_operation_uid_state(operation_id,registry_id,raw_provider_uid,uid_state)
  values(cleanup_operation_id,upload_row.registry_id,transport_row.provider_uid,'reserved');
  update public.stream_media_parent_fences fence set active_operation_id=cleanup_operation_id,
    state_revision=fence.state_revision+1,updated_at=now()
  where fence.source_kind=context_row.parent_kind and fence.source_identity=context_row.parent_identity
    and fence.owner_id=tombstone_row.account_id and fence.source_revision=context_row.source_revision
    and fence.active_operation_id=upload_row.id and fence.fence_state='closing';
  if not found then raise exception 'Account upload abort fence changed' using errcode='40001'; end if;
  return jsonb_build_object('outcome','account_abort_required','upload_operation_id',upload_row.id,
    'cleanup_operation_id',cleanup_operation_id,'cancel_request_id',cancel_request_id,
    'tombstone_id',tombstone_row.id,'tombstone_revision',tombstone_row.revision);
exception when unique_violation then return jsonb_build_object('outcome','identity_mismatch');
  when lock_not_available then return jsonb_build_object('outcome','source_busy');
end;
$$;
revoke all on function public.request_stream_account_media_upload_abort(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.request_stream_account_media_upload_abort(uuid,uuid) to service_role;

create function public.get_stream_media_upload_cancel_work(target_cleanup_operation_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  cleanup public.stream_media_operations%rowtype;
  state_value text;
  canonical_edge public.stream_media_manifest_edges%rowtype;
  abort_manifest public.stream_media_upload_abort_manifests%rowtype;
  binding_row public.stream_media_source_bindings%rowtype;
  asset_row public.stream_media_assets%rowtype;
  upload public.stream_media_operations%rowtype;
  context_row public.stream_media_upload_contexts%rowtype;
  intent_row public.stream_media_upload_intents%rowtype;
  observation_row public.stream_media_upload_observations%rowtype;
  transport_row public.stream_media_upload_transport%rowtype;
  work_registry_id uuid;
  work_uid text;
  work_kind text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Upload cancellation work is service managed' using errcode='42501'; end if;
  select operation.* into cleanup from public.stream_media_operations operation
  where operation.id=target_cleanup_operation_id and operation.operation_kind='cleanup';
  select state.operation_state into state_value from public.stream_media_operation_states state
  where state.operation_id=target_cleanup_operation_id;
  if cleanup.id is null or state_value not in ('cleanup_reserved','delete_started','delete_unknown')
    or not private.stream_account_is_verified(cleanup.registry_id) then
    return jsonb_build_object('outcome','unavailable'); end if;
  select edge.* into canonical_edge from public.stream_media_manifest_edges edge
  where edge.operation_id=cleanup.id and edge.edge_number=1;
  select manifest.* into abort_manifest from public.stream_media_upload_abort_manifests manifest
  where manifest.cleanup_operation_id=cleanup.id;
  if canonical_edge.operation_id is not null and abort_manifest.id is null then
    select binding.* into binding_row from public.stream_media_source_bindings binding
    where binding.id=canonical_edge.binding_id and binding.binding_state='provisional_bound'
      and binding.registry_id=canonical_edge.registry_id and binding.raw_provider_uid=canonical_edge.raw_provider_uid;
    select asset.* into asset_row from public.stream_media_assets asset
    where asset.id=binding_row.asset_id and asset.lifecycle_state='cleanup_pending'
      and asset.signed_urls_verified and asset.ready_to_stream_verified;
    if binding_row.id is null or asset_row.id is null or canonical_edge.edge_number<>1
      or (select count(*) from public.stream_media_manifest_edges edge where edge.operation_id=cleanup.id)<>1
      or private.stream_legacy_uid_unresolved(canonical_edge.registry_id,canonical_edge.raw_provider_uid)
      or private.stream_media_has_effective_reference(canonical_edge.registry_id,canonical_edge.raw_provider_uid,cleanup.id)
      or not private.stream_manifest_edge_authorized(cleanup.id,canonical_edge.source_kind,
        canonical_edge.source_identity,canonical_edge.registry_id,canonical_edge.raw_provider_uid) then
      return jsonb_build_object('outcome','unavailable'); end if;
    work_registry_id:=canonical_edge.registry_id; work_uid:=canonical_edge.raw_provider_uid;
    work_kind:='canonical_provisional';
  elsif canonical_edge.operation_id is null and abort_manifest.id is not null then
    select operation.* into upload from public.stream_media_operations operation
    where operation.id=abort_manifest.upload_operation_id and operation.operation_kind='upload';
    select intent.* into intent_row from public.stream_media_upload_intents intent where intent.id=upload.intent_id;
    select context.* into context_row from public.stream_media_upload_contexts context where context.intent_id=upload.intent_id;
    select transport.* into transport_row from public.stream_media_upload_transport transport
    where transport.operation_id=upload.id;
    select observation.* into observation_row from public.stream_media_upload_observations observation
    where observation.id=abort_manifest.observation_id;
    if upload.id is null or intent_row.id is null or context_row.intent_id is null
      or abort_manifest.intent_id<>intent_row.id or abort_manifest.context_digest<>context_row.context_digest
      or abort_manifest.registry_id<>upload.registry_id or abort_manifest.raw_provider_uid<>transport_row.provider_uid
      or abort_manifest.raw_provider_uid<>observation_row.raw_provider_uid
      or abort_manifest.actor_id<>upload.actor_id or abort_manifest.owner_id<>upload.owner_id
      or abort_manifest.parent_kind<>context_row.parent_kind or abort_manifest.parent_identity<>context_row.parent_identity
      or abort_manifest.parent_revision<>context_row.source_revision
      or observation_row.operation_id<>upload.id or observation_row.observation_kind<>'exact_uid_get'
      or observation_row.http_status<>200 or observation_row.creator_marker_matched is distinct from true
      or observation_row.metadata_marker_matched is distinct from true
      or private.stream_legacy_uid_unresolved(abort_manifest.registry_id,abort_manifest.raw_provider_uid)
      or private.stream_media_has_effective_reference(abort_manifest.registry_id,abort_manifest.raw_provider_uid,cleanup.id)
      or not exists (select 1 from public.stream_media_parent_fences fence
        where fence.source_kind=cleanup.parent_kind and fence.source_identity=cleanup.parent_identity
          and fence.owner_id=cleanup.owner_id and fence.source_revision=cleanup.expected_source_revision
          and fence.active_operation_id=cleanup.id and fence.fence_state='closing') then
      return jsonb_build_object('outcome','unavailable'); end if;
    work_registry_id:=abort_manifest.registry_id; work_uid:=abort_manifest.raw_provider_uid;
    work_kind:='unready_abort';
  else
    return jsonb_build_object('outcome','unavailable');
  end if;
  return jsonb_build_object('outcome','ready','cleanup_operation_id',cleanup.id,
    'cleanup_manifest_kind',work_kind,'registry_id',work_registry_id,'provider_uid',work_uid,
    'provider_host','fixed-by-adapter','account_path','registry-bound');
end;
$$;
revoke all on function public.get_stream_media_upload_cancel_work(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_stream_media_upload_cancel_work(uuid) to service_role;

create function public.finalize_stream_media_upload_cancel(
  target_upload_operation_id uuid,target_cancel_request_id uuid,
  target_cleanup_operation_id uuid,target_absence_request_id uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  upload public.stream_media_operations%rowtype;
  intent_row public.stream_media_upload_intents%rowtype;
  context_row public.stream_media_upload_contexts%rowtype;
  state_value text;
  cleanup public.stream_media_operations%rowtype;
  cleanup_state text;
  canonical_edge public.stream_media_manifest_edges%rowtype;
  abort_manifest public.stream_media_upload_abort_manifests%rowtype;
  binding_row public.stream_media_source_bindings%rowtype;
  asset_row public.stream_media_assets%rowtype;
  transport_row public.stream_media_upload_transport%rowtype;
  observation_row public.stream_media_upload_observations%rowtype;
  uid_state public.stream_media_operation_uid_state%rowtype;
  absence_event public.stream_media_operation_uid_events%rowtype;
  prior_receipt public.stream_media_upload_cancel_receipts%rowtype;
  parent_fence public.stream_media_parent_fences%rowtype;
  final_response jsonb;
  cancel_digest text;
  detach_request uuid;
  cleanup_final_request uuid;
  cleanup_final_transition uuid;
  next_revision bigint;
  submission_id uuid;
  manifest_kind text;
  cleanup_reason text;
  known_uid text;
  eligible_absence boolean;
  absence_order_sequence bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Upload cancellation finalization is service managed' using errcode='42501'; end if;
  if target_upload_operation_id is null or target_cancel_request_id is null
    or target_cleanup_operation_id is null or target_absence_request_id is null then
    raise exception 'Upload cancellation finalization is invalid' using errcode='22023'; end if;
  perform private.stream_require_read_committed();
  select operation.* into upload from public.stream_media_operations operation
  where operation.id=target_upload_operation_id and operation.operation_kind='upload';
  if not found then return jsonb_build_object('outcome','operation_missing'); end if;
  select intent.* into intent_row from public.stream_media_upload_intents intent where intent.id=upload.intent_id;
  select context.* into context_row from public.stream_media_upload_contexts context where context.intent_id=upload.intent_id;
  perform private.stream_lock_accounts(array[upload.actor_id,upload.owner_id]);
  perform pg_advisory_xact_lock(hashtextextended(context_row.parent_kind||':'||context_row.parent_identity,19031002));
  select operation.* into upload from public.stream_media_operations operation
  where operation.id=target_upload_operation_id and operation.operation_kind='upload' for update;
  select operation.* into cleanup from public.stream_media_operations operation
  where operation.id=target_cleanup_operation_id and operation.operation_kind='cleanup' for update;
  if not found or cleanup.owner_id<>upload.owner_id or cleanup.source_kind<>context_row.parent_kind
    or cleanup.source_identity<>context_row.parent_identity or cleanup.parent_kind<>context_row.parent_kind
    or cleanup.parent_identity<>context_row.parent_identity
    or cleanup.expected_source_revision<>context_row.source_revision
    or cleanup.id<>private.stream_media_request_uuid(upload.id::text||':'||target_cancel_request_id::text||':upload-cancel-operation') then
    return jsonb_build_object('outcome','cleanup_identity_mismatch'); end if;
  select state.operation_state into state_value from public.stream_media_operation_states state
  where state.operation_id=upload.id for update;
  select state.operation_state into cleanup_state from public.stream_media_operation_states state
  where state.operation_id=cleanup.id for update;
  select receipt.* into prior_receipt from public.stream_media_upload_cancel_receipts receipt
  where receipt.operation_id=upload.id;
  if found then
    if prior_receipt.request_id<>target_cancel_request_id or prior_receipt.cleanup_operation_id<>cleanup.id
      or not private.stream_upload_cancel_proven(upload.id) then
      return jsonb_build_object('outcome','identity_mismatch'); end if;
    return jsonb_build_object('outcome','canceled','upload_operation_id',upload.id,
      'cleanup_operation_id',cleanup.id,'replayed',true);
  end if;
  select edge.* into canonical_edge from public.stream_media_manifest_edges edge
  where edge.operation_id=cleanup.id and edge.edge_number=1;
  select manifest.* into abort_manifest from public.stream_media_upload_abort_manifests manifest
  where manifest.cleanup_operation_id=cleanup.id;
  select transport.* into transport_row from public.stream_media_upload_transport transport
  where transport.operation_id=upload.id;
  if canonical_edge.operation_id is not null and abort_manifest.id is null then
    manifest_kind:='canonical_provisional';
    select binding.* into binding_row from public.stream_media_source_bindings binding
    where binding.id=canonical_edge.binding_id and binding.source_kind=upload.source_kind
      and binding.source_identity=upload.source_identity and binding.owner_id=upload.owner_id
      and binding.parent_kind=context_row.parent_kind and binding.parent_identity=context_row.parent_identity
      and binding.source_revision=context_row.source_revision and binding.binding_state='provisional_bound' for update;
    select asset.* into asset_row from public.stream_media_assets asset
    where asset.id=binding_row.asset_id and asset.lifecycle_state='cleanup_pending'
      and asset.signed_urls_verified and asset.ready_to_stream_verified for update;
    known_uid:=canonical_edge.raw_provider_uid;
    if state_value<>'provisional_bound' or binding_row.id is null or asset_row.id is null
      or canonical_edge.registry_id<>upload.registry_id or canonical_edge.source_kind<>upload.source_kind
      or canonical_edge.source_identity<>upload.source_identity
      or canonical_edge.source_revision<>context_row.source_revision
      or transport_row.provider_uid<>known_uid or transport_row.registry_id<>upload.registry_id
      or (select count(*) from public.stream_media_manifest_edges edge where edge.operation_id=cleanup.id)<>1 then
      return jsonb_build_object('outcome','canonical_provisional_manifest_mismatch'); end if;
  elsif canonical_edge.operation_id is null and abort_manifest.id is not null then
    manifest_kind:='unready_abort';
    select observation.* into observation_row from public.stream_media_upload_observations observation
    where observation.id=abort_manifest.observation_id;
    known_uid:=abort_manifest.raw_provider_uid;
    if state_value not in ('create_unknown','created_unverified')
      or abort_manifest.upload_operation_id<>upload.id or abort_manifest.intent_id<>intent_row.id
      or abort_manifest.context_digest<>context_row.context_digest
      or abort_manifest.registry_id<>upload.registry_id or abort_manifest.raw_provider_uid<>transport_row.provider_uid
      or abort_manifest.actor_id<>upload.actor_id or abort_manifest.owner_id<>upload.owner_id
      or abort_manifest.parent_kind<>context_row.parent_kind or abort_manifest.parent_identity<>context_row.parent_identity
      or abort_manifest.parent_revision<>context_row.source_revision
      or observation_row.operation_id<>upload.id or observation_row.registry_id<>upload.registry_id
      or observation_row.raw_provider_uid<>known_uid or observation_row.observation_kind<>'exact_uid_get'
      or observation_row.http_status<>200 or observation_row.creator_marker_matched is distinct from true
      or observation_row.metadata_marker_matched is distinct from true
      or (select count(*) from public.stream_media_upload_abort_manifests manifest where manifest.cleanup_operation_id=cleanup.id)<>1
      or (select count(*) from public.stream_media_manifest_edges edge where edge.operation_id=cleanup.id)<>0
      or exists (select 1 from public.stream_media_assets asset
        where asset.registry_id=upload.registry_id and asset.raw_provider_uid=known_uid)
      or exists (select 1 from public.stream_media_source_bindings binding
        where binding.registry_id=upload.registry_id and binding.raw_provider_uid=known_uid
          and binding.binding_state in ('legacy_unverified','provisional_bound','ready_for_publication',
            'active','retained','quarantined')) then
      return jsonb_build_object('outcome','cleanup_only_abort_manifest_mismatch'); end if;
  else
    return jsonb_build_object('outcome','cleanup_manifest_missing_or_ambiguous');
  end if;
  cleanup_reason:=case when abort_manifest.id is null then 'actor_request' else abort_manifest.cleanup_reason end;
  select state.* into uid_state from public.stream_media_operation_uid_state state
  where state.operation_id=cleanup.id and state.registry_id=upload.registry_id
    and state.raw_provider_uid=known_uid for update;
  select event.* into absence_event from public.stream_media_operation_uid_events event
  where event.operation_id=cleanup.id and event.registry_id=upload.registry_id
    and event.raw_provider_uid=known_uid and event.request_id=target_absence_request_id
    and event.outcome in ('deleted_confirmed','already_absent_confirmed');
  select event_clock.order_sequence into absence_order_sequence
  from public.stream_media_operation_uid_event_clocks event_clock
  where event_clock.event_id=absence_event.id;
  eligible_absence := (uid_state.uid_state='deleted_confirmed'
      and absence_event.outcome='deleted_confirmed' and absence_event.delete_http_status between 200 and 299
      and absence_event.http_status=404)
    or (uid_state.uid_state='already_absent_confirmed'
      and absence_event.outcome='already_absent_confirmed' and absence_event.delete_http_status is null
      and absence_event.http_status=404
      and exists (select 1 from public.stream_media_operation_uid_events started
        where started.operation_id=cleanup.id and started.registry_id=upload.registry_id
          and started.raw_provider_uid=known_uid and started.outcome='delete_started'
          and started.sequence_number<absence_event.sequence_number));
  if cleanup_state not in ('delete_started','delete_unknown')
    or uid_state.last_event_id is distinct from absence_event.id or absence_event.id is null
    or absence_order_sequence is null
    or not coalesce(eligible_absence,false)
    or not exists (select 1 from public.stream_media_parent_fences fence
      where fence.source_kind=context_row.parent_kind and fence.source_identity=context_row.parent_identity
        and fence.owner_id=upload.owner_id and fence.source_revision=context_row.source_revision
        and fence.active_operation_id=cleanup.id and fence.fence_state='closing')
    or not private.stream_account_is_verified(upload.registry_id)
    or private.stream_legacy_uid_unresolved(upload.registry_id,known_uid)
    or exists (select 1 from public.stream_media_upload_observations contradictory
      join public.stream_media_upload_observation_clocks contradictory_clock
        on contradictory_clock.observation_id=contradictory.id
      where contradictory.operation_id=upload.id and contradictory.registry_id=upload.registry_id
        and contradictory.raw_provider_uid=known_uid and contradictory.observation_kind='exact_uid_get'
        and contradictory.http_status=200 and contradictory_clock.order_sequence>absence_order_sequence) then
    return jsonb_build_object('outcome','qualified_exact_absence_required'); end if;
  if (upload.source_kind='video' and exists (select 1 from public.videos video where video.id::text=upload.source_identity))
    or (upload.source_kind='post_media' and exists (select 1 from public.post_media media where media.id::text=upload.source_identity)) then
    return jsonb_build_object('outcome','source_already_committed'); end if;
  if not private.stream_try_uid_lock(upload.registry_id,known_uid)
    or private.stream_media_has_effective_reference(upload.registry_id,known_uid,cleanup.id) then
    return jsonb_build_object('outcome','retained_or_shared_uid'); end if;
  cancel_digest := private.stream_media_identity_digest(concat_ws('|','stream_upload_cancel_absence_v1',
    upload.id::text,upload.operation_digest,target_cancel_request_id::text,cleanup.id::text,
    upload.registry_id::text,known_uid,context_row.parent_kind,context_row.parent_identity,
    context_row.source_revision::text,absence_event.evidence_digest,cleanup_reason,
    coalesce(abort_manifest.tombstone_id::text,''),coalesce(abort_manifest.tombstone_request_id::text,''),
    coalesce(abort_manifest.tombstone_revision::text,''),coalesce(abort_manifest.tombstone_state_revision::text,'')));
  if manifest_kind='canonical_provisional' then
    detach_request:=private.stream_media_request_uuid(cleanup.id::text||':'||target_cancel_request_id::text||':upload-cancel-detach');
    update public.stream_media_source_bindings as detached_binding set binding_state='detached',
      state_revision=detached_binding.state_revision+1,updated_at=now(),evidence_digest=cancel_digest
    where detached_binding.id=binding_row.id returning * into binding_row;
    update public.stream_media_assets set lifecycle_state='deleted_confirmed',asset_revision=asset_revision+1,
      observed_at=now(),evidence_digest=cancel_digest where id=asset_row.id returning * into asset_row;
    insert into public.stream_media_source_binding_events(
      binding_id,event_kind,source_revision,request_id,evidence_digest
    ) values(binding_row.id,'detached',context_row.source_revision,detach_request,cancel_digest);
    insert into public.stream_media_asset_events(asset_id,event_kind,asset_revision,request_id,evidence_digest)
    values(asset_row.id,'delete_confirmed',asset_row.asset_revision,target_cancel_request_id,cancel_digest);
  end if;
  cleanup_final_transition:=private.stream_media_request_uuid(cleanup.id::text||':upload-cancel-source-finalizing');
  if cleanup_state in ('delete_started','delete_unknown') then
    perform private.stream_advance_operation(cleanup.id,'source_finalizing',cleanup_final_transition,cancel_digest);
  end if;
  if private.stream_media_has_effective_reference(upload.registry_id,known_uid,cleanup.id) then
    raise exception 'A competing media reference appeared during upload cancellation' using errcode='40001'; end if;
  insert into public.stream_media_upload_cancel_receipts(
    operation_id,request_id,request_digest,observation_request_id,cleanup_operation_id,
    cleanup_manifest_kind,abort_manifest_id,cleanup_reason,tombstone_id,tombstone_request_id,
    tombstone_revision,tombstone_state_revision,registry_id,raw_provider_uid,exact_absence_status,
    absence_evidence_digest,actor_id,owner_id,parent_kind,parent_identity,parent_revision,created_at
  ) values(upload.id,target_cancel_request_id,cancel_digest,target_absence_request_id,cleanup.id,
    manifest_kind,case when manifest_kind='unready_abort' then abort_manifest.id else null end,
    cleanup_reason,abort_manifest.tombstone_id,abort_manifest.tombstone_request_id,
    abort_manifest.tombstone_revision,abort_manifest.tombstone_state_revision,
    upload.registry_id,known_uid,404,absence_event.evidence_digest,upload.actor_id,upload.owner_id,
    context_row.parent_kind,context_row.parent_identity,context_row.source_revision,clock_timestamp());
  update public.stream_media_parent_fences as canceled_fence set fence_state='open',active_operation_id=null,
    source_revision=canceled_fence.source_revision+1,state_revision=canceled_fence.state_revision+1,updated_at=now()
  where canceled_fence.source_kind=context_row.parent_kind
    and canceled_fence.source_identity=context_row.parent_identity
    and canceled_fence.owner_id=upload.owner_id and canceled_fence.source_revision=context_row.source_revision
    and canceled_fence.active_operation_id=cleanup.id and canceled_fence.fence_state='closing';
  if not found then raise exception 'Upload cancellation fence changed during finalize' using errcode='40001'; end if;
  next_revision:=private.stream_advance_operation(upload.id,'canceled',target_cancel_request_id,cancel_digest);
  if upload.source_kind='post_media' then
    select submission.id into submission_id from public.stream_community_video_submissions submission
    where submission.operation_id=upload.id and submission.submission_state='processing';
    if submission_id is not null then
      perform set_config('app.stream_community_submission_id',submission_id::text,true);
      update public.stream_community_video_submissions set submission_state='canceled'
      where id=submission_id and submission_state='processing';
      if not found then raise exception 'Community upload submission changed during cancel' using errcode='40001'; end if;
    end if;
  end if;
  cleanup_final_request:=private.stream_media_request_uuid(cleanup.id::text||':'||target_cancel_request_id::text||':upload-cancel-completed');
  perform private.stream_advance_operation(cleanup.id,'completed',cleanup_final_request,cancel_digest);
  final_response:=jsonb_build_object('outcome','upload_cancel_complete','upload_operation_id',upload.id,
    'cleanup_operation_id',cleanup.id,'raw_provider_uid',known_uid,'cleanup_manifest_kind',manifest_kind,
    'operation_revision',next_revision);
  insert into public.stream_media_finalization_receipts(
    operation_id,request_id,request_digest,terminal_state,response
  ) values(cleanup.id,target_cancel_request_id,cancel_digest,'completed',final_response);
  if not private.stream_upload_cancel_proven(upload.id) then
    raise exception 'Upload cancellation receipt failed its immutable proof check' using errcode='23514'; end if;
  return jsonb_build_object('outcome','canceled','upload_operation_id',upload.id,
    'cleanup_operation_id',cleanup.id,'replayed',false);
exception when unique_violation then return jsonb_build_object('outcome','identity_mismatch');
  when lock_not_available then return jsonb_build_object('outcome','source_busy');
end;
$$;
revoke all on function public.finalize_stream_media_upload_cancel(uuid,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.finalize_stream_media_upload_cancel(uuid,uuid,uuid,uuid) to service_role;

create or replace function private.guard_stream_community_video_submission()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  selected_id uuid;
  cancel_allowed boolean := false;
begin
  if tg_op='INSERT' then return new; end if;
  if tg_op='DELETE' then
    raise exception 'Community video submission evidence is immutable' using errcode='55000';
  end if;
  begin
    selected_id := nullif(current_setting('app.stream_community_submission_id',true),'')::uuid;
  exception when invalid_text_representation then
    selected_id := null;
  end;
  if old.submission_state='processing' and new.submission_state='canceled'
    and selected_id=old.id then
    select private.stream_upload_cancel_receipt_matches(item.operation_id)
      or private.stream_upload_prehttp_cancel_proven(item.operation_id)
      into cancel_allowed
    from public.stream_community_video_submissions item where item.id=old.id;
  end if;
  if selected_id is distinct from old.id
    or old.submission_state<>'processing'
    or not (
      (new.submission_state='published' and new.published_at is not null)
      or (new.submission_state='canceled' and new.published_at is null and cancel_allowed)
    )
    or (to_jsonb(new) - array['submission_state','published_at']) <>
       (to_jsonb(old) - array['submission_state','published_at']) then
    raise exception 'Only the exact atomic publication or absence cancellation can finish a submission'
      using errcode='55000';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_stream_community_video_submission()
  from public,anon,authenticated,service_role;

create or replace function private.stream_upload_prehttp_cancel_proven(target_upload_operation_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.stream_media_operations upload
    join public.stream_media_operation_states state on state.operation_id=upload.id
      and state.operation_state='failed'
    join public.stream_media_upload_contexts context on context.intent_id=upload.intent_id
    join public.stream_media_parent_fences fence on fence.source_kind=context.parent_kind
      and fence.source_identity=context.parent_identity and fence.owner_id=context.owner_id
      and fence.fence_state='open' and fence.active_operation_id is null
      and fence.source_revision>context.source_revision
    join public.stream_media_upload_prehttp_cancel_receipts receipt on receipt.operation_id=upload.id
    where upload.id=target_upload_operation_id and upload.operation_kind='upload'
      and exists (select 1 from public.stream_media_operation_events event
        where event.operation_id=upload.id and event.request_id=receipt.request_id
          and event.to_state='failed' and event.evidence_digest=receipt.request_digest)
      and not exists (select 1 from public.stream_media_create_claims claim where claim.operation_id=upload.id)
      and not exists (select 1 from public.stream_media_upload_transport transport
        where transport.operation_id=upload.id and (transport.provider_uid is not null or transport.tus_location is not null))
      and not exists (select 1 from public.stream_media_assets asset where asset.upload_intent_id=upload.intent_id)
      and not exists (select 1 from public.stream_media_source_bindings binding
        where binding.source_kind=upload.source_kind and binding.source_identity=upload.source_identity
          and binding.binding_state='provisional_bound')
      and ((receipt.cleanup_reason='actor_request' and receipt.tombstone_id is null)
        or (receipt.cleanup_reason='account_cleanup' and exists (
          select 1 from public.stream_media_account_tombstones tombstone
          where tombstone.id=receipt.tombstone_id and tombstone.account_id=upload.owner_id
            and tombstone.request_id=receipt.tombstone_request_id
            and tombstone.revision>=receipt.tombstone_revision
            and tombstone.state_revision>=receipt.tombstone_state_revision)))
  );
$$;
revoke all on function private.stream_upload_prehttp_cancel_proven(uuid)
  from public,anon,authenticated,service_role;

create function public.cancel_stream_media_upload_before_create(target_operation_id uuid,target_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  upload public.stream_media_operations%rowtype;
  intent_row public.stream_media_upload_intents%rowtype;
  context_row public.stream_media_upload_contexts%rowtype;
  state_value text;
  parent_fence_row public.stream_media_parent_fences%rowtype;
  next_revision bigint;
  submission_id uuid;
  cancel_digest text;
  prior_prehttp_receipt public.stream_media_upload_prehttp_cancel_receipts%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null then
    raise exception 'Signed-in upload cancellation is required' using errcode='42501';
  end if;
  if target_operation_id is null or target_request_id is null then
    raise exception 'Pre-create upload cancellation request is invalid' using errcode='22023';
  end if;
  perform private.stream_require_read_committed();
  select operation.* into upload from public.stream_media_operations operation
  where operation.id=target_operation_id and operation.operation_kind='upload'
    and operation.actor_id=auth.uid() and operation.owner_id=auth.uid();
  if not found then return jsonb_build_object('outcome','unavailable'); end if;
  select context.* into context_row from public.stream_media_upload_contexts context
  where context.intent_id=upload.intent_id;
  perform private.stream_lock_accounts(array[auth.uid()]);
  if not private.stream_try_parent_lock(context_row.parent_kind,context_row.parent_identity) then
    return jsonb_build_object('outcome','source_busy');
  end if;
  select operation.* into upload from public.stream_media_operations operation
  where operation.id=target_operation_id for update;
  select state.operation_state into state_value from public.stream_media_operation_states state
  where state.operation_id=target_operation_id for update;
  if state_value not in ('reserved','failed') then
    return jsonb_build_object('outcome','cancel_reconciliation_required','operation_state',state_value);
  end if;
  if exists (select 1 from public.stream_media_create_claims claim where claim.operation_id=upload.id)
    or exists (select 1 from public.stream_media_upload_transport transport
      where transport.operation_id=upload.id and (transport.provider_uid is not null or transport.tus_location is not null))
    or exists (select 1 from public.stream_media_assets asset where asset.upload_intent_id=upload.intent_id) then
    return jsonb_build_object('outcome','cancel_reconciliation_required');
  end if;
  select fence.* into parent_fence_row from public.stream_media_parent_fences fence
  where fence.source_kind=context_row.parent_kind and fence.source_identity=context_row.parent_identity for update;
  if not found or parent_fence_row.owner_id<>auth.uid() then
    return jsonb_build_object('outcome','source_stale');
  end if;
  cancel_digest := private.stream_media_identity_digest(concat_ws('|','pre_http_cancel_v1',
    upload.id::text,upload.operation_digest,target_request_id::text,context_row.context_digest));
  select receipt.* into prior_prehttp_receipt from public.stream_media_upload_prehttp_cancel_receipts receipt
  where receipt.operation_id=upload.id;
  if found then
    if prior_prehttp_receipt.request_id<>target_request_id
      or prior_prehttp_receipt.request_digest<>cancel_digest
      or prior_prehttp_receipt.cleanup_reason<>'actor_request'
      or not private.stream_upload_prehttp_cancel_proven(upload.id) then
      return jsonb_build_object('outcome','identity_mismatch');
    end if;
    return jsonb_build_object('outcome','canceled_without_provider_create',
      'operation_id',upload.id,'operation_revision',(
        select state.state_revision from public.stream_media_operation_states state where state.operation_id=upload.id),
      'replayed',true);
  end if;
  if state_value='reserved' then
    if parent_fence_row.source_revision<>context_row.source_revision
      or parent_fence_row.active_operation_id<>upload.id or parent_fence_row.fence_state<>'closing' then
      return jsonb_build_object('outcome','source_stale');
    end if;
    next_revision := private.stream_advance_operation(upload.id,'failed',target_request_id,cancel_digest);
    update public.stream_media_parent_fences as prehttp_fence set fence_state='open',active_operation_id=null,
      source_revision=prehttp_fence.source_revision+1,state_revision=prehttp_fence.state_revision+1,updated_at=now()
    where prehttp_fence.source_kind=context_row.parent_kind
      and prehttp_fence.source_identity=context_row.parent_identity
      and prehttp_fence.owner_id=auth.uid() and prehttp_fence.active_operation_id=upload.id
      and prehttp_fence.fence_state='closing';
    if not found then raise exception 'Pre-create cancel fence changed' using errcode='40001'; end if;
    insert into public.stream_media_upload_prehttp_cancel_receipts(
      operation_id,request_id,request_digest,cleanup_reason,tombstone_id,tombstone_request_id,
      tombstone_revision,tombstone_state_revision
    ) values(upload.id,target_request_id,cancel_digest,'actor_request',null,null,null,null);
  else
    return jsonb_build_object('outcome','pre_http_absence_not_proven');
  end if;
  if upload.source_kind='post_media' then
    select submission.id into submission_id from public.stream_community_video_submissions submission
    where submission.operation_id=upload.id and submission.submission_state='processing';
    if submission_id is not null then
      perform set_config('app.stream_community_submission_id',submission_id::text,true);
      update public.stream_community_video_submissions set submission_state='canceled'
      where id=submission_id and submission_state='processing';
      if not found then raise exception 'Pre-create community cancel changed' using errcode='40001'; end if;
    end if;
  end if;
  return jsonb_build_object('outcome','canceled_without_provider_create',
    'operation_id',upload.id,'operation_revision',coalesce(next_revision,1));
exception when unique_violation then return jsonb_build_object('outcome','identity_mismatch');
  when lock_not_available then return jsonb_build_object('outcome','source_busy');
end;
$$;
revoke all on function public.cancel_stream_media_upload_before_create(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.cancel_stream_media_upload_before_create(uuid,uuid) to authenticated;

-- Include cancellation receipts as an independently versioned account-cleanup resource set.
-- This digest is recomputed when proving and again when the Auth permit is consumed.
create function private.stream_vod_upload_abort_inventory_digest(target_account_id uuid)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare upload_inventory text;
begin
  if target_account_id is null then return null; end if;
  if exists (
    select 1 from public.stream_media_upload_account_edges account_edge
    join public.stream_media_operations upload on upload.intent_id=account_edge.intent_id
      and upload.operation_kind='upload'
    join public.stream_media_operation_states upload_state on upload_state.operation_id=upload.id
    where account_edge.account_id=target_account_id and upload_state.operation_state='canceled'
      and not private.stream_upload_cancel_proven(upload.id)
  ) then return null; end if;
  select coalesce(string_agg(concat_ws('|',account_edge.intent_id::text,account_edge.relation_kind,
      upload.id::text,coalesce(upload.operation_digest,''),coalesce(upload_state.operation_state,'unreserved'),
      coalesce(upload_state.state_revision::text,''),coalesce(receipt.request_id::text,''),
      coalesce(receipt.request_digest,''),coalesce(receipt.cleanup_operation_id::text,''),
      coalesce(receipt.registry_id::text,''),coalesce(receipt.raw_provider_uid,''),
      coalesce(receipt.parent_revision::text,''),coalesce(receipt.absence_evidence_digest,''),
      coalesce(receipt.cleanup_reason,''),coalesce(receipt.tombstone_id::text,''),
      coalesce(receipt.tombstone_request_id::text,''),coalesce(receipt.tombstone_revision::text,''),
      coalesce(receipt.tombstone_state_revision::text,''),coalesce(prehttp_receipt.request_id::text,''),
      coalesce(prehttp_receipt.request_digest,''),coalesce(prehttp_receipt.cleanup_reason,''),
      coalesce(prehttp_receipt.tombstone_id::text,''),
      coalesce(prehttp_receipt.tombstone_request_id::text,''),
      coalesce(prehttp_receipt.tombstone_revision::text,''),
      coalesce(prehttp_receipt.tombstone_state_revision::text,'')),
      chr(10) order by account_edge.intent_id::text,account_edge.relation_kind))
    into upload_inventory
  from public.stream_media_upload_account_edges account_edge
  left join public.stream_media_operations upload on upload.intent_id=account_edge.intent_id
    and upload.operation_kind='upload'
  left join public.stream_media_operation_states upload_state on upload_state.operation_id=upload.id
  left join public.stream_media_upload_cancel_receipts receipt on receipt.operation_id=upload.id
  left join public.stream_media_upload_prehttp_cancel_receipts prehttp_receipt on prehttp_receipt.operation_id=upload.id
  where account_edge.account_id=target_account_id;
  return private.stream_media_identity_digest(coalesce(upload_inventory,''));
end;
$$;
revoke all on function private.stream_vod_upload_abort_inventory_digest(uuid)
  from public,anon,authenticated,service_role;

insert into public.stream_auth_cleanup_components(
  component_key,component_version,resource_set_revision,required_for_auth
) values ('vod_upload_abort',1,1,true)
on conflict (component_key) do update set
  component_version=greatest(public.stream_auth_cleanup_components.component_version,excluded.component_version),
  resource_set_revision=greatest(public.stream_auth_cleanup_components.resource_set_revision,excluded.resource_set_revision),
  required_for_auth=true;

create function private.guard_stream_vod_upload_abort_component_proof()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  tombstone public.stream_media_account_tombstones%rowtype;
  component public.stream_auth_cleanup_components%rowtype;
  inventory_digest text;
  expected_proof_digest text;
begin
  if new.component_key<>'vod_upload_abort' then return new; end if;
  select item.* into tombstone from public.stream_media_account_tombstones item
  where item.id=new.tombstone_id and item.revision=new.tombstone_revision;
  select item.* into component from public.stream_auth_cleanup_components item
  where item.component_key='vod_upload_abort' and item.required_for_auth;
  if tombstone.id is null or component.component_key is null
    or new.component_version<>component.component_version
    or new.resource_set_revision<>component.resource_set_revision
    or new.proof_state<>'ready' then
    raise exception 'VOD abort proof component is stale or unregistered' using errcode='23514';
  end if;
  inventory_digest := private.stream_vod_upload_abort_inventory_digest(tombstone.account_id);
  expected_proof_digest := private.stream_media_identity_digest(concat_ws('|',
    'vod_upload_abort_component_v1',tombstone.id::text,tombstone.revision::text,
    tombstone.source_revision_digest,inventory_digest,component.component_version::text,
    component.resource_set_revision::text));
  if inventory_digest is null or new.source_revision_digest is distinct from inventory_digest
    or new.proof_digest is distinct from expected_proof_digest then
    raise exception 'VOD abort proof does not match current immutable upload receipts' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_stream_vod_upload_abort_component_proof()
  from public,anon,authenticated,service_role;
create trigger stream_vod_upload_abort_component_proof_guard
before insert on public.stream_media_auth_component_proof_events
for each row execute function private.guard_stream_vod_upload_abort_component_proof();

create function public.record_stream_vod_upload_abort_component_proof(
  target_tombstone_id uuid,target_tombstone_revision bigint,target_request_id uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  tombstone public.stream_media_account_tombstones%rowtype;
  component public.stream_auth_cleanup_components%rowtype;
  inventory_digest text;
  proof_digest text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'VOD abort proof is service managed' using errcode='42501';
  end if;
  if target_tombstone_id is null or target_tombstone_revision is null or target_request_id is null then
    raise exception 'VOD abort proof request is invalid' using errcode='22023';
  end if;
  select item.account_id into tombstone.account_id from public.stream_media_account_tombstones item
  where item.id=target_tombstone_id;
  if not found then return jsonb_build_object('outcome','tombstone_missing'); end if;
  perform pg_advisory_xact_lock(hashtextextended('account:'||tombstone.account_id::text,19031003));
  select item.* into tombstone from public.stream_media_account_tombstones item
  where item.id=target_tombstone_id for update;
  -- After an unknown Auth result, refresh only from the current upload inventory before
  -- revalidating the same permit. A contradiction yields no ready component proof.
  if tombstone.revision<>target_tombstone_revision
    or tombstone.tombstone_state not in ('provider_cleanup','auth_result_unknown')
    or tombstone.source_revision_digest is null then
    return jsonb_build_object('outcome','tombstone_stale_or_cleanup_incomplete');
  end if;
  select item.* into component from public.stream_auth_cleanup_components item
  where item.component_key='vod_upload_abort' and item.required_for_auth;
  if not found then return jsonb_build_object('outcome','component_unregistered'); end if;
  inventory_digest := private.stream_vod_upload_abort_inventory_digest(tombstone.account_id);
  if inventory_digest is null then return jsonb_build_object('outcome','upload_abort_receipt_unproven'); end if;
  proof_digest := private.stream_media_identity_digest(concat_ws('|','vod_upload_abort_component_v1',
    tombstone.id::text,tombstone.revision::text,tombstone.source_revision_digest,
    inventory_digest,component.component_version::text,component.resource_set_revision::text));
  return public.record_stream_auth_cleanup_component_proof(
    target_tombstone_id,target_tombstone_revision,'vod_upload_abort',component.component_version,
    component.resource_set_revision,'ready',inventory_digest,proof_digest,target_request_id);
exception when lock_not_available then return jsonb_build_object('outcome','source_busy');
end;
$$;
revoke all on function public.record_stream_vod_upload_abort_component_proof(uuid,bigint,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.record_stream_vod_upload_abort_component_proof(uuid,bigint,uuid)
  to service_role;

alter function public.begin_stream_account_media_cleanup(uuid,uuid,uuid,text,uuid,text)
  rename to begin_stream_account_media_cleanup_310;
revoke all on function public.begin_stream_account_media_cleanup_310(uuid,uuid,uuid,text,uuid,text)
  from public,anon,authenticated,service_role;
create function public.begin_stream_account_media_cleanup(
  target_tombstone_id uuid,target_account_id uuid,target_request_id uuid,
  target_request_digest text,target_operation_id uuid,target_operation_digest text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  cleanup_result jsonb;
  abort_result jsonb;
  pending_upload_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Account media cleanup is service managed' using errcode='42501';
  end if;
  perform private.stream_require_read_committed();
  if exists (select 1 from public.stream_media_upload_account_edges account_edge
    join public.stream_media_operations upload on upload.intent_id=account_edge.intent_id
      and upload.operation_kind='upload'
    join public.stream_media_operation_states state on state.operation_id=upload.id
    where account_edge.account_id=target_account_id and state.operation_state='canceled'
      and not private.stream_upload_cancel_proven(upload.id)) then
    return jsonb_build_object('outcome','upload_cancel_proof_invalid');
  end if;
  cleanup_result:=public.begin_stream_account_media_cleanup_310(
    target_tombstone_id,target_account_id,target_request_id,target_request_digest,
    target_operation_id,target_operation_digest);
  if cleanup_result->>'outcome'<>'upload_reconciliation_required' then return cleanup_result; end if;
  select upload.id into pending_upload_id from public.stream_media_upload_account_edges account_edge
  join public.stream_media_upload_intents intent on intent.id=account_edge.intent_id
  join public.stream_media_operations upload on upload.intent_id=intent.id and upload.operation_kind='upload'
  join public.stream_media_operation_states state on state.operation_id=upload.id
  where account_edge.account_id=target_account_id
    and state.operation_state in ('reserved','create_unknown','created_unverified')
  order by case state.operation_state when 'reserved' then 0 when 'create_unknown' then 1 else 2 end,
    upload.id::text limit 1;
  if pending_upload_id is null then return cleanup_result; end if;
  abort_result:=public.request_stream_account_media_upload_abort(target_tombstone_id,pending_upload_id);
  if abort_result->>'outcome'='canceled_without_provider_create' then
    return public.begin_stream_account_media_cleanup_310(
      target_tombstone_id,target_account_id,target_request_id,target_request_digest,
      target_operation_id,target_operation_digest);
  end if;
  if (abort_result->>'outcome') in ('account_abort_required','account_abort_in_progress') then
    return jsonb_build_object('outcome','upload_abort_pending','upload_operation_id',pending_upload_id,
      'cleanup_operation_id',abort_result->>'cleanup_operation_id',
      'cancel_request_id',abort_result->>'cancel_request_id',
      'tombstone_id',target_tombstone_id,'tombstone_revision',abort_result->>'tombstone_revision');
  end if;
  return cleanup_result || jsonb_build_object('abort_outcome',abort_result->>'outcome');
end;
$$;
revoke all on function public.begin_stream_account_media_cleanup(uuid,uuid,uuid,text,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.begin_stream_account_media_cleanup(uuid,uuid,uuid,text,uuid,text)
  to service_role;

create or replace function public.prepare_stream_auth_deletion_permit(
  target_tombstone_id uuid, target_expected_tombstone_revision bigint,
  target_permit_id uuid, target_request_id uuid, target_evidence_digest text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  tombstone public.stream_media_account_tombstones%rowtype;
  permit public.stream_media_auth_deletion_permits%rowtype;
  operation public.stream_media_operations%rowtype;
  operation_state text;
  component public.stream_auth_cleanup_components%rowtype;
  proof public.stream_media_auth_component_proof_events%rowtype;
  prior_event public.stream_media_auth_deletion_events%rowtype;
  proof_request_id uuid;
  validation_revision bigint;
  computed_manifest_digest text;
  source_inventory text;
  proof_digest text;
  required_count integer;
  is_revalidation boolean := false;
  event_kind text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Auth deletion permits are service managed' using errcode = '42501';
  end if;
  if target_tombstone_id is null or target_expected_tombstone_revision is null
    or target_expected_tombstone_revision < 1 or target_permit_id is null or target_request_id is null
    or target_evidence_digest is null or target_evidence_digest !~ '^[0-9a-f]{64}$'
  then raise exception 'Auth deletion permit request is invalid' using errcode = '22023'; end if;
  perform private.stream_require_read_committed();
  select item.account_id into permit.account_id from public.stream_media_account_tombstones item
    where item.id=target_tombstone_id;
  if not found then return jsonb_build_object('outcome','tombstone_missing'); end if;
  perform pg_advisory_xact_lock(hashtextextended('account:'||permit.account_id::text,19031003));
  select * into tombstone from public.stream_media_account_tombstones item
    where item.id=target_tombstone_id for update;
  if tombstone.revision<>target_expected_tombstone_revision then
    return jsonb_build_object('outcome','tombstone_stale','revision',tombstone.revision); end if;
  select * into permit from public.stream_media_auth_deletion_permits item
    where item.tombstone_id=target_tombstone_id for update;
  if found then
    if permit.id<>target_permit_id or permit.account_id<>tombstone.account_id
      or permit.request_id<>tombstone.request_id then
      return jsonb_build_object('outcome','permit_identity_mismatch'); end if;
    select * into prior_event from public.stream_media_auth_deletion_events event
      where event.permit_id=permit.id and event.request_id=target_request_id;
    if found then
      if prior_event.evidence_digest<>target_evidence_digest
        or prior_event.event_kind not in ('permit_ready','permit_revalidated') then
        return jsonb_build_object('outcome','identity_mismatch'); end if;
      return jsonb_build_object('outcome','already_prepared','permit_id',permit.id,
        'permit_state',permit.permit_state,'permit_revision',permit.revision);
    end if;
    if permit.permit_state<>'auth_result_unknown' or tombstone.tombstone_state<>'auth_result_unknown' then
      return jsonb_build_object('outcome','permit_state_conflict','permit_state',permit.permit_state); end if;
    is_revalidation := true;
  else
    if exists (select 1 from public.stream_media_auth_deletion_permits item where item.id=target_permit_id)
      or tombstone.tombstone_state<>'provider_cleanup' then
      return jsonb_build_object('outcome','permit_state_conflict','tombstone_state',tombstone.tombstone_state); end if;
  end if;
  if tombstone.source_revision_digest is null then
    return jsonb_build_object('outcome','cleanup_proof_missing'); end if;
  if exists (select 1 from public.stream_media_parent_fences fence
      where fence.source_kind='account' and fence.source_identity=tombstone.account_id::text
        and (fence.fence_state<>'closed' or fence.active_operation_id is not null)) then
    return jsonb_build_object('outcome','account_cleanup_incomplete'); end if;
  select * into operation from public.stream_media_operations item
  where item.request_id=tombstone.request_id and item.operation_kind='account_cleanup'
    and item.owner_id=tombstone.account_id;
  if not found then return jsonb_build_object('outcome','account_cleanup_missing'); end if;
  select state.operation_state into operation_state from public.stream_media_operation_states state
    where state.operation_id=operation.id;
  if operation_state not in ('completed','retained') then
    return jsonb_build_object('outcome','account_cleanup_incomplete'); end if;
  if exists (select 1 from public.stream_media_operations item
      join public.stream_media_operation_states state on state.operation_id=item.id
      where item.operation_kind='account_cleanup' and item.owner_id=tombstone.account_id
        and state.operation_state not in ('completed','retained')) then
    return jsonb_build_object('outcome','account_cleanup_incomplete'); end if;
  if exists (select 1 from public.stream_media_source_account_edges account_edge
      join public.stream_media_source_bindings binding on binding.id=account_edge.binding_id
      where account_edge.account_id=tombstone.account_id
        and (binding.registry_id is null or binding.binding_state in
          ('legacy_unverified','provisional_bound','ready_for_publication','quarantined'))) then
    return jsonb_build_object('outcome','media_identity_unresolved'); end if;
  if exists (select 1 from public.stream_media_source_account_edges account_edge
      join public.stream_media_source_bindings binding on binding.id=account_edge.binding_id
      where account_edge.account_id=tombstone.account_id and binding.registry_id is not null
        and private.stream_legacy_uid_unresolved(binding.registry_id,binding.raw_provider_uid)) then
    return jsonb_build_object('outcome','legacy_account_candidate'); end if;
  if exists (select 1 from public.stream_media_operation_uid_state uid_state
      where uid_state.operation_id=operation.id and uid_state.uid_state not in
        ('deleted_confirmed','already_absent_confirmed','retained_attached','detached_retained')) then
    return jsonb_build_object('outcome','provider_cleanup_incomplete'); end if;

  select count(*)::integer into required_count from public.stream_auth_cleanup_components item
    where item.required_for_auth;
  if required_count<1 or not exists (select 1 from public.stream_auth_cleanup_components item
      where item.component_key='vod_media' and item.required_for_auth) then
    return jsonb_build_object('outcome','required_components_unregistered'); end if;
  if exists (
    select 1 from public.stream_auth_cleanup_components component_row
    where component_row.required_for_auth and component_row.component_key<>'vod_media'
      and not exists (
        select 1 from public.stream_media_auth_component_proof_events proof_row
        where proof_row.tombstone_id=target_tombstone_id
          and proof_row.tombstone_revision=tombstone.revision
          and proof_row.component_key=component_row.component_key
          and proof_row.component_version=component_row.component_version
          and proof_row.resource_set_revision=component_row.resource_set_revision
          and proof_row.proof_state='ready'
          and proof_row.proof_sequence=(select max(latest.proof_sequence)
            from public.stream_media_auth_component_proof_events latest
            where latest.tombstone_id=target_tombstone_id
              and latest.component_key=component_row.component_key))) then
    return jsonb_build_object('outcome','required_component_proofs_incomplete'); end if;

  if exists (
    select 1 from public.stream_auth_cleanup_components abort_component
    where abort_component.component_key='vod_upload_abort' and abort_component.required_for_auth
      and not exists (
        select 1 from public.stream_media_auth_component_proof_events abort_proof
        where abort_proof.tombstone_id=target_tombstone_id
          and abort_proof.tombstone_revision=tombstone.revision
          and abort_proof.component_key=abort_component.component_key
          and abort_proof.component_version=abort_component.component_version
          and abort_proof.resource_set_revision=abort_component.resource_set_revision
          and abort_proof.proof_state='ready'
          and abort_proof.proof_sequence=(select max(latest_abort.proof_sequence)
            from public.stream_media_auth_component_proof_events latest_abort
            where latest_abort.tombstone_id=target_tombstone_id
              and latest_abort.component_key=abort_component.component_key)
          and abort_proof.source_revision_digest=private.stream_vod_upload_abort_inventory_digest(tombstone.account_id)
          and abort_proof.proof_digest=private.stream_media_identity_digest(concat_ws('|',
            'vod_upload_abort_component_v1',tombstone.id::text,tombstone.revision::text,
            tombstone.source_revision_digest,abort_proof.source_revision_digest,
            abort_component.component_version::text,abort_component.resource_set_revision::text))
      )
  ) then
    return jsonb_build_object('outcome','required_component_proofs_incomplete'); end if;
  select private.stream_media_identity_digest(coalesce(string_agg(concat_ws('|',item.id::text,
      item.operation_digest,item.expected_source_revision::text,state.operation_state),chr(10)
      order by item.id::text),''))
    into computed_manifest_digest
  from public.stream_media_operations item
  join public.stream_media_operation_states state on state.operation_id=item.id
  where item.id=operation.id;
  select coalesce(string_agg(concat_ws('|',uid_state.registry_id::text,uid_state.raw_provider_uid,
      uid_state.uid_state,uid_state.state_revision::text),chr(10)
      order by uid_state.registry_id::text,uid_state.raw_provider_uid),'') into source_inventory
  from public.stream_media_operation_uid_state uid_state where uid_state.operation_id=operation.id;
  proof_digest := private.stream_media_identity_digest(concat_ws('|',tombstone.id::text,
    tombstone.account_id::text,tombstone.revision::text,tombstone.source_revision_digest,
    operation.id::text,operation.operation_digest,computed_manifest_digest,source_inventory));
  select coalesce(max(snapshot.validation_revision),0)+1 into validation_revision
    from public.stream_media_auth_permit_components snapshot where snapshot.permit_id=target_permit_id;
  if is_revalidation then
    update public.stream_media_auth_deletion_permits set
      manifest_digest=computed_manifest_digest,manifest_count=1,revision=revision+1,updated_at=now()
    where id=target_permit_id returning * into permit;
  else
    insert into public.stream_media_auth_deletion_permits (
      id,tombstone_id,account_id,request_id,source_revision_digest,manifest_digest,
      manifest_count,permit_state
    ) values (target_permit_id,target_tombstone_id,tombstone.account_id,tombstone.request_id,
      tombstone.source_revision_digest,computed_manifest_digest,1,'ready') returning * into permit;
  end if;
  if not is_revalidation then
    insert into public.stream_media_auth_permit_manifests(
      permit_id,operation_id,operation_digest,source_revision
    ) values (permit.id,operation.id,operation.operation_digest,operation.expected_source_revision);
  end if;
  for component in select component_row.* from public.stream_auth_cleanup_components component_row
      where component_row.required_for_auth order by component_row.component_key for share
  loop
    if component.component_key='vod_media' then
      proof_request_id := private.stream_media_request_uuid(target_permit_id::text||':'||validation_revision::text||':vod_media');
      insert into public.stream_media_auth_component_proof_events(
        tombstone_id,tombstone_revision,component_key,proof_sequence,component_version,
        resource_set_revision,proof_state,source_revision_digest,proof_digest,request_id
      ) select target_tombstone_id,tombstone.revision,component.component_key,
        coalesce((select max(latest.proof_sequence)+1 from public.stream_media_auth_component_proof_events latest
          where latest.tombstone_id=target_tombstone_id and latest.component_key=component.component_key),1),
        component.component_version,component.resource_set_revision,'ready',
        tombstone.source_revision_digest,proof_digest,proof_request_id
      returning * into proof;
    else
      select * into proof from public.stream_media_auth_component_proof_events proof_row
      where proof_row.tombstone_id=target_tombstone_id and proof_row.tombstone_revision=tombstone.revision
        and proof_row.component_key=component.component_key
        and proof_row.component_version=component.component_version
        and proof_row.resource_set_revision=component.resource_set_revision
        and proof_row.proof_state='ready'
        and proof_row.proof_sequence=(select max(latest.proof_sequence)
          from public.stream_media_auth_component_proof_events latest
          where latest.tombstone_id=target_tombstone_id and latest.component_key=component.component_key);
      if not found then return jsonb_build_object('outcome','required_component_proofs_incomplete'); end if;
    end if;
    insert into public.stream_media_auth_permit_components(
      permit_id,validation_revision,component_key,component_version,resource_set_revision,
      proof_event_id,source_revision_digest,proof_digest
    ) values (permit.id,validation_revision,component.component_key,component.component_version,
      component.resource_set_revision,proof.id,proof.source_revision_digest,proof.proof_digest);
  end loop;
  event_kind := case when is_revalidation then 'permit_revalidated' else 'permit_ready' end;
  insert into public.stream_media_auth_deletion_events(permit_id,event_kind,request_id,evidence_digest)
    values (permit.id,event_kind,target_request_id,target_evidence_digest);
  if not is_revalidation then
    update public.stream_media_account_tombstones set tombstone_state='auth_deletion_ready',
      state_revision=state_revision+1,updated_at=now() where id=target_tombstone_id;
    insert into public.stream_media_account_tombstone_events(
      tombstone_id,event_kind,request_id,source_revision_digest,evidence_digest
    ) values (target_tombstone_id,'auth_deletion_ready',target_request_id,
      tombstone.source_revision_digest,target_evidence_digest);
  end if;
  return jsonb_build_object('outcome',case when is_revalidation then 'revalidated' else 'permit_ready' end,
    'permit_id',permit.id,'permit_state',permit.permit_state,'permit_revision',permit.revision,
    'validation_revision',validation_revision,'component_count',required_count);
exception
  when unique_violation then return jsonb_build_object('outcome','identity_mismatch');
  when lock_not_available then return jsonb_build_object('outcome','source_busy');
end;
$$;
revoke all on function public.prepare_stream_auth_deletion_permit(uuid,bigint,uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.prepare_stream_auth_deletion_permit(uuid,bigint,uuid,uuid,text)
  to service_role;

create or replace function private.stream_auth_contract_current(target_permit_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  with selected as (
    select permit.id,permit.tombstone_id,permit.account_id,tombstone.revision as tombstone_revision,
      tombstone.source_revision_digest as tombstone_source_revision_digest,
      coalesce((select max(snapshot.validation_revision)
        from public.stream_media_auth_permit_components snapshot where snapshot.permit_id=permit.id),0) as validation_revision
    from public.stream_media_auth_deletion_permits permit
    join public.stream_media_account_tombstones tombstone
      on tombstone.id=permit.tombstone_id and tombstone.account_id=permit.account_id
    where permit.id=target_permit_id
  ), required as (
    select component.* from public.stream_auth_cleanup_components component
    where component.required_for_auth
  )
  select exists(select 1 from selected)
    and private.stream_auth_permit_manifest_current(target_permit_id)
    and not exists (
      select 1 from selected permit
      join public.stream_media_source_account_edges account_edge on account_edge.account_id=permit.account_id
      join public.stream_media_source_bindings binding on binding.id=account_edge.binding_id
      where binding.registry_id is not null
        and private.stream_legacy_uid_unresolved(binding.registry_id,binding.raw_provider_uid)
    )
    and not exists (
      select 1 from required component cross join selected permit
      where not exists (
        select 1 from public.stream_media_auth_permit_components snapshot
        join public.stream_media_auth_component_proof_events proof on proof.id=snapshot.proof_event_id
        where snapshot.permit_id=permit.id and snapshot.validation_revision=permit.validation_revision
          and snapshot.component_key=component.component_key
          and snapshot.component_version=component.component_version
          and snapshot.resource_set_revision=component.resource_set_revision
          and proof.tombstone_id=permit.tombstone_id and proof.tombstone_revision=permit.tombstone_revision
          and proof.component_key=component.component_key and proof.component_version=component.component_version
          and proof.resource_set_revision=component.resource_set_revision and proof.proof_state='ready'
          and snapshot.source_revision_digest=proof.source_revision_digest
          and snapshot.proof_digest=proof.proof_digest
          and proof.proof_sequence=(select max(latest.proof_sequence)
            from public.stream_media_auth_component_proof_events latest
            where latest.tombstone_id=permit.tombstone_id and latest.component_key=component.component_key)
          and (component.component_key<>'vod_upload_abort'
            or (proof.source_revision_digest=private.stream_vod_upload_abort_inventory_digest(permit.account_id)
              and proof.proof_digest=private.stream_media_identity_digest(concat_ws('|',
                'vod_upload_abort_component_v1',permit.tombstone_id::text,permit.tombstone_revision::text,
                permit.tombstone_source_revision_digest,proof.source_revision_digest,
                component.component_version::text,component.resource_set_revision::text))))
      )
    )
    and (select count(*) from public.stream_media_auth_permit_components snapshot
      cross join selected permit where snapshot.permit_id=permit.id
        and snapshot.validation_revision=permit.validation_revision
        and exists (select 1 from required component where component.component_key=snapshot.component_key))
      =(select count(*) from required);
$$;
revoke all on function private.stream_auth_contract_current(uuid)
  from public,anon,authenticated,service_role;



create or replace function private.guard_stream_media_reference_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_source_kind text := tg_argv[0];
  old_row jsonb;
  new_row jsonb;
  row_data jsonb;
  v_operation_id uuid := private.stream_selected_operation_id();
  v_source_identity text;
  v_parent_kind text;
  v_parent_identity text;
  source_owner uuid;
  parent_owner uuid;
  asset_owner uuid;
  target_video_id uuid;
  old_video_id uuid;
  target_uid text;
  target_registry_id uuid;
  old_uid text;
  old_registry_id uuid;
  uid_registry_ids uuid[];
  uid_values text[];
  asset_id uuid;
  v_binding_id uuid;
  binding_row public.stream_media_source_bindings%rowtype;
  asset_row public.stream_media_assets%rowtype;
  video_row public.videos%rowtype;
  old_video_row public.videos%rowtype;
  uid_state text;
  manifest_detach boolean;
  account_cascade boolean := false;
  row_changed boolean := true;
  event_request uuid;
  event_digest text;
  event_sequence bigint;
  upload_bound boolean := false;
  video_post_media_delete boolean := false;
  v_paid_lesson_snapshot boolean := false;
  v_paid_program_owner_id uuid;
begin
  if tg_op <> 'INSERT' then old_row := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then new_row := to_jsonb(new); end if;
  row_data := case when tg_op='DELETE' then old_row else new_row end;
  video_post_media_delete := v_source_kind='post_media' and row_data->>'kind'='video';
  if tg_op='UPDATE' then
    row_changed := case v_source_kind
      when 'post_media' then old_row->>'post_id' is distinct from new_row->>'post_id'
        or old_row->>'video_uid' is distinct from new_row->>'video_uid'
        or old_row->>'kind' is distinct from new_row->>'kind'
      when 'program_day' then old_row->>'program_id' is distinct from new_row->>'program_id'
        or old_row->>'video_id' is distinct from new_row->>'video_id'
      when 'program_lesson' then old_row->>'program_id' is distinct from new_row->>'program_id'
        or old_row->>'content_version_id' is distinct from new_row->>'content_version_id'
        or old_row->>'video_id' is distinct from new_row->>'video_id'
        or old_row->>'cloudflare_uid' is distinct from new_row->>'cloudflare_uid'
      when 'program_intro' then old_row->>'intro_video_id' is distinct from new_row->>'intro_video_id'
        or old_row->>'coach_id' is distinct from new_row->>'coach_id'
      when 'daily_content_revision' then old_row->>'item_id' is distinct from new_row->>'item_id'
        or old_row->>'video_id' is distinct from new_row->>'video_id'
      when 'daily_content_slot' then old_row->>'item_id' is distinct from new_row->>'item_id'
        or old_row->>'revision_id' is distinct from new_row->>'revision_id'
        or old_row->>'status' is distinct from new_row->>'status'
      when 'daily_content_grant' then old_row->>'member_id' is distinct from new_row->>'member_id'
        or old_row->>'day' is distinct from new_row->>'day'
        or old_row->>'video_id' is distinct from new_row->>'video_id'
      when 'task' then old_row->>'coach_id' is distinct from new_row->>'coach_id'
        or old_row->>'video_id' is distinct from new_row->>'video_id'
      when 'daily_fuel_assignment' then old_row->>'member_id' is distinct from new_row->>'member_id'
        or old_row->>'coach_id' is distinct from new_row->>'coach_id'
        or old_row->>'day' is distinct from new_row->>'day'
        or old_row->>'video_id' is distinct from new_row->>'video_id'
      when 'daily_fuel_bookmark' then old_row->>'member_id' is distinct from new_row->>'member_id'
        or old_row->>'video_id' is distinct from new_row->>'video_id'
      else true end;
    if not row_changed then return new; end if;
    if v_source_kind='daily_content_slot'
      and old_row->>'revision_id'=new_row->>'revision_id'
      and old_row->>'status' in ('scheduled','published') and new_row->>'status'='cancelled'
    then
      v_source_identity := old_row->>'id';
      v_parent_kind := 'daily_content_item'; v_parent_identity := old_row->>'item_id';
      select item.owner_id into source_owner from public.daily_content_items item
        where item.id::text=v_parent_identity;
      select video.cloudflare_uid,video.stream_provider_account_registry_id
        into target_uid,target_registry_id
      from public.daily_content_revisions revision join public.videos video on video.id=revision.video_id
        where revision.id::text=old_row->>'revision_id';
      if target_uid is not null then
        if not private.stream_try_parent_lock(v_parent_kind,v_parent_identity)
          or not private.stream_try_uid_lock(target_registry_id,target_uid) then
          raise exception 'Daily Content media is busy' using errcode = '55P03'; end if;
        if private.stream_media_uid_reserved(target_registry_id,target_uid) then
          raise exception 'Daily Content media has an active cleanup reservation' using errcode = '55P03'; end if;
        for binding_row in select binding.* from public.stream_media_source_bindings binding
          where binding.source_kind='daily_content_slot' and binding.source_identity=v_source_identity
            and binding.raw_provider_uid=target_uid and binding.registry_id=target_registry_id
            and binding.binding_state in ('active','ready_for_publication','retained')
        loop
          perform private.stream_record_local_source_detach(
            binding_row.id,auth.uid(),v_parent_kind,v_parent_identity,source_owner);
        end loop;
      end if;
      return new;
    end if;
    if v_source_kind='daily_content_slot' and old_row->>'revision_id'=new_row->>'revision_id'
      and ((old_row->>'status' in ('scheduled','published') and new_row->>'status' in ('scheduled','published'))
        or (old_row->>'status'='cancelled' and new_row->>'status'='cancelled')) then
      return new;
    end if;
    if (v_source_kind='post_media' and old_row->>'post_id' is distinct from new_row->>'post_id')
      or (v_source_kind in ('program_day','program_lesson') and old_row->>'program_id' is distinct from new_row->>'program_id')
      or (v_source_kind='program_lesson' and old_row->>'content_version_id' is distinct from new_row->>'content_version_id')
      or (v_source_kind='program_intro' and old_row->>'coach_id' is distinct from new_row->>'coach_id')
      or (v_source_kind='daily_content_revision' and old_row->>'item_id' is distinct from new_row->>'item_id')
      or (v_source_kind='daily_content_slot' and old_row->>'item_id' is distinct from new_row->>'item_id')
      or (v_source_kind='daily_content_grant' and (old_row->>'member_id' is distinct from new_row->>'member_id'
        or old_row->>'day' is distinct from new_row->>'day'))
      or (v_source_kind='task' and old_row->>'coach_id' is distinct from new_row->>'coach_id')
      or (v_source_kind='daily_fuel_assignment' and (old_row->>'member_id' is distinct from new_row->>'member_id'
        or old_row->>'day' is distinct from new_row->>'day'
        or (old_row->>'coach_id' is distinct from new_row->>'coach_id'
          and old_row->>'video_id' is not distinct from new_row->>'video_id')))
      or (v_source_kind='daily_fuel_bookmark' and old_row->>'member_id' is distinct from new_row->>'member_id')
    then raise exception 'Media source identity change needs separate detach and attach operations' using errcode = '55000'; end if;
    if v_source_kind in ('program_day','daily_fuel_assignment','program_intro')
      and (case when v_source_kind='program_intro' then old_row->>'intro_video_id' else old_row->>'video_id' end)
        is distinct from (case when v_source_kind='program_intro' then new_row->>'intro_video_id' else new_row->>'video_id' end)
      and (case when v_source_kind='program_intro' then old_row->>'intro_video_id' else old_row->>'video_id' end) is not null then
      v_source_identity := old_row->>'id';
      old_video_id := nullif(case when v_source_kind='program_intro' then old_row->>'intro_video_id' else old_row->>'video_id' end,'')::uuid;
      target_video_id := nullif(case when v_source_kind='program_intro' then new_row->>'intro_video_id' else new_row->>'video_id' end,'')::uuid;
      if v_source_kind='program_day' then
        v_parent_kind := 'program'; v_parent_identity := old_row->>'program_id';
        select program.coach_id into source_owner from public.programs program where program.id::text=v_parent_identity;
        parent_owner := source_owner;
      elsif v_source_kind='program_intro' then
        v_parent_kind := 'program'; v_parent_identity := old_row->>'id'; v_source_identity := old_row->>'id';
        select program.coach_id into source_owner from public.programs program where program.id::text=v_parent_identity;
        parent_owner := source_owner;
      else
        v_parent_kind := 'daily_fuel_assignment'; v_parent_identity := old_row->>'id';
        source_owner := nullif(old_row->>'coach_id','')::uuid;
        parent_owner := nullif(old_row->>'member_id','')::uuid;
      end if;
      select video.* into old_video_row from public.videos video where video.id=old_video_id;
      if not found or old_video_row.stream_provider_account_registry_id is null then
        raise exception 'Old source video account is unresolved' using errcode = '55000'; end if;
      old_uid := old_video_row.cloudflare_uid;
      old_registry_id := old_video_row.stream_provider_account_registry_id;
      select binding.* into binding_row from public.stream_media_source_bindings binding
        where binding.source_kind=v_source_kind and binding.source_identity=v_source_identity
          and binding.registry_id=old_registry_id and binding.raw_provider_uid=old_uid
          and binding.binding_state in ('active','ready_for_publication','retained')
        order by binding.created_at desc limit 1;
      if binding_row.id is null then
        raise exception 'Old source video has no authoritative binding; reconciliation is required' using errcode = '55000'; end if;
      if target_video_id is not null then
        select video.* into video_row from public.videos video where video.id=target_video_id;
        if not found or video_row.stream_provider_account_registry_id is null then
          raise exception 'New source video account is unresolved' using errcode = '55000'; end if;
        if v_source_kind='daily_fuel_assignment' and video_row.coach_id<>nullif(new_row->>'coach_id','')::uuid then
          raise exception 'Daily Fuel owner must match the new video owner' using errcode = '42501'; end if;
      end if;
      select array_agg(identities.registry_id order by identities.registry_id::text,identities.provider_uid),
        array_agg(identities.provider_uid order by identities.registry_id::text,identities.provider_uid)
        into uid_registry_ids,uid_values
      from (select distinct identities.registry_id,identities.provider_uid from (
        select old_registry_id as registry_id,old_uid as provider_uid
        union all
        select video_row.stream_provider_account_registry_id,video_row.cloudflare_uid
        where target_video_id is not null
      ) identities where identities.registry_id is not null and identities.provider_uid is not null) identities;
      perform private.stream_require_read_committed();
      if not private.stream_try_parent_lock(v_parent_kind,v_parent_identity) then
        raise exception 'Source replacement is busy; retry the full write' using errcode = '55P03'; end if;
      perform private.stream_try_uid_locks(uid_registry_ids,uid_values);
      if exists (select 1 from unnest(uid_registry_ids,uid_values) requested(registry_id,provider_uid)
        where private.stream_media_uid_reserved(requested.registry_id,requested.provider_uid)) then
        raise exception 'Source replacement intersects a provider cleanup reservation' using errcode = '55P03'; end if;
      perform private.stream_record_local_source_detach(binding_row.id,auth.uid(),v_parent_kind,v_parent_identity,parent_owner);
    end if;
    if (old_row->>'video_id' is distinct from new_row->>'video_id'
      or old_row->>'video_uid' is distinct from new_row->>'video_uid'
      or old_row->>'intro_video_id' is distinct from new_row->>'intro_video_id'
      or old_row->>'revision_id' is distinct from new_row->>'revision_id')
      and v_source_kind not in ('program_day','daily_fuel_assignment','program_intro')
    then raise exception 'Media source replacement needs separate detach and attach operations' using errcode = '55000'; end if;
  end if;

  v_source_identity := case v_source_kind
    when 'daily_content_grant' then (row_data->>'member_id') || ':' || (row_data->>'day') || ':' || (row_data->>'video_id')
    when 'daily_fuel_bookmark' then (row_data->>'member_id') || ':' || (row_data->>'video_id')
    when 'program_intro' then row_data->>'id'
    else row_data->>'id' end;
  if v_source_kind='post_media' then
    v_parent_kind := 'post'; v_parent_identity := row_data->>'post_id';
    select post.author_id into source_owner from public.posts post where post.id::text=v_parent_identity;
    parent_owner := source_owner;
    target_uid := row_data->>'video_uid';
    select binding.registry_id,binding.asset_id,asset.owner_id
      into target_registry_id,asset_id,asset_owner
    from public.stream_media_source_bindings binding
    join public.stream_media_assets asset on asset.id=binding.asset_id
    where binding.source_kind='post_media' and binding.source_identity=v_source_identity
      and binding.raw_provider_uid=target_uid and binding.binding_state='provisional_bound';
  elsif v_source_kind in ('program_day','program_lesson') then
    v_parent_kind := 'program'; v_parent_identity := row_data->>'program_id';
    select program.coach_id into source_owner from public.programs program where program.id::text=v_parent_identity;
    parent_owner := source_owner;
    target_video_id := nullif(row_data->>'video_id','')::uuid;
    if v_source_kind='program_lesson' then target_uid := row_data->>'cloudflare_uid'; end if;
  elsif v_source_kind='program_intro' then
    v_parent_kind := 'program'; v_parent_identity := row_data->>'id'; v_source_identity := row_data->>'id';
    if tg_op='INSERT' then
      -- BEFORE INSERT runs before this Program exists in public.programs.
      source_owner := nullif(row_data->>'coach_id','')::uuid;
    else
      select program.coach_id into source_owner from public.programs program where program.id::text=v_parent_identity;
    end if;
    parent_owner := source_owner;
    target_video_id := nullif(row_data->>'intro_video_id','')::uuid;
  elsif v_source_kind in ('daily_content_revision','daily_content_slot') then
    v_parent_kind := 'daily_content_item';
    if v_source_kind='daily_content_revision' then
      v_parent_identity := row_data->>'item_id'; target_video_id := nullif(row_data->>'video_id','')::uuid;
    else
      v_parent_identity := row_data->>'item_id';
      select revision.video_id into target_video_id from public.daily_content_revisions revision
        where revision.id::text=row_data->>'revision_id';
    end if;
    select item.owner_id into source_owner from public.daily_content_items item where item.id::text=v_parent_identity;
    parent_owner := source_owner;
  elsif v_source_kind in ('daily_content_grant','daily_fuel_bookmark') then
    v_parent_kind := 'profile'; v_parent_identity := row_data->>'member_id'; source_owner := nullif(v_parent_identity,'')::uuid;
    parent_owner := source_owner;
    target_video_id := nullif(row_data->>'video_id','')::uuid;
  elsif v_source_kind='task' then
    v_parent_kind := 'task'; v_parent_identity := row_data->>'id';
    source_owner := nullif(row_data->>'coach_id','')::uuid; target_video_id := nullif(row_data->>'video_id','')::uuid;
    parent_owner := source_owner;
  elsif v_source_kind='daily_fuel_assignment' then
    v_parent_kind := 'daily_fuel_assignment'; v_parent_identity := row_data->>'id';
    source_owner := nullif(row_data->>'coach_id','')::uuid; parent_owner := nullif(row_data->>'member_id','')::uuid;
    target_video_id := nullif(row_data->>'video_id','')::uuid;
  end if;
  if target_video_id is not null then
    select video.* into video_row from public.videos video where video.id=target_video_id;
    if found then
      target_uid := coalesce(target_uid,video_row.cloudflare_uid);
      target_registry_id := video_row.stream_provider_account_registry_id;
      asset_owner := video_row.coach_id;
    end if;
  end if;
  if tg_op='DELETE' then
    if target_uid is null then return old; end if;
    if target_registry_id is null then
      select binding.registry_id into target_registry_id from public.stream_media_source_bindings binding
      where binding.source_kind=v_source_kind and binding.source_identity=v_source_identity
        and binding.raw_provider_uid=target_uid limit 1;
    end if;
    select * into binding_row from public.stream_media_source_bindings binding
      where binding.source_kind=v_source_kind and binding.source_identity=v_source_identity
        and binding.raw_provider_uid=target_uid
        and binding.registry_id is not distinct from target_registry_id
      order by binding.created_at desc limit 1;
    if binding_row.id is null or target_registry_id is null then
      raise exception 'Unresolved legacy media cannot be detached or deleted' using errcode = '55000'; end if;
    if video_post_media_delete and (v_operation_id is null or not exists (
      select 1 from public.stream_media_operations operation
      where operation.id=v_operation_id and operation.operation_kind in ('cleanup','account_cleanup')
    )) then
      raise exception 'Community video deletion requires its exact durable cleanup operation' using errcode = '55000'; end if;
    if binding_row.binding_state='detached' then
      if video_post_media_delete and not exists (
        select 1
        from public.stream_media_operations operation
        join public.stream_media_operation_states operation_state on operation_state.operation_id=operation.id
        join public.stream_media_manifest_edges manifest on manifest.operation_id=operation.id
          and manifest.binding_id=binding_row.id
          and manifest.source_kind=binding_row.source_kind
          and manifest.source_identity=binding_row.source_identity
          and manifest.source_revision=binding_row.source_revision
          and manifest.registry_id=binding_row.registry_id
          and manifest.raw_provider_uid=binding_row.raw_provider_uid
        join public.stream_media_operation_uid_state uid_state on uid_state.operation_id=operation.id
          and uid_state.registry_id=manifest.registry_id and uid_state.raw_provider_uid=manifest.raw_provider_uid
        join public.stream_media_operation_uid_events uid_result on uid_result.id=uid_state.last_event_id
          and uid_result.operation_id=operation.id and uid_result.registry_id=manifest.registry_id
          and uid_result.raw_provider_uid=manifest.raw_provider_uid and uid_result.outcome=uid_state.uid_state
        join public.stream_media_operation_events finalizing_event on finalizing_event.operation_id=operation.id
          and finalizing_event.to_state='source_finalizing'
          and finalizing_event.request_id=private.stream_media_request_uuid(operation.id::text||':source-finalizing')
        join public.stream_media_source_binding_events detached_event on detached_event.binding_id=binding_row.id
          and detached_event.source_revision=manifest.source_revision
          and detached_event.event_kind in ('detached','retained')
          and detached_event.evidence_digest=finalizing_event.evidence_digest
          and detached_event.request_id=private.stream_media_request_uuid(
            operation.id::text||binding_row.id::text||case
              when operation.operation_kind='account_cleanup' then ':account-finalize' else ':detached' end)
        where operation.id=v_operation_id
          and operation.operation_kind in ('cleanup','account_cleanup')
          and operation.owner_id=binding_row.owner_id
          and ((operation.operation_kind='cleanup' and operation.source_kind='post'
              and operation.source_identity=v_parent_identity
              and (operation_state.operation_state='source_finalizing'
                or (operation_state.operation_state in ('completed','retained')
                  and exists (select 1 from public.stream_media_finalization_receipts receipt
                    where receipt.operation_id=operation.id
                      and receipt.terminal_state=operation_state.operation_state
                      and receipt.request_digest=finalizing_event.evidence_digest
                      and ((operation_state.operation_state='completed'
                          and receipt.response->>'outcome'='completed'
                          and receipt.response->>'source_deleted'='true')
                        or (operation_state.operation_state='retained'
                          and receipt.response->>'outcome'='retained'
                          and receipt.response->>'source_deleted'='false')))))
            or (operation.operation_kind='account_cleanup' and operation.source_kind='account'
              and operation.source_identity=operation.owner_id::text
              and operation_state.operation_state in ('completed','retained')
              and (select private.stream_auth_deletion_permitted(operation.owner_id))
              and exists (select 1 from public.stream_media_finalization_receipts receipt
                where receipt.operation_id=operation.id
                  and receipt.terminal_state=operation_state.operation_state
                  and receipt.request_digest=finalizing_event.evidence_digest
                  and receipt.response->>'outcome'='account_cleanup_complete'
                  and receipt.response->>'state'=operation_state.operation_state))))
          and ((uid_state.uid_state='deleted_confirmed'
              and uid_result.delete_http_status between 200 and 299 and uid_result.http_status=404)
            or (uid_state.uid_state='already_absent_confirmed'
              and uid_result.delete_http_status is null and uid_result.http_status=404)
            or (uid_state.uid_state='retained_attached' and manifest.detach_allowed
              and uid_result.delete_http_status is null and uid_result.http_status is null)
            or (uid_state.uid_state='detached_retained' and manifest.detach_allowed
              and uid_result.delete_http_status is null and uid_result.http_status is null
              and uid_result.evidence_digest=finalizing_event.evidence_digest
              and exists (select 1 from public.stream_media_operation_uid_events prior_retained
                where prior_retained.operation_id=uid_result.operation_id
                  and prior_retained.registry_id=uid_result.registry_id
                  and prior_retained.raw_provider_uid=uid_result.raw_provider_uid
                  and prior_retained.outcome='retained_attached'
                  and prior_retained.sequence_number<uid_result.sequence_number
                  and prior_retained.evidence_digest=operation.operation_digest
                  and prior_retained.delete_http_status is null
                  and prior_retained.http_status is null)))
      ) then
        raise exception 'Detached community video deletion requires exact manifest and terminal proof' using errcode = '55000';
      end if;
      return old;
    end if;
    if not private.stream_try_parent_lock(v_parent_kind,v_parent_identity)
      or not private.stream_try_uid_lock(target_registry_id,target_uid) then
      raise exception 'Media source is busy; retry the complete mutation' using errcode = '55P03'; end if;
    if v_operation_id is null then
      v_operation_id := private.stream_record_local_source_detach(
        binding_row.id,auth.uid(),v_parent_kind,v_parent_identity,parent_owner);
    end if;
    if not private.stream_operation_has_edge(v_operation_id,v_source_kind,v_source_identity,target_registry_id,target_uid) then
      raise exception 'Source deletion requires its exact operation manifest' using errcode = '42501'; end if;
    select operation.operation_kind='account_cleanup'
      and private.stream_auth_deletion_permitted(operation.owner_id)
      into account_cascade
    from public.stream_media_operations operation where operation.id=v_operation_id;
    select uid_state.uid_state,edge.detach_allowed into uid_state,manifest_detach
    from public.stream_media_operation_uid_state uid_state
    join public.stream_media_manifest_edges edge on edge.operation_id=uid_state.operation_id
      and edge.registry_id=uid_state.registry_id and edge.raw_provider_uid=uid_state.raw_provider_uid
      and edge.binding_id=binding_row.id
    where uid_state.operation_id=v_operation_id and uid_state.registry_id=target_registry_id
      and uid_state.raw_provider_uid=target_uid;
    if uid_state not in ('deleted_confirmed','already_absent_confirmed')
      and not (uid_state='retained_attached' and manifest_detach)
      and not (uid_state='retained_attached' and coalesce(account_cascade,false))
      and not (uid_state='detached_retained' and exists (select 1 from public.stream_media_operations operation
        where operation.id=v_operation_id and operation.operation_kind='source_mutation')) then
      raise exception 'Source edge cannot detach with its current UID state' using errcode = '55000'; end if;
    if binding_row.binding_state is distinct from (case when uid_state='retained_attached' then 'retained' else 'detached' end) then
      update public.stream_media_source_bindings set binding_state=case
        when uid_state='retained_attached' then 'retained' else 'detached' end,
        state_revision=state_revision+1,updated_at=now()
      where id=binding_row.id;
      event_request := (substr(md5(v_operation_id::text || binding_row.id::text || ':detach'),1,8) || '-'
        || substr(md5(v_operation_id::text || binding_row.id::text || ':detach'),9,4) || '-'
        || substr(md5(v_operation_id::text || binding_row.id::text || ':detach'),13,4) || '-'
        || substr(md5(v_operation_id::text || binding_row.id::text || ':detach'),17,4) || '-'
        || substr(md5(v_operation_id::text || binding_row.id::text || ':detach'),21,12))::uuid;
      insert into public.stream_media_source_binding_events(binding_id,event_kind,source_revision,request_id,evidence_digest)
        values (binding_row.id,case when uid_state='retained_attached' then 'retained' else 'detached' end,
          binding_row.source_revision,event_request,binding_row.evidence_digest)
        on conflict (binding_id,request_id) do nothing;
    end if;
    return old;
  end if;
  if v_source_kind='daily_content_slot' and row_data->>'status'='cancelled' then return new; end if;
  if target_uid is null then return new; end if;
  if target_registry_id is null or source_owner is null then
    raise exception 'Source media account binding is unresolved' using errcode = '55000'; end if;
  perform private.stream_require_read_committed();
  perform private.stream_try_lock_accounts(array[source_owner,asset_owner]);
  if private.stream_account_is_tombstoned(source_owner) or private.stream_account_is_tombstoned(asset_owner) then
    raise exception 'Media owner or source account is closing' using errcode = '55000'; end if;
  if v_parent_kind='program' and not pg_try_advisory_xact_lock(
    hashtextextended(v_parent_identity::uuid::text,7142026)) then
    raise exception 'Program media is busy; retry the full write' using errcode = '55P03'; end if;
  if not private.stream_try_parent_lock(v_parent_kind,v_parent_identity)
    and not (v_operation_id is not null and exists (
      select 1 from public.stream_media_operations operation
      join public.stream_media_parent_fences fence on fence.active_operation_id=operation.id
      where operation.id=v_operation_id and fence.source_kind=v_parent_kind
        and fence.source_identity=v_parent_identity and fence.fence_state='closing'
    )) then raise exception 'Media parent is busy' using errcode = '55P03'; end if;
  if not private.stream_try_uid_lock(target_registry_id,target_uid) then
    raise exception 'Media UID is busy; retry the full write' using errcode = '40001'; end if;
  if private.stream_uid_blocks_new_media_reference(target_registry_id,target_uid) then
    raise exception 'Media UID is reserved, unresolved, or no longer available' using errcode = '55000'; end if;
  if private.stream_media_uid_reserved(target_registry_id,target_uid)
    and not private.stream_operation_has_edge(v_operation_id,v_source_kind,v_source_identity,target_registry_id,target_uid)
  then raise exception 'Media UID has an active cleanup reservation' using errcode = '55P03'; end if;
  if v_source_kind='program_lesson' and target_video_id is not null then
    select exists (select 1 from public.program_content_versions paid_version
      where paid_version.id::text=row_data->>'content_version_id'
        and paid_version.program_id::text=row_data->>'program_id'
        and paid_version.revision_kind='paid') into v_paid_lesson_snapshot;
    if v_paid_lesson_snapshot then
      select program.coach_id into v_paid_program_owner_id from public.programs program
      where program.id::text=v_parent_identity;
      if v_paid_program_owner_id is null or v_paid_program_owner_id is distinct from source_owner then
        raise exception 'Paid Program owner changed during media attachment' using errcode = '40001'; end if;
      select video.* into video_row from public.videos video
      where video.id=target_video_id and video.coach_id=v_paid_program_owner_id
        and video.cloudflare_uid=target_uid
        and video.stream_provider_account_registry_id=target_registry_id
        and video.status::text='ready' and not video.daily_content_deletion_pending
        and video.visibility in ('private','program_only');
      if not found or not coalesce((row_data->>'cloudflare_signed_urls_verified')::boolean,false) then
        raise exception 'Paid Program lesson video is stale or no longer protected' using errcode = '42501'; end if;
    end if;
  end if;
  upload_bound := private.stream_upload_operation_matches(
    v_operation_id,v_source_kind,v_source_identity,source_owner,target_registry_id,target_uid
  );
  if upload_bound then
    select binding.id into v_binding_id from public.stream_media_source_bindings binding
    where binding.source_kind=v_source_kind and binding.source_identity=v_source_identity
      and binding.registry_id=target_registry_id and binding.raw_provider_uid=target_uid
      and binding.binding_state='provisional_bound';
    select asset.* into asset_row from public.stream_media_assets asset
    where asset.registry_id=target_registry_id and asset.raw_provider_uid=target_uid
      and asset.upload_intent_id=(select operation.intent_id from public.stream_media_operations operation
        where operation.id=v_operation_id);
    asset_id := asset_row.id; asset_owner := asset_row.owner_id;
    if v_binding_id is null or asset_id is null then
      raise exception 'Upload binding is unavailable' using errcode = '55000'; end if;
  elsif v_source_kind='post_media' then
    if not private.stream_upload_operation_matches(v_operation_id,v_source_kind,v_source_identity,
      source_owner,target_registry_id,target_uid) then
      raise exception 'Community video attachment requires its exact upload ticket' using errcode = '42501'; end if;
    select asset.* into asset_row from public.stream_media_assets asset
      where asset.registry_id=target_registry_id and asset.raw_provider_uid=target_uid
        and asset.lifecycle_state='provisional_bound';
    if not found then raise exception 'Community upload is not provisionally bound' using errcode = '55000'; end if;
    asset_id := asset_row.id;
  else
    if video_row.id is null or video_row.status::text <> 'ready' or video_row.daily_content_deletion_pending then
      raise exception 'Choose a ready video' using errcode = '42501'; end if;
    if v_source_kind='program_lesson' and row_data->>'cloudflare_uid' is distinct from video_row.cloudflare_uid then
      raise exception 'Program lesson UID must match its exact video' using errcode = '42501'; end if;
    if video_row.visibility='program_only' and not (
      v_source_kind='program_lesson' and exists (
        select 1 from public.program_content_versions version
        where version.id::text=row_data->>'content_version_id'
          and version.program_id::text=row_data->>'program_id' and version.revision_kind='paid'
      ) and coalesce((row_data->>'cloudflare_signed_urls_verified')::boolean,false)
    ) then raise exception 'Program-only media is limited to verified paid lessons' using errcode = '42501'; end if;
    if not exists (select 1 from public.stream_media_assets asset
      where asset.registry_id=target_registry_id and asset.raw_provider_uid=target_uid
        and asset.lifecycle_state='ready_for_publication'
        and asset.signed_urls_verified and asset.ready_to_stream_verified)
      or not private.stream_source_binding_ready('video',target_video_id::text,
        video_row.coach_id,target_registry_id,target_uid)
    then raise exception 'Source asset is not ready for publication' using errcode = '42501'; end if;
    asset_id := (select asset.id from public.stream_media_assets asset
      where asset.registry_id=target_registry_id and asset.raw_provider_uid=target_uid);
  end if;
  if v_source_kind in ('task','daily_fuel_assignment','daily_fuel_bookmark','daily_content_revision','daily_content_slot','daily_content_grant')
    and video_row.visibility='program_only'
  then raise exception 'Program-only media is unavailable to this surface' using errcode = '42501'; end if;
  perform private.stream_bump_open_parent_revision(v_parent_kind,v_parent_identity,parent_owner,v_operation_id);
  if not upload_bound then
    insert into public.stream_media_source_bindings (
      registry_id,raw_provider_uid,asset_id,source_kind,source_identity,parent_kind,parent_identity,
      source_revision,owner_id,binding_state,evidence_digest
    ) values (
      target_registry_id,target_uid,asset_id,v_source_kind,v_source_identity,v_parent_kind,v_parent_identity,
      (select fence.source_revision from public.stream_media_parent_fences fence
        where fence.source_kind=v_parent_kind and fence.source_identity=v_parent_identity),
      source_owner,'active',private.stream_media_identity_digest(concat_ws('|',v_source_kind,
        v_source_identity,target_uid,target_registry_id::text))
    ) on conflict (source_kind,source_identity,source_revision,registry_id,raw_provider_uid) do nothing
    returning id into v_binding_id;
    if v_binding_id is null then
      select binding.id into v_binding_id from public.stream_media_source_bindings binding
      where binding.source_kind=v_source_kind and binding.source_identity=v_source_identity
        and binding.registry_id=target_registry_id and binding.raw_provider_uid=target_uid
        and binding.binding_state in ('active','ready_for_publication');
    end if;
  end if;
  if v_binding_id is null then raise exception 'Media source binding conflict' using errcode = '23505'; end if;
  perform private.stream_record_source_accounts(v_binding_id,v_source_kind,v_source_identity,source_owner,asset_owner);
  return new;
exception when invalid_text_representation then
  raise exception 'Media source identity is invalid' using errcode = '22023';
end;
$$;
revoke all on function private.guard_stream_media_reference_write() from public, anon, authenticated, service_role;

create or replace function private.guard_stream_media_video_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_operation_id uuid := private.stream_selected_operation_id();
  existing_binding public.stream_media_source_bindings%rowtype;
  uid_state text;
  detach_allowed boolean;
  account_cascade boolean := false;
  legacy_resolution_allowed boolean := false;
  legacy_resolution_event_id uuid;
  paid_uid_retained boolean := false;
begin
  if tg_op='DELETE' then
    if old.stream_provider_account_registry_id is null
      or not private.stream_try_parent_lock('video',old.id::text)
      or not private.stream_try_uid_lock(old.stream_provider_account_registry_id,old.cloudflare_uid)
    then raise exception 'Video identity is unresolved or busy' using errcode = '55P03'; end if;
    select * into existing_binding from public.stream_media_source_bindings binding
    where binding.source_kind='video' and binding.source_identity=old.id::text
      and binding.registry_id=old.stream_provider_account_registry_id
      and binding.raw_provider_uid=old.cloudflare_uid
    order by binding.created_at desc limit 1;
    if existing_binding.id is null or not private.stream_operation_has_edge(
      v_operation_id,'video',old.id::text,old.stream_provider_account_registry_id,old.cloudflare_uid
    ) then raise exception 'Video deletion requires its exact media manifest' using errcode = '42501'; end if;
    select state.uid_state,edge.detach_allowed into uid_state,detach_allowed
    from public.stream_media_operation_uid_state state
    join public.stream_media_manifest_edges edge on edge.operation_id=state.operation_id
      and edge.registry_id=state.registry_id and edge.raw_provider_uid=state.raw_provider_uid
      and edge.binding_id=existing_binding.id
    where state.operation_id=v_operation_id and state.registry_id=old.stream_provider_account_registry_id
      and state.raw_provider_uid=old.cloudflare_uid;
    select operation.operation_kind='account_cleanup'
      and private.stream_auth_deletion_permitted(operation.owner_id)
      into account_cascade
    from public.stream_media_operations operation where operation.id=v_operation_id;
    if uid_state not in ('deleted_confirmed','already_absent_confirmed')
      and not (uid_state='retained_attached' and detach_allowed)
      and not (uid_state='retained_attached' and coalesce(account_cascade,false)) then
      raise exception 'Video provider UID has not reached a safe terminal state' using errcode = '55000'; end if;
    if uid_state in ('deleted_confirmed','already_absent_confirmed')
      and private.stream_media_has_effective_reference(old.stream_provider_account_registry_id,old.cloudflare_uid,v_operation_id)
    then raise exception 'Video still has an effective media reference' using errcode = '55000'; end if;
    return old;
  end if;
  if tg_op='UPDATE' then
    begin
      legacy_resolution_event_id := nullif(current_setting('app.stream_media_legacy_resolution_event_id',true),'')::uuid;
    exception when invalid_text_representation then
      legacy_resolution_event_id := null;
    end;
    legacy_resolution_allowed := auth.role()='service_role'
      and old.stream_provider_account_registry_id is null
      and new.stream_provider_account_registry_id is not null
      and private.stream_legacy_resolution_authorizes_video(
        legacy_resolution_event_id,new.id,new.cloudflare_uid,new.stream_provider_account_registry_id
      );
  end if;
  if new.stream_provider_account_registry_id is null then
    raise exception 'Video UID account identity is unresolved' using errcode = '55000'; end if;
  if tg_op='INSERT' then
    if not private.stream_upload_operation_matches(v_operation_id,'video',new.id::text,
      new.coach_id,new.stream_provider_account_registry_id,new.cloudflare_uid)
    then raise exception 'Video insert requires its exact pre-HTTP upload operation' using errcode = '42501'; end if;
  elsif new.coach_id is distinct from old.coach_id
    or new.cloudflare_uid is distinct from old.cloudflare_uid
    or (new.stream_provider_account_registry_id is distinct from old.stream_provider_account_registry_id
      and not legacy_resolution_allowed)
  then
    raise exception 'Video UID and owner are immutable; use a new upload operation' using errcode = '55000';
  end if;
  if tg_op='UPDATE' and new.visibility is distinct from old.visibility then
    perform private.stream_require_read_committed();
    perform private.stream_try_lock_accounts(array[old.coach_id]);
    if not private.stream_try_parent_lock('video',old.id::text) then
      raise exception 'Video media is busy' using errcode = '55P03'; end if;
    if not private.stream_try_uid_lock(new.stream_provider_account_registry_id,new.cloudflare_uid) then
      raise exception 'Video media is busy' using errcode = '55P03'; end if;
    paid_uid_retained := private.program_paid_media_uid_is_retained(old.cloudflare_uid);
    if paid_uid_retained and (new.visibility='members'
      or (old.visibility='program_only' and new.visibility='private')) then
      raise exception 'Paid Program media cannot be exposed outside protected visibility' using errcode = '42501'; end if;
  end if;
  if private.stream_account_is_tombstoned(new.coach_id) then
    raise exception 'Video owner account is closing' using errcode = '55000'; end if;
  if tg_op='UPDATE' and (new.status is distinct from old.status
      or new.visibility is distinct from old.visibility
      or new.daily_content_deletion_pending is distinct from old.daily_content_deletion_pending)
    and not private.stream_upload_operation_matches(v_operation_id,'video',new.id::text,
      new.coach_id,new.stream_provider_account_registry_id,new.cloudflare_uid)
    and not (legacy_resolution_allowed and new.status='ready'
      and exists (select 1 from public.stream_media_legacy_resolution_events resolution
        where resolution.id=legacy_resolution_event_id
          and resolution.signed_urls_verified and resolution.ready_to_stream_verified)
      and new.visibility is not distinct from old.visibility
      and new.daily_content_deletion_pending is not distinct from old.daily_content_deletion_pending)
  then
    if new.daily_content_deletion_pending is distinct from old.daily_content_deletion_pending
      and not (new.daily_content_deletion_pending and v_operation_id is not null and exists (
        select 1 from public.stream_media_operations operation
        join public.stream_media_operation_states state on state.operation_id=operation.id
        where operation.id=v_operation_id and operation.operation_kind='cleanup'
          and operation.source_kind='video' and operation.source_identity=new.id::text
          and operation.owner_id=old.coach_id and state.operation_state='cleanup_reserved'
          and private.stream_operation_has_edge(v_operation_id,'video',old.id::text,
            old.stream_provider_account_registry_id,old.cloudflare_uid)
      )) then
      raise exception 'Video deletion must use its durable owner manifest' using errcode = '55000';
    end if;
    if new.status is distinct from old.status or new.visibility is distinct from old.visibility then
      if not private.stream_try_parent_lock('video',new.id::text)
      or not private.stream_try_uid_lock(new.stream_provider_account_registry_id,new.cloudflare_uid)
      or private.stream_active_parent_fence('video',new.id::text)
      then raise exception 'Video media is busy' using errcode = '55P03'; end if;
    end if;
  end if;
  if new.visibility='program_only' then
    if not exists (
      select 1 from public.program_content_version_lessons lesson
      join public.program_content_versions version
        on version.program_id=lesson.program_id and version.id=lesson.content_version_id
      where lesson.video_id=new.id and lesson.cloudflare_uid=new.cloudflare_uid
        and lesson.cloudflare_signed_urls_verified and version.revision_kind='paid'
    ) then raise exception 'Program-only visibility requires a verified paid lesson' using errcode = '42501'; end if;
    if exists (select 1 from public.post_media media join public.posts post on post.id=media.post_id
        where media.kind='video' and media.video_uid=new.cloudflare_uid and post.removed_at is null)
      or exists (select 1 from public.tasks task where task.video_id=new.id)
      or exists (select 1 from public.member_daily_fuel_assignments assignment where assignment.video_id=new.id)
      or exists (select 1 from public.member_daily_fuel_bookmarks bookmark where bookmark.video_id=new.id)
      or exists (select 1 from public.member_daily_content_video_grants grant_row where grant_row.video_id=new.id)
    then raise exception 'Program-only media cannot have ordinary member consumers' using errcode = '42501'; end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_stream_media_video_write() from public, anon, authenticated, service_role;

create or replace function public.get_my_stream_program_order_lesson_playback(target_order_id uuid,target_lesson_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  access_row jsonb;
  lesson_row public.program_content_version_lessons%rowtype;
  order_row public.program_orders%rowtype;
  program_owner uuid;
  lesson_projection jsonb;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null
    or not private.has_platform_tier(auth.uid(),'regular')
    or exists (select 1 from public.platform_membership_deletion_locks deletion_lock
      where deletion_lock.member_id=auth.uid()) then
    return jsonb_build_object('outcome','unavailable');
  end if;
  access_row := private.program_order_lesson_access_for_member(
    target_order_id,auth.uid(),private.current_daily_checkin_day());
  if access_row is null or not coalesce(access_row->'lesson_ids' ? target_lesson_id::text,false) then
    return jsonb_build_object('outcome','unavailable');
  end if;
  select orders.* into order_row from public.program_orders orders
  where orders.id=target_order_id and orders.buyer_id=auth.uid();
  select program.coach_id into program_owner from public.programs program
  where program.id=order_row.program_id and program.published;
  select lesson.* into lesson_row from public.program_content_version_lessons lesson
  where lesson.id=target_lesson_id and lesson.program_id=order_row.program_id
    and lesson.content_version_id=order_row.content_version_id;
  if program_owner is null or lesson_row.id is null
    or lesson_row.video_creator_id is distinct from program_owner then
    return jsonb_build_object('outcome','unavailable');
  end if;
  lesson_projection:=private.stream_app_video_projection('program_lesson',lesson_row.id::text,
    program_owner,lesson_row.video_id,lesson_row.cloudflare_uid);
  if lesson_projection->>'outcome'<>'ready'
    or not private.stream_app_paid_lesson_is_exclusive(lesson_row.id,lesson_row.video_id,
      (lesson_projection->>'registry_id')::uuid,lesson_row.cloudflare_uid) then
    return jsonb_build_object('outcome','unavailable');
  end if;
  return lesson_projection;
end;
$$;
revoke all on function public.get_my_stream_program_order_lesson_playback(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_my_stream_program_order_lesson_playback(uuid,uuid) to authenticated;
