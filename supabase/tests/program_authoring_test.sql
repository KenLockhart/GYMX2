begin;
select no_plan();

-- Local synthetic actors and evidence. Provider-shaped data is submitted only through the
-- ordinary 315 Library upload/readback RPCs; there is no provider HTTP call in this TAP.
insert into auth.users(id,email,raw_user_meta_data) values
  ('a6000000-0000-4000-8000-000000000001','author-coach@example.test','{"display_name":"Author Coach"}'),
  ('a6000000-0000-4000-8000-000000000002','author-member@example.test','{"display_name":"Author Member"}'),
  ('a6000000-0000-4000-8000-000000000003','author-outsider@example.test','{"display_name":"Author Outsider"}');
update public.profiles set role='coach'
where id='a6000000-0000-4000-8000-000000000001';
update public.profiles set role='member'
where id in ('a6000000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000003');
insert into public.coach_members(coach_id,member_id)
values('a6000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000002');
insert into public.platform_test_entitlements(member_id,tier,grant_reason,granted_by)
values('a6000000-0000-4000-8000-000000000002','regular','Synthetic Program authoring TAP',
  'a6000000-0000-4000-8000-000000000001');
insert into public.payout_accounts(coach_id,stripe_account_id,charges_enabled,payouts_enabled)
values('a6000000-0000-4000-8000-000000000001','acct_AuthoringFixture',true,false);

select ok(not has_table_privilege('anon','private.program_authoring_drafts','select')
  and not has_table_privilege('authenticated','private.program_authoring_drafts','select')
  and not has_table_privilege('service_role','private.program_authoring_drafts','select')
  and not has_table_privilege('service_role','private.program_authoring_draft_lessons','insert'),
  'draft and lesson tables have no direct API-role access');
select ok(not has_table_privilege('service_role','private.program_authoring_receipts','insert')
  and not has_table_privilege('authenticated','private.program_authoring_receipts','select'),
  'authoring receipts are writable only by the narrow security-definer procedures');
select ok(has_function_privilege('service_role','public.get_program_authoring_draft(uuid,uuid)','execute')
  and has_function_privilege('service_role',
    'public.save_program_authoring_draft(uuid,uuid,uuid,bigint,uuid,uuid,jsonb)','execute')
  and has_function_privilege('service_role',
    'public.publish_program_authoring_draft(uuid,uuid,uuid,bigint,uuid,uuid,uuid,integer,smallint)','execute')
  and not has_function_privilege('authenticated','public.publish_program_authoring_draft(uuid,uuid,uuid,bigint,uuid,uuid,uuid,integer,smallint)','execute'),
  'authoring RPCs execute only through the authenticated server service boundary');

set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.author_attestation',public.record_stream_provider_account_attestation(
  'a6010000-0000-4000-8000-000000000001','a6000000000000000000000000000001',
  'vod_primary',repeat('1',64))::text,true);
select set_config('test.author_registry',
  current_setting('test.author_attestation')::jsonb->>'registry_id',true);
select is(current_setting('test.author_attestation')::jsonb->>'outcome','recorded',
  'the synthetic provider account identity is recorded by the normal trusted-service attestation RPC');
select set_config('test.author_path_verification',public.record_stream_account_path_verification(
  'a6010000-0000-4000-8000-000000000002',current_setting('test.author_registry')::uuid,
  'vod_primary','a6000000000000000000000000000001',200::smallint,repeat('2',64)
  )::text,true);
reset role;
select ok(current_setting('test.author_path_verification')::jsonb->>'outcome'='verified'
  and current_setting('test.author_path_verification')::jsonb->>'event_id' is not null
  and current_setting('test.author_registry') is not null
  and exists (select 1 from public.stream_provider_account_registry registry
    where registry.id=current_setting('test.author_registry')::uuid
      and registry.credential_slot='vod_primary'
      and registry.provider_account_id='a6000000000000000000000000000001')
  and exists (select 1 from public.stream_provider_account_verification_state state
    where state.registry_id=current_setting('test.author_registry')::uuid
      and state.verification_event_id is not null and state.verified_until > now()),
  'the attested registry and fresh account-path verification are durable exact identities');
select ok(exists (select 1 from public.stream_provider_account_attestations attestation
  where attestation.id=(current_setting('test.author_attestation')::jsonb->>'attestation_id')::uuid
    and attestation.registry_id=current_setting('test.author_registry')::uuid
    and attestation.request_id='a6010000-0000-4000-8000-000000000001'
    and attestation.evidence_digest=repeat('1',64))
  and exists (select 1 from public.stream_provider_account_verification_events event
    where event.id=(current_setting('test.author_path_verification')::jsonb->>'event_id')::uuid
      and event.request_id='a6010000-0000-4000-8000-000000000002'
      and event.registry_id=current_setting('test.author_registry')::uuid
      and event.http_status=200 and event.evidence_digest=repeat('2',64)),
  'owner evidence ties the exact attestation and path-read event to their request IDs and digests');

-- First real synthetic Library asset is the coach-owned intro. Keep its complete upload chain
-- in the fixture; no status, UID, binding, asset, event or verification row is fabricated.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"a6000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.author_intro_prepare',public.prepare_stream_library_video_upload(
  'a6010000-0000-4000-8000-000000000003','a6020000-0000-4000-8000-000000000001',
  'Synthetic authoring intro','',repeat('3',64))::text,true);
select ok(current_setting('test.author_intro_prepare')::jsonb->>'outcome'='reserved'
  and current_setting('test.author_intro_prepare')::jsonb->>'operation_id' is not null
  and current_setting('test.author_intro_prepare')::jsonb->>'request_digest' ~ '^[0-9a-f]{64}$'
  and current_setting('test.author_intro_prepare')::jsonb->>'transport_request_id' is not null,
  'intro prepare returns the exact operation, request digest, and transport identity');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.author_intro_claim',public.claim_stream_media_create(
  (current_setting('test.author_intro_prepare')::jsonb->>'operation_id')::uuid,
  'a6010000-0000-4000-8000-000000000004',
  current_setting('test.author_intro_prepare')::jsonb->>'request_digest'
  )::text,true);
select ok(current_setting('test.author_intro_claim')::jsonb->>'outcome'='create_authorized'
  and current_setting('test.author_intro_claim')::jsonb->>'operation_id'
    =current_setting('test.author_intro_prepare')::jsonb->>'operation_id'
  and (current_setting('test.author_intro_claim')::jsonb->>'operation_revision')::bigint>0,
  'intro upload obtains the normal one-time create claim with its operation revision');
select set_config('test.author_intro_transport',public.record_stream_media_upload_transport(
  (current_setting('test.author_intro_prepare')::jsonb->>'operation_id')::uuid,
  (current_setting('test.author_intro_prepare')::jsonb->>'transport_request_id')::uuid,
  current_setting('test.author_intro_prepare')::jsonb->>'request_digest',
  'synthetic-author-intro-uid','https://upload.provider.invalid/tus/author-intro',
  (now()+interval '15 minutes')::timestamptz,7200,true,
  current_setting('test.author_intro_prepare')::jsonb->'metadata',repeat('4',64)
  )::text,true);
select ok(current_setting('test.author_intro_transport')::jsonb->>'outcome'='recorded'
  and current_setting('test.author_intro_transport')::jsonb->>'operation_id'
    =current_setting('test.author_intro_prepare')::jsonb->>'operation_id',
  'intro transport facts use the original request and server metadata');
select set_config('test.author_intro_advance',public.advance_stream_media_upload(
  (current_setting('test.author_intro_prepare')::jsonb->>'operation_id')::uuid,
  'a6010000-0000-4000-8000-000000000005','created_unverified',repeat('5',64)
  )::text,true);
select ok(current_setting('test.author_intro_advance')::jsonb->>'outcome'='advanced'
  and current_setting('test.author_intro_advance')::jsonb->>'state'='created_unverified'
  and (current_setting('test.author_intro_advance')::jsonb->>'revision')::bigint>0,
  'intro upload records the unverified create reply and exact next revision');
select set_config('test.author_intro_observation',public.record_stream_media_upload_observation(
  (current_setting('test.author_intro_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.author_registry')::uuid,'exact_uid_get','synthetic-author-intro-uid',
  200::smallint,true,true,true,true,'a6010000-0000-4000-8000-000000000006',repeat('6',64)
  )::text,true);
select ok(current_setting('test.author_intro_observation')::jsonb->>'outcome'='recorded'
  ,'intro exact-UID synthetic readback records every required positive fact');
select set_config('test.author_intro_binding',public.bind_stream_media_upload_readback(
  (current_setting('test.author_intro_prepare')::jsonb->>'operation_id')::uuid,
  'a6010000-0000-4000-8000-000000000006','a6010000-0000-4000-8000-000000000007'
  )::text,true);
select ok(current_setting('test.author_intro_binding')::jsonb->>'outcome'='provisional_bound'
  and current_setting('test.author_intro_binding')::jsonb->>'binding_id' is not null
  and current_setting('test.author_intro_binding')::jsonb->>'asset_id' is not null,
  'intro readback has exact non-null asset and provisional binding identities');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"a6000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.author_intro_commit',public.commit_stream_library_video_upload(
  (current_setting('test.author_intro_prepare')::jsonb->>'operation_id')::uuid,
  'a6010000-0000-4000-8000-000000000008'
  )::text,true);
select ok(current_setting('test.author_intro_commit')::jsonb->>'outcome'='ready_for_publication'
  and current_setting('test.author_intro_commit')::jsonb->>'video_id'='a6020000-0000-4000-8000-000000000001'
  and (current_setting('test.author_intro_commit')::jsonb->>'source_revision')::bigint>0,
  'the intro is an ordinary committed Library video with its returned source revision');
reset role;
select ok(exists (
    select 1 from public.stream_media_operations operation
    join public.stream_media_operation_states state on state.operation_id=operation.id
    join public.stream_media_upload_transport transport on transport.operation_id=operation.id
    join public.stream_media_assets asset on asset.upload_intent_id=operation.intent_id
    join public.stream_media_source_bindings binding on binding.asset_id=asset.id
    join public.stream_media_upload_observations observation on observation.operation_id=operation.id
    join public.stream_media_finalization_receipts receipt on receipt.operation_id=operation.id
    where operation.id=(current_setting('test.author_intro_prepare')::jsonb->>'operation_id')::uuid
      and operation.operation_kind='upload' and operation.source_kind='video'
      and operation.source_identity='a6020000-0000-4000-8000-000000000001'
      and operation.actor_id='a6000000-0000-4000-8000-000000000001'
      and operation.owner_id='a6000000-0000-4000-8000-000000000001'
      and state.operation_state='completed'
      and transport.registry_id=current_setting('test.author_registry')::uuid
      and transport.provider_uid='synthetic-author-intro-uid'
      and asset.raw_provider_uid='synthetic-author-intro-uid'
      and asset.lifecycle_state='ready_for_publication'
      and binding.source_kind='video' and binding.source_identity='a6020000-0000-4000-8000-000000000001'
      and binding.owner_id='a6000000-0000-4000-8000-000000000001'
      and binding.binding_state='ready_for_publication'
      and observation.observation_kind='exact_uid_get'
      and observation.raw_provider_uid='synthetic-author-intro-uid'
      and observation.http_status=200 and observation.signed_urls_reported
      and observation.creator_marker_matched and observation.metadata_marker_matched
      and observation.ready_to_stream_reported
      and receipt.request_id='a6010000-0000-4000-8000-000000000008'
      and receipt.terminal_state='completed'
      and receipt.response->>'video_id'='a6020000-0000-4000-8000-000000000001'
  ), 'the exact intro operation has completed, matching transport/readback, ready binding, and commit receipt');

-- Existing free path and its ordinary completion must survive the paid conversion.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"a6000000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into public.programs(id,coach_id,title,description,published,intro_video_id)
values('a6030000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001',
  'Authoring Free-to-Paid','',false,'a6020000-0000-4000-8000-000000000001');
select set_config('test.author_day_one',public.save_owned_program_day(
  'a6030000-0000-4000-8000-000000000001',null,1::smallint,'Free day one','Legacy instruction','body',null
)::text,true);
select set_config('test.author_day_four',public.save_owned_program_day(
  'a6030000-0000-4000-8000-000000000001',null,4::smallint,'Free day four','Later free instruction','mind',null
)::text,true);
reset role;
update public.programs set published=true where id='a6030000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"a6000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((public.start_my_program_enrollment('a6030000-0000-4000-8000-000000000001')->>'existing')::boolean,
  false,'the linked Regular member starts the unchanged published free Program path');
select is((public.set_my_program_lesson_state(
  'a6030000-0000-4000-8000-000000000001',current_setting('test.author_day_one')::uuid,true,
  'a6040000-0000-4000-8000-000000000001')->>'accepted')::boolean,
  true,'the grandfathered member creates a real immutable legacy completion before conversion');
reset role;

-- Second synthetic asset is the future paid lesson, again via all normal 315 RPCs.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"a6000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.author_lesson_prepare',public.prepare_stream_library_video_upload(
  'a6050000-0000-4000-8000-000000000001','a6020000-0000-4000-8000-000000000002',
  'Synthetic paid lesson','',repeat('7',64))::text,true);
select ok(current_setting('test.author_lesson_prepare')::jsonb->>'outcome'='reserved'
  and current_setting('test.author_lesson_prepare')::jsonb->>'operation_id' is not null
  and current_setting('test.author_lesson_prepare')::jsonb->>'request_digest' ~ '^[0-9a-f]{64}$'
  and current_setting('test.author_lesson_prepare')::jsonb->>'transport_request_id' is not null,
  'paid lesson prepare returns its exact operation, digest, and transport identities');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.author_lesson_claim',public.claim_stream_media_create(
  (current_setting('test.author_lesson_prepare')::jsonb->>'operation_id')::uuid,
  'a6050000-0000-4000-8000-000000000002',
  current_setting('test.author_lesson_prepare')::jsonb->>'request_digest'
  )::text,true);
select ok(current_setting('test.author_lesson_claim')::jsonb->>'outcome'='create_authorized'
  and current_setting('test.author_lesson_claim')::jsonb->>'operation_id'
    =current_setting('test.author_lesson_prepare')::jsonb->>'operation_id'
  and (current_setting('test.author_lesson_claim')::jsonb->>'operation_revision')::bigint>0,
  'paid lesson upload uses the real service create-claim boundary and revision');
select set_config('test.author_lesson_transport',public.record_stream_media_upload_transport(
  (current_setting('test.author_lesson_prepare')::jsonb->>'operation_id')::uuid,
  (current_setting('test.author_lesson_prepare')::jsonb->>'transport_request_id')::uuid,
  current_setting('test.author_lesson_prepare')::jsonb->>'request_digest',
  'synthetic-author-paid-uid','https://upload.provider.invalid/tus/author-paid',
  (now()+interval '15 minutes')::timestamptz,7200,true,
  current_setting('test.author_lesson_prepare')::jsonb->'metadata',repeat('8',64)
  )::text,true);
select ok(current_setting('test.author_lesson_transport')::jsonb->>'outcome'='recorded'
  and current_setting('test.author_lesson_transport')::jsonb->>'operation_id'
    =current_setting('test.author_lesson_prepare')::jsonb->>'operation_id',
  'paid lesson transport is tied to its unchanged prepared request');
select set_config('test.author_lesson_advance',public.advance_stream_media_upload(
  (current_setting('test.author_lesson_prepare')::jsonb->>'operation_id')::uuid,
  'a6050000-0000-4000-8000-000000000003','created_unverified',repeat('9',64)
  )::text,true);
select ok(current_setting('test.author_lesson_advance')::jsonb->>'outcome'='advanced'
  and current_setting('test.author_lesson_advance')::jsonb->>'state'='created_unverified'
  and (current_setting('test.author_lesson_advance')::jsonb->>'revision')::bigint>0,
  'paid lesson upload records its unverified create response and revision');
select set_config('test.author_lesson_observation',public.record_stream_media_upload_observation(
  (current_setting('test.author_lesson_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.author_registry')::uuid,'exact_uid_get','synthetic-author-paid-uid',
  200::smallint,true,true,true,true,'a6050000-0000-4000-8000-000000000004',repeat('a',64)
  )::text,true);
select ok(current_setting('test.author_lesson_observation')::jsonb->>'outcome'='recorded',
  'paid lesson exact readback records marker, creator, signatures, and readiness');
select set_config('test.author_lesson_binding',public.bind_stream_media_upload_readback(
  (current_setting('test.author_lesson_prepare')::jsonb->>'operation_id')::uuid,
  'a6050000-0000-4000-8000-000000000004','a6050000-0000-4000-8000-000000000005'
  )::text,true);
select ok(current_setting('test.author_lesson_binding')::jsonb->>'outcome'='provisional_bound'
  and current_setting('test.author_lesson_binding')::jsonb->>'asset_id' is not null
  and current_setting('test.author_lesson_binding')::jsonb->>'binding_id' is not null,
  'paid lesson readback records exact non-null asset and binding identities');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"a6000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.author_lesson_commit',public.commit_stream_library_video_upload(
  (current_setting('test.author_lesson_prepare')::jsonb->>'operation_id')::uuid,
  'a6050000-0000-4000-8000-000000000006'
  )::text,true);
select ok(current_setting('test.author_lesson_commit')::jsonb->>'outcome'='ready_for_publication'
  and current_setting('test.author_lesson_commit')::jsonb->>'video_id'='a6020000-0000-4000-8000-000000000002'
  and (current_setting('test.author_lesson_commit')::jsonb->>'source_revision')::bigint>0,
  'the paid lesson is a normal ready Library video before publication');
reset role;
select ok(exists (
    select 1 from public.stream_media_operations operation
    join public.stream_media_operation_states state on state.operation_id=operation.id
    join public.stream_media_upload_transport transport on transport.operation_id=operation.id
    join public.stream_media_assets asset on asset.upload_intent_id=operation.intent_id
    join public.stream_media_source_bindings binding on binding.asset_id=asset.id
    join public.stream_media_upload_observations observation on observation.operation_id=operation.id
    join public.stream_media_finalization_receipts receipt on receipt.operation_id=operation.id
    where operation.id=(current_setting('test.author_lesson_prepare')::jsonb->>'operation_id')::uuid
      and operation.operation_kind='upload' and operation.source_kind='video'
      and operation.source_identity='a6020000-0000-4000-8000-000000000002'
      and operation.actor_id='a6000000-0000-4000-8000-000000000001'
      and operation.owner_id='a6000000-0000-4000-8000-000000000001'
      and state.operation_state='completed'
      and transport.registry_id=current_setting('test.author_registry')::uuid
      and transport.provider_uid='synthetic-author-paid-uid'
      and asset.raw_provider_uid='synthetic-author-paid-uid'
      and asset.lifecycle_state='ready_for_publication'
      and binding.source_kind='video' and binding.source_identity='a6020000-0000-4000-8000-000000000002'
      and binding.owner_id='a6000000-0000-4000-8000-000000000001'
      and binding.binding_state='ready_for_publication'
      and observation.observation_kind='exact_uid_get'
      and observation.raw_provider_uid='synthetic-author-paid-uid'
      and observation.http_status=200 and observation.signed_urls_reported
      and observation.creator_marker_matched and observation.metadata_marker_matched
      and observation.ready_to_stream_reported
      and receipt.request_id='a6050000-0000-4000-8000-000000000006'
      and receipt.terminal_state='completed'
      and receipt.response->>'video_id'='a6020000-0000-4000-8000-000000000002'
  ), 'the exact paid lesson upload has a complete canonical 315 durable identity chain');

-- Third source is for the atomic rollback and Daily-content exclusivity checks. It is also
-- prepared, observed, bound, and committed only through the ordinary authenticated/service RPCs.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"a6000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.author_daily_prepare',public.prepare_stream_library_video_upload(
  'a6070000-0000-4000-8000-000000000001','a6020000-0000-4000-8000-000000000003',
  'Synthetic Daily-content candidate','',repeat('b',64))::text,true);
select ok(current_setting('test.author_daily_prepare')::jsonb->>'outcome'='reserved'
  and current_setting('test.author_daily_prepare')::jsonb->>'operation_id' is not null
  and current_setting('test.author_daily_prepare')::jsonb->>'request_digest' ~ '^[0-9a-f]{64}$'
  and current_setting('test.author_daily_prepare')::jsonb->>'transport_request_id' is not null,
  'Daily candidate prepare returns a complete immutable upload identity');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.author_daily_claim',public.claim_stream_media_create(
  (current_setting('test.author_daily_prepare')::jsonb->>'operation_id')::uuid,
  'a6070000-0000-4000-8000-000000000002',
  current_setting('test.author_daily_prepare')::jsonb->>'request_digest')::text,true);
select ok(current_setting('test.author_daily_claim')::jsonb->>'outcome'='create_authorized'
  and current_setting('test.author_daily_claim')::jsonb->>'operation_id'
    =current_setting('test.author_daily_prepare')::jsonb->>'operation_id'
  and (current_setting('test.author_daily_claim')::jsonb->>'operation_revision')::bigint>0,
  'Daily candidate receives the exact service create claim');
select set_config('test.author_daily_transport',public.record_stream_media_upload_transport(
  (current_setting('test.author_daily_prepare')::jsonb->>'operation_id')::uuid,
  (current_setting('test.author_daily_prepare')::jsonb->>'transport_request_id')::uuid,
  current_setting('test.author_daily_prepare')::jsonb->>'request_digest',
  'synthetic-author-daily-uid','https://upload.provider.invalid/tus/author-daily',
  (now()+interval '15 minutes')::timestamptz,7200,true,
  current_setting('test.author_daily_prepare')::jsonb->'metadata',repeat('c',64))::text,true);
select ok(current_setting('test.author_daily_transport')::jsonb->>'outcome'='recorded'
  and current_setting('test.author_daily_transport')::jsonb->>'operation_id'
    =current_setting('test.author_daily_prepare')::jsonb->>'operation_id',
  'Daily candidate transport preserves the prepared request identity');
select set_config('test.author_daily_advance',public.advance_stream_media_upload(
  (current_setting('test.author_daily_prepare')::jsonb->>'operation_id')::uuid,
  'a6070000-0000-4000-8000-000000000003','created_unverified',repeat('d',64))::text,true);
select ok(current_setting('test.author_daily_advance')::jsonb->>'outcome'='advanced'
  and current_setting('test.author_daily_advance')::jsonb->>'state'='created_unverified'
  and (current_setting('test.author_daily_advance')::jsonb->>'revision')::bigint>0,
  'Daily candidate records the exact unverified provider-create transition');
select set_config('test.author_daily_observation',public.record_stream_media_upload_observation(
  (current_setting('test.author_daily_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.author_registry')::uuid,'exact_uid_get','synthetic-author-daily-uid',
  200::smallint,true,true,true,true,'a6070000-0000-4000-8000-000000000004',repeat('e',64))::text,true);
select is(current_setting('test.author_daily_observation')::jsonb->>'outcome','recorded',
  'Daily candidate exact-UID readback records the five positive readback facts');
select set_config('test.author_daily_binding',public.bind_stream_media_upload_readback(
  (current_setting('test.author_daily_prepare')::jsonb->>'operation_id')::uuid,
  'a6070000-0000-4000-8000-000000000004','a6070000-0000-4000-8000-000000000005')::text,true);
select ok(current_setting('test.author_daily_binding')::jsonb->>'outcome'='provisional_bound'
  and current_setting('test.author_daily_binding')::jsonb->>'asset_id' is not null
  and current_setting('test.author_daily_binding')::jsonb->>'binding_id' is not null,
  'Daily candidate obtains its exact provisional asset and source binding');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"a6000000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.author_daily_commit',public.commit_stream_library_video_upload(
  (current_setting('test.author_daily_prepare')::jsonb->>'operation_id')::uuid,
  'a6070000-0000-4000-8000-000000000006')::text,true);
select ok(current_setting('test.author_daily_commit')::jsonb->>'outcome'='ready_for_publication'
  and current_setting('test.author_daily_commit')::jsonb->>'video_id'='a6020000-0000-4000-8000-000000000003'
  and (current_setting('test.author_daily_commit')::jsonb->>'source_revision')::bigint>0,
  'Daily candidate is committed as an ordinary ready Library source');
reset role;
select ok(exists (
    select 1 from public.stream_media_operations operation
    join public.stream_media_operation_states state on state.operation_id=operation.id
    join public.stream_media_upload_transport transport on transport.operation_id=operation.id
    join public.stream_media_assets asset on asset.upload_intent_id=operation.intent_id
    join public.stream_media_source_bindings binding on binding.asset_id=asset.id
    join public.stream_media_upload_observations observation on observation.operation_id=operation.id
    join public.stream_media_finalization_receipts receipt on receipt.operation_id=operation.id
    where operation.id=(current_setting('test.author_daily_prepare')::jsonb->>'operation_id')::uuid
      and operation.source_identity='a6020000-0000-4000-8000-000000000003'
      and operation.owner_id='a6000000-0000-4000-8000-000000000001'
      and state.operation_state='completed'
      and transport.provider_uid='synthetic-author-daily-uid'
      and asset.lifecycle_state='ready_for_publication'
      and binding.binding_state='ready_for_publication'
      and binding.source_identity='a6020000-0000-4000-8000-000000000003'
      and observation.observation_kind='exact_uid_get'
      and observation.raw_provider_uid='synthetic-author-daily-uid'
      and observation.http_status=200 and observation.signed_urls_reported
      and observation.creator_marker_matched and observation.metadata_marker_matched
      and observation.ready_to_stream_reported
      and receipt.request_id='a6070000-0000-4000-8000-000000000006'
      and receipt.terminal_state='completed'
  ), 'Daily candidate is supported by the exact completed 315 operation and ready binding');

-- A failure after the 200 snapshot must roll the entire conversion back. This test-only trigger
-- fails only for this Program's paid offer insert, after the normal snapshot and lesson/binding
-- writes have been attempted. The surrounding TAP transaction will roll the trigger back too.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"a6000000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into public.programs(id,coach_id,title,description,published,intro_video_id)
values('a6030000-0000-4000-8000-000000000004','a6000000-0000-4000-8000-000000000001',
  'Atomic Snapshot Rollback','',false,'a6020000-0000-4000-8000-000000000001');
select set_config('test.author_rollback_day',public.save_owned_program_day(
  'a6030000-0000-4000-8000-000000000004',null,1::smallint,
  'Rollback legacy day','Must stay on legacy path','body',null
)::text,true);
reset role;
update public.programs set published=true where id='a6030000-0000-4000-8000-000000000004';
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"a6000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((public.start_my_program_enrollment('a6030000-0000-4000-8000-000000000004')->>'existing')::boolean,
  false,'the rollback fixture creates a real legacy free enrollment before conversion');
select is((public.set_my_program_lesson_state(
  'a6030000-0000-4000-8000-000000000004',
  current_setting('test.author_rollback_day')::uuid,true,
  'a6040000-0000-4000-8000-000000000004')->>'accepted')::boolean,
  true,'the rollback fixture creates a genuine completion before 200 snapshots it');
reset role;
select set_config('test.author_rollback_state_before',(
  select state.current_content_version_id::text||':'||state.current_offer_version_id::text
  from public.program_commerce_state state
  where state.program_id='a6030000-0000-4000-8000-000000000004'
),true);
select set_config('test.author_rollback_program_binding_count',(
  select count(*)::text from public.stream_media_source_bindings binding
  where binding.parent_kind='program'
    and binding.parent_identity='a6030000-0000-4000-8000-000000000004'
),true);
select set_config('test.author_rollback_version_counts',(
  select (select count(*)::text from public.program_content_versions version
      where version.program_id='a6030000-0000-4000-8000-000000000004')||':'||
    (select count(*)::text from public.program_content_version_lessons lesson
      where lesson.program_id='a6030000-0000-4000-8000-000000000004')||':'||
    (select count(*)::text from public.program_offer_versions offer
      where offer.program_id='a6030000-0000-4000-8000-000000000004')||':'||
    (select count(*)::text from public.program_lesson_progress_events event
      where event.program_id='a6030000-0000-4000-8000-000000000004')||':'||
    (select count(*)::text from public.program_day_completions completion
      join public.program_enrollments enrollment on enrollment.id=completion.enrollment_id
      where enrollment.program_id='a6030000-0000-4000-8000-000000000004')
),true);
select set_config('test.author_rollback_enrollment_pin',coalesce((
  select enrollment.content_version_id::text
  from public.program_enrollments enrollment
  where enrollment.program_id='a6030000-0000-4000-8000-000000000004'
    and enrollment.member_id='a6000000-0000-4000-8000-000000000002'
),'<null>'),true);
create function public.program_authoring_test_fail_paid_offer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.program_id='a6030000-0000-4000-8000-000000000004'
    and new.offer_kind='paid' then
    raise exception 'synthetic post-snapshot fault' using errcode='P0001';
  end if;
  return new;
end;
$$;
create trigger zz_program_authoring_test_fail_paid_offer
before insert on public.program_offer_versions
for each row execute function public.program_authoring_test_fail_paid_offer();
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.author_rollback_snapshot',public.get_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000004','a6000000-0000-4000-8000-000000000001')::text,true);
select set_config('test.author_rollback_draft',public.save_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000004','a6000000-0000-4000-8000-000000000001',null,0,
  (current_setting('test.author_rollback_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_rollback_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  '[{"lesson_ordinal":1,"timeline_day_number":1,"title":"Rollback paid lesson","instructions":"Must not publish","pillar":"body","video_id":"a6020000-0000-4000-8000-000000000003"}]'::jsonb
)::text,true);
select throws_ok($$select public.publish_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000004','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_rollback_draft')::jsonb->>'draft_id')::uuid,
  (current_setting('test.author_rollback_draft')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.author_rollback_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_rollback_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  'a6060000-0000-4000-8000-000000000010',1500,1::smallint)$$,
  'P0001','synthetic post-snapshot fault',
  'the forced failure occurs only after the free snapshot and paid lesson writes');
reset role;
drop trigger zz_program_authoring_test_fail_paid_offer on public.program_offer_versions;
drop function public.program_authoring_test_fail_paid_offer();
select is((select state.current_content_version_id::text||':'||state.current_offer_version_id::text
  from public.program_commerce_state state
  where state.program_id='a6030000-0000-4000-8000-000000000004'),
  current_setting('test.author_rollback_state_before'),
  'a post-snapshot error preserves both current commerce pointers');
select is((select (select count(*)::text from public.program_content_versions version
      where version.program_id='a6030000-0000-4000-8000-000000000004')||':'||
    (select count(*)::text from public.program_content_version_lessons lesson
      where lesson.program_id='a6030000-0000-4000-8000-000000000004')||':'||
    (select count(*)::text from public.program_offer_versions offer
      where offer.program_id='a6030000-0000-4000-8000-000000000004')||':'||
    (select count(*)::text from public.program_lesson_progress_events event
      where event.program_id='a6030000-0000-4000-8000-000000000004')||':'||
    (select count(*)::text from public.program_day_completions completion
      join public.program_enrollments enrollment on enrollment.id=completion.enrollment_id
      where enrollment.program_id='a6030000-0000-4000-8000-000000000004')),
  current_setting('test.author_rollback_version_counts'),
  'the failure leaves versions, lesson maps, offers, progress events, and legacy completions unchanged');
select is(coalesce((select enrollment.content_version_id::text
  from public.program_enrollments enrollment
  where enrollment.program_id='a6030000-0000-4000-8000-000000000004'
    and enrollment.member_id='a6000000-0000-4000-8000-000000000002'),'<null>'),
  current_setting('test.author_rollback_enrollment_pin'),
  'the free enrollment remains unpinned to a snapshot after conversion rollback');
select is((select count(*)::integer from public.program_versioning_fences fence
  where fence.program_id='a6030000-0000-4000-8000-000000000004'),0,
  'the failed snapshot leaves no active 200 versioning fence');
select is((select count(*)::integer from private.program_authoring_receipts receipt
  where receipt.program_id='a6030000-0000-4000-8000-000000000004'),0,
  'the failed publication leaves no authoring receipt');
select is((select visibility from public.videos
  where id='a6020000-0000-4000-8000-000000000003'),'private',
  'the failed transaction restores candidate visibility to private');
select is((select count(*)::text from public.stream_media_source_bindings binding
  where binding.parent_kind='program'
    and binding.parent_identity='a6030000-0000-4000-8000-000000000004'),
  current_setting('test.author_rollback_program_binding_count'),
  'the failed transaction creates no parent-bound media edge, even if lesson rows were rolled back');
select ok(exists (select 1 from public.videos video
    where video.id='a6020000-0000-4000-8000-000000000003'
      and video.status::text='ready' and video.visibility='private'
      and video.cloudflare_uid='synthetic-author-daily-uid')
  and exists (select 1 from public.stream_media_assets asset
    where asset.registry_id=current_setting('test.author_registry')::uuid
      and asset.raw_provider_uid='synthetic-author-daily-uid'
      and asset.lifecycle_state='ready_for_publication'
      and asset.signed_urls_verified and asset.ready_to_stream_verified)
  and exists (select 1 from public.stream_media_source_bindings binding
    where binding.source_kind='video'
      and binding.source_identity='a6020000-0000-4000-8000-000000000003'
      and binding.raw_provider_uid='synthetic-author-daily-uid'
      and binding.binding_state='ready_for_publication'),
  'snapshot rollback preserves the candidate video and its canonical 315 ready source binding');
select is((select published from public.programs
  where id='a6030000-0000-4000-8000-000000000004'),true,
  'the already-published free parent flag remains unchanged after failed conversion');

-- A legitimate Daily Content revision and slot cannot be stolen by Program publication, even
-- before any member has received a video grant. The fixture uses the same ordinary 315-ready
-- private video and the authenticated Daily Content creator RPCs.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"a6000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$select * from public.save_daily_content_item(
  null,'video','Authoring Daily reference','a6020000-0000-4000-8000-000000000003',null,null,null
)$$,'the creator saves the ready private video through the Daily Content RPC');
select set_config('test.author_daily_item_id',(
  select item.id::text from public.daily_content_items item
  where item.owner_id=auth.uid() and item.title='Authoring Daily reference'
),true);
select set_config('test.author_daily_revision_id',(
  select revision.id::text from public.daily_content_revisions revision
  where revision.title_snapshot='Authoring Daily reference'
),true);
select set_config('test.author_daily_slot_id',public.publish_daily_content_slot(
  current_setting('test.author_daily_item_id')::uuid,
  current_setting('test.author_daily_revision_id')::uuid,
  private.current_daily_checkin_day()
)::text,true);
select ok(current_setting('test.author_daily_item_id') is not null
  and current_setting('test.author_daily_revision_id') is not null
  and current_setting('test.author_daily_slot_id') is not null,
  'the Daily source is durably published through its authenticated creator boundary');
reset role;
select ok((select count(*)::integer from public.member_daily_content_video_grants grant_row
  where grant_row.video_id='a6020000-0000-4000-8000-000000000003')=0
  and not private.stream_uid_blocks_new_media_reference(
    current_setting('test.author_registry')::uuid,'synthetic-author-daily-uid'),
  'the Daily source is active with no member grant and no unrelated UID cleanup block');
select is((select count(*)::integer from public.daily_content_slots slot
  where slot.item_id=current_setting('test.author_daily_item_id')::uuid
    and slot.revision_id=current_setting('test.author_daily_revision_id')::uuid
    and slot.status in ('scheduled','published')),1,
  'the exact ready video revision is referenced by an active Daily slot');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"a6000000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into public.programs(id,coach_id,title,description,published,intro_video_id)
values('a6030000-0000-4000-8000-000000000005','a6000000-0000-4000-8000-000000000001',
  'Daily Source Exclusivity','',false,'a6020000-0000-4000-8000-000000000001');
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.author_daily_exclusive_snapshot',public.get_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000005','a6000000-0000-4000-8000-000000000001')::text,true);
select set_config('test.author_daily_exclusive_draft',public.save_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000005','a6000000-0000-4000-8000-000000000001',null,0,
  (current_setting('test.author_daily_exclusive_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_daily_exclusive_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  '[{"lesson_ordinal":1,"timeline_day_number":1,"title":"Daily-owned source","instructions":"must remain reusable by Daily","pillar":"body","video_id":"a6020000-0000-4000-8000-000000000003"}]'::jsonb
)::text,true);
select throws_ok($$select public.publish_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000005','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_daily_exclusive_draft')::jsonb->>'draft_id')::uuid,
  (current_setting('test.author_daily_exclusive_draft')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.author_daily_exclusive_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_daily_exclusive_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  'a6060000-0000-4000-8000-000000000011',1500,1::smallint)$$,
  '23514','A selected Program lesson video is missing or not ready for publication',
  'Program publication refuses to steal a currently referenced Daily video');
reset role;
select is((select visibility from public.videos
  where id='a6020000-0000-4000-8000-000000000003'),'private',
  'the rejected Daily collision leaves the video private');
select is((select state.current_content_version_id::text||':'||state.current_offer_version_id::text
  from public.program_commerce_state state
  where state.program_id='a6030000-0000-4000-8000-000000000005'),
  (current_setting('test.author_daily_exclusive_snapshot')::jsonb->>'current_content_version_id')||':'||
    (current_setting('test.author_daily_exclusive_snapshot')::jsonb->>'current_offer_version_id'),
  'the rejected Daily collision leaves new Program content and offer pointers untouched');

-- Open/save/publish the exact authored lessons with live actor and base version CAS checks.
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.author_initial_snapshot',public.get_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001')::text,true);
select throws_ok($$select public.save_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001',null,0,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  '["scalar lesson"]'::jsonb)$$,
  '22023',null,'a JSON scalar is rejected as a lesson object');
select throws_ok($$select public.save_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001',null,0,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  '[[1,2]]'::jsonb)$$,
  '22023',null,'a JSON array is rejected as a lesson object');
select throws_ok($$select public.save_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001',null,0,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  '[null]'::jsonb)$$,
  '22023',null,'JSON null is rejected as a lesson object');
select throws_ok($$select public.save_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001',null,0,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  '[{"lesson_ordinal":1,"timeline_day_number":2,"title":"Missing field","pillar":"body","video_id":null}]'::jsonb)$$,
  '22023',null,'a missing lesson key is rejected');
select throws_ok($$select public.save_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001',null,0,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  '[{"lesson_ordinal":1,"timeline_day_number":2,"title":"Extra field","instructions":"","pillar":"body","video_id":null,"fake_ready":true}]'::jsonb)$$,
  '22023',null,'an extra untrusted lesson key is rejected');
reset role;
select is((select count(*)::integer from private.program_authoring_drafts
  where program_id='a6030000-0000-4000-8000-000000000001'),0,
  'invalid scalar and object shapes do not create or mutate a draft');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.author_initial_draft',public.save_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001',null,0,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  '[{"lesson_ordinal":1,"timeline_day_number":2,"title":"Paid video lesson","instructions":"New buyers only","pillar":"body","video_id":"a6020000-0000-4000-8000-000000000002"},{"lesson_ordinal":2,"timeline_day_number":7,"title":"Paid text lesson","instructions":"Also new buyers only","pillar":"mind","video_id":null}]'::jsonb
)::text,true);
select is(current_setting('test.author_initial_draft')::jsonb->>'status','saved',
  'the strict draft RPC saves a verified server-owned lesson candidate and text lesson');
select is(public.get_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001'
)->'lessons'->0->>'video_id','a6020000-0000-4000-8000-000000000002',
  'the author snapshot exposes only the explicitly selected candidate UUID, not media proof');
select set_config('test.author_first_publish',public.publish_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_initial_draft')::jsonb->>'draft_id')::uuid,
  (current_setting('test.author_initial_draft')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  'a6060000-0000-4000-8000-000000000001',1200,2::smallint
)::text,true);
select is(current_setting('test.author_first_publish')::jsonb->>'status','published',
  'atomic publication snapshots the free Program and publishes the requested paid version');
select is((current_setting('test.author_first_publish')::jsonb->>'published')::boolean,true,
  'a successful full content publish marks the parent Program published');
reset role;
select is((select count(*)::integer from public.program_days
  where program_id='a6030000-0000-4000-8000-000000000001'),2,
  'conversion leaves both original dynamic free days intact');
select is((select count(*)::integer from public.program_versioning_fences
  where program_id='a6030000-0000-4000-8000-000000000001'),0,
  'a successful first publication releases its exact temporary 200 fence');
select is((select count(*)::integer from public.program_content_version_lessons lesson
  where lesson.program_id='a6030000-0000-4000-8000-000000000001'
    and lesson.content_version_id=(current_setting('test.author_first_publish')::jsonb->>'free_snapshot_id')::uuid),2,
  'the free snapshot contains only the two prior legacy days');
select is((select count(*)::integer from public.program_content_version_lessons lesson
  where lesson.program_id='a6030000-0000-4000-8000-000000000001'
    and lesson.content_version_id=(current_setting('test.author_first_publish')::jsonb->>'content_version_id')::uuid),2,
  'the paid version contains only the two new authored lessons');
select is((select offer.connected_account_id from public.program_offer_versions offer
  where offer.id=(current_setting('test.author_first_publish')::jsonb->>'offer_version_id')::uuid),
  'acct_AuthoringFixture','the coach offer derives its destination from the persisted enabled account fixture');
reset role;

-- The member keeps the old snapshot and its completion event; the new paid lesson is absent.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"a6000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(public.get_program_versioned_progress('a6030000-0000-4000-8000-000000000001',null)->>'mode',
  'free_snapshot','the pre-existing free enrollment remains on its pinned free snapshot');
select is(public.get_program_versioned_progress('a6030000-0000-4000-8000-000000000001',null)->>'content_version_id',
  current_setting('test.author_first_publish')::jsonb->>'free_snapshot_id',
  'the free member never moves to the newly published paid content pointer');
select is((public.get_program_versioned_progress('a6030000-0000-4000-8000-000000000001',null)->>'lifetime_completed_count')::integer,
  1,'the immutable pre-conversion completion remains in the member progress projection');
select is(jsonb_array_length(public.get_program_versioned_progress(
  'a6030000-0000-4000-8000-000000000001',null)->'required_lessons'),2,
  'the free member receives exactly the two legacy lessons and no new paid lesson');
reset role;

-- Price and promotion append only; exact old content request replay must not move pointers back.
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.author_after_price',public.publish_program_offer_price(
  'a6030000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_first_publish')::jsonb->>'content_version_id')::uuid,
  (current_setting('test.author_first_publish')::jsonb->>'offer_version_id')::uuid,
  'a6060000-0000-4000-8000-000000000002',1800,2::smallint
)::text,true);
select is((current_setting('test.author_after_price')::jsonb->>'list_price_cents')::integer,1800,
  'a price-only change appends the author-selected integer USD cents');
select is((current_setting('test.author_after_price')::jsonb->>'published')::boolean,true,
  'price-only changes preserve the existing Program published flag');
select is(public.create_program_promotion(
  'a6030000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_after_price')::jsonb->>'content_version_id')::uuid,
  (current_setting('test.author_after_price')::jsonb->>'offer_version_id')::uuid,
  'a6060000-0000-4000-8000-000000000003','AUTHORFREE','percent',10000,
  now(),now()+interval '1 day',5
)->>'discount_value','10000','a 100 percent grant promotion is bound to the current paid offer');
select throws_ok($$select public.create_program_promotion(
  'a6030000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_after_price')::jsonb->>'content_version_id')::uuid,
  (current_setting('test.author_after_price')::jsonb->>'offer_version_id')::uuid,
  'a6060000-0000-4000-8000-000000000004','INVALIDPERCENT','percent',10001,
  now(),now()+interval '1 day',5)$$,
  '22023','Program promotion terms are invalid','percent values above 10000 are rejected');
reset role;
select set_config('test.author_before_replay_content',(
  select state.current_content_version_id::text||':'||state.current_offer_version_id::text
  from public.program_commerce_state state where state.program_id='a6030000-0000-4000-8000-000000000001'
),true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is((public.publish_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_initial_draft')::jsonb->>'draft_id')::uuid,
  (current_setting('test.author_initial_draft')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  'a6060000-0000-4000-8000-000000000001',1200,2::smallint
)->>'replayed')::boolean,true,'exact content receipt replay succeeds after price publication');
reset role;
select is((select state.current_content_version_id::text||':'||state.current_offer_version_id::text
  from public.program_commerce_state state where state.program_id='a6030000-0000-4000-8000-000000000001'),
  current_setting('test.author_before_replay_content'),
  'receipt replay returns the original result without resetting the later current pointer');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select throws_ok($$select public.publish_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_initial_draft')::jsonb->>'draft_id')::uuid,
  (current_setting('test.author_initial_draft')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  'a6060000-0000-4000-8000-000000000001',1300,2::smallint)$$,
  '23505','Program authoring request ID was reused with different facts',
  'a request ID cannot be replayed with a changed price payload');
reset role;
select set_config('test.author_before_role_loss',(
  select state.current_content_version_id::text||':'||state.current_offer_version_id::text||':'||
    (select count(*)::text from private.program_authoring_receipts receipt
      where receipt.program_id='a6030000-0000-4000-8000-000000000001')
  from public.program_commerce_state state
  where state.program_id='a6030000-0000-4000-8000-000000000001'
),true);
update public.profiles set role='member'
where id='a6000000-0000-4000-8000-000000000001';
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select throws_ok($$select public.publish_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_initial_draft')::jsonb->>'draft_id')::uuid,
  (current_setting('test.author_initial_draft')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  'a6060000-0000-4000-8000-000000000001',1200,2::smallint)$$,
  '42501','Program authoring actor no longer manages this Program',
  'an exact old receipt cannot replay after the current author role is revoked');
reset role;
select is((select state.current_content_version_id::text||':'||state.current_offer_version_id::text||':'||
    (select count(*)::text from private.program_authoring_receipts receipt
      where receipt.program_id='a6030000-0000-4000-8000-000000000001')
  from public.program_commerce_state state
  where state.program_id='a6030000-0000-4000-8000-000000000001'),
  current_setting('test.author_before_role_loss'),
  'role-loss replay denial does not move pointers or create another receipt');
update public.profiles set role='coach'
where id='a6000000-0000-4000-8000-000000000001';
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';

-- A later paid revision may reuse its own exact active paid asset; other-Program reuse fails.
select set_config('test.author_second_snapshot',public.get_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001')::text,true);
select set_config('test.author_second_draft',public.save_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001',null,0,
  (current_setting('test.author_second_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_second_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  '[{"lesson_ordinal":1,"timeline_day_number":3,"title":"Reused same-Program video","instructions":"Exact same Program source","pillar":"body","video_id":"a6020000-0000-4000-8000-000000000002"}]'::jsonb
)::text,true);
select set_config('test.author_second_publish',public.publish_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_second_draft')::jsonb->>'draft_id')::uuid,
  (current_setting('test.author_second_draft')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.author_second_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_second_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  'a6060000-0000-4000-8000-000000000005',2400,1::smallint
)::text,true);
select is(current_setting('test.author_second_publish')::jsonb->>'status','published',
  'a later immutable revision may reuse its own still-ready paid asset');

-- A second Program has zero legacy days. A paid UID belonging to another Program is rejected;
-- a missing selected UUID remains in the draft until the author explicitly clears it by CAS.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"a6000000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into public.programs(id,coach_id,title,description,published,intro_video_id)
values('a6030000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000001',
  'Empty Legacy Shell','',false,'a6020000-0000-4000-8000-000000000001');
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is((public.get_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000001'
)->>'current_lesson_count')::integer,0,'a new shell is a valid zero-legacy-lesson source');
select set_config('test.author_shell_snapshot',public.get_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000001')::text,true);
select set_config('test.author_shell_draft',public.save_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000001',null,0,
  (current_setting('test.author_shell_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_shell_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  '[{"lesson_ordinal":1,"timeline_day_number":1,"title":"Needs explicit video","instructions":"","pillar":"body","video_id":"a6020000-0000-4000-8000-000000000002"}]'::jsonb
)::text,true);
select throws_ok($$select public.publish_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_shell_draft')::jsonb->>'draft_id')::uuid,
  (current_setting('test.author_shell_draft')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.author_shell_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_shell_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  'a6060000-0000-4000-8000-000000000006',1500,1::smallint)$$,
  '23514',null,'a UID already owned by another paid Program cannot be borrowed');
select set_config('test.author_missing_draft',public.save_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_shell_draft')::jsonb->>'draft_id')::uuid,1,
  (current_setting('test.author_shell_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_shell_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  '[{"lesson_ordinal":1,"timeline_day_number":1,"title":"Deleted selection","instructions":"","pillar":"body","video_id":"a6020000-0000-4000-8000-000000000099"}]'::jsonb
)::text,true);
select throws_ok($$select public.publish_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_missing_draft')::jsonb->>'draft_id')::uuid,
  (current_setting('test.author_missing_draft')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.author_shell_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_shell_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  'a6060000-0000-4000-8000-000000000007',1500,1::smallint)$$,
  '23514',null,'a missing video selection fails closed instead of becoming a text lesson');
select is(public.get_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000001'
)->'lessons'->0->>'video_id','a6020000-0000-4000-8000-000000000099',
  'the missing UUID survives because draft selection has no cascading video foreign key');
select set_config('test.author_shell_cleared',public.save_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_missing_draft')::jsonb->>'draft_id')::uuid,2,
  (current_setting('test.author_shell_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_shell_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  '[{"lesson_ordinal":1,"timeline_day_number":1,"title":"Text-only shell","instructions":"The author explicitly cleared the missing selection","pillar":"mind","video_id":null}]'::jsonb
)::text,true);
select is(public.get_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000001'
)->'lessons'->0->'video_id','null'::jsonb,
  'only a new successful CAS save changes the selected media to intentional text-only');
select throws_ok($$select public.publish_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_shell_cleared')::jsonb->>'draft_id')::uuid,
  (current_setting('test.author_shell_cleared')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.author_shell_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_shell_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  'a6060000-0000-4000-8000-000000000012',1500,2::smallint)$$,
  '23514','Program draft lesson sequence is incomplete',
  'a one-lesson paid Program rejects a two-installment request');
select set_config('test.author_shell_publish',public.publish_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_shell_cleared')::jsonb->>'draft_id')::uuid,
  (current_setting('test.author_shell_cleared')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.author_shell_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_shell_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  'a6060000-0000-4000-8000-000000000008',1500,1::smallint
)::text,true);
select is((current_setting('test.author_shell_publish')::jsonb->>'published')::boolean,true,
  'an empty-legacy-days Program can atomically publish valid paid text content');
select is((current_setting('test.author_shell_publish')::jsonb->>'free_snapshot_id') is not null,true,
  'the first conversion still records its exact zero-lesson free snapshot');
reset role;
select is((select count(*)::integer from public.program_content_version_lessons lesson
  where lesson.program_id='a6030000-0000-4000-8000-000000000002'
    and lesson.content_version_id=(current_setting('test.author_shell_publish')::jsonb->>'free_snapshot_id')::uuid),0,
  'the brand-new Program free snapshot is empty, not a fabricated legacy day');
select is((select offer.connected_account_id from public.program_offer_versions offer
  where offer.id=(current_setting('test.author_shell_publish')::jsonb->>'offer_version_id')::uuid),
  'acct_AuthoringFixture','the empty legacy path still uses the persisted coach Connect destination');

-- Price and promotion changes preserve an explicitly false parent flag; the one-lesson N=1 case
-- above and the two-lesson N=2 paid publication together exercise the installment boundaries.
reset role;
update public.programs set published=false where id='a6030000-0000-4000-8000-000000000002';
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.author_shell_price_false',public.publish_program_offer_price(
  'a6030000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_shell_publish')::jsonb->>'content_version_id')::uuid,
  (current_setting('test.author_shell_publish')::jsonb->>'offer_version_id')::uuid,
  'a6060000-0000-4000-8000-000000000013',1750,1::smallint
)::text,true);
select is((current_setting('test.author_shell_price_false')::jsonb->>'published')::boolean,false,
  'price-only publication preserves a false parent Program flag');
select is((public.publish_program_offer_price(
  'a6030000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_shell_publish')::jsonb->>'content_version_id')::uuid,
  (current_setting('test.author_shell_publish')::jsonb->>'offer_version_id')::uuid,
  'a6060000-0000-4000-8000-000000000013',1750,1::smallint
)->>'replayed')::boolean,true,
  'an exact price receipt replays after the pointer has already advanced');
select set_config('test.author_shell_promo_false',public.create_program_promotion(
  'a6030000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_shell_price_false')::jsonb->>'content_version_id')::uuid,
  (current_setting('test.author_shell_price_false')::jsonb->>'offer_version_id')::uuid,
  'a6060000-0000-4000-8000-000000000014','SHELLFREE','percent',10000,
  now(),now()+interval '1 day',3
)::text,true);
select is((current_setting('test.author_shell_promo_false')::jsonb->>'published')::boolean,false,
  'promotion creation preserves a false parent Program flag');
select is((public.create_program_promotion(
  'a6030000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_shell_price_false')::jsonb->>'content_version_id')::uuid,
  (current_setting('test.author_shell_price_false')::jsonb->>'offer_version_id')::uuid,
  'a6060000-0000-4000-8000-000000000014','SHELLFREE','percent',10000,
  (current_setting('test.author_shell_promo_false')::jsonb->>'starts_at')::timestamptz,
  (current_setting('test.author_shell_promo_false')::jsonb->>'ends_at')::timestamptz,3
)->>'replayed')::boolean,true,
  'an exact promotion receipt replays without creating a second promotion');
reset role;
select set_config('test.author_shell_state_before_disabled',(
  select state.current_content_version_id::text||':'||state.current_offer_version_id::text
  from public.program_commerce_state state
  where state.program_id='a6030000-0000-4000-8000-000000000002'
),true);
reset role;
update public.payout_accounts set charges_enabled=false
where coach_id='a6000000-0000-4000-8000-000000000001';
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select throws_ok($$select public.publish_program_offer_price(
  'a6030000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_shell_price_false')::jsonb->>'content_version_id')::uuid,
  (current_setting('test.author_shell_price_false')::jsonb->>'offer_version_id')::uuid,
  'a6060000-0000-4000-8000-000000000015',1900,1::smallint)$$,
  '23514','Coach charges are not enabled for this Program',
  'a coach cannot append a new offer while charges are disabled');
select throws_ok($$select public.create_program_promotion(
  'a6030000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_shell_price_false')::jsonb->>'content_version_id')::uuid,
  (current_setting('test.author_shell_price_false')::jsonb->>'offer_version_id')::uuid,
  'a6060000-0000-4000-8000-000000000016','DISABLED','percent',1000,
  now(),now()+interval '1 day',3)$$,
  '23514','Coach charges are not enabled for this Program',
  'a coach cannot add promotions while charges are disabled');
reset role;
select is((select state.current_content_version_id::text||':'||state.current_offer_version_id::text
  from public.program_commerce_state state
  where state.program_id='a6030000-0000-4000-8000-000000000002'),
  current_setting('test.author_shell_state_before_disabled'),
  'rejected charges-disabled writes leave content and offer pointers unchanged');
select is((select published from public.programs
  where id='a6030000-0000-4000-8000-000000000002'),false,
  'rejected charges-disabled writes preserve the false parent flag');
update public.payout_accounts set charges_enabled=true
where coach_id='a6000000-0000-4000-8000-000000000001';

-- Live actor checks and strict CAS prevent impersonation or stale writes.
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select throws_ok($$select public.get_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000003')$$,
  '42501',null,'the service cannot use a non-owner profile as the author');
select throws_ok($$select public.save_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000001',null,0,
  (current_setting('test.author_shell_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_shell_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  '[{"lesson_ordinal":1,"timeline_day_number":1,"title":"stale","instructions":"","pillar":"body","video_id":null}]'::jsonb)$$,
  '40001',null,'a stale pre-publication content/offer base cannot open a new draft');
reset role;

-- Platform-owned authoring derives its administrator role and has no connected destination.
update public.profiles set role='admin'
where id='a6000000-0000-4000-8000-000000000001';
insert into public.programs(id,coach_id,title,description,published,platform_owned,intro_video_id)
values('a6030000-0000-4000-8000-000000000003','a6000000-0000-4000-8000-000000000001',
  'Platform-Owned Text Program','',false,true,'a6020000-0000-4000-8000-000000000001');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.author_platform_snapshot',public.get_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000003','a6000000-0000-4000-8000-000000000001')::text,true);
select set_config('test.author_platform_draft',public.save_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000003','a6000000-0000-4000-8000-000000000001',null,0,
  (current_setting('test.author_platform_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_platform_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  '[{"lesson_ordinal":1,"timeline_day_number":1,"title":"Platform text lesson","instructions":"","pillar":"spirit","video_id":null}]'::jsonb
)::text,true);
select set_config('test.author_platform_publish',public.publish_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000003','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_platform_draft')::jsonb->>'draft_id')::uuid,
  (current_setting('test.author_platform_draft')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.author_platform_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_platform_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  'a6060000-0000-4000-8000-000000000009',900,1::smallint
)::text,true);
select is((current_setting('test.author_platform_publish')::jsonb->>'published')::boolean,true,
  'the administrator can publish a valid paid version for a platform-owned Program');
reset role;
select is((select offer.connected_account_id from public.program_offer_versions offer
  where offer.id=(current_setting('test.author_platform_publish')::jsonb->>'offer_version_id')::uuid),
  null::text,'platform-owned offers carry no coach Connect destination');
select is((select offer.platform_owned from public.program_offer_versions offer
  where offer.id=(current_setting('test.author_platform_publish')::jsonb->>'offer_version_id')::uuid),
  true,'platform seller status is derived from the stored Program, not a posted seller field');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select throws_ok($$select public.get_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001')$$,
  '42501',null,'a coach-owned Program cannot continue under a changed administrator role');
reset role;
update public.profiles set role='coach'
where id='a6000000-0000-4000-8000-000000000001';

-- Historical exact content receipts cannot bypass a current media fence or account tombstone.
-- These are real Gate-3 reservation RPCs; no test GUC, direct tombstone row, or raw fence update
-- authorizes the negative replays.
reset role;
select set_config('test.author_p1_state_before_fence',(
  select state.current_content_version_id::text||':'||state.current_offer_version_id::text||':'||
    (select count(*)::text from private.program_authoring_receipts receipt
      where receipt.program_id='a6030000-0000-4000-8000-000000000001')
  from public.program_commerce_state state
  where state.program_id='a6030000-0000-4000-8000-000000000001'
),true);
select set_config('test.author_p1_fence_revision',coalesce((
  select fence.source_revision::text from public.stream_media_parent_fences fence
  where fence.source_kind='program'
    and fence.source_identity='a6030000-0000-4000-8000-000000000001'
), '1'),true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.author_p1_program_close',public.reserve_stream_media_cleanup(
  'a6080000-0000-4000-8000-000000000001','a6080000-0000-4000-8000-000000000002',
  'program','a6030000-0000-4000-8000-000000000001',
  'a6000000-0000-4000-8000-000000000001',
  current_setting('test.author_p1_fence_revision')::bigint,repeat('f',64)
)::text,true);
select is(current_setting('test.author_p1_program_close')::jsonb->>'outcome','reserved',
  'the normal Gate-3 RPC establishes a real active Program media fence');
select throws_ok($$select public.publish_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_initial_draft')::jsonb->>'draft_id')::uuid,
  (current_setting('test.author_initial_draft')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  'a6060000-0000-4000-8000-000000000001',1200,2::smallint)$$,
  '55P03','Program authoring is blocked by a current media or versioning fence',
  'an exact old receipt is rejected once its Program enters the active media fence');
reset role;
select is((select state.current_content_version_id::text||':'||state.current_offer_version_id::text||':'||
    (select count(*)::text from private.program_authoring_receipts receipt
      where receipt.program_id='a6030000-0000-4000-8000-000000000001')
  from public.program_commerce_state state
  where state.program_id='a6030000-0000-4000-8000-000000000001'),
  current_setting('test.author_p1_state_before_fence'),
  'fenced replay denial leaves content, offer, and receipt count unchanged');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.author_account_tombstone',public.begin_stream_account_media_cleanup(
  'a6080000-0000-4000-8000-000000000003','a6000000-0000-4000-8000-000000000001',
  'a6080000-0000-4000-8000-000000000004',repeat('a',64),
  'a6080000-0000-4000-8000-000000000005',repeat('b',64)
)::text,true);
select is(current_setting('test.author_account_tombstone')::jsonb->>'outcome','reserved',
  'the real account-cleanup boundary creates a provider-cleanup tombstone without any HTTP call');
reset role;
select ok(private.stream_account_is_tombstoned('a6000000-0000-4000-8000-000000000001')
  and exists (select 1 from public.stream_media_account_tombstones tombstone
    where tombstone.id='a6080000-0000-4000-8000-000000000003'
      and tombstone.account_id='a6000000-0000-4000-8000-000000000001'
      and tombstone.tombstone_state='provider_cleanup'),
  'the account closure is durable and observed only by the owner-side fixture assertion');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select throws_ok($$select public.publish_program_authoring_draft(
  'a6030000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001',
  (current_setting('test.author_initial_draft')::jsonb->>'draft_id')::uuid,
  (current_setting('test.author_initial_draft')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.author_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  'a6060000-0000-4000-8000-000000000001',1200,2::smallint)$$,
  '55000','Program authoring account is closing',
  'an exact old receipt is rejected after its current account tombstone');
reset role;
select is((select state.current_content_version_id::text||':'||state.current_offer_version_id::text||':'||
    (select count(*)::text from private.program_authoring_receipts receipt
      where receipt.program_id='a6030000-0000-4000-8000-000000000001')
  from public.program_commerce_state state
  where state.program_id='a6030000-0000-4000-8000-000000000001'),
  current_setting('test.author_p1_state_before_fence'),
  'tombstoned replay denial leaves content, offer, and receipt count unchanged');

select * from finish();
rollback;
