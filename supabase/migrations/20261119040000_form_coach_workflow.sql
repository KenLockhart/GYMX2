-- Form Coach workflow contracts. This migration defines database state and trusted RPCs only.
-- It does not upload media, call an AI/Stripe/provider API, or make a client-provided result
-- authoritative. Workflow callers must still be integrated and tested before any feature release.

create table public.form_coach_media_policy_versions (
  revision integer primary key check (revision > 0),
  -- The policy schema can represent a future 200 MB reference tier. The active app and
  -- Storage reservation still enforce the conservative 25 MiB deployment ceiling until
  -- the project's actual Storage limit is verified.
  reference_max_bytes bigint not null check (reference_max_bytes between 1 and 200000000),
  member_clip_max_bytes bigint not null check (member_clip_max_bytes between 1 and 26214400),
  member_clip_max_seconds smallint not null check (member_clip_max_seconds between 1 and 60),
  clip_retention_days smallint not null check (clip_retention_days between 1 and 365),
  created_by uuid,
  created_at timestamptz not null default now()
);
create table public.form_coach_media_policy_current (
  singleton boolean primary key default true check (singleton),
  revision integer not null references public.form_coach_media_policy_versions(revision) on delete restrict,
  changed_at timestamptz not null default now(),
  changed_by uuid
);
insert into public.form_coach_media_policy_versions(
  revision, reference_max_bytes, member_clip_max_bytes, member_clip_max_seconds, clip_retention_days
) values (1, 26214400, 26214400, 60, 90);
insert into public.form_coach_media_policy_current(singleton, revision) values (true, 1);

create table public.form_coach_terms_versions (
  version integer primary key check (version > 0),
  document_path text not null check (document_path ~ '^/legal/form-coach/terms/[1-9][0-9]*$'),
  document_sha256 text not null check (document_sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create table public.form_coach_terms_current (
  singleton boolean primary key default true check (singleton),
  version integer not null references public.form_coach_terms_versions(version) on delete restrict,
  changed_at timestamptz not null default now(),
  changed_by uuid not null
);

create table public.form_coach_member_consents (
  id uuid primary key default gen_random_uuid(),
  member_subject_id uuid not null,
  member_owner_id uuid references public.profiles(id) on delete set null,
  terms_version integer not null references public.form_coach_terms_versions(version) on delete restrict,
  accepted_at timestamptz not null default now(),
  check (member_owner_id is null or member_owner_id = member_subject_id),
  unique(member_subject_id, terms_version)
);
create index form_coach_member_consents_owner_idx
  on public.form_coach_member_consents(member_owner_id, accepted_at desc);

create table public.form_coach_templates (
  id uuid primary key default gen_random_uuid(),
  owner_subject_id uuid not null,
  owner_id uuid references public.profiles(id) on delete set null,
  owner_kind text not null check (owner_kind in ('coach', 'admin')),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check (owner_id is null or owner_id = owner_subject_id)
);
create index form_coach_templates_owner_idx on public.form_coach_templates(owner_id, created_at desc);

create table public.form_coach_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.form_coach_templates(id) on delete restrict,
  revision integer not null check (revision > 0),
  exercise_key text not null check (exercise_key in ('dumbbell_curl')),
  schema_version smallint not null check (schema_version = 1),
  template_payload jsonb not null check (jsonb_typeof(template_payload) = 'object'),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null default 'draft' check (state in ('draft', 'published', 'withdrawn')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  published_by uuid,
  published_at timestamptz,
  unique(template_id, revision),
  unique(template_id, id),
  check ((state = 'draft') = (published_at is null)),
  check ((published_at is null) = (published_by is null))
);
create index form_coach_template_versions_current_idx
  on public.form_coach_template_versions(template_id, revision desc);

-- Reserve each private object key before calling Storage. Unknown upload outcomes keep a durable
-- reservation so account deletion cannot finish while an object may still appear later.
create table public.form_coach_media_upload_intents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  asset_kind text not null check (asset_kind in ('template_reference','template_cue','member_clip')),
  owner_subject_id uuid not null,
  owner_id uuid references public.profiles(id) on delete set null,
  template_version_id uuid references public.form_coach_template_versions(id) on delete restrict,
  attempt_id uuid,
  asset_key text,
  bucket_id text not null check (bucket_id in ('form-coach-reference','form-coach-cues','form-coach-clips')),
  storage_path text not null check (
    char_length(storage_path) between 1 and 512
    and storage_path !~ '(^/|(^|/)\.\.?(/|$)|[?#]|^https?://)'
    and split_part(storage_path, '/', 1) = owner_subject_id::text
  ),
  expected_sha256 text not null check (expected_sha256 ~ '^[a-f0-9]{64}$'),
  expected_byte_size bigint not null check (
    (asset_kind in ('template_reference','template_cue') and expected_byte_size between 1 and 200000000)
    or (asset_kind='member_clip' and expected_byte_size between 1 and 26214400)
  ),
  expected_duration_seconds numeric(5,2),
  state text not null default 'reserved'
    check (state in ('reserved','unknown','uploaded','verified','failed','delete_pending','delete_uncertain','deleted')),
  observed_sha256 text check (observed_sha256 is null or observed_sha256 ~ '^[a-f0-9]{64}$'),
  observed_byte_size bigint check (observed_byte_size is null or observed_byte_size > 0),
  observed_duration_seconds numeric(5,2),
  source_proof_digest text check (source_proof_digest is null or source_proof_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (owner_id is null or owner_id = owner_subject_id),
  check (
    (asset_kind='template_reference' and template_version_id is not null and attempt_id is null
      and asset_key='reference' and bucket_id='form-coach-reference' and expected_duration_seconds is null)
    or (asset_kind='template_cue' and template_version_id is not null and attempt_id is null
      and asset_key ~ '^cue_[a-z0-9_]{1,60}$' and bucket_id='form-coach-cues' and expected_duration_seconds is null)
    or (asset_kind='member_clip' and template_version_id is null and attempt_id is not null
      and asset_key is null and bucket_id='form-coach-clips'
      and expected_duration_seconds between 0.01 and 60)
  ),
  check ((state in ('uploaded','verified','delete_pending','delete_uncertain','deleted'))
    = (observed_sha256 is not null and observed_byte_size is not null)),
  check (observed_duration_seconds is null or observed_duration_seconds between 0.01 and 60),
  check (state <> 'verified' or source_proof_digest is not null)
);
create unique index form_coach_media_upload_path_once_idx on public.form_coach_media_upload_intents(bucket_id,storage_path);
create index form_coach_media_upload_owner_state_idx on public.form_coach_media_upload_intents(owner_id,state,created_at);

-- Asset claims remain pending until a later source-guarded media integration explicitly verifies
-- the storage object and account. No public URL or provider UID is accepted here.
create table public.form_coach_template_asset_claims (
  id uuid primary key default gen_random_uuid(),
  upload_intent_id uuid not null unique references public.form_coach_media_upload_intents(id) on delete restrict,
  template_version_id uuid not null references public.form_coach_template_versions(id) on delete restrict,
  owner_subject_id uuid not null,
  asset_key text not null check (asset_key ~ '^(reference|cue_[a-z0-9_]{1,60})$'),
  bucket_id text not null check (bucket_id in ('form-coach-reference', 'form-coach-cues')),
  storage_path text not null check (
    char_length(storage_path) between 1 and 512
    and storage_path !~ '(^/|(^|/)\.\.?(/|$)|[?#])'
    and split_part(storage_path, '/', 1) = owner_subject_id::text
  ),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  byte_size bigint not null check (byte_size > 0),
  source_guard_state text not null default 'pending_source_guard'
    check (source_guard_state in ('pending_source_guard','private_verified','delete_pending','delete_uncertain','deleted')),
  created_at timestamptz not null default now(),
  unique(bucket_id, storage_path),
  unique(template_version_id, asset_key)
);

create table public.form_coach_program_rules (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null unique,
  program_owner_subject_id uuid not null,
  program_owner_id uuid references public.profiles(id) on delete set null,
  revision bigint not null default 1 check (revision > 0),
  generation_id uuid not null default gen_random_uuid(),
  enabled boolean not null default true,
  auto_send boolean not null default false,
  due_days smallint not null default 7 check (due_days between 1 and 30),
  allow_member_clip boolean not null default false,
  changed_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (program_owner_id is null or program_owner_id = program_owner_subject_id)
);
create index form_coach_program_rules_owner_idx
  on public.form_coach_program_rules(program_owner_id, enabled, updated_at desc);

create table public.form_coach_program_rule_items (
  rule_id uuid not null references public.form_coach_program_rules(id) on delete restrict,
  item_ordinal smallint not null check (item_ordinal between 1 and 20),
  template_version_id uuid not null references public.form_coach_template_versions(id) on delete restrict,
  required_reps smallint not null default 8 check (required_reps between 1 and 20),
  pass_threshold numeric(5,2) not null default 75 check (pass_threshold between 0 and 100),
  cues_enabled boolean not null default false,
  max_attempts smallint not null default 3 check (max_attempts between 1 and 3),
  created_at timestamptz not null default now(),
  primary key(rule_id,item_ordinal),
  unique(rule_id,template_version_id)
);
create index form_coach_program_rule_items_version_idx
  on public.form_coach_program_rule_items(template_version_id,rule_id);

create table public.form_coach_assessments (
  id uuid primary key default gen_random_uuid(),
  send_request_id uuid not null unique,
  send_digest text not null check (send_digest ~ '^[a-f0-9]{64}$'),
  source_kind text not null check (source_kind in ('manual', 'program')),
  member_subject_id uuid not null,
  member_owner_id uuid references public.profiles(id) on delete set null,
  coach_subject_id uuid not null,
  coach_owner_id uuid references public.profiles(id) on delete set null,
  program_id uuid,
  program_owner_subject_id uuid,
  program_owner_id uuid references public.profiles(id) on delete set null,
  program_title_snapshot text check (program_title_snapshot is null or char_length(program_title_snapshot) between 1 and 120),
  program_rule_id uuid,
  program_rule_generation uuid,
  source_enrollment_id uuid,
  source_content_version_id uuid,
  sent_by_subject_id uuid not null,
  sent_by_owner_id uuid references public.profiles(id) on delete set null,
  feature_key text not null default 'form_coach' check (feature_key = 'form_coach'),
  payer_role text not null check (payer_role in ('coach', 'member')),
  payer_subject_id uuid not null,
  payer_owner_id uuid references public.profiles(id) on delete set null,
  config_revision bigint not null,
  due_at timestamptz not null,
  allow_member_clip boolean not null default false,
  status text not null default 'sent' check (status in ('sent', 'in_progress', 'completed', 'cancelled', 'expired')),
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (member_owner_id is null or member_owner_id = member_subject_id),
  check (coach_owner_id is null or coach_owner_id = coach_subject_id),
  check (program_owner_id is null or program_owner_id = program_owner_subject_id),
  check (payer_owner_id is null or payer_owner_id = payer_subject_id),
  check ((source_kind = 'program') = (program_id is not null)),
  check ((source_kind = 'program') = (program_rule_id is not null)),
  check ((source_kind = 'program') = (program_rule_generation is not null)),
  check ((program_id is null) = (program_title_snapshot is null)),
  foreign key(feature_key, config_revision)
    references public.feature_pricing_revisions(feature_key, revision) on delete restrict
);
create unique index form_coach_assessment_rule_generation_once_idx
  on public.form_coach_assessments(member_subject_id, program_id, program_rule_generation)
  where source_kind = 'program';
create index form_coach_assessments_member_idx
  on public.form_coach_assessments(member_owner_id, sent_at desc);
create index form_coach_assessments_coach_idx
  on public.form_coach_assessments(coach_owner_id, sent_at desc);

create table public.form_coach_assessment_items (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.form_coach_assessments(id) on delete restrict,
  item_ordinal smallint not null check (item_ordinal between 1 and 20),
  item_key text not null check (item_key ~ '^[a-z0-9_]{1,64}$'),
  item_title_snapshot text not null check (char_length(btrim(item_title_snapshot)) between 1 and 120),
  template_version_id uuid not null references public.form_coach_template_versions(id) on delete restrict,
  exercise_key text not null check (exercise_key in ('dumbbell_curl')),
  required_reps smallint not null default 8 check (required_reps between 1 and 20),
  pass_threshold numeric(5,2) not null default 75 check (pass_threshold between 0 and 100),
  cues_enabled boolean not null default false,
  max_attempts smallint not null default 3 check (max_attempts between 1 and 3),
  created_at timestamptz not null default now(),
  unique(assessment_id, item_ordinal),
  unique(assessment_id, item_key),
  unique(id, assessment_id)
);
create index form_coach_assessment_items_assessment_idx
  on public.form_coach_assessment_items(assessment_id, item_ordinal);

create table public.form_coach_attempts (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null,
  item_id uuid not null,
  member_subject_id uuid not null,
  attempt_number smallint not null check (attempt_number between 1 and 12),
  state text not null default 'running' check (state in ('running', 'finished', 'abandoned')),
  lease_token uuid not null,
  lease_expires_at timestamptz not null,
  clip_opt_in boolean not null default false,
  consent_terms_version integer not null references public.form_coach_terms_versions(version) on delete restrict,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  abandoned_at timestamptz,
  result_digest text check (result_digest is null or result_digest ~ '^[a-f0-9]{64}$'),
  foreign key(item_id, assessment_id)
    references public.form_coach_assessment_items(id, assessment_id) on delete restrict,
  unique(item_id, attempt_number),
  unique(id, assessment_id),
  check ((state = 'finished') = (finished_at is not null)),
  check ((state = 'abandoned') = (abandoned_at is not null)),
  check ((state = 'finished') = (result_digest is not null))
);
create index form_coach_attempts_item_idx
  on public.form_coach_attempts(item_id, attempt_number desc);
create index form_coach_attempts_active_lease_idx
  on public.form_coach_attempts(lease_expires_at) where state = 'running';
alter table public.form_coach_media_upload_intents
  add constraint form_coach_media_upload_attempt_fk
  foreign key(attempt_id) references public.form_coach_attempts(id) on delete restrict;

create table public.form_coach_attempt_requests (
  request_id uuid primary key,
  attempt_id uuid not null references public.form_coach_attempts(id) on delete restrict,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  lease_token uuid not null,
  created_at timestamptz not null default now(),
  unique(attempt_id, request_id)
);

create table public.form_coach_attempt_rep_results (
  attempt_id uuid not null references public.form_coach_attempts(id) on delete restrict,
  rep_number smallint not null check (rep_number between 1 and 20),
  score numeric(5,2) not null check (score between 0 and 100),
  rom_min_angle numeric(5,2) not null check (rom_min_angle between 0 and 180),
  rom_max_angle numeric(5,2) not null check (rom_max_angle between 0 and 180 and rom_min_angle < rom_max_angle),
  rom_score numeric(5,2) not null check (rom_score between 0 and 100),
  max_upper_arm_drift numeric(5,2) not null check (max_upper_arm_drift between 0 and 180),
  max_torso_swing numeric(5,2) not null check (max_torso_swing between 0 and 180),
  max_shrug numeric(5,4) not null check (max_shrug between 0 and 1),
  concentric_ms integer not null check (concentric_ms between 100 and 15000),
  top_pause_ms integer not null check (top_pause_ms between 0 and 15000),
  eccentric_ms integer not null check (eccentric_ms between 100 and 15000),
  curve_similarity numeric(5,2) not null check (curve_similarity between 0 and 100),
  elbow_score numeric(5,2) not null check (elbow_score between 0 and 100),
  torso_score numeric(5,2) not null check (torso_score between 0 and 100),
  tempo_score numeric(5,2) not null check (tempo_score between 0 and 100),
  shoulders_score numeric(5,2) not null check (shoulders_score between 0 and 100),
  faults text[] not null default '{}',
  recorded_at timestamptz not null default now(),
  primary key(attempt_id, rep_number),
  check (faults <@ array['elbow_drift','torso_swing','short_rom_bottom','short_rom_top','eccentric_too_fast','shoulder_shrug','clean_rep']::text[])
);

create table public.form_coach_attempt_results (
  attempt_id uuid primary key references public.form_coach_attempts(id) on delete restrict,
  result_digest text not null check (result_digest ~ '^[a-f0-9]{64}$'),
  rep_count smallint not null check (rep_count between 1 and 20),
  average_score numeric(5,2) not null check (average_score between 0 and 100),
  numeric_summary jsonb not null check (jsonb_typeof(numeric_summary) = 'object'),
  summary_state text not null default 'pending' check (summary_state in ('pending','complete','unavailable')),
  coach_summary text check (coach_summary is null or (char_length(btrim(coach_summary)) between 1 and 1000 and coach_summary !~ '[<>]')),
  created_at timestamptz not null default now(),
  check ((summary_state = 'complete') = (coach_summary is not null))
);

create table public.form_coach_reviews (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  assessment_id uuid not null,
  item_id uuid not null,
  attempt_id uuid not null,
  coach_subject_id uuid not null,
  coach_owner_id uuid references public.profiles(id) on delete set null,
  verdict text not null check (verdict in ('learned', 'needs_work')),
  feedback text not null default '' check (char_length(feedback) <= 1000),
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  review_sequence integer not null check (review_sequence > 0),
  created_at timestamptz not null default now(),
  foreign key(item_id, assessment_id)
    references public.form_coach_assessment_items(id, assessment_id) on delete restrict,
  foreign key(attempt_id, assessment_id)
    references public.form_coach_attempts(id, assessment_id) on delete restrict,
  unique(item_id, review_sequence),
  check (coach_owner_id is null or coach_owner_id = coach_subject_id)
);
create index form_coach_reviews_attempt_idx on public.form_coach_reviews(attempt_id, review_sequence desc);

create table public.form_coach_retry_windows (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null unique references public.form_coach_reviews(id) on delete restrict,
  assessment_id uuid not null,
  item_id uuid not null,
  opened_by_subject_id uuid not null,
  opened_by_owner_id uuid references public.profiles(id) on delete set null,
  additional_attempts smallint not null default 1 check (additional_attempts between 1 and 3),
  opens_at timestamptz not null default now(),
  closes_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key(item_id, assessment_id)
    references public.form_coach_assessment_items(id, assessment_id) on delete restrict,
  check (closes_at > opens_at and closes_at <= opens_at + interval '30 days'),
  check (opened_by_owner_id is null or opened_by_owner_id = opened_by_subject_id)
);

create table public.form_coach_attempt_clips (
  id uuid primary key default gen_random_uuid(),
  upload_intent_id uuid not null unique references public.form_coach_media_upload_intents(id) on delete restrict,
  attempt_id uuid not null unique references public.form_coach_attempts(id) on delete restrict,
  member_subject_id uuid not null,
  member_owner_id uuid references public.profiles(id) on delete set null,
  bucket_id text not null default 'form-coach-clips' check (bucket_id = 'form-coach-clips'),
  storage_path text not null check (
    char_length(storage_path) between 1 and 512
    and storage_path !~ '(^/|(^|/)\.\.?(/|$)|[?#])'
    and split_part(storage_path, '/', 1) = member_subject_id::text
  ),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  byte_size bigint not null check (byte_size > 0),
  duration_seconds numeric(5,2) not null check (duration_seconds > 0 and duration_seconds <= 60),
  delete_after timestamptz not null,
  state text not null default 'pending_source_guard'
    check (state in ('pending_source_guard', 'available', 'delete_pending', 'deleted', 'delete_uncertain')),
  delete_requested_at timestamptz,
  created_at timestamptz not null default now(),
  check (member_owner_id is null or member_owner_id = member_subject_id),
  check ((state in ('delete_pending','deleted','delete_uncertain')) = (delete_requested_at is not null))
);
create index form_coach_attempt_clips_retention_idx
  on public.form_coach_attempt_clips(delete_after) where state = 'available';

create table public.form_coach_summary_outbox (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique references public.form_coach_attempts(id) on delete restrict,
  prompt_version text not null check (prompt_version = 'attempt-summary-v1'),
  numeric_payload jsonb not null check (jsonb_typeof(numeric_payload) = 'object'),
  state text not null default 'pending' check (state in ('pending', 'claimed', 'complete', 'unavailable', 'suppressed')),
  claim_token uuid,
  lease_expires_at timestamptz,
  completed_digest text check (completed_digest is null or completed_digest ~ '^[a-f0-9]{64}$'),
  attempt_count smallint not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'claimed') = (claim_token is not null and lease_expires_at is not null))
  ,check ((state in ('complete','unavailable')) = (completed_digest is not null))
);
create index form_coach_summary_outbox_pending_idx
  on public.form_coach_summary_outbox(created_at) where state in ('pending','claimed');

create table public.form_coach_program_send_outbox (
  id uuid primary key default gen_random_uuid(),
  member_subject_id uuid not null,
  member_owner_id uuid references public.profiles(id) on delete set null,
  program_id uuid not null,
  program_owner_subject_id uuid not null,
  program_owner_id uuid references public.profiles(id) on delete set null,
  program_title_snapshot text not null check (char_length(program_title_snapshot) between 1 and 120),
  rule_id uuid not null,
  rule_generation uuid not null,
  due_days smallint not null check (due_days between 1 and 30),
  allow_member_clip boolean not null default false,
  source_content_version_id uuid,
  source_enrollment_id uuid,
  state text not null default 'pending' check (state in ('pending','awaiting_funds','claimed','sent','suppressed')),
  next_attempt_at timestamptz not null default now(),
  claim_attempt_count integer not null default 0 check (claim_attempt_count >= 0),
  assessment_id uuid,
  last_outcome text,
  claim_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (member_owner_id is null or member_owner_id = member_subject_id),
  check (program_owner_id is null or program_owner_id = program_owner_subject_id),
  check (
    (state = 'claimed' and claim_token is not null and lease_expires_at is not null)
    or (state <> 'claimed' and claim_token is null and lease_expires_at is null)
  ),
  unique(member_subject_id, program_id, rule_generation)
);
create index form_coach_program_send_outbox_pending_idx
  on public.form_coach_program_send_outbox(next_attempt_at,created_at,id)
  where state in ('pending','awaiting_funds');

create table public.form_coach_program_send_outbox_items (
  outbox_id uuid not null references public.form_coach_program_send_outbox(id) on delete restrict,
  item_ordinal smallint not null check (item_ordinal between 1 and 20),
  template_version_id uuid not null references public.form_coach_template_versions(id) on delete restrict,
  required_reps smallint not null check (required_reps between 1 and 20),
  pass_threshold numeric(5,2) not null check (pass_threshold between 0 and 100),
  cues_enabled boolean not null,
  max_attempts smallint not null check (max_attempts between 1 and 3),
  created_at timestamptz not null default now(),
  primary key(outbox_id,item_ordinal),
  unique(outbox_id,template_version_id)
);
create index form_coach_program_send_outbox_items_version_idx
  on public.form_coach_program_send_outbox_items(template_version_id,outbox_id);

create table public.form_coach_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique check (char_length(event_key) between 1 and 180),
  recipient_subject_id uuid not null,
  recipient_owner_id uuid references public.profiles(id) on delete set null,
  assessment_id uuid,
  event_kind text not null check (event_kind in ('assessment_sent','assessment_submitted',
    'coach_funding_needed','review_recorded','retry_opened')),
  state text not null default 'pending' check (state in ('pending','claimed','recorded','suppressed')),
  claim_token uuid,
  lease_expires_at timestamptz,
  attempt_count smallint not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (recipient_owner_id is null or recipient_owner_id = recipient_subject_id),
  check ((state = 'claimed') = (claim_token is not null and lease_expires_at is not null))
);
create index form_coach_notification_outbox_pending_idx
  on public.form_coach_notification_outbox(created_at) where state in ('pending','claimed');

create table public.form_coach_media_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  asset_kind text not null default 'upload_intent' check (asset_kind='upload_intent'),
  asset_id uuid not null references public.form_coach_media_upload_intents(id) on delete restrict,
  bucket_id text not null check (bucket_id in ('form-coach-reference','form-coach-cues','form-coach-clips')),
  storage_path text not null check (char_length(storage_path) between 1 and 512),
  state text not null default 'pending' check (state in ('pending','claimed','complete','uncertain')),
  claim_token uuid,
  lease_expires_at timestamptz,
  evidence_digest text check (evidence_digest is null or evidence_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(bucket_id, storage_path),
  check ((state = 'claimed') = (claim_token is not null and lease_expires_at is not null)),
  check ((state = 'complete') = (evidence_digest is not null))
);
create index form_coach_media_cleanup_pending_idx
  on public.form_coach_media_cleanup_queue(created_at) where state in ('pending','claimed','uncertain');

-- PostgreSQL exposes jsonb_object_keys rather than a jsonb_object_length builtin. Keep malformed
-- scalar/array input safe so every schema validator fails closed instead of raising unexpectedly.
create function private.form_coach_json_object_key_count(target jsonb)
returns integer language sql immutable set search_path = '' as $$
  select count(*)::integer from jsonb_object_keys(
    case when jsonb_typeof(target)='object' then target else '{}'::jsonb end
  );
$$;
revoke all on function private.form_coach_json_object_key_count(jsonb) from public,anon,authenticated,service_role;

-- Private buckets start at the conservative 25 MiB active limit; later configuration must also
-- respect each bucket's actual file_size_limit.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values
  ('form-coach-reference', 'form-coach-reference', false, 26214400, array['video/mp4','video/webm']),
  ('form-coach-cues', 'form-coach-cues', false, 26214400, array['audio/mpeg','audio/mp4','audio/webm','audio/ogg']),
  ('form-coach-clips', 'form-coach-clips', false, 26214400, array['video/mp4','video/webm'])
on conflict (id) do nothing;

-- Do not silently inherit a public bucket or an incompatible MIME policy from an existing
-- deployment. An operator may lower the active object cap; request/upload paths always use the
-- minimum of the live Storage cap and the versioned Form Coach policy.
do $$
declare incompatible_bucket text;
begin
  select expected.id into incompatible_bucket
  from (values
    ('form-coach-reference', array['video/mp4','video/webm']::text[], 200000000::bigint),
    ('form-coach-cues', array['audio/mpeg','audio/mp4','audio/webm','audio/ogg']::text[], 200000000::bigint),
    ('form-coach-clips', array['video/mp4','video/webm']::text[], 26214400::bigint)
  ) expected(id, mime_types, structural_max_bytes)
  left join storage.buckets bucket on bucket.id=expected.id
  where bucket.id is null or bucket.public is distinct from false
    or bucket.file_size_limit is null or bucket.file_size_limit<1
    or bucket.file_size_limit>expected.structural_max_bytes
    or bucket.allowed_mime_types is null
    or cardinality(bucket.allowed_mime_types)<>cardinality(expected.mime_types)
    or not (bucket.allowed_mime_types @> expected.mime_types)
    or not (expected.mime_types @> bucket.allowed_mime_types)
  limit 1;
  if incompatible_bucket is not null then
    raise exception 'Form Coach Storage bucket is missing or incompatible: %', incompatible_bucket
      using errcode='55000';
  end if;
end;
$$;

-- Browser uploads use one immutable reserved path per object. The RLS predicate checks the exact
-- intent and takes the shared account-ingress transaction lock in the same INSERT as
-- storage.objects metadata. Thus a closing tombstone either wins first, or waits until this row is
-- visible to the component cleanup inventory. These private buckets never allow browser reads,
-- updates/upserts, or deletes; the app returns short-lived signed read URLs and service cleanup
-- owns deletion.
create function private.form_coach_storage_insert_allowed(
  target_bucket_id text, target_name text, target_metadata jsonb
)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); metadata_size numeric; metadata_type text;
  bucket_row storage.buckets%rowtype; intent public.form_coach_media_upload_intents%rowtype;
  profile_role public.user_role; version_row public.form_coach_template_versions%rowtype;
  template_row public.form_coach_templates%rowtype; assessment public.form_coach_assessments%rowtype;
  attempt public.form_coach_attempts%rowtype; policy_row public.form_coach_media_policy_versions%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null
    or target_bucket_id not in ('form-coach-reference','form-coach-cues','form-coach-clips')
    or target_name is null or target_name !~ '^[0-9a-f-]{36}/'
    or split_part(target_name,'/',1)<>actor_id::text
    or target_metadata is null or jsonb_typeof(target_metadata) is distinct from 'object'
    or jsonb_typeof(target_metadata->'size') not in ('number','string')
    or jsonb_typeof(target_metadata->'mimetype') is distinct from 'string' then
    return false;
  end if;
  begin
    metadata_size:=(target_metadata->>'size')::numeric;
  exception when others then return false;
  end;
  if metadata_size is null or metadata_size<=0 or metadata_size<>trunc(metadata_size)
    or metadata_size>9223372036854775807 then return false; end if;
  metadata_type:=target_metadata->>'mimetype';
  if not private.stream_media_account_ingress_allowed(actor_id)
    or private.form_coach_subject_has_deletion_fence(actor_id) then return false; end if;
  select bucket.* into bucket_row from storage.buckets bucket
  where bucket.id=target_bucket_id and bucket.public is false;
  if not found or bucket_row.file_size_limit is null or metadata_size>bucket_row.file_size_limit
    or bucket_row.allowed_mime_types is null or not (metadata_type=any(bucket_row.allowed_mime_types)) then return false; end if;
  select upload.* into intent from public.form_coach_media_upload_intents upload
  where upload.owner_subject_id=actor_id and upload.owner_id=actor_id
    and upload.bucket_id=target_bucket_id and upload.storage_path=target_name
    and upload.state in ('reserved','unknown') for share;
  if not found or intent.expected_byte_size<>metadata_size then return false; end if;
  select profile.role into profile_role from public.profiles profile where profile.id=actor_id;
  if intent.asset_kind in ('template_reference','template_cue') then
    if profile_role not in ('coach'::public.user_role,'admin'::public.user_role)
      or not private.form_coach_coach_can_manage_templates(actor_id) then return false; end if;
    select version.* into version_row from public.form_coach_template_versions version
    where version.id=intent.template_version_id and version.state='draft';
    if not found then return false; end if;
    select template.* into template_row from public.form_coach_templates template
    where template.id=version_row.template_id and template.owner_id=actor_id
      and template.owner_subject_id=actor_id and template.archived_at is null;
    if not found or not private.form_coach_can_manage_template(template_row.id,actor_id) then return false; end if;
    if (intent.asset_kind='template_reference' and target_bucket_id<>'form-coach-reference')
      or (intent.asset_kind='template_cue' and target_bucket_id<>'form-coach-cues') then return false; end if;
    select policy.* into policy_row from public.form_coach_media_policy_current current
    join public.form_coach_media_policy_versions policy on policy.revision=current.revision
    where current.singleton;
    if not found or metadata_size>policy_row.reference_max_bytes then return false; end if;
  elsif intent.asset_kind='member_clip' then
    if profile_role is distinct from 'member'::public.user_role or target_bucket_id<>'form-coach-clips' then return false; end if;
    select clip_attempt.* into attempt from public.form_coach_attempts clip_attempt
    where clip_attempt.id=intent.attempt_id and clip_attempt.member_subject_id=actor_id
      and clip_attempt.clip_opt_in=true and clip_attempt.state in ('running','finished');
    if not found then return false; end if;
    select form_assessment.* into assessment from public.form_coach_assessments form_assessment
    where form_assessment.id=attempt.assessment_id and form_assessment.member_subject_id=actor_id
      and form_assessment.member_owner_id=actor_id and form_assessment.allow_member_clip=true;
    if not found or assessment.status='cancelled' or split_part(target_name,'/',2)<>assessment.id::text
      or split_part(target_name,'/',3)<>attempt.id::text
      or not exists(select 1 from public.form_coach_member_consents consent
        where consent.member_subject_id=actor_id and consent.member_owner_id=actor_id
          and consent.terms_version=attempt.consent_terms_version) then return false; end if;
    select policy.* into policy_row from public.form_coach_media_policy_current current
    join public.form_coach_media_policy_versions policy on policy.revision=current.revision
    where current.singleton;
    if not found or metadata_size>policy_row.member_clip_max_bytes
      or intent.expected_duration_seconds>policy_row.member_clip_max_seconds then return false; end if;
  else
    return false;
  end if;
  return true;
exception when others then
  return false;
end;
$$;
revoke all on function private.form_coach_storage_insert_allowed(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.form_coach_storage_insert_allowed(text,text,jsonb) to authenticated;

create policy form_coach_storage_insert_reserved on storage.objects
  for insert to authenticated
  with check (private.form_coach_storage_insert_allowed(bucket_id,name,metadata));
create policy form_coach_storage_insert_guard on storage.objects as restrictive
  for insert to public
  with check (bucket_id not in ('form-coach-reference','form-coach-cues','form-coach-clips')
    or private.form_coach_storage_insert_allowed(bucket_id,name,metadata));
create policy form_coach_storage_select_guard on storage.objects as restrictive
  for select to public
  using (bucket_id not in ('form-coach-reference','form-coach-cues','form-coach-clips'));
create policy form_coach_storage_update_guard on storage.objects as restrictive
  for update to public
  using (bucket_id not in ('form-coach-reference','form-coach-cues','form-coach-clips'))
  with check (bucket_id not in ('form-coach-reference','form-coach-cues','form-coach-clips'));
create policy form_coach_storage_delete_guard on storage.objects as restrictive
  for delete to public
  using (bucket_id not in ('form-coach-reference','form-coach-cues','form-coach-clips'));

create function private.form_coach_valid_template_payload(target_exercise text, payload jsonb)
returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  weights jsonb;
  reference jsonb;
  tolerances jsonb;
  segmentation jsonb;
  breathing jsonb;
  cue jsonb;
  value numeric;
  weight_total numeric;
begin
  if target_exercise is distinct from 'dumbbell_curl' or payload is null or jsonb_typeof(payload) is distinct from 'object'
    or (payload - array['exerciseKey','schemaVersion','cameraView','arm','segmentation','reference',
      'tolerances','scoringWeights','strictness','cues','breathing']) <> '{}'::jsonb
    or private.form_coach_json_object_key_count(payload) <> 11
    or jsonb_typeof(payload->'exerciseKey') is distinct from 'string'
    or jsonb_typeof(payload->'schemaVersion') is distinct from 'number'
    or jsonb_typeof(payload->'cameraView') is distinct from 'string'
    or jsonb_typeof(payload->'arm') is distinct from 'string'
    or jsonb_typeof(payload->'strictness') is distinct from 'string'
    or payload->>'exerciseKey' <> target_exercise or (payload->>'schemaVersion')::numeric <> 1
    or payload->>'cameraView' not in ('side','front','three_quarter')
    or payload->>'arm' not in ('left','right','both','auto')
    or payload->>'strictness' not in ('beginner','standard','strict')
    or jsonb_typeof(payload->'segmentation') is distinct from 'object'
    or jsonb_typeof(payload->'reference') is distinct from 'object'
    or jsonb_typeof(payload->'tolerances') is distinct from 'object'
    or jsonb_typeof(payload->'scoringWeights') is distinct from 'object'
    or jsonb_typeof(payload->'cues') is distinct from 'array'
    or jsonb_array_length(payload->'cues') > 32
    or jsonb_typeof(payload->'breathing') is distinct from 'object' then
    return false;
  end if;
  segmentation := payload->'segmentation'; reference := payload->'reference';
  tolerances := payload->'tolerances'; weights := payload->'scoringWeights'; breathing := payload->'breathing';
  if jsonb_typeof(segmentation) is distinct from 'object'
    or jsonb_typeof(reference) is distinct from 'object'
    or jsonb_typeof(tolerances) is distinct from 'object'
    or jsonb_typeof(weights) is distinct from 'object'
    or jsonb_typeof(breathing) is distinct from 'object'
    or (segmentation - array['metric','extendedThreshold','flexedThreshold']) <> '{}'::jsonb
    or private.form_coach_json_object_key_count(segmentation) <> 3 or jsonb_typeof(segmentation->'metric') is distinct from 'string'
    or jsonb_typeof(segmentation->'extendedThreshold') is distinct from 'number'
    or jsonb_typeof(segmentation->'flexedThreshold') is distinct from 'number'
    or segmentation->>'metric' <> 'elbowAngle'
    or (reference - array['romMinAngle','romMaxAngle','concentricMs','topPauseMs','eccentricMs','elbowCurve']) <> '{}'::jsonb
    or private.form_coach_json_object_key_count(reference) <> 6
    or exists(select 1 from jsonb_each(reference) field
      where field.key<>'elbowCurve' and jsonb_typeof(field.value) is distinct from 'number')
    or (tolerances - array['romTopDeg','romBottomDeg','upperArmDriftDeg','torsoSwingDeg','shrugRatio','tempoPct']) <> '{}'::jsonb
    or private.form_coach_json_object_key_count(tolerances) <> 6
    or exists(select 1 from jsonb_each(tolerances) field where jsonb_typeof(field.value) is distinct from 'number')
    or (weights - array['rom','elbow','torso','tempo','shoulders']) <> '{}'::jsonb
    or private.form_coach_json_object_key_count(weights) <> 5
    or exists(select 1 from jsonb_each(weights) field where jsonb_typeof(field.value) is distinct from 'number')
    or (breathing - array['concentric','eccentric','fullCueReps','thenEvery']) <> '{}'::jsonb
    or private.form_coach_json_object_key_count(breathing) <> 4
    or jsonb_typeof(breathing->'concentric') is distinct from 'string'
    or jsonb_typeof(breathing->'eccentric') is distinct from 'string'
    or jsonb_typeof(breathing->'fullCueReps') is distinct from 'number'
    or jsonb_typeof(breathing->'thenEvery') is distinct from 'number'
    or (breathing->>'fullCueReps')::numeric<>trunc((breathing->>'fullCueReps')::numeric)
    or (breathing->>'thenEvery')::numeric<>trunc((breathing->>'thenEvery')::numeric)
    or breathing->>'concentric' <> 'exhale' or breathing->>'eccentric' <> 'inhale'
    or jsonb_typeof(reference->'elbowCurve') <> 'array'
    or jsonb_array_length(reference->'elbowCurve') <> 50 then
    return false;
  end if;
  if (segmentation->>'extendedThreshold')::numeric not between 120 and 179.999
    or (segmentation->>'flexedThreshold')::numeric not between 20 and 90
    or (segmentation->>'extendedThreshold')::numeric <= (segmentation->>'flexedThreshold')::numeric + 10
    or (reference->>'romMinAngle')::numeric not between 0 and 180
    or (reference->>'romMaxAngle')::numeric not between 0 and 180
    or (reference->>'romMinAngle')::numeric >= (reference->>'romMaxAngle')::numeric
    or (reference->>'concentricMs')::numeric not between 100 and 15000
    or (reference->>'topPauseMs')::numeric not between 0 and 15000
    or (reference->>'eccentricMs')::numeric not between 100 and 15000
    or (tolerances->>'romTopDeg')::numeric not between 0.1 and 90
    or (tolerances->>'romBottomDeg')::numeric not between 0.1 and 90
    or (tolerances->>'upperArmDriftDeg')::numeric not between 0.1 and 90
    or (tolerances->>'torsoSwingDeg')::numeric not between 0.1 and 90
    or (tolerances->>'shrugRatio')::numeric not between 0.001 and 1
    or (tolerances->>'tempoPct')::numeric not between 1 and 100
    or (breathing->>'fullCueReps')::integer not between 1 and 10
    or (breathing->>'thenEvery')::integer not between 1 and 10 then
    return false;
  end if;
  if exists(select 1 from jsonb_array_elements(reference->'elbowCurve') point(value)
    where jsonb_typeof(point.value) is distinct from 'number') then return false; end if;
  weight_total := 0;
  foreach value in array array[(weights->>'rom')::numeric,(weights->>'elbow')::numeric,
    (weights->>'torso')::numeric,(weights->>'tempo')::numeric,(weights->>'shoulders')::numeric] loop
    if value < 0 or value > 100 then return false; end if;
    weight_total := weight_total + value;
  end loop;
  if abs(weight_total - 100) >= 0.01 then return false; end if;
  for cue in
    select cue_entry.cue_value
    from jsonb_array_elements(payload->'cues') as cue_entry(cue_value)
  loop
    if jsonb_typeof(cue) is distinct from 'object'
      or (cue - array['key','fault','text','priority','minPersistMs','cooldownMs','audioPath']) <> '{}'::jsonb
      or private.form_coach_json_object_key_count(cue) not between 6 and 7
      or jsonb_typeof(cue->'key') is distinct from 'string'
      or jsonb_typeof(cue->'fault') is distinct from 'string'
      or jsonb_typeof(cue->'text') is distinct from 'string'
      or jsonb_typeof(cue->'priority') is distinct from 'number'
      or jsonb_typeof(cue->'minPersistMs') is distinct from 'number'
      or jsonb_typeof(cue->'cooldownMs') is distinct from 'number'
      or coalesce(cue->>'key' !~ '^[a-z0-9_]{1,64}$',true)
      or cue->>'fault' not in ('elbow_drift','torso_swing','short_rom_bottom','short_rom_top',
        'eccentric_too_fast','shoulder_shrug','clean_rep')
      or char_length(btrim(cue->>'text')) not between 1 and 200
      or (cue->>'priority')::integer not between 1 and 10
      or (cue->>'minPersistMs')::integer not between 0 and 10000
      or (cue->>'cooldownMs')::integer not between 0 and 60000
      or (cue->>'priority')::numeric<>trunc((cue->>'priority')::numeric)
      or (cue->>'minPersistMs')::numeric<>trunc((cue->>'minPersistMs')::numeric)
      or (cue->>'cooldownMs')::numeric<>trunc((cue->>'cooldownMs')::numeric)
      or (cue ? 'audioPath' and (
        jsonb_typeof(cue->'audioPath') is distinct from 'string'
        or char_length(cue->>'audioPath') not between 1 and 512
        or cue->>'audioPath' ~ '(^/|^https?://|(^|/)\.\.?(/|$)|[?#])'
      )) then
      return false;
    end if;
  end loop;
  for value in select (curve.value #>> '{}')::numeric from jsonb_array_elements(reference->'elbowCurve') curve(value) loop
    if value < 0 or value > 180 then return false; end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;
revoke all on function private.form_coach_valid_template_payload(text, jsonb) from public, anon, authenticated, service_role;

create function private.form_coach_numeric_summary_valid(payload jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(payload) = 'object'
    and private.form_coach_json_object_key_count(payload) between 1 and 24
    and not exists (
      select 1 from jsonb_each(payload) entry
      where entry.key not in ('rep_count','average_score','minimum_score','maximum_score',
        'rom_min_angle_average','rom_max_angle_average','rom_average','elbow_average','torso_average',
        'tempo_average','shoulders_average','max_upper_arm_drift','max_torso_swing','max_shrug',
        'concentric_ms_average','top_pause_ms_average','eccentric_ms_average','curve_similarity_average',
        'elbow_drift_count','torso_swing_count','short_rom_count','shoulder_shrug_count')
        or jsonb_typeof(entry.value) <> 'number'
    ),false);
$$;
revoke all on function private.form_coach_numeric_summary_valid(jsonb) from public, anon, authenticated, service_role;

create function private.form_coach_assessment_items_valid(items jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb; item_id uuid; seen_ids uuid[] := '{}'; item_count integer;
begin
  if items is null or jsonb_typeof(items) is distinct from 'array'
    or jsonb_array_length(items) not between 1 and 20 then return false; end if;
  for item in select value from jsonb_array_elements(items) entries(value) loop
    if jsonb_typeof(item) is distinct from 'object'
      or private.form_coach_json_object_key_count(item) not between 1 and 5
      or (item - array['template_version_id','required_reps','pass_threshold','cues_enabled','max_attempts']) <> '{}'::jsonb
      or jsonb_typeof(item->'template_version_id') is distinct from 'string'
      or (item ? 'required_reps' and (jsonb_typeof(item->'required_reps') is distinct from 'number'
        or (item->>'required_reps')::numeric <> trunc((item->>'required_reps')::numeric)
        or (item->>'required_reps')::integer not between 1 and 20))
      or (item ? 'pass_threshold' and (jsonb_typeof(item->'pass_threshold') is distinct from 'number'
        or (item->>'pass_threshold')::numeric not between 0 and 100))
      or (item ? 'cues_enabled' and jsonb_typeof(item->'cues_enabled') is distinct from 'boolean')
      or (item ? 'max_attempts' and (jsonb_typeof(item->'max_attempts') is distinct from 'number'
        or (item->>'max_attempts')::numeric <> trunc((item->>'max_attempts')::numeric)
        or (item->>'max_attempts')::integer not between 1 and 3)) then return false; end if;
    item_id := (item->>'template_version_id')::uuid;
    if item_id is null or item_id = any(seen_ids) then return false; end if;
    seen_ids := array_append(seen_ids,item_id);
  end loop;
  select count(*)::integer into item_count from jsonb_array_elements(items);
  return item_count = cardinality(seen_ids);
exception when others then
  return false;
end;
$$;
revoke all on function private.form_coach_assessment_items_valid(jsonb) from public,anon,authenticated,service_role;

create function private.form_coach_normalize_assessment_items(items jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case when private.form_coach_assessment_items_valid(items) then (
    select jsonb_agg(jsonb_build_object(
      'template_version_id',entry.value->>'template_version_id',
      'required_reps',coalesce((entry.value->>'required_reps')::integer,8),
      'pass_threshold',coalesce((entry.value->>'pass_threshold')::numeric,75),
      'cues_enabled',coalesce((entry.value->>'cues_enabled')::boolean,false),
      'max_attempts',coalesce((entry.value->>'max_attempts')::integer,3)
    ) order by entry.ordinality)
    from jsonb_array_elements(items) with ordinality entry(value,ordinality)
  ) else null end;
$$;
revoke all on function private.form_coach_normalize_assessment_items(jsonb) from public,anon,authenticated,service_role;

create function private.form_coach_coach_can_manage_templates(actor_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when actor_id is null or (
      not private.has_role(actor_id,'coach'::public.user_role)
      and not private.has_role(actor_id,'admin'::public.user_role)
    ) then false
    when not exists(select 1 from public.feature_pricing_current current
      join public.feature_pricing_revisions revision
        on revision.feature_key=current.feature_key and revision.revision=current.revision
      where current.feature_key='form_coach' and revision.status<>'disabled') then false
    when private.has_role(actor_id,'admin'::public.user_role) then true
    when exists(select 1 from public.feature_pricing_current current
      join public.feature_pricing_revisions revision
        on revision.feature_key=current.feature_key and revision.revision=current.revision
      where current.feature_key='form_coach' and revision.status<>'disabled' and revision.payer='member') then true
    when exists(select 1 from public.feature_access_grants grant_row
      where grant_row.feature_key='form_coach' and grant_row.user_id=actor_id
        and grant_row.starts_at<=now() and (grant_row.expires_at is null or grant_row.expires_at>now())
        and not exists(select 1 from public.feature_access_grant_events revoked where revoked.grant_id=grant_row.id)) then true
    when exists(select 1 from public.feature_trial_access_grants trial
      where trial.feature_key='form_coach' and trial.user_id=actor_id
        and trial.starts_at<=now() and trial.expires_at>now()) then true
    when exists(select 1 from public.feature_subscriptions subscription
      join public.feature_subscription_access_current access
        on access.subscription_id=subscription.stripe_subscription_id
      where subscription.feature_key='form_coach' and subscription.payer_role='coach'
        and subscription.payer_id=actor_id and subscription.status in ('active','trialing')
        and access.access_through>now()) then true
    when exists(select 1 from public.feature_credit_lots lot
      where lot.feature_key='form_coach' and lot.user_id=actor_id and lot.remaining_units>0
        and (lot.expires_at is null or lot.expires_at>now())) then true
    else false
  end;
$$;
revoke all on function private.form_coach_coach_can_manage_templates(uuid) from public,anon,authenticated,service_role;

create function private.form_coach_lock_subjects(subject_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare subject_id uuid;
begin
  for subject_id in select distinct value from unnest(subject_ids) ids(value) where value is not null order by value loop
    -- Serialize all Form Coach resource mutations with the stream account tombstone. Try-locks
    -- turn contention into a whole-transaction retry instead of waiting while holding a Program,
    -- assessment, or upload row lock. Cleanup also uses this lock but separately permits tombstones.
    if not pg_try_advisory_xact_lock(hashtextextended('account:'||subject_id::text,19031003)) then
      raise exception 'Account workflow is busy; retry' using errcode='40001';
    end if;
    if not pg_try_advisory_xact_lock(hashtextextended(subject_id::text, 0)) then
      raise exception 'Form Coach subject workflow is busy; retry' using errcode='40001';
    end if;
  end loop;
end;
$$;
revoke all on function private.form_coach_lock_subjects(uuid[]) from public, anon, authenticated, service_role;

-- The platform lock closes the active deletion window. The stream tombstone is durable and
-- continues fencing late provider callbacks after the auth row has already been removed.
create function private.form_coach_subject_has_deletion_fence(target_subject_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select target_subject_id is not null and (
    exists(select 1 from public.platform_membership_deletion_locks fence
      where fence.member_id=target_subject_id)
    or exists(select 1 from public.stream_media_account_tombstones tombstone
      where tombstone.account_id=target_subject_id)
  );
$$;
revoke all on function private.form_coach_subject_has_deletion_fence(uuid) from public, anon, authenticated, service_role;

-- A coach/service workflow has to revalidate a known member without using the interactive
-- self-only `has_platform_tier` predicate. This private predicate never returns tier information
-- to a caller; it is used only as a boolean inside owner-checked SECURITY DEFINER operations.
create function private.form_coach_member_has_active_access(target_member_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select target_member_id is not null
    and exists(select 1 from public.profiles profile
      where profile.id=target_member_id and profile.role='member'::public.user_role)
    and not private.form_coach_subject_has_deletion_fence(target_member_id)
    and (
      exists(select 1 from public.platform_memberships membership
        where membership.member_id=target_member_id and membership.status='active'
          and membership.current_period_end>now())
      or exists(select 1 from public.platform_test_entitlements test_access
        where test_access.member_id=target_member_id and test_access.tier in ('regular','premium')
          and test_access.revoked_at is null)
    );
$$;
revoke all on function private.form_coach_member_has_active_access(uuid) from public, anon, authenticated, service_role;

create function private.form_coach_can_manage_template(template_id uuid, actor_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.form_coach_templates template
    where template.id = template_id
      and (
        (template.owner_subject_id = actor_id and template.owner_id = actor_id
          and template.owner_kind = 'coach' and private.has_role(actor_id, 'coach'::public.user_role))
        or private.has_role(actor_id, 'admin'::public.user_role)
      )
  );
$$;
revoke all on function private.form_coach_can_manage_template(uuid, uuid) from public, anon, authenticated, service_role;

create function private.form_coach_enqueue_completed_program(target_program_id uuid, target_member_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare progress jsonb; queued integer := 0; current_program public.programs%rowtype; outbox_id uuid;
begin
  if target_program_id is null or target_member_id is null then return 0; end if;
  select program.* into current_program from public.programs program where program.id = target_program_id;
  if not found or not current_program.published or current_program.platform_owned then return 0; end if;
  perform private.form_coach_lock_subjects(array[target_member_id,current_program.coach_id]);
  if private.form_coach_subject_has_deletion_fence(target_member_id)
    or private.form_coach_subject_has_deletion_fence(current_program.coach_id) then return 0; end if;
  progress := public.get_program_versioned_progress(target_program_id, target_member_id);
  if progress is null
    or coalesce((progress->>'access_authorized')::boolean, false) is not true
    or coalesce((progress->>'required_count')::integer, 0) < 1
    or coalesce((progress->>'current_completed_count')::integer, 0) < coalesce((progress->>'required_count')::integer, 0)
  then return 0; end if;
  select program.* into current_program from public.programs program where program.id = target_program_id;
  if not found or not current_program.published or current_program.platform_owned
  then return 0; end if;
  if private.form_coach_subject_has_deletion_fence(current_program.coach_id) then return 0; end if;
  insert into public.form_coach_program_send_outbox(
    member_subject_id, member_owner_id, program_id, program_owner_subject_id, program_owner_id,
    program_title_snapshot, rule_id, rule_generation, due_days, allow_member_clip,
    source_content_version_id, source_enrollment_id
  )
  select target_member_id, target_member_id, current_program.id, current_program.coach_id,
    current_program.coach_id, current_program.title, rule.id, rule.generation_id,
    rule.due_days, rule.allow_member_clip, nullif(progress->>'content_version_id','')::uuid,
    nullif(progress->>'enrollment_id','')::uuid
  from public.form_coach_program_rules rule
  where rule.program_id = target_program_id and rule.enabled
    and rule.auto_send
    and rule.program_owner_subject_id = current_program.coach_id
  on conflict(member_subject_id, program_id, rule_generation) do nothing;
  get diagnostics queued = row_count;
  if queued = 1 then
    select outbox.id into outbox_id from public.form_coach_program_send_outbox outbox
    where outbox.member_subject_id=target_member_id and outbox.program_id=target_program_id
      and outbox.rule_generation=(select rule.generation_id from public.form_coach_program_rules rule
        where rule.program_id=target_program_id);
    insert into public.form_coach_program_send_outbox_items(
      outbox_id,item_ordinal,template_version_id,required_reps,pass_threshold,cues_enabled,max_attempts
    ) select outbox_id,item.item_ordinal,item.template_version_id,item.required_reps,item.pass_threshold,
      item.cues_enabled,item.max_attempts
    from public.form_coach_program_rules rule
    join public.form_coach_program_rule_items item on item.rule_id=rule.id
    where rule.program_id=target_program_id;
    if not found then raise exception 'Program Form Coach rule has no items' using errcode='55000'; end if;
  end if;
  return queued;
end;
$$;
revoke all on function private.form_coach_enqueue_completed_program(uuid, uuid) from public, anon, authenticated, service_role;

create function private.form_coach_on_program_progress_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare previous_state text;
begin
  if new.event_state is distinct from 'completed'
    or new.source_enrollment_id is not null or new.source_day_id is not null then return new; end if;
  select prior.event_state into previous_state
  from public.program_lesson_progress_events prior
  where prior.subject_member_id=new.subject_member_id and prior.program_id=new.program_id
    and prior.content_version_id=new.content_version_id and prior.lesson_id=new.lesson_id
    and prior.event_sequence<new.event_sequence
  order by prior.event_sequence desc limit 1;
  if previous_state is distinct from 'completed' then
    perform private.form_coach_enqueue_completed_program(new.program_id, new.subject_member_id);
  end if;
  return new;
end;
$$;
revoke all on function private.form_coach_on_program_progress_event() from public, anon, authenticated, service_role;
create trigger form_coach_program_progress_enqueue
after insert on public.program_lesson_progress_events
for each row execute function private.form_coach_on_program_progress_event();

create function public.admin_publish_form_coach_terms(
  target_version integer, target_document_path text, target_document_sha256 text
)
returns integer language plpgsql security definer set search_path = '' as $$
declare next_version integer;
begin
  if auth.role() is distinct from 'authenticated' or not private.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  perform private.form_coach_lock_subjects(array[auth.uid()]);
  if private.form_coach_subject_has_deletion_fence(auth.uid()) then
    raise exception 'Account deletion is in progress' using errcode='55000'; end if;
  if target_version is null or target_version < 1 or target_document_path is null
    or target_document_path !~ '^/legal/form-coach/terms/[1-9][0-9]*$'
    or target_document_sha256 is null or target_document_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Form Coach terms version is invalid' using errcode = '22023';
  end if;
  select coalesce(max(version), 0) + 1 into next_version from public.form_coach_terms_versions;
  if target_version <> next_version then raise exception 'Terms version is stale' using errcode = '40001'; end if;
  insert into public.form_coach_terms_versions(version, document_path, document_sha256, created_by)
  values(target_version, target_document_path, target_document_sha256, auth.uid());
  insert into public.form_coach_terms_current(singleton, version, changed_by)
  values(true, target_version, auth.uid())
  on conflict(singleton) do update set version = excluded.version, changed_at = now(), changed_by = excluded.changed_by;
  return target_version;
end;
$$;
revoke all on function public.admin_publish_form_coach_terms(integer, text, text) from public, anon;
grant execute on function public.admin_publish_form_coach_terms(integer, text, text) to authenticated;

create function public.record_form_coach_member_consent(target_terms_version integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); result_id uuid;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null
    or target_terms_version is null then raise exception 'Consent request is invalid' using errcode = '22023'; end if;
  if not private.has_role(actor_id, 'member'::public.user_role)
    or not private.has_platform_tier(actor_id, 'regular')
    or private.form_coach_subject_has_deletion_fence(actor_id)
    or not exists(select 1 from public.form_coach_terms_current current_terms where current_terms.version = target_terms_version)
  then raise exception 'Current member access and Form Coach terms are required' using errcode = '42501'; end if;
  perform private.form_coach_lock_subjects(array[actor_id]);
  if private.form_coach_subject_has_deletion_fence(actor_id) then
    raise exception 'Account deletion is in progress' using errcode='55000'; end if;
  insert into public.form_coach_member_consents(member_subject_id, member_owner_id, terms_version)
  values(actor_id, actor_id, target_terms_version)
  on conflict(member_subject_id, terms_version) do nothing;
  select consent.id into result_id from public.form_coach_member_consents consent
  where consent.member_subject_id = actor_id and consent.terms_version = target_terms_version;
  return result_id;
end;
$$;
revoke all on function public.record_form_coach_member_consent(integer) from public, anon;
grant execute on function public.record_form_coach_member_consent(integer) to authenticated;

create function public.admin_set_form_coach_media_policy(
  expected_revision integer, reference_limit bigint, clip_limit bigint, clip_seconds smallint, retention_days smallint
)
returns integer language plpgsql security definer set search_path = '' as $$
declare current_revision integer; next_revision integer;
begin
  if auth.role() is distinct from 'authenticated' or not private.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  perform private.form_coach_lock_subjects(array[auth.uid()]);
  if private.form_coach_subject_has_deletion_fence(auth.uid()) then
    raise exception 'Account deletion is in progress' using errcode='55000'; end if;
  if expected_revision is null or expected_revision < 1
    or reference_limit is null or reference_limit not between 1 and 200000000
    or clip_limit is null or clip_limit not between 1 and 26214400
    or clip_seconds is null or clip_seconds not between 1 and 60
    or retention_days is null or retention_days not between 1 and 365 then
    raise exception 'Form Coach media policy is invalid' using errcode = '22023';
  end if;
  select current.revision into current_revision from public.form_coach_media_policy_current current
  where current.singleton for update;
  if current_revision is distinct from expected_revision then raise exception 'Media policy revision is stale' using errcode = '40001'; end if;
  next_revision := current_revision + 1;
  insert into public.form_coach_media_policy_versions(
    revision, reference_max_bytes, member_clip_max_bytes, member_clip_max_seconds, clip_retention_days, created_by
  ) values(next_revision, reference_limit, clip_limit, clip_seconds, retention_days, auth.uid());
  update public.form_coach_media_policy_current current
  set revision = next_revision, changed_at = now(), changed_by = auth.uid() where current.singleton;
  return next_revision;
end;
$$;
revoke all on function public.admin_set_form_coach_media_policy(integer, bigint, bigint, smallint, smallint) from public, anon;
grant execute on function public.admin_set_form_coach_media_policy(integer, bigint, bigint, smallint, smallint) to authenticated;

create function public.save_form_coach_template_draft(
  target_template_id uuid, target_name text, target_payload jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); actor_role public.user_role; template_row public.form_coach_templates%rowtype;
  new_template_id uuid; new_version_id uuid; next_revision integer;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null then
    raise exception 'Template access is unavailable' using errcode = '42501';
  end if;
  select profile.role into actor_role from public.profiles profile where profile.id = actor_id;
  if actor_role is null or actor_role not in ('coach'::public.user_role, 'admin'::public.user_role) then
    raise exception 'Coach or admin access is required' using errcode = '42501';
  end if;
  if actor_role='coach'::public.user_role and not private.form_coach_coach_can_manage_templates(actor_id) then
    raise exception 'Form Coach template entitlement is required' using errcode='42501';
  end if;
  if target_name is null or char_length(btrim(target_name)) not between 1 and 120
    or target_payload is null or not private.form_coach_valid_template_payload('dumbbell_curl', target_payload) then
    raise exception 'Exercise template is invalid' using errcode = '22023';
  end if;
  perform private.form_coach_lock_subjects(array[actor_id]);
  if private.form_coach_subject_has_deletion_fence(actor_id) then
    raise exception 'Account deletion is in progress' using errcode='55000'; end if;
  if target_template_id is null then
    insert into public.form_coach_templates(owner_subject_id, owner_id, owner_kind, name)
    values(actor_id, actor_id, case when actor_role = 'admin' then 'admin' else 'coach' end, btrim(target_name))
    returning id into new_template_id;
  else
    select * into template_row from public.form_coach_templates template
    where template.id = target_template_id for update;
    if not found or not private.form_coach_can_manage_template(target_template_id, actor_id)
      or template_row.archived_at is not null then
      raise exception 'Template was not found or is unavailable' using errcode = '42501';
    end if;
    new_template_id := template_row.id;
    update public.form_coach_templates set name = btrim(target_name) where id = new_template_id;
  end if;
  select coalesce(max(version.revision), 0) + 1 into next_revision
  from public.form_coach_template_versions version where version.template_id = new_template_id;
  insert into public.form_coach_template_versions(
    template_id, revision, exercise_key, schema_version, template_payload, payload_sha256, created_by
  ) values (
    new_template_id, next_revision, 'dumbbell_curl', 1, target_payload,
    encode(extensions.digest(convert_to(target_payload::text, 'UTF8'), 'sha256'), 'hex'), actor_id
  ) returning id into new_version_id;
  return new_version_id;
end;
$$;
revoke all on function public.save_form_coach_template_draft(uuid, text, jsonb) from public, anon;
grant execute on function public.save_form_coach_template_draft(uuid, text, jsonb) to authenticated;

create function public.publish_form_coach_template_version(target_version_id uuid, publish_acknowledged boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); version_row public.form_coach_template_versions%rowtype; template_row public.form_coach_templates%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null or publish_acknowledged is distinct from true then
    raise exception 'Publishing requires explicit coach acknowledgement' using errcode = '42501';
  end if;
  perform private.form_coach_lock_subjects(array[actor_id]);
  if private.form_coach_subject_has_deletion_fence(actor_id) then
    raise exception 'Account deletion is in progress' using errcode='55000'; end if;
  if not private.form_coach_coach_can_manage_templates(actor_id) then
    raise exception 'Form Coach template access is unavailable' using errcode='42501'; end if;
  select version.* into version_row from public.form_coach_template_versions version
  where version.id = target_version_id for update;
  if not found then return false; end if;
  select template.* into template_row from public.form_coach_templates template
  where template.id = version_row.template_id for update;
  if template_row.archived_at is not null or not private.form_coach_can_manage_template(template_row.id, actor_id) then
    raise exception 'Template is not owned by this coach or admin' using errcode = '42501';
  end if;
  if version_row.state = 'published' then return true; end if;
  if version_row.state <> 'draft' or not private.form_coach_valid_template_payload(version_row.exercise_key, version_row.template_payload)
    or not exists(select 1 from public.form_coach_template_asset_claims asset
      where asset.template_version_id=version_row.id and asset.asset_key='reference'
        and asset.bucket_id='form-coach-reference' and asset.source_guard_state='private_verified')
    or exists(select 1 from public.form_coach_template_asset_claims asset
      where asset.template_version_id = version_row.id and asset.source_guard_state <> 'private_verified')
    or exists(select 1 from jsonb_array_elements(version_row.template_payload->'cues') cue(value)
      where cue.value ? 'audioPath' and not exists(
        select 1 from public.form_coach_template_asset_claims asset
        where asset.template_version_id=version_row.id and asset.asset_key='cue_'||(cue.value->>'key')
          and asset.bucket_id='form-coach-cues' and asset.storage_path=cue.value->>'audioPath'
          and asset.source_guard_state='private_verified'
      )) then
    raise exception 'Template version is not publishable' using errcode = '23514';
  end if;
  update public.form_coach_template_versions set state = 'published', published_by = actor_id, published_at = now()
  where id = version_row.id and state = 'draft';
  return found;
end;
$$;
revoke all on function public.publish_form_coach_template_version(uuid, boolean) from public, anon;
grant execute on function public.publish_form_coach_template_version(uuid, boolean) to authenticated;

create function public.save_form_coach_program_rule(
  target_program_id uuid, target_items jsonb, expected_revision bigint,
  enabled_value boolean, auto_send_value boolean, due_days_value smallint,
  allow_member_clip_value boolean, start_new_generation boolean
)
returns table(rule_id uuid, rule_revision bigint, rule_generation uuid)
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); program_row public.programs%rowtype;
  existing public.form_coach_program_rules%rowtype; item jsonb; item_version_id uuid; rule_item record;
  prior_items jsonb; item_configuration_changed boolean;
  output_id uuid; output_revision bigint; output_generation uuid;
begin
  target_items:=private.form_coach_normalize_assessment_items(target_items);
  enabled_value:=coalesce(enabled_value,true);
  auto_send_value:=coalesce(auto_send_value,false);
  due_days_value:=coalesce(due_days_value,7);
  allow_member_clip_value:=coalesce(allow_member_clip_value,false);
  if auth.role() is distinct from 'authenticated' or actor_id is null
    or target_program_id is null or expected_revision is null
    or expected_revision < 0 or target_items is null
    or due_days_value not between 1 and 30
    or start_new_generation is null then
    raise exception 'Program Form Coach rule is invalid' using errcode = '22023';
  end if;
  perform private.form_coach_lock_subjects(array[actor_id]);
  if private.form_coach_subject_has_deletion_fence(actor_id) then
    raise exception 'Account deletion is in progress' using errcode='55000'; end if;
  if not private.form_coach_coach_can_manage_templates(actor_id) then
    raise exception 'Form Coach template access is unavailable' using errcode='42501'; end if;
  select program.* into program_row from public.programs program where program.id = target_program_id for update;
  if not found or not private.can_manage_program(target_program_id) then
    raise exception 'Current program owner access is required' using errcode = '42501';
  end if;
  if program_row.platform_owned then
    raise exception 'Platform-owned Program payer policy is not configured' using errcode='55000';
  end if;
  for item in select value from jsonb_array_elements(target_items) entries(value) loop
    item_version_id := (item->>'template_version_id')::uuid;
    if not exists(select 1 from public.form_coach_template_versions version
      join public.form_coach_templates template on template.id=version.template_id
      where version.id=item_version_id and version.state='published' and template.archived_at is null
        and (template.owner_subject_id=program_row.coach_id or template.owner_kind='admin')) then
      raise exception 'Every rule item must use an available published template' using errcode='22023';
    end if;
  end loop;
  select rule.* into existing from public.form_coach_program_rules rule
  where rule.program_id = target_program_id for update;
  if found then
    if existing.revision is distinct from expected_revision then raise exception 'Program rule revision is stale' using errcode = '40001'; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'template_version_id',item.template_version_id,'required_reps',item.required_reps,
      'pass_threshold',item.pass_threshold,'cues_enabled',item.cues_enabled,'max_attempts',item.max_attempts
    ) order by item.item_ordinal),'[]'::jsonb) into prior_items
    from public.form_coach_program_rule_items item where item.rule_id=existing.id;
    item_configuration_changed := prior_items is distinct from target_items
      or existing.enabled is distinct from enabled_value
      or existing.auto_send is distinct from auto_send_value
      or existing.due_days is distinct from due_days_value
      or existing.allow_member_clip is distinct from allow_member_clip_value;
    if not start_new_generation and item_configuration_changed
      and exists(select 1 from public.form_coach_program_send_outbox outbox
        where outbox.program_id = target_program_id and outbox.rule_generation = existing.generation_id) then
      raise exception 'A used rule requires an explicit new generation' using errcode = '55000';
    end if;
    update public.form_coach_program_rules rule set
      revision = rule.revision + 1,
      generation_id = case when start_new_generation then gen_random_uuid() else rule.generation_id end,
      enabled = enabled_value, auto_send=auto_send_value, due_days=due_days_value,
      allow_member_clip = allow_member_clip_value,
      changed_by = actor_id, updated_at = now()
    where rule.id = existing.id returning rule.id, rule.revision, rule.generation_id
      into output_id, output_revision, output_generation;
  else
    if expected_revision <> 0 or start_new_generation then raise exception 'Program rule is stale' using errcode = '40001'; end if;
    insert into public.form_coach_program_rules(
      program_id, program_owner_subject_id, program_owner_id,
      revision, enabled, auto_send, due_days, allow_member_clip, changed_by
    ) values(target_program_id, program_row.coach_id, program_row.coach_id,
      1, enabled_value, auto_send_value, due_days_value, allow_member_clip_value, actor_id)
    returning id, revision, generation_id into output_id, output_revision, output_generation;
  end if;
  delete from public.form_coach_program_rule_items item_row where item_row.rule_id=output_id;
  for rule_item in select value as item,ordinality::smallint as ordinal
    from jsonb_array_elements(target_items) with ordinality entries(value,ordinality) loop
    insert into public.form_coach_program_rule_items(
      rule_id,item_ordinal,template_version_id,required_reps,pass_threshold,cues_enabled,max_attempts
    ) values(output_id,rule_item.ordinal,(rule_item.item->>'template_version_id')::uuid,
      (rule_item.item->>'required_reps')::smallint,(rule_item.item->>'pass_threshold')::numeric,
      (rule_item.item->>'cues_enabled')::boolean,(rule_item.item->>'max_attempts')::smallint);
  end loop;
  return query select output_id, output_revision, output_generation;
end;
$$;
revoke all on function public.save_form_coach_program_rule(uuid,jsonb,bigint,boolean,boolean,smallint,boolean,boolean) from public, anon;
grant execute on function public.save_form_coach_program_rule(uuid,jsonb,bigint,boolean,boolean,smallint,boolean,boolean) to authenticated;

create function private.form_coach_create_assessment(
  requested_assessment_id uuid, send_request uuid, source_name text,
  target_member_id uuid, actor_id uuid, target_program_id uuid, target_rule_id uuid,
  target_rule_generation uuid, target_program_title text, target_content_version uuid,
  target_enrollment_id uuid, target_item_settings jsonb, target_due_days smallint,
  target_allow_clip boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare config_row public.feature_pricing_revisions%rowtype; current_config_revision bigint;
  member_profile_role public.user_role; actor_profile_role public.user_role; payer_profile_role public.user_role;
  program_row public.programs%rowtype; rule_row public.form_coach_program_rules%rowtype;
  template_row record; setting_row jsonb; payer_id uuid; payer_role text; due_time timestamptz;
  funding_result text; funding_id uuid; send_hash text; item_index integer := 0;
  existing public.form_coach_assessments%rowtype;
begin
  target_item_settings:=private.form_coach_normalize_assessment_items(target_item_settings);
  target_due_days:=coalesce(target_due_days,7);
  target_allow_clip:=coalesce(target_allow_clip,false);
  if requested_assessment_id is null or send_request is null or source_name is null or source_name not in ('manual','program')
    or target_member_id is null or actor_id is null or not private.form_coach_assessment_items_valid(target_item_settings)
    or target_due_days is null or target_due_days not between 1 and 30 or target_allow_clip is null
    or (source_name='manual' and (target_program_id is not null or target_rule_id is not null
      or target_rule_generation is not null or target_program_title is not null
      or target_content_version is not null or target_enrollment_id is not null))
    or (source_name='program' and (target_program_id is null or target_rule_id is null
      or target_rule_generation is null or target_enrollment_id is null
      or nullif(btrim(target_program_title),'') is null)) then
    raise exception 'Assessment send identity or settings are invalid' using errcode='22023';
  end if;
  send_hash := encode(extensions.digest(convert_to(concat_ws('|',requested_assessment_id::text,source_name,target_member_id::text,
    actor_id::text,coalesce(target_program_id::text,''),coalesce(target_rule_id::text,''),
    coalesce(target_rule_generation::text,''),coalesce(target_program_title,''),
    coalesce(target_content_version::text,''),coalesce(target_enrollment_id::text,''),
    target_due_days::text,target_allow_clip::text,target_item_settings::text),'UTF8'),'sha256'),'hex');
  perform private.form_coach_lock_subjects(array[target_member_id,actor_id]);
  select assessment.* into existing from public.form_coach_assessments assessment
  where assessment.send_request_id=send_request;
  if found then
    if existing.id is distinct from requested_assessment_id or existing.send_digest is distinct from send_hash
      or existing.member_subject_id is distinct from target_member_id or existing.coach_subject_id is distinct from actor_id
      or existing.source_kind is distinct from source_name then
      raise exception 'Assessment send request was reused' using errcode='23505';
    end if;
    return jsonb_build_object('outcome','already_sent','assessment_id',existing.id,'due_at',existing.due_at);
  end if;
  if private.form_coach_subject_has_deletion_fence(target_member_id)
    or private.form_coach_subject_has_deletion_fence(actor_id) then
    return jsonb_build_object('outcome','account_deleting');
  end if;
  select profile.role into member_profile_role from public.profiles profile where profile.id=target_member_id for share;
  select profile.role into actor_profile_role from public.profiles profile where profile.id=actor_id for share;
  if member_profile_role is distinct from 'member'::public.user_role
    or not private.form_coach_member_has_active_access(target_member_id) then
    return jsonb_build_object('outcome','member_access_required');
  end if;
  if actor_profile_role is distinct from 'coach'::public.user_role then
    return jsonb_build_object('outcome','coach_access_required');
  end if;
  if not exists(select 1 from public.coach_members link where link.coach_id=actor_id and link.member_id=target_member_id) then
    return jsonb_build_object('outcome','coach_link_required');
  end if;
  if source_name='program' then
    select program.* into program_row from public.programs program where program.id=target_program_id for share;
    if not found or not program_row.published or program_row.platform_owned or program_row.coach_id is distinct from actor_id
      or (auth.role()='authenticated' and not private.can_manage_program(target_program_id))
      or auth.role() not in ('authenticated','service_role') then
      return jsonb_build_object('outcome','program_access_changed');
    end if;
    select rule.* into rule_row from public.form_coach_program_rules rule
    where rule.id=target_rule_id and rule.program_id=target_program_id
      and rule.enabled and rule.auto_send and rule.generation_id=target_rule_generation
      and rule.program_owner_subject_id=actor_id for share;
    if not found or rule_row.due_days is distinct from target_due_days
      or rule_row.allow_member_clip is distinct from target_allow_clip then
      return jsonb_build_object('outcome','rule_changed');
    end if;
  end if;
  select current.revision into current_config_revision
  from public.feature_pricing_current current where current.feature_key='form_coach' for share;
  select revision.* into config_row from public.feature_pricing_revisions revision
  where revision.feature_key='form_coach' and revision.revision=current_config_revision;
  if not found or config_row.status='disabled' then return jsonb_build_object('outcome','feature_disabled'); end if;
  payer_role:=config_row.payer;
  payer_id:=case when payer_role='coach' then actor_id else target_member_id end;
  select profile.role into payer_profile_role from public.profiles profile where profile.id=payer_id for share;
  if payer_profile_role::text is distinct from payer_role then return jsonb_build_object('outcome','payer_role_mismatch'); end if;
  for setting_row in select value from jsonb_array_elements(target_item_settings) entries(value) loop
    select version.id,version.template_id,version.exercise_key,template.name,template.owner_kind,template.owner_subject_id
      into template_row
    from public.form_coach_template_versions version
    join public.form_coach_templates template on template.id=version.template_id
    where version.id=(setting_row->>'template_version_id')::uuid
      and version.state='published' and template.archived_at is null;
    if not found then return jsonb_build_object('outcome','template_unavailable'); end if;
    if template_row.owner_kind='coach'
      and (template_row.owner_subject_id is distinct from actor_id
        or not private.form_coach_can_manage_template(template_row.template_id,actor_id)) then
      return jsonb_build_object('outcome','template_unavailable');
    end if;
    item_index:=item_index+1;
  end loop;
  if item_index <> jsonb_array_length(target_item_settings) then return jsonb_build_object('outcome','template_unavailable'); end if;
  due_time:=now()+make_interval(days=>target_due_days);
  -- Pending pricing only funds explicit comps. Live member-payer sends remain unfunded until the
  -- first assessed attempt; coach-payer sends atomically fund the single bundle here.
  if config_row.status='pricing_pending' or payer_role='coach' then
    select funding.outcome,funding.funding_receipt_id into funding_result,funding_id
    from public.record_feature_bundle_funding(requested_assessment_id,'form_coach',payer_id,
      current_config_revision,due_time,'form-coach-send:'||requested_assessment_id::text) funding;
    if funding_result not in ('funded','already_funded') then
      return jsonb_build_object('outcome','funding_required','funding_outcome',funding_result);
    end if;
  end if;
  insert into public.form_coach_assessments(
    id,send_request_id,send_digest,source_kind,member_subject_id,member_owner_id,
    coach_subject_id,coach_owner_id,program_id,program_owner_subject_id,program_owner_id,
    program_title_snapshot,program_rule_id,program_rule_generation,source_enrollment_id,
    source_content_version_id,sent_by_subject_id,sent_by_owner_id,payer_role,payer_subject_id,
    payer_owner_id,config_revision,due_at,allow_member_clip
  ) values (
    requested_assessment_id,send_request,send_hash,source_name,target_member_id,target_member_id,
    actor_id,actor_id,target_program_id,case when source_name='program' then actor_id else null end,
    case when source_name='program' then actor_id else null end,
    target_program_title,target_rule_id,target_rule_generation,target_enrollment_id,
    target_content_version,actor_id,actor_id,payer_role,payer_id,payer_id,
    current_config_revision,due_time,target_allow_clip
  );
  for template_row in
    select setting.value,version.id,version.exercise_key,template.name,setting.ordinality
    from jsonb_array_elements(target_item_settings) with ordinality setting(value,ordinality)
    join public.form_coach_template_versions version on version.id=(setting.value->>'template_version_id')::uuid
      and version.state='published'
    join public.form_coach_templates template on template.id=version.template_id and template.archived_at is null
    order by setting.ordinality
  loop
    insert into public.form_coach_assessment_items(
      assessment_id,item_ordinal,item_key,item_title_snapshot,template_version_id,exercise_key,
      required_reps,pass_threshold,cues_enabled,max_attempts
    ) values(requested_assessment_id,template_row.ordinality,'exercise_'||template_row.ordinality::text,
      template_row.name,template_row.id,template_row.exercise_key,
      (template_row.value->>'required_reps')::smallint,(template_row.value->>'pass_threshold')::numeric,
      (template_row.value->>'cues_enabled')::boolean,(template_row.value->>'max_attempts')::smallint);
  end loop;
  if not found then raise exception 'Assessment items changed during send' using errcode='40001'; end if;
  insert into public.form_coach_notification_outbox(event_key,recipient_subject_id,recipient_owner_id,assessment_id,event_kind)
  values('assessment-sent:'||requested_assessment_id::text,target_member_id,target_member_id,requested_assessment_id,'assessment_sent')
  on conflict(event_key) do nothing;
  return jsonb_build_object('outcome','sent','assessment_id',requested_assessment_id,'due_at',due_time,
    'funding_receipt_id',funding_id,'payer_role',payer_role,'config_revision',current_config_revision);
end;
$$;
revoke all on function private.form_coach_create_assessment(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,jsonb,smallint,boolean)
  from public,anon,authenticated,service_role;

create function public.send_form_coach_assessment(
  target_member_id uuid,target_item_settings jsonb,target_due_days smallint,
  target_allow_member_clip boolean,target_request_id uuid,target_assessment_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid:=auth.uid(); actor_role public.user_role;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null or target_member_id is null
    or not private.form_coach_assessment_items_valid(target_item_settings)
    or coalesce(target_due_days,7) not between 1 and 30
    or target_request_id is null or target_assessment_id is null then
    raise exception 'Assessment send request is invalid' using errcode='22023';
  end if;
  target_due_days:=coalesce(target_due_days,7);
  target_allow_member_clip:=coalesce(target_allow_member_clip,false);
  select profile.role into actor_role from public.profiles profile where profile.id=actor_id;
  if actor_role is distinct from 'coach'::public.user_role then raise exception 'Coach access is required' using errcode='42501'; end if;
  return private.form_coach_create_assessment(target_assessment_id,target_request_id,'manual',target_member_id,
    actor_id,null,null,null,null,null,null,target_item_settings,target_due_days,target_allow_member_clip);
end;
$$;
revoke all on function public.send_form_coach_assessment(uuid,jsonb,smallint,boolean,uuid,uuid) from public,anon;
grant execute on function public.send_form_coach_assessment(uuid,jsonb,smallint,boolean,uuid,uuid) to authenticated;

create function private.form_coach_program_send_backoff(target_attempt_count integer)
returns interval language sql immutable set search_path = '' as $$
  select make_interval(secs => least(21600::double precision,
    30::double precision * power(2::double precision,
      greatest(least(coalesce(target_attempt_count,1)-1,10),0)::double precision)))
$$;
revoke all on function private.form_coach_program_send_backoff(integer) from public,anon,authenticated,service_role;

create function public.service_claim_form_coach_program_sends(target_limit smallint default 10, lease_seconds smallint default 120)
returns table(outbox_id uuid, program_id uuid, member_subject_id uuid, claim_token uuid, lease_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if target_limit is null or target_limit not between 1 and 25
    or lease_seconds is null or lease_seconds not between 30 and 600 then
    raise exception 'Program send lease bounds are invalid' using errcode='22023'; end if;
  return query
  with candidates as (
    select pending.id from public.form_coach_program_send_outbox pending
    where (pending.state in ('pending','awaiting_funds') and pending.next_attempt_at<=now())
      or (pending.state='claimed' and pending.lease_expires_at<=now())
    order by case when pending.state='claimed' then pending.lease_expires_at else pending.next_attempt_at end,
      pending.created_at,pending.id
    for update skip locked limit target_limit
  ), claimed as (
    update public.form_coach_program_send_outbox outbox set state='claimed',
      claim_token=gen_random_uuid(),lease_expires_at=now()+make_interval(secs=>lease_seconds),
      claim_attempt_count=outbox.claim_attempt_count+1,updated_at=now()
    from candidates where outbox.id=candidates.id
    returning outbox.id,outbox.program_id,outbox.member_subject_id,outbox.claim_token,outbox.lease_expires_at
  ) select claimed.id,claimed.program_id,claimed.member_subject_id,claimed.claim_token,claimed.lease_expires_at
    from claimed order by claimed.id;
end;
$$;
revoke all on function public.service_claim_form_coach_program_sends(smallint,smallint) from public,anon,authenticated;
grant execute on function public.service_claim_form_coach_program_sends(smallint,smallint) to service_role;

create function public.service_process_form_coach_program_send(target_outbox_id uuid, target_claim_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare outbox public.form_coach_program_send_outbox%rowtype; progress jsonb; rule public.form_coach_program_rules%rowtype;
  send_result jsonb; processed_assessment_id uuid; item_settings jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode = '42501'; end if;
  if target_outbox_id is null or target_claim_token is null then raise exception 'Outbox claim identity is invalid' using errcode = '22023'; end if;
  perform set_config('lock_timeout','5s',true);
  perform set_config('statement_timeout','20s',true);
  select row.* into outbox from public.form_coach_program_send_outbox row
  where row.id = target_outbox_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if outbox.state = 'sent' then return jsonb_build_object('outcome','already_sent','assessment_id',outbox.assessment_id); end if;
  if outbox.state = 'suppressed' then return jsonb_build_object('outcome','suppressed'); end if;
  if outbox.state<>'claimed' or outbox.claim_token is distinct from target_claim_token
    or outbox.lease_expires_at<=now() then raise exception 'Program send lease is stale' using errcode='40001'; end if;
  perform private.form_coach_lock_subjects(array[outbox.member_subject_id,outbox.program_owner_subject_id]);
  select row.* into outbox from public.form_coach_program_send_outbox row
  where row.id = target_outbox_id for update;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if outbox.state = 'sent' then return jsonb_build_object('outcome','already_sent','assessment_id',outbox.assessment_id); end if;
  if outbox.state = 'suppressed' then return jsonb_build_object('outcome','suppressed'); end if;
  if outbox.state<>'claimed' or outbox.claim_token is distinct from target_claim_token
    or outbox.lease_expires_at<=now() then raise exception 'Program send lease is stale' using errcode='40001'; end if;
  if outbox.member_owner_id is null or outbox.program_owner_id is null
     or private.form_coach_subject_has_deletion_fence(outbox.member_subject_id)
     or private.form_coach_subject_has_deletion_fence(outbox.program_owner_subject_id) then
    update public.form_coach_program_send_outbox set state='suppressed',claim_token=null,lease_expires_at=null,
      last_outcome='deletion_fence',updated_at=now() where id=outbox.id;
    return jsonb_build_object('outcome','suppressed');
  end if;
  select current_rule.* into rule from public.form_coach_program_rules current_rule
  where current_rule.id=outbox.rule_id and current_rule.program_id=outbox.program_id
    and current_rule.enabled and current_rule.auto_send and current_rule.generation_id=outbox.rule_generation
    and current_rule.due_days=outbox.due_days and current_rule.allow_member_clip=outbox.allow_member_clip;
  if not found then
    update public.form_coach_program_send_outbox set state='suppressed',claim_token=null,lease_expires_at=null,
      last_outcome='eligibility_changed',updated_at=now() where id=outbox.id;
    return jsonb_build_object('outcome','suppressed');
  end if;
  if not exists(select 1 from public.programs program where program.id=outbox.program_id
      and program.published and not program.platform_owned and program.coach_id=outbox.program_owner_subject_id)
     or not exists(select 1 from public.form_coach_program_rule_items current_item where current_item.rule_id=rule.id) then
    update public.form_coach_program_send_outbox set state='suppressed',claim_token=null,lease_expires_at=null,
      last_outcome='eligibility_changed',updated_at=now() where id=outbox.id;
    return jsonb_build_object('outcome','suppressed');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'template_version_id',item.template_version_id,'required_reps',item.required_reps,
    'pass_threshold',item.pass_threshold,'cues_enabled',item.cues_enabled,'max_attempts',item.max_attempts
  ) order by item.item_ordinal),'[]'::jsonb) into item_settings
  from public.form_coach_program_send_outbox_items item where item.outbox_id=outbox.id;
  if not private.form_coach_assessment_items_valid(item_settings)
    or item_settings is distinct from (
      select coalesce(jsonb_agg(jsonb_build_object(
        'template_version_id',item.template_version_id,'required_reps',item.required_reps,
        'pass_threshold',item.pass_threshold,'cues_enabled',item.cues_enabled,'max_attempts',item.max_attempts
      ) order by item.item_ordinal),'[]'::jsonb)
      from public.form_coach_program_rule_items item where item.rule_id=rule.id
    )
    or exists(select 1 from jsonb_array_elements(item_settings) requested(value)
      left join public.form_coach_template_versions version
        on version.id=(requested.value->>'template_version_id')::uuid and version.state='published'
      left join public.form_coach_templates template on template.id=version.template_id and template.archived_at is null
      where version.id is null or template.id is null
        or (template.owner_kind='coach' and template.owner_subject_id is distinct from outbox.program_owner_subject_id)) then
    update public.form_coach_program_send_outbox set state='suppressed',claim_token=null,lease_expires_at=null,
      last_outcome='item_snapshot_changed',updated_at=now() where id=outbox.id;
    return jsonb_build_object('outcome','suppressed');
  end if;
  progress := public.get_program_versioned_progress(outbox.program_id,outbox.member_subject_id);
  if progress is null or coalesce((progress->>'access_authorized')::boolean,false) is not true
    or coalesce((progress->>'required_count')::integer,0)<1
    or coalesce((progress->>'current_completed_count')::integer,0)<coalesce((progress->>'required_count')::integer,0)
    or progress->>'program_title' is distinct from outbox.program_title_snapshot then
    update public.form_coach_program_send_outbox set state='suppressed',claim_token=null,lease_expires_at=null,
      last_outcome='completion_changed',updated_at=now() where id=outbox.id;
    return jsonb_build_object('outcome','suppressed');
  end if;
  send_result := private.form_coach_create_assessment(
    outbox.id, outbox.id, 'program', outbox.member_subject_id,
    outbox.program_owner_subject_id, outbox.program_id, outbox.rule_id, outbox.rule_generation,
    outbox.program_title_snapshot, outbox.source_content_version_id, outbox.source_enrollment_id,
    item_settings,outbox.due_days,outbox.allow_member_clip
  );
  if send_result->>'outcome' = 'sent' or send_result->>'outcome' = 'already_sent' then
    processed_assessment_id := nullif(send_result->>'assessment_id','')::uuid;
    update public.form_coach_program_send_outbox as send_outbox set state='sent',
      assessment_id=processed_assessment_id,claim_token=null,lease_expires_at=null,
      last_outcome='sent', updated_at=now() where send_outbox.id=outbox.id;
    update public.form_coach_notification_outbox set state='suppressed',claim_token=null,lease_expires_at=null,updated_at=now()
      where event_key='coach-funding:'||outbox.id::text and state in ('pending','claimed');
    return jsonb_build_object('outcome','sent','assessment_id',processed_assessment_id);
  elsif send_result->>'outcome' = 'funding_required' then
    update public.form_coach_program_send_outbox as send_outbox set state='awaiting_funds',
      claim_token=null,lease_expires_at=null,last_outcome=send_result->>'funding_outcome',
      next_attempt_at=now()+private.form_coach_program_send_backoff(send_outbox.claim_attempt_count),
      updated_at=now() where send_outbox.id=outbox.id;
    insert into public.form_coach_notification_outbox(event_key,recipient_subject_id,recipient_owner_id,
      assessment_id,event_kind)
    values('coach-funding:'||outbox.id::text,outbox.program_owner_subject_id,outbox.program_owner_id,
      null,'coach_funding_needed') on conflict(event_key) do nothing;
    return jsonb_build_object('outcome','awaiting_funds','funding_outcome',send_result->>'funding_outcome');
  elsif send_result->>'outcome' in ('feature_disabled','member_access_required','current_consent_required') then
    update public.form_coach_program_send_outbox as send_outbox set state='pending',
      claim_token=null,lease_expires_at=null,last_outcome=send_result->>'outcome',
      next_attempt_at=now()+private.form_coach_program_send_backoff(send_outbox.claim_attempt_count),
      updated_at=now() where send_outbox.id=outbox.id;
    return jsonb_build_object('outcome','paused','reason',send_result->>'outcome');
  else
    update public.form_coach_program_send_outbox as send_outbox set state='suppressed',
      claim_token=null,lease_expires_at=null,last_outcome=send_result->>'outcome',
      updated_at=now() where send_outbox.id=outbox.id;
    return jsonb_build_object('outcome','suppressed','reason',send_result->>'outcome');
  end if;
end;
$$;
revoke all on function public.service_process_form_coach_program_send(uuid,uuid) from public, anon, authenticated;
grant execute on function public.service_process_form_coach_program_send(uuid,uuid) to service_role;

create function private.form_coach_attempt_payload_valid(payload jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare rep jsonb; fault jsonb;
begin
  if payload is null or jsonb_typeof(payload) is distinct from 'array'
    or octet_length(payload::text)>32768
    or jsonb_array_length(payload) not between 1 and 20 then return false; end if;
  for rep in select value from jsonb_array_elements(payload) reps(value) loop
    if jsonb_typeof(rep) is distinct from 'object'
      or (rep - array['rep_number','score','rom_min_angle','rom_max_angle','rom_score',
        'max_upper_arm_drift','max_torso_swing','max_shrug','concentric_ms','top_pause_ms','eccentric_ms',
        'curve_similarity','elbow_score','torso_score','tempo_score','shoulders_score','faults']) <> '{}'::jsonb
      or private.form_coach_json_object_key_count(rep) <> 17
      or jsonb_typeof(rep->'rep_number') is distinct from 'number'
      or jsonb_typeof(rep->'score') is distinct from 'number'
      or jsonb_typeof(rep->'rom_min_angle') is distinct from 'number'
      or jsonb_typeof(rep->'rom_max_angle') is distinct from 'number'
      or jsonb_typeof(rep->'rom_score') is distinct from 'number'
      or jsonb_typeof(rep->'max_upper_arm_drift') is distinct from 'number'
      or jsonb_typeof(rep->'max_torso_swing') is distinct from 'number'
      or jsonb_typeof(rep->'max_shrug') is distinct from 'number'
      or jsonb_typeof(rep->'concentric_ms') is distinct from 'number'
      or jsonb_typeof(rep->'top_pause_ms') is distinct from 'number'
      or jsonb_typeof(rep->'eccentric_ms') is distinct from 'number'
      or jsonb_typeof(rep->'curve_similarity') is distinct from 'number'
      or jsonb_typeof(rep->'elbow_score') is distinct from 'number'
      or jsonb_typeof(rep->'torso_score') is distinct from 'number'
      or jsonb_typeof(rep->'tempo_score') is distinct from 'number'
      or jsonb_typeof(rep->'shoulders_score') is distinct from 'number'
      or jsonb_typeof(rep->'faults') is distinct from 'array'
      or jsonb_array_length(rep->'faults')>7
      or (rep->>'rep_number')::integer not between 1 and 20
      or (rep->>'score')::numeric not between 0 and 100
      or (rep->>'rom_min_angle')::numeric not between 0 and 180
      or (rep->>'rom_max_angle')::numeric not between 0 and 180
      or (rep->>'rom_min_angle')::numeric >= (rep->>'rom_max_angle')::numeric
      or (rep->>'rom_score')::numeric not between 0 and 100
      or (rep->>'max_upper_arm_drift')::numeric not between 0 and 180
      or (rep->>'max_torso_swing')::numeric not between 0 and 180
      or (rep->>'max_shrug')::numeric not between 0 and 1
      or (rep->>'concentric_ms')::numeric <> trunc((rep->>'concentric_ms')::numeric)
      or (rep->>'concentric_ms')::integer not between 100 and 15000
      or (rep->>'top_pause_ms')::numeric <> trunc((rep->>'top_pause_ms')::numeric)
      or (rep->>'top_pause_ms')::integer not between 0 and 15000
      or (rep->>'eccentric_ms')::numeric <> trunc((rep->>'eccentric_ms')::numeric)
      or (rep->>'eccentric_ms')::integer not between 100 and 15000
      or (rep->>'curve_similarity')::numeric not between 0 and 100
      or (rep->>'elbow_score')::numeric not between 0 and 100
      or (rep->>'torso_score')::numeric not between 0 and 100
      or (rep->>'tempo_score')::numeric not between 0 and 100
      or (rep->>'shoulders_score')::numeric not between 0 and 100 then return false; end if;
    for fault in select value from jsonb_array_elements(rep->'faults') faults(value) loop
      if jsonb_typeof(fault) is distinct from 'string' or fault #>> '{}' not in (
        'elbow_drift','torso_swing','short_rom_bottom','short_rom_top','eccentric_too_fast','shoulder_shrug','clean_rep'
      ) then return false; end if;
    end loop;
  end loop;
  if (select count(distinct (rep_entry.rep_value->>'rep_number')::integer)
      from jsonb_array_elements(payload) as rep_entry(rep_value)) <> jsonb_array_length(payload)
    or (select min((rep_entry.rep_value->>'rep_number')::integer)
      from jsonb_array_elements(payload) as rep_entry(rep_value)) <> 1
    or (select max((rep_entry.rep_value->>'rep_number')::integer)
      from jsonb_array_elements(payload) as rep_entry(rep_value)) <> jsonb_array_length(payload) then
    return false;
  end if;
  return true;
exception when others then return false;
end;
$$;
revoke all on function private.form_coach_attempt_payload_valid(jsonb) from public, anon, authenticated, service_role;

create function public.start_form_coach_attempt(
  target_assessment_id uuid, target_item_id uuid, target_request_id uuid,
  target_clip_opt_in boolean default false
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); assessment public.form_coach_assessments%rowtype;
  item public.form_coach_assessment_items%rowtype; existing_request public.form_coach_attempt_requests%rowtype;
  attempt public.form_coach_attempts%rowtype; latest_review public.form_coach_reviews%rowtype;
  receipt_row public.feature_bundle_funding_receipts%rowtype;
  active_retry boolean := false; allowed_attempts integer; prior_count integer; request_hash text;
  current_terms integer; feature_status text; funding_result text; funding_id uuid; new_token uuid;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null or target_assessment_id is null
    or target_item_id is null or target_request_id is null or target_clip_opt_in is null then
    raise exception 'Attempt request is invalid' using errcode = '22023'; end if;
  if not private.has_role(actor_id, 'member'::public.user_role) then
    raise exception 'Member access is required' using errcode = '42501'; end if;
  set local lock_timeout = '5s';
  set local statement_timeout = '20s';
  select row.* into assessment from public.form_coach_assessments row where row.id = target_assessment_id;
  if not found or assessment.member_subject_id <> actor_id then
    raise exception 'Assessment was not found' using errcode = 'P0002'; end if;
  perform private.form_coach_lock_subjects(array[actor_id, assessment.payer_subject_id, assessment.coach_subject_id]);
  if private.form_coach_subject_has_deletion_fence(actor_id)
    or private.form_coach_subject_has_deletion_fence(assessment.payer_subject_id)
    or private.form_coach_subject_has_deletion_fence(assessment.coach_subject_id) then
    return jsonb_build_object('outcome','account_deleting'); end if;
  select row.* into assessment from public.form_coach_assessments row
  where row.id = target_assessment_id and row.member_subject_id = actor_id for update;
  if not found or assessment.member_owner_id is null then return jsonb_build_object('outcome','account_unavailable'); end if;
  select row.* into item from public.form_coach_assessment_items row
  where row.id = target_item_id and row.assessment_id = assessment.id for update;
  if not found then raise exception 'Assessment item was not found' using errcode = 'P0002'; end if;
  request_hash := encode(extensions.digest(convert_to(concat_ws('|',assessment.id::text,item.id::text,
    target_clip_opt_in::text),'UTF8'),'sha256'),'hex');
  select request.* into existing_request from public.form_coach_attempt_requests request
  where request.request_id = target_request_id;
  if found then
    if existing_request.request_digest <> request_hash then
      raise exception 'Attempt request ID was reused with different consent options' using errcode = '23505'; end if;
    select row.* into attempt from public.form_coach_attempts row where row.id = existing_request.attempt_id;
    return jsonb_build_object('outcome','existing','attempt_id',attempt.id,'attempt_number',attempt.attempt_number,
      'lease_token',existing_request.lease_token,'state',attempt.state,'replayed',true);
  end if;
  if target_clip_opt_in and not assessment.allow_member_clip then
    raise exception 'This assessment does not permit member clips' using errcode = '42501'; end if;
  select current_terms.version into current_terms from public.form_coach_terms_current current_terms;
  if current_terms is null or not exists(select 1 from public.form_coach_member_consents consent
    where consent.member_subject_id=actor_id and consent.member_owner_id=actor_id and consent.terms_version=current_terms) then
    return jsonb_build_object('outcome','consent_required'); end if;
  if not private.has_platform_tier(actor_id,'regular') or assessment.coach_owner_id is null
    or not (private.has_role(assessment.coach_subject_id,'admin'::public.user_role)
      or (private.has_role(assessment.coach_subject_id,'coach'::public.user_role)
        and exists(select 1 from public.coach_members link
          where link.coach_id=assessment.coach_subject_id and link.member_id=actor_id))) then
    return jsonb_build_object('outcome','eligibility_changed'); end if;
  select revision.status into feature_status from public.feature_pricing_current current
  join public.feature_pricing_revisions revision on revision.feature_key=current.feature_key and revision.revision=current.revision
  where current.feature_key='form_coach';
  if feature_status is null or feature_status='disabled' then return jsonb_build_object('outcome','feature_disabled'); end if;
  if assessment.status in ('cancelled','completed') then return jsonb_build_object('outcome','assessment_closed'); end if;
  select review.* into latest_review from public.form_coach_reviews review
  where review.item_id=item.id order by review.review_sequence desc limit 1;
  if found then
    if latest_review.verdict='learned' then return jsonb_build_object('outcome','item_learned'); end if;
    select exists(select 1 from public.form_coach_retry_windows retry_window
      where retry_window.review_id=latest_review.id and retry_window.assessment_id=assessment.id
        and retry_window.item_id=item.id and retry_window.opens_at<=now() and retry_window.closes_at>now()) into active_retry;
    if not active_retry then return jsonb_build_object('outcome','retry_window_required'); end if;
  end if;
  if not active_retry and (assessment.status='expired' or assessment.due_at<=now()) then
    return jsonb_build_object('outcome','assessment_expired'); end if;
  select least(12,item_row.max_attempts + coalesce(sum(retry_window.additional_attempts),0)::integer) into allowed_attempts
  from public.form_coach_assessment_items item_row
  left join public.form_coach_reviews review on review.item_id=item_row.id and review.verdict='needs_work'
  left join public.form_coach_retry_windows retry_window on retry_window.review_id=review.id
  where item_row.id=item.id group by item_row.max_attempts;
  select count(*)::integer into prior_count from public.form_coach_attempts row where row.item_id=item.id;
  select row.* into attempt from public.form_coach_attempts row
  where row.item_id=item.id and row.state='running' and row.lease_expires_at<=now()
  order by row.attempt_number limit 1 for update;
  if found then
    if attempt.clip_opt_in is distinct from target_clip_opt_in then
      raise exception 'Expired attempt can be resumed only with its original consent choices' using errcode = '23505'; end if;
    new_token := gen_random_uuid();
    update public.form_coach_attempts set lease_token=new_token, lease_expires_at=now()+interval '2 minutes'
    where id=attempt.id;
    insert into public.form_coach_attempt_requests(request_id,attempt_id,request_digest,lease_token)
    values(target_request_id,attempt.id,request_hash,new_token);
    return jsonb_build_object('outcome','resumed','attempt_id',attempt.id,'attempt_number',attempt.attempt_number,
      'lease_token',new_token,'state','running','replayed',false);
  end if;
  if exists(select 1 from public.form_coach_attempts row where row.item_id=item.id
    and row.state='running' and row.lease_expires_at>now()) then
    return jsonb_build_object('outcome','attempt_in_progress'); end if;
  if prior_count >= allowed_attempts then return jsonb_build_object('outcome','attempt_limit'); end if;
  -- The item snapshot's configured allowance is available before the first verdict. A coach
  -- verdict closes or reopens the item; it is not a prerequisite between ordinary attempts.
  if active_retry then
    select receipt.* into receipt_row from public.feature_bundle_funding_receipts receipt
    where receipt.feature_key='form_coach' and receipt.bundle_id=assessment.id;
    if not found or receipt_row.payer_role is distinct from assessment.payer_role
      or receipt_row.payer_id is distinct from assessment.payer_subject_id
      or receipt_row.config_revision is distinct from assessment.config_revision
      or receipt_row.due_at is distinct from assessment.due_at then
      return jsonb_build_object('outcome','funding_receipt_missing'); end if;
  else
    select receipt.* into receipt_row from public.feature_bundle_funding_receipts receipt
    where receipt.feature_key='form_coach' and receipt.bundle_id=assessment.id;
    if found then
      if receipt_row.payer_role is distinct from assessment.payer_role
        or receipt_row.payer_id is distinct from assessment.payer_subject_id
        or receipt_row.config_revision is distinct from assessment.config_revision
        or receipt_row.due_at is distinct from assessment.due_at then
        raise exception 'Funding receipt does not match the frozen assessment' using errcode='23505';
      end if;
      if receipt_row.due_at<=now() then return jsonb_build_object('outcome','assessment_expired'); end if;
    else
      if assessment.payer_role='coach' then return jsonb_build_object('outcome','funding_receipt_missing'); end if;
      select funding.outcome, funding.funding_receipt_id into funding_result, funding_id
      from public.record_feature_bundle_funding(assessment.id,'form_coach',assessment.payer_subject_id,
        assessment.config_revision,assessment.due_at,'form-coach-first-attempt:'||assessment.id::text) funding;
      if funding_result not in ('funded','already_funded') then
        return jsonb_build_object('outcome','funding_required','funding_outcome',funding_result); end if;
    end if;
  end if;
  new_token := gen_random_uuid();
  insert into public.form_coach_attempts(
    assessment_id,item_id,member_subject_id,attempt_number,lease_token,lease_expires_at,
    clip_opt_in,consent_terms_version
  ) values(assessment.id,item.id,actor_id,prior_count+1,new_token,now()+interval '2 minutes',
    target_clip_opt_in,current_terms) returning * into attempt;
  insert into public.form_coach_attempt_requests(request_id,attempt_id,request_digest,lease_token)
  values(target_request_id,attempt.id,request_hash,new_token);
  update public.form_coach_assessments set status='in_progress'
  where id=assessment.id and status='sent';
  return jsonb_build_object('outcome','started','attempt_id',attempt.id,'attempt_number',attempt.attempt_number,
    'lease_token',new_token,'state','running','replayed',false,'funding_receipt_id',funding_id);
end;
$$;
revoke all on function public.start_form_coach_attempt(uuid,uuid,uuid,boolean) from public, anon;
grant execute on function public.start_form_coach_attempt(uuid,uuid,uuid,boolean) to authenticated;

create function public.heartbeat_form_coach_attempt(target_attempt_id uuid, target_lease_token uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); attempt public.form_coach_attempts%rowtype;
  assessment public.form_coach_assessments%rowtype; item public.form_coach_assessment_items%rowtype;
  latest_review public.form_coach_reviews%rowtype; receipt_row public.feature_bundle_funding_receipts%rowtype;
  feature_status text; current_terms integer; active_retry boolean:=false;
  retry_closes_at timestamptz; window_closes_at timestamptz; renewed_expires_at timestamptz;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null or target_attempt_id is null or target_lease_token is null then
    raise exception 'Attempt heartbeat is invalid' using errcode = '22023'; end if;
  select row.* into attempt from public.form_coach_attempts row where row.id=target_attempt_id;
  if not found or attempt.member_subject_id<>actor_id or attempt.state<>'running'
    or attempt.lease_token is distinct from target_lease_token or attempt.lease_expires_at<=now() then return false; end if;
  select row.* into assessment from public.form_coach_assessments row where row.id=attempt.assessment_id;
  if not found or assessment.member_subject_id<>actor_id then return false; end if;
  perform private.form_coach_lock_subjects(array[actor_id,assessment.payer_subject_id,assessment.coach_subject_id]);
  if not private.has_role(actor_id,'member'::public.user_role)
    or not private.has_platform_tier(actor_id,'regular')
    or assessment.member_owner_id is distinct from actor_id
    or assessment.coach_owner_id is null
    or not (private.has_role(assessment.coach_subject_id,'admin'::public.user_role)
      or (private.has_role(assessment.coach_subject_id,'coach'::public.user_role)
        and exists(select 1 from public.coach_members link
          where link.coach_id=assessment.coach_subject_id and link.member_id=actor_id))) then return false; end if;
  if private.form_coach_subject_has_deletion_fence(actor_id)
    or private.form_coach_subject_has_deletion_fence(assessment.member_subject_id)
    or private.form_coach_subject_has_deletion_fence(assessment.coach_subject_id)
    or private.form_coach_subject_has_deletion_fence(assessment.payer_subject_id) then return false; end if;
  select current_revision.status into feature_status
  from public.feature_pricing_current current join public.feature_pricing_revisions current_revision
    on current_revision.feature_key=current.feature_key and current_revision.revision=current.revision
  where current.feature_key='form_coach';
  if feature_status is null or feature_status='disabled' then return false; end if;
  select row.* into assessment from public.form_coach_assessments row where row.id=attempt.assessment_id for share;
  if not found or assessment.member_subject_id is distinct from actor_id
    or assessment.member_owner_id is distinct from actor_id or assessment.coach_owner_id is null
    or assessment.status in ('cancelled','completed') then return false; end if;

  select current_terms.version into current_terms
  from public.form_coach_terms_current current_terms where current_terms.singleton;
  if current_terms is null or not exists(
    select 1 from public.form_coach_member_consents consent
    where consent.member_subject_id=actor_id and consent.member_owner_id=actor_id
      and consent.terms_version=current_terms
  ) then return false; end if;

  select receipt.* into receipt_row from public.feature_bundle_funding_receipts receipt
  where receipt.feature_key='form_coach' and receipt.bundle_id=assessment.id;
  if not found or receipt_row.payer_role is distinct from assessment.payer_role
    or receipt_row.payer_id is distinct from assessment.payer_subject_id
    or receipt_row.config_revision is distinct from assessment.config_revision
    or receipt_row.due_at is distinct from assessment.due_at then return false; end if;

  select row.* into item from public.form_coach_assessment_items row
  where row.id=attempt.item_id and row.assessment_id=assessment.id;
  if not found then return false; end if;
  select review.* into latest_review from public.form_coach_reviews review
  where review.item_id=item.id order by review.review_sequence desc limit 1;
  if found then
    if latest_review.verdict='learned' then return false; end if;
    if latest_review.verdict is distinct from 'needs_work' then return false; end if;
    select retry_window.closes_at into retry_closes_at
    from public.form_coach_retry_windows retry_window
    where retry_window.review_id=latest_review.id and retry_window.assessment_id=assessment.id
      and retry_window.item_id=item.id and retry_window.opens_at<=now() and retry_window.closes_at>now();
    active_retry:=found;
    if not active_retry then return false; end if;
    window_closes_at:=retry_closes_at;
  else
    if assessment.status='expired' or assessment.due_at<=now() then return false; end if;
    window_closes_at:=assessment.due_at;
  end if;
  if window_closes_at is null or window_closes_at<=now() then return false; end if;

  select row.* into attempt from public.form_coach_attempts row
  where row.id=target_attempt_id and row.member_subject_id=actor_id for update;
  if not found or attempt.state<>'running' or attempt.lease_token is distinct from target_lease_token
    or attempt.lease_expires_at<=now() then return false; end if;
  -- Preserve the already-issued finish grace; only any added lease time is capped by the
  -- currently authorized due or exact retry window.
  renewed_expires_at:=greatest(attempt.lease_expires_at,least(now()+interval '2 minutes',window_closes_at));
  if renewed_expires_at<=now() then return false; end if;
  update public.form_coach_attempts row set lease_expires_at=renewed_expires_at
  where row.id=target_attempt_id and row.state='running' and row.lease_token=target_lease_token
    and row.member_subject_id=actor_id and row.lease_expires_at>now();
  return found;
end;
$$;
revoke all on function public.heartbeat_form_coach_attempt(uuid,uuid) from public, anon;
grant execute on function public.heartbeat_form_coach_attempt(uuid,uuid) to authenticated;

create function public.finish_form_coach_attempt(
  target_attempt_id uuid, target_lease_token uuid, target_rep_results jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); attempt public.form_coach_attempts%rowtype;
  assessment public.form_coach_assessments%rowtype; item public.form_coach_assessment_items%rowtype;
  digest_value text; rep jsonb; fault jsonb; rep_count integer; average_score numeric;
  numeric_payload jsonb; existing public.form_coach_attempt_results%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null or target_attempt_id is null
    or target_lease_token is null or target_rep_results is null
    or not private.form_coach_attempt_payload_valid(target_rep_results) then
    raise exception 'Attempt result is invalid' using errcode = '22023'; end if;
  select row.* into attempt from public.form_coach_attempts row where row.id=target_attempt_id;
  if not found or attempt.member_subject_id<>actor_id then raise exception 'Attempt was not found' using errcode='P0002'; end if;
  if not private.has_role(actor_id,'member'::public.user_role) then raise exception 'Member role is required' using errcode='42501'; end if;
  select row.* into assessment from public.form_coach_assessments row where row.id=attempt.assessment_id;
  if not found or assessment.member_subject_id<>actor_id then raise exception 'Assessment is unavailable' using errcode='55000'; end if;
  perform private.form_coach_lock_subjects(array[actor_id,assessment.coach_subject_id]);
  if private.form_coach_subject_has_deletion_fence(actor_id)
    or private.form_coach_subject_has_deletion_fence(assessment.coach_subject_id) then
    raise exception 'Account deletion is in progress' using errcode='55000'; end if;
  select row.* into assessment from public.form_coach_assessments row
  where row.id=attempt.assessment_id and row.member_subject_id=actor_id for update;
  if not found or assessment.member_owner_id is null or assessment.coach_owner_id is null
    or private.form_coach_subject_has_deletion_fence(assessment.coach_subject_id) then
    raise exception 'Assessment is unavailable' using errcode='55000'; end if;
  select row.* into item from public.form_coach_assessment_items row
  where row.id=attempt.item_id and row.assessment_id=assessment.id for update;
  if not found then raise exception 'Assessment item was not found' using errcode='P0002'; end if;
  select row.* into attempt from public.form_coach_attempts row where row.id=target_attempt_id for update;
  if attempt.lease_token<>target_lease_token then raise exception 'Attempt lease has been superseded' using errcode='40001'; end if;
  digest_value := encode(extensions.digest(convert_to(target_rep_results::text,'UTF8'),'sha256'),'hex');
  if attempt.state='finished' then
    select result.* into existing from public.form_coach_attempt_results result where result.attempt_id=attempt.id;
    if existing.result_digest<>digest_value then raise exception 'Final attempt result is immutable' using errcode='23505'; end if;
    return jsonb_build_object('outcome','already_finished','attempt_id',attempt.id,
      'rep_count',existing.rep_count,'average_score',existing.average_score);
  end if;
  if attempt.state<>'running' then raise exception 'Attempt reservation is not active' using errcode='55000'; end if;
  if attempt.lease_expires_at<=now() then raise exception 'Attempt lease has expired' using errcode='40001'; end if;
  rep_count := jsonb_array_length(target_rep_results);
  if rep_count < item.required_reps then
    raise exception 'Attempt does not contain the required rep count' using errcode='23514';
  end if;
  for rep in select value from jsonb_array_elements(target_rep_results) reps(value) loop
    insert into public.form_coach_attempt_rep_results(
      attempt_id,rep_number,score,rom_min_angle,rom_max_angle,rom_score,max_upper_arm_drift,
      max_torso_swing,max_shrug,concentric_ms,top_pause_ms,eccentric_ms,curve_similarity,
      elbow_score,torso_score,tempo_score,shoulders_score,faults
    ) values (
      attempt.id,(rep->>'rep_number')::smallint,(rep->>'score')::numeric,
      (rep->>'rom_min_angle')::numeric,(rep->>'rom_max_angle')::numeric,(rep->>'rom_score')::numeric,
      (rep->>'max_upper_arm_drift')::numeric,(rep->>'max_torso_swing')::numeric,(rep->>'max_shrug')::numeric,
      (rep->>'concentric_ms')::integer,(rep->>'top_pause_ms')::integer,(rep->>'eccentric_ms')::integer,
      (rep->>'curve_similarity')::numeric,(rep->>'elbow_score')::numeric,(rep->>'torso_score')::numeric,(rep->>'tempo_score')::numeric,
      (rep->>'shoulders_score')::numeric,array(select jsonb_array_elements_text(rep->'faults'))
    );
  end loop;
  select round(avg(result.score),2) into average_score from public.form_coach_attempt_rep_results result
  where result.attempt_id=attempt.id;
  select jsonb_build_object(
    'rep_count',count(*)::integer,
    'average_score',round(avg(result.score),2),
    'minimum_score',min(result.score),
    'maximum_score',max(result.score),
    'rom_min_angle_average',round(avg(result.rom_min_angle),2),
    'rom_max_angle_average',round(avg(result.rom_max_angle),2),
    'rom_average',round(avg(result.rom_score),2),
    'elbow_average',round(avg(result.elbow_score),2),
    'torso_average',round(avg(result.torso_score),2),
    'tempo_average',round(avg(result.tempo_score),2),
    'shoulders_average',round(avg(result.shoulders_score),2),
    'max_upper_arm_drift',max(result.max_upper_arm_drift),
    'max_torso_swing',max(result.max_torso_swing),
    'max_shrug',max(result.max_shrug),
    'concentric_ms_average',round(avg(result.concentric_ms),2),
    'top_pause_ms_average',round(avg(result.top_pause_ms),2),
    'eccentric_ms_average',round(avg(result.eccentric_ms),2),
    'curve_similarity_average',round(avg(result.curve_similarity),2),
    'elbow_drift_count',count(*) filter(where 'elbow_drift'=any(result.faults)),
    'torso_swing_count',count(*) filter(where 'torso_swing'=any(result.faults)),
    'short_rom_count',count(*) filter(where result.faults && array['short_rom_bottom','short_rom_top']::text[]),
    'shoulder_shrug_count',count(*) filter(where 'shoulder_shrug'=any(result.faults))
  ) into numeric_payload from public.form_coach_attempt_rep_results result where result.attempt_id=attempt.id;
  if not private.form_coach_numeric_summary_valid(numeric_payload) then
    raise exception 'Numeric attempt summary is invalid' using errcode='23514'; end if;
  insert into public.form_coach_attempt_results(attempt_id,result_digest,rep_count,average_score,numeric_summary)
  values(attempt.id,digest_value,rep_count,average_score,numeric_payload);
  update public.form_coach_attempts set state='finished',finished_at=now(),result_digest=digest_value
  where id=attempt.id and state='running' and lease_token=target_lease_token;
  if not found then raise exception 'Attempt changed while finalizing' using errcode='40001'; end if;
  insert into public.form_coach_summary_outbox(attempt_id,prompt_version,numeric_payload)
  values(attempt.id,'attempt-summary-v1',numeric_payload) on conflict(attempt_id) do nothing;
  insert into public.form_coach_notification_outbox(
    event_key,recipient_subject_id,recipient_owner_id,assessment_id,event_kind
  ) values('assessment-submitted:'||assessment.id::text||':'||attempt.id::text,
    assessment.coach_subject_id,assessment.coach_owner_id,assessment.id,'assessment_submitted')
  on conflict(event_key) do nothing;
  return jsonb_build_object('outcome','finished','attempt_id',attempt.id,'rep_count',rep_count,
    'average_score',average_score,'coach_review_required',true);
end;
$$;
revoke all on function public.finish_form_coach_attempt(uuid,uuid,jsonb) from public, anon;
grant execute on function public.finish_form_coach_attempt(uuid,uuid,jsonb) to authenticated;

create function public.archive_form_coach_template(target_template_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); template_row public.form_coach_templates%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null or target_template_id is null then
    raise exception 'Template archive request is invalid' using errcode='22023'; end if;
  perform private.form_coach_lock_subjects(array[actor_id]);
  if private.form_coach_subject_has_deletion_fence(actor_id) then
    raise exception 'Account deletion is in progress' using errcode='55000'; end if;
  select template.* into template_row from public.form_coach_templates template
  where template.id=target_template_id for update;
  if not found or not private.form_coach_can_manage_template(target_template_id,actor_id) then
    raise exception 'Template was not found' using errcode='P0002'; end if;
  update public.form_coach_templates set archived_at=coalesce(archived_at,now()) where id=template_row.id;
  return true;
end;
$$;
revoke all on function public.archive_form_coach_template(uuid) from public, anon, service_role;
grant execute on function public.archive_form_coach_template(uuid) to authenticated;

create function public.get_my_form_coach_templates()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); actor_role public.user_role; result jsonb;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null then return '[]'::jsonb; end if;
  select profile.role into actor_role from public.profiles profile where profile.id=actor_id;
  if actor_role is null or actor_role not in ('coach'::public.user_role,'admin'::public.user_role) then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', template.id, 'name', template.name, 'owner_kind', template.owner_kind,
    'archived_at', template.archived_at, 'created_at', template.created_at,
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', version.id, 'revision', version.revision, 'exercise_key', version.exercise_key,
        'schema_version', version.schema_version, 'state', version.state,
        'published_at', version.published_at, 'template_payload',
          jsonb_set(version.template_payload, '{cues}', coalesce((
            select jsonb_agg(cue.value - 'audioPath' order by cue.ordinality)
            from jsonb_array_elements(version.template_payload->'cues') with ordinality cue(value,ordinality)
          ),'[]'::jsonb),false)
      ) order by version.revision desc)
      from public.form_coach_template_versions version where version.template_id=template.id
    ),'[]'::jsonb)
  ) order by template.created_at desc),'[]'::jsonb) into result
  from public.form_coach_templates template
  where (template.owner_id=actor_id or actor_role='admin'::public.user_role);
  return result;
end;
$$;
revoke all on function public.get_my_form_coach_templates() from public, anon, service_role;
grant execute on function public.get_my_form_coach_templates() to authenticated;

create function public.get_form_coach_program_rule(target_program_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); rule public.form_coach_program_rules%rowtype;
  item_rows jsonb;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null or target_program_id is null then return null; end if;
  if not exists(select 1 from public.profiles profile where profile.id=actor_id
      and profile.role in ('coach'::public.user_role,'admin'::public.user_role))
    or private.can_manage_program(target_program_id) is distinct from true then return null; end if;
  select row.* into rule from public.form_coach_program_rules row where row.program_id=target_program_id;
  if not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'template_version_id',item.template_version_id,'required_reps',item.required_reps,
    'pass_threshold',item.pass_threshold,'cues_enabled',item.cues_enabled,'max_attempts',item.max_attempts
  ) order by item.item_ordinal),'[]'::jsonb) into item_rows
  from public.form_coach_program_rule_items item where item.rule_id=rule.id;
  return jsonb_build_object('id',rule.id,'program_id',rule.program_id,
    'revision',rule.revision,'generation_id',rule.generation_id,'enabled',rule.enabled,
    'auto_send',rule.auto_send,'due_days',rule.due_days,'allow_member_clip',rule.allow_member_clip,
    'items',item_rows,'updated_at',rule.updated_at);
end;
$$;
revoke all on function public.get_form_coach_program_rule(uuid) from public, anon, service_role;
grant execute on function public.get_form_coach_program_rule(uuid) to authenticated;

create function public.list_my_form_coach_assessments(target_page integer default 1, target_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); output_rows jsonb; total_count bigint; safe_page integer; safe_size integer;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null
    or target_page is null or target_page<1 or target_page_size is null or target_page_size not between 1 and 50 then
    raise exception 'Assessment page is invalid' using errcode='22023'; end if;
  if not private.has_role(actor_id,'member'::public.user_role) then return jsonb_build_object('rows','[]'::jsonb,'page',1,'has_more',false); end if;
  safe_page:=least(target_page,1000000); safe_size:=target_page_size;
  select count(*) into total_count from public.form_coach_assessments assessment
  where assessment.member_subject_id=actor_id and assessment.member_owner_id=actor_id;
  select coalesce(jsonb_agg(page_row.value order by page_row.ordinality),'[]'::jsonb) into output_rows
  from (
    select jsonb_build_object(
      'assessment_id',assessment.id,'source_kind',assessment.source_kind,'program_title',assessment.program_title_snapshot,
      'sent_at',assessment.sent_at,'due_at',assessment.due_at,'status',assessment.status,
      'item_count',(select count(*) from public.form_coach_assessment_items item where item.assessment_id=assessment.id),
      'finished_attempt_count',(select count(*) from public.form_coach_attempts attempt
        where attempt.assessment_id=assessment.id and attempt.state='finished')
    ) as value, row_number() over(order by assessment.sent_at desc,assessment.id) as ordinality
    from public.form_coach_assessments assessment
    where assessment.member_subject_id=actor_id and assessment.member_owner_id=actor_id
    order by assessment.sent_at desc,assessment.id limit safe_size offset (safe_page-1)*safe_size
  ) page_row;
  return jsonb_build_object('rows',output_rows,'page',safe_page,'has_more',total_count>safe_page*safe_size);
end;
$$;
revoke all on function public.list_my_form_coach_assessments(integer,integer) from public, anon, service_role;
grant execute on function public.list_my_form_coach_assessments(integer,integer) to authenticated;

create function public.get_form_coach_assessment(target_assessment_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); actor_role public.user_role; assessment public.form_coach_assessments%rowtype;
  member_view boolean:=false; coach_view boolean:=false; admin_view boolean:=false;
  live_use boolean:=false; member_can_open boolean:=false;
  items_json jsonb; receipt_ok boolean; current_status text;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null or target_assessment_id is null then return null; end if;
  select profile.role into actor_role from public.profiles profile where profile.id=actor_id;
  select row.* into assessment from public.form_coach_assessments row where row.id=target_assessment_id;
  if not found then return null; end if;
  -- auth.uid() may be a stale/profileless JWT subject. NULL booleans make `IF NOT (a OR b OR c)`
  -- evaluate to NULL and skip the authorization branch, so require a current role first.
  if actor_role is null or actor_role not in (
    'member'::public.user_role,'coach'::public.user_role,'admin'::public.user_role
  ) then return null; end if;
  member_view:=actor_role='member'::public.user_role and assessment.member_subject_id=actor_id and assessment.member_owner_id=actor_id;
  coach_view:=actor_role='coach'::public.user_role and assessment.coach_subject_id=actor_id and assessment.coach_owner_id=actor_id
    and exists(select 1 from public.coach_members link where link.coach_id=actor_id and link.member_id=assessment.member_subject_id);
  admin_view:=actor_role='admin'::public.user_role;
  if not (member_view or coach_view or admin_view) then return null; end if;
  select revision.status into current_status from public.feature_pricing_current current
  join public.feature_pricing_revisions revision on revision.feature_key=current.feature_key and revision.revision=current.revision
  where current.feature_key='form_coach';
  select exists(select 1 from public.feature_bundle_funding_receipts receipt
    where receipt.feature_key='form_coach' and receipt.bundle_id=assessment.id
      and receipt.payer_role=assessment.payer_role and receipt.payer_id=assessment.payer_subject_id
      and receipt.config_revision=assessment.config_revision and receipt.due_at=assessment.due_at)
    into receipt_ok;
  live_use:=current_status is distinct from 'disabled' and receipt_ok
    and (assessment.due_at>=now() or exists(
      select 1 from public.form_coach_retry_windows retry_window
      join public.form_coach_reviews review on review.id=retry_window.review_id
      where retry_window.assessment_id=assessment.id and retry_window.opens_at<=now() and retry_window.closes_at>now()
        and review.verdict='needs_work'
    ));
  if member_view then
    member_can_open:=current_status is distinct from 'disabled'
      and private.has_platform_tier(actor_id,'regular')
      and assessment.coach_owner_id is not null
      and private.has_role(assessment.coach_subject_id,'coach'::public.user_role)
      and exists(select 1 from public.coach_members link
        where link.coach_id=assessment.coach_subject_id and link.member_id=actor_id)
      and (receipt_ok or (assessment.payer_role='member' and current_status='live'))
      and (assessment.due_at>=now() or exists(
        select 1 from public.form_coach_retry_windows retry_window
        join public.form_coach_reviews review on review.id=retry_window.review_id
        where retry_window.assessment_id=assessment.id and retry_window.opens_at<=now() and retry_window.closes_at>now()
          and review.verdict='needs_work'
      ));
    live_use:=member_can_open;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id',item.id,'ordinal',item.item_ordinal,'item_key',item.item_key,
    'title',item.item_title_snapshot,'exercise_key',item.exercise_key,
    'required_reps',item.required_reps,'pass_threshold',item.pass_threshold,
    'cues_enabled',item.cues_enabled,'max_attempts',item.max_attempts,
    'attempts',coalesce((select jsonb_agg(jsonb_build_object(
      'attempt_id',attempt.id,'attempt_number',attempt.attempt_number,'state',attempt.state,
      'started_at',attempt.started_at,'finished_at',attempt.finished_at,'result',case when result.attempt_id is null then null else
        jsonb_build_object('rep_count',result.rep_count,'average_score',result.average_score,
          'numeric_summary',result.numeric_summary,'summary_state',result.summary_state,'coach_summary',result.coach_summary,
          'rep_results',(select coalesce(jsonb_agg(jsonb_build_object(
            'rep_number',rep.rep_number,'score',rep.score,'rom_min_angle',rep.rom_min_angle,
            'rom_max_angle',rep.rom_max_angle,'rom_score',rep.rom_score,
            'max_upper_arm_drift',rep.max_upper_arm_drift,'max_torso_swing',rep.max_torso_swing,
            'max_shrug',rep.max_shrug,'concentric_ms',rep.concentric_ms,'top_pause_ms',rep.top_pause_ms,
            'eccentric_ms',rep.eccentric_ms,'curve_similarity',rep.curve_similarity,
            'elbow_score',rep.elbow_score,'torso_score',rep.torso_score,'tempo_score',rep.tempo_score,
            'shoulders_score',rep.shoulders_score,'faults',rep.faults
          ) order by rep.rep_number),'[]'::jsonb) from public.form_coach_attempt_rep_results rep
            where rep.attempt_id=attempt.id)) end
    ) order by attempt.attempt_number)
      from public.form_coach_attempts attempt
      left join public.form_coach_attempt_results result on result.attempt_id=attempt.id
      where attempt.item_id=item.id and attempt.member_subject_id=assessment.member_subject_id
    ),'[]'::jsonb),
    'latest_review',(select jsonb_build_object('verdict',review.verdict,'feedback',review.feedback,'created_at',review.created_at)
      from public.form_coach_reviews review where review.item_id=item.id order by review.review_sequence desc limit 1),
    'template',case when member_can_open or coach_view or admin_view then
      jsonb_set(version.template_payload,'{cues}',coalesce((
        select jsonb_agg(cue.value - 'audioPath' order by cue.ordinality)
        from jsonb_array_elements(version.template_payload->'cues') with ordinality cue(value,ordinality)
      ),'[]'::jsonb),false) else null end
  ) order by item.item_ordinal),'[]'::jsonb) into items_json
  from public.form_coach_assessment_items item
  join public.form_coach_template_versions version on version.id=item.template_version_id
  where item.assessment_id=assessment.id;
  return jsonb_build_object('assessment_id',assessment.id,'source_kind',assessment.source_kind,
    'program_title',assessment.program_title_snapshot,'sent_at',assessment.sent_at,'due_at',assessment.due_at,
    'status',assessment.status,'payer_role',assessment.payer_role,'can_attempt',member_view and live_use,
    'items',items_json);
end;
$$;
revoke all on function public.get_form_coach_assessment(uuid) from public, anon, service_role;
grant execute on function public.get_form_coach_assessment(uuid) to authenticated;

create function public.record_form_coach_review(
  target_attempt_id uuid, target_expected_review_sequence integer, target_request_id uuid, target_verdict text,
  target_feedback text default '', open_retry_window boolean default false,
  retry_minutes integer default null, extra_attempts smallint default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid:=auth.uid(); actor_role public.user_role; attempt public.form_coach_attempts%rowtype;
  assessment public.form_coach_assessments%rowtype; item public.form_coach_assessment_items%rowtype;
  replay_review public.form_coach_reviews%rowtype;
  current_review_sequence integer; prior_retry_count integer; prior_extra integer; request_hash text; new_review_id uuid;
  new_window_id uuid; feature_status text; coach_allowed boolean;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null or target_attempt_id is null
    or target_expected_review_sequence is null or target_expected_review_sequence < 0
    or target_request_id is null or target_verdict is null or target_verdict not in ('learned','needs_work')
    or target_feedback is null or char_length(target_feedback)>1000 or open_retry_window is null
    or (open_retry_window and (target_verdict<>'needs_work' or retry_minutes is null
      or retry_minutes not between 1 and 43200 or extra_attempts is null or extra_attempts not between 1 and 3))
    or (not open_retry_window and (retry_minutes is not null or extra_attempts is not null)) then
    raise exception 'Form Coach review is invalid' using errcode='22023'; end if;
  select profile.role into actor_role from public.profiles profile where profile.id=actor_id;
  if actor_role is distinct from 'coach'::public.user_role and actor_role is distinct from 'admin'::public.user_role then
    raise exception 'Coach access is required' using errcode='42501'; end if;
  request_hash:=encode(extensions.digest(convert_to(concat_ws('|',actor_id::text,target_attempt_id::text,
    target_expected_review_sequence::text,target_verdict,
    btrim(target_feedback),open_retry_window::text,coalesce(retry_minutes::text,''),coalesce(extra_attempts::text,'')),'UTF8'),'sha256'),'hex');
  select review.* into replay_review from public.form_coach_reviews review where review.request_id=target_request_id;
  if found then
    if replay_review.coach_subject_id is distinct from actor_id or replay_review.request_digest is distinct from request_hash then
      raise exception 'Review request ID was reused' using errcode='23505'; end if;
    return jsonb_build_object('outcome','already_recorded','review_id',replay_review.id,
      'verdict',replay_review.verdict,'retry_opened',exists(select 1 from public.form_coach_retry_windows retry_window where retry_window.review_id=replay_review.id));
  end if;
  select row.* into attempt from public.form_coach_attempts row where row.id=target_attempt_id;
  if not found then raise exception 'Attempt was not found' using errcode='P0002'; end if;
  select row.* into assessment from public.form_coach_assessments row where row.id=attempt.assessment_id;
  if not found then raise exception 'Assessment was not found' using errcode='P0002'; end if;
  perform private.form_coach_lock_subjects(array[actor_id,assessment.member_subject_id,assessment.coach_subject_id]);
  if private.form_coach_subject_has_deletion_fence(actor_id)
    or private.form_coach_subject_has_deletion_fence(assessment.member_subject_id)
    or private.form_coach_subject_has_deletion_fence(assessment.coach_subject_id) then
    raise exception 'Account deletion is in progress' using errcode='55000'; end if;
  select profile.role into actor_role from public.profiles profile where profile.id=actor_id;
  if actor_role is distinct from 'coach'::public.user_role and actor_role is distinct from 'admin'::public.user_role then
    raise exception 'Coach access changed' using errcode='42501'; end if;
  select row.* into assessment from public.form_coach_assessments row
  where row.id=attempt.assessment_id for update;
  if not found or assessment.member_owner_id is null or assessment.coach_owner_id is null
    or assessment.status='cancelled' then raise exception 'Assessment is unavailable' using errcode='55000'; end if;
  select row.* into item from public.form_coach_assessment_items row
  where row.id=attempt.item_id and row.assessment_id=assessment.id for update;
  if not found then raise exception 'Assessment item was not found' using errcode='P0002'; end if;
  select coalesce(max(review.review_sequence),0)::integer into current_review_sequence
  from public.form_coach_reviews review where review.item_id=item.id;
  if target_expected_review_sequence is distinct from current_review_sequence then
    raise exception 'Review sequence is stale' using errcode='40001';
  end if;
  select row.* into attempt from public.form_coach_attempts row
  where row.id=target_attempt_id and row.assessment_id=assessment.id for update;
  if not found or attempt.state<>'finished' then raise exception 'Only a finished attempt can be reviewed' using errcode='55000'; end if;
  coach_allowed:=actor_role='admin'::public.user_role or (
    actor_role='coach'::public.user_role and assessment.coach_subject_id=actor_id
    and exists(select 1 from public.coach_members link where link.coach_id=actor_id and link.member_id=assessment.member_subject_id));
  if not coach_allowed then raise exception 'Current coach relationship is required' using errcode='42501'; end if;
  select revision.status into feature_status from public.feature_pricing_current current
  join public.feature_pricing_revisions revision on revision.feature_key=current.feature_key and revision.revision=current.revision
  where current.feature_key='form_coach';
  if feature_status is null or feature_status='disabled' then
    return jsonb_build_object('outcome','feature_disabled'); end if;
  if exists(select 1 from public.form_coach_reviews review where review.item_id=item.id and review.verdict='learned') then
    return jsonb_build_object('outcome','item_learned'); end if;
  if not exists(select 1 from public.feature_bundle_funding_receipts receipt
    where receipt.feature_key='form_coach' and receipt.bundle_id=assessment.id
      and receipt.payer_role=assessment.payer_role and receipt.payer_id=assessment.payer_subject_id
      and receipt.config_revision=assessment.config_revision and receipt.due_at=assessment.due_at) then
    raise exception 'Assessment funding receipt is missing' using errcode='55000'; end if;
  new_review_id:=gen_random_uuid();
  insert into public.form_coach_reviews(
    id,request_id,assessment_id,item_id,attempt_id,coach_subject_id,coach_owner_id,
    verdict,feedback,request_digest,review_sequence
  ) values(new_review_id,target_request_id,assessment.id,item.id,attempt.id,actor_id,actor_id,
    target_verdict,btrim(target_feedback),request_hash,current_review_sequence+1);
  if open_retry_window then
    select count(*)::integer,coalesce(sum(retry_window.additional_attempts),0)::integer
      into prior_retry_count,prior_extra
    from public.form_coach_retry_windows retry_window where retry_window.item_id=item.id;
    if prior_retry_count>=3 or prior_extra+extra_attempts>9 then
      raise exception 'Retry allowance is exhausted' using errcode='54000'; end if;
    new_window_id:=gen_random_uuid();
    insert into public.form_coach_retry_windows(
      id,review_id,assessment_id,item_id,opened_by_subject_id,opened_by_owner_id,
      additional_attempts,opens_at,closes_at
    ) values(new_window_id,new_review_id,assessment.id,item.id,actor_id,actor_id,
      extra_attempts,now(),now()+make_interval(mins=>retry_minutes));
  end if;
  if target_verdict='learned' and not exists(
    select 1 from public.form_coach_assessment_items candidate
    where candidate.assessment_id=assessment.id and not exists(
      select 1 from public.form_coach_reviews latest
      where latest.item_id=candidate.id and latest.verdict='learned'
        and latest.review_sequence=(select max(last_review.review_sequence) from public.form_coach_reviews last_review where last_review.item_id=candidate.id)
    )
  ) then
    update public.form_coach_assessments set status='completed' where id=assessment.id and status<>'cancelled';
  elsif target_verdict='needs_work' and assessment.status='completed' then
    update public.form_coach_assessments set status='in_progress' where id=assessment.id;
  end if;
  insert into public.form_coach_notification_outbox(event_key,recipient_subject_id,recipient_owner_id,assessment_id,event_kind)
  values('review:'||new_review_id::text,assessment.member_subject_id,assessment.member_owner_id,assessment.id,'review_recorded')
  on conflict(event_key) do nothing;
  if open_retry_window then
    insert into public.form_coach_notification_outbox(event_key,recipient_subject_id,recipient_owner_id,assessment_id,event_kind)
    values('retry:'||new_review_id::text,assessment.member_subject_id,assessment.member_owner_id,assessment.id,'retry_opened')
    on conflict(event_key) do nothing;
  end if;
  return jsonb_build_object('outcome','recorded','review_id',new_review_id,'verdict',target_verdict,
    'retry_window_id',new_window_id,'retry_opened',open_retry_window);
end;
$$;
revoke all on function public.record_form_coach_review(uuid,integer,uuid,text,text,boolean,integer,smallint) from public, anon, service_role;
grant execute on function public.record_form_coach_review(uuid,integer,uuid,text,text,boolean,integer,smallint) to authenticated;

create function public.service_reserve_form_coach_media_upload(
  target_request_id uuid, target_asset_kind text, target_owner_id uuid,
  target_template_version_id uuid, target_attempt_id uuid, target_asset_key text,
  target_bucket_id text, target_storage_path text, target_sha256 text,
  target_byte_size bigint, claimed_duration_seconds numeric default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare profile_role public.user_role; version_row public.form_coach_template_versions%rowtype;
  template_row public.form_coach_templates%rowtype; assessment public.form_coach_assessments%rowtype;
  attempt public.form_coach_attempts%rowtype; policy_row public.form_coach_media_policy_versions%rowtype;
  existing public.form_coach_media_upload_intents%rowtype; expected_bucket text; slash_count integer; request_hash text;
  bucket_limit bigint;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if target_request_id is null or target_owner_id is null or target_asset_kind is null
    or target_asset_kind not in ('template_reference','template_cue','member_clip')
    or target_bucket_id is null or target_storage_path is null or target_sha256 is null
    or target_sha256 !~ '^[a-f0-9]{64}$' or target_byte_size is null or target_byte_size<1
    or (target_asset_kind in ('template_reference','template_cue') and target_byte_size>200000000)
    or (target_asset_kind='member_clip' and target_byte_size>26214400) then
    raise exception 'Media upload reservation is invalid' using errcode='22023'; end if;
  slash_count:=length(target_storage_path)-length(replace(target_storage_path,'/',''));
  if target_storage_path ~ '(^/|//|(^|/)\.\.?(/|$)|[?#]|^https?://)'
    or split_part(target_storage_path,'/',1)<>target_owner_id::text then
    raise exception 'Media path is not owner-scoped' using errcode='22023'; end if;
  expected_bucket:=case target_asset_kind when 'template_reference' then 'form-coach-reference'
    when 'template_cue' then 'form-coach-cues' else 'form-coach-clips' end;
  if target_bucket_id<>expected_bucket then raise exception 'Media bucket does not match asset kind' using errcode='22023'; end if;
  request_hash:=encode(extensions.digest(convert_to(concat_ws('|',target_asset_kind,target_owner_id::text,
    coalesce(target_template_version_id::text,''),coalesce(target_attempt_id::text,''),coalesce(target_asset_key,''),
    target_bucket_id,target_storage_path,target_sha256,target_byte_size::text,coalesce(claimed_duration_seconds::text,'')),'UTF8'),'sha256'),'hex');
  perform private.form_coach_lock_subjects(array[target_owner_id]);
  if private.form_coach_subject_has_deletion_fence(target_owner_id) then
    return jsonb_build_object('outcome','account_deleting'); end if;
  select intent.* into existing from public.form_coach_media_upload_intents intent where intent.request_id=target_request_id;
  if found then
    if existing.owner_subject_id<>target_owner_id or existing.asset_kind<>target_asset_kind
      or existing.template_version_id is distinct from target_template_version_id
      or existing.attempt_id is distinct from target_attempt_id or existing.asset_key is distinct from target_asset_key
      or existing.bucket_id<>target_bucket_id or existing.storage_path<>target_storage_path
      or existing.expected_sha256<>target_sha256 or existing.expected_byte_size<>target_byte_size
      or existing.expected_duration_seconds is distinct from claimed_duration_seconds then
      raise exception 'Media upload request was reused' using errcode='23505'; end if;
    return jsonb_build_object('outcome','existing','upload_intent_id',existing.id,'state',existing.state);
  end if;
  select profile.role into profile_role from public.profiles profile where profile.id=target_owner_id;
  if target_asset_kind in ('template_reference','template_cue') then
    if profile_role is null or profile_role not in ('coach'::public.user_role,'admin'::public.user_role)
      or target_template_version_id is null or target_attempt_id is not null
      or (target_asset_kind='template_reference' and target_asset_key<>'reference')
      or (target_asset_kind='template_cue' and (target_asset_key is null or target_asset_key !~ '^cue_[a-z0-9_]{1,60}$'))
      or (target_asset_kind='template_reference' and (slash_count<>2 or target_storage_path !~ '/[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp4|webm)$'))
      or (target_asset_kind='template_cue' and (slash_count<>3 or target_storage_path !~ '/[0-9a-f-]{36}/cue_[a-z0-9_]{1,60}/[0-9a-f-]{36}\.(mp3|m4a|webm|ogg)$')) then
      raise exception 'Template asset reservation is invalid' using errcode='22023'; end if;
    select version.* into version_row from public.form_coach_template_versions version
    where version.id=target_template_version_id and version.state='draft' for update;
    if not found then raise exception 'Only a draft template can reserve an asset' using errcode='55000'; end if;
    select template.* into template_row from public.form_coach_templates template
    where template.id=version_row.template_id for update;
    if template_row.archived_at is not null
      or (profile_role='coach' and (template_row.owner_subject_id<>target_owner_id or template_row.owner_kind<>'coach'))
      or (profile_role='admin' and template_row.owner_subject_id<>target_owner_id) then
      raise exception 'Template owner access changed' using errcode='42501'; end if;
    if not private.form_coach_coach_can_manage_templates(target_owner_id) then
      raise exception 'Form Coach template entitlement is required' using errcode='42501'; end if;
    select policy.* into policy_row from public.form_coach_media_policy_current current
    join public.form_coach_media_policy_versions policy on policy.revision=current.revision where current.singleton;
    if not found or target_byte_size>policy_row.reference_max_bytes then
      raise exception 'Asset exceeds the current private upload limit' using errcode='22023'; end if;
    select bucket.file_size_limit into bucket_limit from storage.buckets bucket
    where bucket.id=expected_bucket and bucket.public is false;
    if not found or bucket_limit is null or target_byte_size>bucket_limit then
      raise exception 'Asset exceeds the current private upload limit' using errcode='22023'; end if;
  else
    if profile_role is distinct from 'member'::public.user_role or target_template_version_id is not null
      or target_attempt_id is null or target_asset_key is not null or claimed_duration_seconds is null
      or claimed_duration_seconds<=0 or claimed_duration_seconds>60 or slash_count<>3
      or target_storage_path !~ '/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp4|webm)$' then
      raise exception 'Member clip reservation is invalid' using errcode='22023'; end if;
    select reserved_attempt.* into attempt from public.form_coach_attempts reserved_attempt
    where reserved_attempt.id=target_attempt_id and reserved_attempt.member_subject_id=target_owner_id for update;
    if not found or attempt.clip_opt_in is distinct from true or attempt.state='abandoned' then
      raise exception 'The exact attempt did not opt in to a clip' using errcode='42501'; end if;
    select reserved_assessment.* into assessment from public.form_coach_assessments reserved_assessment
    where reserved_assessment.id=attempt.assessment_id and reserved_assessment.member_owner_id=target_owner_id;
    if not found or assessment.allow_member_clip is distinct from true then
      raise exception 'The assessment does not permit member clips' using errcode='42501'; end if;
    if split_part(target_storage_path,'/',2)<>assessment.id::text
      or split_part(target_storage_path,'/',3)<>attempt.id::text
      or not exists(select 1 from public.form_coach_member_consents consent
        where consent.member_subject_id=target_owner_id and consent.member_owner_id=target_owner_id
          and consent.terms_version=attempt.consent_terms_version) then
      raise exception 'Member clip ownership or consent does not match the attempt' using errcode='42501'; end if;
    select policy.* into policy_row from public.form_coach_media_policy_current current
    join public.form_coach_media_policy_versions policy on policy.revision=current.revision where current.singleton;
    if not found or target_byte_size>policy_row.member_clip_max_bytes
      or claimed_duration_seconds>policy_row.member_clip_max_seconds then
      raise exception 'Clip exceeds the current private upload limit' using errcode='22023'; end if;
    select bucket.file_size_limit into bucket_limit from storage.buckets bucket
    where bucket.id=expected_bucket and bucket.public is false;
    if not found or bucket_limit is null or target_byte_size>bucket_limit then
      raise exception 'Clip exceeds the current private upload limit' using errcode='22023'; end if;
  end if;
  insert into public.form_coach_media_upload_intents(
    request_id,asset_kind,owner_subject_id,owner_id,template_version_id,attempt_id,asset_key,
    bucket_id,storage_path,expected_sha256,expected_byte_size,expected_duration_seconds
  ) values(target_request_id,target_asset_kind,target_owner_id,target_owner_id,target_template_version_id,
    target_attempt_id,target_asset_key,target_bucket_id,target_storage_path,target_sha256,target_byte_size,claimed_duration_seconds)
  returning * into existing;
  return jsonb_build_object('outcome','reserved','upload_intent_id',existing.id,'state',existing.state);
end;
$$;
revoke all on function public.service_reserve_form_coach_media_upload(uuid,text,uuid,uuid,uuid,text,text,text,text,bigint,numeric)
  from public,anon,authenticated;
grant execute on function public.service_reserve_form_coach_media_upload(uuid,text,uuid,uuid,uuid,text,text,text,text,bigint,numeric)
  to service_role;

create function private.form_coach_enqueue_media_cleanup(target_upload_intent_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare intent public.form_coach_media_upload_intents%rowtype; result_id uuid;
begin
  if target_upload_intent_id is null then raise exception 'Cleanup upload identity is invalid' using errcode='22023'; end if;
  select row.* into intent from public.form_coach_media_upload_intents row where row.id=target_upload_intent_id;
  if not found then raise exception 'Cleanup upload was not found' using errcode='P0002'; end if;
  insert into public.form_coach_media_cleanup_queue(asset_kind,asset_id,bucket_id,storage_path)
  values('upload_intent',intent.id,intent.bucket_id,intent.storage_path)
  on conflict(bucket_id,storage_path) do nothing;
  select queue.id into result_id from public.form_coach_media_cleanup_queue queue
  where queue.bucket_id=intent.bucket_id and queue.storage_path=intent.storage_path;
  return result_id;
end;
$$;
revoke all on function private.form_coach_enqueue_media_cleanup(uuid) from public,anon,authenticated,service_role;

create function public.service_record_form_coach_media_upload_outcome(
  target_request_id uuid, target_outcome text, observed_sha256 text default null,
  observed_byte_size bigint default null, observed_duration_seconds numeric default null,
  source_proof_digest text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare intent public.form_coach_media_upload_intents%rowtype; current_tombstone boolean;
  policy_row public.form_coach_media_policy_versions%rowtype; cleanup_id uuid; claim_id uuid; clip_id uuid;
  v_observed_sha256 text := observed_sha256;
  v_observed_byte_size bigint := observed_byte_size;
  v_observed_duration_seconds numeric := observed_duration_seconds;
  v_source_proof_digest text := source_proof_digest;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if target_request_id is null or target_outcome is null
    or target_outcome not in ('unknown','uploaded','verified','failed') then
    raise exception 'Upload outcome is invalid' using errcode='22023'; end if;
  select row.* into intent from public.form_coach_media_upload_intents row where row.request_id=target_request_id;
  if not found then raise exception 'Upload reservation was not found' using errcode='P0002'; end if;
  perform private.form_coach_lock_subjects(array[intent.owner_subject_id]);
  select row.* into intent from public.form_coach_media_upload_intents row where row.id=intent.id for update;
  current_tombstone:=private.form_coach_subject_has_deletion_fence(intent.owner_subject_id);
  if intent.state in ('delete_pending','delete_uncertain','deleted') then
    return jsonb_build_object('outcome','cleanup_active','state',intent.state,'upload_intent_id',intent.id);
  end if;
  if intent.state='verified' then
    if target_outcome='verified' and observed_sha256 is not distinct from intent.observed_sha256
      and observed_byte_size is not distinct from intent.observed_byte_size
      and observed_duration_seconds is not distinct from intent.observed_duration_seconds
      and source_proof_digest is not distinct from intent.source_proof_digest then
      return jsonb_build_object('outcome','already_verified','upload_intent_id',intent.id);
    end if;
    raise exception 'A verified upload cannot be rebound' using errcode='23505';
  end if;
  if intent.state='failed' then
    if target_outcome='failed' then return jsonb_build_object('outcome','already_failed','upload_intent_id',intent.id); end if;
    raise exception 'A terminal failed upload cannot be rebound' using errcode='23505';
  end if;
  if target_outcome='unknown' then
    if v_observed_sha256 is not null or v_observed_byte_size is not null or v_observed_duration_seconds is not null or v_source_proof_digest is not null then
      raise exception 'Unknown upload outcomes cannot assert object facts' using errcode='22023'; end if;
    if intent.state='uploaded' then return jsonb_build_object('outcome','already_uploaded','upload_intent_id',intent.id); end if;
    update public.form_coach_media_upload_intents set state='unknown',updated_at=now() where id=intent.id;
    return jsonb_build_object('outcome','unknown','upload_intent_id',intent.id,'retry_same_request',true);
  end if;
  if target_outcome='failed' then
    if v_observed_sha256 is not null or v_observed_byte_size is not null or v_observed_duration_seconds is not null or v_source_proof_digest is not null then
      raise exception 'Failed upload must prove that no object was created' using errcode='22023'; end if;
    if intent.state='uploaded' then raise exception 'A known uploaded object must be cleaned up, not marked failed' using errcode='55000'; end if;
    update public.form_coach_media_upload_intents set state='failed',updated_at=now() where id=intent.id;
    return jsonb_build_object('outcome','failed','upload_intent_id',intent.id);
  end if;
  if v_observed_sha256 is null or v_observed_sha256 !~ '^[a-f0-9]{64}$' or v_observed_byte_size is null or v_observed_byte_size<1 then
    raise exception 'Observed upload facts are required' using errcode='22023'; end if;
  if target_outcome='verified' then
    if v_observed_sha256<>intent.expected_sha256 or v_observed_byte_size<>intent.expected_byte_size or v_source_proof_digest is null
      or v_source_proof_digest !~ '^[a-f0-9]{64}$' then
      target_outcome:='uploaded';
    end if;
    if intent.asset_kind='member_clip' then
      select policy.* into policy_row from public.form_coach_media_policy_current current
      join public.form_coach_media_policy_versions policy on policy.revision=current.revision where current.singleton;
      if v_observed_duration_seconds is null or v_observed_duration_seconds<=0
        or v_observed_duration_seconds>policy_row.member_clip_max_seconds then target_outcome:='uploaded'; end if;
    elsif v_observed_duration_seconds is not null then
      raise exception 'A reference or cue asset cannot report a member clip duration' using errcode='22023'; end if;
  end if;
  if target_outcome='uploaded' then
    if v_observed_sha256<>intent.expected_sha256 or v_observed_byte_size<>intent.expected_byte_size then
      update public.form_coach_media_upload_intents as upload_intent set state='delete_pending',
        observed_sha256=v_observed_sha256,observed_byte_size=v_observed_byte_size,
        observed_duration_seconds=v_observed_duration_seconds,updated_at=now()
      where upload_intent.id=intent.id returning upload_intent.* into intent;
      cleanup_id:=private.form_coach_enqueue_media_cleanup(intent.id);
      return jsonb_build_object('outcome','cleanup_required_mismatch','upload_intent_id',intent.id,'cleanup_id',cleanup_id);
    end if;
    update public.form_coach_media_upload_intents as upload_intent set state='uploaded',
      observed_sha256=v_observed_sha256,observed_byte_size=v_observed_byte_size,
      observed_duration_seconds=v_observed_duration_seconds,source_proof_digest=null,updated_at=now()
    where upload_intent.id=intent.id returning upload_intent.* into intent;
    if current_tombstone then
      cleanup_id:=private.form_coach_enqueue_media_cleanup(intent.id);
      update public.form_coach_media_upload_intents set state='delete_pending',updated_at=now() where id=intent.id;
      return jsonb_build_object('outcome','cleanup_required','upload_intent_id',intent.id,'cleanup_id',cleanup_id);
    end if;
    return jsonb_build_object('outcome','uploaded_unverified','upload_intent_id',intent.id);
  end if;
  if intent.state not in ('reserved','unknown','uploaded') then raise exception 'Upload state changed' using errcode='40001'; end if;
  if current_tombstone then
    update public.form_coach_media_upload_intents as upload_intent set state='delete_pending',
      observed_sha256=v_observed_sha256,observed_byte_size=v_observed_byte_size,
      observed_duration_seconds=v_observed_duration_seconds,source_proof_digest=v_source_proof_digest,updated_at=now()
    where upload_intent.id=intent.id returning upload_intent.* into intent;
    cleanup_id:=private.form_coach_enqueue_media_cleanup(intent.id);
    return jsonb_build_object('outcome','cleanup_required','upload_intent_id',intent.id,'cleanup_id',cleanup_id);
  end if;
  update public.form_coach_media_upload_intents as upload_intent set state='verified',
    observed_sha256=v_observed_sha256,observed_byte_size=v_observed_byte_size,
    observed_duration_seconds=v_observed_duration_seconds,source_proof_digest=v_source_proof_digest,updated_at=now()
  where upload_intent.id=intent.id returning upload_intent.* into intent;
  if intent.asset_kind in ('template_reference','template_cue') then
    insert into public.form_coach_template_asset_claims(
      upload_intent_id,template_version_id,owner_subject_id,asset_key,bucket_id,storage_path,
      content_sha256,byte_size,source_guard_state
    ) values(intent.id,intent.template_version_id,intent.owner_subject_id,intent.asset_key,intent.bucket_id,
      intent.storage_path,intent.expected_sha256,intent.expected_byte_size,'private_verified')
    returning id into claim_id;
    return jsonb_build_object('outcome','verified','asset_claim_id',claim_id,'upload_intent_id',intent.id);
  end if;
  insert into public.form_coach_attempt_clips(
    upload_intent_id,attempt_id,member_subject_id,member_owner_id,bucket_id,storage_path,
    content_sha256,byte_size,duration_seconds,delete_after,state
  ) select intent.id,attempt.id,intent.owner_subject_id,intent.owner_subject_id,intent.bucket_id,intent.storage_path,
    intent.expected_sha256,intent.expected_byte_size,intent.observed_duration_seconds,
    now()+make_interval(days=>policy.clip_retention_days),'available'
  from public.form_coach_attempts attempt
  cross join public.form_coach_media_policy_current current
  join public.form_coach_media_policy_versions policy on policy.revision=current.revision
  where attempt.id=intent.attempt_id and current.singleton
  returning id into clip_id;
  if clip_id is null then raise exception 'Clip policy or attempt changed' using errcode='55000'; end if;
  return jsonb_build_object('outcome','verified','clip_id',clip_id,'upload_intent_id',intent.id);
end;
$$;
revoke all on function public.service_record_form_coach_media_upload_outcome(uuid,text,text,bigint,numeric,text)
  from public,anon,authenticated;
grant execute on function public.service_record_form_coach_media_upload_outcome(uuid,text,text,bigint,numeric,text)
  to service_role;

create function public.service_claim_form_coach_summary_jobs(target_limit smallint default 10, lease_seconds smallint default 120)
returns table(outbox_id uuid,attempt_id uuid,prompt_version text,numeric_payload jsonb,claim_token uuid,lease_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if target_limit is null or target_limit not between 1 and 25 or lease_seconds is null or lease_seconds not between 30 and 600 then
    raise exception 'Summary lease bounds are invalid' using errcode='22023'; end if;
  update public.form_coach_summary_outbox outbox set state='suppressed',claim_token=null,lease_expires_at=null,updated_at=now()
  where outbox.state in ('pending','claimed') and exists(
    select 1 from public.form_coach_attempts attempt
    join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
    where attempt.id=outbox.attempt_id and (assessment.member_owner_id is null or assessment.coach_owner_id is null
      or private.form_coach_subject_has_deletion_fence(assessment.member_subject_id)
      or private.form_coach_subject_has_deletion_fence(assessment.coach_subject_id))
  );
  return query
  with candidates as (
    select outbox.id from public.form_coach_summary_outbox outbox
    where outbox.state='pending' or (outbox.state='claimed' and outbox.lease_expires_at<=now())
    order by outbox.created_at,outbox.id for update skip locked limit target_limit
  ), claimed as (
    update public.form_coach_summary_outbox outbox set state='claimed',claim_token=gen_random_uuid(),
      lease_expires_at=now()+make_interval(secs=>lease_seconds),attempt_count=outbox.attempt_count+1,updated_at=now()
    from candidates where outbox.id=candidates.id
    returning outbox.id,outbox.attempt_id,outbox.prompt_version,outbox.numeric_payload,outbox.claim_token,outbox.lease_expires_at
  ) select * from claimed;
end;
$$;
revoke all on function public.service_claim_form_coach_summary_jobs(smallint,smallint) from public,anon,authenticated;
grant execute on function public.service_claim_form_coach_summary_jobs(smallint,smallint) to service_role;

create function public.service_finish_form_coach_summary_job(
  target_attempt_id uuid,target_claim_token uuid,target_outcome text,target_summary text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare outbox public.form_coach_summary_outbox%rowtype; summary_hash text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if target_attempt_id is null or target_claim_token is null or target_outcome is null
    or target_outcome not in ('complete','unavailable','retry')
    or (target_outcome='complete' and (target_summary is null or char_length(btrim(target_summary)) not between 1 and 1000
      or target_summary ~ '[<>]')) or (target_outcome<>'complete' and target_summary is not null) then
    raise exception 'Summary result is invalid' using errcode='22023'; end if;
  select row.* into outbox from public.form_coach_summary_outbox row
  where row.attempt_id=target_attempt_id for update;
  if not found then raise exception 'Summary work was not found' using errcode='P0002'; end if;
  summary_hash:=encode(extensions.digest(convert_to(target_outcome||'|'||coalesce(btrim(target_summary),''),'UTF8'),'sha256'),'hex');
  if outbox.state in ('complete','unavailable','suppressed') then
    if outbox.completed_digest is not distinct from summary_hash then
      return jsonb_build_object('outcome','already_recorded','state',outbox.state); end if;
    raise exception 'Summary work is already terminal' using errcode='23505';
  end if;
  if outbox.state<>'claimed' or outbox.claim_token is distinct from target_claim_token
    or outbox.lease_expires_at<=now() then
    raise exception 'Summary lease is stale' using errcode='40001'; end if;
  if target_outcome='retry' then
    update public.form_coach_summary_outbox set state='pending',claim_token=null,lease_expires_at=null,updated_at=now()
    where id=outbox.id;
    return jsonb_build_object('outcome','retry');
  end if;
  update public.form_coach_attempt_results result set summary_state=target_outcome,
    coach_summary=case when target_outcome='complete' then btrim(target_summary) else null end
  where result.attempt_id=target_attempt_id;
  if not found then raise exception 'Finished attempt summary target is missing' using errcode='55000'; end if;
  update public.form_coach_summary_outbox set state=target_outcome,claim_token=null,lease_expires_at=null,
    completed_digest=summary_hash,updated_at=now() where id=outbox.id;
  return jsonb_build_object('outcome',target_outcome);
end;
$$;
revoke all on function public.service_finish_form_coach_summary_job(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.service_finish_form_coach_summary_job(uuid,uuid,text,text) to service_role;

create function public.service_claim_form_coach_notifications(target_limit smallint default 20, lease_seconds smallint default 120)
returns table(outbox_id uuid,event_key text,recipient_id uuid,assessment_id uuid,event_kind text,claim_token uuid,lease_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if target_limit is null or target_limit not between 1 and 50 or lease_seconds is null or lease_seconds not between 30 and 600 then
    raise exception 'Notification lease bounds are invalid' using errcode='22023'; end if;
  update public.form_coach_notification_outbox outbox set state='suppressed',claim_token=null,lease_expires_at=null,updated_at=now()
  where outbox.state in ('pending','claimed') and (outbox.recipient_owner_id is null
    or private.form_coach_subject_has_deletion_fence(outbox.recipient_subject_id));
  return query
  with candidates as (
    select outbox.id from public.form_coach_notification_outbox outbox
    where outbox.state='pending' or (outbox.state='claimed' and outbox.lease_expires_at<=now())
    order by outbox.created_at,outbox.id for update skip locked limit target_limit
  ), claimed as (
    update public.form_coach_notification_outbox outbox set state='claimed',claim_token=gen_random_uuid(),
      lease_expires_at=now()+make_interval(secs=>lease_seconds),attempt_count=outbox.attempt_count+1,updated_at=now()
    from candidates where outbox.id=candidates.id
    returning outbox.id,outbox.event_key,outbox.recipient_subject_id,outbox.assessment_id,outbox.event_kind,
      outbox.claim_token,outbox.lease_expires_at
  ) select * from claimed;
end;
$$;
revoke all on function public.service_claim_form_coach_notifications(smallint,smallint) from public,anon,authenticated;
grant execute on function public.service_claim_form_coach_notifications(smallint,smallint) to service_role;

create function public.service_finish_form_coach_notification(
  target_outbox_id uuid,target_claim_token uuid,target_outcome text
)
returns text language plpgsql security definer set search_path = '' as $$
declare row_value public.form_coach_notification_outbox%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if target_outbox_id is null or target_claim_token is null or target_outcome is null
    or target_outcome not in ('recorded','retry','suppressed') then
    raise exception 'Notification outcome is invalid' using errcode='22023'; end if;
  select row.* into row_value from public.form_coach_notification_outbox row where row.id=target_outbox_id for update;
  if not found then raise exception 'Notification was not found' using errcode='P0002'; end if;
  if row_value.state in ('recorded','suppressed') then return row_value.state; end if;
  if row_value.state<>'claimed' or row_value.claim_token is distinct from target_claim_token
    or row_value.lease_expires_at<=now() then raise exception 'Notification lease is stale' using errcode='40001'; end if;
  if target_outcome='retry' then
    update public.form_coach_notification_outbox set state='pending',claim_token=null,lease_expires_at=null,updated_at=now()
    where id=row_value.id;
    return 'pending';
  end if;
  update public.form_coach_notification_outbox set state=target_outcome,claim_token=null,lease_expires_at=null,updated_at=now()
  where id=row_value.id;
  return target_outcome;
end;
$$;
revoke all on function public.service_finish_form_coach_notification(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.service_finish_form_coach_notification(uuid,uuid,text) to service_role;

-- This component is required for the later auth-deletion permit. Its proof RPC is owned by the
-- preceding stream-media migration; this migration only registers and reports its own inventory.
insert into public.stream_auth_cleanup_components(
  component_key,component_version,resource_set_revision,required_for_auth
) values('form_coach_workflow',1,1,true)
on conflict(component_key) do nothing;
do $$
begin
  if not exists(select 1 from public.stream_auth_cleanup_components component
    where component.component_key='form_coach_workflow' and component.component_version=1
      and component.resource_set_revision=1 and component.required_for_auth) then
    raise exception 'Form Coach auth-cleanup component registry is incompatible';
  end if;
end;
$$;

create function public.service_prepare_form_coach_account_cleanup(target_tombstone_id uuid,target_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare account_id uuid; tombstone_state text; row_revision bigint; abandoned_count integer:=0; queued_count integer:=0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if target_tombstone_id is null or target_revision is null or target_revision<1 then
    raise exception 'Cleanup tombstone identity is invalid' using errcode='22023'; end if;
  select tombstone.account_id,tombstone.tombstone_state,tombstone.revision
    into account_id,tombstone_state,row_revision
  from public.stream_media_account_tombstones tombstone where tombstone.id=target_tombstone_id;
  if not found or row_revision is distinct from target_revision or tombstone_state not in ('closing','provider_cleanup') then
    raise exception 'Current closing tombstone is required' using errcode='55000'; end if;
  perform private.form_coach_lock_subjects(array[account_id]);
  select tombstone.tombstone_state,tombstone.revision into tombstone_state,row_revision
  from public.stream_media_account_tombstones tombstone where tombstone.id=target_tombstone_id for share;
  if row_revision is distinct from target_revision or tombstone_state not in ('closing','provider_cleanup') then
    raise exception 'Cleanup tombstone changed' using errcode='40001'; end if;

  update public.form_coach_program_send_outbox outbox set state='suppressed',claim_token=null,lease_expires_at=null,
    last_outcome='account_deleting',updated_at=now()
  where outbox.state in ('pending','awaiting_funds','claimed')
    and (outbox.member_subject_id=account_id or outbox.program_owner_subject_id=account_id);
  update public.form_coach_notification_outbox outbox set state='suppressed',claim_token=null,lease_expires_at=null,updated_at=now()
  where outbox.recipient_subject_id=account_id and outbox.state in ('pending','claimed');
  update public.form_coach_summary_outbox outbox set state='suppressed',claim_token=null,lease_expires_at=null,updated_at=now()
  from public.form_coach_attempts attempt join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
  where outbox.attempt_id=attempt.id and (assessment.member_subject_id=account_id or assessment.coach_subject_id=account_id)
    and outbox.state in ('pending','claimed');
  update public.form_coach_attempts attempt set state='abandoned',abandoned_at=coalesce(attempt.abandoned_at,now()),lease_expires_at=now()
  from public.form_coach_assessments assessment
  where attempt.assessment_id=assessment.id and attempt.state='running'
    and (assessment.member_subject_id=account_id or assessment.coach_subject_id=account_id);
  insert into public.form_coach_media_cleanup_queue(asset_kind,asset_id,bucket_id,storage_path)
  select 'upload_intent',intent.id,intent.bucket_id,intent.storage_path
  from public.form_coach_media_upload_intents intent
  where intent.owner_subject_id=account_id and intent.state in ('uploaded','verified')
  on conflict(bucket_id,storage_path) do nothing;
  get diagnostics queued_count=row_count;
  update public.form_coach_media_upload_intents intent set state='delete_pending',updated_at=now()
  where intent.owner_subject_id=account_id and intent.state in ('uploaded','verified');
  update public.form_coach_template_asset_claims asset set source_guard_state='delete_pending'
  where asset.owner_subject_id=account_id and asset.source_guard_state='private_verified';
  update public.form_coach_attempt_clips clip set state='delete_pending',delete_requested_at=coalesce(clip.delete_requested_at,now())
  where clip.member_subject_id=account_id and clip.state='available';
  select count(*)::integer into abandoned_count from public.form_coach_attempts attempt
  join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
  where (assessment.member_subject_id=account_id or assessment.coach_subject_id=account_id) and attempt.state='abandoned';
  return jsonb_build_object('outcome','prepared','abandoned_attempts',abandoned_count,'queued_uploads',queued_count);
end;
$$;
revoke all on function public.service_prepare_form_coach_account_cleanup(uuid,bigint) from public,anon,authenticated;
grant execute on function public.service_prepare_form_coach_account_cleanup(uuid,bigint) to service_role;

create function public.service_claim_form_coach_media_cleanup(target_limit smallint default 10,lease_seconds smallint default 120)
returns table(cleanup_id uuid,asset_kind text,asset_id uuid,bucket_id text,storage_path text,claim_token uuid,
  lease_expires_at timestamptz,reconcile_first boolean)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if target_limit is null or target_limit not between 1 and 25 or lease_seconds is null or lease_seconds not between 30 and 600 then
    raise exception 'Cleanup lease bounds are invalid' using errcode='22023'; end if;
  return query
  with candidates as (
    select queue.id,queue.state from public.form_coach_media_cleanup_queue queue
    where queue.state in ('pending','uncertain') or (queue.state='claimed' and queue.lease_expires_at<=now())
    order by queue.created_at,queue.id for update skip locked limit target_limit
  ), claimed as (
    update public.form_coach_media_cleanup_queue queue set state='claimed',claim_token=gen_random_uuid(),
      lease_expires_at=now()+make_interval(secs=>lease_seconds),updated_at=now()
    from candidates where queue.id=candidates.id
    returning queue.id,queue.asset_kind,queue.asset_id,queue.bucket_id,queue.storage_path,queue.claim_token,
      queue.lease_expires_at,(candidates.state in ('uncertain','claimed')) as reconcile_first
  ) select * from claimed;
end;
$$;
revoke all on function public.service_claim_form_coach_media_cleanup(smallint,smallint) from public,anon,authenticated;
grant execute on function public.service_claim_form_coach_media_cleanup(smallint,smallint) to service_role;

create function public.service_finish_form_coach_media_cleanup(
  target_cleanup_id uuid,target_claim_token uuid,target_outcome text,target_evidence_digest text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare queue public.form_coach_media_cleanup_queue%rowtype; intent public.form_coach_media_upload_intents%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if target_cleanup_id is null or target_claim_token is null or target_outcome is null
    or target_outcome not in ('deleted','present','unknown')
    or (target_outcome='deleted' and (target_evidence_digest is null or target_evidence_digest !~ '^[a-f0-9]{64}$'))
    or (target_outcome<>'deleted' and target_evidence_digest is not null) then
    raise exception 'Cleanup outcome is invalid' using errcode='22023'; end if;
  select row.* into queue from public.form_coach_media_cleanup_queue row where row.id=target_cleanup_id for update;
  if not found then raise exception 'Cleanup job was not found' using errcode='P0002'; end if;
  if queue.state='complete' then return jsonb_build_object('outcome','already_deleted','cleanup_id',queue.id); end if;
  if queue.state<>'claimed' or queue.claim_token is distinct from target_claim_token or queue.lease_expires_at<=now() then
    raise exception 'Cleanup lease is stale' using errcode='40001'; end if;
  if queue.asset_kind<>'upload_intent' then raise exception 'Unsupported workflow cleanup resource' using errcode='55000'; end if;
  select row.* into intent from public.form_coach_media_upload_intents row where row.id=queue.asset_id for update;
  if not found or intent.bucket_id<>queue.bucket_id or intent.storage_path<>queue.storage_path then
    raise exception 'Cleanup resource binding changed' using errcode='23505'; end if;
  if target_outcome='unknown' then
    update public.form_coach_media_cleanup_queue set state='uncertain',claim_token=null,lease_expires_at=null,updated_at=now()
    where id=queue.id;
    update public.form_coach_media_upload_intents set state='delete_uncertain',updated_at=now() where id=intent.id;
    update public.form_coach_template_asset_claims set source_guard_state='delete_uncertain' where upload_intent_id=intent.id;
    update public.form_coach_attempt_clips set state='delete_uncertain' where upload_intent_id=intent.id;
    return jsonb_build_object('outcome','unknown','cleanup_id',queue.id);
  elsif target_outcome='present' then
    update public.form_coach_media_cleanup_queue set state='pending',claim_token=null,lease_expires_at=null,updated_at=now()
    where id=queue.id;
    update public.form_coach_media_upload_intents set state='delete_pending',updated_at=now() where id=intent.id;
    update public.form_coach_template_asset_claims set source_guard_state='delete_pending' where upload_intent_id=intent.id;
    update public.form_coach_attempt_clips set state='delete_pending' where upload_intent_id=intent.id;
    return jsonb_build_object('outcome','retry_pending','cleanup_id',queue.id);
  end if;
  update public.form_coach_media_cleanup_queue set state='complete',claim_token=null,lease_expires_at=null,
    evidence_digest=target_evidence_digest,updated_at=now() where id=queue.id;
  update public.form_coach_media_upload_intents set state='deleted',updated_at=now() where id=intent.id;
  update public.form_coach_template_asset_claims set source_guard_state='deleted' where upload_intent_id=intent.id;
  update public.form_coach_attempt_clips set state='deleted' where upload_intent_id=intent.id;
  return jsonb_build_object('outcome','deleted','cleanup_id',queue.id);
end;
$$;
revoke all on function public.service_finish_form_coach_media_cleanup(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.service_finish_form_coach_media_cleanup(uuid,uuid,text,text) to service_role;

create function public.delete_my_form_coach_clip(target_clip_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid:=auth.uid(); clip public.form_coach_attempt_clips%rowtype; queue_id uuid; queue_state text;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null or target_clip_id is null
    or not private.has_role(actor_id,'member'::public.user_role) then
    raise exception 'Clip deletion request is invalid' using errcode='42501'; end if;
  perform private.form_coach_lock_subjects(array[actor_id]);
  select row.* into clip from public.form_coach_attempt_clips row
  where row.id=target_clip_id and row.member_subject_id=actor_id and row.member_owner_id=actor_id for update;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if clip.state in ('delete_pending','delete_uncertain','deleted') then
    return jsonb_build_object('outcome',clip.state,'clip_id',clip.id); end if;
  insert into public.form_coach_media_cleanup_queue(asset_kind,asset_id,bucket_id,storage_path)
  values('upload_intent',clip.upload_intent_id,clip.bucket_id,clip.storage_path)
  on conflict(bucket_id,storage_path) do nothing;
  select queue.id,queue.state into queue_id,queue_state
  from public.form_coach_media_cleanup_queue queue
  where queue.bucket_id=clip.bucket_id and queue.storage_path=clip.storage_path;
  if queue_id is null then raise exception 'Cleanup barrier could not be established' using errcode='55000'; end if;
  if queue_state='complete' then
    update public.form_coach_attempt_clips set state='deleted',delete_requested_at=coalesce(delete_requested_at,now()) where id=clip.id;
    update public.form_coach_media_upload_intents set state='deleted',updated_at=now() where id=clip.upload_intent_id;
    return jsonb_build_object('outcome','deleted','clip_id',clip.id,'cleanup_id',queue_id);
  end if;
  if queue_state='uncertain' then
    update public.form_coach_attempt_clips set state='delete_uncertain',delete_requested_at=coalesce(delete_requested_at,now())
    where id=clip.id;
    update public.form_coach_media_upload_intents set state='delete_uncertain',updated_at=now()
    where id=clip.upload_intent_id and state in ('verified','delete_pending','delete_uncertain');
    return jsonb_build_object('outcome','delete_uncertain','clip_id',clip.id,'cleanup_id',queue_id);
  end if;
  update public.form_coach_attempt_clips set state='delete_pending',delete_requested_at=coalesce(delete_requested_at,now())
  where id=clip.id;
  update public.form_coach_media_upload_intents set state='delete_pending',updated_at=now()
  where id=clip.upload_intent_id and state in ('verified','delete_uncertain');
  return jsonb_build_object('outcome','delete_pending','clip_id',clip.id,'cleanup_id',queue_id);
end;
$$;
revoke all on function public.delete_my_form_coach_clip(uuid) from public,anon,service_role;
grant execute on function public.delete_my_form_coach_clip(uuid) to authenticated;

create function public.service_queue_expired_form_coach_clips(target_limit smallint default 100)
returns integer language plpgsql security definer set search_path = '' as $$
declare queued integer:=0; expired_clip record; queue_id uuid; queue_state text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if target_limit is null or target_limit not between 1 and 500 then raise exception 'Expiry batch is invalid' using errcode='22023'; end if;
  for expired_clip in
    select clip.id,clip.upload_intent_id,clip.bucket_id,clip.storage_path
    from public.form_coach_attempt_clips clip
    where clip.state='available' and clip.delete_after<=now()
    order by clip.delete_after,clip.id for update skip locked limit target_limit
  loop
    insert into public.form_coach_media_cleanup_queue(asset_kind,asset_id,bucket_id,storage_path)
    values('upload_intent',expired_clip.upload_intent_id,expired_clip.bucket_id,expired_clip.storage_path)
    on conflict(bucket_id,storage_path) do nothing;
    select queue.id,queue.state into queue_id,queue_state
    from public.form_coach_media_cleanup_queue queue
    where queue.bucket_id=expired_clip.bucket_id and queue.storage_path=expired_clip.storage_path;
    if queue_id is null then raise exception 'Cleanup barrier could not be established' using errcode='55000'; end if;
    update public.form_coach_attempt_clips set
      state=case queue_state when 'complete' then 'deleted' when 'uncertain' then 'delete_uncertain' else 'delete_pending' end,
      delete_requested_at=coalesce(delete_requested_at,now()) where id=expired_clip.id;
    update public.form_coach_media_upload_intents set
      state=case queue_state when 'complete' then 'deleted' when 'uncertain' then 'delete_uncertain' else 'delete_pending' end,
      updated_at=now()
    where id=expired_clip.upload_intent_id and state in ('verified','delete_pending','delete_uncertain');
    if queue_state='complete' then
      update public.form_coach_template_asset_claims set source_guard_state='deleted'
      where upload_intent_id=expired_clip.upload_intent_id;
    elsif queue_state='uncertain' then
      update public.form_coach_template_asset_claims set source_guard_state='delete_uncertain'
      where upload_intent_id=expired_clip.upload_intent_id and source_guard_state in ('private_verified','delete_pending','delete_uncertain');
    else
      update public.form_coach_template_asset_claims set source_guard_state='delete_pending'
      where upload_intent_id=expired_clip.upload_intent_id and source_guard_state in ('private_verified','delete_uncertain');
    end if;
    queued:=queued+1;
  end loop;
  return queued;
end;
$$;
revoke all on function public.service_queue_expired_form_coach_clips(smallint) from public,anon,authenticated;
grant execute on function public.service_queue_expired_form_coach_clips(smallint) to service_role;

create function public.service_record_form_coach_auth_cleanup_proof(
  target_tombstone_id uuid,target_tombstone_revision bigint,target_request_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare account_id uuid; tombstone_state text; current_revision bigint; unresolved_count bigint;
  source_digest text; proof_digest text; inventory jsonb; is_ready boolean; prepare_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if target_tombstone_id is null or target_tombstone_revision is null or target_request_id is null then
    raise exception 'Auth cleanup proof identity is invalid' using errcode='22023'; end if;
  select tombstone.account_id,tombstone.tombstone_state,tombstone.revision
    into account_id,tombstone_state,current_revision
  from public.stream_media_account_tombstones tombstone where tombstone.id=target_tombstone_id;
  if not found or current_revision is distinct from target_tombstone_revision
    or tombstone_state not in ('closing','provider_cleanup') then
    raise exception 'Current closing tombstone is required' using errcode='55000'; end if;
  perform private.form_coach_lock_subjects(array[account_id]);
  prepare_result:=public.service_prepare_form_coach_account_cleanup(target_tombstone_id,target_tombstone_revision);
  select tombstone.tombstone_state,tombstone.revision into tombstone_state,current_revision
  from public.stream_media_account_tombstones tombstone where tombstone.id=target_tombstone_id for share;
  if current_revision is distinct from target_tombstone_revision or tombstone_state not in ('closing','provider_cleanup') then
    raise exception 'Cleanup tombstone changed' using errcode='40001'; end if;
  select count(*) into unresolved_count from public.form_coach_media_upload_intents intent
  where intent.owner_subject_id=account_id and intent.state not in ('failed','deleted');
  unresolved_count:=unresolved_count + (select count(*) from public.form_coach_template_asset_claims asset
    where asset.owner_subject_id=account_id and asset.source_guard_state<>'deleted');
  unresolved_count:=unresolved_count + (select count(*) from public.form_coach_attempt_clips clip
    where clip.member_subject_id=account_id and clip.state<>'deleted');
  unresolved_count:=unresolved_count + (select count(*) from public.form_coach_media_cleanup_queue queue
    join public.form_coach_media_upload_intents intent on intent.id=queue.asset_id
    where intent.owner_subject_id=account_id and queue.state<>'complete');
  unresolved_count:=unresolved_count + (select count(*) from public.form_coach_attempts attempt
    join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
    where attempt.state='running' and (assessment.member_subject_id=account_id or assessment.coach_subject_id=account_id));
  unresolved_count:=unresolved_count + (select count(*) from public.form_coach_program_send_outbox outbox
    where outbox.state in ('pending','awaiting_funds','claimed')
      and (outbox.member_subject_id=account_id or outbox.program_owner_subject_id=account_id));
  unresolved_count:=unresolved_count + (select count(*) from public.form_coach_summary_outbox outbox
    join public.form_coach_attempts attempt on attempt.id=outbox.attempt_id
    join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
    where outbox.state in ('pending','claimed')
      and (assessment.member_subject_id=account_id or assessment.coach_subject_id=account_id));
  unresolved_count:=unresolved_count + (select count(*) from public.form_coach_notification_outbox outbox
    where outbox.recipient_subject_id=account_id and outbox.state in ('pending','claimed'));
  is_ready:=unresolved_count=0;
  select coalesce(jsonb_agg(resource.value order by resource.value::text),'[]'::jsonb) into inventory
  from (
    select jsonb_build_object('kind','upload','id',intent.id,'state',intent.state,'bucket',intent.bucket_id,
      'path',intent.storage_path,'expected',intent.expected_sha256,'observed',intent.observed_sha256,
      'proof',intent.source_proof_digest) as value
    from public.form_coach_media_upload_intents intent where intent.owner_subject_id=account_id
    union all
    select jsonb_build_object('kind','asset_claim','id',asset.id,'state',asset.source_guard_state,
      'upload',asset.upload_intent_id,'sha',asset.content_sha256) from public.form_coach_template_asset_claims asset
    where asset.owner_subject_id=account_id
    union all
    select jsonb_build_object('kind','clip','id',clip.id,'state',clip.state,'upload',clip.upload_intent_id,
      'delete_after',clip.delete_after,'sha',clip.content_sha256) from public.form_coach_attempt_clips clip
    where clip.member_subject_id=account_id
    union all
    select jsonb_build_object('kind','cleanup','id',queue.id,'state',queue.state,'asset',queue.asset_id,
      'evidence',queue.evidence_digest) from public.form_coach_media_cleanup_queue queue
    join public.form_coach_media_upload_intents intent on intent.id=queue.asset_id
    where intent.owner_subject_id=account_id
    union all
    select jsonb_build_object('kind','attempt','id',attempt.id,'state',attempt.state,
      'result_digest',attempt.result_digest) from public.form_coach_attempts attempt
    join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
    where assessment.member_subject_id=account_id or assessment.coach_subject_id=account_id
    union all
    select jsonb_build_object('kind','program_send','id',outbox.id,'state',outbox.state,
      'outcome',outbox.last_outcome,'assessment_id',outbox.assessment_id)
    from public.form_coach_program_send_outbox outbox
    where outbox.member_subject_id=account_id or outbox.program_owner_subject_id=account_id
    union all
    select jsonb_build_object('kind','program_send_item','outbox_id',item.outbox_id,
      'ordinal',item.item_ordinal,'template_version',item.template_version_id)
    from public.form_coach_program_send_outbox_items item
    join public.form_coach_program_send_outbox outbox on outbox.id=item.outbox_id
    where outbox.member_subject_id=account_id or outbox.program_owner_subject_id=account_id
    union all
    select jsonb_build_object('kind','summary_outbox','id',outbox.id,'state',outbox.state,
      'attempt_id',outbox.attempt_id,'completed_digest',outbox.completed_digest)
    from public.form_coach_summary_outbox outbox
    join public.form_coach_attempts attempt on attempt.id=outbox.attempt_id
    join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
    where assessment.member_subject_id=account_id or assessment.coach_subject_id=account_id
    union all
    select jsonb_build_object('kind','notification_outbox','id',outbox.id,'state',outbox.state,
      'event_kind',outbox.event_kind,'assessment_id',outbox.assessment_id)
    from public.form_coach_notification_outbox outbox
    where outbox.recipient_subject_id=account_id
  ) resource;
  source_digest:=encode(extensions.digest(convert_to(inventory::text,'UTF8'),'sha256'),'hex');
  proof_digest:=encode(extensions.digest(convert_to(concat_ws('|',target_tombstone_id::text,account_id::text,
    target_tombstone_revision::text,'form_coach_workflow','1','1',case when is_ready then 'ready' else 'incomplete' end,source_digest),'UTF8'),'sha256'),'hex');
  perform public.record_stream_auth_cleanup_component_proof(
    target_tombstone_id,target_tombstone_revision,'form_coach_workflow',1,1,
    case when is_ready then 'ready' else 'incomplete' end,source_digest,proof_digest,target_request_id
  );
  return jsonb_build_object('component_key','form_coach_workflow','component_version',1,
    'resource_set_revision',1,'ready',is_ready,'unresolved_count',unresolved_count,
    'source_revision_digest',source_digest,'proof_digest',proof_digest,'prepare',prepare_result);
end;
$$;
revoke all on function public.service_record_form_coach_auth_cleanup_proof(uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.service_record_form_coach_auth_cleanup_proof(uuid,bigint,uuid) to service_role;

-- The pricing widget may show product usage, but workflow rows remain private even from
-- service_role. Submission/review counts represent assessments whose complete item set entered
-- that state in the window, rather than attempts or review events counted as separate sales.
create function public.admin_get_form_coach_usage()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare as_of timestamptz := now(); window_start timestamptz := as_of - interval '30 days';
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null or private.is_admin() is distinct from true then
    raise exception 'Admin access required' using errcode='42501';
  end if;
  return jsonb_build_object(
    'window_days',30,
    'assessments_sent',(select count(*)::integer from public.form_coach_assessments assessment
      where assessment.sent_at>=window_start and assessment.sent_at<=as_of),
    'assessments_submitted',(select count(*)::integer from public.form_coach_assessments assessment
      where (select count(*) from public.form_coach_assessment_items item
          where item.assessment_id=assessment.id)>0
        and (select count(*) from (
          select item.id,min(attempt.finished_at) first_finished_at
          from public.form_coach_assessment_items item
          join public.form_coach_attempts attempt on attempt.item_id=item.id
            and attempt.assessment_id=item.assessment_id and attempt.state='finished'
          where item.assessment_id=assessment.id and attempt.finished_at is not null
          group by item.id
        ) per_item_first_finish)=(select count(*) from public.form_coach_assessment_items item
          where item.assessment_id=assessment.id)
        and (select max(per_item_first_finish.first_finished_at) from (
          select item.id,min(attempt.finished_at) first_finished_at
          from public.form_coach_assessment_items item
          join public.form_coach_attempts attempt on attempt.item_id=item.id
            and attempt.assessment_id=item.assessment_id and attempt.state='finished'
          where item.assessment_id=assessment.id and attempt.finished_at is not null
          group by item.id
        ) per_item_first_finish) between window_start and as_of),
    'assessments_reviewed',(select count(*)::integer from public.form_coach_assessments assessment
      where (select count(*) from public.form_coach_assessment_items item
          where item.assessment_id=assessment.id)>0
        and (select count(*) from (
          select item.id,min(review.created_at) first_reviewed_at
          from public.form_coach_assessment_items item
          join public.form_coach_reviews review on review.item_id=item.id
            and review.assessment_id=item.assessment_id
          where item.assessment_id=assessment.id
          group by item.id
        ) per_item_first_review)=(select count(*) from public.form_coach_assessment_items item
          where item.assessment_id=assessment.id)
        and (select max(per_item_first_review.first_reviewed_at) from (
          select item.id,min(review.created_at) first_reviewed_at
          from public.form_coach_assessment_items item
          join public.form_coach_reviews review on review.item_id=item.id
            and review.assessment_id=item.assessment_id
          where item.assessment_id=assessment.id
          group by item.id
        ) per_item_first_review) between window_start and as_of)
  );
end;
$$;
revoke all on function public.admin_get_form_coach_usage() from public,anon,service_role;
grant execute on function public.admin_get_form_coach_usage() to authenticated;

-- Workflow state is reachable only through the narrow RPCs above. In particular, clients and
-- service_role do not receive table access that could bypass the immutable send/attempt/result
-- transitions or read private storage paths and unredacted template data.
alter table public.form_coach_media_policy_versions enable row level security;
alter table public.form_coach_media_policy_current enable row level security;
alter table public.form_coach_terms_versions enable row level security;
alter table public.form_coach_terms_current enable row level security;
alter table public.form_coach_member_consents enable row level security;
alter table public.form_coach_templates enable row level security;
alter table public.form_coach_template_versions enable row level security;
alter table public.form_coach_media_upload_intents enable row level security;
alter table public.form_coach_template_asset_claims enable row level security;
alter table public.form_coach_program_rules enable row level security;
alter table public.form_coach_program_rule_items enable row level security;
alter table public.form_coach_assessments enable row level security;
alter table public.form_coach_assessment_items enable row level security;
alter table public.form_coach_attempts enable row level security;
alter table public.form_coach_attempt_requests enable row level security;
alter table public.form_coach_attempt_rep_results enable row level security;
alter table public.form_coach_attempt_results enable row level security;
alter table public.form_coach_reviews enable row level security;
alter table public.form_coach_retry_windows enable row level security;
alter table public.form_coach_attempt_clips enable row level security;
alter table public.form_coach_summary_outbox enable row level security;
alter table public.form_coach_program_send_outbox enable row level security;
alter table public.form_coach_program_send_outbox_items enable row level security;
alter table public.form_coach_notification_outbox enable row level security;
alter table public.form_coach_media_cleanup_queue enable row level security;

revoke all on table
  public.form_coach_media_policy_versions,
  public.form_coach_media_policy_current,
  public.form_coach_terms_versions,
  public.form_coach_terms_current,
  public.form_coach_member_consents,
  public.form_coach_templates,
  public.form_coach_template_versions,
  public.form_coach_media_upload_intents,
  public.form_coach_template_asset_claims,
  public.form_coach_program_rules,
  public.form_coach_program_rule_items,
  public.form_coach_assessments,
  public.form_coach_assessment_items,
  public.form_coach_attempts,
  public.form_coach_attempt_requests,
  public.form_coach_attempt_rep_results,
  public.form_coach_attempt_results,
  public.form_coach_reviews,
  public.form_coach_retry_windows,
  public.form_coach_attempt_clips,
  public.form_coach_summary_outbox,
  public.form_coach_program_send_outbox,
  public.form_coach_program_send_outbox_items,
  public.form_coach_notification_outbox,
  public.form_coach_media_cleanup_queue
from public,anon,authenticated,service_role;
