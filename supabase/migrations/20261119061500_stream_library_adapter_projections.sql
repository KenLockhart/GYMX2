-- Narrow server projections for the first VOD adapter. These read only the durable 300/310/315
-- contracts; they do not register accounts, attest provider responses, mint bearer URLs, or claim POSTs.

create function public.get_stream_provider_account_projection(
  target_credential_slot text,
  target_expected_provider_account_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_registry public.stream_provider_account_registry%rowtype;
  v_attestation public.stream_provider_account_attestations%rowtype;
  v_verification_state public.stream_provider_account_verification_state%rowtype;
  v_verification_event public.stream_provider_account_verification_events%rowtype;
  v_verification_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Stream account projections are service managed' using errcode = '42501';
  end if;
  if target_credential_slot is null or target_expected_provider_account_id is null
    or target_expected_provider_account_id !~ '^[0-9a-f]{32}$' then
    raise exception 'Stream account projection identity is invalid' using errcode = '22023';
  end if;
  if target_credential_slot not in ('vod_primary','vod_secondary') then
    return jsonb_build_object('outcome','invalid_slot');
  end if;

  select registry.* into v_registry
  from public.stream_provider_account_registry registry
  where registry.provider = 'cloudflare_stream'
    and registry.credential_slot = target_credential_slot;
  if not found then
    return jsonb_build_object('outcome','slot_unregistered');
  end if;
  select attestation.* into v_attestation
  from public.stream_provider_account_attestations attestation
  where attestation.registry_id=v_registry.id
    and attestation.provider='cloudflare_stream'
    and attestation.credential_slot=v_registry.credential_slot
    and attestation.provider_account_id=v_registry.provider_account_id
    and attestation.attestation_kind='trusted_service_account_binding_report'
  order by attestation.attested_at desc,attestation.id
  limit 1;
  if not found then
    return jsonb_build_object('outcome','identity_inconsistent');
  end if;

  if v_registry.provider_account_id is distinct from target_expected_provider_account_id then
    return jsonb_build_object('outcome','account_binding_mismatch');
  end if;

  select verification_state.* into v_verification_state
  from public.stream_provider_account_verification_state verification_state
  where verification_state.registry_id = v_registry.id;
  if not found then
    return jsonb_build_object(
      'outcome','identity_found',
      'registry_id',v_registry.id,
      'provider',v_registry.provider,
      'credential_slot',v_registry.credential_slot,
      'provider_account_id',v_registry.provider_account_id,
      'attestation_id',v_attestation.id,
      'attestation_request_id',v_attestation.request_id,
      'attestation_digest',v_attestation.evidence_digest,
      'attested_at',v_attestation.attested_at,
      'verification_status','unverified',
      'verification_valid',false,
      'verified_until',null,
      'verification_revision',null,
      'verification_event_id',null,
      'verification_request_id',null,
      'verification_observed_at',null
    );
  end if;

  select verification_event.* into v_verification_event
  from public.stream_provider_account_verification_events verification_event
  where verification_event.id = v_verification_state.verification_event_id
    and verification_event.registry_id = v_registry.id
    and verification_event.credential_slot = v_registry.credential_slot
    and verification_event.provider_account_id = v_registry.provider_account_id
    and verification_event.verification_kind = 'explicit_account_stream_path_access'
    and verification_event.http_status between 200 and 299;
  if not found then
    return jsonb_build_object('outcome','identity_inconsistent');
  end if;

  v_verification_status := case
    when v_verification_state.verified_until > statement_timestamp() then 'verified_current'
    else 'verification_expired'
  end;
  return jsonb_build_object(
    'outcome','identity_found',
    'registry_id',v_registry.id,
    'provider',v_registry.provider,
    'credential_slot',v_registry.credential_slot,
    'provider_account_id',v_registry.provider_account_id,
    'attestation_id',v_attestation.id,
    'attestation_request_id',v_attestation.request_id,
    'attestation_digest',v_attestation.evidence_digest,
    'attested_at',v_attestation.attested_at,
    'verification_status',v_verification_status,
    'verification_valid',v_verification_status = 'verified_current',
    'verified_until',v_verification_state.verified_until,
    'verification_revision',v_verification_state.revision,
    'verification_event_id',v_verification_event.id,
    'verification_request_id',v_verification_event.request_id,
    'verification_observed_at',v_verification_event.observed_at
  );
end;
$$;
revoke all on function public.get_stream_provider_account_projection(text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.get_stream_provider_account_projection(text,text)
  to service_role;

create function public.get_stream_library_upload_work(
  target_operation_id uuid,
  target_expected_actor_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_operation public.stream_media_operations%rowtype;
  v_intent public.stream_media_upload_intents%rowtype;
  v_context public.stream_media_upload_contexts%rowtype;
  v_library_request public.stream_media_library_requests%rowtype;
  v_transport public.stream_media_upload_transport%rowtype;
  v_state public.stream_media_operation_states%rowtype;
  v_registry public.stream_provider_account_registry%rowtype;
  v_attestation public.stream_provider_account_attestations%rowtype;
  v_verification_state public.stream_provider_account_verification_state%rowtype;
  v_verification_event public.stream_provider_account_verification_events%rowtype;
  v_create_claim public.stream_media_create_claims%rowtype;
  v_latest_observation public.stream_media_upload_observations%rowtype;
  v_latest_exact_get public.stream_media_upload_observations%rowtype;
  v_latest_observation_order bigint;
  v_latest_observation_at timestamptz;
  v_latest_exact_get_order bigint;
  v_latest_exact_get_at timestamptz;
  v_latest_receipt public.stream_media_finalization_receipts%rowtype;
  v_profile_fence public.stream_media_parent_fences%rowtype;
  v_asset public.stream_media_assets%rowtype;
  v_binding public.stream_media_source_bindings%rowtype;
  v_video public.videos%rowtype;
  v_actor_role text;
  v_actor_eligible boolean;
  v_verification_current boolean := false;
  v_has_verification boolean := false;
  v_fence_current boolean := false;
  v_latest_readback_valid boolean := false;
  v_latest_readback_identity_valid boolean := false;
  v_latest_readback_retryable boolean := false;
  v_expected_payload_digest text;
  v_expected_operation_digest text;
  v_expected_metadata jsonb;
  v_asset_count bigint := 0;
  v_binding_count bigint := 0;
  v_active_state boolean := false;
  v_completed boolean := false;
  v_has_source_video boolean := false;
  v_work jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Library upload work projections are service managed' using errcode = '42501';
  end if;
  if target_operation_id is null or target_expected_actor_id is null then
    raise exception 'Library upload projection identity is invalid' using errcode = '22023';
  end if;

  select operation.* into v_operation
  from public.stream_media_operations operation
  where operation.id = target_operation_id
    and operation.operation_kind = 'upload'
    and operation.source_kind = 'video'
    and operation.actor_id = target_expected_actor_id
    and operation.owner_id = target_expected_actor_id;
  if not found then
    return jsonb_build_object('outcome','unavailable');
  end if;

  select profile.role::text into v_actor_role
  from public.profiles profile
  where profile.id = target_expected_actor_id;
  if not found then
    return jsonb_build_object('outcome','not_eligible');
  end if;
  v_actor_eligible := v_actor_role in ('coach','admin')
    and private.stream_app_role_eligible(target_expected_actor_id,'video');
  if not v_actor_eligible then
    return jsonb_build_object('outcome','not_eligible','actor_role',v_actor_role);
  end if;
  if private.stream_account_is_tombstoned(target_expected_actor_id) then
    return jsonb_build_object('outcome','account_deleting',
      'actor_tombstoned',true,'owner_tombstoned',true);
  end if;

  select intent.* into v_intent
  from public.stream_media_upload_intents intent
  where intent.id = v_operation.intent_id;
  select context.* into v_context
  from public.stream_media_upload_contexts context
  where context.intent_id = v_operation.intent_id;
  select library_request.* into v_library_request
  from public.stream_media_library_requests library_request
  where library_request.operation_id = target_operation_id;
  select transport.* into v_transport
  from public.stream_media_upload_transport transport
  where transport.operation_id = target_operation_id;
  select state.* into v_state
  from public.stream_media_operation_states state
  where state.operation_id = target_operation_id;
  select registry.* into v_registry
  from public.stream_provider_account_registry registry
  where registry.id = v_operation.registry_id
    and registry.provider = 'cloudflare_stream';
  if v_intent.id is null or v_context.intent_id is null
    or v_library_request.operation_id is null or v_transport.operation_id is null
    or v_state.operation_id is null or v_registry.id is null then
    return jsonb_build_object('outcome','operation_inconsistent');
  end if;

  v_expected_payload_digest := private.stream_media_identity_digest(concat_ws('|',
    'library_video',target_expected_actor_id::text,v_library_request.video_id::text,
    v_library_request.title,v_library_request.description,v_library_request.file_digest));
  v_expected_metadata := jsonb_build_object(
    'request_marker',v_intent.request_marker::text,
    'source_kind','video',
    'source_id',v_library_request.video_id::text,
    'actor_id',target_expected_actor_id::text
  );
  v_expected_operation_digest := private.stream_media_identity_digest(concat_ws('|',
    'stream_library_upload_v1',v_expected_payload_digest,v_intent.id::text,
    v_library_request.video_id::text,target_expected_actor_id::text,
    v_intent.request_marker::text,'vod_primary','7200','true'));

  if v_operation.parent_kind is distinct from 'profile'
    or v_operation.parent_identity is distinct from target_expected_actor_id::text
    or v_operation.expected_source_revision is distinct from v_context.source_revision
    or v_operation.expected_source_revision is distinct from v_intent.parent_revision
    or v_operation.source_identity is distinct from v_library_request.video_id::text
    or v_operation.operation_digest is distinct from v_expected_operation_digest
    or v_intent.purpose is distinct from 'library_video'
    or v_intent.source_kind is distinct from 'video'
    or v_intent.source_id is distinct from v_library_request.video_id
    or v_intent.actor_id is distinct from target_expected_actor_id
    or v_intent.provider_account_registry_id is distinct from v_operation.registry_id
    or v_intent.payload_digest is distinct from v_expected_payload_digest
    or v_context.parent_kind is distinct from 'profile'
    or v_context.parent_identity is distinct from target_expected_actor_id::text
    or v_context.owner_id is distinct from target_expected_actor_id
    or v_context.context_digest is distinct from private.stream_media_identity_digest(concat_ws('|',
      'profile',target_expected_actor_id::text,v_context.source_revision::text,v_intent.id::text))
    or v_library_request.actor_id is distinct from target_expected_actor_id
    or v_library_request.request_digest is distinct from v_expected_payload_digest
    or v_transport.registry_id is distinct from v_operation.registry_id
    or v_transport.request_digest is distinct from v_operation.operation_digest
    or v_transport.request_marker is distinct from v_intent.request_marker
    or v_transport.original_max_duration_seconds is distinct from 7200
    or v_transport.original_require_signed_urls is distinct from true
    or v_transport.original_metadata is distinct from v_expected_metadata
    or v_registry.credential_slot is distinct from 'vod_primary'
    or (select count(*) from public.stream_media_upload_account_edges account_edge
        where account_edge.intent_id=v_intent.id
          and account_edge.account_id=target_expected_actor_id
          and account_edge.relation_kind in ('actor','source_owner')) <> 2
    or exists (select 1 from public.stream_media_upload_account_edges foreign_edge
        where foreign_edge.intent_id=v_intent.id
          and foreign_edge.account_id is distinct from target_expected_actor_id) then
    return jsonb_build_object('outcome','operation_inconsistent');
  end if;

  select verification_state.* into v_verification_state
  from public.stream_provider_account_verification_state verification_state
  where verification_state.registry_id = v_registry.id;
  if found then
    select verification_event.* into v_verification_event
    from public.stream_provider_account_verification_events verification_event
    where verification_event.id = v_verification_state.verification_event_id
      and verification_event.registry_id = v_registry.id
      and verification_event.credential_slot = v_registry.credential_slot
      and verification_event.provider_account_id = v_registry.provider_account_id
      and verification_event.verification_kind = 'explicit_account_stream_path_access'
      and verification_event.http_status between 200 and 299;
    if not found then
      return jsonb_build_object('outcome','account_identity_inconsistent');
    end if;
    v_has_verification := true;
    v_verification_current := v_verification_state.verified_until > statement_timestamp();
  end if;

  if v_state.operation_state = 'canceled'
    or exists (select 1 from public.stream_media_upload_cancel_receipts cancel_receipt
        where cancel_receipt.operation_id=target_operation_id)
    or exists (select 1 from public.stream_media_upload_prehttp_cancel_receipts prehttp_receipt
        where prehttp_receipt.operation_id=target_operation_id)
    or exists (select 1 from public.stream_media_upload_abort_manifests abort_manifest
        where abort_manifest.upload_operation_id=target_operation_id) then
    return jsonb_build_object('outcome','canceled_or_cleanup_held');
  end if;
  if v_state.operation_state in ('failed','cleanup_reserved','delete_started','delete_unknown',
      'source_finalizing','retained','auth_call_started','auth_result_unknown','auth_confirmed')
    then
    return jsonb_build_object('outcome','unavailable');
  end if;

  v_active_state := v_state.operation_state in (
    'reserved','create_started','create_unknown','created_unverified','provisional_bound'
  );
  v_completed := v_state.operation_state = 'completed';
  if not v_active_state and not v_completed then
    return jsonb_build_object('outcome','operation_inconsistent');
  end if;
  if v_active_state and not v_verification_current then
    return jsonb_build_object('outcome','account_unverified',
      'registry_id',v_registry.id,
      'credential_slot',v_registry.credential_slot,
      'provider_account_id',v_registry.provider_account_id,
      'verification_status',case when v_has_verification then 'verification_expired' else 'unverified' end,
      'verified_until',case when v_has_verification then v_verification_state.verified_until else null end);
  end if;

  select fence.* into v_profile_fence
  from public.stream_media_parent_fences fence
  where fence.source_kind='profile'
    and fence.source_identity=target_expected_actor_id::text;
  if found then
    v_fence_current := v_profile_fence.owner_id is not distinct from target_expected_actor_id
      and v_profile_fence.source_revision = v_operation.expected_source_revision
      and v_profile_fence.active_operation_id = target_operation_id
      and v_profile_fence.fence_state = 'closing';
  end if;
  if v_active_state and not v_fence_current then
    return jsonb_build_object('outcome','source_fence_changed');
  end if;

  select claim.* into v_create_claim
  from public.stream_media_create_claims claim
  where claim.operation_id=target_operation_id;
  if found and (v_create_claim.request_digest is distinct from v_operation.operation_digest
      or v_create_claim.operation_revision < 1) then
    return jsonb_build_object('outcome','operation_inconsistent');
  end if;

  select observation.* into v_latest_observation
  from public.stream_media_upload_observations observation
  join public.stream_media_upload_observation_clocks observation_clock
    on observation_clock.observation_id=observation.id
  where observation.operation_id=target_operation_id
    and observation.registry_id=v_registry.id
  order by observation_clock.order_sequence desc
  limit 1;
  if found then
    select observation_clock.order_sequence,observation_clock.observed_at
      into v_latest_observation_order,v_latest_observation_at
    from public.stream_media_upload_observation_clocks observation_clock
    where observation_clock.observation_id=v_latest_observation.id;
  end if;

  select observation.* into v_latest_exact_get
  from public.stream_media_upload_observations observation
  join public.stream_media_upload_observation_clocks observation_clock
    on observation_clock.observation_id=observation.id
  where observation.operation_id=target_operation_id
    and observation.registry_id=v_registry.id
    and observation.observation_kind='exact_uid_get'
  order by observation_clock.order_sequence desc
  limit 1;
  if found then
    select observation_clock.order_sequence,observation_clock.observed_at
      into v_latest_exact_get_order,v_latest_exact_get_at
    from public.stream_media_upload_observation_clocks observation_clock
    where observation_clock.observation_id=v_latest_exact_get.id;
    v_latest_readback_identity_valid :=
      v_latest_exact_get.raw_provider_uid is not distinct from v_transport.provider_uid
      and v_latest_exact_get.http_status is not distinct from 200
      and v_latest_exact_get.signed_urls_reported is true
      and v_latest_exact_get.creator_marker_matched is true
      and v_latest_exact_get.metadata_marker_matched is true;
    v_latest_readback_valid := v_latest_readback_identity_valid
      and v_latest_exact_get.ready_to_stream_reported is true;
    v_latest_readback_retryable :=
      ((v_latest_exact_get.http_status in (408,425,429)
          or v_latest_exact_get.http_status between 500 and 599)
        and v_latest_exact_get.raw_provider_uid is not distinct from v_transport.provider_uid
        and v_latest_exact_get.signed_urls_reported is not false
        and v_latest_exact_get.creator_marker_matched is not false
        and v_latest_exact_get.metadata_marker_matched is not false)
      or (v_latest_readback_identity_valid
        and v_latest_exact_get.ready_to_stream_reported is not true);
    if not v_latest_readback_valid and not v_latest_readback_retryable then
      return jsonb_build_object('outcome','observation_conflict');
    end if;
  end if;

  if v_latest_observation.id is not null
    and v_transport.provider_uid is not null
    and v_latest_observation.raw_provider_uid is not null
    and v_latest_observation.raw_provider_uid is distinct from v_transport.provider_uid then
    return jsonb_build_object('outcome','observation_conflict');
  end if;

  select count(*) into v_asset_count
  from public.stream_media_assets asset
  where asset.upload_intent_id=v_intent.id;
  if v_asset_count > 1 then
    return jsonb_build_object('outcome','operation_inconsistent');
  end if;
  if v_asset_count = 1 then
    select asset.* into v_asset
    from public.stream_media_assets asset
    where asset.upload_intent_id=v_intent.id;
    select count(*) into v_binding_count
    from public.stream_media_source_bindings binding
    where binding.asset_id=v_asset.id
      and binding.registry_id=v_registry.id
      and binding.raw_provider_uid=v_transport.provider_uid
      and binding.source_kind='video'
      and binding.source_identity=v_library_request.video_id::text
      and binding.parent_kind='profile'
      and binding.parent_identity=target_expected_actor_id::text
      and binding.owner_id=target_expected_actor_id;
    if v_binding_count > 1 then
      return jsonb_build_object('outcome','operation_inconsistent');
    end if;
    if v_binding_count = 1 then
      select binding.* into v_binding
      from public.stream_media_source_bindings binding
      where binding.asset_id=v_asset.id
        and binding.registry_id=v_registry.id
        and binding.raw_provider_uid=v_transport.provider_uid
        and binding.source_kind='video'
        and binding.source_identity=v_library_request.video_id::text
        and binding.parent_kind='profile'
        and binding.parent_identity=target_expected_actor_id::text
        and binding.owner_id=target_expected_actor_id;
    end if;
  end if;

  if v_transport.provider_uid is null
    and (v_transport.provider_evidence_digest is not null
      or v_transport.tus_location is not null
      or v_transport.transport_expires_at is not null) then
    return jsonb_build_object('outcome','operation_inconsistent');
  end if;
  if v_transport.provider_uid is not null and v_transport.provider_evidence_digest is null then
    return jsonb_build_object('outcome','operation_inconsistent');
  end if;

  if v_state.operation_state='reserved' then
    if v_create_claim.operation_id is not null or v_transport.provider_uid is not null
      or v_latest_observation.id is not null or v_asset_count <> 0
      or exists (select 1 from public.videos video where video.id=v_library_request.video_id) then
      return jsonb_build_object('outcome','operation_inconsistent');
    end if;
  elsif v_state.operation_state in ('create_started','create_unknown') then
    if v_create_claim.operation_id is null then
      return jsonb_build_object('outcome','operation_inconsistent');
    end if;
  elsif v_state.operation_state='created_unverified' then
    if v_create_claim.operation_id is null or v_transport.provider_uid is null then
      return jsonb_build_object('outcome','operation_inconsistent');
    end if;
  elsif v_state.operation_state='provisional_bound' then
    if v_create_claim.operation_id is null or v_transport.provider_uid is null
      or v_asset_count <> 1 or v_binding_count <> 1
      or v_asset.registry_id is distinct from v_registry.id
      or v_asset.raw_provider_uid is distinct from v_transport.provider_uid
      or v_asset.owner_id is distinct from target_expected_actor_id
      or v_asset.lifecycle_state is distinct from 'provisional_bound'
      or v_asset.signed_urls_verified is distinct from true
      or v_asset.ready_to_stream_verified is distinct from true
      or v_binding.registry_id is distinct from v_registry.id
      or v_binding.raw_provider_uid is distinct from v_transport.provider_uid
      or v_binding.asset_id is distinct from v_asset.id
      or v_binding.source_kind is distinct from 'video'
      or v_binding.source_identity is distinct from v_library_request.video_id::text
      or v_binding.parent_kind is distinct from 'profile'
      or v_binding.parent_identity is distinct from target_expected_actor_id::text
      or v_binding.source_revision is distinct from v_operation.expected_source_revision
      or v_binding.owner_id is distinct from target_expected_actor_id
      or v_binding.binding_state is distinct from 'provisional_bound'
      or v_binding.evidence_digest is distinct from v_asset.evidence_digest
      or exists (select 1 from public.videos video where video.id=v_library_request.video_id) then
      return jsonb_build_object('outcome','operation_inconsistent');
    end if;
  elsif v_completed then
    if v_transport.provider_uid is null or v_asset_count <> 1 or v_binding_count <> 1
      or v_asset.registry_id is distinct from v_registry.id
      or v_asset.raw_provider_uid is distinct from v_transport.provider_uid
      or v_asset.owner_id is distinct from target_expected_actor_id
      or v_asset.lifecycle_state is distinct from 'ready_for_publication'
      or v_asset.signed_urls_verified is distinct from true
      or v_asset.ready_to_stream_verified is distinct from true
      or v_binding.registry_id is distinct from v_registry.id
      or v_binding.raw_provider_uid is distinct from v_transport.provider_uid
      or v_binding.asset_id is distinct from v_asset.id
      or v_binding.source_kind is distinct from 'video'
      or v_binding.source_identity is distinct from v_library_request.video_id::text
      or v_binding.parent_kind is distinct from 'profile'
      or v_binding.parent_identity is distinct from target_expected_actor_id::text
      or v_binding.source_revision is distinct from v_operation.expected_source_revision+1
      or v_binding.owner_id is distinct from target_expected_actor_id
      or v_binding.binding_state is distinct from 'ready_for_publication'
      or v_binding.evidence_digest is distinct from v_asset.evidence_digest then
      return jsonb_build_object('outcome','operation_inconsistent');
    end if;

    select receipt.* into v_latest_receipt
    from public.stream_media_finalization_receipts receipt
    where receipt.operation_id=target_operation_id
    order by receipt.created_at desc,receipt.request_id
    limit 1;
    if v_latest_receipt.operation_id is null
      or v_latest_receipt.terminal_state is distinct from 'completed'
      or v_latest_receipt.request_digest is distinct from v_asset.evidence_digest
      or v_latest_receipt.response->>'outcome' is distinct from 'ready_for_publication'
      or v_latest_receipt.response->>'video_id' is distinct from v_library_request.video_id::text then
      return jsonb_build_object('outcome','operation_inconsistent');
    end if;

    select video.* into v_video
    from public.videos video
    where video.id=v_library_request.video_id
      and video.coach_id=target_expected_actor_id
      and video.cloudflare_uid=v_transport.provider_uid
      and video.stream_provider_account_registry_id=v_registry.id
      and video.status::text='ready';
    v_has_source_video := found;
    if not v_has_source_video then
      return jsonb_build_object('outcome','source_changed');
    end if;
  end if;
  v_work := jsonb_build_object(
    'operation_id',v_operation.id,
    'operation_request_id',v_operation.request_id,
    'operation_digest',v_operation.operation_digest,
    'operation_state',v_state.operation_state,
    'operation_revision',v_state.state_revision,
    'intent_id',v_intent.id,
    'actor_id',v_operation.actor_id,
    'owner_id',v_operation.owner_id,
    'source_kind',v_operation.source_kind,
    'source_id',v_library_request.video_id,
    'expected_source_revision',v_operation.expected_source_revision,
    'title',v_library_request.title,
    'description',v_library_request.description,
    'file_digest',v_library_request.file_digest,
    'request_digest',v_library_request.request_digest,
    'registry',jsonb_build_object(
      'registry_id',v_registry.id,
      'provider',v_registry.provider,
      'credential_slot',v_registry.credential_slot,
      'provider_account_id',v_registry.provider_account_id,
      'verification_status',case
        when not v_has_verification then 'unverified'
        when v_verification_current then 'verified_current'
        else 'verification_expired' end,
      'verified_until',case when v_has_verification then v_verification_state.verified_until else null end,
      'verification_revision',case when v_has_verification then v_verification_state.revision else null end,
      'verification_event_id',case when v_has_verification then v_verification_event.id else null end,
      'verification_request_id',case when v_has_verification then v_verification_event.request_id else null end
    ),
    'transport',jsonb_build_object(
      'request_id',v_transport.request_id,
      'request_digest',v_transport.request_digest,
      'request_marker',v_transport.request_marker,
      'provider_uid',v_transport.provider_uid,
      'provider_evidence_digest',v_transport.provider_evidence_digest,
      'tus_location_present',v_transport.tus_location is not null,
      'transport_expires_at',v_transport.transport_expires_at,
      'original_max_duration_seconds',v_transport.original_max_duration_seconds,
      'original_require_signed_urls',v_transport.original_require_signed_urls,
      'original_metadata',v_transport.original_metadata
    ),
    'create_claim',case when v_create_claim.operation_id is null then null else jsonb_build_object(
      'request_id',v_create_claim.request_id,
      'request_digest',v_create_claim.request_digest,
      'operation_revision',v_create_claim.operation_revision) end,
    'latest_observation',case when v_latest_observation.id is null then null else jsonb_build_object(
      'observation_id',v_latest_observation.id,
      'request_id',v_latest_observation.request_id,
      'kind',v_latest_observation.observation_kind,
      'provider_uid',v_latest_observation.raw_provider_uid,
      'http_status',v_latest_observation.http_status,
      'signed_urls_reported',v_latest_observation.signed_urls_reported,
      'creator_marker_matched',v_latest_observation.creator_marker_matched,
      'metadata_marker_matched',v_latest_observation.metadata_marker_matched,
      'ready_to_stream_reported',v_latest_observation.ready_to_stream_reported,
      'evidence_digest',v_latest_observation.evidence_digest,
      'observed_at',v_latest_observation_at,
      'order_sequence',v_latest_observation_order) end,
    'latest_exact_uid_get',case when v_latest_exact_get.id is null then null else jsonb_build_object(
      'observation_id',v_latest_exact_get.id,
      'request_id',v_latest_exact_get.request_id,
      'provider_uid',v_latest_exact_get.raw_provider_uid,
      'http_status',v_latest_exact_get.http_status,
      'signed_urls_reported',v_latest_exact_get.signed_urls_reported,
      'creator_marker_matched',v_latest_exact_get.creator_marker_matched,
      'metadata_marker_matched',v_latest_exact_get.metadata_marker_matched,
      'ready_to_stream_reported',v_latest_exact_get.ready_to_stream_reported,
      'evidence_digest',v_latest_exact_get.evidence_digest,
      'observed_at',v_latest_exact_get_at,
      'order_sequence',v_latest_exact_get_order) end,
    'finalization_receipt',case when v_latest_receipt.operation_id is null then null else jsonb_build_object(
      'request_id',v_latest_receipt.request_id,
      'request_digest',v_latest_receipt.request_digest,
      'terminal_state',v_latest_receipt.terminal_state,
      'response',v_latest_receipt.response,
      'created_at',v_latest_receipt.created_at) end,
    'eligibility',jsonb_build_object(
      'actor_role',v_actor_role,
      'actor_role_eligible',v_actor_eligible,
      'actor_tombstoned',false,
      'owner_tombstoned',false,
      'account_verified_current',v_verification_current
    ),
    'profile_fence',case when v_profile_fence.source_kind is null then null else jsonb_build_object(
      'source_revision',v_profile_fence.source_revision,
      'fence_state',v_profile_fence.fence_state,
      'active_operation_id',v_profile_fence.active_operation_id,
      'state_revision',v_profile_fence.state_revision,
      'matches_active_operation',v_fence_current) end,
    'latest_readback_valid',v_latest_readback_valid,
    'latest_readback_identity_valid',v_latest_readback_identity_valid,
    'latest_readback_retryable',v_latest_readback_retryable,
    'provider_post_authorized',false
  );

  if v_completed and v_latest_readback_valid then
    return jsonb_build_object('outcome','completed','work',v_work);
  elsif v_latest_readback_retryable then
    return jsonb_build_object('outcome','recovery_required','work',v_work,
      'provider_post_authorized',false,'readback_retry_allowed',true);
  elsif v_completed then
    return jsonb_build_object('outcome','operation_inconsistent');
  elsif v_state.operation_state='reserved' then
    return jsonb_build_object('outcome','work_available','work',v_work,
      'create_claim_required',true);
  elsif v_state.operation_state='provisional_bound' and v_latest_readback_valid then
    return jsonb_build_object('outcome','work_available','work',v_work,
      'source_commit_available',true);
  else
    return jsonb_build_object('outcome','recovery_required','work',v_work,
      'provider_post_authorized',false);
  end if;
end;
$$;
revoke all on function public.get_stream_library_upload_work(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_stream_library_upload_work(uuid,uuid)
  to service_role;
