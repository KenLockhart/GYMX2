begin;
select no_plan();

-- Synthetic provider facts enter through the existing 300/310 producer RPCs.
-- Rollback-only verification expiry updates below simulate clock passage, not provider proof.
-- This suite creates no provider traffic and rolls all fixture rows back.
insert into auth.users(id,email,raw_user_meta_data) values
  ('d6150000-0000-0000-0000-000000000001','projection-owner@example.test','{"display_name":"Projection Owner"}'),
  ('d6150000-0000-0000-0000-000000000002','projection-other-coach@example.test','{"display_name":"Projection Other Coach"}'),
  ('d6150000-0000-0000-0000-000000000003','projection-tombstoned@example.test','{"display_name":"Projection Tombstoned Coach"}');
update public.profiles set role='coach'
where id in ('d6150000-0000-0000-0000-000000000001',
  'd6150000-0000-0000-0000-000000000002',
  'd6150000-0000-0000-0000-000000000003');

select ok(has_function_privilege('service_role',
    'public.get_stream_provider_account_projection(text,text)','execute')
  and has_function_privilege('service_role',
    'public.get_stream_library_upload_work(uuid,uuid)','execute')
  and not has_function_privilege('anon',
    'public.get_stream_provider_account_projection(text,text)','execute')
  and not has_function_privilege('authenticated',
    'public.get_stream_provider_account_projection(text,text)','execute')
  and not has_function_privilege('anon',
    'public.get_stream_library_upload_work(uuid,uuid)','execute')
  and not has_function_privilege('authenticated',
    'public.get_stream_library_upload_work(uuid,uuid)','execute'),
  'both narrow projections execute only for service_role');
select ok(not has_table_privilege('service_role','public.stream_media_upload_transport','select')
  and not has_table_privilege('authenticated','public.stream_media_upload_transport','select'),
  'the projections do not grant raw transport table access');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d6150000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$select public.get_stream_library_upload_work('d6152000-0000-0000-0000-000000000001','d6150000-0000-0000-0000-000000000001')$$,
  '42501',null,'an actor JWT cannot call the service work projection');
select throws_ok(
  $$select public.get_stream_provider_account_projection('vod_primary',repeat('a',32))$$,
  '42501',null,'an actor JWT cannot call the service registry projection');

set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.projection_registry',public.record_stream_provider_account_attestation(
  'd6151000-0000-0000-0000-000000000001',repeat('a',32),'vod_primary',repeat('1',64)
)->>'registry_id',true);
select is(public.get_stream_provider_account_projection('vod_secondary',repeat('b',32))->>'outcome',
  'slot_unregistered','a recognized but unregistered credential slot is reported explicitly');
select is(public.record_stream_provider_account_attestation(
  'd6151000-0000-0000-0000-000000000010',repeat('b',32),'vod_secondary',repeat('e',64)
)->>'outcome','recorded','the fixture registers a separate secondary account through the normal attestation RPC');
select set_config('test.projection_secondary_registry',public.get_stream_provider_account_projection(
  'vod_secondary',repeat('b',32)
)::text,true);
select is(current_setting('test.projection_secondary_registry')::jsonb->>'outcome','identity_found',
  'a registered secondary identity is available before verification');
select is(current_setting('test.projection_secondary_registry')::jsonb->>'verification_status','unverified',
  'a registered account with no verification event remains explicitly unverified');
select ok(current_setting('test.projection_secondary_registry')::jsonb->>'verified_until' is null
  and current_setting('test.projection_secondary_registry')::jsonb->>'verification_event_id' is null,
  'the unverified account projection invents no verification evidence');
select is(public.record_stream_account_path_verification(
  'd6151000-0000-0000-0000-000000000002',
  current_setting('test.projection_registry')::uuid,'vod_primary',repeat('a',32),
  200::smallint,repeat('2',64)
)->>'outcome','verified','the ordinary trusted verification producer establishes current account proof');

reset role;
select set_config('test.projection_registry_before',(
  select jsonb_build_object(
    'registry_count',(select count(*) from public.stream_provider_account_registry),
    'attestation_count',(select count(*) from public.stream_provider_account_attestations),
    'verification_event_count',(select count(*) from public.stream_provider_account_verification_events),
    'verification_state_count',(select count(*) from public.stream_provider_account_verification_state)
  )::text
),true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.projection_registry_current',
  public.get_stream_provider_account_projection('vod_primary',repeat('a',32))::text,true);
select is(current_setting('test.projection_registry_current')::jsonb->>'outcome','identity_found',
  'the fixed-slot registry lookup returns only its exact registered account identity');
select is(current_setting('test.projection_registry_current')::jsonb->>'credential_slot','vod_primary',
  'the registry DTO carries the fixed non-secret credential slot');
select is(current_setting('test.projection_registry_current')::jsonb->>'provider_account_id',repeat('a',32),
  'the registry DTO binds the exact expected provider account');
select is(current_setting('test.projection_registry_current')::jsonb->>'verification_status','verified_current',
  'the registry DTO exposes current persisted verification state');
select ok((current_setting('test.projection_registry_current')::jsonb->>'verified_until')::timestamptz
    > statement_timestamp(),
  'the current verification expiry is returned without refreshing it');
select is(public.get_stream_provider_account_projection('vod_primary',repeat('b',32))->>'outcome',
  'account_binding_mismatch','a fixed slot paired with a different account fails closed');
select is(public.get_stream_provider_account_projection('vod_tertiary',repeat('a',32))->>'outcome',
  'invalid_slot','an unrecognized credential slot fails closed');
reset role;
select set_config('test.projection_registry_after',(
  select jsonb_build_object(
    'registry_count',(select count(*) from public.stream_provider_account_registry),
    'attestation_count',(select count(*) from public.stream_provider_account_attestations),
    'verification_event_count',(select count(*) from public.stream_provider_account_verification_events),
    'verification_state_count',(select count(*) from public.stream_provider_account_verification_state)
  )::text
),true);
select is(current_setting('test.projection_registry_after')::jsonb,
  current_setting('test.projection_registry_before')::jsonb,
  'registry projections are read-only and create no registration or verification evidence');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d6150000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('test.library_projection_prepare',public.prepare_stream_library_video_upload(
  'd6152000-0000-0000-0000-000000000001','d6153000-0000-0000-0000-000000000001',
  'Synthetic adapter projection video','',repeat('3',64))::text,true);
select is(current_setting('test.library_projection_prepare')::jsonb->>'outcome','reserved',
  'the fixture enters through the normal authenticated Library prepare RPC');

set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.library_projection_reserved',public.get_stream_library_upload_work(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6150000-0000-0000-0000-000000000001'
)::text,true);
select is(current_setting('test.library_projection_reserved')::jsonb->>'outcome','work_available',
  'a current reserved Library intent is projected to the service adapter');
select is(current_setting('test.library_projection_reserved')::jsonb->'work'->>'operation_state','reserved',
  'the reserved DTO reports the durable operation state');
select is(current_setting('test.library_projection_reserved')::jsonb->'work'->>'actor_id',
  'd6150000-0000-0000-0000-000000000001','the operation actor is derived from its immutable operation row');
select is(current_setting('test.library_projection_reserved')::jsonb->'work'->'transport'->>'original_max_duration_seconds',
  '7200','the DTO preserves the existing two-hour Library upload limit');
select is(current_setting('test.library_projection_reserved')::jsonb->'work'->'transport'->>'original_require_signed_urls',
  'true','the DTO preserves the signed-URL requirement');
select ok(current_setting('test.library_projection_reserved')::jsonb->'work'->'transport'->'original_metadata'
    = jsonb_build_object('request_marker',
        current_setting('test.library_projection_prepare')::jsonb->'metadata'->>'request_marker',
      'source_kind','video','source_id','d6153000-0000-0000-0000-000000000001',
      'actor_id','d6150000-0000-0000-0000-000000000001'),
  'the DTO returns only the exact canonical immutable provider metadata');
select ok(not (current_setting('test.library_projection_reserved')::jsonb->'work'->'transport' ? 'tus_location')
  and current_setting('test.library_projection_reserved')::jsonb->'work'->'transport'->>'tus_location_present'='false'
  and current_setting('test.library_projection_reserved')::jsonb->'work'->'transport'->>'provider_uid' is null,
  'a prepared projection contains neither bearer URL nor unobserved provider UID');
select ok(current_setting('test.library_projection_reserved')::jsonb->>'create_claim_required'='true'
  and current_setting('test.library_projection_reserved')::jsonb->'work'->>'provider_post_authorized'='false'
  and current_setting('test.library_projection_reserved')::jsonb->'work'->'profile_fence'->>'matches_active_operation'='true',
  'the projection reports its live fence while leaving POST authority to the fresh claim RPC');
select is(public.get_stream_library_upload_work(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6150000-0000-0000-0000-000000000002'
)->>'outcome','unavailable','another coach cannot use the owner-bound projection to inspect this operation');

-- The community operation is a real producer operation but has the wrong source kind for this DTO.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d6150000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('test.community_projection_prepare',public.prepare_stream_community_video_submission(
  'd6152100-0000-0000-0000-000000000001','Synthetic processing post',repeat('4',64),
  'general','everyone',null
)::text,true);
select ok(
  current_setting('test.community_projection_prepare')::jsonb->>'outcome'='processing'
  and current_setting('test.community_projection_prepare')::jsonb->>'operation_state'='reserved'
  and nullif(current_setting('test.community_projection_prepare')::jsonb->>'operation_id','') is not null
  and nullif(current_setting('test.community_projection_prepare')::jsonb->>'submission_id','') is not null
  and nullif(current_setting('test.community_projection_prepare')::jsonb->>'post_id','') is not null
  and nullif(current_setting('test.community_projection_prepare')::jsonb->>'media_id','') is not null,
  'Community prepare returns a processing submission, reserved operation state, and required IDs before projection checks');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.get_stream_library_upload_work(
  (current_setting('test.community_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6150000-0000-0000-0000-000000000001'
)->>'outcome','unavailable','a Community post_media operation cannot be treated as Library video work');

reset role;
update public.profiles set role='member'
where id='d6150000-0000-0000-0000-000000000001';
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.get_stream_library_upload_work(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6150000-0000-0000-0000-000000000001'
)->>'outcome','not_eligible','a role change revokes the work projection');
reset role;
update public.profiles set role='coach'
where id='d6150000-0000-0000-0000-000000000001';

-- Rollback-only time travel: direct state change simulates expiry; the test rolls it back.
update public.stream_provider_account_verification_state
set verified_until=statement_timestamp()-interval '1 second'
where registry_id=current_setting('test.projection_registry')::uuid;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.library_projection_expired',public.get_stream_library_upload_work(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6150000-0000-0000-0000-000000000001'
)::text,true);
select is(current_setting('test.library_projection_expired')::jsonb->>'outcome','account_unverified',
  'expired account proof prevents any active provider work');
select set_config('test.projection_registry_expired',
  public.get_stream_provider_account_projection('vod_primary',repeat('a',32))::text,true);
select is(current_setting('test.projection_registry_expired')::jsonb->>'outcome','identity_found',
  'the account identity remains available after verification expiry');
select is(current_setting('test.projection_registry_expired')::jsonb->>'verification_status',
  'verification_expired','expired state is exposed rather than silently refreshed');
select ok((current_setting('test.projection_registry_expired')::jsonb->>'verified_until')::timestamptz
    < statement_timestamp(),
  'the expired timestamp is the persisted state value');
select is(public.record_stream_account_path_verification(
  'd6151000-0000-0000-0000-000000000003',
  current_setting('test.projection_registry')::uuid,'vod_primary',repeat('a',32),
  200::smallint,repeat('5',64)
)->>'outcome','verified','only a separate ordinary trusted verification call restores eligibility');
select is(public.get_stream_library_upload_work(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6150000-0000-0000-0000-000000000001'
)->>'outcome','work_available','active work becomes projectable only after persisted verification is current');

select is(public.claim_stream_media_create(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6152000-0000-0000-0000-000000000002',
  current_setting('test.library_projection_prepare')::jsonb->>'request_digest'
)->>'outcome','create_authorized','the fresh create claim remains the only POST authorization');
select set_config('test.library_projection_create_started',public.get_stream_library_upload_work(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6150000-0000-0000-0000-000000000001'
)::text,true);
select is(current_setting('test.library_projection_create_started')::jsonb->>'outcome','recovery_required',
  'a claimed create_started operation with no UID remains recovery-only');
select ok(current_setting('test.library_projection_create_started')::jsonb->'work'->'transport'->>'provider_uid' is null
  and current_setting('test.library_projection_create_started')::jsonb->'work'->>'operation_state'='create_started'
  and current_setting('test.library_projection_create_started')::jsonb->'work'->>'provider_post_authorized'='false',
  'create_started without a durable UID cannot create a second POST capability');
select is(public.advance_stream_media_upload(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6154000-0000-0000-0000-00000000000b','create_unknown',repeat('d',64)
)->>'outcome','advanced','the ordinary service transition records an unknown create response without a UID');
select set_config('test.library_projection_create_unknown',public.get_stream_library_upload_work(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6150000-0000-0000-0000-000000000001'
)::text,true);
select is(current_setting('test.library_projection_create_unknown')::jsonb->>'outcome','recovery_required',
  'create_unknown without a UID remains recovery-only');
select ok(current_setting('test.library_projection_create_unknown')::jsonb->'work'->'transport'->>'provider_uid' is null
  and current_setting('test.library_projection_create_unknown')::jsonb->'work'->>'operation_state'='create_unknown'
  and current_setting('test.library_projection_create_unknown')::jsonb->>'provider_post_authorized'='false',
  'create_unknown cannot authorize a retry or reconstruct transport identity');
select is(public.record_stream_media_upload_transport(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  (current_setting('test.library_projection_prepare')::jsonb->>'transport_request_id')::uuid,
  current_setting('test.library_projection_prepare')::jsonb->>'request_digest',
  'synthetic-library-projection-uid','https://upload.provider.invalid/tus/projection',
  (statement_timestamp()+interval '15 minutes')::timestamptz,7200,true,
  current_setting('test.library_projection_prepare')::jsonb->'metadata',repeat('6',64)
)->>'outcome','recorded','synthetic transport facts enter only through the normal service recording RPC');
select is(public.advance_stream_media_upload(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6154000-0000-0000-0000-000000000001','created_unverified',repeat('7',64)
)->>'outcome','advanced','the trusted state transition follows the one fresh create claim');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.projection_registry')::uuid,'create_reply','synthetic-library-projection-uid',
  201::smallint,false,false,false,false,'d6154000-0000-0000-0000-00000000000c',repeat('c',64)
)->>'outcome','recorded','the durable create reply is recorded as distinct from an exact UID GET');
select set_config('test.library_projection_create_reply',public.get_stream_library_upload_work(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6150000-0000-0000-0000-000000000001'
)::text,true);
select is(current_setting('test.library_projection_create_reply')::jsonb->>'outcome','recovery_required',
  'a durable create reply is recovery-only and cannot authorize a second POST');
select ok(current_setting('test.library_projection_create_reply')::jsonb->'work'->'transport'->>'provider_uid'
    = 'synthetic-library-projection-uid'
  and current_setting('test.library_projection_create_reply')::jsonb->'work'->'transport'->>'tus_location_present'='true'
  and not (current_setting('test.library_projection_create_reply')::jsonb->'work'->'transport' ? 'tus_location')
  and current_setting('test.library_projection_create_reply')::jsonb->>'provider_post_authorized'='false',
  'known transport identity is returned without exposing its TUS bearer capability');

select is(public.record_stream_media_upload_observation(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.projection_registry')::uuid,'exact_uid_get','synthetic-library-projection-uid',
  200::smallint,true,true,true,false,'d6154000-0000-0000-0000-000000000007',repeat('d',64)
)->>'outcome','recorded','a valid identity readback that is not ready is retained for recovery');
select set_config('test.library_projection_not_ready',public.get_stream_library_upload_work(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6150000-0000-0000-0000-000000000001'
)::text,true);
select is(current_setting('test.library_projection_not_ready')::jsonb->>'outcome','recovery_required',
  'an exact 200 readback with valid identity but ready=false requests readback recovery');
select ok(current_setting('test.library_projection_not_ready')::jsonb->'work'->'transport'->>'provider_uid'
      ='synthetic-library-projection-uid'
  and current_setting('test.library_projection_not_ready')::jsonb->'work'->>'latest_readback_identity_valid'='true'
  and current_setting('test.library_projection_not_ready')::jsonb->'work'->>'latest_readback_valid'='false'
  and current_setting('test.library_projection_not_ready')::jsonb->'work'->>'latest_readback_retryable'='true'
  and current_setting('test.library_projection_not_ready')::jsonb->>'provider_post_authorized'='false'
  and current_setting('test.library_projection_not_ready')::jsonb->>'source_commit_available' is null,
  'not-ready readback preserves the UID while withholding POST and source-commit authority');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.projection_registry')::uuid,'exact_uid_get','synthetic-library-projection-uid',
  503::smallint,null::boolean,null::boolean,null::boolean,null::boolean,
  'd6154000-0000-0000-0000-000000000008',repeat('e',64)
)->>'outcome','recorded','a transient exact-GET failure is retained as retryable evidence');
select set_config('test.library_projection_transient_get',public.get_stream_library_upload_work(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6150000-0000-0000-0000-000000000001'
)::text,true);
select is(current_setting('test.library_projection_transient_get')::jsonb->>'outcome','recovery_required',
  'a transient exact-GET failure permits only read-only recovery');
select ok(current_setting('test.library_projection_transient_get')::jsonb->'work'->'transport'->>'provider_uid'
      ='synthetic-library-projection-uid'
  and current_setting('test.library_projection_transient_get')::jsonb->'work'->'latest_exact_uid_get'->>'http_status'='503'
  and current_setting('test.library_projection_transient_get')::jsonb->'work'->>'latest_readback_retryable'='true'
  and current_setting('test.library_projection_transient_get')::jsonb->>'provider_post_authorized'='false',
  'transient GET recovery preserves the UID and cannot authorize another POST');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.projection_registry')::uuid,'exact_uid_get','synthetic-library-projection-uid',
  200::smallint,true,true,true,true,'d6154000-0000-0000-0000-000000000002',repeat('8',64)
)->>'outcome','recorded','the fixture adds a normal trusted exact UID and readiness observation');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.projection_registry')::uuid,'create_reply','synthetic-library-projection-uid',
  201::smallint,false,false,false,false,'d6154000-0000-0000-0000-000000000009',repeat('f',64)
)->>'outcome','recorded','a later create reply cannot replace the independently ordered latest exact GET');
select set_config('test.library_projection_latest_create_reply',public.get_stream_library_upload_work(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6150000-0000-0000-0000-000000000001'
)::text,true);
select is(current_setting('test.library_projection_latest_create_reply')::jsonb->'work'->'latest_observation'->>'kind',
  'create_reply','the DTO still reports the newest overall observation');
select is(current_setting('test.library_projection_latest_create_reply')::jsonb->'work'->'latest_exact_uid_get'->>'request_id',
  'd6154000-0000-0000-0000-000000000002','the exact GET projection remains independently selected');
select is(current_setting('test.library_projection_latest_create_reply')::jsonb->'work'->>'latest_readback_valid',
  'true','a later non-GET reply does not invalidate a ready exact readback');
select is(public.bind_stream_media_upload_readback(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6154000-0000-0000-0000-000000000002','d6154000-0000-0000-0000-000000000003'
)->>'outcome','provisional_bound','the canonical 310 producer creates the exact provisional binding');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.projection_registry')::uuid,'exact_uid_get','synthetic-library-projection-uid',
  503::smallint,null::boolean,null::boolean,null::boolean,null::boolean,
  'd6154000-0000-0000-0000-000000000010',repeat('3',64)
)->>'outcome','recorded','a later transient readback remains visible after provisional binding');
select set_config('test.library_projection_bound_transient',public.get_stream_library_upload_work(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6150000-0000-0000-0000-000000000001'
)::text,true);
select is(current_setting('test.library_projection_bound_transient')::jsonb->>'outcome','recovery_required',
  'a bound upload with a transient latest GET does not expose source-commit work');
select ok(current_setting('test.library_projection_bound_transient')::jsonb->'work'->'transport'->>'provider_uid'
      ='synthetic-library-projection-uid'
  and current_setting('test.library_projection_bound_transient')::jsonb->'work'->>'latest_readback_retryable'='true'
  and current_setting('test.library_projection_bound_transient')::jsonb->>'source_commit_available' is null
  and current_setting('test.library_projection_bound_transient')::jsonb->>'provider_post_authorized'='false',
  'a transient bound readback keeps recovery identity without POST or commit authority');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.projection_registry')::uuid,'exact_uid_get','synthetic-library-projection-uid',
  200::smallint,true,true,true,true,'d6154000-0000-0000-0000-000000000011',repeat('4',64)
)->>'outcome','recorded','a later ready exact readback restores only the readback prerequisite');
select set_config('test.library_projection_bound',public.get_stream_library_upload_work(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6150000-0000-0000-0000-000000000001'
)::text,true);
select is(current_setting('test.library_projection_bound')::jsonb->>'outcome','work_available',
  'provisional work requires a coherent exact ready readback and current operation fence');
select is(current_setting('test.library_projection_bound')::jsonb->'work'->'latest_exact_uid_get'->>'request_id',
  'd6154000-0000-0000-0000-000000000011','the projection reports the latest durable exact GET identity');
select is(current_setting('test.library_projection_bound')::jsonb->>'source_commit_available','true',
  'a bound ready result is distinct from create authorization and is available for the actor commit');
select ok(not (current_setting('test.library_projection_bound')::jsonb->'work'->'transport' ? 'tus_location')
  and current_setting('test.library_projection_bound')::jsonb->'work'->>'provider_post_authorized'='false',
  'bound work still carries no bearer URL and no POST authorization');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d6150000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.commit_stream_library_video_upload(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6154000-0000-0000-0000-000000000004'
)->>'outcome','ready_for_publication','the actor finalizes the operation through the atomic source commit');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d6150000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$insert into public.programs(id,coach_id,title,description,published,intro_video_id)
  values('d6158000-0000-0000-0000-000000000001','d6150000-0000-0000-0000-000000000001',
    'Projection shared intro','',true,'d6153000-0000-0000-0000-000000000001')$$,
  'the normal authenticated Program intro guard attaches another valid context to the Library asset');
reset role;
select ok(exists(select 1 from public.stream_media_source_bindings library_binding
    join public.stream_media_source_bindings intro_binding on intro_binding.asset_id=library_binding.asset_id
    join public.stream_media_source_binding_events intro_event on intro_event.binding_id=intro_binding.id
      and intro_event.event_kind='attached' and intro_event.source_revision=intro_binding.source_revision
      and intro_event.evidence_digest=intro_binding.evidence_digest
    where library_binding.source_kind='video'
      and library_binding.source_identity='d6153000-0000-0000-0000-000000000001'
      and intro_binding.source_kind='program_intro'
      and intro_binding.source_identity='d6158000-0000-0000-0000-000000000001'
      and intro_binding.raw_provider_uid='synthetic-library-projection-uid'),
  'the shared asset retains distinct exact Library and guarded Program intro bindings with their events');

-- Rollback-only time travel: direct state change simulates expiry; the test rolls it back.
update public.stream_provider_account_verification_state
set verified_until=statement_timestamp()-interval '1 second'
where registry_id=current_setting('test.projection_registry')::uuid;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.library_projection_completed_expired',public.get_stream_library_upload_work(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6150000-0000-0000-0000-000000000001'
)::text,true);
select is(current_setting('test.library_projection_completed_expired')::jsonb->>'outcome','completed',
  'a completed Library receipt remains projectable after account verification expires');
select is(current_setting('test.library_projection_completed_expired')::jsonb->'work'->'registry'->>'verification_status',
  'verification_expired','the completed receipt reports its expired proof without refreshing it');
select is(public.record_stream_account_path_verification(
  'd6151000-0000-0000-0000-000000000004',
  current_setting('test.projection_registry')::uuid,'vod_primary',repeat('a',32),
  200::smallint,repeat('9',64)
)->>'outcome','verified','a separate trusted verification producer restores only the current account proof');
select set_config('test.library_projection_completed',public.get_stream_library_upload_work(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6150000-0000-0000-0000-000000000001'
)::text,true);
select is(current_setting('test.library_projection_completed')::jsonb->>'outcome','completed',
  'a completed operation returns its immutable receipt rather than fresh provider work');
select is(current_setting('test.library_projection_completed')::jsonb->'work'->'finalization_receipt'->>'request_id',
  'd6154000-0000-0000-0000-000000000004','the completed DTO exposes the exact receipt request identity');
select ok(current_setting('test.library_projection_completed')::jsonb->'work'->'provider_post_authorized'='false'
  and not (current_setting('test.library_projection_completed')::jsonb->'work'->'transport' ? 'tus_location'),
  'a completed receipt never becomes another create or bearer capability');

-- A later same-owner preparation closes the profile fence at N+1; the N receipt must still replay.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d6150000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('test.library_projection_second',public.prepare_stream_library_video_upload(
  'd6152200-0000-0000-0000-000000000001','d6153000-0000-0000-0000-000000000002',
  'Synthetic next upload','',repeat('9',64))::text,true);
select is(current_setting('test.library_projection_second')::jsonb->>'outcome','reserved',
  'a second same-owner upload prepares successfully before its replay and cancel checks');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.library_projection_completed_after_advance',
  public.get_stream_library_upload_work(
    (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
    'd6150000-0000-0000-0000-000000000001'
  )::text,true);
select is(current_setting('test.library_projection_completed_after_advance')::jsonb->>'outcome',
  'completed','a completed receipt does not require its old closing fence after the profile advances');
select is(current_setting('test.library_projection_completed_after_advance')::jsonb->'work'->'profile_fence'->>'active_operation_id',
  current_setting('test.library_projection_second')::jsonb->>'operation_id',
  'the completed projection reports the newer profile operation without mistaking it for its own fence');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d6150000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.cancel_stream_media_upload_before_create(
  (current_setting('test.library_projection_second')::jsonb->>'operation_id')::uuid,
  'd6152200-0000-0000-0000-000000000002'
)->>'outcome','canceled_without_provider_create',
  'the unrelated active upload can be canceled through its canonical pre-create lane');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.get_stream_library_upload_work(
  (current_setting('test.library_projection_second')::jsonb->>'operation_id')::uuid,
  'd6150000-0000-0000-0000-000000000001'
)->>'outcome','canceled_or_cleanup_held',
  'a canceled upload cannot be revived by the work projection');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d6150000-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('test.library_projection_missing_location_prepare',public.prepare_stream_library_video_upload(
  'd6152100-0000-0000-0000-000000000002','d6153000-0000-0000-0000-000000000004',
  'Synthetic missing TUS location','',repeat('4',64))::text,true);
select is(current_setting('test.library_projection_missing_location_prepare')::jsonb->>'outcome','reserved',
  'the independent coach operation prepares before testing a UID-only provider response');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.claim_stream_media_create(
  (current_setting('test.library_projection_missing_location_prepare')::jsonb->>'operation_id')::uuid,
  'd6152100-0000-0000-0000-000000000003',
  current_setting('test.library_projection_missing_location_prepare')::jsonb->>'request_digest'
)->>'outcome','create_authorized','the distinct operation obtains its one fresh claim');
select is(public.record_stream_media_upload_transport(
  (current_setting('test.library_projection_missing_location_prepare')::jsonb->>'operation_id')::uuid,
  (current_setting('test.library_projection_missing_location_prepare')::jsonb->>'transport_request_id')::uuid,
  current_setting('test.library_projection_missing_location_prepare')::jsonb->>'request_digest',
  'synthetic-library-missing-location-uid',null::text,null::timestamptz,7200,true,
  current_setting('test.library_projection_missing_location_prepare')::jsonb->'metadata',repeat('6',64)
)->>'outcome','known_uid_location_missing','a trusted UID-only response is persisted without fabricating a TUS capability');
select is(public.advance_stream_media_upload(
  (current_setting('test.library_projection_missing_location_prepare')::jsonb->>'operation_id')::uuid,
  'd6154000-0000-0000-0000-00000000000d','created_unverified',repeat('7',64)
)->>'outcome','advanced','the normal state transition records a known UID with missing transport location');
select set_config('test.library_projection_missing_location',public.get_stream_library_upload_work(
  (current_setting('test.library_projection_missing_location_prepare')::jsonb->>'operation_id')::uuid,
  'd6150000-0000-0000-0000-000000000002'
)::text,true);
select is(current_setting('test.library_projection_missing_location')::jsonb->>'outcome','recovery_required',
  'known UID without a TUS Location remains recovery work');
select ok(current_setting('test.library_projection_missing_location')::jsonb->'work'->'transport'->>'provider_uid'
      ='synthetic-library-missing-location-uid'
  and current_setting('test.library_projection_missing_location')::jsonb->'work'->'transport'->>'tus_location_present'='false'
  and not (current_setting('test.library_projection_missing_location')::jsonb->'work'->'transport' ? 'tus_location')
  and current_setting('test.library_projection_missing_location')::jsonb->>'provider_post_authorized'='false',
  'UID-only recovery exposes neither a bearer URL nor another POST authorization');

select is(public.record_stream_media_upload_observation(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.projection_registry')::uuid,'exact_uid_get','synthetic-other-provider-uid',
  200::smallint,true,true,true,true,'d6154000-0000-0000-0000-00000000000e',repeat('1',64)
)->>'outcome','recorded','a trusted exact GET with a conflicting UID remains durable evidence');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.projection_registry')::uuid,'create_reply','synthetic-library-projection-uid',
  201::smallint,true,true,true,true,'d6154000-0000-0000-0000-00000000000f',repeat('2',64)
)->>'outcome','recorded','a later matching create reply cannot replace the exact-GET UID conflict');
select is(public.get_stream_library_upload_work(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6150000-0000-0000-0000-000000000001'
)->>'outcome','observation_conflict',
  'a conflicting exact-GET UID remains held after a later create reply');

select is(public.record_stream_media_upload_observation(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.projection_registry')::uuid,'exact_uid_get','synthetic-library-projection-uid',
  200::smallint,true,false,true,false,'d6154000-0000-0000-0000-000000000005',repeat('a',64)
)->>'outcome','recorded','a later contradictory exact GET remains trusted audit data');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.projection_registry')::uuid,'create_reply','synthetic-library-projection-uid',
  201::smallint,true,true,true,true,'d6154000-0000-0000-0000-00000000000a',repeat('b',64)
)->>'outcome','recorded','a later create reply cannot erase a contradictory exact UID GET');
select is(public.get_stream_library_upload_work(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6150000-0000-0000-0000-000000000001'
)->>'outcome','observation_conflict',
  'latest contradictory readback prevents any further provider work or UID projection');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.projection_registry')::uuid,'exact_uid_get','synthetic-library-projection-uid',
  200::smallint,false,true,true,true,'d6154000-0000-0000-0000-000000000012',repeat('3',64)
)->>'outcome','recorded','a signed-URL mismatch is preserved as a separate exact-readback conflict');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.projection_registry')::uuid,'create_reply','synthetic-library-projection-uid',
  201::smallint,true,true,true,true,'d6154000-0000-0000-0000-000000000013',repeat('4',64)
)->>'outcome','recorded','a later create reply cannot erase the signed-URL mismatch');
select is(public.get_stream_library_upload_work(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6150000-0000-0000-0000-000000000001'
)->>'outcome','observation_conflict','a signed-URL mismatch remains held after later non-GET evidence');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.projection_registry')::uuid,'exact_uid_get','synthetic-library-projection-uid',
  200::smallint,true,true,false,true,'d6154000-0000-0000-0000-000000000014',repeat('5',64)
)->>'outcome','recorded','a metadata-marker mismatch is preserved as a separate exact-readback conflict');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.projection_registry')::uuid,'create_reply','synthetic-library-projection-uid',
  201::smallint,true,true,true,true,'d6154000-0000-0000-0000-000000000015',repeat('6',64)
)->>'outcome','recorded','a later create reply cannot erase the metadata-marker mismatch');
select is(public.get_stream_library_upload_work(
  (current_setting('test.library_projection_prepare')::jsonb->>'operation_id')::uuid,
  'd6150000-0000-0000-0000-000000000001'
)->>'outcome','observation_conflict','a metadata-marker mismatch remains held after later non-GET evidence');

-- A normal service cleanup start creates the tombstone; no fixture writes manufacture one.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d6150000-0000-0000-0000-000000000003","role":"authenticated"}';
select set_config('test.library_projection_tombstone_prepare',public.prepare_stream_library_video_upload(
  'd6152300-0000-0000-0000-000000000001','d6153000-0000-0000-0000-000000000003',
  'Synthetic account cleanup upload','',repeat('b',64))::text,true);
select is(current_setting('test.library_projection_tombstone_prepare')::jsonb->>'outcome','reserved',
  'the tombstone fixture upload prepares normally before account cleanup starts');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.library_projection_tombstone_start',public.begin_stream_account_media_cleanup(
  'd6157000-0000-0000-0000-000000000001','d6150000-0000-0000-0000-000000000003',
  'd6157000-0000-0000-0000-000000000002',repeat('c',64),
  'd6157000-0000-0000-0000-000000000003',repeat('d',64)
)::text,true);
reset role;
select ok(exists(select 1 from public.stream_media_account_tombstones tombstone
  where tombstone.account_id='d6150000-0000-0000-0000-000000000003'),
  'the normal account cleanup RPC persisted the test tombstone');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.get_stream_library_upload_work(
  (current_setting('test.library_projection_tombstone_prepare')::jsonb->>'operation_id')::uuid,
  'd6150000-0000-0000-0000-000000000003'
)->>'outcome','account_deleting',
  'a current account tombstone blocks Library work projection');

reset role;
select * from finish();
rollback;
