-- Program Gate 3: durable media identity, retention, and cleanup lifecycle.
-- The 190300 provenance observations remain immutable, incomplete facts. This migration adds
-- guarded projections and transitions; it does not call Cloudflare or authorize browser UID input.

-- Cloudflare UIDs are unique only within an account. Existing rows stay account-unknown (NULL)
-- until separately reconciled; new rows carry the fixed registry identity in a private column.
alter table public.videos
  add column stream_provider_account_registry_id uuid
    references public.stream_provider_account_registry (id) on delete restrict;
do $$
declare constraint_row record;
begin
  for constraint_row in
    select constraint_item.conname
    from pg_constraint constraint_item
    where constraint_item.conrelid = 'public.videos'::regclass
      and constraint_item.contype = 'u'
      and pg_get_constraintdef(constraint_item.oid) = 'UNIQUE (cloudflare_uid)'
  loop
    execute format('alter table public.videos drop constraint %I', constraint_row.conname);
  end loop;
end;
$$;
create unique index videos_stream_account_uid_idx
  on public.videos (stream_provider_account_registry_id, cloudflare_uid)
  where stream_provider_account_registry_id is not null;
comment on column public.videos.stream_provider_account_registry_id is
  'Private immutable account binding for this Stream UID. NULL means legacy identity is unresolved; never infer it from current environment credentials.';

-- Verification events bind the fixed deployment slot as well as the account ID.
alter table public.stream_provider_account_registry
  add constraint stream_provider_registry_slot_account_identity_key
  unique (id, credential_slot, provider_account_id);

create table public.stream_provider_account_verification_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  registry_id uuid not null references public.stream_provider_account_registry (id) on delete restrict,
  credential_slot text not null check (credential_slot in ('vod_primary', 'vod_secondary')),
  provider_account_id text not null check (provider_account_id ~ '^[0-9a-f]{32}$'),
  verification_kind text not null check (verification_kind = 'explicit_account_stream_path_access'),
  http_status smallint not null check (http_status between 200 and 299),
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz not null default now(),
  foreign key (registry_id, credential_slot, provider_account_id)
    references public.stream_provider_account_registry (id, credential_slot, provider_account_id)
    on delete restrict
);

comment on table public.stream_provider_account_verification_events is
  'Service-reported success against the explicit Cloudflare Stream account path. The response has no account-id field; this row is evidence, not a secret or independent provider proof.';

create table public.stream_provider_account_verification_state (
  registry_id uuid primary key references public.stream_provider_account_registry (id) on delete restrict,
  verification_event_id uuid not null references public.stream_provider_account_verification_events (id) on delete restrict,
  verified_until timestamptz not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

create table public.stream_media_assets (
  id uuid primary key default gen_random_uuid(),
  registry_id uuid not null references public.stream_provider_account_registry (id) on delete restrict,
  raw_provider_uid text not null check (char_length(raw_provider_uid) between 1 and 200),
  owner_id uuid not null,
  upload_intent_id uuid references public.stream_media_upload_intents (id) on delete restrict,
  creator_observation text,
  marker_observation text,
  signed_urls_verified boolean not null default false,
  ready_to_stream_verified boolean not null default false,
  lifecycle_state text not null check (lifecycle_state in (
    'provisional_bound', 'ready_for_publication', 'cleanup_pending',
    'delete_unknown', 'deleted_confirmed', 'quarantined'
  )),
  asset_revision bigint not null default 1 check (asset_revision > 0),
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz not null default now(),
  unique (registry_id, raw_provider_uid),
  unique (id, registry_id, raw_provider_uid),
  check (lifecycle_state <> 'ready_for_publication'
    or (signed_urls_verified and ready_to_stream_verified))
);
comment on table public.stream_media_assets is
  'Account-scoped current asset projection. Creator/meta are mutable provider observations; ready_for_publication requires an exact asset readback and source CAS, not a create reply.';

create table public.stream_media_asset_events (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.stream_media_assets (id) on delete restrict,
  event_kind text not null check (event_kind in (
    'provisional_bind', 'ready_readback', 'cleanup_reserved', 'delete_started',
    'delete_unknown', 'delete_confirmed', 'quarantined'
  )),
  asset_revision bigint not null check (asset_revision > 0),
  request_id uuid not null,
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (asset_id, asset_revision)
);

create table public.stream_media_parent_fences (
  source_kind text not null check (source_kind in (
    'video', 'post', 'post_media', 'program', 'program_day', 'program_lesson',
    'program_offer', 'program_order', 'program_enrollment', 'program_intro',
    'daily_content_item', 'daily_content_revision', 'daily_content_slot', 'daily_content_grant',
    'task', 'daily_fuel_assignment', 'daily_fuel_bookmark', 'profile', 'account'
  )),
  source_identity text not null check (char_length(source_identity) between 1 and 200),
  owner_id uuid,
  source_revision bigint not null default 1 check (source_revision > 0),
  fence_state text not null default 'open' check (fence_state in ('open', 'closing', 'closed')),
  active_operation_id uuid,
  state_revision bigint not null default 1 check (state_revision > 0),
  updated_at timestamptz not null default now(),
  primary key (source_kind, source_identity),
  check ((fence_state in ('open', 'closed')) = (active_operation_id is null))
);

create table public.stream_media_operations (
  id uuid primary key,
  request_id uuid not null unique,
  operation_kind text not null check (operation_kind in (
    'upload', 'cleanup', 'source_mutation', 'account_cleanup'
  )),
  actor_id uuid,
  owner_id uuid,
  source_kind text not null check (source_kind in (
    'video', 'post', 'post_media', 'program', 'program_day', 'program_lesson',
    'program_offer', 'program_order', 'program_enrollment', 'program_intro',
    'daily_content_item', 'daily_content_revision', 'daily_content_slot', 'daily_content_grant',
    'task', 'daily_fuel_assignment', 'daily_fuel_bookmark', 'profile', 'account'
  )),
  source_identity text not null check (char_length(source_identity) between 1 and 200),
  parent_kind text not null check (parent_kind in (
    'video', 'post', 'program', 'program_day', 'program_lesson', 'program_intro',
    'daily_content_item', 'daily_content_revision', 'daily_content_grant',
    'daily_content_slot', 'task', 'daily_fuel_assignment', 'daily_fuel_bookmark',
    'profile', 'account'
  )),
  parent_identity text not null check (char_length(parent_identity) between 1 and 200),
  expected_source_revision bigint not null check (expected_source_revision >= 0),
  registry_id uuid references public.stream_provider_account_registry (id) on delete restrict,
  intent_id uuid references public.stream_media_upload_intents (id) on delete restrict,
  operation_digest text not null check (operation_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (id, operation_kind, source_kind, source_identity)
);
comment on table public.stream_media_operations is
  'Immutable operation identity. A local GUC can select this row but cannot authorize a mutation without the exact durable state, actor, parent, revision, and manifest checks.';

create table public.stream_media_operation_states (
  operation_id uuid primary key references public.stream_media_operations (id) on delete restrict,
  operation_state text not null check (operation_state in (
    'reserved', 'create_started', 'create_unknown', 'created_unverified',
    'provisional_bound', 'ready_for_publication', 'cleanup_reserved',
    'delete_started', 'delete_unknown', 'source_finalizing', 'completed',
    'retained', 'failed', 'auth_call_started', 'auth_result_unknown', 'auth_confirmed'
  )),
  state_revision bigint not null default 1 check (state_revision > 0),
  updated_at timestamptz not null default now()
);

create table public.stream_media_operation_events (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.stream_media_operations (id) on delete restrict,
  sequence_number bigint not null check (sequence_number > 0),
  from_state text,
  to_state text not null,
  request_id uuid not null,
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (operation_id, sequence_number),
  unique (operation_id, request_id)
);

-- Exact caller request/digest replay for irreversible source finalizers. The state event keeps
-- its internal transition ID; this receipt makes a lost success response safely repeatable.
create table public.stream_media_finalization_receipts (
  operation_id uuid not null references public.stream_media_operations (id) on delete restrict,
  request_id uuid not null,
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  terminal_state text not null check (terminal_state in ('completed','retained')),
  response jsonb not null check (jsonb_typeof(response)='object'),
  created_at timestamptz not null default now(),
  primary key (operation_id,request_id)
);

create table public.stream_media_upload_observations (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.stream_media_operations (id) on delete restrict,
  registry_id uuid not null references public.stream_provider_account_registry (id) on delete restrict,
  observation_kind text not null check (observation_kind in (
    'create_reply', 'exact_uid_get', 'unique_marker_list_match'
  )),
  raw_provider_uid text,
  http_status smallint check (http_status between 100 and 599),
  signed_urls_reported boolean,
  creator_marker_matched boolean,
  metadata_marker_matched boolean,
  ready_to_stream_reported boolean,
  request_id uuid not null,
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (operation_id, request_id),
  check ((observation_kind = 'create_reply') or raw_provider_uid is not null)
);

create table public.stream_media_upload_contexts (
  intent_id uuid primary key references public.stream_media_upload_intents (id) on delete restrict,
  parent_kind text not null check (parent_kind in (
    'video', 'post', 'program', 'program_day', 'program_lesson', 'program_intro',
    'daily_content_item', 'daily_content_revision', 'profile'
  )),
  parent_identity text not null check (char_length(parent_identity) between 1 and 200),
  owner_id uuid not null,
  source_revision bigint not null check (source_revision > 0),
  context_digest text not null check (context_digest ~ '^[0-9a-f]{64}$'),
  request_id uuid not null unique,
  created_at timestamptz not null default now()
);

-- An upload intent is associated with both its actor and eventual source owner before the
-- provider call. This survives a missing video/binding row during account-deletion inventory.
create table public.stream_media_upload_account_edges (
  intent_id uuid not null references public.stream_media_upload_intents (id) on delete restrict,
  account_id uuid not null,
  relation_kind text not null check (relation_kind in ('actor','source_owner')),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (intent_id, account_id, relation_kind),
  unique (intent_id, relation_kind)
);

-- A legacy observation stays immutable. This separate service attestation resolves exactly one
-- captured source after an account-scoped exact-UID readback and a fresh source-row check.
create table public.stream_media_legacy_resolution_events (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null unique
    references public.stream_media_legacy_observations (id) on delete restrict,
  registry_id uuid not null references public.stream_provider_account_registry (id) on delete restrict,
  canonical_source_kind text not null check (canonical_source_kind in ('video','post_media','program_lesson')),
  canonical_source_identity text not null check (char_length(canonical_source_identity) between 1 and 200),
  raw_provider_uid text not null,
  owner_id uuid not null,
  source_revision bigint not null check (source_revision > 0),
  http_status smallint not null check (http_status = 200),
  signed_urls_verified boolean not null,
  ready_to_stream_verified boolean not null,
  request_id uuid not null unique,
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (id, registry_id, raw_provider_uid)
);

create table public.stream_media_source_bindings (
  id uuid primary key default gen_random_uuid(),
  registry_id uuid references public.stream_provider_account_registry (id) on delete restrict,
  raw_provider_uid text not null,
  asset_id uuid references public.stream_media_assets (id) on delete restrict,
  source_kind text not null check (source_kind in (
    'video', 'post', 'post_media', 'program', 'program_day', 'program_lesson',
    'program_offer', 'program_order', 'program_enrollment', 'program_intro',
    'daily_content_item', 'daily_content_revision', 'daily_content_slot', 'daily_content_grant',
    'task', 'daily_fuel_assignment', 'daily_fuel_bookmark'
  )),
  source_identity text not null check (char_length(source_identity) between 1 and 200),
  parent_kind text,
  parent_identity text,
  source_revision bigint not null check (source_revision > 0),
  owner_id uuid,
  binding_state text not null check (binding_state in (
    'legacy_unverified', 'provisional_bound', 'ready_for_publication',
    'active', 'detached', 'retained', 'quarantined'
  )),
  observed_creator text,
  observed_marker text,
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  state_revision bigint not null default 1 check (state_revision > 0),
  updated_at timestamptz not null default now(),
  check ((registry_id is null) = (asset_id is null)),
  unique (id, registry_id, raw_provider_uid),
  unique (source_kind, source_identity, source_revision, registry_id, raw_provider_uid)
);
comment on table public.stream_media_source_bindings is
  'Source identity values are deliberately not foreign keys to mutable posts, Program rows, enrollments, or profiles. Legacy-unverified edges never authorize provider deletion or paid playback.';

create table public.stream_media_source_binding_events (
  id uuid primary key default gen_random_uuid(),
  binding_id uuid not null references public.stream_media_source_bindings (id) on delete restrict,
  event_kind text not null check (event_kind in ('attached', 'detached', 'retained', 'quarantined')),
  source_revision bigint not null check (source_revision > 0),
  request_id uuid not null,
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (binding_id, request_id)
);

create table public.stream_media_source_account_edges (
  binding_id uuid not null references public.stream_media_source_bindings (id) on delete restrict,
  account_id uuid not null,
  relation_kind text not null check (relation_kind in (
    'source_owner','asset_owner','assigned_member','bookmark_owner','grant_recipient'
  )),
  recorded_at timestamptz not null default now(),
  primary key (binding_id,account_id,relation_kind)
);

create table public.stream_media_operation_uid_state (
  operation_id uuid not null references public.stream_media_operations (id) on delete restrict,
  registry_id uuid not null references public.stream_provider_account_registry (id) on delete restrict,
  raw_provider_uid text not null,
  uid_state text not null check (uid_state in (
    'reserved', 'delete_started', 'delete_unknown', 'deleted_confirmed',
    'already_absent_confirmed', 'retained_attached', 'detached_retained'
  )),
  state_revision bigint not null default 1 check (state_revision > 0),
  last_event_id uuid,
  updated_at timestamptz not null default now(),
  primary key (operation_id, registry_id, raw_provider_uid)
);

create table public.stream_media_manifest_edges (
  operation_id uuid not null references public.stream_media_operations (id) on delete restrict,
  edge_number integer not null check (edge_number > 0),
  binding_id uuid not null references public.stream_media_source_bindings (id) on delete restrict,
  source_kind text not null,
  source_identity text not null,
  source_revision bigint not null check (source_revision > 0),
  registry_id uuid not null references public.stream_provider_account_registry (id) on delete restrict,
  raw_provider_uid text not null,
  detach_allowed boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (operation_id, edge_number),
  unique (operation_id, binding_id),
  foreign key (operation_id, registry_id, raw_provider_uid)
    references public.stream_media_operation_uid_state (operation_id, registry_id, raw_provider_uid)
    on delete restrict
);
comment on table public.stream_media_manifest_edges is
  'Immutable edge-level snapshot: duplicate provider work is deduplicated by account+UID, but every source identity remains auditable.';

create table public.stream_media_operation_uid_events (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  registry_id uuid not null,
  raw_provider_uid text not null,
  sequence_number bigint not null check (sequence_number > 0),
  outcome text not null check (outcome in (
    'delete_started', 'delete_unknown', 'deleted_confirmed',
    'already_absent_confirmed', 'retained_attached', 'detached_retained'
  )),
  request_id uuid not null,
  delete_http_status smallint check (delete_http_status between 100 and 599),
  http_status smallint check (http_status between 100 and 599),
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (operation_id, registry_id, raw_provider_uid)
    references public.stream_media_operation_uid_state (operation_id, registry_id, raw_provider_uid)
    on delete restrict,
  unique (operation_id, registry_id, raw_provider_uid, sequence_number),
  unique (operation_id, registry_id, raw_provider_uid, request_id)
);

create table public.stream_media_retention_obligations (
  id uuid primary key default gen_random_uuid(),
  registry_id uuid references public.stream_provider_account_registry (id) on delete restrict,
  raw_provider_uid text not null,
  source_kind text not null,
  source_identity text not null,
  source_revision bigint not null check (source_revision > 0),
  obligation_kind text not null check (obligation_kind in (
    'marketed_offer', 'paid_order', 'checkout_intent', 'zero_total_order',
    'pinned_free_enrollment', 'ordinary_source'
  )),
  obligation_state text not null check (obligation_state in ('active', 'released')),
  release_event_id uuid,
  updated_at timestamptz not null default now(),
  unique (registry_id, raw_provider_uid, source_kind, source_identity, source_revision, obligation_kind)
);
create index stream_media_retention_uid_state_idx
  on public.stream_media_retention_obligations (raw_provider_uid, obligation_state);
create unique index stream_media_retention_identity_idx
  on public.stream_media_retention_obligations (
    coalesce(registry_id, '00000000-0000-0000-0000-000000000000'::uuid),
    raw_provider_uid, source_kind, source_identity, source_revision, obligation_kind
  );

create table public.stream_media_retention_events (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.stream_media_retention_obligations (id) on delete restrict,
  event_kind text not null check (event_kind in ('retained', 'released', 'superseded')),
  actor_id uuid,
  reason_code text not null check (char_length(reason_code) between 1 and 80),
  request_id uuid not null,
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (obligation_id, request_id)
);

create table public.stream_media_account_tombstones (
  id uuid primary key,
  account_id uuid not null unique,
  request_id uuid not null unique,
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  tombstone_state text not null check (tombstone_state in (
    'closing', 'provider_cleanup', 'auth_deletion_ready', 'auth_call_started',
    'auth_result_unknown', 'auth_confirmed', 'completed'
  )),
  source_revision_digest text,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, account_id)
);

create table public.stream_media_auth_deletion_permits (
  id uuid primary key,
  tombstone_id uuid not null unique references public.stream_media_account_tombstones (id) on delete restrict,
  account_id uuid not null unique,
  request_id uuid not null unique,
  source_revision_digest text not null check (source_revision_digest ~ '^[0-9a-f]{64}$'),
  manifest_digest text not null check (manifest_digest ~ '^[0-9a-f]{64}$'),
  manifest_count integer not null check (manifest_count >= 0),
  permit_state text not null check (permit_state in (
    'ready', 'auth_call_started', 'auth_result_unknown', 'auth_confirmed', 'completed'
  )),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tombstone_id, account_id)
    references public.stream_media_account_tombstones (id, account_id) on delete restrict
);

create table public.stream_media_auth_permit_manifests (
  permit_id uuid not null references public.stream_media_auth_deletion_permits (id) on delete restrict,
  operation_id uuid not null references public.stream_media_operations (id) on delete restrict,
  operation_digest text not null check (operation_digest ~ '^[0-9a-f]{64}$'),
  source_revision bigint not null check (source_revision > 0),
  primary key (permit_id, operation_id)
);

create table public.stream_media_auth_deletion_events (
  id uuid primary key default gen_random_uuid(),
  permit_id uuid not null references public.stream_media_auth_deletion_permits (id) on delete restrict,
  event_kind text not null check (event_kind in (
    'permit_ready', 'permit_revalidated', 'auth_call_started', 'auth_result_unknown', 'auth_confirmed', 'completed'
  )),
  request_id uuid not null,
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (permit_id, request_id)
);

create table public.stream_media_account_tombstone_events (
  id uuid primary key default gen_random_uuid(),
  tombstone_id uuid not null references public.stream_media_account_tombstones (id) on delete restrict,
  event_kind text not null check (event_kind in (
    'closing', 'provider_cleanup', 'auth_deletion_ready', 'auth_call_started',
    'auth_result_unknown', 'auth_confirmed', 'completed'
  )),
  request_id uuid not null,
  source_revision_digest text,
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (tombstone_id, request_id)
);

create index stream_media_assets_uid_idx on public.stream_media_assets (raw_provider_uid, registry_id);
create index stream_media_bindings_source_idx
  on public.stream_media_source_bindings (source_kind, source_identity, binding_state);
create unique index stream_media_bindings_identity_idx
  on public.stream_media_source_bindings (
    source_kind, source_identity, source_revision,
    coalesce(registry_id, '00000000-0000-0000-0000-000000000000'::uuid), raw_provider_uid
  );
create index stream_media_operations_parent_idx
  on public.stream_media_operations (source_kind, source_identity, created_at desc);
create index stream_media_manifest_uid_idx
  on public.stream_media_manifest_edges (registry_id, raw_provider_uid, operation_id);

alter table public.stream_provider_account_verification_events enable row level security;
alter table public.stream_provider_account_verification_state enable row level security;
alter table public.stream_media_assets enable row level security;
alter table public.stream_media_asset_events enable row level security;
alter table public.stream_media_parent_fences enable row level security;
alter table public.stream_media_operations enable row level security;
alter table public.stream_media_operation_states enable row level security;
alter table public.stream_media_operation_events enable row level security;
alter table public.stream_media_finalization_receipts enable row level security;
alter table public.stream_media_legacy_resolution_events enable row level security;
alter table public.stream_media_upload_observations enable row level security;
alter table public.stream_media_upload_contexts enable row level security;
alter table public.stream_media_upload_account_edges enable row level security;
alter table public.stream_media_source_bindings enable row level security;
alter table public.stream_media_source_binding_events enable row level security;
alter table public.stream_media_source_account_edges enable row level security;
alter table public.stream_media_operation_uid_state enable row level security;
alter table public.stream_media_manifest_edges enable row level security;
alter table public.stream_media_operation_uid_events enable row level security;
alter table public.stream_media_retention_obligations enable row level security;
alter table public.stream_media_retention_events enable row level security;
alter table public.stream_media_account_tombstones enable row level security;
alter table public.stream_media_auth_deletion_permits enable row level security;
alter table public.stream_media_auth_permit_manifests enable row level security;
alter table public.stream_media_auth_deletion_events enable row level security;
alter table public.stream_media_account_tombstone_events enable row level security;

revoke all on public.stream_provider_account_verification_events,
  public.stream_provider_account_verification_state,
  public.stream_media_assets, public.stream_media_asset_events,
  public.stream_media_parent_fences, public.stream_media_operations,
  public.stream_media_operation_states, public.stream_media_operation_events,
  public.stream_media_finalization_receipts,
  public.stream_media_legacy_resolution_events,
  public.stream_media_upload_observations,
  public.stream_media_upload_contexts,
  public.stream_media_upload_account_edges,
  public.stream_media_source_bindings, public.stream_media_source_binding_events,
  public.stream_media_source_account_edges,
  public.stream_media_operation_uid_state, public.stream_media_manifest_edges,
  public.stream_media_operation_uid_events, public.stream_media_retention_obligations,
  public.stream_media_retention_events, public.stream_media_account_tombstones,
  public.stream_media_auth_deletion_permits, public.stream_media_auth_permit_manifests,
  public.stream_media_auth_deletion_events, public.stream_media_account_tombstone_events
from public, anon, authenticated, service_role;

create function private.reject_stream_media_lifecycle_evidence_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Stream media lifecycle evidence is append-only' using errcode = '55000';
end;
$$;
revoke all on function private.reject_stream_media_lifecycle_evidence_mutation()
  from public, anon, authenticated, service_role;

create trigger stream_account_verification_events_immutable
before update or delete on public.stream_provider_account_verification_events
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();
create trigger stream_media_asset_events_immutable
before update or delete on public.stream_media_asset_events
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();
create trigger stream_media_operation_events_immutable
before update or delete on public.stream_media_operation_events
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();
create trigger stream_media_finalization_receipts_immutable
before update or delete on public.stream_media_finalization_receipts
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();
create trigger stream_media_legacy_resolution_events_immutable
before update or delete on public.stream_media_legacy_resolution_events
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();
create trigger stream_media_upload_observations_immutable
before update or delete on public.stream_media_upload_observations
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();
create trigger stream_media_upload_contexts_immutable
before update or delete on public.stream_media_upload_contexts
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();
create trigger stream_media_upload_account_edges_immutable
before update or delete on public.stream_media_upload_account_edges
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();
create trigger stream_media_source_binding_events_immutable
before update or delete on public.stream_media_source_binding_events
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();
create trigger stream_media_source_account_edges_immutable
before update or delete on public.stream_media_source_account_edges
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();
create trigger stream_media_operation_uid_events_immutable
before update or delete on public.stream_media_operation_uid_events
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();
create trigger stream_media_retention_events_immutable
before update or delete on public.stream_media_retention_events
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();
create trigger stream_media_auth_deletion_events_immutable
before update or delete on public.stream_media_auth_deletion_events
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();
create trigger stream_media_auth_permit_manifests_immutable
before update or delete on public.stream_media_auth_permit_manifests
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();
create trigger stream_media_account_tombstone_events_immutable
before update or delete on public.stream_media_account_tombstone_events
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();

create function private.stream_media_identity_digest(payload text)
returns text
language sql
immutable
set search_path = ''
as $$
  select md5(coalesce(payload, '')) || md5('stream-media-gate3|' || coalesce(payload, ''));
$$;
revoke all on function private.stream_media_identity_digest(text) from public, anon, authenticated, service_role;

create function private.stream_media_request_uuid(seed text)
returns uuid
language sql immutable set search_path = ''
as $$
  select (substr(md5(seed),1,8)||'-'||substr(md5(seed),9,4)||'-'||substr(md5(seed),13,4)||'-'
    ||substr(md5(seed),17,4)||'-'||substr(md5(seed),21,12))::uuid;
$$;
revoke all on function private.stream_media_request_uuid(text) from public, anon, authenticated, service_role;

create function private.stream_try_uid_lock(target_registry_id uuid, target_uid text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select pg_try_advisory_xact_lock(hashtextextended(
    coalesce(target_registry_id::text, 'unknown-account') || chr(31) || coalesce(target_uid, ''),
    19031000
  ));
$$;
revoke all on function private.stream_try_uid_lock(uuid, text) from public, anon, authenticated, service_role;

create function private.stream_try_uid_locks(target_registry_ids uuid[], target_uids text[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  item record;
begin
  if coalesce(cardinality(target_registry_ids), 0) <> coalesce(cardinality(target_uids), 0) then
    raise exception 'Media UID lock set is invalid' using errcode = '22023';
  end if;
  for item in
    select lock_item.registry_id, lock_item.raw_uid
    from unnest(target_registry_ids, target_uids) as lock_item(registry_id, raw_uid)
    order by coalesce(lock_item.registry_id::text, ''), lock_item.raw_uid
  loop
    if not private.stream_try_uid_lock(item.registry_id, item.raw_uid) then
      raise exception 'Media UID is busy; retry the complete operation' using errcode = '40001';
    end if;
  end loop;
end;
$$;
revoke all on function private.stream_try_uid_locks(uuid[], text[]) from public, anon, authenticated, service_role;

create function private.stream_require_read_committed()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'This media operation requires READ COMMITTED isolation' using errcode = '25001';
  end if;
end;
$$;
revoke all on function private.stream_require_read_committed() from public, anon, authenticated, service_role;

create function private.stream_account_is_verified(target_registry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.stream_provider_account_verification_state state
    join public.stream_provider_account_registry registry on registry.id = state.registry_id
    where state.registry_id = target_registry_id
      and state.verified_until > now()
      and registry.provider = 'cloudflare_stream'
  );
$$;
revoke all on function private.stream_account_is_verified(uuid) from public, anon, authenticated, service_role;

create function private.stream_account_is_tombstoned(target_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.stream_media_account_tombstones tombstone
    where tombstone.account_id = target_account_id
  );
$$;
revoke all on function private.stream_account_is_tombstoned(uuid) from public, anon, authenticated, service_role;

create function private.stream_legacy_uid_unresolved(target_registry_id uuid,target_uid text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.stream_media_legacy_observations observation
    where observation.uid_state='present' and observation.account_state='unknown'
      and observation.captured_uid=target_uid
      and not exists (
        select 1 from public.stream_media_legacy_resolution_events resolution
        where resolution.observation_id=observation.id
          and resolution.registry_id=target_registry_id
          and resolution.raw_provider_uid=observation.captured_uid
      )
  );
$$;
revoke all on function private.stream_legacy_uid_unresolved(uuid,text)
  from public, anon, authenticated, service_role;

create function private.stream_legacy_observation_source_current(target_observation_id uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  observation public.stream_media_legacy_observations%rowtype;
  first_id uuid;
  second_id uuid;
begin
  select * into observation from public.stream_media_legacy_observations item
    where item.id=target_observation_id;
  if not found or observation.uid_state<>'present' or observation.captured_uid is null then return false; end if;
  if observation.source_kind in ('pinned_free_enrollment_lessons','program_offer_lessons','program_order_lessons') then
    first_id := nullif(split_part(observation.source_identity,':',1),'')::uuid;
    second_id := nullif(split_part(observation.source_identity,':',2),'')::uuid;
  else
    first_id := nullif(observation.source_identity,'')::uuid;
  end if;
  if observation.source_kind='videos' then
    return exists(select 1 from public.videos video
      where video.id=first_id and video.cloudflare_uid=observation.captured_uid);
  elsif observation.source_kind='post_media' then
    return exists(select 1 from public.post_media media
      where media.id=first_id and media.kind='video' and media.video_uid=observation.captured_uid);
  elsif observation.source_kind='program_content_version_lessons' then
    return exists(select 1 from public.program_content_version_lessons lesson
      where lesson.id=first_id and lesson.cloudflare_uid=observation.captured_uid);
  elsif observation.source_kind='pinned_free_enrollment_lessons' then
    return exists(select 1 from public.program_enrollments enrollment
      join public.program_content_version_lessons lesson
        on lesson.program_id=enrollment.program_id and lesson.content_version_id=enrollment.content_version_id
      join public.program_content_versions version
        on version.program_id=lesson.program_id and version.id=lesson.content_version_id
      where enrollment.id=first_id and lesson.id=second_id
        and version.revision_kind='free_snapshot' and lesson.cloudflare_uid=observation.captured_uid);
  elsif observation.source_kind='program_offer_lessons' then
    return exists(select 1 from public.program_offer_versions offer
      join public.program_content_version_lessons lesson
        on lesson.program_id=offer.program_id and lesson.content_version_id=offer.content_version_id
      where offer.id=first_id and lesson.id=second_id and lesson.cloudflare_uid=observation.captured_uid);
  elsif observation.source_kind='program_order_lessons' then
    return exists(select 1 from public.program_orders orders
      join public.program_content_version_lessons lesson
        on lesson.program_id=orders.program_id and lesson.content_version_id=orders.content_version_id
      where orders.id=first_id and lesson.id=second_id and lesson.cloudflare_uid=observation.captured_uid);
  end if;
  return false;
exception when invalid_text_representation then
  return false;
end;
$$;
revoke all on function private.stream_legacy_observation_source_current(uuid)
  from public, anon, authenticated, service_role;

-- Storage ingress uses this in its INSERT policy in the same transaction as object creation.
-- It shares the account-deletion mutex, so either the upload commits before the tombstone or
-- the upload is rejected after cleanup has started; a separate preflight read is insufficient.
create function private.stream_media_account_ingress_allowed(target_account_id uuid)
returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if target_account_id is null then return false; end if;
  if auth.role() is not distinct from 'authenticated'
    and auth.uid() is distinct from target_account_id then
    return false;
  end if;
  if auth.role() is distinct from 'authenticated'
    and auth.role() is distinct from 'service_role' then return false; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('account:'||target_account_id::text,19031003)) then
    return false;
  end if;
  return not private.stream_account_is_tombstoned(target_account_id);
end;
$$;
revoke all on function private.stream_media_account_ingress_allowed(uuid) from public, anon, authenticated, service_role;
grant execute on function private.stream_media_account_ingress_allowed(uuid) to authenticated, service_role;

create function private.stream_lock_accounts(target_account_ids uuid[])
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare account_id uuid;
begin
  for account_id in
    select distinct item.account_id from unnest(target_account_ids) item(account_id)
    where item.account_id is not null order by item.account_id
  loop
    perform pg_advisory_xact_lock(hashtextextended('account:'||account_id::text,19031003));
  end loop;
end;
$$;
revoke all on function private.stream_lock_accounts(uuid[]) from public, anon, authenticated, service_role;

create function private.stream_try_lock_accounts(target_account_ids uuid[])
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare account_id uuid;
begin
  for account_id in
    select distinct item.account_id from unnest(target_account_ids) item(account_id)
    where item.account_id is not null order by item.account_id
  loop
    if not pg_try_advisory_xact_lock(hashtextextended('account:'||account_id::text,19031003)) then
      raise exception 'Media account is busy; retry the full mutation' using errcode = '55P03';
    end if;
  end loop;
end;
$$;
revoke all on function private.stream_try_lock_accounts(uuid[]) from public, anon, authenticated, service_role;

create function private.stream_source_may_match_account(
  target_source_kind text,
  target_source_identity text,
  target_uid text,
  target_registry_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not exists (
      select 1 from public.stream_media_source_bindings binding
      where binding.source_kind = target_source_kind
        and binding.source_identity = target_source_identity
        and binding.raw_provider_uid = target_uid
        and binding.binding_state in ('legacy_unverified', 'provisional_bound',
          'ready_for_publication', 'active', 'retained', 'quarantined')
    ) then true
    else exists (
      select 1 from public.stream_media_source_bindings binding
      where binding.source_kind = target_source_kind
        and binding.source_identity = target_source_identity
        and binding.raw_provider_uid = target_uid
        and binding.binding_state in ('legacy_unverified', 'provisional_bound',
          'ready_for_publication', 'active', 'retained', 'quarantined')
        and (binding.registry_id is null or binding.registry_id = target_registry_id)
    )
  end;
$$;
revoke all on function private.stream_source_may_match_account(text, text, text, uuid)
  from public, anon, authenticated, service_role;

create function private.stream_manifest_edge_authorized(
  target_operation_id uuid,
  target_source_kind text,
  target_source_identity text,
  target_registry_id uuid,
  target_uid text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.stream_media_operations operation
    join public.stream_media_operation_states state on state.operation_id = operation.id
    join public.stream_media_manifest_edges edge on edge.operation_id = operation.id
    join public.stream_media_source_bindings binding on binding.id = edge.binding_id
    where operation.id = target_operation_id
      and operation.operation_kind in ('cleanup', 'account_cleanup')
      and state.operation_state in ('cleanup_reserved', 'delete_started', 'delete_unknown', 'source_finalizing')
      and edge.source_kind = target_source_kind
      and edge.source_identity = target_source_identity
      and edge.registry_id = target_registry_id
      and edge.raw_provider_uid = target_uid
      and edge.source_revision = binding.source_revision
      and binding.registry_id = target_registry_id
      and binding.raw_provider_uid = target_uid
      and (
        (operation.source_kind = target_source_kind and operation.source_identity = target_source_identity)
        or (operation.operation_kind = 'account_cleanup' and operation.owner_id = binding.owner_id)
        or (binding.parent_kind = operation.source_kind
          and binding.parent_identity = operation.source_identity)
      )
      and (
        operation.owner_id is not distinct from binding.owner_id
        or (operation.operation_kind = 'account_cleanup' and operation.owner_id = binding.owner_id)
      )
      and exists (
        select 1 from public.stream_media_parent_fences fence
        where fence.source_kind = operation.source_kind
          and fence.source_identity = operation.source_identity
          and fence.active_operation_id = operation.id
          and fence.source_revision = operation.expected_source_revision
      )
  );
$$;
revoke all on function private.stream_manifest_edge_authorized(uuid, text, text, uuid, text)
  from public, anon, authenticated, service_role;

create function private.stream_media_has_effective_reference(
  target_registry_id uuid,
  target_uid text,
  target_excluded_operation_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_uid is null or exists (
    select 1 from public.stream_media_retention_obligations obligation
    where obligation.raw_provider_uid = target_uid
      and obligation.obligation_state = 'active'
      and (obligation.registry_id is null or obligation.registry_id = target_registry_id)
  ) or exists (
    select 1 where private.stream_legacy_uid_unresolved(target_registry_id,target_uid)
  ) or exists (
    select 1 from public.stream_media_source_bindings binding
    where binding.raw_provider_uid = target_uid
      and binding.binding_state in ('legacy_unverified', 'provisional_bound',
        'ready_for_publication', 'active', 'retained', 'quarantined')
      and binding.source_kind <> 'program_lesson'
      and (binding.registry_id is null or binding.registry_id = target_registry_id)
      and not private.stream_manifest_edge_authorized(
        target_excluded_operation_id, binding.source_kind, binding.source_identity,
        coalesce(binding.registry_id, target_registry_id), target_uid
      )
  ) or exists (
    select 1 from public.stream_media_source_bindings binding
    where binding.raw_provider_uid=target_uid and binding.source_kind='program_lesson'
      and binding.binding_state='quarantined'
      and (binding.registry_id is null or binding.registry_id=target_registry_id)
  ) or exists (
    select 1 from public.videos video
    where video.cloudflare_uid = target_uid
      and (video.stream_provider_account_registry_id is null
        or video.stream_provider_account_registry_id = target_registry_id)
      and not private.stream_manifest_edge_authorized(
        target_excluded_operation_id, 'video', video.id::text, target_registry_id, target_uid
      )
  ) or exists (
    select 1 from public.post_media media
    join public.posts post on post.id = media.post_id
    where media.kind = 'video' and media.video_uid = target_uid and post.removed_at is null
      and private.stream_source_may_match_account('post_media', media.id::text, target_uid, target_registry_id)
      and not private.stream_manifest_edge_authorized(
        target_excluded_operation_id, 'post_media', media.id::text, target_registry_id, target_uid
      )
  ) or exists (
    select 1 from public.program_days day
    join public.videos video on video.id = day.video_id
    where video.cloudflare_uid = target_uid
      and private.stream_source_may_match_account('program_day', day.id::text, target_uid, target_registry_id)
      and not private.stream_manifest_edge_authorized(
        target_excluded_operation_id, 'program_day', day.id::text, target_registry_id, target_uid
      )
  ) or exists (
    select 1 from public.programs program
    join public.videos video on video.id = program.intro_video_id
    where video.cloudflare_uid = target_uid
      and private.stream_source_may_match_account('program_intro', program.id::text, target_uid, target_registry_id)
      and not private.stream_manifest_edge_authorized(
        target_excluded_operation_id, 'program_intro', program.id::text, target_registry_id, target_uid
      )
  ) or exists (
    select 1 from public.program_content_version_lessons lesson
    join public.program_content_versions version
      on version.program_id = lesson.program_id and version.id = lesson.content_version_id
    join public.programs program on program.id = lesson.program_id
    join public.program_commerce_state commerce on commerce.program_id = program.id
    join public.program_offer_versions offer
      on offer.program_id = commerce.program_id and offer.id = commerce.current_offer_version_id
    where lesson.cloudflare_uid = target_uid and program.published
      and commerce.current_content_version_id = version.id
      and commerce.current_offer_version_id=offer.id
      and private.stream_source_may_match_account('program_lesson', lesson.id::text, target_uid, target_registry_id)
      and not private.stream_manifest_edge_authorized(
        target_excluded_operation_id, 'program_lesson', lesson.id::text, target_registry_id, target_uid
      )
  ) or exists (
    select 1 from public.program_enrollments enrollment
    join public.program_content_version_lessons lesson
      on lesson.program_id = enrollment.program_id and lesson.content_version_id = enrollment.content_version_id
    join public.program_content_versions version
      on version.program_id = lesson.program_id and version.id = lesson.content_version_id
    where lesson.cloudflare_uid = target_uid and version.revision_kind = 'free_snapshot'
      and private.stream_source_may_match_account('program_lesson', lesson.id::text, target_uid, target_registry_id)
      and not private.stream_manifest_edge_authorized(
        target_excluded_operation_id, 'program_lesson', lesson.id::text, target_registry_id, target_uid
      )
  ) or exists (
    select 1 from public.program_orders orders
    left join public.program_order_state order_state on order_state.order_id = orders.id
    join public.program_content_version_lessons lesson
      on lesson.program_id = orders.program_id and lesson.content_version_id = orders.content_version_id
    where lesson.cloudflare_uid = target_uid
      and (
        order_state.billing_state in ('awaiting_checkout', 'checkout_pending', 'active', 'paid', 'cancel_requested', 'free_grant')
        or order_state.order_id is null
        or exists (
          select 1 from public.program_payment_events payment
          where payment.order_id = orders.id and payment.provider_status = 'succeeded'
            and payment.amount_cents > 0
        )
      )
      and private.stream_source_may_match_account('program_lesson', lesson.id::text, target_uid, target_registry_id)
      and not private.stream_manifest_edge_authorized(
        target_excluded_operation_id, 'program_lesson', lesson.id::text, target_registry_id, target_uid
      )
  ) or exists (
    select 1 from public.tasks task
    join public.videos video on video.id = task.video_id
    where video.cloudflare_uid = target_uid
      and private.stream_source_may_match_account('task', task.id::text, target_uid, target_registry_id)
      and not private.stream_manifest_edge_authorized(
        target_excluded_operation_id, 'task', task.id::text, target_registry_id, target_uid
      )
  ) or exists (
    select 1 from public.member_daily_fuel_assignments assignment
    join public.videos video on video.id = assignment.video_id
    where video.cloudflare_uid = target_uid and assignment.day >= (select private.current_daily_checkin_day())
      and private.stream_source_may_match_account('daily_fuel_assignment', assignment.id::text, target_uid, target_registry_id)
      and not private.stream_manifest_edge_authorized(
        target_excluded_operation_id, 'daily_fuel_assignment', assignment.id::text, target_registry_id, target_uid
      )
  ) or exists (
    select 1 from public.member_daily_fuel_bookmarks bookmark
    join public.videos video on video.id = bookmark.video_id
    where video.cloudflare_uid = target_uid
      and private.stream_source_may_match_account(
        'daily_fuel_bookmark', bookmark.member_id::text || ':' || bookmark.video_id::text, target_uid, target_registry_id
      )
      and not private.stream_manifest_edge_authorized(
        target_excluded_operation_id, 'daily_fuel_bookmark',
        bookmark.member_id::text || ':' || bookmark.video_id::text, target_registry_id, target_uid
      )
  ) or exists (
    select 1 from public.daily_content_revisions revision
    join public.daily_content_items item on item.id = revision.item_id
    where revision.video_id in (select video.id from public.videos video where video.cloudflare_uid = target_uid)
      and item.status <> 'archived'
      and private.stream_source_may_match_account('daily_content_revision', revision.id::text, target_uid, target_registry_id)
      and not private.stream_manifest_edge_authorized(
        target_excluded_operation_id, 'daily_content_revision', revision.id::text, target_registry_id, target_uid
      )
  ) or exists (
    select 1 from public.daily_content_slots slot
    join public.daily_content_revisions revision on revision.id = slot.revision_id
    where revision.video_id in (select video.id from public.videos video where video.cloudflare_uid = target_uid)
      and slot.status in ('scheduled', 'published')
      and slot.day >= (select private.current_daily_checkin_day())
      and private.stream_source_may_match_account('daily_content_slot', slot.id::text, target_uid, target_registry_id)
      and not private.stream_manifest_edge_authorized(
        target_excluded_operation_id, 'daily_content_slot', slot.id::text, target_registry_id, target_uid
      )
  ) or exists (
    select 1 from public.member_daily_content_video_grants grant_row
    where grant_row.video_id in (select video.id from public.videos video where video.cloudflare_uid = target_uid)
      and private.stream_source_may_match_account(
        'daily_content_grant', grant_row.member_id::text || ':' || grant_row.day::text || ':' || grant_row.video_id::text,
        target_uid, target_registry_id
      )
  );
$$;
revoke all on function private.stream_media_has_effective_reference(uuid, text, uuid)
  from public, anon, authenticated, service_role;

-- A new live reference or retention obligation must not race a durable delete reservation,
-- ambiguous provider delete, terminal absence, or quarantined asset. Live writers take account
-- and source locks first, then the nonblocking UID lock, and evaluate this predicate fresh.
create function private.stream_uid_blocks_new_media_reference(target_registry_id uuid,target_uid text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.stream_media_operation_uid_state uid_state
    where (target_registry_id is null or uid_state.registry_id=target_registry_id)
      and uid_state.raw_provider_uid=target_uid
      and uid_state.uid_state in (
        'reserved','delete_started','delete_unknown','deleted_confirmed','already_absent_confirmed'
      )
  ) or exists (
    select 1 from public.stream_media_operation_uid_state uid_state
    join public.stream_media_operation_states operation_state
      on operation_state.operation_id=uid_state.operation_id
    where (target_registry_id is null or uid_state.registry_id=target_registry_id)
      and uid_state.raw_provider_uid=target_uid
      and operation_state.operation_state in ('cleanup_reserved','delete_started','delete_unknown','source_finalizing')
  ) or exists (
    select 1 from public.stream_media_assets asset
    where (target_registry_id is null or asset.registry_id=target_registry_id)
      and asset.raw_provider_uid=target_uid
      and asset.lifecycle_state in ('cleanup_pending','delete_unknown','deleted_confirmed','quarantined')
  );
$$;
revoke all on function private.stream_uid_blocks_new_media_reference(uuid,text)
  from public,anon,authenticated,service_role;

create function private.stream_set_retention_obligation(
  target_registry_id uuid,
  target_uid text,
  target_source_kind text,
  target_source_identity text,
  target_source_revision bigint,
  target_obligation_kind text,
  target_active boolean,
  target_actor_id uuid,
  target_reason_code text,
  target_request_id uuid,
  target_evidence_digest text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  obligation_row public.stream_media_retention_obligations%rowtype;
  event_row public.stream_media_retention_events%rowtype;
  obligation_id uuid;
  new_event_id uuid;
  next_state text := case when target_active then 'active' else 'released' end;
  next_event_kind text := case when target_active then 'retained' else 'released' end;
begin
  if target_uid is null or target_source_kind is null or target_source_identity is null
    or target_source_revision is null or target_source_revision < 1
    or target_obligation_kind not in (
      'marketed_offer', 'paid_order', 'checkout_intent', 'zero_total_order',
      'pinned_free_enrollment', 'ordinary_source'
    )
    or target_reason_code is null or char_length(target_reason_code) not between 1 and 80
    or target_active is null or target_request_id is null
    or target_evidence_digest is null or target_evidence_digest !~ '^[0-9a-f]{64}$'
  then raise exception 'Media retention evidence is invalid' using errcode = '22023'; end if;
  perform private.stream_require_read_committed();
  if not private.stream_try_uid_lock(target_registry_id, target_uid) then
    raise exception 'Media UID is busy; retry the complete source mutation' using errcode = '40001';
  end if;
  if target_active and private.stream_uid_blocks_new_media_reference(target_registry_id,target_uid) then
    raise exception 'Media UID is reserved, unresolved, or no longer available' using errcode = '55000';
  end if;
  select * into obligation_row
  from public.stream_media_retention_obligations obligation
  where obligation.registry_id is not distinct from target_registry_id
    and obligation.raw_provider_uid = target_uid
    and obligation.source_kind = target_source_kind
    and obligation.source_identity = target_source_identity
    and obligation.source_revision = target_source_revision
    and obligation.obligation_kind = target_obligation_kind
  for update;
  if not found then
    insert into public.stream_media_retention_obligations (
      registry_id, raw_provider_uid, source_kind, source_identity, source_revision,
      obligation_kind, obligation_state
    ) values (
      target_registry_id, target_uid, target_source_kind, target_source_identity,
      target_source_revision, target_obligation_kind, next_state
    ) returning * into obligation_row;
  elsif obligation_row.obligation_state = next_state then
    select * into event_row from public.stream_media_retention_events event
    where event.obligation_id = obligation_row.id and event.request_id = target_request_id;
    if found and (event_row.event_kind <> next_event_kind
      or event_row.evidence_digest <> target_evidence_digest
      or event_row.reason_code <> target_reason_code)
    then raise exception 'Retention request identity conflicts' using errcode = '23505'; end if;
    return obligation_row.id;
  else
    update public.stream_media_retention_obligations
    set obligation_state = next_state,
        release_event_id = null,
        updated_at = now()
    where id = obligation_row.id
    returning * into obligation_row;
  end if;
  insert into public.stream_media_retention_events (
    obligation_id, event_kind, actor_id, reason_code, request_id, evidence_digest
  ) values (
    obligation_row.id, next_event_kind, target_actor_id, target_reason_code,
    target_request_id, target_evidence_digest
  ) returning id into new_event_id;
  if not target_active then
    update public.stream_media_retention_obligations
    set release_event_id = new_event_id, updated_at = now()
    where id = obligation_row.id;
  end if;
  return obligation_row.id;
end;
$$;
revoke all on function private.stream_set_retention_obligation(uuid, text, text, text, bigint, text, boolean, uuid, text, uuid, text)
  from public, anon, authenticated, service_role;

create function private.try_lock_program_media_versions(target_program_id uuid,target_version_ids uuid[])
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  registry_ids uuid[];
  raw_uids text[];
begin
  if target_program_id is null then raise exception 'Program identity is required' using errcode='22023'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended(target_program_id::text,7142026))
    or not private.stream_try_parent_lock('program',target_program_id::text) then
    raise exception 'Program media is busy; retry the whole write' using errcode='55P03';
  end if;
  select array_agg(item.registry_id order by coalesce(item.registry_id::text,''),item.raw_uid),
         array_agg(item.raw_uid order by coalesce(item.registry_id::text,''),item.raw_uid)
    into registry_ids,raw_uids
  from (
    select distinct coalesce(binding.registry_id,video.stream_provider_account_registry_id) as registry_id,
      lesson.cloudflare_uid as raw_uid
    from public.program_content_version_lessons lesson
    left join public.videos video on video.id=lesson.video_id
    left join public.stream_media_source_bindings binding
      on binding.source_kind='program_lesson' and binding.source_identity=lesson.id::text
        and binding.raw_provider_uid=lesson.cloudflare_uid
        and binding.binding_state in ('legacy_unverified','provisional_bound','ready_for_publication','active','retained','quarantined')
    where lesson.program_id=target_program_id and lesson.cloudflare_uid is not null
      and (target_version_ids is null or lesson.content_version_id=any(target_version_ids))
  ) item;
  if coalesce(cardinality(raw_uids),0)>0 then perform private.stream_try_uid_locks(registry_ids,raw_uids); end if;
end;
$$;
revoke all on function private.try_lock_program_media_versions(uuid,uuid[])
  from public,anon,authenticated,service_role;

create function private.sync_program_market_retention(target_program_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  item record;
  active_offer boolean;
  revision_number bigint;
  proof_digest text;
begin
  if target_program_id is null then return; end if;
  perform private.try_lock_program_media_versions(target_program_id,null);
  for item in
    select distinct offer.id as offer_id,lesson.id as lesson_id,lesson.cloudflare_uid as raw_uid,
      coalesce(binding.registry_id,video.stream_provider_account_registry_id) as registry_id,
      version.revision_number::bigint as source_revision,program.coach_id as actor_id
    from public.program_offer_versions offer
    join public.program_content_versions version
      on version.program_id=offer.program_id and version.id=offer.content_version_id
    join public.program_content_version_lessons lesson
      on lesson.program_id=version.program_id and lesson.content_version_id=version.id
    join public.programs program on program.id=offer.program_id
    left join public.program_commerce_state commerce on commerce.program_id=program.id
    left join public.videos video on video.id=lesson.video_id
    left join public.stream_media_source_bindings binding
      on binding.source_kind='program_lesson' and binding.source_identity=lesson.id::text
        and binding.raw_provider_uid=lesson.cloudflare_uid
        and binding.binding_state in ('legacy_unverified','provisional_bound','ready_for_publication','active','retained','quarantined')
    where offer.program_id=target_program_id and lesson.cloudflare_uid is not null
      and (offer.id=commerce.current_offer_version_id
        or exists (select 1 from public.stream_media_retention_obligations obligation
          where obligation.source_kind='program_offer'
            and obligation.source_identity=offer.id::text||':'||lesson.id::text
            and obligation.raw_provider_uid=lesson.cloudflare_uid
            and obligation.obligation_kind='marketed_offer'
            and obligation.obligation_state='active'))
    order by offer_id,lesson_id
  loop
    select exists(select 1 from public.programs program
      join public.program_commerce_state commerce on commerce.program_id=program.id
      join public.program_offer_versions offer
        on offer.program_id=commerce.program_id and offer.id=commerce.current_offer_version_id
      where program.id=target_program_id and program.published
        and offer.id=item.offer_id and offer.content_version_id=commerce.current_content_version_id)
      into active_offer;
    proof_digest:=private.stream_media_identity_digest(concat_ws('|','marketed_offer',
      target_program_id::text,item.offer_id::text,item.lesson_id::text,item.raw_uid,item.source_revision::text,
      active_offer::text));
    perform private.stream_set_retention_obligation(item.registry_id,item.raw_uid,'program_offer',
      item.offer_id::text||':'||item.lesson_id::text,item.source_revision,'marketed_offer',active_offer,
      item.actor_id,'program_current_offer_transition',gen_random_uuid(),proof_digest);
  end loop;
end;
$$;
revoke all on function private.sync_program_market_retention(uuid)
  from public,anon,authenticated,service_role;

create function private.sync_program_order_retention(target_order_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  order_row public.program_orders%rowtype;
  order_state text;
  is_paid boolean;
  is_checkout boolean;
  is_zero boolean;
  item record;
  proof_digest text;
begin
  select * into order_row from public.program_orders orders where orders.id=target_order_id;
  if not found then return; end if;
  select coalesce(state.billing_state,'awaiting_checkout') into order_state
    from (select 1) singleton left join public.program_order_state state on state.order_id=target_order_id;
  select order_state='paid' or exists(select 1 from public.program_payment_events payment
    where payment.order_id=target_order_id and payment.provider_status='succeeded'
      and payment.amount_cents>0) into is_paid;
  is_zero:=order_row.effective_total_cents=0;
  is_checkout:=not is_paid and not is_zero
    and order_state in ('awaiting_checkout','checkout_pending','active','cancel_requested');
  for item in
    select lesson.id as lesson_id,lesson.cloudflare_uid as raw_uid,
      coalesce(binding.registry_id,video.stream_provider_account_registry_id) as registry_id,
      version.revision_number::bigint as source_revision,program.coach_id as coach_id
    from public.program_content_version_lessons lesson
    join public.program_content_versions version
      on version.program_id=lesson.program_id and version.id=lesson.content_version_id
    join public.programs program on program.id=lesson.program_id
    left join public.videos video on video.id=lesson.video_id
    left join public.stream_media_source_bindings binding
      on binding.source_kind='program_lesson' and binding.source_identity=lesson.id::text
        and binding.raw_provider_uid=lesson.cloudflare_uid
        and binding.binding_state in ('legacy_unverified','provisional_bound','ready_for_publication','active','retained','quarantined')
    where lesson.program_id=order_row.program_id and lesson.content_version_id=order_row.content_version_id
      and lesson.cloudflare_uid is not null
  loop
    if is_paid or exists(select 1 from public.stream_media_retention_obligations obligation
        where obligation.registry_id is not distinct from item.registry_id
          and obligation.raw_provider_uid=item.raw_uid and obligation.source_kind='program_order'
          and obligation.source_identity=target_order_id::text||':'||item.lesson_id::text
          and obligation.source_revision=item.source_revision and obligation.obligation_kind='paid_order') then
      proof_digest:=private.stream_media_identity_digest(concat_ws('|','paid_order',target_order_id::text,
        item.lesson_id::text,item.raw_uid,is_paid::text,order_state));
      perform private.stream_set_retention_obligation(item.registry_id,item.raw_uid,'program_order',
        target_order_id::text||':'||item.lesson_id::text,item.source_revision,'paid_order',is_paid,
        item.coach_id,'program_order_settlement_transition',gen_random_uuid(),proof_digest);
    end if;
    if is_checkout or exists(select 1 from public.stream_media_retention_obligations obligation
        where obligation.registry_id is not distinct from item.registry_id
          and obligation.raw_provider_uid=item.raw_uid and obligation.source_kind='program_order'
          and obligation.source_identity=target_order_id::text||':'||item.lesson_id::text
          and obligation.source_revision=item.source_revision and obligation.obligation_kind='checkout_intent') then
      proof_digest:=private.stream_media_identity_digest(concat_ws('|','checkout_intent',target_order_id::text,
        item.lesson_id::text,item.raw_uid,is_checkout::text,order_state));
      perform private.stream_set_retention_obligation(item.registry_id,item.raw_uid,'program_order',
        target_order_id::text||':'||item.lesson_id::text,item.source_revision,'checkout_intent',is_checkout,
        item.coach_id,'program_order_checkout_transition',gen_random_uuid(),proof_digest);
    end if;
    if is_zero or exists(select 1 from public.stream_media_retention_obligations obligation
        where obligation.registry_id is not distinct from item.registry_id
          and obligation.raw_provider_uid=item.raw_uid and obligation.source_kind='program_order'
          and obligation.source_identity=target_order_id::text||':'||item.lesson_id::text
          and obligation.source_revision=item.source_revision and obligation.obligation_kind='zero_total_order') then
      proof_digest:=private.stream_media_identity_digest(concat_ws('|','zero_total_order',target_order_id::text,
        item.lesson_id::text,item.raw_uid,is_zero::text));
      perform private.stream_set_retention_obligation(item.registry_id,item.raw_uid,'program_order',
        target_order_id::text||':'||item.lesson_id::text,item.source_revision,'zero_total_order',is_zero,
        item.coach_id,'program_zero_total_transition',gen_random_uuid(),proof_digest);
    end if;
  end loop;
end;
$$;
revoke all on function private.sync_program_order_retention(uuid)
  from public,anon,authenticated,service_role;

-- Capture only existing identities. Account remains NULL and every edge stays legacy_unverified;
-- this seed prevents false absence but grants no provider authority.
insert into public.stream_media_parent_fences (source_kind, source_identity, owner_id)
select 'video', video.id::text, video.coach_id from public.videos video
union
select 'post_media', media.id::text, post.author_id
from public.post_media media join public.posts post on post.id = media.post_id
where media.kind = 'video'
union
select 'post', post.id::text, post.author_id from public.posts post
union
select 'program', program.id::text, program.coach_id from public.programs program
union
select 'daily_content_item', item.id::text, item.owner_id from public.daily_content_items item
union
select 'program_day', day.id::text, program.coach_id
from public.program_days day join public.programs program on program.id = day.program_id
where day.video_id is not null
union
select 'program_lesson', lesson.id::text, program.coach_id
from public.program_content_version_lessons lesson join public.programs program on program.id = lesson.program_id
where lesson.cloudflare_uid is not null
union
select 'program_intro', program.id::text, program.coach_id
from public.programs program where program.intro_video_id is not null
union
select 'task', task.id::text, task.coach_id
from public.tasks task
union
select 'daily_fuel_assignment', assignment.id::text, assignment.member_id
from public.member_daily_fuel_assignments assignment
union
select 'daily_fuel_bookmark', bookmark.member_id::text || ':' || bookmark.video_id::text, bookmark.member_id
from public.member_daily_fuel_bookmarks bookmark join public.videos video on video.id = bookmark.video_id
union
select 'daily_content_revision', revision.id::text, item.owner_id
from public.daily_content_revisions revision join public.daily_content_items item on item.id = revision.item_id
where revision.video_id is not null
union
select 'daily_content_slot', slot.id::text, coalesce(slot.coach_id, item.owner_id)
from public.daily_content_slots slot
join public.daily_content_revisions revision on revision.id = slot.revision_id
join public.daily_content_items item on item.id = slot.item_id
where revision.video_id is not null
union
select 'daily_content_grant', grant_row.member_id::text || ':' || grant_row.day::text || ':' || grant_row.video_id::text,
       grant_row.member_id
from public.member_daily_content_video_grants grant_row join public.videos video on video.id = grant_row.video_id
on conflict (source_kind, source_identity) do nothing;

insert into public.stream_media_source_bindings (
  registry_id, raw_provider_uid, asset_id, source_kind, source_identity, parent_kind, parent_identity,
  source_revision, owner_id, binding_state, evidence_digest
)
select null, edge.raw_uid, null, edge.source_kind, edge.source_identity, edge.parent_kind, edge.parent_identity,
       1, edge.owner_id, 'legacy_unverified',
       private.stream_media_identity_digest(concat_ws('|', edge.source_kind, edge.source_identity, edge.raw_uid, 'legacy'))
from (
  select video.cloudflare_uid as raw_uid, 'video'::text as source_kind,
         video.id::text as source_identity, 'profile'::text as parent_kind,
         video.coach_id::text as parent_identity, video.coach_id as owner_id
  from public.videos video
  union all
  select media.video_uid, 'post_media', media.id::text, 'post', media.post_id::text, post.author_id
  from public.post_media media join public.posts post on post.id = media.post_id
  where media.kind = 'video'
  union all
  select video.cloudflare_uid, 'program_day', day.id::text, 'program', day.program_id::text, program.coach_id
  from public.program_days day join public.programs program on program.id = day.program_id
  join public.videos video on video.id = day.video_id
  union all
  select lesson.cloudflare_uid, 'program_lesson', lesson.id::text, 'program', lesson.program_id::text, program.coach_id
  from public.program_content_version_lessons lesson join public.programs program on program.id = lesson.program_id
  where lesson.cloudflare_uid is not null
  union all
  select video.cloudflare_uid, 'program_intro', program.id::text, 'program', program.id::text, program.coach_id
  from public.programs program join public.videos video on video.id = program.intro_video_id
  union all
  select video.cloudflare_uid, 'task', task.id::text, 'task', task.id::text, task.coach_id
  from public.tasks task join public.videos video on video.id = task.video_id
  union all
  select video.cloudflare_uid, 'daily_fuel_assignment', assignment.id::text, 'daily_fuel_assignment', assignment.id::text, assignment.coach_id
  from public.member_daily_fuel_assignments assignment join public.videos video on video.id = assignment.video_id
  union all
  select video.cloudflare_uid, 'daily_fuel_bookmark', bookmark.member_id::text || ':' || bookmark.video_id::text,
         'profile', bookmark.member_id::text, bookmark.member_id
  from public.member_daily_fuel_bookmarks bookmark join public.videos video on video.id = bookmark.video_id
  union all
  select video.cloudflare_uid, 'daily_content_revision', revision.id::text, 'daily_content_item', revision.item_id::text, item.owner_id
  from public.daily_content_revisions revision join public.daily_content_items item on item.id = revision.item_id
  join public.videos video on video.id = revision.video_id
  union all
  select video.cloudflare_uid, 'daily_content_slot', slot.id::text, 'daily_content_item', slot.item_id::text, coalesce(slot.coach_id, item.owner_id)
  from public.daily_content_slots slot join public.daily_content_items item on item.id = slot.item_id
  join public.daily_content_revisions revision on revision.id = slot.revision_id
  join public.videos video on video.id = revision.video_id
  union all
  select video.cloudflare_uid, 'daily_content_grant',
         grant_row.member_id::text || ':' || grant_row.day::text || ':' || grant_row.video_id::text,
         'profile', grant_row.member_id::text, grant_row.member_id
  from public.member_daily_content_video_grants grant_row join public.videos video on video.id = grant_row.video_id
) edge
where edge.raw_uid is not null
on conflict do nothing;

insert into public.stream_media_source_binding_events (
  binding_id, event_kind, source_revision, request_id, evidence_digest
)
select binding.id, 'attached', binding.source_revision, gen_random_uuid(), binding.evidence_digest
from public.stream_media_source_bindings binding
where binding.binding_state = 'legacy_unverified'
  and not exists (
    select 1 from public.stream_media_source_binding_events event where event.binding_id = binding.id
  );

-- Account ownership is many-to-many: a coach may own the provider asset while a member owns
-- an enrollment, assignment, bookmark, or grant edge that will cascade with that member.
insert into public.stream_media_source_account_edges (binding_id,account_id,relation_kind)
select binding.id,binding.owner_id,'source_owner'
from public.stream_media_source_bindings binding where binding.owner_id is not null
on conflict do nothing;
insert into public.stream_media_source_account_edges (binding_id,account_id,relation_kind)
select binding.id,asset.owner_id,'asset_owner'
from public.stream_media_source_bindings binding
join public.stream_media_assets asset on asset.id=binding.asset_id
on conflict do nothing;
insert into public.stream_media_source_account_edges (binding_id,account_id,relation_kind)
select binding.id,assignment.member_id,'assigned_member'
from public.stream_media_source_bindings binding
join public.member_daily_fuel_assignments assignment on assignment.id::text=binding.source_identity
where binding.source_kind='daily_fuel_assignment'
union
select binding.id,task_assignment.member_id,'assigned_member'
from public.stream_media_source_bindings binding
join public.task_assignments task_assignment on task_assignment.task_id::text=binding.source_identity
where binding.source_kind='task'
union
select binding.id,enrollment.member_id,'assigned_member'
from public.stream_media_source_bindings binding
join public.program_content_version_lessons lesson on lesson.id::text=binding.source_identity
join public.program_enrollments enrollment
  on enrollment.program_id=lesson.program_id and enrollment.content_version_id=lesson.content_version_id
where binding.source_kind='program_lesson'
  and exists (select 1 from public.program_content_versions version
    where version.id=lesson.content_version_id and version.revision_kind='free_snapshot')
union
select binding.id,orders.buyer_id,'assigned_member'
from public.stream_media_source_bindings binding
join public.program_content_version_lessons lesson on lesson.id::text=binding.source_identity
join public.program_orders orders
  on orders.program_id=lesson.program_id and orders.content_version_id=lesson.content_version_id
where binding.source_kind='program_lesson'
union
select binding.id,bookmark.member_id,'bookmark_owner'
from public.stream_media_source_bindings binding
join public.member_daily_fuel_bookmarks bookmark
  on (bookmark.member_id::text || ':' || bookmark.video_id::text)=binding.source_identity
where binding.source_kind='daily_fuel_bookmark'
union
select binding.id,grant_row.member_id,'grant_recipient'
from public.stream_media_source_bindings binding
join public.member_daily_content_video_grants grant_row
  on (grant_row.member_id::text || ':' || grant_row.day::text || ':' || grant_row.video_id::text)=binding.source_identity
where binding.source_kind='daily_content_grant'
on conflict do nothing;

-- Backfill only effective durable obligations. Draft/unmarketed sealed versions are not permanent
-- blockers; unsettled nonterminal orders, paid snapshots, current marketed offers, and actual pins are.
select private.stream_set_retention_obligation(
  null, effective.raw_uid, effective.source_kind, effective.source_identity,
  greatest(effective.source_revision, 1), effective.obligation_kind, true, null,
  effective.reason_code, gen_random_uuid(),
  private.stream_media_identity_digest(concat_ws('|', effective.source_kind,
    effective.source_identity, effective.raw_uid, effective.obligation_kind, 'gate3-backfill'))
)
from (
  select lesson.cloudflare_uid as raw_uid, 'program_offer'::text as source_kind,
         offer.id::text || ':' || lesson.id::text as source_identity,
         version.revision_number::bigint as source_revision, 'marketed_offer'::text as obligation_kind,
         'gate3_backfill_marketed_offer'::text as reason_code
  from public.programs program
  join public.program_commerce_state commerce on commerce.program_id = program.id
  join public.program_offer_versions offer
    on offer.program_id = commerce.program_id and offer.id = commerce.current_offer_version_id
  join public.program_content_versions version
    on version.program_id = offer.program_id and version.id = offer.content_version_id
  join public.program_content_version_lessons lesson
    on lesson.program_id = version.program_id and lesson.content_version_id = version.id
  where program.published
    and lesson.cloudflare_uid is not null
  union all
  select lesson.cloudflare_uid, 'program_order',
         orders.id::text || ':' || lesson.id::text, version.revision_number::bigint,
         case
           when orders.effective_total_cents = 0 then 'zero_total_order'
           when exists (select 1 from public.program_payment_events payment
             where payment.order_id = orders.id and payment.provider_status = 'succeeded'
               and payment.amount_cents > 0) then 'paid_order'
           else 'checkout_intent'
         end,
         'gate3_backfill_order'
  from public.program_orders orders
  left join public.program_order_state order_state on order_state.order_id = orders.id
  join public.program_content_versions version
    on version.program_id = orders.program_id and version.id = orders.content_version_id
  join public.program_content_version_lessons lesson
    on lesson.program_id = orders.program_id and lesson.content_version_id = orders.content_version_id
  where lesson.cloudflare_uid is not null
    and (orders.effective_total_cents = 0
      or exists (select 1 from public.program_payment_events payment
        where payment.order_id = orders.id and payment.provider_status = 'succeeded'
          and payment.amount_cents > 0)
      or order_state.order_id is null
      or order_state.billing_state in ('awaiting_checkout', 'checkout_pending', 'active', 'paid', 'cancel_requested', 'free_grant'))
  union all
  select lesson.cloudflare_uid, 'program_enrollment',
         enrollment.id::text || ':' || lesson.id::text, version.revision_number::bigint,
         'pinned_free_enrollment', 'gate3_backfill_pinned_free_enrollment'
  from public.program_enrollments enrollment
  join public.program_content_versions version
    on version.program_id = enrollment.program_id and version.id = enrollment.content_version_id
  join public.program_content_version_lessons lesson
    on lesson.program_id = version.program_id and lesson.content_version_id = version.id
  where enrollment.content_version_id is not null
    and version.revision_kind = 'free_snapshot'
    and lesson.cloudflare_uid is not null
) effective;




create function private.stream_advance_operation(
  target_operation_id uuid,
  target_next_state text,
  target_request_id uuid,
  target_evidence_digest text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  state_row public.stream_media_operation_states%rowtype;
  next_revision bigint;
begin
  if target_operation_id is null or target_request_id is null
    or target_evidence_digest is null or target_evidence_digest !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Media operation transition is invalid' using errcode = '22023';
  end if;
  select * into state_row from public.stream_media_operation_states state
  where state.operation_id = target_operation_id for update;
  if not found then raise exception 'Media operation is unavailable' using errcode = 'P0002'; end if;
  if exists (
    select 1 from public.stream_media_operation_events event
    where event.operation_id = target_operation_id and event.request_id = target_request_id
  ) then
    if exists (
      select 1 from public.stream_media_operation_events event
      where event.operation_id = target_operation_id and event.request_id = target_request_id
        and event.to_state = target_next_state and event.evidence_digest = target_evidence_digest
    ) then return state_row.state_revision; end if;
    raise exception 'Media operation request identity conflicts' using errcode = '23505';
  end if;
  if not (
    (state_row.operation_state = 'reserved' and target_next_state in ('create_started', 'cleanup_reserved', 'source_finalizing', 'failed'))
    or (state_row.operation_state = 'create_started' and target_next_state in ('create_unknown', 'created_unverified'))
    or (state_row.operation_state = 'create_unknown' and target_next_state in ('created_unverified', 'provisional_bound'))
    or (state_row.operation_state = 'created_unverified' and target_next_state = 'provisional_bound')
    or (state_row.operation_state = 'provisional_bound' and target_next_state = 'ready_for_publication')
    or (state_row.operation_state = 'ready_for_publication' and target_next_state = 'completed')
    or (state_row.operation_state = 'cleanup_reserved' and target_next_state in ('delete_started', 'retained', 'source_finalizing'))
    or (state_row.operation_state = 'delete_started' and target_next_state in ('delete_unknown', 'source_finalizing'))
    or (state_row.operation_state = 'delete_unknown' and target_next_state in ('delete_started', 'source_finalizing'))
    or (state_row.operation_state = 'source_finalizing' and target_next_state in ('completed', 'retained'))
  ) then
    raise exception 'Media operation transition is not allowed' using errcode = '23514';
  end if;
  next_revision := state_row.state_revision + 1;
  insert into public.stream_media_operation_events (
    operation_id, sequence_number, from_state, to_state, request_id, evidence_digest
  ) values (
    target_operation_id, next_revision, state_row.operation_state, target_next_state,
    target_request_id, target_evidence_digest
  );
  update public.stream_media_operation_states
  set operation_state = target_next_state, state_revision = next_revision, updated_at = now()
  where operation_id = target_operation_id;
  return next_revision;
end;
$$;
revoke all on function private.stream_advance_operation(uuid, text, uuid, text)
  from public, anon, authenticated, service_role;

create function public.record_stream_account_path_verification(
  target_request_id uuid,
  target_registry_id uuid,
  target_credential_slot text,
  target_provider_account_id text,
  target_http_status smallint,
  target_evidence_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  registry_row public.stream_provider_account_registry%rowtype;
  prior_event public.stream_provider_account_verification_events%rowtype;
  event_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Stream account verification is service managed' using errcode = '42501';
  end if;
  if target_request_id is null or target_registry_id is null or target_credential_slot is null
    or target_credential_slot not in ('vod_primary', 'vod_secondary')
    or target_provider_account_id is null or target_provider_account_id !~ '^[0-9a-f]{32}$'
    or target_http_status is null or target_http_status not between 200 and 299
    or target_evidence_digest is null or target_evidence_digest !~ '^[0-9a-f]{64}$'
  then raise exception 'Stream account verification evidence is invalid' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_registry_id::text, 19031001));
  select * into registry_row from public.stream_provider_account_registry registry
  where registry.id = target_registry_id for update;
  if not found or registry_row.credential_slot <> target_credential_slot
    or registry_row.provider_account_id <> target_provider_account_id
  then return jsonb_build_object('outcome', 'account_binding_mismatch'); end if;

  select * into prior_event from public.stream_provider_account_verification_events event
  where event.request_id = target_request_id;
  if found then
    if prior_event.registry_id <> target_registry_id
      or prior_event.credential_slot <> target_credential_slot
      or prior_event.provider_account_id <> target_provider_account_id
      or prior_event.http_status <> target_http_status
      or prior_event.evidence_digest <> target_evidence_digest
    then return jsonb_build_object('outcome', 'identity_mismatch'); end if;
    return jsonb_build_object('outcome', 'already_recorded', 'event_id', prior_event.id);
  else
    insert into public.stream_provider_account_verification_events (
      request_id, registry_id, credential_slot, provider_account_id,
      verification_kind, http_status, evidence_digest
    ) values (
      target_request_id, target_registry_id, target_credential_slot, target_provider_account_id,
      'explicit_account_stream_path_access', target_http_status, target_evidence_digest
    ) returning id into event_id;
  end if;
  insert into public.stream_provider_account_verification_state (
    registry_id, verification_event_id, verified_until, revision
  ) values (target_registry_id, event_id, now() + interval '5 minutes', 1)
  on conflict (registry_id) do update set
    verification_event_id = excluded.verification_event_id,
    verified_until = excluded.verified_until,
    revision = public.stream_provider_account_verification_state.revision + 1,
    updated_at = now();
  return jsonb_build_object('outcome', 'verified', 'registry_id', target_registry_id, 'event_id', event_id);
end;
$$;
revoke all on function public.record_stream_account_path_verification(uuid, uuid, text, text, smallint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_stream_account_path_verification(uuid, uuid, text, text, smallint, text)
  to service_role;

create function public.record_stream_upload_context(
  target_request_id uuid,
  target_intent_id uuid,
  target_parent_kind text,
  target_parent_identity text,
  target_owner_id uuid,
  target_source_revision bigint,
  target_context_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent_row public.stream_media_upload_intents%rowtype;
  context_row public.stream_media_upload_contexts%rowtype;
  parent_fence public.stream_media_parent_fences%rowtype;
  parent_owner uuid;
  intent_actor_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Stream upload context is service managed' using errcode = '42501';
  end if;
  if target_request_id is null or target_intent_id is null or target_parent_kind is null
    or target_parent_identity is null or target_owner_id is null
    or target_source_revision is null or target_source_revision < 1
    or target_context_digest is null or target_context_digest !~ '^[0-9a-f]{64}$'
  then raise exception 'Stream upload context is invalid' using errcode = '22023'; end if;
  select intent.actor_id into intent_actor_id from public.stream_media_upload_intents intent
  where intent.id = target_intent_id;
  if not found then return jsonb_build_object('outcome', 'intent_missing'); end if;
  perform private.stream_lock_accounts(array[intent_actor_id,target_owner_id]);
  select * into intent_row from public.stream_media_upload_intents intent
  where intent.id = target_intent_id for update;
  if not found then return jsonb_build_object('outcome', 'intent_missing'); end if;
  if intent_row.actor_id is distinct from intent_actor_id then
    return jsonb_build_object('outcome','identity_mismatch'); end if;
  if intent_row.source_kind in ('program_lesson','program_intro','daily_content_revision') then
    return jsonb_build_object('outcome','unsupported_direct_upload');
  end if;
  if not (
    (intent_row.source_kind = 'video' and target_parent_kind = 'profile'
      and target_parent_identity = intent_row.actor_id::text and target_owner_id = intent_row.actor_id)
    or (intent_row.source_kind = 'post_media' and target_parent_kind = 'post')
    or (intent_row.source_kind in ('program_lesson', 'program_intro') and target_parent_kind = 'program')
    or (intent_row.source_kind = 'daily_content_revision' and target_parent_kind = 'daily_content_item')
  ) then return jsonb_build_object('outcome', 'identity_mismatch'); end if;

  select * into context_row from public.stream_media_upload_contexts context
  where context.intent_id = target_intent_id;
  if found then
    if context_row.request_id <> target_request_id
      or context_row.parent_kind <> target_parent_kind
      or context_row.parent_identity <> target_parent_identity
      or context_row.owner_id <> target_owner_id
      or context_row.source_revision <> target_source_revision
      or context_row.context_digest <> target_context_digest
    then return jsonb_build_object('outcome', 'identity_mismatch'); end if;
    return jsonb_build_object('outcome', 'same_context', 'intent_id', target_intent_id,
      'source_revision', context_row.source_revision);
  end if;

  if private.stream_account_is_tombstoned(intent_row.actor_id)
    or private.stream_account_is_tombstoned(target_owner_id)
  then return jsonb_build_object('outcome', 'account_deleting'); end if;
  if intent_row.source_kind='post_media' then
    if not exists (
      select 1 from public.profiles profile
      where profile.id=intent_row.actor_id and profile.role::text in ('member','coach','admin')
    ) then return jsonb_build_object('outcome','actor_not_authorized'); end if;
    if exists (select 1 from public.profiles profile
        where profile.id=intent_row.actor_id and profile.role::text='member')
      and not (
        exists (select 1 from public.platform_memberships membership
          where membership.member_id=intent_row.actor_id and membership.status='active'
            and membership.current_period_end>now())
        or exists (select 1 from public.platform_test_entitlements entitlement
          where entitlement.member_id=intent_row.actor_id and entitlement.revoked_at is null)
      )
    then return jsonb_build_object('outcome','actor_not_authorized'); end if;
  elsif not exists (
    select 1 from public.profiles profile
    where profile.id = intent_row.actor_id and profile.role::text in ('coach', 'admin')
  ) then return jsonb_build_object('outcome', 'actor_not_authorized'); end if;
  if exists (select 1 from public.profiles profile where profile.id = intent_row.actor_id) then
    perform 1 from public.profiles profile where profile.id = intent_row.actor_id for key share nowait;
  else
    return jsonb_build_object('outcome', 'owner_missing');
  end if;

  if target_parent_kind = 'post' then
    select post.author_id into parent_owner from public.posts post
    where post.id = target_parent_identity::uuid and post.removed_at is null for update;
  elsif target_parent_kind = 'program' then
    perform private.lock_program_mutation(target_parent_identity::uuid);
    select program.coach_id into parent_owner from public.programs program
    where program.id = target_parent_identity::uuid for update;
  elsif target_parent_kind = 'daily_content_item' then
    select item.owner_id into parent_owner from public.daily_content_items item
    where item.id = target_parent_identity::uuid and item.status <> 'archived' for update;
  else
    select profile.id into parent_owner from public.profiles profile
    where profile.id = target_parent_identity::uuid for key share nowait;
  end if;
  if parent_owner is null or parent_owner <> target_owner_id then
    return jsonb_build_object('outcome', 'parent_owner_mismatch');
  end if;
  if intent_row.source_kind = 'post_media' and intent_row.actor_id <> target_owner_id then
    return jsonb_build_object('outcome', 'actor_not_authorized');
  end if;
  if target_parent_kind in ('program', 'daily_content_item')
    and intent_row.actor_id <> target_owner_id
    and not exists (
      select 1 from public.profiles actor_profile
      where actor_profile.id = intent_row.actor_id and actor_profile.role::text = 'admin'
    )
  then return jsonb_build_object('outcome', 'actor_not_authorized'); end if;
  if (intent_row.source_kind = 'video' and exists (
        select 1 from public.videos video where video.id = intent_row.source_id
      ))
    or (intent_row.source_kind = 'post_media' and exists (
        select 1 from public.post_media media where media.id = intent_row.source_id
      ))
    or (intent_row.source_kind = 'program_lesson' and exists (
        select 1 from public.program_content_version_lessons lesson where lesson.id = intent_row.source_id
      ))
    or (intent_row.source_kind = 'daily_content_revision' and exists (
        select 1 from public.daily_content_revisions revision where revision.id = intent_row.source_id
      ))
    or (intent_row.source_kind = 'program_intro' and exists (
        select 1 from public.programs program
        where program.id = target_parent_identity::uuid and program.intro_video_id is not null
      ))
  then return jsonb_build_object('outcome', 'source_identity_in_use'); end if;
  if target_parent_kind in ('post', 'program', 'daily_content_item') then
    perform 1 from public.stream_media_parent_fences fence
    where fence.source_kind = target_parent_kind
      and fence.source_identity = target_parent_identity
    for update;
    if not found then
      insert into public.stream_media_parent_fences (
        source_kind, source_identity, owner_id, source_revision
      ) values (target_parent_kind, target_parent_identity, target_owner_id, 1);
      select * into parent_fence from public.stream_media_parent_fences fence
      where fence.source_kind = target_parent_kind and fence.source_identity = target_parent_identity;
    else
      select * into parent_fence from public.stream_media_parent_fences fence
      where fence.source_kind = target_parent_kind and fence.source_identity = target_parent_identity;
    end if;
  else
    insert into public.stream_media_parent_fences (source_kind, source_identity, owner_id, source_revision)
    values (target_parent_kind, target_parent_identity, target_owner_id, 1)
    on conflict (source_kind, source_identity) do nothing;
    select * into parent_fence from public.stream_media_parent_fences fence
    where fence.source_kind = target_parent_kind and fence.source_identity = target_parent_identity
    for update;
  end if;
  if parent_fence.owner_id is distinct from target_owner_id
    or parent_fence.source_revision <> target_source_revision
    or parent_fence.fence_state <> 'open'
  then return jsonb_build_object('outcome', 'source_busy_or_stale'); end if;
  if intent_row.parent_revision not in (0, parent_fence.source_revision) then
    return jsonb_build_object('outcome', 'revision_stale');
  end if;
  insert into public.stream_media_upload_contexts (
    intent_id, parent_kind, parent_identity, owner_id, source_revision, context_digest, request_id
  ) values (
    target_intent_id, target_parent_kind, target_parent_identity, target_owner_id,
    target_source_revision, target_context_digest, target_request_id
  );
  insert into public.stream_media_upload_account_edges(intent_id,account_id,relation_kind,request_id)
    values (target_intent_id,intent_row.actor_id,'actor',target_request_id),
      (target_intent_id,target_owner_id,'source_owner',target_request_id);
  return jsonb_build_object('outcome', 'context_recorded', 'intent_id', target_intent_id,
    'source_revision', target_source_revision);
exception
  when lock_not_available then
    return jsonb_build_object('outcome', 'source_busy');
  when invalid_text_representation then
    return jsonb_build_object('outcome', 'identity_mismatch');
end;
$$;
revoke all on function public.record_stream_upload_context(uuid, uuid, text, text, uuid, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_stream_upload_context(uuid, uuid, text, text, uuid, bigint, text)
  to service_role;

create function public.reserve_stream_media_upload(
  target_operation_id uuid,
  target_request_id uuid,
  target_intent_id uuid,
  target_operation_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent_row public.stream_media_upload_intents%rowtype;
  context_row public.stream_media_upload_contexts%rowtype;
  fence public.stream_media_parent_fences%rowtype;
  existing_operation public.stream_media_operations%rowtype;
  operation_state text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Stream upload reservation is service managed' using errcode = '42501';
  end if;
  if target_operation_id is null or target_request_id is null or target_intent_id is null
    or target_operation_digest is null or target_operation_digest !~ '^[0-9a-f]{64}$'
  then raise exception 'Stream upload reservation is invalid' using errcode = '22023'; end if;
  select * into intent_row from public.stream_media_upload_intents intent where intent.id = target_intent_id;
  select * into context_row from public.stream_media_upload_contexts context where context.intent_id = target_intent_id;
  if intent_row.id is null or context_row.intent_id is null then
    return jsonb_build_object('outcome', 'context_missing'); end if;
  if intent_row.source_kind in ('program_lesson','program_intro','daily_content_revision') then
    return jsonb_build_object('outcome','unsupported_direct_upload');
  end if;
  if intent_row.source_guard_state <> 'pending_source_guard' then
    return jsonb_build_object('outcome', 'context_missing'); end if;
  perform private.stream_lock_accounts(array[intent_row.actor_id,context_row.owner_id]);
  if not private.stream_account_is_verified(intent_row.provider_account_registry_id) then
    return jsonb_build_object('outcome', 'account_unverified');
  end if;
  if private.stream_account_is_tombstoned(intent_row.actor_id)
    or private.stream_account_is_tombstoned(context_row.owner_id)
  then return jsonb_build_object('outcome', 'account_deleting'); end if;

  -- Parent mutex precedes operation-row locking everywhere in this lifecycle.
  perform pg_advisory_xact_lock(hashtextextended(
    context_row.parent_kind || ':' || context_row.parent_identity, 19031002
  ));

  select * into existing_operation from public.stream_media_operations operation
  where operation.id = target_operation_id or operation.request_id = target_request_id
  for update;
  if found then
    if existing_operation.id <> target_operation_id
      or existing_operation.request_id <> target_request_id
      or existing_operation.operation_kind <> 'upload'
      or existing_operation.actor_id <> intent_row.actor_id
      or existing_operation.owner_id <> context_row.owner_id
      or existing_operation.source_kind <> intent_row.source_kind
      or existing_operation.source_identity <> intent_row.source_id::text
      or existing_operation.parent_kind <> context_row.parent_kind
      or existing_operation.parent_identity <> context_row.parent_identity
      or existing_operation.registry_id <> intent_row.provider_account_registry_id
      or existing_operation.intent_id <> target_intent_id
      or existing_operation.expected_source_revision <> context_row.source_revision
      or existing_operation.operation_digest <> target_operation_digest
    then return jsonb_build_object('outcome', 'identity_mismatch'); end if;
    select state.operation_state into operation_state from public.stream_media_operation_states state
    where state.operation_id = existing_operation.id;
    return jsonb_build_object('outcome', 'same_operation', 'operation_id', existing_operation.id,
      'operation_state', operation_state);
  end if;

  select * into fence from public.stream_media_parent_fences parent
  where parent.source_kind = context_row.parent_kind and parent.source_identity = context_row.parent_identity
  for update;
  if not found or fence.owner_id <> context_row.owner_id
    or fence.source_revision <> context_row.source_revision or fence.fence_state <> 'open'
  then return jsonb_build_object('outcome', 'revision_stale_or_busy'); end if;
  insert into public.stream_media_operations (
    id, request_id, operation_kind, actor_id, owner_id, source_kind, source_identity,
    parent_kind, parent_identity, expected_source_revision, registry_id, intent_id, operation_digest
  ) values (
    target_operation_id, target_request_id, 'upload', intent_row.actor_id, context_row.owner_id,
    intent_row.source_kind, intent_row.source_id::text, context_row.parent_kind,
    context_row.parent_identity, context_row.source_revision,
    intent_row.provider_account_registry_id, target_intent_id, target_operation_digest
  );
  insert into public.stream_media_operation_states (operation_id, operation_state)
  values (target_operation_id, 'reserved');
  insert into public.stream_media_operation_events (
    operation_id, sequence_number, from_state, to_state, request_id, evidence_digest
  ) values (target_operation_id, 1, null, 'reserved', target_request_id, target_operation_digest);
  update public.stream_media_parent_fences
  set fence_state = 'closing', active_operation_id = target_operation_id,
      state_revision = state_revision + 1, updated_at = now()
  where source_kind = context_row.parent_kind and source_identity = context_row.parent_identity;
  return jsonb_build_object('outcome', 'reserved', 'operation_id', target_operation_id,
    'operation_state', 'reserved');
exception
  when unique_violation then
    return jsonb_build_object('outcome', 'identity_mismatch');
  when lock_not_available then
    return jsonb_build_object('outcome', 'source_busy');
end;
$$;
revoke all on function public.reserve_stream_media_upload(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_stream_media_upload(uuid, uuid, uuid, text)
  to service_role;

-- A local GUC selects an operation; protected rows and exact tuples authorize it.
create function private.stream_selected_operation_id()
returns uuid
language plpgsql stable set search_path = ''
as $$
declare raw_id text := current_setting('app.stream_media_operation_id', true);
begin
  if raw_id is null or raw_id = '' then return null; end if;
  return raw_id::uuid;
exception when invalid_text_representation then return null;
end;
$$;
revoke all on function private.stream_selected_operation_id() from public, anon, authenticated, service_role;

create function private.stream_operation_has_edge(
  target_operation_id uuid, target_source_kind text, target_source_identity text,
  target_registry_id uuid, target_uid text
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select target_operation_id is not null and exists (
    select 1 from public.stream_media_operations operation
    join public.stream_media_operation_states state on state.operation_id = operation.id
    join public.stream_media_manifest_edges edge on edge.operation_id = operation.id
    join public.stream_media_source_bindings binding on binding.id = edge.binding_id
    join public.stream_media_parent_fences fence
      on fence.source_kind = operation.source_kind and fence.source_identity = operation.source_identity
    where operation.id = target_operation_id
      and operation.operation_kind in ('cleanup','account_cleanup')
      and state.operation_state in ('cleanup_reserved','delete_started','delete_unknown','source_finalizing')
      and fence.active_operation_id = operation.id and fence.fence_state = 'closing'
      and fence.source_revision = operation.expected_source_revision
      and edge.source_kind = target_source_kind and edge.source_identity = target_source_identity
      and edge.registry_id = target_registry_id and edge.raw_provider_uid = target_uid
      and edge.source_revision = binding.source_revision
      and binding.registry_id = target_registry_id and binding.raw_provider_uid = target_uid
  );
$$;
revoke all on function private.stream_operation_has_edge(uuid,text,text,uuid,text)
  from public, anon, authenticated, service_role;

create or replace function private.stream_manifest_edge_authorized(
  target_operation_id uuid,target_source_kind text,target_source_identity text,
  target_registry_id uuid,target_uid text
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.stream_media_operations operation
    join public.stream_media_operation_states state on state.operation_id=operation.id
    join public.stream_media_manifest_edges edge on edge.operation_id=operation.id
    join public.stream_media_operation_uid_state uid_state
      on uid_state.operation_id=edge.operation_id and uid_state.registry_id=edge.registry_id
        and uid_state.raw_provider_uid=edge.raw_provider_uid
    join public.stream_media_source_bindings binding on binding.id=edge.binding_id
    join public.stream_media_parent_fences fence
      on fence.source_kind=operation.parent_kind and fence.source_identity=operation.parent_identity
    where operation.id=target_operation_id
      and operation.operation_kind in ('cleanup','account_cleanup')
      and state.operation_state in ('cleanup_reserved','delete_started','delete_unknown','source_finalizing')
      and edge.source_kind=target_source_kind and edge.source_identity=target_source_identity
      and edge.registry_id=target_registry_id and edge.raw_provider_uid=target_uid
      and edge.source_revision=binding.source_revision
      and binding.registry_id=target_registry_id and binding.raw_provider_uid=target_uid
      and fence.active_operation_id=operation.id and fence.fence_state='closing'
      and fence.source_revision=operation.expected_source_revision
      and (
        (operation.operation_kind='account_cleanup' and exists (
          select 1 from public.stream_media_source_account_edges account_edge
          where account_edge.binding_id=binding.id and account_edge.account_id=operation.owner_id
        ))
        or ((operation.source_kind=target_source_kind and operation.source_identity=target_source_identity)
          or (binding.parent_kind=operation.source_kind and binding.parent_identity=operation.source_identity))
      )
      and (operation.operation_kind='account_cleanup' or operation.owner_id is not distinct from binding.owner_id)
  );
$$;
revoke all on function private.stream_manifest_edge_authorized(uuid,text,text,uuid,text)
  from public, anon, authenticated, service_role;

create function private.stream_upload_operation_matches(
  target_operation_id uuid, target_source_kind text, target_source_identity text,
  target_owner_id uuid, target_registry_id uuid, target_uid text
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select target_operation_id is not null and exists (
    select 1 from public.stream_media_operations operation
    join public.stream_media_operation_states state on state.operation_id = operation.id
    join public.stream_media_upload_contexts context on context.intent_id = operation.intent_id
    join public.stream_media_upload_intents intent on intent.id = context.intent_id
    join public.stream_media_assets asset
      on asset.registry_id = operation.registry_id and asset.upload_intent_id = operation.intent_id
    join public.stream_media_source_bindings binding
      on binding.asset_id = asset.id and binding.registry_id = asset.registry_id
        and binding.raw_provider_uid = asset.raw_provider_uid
    join public.stream_media_parent_fences fence
      on fence.source_kind = context.parent_kind and fence.source_identity = context.parent_identity
    where operation.id = target_operation_id and operation.operation_kind = 'upload'
      and state.operation_state in ('provisional_bound','ready_for_publication')
      and operation.owner_id = target_owner_id and operation.registry_id = target_registry_id
      and operation.source_kind = target_source_kind and operation.source_identity = target_source_identity
      and intent.source_kind = target_source_kind and intent.source_id::text = target_source_identity
      and intent.provider_account_registry_id = target_registry_id
      and context.owner_id = target_owner_id
      and fence.owner_id = target_owner_id and fence.source_revision = context.source_revision
      and fence.active_operation_id = operation.id and fence.fence_state = 'closing'
      and binding.owner_id = target_owner_id and binding.source_kind = target_source_kind
      and binding.source_identity = target_source_identity and binding.raw_provider_uid = target_uid
      and binding.binding_state in ('provisional_bound','ready_for_publication')
      and asset.raw_provider_uid = target_uid
      and asset.lifecycle_state in ('provisional_bound','ready_for_publication')
  );
$$;
revoke all on function private.stream_upload_operation_matches(uuid,text,text,uuid,uuid,text)
  from public, anon, authenticated, service_role;

create function private.stream_source_binding_ready(
  target_source_kind text, target_source_identity text,
  target_owner_id uuid, target_registry_id uuid, target_uid text
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.stream_media_source_bindings binding
    join public.stream_media_assets asset on asset.id = binding.asset_id
      and asset.registry_id = binding.registry_id and asset.raw_provider_uid = binding.raw_provider_uid
    where binding.source_kind = target_source_kind
      and binding.source_identity = target_source_identity
      and binding.owner_id = target_owner_id and binding.registry_id = target_registry_id
      and binding.raw_provider_uid = target_uid
      and binding.binding_state = 'ready_for_publication'
      and asset.lifecycle_state = 'ready_for_publication'
      and asset.signed_urls_verified and asset.ready_to_stream_verified
  );
$$;
revoke all on function private.stream_source_binding_ready(text,text,uuid,uuid,text)
  from public, anon, authenticated, service_role;

create function private.stream_active_parent_fence(target_kind text, target_identity text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.stream_media_parent_fences fence
    where fence.source_kind = target_kind and fence.source_identity = target_identity
      and fence.fence_state <> 'open');
$$;
revoke all on function private.stream_active_parent_fence(text,text)
  from public, anon, authenticated, service_role;

create function public.advance_stream_media_upload(
  target_operation_id uuid, target_request_id uuid, target_next_state text, target_evidence_digest text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare operation_row public.stream_media_operations%rowtype;
v_parent_fence public.stream_media_parent_fences%rowtype;
current_state text;
next_revision bigint;
v_fence_rows integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Stream upload operations are service managed' using errcode = '42501';
  end if;
  if target_operation_id is null or target_request_id is null
    or target_next_state not in ('create_started','create_unknown','created_unverified','failed')
    or target_evidence_digest is null or target_evidence_digest !~ '^[0-9a-f]{64}$'
  then raise exception 'Stream upload transition is invalid' using errcode = '22023'; end if;
  select operation.* into operation_row from public.stream_media_operations operation
  where operation.id = target_operation_id and operation.operation_kind = 'upload';
  if not found then return jsonb_build_object('outcome','operation_missing'); end if;
  perform private.stream_lock_accounts(array[operation_row.actor_id,operation_row.owner_id]);
  perform pg_advisory_xact_lock(hashtextextended(
    operation_row.parent_kind||':'||operation_row.parent_identity,19031002));
  select operation.* into operation_row from public.stream_media_operations operation
  where operation.id = target_operation_id and operation.operation_kind = 'upload' for update;
  if not found then return jsonb_build_object('outcome','operation_missing'); end if;
  select state.operation_state into current_state from public.stream_media_operation_states state
  where state.operation_id = target_operation_id for update;
  if current_state = target_next_state and exists (
    select 1 from public.stream_media_operation_events event
    where event.operation_id = target_operation_id and event.request_id = target_request_id
      and event.to_state = target_next_state and event.evidence_digest = target_evidence_digest
  ) then return jsonb_build_object('outcome','already_recorded','state',current_state); end if;
  if exists (select 1 from public.stream_media_operation_events event
    where event.operation_id = target_operation_id and event.request_id = target_request_id)
  then return jsonb_build_object('outcome','identity_mismatch'); end if;
  if current_state='reserved' and target_next_state='create_started'
    and (private.stream_account_is_tombstoned(operation_row.actor_id)
      or private.stream_account_is_tombstoned(operation_row.owner_id))
  then return jsonb_build_object('outcome','account_deleting'); end if;
  if target_next_state='failed' then
    if current_state is distinct from 'reserved' then
      return jsonb_build_object('outcome','reconciliation_required','state',current_state);
    end if;
    select fence.* into v_parent_fence from public.stream_media_parent_fences fence
    where fence.source_kind=operation_row.parent_kind
      and fence.source_identity=operation_row.parent_identity
    for update;
    if not found or v_parent_fence.owner_id is distinct from operation_row.owner_id
      or v_parent_fence.source_revision is distinct from operation_row.expected_source_revision
      or v_parent_fence.fence_state is distinct from 'closing'
      or v_parent_fence.active_operation_id is distinct from target_operation_id
    then return jsonb_build_object('outcome','parent_fence_mismatch','state',current_state); end if;
    next_revision := private.stream_advance_operation(
      target_operation_id,target_next_state,target_request_id,target_evidence_digest
    );
    update public.stream_media_parent_fences fence
      set fence_state='open',active_operation_id=null,
          state_revision=state_revision+1,updated_at=now()
    where fence.source_kind=operation_row.parent_kind
      and fence.source_identity=operation_row.parent_identity
      and fence.owner_id is not distinct from operation_row.owner_id
      and fence.source_revision=operation_row.expected_source_revision
      and fence.fence_state='closing' and fence.active_operation_id=target_operation_id;
    get diagnostics v_fence_rows = row_count;
    if v_fence_rows <> 1 then
      raise exception 'Reserved upload parent fence changed during failure release' using errcode='40001';
    end if;
    return jsonb_build_object('outcome','advanced','state',target_next_state,'revision',next_revision);
  end if;
  next_revision := private.stream_advance_operation(
    target_operation_id, target_next_state, target_request_id, target_evidence_digest
  );
  return jsonb_build_object('outcome','advanced','state',target_next_state,'revision',next_revision);
end;
$$;
revoke all on function public.advance_stream_media_upload(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.advance_stream_media_upload(uuid,uuid,text,text) to service_role;

create function public.record_stream_media_upload_observation(
  target_operation_id uuid, target_registry_id uuid, target_kind text, target_uid text,
  target_http_status smallint, target_signed_urls boolean, target_creator_match boolean,
  target_marker_match boolean, target_ready boolean, target_request_id uuid, target_evidence_digest text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare operation_row public.stream_media_operations%rowtype;
prior public.stream_media_upload_observations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Provider observations are service managed' using errcode = '42501';
  end if;
  if target_operation_id is null or target_registry_id is null or target_kind not in ('create_reply','exact_uid_get','unique_marker_list_match')
    or target_http_status is null or target_http_status not between 100 and 599
    or target_request_id is null or target_evidence_digest is null or target_evidence_digest !~ '^[0-9a-f]{64}$'
    or (target_kind <> 'create_reply' and (target_uid is null or char_length(target_uid) not between 1 and 200))
  then raise exception 'Provider observation is invalid' using errcode = '22023'; end if;
  select * into operation_row from public.stream_media_operations operation
  where operation.id = target_operation_id and operation.operation_kind = 'upload';
  if not found or operation_row.registry_id <> target_registry_id then
    return jsonb_build_object('outcome','operation_mismatch'); end if;
  perform private.stream_lock_accounts(array[operation_row.actor_id,operation_row.owner_id]);
  if not private.stream_account_is_verified(target_registry_id) then
    return jsonb_build_object('outcome','account_unverified'); end if;
  select * into prior from public.stream_media_upload_observations observation
  where observation.request_id = target_request_id;
  if found then
    if prior.operation_id <> target_operation_id or prior.registry_id <> target_registry_id
      or prior.observation_kind <> target_kind or prior.raw_provider_uid is distinct from target_uid
      or prior.http_status <> target_http_status or prior.signed_urls_reported is distinct from target_signed_urls
      or prior.creator_marker_matched is distinct from target_creator_match
      or prior.metadata_marker_matched is distinct from target_marker_match
      or prior.ready_to_stream_reported is distinct from target_ready
      or prior.evidence_digest <> target_evidence_digest
    then return jsonb_build_object('outcome','identity_mismatch'); end if;
    return jsonb_build_object('outcome','already_recorded','observation_id',prior.id);
  end if;
  insert into public.stream_media_upload_observations (
    operation_id, registry_id, observation_kind, raw_provider_uid, http_status,
    signed_urls_reported, creator_marker_matched, metadata_marker_matched,
    ready_to_stream_reported, request_id, evidence_digest
  ) values (
    target_operation_id, target_registry_id, target_kind, target_uid, target_http_status,
    target_signed_urls, target_creator_match, target_marker_match,
    target_ready, target_request_id, target_evidence_digest
  );
  return jsonb_build_object('outcome','recorded');
exception when unique_violation then
  return jsonb_build_object('outcome','identity_mismatch');
end;
$$;
revoke all on function public.record_stream_media_upload_observation(uuid,uuid,text,text,smallint,boolean,boolean,boolean,boolean,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_stream_media_upload_observation(uuid,uuid,text,text,smallint,boolean,boolean,boolean,boolean,uuid,text)
  to service_role;

create function public.bind_stream_media_upload_readback(
  target_operation_id uuid, target_observation_request_id uuid, target_request_id uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare operation_row public.stream_media_operations%rowtype;
context_row public.stream_media_upload_contexts%rowtype;
observation_row public.stream_media_upload_observations%rowtype;
asset_id uuid;
asset_owner_id uuid;
binding_id uuid;
operation_state text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Media binding is service managed' using errcode = '42501';
  end if;
  if target_operation_id is null or target_observation_request_id is null or target_request_id is null then
    raise exception 'Media binding request is invalid' using errcode = '22023'; end if;
  perform private.stream_require_read_committed();
  select * into operation_row from public.stream_media_operations operation
  where operation.id = target_operation_id and operation.operation_kind = 'upload';
  if not found then return jsonb_build_object('outcome','operation_missing'); end if;
  perform private.stream_lock_accounts(array[operation_row.actor_id,operation_row.owner_id]);
  perform pg_advisory_xact_lock(hashtextextended(
    operation_row.parent_kind || ':' || operation_row.parent_identity,19031002
  ));
  select * into operation_row from public.stream_media_operations operation
  where operation.id = target_operation_id and operation.operation_kind = 'upload' for update;
  if not found then return jsonb_build_object('outcome','operation_missing'); end if;
  select context.* into context_row from public.stream_media_upload_contexts context
  where context.intent_id = operation_row.intent_id;
  select upload_observation.* into observation_row from public.stream_media_upload_observations upload_observation
  where upload_observation.operation_id = target_operation_id
    and upload_observation.request_id = target_observation_request_id;
  if context_row.intent_id is null or observation_row.id is null
    or observation_row.observation_kind <> 'exact_uid_get'
    or observation_row.http_status <> 200
    or not coalesce(observation_row.signed_urls_reported,false)
    or not coalesce(observation_row.creator_marker_matched,false)
    or not coalesce(observation_row.metadata_marker_matched,false)
    or not coalesce(observation_row.ready_to_stream_reported,false)
  then return jsonb_build_object('outcome','readback_not_ready'); end if;
  if not private.stream_account_is_verified(operation_row.registry_id)
  then return jsonb_build_object('outcome','account_unavailable'); end if;
  if not private.stream_try_uid_lock(operation_row.registry_id, observation_row.raw_provider_uid) then
    return jsonb_build_object('outcome','uid_busy'); end if;
  if not exists (
    select 1 from public.stream_media_parent_fences fence
    where fence.source_kind = context_row.parent_kind and fence.source_identity = context_row.parent_identity
      and fence.owner_id = context_row.owner_id and fence.source_revision = context_row.source_revision
      and fence.active_operation_id = target_operation_id and fence.fence_state = 'closing'
  ) then return jsonb_build_object('outcome','source_stale'); end if;
  select state.operation_state into operation_state from public.stream_media_operation_states state
  where state.operation_id = target_operation_id for update;
  if operation_state not in ('created_unverified','create_unknown') then
    if operation_state = 'provisional_bound' and exists (
      select 1 from public.stream_media_assets asset
      where asset.upload_intent_id = operation_row.intent_id
        and asset.registry_id = operation_row.registry_id
        and asset.raw_provider_uid = observation_row.raw_provider_uid
    ) then return jsonb_build_object('outcome','already_bound'); end if;
    return jsonb_build_object('outcome','state_conflict');
  end if;
  insert into public.stream_media_assets (
    registry_id, raw_provider_uid, owner_id, upload_intent_id, creator_observation,
    marker_observation, signed_urls_verified, ready_to_stream_verified,
    lifecycle_state, evidence_digest
  ) values (
    operation_row.registry_id, observation_row.raw_provider_uid, operation_row.owner_id,
    operation_row.intent_id, 'matched_at_exact_readback', 'matched_at_exact_readback',
    true, true, 'provisional_bound', observation_row.evidence_digest
  ) returning id,owner_id into asset_id,asset_owner_id;
  insert into public.stream_media_source_bindings (
    registry_id, raw_provider_uid, asset_id, source_kind, source_identity,
    parent_kind, parent_identity, source_revision, owner_id, binding_state,
    observed_creator, observed_marker, evidence_digest
  ) values (
    operation_row.registry_id, observation_row.raw_provider_uid, asset_id,
    operation_row.source_kind, operation_row.source_identity,
    context_row.parent_kind, context_row.parent_identity, context_row.source_revision,
    operation_row.owner_id, 'provisional_bound', 'matched_at_exact_readback',
    'matched_at_exact_readback', observation_row.evidence_digest
  ) returning id into binding_id;
  insert into public.stream_media_source_binding_events (
    binding_id, event_kind, source_revision, request_id, evidence_digest
  ) values (binding_id, 'attached', context_row.source_revision, target_request_id, observation_row.evidence_digest);
  perform private.stream_record_source_accounts(
    binding_id,operation_row.source_kind,operation_row.source_identity,
    operation_row.owner_id,asset_owner_id
  );
  perform private.stream_advance_operation(target_operation_id,'provisional_bound',
    target_request_id, observation_row.evidence_digest);
  return jsonb_build_object('outcome','provisional_bound','asset_id',asset_id,
    'binding_id',binding_id,'publication_ready',false);
exception
  when unique_violation then return jsonb_build_object('outcome','identity_mismatch');
  when lock_not_available then return jsonb_build_object('outcome','source_busy');
end;
$$;
revoke all on function public.bind_stream_media_upload_readback(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.bind_stream_media_upload_readback(uuid,uuid,uuid) to service_role;

create function private.stream_upload_source_exists(
  target_source_kind text, target_source_identity text, target_owner_id uuid,
  target_registry_id uuid, target_uid text
)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  matches boolean := false;
begin
  if target_source_kind = 'video' then
    select exists (select 1 from public.videos video
      where video.id::text = target_source_identity and video.coach_id = target_owner_id
        and video.stream_provider_account_registry_id = target_registry_id
        and video.cloudflare_uid = target_uid) into matches;
  elsif target_source_kind = 'post_media' then
    select exists (select 1 from public.post_media media
      join public.posts post on post.id = media.post_id
      where media.id::text = target_source_identity and post.author_id = target_owner_id
        and media.kind = 'video' and media.video_uid = target_uid and post.removed_at is null) into matches;
  elsif target_source_kind = 'program_lesson' then
    select exists (select 1 from public.program_content_version_lessons lesson
      join public.programs program on program.id = lesson.program_id
      where lesson.id::text = target_source_identity and program.coach_id = target_owner_id
        and lesson.cloudflare_uid = target_uid and lesson.cloudflare_signed_urls_verified
        and exists (select 1 from public.videos video where video.id = lesson.video_id
          and video.coach_id = target_owner_id and video.cloudflare_uid = target_uid
          and video.stream_provider_account_registry_id = target_registry_id)) into matches;
  elsif target_source_kind = 'program_intro' then
    select exists (select 1 from public.programs program
      join public.videos video on video.id = program.intro_video_id
      where program.id::text = target_source_identity and program.coach_id = target_owner_id
        and video.cloudflare_uid = target_uid and video.stream_provider_account_registry_id = target_registry_id
        and video.coach_id = target_owner_id) into matches;
  elsif target_source_kind = 'daily_content_revision' then
    select exists (select 1 from public.daily_content_revisions revision
      join public.daily_content_items item on item.id = revision.item_id
      join public.videos video on video.id = revision.video_id
      where revision.id::text = target_source_identity and item.owner_id = target_owner_id
        and video.cloudflare_uid = target_uid and video.stream_provider_account_registry_id = target_registry_id
        and video.coach_id = target_owner_id) into matches;
  end if;
  return coalesce(matches,false);
end;
$$;
revoke all on function private.stream_upload_source_exists(text,text,uuid,uuid,text)
  from public, anon, authenticated, service_role;

create function public.finalize_stream_media_upload(
  target_operation_id uuid, target_request_id uuid, target_evidence_digest text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  operation_row public.stream_media_operations%rowtype;
  state_row public.stream_media_operation_states%rowtype;
  finalization_receipt public.stream_media_finalization_receipts%rowtype;
  context_row public.stream_media_upload_contexts%rowtype;
  asset_row public.stream_media_assets%rowtype;
  binding_row public.stream_media_source_bindings%rowtype;
  source_uid text;
  next_revision bigint;
  operation_event_request uuid;
  final_response jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Upload finalization is service managed' using errcode = '42501';
  end if;
  if target_operation_id is null or target_request_id is null
    or target_evidence_digest is null or target_evidence_digest !~ '^[0-9a-f]{64}$'
  then raise exception 'Upload finalization is invalid' using errcode = '22023'; end if;
  perform private.stream_require_read_committed();
  select * into operation_row from public.stream_media_operations operation
    where operation.id = target_operation_id and operation.operation_kind = 'upload';
  if not found then return jsonb_build_object('outcome','operation_missing'); end if;
  select context.* into context_row from public.stream_media_upload_contexts context
    where context.intent_id=operation_row.intent_id;
  if context_row.intent_id is null then return jsonb_build_object('outcome','context_missing'); end if;
  perform private.stream_lock_accounts(array[operation_row.actor_id,operation_row.owner_id]);
  if context_row.parent_kind='program' then
    perform private.lock_program_mutation(context_row.parent_identity::uuid);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    context_row.parent_kind||':'||context_row.parent_identity,19031002));
  select * into operation_row from public.stream_media_operations operation
    where operation.id = target_operation_id and operation.operation_kind = 'upload' for update;
  if not found then return jsonb_build_object('outcome','operation_missing'); end if;
  select * into state_row from public.stream_media_operation_states state
    where state.operation_id = target_operation_id for update;
  select * into finalization_receipt from public.stream_media_finalization_receipts receipt
    where receipt.operation_id=target_operation_id and receipt.request_id=target_request_id;
  if found then
    if finalization_receipt.request_digest<>target_evidence_digest then
      return jsonb_build_object('outcome','identity_mismatch');
    end if;
    return finalization_receipt.response;
  end if;
  if state_row.operation_state = 'completed' then
    return jsonb_build_object('outcome','identity_mismatch');
  end if;
  if state_row.operation_state <> 'provisional_bound' then
    return jsonb_build_object('outcome','state_conflict'); end if;
  select * into context_row from public.stream_media_upload_contexts context
    where context.intent_id = operation_row.intent_id;
  select * into asset_row from public.stream_media_assets asset
    where asset.upload_intent_id = operation_row.intent_id and asset.registry_id = operation_row.registry_id;
  select * into binding_row from public.stream_media_source_bindings binding
    where binding.asset_id = asset_row.id and binding.source_kind = operation_row.source_kind
      and binding.source_identity = operation_row.source_identity;
  if context_row.intent_id is null or asset_row.id is null or binding_row.id is null
    or binding_row.binding_state <> 'provisional_bound'
    or not asset_row.signed_urls_verified or not asset_row.ready_to_stream_verified
  then return jsonb_build_object('outcome','provisional_binding_missing'); end if;
  source_uid := asset_row.raw_provider_uid;
  if not private.stream_try_uid_lock(operation_row.registry_id, source_uid) then
    return jsonb_build_object('outcome','uid_busy'); end if;
  if not private.stream_account_is_verified(operation_row.registry_id)
    or private.stream_account_is_tombstoned(operation_row.owner_id)
    or not exists (
      select 1 from public.stream_media_parent_fences fence
      where fence.source_kind = context_row.parent_kind and fence.source_identity = context_row.parent_identity
        and fence.owner_id = context_row.owner_id and fence.source_revision = context_row.source_revision
        and fence.active_operation_id = target_operation_id and fence.fence_state = 'closing'
    ) then return jsonb_build_object('outcome','source_stale_or_account_unavailable'); end if;
  if not private.stream_upload_source_exists(
    operation_row.source_kind, operation_row.source_identity, operation_row.owner_id,
    operation_row.registry_id, source_uid
  ) then return jsonb_build_object('outcome','source_not_bound'); end if;
  if exists (select 1 from public.stream_media_source_bindings other_binding
    where other_binding.registry_id = operation_row.registry_id
      and other_binding.raw_provider_uid = source_uid and other_binding.id <> binding_row.id
      and other_binding.binding_state in ('legacy_unverified','provisional_bound','ready_for_publication','active','retained','quarantined'))
    or private.stream_legacy_uid_unresolved(operation_row.registry_id,source_uid) then
    return jsonb_build_object('outcome','uid_collision_or_legacy_candidate'); end if;
  update public.stream_media_assets
    set lifecycle_state = 'ready_for_publication', asset_revision = asset_revision + 1,
        observed_at = now(), evidence_digest = target_evidence_digest
    where id = asset_row.id returning * into asset_row;
  update public.stream_media_source_bindings
    set binding_state = 'ready_for_publication', source_revision = source_revision + 1,
        state_revision=state_revision+1,updated_at=now(),evidence_digest = target_evidence_digest
    where id = binding_row.id returning * into binding_row;
  insert into public.stream_media_asset_events (
    asset_id, event_kind, asset_revision, request_id, evidence_digest
  ) values (asset_row.id,'ready_readback',asset_row.asset_revision,target_request_id,target_evidence_digest);
  insert into public.stream_media_source_binding_events (
    binding_id,event_kind,source_revision,request_id,evidence_digest
  ) values (binding_row.id,'attached',binding_row.source_revision,target_request_id,target_evidence_digest);
  next_revision := private.stream_advance_operation(
    target_operation_id,'ready_for_publication',target_request_id,target_evidence_digest
  );
  perform set_config('app.stream_media_operation_id',target_operation_id::text,true);
  if operation_row.source_kind = 'video' then
    update public.videos set status = 'ready' where id::text = operation_row.source_identity
      and cloudflare_uid = source_uid and coach_id = operation_row.owner_id
      and stream_provider_account_registry_id = operation_row.registry_id;
    if not found then return jsonb_build_object('outcome','source_stale'); end if;
  end if;
  operation_event_request := private.stream_media_request_uuid(
    target_operation_id::text||':'||target_request_id::text||':upload-completed');
  perform private.stream_advance_operation(
    target_operation_id,'completed',operation_event_request,target_evidence_digest
  );
  update public.stream_media_parent_fences fence
    set fence_state='open',active_operation_id=null,source_revision=source_revision+1,
        state_revision=state_revision+1,updated_at=now()
    where fence.source_kind=context_row.parent_kind and fence.source_identity=context_row.parent_identity
      and fence.active_operation_id=target_operation_id and fence.source_revision=context_row.source_revision;
  final_response := jsonb_build_object('outcome','ready_for_publication','operation_revision',next_revision,
    'source_revision',context_row.source_revision+1);
  insert into public.stream_media_finalization_receipts(
    operation_id,request_id,request_digest,terminal_state,response
  ) values (target_operation_id,target_request_id,target_evidence_digest,'completed',final_response);
  return final_response;
exception
  when unique_violation then return jsonb_build_object('outcome','identity_mismatch');
  when lock_not_available then return jsonb_build_object('outcome','source_busy');
end;
$$;
revoke all on function public.finalize_stream_media_upload(uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_stream_media_upload(uuid,uuid,text) to service_role;

-- Account deletion readiness is a registered multi-component contract. Later feature migrations
-- insert their required component here; an absent registration/proof is never treated as ready.
create table public.stream_auth_cleanup_components (
  component_key text primary key check (component_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  component_version bigint not null check (component_version > 0),
  resource_set_revision bigint not null check (resource_set_revision > 0),
  required_for_auth boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.stream_auth_cleanup_components (
  component_key, component_version, resource_set_revision, required_for_auth
) values ('vod_media',1,1,true);

create table public.stream_media_auth_component_proof_events (
  id uuid primary key default gen_random_uuid(),
  tombstone_id uuid not null references public.stream_media_account_tombstones (id) on delete restrict,
  tombstone_revision bigint not null check (tombstone_revision > 0),
  component_key text not null references public.stream_auth_cleanup_components (component_key) on delete restrict,
  proof_sequence bigint not null check (proof_sequence > 0),
  component_version bigint not null check (component_version > 0),
  resource_set_revision bigint not null check (resource_set_revision > 0),
  proof_state text not null check (proof_state in ('ready','incomplete','unknown','blocked')),
  source_revision_digest text not null check (source_revision_digest ~ '^[0-9a-f]{64}$'),
  proof_digest text not null check (proof_digest ~ '^[0-9a-f]{64}$'),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (tombstone_id, component_key, proof_sequence),
  unique (tombstone_id, request_id)
);

create table public.stream_media_auth_permit_components (
  permit_id uuid not null references public.stream_media_auth_deletion_permits (id) on delete restrict,
  validation_revision bigint not null check (validation_revision > 0),
  component_key text not null,
  component_version bigint not null check (component_version > 0),
  resource_set_revision bigint not null check (resource_set_revision > 0),
  proof_event_id uuid not null references public.stream_media_auth_component_proof_events (id) on delete restrict,
  source_revision_digest text not null check (source_revision_digest ~ '^[0-9a-f]{64}$'),
  proof_digest text not null check (proof_digest ~ '^[0-9a-f]{64}$'),
  primary key (permit_id, validation_revision, component_key)
);

alter table public.stream_auth_cleanup_components enable row level security;
alter table public.stream_media_auth_component_proof_events enable row level security;
alter table public.stream_media_auth_permit_components enable row level security;
revoke all on public.stream_auth_cleanup_components,
  public.stream_media_auth_component_proof_events, public.stream_media_auth_permit_components
  from public, anon, authenticated, service_role;
create trigger stream_media_auth_component_proofs_immutable
before update or delete on public.stream_media_auth_component_proof_events
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();
create trigger stream_media_auth_permit_components_immutable
before update or delete on public.stream_media_auth_permit_components
for each row execute function private.reject_stream_media_lifecycle_evidence_mutation();

create function public.record_stream_auth_cleanup_component_proof(
  target_tombstone_id uuid, target_tombstone_revision bigint, target_component_key text,
  target_component_version bigint, target_resource_set_revision bigint, target_proof_state text,
  target_source_revision_digest text, target_proof_digest text, target_request_id uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  tombstone public.stream_media_account_tombstones%rowtype;
  component public.stream_auth_cleanup_components%rowtype;
  prior public.stream_media_auth_component_proof_events%rowtype;
  next_sequence bigint;
  event_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Cleanup readiness proofs are service managed' using errcode = '42501';
  end if;
  if target_tombstone_id is null or target_tombstone_revision is null
    or target_component_key is null or target_component_version is null or target_resource_set_revision is null
    or target_proof_state not in ('ready','incomplete','unknown','blocked')
    or target_source_revision_digest is null or target_source_revision_digest !~ '^[0-9a-f]{64}$'
    or target_proof_digest is null or target_proof_digest !~ '^[0-9a-f]{64}$'
    or target_request_id is null
  then raise exception 'Cleanup readiness proof is invalid' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_tombstone_id::text,19031003));
  select * into tombstone from public.stream_media_account_tombstones item
  where item.id = target_tombstone_id for update;
  if not found or tombstone.revision <> target_tombstone_revision
    or tombstone.tombstone_state not in ('closing','provider_cleanup','auth_deletion_ready','auth_call_started','auth_result_unknown')
  then return jsonb_build_object('outcome','tombstone_stale'); end if;
  select * into component from public.stream_auth_cleanup_components item
  where item.component_key = target_component_key;
  if not found or component.component_version <> target_component_version
    or component.resource_set_revision <> target_resource_set_revision or not component.required_for_auth
  then return jsonb_build_object('outcome','component_stale_or_unregistered'); end if;
  select * into prior from public.stream_media_auth_component_proof_events event
  where event.tombstone_id = target_tombstone_id and event.request_id = target_request_id;
  if found then
    if prior.tombstone_revision <> target_tombstone_revision or prior.component_key <> target_component_key
      or prior.component_version <> target_component_version
      or prior.resource_set_revision <> target_resource_set_revision
      or prior.proof_state <> target_proof_state
      or prior.source_revision_digest <> target_source_revision_digest
      or prior.proof_digest <> target_proof_digest
    then return jsonb_build_object('outcome','identity_mismatch'); end if;
    return jsonb_build_object('outcome','already_recorded','proof_event_id',prior.id);
  end if;
  select coalesce(max(event.proof_sequence),0)+1 into next_sequence
  from public.stream_media_auth_component_proof_events event
  where event.tombstone_id = target_tombstone_id and event.component_key = target_component_key;
  insert into public.stream_media_auth_component_proof_events (
    tombstone_id,tombstone_revision,component_key,proof_sequence,component_version,
    resource_set_revision,proof_state,source_revision_digest,proof_digest,request_id
  ) values (
    target_tombstone_id,target_tombstone_revision,target_component_key,next_sequence,
    target_component_version,target_resource_set_revision,target_proof_state,
    target_source_revision_digest,target_proof_digest,target_request_id
  ) returning id into event_id;
  return jsonb_build_object('outcome','recorded','proof_event_id',event_id,'proof_sequence',next_sequence);
exception when unique_violation then
  return jsonb_build_object('outcome','identity_mismatch');
end;
$$;
revoke all on function public.record_stream_auth_cleanup_component_proof(uuid,bigint,text,bigint,bigint,text,text,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.record_stream_auth_cleanup_component_proof(uuid,bigint,text,bigint,bigint,text,text,text,uuid)
  to service_role;

alter table public.stream_media_account_tombstones
  add column state_revision bigint not null default 1 check (state_revision > 0);

create function private.stream_auth_permit_manifest_current(target_permit_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  with selected as (
    select permit.id,permit.account_id,permit.tombstone_id,permit.manifest_count,
      permit.manifest_digest,permit.source_revision_digest,tombstone.request_id,
      tombstone.source_revision_digest as current_source_revision_digest
    from public.stream_media_auth_deletion_permits permit
    join public.stream_media_account_tombstones tombstone
      on tombstone.id=permit.tombstone_id and tombstone.account_id=permit.account_id
    where permit.id=target_permit_id
  ), manifests as (
    select manifest.permit_id,manifest.operation_id,manifest.operation_digest,manifest.source_revision,
      operation.request_id,operation.operation_kind,operation.owner_id,operation.operation_digest as current_digest,
      operation.expected_source_revision,state.operation_state
    from public.stream_media_auth_permit_manifests manifest
    join public.stream_media_operations operation on operation.id=manifest.operation_id
    join public.stream_media_operation_states state on state.operation_id=operation.id
  )
  select exists (
    select 1 from selected permit
    where permit.current_source_revision_digest is not null
      and permit.source_revision_digest=permit.current_source_revision_digest
      and permit.manifest_count=(select count(*) from manifests item where item.permit_id=permit.id)
      and permit.manifest_count > 0
      and permit.manifest_digest=private.stream_media_identity_digest(coalesce((
        select string_agg(concat_ws('|',item.operation_id::text,item.operation_digest,
          item.source_revision::text,item.operation_state),chr(10) order by item.operation_id::text)
        from manifests item where item.permit_id=permit.id
      ),''))
      and not exists (
        select 1 from manifests item where item.permit_id=permit.id
          and (item.request_id<>permit.request_id or item.operation_kind<>'account_cleanup'
            or item.owner_id<>permit.account_id or item.current_digest<>item.operation_digest
            or item.expected_source_revision<>item.source_revision
            or item.operation_state not in ('completed','retained'))
      )
  );
$$;
revoke all on function private.stream_auth_permit_manifest_current(uuid)
  from public, anon, authenticated, service_role;

create function private.stream_auth_contract_current(target_permit_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  with selected as (
    select permit.id,permit.tombstone_id,permit.account_id,tombstone.revision as tombstone_revision,
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
  select exists (select 1 from selected)
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
        join public.stream_media_auth_component_proof_events proof
          on proof.id=snapshot.proof_event_id
        where snapshot.permit_id=permit.id
          and snapshot.validation_revision=permit.validation_revision
          and snapshot.component_key=component.component_key
          and snapshot.component_version=component.component_version
          and snapshot.resource_set_revision=component.resource_set_revision
          and proof.tombstone_id=permit.tombstone_id
          and proof.tombstone_revision=permit.tombstone_revision
          and proof.component_key=component.component_key
          and proof.component_version=component.component_version
          and proof.resource_set_revision=component.resource_set_revision
          and proof.proof_state='ready'
          and snapshot.source_revision_digest=proof.source_revision_digest
          and snapshot.proof_digest=proof.proof_digest
          and proof.proof_sequence=(select max(latest.proof_sequence)
            from public.stream_media_auth_component_proof_events latest
            where latest.tombstone_id=permit.tombstone_id and latest.component_key=component.component_key)
      )
    )
    and (
      select count(*) from public.stream_media_auth_permit_components snapshot
      cross join selected permit
      where snapshot.permit_id=permit.id and snapshot.validation_revision=permit.validation_revision
        and exists (select 1 from required component
          where component.component_key=snapshot.component_key)
    ) = (select count(*) from required);
$$;
revoke all on function private.stream_auth_contract_current(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.stream_auth_deletion_permitted(target_account_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.stream_media_auth_deletion_permits permit
    join public.stream_media_account_tombstones tombstone
      on tombstone.id=permit.tombstone_id and tombstone.account_id=permit.account_id
    where permit.account_id=target_account_id
      and permit.permit_state in ('auth_call_started','auth_result_unknown','auth_confirmed','completed')
      and tombstone.tombstone_state in ('auth_call_started','auth_result_unknown','auth_confirmed','completed')
      and private.stream_auth_contract_current(permit.id)
      and not exists (
        select 1 from public.stream_media_auth_permit_manifests manifest
        join public.stream_media_operations operation on operation.id=manifest.operation_id
        join public.stream_media_operation_states state on state.operation_id=operation.id
        where manifest.permit_id=permit.id
          and (state.operation_state not in ('completed','retained')
            or operation.operation_kind <> 'account_cleanup'
            or operation.owner_id <> target_account_id)
      )
      and not exists (
        select 1 from public.stream_media_source_account_edges account_edge
        join public.stream_media_source_bindings binding on binding.id=account_edge.binding_id
        where account_edge.account_id=target_account_id
          and (binding.registry_id is null
            or binding.binding_state in ('legacy_unverified','provisional_bound','ready_for_publication','quarantined'))
      )
      and not exists (
        select 1 from public.stream_media_operations operation
        join public.stream_media_operation_states state on state.operation_id=operation.id
        where operation.operation_kind='account_cleanup' and operation.owner_id=target_account_id
          and state.operation_state not in ('completed','retained')
      )
  );
$$;
revoke all on function private.stream_auth_deletion_permitted(uuid)
  from public, anon, authenticated, service_role;

create function public.prepare_stream_auth_deletion_permit(
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

create function public.start_stream_auth_deletion_call(
  target_permit_id uuid,target_expected_permit_revision bigint,
  target_expected_tombstone_state_revision bigint,target_request_id uuid,target_evidence_digest text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  permit public.stream_media_auth_deletion_permits%rowtype;
  tombstone public.stream_media_account_tombstones%rowtype;
  prior public.stream_media_auth_deletion_events%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Auth deletion calls are service managed' using errcode = '42501'; end if;
  if target_permit_id is null or target_expected_permit_revision is null
    or target_expected_tombstone_state_revision is null or target_request_id is null
    or target_evidence_digest is null or target_evidence_digest !~ '^[0-9a-f]{64}$'
  then raise exception 'Auth deletion start is invalid' using errcode = '22023'; end if;
  select account_row.* into tombstone from public.stream_media_auth_deletion_permits permit_row
    join public.stream_media_account_tombstones account_row on account_row.id=permit_row.tombstone_id
    where permit_row.id=target_permit_id;
  if not found then return jsonb_build_object('outcome','permit_missing'); end if;
  perform pg_advisory_xact_lock(hashtextextended('account:'||tombstone.account_id::text,19031003));
  select * into permit from public.stream_media_auth_deletion_permits item
    where item.id=target_permit_id for update;
  select * into tombstone from public.stream_media_account_tombstones item
    where item.id=permit.tombstone_id for update;
  select * into prior from public.stream_media_auth_deletion_events event
    where event.permit_id=permit.id and event.request_id=target_request_id;
  if found then
    if prior.event_kind<>'auth_call_started' or prior.evidence_digest<>target_evidence_digest then
      return jsonb_build_object('outcome','identity_mismatch'); end if;
    return jsonb_build_object('outcome','already_started','permit_state',permit.permit_state);
  end if;
  if permit.revision<>target_expected_permit_revision
    or tombstone.state_revision<>target_expected_tombstone_state_revision then
    return jsonb_build_object('outcome','state_stale','permit_revision',permit.revision,
      'tombstone_state_revision',tombstone.state_revision); end if;
  if permit.permit_state not in ('ready','auth_result_unknown')
    or tombstone.tombstone_state not in ('auth_deletion_ready','auth_result_unknown') then
    return jsonb_build_object('outcome','state_conflict'); end if;
  if not private.stream_auth_contract_current(permit.id) then
    return jsonb_build_object('outcome','component_proofs_stale'); end if;
  update public.stream_media_auth_deletion_permits set permit_state='auth_call_started',
    revision=revision+1,updated_at=now() where id=permit.id returning * into permit;
  update public.stream_media_account_tombstones set tombstone_state='auth_call_started',
    state_revision=state_revision+1,updated_at=now() where id=tombstone.id returning * into tombstone;
  insert into public.stream_media_auth_deletion_events(permit_id,event_kind,request_id,evidence_digest)
    values (permit.id,'auth_call_started',target_request_id,target_evidence_digest);
  insert into public.stream_media_account_tombstone_events(
    tombstone_id,event_kind,request_id,source_revision_digest,evidence_digest
  ) values (tombstone.id,'auth_call_started',target_request_id,tombstone.source_revision_digest,target_evidence_digest);
  return jsonb_build_object('outcome','started','permit_id',permit.id,'permit_revision',permit.revision,
    'tombstone_state_revision',tombstone.state_revision);
exception when unique_violation then return jsonb_build_object('outcome','identity_mismatch');
end;
$$;
revoke all on function public.start_stream_auth_deletion_call(uuid,bigint,bigint,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.start_stream_auth_deletion_call(uuid,bigint,bigint,uuid,text)
  to service_role;

create function public.record_stream_auth_deletion_result(
  target_permit_id uuid,target_expected_permit_revision bigint,
  target_tombstone_state_revision bigint,target_result text,
  target_request_id uuid,target_evidence_digest text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  permit public.stream_media_auth_deletion_permits%rowtype;
  tombstone public.stream_media_account_tombstones%rowtype;
  prior public.stream_media_auth_deletion_events%rowtype;
  next_state text;
  expected_event text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Auth deletion results are service managed' using errcode = '42501'; end if;
  if target_permit_id is null or target_expected_permit_revision is null
    or target_tombstone_state_revision is null or target_result is null
    or target_result not in ('unknown','confirmed')
    or target_request_id is null or target_evidence_digest is null
    or target_evidence_digest !~ '^[0-9a-f]{64}$'
  then raise exception 'Auth deletion result is invalid' using errcode = '22023'; end if;
  select account_row.* into tombstone from public.stream_media_auth_deletion_permits permit_row
    join public.stream_media_account_tombstones account_row on account_row.id=permit_row.tombstone_id
    where permit_row.id=target_permit_id;
  if not found then return jsonb_build_object('outcome','permit_missing'); end if;
  perform pg_advisory_xact_lock(hashtextextended('account:'||tombstone.account_id::text,19031003));
  select * into permit from public.stream_media_auth_deletion_permits item
    where item.id=target_permit_id for update;
  select * into tombstone from public.stream_media_account_tombstones item
    where item.id=permit.tombstone_id for update;
  expected_event := case when target_result='unknown' then 'auth_result_unknown' else 'auth_confirmed' end;
  select * into prior from public.stream_media_auth_deletion_events event
    where event.permit_id=permit.id and event.request_id=target_request_id;
  if found then
    if prior.event_kind<>expected_event or prior.evidence_digest<>target_evidence_digest then
      return jsonb_build_object('outcome','identity_mismatch'); end if;
    return jsonb_build_object('outcome','already_recorded','permit_state',permit.permit_state);
  end if;
  if permit.revision<>target_expected_permit_revision
    or tombstone.state_revision<>target_tombstone_state_revision then
    return jsonb_build_object('outcome','state_stale','permit_revision',permit.revision,
      'tombstone_state_revision',tombstone.state_revision); end if;
  if target_result='unknown' then
    if permit.permit_state<>'auth_call_started' or tombstone.tombstone_state<>'auth_call_started' then
      return jsonb_build_object('outcome','state_conflict'); end if;
    next_state := 'auth_result_unknown';
  else
    if permit.permit_state not in ('auth_call_started','auth_result_unknown')
      or tombstone.tombstone_state not in ('auth_call_started','auth_result_unknown') then
      return jsonb_build_object('outcome','state_conflict'); end if;
    next_state := 'auth_confirmed';
  end if;
  update public.stream_media_auth_deletion_permits set permit_state=next_state,
    revision=revision+1,updated_at=now() where id=permit.id returning * into permit;
  update public.stream_media_account_tombstones set tombstone_state=next_state,
    state_revision=state_revision+1,updated_at=now() where id=tombstone.id returning * into tombstone;
  insert into public.stream_media_auth_deletion_events(permit_id,event_kind,request_id,evidence_digest)
    values (permit.id,next_state,target_request_id,target_evidence_digest);
  insert into public.stream_media_account_tombstone_events(
    tombstone_id,event_kind,request_id,source_revision_digest,evidence_digest
  ) values (tombstone.id,next_state,target_request_id,tombstone.source_revision_digest,target_evidence_digest);
  return jsonb_build_object('outcome','recorded','permit_state',permit.permit_state,
    'permit_revision',permit.revision,'tombstone_state_revision',tombstone.state_revision);
exception when unique_violation then return jsonb_build_object('outcome','identity_mismatch');
end;
$$;
revoke all on function public.record_stream_auth_deletion_result(uuid,bigint,bigint,text,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_stream_auth_deletion_result(uuid,bigint,bigint,text,uuid,text)
  to service_role;

create function public.complete_stream_auth_deletion(
  target_permit_id uuid,target_expected_permit_revision bigint,
  target_tombstone_state_revision bigint,target_request_id uuid,target_evidence_digest text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  permit public.stream_media_auth_deletion_permits%rowtype;
  tombstone public.stream_media_account_tombstones%rowtype;
  prior public.stream_media_auth_deletion_events%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Auth deletion completion is service managed' using errcode = '42501'; end if;
  if target_permit_id is null or target_expected_permit_revision is null
    or target_tombstone_state_revision is null or target_request_id is null
    or target_evidence_digest is null or target_evidence_digest !~ '^[0-9a-f]{64}$'
  then raise exception 'Auth deletion completion is invalid' using errcode = '22023'; end if;
  select account_row.* into tombstone from public.stream_media_auth_deletion_permits permit_row
    join public.stream_media_account_tombstones account_row on account_row.id=permit_row.tombstone_id
    where permit_row.id=target_permit_id;
  if not found then return jsonb_build_object('outcome','permit_missing'); end if;
  perform pg_advisory_xact_lock(hashtextextended('account:'||tombstone.account_id::text,19031003));
  select * into permit from public.stream_media_auth_deletion_permits item
    where item.id=target_permit_id for update;
  select * into tombstone from public.stream_media_account_tombstones item
    where item.id=permit.tombstone_id for update;
  select * into prior from public.stream_media_auth_deletion_events event
    where event.permit_id=permit.id and event.request_id=target_request_id;
  if found then
    if prior.event_kind<>'completed' or prior.evidence_digest<>target_evidence_digest then
      return jsonb_build_object('outcome','identity_mismatch'); end if;
    return jsonb_build_object('outcome','already_completed','permit_id',permit.id); end if;
  if permit.revision<>target_expected_permit_revision
    or tombstone.state_revision<>target_tombstone_state_revision then
    return jsonb_build_object('outcome','state_stale','permit_revision',permit.revision,
      'tombstone_state_revision',tombstone.state_revision); end if;
  if permit.permit_state<>'auth_confirmed' or tombstone.tombstone_state<>'auth_confirmed' then
    return jsonb_build_object('outcome','state_conflict'); end if;
  update public.stream_media_auth_deletion_permits set permit_state='completed',
    revision=revision+1,updated_at=now() where id=permit.id returning * into permit;
  update public.stream_media_account_tombstones set tombstone_state='completed',
    state_revision=state_revision+1,updated_at=now() where id=tombstone.id returning * into tombstone;
  insert into public.stream_media_auth_deletion_events(permit_id,event_kind,request_id,evidence_digest)
    values (permit.id,'completed',target_request_id,target_evidence_digest);
  insert into public.stream_media_account_tombstone_events(
    tombstone_id,event_kind,request_id,source_revision_digest,evidence_digest
  ) values (tombstone.id,'completed',target_request_id,tombstone.source_revision_digest,target_evidence_digest);
  return jsonb_build_object('outcome','completed','permit_id',permit.id,
    'permit_revision',permit.revision,'tombstone_state_revision',tombstone.state_revision);
exception when unique_violation then return jsonb_build_object('outcome','identity_mismatch');
end;
$$;
revoke all on function public.complete_stream_auth_deletion(uuid,bigint,bigint,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_stream_auth_deletion(uuid,bigint,bigint,uuid,text)
  to service_role;

create or replace function private.stream_operation_has_edge(
  target_operation_id uuid,target_source_kind text,target_source_identity text,
  target_registry_id uuid,target_uid text
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.stream_media_operations operation
    join public.stream_media_operation_states state on state.operation_id=operation.id
    join public.stream_media_manifest_edges edge on edge.operation_id=operation.id
    join public.stream_media_operation_uid_state uid_state
      on uid_state.operation_id=edge.operation_id and uid_state.registry_id=edge.registry_id
        and uid_state.raw_provider_uid=edge.raw_provider_uid
    join public.stream_media_source_bindings binding on binding.id=edge.binding_id
    join public.stream_media_parent_fences fence
      on fence.source_kind=operation.parent_kind and fence.source_identity=operation.parent_identity
    where operation.id=target_operation_id
      and edge.source_kind=target_source_kind and edge.source_identity=target_source_identity
      and edge.registry_id=target_registry_id and edge.raw_provider_uid=target_uid
      and binding.registry_id=target_registry_id and binding.raw_provider_uid=target_uid
      and edge.source_revision=binding.source_revision
      and ((operation.operation_kind='cleanup'
          and state.operation_state in ('cleanup_reserved','delete_started','delete_unknown','source_finalizing')
          and fence.active_operation_id=operation.id and fence.fence_state='closing'
          and fence.source_revision=operation.expected_source_revision)
        or (operation.operation_kind='account_cleanup'
          and exists (select 1 from public.stream_media_source_account_edges account_edge
            where account_edge.binding_id=binding.id and account_edge.account_id=operation.owner_id)
          and ((state.operation_state in ('cleanup_reserved','delete_started','delete_unknown','source_finalizing')
              and fence.active_operation_id=operation.id and fence.fence_state='closing'
              and fence.source_revision=operation.expected_source_revision)
            or (state.operation_state in ('completed','retained')
              and private.stream_auth_deletion_permitted(operation.owner_id)
              and fence.fence_state='closed' and fence.active_operation_id is null
               and fence.source_revision=operation.expected_source_revision+1)))
        or (operation.operation_kind='source_mutation' and state.operation_state='completed'
          and uid_state.uid_state='detached_retained' and edge.detach_allowed
          and fence.fence_state='open' and fence.active_operation_id is null
          and fence.source_revision=operation.expected_source_revision+1
          and binding.owner_id=operation.owner_id)
      )
  );
$$;
revoke all on function private.stream_operation_has_edge(uuid,text,text,uuid,text)
  from public, anon, authenticated, service_role;

create or replace function private.stream_manifest_edge_authorized(
  target_operation_id uuid,target_source_kind text,target_source_identity text,
  target_registry_id uuid,target_uid text
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.stream_media_operations operation
    join public.stream_media_operation_states state on state.operation_id=operation.id
    join public.stream_media_manifest_edges edge on edge.operation_id=operation.id
    join public.stream_media_operation_uid_state uid_state
      on uid_state.operation_id=edge.operation_id and uid_state.registry_id=edge.registry_id
        and uid_state.raw_provider_uid=edge.raw_provider_uid
    join public.stream_media_source_bindings binding on binding.id=edge.binding_id
    join public.stream_media_parent_fences fence
      on fence.source_kind=operation.parent_kind and fence.source_identity=operation.parent_identity
    where operation.id=target_operation_id
      and edge.source_kind=target_source_kind and edge.source_identity=target_source_identity
      and edge.registry_id=target_registry_id and edge.raw_provider_uid=target_uid
      and binding.registry_id=target_registry_id and binding.raw_provider_uid=target_uid
      and edge.source_revision=binding.source_revision
      and ((operation.operation_kind='cleanup'
          and state.operation_state in ('cleanup_reserved','delete_started','delete_unknown','source_finalizing')
          and fence.active_operation_id=operation.id and fence.fence_state='closing'
          and fence.source_revision=operation.expected_source_revision
          and (operation.source_kind=target_source_kind and operation.source_identity=target_source_identity
            or binding.parent_kind=operation.source_kind and binding.parent_identity=operation.source_identity))
        or (operation.operation_kind='account_cleanup'
          and exists (select 1 from public.stream_media_source_account_edges account_edge
            where account_edge.binding_id=binding.id and account_edge.account_id=operation.owner_id)
          and ((state.operation_state in ('cleanup_reserved','delete_started','delete_unknown','source_finalizing')
              and fence.active_operation_id=operation.id and fence.fence_state='closing'
              and fence.source_revision=operation.expected_source_revision)
            or (state.operation_state in ('completed','retained')
              and private.stream_auth_deletion_permitted(operation.owner_id)
              and fence.fence_state='closed' and fence.active_operation_id is null
               and fence.source_revision=operation.expected_source_revision+1)))
        or (operation.operation_kind='source_mutation' and state.operation_state='completed'
          and uid_state.uid_state='detached_retained' and edge.detach_allowed
          and fence.fence_state='open' and fence.active_operation_id is null
          and fence.source_revision=operation.expected_source_revision+1
          and binding.owner_id=operation.owner_id)
      )
  );
$$;
revoke all on function private.stream_manifest_edge_authorized(uuid,text,text,uuid,text)
  from public, anon, authenticated, service_role;

create function private.guard_stream_profile_delete()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare account_operation_id uuid;
begin
  if not private.stream_auth_deletion_permitted(old.id) then
    raise exception 'Account deletion requires a current durable media permit' using errcode = '55000';
  end if;
  select operation.id into account_operation_id
  from public.stream_media_auth_deletion_permits permit
  join public.stream_media_auth_permit_manifests manifest on manifest.permit_id=permit.id
  join public.stream_media_operations operation on operation.id=manifest.operation_id
  join public.stream_media_operation_states state on state.operation_id=operation.id
  where permit.account_id=old.id and operation.operation_kind='account_cleanup'
    and operation.owner_id=old.id and state.operation_state in ('completed','retained')
  order by operation.created_at desc limit 1;
  if account_operation_id is null then
    raise exception 'Account media operation is missing from the permit' using errcode = '55000';
  end if;
  -- This value only selects the already-authorized account operation. Child guards re-check the
  -- durable permit, exact manifest edge, retained state, and account/UID tuple.
  perform set_config('app.stream_media_operation_id',account_operation_id::text,true);
  return old;
end;
$$;
revoke all on function private.guard_stream_profile_delete() from public, anon, authenticated, service_role;
create trigger profiles_stream_media_delete_guard
before delete on public.profiles
for each row execute function private.guard_stream_profile_delete();

create function public.finalize_stream_media_cleanup(
  target_operation_id uuid,target_request_id uuid,target_evidence_digest text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  operation_row public.stream_media_operations%rowtype;
  state_row public.stream_media_operation_states%rowtype;
  finalization_receipt public.stream_media_finalization_receipts%rowtype;
  fence public.stream_media_parent_fences%rowtype;
  uid_item record;
  edge_item record;
  all_terminal boolean;
  must_retain_parent boolean := false;
  has_retained boolean := false;
  next_state text;
  transition_request uuid;
  completed_request uuid;
  digest text;
  inventory text;
  event_request uuid;
  event_sequence bigint;
  registry_ids uuid[];
  raw_uids text[];
  source_exists boolean;
  final_response jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Media cleanup finalization is service managed' using errcode = '42501'; end if;
  if target_operation_id is null or target_request_id is null
    or target_evidence_digest is null or target_evidence_digest !~ '^[0-9a-f]{64}$'
  then raise exception 'Media cleanup finalization is invalid' using errcode = '22023'; end if;
  perform private.stream_require_read_committed();
  select * into operation_row from public.stream_media_operations operation
    where operation.id=target_operation_id and operation.operation_kind in ('cleanup','account_cleanup');
  if not found then return jsonb_build_object('outcome','operation_missing'); end if;
  perform private.stream_lock_accounts(array[operation_row.owner_id]);
  if operation_row.source_kind='program' then
    perform private.lock_program_mutation(operation_row.source_identity::uuid);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    operation_row.parent_kind||':'||operation_row.parent_identity,19031002));
  select * into operation_row from public.stream_media_operations operation
    where operation.id=target_operation_id and operation.operation_kind in ('cleanup','account_cleanup') for update;
  if not found then return jsonb_build_object('outcome','operation_missing'); end if;
  select * into state_row from public.stream_media_operation_states state
    where state.operation_id=target_operation_id for update;
  select * into finalization_receipt from public.stream_media_finalization_receipts receipt
    where receipt.operation_id=target_operation_id and receipt.request_id=target_request_id;
  if found then
    if finalization_receipt.request_digest<>target_evidence_digest then
      return jsonb_build_object('outcome','identity_mismatch');
    end if;
    return finalization_receipt.response;
  end if;
  if state_row.operation_state in ('completed','retained') then
    return jsonb_build_object('outcome','identity_mismatch');
  end if;
  if state_row.operation_state not in ('cleanup_reserved','delete_started','delete_unknown') then
    return jsonb_build_object('outcome','state_conflict'); end if;
  if exists (select 1 from public.stream_media_operation_uid_state uid_state
    where uid_state.operation_id=target_operation_id
      and uid_state.uid_state not in ('deleted_confirmed','already_absent_confirmed',
        'retained_attached','detached_retained')) then
    return jsonb_build_object('outcome','uid_outcomes_incomplete'); end if;
  select * into fence from public.stream_media_parent_fences parent
    where parent.source_kind=operation_row.source_kind
      and parent.source_identity=operation_row.source_identity for update;
  if not found or fence.active_operation_id<>target_operation_id
    or fence.source_revision<>operation_row.expected_source_revision or fence.fence_state<>'closing'
  then return jsonb_build_object('outcome','source_revision_stale'); end if;
  select array_agg(item.registry_id order by item.registry_id::text,item.raw_provider_uid),
         array_agg(item.raw_provider_uid order by item.registry_id::text,item.raw_provider_uid)
    into registry_ids,raw_uids
  from (select distinct uid_state.registry_id,uid_state.raw_provider_uid
    from public.stream_media_operation_uid_state uid_state where uid_state.operation_id=target_operation_id) item;
  if coalesce(cardinality(raw_uids),0)>0 then perform private.stream_try_uid_locks(registry_ids,raw_uids); end if;
  select exists (
    select 1 from public.stream_media_operation_uid_state uid_state
    join public.stream_media_manifest_edges edge on edge.operation_id=uid_state.operation_id
      and edge.registry_id=uid_state.registry_id and edge.raw_provider_uid=uid_state.raw_provider_uid
    where uid_state.operation_id=target_operation_id and uid_state.uid_state='retained_attached'
      and not edge.detach_allowed
  ) into must_retain_parent;
  transition_request := (substr(md5(target_operation_id::text || ':source-finalizing'),1,8) || '-'
    || substr(md5(target_operation_id::text || ':source-finalizing'),9,4) || '-'
    || substr(md5(target_operation_id::text || ':source-finalizing'),13,4) || '-'
    || substr(md5(target_operation_id::text || ':source-finalizing'),17,4) || '-'
    || substr(md5(target_operation_id::text || ':source-finalizing'),21,12))::uuid;
  if not exists (select 1 from public.stream_media_operation_events event
    where event.operation_id=target_operation_id and event.request_id=transition_request) then
    perform private.stream_advance_operation(target_operation_id,'source_finalizing',
      transition_request,target_evidence_digest);
  end if;
  if operation_row.operation_kind='account_cleanup' then
    select exists (select 1 from public.stream_media_operation_uid_state uid_state
      where uid_state.operation_id=target_operation_id and uid_state.uid_state='retained_attached')
      into has_retained;
    for edge_item in select edge.*,binding.binding_state from public.stream_media_manifest_edges edge
      join public.stream_media_source_bindings binding on binding.id=edge.binding_id
      where edge.operation_id=target_operation_id
    loop
      update public.stream_media_source_bindings set binding_state=case
        when exists (select 1 from public.stream_media_operation_uid_state state
          where state.operation_id=target_operation_id and state.registry_id=edge_item.registry_id
            and state.raw_provider_uid=edge_item.raw_provider_uid
            and state.uid_state='retained_attached') then 'retained'
        else 'detached' end,state_revision=state_revision+1,updated_at=now()
      where id=edge_item.binding_id;
      event_request := (substr(md5(target_operation_id::text || edge_item.binding_id::text || ':account-finalize'),1,8) || '-'
        || substr(md5(target_operation_id::text || edge_item.binding_id::text || ':account-finalize'),9,4) || '-'
        || substr(md5(target_operation_id::text || edge_item.binding_id::text || ':account-finalize'),13,4) || '-'
        || substr(md5(target_operation_id::text || edge_item.binding_id::text || ':account-finalize'),17,4) || '-'
        || substr(md5(target_operation_id::text || edge_item.binding_id::text || ':account-finalize'),21,12))::uuid;
      insert into public.stream_media_source_binding_events(binding_id,event_kind,source_revision,request_id,evidence_digest)
        values (edge_item.binding_id,
          case when exists (select 1 from public.stream_media_operation_uid_state state
            where state.operation_id=target_operation_id and state.registry_id=edge_item.registry_id
              and state.raw_provider_uid=edge_item.raw_provider_uid and state.uid_state='retained_attached')
            then 'retained' else 'detached' end,
          edge_item.source_revision,event_request,target_evidence_digest)
        on conflict (binding_id,request_id) do nothing;
    end loop;
    select coalesce(string_agg(concat_ws('|',edge.edge_number::text,edge.binding_id::text,
      edge.source_kind,edge.source_identity,edge.source_revision::text,edge.registry_id::text,
      edge.raw_provider_uid),chr(10) order by edge.edge_number),'') into inventory
    from public.stream_media_manifest_edges edge where edge.operation_id=target_operation_id;
    digest := private.stream_media_identity_digest(concat_ws('|',operation_row.owner_id::text,
      target_operation_id::text,operation_row.operation_digest,inventory,
      (select string_agg(uid_state.registry_id::text||':'||uid_state.raw_provider_uid||':'||uid_state.uid_state,
        chr(10) order by uid_state.registry_id::text,uid_state.raw_provider_uid)
       from public.stream_media_operation_uid_state uid_state where uid_state.operation_id=target_operation_id)));
    completed_request := private.stream_media_request_uuid(
      target_operation_id::text||':'||target_request_id::text||':account-completed');
    perform private.stream_advance_operation(target_operation_id,
      case when has_retained then 'retained' else 'completed' end,
      completed_request,target_evidence_digest);
    update public.stream_media_parent_fences set fence_state='closed',active_operation_id=null,
      source_revision=source_revision+1,state_revision=state_revision+1,updated_at=now()
      where source_kind='account' and source_identity=operation_row.owner_id::text
        and active_operation_id=target_operation_id;
    update public.stream_media_account_tombstones set source_revision_digest=digest,
      revision=revision+1,state_revision=state_revision+1,tombstone_state='provider_cleanup',updated_at=now()
      where account_id=operation_row.owner_id;
    event_request := (substr(md5(target_operation_id::text || ':account-provider-cleanup-finalized'),1,8) || '-'
      || substr(md5(target_operation_id::text || ':account-provider-cleanup-finalized'),9,4) || '-'
      || substr(md5(target_operation_id::text || ':account-provider-cleanup-finalized'),13,4) || '-'
      || substr(md5(target_operation_id::text || ':account-provider-cleanup-finalized'),17,4) || '-'
      || substr(md5(target_operation_id::text || ':account-provider-cleanup-finalized'),21,12))::uuid;
    insert into public.stream_media_account_tombstone_events(
      tombstone_id,event_kind,request_id,source_revision_digest,evidence_digest
    ) select tombstone.id,'provider_cleanup',event_request,digest,target_evidence_digest
      from public.stream_media_account_tombstones tombstone where tombstone.account_id=operation_row.owner_id
      on conflict (tombstone_id,request_id) do nothing;
    final_response := jsonb_build_object('outcome','account_cleanup_complete','state',
      case when has_retained then 'retained' else 'completed' end,'source_revision_digest',digest);
    insert into public.stream_media_finalization_receipts(
      operation_id,request_id,request_digest,terminal_state,response
    ) values (target_operation_id,target_request_id,target_evidence_digest,
      case when has_retained then 'retained' else 'completed' end,final_response);
    return final_response;
  end if;
  if must_retain_parent then
    for edge_item in select edge.* from public.stream_media_manifest_edges edge
      where edge.operation_id=target_operation_id
    loop
      update public.stream_media_source_bindings set binding_state='retained',
        state_revision=state_revision+1,updated_at=now()
        where id=edge_item.binding_id;
    end loop;
    completed_request := private.stream_media_request_uuid(
      target_operation_id::text||':'||target_request_id::text||':retained');
    perform private.stream_advance_operation(target_operation_id,'retained',completed_request,target_evidence_digest);
    update public.stream_media_parent_fences set fence_state='open',active_operation_id=null,
      source_revision=source_revision+1,state_revision=state_revision+1,updated_at=now()
      where source_kind=operation_row.source_kind and source_identity=operation_row.source_identity
        and active_operation_id=target_operation_id;
    final_response := jsonb_build_object('outcome','retained','source_deleted',false);
    insert into public.stream_media_finalization_receipts(
      operation_id,request_id,request_digest,terminal_state,response
    ) values (target_operation_id,target_request_id,target_evidence_digest,'retained',final_response);
    return final_response;
  end if;
  if operation_row.source_kind='post' then
    select exists(select 1 from public.posts post where post.id::text=operation_row.source_identity
      and post.author_id=operation_row.owner_id) into source_exists;
  elsif operation_row.source_kind='daily_content_item' then
    select exists(select 1 from public.daily_content_items item where item.id::text=operation_row.source_identity
      and item.owner_id=operation_row.owner_id) into source_exists;
  elsif operation_row.source_kind='program' then
    select exists(select 1 from public.programs program where program.id::text=operation_row.source_identity
      and program.coach_id=operation_row.owner_id) into source_exists;
  elsif operation_row.source_kind='video' then
    select exists(select 1 from public.videos video where video.id::text=operation_row.source_identity
      and video.coach_id=operation_row.owner_id) into source_exists;
  else
    return jsonb_build_object('outcome','unsupported_source_kind');
  end if;
  if not source_exists then return jsonb_build_object('outcome','source_missing'); end if;
  perform set_config('app.stream_media_operation_id',target_operation_id::text,true);
  for edge_item in select edge.* from public.stream_media_manifest_edges edge
    where edge.operation_id=target_operation_id
  loop
    update public.stream_media_source_bindings set binding_state='detached',
      state_revision=state_revision+1,updated_at=now() where id=edge_item.binding_id;
    event_request := (substr(md5(target_operation_id::text || edge_item.binding_id::text || ':detached'),1,8) || '-'
      || substr(md5(target_operation_id::text || edge_item.binding_id::text || ':detached'),9,4) || '-'
      || substr(md5(target_operation_id::text || edge_item.binding_id::text || ':detached'),13,4) || '-'
      || substr(md5(target_operation_id::text || edge_item.binding_id::text || ':detached'),17,4) || '-'
      || substr(md5(target_operation_id::text || edge_item.binding_id::text || ':detached'),21,12))::uuid;
    insert into public.stream_media_source_binding_events(binding_id,event_kind,source_revision,request_id,evidence_digest)
      values (edge_item.binding_id,'detached',edge_item.source_revision,event_request,target_evidence_digest)
      on conflict (binding_id,request_id) do nothing;
  end loop;
  for uid_item in select state.registry_id,state.raw_provider_uid
    from public.stream_media_operation_uid_state state
    where state.operation_id=target_operation_id and state.uid_state='retained_attached'
  loop
    select coalesce(max(event.sequence_number),0)+1 into event_sequence
    from public.stream_media_operation_uid_events event where event.operation_id=target_operation_id
      and event.registry_id=uid_item.registry_id and event.raw_provider_uid=uid_item.raw_provider_uid;
    event_request := gen_random_uuid();
    insert into public.stream_media_operation_uid_events(
      operation_id,registry_id,raw_provider_uid,sequence_number,outcome,request_id,evidence_digest
    ) values (target_operation_id,uid_item.registry_id,uid_item.raw_provider_uid,event_sequence,
      'detached_retained',event_request,target_evidence_digest);
    update public.stream_media_operation_uid_state set uid_state='detached_retained',
      state_revision=state_revision+1,last_event_id=(select event.id from public.stream_media_operation_uid_events event
        where event.operation_id=target_operation_id and event.registry_id=uid_item.registry_id
          and event.raw_provider_uid=uid_item.raw_provider_uid and event.request_id=event_request),updated_at=now()
    where operation_id=target_operation_id and registry_id=uid_item.registry_id
      and raw_provider_uid=uid_item.raw_provider_uid;
  end loop;
  if operation_row.source_kind='post' then
    delete from public.posts where id::text=operation_row.source_identity and author_id=operation_row.owner_id;
  elsif operation_row.source_kind='daily_content_item' then
    delete from public.daily_content_items where id::text=operation_row.source_identity and owner_id=operation_row.owner_id;
  elsif operation_row.source_kind='program' then
    delete from public.programs where id::text=operation_row.source_identity and coach_id=operation_row.owner_id;
  elsif operation_row.source_kind='video' then
    delete from public.videos where id::text=operation_row.source_identity and coach_id=operation_row.owner_id;
  else
    return jsonb_build_object('outcome','unsupported_source_kind');
  end if;
  transition_request := private.stream_media_request_uuid(
    target_operation_id::text||':'||target_request_id::text||':completed');
  perform private.stream_advance_operation(target_operation_id,'completed',transition_request,target_evidence_digest);
  update public.stream_media_parent_fences set fence_state='closed',active_operation_id=null,
    source_revision=source_revision+1,state_revision=state_revision+1,updated_at=now()
    where source_kind=operation_row.source_kind and source_identity=operation_row.source_identity
      and active_operation_id=target_operation_id;
  final_response := jsonb_build_object('outcome','completed','source_deleted',true);
  insert into public.stream_media_finalization_receipts(
    operation_id,request_id,request_digest,terminal_state,response
  ) values (target_operation_id,target_request_id,target_evidence_digest,'completed',final_response);
  return final_response;
exception
  when foreign_key_violation then return jsonb_build_object('outcome','source_has_other_references');
  when lock_not_available then return jsonb_build_object('outcome','source_busy');
end;
$$;
revoke all on function public.finalize_stream_media_cleanup(uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_stream_media_cleanup(uuid,uuid,text) to service_role;

create function public.reserve_stream_media_cleanup(
  target_operation_id uuid, target_request_id uuid, target_parent_kind text,
  target_parent_identity text, target_owner_id uuid, target_expected_revision bigint,
  target_operation_digest text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  fence public.stream_media_parent_fences%rowtype;
  existing public.stream_media_operations%rowtype;
  source_owner uuid;
  registry_ids uuid[];
  raw_uids text[];
  has_unresolved boolean;
  manifest_count integer;
  uid_count integer;
  uid_item record;
begin
  if auth.role() is distinct from 'service_role' and auth.role() is distinct from 'authenticated' then
    raise exception 'Media cleanup requires an owner session or service role' using errcode = '42501';
  end if;
  if target_operation_id is null or target_request_id is null
    or target_parent_kind not in ('video','post','program','daily_content_item','profile')
    or target_parent_identity is null or char_length(target_parent_identity) not between 1 and 200
    or target_owner_id is null or target_expected_revision is null or target_expected_revision < 1
    or target_operation_digest is null or target_operation_digest !~ '^[0-9a-f]{64}$'
  then raise exception 'Media cleanup identity is invalid' using errcode = '22023'; end if;
  perform private.stream_require_read_committed();
  perform private.stream_lock_accounts(array[target_owner_id]);
  if target_parent_kind = 'program' then perform private.lock_program_mutation(target_parent_identity::uuid); end if;
  perform pg_advisory_xact_lock(hashtextextended(target_parent_kind || ':' || target_parent_identity,19031002));
  select * into existing from public.stream_media_operations operation
  where operation.id = target_operation_id or operation.request_id = target_request_id for update;
  if found then
    if existing.id <> target_operation_id or existing.request_id <> target_request_id
      or existing.operation_kind <> 'cleanup' or existing.source_kind <> target_parent_kind
      or existing.source_identity <> target_parent_identity or existing.owner_id <> target_owner_id
      or existing.expected_source_revision <> target_expected_revision
      or existing.operation_digest <> target_operation_digest
    then return jsonb_build_object('outcome','identity_mismatch'); end if;
    return jsonb_build_object('outcome','same_operation','operation_id',existing.id);
  end if;
  if target_parent_kind = 'video' then
    select video.coach_id into source_owner from public.videos video where video.id::text = target_parent_identity;
  elsif target_parent_kind = 'post' then
    select post.author_id into source_owner from public.posts post where post.id::text = target_parent_identity;
  elsif target_parent_kind = 'program' then
    select program.coach_id into source_owner from public.programs program where program.id::text = target_parent_identity;
  elsif target_parent_kind = 'daily_content_item' then
    select item.owner_id into source_owner from public.daily_content_items item where item.id::text = target_parent_identity;
  else
    select profile.id into source_owner from public.profiles profile where profile.id::text = target_parent_identity;
  end if;
  if source_owner is null then return jsonb_build_object('outcome','parent_missing'); end if;
  if auth.role()='authenticated' and not (
    target_parent_kind='video' and (
      (target_owner_id=auth.uid() and (select private.has_role(auth.uid(),'coach')))
      or (select private.is_admin())
    )
  ) then raise exception 'Only a video owner or admin may reserve this cleanup' using errcode = '42501'; end if;
  if source_owner <> target_owner_id or private.stream_account_is_tombstoned(target_owner_id) then
    return jsonb_build_object('outcome','owner_mismatch_or_deleting'); end if;
  select * into fence from public.stream_media_parent_fences item
  where item.source_kind = target_parent_kind and item.source_identity = target_parent_identity for update;
  if not found then
    insert into public.stream_media_parent_fences (source_kind,source_identity,owner_id,source_revision)
    values (target_parent_kind,target_parent_identity,target_owner_id,1)
    on conflict (source_kind,source_identity) do nothing;
    select * into fence from public.stream_media_parent_fences item
    where item.source_kind = target_parent_kind and item.source_identity = target_parent_identity for update;
  end if;
  if fence.owner_id is distinct from target_owner_id or fence.source_revision <> target_expected_revision
    or fence.fence_state <> 'open'
  then return jsonb_build_object('outcome','source_stale_or_busy'); end if;
  select exists (
    select 1 from public.stream_media_source_bindings binding
    where ((binding.parent_kind = target_parent_kind and binding.parent_identity = target_parent_identity)
       or (binding.source_kind = target_parent_kind and binding.source_identity = target_parent_identity))
      and binding.owner_id = target_owner_id
      and binding.binding_state in ('legacy_unverified','provisional_bound','ready_for_publication','quarantined')
      and binding.registry_id is null
  ) into has_unresolved;
  if has_unresolved then return jsonb_build_object('outcome','unresolved_legacy_identity'); end if;
  select array_agg(tuple.registry_id order by tuple.registry_id::text,tuple.raw_uid),
         array_agg(tuple.raw_uid order by tuple.registry_id::text,tuple.raw_uid)
    into registry_ids,raw_uids
  from (select distinct binding.registry_id,binding.raw_provider_uid as raw_uid
    from public.stream_media_source_bindings binding
    where ((binding.parent_kind = target_parent_kind and binding.parent_identity = target_parent_identity)
       or (binding.source_kind = target_parent_kind and binding.source_identity = target_parent_identity))
      and binding.owner_id = target_owner_id
      and binding.registry_id is not null
      and binding.binding_state <> 'detached') tuple;
  if coalesce(cardinality(raw_uids),0) = 0 then
    return jsonb_build_object('outcome','no_bound_media');
  end if;
  if exists (
    select 1 from unnest(registry_ids,raw_uids) selected(registry_id,raw_uid)
    where not private.stream_account_is_verified(selected.registry_id)
      or private.stream_legacy_uid_unresolved(selected.registry_id,selected.raw_uid)
  ) then return jsonb_build_object('outcome','account_unverified_or_legacy_candidate'); end if;
  perform private.stream_try_uid_locks(registry_ids,raw_uids);
  insert into public.stream_media_operations (
    id,request_id,operation_kind,actor_id,owner_id,source_kind,source_identity,
    parent_kind,parent_identity,expected_source_revision,operation_digest
  ) values (
    target_operation_id,target_request_id,'cleanup',null,target_owner_id,
    target_parent_kind,target_parent_identity,target_parent_kind,target_parent_identity,
    target_expected_revision,target_operation_digest
  );
  insert into public.stream_media_operation_states (operation_id,operation_state)
  values (target_operation_id,'cleanup_reserved');
  insert into public.stream_media_operation_events (
    operation_id,sequence_number,from_state,to_state,request_id,evidence_digest
  ) values (target_operation_id,1,null,'cleanup_reserved',target_request_id,target_operation_digest);
  update public.stream_media_parent_fences set fence_state='closing',active_operation_id=target_operation_id,
    state_revision=state_revision+1,updated_at=now()
  where source_kind=target_parent_kind and source_identity=target_parent_identity;
  -- The UID-state rows are the referenced parent of every manifest edge. Create the
  -- complete de-duplicated UID set first so the immediate FK is satisfied atomically.
  insert into public.stream_media_operation_uid_state (
    operation_id,registry_id,raw_provider_uid,uid_state
  )
  select target_operation_id,selected.registry_id,selected.raw_uid,'reserved'
  from (
    select distinct binding.registry_id,binding.raw_provider_uid as raw_uid
    from public.stream_media_source_bindings binding
    where ((binding.parent_kind=target_parent_kind and binding.parent_identity=target_parent_identity)
        or (binding.source_kind=target_parent_kind and binding.source_identity=target_parent_identity))
      and binding.owner_id=target_owner_id and binding.registry_id is not null
      and binding.binding_state <> 'detached'
  ) selected;
  insert into public.stream_media_manifest_edges (
    operation_id,edge_number,binding_id,source_kind,source_identity,source_revision,
    registry_id,raw_provider_uid,detach_allowed
  )
  select target_operation_id,row_number() over (order by binding.source_kind,binding.source_identity,binding.id)::integer,
    binding.id,binding.source_kind,binding.source_identity,binding.source_revision,
    binding.registry_id,binding.raw_provider_uid,exists (
      select 1 from public.stream_media_source_bindings other_binding
      where other_binding.registry_id=binding.registry_id
        and other_binding.raw_provider_uid=binding.raw_provider_uid
        and other_binding.binding_state in ('ready_for_publication','active','retained')
        and not ((other_binding.parent_kind=target_parent_kind
          and other_binding.parent_identity=target_parent_identity)
          or (other_binding.source_kind=target_parent_kind
            and other_binding.source_identity=target_parent_identity))
    )
  from public.stream_media_source_bindings binding
  where ((binding.parent_kind=target_parent_kind and binding.parent_identity=target_parent_identity)
      or (binding.source_kind=target_parent_kind and binding.source_identity=target_parent_identity))
    and binding.owner_id=target_owner_id and binding.registry_id is not null
    and binding.binding_state <> 'detached';
  for uid_item in select uid_state.registry_id,uid_state.raw_provider_uid
    from public.stream_media_operation_uid_state uid_state
    where uid_state.operation_id=target_operation_id
  loop
    if private.stream_media_has_effective_reference(uid_item.registry_id,uid_item.raw_provider_uid,target_operation_id) then
      update public.stream_media_operation_uid_state set uid_state='retained_attached',state_revision=state_revision+1,
        updated_at=now() where operation_id=target_operation_id and registry_id=uid_item.registry_id
          and raw_provider_uid=uid_item.raw_provider_uid;
      insert into public.stream_media_operation_uid_events (
        operation_id,registry_id,raw_provider_uid,sequence_number,outcome,request_id,evidence_digest
      ) values (target_operation_id,uid_item.registry_id,uid_item.raw_provider_uid,1,'retained_attached',
        gen_random_uuid(),target_operation_digest);
    end if;
  end loop;
  select count(*)::integer into manifest_count from public.stream_media_manifest_edges edge
    where edge.operation_id=target_operation_id;
  select count(*)::integer into uid_count from public.stream_media_operation_uid_state uid_state
    where uid_state.operation_id=target_operation_id;
  return jsonb_build_object('outcome','reserved','operation_id',target_operation_id,
    'manifest_edges',manifest_count,'uid_count',uid_count);
exception
  when unique_violation then return jsonb_build_object('outcome','identity_mismatch');
  when lock_not_available then return jsonb_build_object('outcome','source_busy');
  when invalid_text_representation then return jsonb_build_object('outcome','identity_mismatch');
end;
$$;
revoke all on function public.reserve_stream_media_cleanup(uuid,uuid,text,text,uuid,bigint,text)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_stream_media_cleanup(uuid,uuid,text,text,uuid,bigint,text)
  to service_role;
grant execute on function public.reserve_stream_media_cleanup(uuid,uuid,text,text,uuid,bigint,text)
  to authenticated;

create or replace function public.reserve_daily_content_video_delete(target_video_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  caller_role text;
  video_row public.videos%rowtype;
  fence public.stream_media_parent_fences%rowtype;
  active_operation_id uuid;
  active_state text;
  request_id uuid;
  v_operation_id uuid;
  operation_digest text;
  reservation jsonb;
begin
  select profile.role::text into caller_role from public.profiles profile
    where profile.id=caller for share;
  if caller is null or caller_role is null or caller_role not in ('coach','admin') then
    raise exception 'Staff access required' using errcode = '42501'; end if;
  if target_video_id is null then raise exception 'Video identity is required' using errcode = '22023'; end if;
  perform private.stream_require_read_committed();
  select video.* into video_row from public.videos video where video.id=target_video_id;
  if not found then raise exception 'Video was not found' using errcode = 'P0002'; end if;
  if caller_role<>'admin' and video_row.coach_id is distinct from caller then
    raise exception 'Only the video owner or an admin can delete it' using errcode = '42501'; end if;
  if video_row.stream_provider_account_registry_id is null then
    raise exception 'Video account identity requires reconciliation before deletion' using errcode = '55000'; end if;
  if not private.stream_try_parent_lock('video',target_video_id::text)
    or not private.stream_try_uid_lock(video_row.stream_provider_account_registry_id,video_row.cloudflare_uid) then
    raise exception 'Video media is busy; retry the deletion request' using errcode = '55P03'; end if;
  insert into public.stream_media_parent_fences(source_kind,source_identity,owner_id,source_revision)
    values ('video',target_video_id::text,video_row.coach_id,1)
    on conflict (source_kind,source_identity) do nothing;
  select * into fence from public.stream_media_parent_fences item
    where item.source_kind='video' and item.source_identity=target_video_id::text for update;
  if fence.owner_id is distinct from video_row.coach_id then
    raise exception 'Video media owner changed' using errcode = '42501'; end if;
  select operation.id,state.operation_state into active_operation_id,active_state
  from public.stream_media_operations operation
  join public.stream_media_operation_states state on state.operation_id=operation.id
  where operation.operation_kind='cleanup' and operation.source_kind='video'
    and operation.source_identity=target_video_id::text and operation.owner_id=video_row.coach_id
  order by operation.created_at desc limit 1;
  if active_state in ('cleanup_reserved','delete_started','delete_unknown','source_finalizing') then
    if fence.active_operation_id is distinct from active_operation_id or fence.fence_state<>'closing' then
      raise exception 'Video cleanup reservation changed' using errcode = '55P03'; end if;
    if exists (select 1 from public.stream_media_operation_uid_state uid_state
        where uid_state.operation_id=active_operation_id and uid_state.uid_state='retained_attached') then
      raise exception 'Video is retained by another source or durable obligation' using errcode = '23503'; end if;
    perform set_config('app.stream_media_operation_id',active_operation_id::text,true);
    update public.videos set daily_content_deletion_pending=true
      where id=target_video_id and not daily_content_deletion_pending;
    return true;
  end if;
  if active_state in ('completed','retained') then
    if active_state='completed' or private.stream_media_has_effective_reference(
      video_row.stream_provider_account_registry_id,video_row.cloudflare_uid,active_operation_id) then
      return true;
    end if;
  end if;
  if fence.fence_state<>'open' or fence.active_operation_id is not null then
    raise exception 'Video media is already reserved' using errcode = '55P03'; end if;
  select video.* into video_row from public.videos video where video.id=target_video_id for update;
  if not found or video_row.coach_id is distinct from caller and caller_role<>'admin'
    or video_row.stream_provider_account_registry_id is null then
    raise exception 'Video ownership or account identity changed' using errcode = '42501'; end if;
  if exists (
    select 1 from public.daily_content_revisions revision
    join public.daily_content_items item on item.id=revision.item_id
    where revision.video_id=target_video_id and item.status<>'archived'
  ) or exists (
    select 1 from public.daily_content_slots slot
    join public.daily_content_revisions revision on revision.id=slot.revision_id
    where revision.video_id=target_video_id and slot.day >= (select private.current_daily_checkin_day())
      and slot.status in ('scheduled','published')
  ) or exists (
    select 1 from public.member_daily_content_video_grants grant_row where grant_row.video_id=target_video_id
  ) or exists (
    select 1 from public.member_daily_fuel_bookmarks bookmark where bookmark.video_id=target_video_id
  ) then
    raise exception 'Video is used by Daily Content or is still saved by a member' using errcode = '23503'; end if;
  if exists (select 1 from public.member_daily_fuel_assignments assignment
      where assignment.video_id=target_video_id
        and assignment.day >= (select private.current_daily_checkin_day())) then
    raise exception 'Video is assigned in Daily Fuel' using errcode = '23503'; end if;
  if exists (select 1 from public.tasks task where task.video_id=target_video_id) then
    raise exception 'Video is still used by a Task' using errcode = '23503'; end if;
  request_id := gen_random_uuid();
  v_operation_id := gen_random_uuid();
  operation_digest := private.stream_media_identity_digest(concat_ws('|','daily-content-video-delete',
    target_video_id::text,video_row.coach_id::text,fence.source_revision::text,
    video_row.stream_provider_account_registry_id::text,video_row.cloudflare_uid));
  reservation := public.reserve_stream_media_cleanup(v_operation_id,request_id,'video',
    target_video_id::text,video_row.coach_id,fence.source_revision,operation_digest);
  if reservation->>'outcome' not in ('reserved','same_operation') then
    raise exception 'Video cleanup could not be reserved: %',coalesce(reservation->>'outcome','unknown') using errcode = '55P03'; end if;
  if exists (select 1 from public.stream_media_operation_uid_state uid_state
      where uid_state.operation_id=v_operation_id and uid_state.uid_state='retained_attached') then
    raise exception 'Video is retained by another source or durable obligation' using errcode = '23503'; end if;
  perform set_config('app.stream_media_operation_id',v_operation_id::text,true);
  update public.videos set daily_content_deletion_pending=true
    where id=target_video_id and not daily_content_deletion_pending;
  return true;
end;
$$;
revoke all on function public.reserve_daily_content_video_delete(uuid) from public, anon, authenticated;
grant execute on function public.reserve_daily_content_video_delete(uuid) to authenticated;

create function public.start_stream_media_uid_delete(
  target_operation_id uuid, target_registry_id uuid, target_uid text,
  target_request_id uuid, target_evidence_digest text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  operation_row public.stream_media_operations%rowtype;
  operation_state text;
  uid_state public.stream_media_operation_uid_state%rowtype;
  prior public.stream_media_operation_uid_events%rowtype;
  event_id uuid;
  sequence_no bigint;
  transition_request uuid;
  transition_digest text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Provider deletion is service managed' using errcode = '42501';
  end if;
  if target_operation_id is null or target_registry_id is null or target_uid is null
    or target_request_id is null or target_evidence_digest is null
    or target_evidence_digest !~ '^[0-9a-f]{64}$'
  then raise exception 'Provider deletion request is invalid' using errcode = '22023'; end if;
  perform private.stream_require_read_committed();
  select * into operation_row from public.stream_media_operations operation
    where operation.id=target_operation_id and operation.operation_kind in ('cleanup','account_cleanup') for update;
  if not found then return jsonb_build_object('outcome','operation_missing'); end if;
  select state.operation_state into operation_state from public.stream_media_operation_states state
    where state.operation_id=target_operation_id for update;
  if operation_state not in ('cleanup_reserved','delete_started','delete_unknown') then
    return jsonb_build_object('outcome','operation_not_deleting'); end if;
  if not private.stream_account_is_verified(target_registry_id) then
    return jsonb_build_object('outcome','account_unverified'); end if;
  select * into uid_state from public.stream_media_operation_uid_state state
    where state.operation_id=target_operation_id and state.registry_id=target_registry_id
      and state.raw_provider_uid=target_uid for update;
  if not found then return jsonb_build_object('outcome','uid_not_in_manifest'); end if;
  if uid_state.uid_state='retained_attached' then return jsonb_build_object('outcome','retained_attached'); end if;
  if uid_state.uid_state in ('deleted_confirmed','already_absent_confirmed','detached_retained') then
    return jsonb_build_object('outcome','already_terminal'); end if;
  if private.stream_media_has_effective_reference(target_registry_id,target_uid,target_operation_id) then
    return jsonb_build_object('outcome','retention_or_reference_changed'); end if;
  if exists (select 1 from public.stream_media_operation_uid_events event
    where event.operation_id=target_operation_id and event.registry_id=target_registry_id
      and event.raw_provider_uid=target_uid and event.request_id=target_request_id)
  then
    select * into prior from public.stream_media_operation_uid_events event
      where event.operation_id=target_operation_id and event.registry_id=target_registry_id
        and event.raw_provider_uid=target_uid and event.request_id=target_request_id;
    if prior.outcome='delete_started' and prior.evidence_digest=target_evidence_digest
    then return jsonb_build_object('outcome','already_started'); end if;
    return jsonb_build_object('outcome','identity_mismatch');
  end if;
  if uid_state.uid_state not in ('reserved','delete_unknown','delete_started') then
    return jsonb_build_object('outcome','state_conflict'); end if;
  select coalesce(max(event.sequence_number),0)+1 into sequence_no
    from public.stream_media_operation_uid_events event
    where event.operation_id=target_operation_id and event.registry_id=target_registry_id
      and event.raw_provider_uid=target_uid;
  insert into public.stream_media_operation_uid_events (
    operation_id,registry_id,raw_provider_uid,sequence_number,outcome,request_id,evidence_digest
  ) values (target_operation_id,target_registry_id,target_uid,sequence_no,'delete_started',
    target_request_id,target_evidence_digest) returning id into event_id;
  update public.stream_media_operation_uid_state set uid_state='delete_started',
    state_revision=state_revision+1,last_event_id=event_id,updated_at=now()
    where operation_id=target_operation_id and registry_id=target_registry_id and raw_provider_uid=target_uid;
  if operation_state in ('cleanup_reserved','delete_unknown') then
    transition_request := (substr(md5(target_operation_id::text || ':delete-started'),1,8) || '-'
      || substr(md5(target_operation_id::text || ':delete-started'),9,4) || '-'
      || substr(md5(target_operation_id::text || ':delete-started'),13,4) || '-'
      || substr(md5(target_operation_id::text || ':delete-started'),17,4) || '-'
      || substr(md5(target_operation_id::text || ':delete-started'),21,12))::uuid;
    transition_digest := private.stream_media_identity_digest(target_operation_id::text || ':delete-started');
    if not exists (select 1 from public.stream_media_operation_events event
      where event.operation_id=target_operation_id and event.request_id=transition_request) then
      perform private.stream_advance_operation(target_operation_id,'delete_started',transition_request,transition_digest);
    end if;
  end if;
  return jsonb_build_object('outcome','delete_started','event_id',event_id);
exception when unique_violation then return jsonb_build_object('outcome','identity_mismatch');
end;
$$;
revoke all on function public.start_stream_media_uid_delete(uuid,uuid,text,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.start_stream_media_uid_delete(uuid,uuid,text,uuid,text) to service_role;

create function public.record_stream_media_uid_delete_result(
  target_operation_id uuid, target_registry_id uuid, target_uid text,
  target_outcome text, target_delete_http_status smallint, target_exact_get_http_status smallint,
  target_request_id uuid, target_evidence_digest text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  operation_row public.stream_media_operations%rowtype;
  operation_state text;
  state_row public.stream_media_operation_uid_state%rowtype;
  prior public.stream_media_operation_uid_events%rowtype;
  next_sequence bigint;
  event_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Provider deletion outcomes are service managed' using errcode = '42501';
  end if;
  if target_operation_id is null or target_registry_id is null or target_uid is null
    or target_outcome is null
    or target_outcome not in ('deleted_confirmed','already_absent_confirmed','delete_unknown')
    or target_request_id is null or target_evidence_digest is null or target_evidence_digest !~ '^[0-9a-f]{64}$'
    or (target_delete_http_status is not null and target_delete_http_status not between 100 and 599)
    or (target_exact_get_http_status is not null and target_exact_get_http_status not between 100 and 599)
  then raise exception 'Provider deletion observation is invalid' using errcode = '22023'; end if;
  select * into operation_row from public.stream_media_operations operation
  where operation.id=target_operation_id and operation.operation_kind in ('cleanup','account_cleanup') for update;
  if not found then return jsonb_build_object('outcome','operation_missing'); end if;
  select state.operation_state into operation_state from public.stream_media_operation_states state
    where state.operation_id=target_operation_id for update;
  if operation_state not in ('delete_started','delete_unknown') then
    return jsonb_build_object('outcome','operation_not_deleting'); end if;
  if not private.stream_account_is_verified(target_registry_id) then
    return jsonb_build_object('outcome','account_unverified'); end if;
  select * into state_row from public.stream_media_operation_uid_state uid_state
  where uid_state.operation_id=target_operation_id and uid_state.registry_id=target_registry_id
    and uid_state.raw_provider_uid=target_uid for update;
  if not found then return jsonb_build_object('outcome','uid_not_in_manifest'); end if;
  if state_row.uid_state = 'retained_attached' then
    return jsonb_build_object('outcome','retained_attached'); end if;
  select * into prior from public.stream_media_operation_uid_events event
  where event.operation_id=target_operation_id and event.registry_id=target_registry_id
    and event.raw_provider_uid=target_uid and event.request_id=target_request_id;
  if found then
    if prior.outcome=target_outcome and prior.evidence_digest=target_evidence_digest
      and prior.delete_http_status is not distinct from target_delete_http_status
      and prior.http_status is not distinct from target_exact_get_http_status
    then return jsonb_build_object('outcome','already_recorded','uid_state',state_row.uid_state); end if;
    return jsonb_build_object('outcome','identity_mismatch');
  end if;
  if state_row.uid_state in ('deleted_confirmed','already_absent_confirmed','detached_retained') then
    return jsonb_build_object('outcome','identity_mismatch');
  end if;
  if target_outcome='deleted_confirmed' and (
      target_delete_http_status between 200 and 299 and target_exact_get_http_status=404
  ) is not true then return jsonb_build_object('outcome','absence_not_confirmed'); end if;
  if target_outcome='already_absent_confirmed' and (
      target_delete_http_status is null and target_exact_get_http_status=404
  ) is not true then return jsonb_build_object('outcome','absence_not_confirmed'); end if;
  if target_outcome='delete_unknown' and target_exact_get_http_status=404 then
    return jsonb_build_object('outcome','use_exact_absence_outcome'); end if;
  if state_row.uid_state <> 'delete_started' then
    return jsonb_build_object('outcome','delete_start_required'); end if;
  if private.stream_media_has_effective_reference(target_registry_id,target_uid,target_operation_id)
    and target_outcome in ('deleted_confirmed','already_absent_confirmed')
  then return jsonb_build_object('outcome','retention_or_reference_changed'); end if;
  select coalesce(max(event.sequence_number),0)+1 into next_sequence
  from public.stream_media_operation_uid_events event
  where event.operation_id=target_operation_id and event.registry_id=target_registry_id
    and event.raw_provider_uid=target_uid;
  insert into public.stream_media_operation_uid_events (
    operation_id,registry_id,raw_provider_uid,sequence_number,outcome,request_id,
    delete_http_status,http_status,evidence_digest
  ) values (
    target_operation_id,target_registry_id,target_uid,next_sequence,target_outcome,
    target_request_id,target_delete_http_status,target_exact_get_http_status,target_evidence_digest
  ) returning id into event_id;
  update public.stream_media_operation_uid_state set
    uid_state=target_outcome,state_revision=state_revision+1,last_event_id=event_id,updated_at=now()
  where operation_id=target_operation_id and registry_id=target_registry_id and raw_provider_uid=target_uid;
  if target_outcome='delete_unknown' and operation_state='delete_started' then
    perform private.stream_advance_operation(target_operation_id,'delete_unknown',
      target_request_id,target_evidence_digest);
  end if;
  return jsonb_build_object('outcome','recorded','uid_state',target_outcome,'event_id',event_id);
exception when unique_violation then return jsonb_build_object('outcome','identity_mismatch');
end;
$$;
revoke all on function public.record_stream_media_uid_delete_result(uuid,uuid,text,text,smallint,smallint,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_stream_media_uid_delete_result(uuid,uuid,text,text,smallint,smallint,uuid,text)
  to service_role;

-- A completed upload is drained only after its exact source binding was detached by a
-- finalized cleanup manifest and the manifest has durable terminal provider evidence.
-- In particular, a detached binding row by itself is never proof of provider absence.
create function private.stream_upload_cleanup_proven(
  target_intent_id uuid,target_account_id uuid
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.stream_media_operations upload
    join public.stream_media_operation_states upload_state
      on upload_state.operation_id=upload.id and upload_state.operation_state='completed'
    join public.stream_media_upload_intents intent on intent.id=upload.intent_id
    join public.stream_media_upload_contexts context on context.intent_id=intent.id
    join public.stream_media_finalization_receipts upload_receipt
      on upload_receipt.operation_id=upload.id and upload_receipt.terminal_state='completed'
        and upload_receipt.response->>'outcome'='ready_for_publication'
    join public.stream_media_assets asset on asset.upload_intent_id=intent.id
      and asset.registry_id=upload.registry_id and asset.owner_id=target_account_id
    join public.stream_media_upload_observations observation
      on observation.operation_id=upload.id and observation.registry_id=upload.registry_id
        and observation.raw_provider_uid=asset.raw_provider_uid
        and observation.observation_kind='exact_uid_get' and observation.http_status=200
        and observation.signed_urls_reported is true
        and observation.creator_marker_matched is true
        and observation.metadata_marker_matched is true
        and observation.ready_to_stream_reported is true
    join public.stream_media_source_bindings binding on binding.asset_id=asset.id
      and binding.registry_id=asset.registry_id and binding.raw_provider_uid=asset.raw_provider_uid
      and binding.source_kind=upload.source_kind and binding.source_identity=upload.source_identity
      and binding.parent_kind=context.parent_kind and binding.parent_identity=context.parent_identity
      and binding.source_revision=context.source_revision+1 and binding.owner_id=target_account_id
      and binding.binding_state='detached'
    where upload.id is not null and upload.operation_kind='upload'
      and upload.intent_id=target_intent_id and upload.source_kind in ('video','post_media')
      and upload.actor_id=target_account_id and upload.owner_id=target_account_id
      and upload.source_kind=intent.source_kind and upload.source_identity=intent.source_id::text
      and intent.actor_id=target_account_id and intent.provider_account_registry_id=upload.registry_id
      and context.owner_id=target_account_id and context.source_revision=upload.expected_source_revision
      and exists (select 1 from public.stream_media_source_account_edges owner_edge
        where owner_edge.binding_id=binding.id and owner_edge.account_id=target_account_id
          and owner_edge.relation_kind='source_owner')
      and exists (select 1 from public.stream_media_source_account_edges asset_edge
        where asset_edge.binding_id=binding.id and asset_edge.account_id=target_account_id
          and asset_edge.relation_kind='asset_owner')
      and exists (
        select 1
        from public.stream_media_operations cleanup
        join public.stream_media_operation_states cleanup_state
          on cleanup_state.operation_id=cleanup.id
            and cleanup_state.operation_state in ('completed','retained')
        join public.stream_media_finalization_receipts receipt
          on receipt.operation_id=cleanup.id
            and receipt.terminal_state=cleanup_state.operation_state
            and receipt.response->>'outcome' in ('completed','retained','account_cleanup_complete')
            and (receipt.response->>'outcome'<>'account_cleanup_complete'
              or receipt.response->>'state'=receipt.terminal_state)
        join public.stream_media_manifest_edges manifest
          on manifest.operation_id=cleanup.id and manifest.binding_id=binding.id
            and manifest.source_kind=binding.source_kind
            and manifest.source_identity=binding.source_identity
            and manifest.source_revision=binding.source_revision
            and manifest.registry_id=binding.registry_id
            and manifest.raw_provider_uid=binding.raw_provider_uid
        join public.stream_media_operation_uid_state uid_state
          on uid_state.operation_id=cleanup.id and uid_state.registry_id=manifest.registry_id
            and uid_state.raw_provider_uid=manifest.raw_provider_uid
        join public.stream_media_operation_uid_events uid_result
          on uid_result.id=uid_state.last_event_id and uid_result.operation_id=cleanup.id
            and uid_result.registry_id=manifest.registry_id
            and uid_result.raw_provider_uid=manifest.raw_provider_uid
            and uid_result.outcome=uid_state.uid_state
        where cleanup.operation_kind in ('cleanup','account_cleanup')
          and cleanup.owner_id=target_account_id
          and (
            (uid_state.uid_state='deleted_confirmed'
              and uid_result.delete_http_status between 200 and 299
              and uid_result.http_status=404)
            or (uid_state.uid_state='already_absent_confirmed'
              and uid_result.delete_http_status is null and uid_result.http_status=404)
            or (uid_state.uid_state='detached_retained' and manifest.detach_allowed
              and uid_result.delete_http_status is null and uid_result.http_status is null
              and exists (select 1 from public.stream_media_operation_uid_events prior_retained
                where prior_retained.operation_id=cleanup.id
                  and prior_retained.registry_id=manifest.registry_id
                  and prior_retained.raw_provider_uid=manifest.raw_provider_uid
                  and prior_retained.outcome='retained_attached'
                  and prior_retained.sequence_number<uid_result.sequence_number))
          )
          and exists (select 1 from public.stream_media_source_binding_events detached
            where detached.binding_id=binding.id and detached.event_kind='detached'
              and detached.source_revision=manifest.source_revision
              and detached.evidence_digest=receipt.request_digest
              and detached.request_id=private.stream_media_request_uuid(
                cleanup.id::text||binding.id::text||case
                  when cleanup.operation_kind='account_cleanup' then ':account-finalize'
                  else ':detached' end))
      )
  );
$$;
revoke all on function private.stream_upload_cleanup_proven(uuid,uuid)
  from public, anon, authenticated, service_role;

-- A provider object can enter account cleanup after exact readback even if the process
-- crashed before inserting its mutable source. This proof is per binding and actor=owner only.
create function private.stream_provisional_upload_account_cleanup_eligible(
  target_binding_id uuid,target_account_id uuid
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.stream_media_source_bindings binding
    join public.stream_media_assets asset on asset.id=binding.asset_id
      and asset.registry_id=binding.registry_id and asset.raw_provider_uid=binding.raw_provider_uid
      and asset.lifecycle_state='provisional_bound'
      and asset.signed_urls_verified is true and asset.ready_to_stream_verified is true
    join public.stream_media_upload_intents intent on intent.id=asset.upload_intent_id
      and intent.source_guard_state='pending_source_guard'
    join public.stream_media_upload_contexts context on context.intent_id=intent.id
    join public.stream_media_operations upload on upload.intent_id=intent.id
      and upload.operation_kind='upload' and upload.source_kind=intent.source_kind
      and upload.source_identity=intent.source_id::text
      and upload.registry_id=intent.provider_account_registry_id
      and upload.actor_id=target_account_id and upload.owner_id=target_account_id
      and upload.parent_kind=context.parent_kind and upload.parent_identity=context.parent_identity
      and upload.expected_source_revision=context.source_revision
    join public.stream_media_operation_states upload_state on upload_state.operation_id=upload.id
      and upload_state.operation_state='provisional_bound'
    join public.stream_media_upload_observations observation on observation.operation_id=upload.id
      and observation.registry_id=upload.registry_id
      and observation.raw_provider_uid=binding.raw_provider_uid
      and observation.observation_kind='exact_uid_get' and observation.http_status=200
      and observation.signed_urls_reported is true
      and observation.creator_marker_matched is true
      and observation.metadata_marker_matched is true
      and observation.ready_to_stream_reported is true
      and observation.evidence_digest=asset.evidence_digest
      and observation.evidence_digest=binding.evidence_digest
    join public.stream_media_parent_fences parent_fence
      on parent_fence.source_kind=context.parent_kind
      and parent_fence.source_identity=context.parent_identity
      and parent_fence.owner_id=target_account_id
      and parent_fence.source_revision=context.source_revision
      and parent_fence.fence_state='closing'
      and parent_fence.active_operation_id=upload.id
    where binding.id=target_binding_id
      and binding.binding_state='provisional_bound'
      and binding.owner_id=target_account_id
      and binding.source_kind=upload.source_kind
      and binding.source_identity=upload.source_identity
      and binding.parent_kind=context.parent_kind
      and binding.parent_identity=context.parent_identity
      and binding.source_revision=context.source_revision
      and binding.observed_creator='matched_at_exact_readback'
      and binding.observed_marker='matched_at_exact_readback'
      and asset.owner_id=target_account_id and asset.upload_intent_id=intent.id
      and asset.creator_observation='matched_at_exact_readback'
      and asset.marker_observation='matched_at_exact_readback'
      and intent.actor_id=target_account_id
      and intent.provider_account_registry_id=upload.registry_id
      and intent.source_kind in ('video','post_media')
      and intent.purpose=case when intent.source_kind='video' then 'library_video' else 'community_video' end
      and context.owner_id=target_account_id
      and ((intent.source_kind='video' and context.parent_kind='profile'
          and context.parent_identity=target_account_id::text
          and exists (select 1 from public.profiles profile where profile.id=target_account_id)
          and (not exists (select 1 from public.videos video where video.id=intent.source_id)
            or exists (select 1 from public.videos video where video.id=intent.source_id
              and video.coach_id=target_account_id and video.cloudflare_uid=binding.raw_provider_uid
              and video.stream_provider_account_registry_id=binding.registry_id
              and video.status::text='uploading')))
        or (intent.source_kind='post_media' and context.parent_kind='post'
          and exists (select 1 from public.posts post
            where post.id::text=context.parent_identity and post.author_id=target_account_id
              and post.removed_at is null)
          and (not exists (select 1 from public.post_media media where media.id=intent.source_id)
            or exists (select 1 from public.post_media media join public.posts post
                on post.id=media.post_id
              where media.id=intent.source_id and media.kind='video'
                and media.video_uid=binding.raw_provider_uid
                and post.id::text=context.parent_identity and post.author_id=target_account_id
                and post.removed_at is null))))
      and exists (select 1 from public.stream_media_upload_account_edges actor_edge
        where actor_edge.intent_id=intent.id and actor_edge.account_id=target_account_id
          and actor_edge.relation_kind='actor' and actor_edge.request_id=context.request_id)
      and exists (select 1 from public.stream_media_upload_account_edges owner_edge
        where owner_edge.intent_id=intent.id and owner_edge.account_id=target_account_id
          and owner_edge.relation_kind='source_owner' and owner_edge.request_id=context.request_id)
      and exists (select 1 from public.stream_media_source_account_edges source_owner
        where source_owner.binding_id=binding.id and source_owner.account_id=target_account_id
          and source_owner.relation_kind='source_owner')
      and exists (select 1 from public.stream_media_source_account_edges asset_owner
        where asset_owner.binding_id=binding.id and asset_owner.account_id=target_account_id
          and asset_owner.relation_kind='asset_owner')
      and exists (select 1 from public.stream_media_source_binding_events attached
        join public.stream_media_operation_events upload_event
          on upload_event.operation_id=upload.id and upload_event.request_id=attached.request_id
            and upload_event.to_state='provisional_bound'
            and upload_event.evidence_digest=observation.evidence_digest
        where attached.binding_id=binding.id and attached.event_kind='attached'
          and attached.source_revision=context.source_revision
          and attached.evidence_digest=observation.evidence_digest)
      and not private.stream_legacy_uid_unresolved(binding.registry_id,binding.raw_provider_uid)
      and not exists (select 1 from public.stream_media_source_bindings other_binding
        where other_binding.registry_id=binding.registry_id
          and other_binding.raw_provider_uid=binding.raw_provider_uid
          and other_binding.id<>binding.id
          and other_binding.binding_state in
            ('legacy_unverified','provisional_bound','ready_for_publication','active','retained','quarantined'))
  );
$$;
revoke all on function private.stream_provisional_upload_account_cleanup_eligible(uuid,uuid)
  from public, anon, authenticated, service_role;

-- An account-finalized provisional upload has no completed-upload receipt. Its special terminal
-- proof requires the original revision, exact current binding, terminal UID event, and receipt.
create function private.stream_provisional_upload_cleanup_proven(
  target_intent_id uuid,target_account_id uuid
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.stream_media_operations upload
    join public.stream_media_operation_states upload_state on upload_state.operation_id=upload.id
      and upload_state.operation_state='provisional_bound'
    join public.stream_media_upload_intents intent on intent.id=upload.intent_id
    join public.stream_media_upload_contexts context on context.intent_id=intent.id
    join public.stream_media_parent_fences parent_fence
      on parent_fence.source_kind=context.parent_kind
      and parent_fence.source_identity=context.parent_identity
      and parent_fence.owner_id=target_account_id
      and parent_fence.source_revision=context.source_revision
      and parent_fence.fence_state='closing'
      and parent_fence.active_operation_id=upload.id
    join public.stream_media_assets asset on asset.upload_intent_id=intent.id
      and asset.registry_id=upload.registry_id and asset.owner_id=target_account_id
      and asset.lifecycle_state='provisional_bound'
      and asset.signed_urls_verified is true and asset.ready_to_stream_verified is true
    join public.stream_media_source_bindings binding on binding.asset_id=asset.id
      and binding.registry_id=asset.registry_id and binding.raw_provider_uid=asset.raw_provider_uid
      and binding.source_kind=upload.source_kind and binding.source_identity=upload.source_identity
      and binding.parent_kind=context.parent_kind and binding.parent_identity=context.parent_identity
      and binding.source_revision=context.source_revision and binding.owner_id=target_account_id
      and binding.binding_state='detached'
    join public.stream_media_upload_observations observation on observation.operation_id=upload.id
      and observation.registry_id=upload.registry_id
      and observation.raw_provider_uid=binding.raw_provider_uid
      and observation.observation_kind='exact_uid_get' and observation.http_status=200
      and observation.signed_urls_reported is true
      and observation.creator_marker_matched is true
      and observation.metadata_marker_matched is true
      and observation.ready_to_stream_reported is true
      and observation.evidence_digest=asset.evidence_digest
      and observation.evidence_digest=binding.evidence_digest
    join public.stream_media_source_account_edges source_owner on source_owner.binding_id=binding.id
      and source_owner.account_id=target_account_id and source_owner.relation_kind='source_owner'
    join public.stream_media_source_account_edges asset_owner on asset_owner.binding_id=binding.id
      and asset_owner.account_id=target_account_id and asset_owner.relation_kind='asset_owner'
    join public.stream_media_upload_account_edges actor_edge on actor_edge.intent_id=intent.id
      and actor_edge.account_id=target_account_id and actor_edge.relation_kind='actor'
      and actor_edge.request_id=context.request_id
    join public.stream_media_upload_account_edges owner_edge on owner_edge.intent_id=intent.id
      and owner_edge.account_id=target_account_id and owner_edge.relation_kind='source_owner'
      and owner_edge.request_id=context.request_id
    join public.stream_media_account_tombstones tombstone on tombstone.account_id=target_account_id
    where upload.operation_kind='upload' and upload.intent_id=target_intent_id
      and upload.source_kind in ('video','post_media')
      and upload.actor_id=target_account_id and upload.owner_id=target_account_id
      and upload.source_kind=intent.source_kind and upload.source_identity=intent.source_id::text
      and upload.registry_id=intent.provider_account_registry_id
      and upload.parent_kind=context.parent_kind and upload.parent_identity=context.parent_identity
      and upload.expected_source_revision=context.source_revision
      and intent.source_guard_state='pending_source_guard' and intent.actor_id=target_account_id
      and intent.purpose=case when intent.source_kind='video' then 'library_video' else 'community_video' end
      and context.owner_id=target_account_id
      and binding.observed_creator='matched_at_exact_readback'
      and binding.observed_marker='matched_at_exact_readback'
      and asset.upload_intent_id=intent.id
      and asset.creator_observation='matched_at_exact_readback'
      and asset.marker_observation='matched_at_exact_readback'
      and exists (select 1 from public.stream_media_source_binding_events attached
        join public.stream_media_operation_events upload_event
          on upload_event.operation_id=upload.id and upload_event.request_id=attached.request_id
            and upload_event.to_state='provisional_bound'
            and upload_event.evidence_digest=observation.evidence_digest
        where attached.binding_id=binding.id and attached.event_kind='attached'
          and attached.source_revision=context.source_revision
          and attached.evidence_digest=observation.evidence_digest)
      and ((intent.source_kind='video' and context.parent_kind='profile'
          and context.parent_identity=target_account_id::text
          and (not exists (select 1 from public.videos video where video.id=intent.source_id)
            or exists (select 1 from public.videos video where video.id=intent.source_id
              and video.coach_id=target_account_id and video.cloudflare_uid=binding.raw_provider_uid
              and video.stream_provider_account_registry_id=binding.registry_id
              and video.status::text='uploading')))
        or (intent.source_kind='post_media' and context.parent_kind='post'
          and (not exists (select 1 from public.post_media media where media.id=intent.source_id)
            or exists (select 1 from public.post_media media join public.posts post
                on post.id=media.post_id
              where media.id=intent.source_id and media.kind='video'
                and media.video_uid=binding.raw_provider_uid
                and post.id::text=context.parent_identity and post.author_id=target_account_id
                and post.removed_at is null))))
      and (select count(*) from public.stream_media_assets sibling_asset
        where sibling_asset.upload_intent_id=intent.id)=1
      and (select count(*) from public.stream_media_source_bindings sibling_binding
        join public.stream_media_assets sibling_asset on sibling_asset.id=sibling_binding.asset_id
        where sibling_asset.upload_intent_id=intent.id)=1
      and exists (select 1 from public.stream_media_operations cleanup
        join public.stream_media_operation_states cleanup_state on cleanup_state.operation_id=cleanup.id
          and cleanup_state.operation_state in ('completed','retained')
        join public.stream_media_finalization_receipts receipt on receipt.operation_id=cleanup.id
          and receipt.terminal_state=cleanup_state.operation_state
          and receipt.response->>'outcome'='account_cleanup_complete'
          and receipt.response->>'state'=cleanup_state.operation_state
        join public.stream_media_manifest_edges manifest on manifest.operation_id=cleanup.id
          and manifest.binding_id=binding.id
          and manifest.source_kind=binding.source_kind
          and manifest.source_identity=binding.source_identity
          and manifest.source_revision=context.source_revision
          and manifest.registry_id=binding.registry_id
          and manifest.raw_provider_uid=binding.raw_provider_uid
        join public.stream_media_operation_uid_state uid_state on uid_state.operation_id=cleanup.id
          and uid_state.registry_id=manifest.registry_id
          and uid_state.raw_provider_uid=manifest.raw_provider_uid
          and uid_state.uid_state in ('deleted_confirmed','already_absent_confirmed')
        join public.stream_media_operation_uid_events uid_result on uid_result.id=uid_state.last_event_id
          and uid_result.operation_id=cleanup.id and uid_result.registry_id=manifest.registry_id
          and uid_result.raw_provider_uid=manifest.raw_provider_uid
          and uid_result.outcome=uid_state.uid_state
        where cleanup.operation_kind='account_cleanup' and cleanup.owner_id=target_account_id
          and cleanup.source_kind='account' and cleanup.source_identity=target_account_id::text
          and cleanup.request_id=tombstone.request_id
          and ((uid_state.uid_state='deleted_confirmed'
              and uid_result.delete_http_status between 200 and 299 and uid_result.http_status=404)
            or (uid_state.uid_state='already_absent_confirmed'
              and uid_result.delete_http_status is null and uid_result.http_status=404))
          and exists (select 1 from public.stream_media_source_binding_events detached
            where detached.binding_id=binding.id and detached.event_kind='detached'
              and detached.source_revision=context.source_revision
              and detached.evidence_digest=receipt.request_digest
              and detached.request_id=private.stream_media_request_uuid(
                cleanup.id::text||binding.id::text||':account-finalize'))
          and receipt.response->>'source_revision_digest'=tombstone.source_revision_digest)
  );
$$;
revoke all on function private.stream_provisional_upload_cleanup_proven(uuid,uuid)
  from public, anon, authenticated, service_role;

create function public.begin_stream_account_media_cleanup(
  target_tombstone_id uuid, target_account_id uuid, target_request_id uuid,
  target_request_digest text, target_operation_id uuid, target_operation_digest text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  tombstone public.stream_media_account_tombstones%rowtype;
  fence public.stream_media_parent_fences%rowtype;
  existing public.stream_media_operations%rowtype;
  registry_ids uuid[];
  raw_uids text[];
  uid_item record;
  manifest_count integer;
  uid_count integer;
  unresolved boolean;
  upload_unresolved boolean;
  source_digest text;
  source_inventory text;
  upload_inventory text;
  provider_event_request uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Account media cleanup is service managed' using errcode = '42501';
  end if;
  if target_tombstone_id is null or target_account_id is null or target_request_id is null
    or target_request_digest is null or target_request_digest !~ '^[0-9a-f]{64}$'
    or target_operation_id is null or target_operation_digest is null
    or target_operation_digest !~ '^[0-9a-f]{64}$'
  then raise exception 'Account cleanup request is invalid' using errcode = '22023'; end if;
  perform private.stream_require_read_committed();
  perform pg_advisory_xact_lock(hashtextextended('account:'||target_account_id::text,19031003));
  select * into tombstone from public.stream_media_account_tombstones item
    where item.account_id=target_account_id for update;
  if found then
    if tombstone.id <> target_tombstone_id or tombstone.request_id <> target_request_id
      or tombstone.request_digest <> target_request_digest
    then return jsonb_build_object('outcome','tombstone_identity_mismatch'); end if;
  else
    insert into public.stream_media_account_tombstones (
      id,account_id,request_id,request_digest,tombstone_state
    ) values (target_tombstone_id,target_account_id,target_request_id,target_request_digest,'closing')
    returning * into tombstone;
    insert into public.stream_media_account_tombstone_events (
      tombstone_id,event_kind,request_id,evidence_digest
    ) values (target_tombstone_id,'closing',target_request_id,target_request_digest);
  end if;
  if tombstone.tombstone_state in ('auth_deletion_ready','auth_call_started','auth_result_unknown','auth_confirmed','completed') then
    return jsonb_build_object('outcome','same_tombstone','state',tombstone.tombstone_state,
      'revision',tombstone.revision);
  end if;
  select * into existing from public.stream_media_operations operation
    where operation.id=target_operation_id or operation.request_id=target_request_id for update;
  if found then
    if existing.id <> target_operation_id or existing.request_id <> target_request_id
      or existing.operation_kind <> 'account_cleanup' or existing.owner_id <> target_account_id
      or existing.operation_digest <> target_operation_digest
    then return jsonb_build_object('outcome','operation_identity_mismatch'); end if;
    return jsonb_build_object('outcome','same_operation','operation_id',existing.id,
      'state',(select state.operation_state from public.stream_media_operation_states state where state.operation_id=existing.id));
  end if;
  select exists (
    select 1 from public.stream_media_source_account_edges account_edge
    join public.stream_media_source_bindings binding on binding.id=account_edge.binding_id
    where account_edge.account_id=target_account_id
       and (binding.registry_id is null
         or binding.binding_state in ('legacy_unverified','quarantined')
         or (binding.binding_state='provisional_bound'
           and not private.stream_provisional_upload_account_cleanup_eligible(binding.id,target_account_id))
         or (binding.binding_state='ready_for_publication' and not (
           exists (select 1 from public.stream_media_assets asset
             where asset.id=binding.asset_id
               and asset.registry_id=binding.registry_id
               and asset.raw_provider_uid=binding.raw_provider_uid
               and asset.lifecycle_state='ready_for_publication'
               and asset.signed_urls_verified and asset.ready_to_stream_verified)
           and (binding.source_kind not in ('video','post_media')
             or private.stream_upload_source_exists(binding.source_kind,binding.source_identity,
               binding.owner_id,binding.registry_id,binding.raw_provider_uid))
         )))
  ) into unresolved;
  if unresolved then
    update public.stream_media_account_tombstones set tombstone_state='provider_cleanup',updated_at=now()
      where id=target_tombstone_id;
    return jsonb_build_object('outcome','unresolved_media_identity','tombstone_id',target_tombstone_id,
      'tombstone_revision',tombstone.revision);
  end if;
  -- Uploads are associated before HTTP. Never omit an unknown create merely because it has
  -- no video/source row yet; only an explicitly pre-HTTP absence or a terminal bound result
  -- is safe to continue past.
  select exists (
    select 1
    from public.stream_media_upload_account_edges account_upload
    join public.stream_media_upload_intents intent on intent.id=account_upload.intent_id
    left join public.stream_media_operations operation on operation.intent_id=intent.id
      and operation.operation_kind='upload'
    left join public.stream_media_operation_states state on state.operation_id=operation.id
    where account_upload.account_id=target_account_id
      and (
        (operation.id is not null and state.operation_state in
          ('reserved','create_started','create_unknown','created_unverified'))
        or (operation.id is not null and state.operation_state in ('provisional_bound','completed')
          and not exists (
            select 1 from public.stream_media_assets asset
            join public.stream_media_source_bindings binding on binding.asset_id=asset.id
              and binding.registry_id=asset.registry_id and binding.raw_provider_uid=asset.raw_provider_uid
            join public.stream_media_source_account_edges source_account on source_account.binding_id=binding.id
            where asset.upload_intent_id=intent.id and source_account.account_id=target_account_id
              and binding.binding_state in ('provisional_bound','ready_for_publication','active','retained')
          )
          and not private.stream_upload_cleanup_proven(intent.id,target_account_id)
          and not private.stream_provisional_upload_cleanup_proven(intent.id,target_account_id))
      )
  ) into upload_unresolved;
  if upload_unresolved then
    update public.stream_media_account_tombstones set tombstone_state='provider_cleanup',
      source_revision_digest=null,revision=revision+1,state_revision=state_revision+1,updated_at=now()
      where id=target_tombstone_id;
    return jsonb_build_object('outcome','upload_reconciliation_required',
      'tombstone_id',target_tombstone_id,'tombstone_revision',tombstone.revision+1);
  end if;
  select array_agg(tuple.registry_id order by tuple.registry_id::text,tuple.raw_uid),
         array_agg(tuple.raw_uid order by tuple.registry_id::text,tuple.raw_uid)
    into registry_ids,raw_uids
  from (select distinct binding.registry_id,binding.raw_provider_uid as raw_uid
    from public.stream_media_source_account_edges account_edge
    join public.stream_media_source_bindings binding on binding.id=account_edge.binding_id
    where account_edge.account_id=target_account_id and binding.registry_id is not null
      and binding.binding_state <> 'detached') tuple;
  if exists (
    select 1 from unnest(registry_ids,raw_uids) selected(registry_id,raw_uid)
    where not private.stream_account_is_verified(selected.registry_id)
      or private.stream_legacy_uid_unresolved(selected.registry_id,selected.raw_uid)
  ) then
    update public.stream_media_account_tombstones set tombstone_state='provider_cleanup',updated_at=now()
      where id=target_tombstone_id;
    return jsonb_build_object('outcome','account_unverified_or_legacy_candidate',
      'tombstone_id',target_tombstone_id,'tombstone_revision',tombstone.revision);
  end if;
  if coalesce(cardinality(raw_uids),0)>0 then perform private.stream_try_uid_locks(registry_ids,raw_uids); end if;
  insert into public.stream_media_parent_fences (source_kind,source_identity,owner_id,source_revision)
  values ('account',target_account_id::text,target_account_id,greatest(tombstone.revision,1))
  on conflict (source_kind,source_identity) do nothing;
  select * into fence from public.stream_media_parent_fences parent
    where parent.source_kind='account' and parent.source_identity=target_account_id::text for update;
  if fence.fence_state <> 'open' then
    return jsonb_build_object('outcome','account_cleanup_busy'); end if;
  insert into public.stream_media_operations (
    id,request_id,operation_kind,actor_id,owner_id,source_kind,source_identity,
    parent_kind,parent_identity,expected_source_revision,operation_digest
  ) values (
    target_operation_id,target_request_id,'account_cleanup',target_account_id,target_account_id,
    'account',target_account_id::text,'account',target_account_id::text,
    fence.source_revision,target_operation_digest
  );
  insert into public.stream_media_operation_states(operation_id,operation_state)
    values (target_operation_id,'cleanup_reserved');
  insert into public.stream_media_operation_events(operation_id,sequence_number,from_state,to_state,request_id,evidence_digest)
    values (target_operation_id,1,null,'cleanup_reserved',target_request_id,target_operation_digest);
  update public.stream_media_parent_fences set fence_state='closing',active_operation_id=target_operation_id,
    state_revision=state_revision+1,updated_at=now()
    where source_kind='account' and source_identity=target_account_id::text;
  -- Populate referenced UID state before inserting any manifest edge.
  insert into public.stream_media_operation_uid_state(operation_id,registry_id,raw_provider_uid,uid_state)
  select target_operation_id,selected.registry_id,selected.raw_uid,'reserved'
  from (
    select distinct binding.registry_id,binding.raw_provider_uid as raw_uid
    from public.stream_media_source_account_edges account_edge
    join public.stream_media_source_bindings binding on binding.id=account_edge.binding_id
    where account_edge.account_id=target_account_id and binding.registry_id is not null
      and binding.binding_state <> 'detached'
  ) selected;
  insert into public.stream_media_manifest_edges (
    operation_id,edge_number,binding_id,source_kind,source_identity,source_revision,
    registry_id,raw_provider_uid,detach_allowed
  )
  select target_operation_id,row_number() over (order by binding.source_kind,binding.source_identity,binding.id)::integer,
    binding.id,binding.source_kind,binding.source_identity,binding.source_revision,
    binding.registry_id,binding.raw_provider_uid,exists (
      select 1 from public.stream_media_source_bindings other_binding
      where other_binding.registry_id=binding.registry_id and other_binding.raw_provider_uid=binding.raw_provider_uid
        and other_binding.binding_state in ('ready_for_publication','active','retained')
        and not exists (select 1 from public.stream_media_source_account_edges account_edge
          where account_edge.binding_id=other_binding.id and account_edge.account_id=target_account_id)
    )
  from public.stream_media_source_account_edges account_edge
  join public.stream_media_source_bindings binding on binding.id=account_edge.binding_id
  where account_edge.account_id=target_account_id and binding.registry_id is not null
    and binding.binding_state <> 'detached'
  on conflict (operation_id,binding_id) do nothing;
  for uid_item in select state.registry_id,state.raw_provider_uid
    from public.stream_media_operation_uid_state state where state.operation_id=target_operation_id
  loop
    if private.stream_media_has_effective_reference(uid_item.registry_id,uid_item.raw_provider_uid,target_operation_id) then
      update public.stream_media_operation_uid_state set uid_state='retained_attached',
        state_revision=state_revision+1,updated_at=now()
      where operation_id=target_operation_id and registry_id=uid_item.registry_id
        and raw_provider_uid=uid_item.raw_provider_uid;
      insert into public.stream_media_operation_uid_events (
        operation_id,registry_id,raw_provider_uid,sequence_number,outcome,request_id,evidence_digest
      ) values (target_operation_id,uid_item.registry_id,uid_item.raw_provider_uid,1,'retained_attached',
        gen_random_uuid(),target_operation_digest);
    end if;
  end loop;
  select count(*)::integer into manifest_count from public.stream_media_manifest_edges edge
    where edge.operation_id=target_operation_id;
  select count(*)::integer into uid_count from public.stream_media_operation_uid_state state
    where state.operation_id=target_operation_id;
  select coalesce(string_agg(concat_ws('|',edge.edge_number::text,edge.binding_id::text,
    edge.source_kind,edge.source_identity,edge.source_revision::text,edge.registry_id::text,
    edge.raw_provider_uid),chr(10) order by edge.edge_number),'') into source_inventory
  from public.stream_media_manifest_edges edge where edge.operation_id=target_operation_id;
  select coalesce(string_agg(concat_ws('|',upload.intent_id::text,upload.relation_kind,
      coalesce(operation.id::text,'pre_http'),coalesce(state.operation_state,'unreserved'),
      coalesce(operation.operation_digest,'')),chr(10)
      order by upload.intent_id::text,upload.relation_kind),'') into upload_inventory
  from public.stream_media_upload_account_edges upload
  left join public.stream_media_operations operation on operation.intent_id=upload.intent_id
    and operation.operation_kind='upload'
  left join public.stream_media_operation_states state on state.operation_id=operation.id
  where upload.account_id=target_account_id;
  source_digest := private.stream_media_identity_digest(concat_ws('|',target_account_id::text,
    tombstone.revision::text,target_operation_id::text,target_operation_digest,
    manifest_count::text,uid_count::text,source_inventory,upload_inventory));
  update public.stream_media_account_tombstones set tombstone_state='provider_cleanup',
    source_revision_digest=source_digest,updated_at=now() where id=target_tombstone_id;
  provider_event_request := (substr(md5(target_request_id::text || ':provider-cleanup'),1,8) || '-'
    || substr(md5(target_request_id::text || ':provider-cleanup'),9,4) || '-'
    || substr(md5(target_request_id::text || ':provider-cleanup'),13,4) || '-'
    || substr(md5(target_request_id::text || ':provider-cleanup'),17,4) || '-'
    || substr(md5(target_request_id::text || ':provider-cleanup'),21,12))::uuid;
  insert into public.stream_media_account_tombstone_events (
    tombstone_id,event_kind,request_id,source_revision_digest,evidence_digest
  ) values (target_tombstone_id,'provider_cleanup',provider_event_request,source_digest,target_operation_digest)
  on conflict (tombstone_id,request_id) do nothing;
  return jsonb_build_object('outcome','reserved','operation_id',target_operation_id,
    'tombstone_id',target_tombstone_id,'tombstone_revision',tombstone.revision,
    'manifest_edges',manifest_count,'uid_count',uid_count);
exception
  when unique_violation then return jsonb_build_object('outcome','identity_mismatch');
  when lock_not_available then return jsonb_build_object('outcome','source_busy');
  when invalid_text_representation then return jsonb_build_object('outcome','identity_mismatch');
end;
$$;
revoke all on function public.begin_stream_account_media_cleanup(uuid,uuid,uuid,text,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.begin_stream_account_media_cleanup(uuid,uuid,uuid,text,uuid,text)
  to service_role;

create function private.stream_try_parent_lock(target_parent_kind text,target_parent_identity text)
returns boolean
language sql volatile security definer set search_path = ''
as $$
  select pg_try_advisory_xact_lock(hashtextextended(
    target_parent_kind || ':' || target_parent_identity,19031002
  ));
$$;
revoke all on function private.stream_try_parent_lock(text,text) from public, anon, authenticated, service_role;

create function private.stream_bump_open_parent_revision(
  target_parent_kind text,target_parent_identity text,target_owner_id uuid,target_operation_id uuid
)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare fence public.stream_media_parent_fences%rowtype;
next_revision bigint;
begin
  if not private.stream_try_parent_lock(target_parent_kind,target_parent_identity) then
    raise exception 'Media parent is busy; retry the full mutation' using errcode = '55P03';
  end if;
  insert into public.stream_media_parent_fences(source_kind,source_identity,owner_id,source_revision)
  values (target_parent_kind,target_parent_identity,target_owner_id,1)
  on conflict (source_kind,source_identity) do nothing;
  select * into fence from public.stream_media_parent_fences item
  where item.source_kind=target_parent_kind and item.source_identity=target_parent_identity;
  if fence.owner_id is distinct from target_owner_id then
    raise exception 'Media parent owner changed' using errcode = '42501'; end if;
  if fence.fence_state <> 'open' and fence.active_operation_id is distinct from target_operation_id then
    raise exception 'Media parent is closing' using errcode = '55P03'; end if;
  if fence.active_operation_id is not null then return fence.source_revision; end if;
  update public.stream_media_parent_fences set source_revision=source_revision+1,
    state_revision=state_revision+1,updated_at=now()
  where source_kind=target_parent_kind and source_identity=target_parent_identity
  returning source_revision into next_revision;
  return next_revision;
end;
$$;
revoke all on function private.stream_bump_open_parent_revision(text,text,uuid,uuid)
  from public, anon, authenticated, service_role;

create function private.stream_record_local_source_detach(
  target_binding_id uuid,target_actor_id uuid,target_parent_kind text,
  target_parent_identity text,target_parent_owner uuid
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  binding public.stream_media_source_bindings%rowtype;
  fence public.stream_media_parent_fences%rowtype;
  mutation_id uuid := gen_random_uuid();
  operation_request uuid := gen_random_uuid();
  start_request uuid;
  done_request uuid;
  binding_event_request uuid;
  uid_event_request uuid;
  operation_digest text;
begin
  if target_binding_id is null or target_parent_kind is null or target_parent_identity is null
    or target_parent_owner is null then
    raise exception 'Source detach identity is incomplete' using errcode = '22023'; end if;
  select * into binding from public.stream_media_source_bindings item
    where item.id=target_binding_id for update;
  if not found or binding.registry_id is null or binding.binding_state not in ('active','ready_for_publication','retained') then
    raise exception 'Source media identity is not safely bound' using errcode = '55000'; end if;
  if binding.parent_kind is distinct from target_parent_kind
    or binding.parent_identity is distinct from target_parent_identity then
    raise exception 'Source media parent identity changed' using errcode = '42501'; end if;
  if private.stream_account_is_tombstoned(binding.owner_id)
    or private.stream_account_is_tombstoned(target_parent_owner) then
    raise exception 'Source owner account is closing' using errcode = '55000'; end if;
  if not private.stream_try_parent_lock(target_parent_kind,target_parent_identity)
    or not private.stream_try_uid_lock(binding.registry_id,binding.raw_provider_uid) then
    raise exception 'Source media is busy; retry the entire change' using errcode = '55P03'; end if;
  if private.stream_media_uid_reserved(binding.registry_id,binding.raw_provider_uid) then
    raise exception 'Source UID has an active provider cleanup reservation' using errcode = '55P03'; end if;
  insert into public.stream_media_parent_fences(source_kind,source_identity,owner_id,source_revision)
  values (target_parent_kind,target_parent_identity,target_parent_owner,1)
  on conflict (source_kind,source_identity) do nothing;
  select * into fence from public.stream_media_parent_fences item
    where item.source_kind=target_parent_kind and item.source_identity=target_parent_identity for update;
  if fence.owner_id is distinct from target_parent_owner or fence.fence_state<>'open'
    or fence.active_operation_id is not null then
    raise exception 'Source parent is closing or has changed owner' using errcode = '55P03'; end if;
  operation_digest := private.stream_media_identity_digest(concat_ws('|','source_mutation',
    target_binding_id::text,binding.source_kind,binding.source_identity,binding.source_revision::text,
    binding.registry_id::text,binding.raw_provider_uid,target_parent_kind,target_parent_identity,
    fence.source_revision::text));
  perform private.stream_bump_open_parent_revision(
    target_parent_kind,target_parent_identity,target_parent_owner,null);
  insert into public.stream_media_operations(
    id,request_id,operation_kind,actor_id,owner_id,source_kind,source_identity,
    parent_kind,parent_identity,expected_source_revision,registry_id,operation_digest
  ) values (
    mutation_id,operation_request,'source_mutation',coalesce(target_actor_id,binding.owner_id),
    binding.owner_id,binding.source_kind,binding.source_identity,target_parent_kind,
    target_parent_identity,fence.source_revision,binding.registry_id,operation_digest
  );
  insert into public.stream_media_operation_states(operation_id,operation_state)
    values (mutation_id,'reserved');
  insert into public.stream_media_operation_events(operation_id,sequence_number,from_state,to_state,request_id,evidence_digest)
    values (mutation_id,1,null,'reserved',operation_request,operation_digest);
  insert into public.stream_media_operation_uid_state(operation_id,registry_id,raw_provider_uid,uid_state)
    values (mutation_id,binding.registry_id,binding.raw_provider_uid,'detached_retained');
  insert into public.stream_media_manifest_edges(
    operation_id,edge_number,binding_id,source_kind,source_identity,source_revision,
    registry_id,raw_provider_uid,detach_allowed
  ) values (mutation_id,1,binding.id,binding.source_kind,binding.source_identity,
    binding.source_revision,binding.registry_id,binding.raw_provider_uid,true);
  start_request := private.stream_media_request_uuid(mutation_id::text||':source-finalizing');
  perform private.stream_advance_operation(mutation_id,'source_finalizing',start_request,operation_digest);
  binding_event_request := private.stream_media_request_uuid(mutation_id::text||':binding-detached');
  update public.stream_media_source_bindings set binding_state='detached',
    state_revision=state_revision+1,updated_at=now() where id=binding.id;
  insert into public.stream_media_source_binding_events(binding_id,event_kind,source_revision,request_id,evidence_digest)
    values (binding.id,'detached',binding.source_revision,binding_event_request,operation_digest);
  uid_event_request := private.stream_media_request_uuid(mutation_id::text||':uid-detached-retained');
  insert into public.stream_media_operation_uid_events(
    operation_id,registry_id,raw_provider_uid,sequence_number,outcome,request_id,evidence_digest
  ) values (mutation_id,binding.registry_id,binding.raw_provider_uid,1,'detached_retained',
    uid_event_request,operation_digest);
  update public.stream_media_operation_uid_state set state_revision=state_revision+1,
    last_event_id=(select event.id from public.stream_media_operation_uid_events event
      where event.operation_id=mutation_id and event.registry_id=binding.registry_id
        and event.raw_provider_uid=binding.raw_provider_uid and event.request_id=uid_event_request),updated_at=now()
  where operation_id=mutation_id and registry_id=binding.registry_id and raw_provider_uid=binding.raw_provider_uid;
  done_request := private.stream_media_request_uuid(mutation_id::text||':source-completed');
  perform private.stream_advance_operation(mutation_id,'completed',done_request,operation_digest);
  return mutation_id;
exception when lock_not_available then
  raise exception 'Source media is busy; retry the entire change' using errcode = '55P03';
end;
$$;
revoke all on function private.stream_record_local_source_detach(uuid,uuid,text,text,uuid)
  from public, anon, authenticated, service_role;

create function private.stream_record_source_accounts(
  target_binding_id uuid,target_source_kind text,target_source_identity text,
  target_source_owner uuid,target_asset_owner uuid
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if target_source_owner is not null then
    insert into public.stream_media_source_account_edges(binding_id,account_id,relation_kind)
    values (target_binding_id,target_source_owner,'source_owner') on conflict do nothing;
  end if;
  if target_asset_owner is not null then
    insert into public.stream_media_source_account_edges(binding_id,account_id,relation_kind)
    values (target_binding_id,target_asset_owner,'asset_owner') on conflict do nothing;
  end if;
  if target_source_kind='task' then
    insert into public.stream_media_source_account_edges(binding_id,account_id,relation_kind)
    select target_binding_id,assignment.member_id,'assigned_member'
    from public.task_assignments assignment where assignment.task_id::text=target_source_identity
    on conflict do nothing;
  elsif target_source_kind='daily_fuel_assignment' then
    insert into public.stream_media_source_account_edges(binding_id,account_id,relation_kind)
    select target_binding_id,assignment.member_id,'assigned_member'
    from public.member_daily_fuel_assignments assignment where assignment.id::text=target_source_identity
    on conflict do nothing;
  elsif target_source_kind='daily_fuel_bookmark' then
    insert into public.stream_media_source_account_edges(binding_id,account_id,relation_kind)
    select target_binding_id,bookmark.member_id,'bookmark_owner'
    from public.member_daily_fuel_bookmarks bookmark
    where bookmark.member_id::text || ':' || bookmark.video_id::text=target_source_identity
    on conflict do nothing;
  elsif target_source_kind='daily_content_grant' then
    insert into public.stream_media_source_account_edges(binding_id,account_id,relation_kind)
    select target_binding_id,grant_row.member_id,'grant_recipient'
    from public.member_daily_content_video_grants grant_row
    where grant_row.member_id::text || ':' || grant_row.day::text || ':' || grant_row.video_id::text=target_source_identity
    on conflict do nothing;
  elsif target_source_kind='program_lesson' then
    insert into public.stream_media_source_account_edges(binding_id,account_id,relation_kind)
    select target_binding_id,enrollment.member_id,'assigned_member'
    from public.program_content_version_lessons lesson
    join public.program_content_versions version on version.id=lesson.content_version_id
    join public.program_enrollments enrollment
      on enrollment.program_id=lesson.program_id and enrollment.content_version_id=lesson.content_version_id
    where lesson.id::text=target_source_identity and version.revision_kind='free_snapshot'
    on conflict do nothing;
    insert into public.stream_media_source_account_edges(binding_id,account_id,relation_kind)
    select target_binding_id,orders.buyer_id,'assigned_member'
    from public.program_content_version_lessons lesson
    join public.program_orders orders
      on orders.program_id=lesson.program_id and orders.content_version_id=lesson.content_version_id
    where lesson.id::text=target_source_identity
    on conflict do nothing;
  end if;
end;
$$;
revoke all on function private.stream_record_source_accounts(uuid,text,text,uuid,uuid)
  from public, anon, authenticated, service_role;

create function private.stream_legacy_resolution_authorizes_video(
  target_resolution_event_id uuid,target_video_id uuid,target_uid text,target_registry_id uuid
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.stream_media_legacy_resolution_events resolution
    where resolution.id=target_resolution_event_id
      and resolution.canonical_source_kind='video'
      and resolution.canonical_source_identity=target_video_id::text
      and resolution.raw_provider_uid=target_uid
      and resolution.registry_id=target_registry_id
  );
$$;
revoke all on function private.stream_legacy_resolution_authorizes_video(uuid,uuid,text,uuid)
  from public,anon,authenticated,service_role;

create function public.resolve_legacy_stream_media_observation(
  target_observation_id uuid,target_registry_id uuid,target_request_id uuid,
  target_http_status smallint,target_signed_urls_verified boolean,
  target_ready_to_stream_verified boolean,target_evidence_digest text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  observation public.stream_media_legacy_observations%rowtype;
  prior public.stream_media_legacy_resolution_events%rowtype;
  binding public.stream_media_source_bindings%rowtype;
  asset public.stream_media_assets%rowtype;
  v_source_owner uuid;
  v_consumer_id uuid;
  v_parent_kind text;
  v_parent_identity text;
  v_program_id uuid;
  v_canonical_kind text;
  v_canonical_identity text;
  v_source_revision bigint;
  v_next_state text;
  v_asset_lifecycle_state text;
  resolution_id uuid := gen_random_uuid();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Legacy media reconciliation is service managed' using errcode='42501';
  end if;
  if target_observation_id is null or target_registry_id is null or target_request_id is null
    or target_http_status is null or target_http_status<>200
    or target_signed_urls_verified is null or target_ready_to_stream_verified is null
    or target_evidence_digest is null or target_evidence_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'Legacy reconciliation evidence is invalid' using errcode='22023';
  end if;
  perform private.stream_require_read_committed();
  select * into observation from public.stream_media_legacy_observations item
    where item.id=target_observation_id;
  if not found or observation.uid_state<>'present' or observation.account_state<>'unknown'
    or observation.captured_uid is null then
    return jsonb_build_object('outcome','observation_not_reconcilable');
  end if;
  select * into prior from public.stream_media_legacy_resolution_events event
    where event.observation_id=target_observation_id;
  if found then
    if prior.registry_id<>target_registry_id or prior.request_id<>target_request_id
      or prior.http_status<>target_http_status
      or prior.signed_urls_verified<>target_signed_urls_verified
      or prior.ready_to_stream_verified<>target_ready_to_stream_verified
      or prior.evidence_digest<>target_evidence_digest then
      return jsonb_build_object('outcome','identity_mismatch');
    end if;
    return jsonb_build_object('outcome','already_resolved','resolution_id',prior.id);
  end if;
  if not private.stream_account_is_verified(target_registry_id)
    or not private.stream_legacy_observation_source_current(target_observation_id) then
    return jsonb_build_object('outcome','account_or_source_unverified');
  end if;

  if observation.source_kind='videos' then
    select video.coach_id,'profile',video.coach_id::text,'video',video.id::text
      into v_source_owner,v_parent_kind,v_parent_identity,v_canonical_kind,v_canonical_identity
    from public.videos video where video.id::text=observation.source_identity
      and video.cloudflare_uid=observation.captured_uid;
  elsif observation.source_kind='post_media' then
    select post.author_id,'post',post.id::text,'post_media',media.id::text
      into v_source_owner,v_parent_kind,v_parent_identity,v_canonical_kind,v_canonical_identity
    from public.post_media media join public.posts post on post.id=media.post_id
    where media.id::text=observation.source_identity and media.kind='video'
      and media.video_uid=observation.captured_uid;
  elsif observation.source_kind='program_content_version_lessons' then
    select program.coach_id,'program',program.id::text,'program_lesson',lesson.id::text,program.id
      into v_source_owner,v_parent_kind,v_parent_identity,v_canonical_kind,v_canonical_identity,v_program_id
    from public.program_content_version_lessons lesson join public.programs program on program.id=lesson.program_id
    where lesson.id::text=observation.source_identity and lesson.cloudflare_uid=observation.captured_uid;
  elsif observation.source_kind='pinned_free_enrollment_lessons' then
    select program.coach_id,enrollment.member_id,'program',program.id::text,
      'program_lesson',lesson.id::text,program.id
      into v_source_owner,v_consumer_id,v_parent_kind,v_parent_identity,v_canonical_kind,v_canonical_identity,v_program_id
    from public.program_enrollments enrollment
    join public.program_content_version_lessons lesson
      on lesson.program_id=enrollment.program_id and lesson.content_version_id=enrollment.content_version_id
    join public.program_content_versions version
      on version.program_id=lesson.program_id and version.id=lesson.content_version_id
    join public.programs program on program.id=lesson.program_id
    where enrollment.id::text=split_part(observation.source_identity,':',1)
      and lesson.id::text=split_part(observation.source_identity,':',2)
      and version.revision_kind='free_snapshot' and lesson.cloudflare_uid=observation.captured_uid;
  elsif observation.source_kind='program_offer_lessons' then
    select program.coach_id,'program',program.id::text,'program_lesson',lesson.id::text,program.id
      into v_source_owner,v_parent_kind,v_parent_identity,v_canonical_kind,v_canonical_identity,v_program_id
    from public.program_offer_versions offer
    join public.program_content_version_lessons lesson
      on lesson.program_id=offer.program_id and lesson.content_version_id=offer.content_version_id
    join public.programs program on program.id=offer.program_id
    where offer.id::text=split_part(observation.source_identity,':',1)
      and lesson.id::text=split_part(observation.source_identity,':',2)
      and lesson.cloudflare_uid=observation.captured_uid;
  elsif observation.source_kind='program_order_lessons' then
    select program.coach_id,orders.buyer_id,'program',program.id::text,
      'program_lesson',lesson.id::text,program.id
      into v_source_owner,v_consumer_id,v_parent_kind,v_parent_identity,v_canonical_kind,v_canonical_identity,v_program_id
    from public.program_orders orders
    join public.program_content_version_lessons lesson
      on lesson.program_id=orders.program_id and lesson.content_version_id=orders.content_version_id
    join public.programs program on program.id=orders.program_id
    where orders.id::text=split_part(observation.source_identity,':',1)
      and lesson.id::text=split_part(observation.source_identity,':',2)
      and lesson.cloudflare_uid=observation.captured_uid;
  end if;
  if v_source_owner is null or v_parent_kind is null or v_canonical_kind is null or v_canonical_identity is null then
    return jsonb_build_object('outcome','source_stale');
  end if;
  perform private.stream_lock_accounts(array[v_source_owner,v_consumer_id]);
  if private.stream_account_is_tombstoned(v_source_owner)
    or (v_consumer_id is not null and private.stream_account_is_tombstoned(v_consumer_id)) then
    return jsonb_build_object('outcome','account_closing');
  end if;
  if not private.stream_account_is_verified(target_registry_id) then
    return jsonb_build_object('outcome','account_or_source_unverified');
  end if;
  if v_program_id is not null then perform private.lock_program_mutation(v_program_id); end if;
  if not private.stream_try_parent_lock(v_parent_kind,v_parent_identity) then
    return jsonb_build_object('outcome','source_busy');
  end if;
  if not private.stream_try_uid_lock(target_registry_id,observation.captured_uid) then
    return jsonb_build_object('outcome','uid_busy');
  end if;
  if not private.stream_legacy_observation_source_current(target_observation_id) then
    return jsonb_build_object('outcome','source_stale');
  end if;
  if exists (select 1 from public.stream_media_source_bindings item
      where item.source_kind=v_canonical_kind and item.source_identity=v_canonical_identity
        and item.raw_provider_uid=observation.captured_uid
        and item.registry_id is not null and item.registry_id<>target_registry_id)
    or (v_canonical_kind='video' and exists (select 1 from public.videos video
      where video.id::text=v_canonical_identity and video.stream_provider_account_registry_id is not null
        and video.stream_provider_account_registry_id<>target_registry_id)) then
    return jsonb_build_object('outcome','binding_identity_conflict');
  end if;
  insert into public.stream_media_parent_fences(source_kind,source_identity,owner_id,source_revision)
    values(v_parent_kind,v_parent_identity,v_source_owner,1) on conflict(source_kind,source_identity) do nothing;
  select fence.source_revision into v_source_revision from public.stream_media_parent_fences fence
    where fence.source_kind=v_parent_kind and fence.source_identity=v_parent_identity
      and fence.owner_id=v_source_owner;
  if v_source_revision is null then return jsonb_build_object('outcome','parent_owner_conflict'); end if;
  select * into binding from public.stream_media_source_bindings item
    where item.source_kind=v_canonical_kind and item.source_identity=v_canonical_identity
      and item.raw_provider_uid=observation.captured_uid
      and (item.registry_id is null or item.registry_id=target_registry_id)
    order by (item.registry_id=target_registry_id) desc nulls last,item.created_at desc limit 1 for update;
  if found then v_source_revision := binding.source_revision; end if;
  if found and binding.binding_state not in
      ('legacy_unverified','provisional_bound','ready_for_publication','active') then
    return jsonb_build_object('outcome','binding_identity_conflict');
  end if;
  v_asset_lifecycle_state := case when target_signed_urls_verified and target_ready_to_stream_verified
    then 'ready_for_publication' else 'provisional_bound' end;
  v_next_state := v_asset_lifecycle_state;
  if binding.binding_state in ('active','ready_for_publication') then
    v_next_state := binding.binding_state;
  end if;
  insert into public.stream_media_assets(
    registry_id,raw_provider_uid,owner_id,creator_observation,marker_observation,
    signed_urls_verified,ready_to_stream_verified,lifecycle_state,evidence_digest
  ) values (
    target_registry_id,observation.captured_uid,v_source_owner,'legacy_exact_uid_get',
    observation.source_kind||':'||observation.source_identity,target_signed_urls_verified,
     target_ready_to_stream_verified,v_asset_lifecycle_state,target_evidence_digest
  ) on conflict (registry_id,raw_provider_uid) do nothing;
  select * into asset from public.stream_media_assets item
    where item.registry_id=target_registry_id and item.raw_provider_uid=observation.captured_uid for update;
  if not found or asset.lifecycle_state in ('cleanup_pending','delete_unknown','deleted_confirmed','quarantined') then
    return jsonb_build_object('outcome','asset_state_conflict');
  end if;
  if asset.lifecycle_state='provisional_bound' and v_asset_lifecycle_state='ready_for_publication' then
    update public.stream_media_assets set signed_urls_verified=true,ready_to_stream_verified=true,
      lifecycle_state='ready_for_publication',asset_revision=asset_revision+1,
      evidence_digest=target_evidence_digest,observed_at=now()
      where id=asset.id returning * into asset;
  end if;
  insert into public.stream_media_legacy_resolution_events(
    id,observation_id,registry_id,canonical_source_kind,canonical_source_identity,
    raw_provider_uid,owner_id,source_revision,http_status,signed_urls_verified,
    ready_to_stream_verified,request_id,evidence_digest
  ) values (resolution_id,target_observation_id,target_registry_id,v_canonical_kind,v_canonical_identity,
    observation.captured_uid,v_source_owner,v_source_revision,target_http_status,
    target_signed_urls_verified,target_ready_to_stream_verified,target_request_id,target_evidence_digest);
  if binding.id is null then
    insert into public.stream_media_source_bindings(
      registry_id,raw_provider_uid,asset_id,source_kind,source_identity,parent_kind,parent_identity,
      source_revision,owner_id,binding_state,observed_marker,evidence_digest
    ) values (target_registry_id,observation.captured_uid,asset.id,v_canonical_kind,v_canonical_identity,
      v_parent_kind,v_parent_identity,v_source_revision,v_source_owner,v_next_state,
      observation.source_kind||':'||observation.source_identity,target_evidence_digest)
    returning * into binding;
  else
    update public.stream_media_source_bindings set registry_id=target_registry_id,asset_id=asset.id,
      parent_kind=v_parent_kind,parent_identity=v_parent_identity,owner_id=v_source_owner,
      binding_state=v_next_state,source_revision=v_source_revision,state_revision=state_revision+1,
      updated_at=now(),observed_marker=observation.source_kind||':'||observation.source_identity,
      evidence_digest=target_evidence_digest
    where id=binding.id returning * into binding;
  end if;
  insert into public.stream_media_source_binding_events(
    binding_id,event_kind,source_revision,request_id,evidence_digest
  ) values (binding.id,'attached',binding.source_revision,target_request_id,target_evidence_digest)
    on conflict (binding_id,request_id) do nothing;
  perform private.stream_record_source_accounts(binding.id,binding.source_kind,binding.source_identity,
    v_source_owner,asset.owner_id);
  if v_consumer_id is not null then
    insert into public.stream_media_source_account_edges(binding_id,account_id,relation_kind)
      values(binding.id,v_consumer_id,'assigned_member') on conflict do nothing;
  end if;
  if v_canonical_kind='video' then
    perform set_config('app.stream_media_legacy_resolution_event_id',resolution_id::text,true);
    update public.videos set stream_provider_account_registry_id=target_registry_id,
      status=case when v_next_state='ready_for_publication' then 'ready'::public.video_status else status end
      where id::text=v_canonical_identity and cloudflare_uid=observation.captured_uid
        and (stream_provider_account_registry_id is null
          or stream_provider_account_registry_id=target_registry_id);
    perform set_config('app.stream_media_legacy_resolution_event_id','',true);
  end if;
  return jsonb_build_object('outcome',v_next_state,'resolution_id',resolution_id,
    'binding_id',binding.id,'source_revision',binding.source_revision);
exception
  when unique_violation then return jsonb_build_object('outcome','identity_mismatch');
  when lock_not_available then return jsonb_build_object('outcome','source_busy');
  when invalid_text_representation then return jsonb_build_object('outcome','observation_not_reconcilable');
end;
$$;
revoke all on function public.resolve_legacy_stream_media_observation(uuid,uuid,uuid,smallint,boolean,boolean,text)
  from public,anon,authenticated,service_role;
grant execute on function public.resolve_legacy_stream_media_observation(uuid,uuid,uuid,smallint,boolean,boolean,text)
  to service_role;

create function private.guard_program_enrollment_media_retention()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_program_id uuid;
  v_enrollment_id uuid;
  v_member_id uuid;
  v_coach_id uuid;
  v_old_version_id uuid;
  v_new_version_id uuid;
  v_binding_id uuid;
  v_lesson record;
  is_delete boolean := tg_op='DELETE';
  proof_digest text;
begin
  if tg_op='UPDATE' then
    if new.content_version_id is not distinct from old.content_version_id
      and new.program_id is not distinct from old.program_id
      and new.member_id is not distinct from old.member_id then return new; end if;
  end if;
  v_program_id:=case when is_delete then old.program_id else new.program_id end;
  v_enrollment_id:=case when is_delete then old.id else new.id end;
  v_member_id:=case when is_delete then old.member_id else new.member_id end;
  v_old_version_id:=case when tg_op='INSERT' then null else old.content_version_id end;
  v_new_version_id:=case when is_delete then null else new.content_version_id end;
  select program.coach_id into v_coach_id from public.programs program where program.id=v_program_id;
  perform private.stream_require_read_committed();
  perform private.stream_try_lock_accounts(array[v_coach_id,v_member_id]);
  perform private.try_lock_program_media_versions(v_program_id,array_remove(array[v_old_version_id,v_new_version_id],null));
  if (private.stream_account_is_tombstoned(v_coach_id)
      and not (is_delete and private.stream_auth_deletion_permitted(v_coach_id)))
    or (private.stream_account_is_tombstoned(v_member_id)
      and not (is_delete and private.stream_auth_deletion_permitted(v_member_id))) then
    raise exception 'Enrollment media identity is closing' using errcode='55000';
  end if;
  if is_delete and (private.stream_auth_deletion_permitted(v_coach_id)
      or private.stream_auth_deletion_permitted(v_member_id)) then
    -- Account cleanup preserves the immutable pin obligation after the live enrollment cascades.
    return old;
  end if;
  if v_old_version_id is not null and v_old_version_id is distinct from v_new_version_id
    and exists(select 1 from public.program_content_versions version
      where version.id=v_old_version_id and version.revision_kind='free_snapshot') then
    for v_lesson in
      select lesson.id,lesson.cloudflare_uid,version.revision_number::bigint as source_revision,
        coalesce(binding.registry_id,video.stream_provider_account_registry_id) as registry_id
      from public.program_content_version_lessons lesson
      join public.program_content_versions version
        on version.program_id=lesson.program_id and version.id=lesson.content_version_id
      left join public.videos video on video.id=lesson.video_id
      left join public.stream_media_source_bindings binding
        on binding.source_kind='program_lesson' and binding.source_identity=lesson.id::text
          and binding.raw_provider_uid=lesson.cloudflare_uid
          and binding.binding_state in ('legacy_unverified','provisional_bound','ready_for_publication','active','retained','quarantined')
      where lesson.program_id=v_program_id and lesson.content_version_id=v_old_version_id
        and lesson.cloudflare_uid is not null
    loop
      proof_digest:=private.stream_media_identity_digest(concat_ws('|','free_pin_release',
        v_program_id::text,v_enrollment_id::text,v_member_id::text,v_lesson.id::text,v_lesson.cloudflare_uid));
      perform private.stream_set_retention_obligation(v_lesson.registry_id,v_lesson.cloudflare_uid,
        'program_enrollment',v_enrollment_id::text||':'||v_lesson.id::text,v_lesson.source_revision,
        'pinned_free_enrollment',false,v_coach_id,'free_enrollment_pin_released',gen_random_uuid(),proof_digest);
    end loop;
  end if;
  if v_new_version_id is not null and exists(select 1 from public.program_content_versions version
      where version.id=v_new_version_id and version.revision_kind='free_snapshot') then
    for v_lesson in
      select lesson.id,lesson.cloudflare_uid,version.revision_number::bigint as source_revision,
        coalesce(binding.registry_id,video.stream_provider_account_registry_id) as registry_id
      from public.program_content_version_lessons lesson
      join public.program_content_versions version
        on version.program_id=lesson.program_id and version.id=lesson.content_version_id
      left join public.videos video on video.id=lesson.video_id
      left join public.stream_media_source_bindings binding
        on binding.source_kind='program_lesson' and binding.source_identity=lesson.id::text
          and binding.raw_provider_uid=lesson.cloudflare_uid
          and binding.binding_state in ('legacy_unverified','provisional_bound','ready_for_publication','active','retained','quarantined')
      where lesson.program_id=v_program_id and lesson.content_version_id=v_new_version_id
        and lesson.cloudflare_uid is not null
    loop
      proof_digest:=private.stream_media_identity_digest(concat_ws('|','free_pin_retain',
        v_program_id::text,v_enrollment_id::text,v_member_id::text,v_lesson.id::text,v_lesson.cloudflare_uid));
      perform private.stream_set_retention_obligation(v_lesson.registry_id,v_lesson.cloudflare_uid,
        'program_enrollment',v_enrollment_id::text||':'||v_lesson.id::text,v_lesson.source_revision,
        'pinned_free_enrollment',true,v_coach_id,'free_enrollment_pin_created',gen_random_uuid(),proof_digest);
      select binding.id into v_binding_id from public.stream_media_source_bindings binding
        where binding.source_kind='program_lesson' and binding.source_identity=v_lesson.id::text
          and binding.raw_provider_uid=v_lesson.cloudflare_uid and binding.registry_id is not distinct from v_lesson.registry_id
          and binding.binding_state in ('legacy_unverified','provisional_bound','ready_for_publication','active','retained','quarantined')
        order by binding.created_at desc limit 1;
      if v_binding_id is not null then
        insert into public.stream_media_source_account_edges(binding_id,account_id,relation_kind)
          values(v_binding_id,v_member_id,'assigned_member') on conflict do nothing;
      end if;
    end loop;
  end if;
  if is_delete then return old; end if;
  return new;
end;
$$;
revoke all on function private.guard_program_enrollment_media_retention() from public,anon,authenticated,service_role;

create function private.guard_program_market_retention_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_program_id uuid;
  v_owner_id uuid;
begin
  if tg_table_name='programs' then v_program_id:=new.id; else v_program_id:=new.program_id; end if;
  if tg_op='UPDATE' then
    if tg_table_name='programs' then
      if new.published is not distinct from old.published then return new; end if;
    else
      if new.current_content_version_id is not distinct from old.current_content_version_id
        and new.current_offer_version_id is not distinct from old.current_offer_version_id then return new; end if;
    end if;
  end if;
  select program.coach_id into v_owner_id from public.programs program where program.id=v_program_id;
  if v_owner_id is null then return new; end if;
  perform private.stream_require_read_committed();
  perform private.stream_try_lock_accounts(array[v_owner_id]);
  if private.stream_account_is_tombstoned(v_owner_id) then
    raise exception 'Program owner account is closing' using errcode='55000'; end if;
  perform private.sync_program_market_retention(v_program_id);
  return new;
end;
$$;
revoke all on function private.guard_program_market_retention_write() from public,anon,authenticated,service_role;

create function private.guard_program_order_media_retention()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_order_id uuid;
  v_program_id uuid;
  v_buyer_id uuid;
  v_coach_id uuid;
  v_version_id uuid;
begin
  if tg_table_name='program_orders' then
    v_order_id:=new.id; v_program_id:=new.program_id; v_buyer_id:=new.buyer_id; v_version_id:=new.content_version_id;
  else
    v_order_id:=case when tg_op='DELETE' then old.order_id else new.order_id end;
    select orders.program_id,orders.buyer_id,orders.content_version_id
      into v_program_id,v_buyer_id,v_version_id from public.program_orders orders where orders.id=v_order_id;
  end if;
  if v_program_id is null then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  select program.coach_id into v_coach_id from public.programs program where program.id=v_program_id;
  perform private.stream_require_read_committed();
  perform private.stream_try_lock_accounts(array[v_buyer_id,v_coach_id]);
  if private.stream_account_is_tombstoned(v_buyer_id) or private.stream_account_is_tombstoned(v_coach_id) then
    raise exception 'Program order media identity is closing' using errcode='55000'; end if;
  perform private.try_lock_program_media_versions(v_program_id,array[v_version_id]);
  perform private.sync_program_order_retention(v_order_id);
  insert into public.stream_media_source_account_edges(binding_id,account_id,relation_kind)
  select binding.id,v_buyer_id,'assigned_member'
  from public.program_content_version_lessons lesson
  join public.stream_media_source_bindings binding
    on binding.source_kind='program_lesson' and binding.source_identity=lesson.id::text
      and binding.raw_provider_uid=lesson.cloudflare_uid
      and binding.binding_state in ('legacy_unverified','provisional_bound','ready_for_publication','active','retained','quarantined')
  where lesson.program_id=v_program_id and lesson.content_version_id=v_version_id
  on conflict do nothing;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.guard_program_order_media_retention() from public,anon,authenticated,service_role;

create function private.guard_stream_task_assignment_account_edge()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  task_row public.tasks%rowtype;
  item record;
begin
  if tg_op='DELETE' then return old; end if;
  select * into task_row from public.tasks task where task.id=new.task_id;
  if not found then return new; end if;
  perform private.stream_require_read_committed();
  perform private.stream_try_lock_accounts(array[task_row.coach_id,new.member_id]);
  if private.stream_account_is_tombstoned(task_row.coach_id) or private.stream_account_is_tombstoned(new.member_id) then
    raise exception 'Task media account is closing' using errcode='55000'; end if;
  if not private.stream_try_parent_lock('task',task_row.id::text) then
    raise exception 'Task media is busy' using errcode='55P03'; end if;
  for item in select binding.id,binding.registry_id,binding.raw_provider_uid
    from public.stream_media_source_bindings binding
    where binding.source_kind='task' and binding.source_identity=task_row.id::text
      and binding.binding_state in ('legacy_unverified','provisional_bound','ready_for_publication','active','retained','quarantined')
    order by coalesce(binding.registry_id::text,''),binding.raw_provider_uid
  loop
    if not private.stream_try_uid_lock(item.registry_id,item.raw_provider_uid) then
      raise exception 'Task media is busy' using errcode='40001'; end if;
    if private.stream_uid_blocks_new_media_reference(item.registry_id,item.raw_provider_uid) then
      raise exception 'Task media UID is reserved, unresolved, or no longer available' using errcode='55000'; end if;
    insert into public.stream_media_source_account_edges(binding_id,account_id,relation_kind)
      values(item.id,new.member_id,'assigned_member') on conflict do nothing;
  end loop;
  return new;
end;
$$;
revoke all on function private.guard_stream_task_assignment_account_edge() from public,anon,authenticated,service_role;

create function private.guard_stream_daily_content_item_transition()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_item_id uuid := case when tg_op='DELETE' then old.id else new.id end;
  owner_id uuid;
  v_operation_id uuid := private.stream_selected_operation_id();
  video_uid record;
begin
  if tg_op='UPDATE' then
    if new.status is not distinct from old.status then return new; end if;
  end if;
  if tg_op='DELETE' then
    select item.owner_id into owner_id from public.daily_content_items item where item.id=v_item_id;
    if v_operation_id is null or not exists (
      select 1 from public.stream_media_operations operation
      join public.stream_media_operation_states state on state.operation_id=operation.id
      where operation.id=v_operation_id and operation.operation_kind in ('cleanup','account_cleanup')
        and operation.source_kind in ('daily_content_item','account')
        and (operation.source_kind='account' or operation.source_identity=v_item_id::text)
        and ((operation.operation_kind='account_cleanup'
              and state.operation_state in ('completed','retained','auth_call_started','auth_result_unknown','auth_confirmed')
              and private.stream_auth_deletion_permitted(operation.owner_id))
          or (operation.operation_kind='cleanup' and state.operation_state='source_finalizing'
            and exists(select 1 from public.stream_media_manifest_edges edge
              join public.stream_media_source_bindings binding on binding.id=edge.binding_id
              where edge.operation_id=operation.id and binding.parent_kind='daily_content_item'
                and binding.parent_identity=v_item_id::text)))
    ) then raise exception 'Daily Content deletion requires its exact cleanup manifest' using errcode='42501'; end if;
    return old;
  end if;
  select item.owner_id into owner_id from public.daily_content_items item where item.id=v_item_id;
  if owner_id is null then return new; end if;
  perform private.stream_require_read_committed();
  perform private.stream_try_lock_accounts(array[owner_id]);
  if private.stream_account_is_tombstoned(owner_id) then
    raise exception 'Daily Content owner account is closing' using errcode='55000'; end if;
  if not private.stream_try_parent_lock('daily_content_item',v_item_id::text) then
    raise exception 'Daily Content media is busy' using errcode='55P03'; end if;
  for video_uid in
    select distinct coalesce(binding.registry_id,video.stream_provider_account_registry_id) as registry_id,
      video.cloudflare_uid as raw_uid
    from public.daily_content_revisions revision
    join public.videos video on video.id=revision.video_id
    left join public.stream_media_source_bindings binding
      on binding.source_kind='daily_content_revision' and binding.source_identity=revision.id::text
        and binding.raw_provider_uid=video.cloudflare_uid
        and binding.binding_state in ('legacy_unverified','provisional_bound','ready_for_publication','active','retained','quarantined')
    where revision.item_id=v_item_id and video.cloudflare_uid is not null
    order by registry_id,raw_uid
  loop
    if not private.stream_try_uid_lock(video_uid.registry_id,video_uid.raw_uid) then
      raise exception 'Daily Content media is busy' using errcode='55P03'; end if;
    if private.stream_media_uid_reserved(video_uid.registry_id,video_uid.raw_uid) then
      raise exception 'Daily Content media has an active cleanup reservation' using errcode='55P03'; end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.guard_stream_daily_content_item_transition() from public,anon,authenticated,service_role;

create function private.stream_media_uid_reserved(target_registry_id uuid,target_uid text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.stream_media_operation_uid_state uid_state
    join public.stream_media_operation_states state on state.operation_id=uid_state.operation_id
    where uid_state.registry_id=target_registry_id and uid_state.raw_provider_uid=target_uid
      and state.operation_state in ('cleanup_reserved','delete_started','delete_unknown','source_finalizing')
  );
$$;
revoke all on function private.stream_media_uid_reserved(uuid,text)
  from public, anon, authenticated, service_role;

create function private.stream_operation_can_detach(
  target_operation_id uuid,target_binding_id uuid,target_registry_id uuid,target_uid text
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.stream_media_manifest_edges edge
    join public.stream_media_operation_uid_state uid_state
      on uid_state.operation_id=edge.operation_id and uid_state.registry_id=edge.registry_id
        and uid_state.raw_provider_uid=edge.raw_provider_uid
    where edge.operation_id=target_operation_id and edge.binding_id=target_binding_id
      and edge.registry_id=target_registry_id and edge.raw_provider_uid=target_uid
      and edge.detach_allowed
      and uid_state.uid_state in ('retained_attached','deleted_confirmed','already_absent_confirmed')
  );
$$;
revoke all on function private.stream_operation_can_detach(uuid,uuid,uuid,text)
  from public, anon, authenticated, service_role;

create function private.guard_stream_media_reference_write()
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
    select program.coach_id into source_owner from public.programs program where program.id::text=v_parent_identity;
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

create function private.guard_stream_media_video_write()
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
create trigger videos_stream_media_lifecycle_guard
before insert or update or delete on public.videos
for each row execute function private.guard_stream_media_video_write();

create trigger post_media_stream_media_lifecycle_guard
before insert or update or delete on public.post_media
for each row execute function private.guard_stream_media_reference_write('post_media');
create trigger programs_intro_stream_media_lifecycle_guard
before insert or update or delete on public.programs
for each row execute function private.guard_stream_media_reference_write('program_intro');
create trigger program_days_stream_media_lifecycle_guard
before insert or update or delete on public.program_days
for each row execute function private.guard_stream_media_reference_write('program_day');
create trigger program_lessons_stream_media_lifecycle_guard
before insert or update or delete on public.program_content_version_lessons
for each row execute function private.guard_stream_media_reference_write('program_lesson');
create trigger daily_content_revisions_stream_media_lifecycle_guard
before insert or update or delete on public.daily_content_revisions
for each row execute function private.guard_stream_media_reference_write('daily_content_revision');
create trigger daily_content_slots_stream_media_lifecycle_guard
before insert or update or delete on public.daily_content_slots
for each row execute function private.guard_stream_media_reference_write('daily_content_slot');
create trigger daily_content_grants_stream_media_lifecycle_guard
before insert or update or delete on public.member_daily_content_video_grants
for each row execute function private.guard_stream_media_reference_write('daily_content_grant');
create trigger tasks_stream_media_lifecycle_guard
before insert or update or delete on public.tasks
for each row execute function private.guard_stream_media_reference_write('task');
create trigger daily_fuel_assignments_stream_media_lifecycle_guard
before insert or update or delete on public.member_daily_fuel_assignments
for each row execute function private.guard_stream_media_reference_write('daily_fuel_assignment');
create trigger daily_fuel_bookmarks_stream_media_lifecycle_guard
before insert or update or delete on public.member_daily_fuel_bookmarks
for each row execute function private.guard_stream_media_reference_write('daily_fuel_bookmark');

-- Program, enrollment, payment, assignment, and publication changes share the same
-- nonblocking Program/account/UID lock order as cleanup reservations.
create trigger programs_stream_market_retention_guard
after insert or update on public.programs
for each row execute function private.guard_program_market_retention_write();
create trigger program_commerce_state_stream_market_retention_guard
after insert or update on public.program_commerce_state
for each row execute function private.guard_program_market_retention_write();
create trigger program_enrollments_stream_pin_retention_guard
after insert or update or delete on public.program_enrollments
for each row execute function private.guard_program_enrollment_media_retention();
create trigger program_orders_stream_retention_guard
after insert on public.program_orders
for each row execute function private.guard_program_order_media_retention();
create trigger program_order_state_stream_retention_guard
after insert or update on public.program_order_state
for each row execute function private.guard_program_order_media_retention();
create trigger program_payment_events_stream_retention_guard
after insert on public.program_payment_events
for each row execute function private.guard_program_order_media_retention();
create trigger task_assignments_stream_account_edge_guard
after insert or update on public.task_assignments
for each row execute function private.guard_stream_task_assignment_account_edge();
create trigger daily_content_items_stream_media_status_guard
after update on public.daily_content_items
for each row execute function private.guard_stream_daily_content_item_transition();
create trigger daily_content_items_stream_media_delete_guard
before delete on public.daily_content_items
for each row execute function private.guard_stream_daily_content_item_transition();

create policy videos_deny_program_only_direct_select
on public.videos as restrictive for select to authenticated
using (visibility <> 'program_only');
