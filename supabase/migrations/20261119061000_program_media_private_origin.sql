-- Gate 6.10: a Program-paid media UID must prove a never-shared, post-activation
-- Library origin. Unknown and historical media remain ineligible.
begin;
set local lock_timeout = '5s';

-- Quiesce every writer and every canonical upload fact used by certification. These
-- locks do not infer that an already-issued provider request has stopped; such a
-- pre-epoch operation can finish, but its receipt cannot produce an origin proof.
lock table
  public.daily_content_revisions,
  public.daily_content_slots,
  public.member_daily_content_video_grants,
  public.member_daily_fuel_assignments,
  public.member_daily_fuel_bookmarks,
  public.post_media,
  public.posts,
  public.program_content_version_lessons,
  public.program_content_versions,
  public.program_days,
  public.program_orders,
  public.programs,
  public.stream_media_account_tombstones,
  public.stream_media_asset_events,
  public.stream_media_assets,
  public.stream_media_create_claims,
  public.stream_media_finalization_receipts,
  public.stream_media_legacy_observations,
  public.stream_media_legacy_resolution_events,
  public.stream_media_operation_events,
  public.stream_media_operation_states,
  public.stream_media_operation_uid_state,
  public.stream_media_source_binding_events,
  public.stream_media_source_bindings,
  public.stream_media_upload_contexts,
  public.stream_media_upload_intents,
  public.stream_media_upload_observation_clocks,
  public.stream_media_upload_observations,
  public.stream_media_upload_transport,
  public.stream_media_library_requests,
  public.stream_media_operations,
  public.tasks,
  public.videos
in share row exclusive mode;

do $$
begin
  if exists (
    select 1 from public.program_content_version_lessons lesson
    join public.program_content_versions version
      on version.program_id=lesson.program_id and version.id=lesson.content_version_id
    where version.revision_kind='paid'
  ) then
    raise exception 'Private Program media origin activation requires zero paid lessons'
      using errcode='55000';
  end if;
  if exists (select 1 from public.program_orders) then
    raise exception 'Private Program media origin activation requires zero Program orders'
      using errcode='55000';
  end if;
end;
$$;

create table private.program_media_private_origin_epoch (
  singleton boolean primary key default true check (singleton),
  epoch_id uuid not null unique,
  activated_at timestamptz not null
);

create table private.program_media_private_origins (
  uid_digest text not null check (uid_digest ~ '^[0-9a-f]{64}$'),
  origin_state text not null check (origin_state in ('protected_private','shared','denied')),
  state_revision bigint not null default 1 check (state_revision>0),
  origin_proof_digest text check (origin_proof_digest is null or origin_proof_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (uid_digest),
  check ((origin_state='protected_private') = (origin_proof_digest is not null))
);
alter table private.program_media_private_origin_epoch enable row level security;
alter table private.program_media_private_origins enable row level security;
revoke all on private.program_media_private_origin_epoch,
  private.program_media_private_origins from public,anon,authenticated,service_role;

create function private.guard_program_media_private_origin_epoch()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Private media origin activation is immutable' using errcode='55000';
end;
$$;
revoke all on function private.guard_program_media_private_origin_epoch() from public,anon,authenticated,service_role;
create trigger program_media_private_origin_epoch_immutable
before update or delete on private.program_media_private_origin_epoch
for each row execute function private.guard_program_media_private_origin_epoch();

create function private.guard_program_media_private_origin_state()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' then
    raise exception 'Private media origin history cannot be deleted' using errcode='55000';
  end if;
  if new.uid_digest is distinct from old.uid_digest
    or new.created_at is distinct from old.created_at
    or new.state_revision<>old.state_revision+1
    or not (
      (old.origin_state='protected_private' and new.origin_state in ('shared','denied')
        and new.origin_proof_digest is null)
      or (old.origin_state='shared' and new.origin_state='denied'
        and new.origin_proof_digest is null)
    ) then
    raise exception 'Private media origin state is monotonic' using errcode='55000';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_program_media_private_origin_state() from public,anon,authenticated,service_role;
create trigger program_media_private_origin_state_monotonic
before update or delete on private.program_media_private_origins
for each row execute function private.guard_program_media_private_origin_state();

create function private.program_media_private_origin_uid_digest(target_registry_id uuid,target_uid text)
returns text language sql immutable set search_path = '' as $$
  select private.stream_media_identity_digest(concat_ws('|','program-private-origin-uid-v1',
    target_registry_id::text,target_uid));
$$;
revoke all on function private.program_media_private_origin_uid_digest(uuid,text)
  from public,anon,authenticated,service_role;

-- This digest is assembled only from immutable intent, operation, receipt, provider
-- observation-clock, and attached-event facts. Mutable asset/binding state revisions,
-- their current evidence digests, and the current profile fence are deliberately excluded.
create function private.program_media_private_origin_chain_digest(
  target_registry_id uuid,target_uid text,target_video_id uuid,target_require_clean_history boolean
)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  epoch_row record;
  chain record;
  candidate_count integer;
  attached_count integer;
begin
  if target_registry_id is null or target_uid is null or target_video_id is null then return null; end if;
  select * into epoch_row from private.program_media_private_origin_epoch where singleton;
  if not found then return null; end if;

  select count(*)::integer into candidate_count
  from public.stream_media_finalization_receipts receipt
  join public.stream_media_operations operation on operation.id=receipt.operation_id
  join public.stream_media_operation_states operation_state on operation_state.operation_id=operation.id
  join public.stream_media_upload_intents intent on intent.id=operation.intent_id
  join public.stream_media_upload_contexts context on context.intent_id=intent.id
  join public.stream_media_library_requests library_request on library_request.operation_id=operation.id
  join public.stream_media_create_claims create_claim on create_claim.operation_id=operation.id
  join public.stream_media_upload_transport transport on transport.operation_id=operation.id
  join public.stream_media_assets asset on asset.upload_intent_id=intent.id
    and asset.registry_id=operation.registry_id and asset.raw_provider_uid=transport.provider_uid
  join public.stream_media_source_bindings library_binding on library_binding.asset_id=asset.id
    and library_binding.registry_id=operation.registry_id
    and library_binding.raw_provider_uid=transport.provider_uid
    and library_binding.source_kind='video' and library_binding.source_identity=library_request.video_id::text
    and library_binding.owner_id=operation.owner_id
  join public.videos video on video.id=library_request.video_id
    and video.coach_id=operation.owner_id and video.stream_provider_account_registry_id=operation.registry_id
    and video.cloudflare_uid=transport.provider_uid and video.status::text='ready'
    and (video.visibility='private' or (not target_require_clean_history and video.visibility='program_only'))
    and not video.daily_content_deletion_pending
  where receipt.terminal_state='completed'
    and receipt.response->>'outcome'='ready_for_publication'
    and receipt.response->>'video_id'=target_video_id::text
    and receipt.operation_id=operation.id
    and operation.operation_kind='upload' and operation.source_kind='video'
    and operation.registry_id=target_registry_id and operation.source_identity=target_video_id::text
    and operation.actor_id=operation.owner_id and operation.actor_id=video.coach_id
    and operation.parent_kind='profile' and operation.parent_identity=operation.owner_id::text
    and operation.expected_source_revision=context.source_revision
    and operation.created_at>=epoch_row.activated_at
    and intent.purpose='library_video' and intent.source_kind='video'
    and intent.source_id=target_video_id and intent.actor_id=operation.actor_id
    and intent.provider_account_registry_id=operation.registry_id
    and context.parent_kind='profile' and context.parent_identity=operation.owner_id::text
    and context.owner_id=operation.owner_id
    and library_request.video_id=target_video_id and library_request.actor_id=operation.actor_id
    and library_request.request_digest=intent.payload_digest
    and create_claim.request_digest=operation.operation_digest
    and create_claim.operation_revision>0
    and transport.registry_id=operation.registry_id
    and transport.request_digest=operation.operation_digest
    and transport.request_marker=intent.request_marker
    and transport.provider_uid=target_uid and transport.provider_evidence_digest is not null
    and transport.tus_location is not null
    and transport.tus_location_digest=private.stream_media_identity_digest(transport.tus_location)
    and (not target_require_clean_history or operation_state.operation_state='completed')
    and asset.owner_id=operation.owner_id
    and (not target_require_clean_history or (asset.lifecycle_state='ready_for_publication'
      and asset.signed_urls_verified and asset.ready_to_stream_verified))
    and (not target_require_clean_history or library_binding.binding_state='ready_for_publication')
    and exists (
      select 1 from public.stream_media_operation_events claimed
      where claimed.operation_id=operation.id and claimed.to_state='create_started'
        and claimed.request_id=create_claim.request_id
        and claimed.evidence_digest=create_claim.request_digest
    )
    and exists (
      select 1 from public.stream_media_operation_events completed
      where completed.operation_id=operation.id and completed.to_state='completed'
        and completed.evidence_digest=receipt.request_digest
    )
    and exists (
      select 1 from public.stream_media_upload_observations observation
      join public.stream_media_upload_observation_clocks observation_clock
        on observation_clock.observation_id=observation.id
      where observation.operation_id=operation.id and observation.registry_id=operation.registry_id
        and observation.raw_provider_uid=target_uid and observation.observation_kind='exact_uid_get'
        and observation.http_status=200 and observation.signed_urls_reported
        and observation.creator_marker_matched and observation.metadata_marker_matched
        and observation.ready_to_stream_reported
        and private.stream_media_identity_digest(concat_ws('|','stream_library_commit_v1',
          operation.operation_digest,observation.evidence_digest,library_request.request_digest))
          =receipt.request_digest
        and (not target_require_clean_history or not exists (
          select 1 from public.stream_media_upload_observations later
          join public.stream_media_upload_observation_clocks later_clock
            on later_clock.observation_id=later.id
          where later.operation_id=operation.id and later.registry_id=operation.registry_id
            and later.raw_provider_uid=target_uid and later.observation_kind='exact_uid_get'
            and later_clock.order_sequence>observation_clock.order_sequence
        ))
    )
    and exists (
      select 1 from public.stream_media_asset_events ready_event
      where ready_event.asset_id=asset.id and ready_event.event_kind='ready_readback'
        and ready_event.request_id=receipt.request_id
        and ready_event.evidence_digest=receipt.request_digest
    )
    and exists (
      select 1 from public.stream_media_source_binding_events readback_event
      where readback_event.binding_id=library_binding.id and readback_event.event_kind='attached'
        and readback_event.source_revision=operation.expected_source_revision
        and readback_event.created_at<=receipt.created_at
    )
    and exists (
      select 1 from public.stream_media_source_binding_events commit_event
      where commit_event.binding_id=library_binding.id and commit_event.event_kind='attached'
        and commit_event.source_revision=operation.expected_source_revision+1
        and commit_event.request_id=receipt.request_id
        and commit_event.evidence_digest=receipt.request_digest
    )
    and (not target_require_clean_history or (
      (select count(*) from public.stream_media_source_binding_events event
        where event.binding_id=library_binding.id)=2
      and (select count(*) from public.stream_media_source_bindings binding
        where binding.registry_id=target_registry_id and binding.raw_provider_uid=target_uid)=1
      and not exists (select 1 from public.stream_media_operation_uid_state uid_state
        where uid_state.registry_id=target_registry_id and uid_state.raw_provider_uid=target_uid)
      and not exists (select 1 from public.stream_media_legacy_observations legacy
        where legacy.captured_uid=target_uid)
      and not exists (select 1 from public.stream_media_legacy_resolution_events legacy_resolution
        where legacy_resolution.registry_id=target_registry_id
          and legacy_resolution.raw_provider_uid=target_uid)
      and not exists (select 1 from public.stream_media_upload_observations prior_observation
        where prior_observation.registry_id=target_registry_id
          and prior_observation.raw_provider_uid=target_uid
          and prior_observation.operation_id<>operation.id)
      and not exists (select 1 from public.program_content_version_lessons lesson
        where lesson.cloudflare_uid=target_uid)
      and not exists (select 1 from public.programs program
        where program.intro_video_id=target_video_id)
      and not exists (select 1 from public.program_days day_row
        where day_row.video_id=target_video_id)
      and not exists (select 1 from public.tasks task where task.video_id=target_video_id)
      and not exists (select 1 from public.post_media media
        where media.kind='video' and media.video_uid=target_uid)
      and not exists (select 1 from public.daily_content_revisions revision
        where revision.video_id=target_video_id)
      and not exists (select 1 from public.member_daily_content_video_grants grant_row
        where grant_row.video_id=target_video_id)
      and not exists (select 1 from public.member_daily_fuel_assignments assignment
        where assignment.video_id=target_video_id)
      and not exists (select 1 from public.member_daily_fuel_bookmarks bookmark
        where bookmark.video_id=target_video_id)
      and not exists (select 1 from public.stream_media_source_bindings other_binding
        where other_binding.registry_id=target_registry_id and other_binding.raw_provider_uid=target_uid
          and other_binding.id<>library_binding.id)
    ));

  if candidate_count<>1 then return null; end if;

  select operation.id as operation_id, operation.operation_digest, operation.actor_id,
    intent.id as intent_id, intent.payload_digest, context.context_digest,
    library_request.request_digest as library_request_digest,
    create_claim.request_id as claim_request_id, create_claim.request_digest as claim_digest,
    create_claim.operation_revision, transport.request_id as transport_request_id,
    transport.provider_evidence_digest, observation.id as observation_id,
    observation.evidence_digest as observation_digest, asset.id as asset_id,
    ready_event.id as asset_ready_event_id, ready_event.asset_revision,
    ready_event.evidence_digest as asset_ready_digest,
    library_binding.id as library_binding_id, readback_event.id as readback_event_id,
    readback_event.source_revision as readback_revision,
    readback_event.evidence_digest as readback_digest,
    commit_event.id as commit_event_id, commit_event.source_revision as commit_revision,
    commit_event.evidence_digest as commit_digest, receipt.request_id as receipt_request_id,
    receipt.request_digest as receipt_digest
  into chain
  from public.stream_media_finalization_receipts receipt
  join public.stream_media_operations operation on operation.id=receipt.operation_id
  join public.stream_media_operation_states operation_state on operation_state.operation_id=operation.id
  join public.stream_media_upload_intents intent on intent.id=operation.intent_id
  join public.stream_media_upload_contexts context on context.intent_id=intent.id
  join public.stream_media_library_requests library_request on library_request.operation_id=operation.id
  join public.stream_media_create_claims create_claim on create_claim.operation_id=operation.id
  join public.stream_media_upload_transport transport on transport.operation_id=operation.id
  join public.stream_media_assets asset on asset.upload_intent_id=intent.id
    and asset.registry_id=operation.registry_id and asset.raw_provider_uid=transport.provider_uid
  join public.stream_media_source_bindings library_binding on library_binding.asset_id=asset.id
    and library_binding.registry_id=operation.registry_id
    and library_binding.raw_provider_uid=transport.provider_uid
    and library_binding.source_kind='video' and library_binding.source_identity=library_request.video_id::text
    and library_binding.owner_id=operation.owner_id
  join public.videos video on video.id=library_request.video_id
  join public.stream_media_asset_events ready_event on ready_event.asset_id=asset.id
    and ready_event.event_kind='ready_readback' and ready_event.request_id=receipt.request_id
    and ready_event.evidence_digest=receipt.request_digest
  join public.stream_media_source_binding_events readback_event on readback_event.binding_id=library_binding.id
    and readback_event.event_kind='attached' and readback_event.source_revision=operation.expected_source_revision
  join public.stream_media_source_binding_events commit_event on commit_event.binding_id=library_binding.id
    and commit_event.event_kind='attached'
    and commit_event.source_revision=operation.expected_source_revision+1
    and commit_event.request_id=receipt.request_id and commit_event.evidence_digest=receipt.request_digest
  join public.stream_media_upload_observations observation on observation.operation_id=operation.id
    and observation.registry_id=operation.registry_id and observation.raw_provider_uid=transport.provider_uid
    and observation.observation_kind='exact_uid_get'
  join public.stream_media_upload_observation_clocks observation_clock
    on observation_clock.observation_id=observation.id
  where receipt.terminal_state='completed' and receipt.response->>'outcome'='ready_for_publication'
    and receipt.response->>'video_id'=target_video_id::text
    and operation.operation_kind='upload' and operation.source_kind='video'
    and operation.registry_id=target_registry_id and operation.source_identity=target_video_id::text
    and operation.actor_id=operation.owner_id and operation.parent_kind='profile'
    and operation.parent_identity=operation.owner_id::text
    and operation.expected_source_revision=context.source_revision
    and operation.created_at>=epoch_row.activated_at
    and intent.purpose='library_video' and intent.source_kind='video'
    and intent.source_id=target_video_id and intent.actor_id=operation.actor_id
    and intent.provider_account_registry_id=operation.registry_id
    and context.parent_kind='profile' and context.parent_identity=operation.owner_id::text
    and context.owner_id=operation.owner_id
    and library_request.video_id=target_video_id and library_request.actor_id=operation.actor_id
    and library_request.request_digest=intent.payload_digest
    and create_claim.request_digest=operation.operation_digest
    and transport.registry_id=operation.registry_id and transport.request_digest=operation.operation_digest
    and transport.provider_uid=target_uid
    and (not target_require_clean_history or operation_state.operation_state='completed')
    and video.id=target_video_id and video.coach_id=operation.owner_id
    and video.stream_provider_account_registry_id=operation.registry_id and video.cloudflare_uid=target_uid
    and video.status::text='ready' and not video.daily_content_deletion_pending
    and (not target_require_clean_history or video.visibility='private')
    and observation.http_status=200 and observation.signed_urls_reported
    and observation.creator_marker_matched and observation.metadata_marker_matched
    and observation.ready_to_stream_reported
    and private.stream_media_identity_digest(concat_ws('|','stream_library_commit_v1',
      operation.operation_digest,observation.evidence_digest,library_request.request_digest))
      =receipt.request_digest
    and (not target_require_clean_history or not exists (select 1 from public.stream_media_upload_observations later
      join public.stream_media_upload_observation_clocks later_clock on later_clock.observation_id=later.id
      where later.operation_id=operation.id and later.registry_id=operation.registry_id
        and later.raw_provider_uid=target_uid and later.observation_kind='exact_uid_get'
        and later_clock.order_sequence>observation_clock.order_sequence))
  order by observation_clock.order_sequence desc limit 1;

  if chain.operation_id is null then return null; end if;
  if target_require_clean_history then
    select count(*)::integer into attached_count
    from public.stream_media_source_binding_events event
    where event.binding_id=chain.library_binding_id;
    if attached_count<>2 then return null; end if;
  end if;

  return private.stream_media_identity_digest(concat_ws('|',
    'program_private_library_origin_v1',epoch_row.epoch_id::text,target_registry_id::text,
    target_uid,target_video_id::text,chain.actor_id::text,chain.operation_id::text,
    chain.operation_digest,chain.intent_id::text,chain.payload_digest,chain.context_digest,
    chain.library_request_digest,chain.claim_request_id::text,chain.claim_digest,
    chain.operation_revision::text,chain.transport_request_id::text,chain.provider_evidence_digest,
    chain.observation_id::text,chain.observation_digest,chain.asset_id::text,
    chain.asset_ready_event_id::text,chain.asset_revision::text,chain.asset_ready_digest,
    chain.library_binding_id::text,chain.readback_event_id::text,chain.readback_revision::text,
    chain.readback_digest,chain.commit_event_id::text,chain.commit_revision::text,
    chain.commit_digest,chain.receipt_request_id::text,chain.receipt_digest));
end;
$$;
revoke all on function private.program_media_private_origin_chain_digest(uuid,text,uuid,boolean)
  from public,anon,authenticated,service_role;

create function private.program_media_private_origin_is_current(
  target_registry_id uuid,target_uid text,target_video_id uuid
)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  origin_row private.program_media_private_origins%rowtype;
  proof_digest text;
begin
  if target_registry_id is null or target_uid is null or target_video_id is null then return false; end if;
  select * into origin_row from private.program_media_private_origins origin
  where origin.uid_digest=private.program_media_private_origin_uid_digest(target_registry_id,target_uid);
  if not found or origin_row.origin_state<>'protected_private' or origin_row.origin_proof_digest is null then
    return false;
  end if;
  proof_digest:=private.program_media_private_origin_chain_digest(
    target_registry_id,target_uid,target_video_id,false);
  if proof_digest is null or proof_digest<>origin_row.origin_proof_digest then return false; end if;
  if not exists (select 1 from public.videos video
    join public.stream_media_assets asset on asset.registry_id=video.stream_provider_account_registry_id
      and asset.raw_provider_uid=video.cloudflare_uid and asset.owner_id=video.coach_id
      and asset.lifecycle_state='ready_for_publication'
      and asset.signed_urls_verified and asset.ready_to_stream_verified
    where video.id=target_video_id and video.stream_provider_account_registry_id=target_registry_id
      and video.cloudflare_uid=target_uid and video.status::text='ready'
      and video.visibility in ('private','program_only') and not video.daily_content_deletion_pending)
    or private.stream_account_is_tombstoned((select video.coach_id from public.videos video
      where video.id=target_video_id)) then
    return false;
  end if;
  if private.stream_media_uid_reserved(target_registry_id,target_uid)
    or private.stream_uid_blocks_new_media_reference(target_registry_id,target_uid)
    or private.stream_legacy_uid_unresolved(target_registry_id,target_uid) then
    return false;
  end if;
  if exists (select 1 from public.program_content_version_lessons lesson
    join public.program_content_versions version
      on version.program_id=lesson.program_id and version.id=lesson.content_version_id
    join public.videos lesson_video on lesson_video.id=lesson.video_id
    where lesson.cloudflare_uid=target_uid
      and lesson_video.stream_provider_account_registry_id=target_registry_id
      and lesson_video.cloudflare_uid=target_uid
      and version.revision_kind in ('current','free_snapshot'))
    or exists (select 1 from public.programs program where program.intro_video_id=target_video_id)
    or exists (select 1 from public.program_days day_row where day_row.video_id=target_video_id)
    or exists (select 1 from public.tasks task where task.video_id=target_video_id)
    or exists (select 1 from public.post_media media where media.kind='video' and media.video_uid=target_uid)
    or exists (select 1 from public.daily_content_revisions revision where revision.video_id=target_video_id)
    or exists (select 1 from public.member_daily_content_video_grants grant_row where grant_row.video_id=target_video_id)
    or exists (select 1 from public.member_daily_fuel_assignments assignment where assignment.video_id=target_video_id)
    or exists (select 1 from public.member_daily_fuel_bookmarks bookmark where bookmark.video_id=target_video_id)
    or exists (select 1 from public.stream_media_source_bindings binding
      where binding.registry_id=target_registry_id and binding.raw_provider_uid=target_uid
        and binding.source_kind not in ('video','program_lesson','program_offer','program_order'))
    or exists (select 1 from public.stream_media_source_bindings orphan
      where orphan.registry_id=target_registry_id and orphan.raw_provider_uid=target_uid
        and orphan.source_kind='program_lesson'
        and not exists (select 1 from public.program_content_version_lessons lesson
          join public.program_content_versions version
            on version.program_id=lesson.program_id and version.id=lesson.content_version_id
          where lesson.id::text=orphan.source_identity and lesson.video_id=target_video_id
            and lesson.cloudflare_uid=target_uid and version.revision_kind='paid')) then
    return false;
  end if;
  return true;
end;
$$;
revoke all on function private.program_media_private_origin_is_current(uuid,text,uuid)
  from public,anon,authenticated,service_role;

create function private.program_media_private_origin_mark(
  target_registry_id uuid,target_uid text,target_owner_id uuid,target_state text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  key_digest text;
  existing_row private.program_media_private_origins%rowtype;
begin
  if target_registry_id is null or target_uid is null or target_state is null
    or target_state not in ('shared','denied') then return; end if;
  perform private.stream_require_read_committed();
  perform private.stream_try_lock_accounts(array[target_owner_id]);
  if not private.stream_try_uid_lock(target_registry_id,target_uid) then
    raise exception 'Program media UID is busy; retry the complete source write' using errcode='40001';
  end if;
  -- Fresh read after the nonblocking account/UID fences. No wait lock or caller GUC
  -- can make this table write authoritative.
  if target_state='shared' and exists (
    select 1 from public.program_content_version_lessons lesson
    join public.program_content_versions version
      on version.program_id=lesson.program_id and version.id=lesson.content_version_id
    where lesson.cloudflare_uid=target_uid and version.revision_kind='paid'
      and (
        exists (select 1 from public.videos lesson_video
          where lesson_video.id=lesson.video_id
            and lesson_video.stream_provider_account_registry_id=target_registry_id
            and lesson_video.cloudflare_uid=target_uid)
        or exists (select 1 from public.stream_media_source_bindings paid_binding
          where paid_binding.source_kind='program_lesson'
            and paid_binding.source_identity=lesson.id::text
            and paid_binding.registry_id=target_registry_id
            and paid_binding.raw_provider_uid=target_uid)
      )
  ) then
    raise exception 'A paid Program UID cannot gain a nonpaid consumer' using errcode='23514';
  end if;
  key_digest:=private.program_media_private_origin_uid_digest(target_registry_id,target_uid);
  insert into private.program_media_private_origins as origin(
    uid_digest,origin_state,origin_proof_digest)
  values(key_digest,target_state,null)
  on conflict(uid_digest) do update set
    origin_state=case when origin.origin_state='protected_private'
      and excluded.origin_state='shared' then 'shared'
      when origin.origin_state in ('protected_private','shared')
        and excluded.origin_state='denied' then 'denied'
      else origin.origin_state end,
    origin_proof_digest=case when origin.origin_state='protected_private'
      then null else origin.origin_proof_digest end,
    state_revision=origin.state_revision+1,
    updated_at=clock_timestamp()
  where (origin.origin_state='protected_private'
      and excluded.origin_state in ('shared','denied'))
    or (origin.origin_state='shared' and excluded.origin_state='denied');
  select * into existing_row from private.program_media_private_origins origin
  where origin.uid_digest=key_digest;
  if existing_row.origin_state not in ('shared','denied') then
    raise exception 'Private media origin cannot be downgraded safely' using errcode='55000';
  end if;
end;
$$;
revoke all on function private.program_media_private_origin_mark(uuid,text,uuid,text)
  from public,anon,authenticated,service_role;

create function private.program_media_private_origin_mark_uid(target_uid text,target_state text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  candidate record;
begin
  if target_uid is null or target_state is null or target_state not in ('shared','denied') then return; end if;
  for candidate in
    select distinct tuple.registry_id,tuple.owner_id
    from (
      select video.stream_provider_account_registry_id as registry_id,video.coach_id as owner_id
      from public.videos video where video.cloudflare_uid=target_uid
      union all
      select asset.registry_id,asset.owner_id from public.stream_media_assets asset
      where asset.raw_provider_uid=target_uid
      union all
      select binding.registry_id,binding.owner_id from public.stream_media_source_bindings binding
      where binding.raw_provider_uid=target_uid and binding.registry_id is not null
    ) tuple
    where tuple.registry_id is not null
    order by tuple.registry_id,tuple.owner_id
  loop
    perform private.program_media_private_origin_mark(
      candidate.registry_id,target_uid,candidate.owner_id,target_state);
  end loop;
end;
$$;
revoke all on function private.program_media_private_origin_mark_uid(text,text)
  from public,anon,authenticated,service_role;

create function private.program_media_private_origin_certify_receipt()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  operation_row public.stream_media_operations%rowtype;
  transport_row public.stream_media_upload_transport%rowtype;
  proof_digest text;
  computed_uid_digest text;
begin
  select operation.* into operation_row from public.stream_media_operations operation
  where operation.id=new.operation_id;
  if not found or operation_row.operation_kind<>'upload' or operation_row.source_kind<>'video'
    or new.terminal_state<>'completed' or new.response->>'outcome'<>'ready_for_publication' then
    return null;
  end if;
  select transport.* into transport_row from public.stream_media_upload_transport transport
  where transport.operation_id=operation_row.id;
  if not found or transport_row.provider_uid is null then return null; end if;
  perform private.stream_require_read_committed();
  perform private.stream_try_lock_accounts(array[operation_row.actor_id,operation_row.owner_id]);
  if not private.stream_try_uid_lock(operation_row.registry_id,transport_row.provider_uid) then
    raise exception 'Program media UID is busy; retry library finalization' using errcode='40001';
  end if;
  proof_digest:=private.program_media_private_origin_chain_digest(
    operation_row.registry_id,transport_row.provider_uid,operation_row.source_identity::uuid,true);
  if proof_digest is null or private.stream_account_is_tombstoned(operation_row.owner_id) then return null; end if;
  computed_uid_digest:=private.program_media_private_origin_uid_digest(operation_row.registry_id,transport_row.provider_uid);
  insert into private.program_media_private_origins(uid_digest,origin_state,origin_proof_digest)
  values(computed_uid_digest,'protected_private',proof_digest)
  on conflict(uid_digest) do nothing;
  return null;
exception when invalid_text_representation then
  return null;
end;
$$;
revoke all on function private.program_media_private_origin_certify_receipt()
  from public,anon,authenticated,service_role;
create trigger stream_media_finalization_private_origin_certificate
after insert on public.stream_media_finalization_receipts
for each row execute function private.program_media_private_origin_certify_receipt();

create function private.program_media_private_origin_reference_hook()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  old_row jsonb;
  new_row jsonb;
  row_data jsonb;
  old_video uuid;
  new_video uuid;
  owner_id uuid;
  registry_id uuid;
  provider_uid text;
  binding_row record;
  media_uid text;
  owner_candidate uuid;
begin
  if tg_op<>'INSERT' then old_row:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then new_row:=to_jsonb(new); end if;
  if tg_table_name='videos' then
    if tg_op in ('UPDATE','DELETE') then
      old_video:=nullif(old_row->>'id','')::uuid;
      if old_row->>'visibility'='members' or tg_op='DELETE'
        or (tg_op='UPDATE' and (old_row->>'cloudflare_uid' is distinct from new_row->>'cloudflare_uid'
          or old_row->>'stream_provider_account_registry_id' is distinct from new_row->>'stream_provider_account_registry_id')) then
        perform private.program_media_private_origin_mark(
          nullif(old_row->>'stream_provider_account_registry_id','')::uuid,old_row->>'cloudflare_uid',
          nullif(old_row->>'coach_id','')::uuid,case when tg_op='DELETE' then 'denied' else 'shared' end);
      end if;
    end if;
    if tg_op<>'DELETE' then
      if new_row->>'visibility'='members' then
        perform private.program_media_private_origin_mark(
          nullif(new_row->>'stream_provider_account_registry_id','')::uuid,new_row->>'cloudflare_uid',
          nullif(new_row->>'coach_id','')::uuid,'shared');
      end if;
      if tg_op='UPDATE' and (old_row->>'cloudflare_uid' is distinct from new_row->>'cloudflare_uid'
        or old_row->>'stream_provider_account_registry_id' is distinct from new_row->>'stream_provider_account_registry_id') then
        perform private.program_media_private_origin_mark(
          nullif(new_row->>'stream_provider_account_registry_id','')::uuid,new_row->>'cloudflare_uid',
          nullif(new_row->>'coach_id','')::uuid,'shared');
      end if;
    end if;
    return null;
  elsif tg_table_name='stream_media_source_bindings' then
    if tg_op in ('UPDATE','DELETE') and old_row->>'source_kind'
      not in ('video','program_lesson','program_offer','program_order') then
      perform private.program_media_private_origin_mark(
        nullif(old_row->>'registry_id','')::uuid,old_row->>'raw_provider_uid',
        nullif(old_row->>'owner_id','')::uuid,case when tg_op='DELETE' then 'denied' else 'shared' end);
    end if;
    if tg_op<>'DELETE' and new_row->>'source_kind'
      not in ('video','program_lesson','program_offer','program_order') then
      perform private.program_media_private_origin_mark(
        nullif(new_row->>'registry_id','')::uuid,new_row->>'raw_provider_uid',
        nullif(new_row->>'owner_id','')::uuid,'shared');
    end if;
    return null;
  elsif tg_table_name='post_media' then
    if tg_op in ('UPDATE','DELETE') and old_row->>'kind'='video' then
      perform private.program_media_private_origin_mark_uid(old_row->>'video_uid',
        case when tg_op='DELETE' then 'denied' else 'shared' end);
    end if;
    if tg_op<>'DELETE' and new_row->>'kind'='video' then
      perform private.program_media_private_origin_mark_uid(new_row->>'video_uid','shared');
    end if;
    return null;
  elsif tg_table_name='program_content_version_lessons' then
    if tg_op in ('UPDATE','DELETE') and old_row->>'cloudflare_uid' is not null
      and exists (select 1 from public.program_content_versions version
        where version.program_id=(old_row->>'program_id')::uuid
          and version.id=(old_row->>'content_version_id')::uuid
          and version.revision_kind in ('current','free_snapshot')) then
      select video.stream_provider_account_registry_id,video.coach_id
        into registry_id,owner_candidate from public.videos video
        where video.id::text=old_row->>'video_id';
      if registry_id is null then
        select asset.registry_id,asset.owner_id into registry_id,owner_candidate
        from public.stream_media_assets asset where asset.raw_provider_uid=old_row->>'cloudflare_uid';
      end if;
      if registry_id is not null then
        perform private.program_media_private_origin_mark(registry_id,old_row->>'cloudflare_uid',
          owner_candidate,'shared');
      end if;
    end if;
    if tg_op<>'DELETE' and new_row->>'cloudflare_uid' is not null then
      if exists (select 1 from public.program_content_versions version
        where version.program_id=(new_row->>'program_id')::uuid
          and version.id=(new_row->>'content_version_id')::uuid
          and version.revision_kind in ('current','free_snapshot')) then
        select video.stream_provider_account_registry_id,video.coach_id
          into registry_id,owner_candidate from public.videos video
          where video.id::text=new_row->>'video_id';
        if registry_id is null then
          select asset.registry_id,asset.owner_id into registry_id,owner_candidate
          from public.stream_media_assets asset where asset.raw_provider_uid=new_row->>'cloudflare_uid';
        end if;
        if registry_id is not null then
          perform private.program_media_private_origin_mark(registry_id,new_row->>'cloudflare_uid',
            owner_candidate,'shared');
        end if;
      end if;
    end if;
    return null;
  end if;

  -- Remaining shareable source rows carry a video_id. A daily slot reaches its video
  -- through the exact revision; a Program intro/day and Tasks resolve through videos.
  if tg_op in ('UPDATE','DELETE') then
    row_data:=old_row;
    if tg_table_name='programs' then
      old_video:=nullif(row_data->>'intro_video_id','')::uuid;
      owner_id:=nullif(row_data->>'coach_id','')::uuid;
    elsif tg_table_name='program_days' or tg_table_name='tasks'
      or tg_table_name='daily_content_revisions' or tg_table_name='member_daily_content_video_grants'
      or tg_table_name='member_daily_fuel_assignments' or tg_table_name='member_daily_fuel_bookmarks' then
      old_video:=nullif(row_data->>'video_id','')::uuid;
      if tg_table_name='program_days' then
        select program.coach_id into owner_id from public.programs program
        where program.id=(row_data->>'program_id')::uuid;
      elsif tg_table_name='tasks' then owner_id:=nullif(row_data->>'coach_id','')::uuid;
      elsif tg_table_name='daily_content_revisions' then
        select item.owner_id into owner_id from public.daily_content_items item
        where item.id=(row_data->>'item_id')::uuid;
      elsif tg_table_name='member_daily_content_video_grants' then
        old_video:=nullif(row_data->>'video_id','')::uuid;
      elsif tg_table_name='member_daily_fuel_assignments' then owner_id:=nullif(row_data->>'coach_id','')::uuid;
      else old_video:=nullif(row_data->>'video_id','')::uuid;
      end if;
    elsif tg_table_name='daily_content_slots' then
      select revision.video_id,item.owner_id into old_video,owner_id
      from public.daily_content_revisions revision
      join public.daily_content_items item on item.id=revision.item_id
      where revision.id=(row_data->>'revision_id')::uuid
        and revision.item_id=(row_data->>'item_id')::uuid
        and revision.kind='video' and row_data->>'content_kind'='video'
        and row_data->>'status' in ('scheduled','published');
    end if;
    if old_video is not null then
      select video.stream_provider_account_registry_id,video.cloudflare_uid,video.coach_id
        into registry_id,provider_uid,owner_candidate from public.videos video where video.id=old_video;
      if registry_id is not null and provider_uid is not null then
        perform private.program_media_private_origin_mark(registry_id,provider_uid,
          coalesce(owner_id,owner_candidate),'shared');
      end if;
    end if;
  end if;
  if tg_op<>'DELETE' then
    row_data:=new_row;
    owner_id:=null;
    new_video:=null;
    if tg_table_name='programs' then
      new_video:=nullif(row_data->>'intro_video_id','')::uuid;
      owner_id:=nullif(row_data->>'coach_id','')::uuid;
    elsif tg_table_name='program_days' or tg_table_name='tasks'
      or tg_table_name='daily_content_revisions' or tg_table_name='member_daily_content_video_grants'
      or tg_table_name='member_daily_fuel_assignments' or tg_table_name='member_daily_fuel_bookmarks' then
      new_video:=nullif(row_data->>'video_id','')::uuid;
      if tg_table_name='program_days' then
        select program.coach_id into owner_id from public.programs program
        where program.id=(row_data->>'program_id')::uuid;
      elsif tg_table_name='tasks' then owner_id:=nullif(row_data->>'coach_id','')::uuid;
      elsif tg_table_name='daily_content_revisions' then
        select item.owner_id into owner_id from public.daily_content_items item
        where item.id=(row_data->>'item_id')::uuid;
      elsif tg_table_name='member_daily_fuel_assignments' then owner_id:=nullif(row_data->>'coach_id','')::uuid;
      end if;
    elsif tg_table_name='daily_content_slots' then
      select revision.video_id,item.owner_id into new_video,owner_id
      from public.daily_content_revisions revision
      join public.daily_content_items item on item.id=revision.item_id
      where revision.id=(row_data->>'revision_id')::uuid
        and revision.item_id=(row_data->>'item_id')::uuid
        and revision.kind='video' and row_data->>'content_kind'='video'
        and row_data->>'status' in ('scheduled','published');
    end if;
    if new_video is not null then
      select video.stream_provider_account_registry_id,video.cloudflare_uid,video.coach_id
        into registry_id,provider_uid,owner_candidate from public.videos video where video.id=new_video;
      if registry_id is not null and provider_uid is not null then
        perform private.program_media_private_origin_mark(registry_id,provider_uid,
          coalesce(owner_id,owner_candidate),'shared');
      end if;
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.program_media_private_origin_reference_hook()
  from public,anon,authenticated,service_role;

create function private.program_media_private_origin_paid_lesson_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  version_kind text;
  registry_id uuid;
  provider_uid text;
  owner_id uuid;
begin
  select version.revision_kind into version_kind
  from public.program_content_versions version
  where version.program_id=new.program_id and version.id=new.content_version_id;
  if new.video_id is null then return null; end if;
  select video.stream_provider_account_registry_id,video.cloudflare_uid,video.coach_id
    into registry_id,provider_uid,owner_id from public.videos video where video.id=new.video_id;
  if version_kind in ('current','free_snapshot') then
    if registry_id is not null and provider_uid is not null then
      perform private.program_media_private_origin_mark(registry_id,provider_uid,
        (select video.coach_id from public.videos video where video.id=new.video_id),'shared');
    end if;
    return null;
  end if;
  if version_kind='paid' then
    if registry_id is null or provider_uid is null or owner_id is null
      or new.cloudflare_uid is distinct from provider_uid
      or new.video_creator_id is distinct from owner_id then
      raise exception 'Paid Program media must match its exact current Library identity'
        using errcode='23514';
    end if;
    perform private.stream_require_read_committed();
    perform private.stream_try_lock_accounts(array[owner_id]);
    if not private.stream_try_uid_lock(registry_id,provider_uid) then
      raise exception 'Paid Program media UID is busy; retry the complete publication'
        using errcode='40001';
    end if;
    -- The same nonblocking account+UID fence used by every exposure writer stays held
    -- through commit, so an exposure cannot race a successful publication check.
    if not private.program_media_private_origin_is_current(registry_id,provider_uid,new.video_id) then
      raise exception 'Paid Program media requires a valid never-shared Library origin'
        using errcode='23514';
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.program_media_private_origin_paid_lesson_guard()
  from public,anon,authenticated,service_role;
create trigger program_lessons_private_origin_exposure
after insert or update of program_id,content_version_id,video_id,cloudflare_uid
on public.program_content_version_lessons
for each row execute function private.program_media_private_origin_paid_lesson_guard();

create function private.program_media_private_origin_paid_lesson_final_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  version_kind text;
  selected_registry_id uuid;
  provider_uid text;
begin
  select version.revision_kind into version_kind
  from public.program_content_versions version
  where version.program_id=new.program_id and version.id=new.content_version_id;
  if version_kind<>'paid' or new.video_id is null then return null; end if;
  select video.stream_provider_account_registry_id,video.cloudflare_uid
    into selected_registry_id,provider_uid from public.videos video where video.id=new.video_id;
  if selected_registry_id is null or provider_uid is null or new.cloudflare_uid is distinct from provider_uid
    or not private.program_media_private_origin_is_current(selected_registry_id,provider_uid,new.video_id)
    or not private.stream_app_paid_lesson_is_exclusive(new.id,new.video_id,selected_registry_id,provider_uid)
    or exists (
      select 1 from public.program_content_version_lessons other_lesson
      join public.program_content_versions other_version
        on other_version.program_id=other_lesson.program_id
       and other_version.id=other_lesson.content_version_id
      where other_lesson.id<>new.id and other_lesson.cloudflare_uid=provider_uid
        and other_version.revision_kind='paid' and other_lesson.program_id<>new.program_id
        and (
          exists (select 1 from public.videos other_video
            where other_video.id=other_lesson.video_id
              and other_video.stream_provider_account_registry_id=selected_registry_id
              and other_video.cloudflare_uid=provider_uid)
          or exists (select 1 from public.stream_media_source_bindings other_binding
            where other_binding.source_kind='program_lesson'
              and other_binding.source_identity=other_lesson.id::text
              and other_binding.registry_id=selected_registry_id
              and other_binding.raw_provider_uid=provider_uid)
        )
    ) then
    raise exception 'Paid Program media failed its final origin or exclusivity check'
      using errcode='23514';
  end if;
  return null;
end;
$$;
revoke all on function private.program_media_private_origin_paid_lesson_final_check()
  from public,anon,authenticated,service_role;
create constraint trigger program_lessons_private_origin_final_check
after insert or update of program_id,content_version_id,video_id,cloudflare_uid
on public.program_content_version_lessons
deferrable initially deferred
for each row execute function private.program_media_private_origin_paid_lesson_final_check();

create function private.program_media_private_origin_order_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  lesson record;
begin
  for lesson in
    select content_lesson.id,content_lesson.program_id,content_lesson.video_id,
      content_lesson.cloudflare_uid,video.stream_provider_account_registry_id as registry_id,
      video.coach_id as owner_id,content_lesson.video_creator_id,version.revision_kind
    from public.program_content_version_lessons content_lesson
    join public.program_content_versions version on version.program_id=content_lesson.program_id
      and version.id=content_lesson.content_version_id
    left join public.videos video on video.id=content_lesson.video_id
    where content_lesson.program_id=new.program_id
      and content_lesson.content_version_id=new.content_version_id
      and content_lesson.video_id is not null
  loop
    if lesson.revision_kind='paid' then
      perform private.stream_require_read_committed();
      if lesson.registry_id is null or lesson.owner_id is null
        or lesson.video_creator_id is distinct from lesson.owner_id then
        raise exception 'Program order content has an unverified paid media identity' using errcode='23514';
      end if;
      perform private.stream_try_lock_accounts(array[lesson.owner_id]);
      if not private.stream_try_uid_lock(lesson.registry_id,lesson.cloudflare_uid) then
        raise exception 'Program order media UID is busy; retry the complete operation' using errcode='40001';
      end if;
      if not private.program_media_private_origin_is_current(
          lesson.registry_id,lesson.cloudflare_uid,lesson.video_id)
        or not private.stream_app_paid_lesson_is_exclusive(
          lesson.id,lesson.video_id,lesson.registry_id,lesson.cloudflare_uid) then
        raise exception 'Program order content has an unverified paid media origin' using errcode='23514';
      end if;
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function private.program_media_private_origin_order_guard()
  from public,anon,authenticated,service_role;
create trigger program_orders_private_origin_guard
after insert or update of program_id,content_version_id on public.program_orders
for each row execute function private.program_media_private_origin_order_guard();

create function private.program_media_private_origin_asset_cleanup_hook()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.lifecycle_state in ('cleanup_pending','delete_unknown','deleted_confirmed','quarantined')
    and new.lifecycle_state is distinct from old.lifecycle_state then
    perform private.program_media_private_origin_mark(new.registry_id,new.raw_provider_uid,
      new.owner_id,'denied');
  end if;
  return null;
end;
$$;
revoke all on function private.program_media_private_origin_asset_cleanup_hook()
  from public,anon,authenticated,service_role;
create trigger stream_media_assets_private_origin_cleanup
after update of lifecycle_state on public.stream_media_assets
for each row execute function private.program_media_private_origin_asset_cleanup_hook();

create function private.program_media_private_origin_account_cleanup_hook()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  asset_row record;
begin
  for asset_row in
    select distinct candidate.registry_id,candidate.raw_provider_uid,candidate.owner_id
    from (
      select asset.registry_id,asset.raw_provider_uid,asset.owner_id
      from public.stream_media_assets asset where asset.owner_id=new.account_id
      union all
      select video.stream_provider_account_registry_id,video.cloudflare_uid,video.coach_id
      from public.videos video where video.coach_id=new.account_id
        and video.stream_provider_account_registry_id is not null
    ) candidate
    order by candidate.registry_id,candidate.raw_provider_uid
  loop
    perform private.program_media_private_origin_mark(asset_row.registry_id,
      asset_row.raw_provider_uid,asset_row.owner_id,'denied');
  end loop;
  return null;
end;
$$;
revoke all on function private.program_media_private_origin_account_cleanup_hook()
  from public,anon,authenticated,service_role;
create trigger stream_media_account_tombstones_private_origin_cleanup
after insert on public.stream_media_account_tombstones
for each row execute function private.program_media_private_origin_account_cleanup_hook();

-- Idempotent-source hook set. The existing 315/600 bodies and triggers remain unchanged.
create trigger videos_program_private_origin_exposure
after insert or update or delete on public.videos
for each row execute function private.program_media_private_origin_reference_hook();
create trigger stream_media_source_bindings_program_private_origin_exposure
after insert or update or delete on public.stream_media_source_bindings
for each row execute function private.program_media_private_origin_reference_hook();
create trigger post_media_program_private_origin_exposure
after insert or update or delete on public.post_media
for each row execute function private.program_media_private_origin_reference_hook();
create trigger programs_program_private_origin_exposure
after insert or update or delete on public.programs
for each row execute function private.program_media_private_origin_reference_hook();
create trigger program_days_program_private_origin_exposure
after insert or update or delete on public.program_days
for each row execute function private.program_media_private_origin_reference_hook();
create trigger tasks_program_private_origin_exposure
after insert or update or delete on public.tasks
for each row execute function private.program_media_private_origin_reference_hook();
create trigger daily_content_revisions_program_private_origin_exposure
after insert or update or delete on public.daily_content_revisions
for each row execute function private.program_media_private_origin_reference_hook();
create trigger daily_content_slots_program_private_origin_exposure
after insert or update or delete on public.daily_content_slots
for each row execute function private.program_media_private_origin_reference_hook();
create trigger daily_content_grants_program_private_origin_exposure
after insert or update or delete on public.member_daily_content_video_grants
for each row execute function private.program_media_private_origin_reference_hook();
create trigger daily_fuel_assignments_program_private_origin_exposure
after insert or update or delete on public.member_daily_fuel_assignments
for each row execute function private.program_media_private_origin_reference_hook();
create trigger daily_fuel_bookmarks_program_private_origin_exposure
after insert or update or delete on public.member_daily_fuel_bookmarks
for each row execute function private.program_media_private_origin_reference_hook();

-- Freeze new writes behind installed hooks before creating the epoch. The zero-history
-- checks, triggers, and marker commit as one transaction; a timeout or check failure aborts all.
insert into private.program_media_private_origin_epoch(singleton,epoch_id,activated_at)
values(true,gen_random_uuid(),clock_timestamp());
commit;
