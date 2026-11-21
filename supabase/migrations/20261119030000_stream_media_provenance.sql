-- Inert Cloudflare Stream provenance observations only.
-- This migration does not authorize uploads, verify current source ownership, protect reads,
-- reserve deletion, or make any provider call. Those capabilities require later source guards.

create table public.stream_provider_account_registry (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'cloudflare_stream'
    check (provider = 'cloudflare_stream'),
  credential_slot text not null
    check (credential_slot in ('vod_primary', 'vod_secondary')),
  provider_account_id text not null
    check (provider_account_id ~ '^[0-9a-f]{32}$'),
  registration_request_id uuid not null unique,
  registration_digest text not null
    check (registration_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (credential_slot),
  unique (provider, provider_account_id),
  unique (id, provider, provider_account_id)
);

comment on table public.stream_provider_account_registry is
  'Explicit service-attested account identity metadata. Rows are empty until a trusted bootstrap records a binding. This is not HTTP verification or upload authorization.';
comment on column public.stream_provider_account_registry.credential_slot is
  'Fixed non-secret deployment selector. It is not a token or an account-discovery source.';
comment on column public.stream_provider_account_registry.registration_digest is
  'Digest of the trusted bootstrap request; never a credential or provider response body.';

create table public.stream_provider_account_attestations (
  id uuid primary key default gen_random_uuid(),
  registry_id uuid not null references public.stream_provider_account_registry (id) on delete restrict,
  request_id uuid not null unique,
  provider text not null check (provider = 'cloudflare_stream'),
  credential_slot text not null
    check (credential_slot in ('vod_primary', 'vod_secondary')),
  provider_account_id text not null
    check (provider_account_id ~ '^[0-9a-f]{32}$'),
  attestation_kind text not null
    check (attestation_kind = 'trusted_service_account_binding_report'),
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  attested_at timestamptz not null default now(),
  unique (registry_id, request_id),
  foreign key (registry_id, provider, provider_account_id)
    references public.stream_provider_account_registry (id, provider, provider_account_id) on delete restrict
);

comment on table public.stream_provider_account_attestations is
  'Append-only, trusted-service reports of an explicit account/credential-slot binding. The database does not validate Cloudflare HTTP identity.';

create table public.stream_media_upload_intents (
  id uuid primary key,
  request_id uuid not null unique,
  actor_id uuid not null,
  purpose text not null check (purpose in (
    'library_video', 'community_video', 'program_lesson_video',
    'daily_content_video', 'program_intro_video'
  )),
  source_kind text not null check (source_kind in (
    'video', 'post_media', 'program_lesson', 'daily_content_revision', 'program_intro'
  )),
  source_id uuid not null,
  parent_revision bigint not null check (parent_revision >= 0),
  provider_account_registry_id uuid not null
    references public.stream_provider_account_registry (id) on delete restrict,
  request_marker uuid not null,
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  source_guard_state text not null default 'pending_source_guard'
    check (source_guard_state = 'pending_source_guard'),
  recorded_at timestamptz not null default now(),
  unique (provider_account_registry_id, request_marker)
);

comment on table public.stream_media_upload_intents is
  'Immutable pre-HTTP intent identity. Until a later source-guard migration, every row remains pending_source_guard and authorizes no upload or source ownership.';
comment on column public.stream_media_upload_intents.request_marker is
  'Stable opaque correlation marker intended for future provider metadata; it is not an ownership proof.';

create table public.stream_provider_object_observations (
  id uuid primary key,
  request_id uuid not null unique,
  upload_intent_id uuid not null,
  provider text not null default 'cloudflare_stream'
    check (provider = 'cloudflare_stream'),
  provider_account_registry_id uuid not null
    references public.stream_provider_account_registry (id) on delete restrict,
  provider_account_id text not null
    check (provider_account_id ~ '^[0-9a-f]{32}$'),
  provider_uid text not null,
  source_kind text not null check (source_kind in (
    'video', 'post_media', 'program_lesson', 'daily_content_revision', 'program_intro'
  )),
  source_id uuid not null,
  observation_kind text not null check (observation_kind in (
    'create_reply_report', 'retrieve_report', 'list_match_report'
  )),
  provider_state text not null check (provider_state in (
    'reported_present', 'reported_missing', 'unavailable', 'invalid_response'
  )),
  signed_urls_state text not null check (signed_urls_state in (
    'unknown', 'reported_true', 'reported_false'
  )),
  creator_marker_state text not null check (creator_marker_state in (
    'unknown', 'reported_match', 'reported_mismatch'
  )),
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  observation_state text not null default 'reported_unverified'
    check (observation_state = 'reported_unverified'),
  observed_at timestamptz not null default now(),
  foreign key (upload_intent_id) references public.stream_media_upload_intents (id) on delete restrict,
  foreign key (provider_account_registry_id, provider, provider_account_id)
    references public.stream_provider_account_registry (id, provider, provider_account_id) on delete restrict
);

comment on table public.stream_provider_object_observations is
  'Append-only reports about one UID in one explicit account. Reports are not authoritative source bindings and never mean an upload is ready.';
comment on column public.stream_provider_object_observations.provider_uid is
  'Raw reported UID, retained verbatim even when it is empty or fails a provider-format check.';
comment on column public.stream_provider_object_observations.evidence_digest is
  'Digest only; no raw provider payload, upload URL, credential, or response body is stored.';

create table public.stream_source_binding_observations (
  id uuid primary key,
  request_id uuid not null unique,
  upload_intent_id uuid not null,
  provider_observation_id uuid not null
    references public.stream_provider_object_observations (id) on delete restrict,
  provider_account_registry_id uuid not null
    references public.stream_provider_account_registry (id) on delete restrict,
  provider text not null default 'cloudflare_stream'
    check (provider = 'cloudflare_stream'),
  provider_account_id text not null
    check (provider_account_id ~ '^[0-9a-f]{32}$'),
  provider_uid text not null,
  source_kind text not null check (source_kind in (
    'video', 'post_media', 'program_lesson', 'daily_content_revision', 'program_intro'
  )),
  source_id uuid not null,
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  binding_state text not null default 'pending_source_guard'
    check (binding_state = 'pending_source_guard'),
  recorded_at timestamptz not null default now(),
  foreign key (upload_intent_id) references public.stream_media_upload_intents (id) on delete restrict,
  foreign key (provider_account_registry_id, provider, provider_account_id)
    references public.stream_provider_account_registry (id, provider, provider_account_id) on delete restrict
);

comment on table public.stream_source_binding_observations is
  'Append-only exact account/UID/source/evidence observations. pending_source_guard is the only state; this table cannot certify current source ownership.';

create table public.stream_media_capture_runs (
  id uuid primary key,
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  coverage text not null default 'unguarded_incomplete'
    check (coverage = 'unguarded_incomplete'),
  authoritative boolean not null default false check (authoritative = false),
  captured_at timestamptz not null default now()
);

comment on table public.stream_media_capture_runs is
  'A bounded legacy inventory snapshot. Existing writers are not guarded, so every run is permanently marked unguarded_incomplete and non-authoritative.';

create table public.stream_media_legacy_observations (
  id uuid primary key default gen_random_uuid(),
  capture_run_id uuid not null
    references public.stream_media_capture_runs (id) on delete restrict,
  source_kind text not null check (source_kind in (
    'videos', 'post_media', 'program_content_version_lessons',
    'pinned_free_enrollment_lessons', 'program_offer_lessons', 'program_order_lessons'
  )),
  source_identity text not null,
  source_ordinal integer not null default 0 check (source_ordinal >= 0),
  reference_kind text not null check (reference_kind in (
    'mutable_video_row', 'community_post_media', 'current_program_lesson',
    'paid_program_lesson', 'free_snapshot_lesson', 'pinned_free_enrollment',
    'program_offer_reference', 'program_order_reference'
  )),
  captured_uid text,
  uid_state text not null check (uid_state in ('missing', 'present')),
  provider_account_registry_id uuid,
  account_state text not null default 'unknown' check (account_state = 'unknown'),
  observed_at timestamptz not null default now(),
  unique (capture_run_id, source_kind, source_identity, source_ordinal),
  foreign key (provider_account_registry_id)
    references public.stream_provider_account_registry (id) on delete restrict,
  check ((uid_state = 'missing') = (captured_uid is null)),
  check (provider_account_registry_id is null)
);

comment on table public.stream_media_legacy_observations is
  'Non-authoritative, account-unknown copies of legacy UID references. Source identities are opaque text and intentionally have no foreign keys to mutable source tables.';
comment on column public.stream_media_legacy_observations.captured_uid is
  'Raw UID copied without normalization or format validation; never treated as deletion permission.';

create index stream_media_legacy_capture_source_idx
  on public.stream_media_legacy_observations (capture_run_id, source_kind, source_identity);
create function private.reject_stream_media_evidence_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Stream media provenance is append-only; record a superseding observation'
    using errcode = '55000';
end;
$$;
revoke all on function private.reject_stream_media_evidence_mutation() from public, anon, authenticated, service_role;

create trigger stream_provider_account_registry_immutable
before update or delete on public.stream_provider_account_registry
for each row execute function private.reject_stream_media_evidence_mutation();
create trigger stream_provider_account_attestations_immutable
before update or delete on public.stream_provider_account_attestations
for each row execute function private.reject_stream_media_evidence_mutation();
create trigger stream_media_upload_intents_immutable
before update or delete on public.stream_media_upload_intents
for each row execute function private.reject_stream_media_evidence_mutation();
create trigger stream_provider_object_observations_immutable
before update or delete on public.stream_provider_object_observations
for each row execute function private.reject_stream_media_evidence_mutation();
create trigger stream_source_binding_observations_immutable
before update or delete on public.stream_source_binding_observations
for each row execute function private.reject_stream_media_evidence_mutation();
create trigger stream_media_capture_runs_immutable
before update or delete on public.stream_media_capture_runs
for each row execute function private.reject_stream_media_evidence_mutation();
create trigger stream_media_legacy_observations_immutable
before update or delete on public.stream_media_legacy_observations
for each row execute function private.reject_stream_media_evidence_mutation();

alter table public.stream_provider_account_registry enable row level security;
alter table public.stream_provider_account_attestations enable row level security;
alter table public.stream_media_upload_intents enable row level security;
alter table public.stream_provider_object_observations enable row level security;
alter table public.stream_source_binding_observations enable row level security;
alter table public.stream_media_capture_runs enable row level security;
alter table public.stream_media_legacy_observations enable row level security;

revoke all on public.stream_provider_account_registry,
  public.stream_provider_account_attestations,
  public.stream_media_upload_intents,
  public.stream_provider_object_observations,
  public.stream_source_binding_observations,
  public.stream_media_capture_runs,
  public.stream_media_legacy_observations
from public, anon, authenticated, service_role;

create function public.record_stream_provider_account_attestation(
  target_request_id uuid,
  target_provider_account_id text,
  target_credential_slot text,
  target_evidence_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_attestation public.stream_provider_account_attestations%rowtype;
  registry_row public.stream_provider_account_registry%rowtype;
  registry_id uuid;
  attestation_id uuid;
  lock_key text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Stream account attestation is service managed' using errcode = '42501';
  end if;
  if target_request_id is null
    or target_provider_account_id is null
    or target_provider_account_id !~ '^[0-9a-f]{32}$'
    or target_credential_slot is null
    or target_credential_slot not in ('vod_primary', 'vod_secondary')
    or target_evidence_digest is null
    or target_evidence_digest !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Stream account attestation is invalid' using errcode = '22023';
  end if;

  for lock_key in
    select lock_value from unnest(array[
      'account:' || target_provider_account_id,
      'request:' || target_request_id::text,
      'slot:' || target_credential_slot
    ]) as lock_values(lock_value)
    order by lock_value
  loop
    perform pg_advisory_xact_lock(hashtextextended(lock_key, 19030000));
  end loop;

  select * into existing_attestation
  from public.stream_provider_account_attestations attestation
  where attestation.request_id = target_request_id;
  if found then
    if existing_attestation.provider_account_id <> target_provider_account_id
      or existing_attestation.credential_slot <> target_credential_slot
      or existing_attestation.evidence_digest <> target_evidence_digest
    then
      return jsonb_build_object('outcome', 'identity_mismatch');
    end if;
    return jsonb_build_object(
      'outcome', 'already_recorded',
      'registry_id', existing_attestation.registry_id,
      'attestation_id', existing_attestation.id,
      'attestation_kind', existing_attestation.attestation_kind
    );
  end if;

  select * into registry_row
  from public.stream_provider_account_registry registry
  where registry.credential_slot = target_credential_slot
     or registry.provider_account_id = target_provider_account_id
  for update;
  if found then
    if registry_row.credential_slot <> target_credential_slot
      or registry_row.provider_account_id <> target_provider_account_id
    then
      return jsonb_build_object('outcome', 'identity_mismatch');
    end if;
    registry_id := registry_row.id;
  else
    insert into public.stream_provider_account_registry (
      credential_slot, provider_account_id, registration_request_id, registration_digest
    ) values (
      target_credential_slot, target_provider_account_id, target_request_id, target_evidence_digest
    ) returning id into registry_id;
  end if;

  insert into public.stream_provider_account_attestations (
    registry_id, request_id, provider, credential_slot, provider_account_id,
    attestation_kind, evidence_digest
  ) values (
    registry_id, target_request_id, 'cloudflare_stream', target_credential_slot,
    target_provider_account_id, 'trusted_service_account_binding_report', target_evidence_digest
  ) returning id into attestation_id;

  return jsonb_build_object(
    'outcome', 'recorded',
    'registry_id', registry_id,
    'attestation_id', attestation_id,
    'attestation_kind', 'trusted_service_account_binding_report'
  );
end;
$$;
revoke all on function public.record_stream_provider_account_attestation(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_stream_provider_account_attestation(uuid, text, text, text)
  to service_role;

create function public.record_stream_media_upload_intent(
  target_intent_id uuid,
  target_request_id uuid,
  target_actor_id uuid,
  target_purpose text,
  target_source_kind text,
  target_source_id uuid,
  target_parent_revision bigint,
  target_provider_account_registry_id uuid,
  target_request_marker uuid,
  target_payload_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_intent public.stream_media_upload_intents%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Stream upload intent recording is service managed' using errcode = '42501';
  end if;
  if target_intent_id is null or target_request_id is null or target_actor_id is null
    or target_purpose is null or target_source_kind is null
    or target_purpose not in (
      'library_video', 'community_video', 'program_lesson_video',
      'daily_content_video', 'program_intro_video'
    )
    or target_source_kind not in (
      'video', 'post_media', 'program_lesson', 'daily_content_revision', 'program_intro'
    )
    or target_source_id is null or target_parent_revision is null or target_parent_revision < 0
    or target_provider_account_registry_id is null or target_request_marker is null
    or target_payload_digest is null or target_payload_digest !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Stream upload intent is invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.stream_provider_account_registry registry
    where registry.id = target_provider_account_registry_id
  ) then
    return jsonb_build_object('outcome', 'account_unregistered');
  end if;
  if not (
    (target_purpose = 'library_video' and target_source_kind = 'video')
    or (target_purpose = 'community_video' and target_source_kind = 'post_media')
    or (target_purpose = 'program_lesson_video' and target_source_kind = 'program_lesson')
    or (target_purpose = 'daily_content_video' and target_source_kind = 'daily_content_revision')
    or (target_purpose = 'program_intro_video' and target_source_kind = 'program_intro')
  ) then
    raise exception 'Stream upload purpose and source kind do not match' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_request_id::text, 19030001));

  select * into existing_intent from public.stream_media_upload_intents intent
  where intent.request_id = target_request_id or intent.id = target_intent_id
  for update;
  if found then
    if existing_intent.id <> target_intent_id
      or existing_intent.request_id <> target_request_id
      or existing_intent.actor_id <> target_actor_id
      or existing_intent.purpose <> target_purpose
      or existing_intent.source_kind <> target_source_kind
      or existing_intent.source_id <> target_source_id
      or existing_intent.parent_revision <> target_parent_revision
      or existing_intent.provider_account_registry_id <> target_provider_account_registry_id
      or existing_intent.request_marker <> target_request_marker
      or existing_intent.payload_digest <> target_payload_digest
    then
      return jsonb_build_object('outcome', 'identity_mismatch');
    end if;
    return jsonb_build_object(
      'outcome', 'same_intent', 'intent_id', existing_intent.id,
      'source_guard_state', existing_intent.source_guard_state
    );
  end if;

  insert into public.stream_media_upload_intents (
    id, request_id, actor_id, purpose, source_kind, source_id, parent_revision,
    provider_account_registry_id, request_marker, payload_digest
  ) values (
    target_intent_id, target_request_id, target_actor_id, target_purpose, target_source_kind,
    target_source_id, target_parent_revision, target_provider_account_registry_id,
    target_request_marker, target_payload_digest
  );
  return jsonb_build_object(
    'outcome', 'recorded', 'intent_id', target_intent_id,
    'source_guard_state', 'pending_source_guard'
  );
exception
  when unique_violation then
    return jsonb_build_object('outcome', 'identity_mismatch');
end;
$$;
revoke all on function public.record_stream_media_upload_intent(uuid, uuid, uuid, text, text, uuid, bigint, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_stream_media_upload_intent(uuid, uuid, uuid, text, text, uuid, bigint, uuid, uuid, text)
  to service_role;

create function public.record_stream_provider_object_observation(
  target_observation_id uuid,
  target_request_id uuid,
  target_intent_id uuid,
  target_provider_account_registry_id uuid,
  target_provider_account_id text,
  target_provider_uid text,
  target_observation_kind text,
  target_provider_state text,
  target_signed_urls_state text,
  target_creator_marker_state text,
  target_evidence_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent_row public.stream_media_upload_intents%rowtype;
  account_row public.stream_provider_account_registry%rowtype;
  existing_observation public.stream_provider_object_observations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Provider observations are service managed' using errcode = '42501';
  end if;
  if target_observation_id is null or target_request_id is null or target_intent_id is null
    or target_provider_account_registry_id is null or target_provider_account_id is null
    or target_provider_uid is null
    or target_observation_kind is null or target_provider_state is null
    or target_signed_urls_state is null or target_creator_marker_state is null
    or target_observation_kind not in ('create_reply_report', 'retrieve_report', 'list_match_report')
    or target_provider_state not in ('reported_present', 'reported_missing', 'unavailable', 'invalid_response')
    or target_signed_urls_state not in ('unknown', 'reported_true', 'reported_false')
    or target_creator_marker_state not in ('unknown', 'reported_match', 'reported_mismatch')
    or target_evidence_digest is null or target_evidence_digest !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Provider observation is invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_request_id::text, 19030002));

  select * into intent_row from public.stream_media_upload_intents intent
  where intent.id = target_intent_id;
  if not found then return jsonb_build_object('outcome', 'intent_missing'); end if;
  select * into account_row from public.stream_provider_account_registry registry
  where registry.id = target_provider_account_registry_id;
  if not found or intent_row.provider_account_registry_id <> target_provider_account_registry_id
    or account_row.provider_account_id <> target_provider_account_id
  then
    return jsonb_build_object('outcome', 'identity_mismatch');
  end if;

  select * into existing_observation from public.stream_provider_object_observations observation
  where observation.request_id = target_request_id or observation.id = target_observation_id
  for update;
  if found then
    if existing_observation.id <> target_observation_id
      or existing_observation.request_id <> target_request_id
      or existing_observation.upload_intent_id <> target_intent_id
      or existing_observation.provider_account_registry_id <> target_provider_account_registry_id
      or existing_observation.provider_account_id <> target_provider_account_id
      or existing_observation.provider_uid <> target_provider_uid
      or existing_observation.observation_kind <> target_observation_kind
      or existing_observation.provider_state <> target_provider_state
      or existing_observation.signed_urls_state <> target_signed_urls_state
      or existing_observation.creator_marker_state <> target_creator_marker_state
      or existing_observation.evidence_digest <> target_evidence_digest
    then
      return jsonb_build_object('outcome', 'identity_mismatch');
    end if;
    return jsonb_build_object(
      'outcome', 'already_recorded', 'observation_id', existing_observation.id,
      'observation_state', existing_observation.observation_state
    );
  end if;

  insert into public.stream_provider_object_observations (
    id, request_id, upload_intent_id, provider_account_registry_id, provider_account_id,
    provider_uid, source_kind, source_id, observation_kind, provider_state,
    signed_urls_state, creator_marker_state, evidence_digest
  ) values (
    target_observation_id, target_request_id, target_intent_id,
    target_provider_account_registry_id, target_provider_account_id, target_provider_uid,
    intent_row.source_kind, intent_row.source_id, target_observation_kind, target_provider_state,
    target_signed_urls_state, target_creator_marker_state, target_evidence_digest
  );
  return jsonb_build_object(
    'outcome', 'recorded', 'observation_id', target_observation_id,
    'observation_state', 'reported_unverified'
  );
exception
  when unique_violation then
    return jsonb_build_object('outcome', 'identity_mismatch');
end;
$$;
revoke all on function public.record_stream_provider_object_observation(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_stream_provider_object_observation(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text)
  to service_role;

create function public.record_stream_source_binding_observation(
  target_observation_id uuid,
  target_request_id uuid,
  target_intent_id uuid,
  target_provider_observation_id uuid,
  target_evidence_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_observation public.stream_provider_object_observations%rowtype;
  intent_row public.stream_media_upload_intents%rowtype;
  existing_binding public.stream_source_binding_observations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Source binding observations are service managed' using errcode = '42501';
  end if;
  if target_observation_id is null or target_request_id is null or target_intent_id is null
    or target_provider_observation_id is null
    or target_evidence_digest is null or target_evidence_digest !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Source binding observation is invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_request_id::text, 19030003));

  select * into intent_row from public.stream_media_upload_intents intent
  where intent.id = target_intent_id;
  select * into provider_observation
  from public.stream_provider_object_observations observation
  where observation.id = target_provider_observation_id;
  if not found or intent_row.id is null then
    return jsonb_build_object('outcome', 'evidence_missing');
  end if;
  if provider_observation.upload_intent_id <> intent_row.id
    or provider_observation.provider_account_registry_id <> intent_row.provider_account_registry_id
    or provider_observation.source_kind <> intent_row.source_kind
    or provider_observation.source_id <> intent_row.source_id
  then
    return jsonb_build_object('outcome', 'identity_mismatch');
  end if;

  select * into existing_binding from public.stream_source_binding_observations binding
  where binding.request_id = target_request_id or binding.id = target_observation_id
  for update;
  if found then
    if existing_binding.id <> target_observation_id
      or existing_binding.request_id <> target_request_id
      or existing_binding.upload_intent_id <> target_intent_id
      or existing_binding.provider_observation_id <> target_provider_observation_id
      or existing_binding.evidence_digest <> target_evidence_digest
    then
      return jsonb_build_object('outcome', 'identity_mismatch');
    end if;
    return jsonb_build_object(
      'outcome', 'already_recorded', 'binding_id', existing_binding.id,
      'binding_state', existing_binding.binding_state
    );
  end if;

  insert into public.stream_source_binding_observations (
    id, request_id, upload_intent_id, provider_observation_id,
    provider_account_registry_id, provider_account_id, provider_uid,
    source_kind, source_id, evidence_digest
  ) values (
    target_observation_id, target_request_id, target_intent_id,
    target_provider_observation_id, provider_observation.provider_account_registry_id,
    provider_observation.provider_account_id, provider_observation.provider_uid,
    intent_row.source_kind, intent_row.source_id, target_evidence_digest
  );
  return jsonb_build_object(
    'outcome', 'recorded', 'binding_id', target_observation_id,
    'binding_state', 'pending_source_guard'
  );
exception
  when unique_violation then
    return jsonb_build_object('outcome', 'identity_mismatch');
end;
$$;
revoke all on function public.record_stream_source_binding_observation(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_stream_source_binding_observation(uuid, uuid, uuid, uuid, text)
  to service_role;

create function public.capture_legacy_stream_media(
  target_capture_id uuid,
  target_request_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_run public.stream_media_capture_runs%rowtype;
  observation_count bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Legacy media capture is service managed' using errcode = '42501';
  end if;
  if target_capture_id is null or target_request_digest is null
    or target_request_digest !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Legacy media capture request is invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_capture_id::text, 19030004));

  select * into existing_run from public.stream_media_capture_runs run
  where run.id = target_capture_id;
  if found then
    if existing_run.request_digest <> target_request_digest then
      return jsonb_build_object('outcome', 'identity_mismatch');
    end if;
    select count(*) into observation_count
    from public.stream_media_legacy_observations observation
    where observation.capture_run_id = target_capture_id;
    return jsonb_build_object(
      'outcome', 'already_captured', 'capture_id', target_capture_id,
      'coverage', existing_run.coverage, 'authoritative', existing_run.authoritative,
      'observation_count', observation_count
    );
  end if;

  insert into public.stream_media_capture_runs (id, request_digest)
  values (target_capture_id, target_request_digest);

  insert into public.stream_media_legacy_observations (
    capture_run_id, source_kind, source_identity, source_ordinal, reference_kind,
    captured_uid, uid_state, provider_account_registry_id, account_state
  )
  select target_capture_id, inventory.source_kind, inventory.source_identity,
         inventory.source_ordinal, inventory.reference_kind, inventory.raw_uid,
         case when inventory.raw_uid is null then 'missing' else 'present' end,
         null, 'unknown'
  from (
    select 'videos'::text as source_kind, video.id::text as source_identity,
           0::integer as source_ordinal, 'mutable_video_row'::text as reference_kind,
           video.cloudflare_uid as raw_uid
    from public.videos video
    union all
    select 'post_media', media.id::text, 0, 'community_post_media', media.video_uid
    from public.post_media media where media.kind = 'video'
    union all
    select 'program_content_version_lessons', lesson.id::text, lesson.lesson_ordinal::integer,
           case version.revision_kind
             when 'paid' then 'paid_program_lesson'
             when 'free_snapshot' then 'free_snapshot_lesson'
             else 'current_program_lesson'
           end,
           lesson.cloudflare_uid
    from public.program_content_version_lessons lesson
    join public.program_content_versions version
      on version.program_id = lesson.program_id
     and version.id = lesson.content_version_id
    where lesson.cloudflare_uid is not null
    union all
    select 'pinned_free_enrollment_lessons', enrollment.id::text || ':' || lesson.id::text,
           lesson.lesson_ordinal::integer, 'pinned_free_enrollment', lesson.cloudflare_uid
    from public.program_enrollments enrollment
    join public.program_content_version_lessons lesson
      on lesson.program_id = enrollment.program_id
     and lesson.content_version_id = enrollment.content_version_id
    join public.program_content_versions version
      on version.program_id = lesson.program_id and version.id = lesson.content_version_id
    where enrollment.content_version_id is not null
      and version.revision_kind = 'free_snapshot'
      and lesson.cloudflare_uid is not null
    union all
    select 'program_offer_lessons', offer.id::text || ':' || lesson.id::text,
           lesson.lesson_ordinal::integer, 'program_offer_reference', lesson.cloudflare_uid
    from public.program_offer_versions offer
    join public.program_content_version_lessons lesson
      on lesson.program_id = offer.program_id
     and lesson.content_version_id = offer.content_version_id
    where lesson.cloudflare_uid is not null
    union all
    select 'program_order_lessons', orders.id::text || ':' || lesson.id::text,
           lesson.lesson_ordinal::integer, 'program_order_reference', lesson.cloudflare_uid
    from public.program_orders orders
    join public.program_content_version_lessons lesson
      on lesson.program_id = orders.program_id
     and lesson.content_version_id = orders.content_version_id
    where lesson.cloudflare_uid is not null
  ) inventory;
  get diagnostics observation_count = row_count;

  return jsonb_build_object(
    'outcome', 'captured', 'capture_id', target_capture_id,
    'coverage', 'unguarded_incomplete', 'authoritative', false,
    'observation_count', observation_count
  );
exception
  when unique_violation then
    return jsonb_build_object('outcome', 'identity_mismatch');
end;
$$;
revoke all on function public.capture_legacy_stream_media(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.capture_legacy_stream_media(uuid, text)
  to service_role;

-- A later, separately reviewed migration must add parent/source guards and cleanup manifests.
-- These append-only records do not provide provider deletion permission or playback authority.
