begin;
select no_plan();

-- Synthetic local fixture facts use the normal trusted account attestation and 315 producer RPCs.
-- Local synthetic actors and evidence. Provider-shaped data is submitted only through the
-- ordinary 315 Library upload/readback RPCs; there is no provider HTTP call in this TAP.
insert into auth.users(id,email,raw_user_meta_data) values
  ('f6250000-0000-4000-8000-000000000001','optional-coach@example.test','{"display_name":"Optional Intro Coach"}'),
  ('f6250000-0000-4000-8000-000000000002','optional-member@example.test','{"display_name":"Author Member"}'),
  ('f6250000-0000-4000-8000-000000000003','optional-outsider@example.test','{"display_name":"Author Outsider"}');
update public.profiles set role='coach'
where id='f6250000-0000-4000-8000-000000000001';
update public.profiles set role='member'
where id in ('f6250000-0000-4000-8000-000000000002','f6250000-0000-4000-8000-000000000003');
insert into public.coach_members(coach_id,member_id)
values('f6250000-0000-4000-8000-000000000001','f6250000-0000-4000-8000-000000000002');
insert into public.platform_test_entitlements(member_id,tier,grant_reason,granted_by)
values('f6250000-0000-4000-8000-000000000002','regular','Synthetic Program authoring TAP',
  'f6250000-0000-4000-8000-000000000001');
insert into public.payout_accounts(coach_id,stripe_account_id,charges_enabled,payouts_enabled)
values('f6250000-0000-4000-8000-000000000001','acct_OptionalIntroFixture',true,false);

set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.optional_attestation',public.record_stream_provider_account_attestation(
  'f6260000-0000-4000-8000-000000000001','f6250000000000000000000000000001',
  'vod_primary',repeat('1',64))::text,true);
select set_config('test.optional_registry',
  current_setting('test.optional_attestation')::jsonb->>'registry_id',true);
select is(current_setting('test.optional_attestation')::jsonb->>'outcome','recorded',
  'the synthetic provider account identity is recorded by the normal trusted-service attestation RPC');
select set_config('test.optional_path_verification',public.record_stream_account_path_verification(
  'f6260000-0000-4000-8000-000000000002',current_setting('test.optional_registry')::uuid,
  'vod_primary','f6250000000000000000000000000001',200::smallint,repeat('2',64)
  )::text,true);
reset role;
select ok(current_setting('test.optional_path_verification')::jsonb->>'outcome'='verified'
  and current_setting('test.optional_path_verification')::jsonb->>'event_id' is not null
  and current_setting('test.optional_registry') is not null
  and exists (select 1 from public.stream_provider_account_registry registry
    where registry.id=current_setting('test.optional_registry')::uuid
      and registry.credential_slot='vod_primary'
      and registry.provider_account_id='f6250000000000000000000000000001')
  and exists (select 1 from public.stream_provider_account_verification_state state
    where state.registry_id=current_setting('test.optional_registry')::uuid
      and state.verification_event_id is not null and state.verified_until > now()),
  'the attested registry and fresh account-path verification are durable exact identities');
select ok(exists (select 1 from public.stream_provider_account_attestations attestation
  where attestation.id=(current_setting('test.optional_attestation')::jsonb->>'attestation_id')::uuid
    and attestation.registry_id=current_setting('test.optional_registry')::uuid
    and attestation.request_id='f6260000-0000-4000-8000-000000000001'
    and attestation.evidence_digest=repeat('1',64))
  and exists (select 1 from public.stream_provider_account_verification_events event
    where event.id=(current_setting('test.optional_path_verification')::jsonb->>'event_id')::uuid
      and event.request_id='f6260000-0000-4000-8000-000000000002'
      and event.registry_id=current_setting('test.optional_registry')::uuid
      and event.http_status=200 and event.evidence_digest=repeat('2',64)),
  'owner evidence ties the exact attestation and path-read event to their request IDs and digests');

-- The synthetic paid lesson is created only through normal 315 RPCs.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f6250000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.optional_lesson_prepare',public.prepare_stream_library_video_upload(
  'f62a0000-0000-4000-8000-000000000001','f6270000-0000-4000-8000-000000000002',
  'Synthetic optional-intro paid lesson','',repeat('7',64))::text,true);
select ok(current_setting('test.optional_lesson_prepare')::jsonb->>'outcome'='reserved'
  and current_setting('test.optional_lesson_prepare')::jsonb->>'operation_id' is not null
  and current_setting('test.optional_lesson_prepare')::jsonb->>'request_digest' ~ '^[0-9a-f]{64}$'
  and current_setting('test.optional_lesson_prepare')::jsonb->>'transport_request_id' is not null,
  'paid lesson prepare returns its exact operation, digest, and transport identities');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.optional_lesson_claim',public.claim_stream_media_create(
  (current_setting('test.optional_lesson_prepare')::jsonb->>'operation_id')::uuid,
  'f62a0000-0000-4000-8000-000000000002',
  current_setting('test.optional_lesson_prepare')::jsonb->>'request_digest'
  )::text,true);
select ok(current_setting('test.optional_lesson_claim')::jsonb->>'outcome'='create_authorized'
  and current_setting('test.optional_lesson_claim')::jsonb->>'operation_id'
    =current_setting('test.optional_lesson_prepare')::jsonb->>'operation_id'
  and (current_setting('test.optional_lesson_claim')::jsonb->>'operation_revision')::bigint>0,
  'paid lesson upload uses the real service create-claim boundary and revision');
select set_config('test.optional_lesson_transport',public.record_stream_media_upload_transport(
  (current_setting('test.optional_lesson_prepare')::jsonb->>'operation_id')::uuid,
  (current_setting('test.optional_lesson_prepare')::jsonb->>'transport_request_id')::uuid,
  current_setting('test.optional_lesson_prepare')::jsonb->>'request_digest',
  'synthetic-author-paid-uid','https://upload.provider.invalid/tus/author-paid',
  (now()+interval '15 minutes')::timestamptz,7200,true,
  current_setting('test.optional_lesson_prepare')::jsonb->'metadata',repeat('8',64)
  )::text,true);
select ok(current_setting('test.optional_lesson_transport')::jsonb->>'outcome'='recorded'
  and current_setting('test.optional_lesson_transport')::jsonb->>'operation_id'
    =current_setting('test.optional_lesson_prepare')::jsonb->>'operation_id',
  'paid lesson transport is tied to its unchanged prepared request');
select set_config('test.optional_lesson_advance',public.advance_stream_media_upload(
  (current_setting('test.optional_lesson_prepare')::jsonb->>'operation_id')::uuid,
  'f62a0000-0000-4000-8000-000000000003','created_unverified',repeat('9',64)
  )::text,true);
select ok(current_setting('test.optional_lesson_advance')::jsonb->>'outcome'='advanced'
  and current_setting('test.optional_lesson_advance')::jsonb->>'state'='created_unverified'
  and (current_setting('test.optional_lesson_advance')::jsonb->>'revision')::bigint>0,
  'paid lesson upload records its unverified create response and revision');
select set_config('test.optional_lesson_observation',public.record_stream_media_upload_observation(
  (current_setting('test.optional_lesson_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.optional_registry')::uuid,'exact_uid_get','synthetic-author-paid-uid',
  200::smallint,true,true,true,true,'f62a0000-0000-4000-8000-000000000004',repeat('a',64)
  )::text,true);
select ok(current_setting('test.optional_lesson_observation')::jsonb->>'outcome'='recorded',
  'paid lesson exact readback records marker, creator, signatures, and readiness');
select set_config('test.optional_lesson_binding',public.bind_stream_media_upload_readback(
  (current_setting('test.optional_lesson_prepare')::jsonb->>'operation_id')::uuid,
  'f62a0000-0000-4000-8000-000000000004','f62a0000-0000-4000-8000-000000000005'
  )::text,true);
select ok(current_setting('test.optional_lesson_binding')::jsonb->>'outcome'='provisional_bound'
  and current_setting('test.optional_lesson_binding')::jsonb->>'asset_id' is not null
  and current_setting('test.optional_lesson_binding')::jsonb->>'binding_id' is not null,
  'paid lesson readback records exact non-null asset and binding identities');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f6250000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.optional_lesson_commit',public.commit_stream_library_video_upload(
  (current_setting('test.optional_lesson_prepare')::jsonb->>'operation_id')::uuid,
  'f62a0000-0000-4000-8000-000000000006'
  )::text,true);
select ok(current_setting('test.optional_lesson_commit')::jsonb->>'outcome'='ready_for_publication'
  and current_setting('test.optional_lesson_commit')::jsonb->>'video_id'='f6270000-0000-4000-8000-000000000002'
  and (current_setting('test.optional_lesson_commit')::jsonb->>'source_revision')::bigint>0,
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
    where operation.id=(current_setting('test.optional_lesson_prepare')::jsonb->>'operation_id')::uuid
      and operation.operation_kind='upload' and operation.source_kind='video'
      and operation.source_identity='f6270000-0000-4000-8000-000000000002'
      and operation.actor_id='f6250000-0000-4000-8000-000000000001'
      and operation.owner_id='f6250000-0000-4000-8000-000000000001'
      and state.operation_state='completed'
      and transport.registry_id=current_setting('test.optional_registry')::uuid
      and transport.provider_uid='synthetic-author-paid-uid'
      and asset.raw_provider_uid='synthetic-author-paid-uid'
      and asset.lifecycle_state='ready_for_publication'
      and binding.source_kind='video' and binding.source_identity='f6270000-0000-4000-8000-000000000002'
      and binding.owner_id='f6250000-0000-4000-8000-000000000001'
      and binding.binding_state='ready_for_publication'
      and observation.observation_kind='exact_uid_get'
      and observation.raw_provider_uid='synthetic-author-paid-uid'
      and observation.http_status=200 and observation.signed_urls_reported
      and observation.creator_marker_matched and observation.metadata_marker_matched
      and observation.ready_to_stream_reported
      and receipt.request_id='f62a0000-0000-4000-8000-000000000006'
      and receipt.terminal_state='completed'
      and receipt.response->>'video_id'='f6270000-0000-4000-8000-000000000002'
  ), 'the exact paid lesson upload has a complete canonical 315 durable identity chain');

select set_config('app.stream_media_operation_id','',true);
select ok(nullif(current_setting('app.stream_media_operation_id',true),'') is null,
  'a new Program request does not inherit the completed upload operation selector');

-- This program starts on the ordinary published free path with no intro video.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f6250000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into public.programs(id,coach_id,title,description,published,intro_video_id)
values('f6280000-0000-4000-8000-000000000001','f6250000-0000-4000-8000-000000000001',
  'Optional Intro Conversion','',false,null);
select set_config('test.optional_legacy_day',public.save_owned_program_day(
  'f6280000-0000-4000-8000-000000000001',null,1::smallint,
  'Legacy free lesson','Existing free access stays pinned','body',null
)::text,true);
reset role;
update public.programs set published=true where id='f6280000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f6250000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((public.start_my_program_enrollment('f6280000-0000-4000-8000-000000000001')->>'existing')::boolean,
  false,'a signed-in Regular member can enroll in the published free Program with no intro');
select set_config('test.optional_completion',public.set_my_program_lesson_state(
  'f6280000-0000-4000-8000-000000000001',current_setting('test.optional_legacy_day')::uuid,true,
  'f6290000-0000-4000-8000-000000000001')::text,true);
select is((current_setting('test.optional_completion')::jsonb->>'accepted')::boolean,true,
  'the free member records a normal lesson completion before conversion');
reset role;

-- Convert the free Program using an actual 315 Library lesson, without any intro source.
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.optional_initial_snapshot',public.get_program_authoring_draft(
  'f6280000-0000-4000-8000-000000000001','f6250000-0000-4000-8000-000000000001')::text,true);
select ok(current_setting('test.optional_initial_snapshot')::jsonb->>'current_content_version_id' is not null
  and current_setting('test.optional_initial_snapshot')::jsonb->>'current_offer_version_id' is not null,
  'the service authoring snapshot has the current free content and offer pointers');
select set_config('test.optional_first_draft',public.save_program_authoring_draft(
  'f6280000-0000-4000-8000-000000000001','f6250000-0000-4000-8000-000000000001',null,0,
  (current_setting('test.optional_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.optional_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  '[{"lesson_ordinal":1,"timeline_day_number":3,"title":"First paid lesson","instructions":"Valid ordinary Library media","pillar":"body","video_id":"f6270000-0000-4000-8000-000000000002"}]'::jsonb
)::text,true);
select is(current_setting('test.optional_first_draft')::jsonb->>'status','saved',
  'the normal authoring RPC saves the selected ready lesson');
select set_config('test.optional_first_publish',public.publish_program_authoring_draft(
  'f6280000-0000-4000-8000-000000000001','f6250000-0000-4000-8000-000000000001',
  (current_setting('test.optional_first_draft')::jsonb->>'draft_id')::uuid,
  (current_setting('test.optional_first_draft')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.optional_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.optional_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  'f62b0000-0000-4000-8000-000000000001',1200,1::smallint
)::text,true);
select ok(current_setting('test.optional_first_publish')::jsonb->>'status'='published'
  and current_setting('test.optional_first_publish')::jsonb->>'free_snapshot_id' is not null
  and (current_setting('test.optional_first_publish')::jsonb->>'published')::boolean,
  'a free Program with no intro converts atomically to a paid published version');
reset role;
select ok((select intro_video_id is null and published from public.programs
  where id='f6280000-0000-4000-8000-000000000001'),
  'conversion leaves the Program intro absent');
select is((select count(*)::integer from public.stream_media_source_bindings binding
  where binding.source_kind='program_intro' and binding.source_identity='f6280000-0000-4000-8000-000000000001'),
  0,'publishing with no intro fabricates no program_intro binding');
select ok(exists (select 1 from public.program_content_version_lessons lesson
  where lesson.program_id='f6280000-0000-4000-8000-000000000001'
    and lesson.content_version_id=(current_setting('test.optional_first_publish')::jsonb->>'content_version_id')::uuid
    and lesson.video_id='f6270000-0000-4000-8000-000000000002'
    and lesson.cloudflare_uid='synthetic-author-paid-uid'),
  'the published paid lesson still has its exact normal 315 video and UID');
select is((select offer.connected_account_id from public.program_offer_versions offer
  where offer.id=(current_setting('test.optional_first_publish')::jsonb->>'offer_version_id')::uuid),
  'acct_OptionalIntroFixture','the paid offer still uses the persisted charges-enabled coach destination');

-- An exact retry returns the first immutable receipt without moving current pointers.
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.optional_first_replay',public.publish_program_authoring_draft(
  'f6280000-0000-4000-8000-000000000001','f6250000-0000-4000-8000-000000000001',
  (current_setting('test.optional_first_draft')::jsonb->>'draft_id')::uuid,
  (current_setting('test.optional_first_draft')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.optional_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.optional_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  'f62b0000-0000-4000-8000-000000000001',1200,1::smallint
)::text,true);
select ok((current_setting('test.optional_first_replay')::jsonb->>'replayed')::boolean
  and current_setting('test.optional_first_replay')::jsonb->>'content_version_id'
    =current_setting('test.optional_first_publish')::jsonb->>'content_version_id'
  and current_setting('test.optional_first_replay')::jsonb->>'offer_version_id'
    =current_setting('test.optional_first_publish')::jsonb->>'offer_version_id',
  'an exact first-publication replay returns the original content and offer IDs');
reset role;
select is((select count(*)::integer from private.program_authoring_receipts receipt
  where receipt.program_id='f6280000-0000-4000-8000-000000000001'
    and receipt.operation_kind='publish_content'),1,
  'the first publication replay creates no duplicate receipt');

-- The now-paid Program also accepts a later revision without an intro; reuse remains same-Program.
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.optional_paid_snapshot',public.get_program_authoring_draft(
  'f6280000-0000-4000-8000-000000000001','f6250000-0000-4000-8000-000000000001')::text,true);
select is(current_setting('test.optional_paid_snapshot')::jsonb->>'offer_kind','paid',
  'the follow-up publication starts from the current paid offer');
select set_config('test.optional_second_draft',public.save_program_authoring_draft(
  'f6280000-0000-4000-8000-000000000001','f6250000-0000-4000-8000-000000000001',null,0,
  (current_setting('test.optional_paid_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.optional_paid_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  '[{"lesson_ordinal":1,"timeline_day_number":5,"title":"Revised paid lesson","instructions":"Same Program source remains valid","pillar":"body","video_id":"f6270000-0000-4000-8000-000000000002"}]'::jsonb
)::text,true);
select set_config('test.optional_second_publish',public.publish_program_authoring_draft(
  'f6280000-0000-4000-8000-000000000001','f6250000-0000-4000-8000-000000000001',
  (current_setting('test.optional_second_draft')::jsonb->>'draft_id')::uuid,
  (current_setting('test.optional_second_draft')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.optional_paid_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.optional_paid_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  'f62b0000-0000-4000-8000-000000000002',1600,1::smallint
)::text,true);
select ok(current_setting('test.optional_second_publish')::jsonb->>'status'='published'
  and current_setting('test.optional_second_publish')::jsonb->>'free_snapshot_id' is null
  and current_setting('test.optional_second_publish')::jsonb->>'content_version_id'
    is distinct from current_setting('test.optional_first_publish')::jsonb->>'content_version_id'
  and (current_setting('test.optional_second_publish')::jsonb->>'published')::boolean,
  'an already-paid Program publishes a later no-intro revision with a new immutable content version');
select set_config('test.optional_second_replay',public.publish_program_authoring_draft(
  'f6280000-0000-4000-8000-000000000001','f6250000-0000-4000-8000-000000000001',
  (current_setting('test.optional_second_draft')::jsonb->>'draft_id')::uuid,
  (current_setting('test.optional_second_draft')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.optional_paid_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.optional_paid_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  'f62b0000-0000-4000-8000-000000000002',1600,1::smallint
)::text,true);
select ok((current_setting('test.optional_second_replay')::jsonb->>'replayed')::boolean
  and current_setting('test.optional_second_replay')::jsonb->>'content_version_id'
    =current_setting('test.optional_second_publish')::jsonb->>'content_version_id',
  'an exact later-publication replay returns the same immutable version');
reset role;
select ok((select intro_video_id is null from public.programs
  where id='f6280000-0000-4000-8000-000000000001'),
  'later paid publication still leaves intro_video_id NULL');
select is((select count(*)::integer from private.program_authoring_receipts receipt
  where receipt.program_id='f6280000-0000-4000-8000-000000000001'
    and receipt.operation_kind='publish_content'),2,
  'each distinct successful content request has one receipt and its replay adds none');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f6250000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(public.get_program_versioned_progress('f6280000-0000-4000-8000-000000000001',null)->>'mode',
  'free_snapshot','the original free member remains on the pinned snapshot after later publication');
select is(public.get_program_versioned_progress('f6280000-0000-4000-8000-000000000001',null)->>'content_version_id',
  current_setting('test.optional_first_publish')::jsonb->>'free_snapshot_id',
  'the old enrollment does not move to either paid content version');
select is((public.get_program_versioned_progress('f6280000-0000-4000-8000-000000000001',null)->>'lifetime_completed_count')::integer,
  1,'the original completed free lesson remains recorded');
select is(jsonb_array_length(public.get_program_versioned_progress(
  'f6280000-0000-4000-8000-000000000001',null)->'required_lessons'),1,
  'the old free member sees exactly the pinned lesson and no paid media');
reset role;


-- An administrator can publish a platform-owned free Program with no intro and text-only lessons.
update public.profiles set role='admin' where id='f6250000-0000-4000-8000-000000000003';
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f6250000-0000-4000-8000-000000000003","role":"authenticated"}';
insert into public.programs(id,coach_id,title,description,published,platform_owned,intro_video_id)
values('f6280000-0000-4000-8000-000000000002','f6250000-0000-4000-8000-000000000003',
  'Free Platform Program Without Intro','',false,true,null);
select set_config('test.optional_platform_day',public.save_owned_program_day(
  'f6280000-0000-4000-8000-000000000002',null,1::smallint,
  'Platform free text lesson','No media required','mind',null
)::text,true);
reset role;
update public.programs set published=true where id='f6280000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f6250000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((public.start_my_program_enrollment('f6280000-0000-4000-8000-000000000002')->>'existing')::boolean,
  false,'the member enrolls in the free platform Program with no intro');
select set_config('test.optional_platform_completion',public.set_my_program_lesson_state(
  'f6280000-0000-4000-8000-000000000002',current_setting('test.optional_platform_day')::uuid,true,
  'f6290000-0000-4000-8000-000000000002')::text,true);
select is((current_setting('test.optional_platform_completion')::jsonb->>'accepted')::boolean,true,
  'the free platform lesson receives its ordinary completion event');
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.optional_platform_snapshot',public.get_program_authoring_draft(
  'f6280000-0000-4000-8000-000000000002','f6250000-0000-4000-8000-000000000003')::text,true);
select is(current_setting('test.optional_platform_snapshot')::jsonb->>'offer_kind','free',
  'the platform publisher starts from the zero-price free offer');
select set_config('test.optional_platform_draft',public.save_program_authoring_draft(
  'f6280000-0000-4000-8000-000000000002','f6250000-0000-4000-8000-000000000003',null,0,
  (current_setting('test.optional_platform_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.optional_platform_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  '[{"lesson_ordinal":1,"timeline_day_number":2,"title":"Platform paid text lesson","instructions":"No media or intro required","pillar":"mind","video_id":null}]'::jsonb
)::text,true);
select set_config('test.optional_platform_publish',public.publish_program_authoring_draft(
  'f6280000-0000-4000-8000-000000000002','f6250000-0000-4000-8000-000000000003',
  (current_setting('test.optional_platform_draft')::jsonb->>'draft_id')::uuid,
  (current_setting('test.optional_platform_draft')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.optional_platform_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.optional_platform_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  'f62b0000-0000-4000-8000-000000000003',500,1::smallint
)::text,true);
select ok(current_setting('test.optional_platform_publish')::jsonb->>'status'='published'
  and current_setting('test.optional_platform_publish')::jsonb->>'free_snapshot_id' is not null
  and (current_setting('test.optional_platform_publish')::jsonb->>'published')::boolean,
  'the zero-price platform Program publishes a paid text-only revision without an intro');
reset role;
select ok((select platform_owned and intro_video_id is null and published
    from public.programs where id='f6280000-0000-4000-8000-000000000002'),
  'admin publication leaves the platform Program published with no intro');
select is((select offer.connected_account_id from public.program_offer_versions offer
  where offer.id=(current_setting('test.optional_platform_publish')::jsonb->>'offer_version_id')::uuid),
  null,'platform-owned publication creates no coach payout destination');
select ok(exists (select 1 from public.program_content_version_lessons lesson
  where lesson.program_id='f6280000-0000-4000-8000-000000000002'
    and lesson.content_version_id=(current_setting('test.optional_platform_publish')::jsonb->>'content_version_id')::uuid
    and lesson.video_id is null),
  'platform publication contains the requested text-only paid lesson');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f6250000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(public.get_program_versioned_progress('f6280000-0000-4000-8000-000000000002',null)->>'mode',
  'free_snapshot','the platform Program free member remains on the pre-conversion snapshot');
select is((public.get_program_versioned_progress('f6280000-0000-4000-8000-000000000002',null)->>'lifetime_completed_count')::integer,
  1,'the platform Program member completion remains recorded');
reset role;
select * from finish();
rollback;
