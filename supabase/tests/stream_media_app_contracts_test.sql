begin;
select no_plan();

-- Synthetic provider evidence is submitted only through the trusted 300/310 RPCs.
-- No network/provider request occurs; all data rolls back at the end of the suite.
insert into auth.users(id,email,raw_user_meta_data) values
  ('d3150000-0000-0000-0000-000000000001','vod-app-coach@example.test','{"display_name":"VOD App Coach"}'),
  ('d3150000-0000-0000-0000-000000000002','vod-app-member@example.test','{"display_name":"VOD App Member"}'),
  ('d3150000-0000-0000-0000-000000000003','vod-app-unready@example.test','{"display_name":"VOD App Unready"}'),
  ('d3150000-0000-0000-0000-000000000004','vod-app-unknown@example.test','{"display_name":"VOD App Unknown"}'),
  ('d3150000-0000-0000-0000-000000000005','vod-app-provisional@example.test','{"display_name":"VOD App Provisional"}'),
  ('d3150000-0000-0000-0000-000000000006','vod-app-closing@example.test','{"display_name":"VOD App Closing"}'),
  ('d3150000-0000-0000-0000-000000000007','vod-app-program-member@example.test','{"display_name":"VOD App Program Member"}'),
  ('d3150000-0000-0000-0000-000000000008','vod-app-daily-outsider@example.test','{"display_name":"VOD App Daily Outsider"}');
update public.profiles set role='coach'
where id in ('d3150000-0000-0000-0000-000000000001','d3150000-0000-0000-0000-000000000003',
  'd3150000-0000-0000-0000-000000000004','d3150000-0000-0000-0000-000000000005',
  'd3150000-0000-0000-0000-000000000006');
update public.profiles set role='member'
where id in ('d3150000-0000-0000-0000-000000000002','d3150000-0000-0000-0000-000000000007',
  'd3150000-0000-0000-0000-000000000008');
insert into public.coach_members(coach_id,member_id)
values('d3150000-0000-0000-0000-000000000001','d3150000-0000-0000-0000-000000000002'),
  ('d3150000-0000-0000-0000-000000000001','d3150000-0000-0000-0000-000000000007'),
  ('d3150000-0000-0000-0000-000000000001','d3150000-0000-0000-0000-000000000008'),
  ('d3150000-0000-0000-0000-000000000005','d3150000-0000-0000-0000-000000000007');
insert into public.platform_test_entitlements(member_id,tier,grant_reason,granted_by)
values
  ('d3150000-0000-0000-0000-000000000002','regular','Synthetic VOD app playback fixture',
    'd3150000-0000-0000-0000-000000000001'),
  ('d3150000-0000-0000-0000-000000000007','regular','Synthetic VOD app playback fixture',
    'd3150000-0000-0000-0000-000000000001'),
  ('d3150000-0000-0000-0000-000000000008','regular','Synthetic VOD app playback fixture',
    'd3150000-0000-0000-0000-000000000001');

select ok(not has_table_privilege('anon','public.stream_media_upload_transport','select')
  and not has_table_privilege('authenticated','public.stream_media_upload_transport','select')
  and not has_table_privilege('service_role','public.stream_media_upload_transport','select'),
  'private TUS capabilities deny direct table reads for every API role');
select ok(not has_table_privilege('service_role','public.stream_media_upload_abort_manifests','insert')
  and not has_table_privilege('service_role','public.stream_media_upload_cancel_receipts','insert'),
  'service clients cannot forge upload abort manifests or terminal receipts');
select ok(not has_function_privilege('authenticated',
    'public.record_stream_media_upload_transport(uuid,uuid,text,text,text,timestamptz,integer,boolean,jsonb,text)','execute')
  and has_function_privilege('service_role',
    'public.record_stream_media_upload_transport(uuid,uuid,text,text,text,timestamptz,integer,boolean,jsonb,text)','execute'),
  'only the service adapter records provider transport observations');
select ok(has_function_privilege('authenticated','public.get_stream_media_upload_status(uuid)','execute')
  and has_function_privilege('authenticated','public.get_stream_media_upload_tus_location(uuid)','execute')
  and not has_function_privilege('anon','public.get_stream_media_upload_tus_location(uuid)','execute'),
  'signed-in callers have status and capability RPCs while anonymous callers do not');
select ok(has_function_privilege('authenticated','public.commit_stream_library_video_upload(uuid,uuid)','execute')
  and has_function_privilege('authenticated','public.publish_stream_community_video_submission(uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.commit_stream_library_video_upload(uuid,uuid)','execute'),
  'source commits are actor-bound RPCs rather than direct service table writes');
select is((select count(*)::bigint from public.stream_auth_cleanup_components component
  where component.required_for_auth),2::bigint,
  'the standalone E baseline requires only 310 core VOD and 315 upload-abort cleanup proofs');

set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.vod_registry',public.record_stream_provider_account_attestation(
  'd3151000-0000-0000-0000-000000000001',repeat('a',32),'vod_primary',repeat('1',64)
)->>'registry_id',true);
select is(public.record_stream_account_path_verification(
  'd3151000-0000-0000-0000-000000000002',current_setting('test.vod_registry')::uuid,
  'vod_primary',repeat('a',32),200::smallint,repeat('2',64)
)->>'outcome','verified','synthetic service evidence verifies the fixed provider account path');

-- Prepare a Library operation through the authenticated product RPC.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('test.vod_library_prepare',public.prepare_stream_library_video_upload(
  'd3152000-0000-0000-0000-000000000001','d3153000-0000-0000-0000-000000000001',
  'Synthetic private Library video','',repeat('3',64))::text,true);
select is(current_setting('test.vod_library_prepare')::jsonb->>'outcome','reserved',
  'Library preparation reserves an owner-scoped upload without inserting a video row');
select is(current_setting('test.vod_library_prepare')::jsonb->>'max_duration_seconds','7200',
  'the Library RPC preserves the existing two-hour server upload limit');
select is((select count(*)::bigint from public.videos
  where id='d3153000-0000-0000-0000-000000000001'),0::bigint,
  'file selection alone creates no Library source row');
select is(public.get_stream_media_upload_status(
  (current_setting('test.vod_library_prepare')::jsonb->>'operation_id')::uuid
)->>'operation_state','reserved','the initiating actor can read narrow operation status');

set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.claim_stream_media_create(
  (current_setting('test.vod_library_prepare')::jsonb->>'operation_id')::uuid,
  'd3152000-0000-0000-0000-000000000002',
  current_setting('test.vod_library_prepare')::jsonb->>'request_digest'
)->>'outcome','create_authorized','only a fresh create claim can authorize one provider POST');
select is(public.claim_stream_media_create(
  (current_setting('test.vod_library_prepare')::jsonb->>'operation_id')::uuid,
  'd3152000-0000-0000-0000-000000000002',
  current_setting('test.vod_library_prepare')::jsonb->>'request_digest'
)->>'create_authorized','false','a duplicate claim is recovery, not another provider POST');
select is(public.claim_stream_media_create(
  (current_setting('test.vod_library_prepare')::jsonb->>'operation_id')::uuid,
  'd3152000-0000-0000-0000-000000000002',repeat('f',64)
)->>'outcome','request_digest_mismatch','a stable claim cannot be replayed with changed request parameters');
select set_config('test.vod_expiry',(now()+interval '15 minutes')::text,true);
select is(public.record_stream_media_upload_transport(
  (current_setting('test.vod_library_prepare')::jsonb->>'operation_id')::uuid,
  (current_setting('test.vod_library_prepare')::jsonb->>'transport_request_id')::uuid,
  current_setting('test.vod_library_prepare')::jsonb->>'request_digest',
  'synthetic-vod-library-ready-uid','https://upload.provider.invalid/tus/library-one',
  current_setting('test.vod_expiry')::timestamptz,7200,true,
  current_setting('test.vod_library_prepare')::jsonb->'metadata',repeat('4',64)
)->>'outcome','recorded','provider transport evidence is stored against the original fixed request');
select is(public.record_stream_media_upload_transport(
  (current_setting('test.vod_library_prepare')::jsonb->>'operation_id')::uuid,
  (current_setting('test.vod_library_prepare')::jsonb->>'transport_request_id')::uuid,
  current_setting('test.vod_library_prepare')::jsonb->>'request_digest',
  'synthetic-vod-library-ready-uid','https://upload.provider.invalid/tus/library-one',
  current_setting('test.vod_expiry')::timestamptz,7201,true,
  current_setting('test.vod_library_prepare')::jsonb->'metadata',repeat('4',64)
)->>'outcome','identity_mismatch','a replay cannot change the original upload parameters');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.get_stream_media_upload_tus_location(
  (current_setting('test.vod_library_prepare')::jsonb->>'operation_id')::uuid
)->>'outcome','unavailable','another signed-in actor cannot retrieve the upload bearer capability');
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_stream_media_upload_tus_location(
  (current_setting('test.vod_library_prepare')::jsonb->>'operation_id')::uuid
)->>'tus_location','https://upload.provider.invalid/tus/library-one',
  'only the initiating eligible actor can retrieve the stored TUS capability');
select is(public.get_stream_media_upload_tus_location(
  (current_setting('test.vod_library_prepare')::jsonb->>'operation_id')::uuid
)->>'max_duration_seconds','7200','the immutable TUS DTO carries the route-compatible Library limit');
select ok(not (public.get_stream_media_upload_status(
  (current_setting('test.vod_library_prepare')::jsonb->>'operation_id')::uuid
) ? 'tus_location'), 'general status never returns a bearer capability');

set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.advance_stream_media_upload(
  (current_setting('test.vod_library_prepare')::jsonb->>'operation_id')::uuid,
  'd3152000-0000-0000-0000-000000000003','created_unverified',repeat('5',64)
)->>'outcome','advanced','the service records an unverified create reply before exact readback');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.vod_library_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'exact_uid_get','synthetic-vod-library-ready-uid',
  200::smallint,true,true,true,true,'d3152000-0000-0000-0000-000000000004',repeat('6',64)
)->>'outcome','recorded','exact provider GET evidence ties creator and marker to the operation');
select is(public.bind_stream_media_upload_readback(
  (current_setting('test.vod_library_prepare')::jsonb->>'operation_id')::uuid,
  'd3152000-0000-0000-0000-000000000004','d3152000-0000-0000-0000-000000000005'
)->>'outcome','provisional_bound','the canonical 310 readback RPC creates the provisional binding');
reset role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('test.vod_library_commit',public.commit_stream_library_video_upload(
  (current_setting('test.vod_library_prepare')::jsonb->>'operation_id')::uuid,
  'd3152000-0000-0000-0000-000000000006'
)::text,true);
select is(current_setting('test.vod_library_commit')::jsonb->>'outcome','ready_for_publication',
  'Library commit inserts its exact prospective video and finalizes in one transaction');
reset role;
select is((select count(*)::bigint from public.videos
  where id='d3153000-0000-0000-0000-000000000001'
    and coach_id='d3150000-0000-0000-0000-000000000001'
    and cloudflare_uid='synthetic-vod-library-ready-uid'
    and status::text='ready'),1::bigint,
  'the only committed video has the server-owned owner, UID, and ready state');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.commit_stream_library_video_upload(
  (current_setting('test.vod_library_prepare')::jsonb->>'operation_id')::uuid,
  'd3152000-0000-0000-0000-000000000006'
)->>'outcome','ready_for_publication','the same library commit request replays its immutable receipt');
select is(public.get_my_stream_library_video_playback(
  'd3153000-0000-0000-0000-000000000001'
)->>'outcome','ready','the Library playback projection resolves the owner’s exact ready binding');
select is(public.get_my_stream_library_video_playback(
  'd3153000-0000-0000-0000-000000000001'
)->>'provider_uid','synthetic-vod-library-ready-uid',
  'the Library signer receives only the verified UID from that owner-scoped projection');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.record_stream_media_upload_observation(
  (current_setting('test.vod_library_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'exact_uid_get','synthetic-vod-library-ready-uid',
  200::smallint,true,true,true,true,'d3152000-0000-0000-0000-000000000007',repeat('9',64)
)->>'outcome','recorded','a later exact ready observation is durably ordered after Library finalization');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.vod_library_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'exact_uid_get','synthetic-vod-library-ready-uid',
  200::smallint,true,false,true,false,'d3152000-0000-0000-0000-000000000008',repeat('a',64)
)->>'outcome','recorded','a later contradictory exact observation remains auditable after Library finalization');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.commit_stream_library_video_upload(
  (current_setting('test.vod_library_prepare')::jsonb->>'operation_id')::uuid,
  'd3152000-0000-0000-0000-000000000006'
)->>'outcome','ready_for_publication',
  'a lost Library response retries from the immutable receipt despite later contradictory observations');
select ok(not (public.commit_stream_library_video_upload(
  (current_setting('test.vod_library_prepare')::jsonb->>'operation_id')::uuid,
  'd3152000-0000-0000-0000-000000000006'
) ? 'provider_uid'),
  'a completed Library receipt replay is not a new provider UID authorization');

-- A different successful Library upload and a pre-create cancellation both advance the
-- profile fence without invalidating the exact ready binding for the original video.
select set_config('test.vod_library_second_prepare',public.prepare_stream_library_video_upload(
  'd3159400-0000-0000-0000-000000000001','d3153000-0000-0000-0000-000000000013',
  'Synthetic second Library video','',repeat('b',64))::text,true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.claim_stream_media_create(
  (current_setting('test.vod_library_second_prepare')::jsonb->>'operation_id')::uuid,
  'd3159400-0000-0000-0000-000000000002',
  current_setting('test.vod_library_second_prepare')::jsonb->>'request_digest'
)->>'outcome','create_authorized','the same coach can start a second Library upload after the first commits');
select is(public.record_stream_media_upload_transport(
  (current_setting('test.vod_library_second_prepare')::jsonb->>'operation_id')::uuid,
  (current_setting('test.vod_library_second_prepare')::jsonb->>'transport_request_id')::uuid,
  current_setting('test.vod_library_second_prepare')::jsonb->>'request_digest',
  'synthetic-vod-library-second-uid','https://upload.provider.invalid/tus/library-two',
  (now()+interval '15 minutes')::timestamptz,7200,true,
  current_setting('test.vod_library_second_prepare')::jsonb->'metadata',repeat('c',64)
)->>'outcome','recorded','the second Library UID is stored against its own immutable transport');
select is(public.advance_stream_media_upload(
  (current_setting('test.vod_library_second_prepare')::jsonb->>'operation_id')::uuid,
  'd3159400-0000-0000-0000-000000000003','created_unverified',repeat('d',64)
)->>'outcome','advanced','the second Library create remains unverified until exact readback');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.vod_library_second_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'exact_uid_get','synthetic-vod-library-second-uid',
  200::smallint,true,true,true,true,'d3159400-0000-0000-0000-000000000004',repeat('e',64)
)->>'outcome','recorded','the second Library response has its own trusted exact GET evidence');
select is(public.bind_stream_media_upload_readback(
  (current_setting('test.vod_library_second_prepare')::jsonb->>'operation_id')::uuid,
  'd3159400-0000-0000-0000-000000000004','d3159400-0000-0000-0000-000000000005'
)->>'outcome','provisional_bound','the second Library UID binds only to its exact prospective source');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_my_stream_library_video_playback(
  'd3153000-0000-0000-0000-000000000001'
)->>'outcome','ready',
  'the first exact Library binding stays playable while a different same-owner upload holds the profile fence');
select is(public.commit_stream_library_video_upload(
  (current_setting('test.vod_library_second_prepare')::jsonb->>'operation_id')::uuid,
  'd3159400-0000-0000-0000-000000000006'
)->>'outcome','ready_for_publication','the second source commits atomically under the same owner profile');
select is(public.get_my_stream_library_video_playback(
  'd3153000-0000-0000-0000-000000000001'
)->>'outcome','ready','a later Library commit preserves playback of the first exact ready binding');
select set_config('test.vod_library_prehttp_prepare',public.prepare_stream_library_video_upload(
  'd3159500-0000-0000-0000-000000000001','d3153000-0000-0000-0000-000000000014',
  'Synthetic pre-create fence advance','',repeat('f',64))::text,true);
select is(public.cancel_stream_media_upload_before_create(
  (current_setting('test.vod_library_prehttp_prepare')::jsonb->>'operation_id')::uuid,
  'd3159500-0000-0000-0000-000000000002'
)->>'outcome','canceled_without_provider_create',
  'a same-owner pre-create cancellation truthfully reopens the advanced profile fence');
select is(public.get_my_stream_library_video_playback(
  'd3153000-0000-0000-0000-000000000001'
)->>'outcome','ready','a pre-create cancellation also preserves the original ready Library binding');
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000005","role":"authenticated"}';
select is(public.get_my_stream_library_video_playback(
  'd3153000-0000-0000-0000-000000000001'
)->>'outcome','unavailable','another eligible coach cannot read the owner’s Library playback identity');
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_stream_media_upload_tus_location(
  (current_setting('test.vod_library_prepare')::jsonb->>'operation_id')::uuid
)->>'outcome','unavailable','a completed upload cannot retrieve its expired operation capability');

-- A separately retained UID cannot enter the destructive unready lane.
select set_config('test.vod_retained_prepare',public.prepare_stream_library_video_upload(
  'd3152600-0000-0000-0000-000000000001','d3153000-0000-0000-0000-000000000007',
  'Synthetic retained probe','',repeat('6',64))::text,true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.claim_stream_media_create(
  (current_setting('test.vod_retained_prepare')::jsonb->>'operation_id')::uuid,
  'd3152600-0000-0000-0000-000000000002',
  current_setting('test.vod_retained_prepare')::jsonb->>'request_digest'
)->>'outcome','create_authorized','retention fixture starts through the normal create claim');
select set_config('test.vod_retained_expiry',(now()+interval '15 minutes')::text,true);
select is(public.record_stream_media_upload_transport(
  (current_setting('test.vod_retained_prepare')::jsonb->>'operation_id')::uuid,
  (current_setting('test.vod_retained_prepare')::jsonb->>'transport_request_id')::uuid,
  current_setting('test.vod_retained_prepare')::jsonb->>'request_digest',
  'synthetic-vod-retained-abort-uid','https://upload.provider.invalid/tus/retained-one',
  current_setting('test.vod_retained_expiry')::timestamptz,7200,true,
  current_setting('test.vod_retained_prepare')::jsonb->'metadata',repeat('7',64)
)->>'outcome','recorded','retention fixture receives an exact service transport response');
select is(public.advance_stream_media_upload(
  (current_setting('test.vod_retained_prepare')::jsonb->>'operation_id')::uuid,
  'd3152600-0000-0000-0000-000000000003','created_unverified',repeat('8',64)
)->>'outcome','advanced','retention fixture remains unready before source binding');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.vod_retained_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'exact_uid_get','synthetic-vod-retained-abort-uid',
  200::smallint,false,true,true,false,'d3152600-0000-0000-0000-000000000004',repeat('9',64)
)->>'outcome','recorded','retention fixture has exact creator and marker but remains unready');
reset role;
select private.stream_set_retention_obligation(
  current_setting('test.vod_registry')::uuid,'synthetic-vod-retained-abort-uid',
  'program_offer','d315-synthetic-retained-probe',1::bigint,'marketed_offer',true,null::uuid,
  'synthetic_retained','d3152600-0000-0000-0000-000000000005',repeat('a',64));
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.request_stream_media_upload_cancel(
  (current_setting('test.vod_retained_prepare')::jsonb->>'operation_id')::uuid,
  'd3152600-0000-0000-0000-000000000006'
)->>'outcome','legacy_or_retained_uid_hold',
  'an active retention obligation prevents unready UID destruction');

-- The community parent is created only on submit and remains only_me while processing.
select set_config('test.vod_community_prepare',public.prepare_stream_community_video_submission(
  'd3152100-0000-0000-0000-000000000001','',repeat('7',64),'announcement','everyone',null
)::text,true);
select is(current_setting('test.vod_community_prepare')::jsonb->>'outcome','processing',
  'an empty-body video submission receives a private processing parent on submit');
select is((select audience from public.posts
  where id=(current_setting('test.vod_community_prepare')::jsonb->>'post_id')::uuid),'only_me',
  'a submitted video post stays private until the atomic publication RPC');
select is((select kind from public.posts
  where id=(current_setting('test.vod_community_prepare')::jsonb->>'post_id')::uuid),'general',
  'the only_me processing parent is always general regardless of intended post kind');
select throws_ok(format('update public.posts set audience=''everyone'' where id=%L',
    current_setting('test.vod_community_prepare')::jsonb->>'post_id'),
  '42501',null,'ordinary direct post promotion is rejected while the media submission processes');
select throws_ok(format('update public.posts set kind=''workout'' where id=%L',
    current_setting('test.vod_community_prepare')::jsonb->>'post_id'),
  '42501',null,'ordinary edits cannot change an immutable processing post intent');

set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.claim_stream_media_create(
  (current_setting('test.vod_community_prepare')::jsonb->>'operation_id')::uuid,
  'd3152100-0000-0000-0000-000000000002',
  current_setting('test.vod_community_prepare')::jsonb->>'request_digest'
)->>'outcome','create_authorized','the community adapter receives one fresh create authorization');
select set_config('test.vod_community_expiry',(now()+interval '15 minutes')::text,true);
select is(public.record_stream_media_upload_transport(
  (current_setting('test.vod_community_prepare')::jsonb->>'operation_id')::uuid,
  (current_setting('test.vod_community_prepare')::jsonb->>'transport_request_id')::uuid,
  current_setting('test.vod_community_prepare')::jsonb->>'request_digest',
  'synthetic-vod-community-ready-uid','https://upload.provider.invalid/tus/community-one',
  current_setting('test.vod_community_expiry')::timestamptz,600,true,
  current_setting('test.vod_community_prepare')::jsonb->'metadata',repeat('8',64)
)->>'outcome','recorded','community transport remains private and operation-bound');
select is(public.advance_stream_media_upload(
  (current_setting('test.vod_community_prepare')::jsonb->>'operation_id')::uuid,
  'd3152100-0000-0000-0000-000000000003','created_unverified',repeat('9',64)
)->>'outcome','advanced','community create response remains unverified until exact readback');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.vod_community_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'exact_uid_get','synthetic-vod-community-ready-uid',
  200::smallint,true,true,true,true,'d3152100-0000-0000-0000-000000000004',repeat('a',64)
)->>'outcome','recorded','community exact GET evidence confirms provider ownership and readiness');
select is(public.bind_stream_media_upload_readback(
  (current_setting('test.vod_community_prepare')::jsonb->>'operation_id')::uuid,
  'd3152100-0000-0000-0000-000000000004','d3152100-0000-0000-0000-000000000005'
)->>'outcome','provisional_bound','the provider UID remains provisional until publication');
reset role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('test.vod_community_publish',public.publish_stream_community_video_submission(
  (current_setting('test.vod_community_prepare')::jsonb->>'submission_id')::uuid,
  'd3152100-0000-0000-0000-000000000006'
)::text,true);
select is(current_setting('test.vod_community_publish')::jsonb->>'outcome','published',
  'publication atomically attaches completed video media and applies intended audience');
select is((select audience from public.posts
  where id=(current_setting('test.vod_community_prepare')::jsonb->>'post_id')::uuid),'everyone',
  'publication applies the immutable intended audience only after media binding checks');
select is((select kind from public.posts
  where id=(current_setting('test.vod_community_prepare')::jsonb->>'post_id')::uuid),'announcement',
  'valid coach announcement publication applies its immutable kind only with the receipt');
select is((select body from public.posts
  where id=(current_setting('test.vod_community_prepare')::jsonb->>'post_id')::uuid),'',
  'a video-only community post keeps the exact empty body');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.record_stream_media_upload_observation(
  (current_setting('test.vod_community_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'exact_uid_get','synthetic-vod-community-ready-uid',
  200::smallint,true,true,true,true,'d3152100-0000-0000-0000-000000000007',repeat('1',64)
)->>'outcome','recorded','a later exact ready observation is durably ordered after publication');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.vod_community_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'exact_uid_get','synthetic-vod-community-ready-uid',
  200::smallint,true,false,true,false,'d3152100-0000-0000-0000-000000000008',repeat('2',64)
)->>'outcome','recorded','a later contradictory exact observation remains auditable');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.publish_stream_community_video_submission(
  (current_setting('test.vod_community_prepare')::jsonb->>'submission_id')::uuid,
  'd3152100-0000-0000-0000-000000000006'
)->>'outcome','published','repeated publication returns the stored receipt without another media insert');
select ok(not (public.publish_stream_community_video_submission(
  (current_setting('test.vod_community_prepare')::jsonb->>'submission_id')::uuid,
  'd3152100-0000-0000-0000-000000000006'
) ? 'provider_uid'),
  'an immutable publication replay returns no provider UID or signer capability');
select is((select count(*)::bigint from public.post_media media
  where media.id=(current_setting('test.vod_community_prepare')::jsonb->>'media_id')::uuid),
  1::bigint,'publication creates one exact post_media binding');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.get_visible_stream_post_video_playback(
  (current_setting('test.vod_community_prepare')::jsonb->>'post_id')::uuid,
  (current_setting('test.vod_community_prepare')::jsonb->>'media_id')::uuid
)->>'outcome','ready','visible post_media can project its exact ready UID without a videos row');
select is(public.get_visible_stream_post_video_playback(
  (current_setting('test.vod_community_prepare')::jsonb->>'post_id')::uuid,
  'd3153000-0000-0000-0000-000000000001'
)->>'outcome','unavailable','post playback cannot cross to another media identity');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.prepare_stream_community_video_submission(
  'd3152200-0000-0000-0000-000000000001','',repeat('b',64),'announcement','only_me',null
)->>'outcome','posting_rights_revoked','a member cannot use a private processing parent to bypass announcement rights');
select is(public.prepare_stream_community_video_submission(
  'd3152200-0000-0000-0000-000000000007','',repeat('c',64),'challenge','only_me',null
)->>'outcome','posting_rights_revoked','a member cannot publish a challenge to only_me contrary to canonical post policy');
select is(public.prepare_stream_community_video_submission(
  'd3152200-0000-0000-0000-000000000008','',repeat('d',64),'announcement','only_me',null
)->>'outcome','posting_rights_revoked','a member cannot publish an announcement to only_me contrary to canonical post policy');
select set_config('test.vod_private_general_prepare',public.prepare_stream_community_video_submission(
  'd3152200-0000-0000-0000-000000000009','',repeat('e',64),'general','only_me',null
)::text,true);
select is(current_setting('test.vod_private_general_prepare')::jsonb->>'outcome','processing',
  'a permitted private general video submission can enter processing');
select ok((select post.kind='general' and post.audience='only_me' and post.coach_id is null
    and post.body='' and post.removed_at is null
  from public.posts post where post.id=(current_setting('test.vod_private_general_prepare')::jsonb->>'post_id')::uuid),
  'the accepted private submission stores only a private general parent before publication');

-- Posting rights are checked again after media readback; membership loss leaves the post private.
select set_config('test.vod_revoked_prepare',public.prepare_stream_community_video_submission(
  'd3152210-0000-0000-0000-000000000001','Member video',repeat('c',64),
  'general','coach_community','d3150000-0000-0000-0000-000000000001'
)::text,true);
select is(current_setting('test.vod_revoked_prepare')::jsonb->>'outcome','processing',
  'a current coach-community member can submit a video to the private processing parent');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.claim_stream_media_create(
  (current_setting('test.vod_revoked_prepare')::jsonb->>'operation_id')::uuid,
  'd3152210-0000-0000-0000-000000000002',
  current_setting('test.vod_revoked_prepare')::jsonb->>'request_digest'
)->>'outcome','create_authorized','the member media upload receives one provider create claim');
select is(public.record_stream_media_upload_transport(
  (current_setting('test.vod_revoked_prepare')::jsonb->>'operation_id')::uuid,
  (current_setting('test.vod_revoked_prepare')::jsonb->>'transport_request_id')::uuid,
  current_setting('test.vod_revoked_prepare')::jsonb->>'request_digest',
  'synthetic-vod-community-revoked-uid','https://upload.provider.invalid/tus/community-revoked',
  (now()+interval '15 minutes')::timestamptz,600,true,
  current_setting('test.vod_revoked_prepare')::jsonb->'metadata',repeat('d',64)
)->>'outcome','recorded','the member media transport is durably associated with its immutable intent');
select is(public.advance_stream_media_upload(
  (current_setting('test.vod_revoked_prepare')::jsonb->>'operation_id')::uuid,
  'd3152210-0000-0000-0000-000000000003','created_unverified',repeat('e',64)
)->>'outcome','advanced','the provider create response remains unverified before exact readback');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.vod_revoked_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'exact_uid_get','synthetic-vod-community-revoked-uid',
  200::smallint,true,true,true,true,'d3152210-0000-0000-0000-000000000004',repeat('f',64)
)->>'outcome','recorded','the exact UID readback proves creator, marker, signed URLs, and readiness');
select is(public.bind_stream_media_upload_readback(
  (current_setting('test.vod_revoked_prepare')::jsonb->>'operation_id')::uuid,
  'd3152210-0000-0000-0000-000000000004','d3152210-0000-0000-0000-000000000005'
)->>'outcome','provisional_bound','member media remains provisional until publication rechecks rights');
reset role;
delete from public.coach_members
where coach_id='d3150000-0000-0000-0000-000000000001'
  and member_id='d3150000-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.publish_stream_community_video_submission(
  (current_setting('test.vod_revoked_prepare')::jsonb->>'submission_id')::uuid,
  'd3152210-0000-0000-0000-000000000006'
)->>'outcome','posting_rights_revoked','revoked coach-community membership blocks final publication');
select is((select audience from public.posts
  where id=(current_setting('test.vod_revoked_prepare')::jsonb->>'post_id')::uuid),'only_me',
  'membership loss leaves the processing parent private');
select is((select count(*)::bigint from public.post_media media
  where media.id=(current_setting('test.vod_revoked_prepare')::jsonb->>'media_id')::uuid),
  0::bigint,'revoked membership cannot create a publishable post_media row');

-- Unready but known UID: no fake asset/binding is made. A lost DELETE response is resolved
-- only by a durable start event and an exact GET 404 for that known account+UID.
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000003","role":"authenticated"}';
select set_config('test.vod_unready_prepare',public.prepare_stream_library_video_upload(
  'd3152300-0000-0000-0000-000000000001','d3153000-0000-0000-0000-000000000003',
  'Synthetic unready video','',repeat('c',64))::text,true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.claim_stream_media_create(
  (current_setting('test.vod_unready_prepare')::jsonb->>'operation_id')::uuid,
  'd3152300-0000-0000-0000-000000000002',
  current_setting('test.vod_unready_prepare')::jsonb->>'request_digest'
)->>'outcome','create_authorized','known-unready fixture starts from one fresh create claim');
select is(public.record_stream_media_upload_transport(
  (current_setting('test.vod_unready_prepare')::jsonb->>'operation_id')::uuid,
  (current_setting('test.vod_unready_prepare')::jsonb->>'transport_request_id')::uuid,
  current_setting('test.vod_unready_prepare')::jsonb->>'request_digest',
  'synthetic-vod-unready-uid',null,null::timestamptz,7200,true,
  current_setting('test.vod_unready_prepare')::jsonb->'metadata',repeat('d',64)
)->>'outcome','known_uid_location_missing','a known UID with missing Location is durably held for recovery');
select is(public.advance_stream_media_upload(
  (current_setting('test.vod_unready_prepare')::jsonb->>'operation_id')::uuid,
  'd3152300-0000-0000-0000-000000000003','created_unverified',repeat('e',64)
)->>'outcome','advanced','the upload stays unverified while its transport capability is unavailable');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.vod_unready_prepare')::jsonb->>'operation_id')::uuid,
  'd315ffff-0000-0000-0000-000000000099'::uuid,'exact_uid_get','synthetic-vod-unready-uid',
  200::smallint,true,true,true,true,'d3152300-0000-0000-0000-000000000011',repeat('a',64)
)->>'outcome','operation_mismatch','an observation cannot move this upload to a foreign provider registry');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.vod_unready_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'exact_uid_get','synthetic-vod-foreign-uid',
  200::smallint,false,true,true,false,'d3152300-0000-0000-0000-000000000012',repeat('b',64)
)->>'outcome','recorded','a different UID remains distinct from the durable create response UID');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.vod_unready_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'exact_uid_get','synthetic-vod-unready-uid',
  200::smallint,false,false,true,false,'d3152300-0000-0000-0000-000000000013',repeat('c',64)
)->>'outcome','recorded','a UID observation with a mismatched creator remains a separate untrusted observation');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(public.request_stream_media_upload_cancel(
  (current_setting('test.vod_unready_prepare')::jsonb->>'operation_id')::uuid,
  'd3152300-0000-0000-0000-000000000005'
)->>'outcome','known_owned_unready_identity_not_proven',
  'a different exact-GET UID cannot stand in for the durable create response UID');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.record_stream_media_upload_observation(
  (current_setting('test.vod_unready_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'exact_uid_get','synthetic-vod-unready-uid',
  200::smallint,false,true,false,false,'d3152300-0000-0000-0000-000000000014',repeat('d',64)
)->>'outcome','recorded','a mismatched intent marker remains untrusted even for the expected UID');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(public.request_stream_media_upload_cancel(
  (current_setting('test.vod_unready_prepare')::jsonb->>'operation_id')::uuid,
  'd3152300-0000-0000-0000-000000000005'
)->>'outcome','known_owned_unready_identity_not_proven',
  'a mismatched creator or intent marker cannot authorize destructive cleanup');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.record_stream_media_upload_observation(
  (current_setting('test.vod_unready_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'exact_uid_get','synthetic-vod-unready-uid',
  200::smallint,false,true,true,false,'d3152300-0000-0000-0000-000000000004',repeat('f',64)
)->>'outcome','recorded','exact UID readback records creator and marker without asserting readiness');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000003","role":"authenticated"}';
select set_config('test.vod_unready_cancel',public.request_stream_media_upload_cancel(
  (current_setting('test.vod_unready_prepare')::jsonb->>'operation_id')::uuid,
  'd3152300-0000-0000-0000-000000000005'
)::text,true);
select is(current_setting('test.vod_unready_cancel')::jsonb->>'cleanup_manifest_kind','unready_abort',
  'the unready cleanup path uses its own binderless immutable manifest');
select is(public.request_stream_media_upload_cancel(
  (current_setting('test.vod_unready_prepare')::jsonb->>'operation_id')::uuid,
  'd3152300-0000-0000-0000-000000000005'
)->>'outcome','cancel_in_progress',
  'an exact unready cancellation replay is recognized before lifecycle-state prerequisites');
select is(public.request_stream_media_upload_cancel(
  (current_setting('test.vod_unready_prepare')::jsonb->>'operation_id')::uuid,
  'd3152300-0000-0000-0000-000000000015'
)->>'outcome','identity_mismatch',
  'an existing unready abort cannot be claimed by a changed cancellation request');
reset role;
select is((select count(*)::bigint from public.stream_media_assets asset
  where asset.registry_id=current_setting('test.vod_registry')::uuid
    and asset.raw_provider_uid='synthetic-vod-unready-uid'),0::bigint,
  'an unready UID is never written as a canonical asset');
select is((select count(*)::bigint from public.stream_media_source_bindings binding
  where binding.registry_id=current_setting('test.vod_registry')::uuid
    and binding.raw_provider_uid='synthetic-vod-unready-uid'),0::bigint,
  'an unready UID is never written as a canonical source binding');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.start_stream_media_uid_delete(
  (current_setting('test.vod_unready_cancel')::jsonb->>'cleanup_operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'synthetic-vod-unready-uid',
  'd3152300-0000-0000-0000-000000000006',repeat('1',64)
)->>'outcome','delete_started','the cleanup-only manifest authorizes a delete start for its exact UID');
select is(public.record_stream_media_uid_delete_result(
  (current_setting('test.vod_unready_cancel')::jsonb->>'cleanup_operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'synthetic-vod-unready-uid',
  'delete_unknown',503::smallint,200::smallint,'d3152300-0000-0000-0000-000000000007',repeat('2',64)
)->>'outcome','recorded','a lost or failed response with the object still present stays unknown');
select is(public.finalize_stream_media_upload_cancel(
  (current_setting('test.vod_unready_prepare')::jsonb->>'operation_id')::uuid,
  'd3152300-0000-0000-0000-000000000005',
  (current_setting('test.vod_unready_cancel')::jsonb->>'cleanup_operation_id')::uuid,
  'd3152300-0000-0000-0000-000000000007'
)->>'outcome','qualified_exact_absence_required','a still-present exact GET prevents terminal cancellation');
select is(public.start_stream_media_uid_delete(
  (current_setting('test.vod_unready_cancel')::jsonb->>'cleanup_operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'synthetic-vod-unready-uid',
  'd3152300-0000-0000-0000-000000000008',repeat('3',64)
)->>'outcome','delete_started','a lost response can be reconciled under a later durable delete start');
select is(public.record_stream_media_uid_delete_result(
  (current_setting('test.vod_unready_cancel')::jsonb->>'cleanup_operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'synthetic-vod-unready-uid',
  'already_absent_confirmed',null::smallint,404::smallint,
  'd3152300-0000-0000-0000-000000000009',repeat('4',64)
)->>'outcome','recorded','only an exact GET 404 after durable delete start proves lost-response absence');
select is(public.finalize_stream_media_upload_cancel(
  (current_setting('test.vod_unready_prepare')::jsonb->>'operation_id')::uuid,
  'd3152300-0000-0000-0000-000000000005',
  (current_setting('test.vod_unready_cancel')::jsonb->>'cleanup_operation_id')::uuid,
  'd3152300-0000-0000-0000-000000000009'
)->>'outcome','canceled','the exact absent UID completes the immutable cancellation receipt');
reset role;
select ok(private.stream_upload_cancel_proven(
  (current_setting('test.vod_unready_prepare')::jsonb->>'operation_id')::uuid),
  'the terminal unready receipt joins its exact manifest, UID event, and cleanup receipt');
select ok((select observation_clock.order_sequence<absence_clock.order_sequence
  from public.stream_media_upload_observations observation
  join public.stream_media_upload_observation_clocks observation_clock
    on observation_clock.observation_id=observation.id
  join public.stream_media_upload_cancel_receipts receipt on receipt.operation_id=observation.operation_id
  join public.stream_media_operation_uid_events absence_event
    on absence_event.operation_id=receipt.cleanup_operation_id
    and absence_event.request_id='d3152300-0000-0000-0000-000000000009'
    and absence_event.outcome='already_absent_confirmed'
  join public.stream_media_operation_uid_event_clocks absence_clock
    on absence_clock.event_id=absence_event.id
  where observation.operation_id=(current_setting('test.vod_unready_prepare')::jsonb->>'operation_id')::uuid
    and observation.request_id='d3152300-0000-0000-0000-000000000004'),
  'database evidence sequence orders the exact creator-marker GET before same-transaction absence');
select ok((select state.operation_state='canceled'
  from public.stream_media_operation_states state
  where state.operation_id=(current_setting('test.vod_unready_prepare')::jsonb->>'operation_id')::uuid),
  'the upload reaches canceled only after the exact absence proof');

-- A provider contradiction arriving after cancellation invalidates its receipt and account
-- inventory proof, so Auth cannot consume a stale success.
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.record_stream_media_upload_observation(
  (current_setting('test.vod_unready_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'exact_uid_get','synthetic-vod-unready-uid',
  200::smallint,true,true,true,true,'d3152300-0000-0000-0000-000000000010',repeat('5',64)
)->>'outcome','recorded','a late exact provider contradiction is durably recorded for reconciliation');
select is(public.bind_stream_media_upload_readback(
  (current_setting('test.vod_unready_prepare')::jsonb->>'operation_id')::uuid,
  'd3152300-0000-0000-0000-000000000010','d3152300-0000-0000-0000-000000000013'
)->>'outcome','source_stale','a late exact ready callback cannot create a binding after cancellation released the fence');
reset role;
select ok(not private.stream_upload_cancel_proven(
    (current_setting('test.vod_unready_prepare')::jsonb->>'operation_id')::uuid)
  and private.stream_vod_upload_abort_inventory_digest('d3150000-0000-0000-0000-000000000003') is null,
  'a late exact UID-present observation invalidates cancellation and the Auth component inventory');
select ok((select late_clock.order_sequence>absence_clock.order_sequence
    and late_observation.created_at=absence_event.created_at
  from public.stream_media_upload_observations late_observation
  join public.stream_media_upload_observation_clocks late_clock
    on late_clock.observation_id=late_observation.id
  join public.stream_media_upload_cancel_receipts receipt
    on receipt.operation_id=late_observation.operation_id
  join public.stream_media_operation_uid_events absence_event
    on absence_event.operation_id=receipt.cleanup_operation_id
    and absence_event.request_id='d3152300-0000-0000-0000-000000000009'
    and absence_event.outcome='already_absent_confirmed'
  join public.stream_media_operation_uid_event_clocks absence_clock
    on absence_clock.event_id=absence_event.id
  where late_observation.operation_id=(current_setting('test.vod_unready_prepare')::jsonb->>'operation_id')::uuid
    and late_observation.request_id='d3152300-0000-0000-0000-000000000010'),
  'same-transaction evidence has tied transaction timestamps while the database sequence detects later contradiction');

-- A synthetically conflicting trusted readback cannot turn an existing ready UID into a second
-- destructive candidate. The test reports no readiness and expects the shared asset to hold.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000003","role":"authenticated"}';
select set_config('test.vod_shared_prepare',public.prepare_stream_library_video_upload(
  'd3152700-0000-0000-0000-000000000001','d3153000-0000-0000-0000-000000000008',
  'Synthetic conflicting UID','',repeat('8',64))::text,true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.claim_stream_media_create(
  (current_setting('test.vod_shared_prepare')::jsonb->>'operation_id')::uuid,
  'd3152700-0000-0000-0000-000000000002',
  current_setting('test.vod_shared_prepare')::jsonb->>'request_digest'
)->>'outcome','create_authorized','the conflicting UID case still starts from one normal service claim');
select is(public.record_stream_media_upload_transport(
  (current_setting('test.vod_shared_prepare')::jsonb->>'operation_id')::uuid,
  (current_setting('test.vod_shared_prepare')::jsonb->>'transport_request_id')::uuid,
  current_setting('test.vod_shared_prepare')::jsonb->>'request_digest',
  'synthetic-vod-library-ready-uid','https://upload.provider.invalid/tus/shared',
  (now()+interval '15 minutes')::timestamptz,7200,true,
  current_setting('test.vod_shared_prepare')::jsonb->'metadata',repeat('9',64)
)->>'outcome','recorded','the synthetic conflicting provider response is persisted without making a ready asset');
select is(public.advance_stream_media_upload(
  (current_setting('test.vod_shared_prepare')::jsonb->>'operation_id')::uuid,
  'd3152700-0000-0000-0000-000000000003','created_unverified',repeat('a',64)
)->>'outcome','advanced','the conflicting upload remains unready');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.vod_shared_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'exact_uid_get','synthetic-vod-library-ready-uid',
  200::smallint,false,true,true,false,'d3152700-0000-0000-0000-000000000004',repeat('b',64)
)->>'outcome','recorded','the local test readback reports creator and marker but explicitly reports not ready');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(public.request_stream_media_upload_cancel(
  (current_setting('test.vod_shared_prepare')::jsonb->>'operation_id')::uuid,
  'd3152700-0000-0000-0000-000000000005'
)->>'outcome','known_owned_unready_identity_not_proven',
  'an existing ready asset or binding prevents its UID from entering another cleanup manifest');
reset role;
select is((select count(*)::bigint from public.stream_media_upload_abort_manifests manifest
  where manifest.upload_operation_id=(current_setting('test.vod_shared_prepare')::jsonb->>'operation_id')::uuid),
  0::bigint,'the shared UID hold creates no destructive cleanup-only manifest');

-- A source-ready-but-uninserted provisional Library object uses its actual canonical binding,
-- then detaches only after exact deletion and absence evidence. It never commits a video row.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000005","role":"authenticated"}';
select set_config('test.vod_provisional_prepare',public.prepare_stream_library_video_upload(
  'd3152400-0000-0000-0000-000000000001','d3153000-0000-0000-0000-000000000005',
  'Synthetic provisional video','',repeat('6',64))::text,true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.claim_stream_media_create(
  (current_setting('test.vod_provisional_prepare')::jsonb->>'operation_id')::uuid,
  'd3152400-0000-0000-0000-000000000002',
  current_setting('test.vod_provisional_prepare')::jsonb->>'request_digest'
)->>'outcome','create_authorized','provisional crash fixture gets one create claim');
select set_config('test.vod_provisional_expiry',(now()+interval '15 minutes')::text,true);
select is(public.record_stream_media_upload_transport(
  (current_setting('test.vod_provisional_prepare')::jsonb->>'operation_id')::uuid,
  (current_setting('test.vod_provisional_prepare')::jsonb->>'transport_request_id')::uuid,
  current_setting('test.vod_provisional_prepare')::jsonb->>'request_digest',
  'synthetic-vod-provisional-uid','https://upload.provider.invalid/tus/provisional-one',
  current_setting('test.vod_provisional_expiry')::timestamptz,7200,true,
  current_setting('test.vod_provisional_prepare')::jsonb->'metadata',repeat('7',64)
)->>'outcome','recorded','provisional fixture stores fixed original provider transport');
select is(public.advance_stream_media_upload(
  (current_setting('test.vod_provisional_prepare')::jsonb->>'operation_id')::uuid,
  'd3152400-0000-0000-0000-000000000003','created_unverified',repeat('8',64)
)->>'outcome','advanced','provisional readback remains uncommitted until source insertion');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.vod_provisional_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'exact_uid_get','synthetic-vod-provisional-uid',
  200::smallint,true,true,true,true,'d3152400-0000-0000-0000-000000000004',repeat('9',64)
)->>'outcome','recorded','the provider reports exact ready creator and intent markers');
select is(public.bind_stream_media_upload_readback(
  (current_setting('test.vod_provisional_prepare')::jsonb->>'operation_id')::uuid,
  'd3152400-0000-0000-0000-000000000004','d3152400-0000-0000-0000-000000000005'
)->>'outcome','provisional_bound','the canonical 310 RPC creates the exact provisional binding');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000005","role":"authenticated"}';
select set_config('test.vod_provisional_cancel',public.request_stream_media_upload_cancel(
  (current_setting('test.vod_provisional_prepare')::jsonb->>'operation_id')::uuid,
  'd3152400-0000-0000-0000-000000000006'
)::text,true);
select is(current_setting('test.vod_provisional_cancel')::jsonb->>'cleanup_manifest_kind','canonical_provisional',
  'a ready-but-uninserted object uses only its exact canonical provisional binding');
select is(public.request_stream_media_upload_cancel(
  (current_setting('test.vod_provisional_prepare')::jsonb->>'operation_id')::uuid,
  'd3152400-0000-0000-0000-000000000006'
)->>'outcome','cancel_in_progress',
  'a canonical replay is handled after its asset enters cleanup_pending');
select is(public.request_stream_media_upload_cancel(
  (current_setting('test.vod_provisional_prepare')::jsonb->>'operation_id')::uuid,
  'd3152400-0000-0000-0000-000000000016'
)->>'outcome','identity_mismatch',
  'a canonical cleanup reservation cannot be replayed under a different request ID');
select is((select count(*)::bigint from public.videos
  where id='d3153000-0000-0000-0000-000000000005'),0::bigint,
  'provisional cancellation never fabricates a source video');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.start_stream_media_uid_delete(
  (current_setting('test.vod_provisional_cancel')::jsonb->>'cleanup_operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'synthetic-vod-provisional-uid',
  'd3152400-0000-0000-0000-000000000007',repeat('a',64)
)->>'outcome','delete_started','canonical provisional cleanup starts the exact manifest UID');
select is(public.record_stream_media_uid_delete_result(
  (current_setting('test.vod_provisional_cancel')::jsonb->>'cleanup_operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'synthetic-vod-provisional-uid',
  'deleted_confirmed',204::smallint,404::smallint,
  'd3152400-0000-0000-0000-000000000008',repeat('b',64)
)->>'outcome','recorded','a successful DELETE plus exact GET absence is accepted');
select is(public.finalize_stream_media_upload_cancel(
  (current_setting('test.vod_provisional_prepare')::jsonb->>'operation_id')::uuid,
  'd3152400-0000-0000-0000-000000000006',
  (current_setting('test.vod_provisional_cancel')::jsonb->>'cleanup_operation_id')::uuid,
  'd3152400-0000-0000-0000-000000000008'
)->>'outcome','canceled','the provisional UID is terminal only after exact DELETE and GET absence');
reset role;
select ok(exists(select 1 from public.stream_media_upload_cancel_receipts receipt
    where receipt.operation_id=(current_setting('test.vod_provisional_prepare')::jsonb->>'operation_id')::uuid
      and receipt.cleanup_manifest_kind='canonical_provisional'
      and receipt.abort_manifest_id is null)
  and exists(select 1 from public.stream_media_manifest_edges edge
    join public.stream_media_source_bindings binding on binding.id=edge.binding_id
    where edge.operation_id=(current_setting('test.vod_provisional_cancel')::jsonb->>'cleanup_operation_id')::uuid
      and edge.edge_number=1 and edge.source_kind='video'
      and edge.source_identity='d3153000-0000-0000-0000-000000000005'
      and edge.raw_provider_uid='synthetic-vod-provisional-uid'
      and binding.binding_state='detached'),
  'canonical cancellation detaches the exact binding named by its one-edge cleanup manifest');

-- A stable cancel request can finish before provider create begins. Its immutable receipt opens
-- the profile fence, and an exact replay remains valid after the fence revision advances.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000005","role":"authenticated"}';
select set_config('test.vod_prehttp_prepare',public.prepare_stream_library_video_upload(
  'd3152900-0000-0000-0000-000000000001','d3153000-0000-0000-0000-000000000009',
  'Synthetic pre-create cancel','',repeat('9',64))::text,true);
select is(public.cancel_stream_media_upload_before_create(
  (current_setting('test.vod_prehttp_prepare')::jsonb->>'operation_id')::uuid,
  'd3152900-0000-0000-0000-000000000002'
)->>'outcome','canceled_without_provider_create',
  'pre-create cancellation records an immutable no-claim receipt and releases the owner fence');
select is(public.cancel_stream_media_upload_before_create(
  (current_setting('test.vod_prehttp_prepare')::jsonb->>'operation_id')::uuid,
  'd3152900-0000-0000-0000-000000000002'
)->>'outcome','canceled_without_provider_create',
  'an exact pre-create retry is resolved from its receipt before the advanced-fence check');
select is(public.cancel_stream_media_upload_before_create(
  (current_setting('test.vod_prehttp_prepare')::jsonb->>'operation_id')::uuid,
  'd3152900-0000-0000-0000-000000000012'
)->>'outcome','identity_mismatch',
  'a pre-create receipt cannot be replayed under a changed cancellation ID');
reset role;
select is((select count(*)::bigint from public.stream_media_create_claims claim
  where claim.operation_id=(current_setting('test.vod_prehttp_prepare')::jsonb->>'operation_id')::uuid),
  0::bigint,'the pre-create cancel lane has no provider create claim');
reset role;

-- Account deletion can clean a known-unready UID without an actor JWT. Every provider-like fact
-- below enters through the same trusted synthetic 300/310 RPCs used by the adapter.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000006","role":"authenticated"}';
select set_config('test.vod_account_unready_prepare',public.prepare_stream_library_video_upload(
  'd3157000-0000-0000-0000-000000000011','d3153000-0000-0000-0000-000000000010',
  'Synthetic account cleanup upload','',repeat('a',64))::text,true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.claim_stream_media_create(
  (current_setting('test.vod_account_unready_prepare')::jsonb->>'operation_id')::uuid,
  'd3157000-0000-0000-0000-000000000012',
  current_setting('test.vod_account_unready_prepare')::jsonb->>'request_digest'
)->>'outcome','create_authorized','account cleanup fixture begins with one trusted create claim');
select is(public.record_stream_media_upload_transport(
  (current_setting('test.vod_account_unready_prepare')::jsonb->>'operation_id')::uuid,
  (current_setting('test.vod_account_unready_prepare')::jsonb->>'transport_request_id')::uuid,
  current_setting('test.vod_account_unready_prepare')::jsonb->>'request_digest',
  'synthetic-vod-account-abort-uid','https://upload.provider.invalid/tus/account-abort',
  (now()+interval '15 minutes')::timestamptz,7200,true,
  current_setting('test.vod_account_unready_prepare')::jsonb->'metadata',repeat('b',64)
)->>'outcome','recorded','the known UID and private transport are durably tied to the account intent');
select is(public.advance_stream_media_upload(
  (current_setting('test.vod_account_unready_prepare')::jsonb->>'operation_id')::uuid,
  'd3157000-0000-0000-0000-000000000013','created_unverified',repeat('c',64)
)->>'outcome','advanced','the account cleanup upload stays created_unverified without a canonical binding');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.vod_account_unready_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'exact_uid_get','synthetic-vod-account-abort-uid',
  200::smallint,false,true,true,false,'d3157000-0000-0000-0000-000000000014',repeat('d',64)
)->>'outcome','recorded','an exact synthetic GET proves only the owned creator and intent marker');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000006","role":"authenticated"}';
select set_config('test.vod_account_actor_cancel',public.request_stream_media_upload_cancel(
  (current_setting('test.vod_account_unready_prepare')::jsonb->>'operation_id')::uuid,
  'd3157000-0000-0000-0000-000000000015'
)::text,true);
select is(current_setting('test.vod_account_actor_cancel')::jsonb->>'outcome','cancel_reserved',
  'the initiating actor can reserve known-unready cleanup before account deletion begins');
select is(current_setting('test.vod_account_actor_cancel')::jsonb->>'cleanup_manifest_kind','unready_abort',
  'actor cancellation stores the exact binderless unready manifest before the session is lost');
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(auth.uid(),null::uuid,'service account cleanup has no actor JWT session');
select set_config('test.vod_account_abort_begin',public.begin_stream_account_media_cleanup(
  'd3157000-0000-0000-0000-000000000001','d3150000-0000-0000-0000-000000000006',
  'd3157000-0000-0000-0000-000000000002',repeat('e',64),
  'd3157000-0000-0000-0000-000000000003',repeat('f',64)
)::text,true);
select is(current_setting('test.vod_account_abort_begin')::jsonb->>'outcome','upload_abort_pending',
  'the service account cleanup wrapper routes 310’s unresolved upload into the binderless VOD lane');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000006","role":"authenticated"}';
select is(public.get_stream_media_upload_tus_location(
  (current_setting('test.vod_account_unready_prepare')::jsonb->>'operation_id')::uuid
)->>'outcome','unavailable','the initiating actor cannot retrieve a bearer capability after tombstoning');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
reset role;
select is((select count(*)::bigint from public.stream_media_upload_abort_manifests manifest
  where manifest.upload_operation_id=(current_setting('test.vod_account_unready_prepare')::jsonb->>'operation_id')::uuid
    and manifest.cleanup_reason='actor_request'
    and manifest.tombstone_id is null
    and manifest.cancel_request_id='d3157000-0000-0000-0000-000000000015'),
  1::bigint,'service continuation preserves the actor manifest and does not rewrite its provenance');
select is((select count(*)::bigint from public.stream_media_assets asset
  where asset.registry_id=current_setting('test.vod_registry')::uuid
    and asset.raw_provider_uid='synthetic-vod-account-abort-uid'),
  0::bigint,'service account deletion does not manufacture an unready canonical asset');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.get_stream_media_upload_cancel_work(
  (current_setting('test.vod_account_abort_begin')::jsonb->>'cleanup_operation_id')::uuid
)->>'outcome','ready','only the reserved tombstone-scoped abort manifest releases its UID to the service worker');
select is(public.start_stream_media_uid_delete(
  (current_setting('test.vod_account_abort_begin')::jsonb->>'cleanup_operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'synthetic-vod-account-abort-uid',
  'd3157100-0000-0000-0000-000000000004',repeat('1',64)
)->>'outcome','delete_started','the service starts DELETE under the exact cleanup manifest UID');
select is(public.record_stream_media_uid_delete_result(
  (current_setting('test.vod_account_abort_begin')::jsonb->>'cleanup_operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'synthetic-vod-account-abort-uid',
  'deleted_confirmed',204::smallint,404::smallint,'d3157100-0000-0000-0000-000000000005',repeat('2',64)
)->>'outcome','recorded','a trusted DELETE response and exact GET 404 establish provider absence');
select is(public.finalize_stream_media_upload_cancel(
  (current_setting('test.vod_account_unready_prepare')::jsonb->>'operation_id')::uuid,
  (current_setting('test.vod_account_abort_begin')::jsonb->>'cancel_request_id')::uuid,
  (current_setting('test.vod_account_abort_begin')::jsonb->>'cleanup_operation_id')::uuid,
  'd3157100-0000-0000-0000-000000000005'
)->>'outcome','canceled','the service-only lane records the terminal cancellation after exact absence');
reset role;
select ok(private.stream_upload_cancel_proven(
    (current_setting('test.vod_account_unready_prepare')::jsonb->>'operation_id')::uuid)
  and exists (select 1 from public.stream_media_upload_cancel_receipts receipt
    where receipt.operation_id=(current_setting('test.vod_account_unready_prepare')::jsonb->>'operation_id')::uuid
      and receipt.request_id='d3157000-0000-0000-0000-000000000015'
      and receipt.cleanup_reason='actor_request' and receipt.tombstone_id is null),
  'service-only continuation finalizes the original actor request under the active account tombstone');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.vod_account_cleanup_resume',public.begin_stream_account_media_cleanup(
  'd3157000-0000-0000-0000-000000000001','d3150000-0000-0000-0000-000000000006',
  'd3157000-0000-0000-0000-000000000002',repeat('e',64),
  'd3157000-0000-0000-0000-000000000003',repeat('f',64)
)::text,true);
select is(current_setting('test.vod_account_cleanup_resume')::jsonb->>'outcome','reserved',
  'account cleanup resumes only after the upload cancellation receipt validates');
select is(public.finalize_stream_media_cleanup(
  'd3157000-0000-0000-0000-000000000003','d3157000-0000-0000-0000-000000000002',repeat('f',64)
)->>'outcome','account_cleanup_complete','the account inventory closes after its binderless abort receipt is consumed');
reset role;
select set_config('test.vod_account_tombstone_revision',(
  select tombstone.revision::text from public.stream_media_account_tombstones tombstone
  where tombstone.id='d3157000-0000-0000-0000-000000000001'),true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.record_stream_vod_upload_abort_component_proof(
  'd3157000-0000-0000-0000-000000000001',current_setting('test.vod_account_tombstone_revision')::bigint,
  'd3157100-0000-0000-0000-000000000006'
)->>'outcome','recorded','Auth cleanup records the exact VOD upload receipt inventory for the tombstone');
reset role;
select ok(private.stream_vod_upload_abort_inventory_digest('d3150000-0000-0000-0000-000000000006') is not null,
  'the service cleanup result is present in the current VOD Auth component inventory');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.vod_auth_permit_prepare',public.prepare_stream_auth_deletion_permit(
  'd3157000-0000-0000-0000-000000000001',current_setting('test.vod_account_tombstone_revision')::bigint,
  'd3157200-0000-0000-0000-000000000001','d3157200-0000-0000-0000-000000000002',repeat('4',64)
)::text,true);
select is(current_setting('test.vod_auth_permit_prepare')::jsonb->>'outcome','permit_ready',
  'the standalone 310 baseline consumes the proven VOD abort component without unrelated cleanup proofs');
reset role;
select ok(private.stream_auth_contract_current(
    (current_setting('test.vod_auth_permit_prepare')::jsonb->>'permit_id')::uuid),
  'the actual Auth permit consumes current account cleanup and VOD upload receipt inventories');
reset role;
select set_config('test.vod_auth_permit_revision',(
  select permit.revision::text from public.stream_media_auth_deletion_permits permit
  where permit.id='d3157200-0000-0000-0000-000000000001'),true);
select set_config('test.vod_auth_tombstone_revision',(
  select tombstone.state_revision::text from public.stream_media_account_tombstones tombstone
  where tombstone.id='d3157000-0000-0000-0000-000000000001'),true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.vod_auth_started',public.start_stream_auth_deletion_call(
  'd3157200-0000-0000-0000-000000000001',
  current_setting('test.vod_auth_permit_revision')::bigint,
  current_setting('test.vod_auth_tombstone_revision')::bigint,
  'd3157200-0000-0000-0000-000000000003',repeat('5',64)
)::text,true);
select is(current_setting('test.vod_auth_started')::jsonb->>'outcome','started',
  'a current service permit reaches the Auth call boundary without making an HTTP request');
select is(public.record_stream_auth_deletion_result(
  'd3157200-0000-0000-0000-000000000001',
  (current_setting('test.vod_auth_started')::jsonb->>'permit_revision')::bigint,
  (current_setting('test.vod_auth_started')::jsonb->>'tombstone_state_revision')::bigint,
  'unknown','d3157200-0000-0000-0000-000000000004',repeat('6',64)
)->>'outcome','recorded','an unknown Auth result is durably represented for same-permit revalidation');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.vod_account_unready_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'exact_uid_get','synthetic-vod-account-abort-uid',
  200::smallint,true,true,true,true,'d3157100-0000-0000-0000-000000000007',repeat('3',64)
)->>'outcome','recorded','a late exact provider contradiction remains durable after account cleanup');
reset role;
select ok(private.stream_vod_upload_abort_inventory_digest('d3150000-0000-0000-0000-000000000006') is null
  and not private.stream_upload_cancel_proven(
    (current_setting('test.vod_account_unready_prepare')::jsonb->>'operation_id')::uuid),
  'late UID-present evidence invalidates both the account upload receipt and its Auth inventory digest');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.record_stream_vod_upload_abort_component_proof(
  'd3157000-0000-0000-0000-000000000001',current_setting('test.vod_account_tombstone_revision')::bigint,
  'd3157100-0000-0000-0000-000000000008'
)->>'outcome','upload_abort_receipt_unproven',
  'a stale VOD proof cannot be refreshed after a contradictory late UID observation');
select set_config('test.vod_auth_permit_revalidation',public.prepare_stream_auth_deletion_permit(
  'd3157000-0000-0000-0000-000000000001',current_setting('test.vod_account_tombstone_revision')::bigint,
  'd3157200-0000-0000-0000-000000000001','d3157200-0000-0000-0000-000000000005',repeat('7',64)
)::text,true);
select is(current_setting('test.vod_auth_permit_revalidation')::jsonb->>'outcome','required_component_proofs_incomplete',
  'same-permit revalidation rejects the last ready VOD proof after the account inventory changes');
reset role;
select set_config('test.vod_auth_permit_id',(
  select permit.id::text from public.stream_media_auth_deletion_permits permit
  where permit.id='d3157200-0000-0000-0000-000000000001'),true);
select set_config('test.vod_auth_permit_state',(
  select permit.permit_state from public.stream_media_auth_deletion_permits permit
  where permit.id='d3157200-0000-0000-0000-000000000001'),true);
select set_config('test.vod_auth_permit_revision',(
  select permit.revision::text from public.stream_media_auth_deletion_permits permit
  where permit.id='d3157200-0000-0000-0000-000000000001'),true);
select set_config('test.vod_auth_tombstone_revision',(
  select tombstone.state_revision::text from public.stream_media_account_tombstones tombstone
  where tombstone.id='d3157000-0000-0000-0000-000000000001'),true);
select is(current_setting('test.vod_auth_permit_id'),
  current_setting('test.vod_auth_permit_prepare')::jsonb->>'permit_id',
  'failed revalidation keeps the original Auth permit identity intact');
select is(current_setting('test.vod_auth_permit_state'),'auth_result_unknown',
  'failed VOD proof refresh leaves the Auth result unknown for safe retry');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
reset role;
select ok(not private.stream_auth_contract_current(
    (current_setting('test.vod_auth_permit_prepare')::jsonb->>'permit_id')::uuid),
  'late UID-present evidence makes the original permit stale at consumption time');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.start_stream_auth_deletion_call(
  'd3157200-0000-0000-0000-000000000001',
  current_setting('test.vod_auth_permit_revision')::bigint,
  current_setting('test.vod_auth_tombstone_revision')::bigint,
  'd3157200-0000-0000-0000-000000000006',repeat('8',64)
)->>'outcome','component_proofs_stale',
  'a stale VOD proof blocks the next Auth call after same-permit revalidation');

-- A second normal Library upload supplies verified source media for exact Program and Daily
-- caller tests below.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000005","role":"authenticated"}';
select set_config('test.vod_context_video_prepare',public.prepare_stream_library_video_upload(
  'd3158000-0000-0000-0000-000000000001','d3153000-0000-0000-0000-000000000011',
  'Synthetic intro and Daily video','',repeat('4',64))::text,true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.claim_stream_media_create(
  (current_setting('test.vod_context_video_prepare')::jsonb->>'operation_id')::uuid,
  'd3158000-0000-0000-0000-000000000002',
  current_setting('test.vod_context_video_prepare')::jsonb->>'request_digest'
)->>'outcome','create_authorized','context fixture obtains one ordinary provider claim');
select is(public.record_stream_media_upload_transport(
  (current_setting('test.vod_context_video_prepare')::jsonb->>'operation_id')::uuid,
  (current_setting('test.vod_context_video_prepare')::jsonb->>'transport_request_id')::uuid,
  current_setting('test.vod_context_video_prepare')::jsonb->>'request_digest',
  'synthetic-vod-context-ready-uid','https://upload.provider.invalid/tus/context-ready',
  (now()+interval '15 minutes')::timestamptz,7200,true,
  current_setting('test.vod_context_video_prepare')::jsonb->'metadata',repeat('5',64)
)->>'outcome','recorded','the context fixture stores its immutable provider transport result');
select is(public.advance_stream_media_upload(
  (current_setting('test.vod_context_video_prepare')::jsonb->>'operation_id')::uuid,
  'd3158000-0000-0000-0000-000000000003','created_unverified',repeat('6',64)
)->>'outcome','advanced','context fixture waits for canonical exact readback');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.vod_context_video_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'exact_uid_get','synthetic-vod-context-ready-uid',
  200::smallint,true,true,true,true,'d3158000-0000-0000-0000-000000000004',repeat('7',64)
)->>'outcome','recorded','exact synthetic GET marks the video creator, marker, signed URLs, and readiness');
select is(public.bind_stream_media_upload_readback(
  (current_setting('test.vod_context_video_prepare')::jsonb->>'operation_id')::uuid,
  'd3158000-0000-0000-0000-000000000004','d3158000-0000-0000-0000-000000000005'
)->>'outcome','provisional_bound','the canonical readback RPC creates the only provisional binding');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000005","role":"authenticated"}';
select is(public.commit_stream_library_video_upload(
  (current_setting('test.vod_context_video_prepare')::jsonb->>'operation_id')::uuid,
  'd3158000-0000-0000-0000-000000000006'
)->>'outcome','ready_for_publication','the intro and Daily fixture is a real committed Library video');
reset role;

select is((select video.visibility::text from public.videos video
  where video.id='d3153000-0000-0000-0000-000000000011'),'private',
  'an ordinary ready Library video starts with private visibility');
select set_config('test.vod_visibility_previous_operation',
  coalesce(current_setting('app.stream_media_operation_id',true),''),true);
select set_config('app.stream_media_operation_id',
  current_setting('test.vod_context_video_prepare')::jsonb->>'operation_id',true);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000005","role":"authenticated"}';
select lives_ok($$update public.videos set visibility='members'
  where id='d3153000-0000-0000-0000-000000000011' and coach_id=auth.uid()$$,
  'an ordinary Library owner can expose a nonpaid private video to members');
select lives_ok($$update public.videos set visibility='private'
  where id='d3153000-0000-0000-0000-000000000011' and coach_id=auth.uid()$$,
  'an ordinary Library owner can return a nonpaid members video to private');
select throws_ok($$update public.videos set visibility='public'
  where id='d3153000-0000-0000-0000-000000000011' and coach_id=auth.uid()$$,
  '23514',null,'the visibility constraint rejects arbitrary values');
reset role;
select set_config('app.stream_media_operation_id',
  current_setting('test.vod_visibility_previous_operation'),true);

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000005","role":"authenticated"}';
insert into public.programs(id,coach_id,title,description,published,intro_video_id)
values('d3154000-0000-0000-0000-000000000001','d3150000-0000-0000-0000-000000000005',
  'Synthetic intro preview','',true,'d3153000-0000-0000-0000-000000000011');
reset role;
select is((select count(*)::bigint from public.stream_media_source_bindings binding
  join public.stream_media_source_binding_events event on event.binding_id=binding.id
    and event.event_kind='attached' and event.source_revision=binding.source_revision
    and event.evidence_digest=binding.evidence_digest
  where binding.source_kind='program_intro' and binding.source_identity='d3154000-0000-0000-0000-000000000001'
    and binding.raw_provider_uid='synthetic-vod-context-ready-uid'),1::bigint,
  'the normal Program intro guard emits one exact attached event for the verified source');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$insert into public.programs(
    id,coach_id,title,description,published,platform_owned,intro_video_id
  ) values('d3154000-0000-0000-0000-000000000005','d3150000-0000-0000-0000-000000000001',
    'Synthetic foreign private intro','',false,false,'d3153000-0000-0000-0000-000000000011')$$,
  '23514','Choose a ready creator-owned video that is not protected Program media',
  'an authenticated coach cannot attach another creator’s private video on initial Program insert');
reset role;
select ok(not exists(select 1 from public.programs program
      where program.id='d3154000-0000-0000-0000-000000000005')
    and not exists(select 1 from public.stream_media_source_bindings binding
      where binding.source_kind='program_intro' and binding.source_identity='d3154000-0000-0000-0000-000000000005')
    and not exists(select 1 from public.stream_media_source_binding_events event
      join public.stream_media_source_bindings binding on binding.id=event.binding_id
      where binding.source_kind='program_intro' and binding.source_identity='d3154000-0000-0000-0000-000000000005'),
  'the rejected foreign-video insert leaves no Program, source binding, or attachment event');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000005","role":"authenticated"}';
select throws_ok($$insert into public.programs(
    id,coach_id,title,description,published,platform_owned,intro_video_id
  ) values('d3154000-0000-0000-0000-000000000006','d3150000-0000-0000-0000-000000000001',
    'Synthetic forged Program owner','',false,false,'d3153000-0000-0000-0000-000000000001')$$,
  '42501',null,'an authenticated coach cannot forge another coach’s Program owner during initial insert');
reset role;
select ok(not exists(select 1 from public.programs program
      where program.id='d3154000-0000-0000-0000-000000000006')
    and not exists(select 1 from public.stream_media_source_bindings binding
      where binding.source_kind='program_intro' and binding.source_identity='d3154000-0000-0000-0000-000000000006')
    and not exists(select 1 from public.stream_media_source_binding_events event
      join public.stream_media_source_bindings binding on binding.id=event.binding_id
      where binding.source_kind='program_intro' and binding.source_identity='d3154000-0000-0000-0000-000000000006'),
  'the rejected forged-owner insert leaves no Program, source binding, or attachment event');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000007","role":"authenticated"}';
select is(public.get_stream_program_intro_playback('d3154000-0000-0000-0000-000000000001')->>'outcome','ready',
  'an eligible signed-in member can preview the exact Program intro without a paid order');
reset role;
select is((select count(*)::bigint from public.program_orders orders
  where orders.program_id='d3154000-0000-0000-0000-000000000001'),0::bigint,
  'the intro preview fixture has no purchase order');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000007","role":"authenticated"}';
select is(public.get_stream_program_intro_playback('d3154000-0000-0000-0000-000000000001')->>'provider_uid',
  'synthetic-vod-context-ready-uid','the preview projection returns only the verified intro UID');
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000008","role":"authenticated"}';
select is(public.get_stream_program_intro_playback('d3154000-0000-0000-0000-000000000001')->>'outcome','unavailable',
  'an unrelated member without Program audience rights cannot resolve the intro UID');
reset role;

-- Daily Content resolves current slot/revision under the connected coach. Daily Fuel assignment
-- and bookmark projections use the member-owned contexts even though the video owner is a coach.
select set_config('test.vod_daily_eastern_base_date',
  (now() at time zone 'America/New_York')::date::text,true);
select set_config('test.vod_daily_original_helper_hash',encode(extensions.digest(convert_to(
  pg_get_functiondef('private.current_daily_checkin_day()'::regprocedure),'UTF8'),'sha256'),'hex'),true);
select is(current_setting('test.vod_daily_eastern_base_date')::date,
  (now() at time zone 'America/New_York')::date,
  'the Daily test base is the production Eastern calendar date');
select ok(current_setting('test.vod_daily_original_helper_hash') ~ '^[0-9a-f]{64}$'
    and position('America/New_York' in pg_get_functiondef('private.current_daily_checkin_day()'::regprocedure))>0,
  'the test captures the original production Daily clock definition before its rollback-scoped override');
select set_config('daily_content.test_day',current_setting('test.vod_daily_eastern_base_date'),true);
create or replace function private.current_daily_checkin_day()
returns date language sql stable set search_path=''
as $$ select current_setting('daily_content.test_day')::date $$;
update public.coach_members set created_at=now()-interval '1 hour'
where coach_id='d3150000-0000-0000-0000-000000000001'
  and member_id='d3150000-0000-0000-0000-000000000007';
update public.coach_members set created_at=now()
where coach_id='d3150000-0000-0000-0000-000000000005'
  and member_id='d3150000-0000-0000-0000-000000000007';
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000005","role":"authenticated"}';
select lives_ok($$select * from public.save_daily_content_item(
  null,'video','Synthetic current video','d3153000-0000-0000-0000-000000000011',null,null,null)$$,
  'the video owner uses the normal Daily Content item RPC');
select lives_ok($$select public.publish_daily_content_slot(
  (select item.id from public.daily_content_items item where item.owner_id='d3150000-0000-0000-0000-000000000005'
    and item.title='Synthetic current video'),
  (select revision.id from public.daily_content_revisions revision where revision.title_snapshot='Synthetic current video'),
  private.current_daily_checkin_day())$$,
  'the owner publishes a current-day immutable Daily Content slot and revision');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000007","role":"authenticated"}';
select set_config('test.vod_daily_slot',resolved.video_slot_id::text,true),
  set_config('test.vod_daily_revision',resolved.video_revision_id::text,true)
from public.resolve_member_daily_content() resolved;
select ok(nullif(current_setting('test.vod_daily_slot'),'') is not null
  and nullif(current_setting('test.vod_daily_revision'),'') is not null,
  'the current member resolves a concrete Daily Content slot and revision before UUID checks');
select is(public.get_my_stream_daily_content_video_playback(
  current_setting('test.vod_daily_slot')::uuid,current_setting('test.vod_daily_revision')::uuid
)->>'outcome','ready','the resolved Daily gate exposes the exact current slot and revision');
select is(public.get_my_stream_daily_content_video_playback(
  current_setting('test.vod_daily_slot')::uuid,'d3154000-0000-0000-0000-000000000099'
)->>'outcome','unavailable','Daily playback rejects a forged or stale revision ID');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000005","role":"authenticated"}';
select lives_ok($$select public.assign_member_daily_fuel_video(
  'd3150000-0000-0000-0000-000000000007','d3153000-0000-0000-0000-000000000011',
  private.current_daily_checkin_day())$$,
  'the coach assigns the exact verified video to a current-day member assignment');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000007","role":"authenticated"}';
select ok(exists(select 1 from public.resolve_member_daily_content() resolved
    where resolved.video_id='d3153000-0000-0000-0000-000000000011'
      and resolved.video_slot_id is null and resolved.video_revision_id is null),
  'the exact member Fuel assignment takes precedence and intentionally has no Daily Content slot revision');
select set_config('test.vod_daily_assignment',(
  select assignment.id::text from public.member_daily_fuel_assignments assignment
  where assignment.member_id=auth.uid() and assignment.video_id='d3153000-0000-0000-0000-000000000011'
    and assignment.day=private.current_daily_checkin_day()),true);
select is(public.get_my_stream_daily_fuel_assignment_playback(
  current_setting('test.vod_daily_assignment')::uuid)->>'outcome','ready',
  'the current member-owned assignment resolves its exact coach video binding');
select is(public.get_my_stream_daily_fuel_assignment_playback(
  'd3154000-0000-0000-0000-000000000099')->>'outcome','unavailable',
  'a different or stale assignment ID cannot borrow the current video');
select lives_ok($$select public.set_member_daily_fuel_bookmark(
  'd3153000-0000-0000-0000-000000000011',true)$$,
  'the member bookmarks a coach-owned current Daily video through the normal RPC');
reset role;
select is((select count(*)::bigint from public.stream_media_source_bindings binding
  join public.stream_media_source_binding_events event on event.binding_id=binding.id
    and event.event_kind='attached' and event.source_revision=binding.source_revision
    and event.evidence_digest=binding.evidence_digest
  where (binding.source_kind='daily_content_slot'
      and binding.source_identity=current_setting('test.vod_daily_slot'))
    or (binding.source_kind='daily_fuel_assignment'
      and binding.source_identity=current_setting('test.vod_daily_assignment'))
    or (binding.source_kind='daily_fuel_bookmark'
      and binding.source_identity=(auth.uid()::text||':d3153000-0000-0000-0000-000000000011'))),
  3::bigint,'the normal Daily slot, assignment, and bookmark guards each emit their own attachment evidence');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000007","role":"authenticated"}';
select is(public.get_my_stream_daily_fuel_bookmark_playback(
  'd3153000-0000-0000-0000-000000000011')->>'outcome','ready',
  'bookmark playback checks the member bookmark and separate coach video owner');
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000005","role":"authenticated"}';
select is(public.get_my_stream_daily_fuel_bookmark_playback(
  'd3153000-0000-0000-0000-000000000011')->>'outcome','unavailable',
  'the coach video owner cannot impersonate the member-owned bookmark');
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000008","role":"authenticated"}';
select is(public.get_my_stream_daily_content_video_playback(
  current_setting('test.vod_daily_slot')::uuid,current_setting('test.vod_daily_revision')::uuid
)->>'outcome','unavailable','a different member without the selected coach context cannot use the Daily slot');
select is(public.get_my_stream_daily_fuel_assignment_playback(
  current_setting('test.vod_daily_assignment')::uuid)->>'outcome','unavailable',
  'an unrelated member without the assignment coach link cannot resolve its Daily Fuel UID');
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000007","role":"authenticated"}';
select set_config('daily_content.test_day',
  (current_setting('test.vod_daily_eastern_base_date')::date+1)::text,true);
select is(public.get_my_stream_daily_fuel_assignment_playback(
  current_setting('test.vod_daily_assignment')::uuid)->>'outcome','unavailable',
  'the member cannot use yesterday’s assignment after the daily gate advances');
select set_config('daily_content.test_day',current_setting('test.vod_daily_eastern_base_date'),true);
reset role;

-- Paid playback proves the buyer, immutable order, installment, timeline, and exclusive ready UID.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.programs(id,coach_id,title,description,published)
values('d3154000-0000-0000-0000-000000000002','d3150000-0000-0000-0000-000000000001',
  'Synthetic paid media','','true');
reset role;
insert into public.program_content_versions(id,program_id,revision_number,revision_kind,lesson_count,created_by)
select 'd3154100-0000-0000-0000-000000000001','d3154000-0000-0000-0000-000000000002',
  coalesce(max(version.revision_number),0)+1,'paid',2,'d3150000-0000-0000-0000-000000000001'
from public.program_content_versions version where version.program_id='d3154000-0000-0000-0000-000000000002';
insert into public.program_content_version_lessons(
  id,program_id,content_version_id,lesson_ordinal,timeline_day_number,source_day_id,
  title,instructions,pillar,video_id,video_creator_id,cloudflare_uid,cloudflare_signed_urls_verified
) values
  ('d3154200-0000-0000-0000-000000000001','d3154000-0000-0000-0000-000000000002',
   'd3154100-0000-0000-0000-000000000001',1,1,null,'Paid stage one','', 'body',
   'd3153000-0000-0000-0000-000000000001','d3150000-0000-0000-0000-000000000001',
   'synthetic-vod-library-ready-uid',true),
  ('d3154200-0000-0000-0000-000000000002','d3154000-0000-0000-0000-000000000002',
   'd3154100-0000-0000-0000-000000000001',2,2,null,'Paid stage two','', 'mind',
   'd3153000-0000-0000-0000-000000000001','d3150000-0000-0000-0000-000000000001',
    'synthetic-vod-library-ready-uid',true);
select is((select count(*)::bigint from public.stream_media_source_bindings binding
  join public.stream_media_source_binding_events event on event.binding_id=binding.id
    and event.event_kind='attached' and event.source_revision=binding.source_revision
    and event.evidence_digest=binding.evidence_digest
  where binding.source_kind='program_lesson'
    and binding.source_identity in ('d3154200-0000-0000-0000-000000000001',
      'd3154200-0000-0000-0000-000000000002') and binding.binding_state='active'),
  2::bigint,'the guarded producer emits one exact attachment event for each lesson in the same version');

select set_config('test.vod_paid_visibility_snapshot',(
  select jsonb_build_object(
    'video',(select to_jsonb(video) from public.videos video
      where video.id='d3153000-0000-0000-0000-000000000001'),
    'bindings',(select coalesce(jsonb_agg(to_jsonb(binding) order by binding.id),'[]'::jsonb)
      from public.stream_media_source_bindings binding
      where (binding.source_kind='video' and binding.source_identity='d3153000-0000-0000-0000-000000000001')
        or (binding.source_kind='program_lesson' and binding.source_identity in
          ('d3154200-0000-0000-0000-000000000001','d3154200-0000-0000-0000-000000000002'))),
    'events',(select coalesce(jsonb_agg(to_jsonb(event) order by event.id),'[]'::jsonb)
      from public.stream_media_source_binding_events event
      join public.stream_media_source_bindings binding on binding.id=event.binding_id
      where (binding.source_kind='video' and binding.source_identity='d3153000-0000-0000-0000-000000000001')
        or (binding.source_kind='program_lesson' and binding.source_identity in
          ('d3154200-0000-0000-0000-000000000001','d3154200-0000-0000-0000-000000000002'))),
    'fences',(select coalesce(jsonb_agg(to_jsonb(fence) order by fence.source_kind,fence.source_identity),'[]'::jsonb)
      from public.stream_media_parent_fences fence
      where (fence.source_kind='profile' and fence.source_identity='d3150000-0000-0000-0000-000000000001')
        or (fence.source_kind='video' and fence.source_identity='d3153000-0000-0000-0000-000000000001')
        or (fence.source_kind='program' and fence.source_identity='d3154000-0000-0000-0000-000000000002'))
  ))::text,true);
select set_config('test.vod_paid_visibility_previous_operation',
  coalesce(current_setting('app.stream_media_operation_id',true),''),true);
select set_config('app.stream_media_operation_id',
  current_setting('test.vod_library_prepare')::jsonb->>'operation_id',true);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$update public.videos set visibility='members'
  where id='d3153000-0000-0000-0000-000000000001' and coach_id=auth.uid()$$,
  '42501','Paid Program media cannot be exposed outside protected visibility',
  'an authenticated owner cannot expose a retained paid UID from private to members');
reset role;
select set_config('app.stream_media_operation_id',
  current_setting('test.vod_paid_visibility_previous_operation'),true);
select is((select to_jsonb(video) from public.videos video
    where video.id='d3153000-0000-0000-0000-000000000001'),
  current_setting('test.vod_paid_visibility_snapshot')::jsonb->'video',
  'the rejected visibility change leaves the paid video row unchanged');
select is((select coalesce(jsonb_agg(to_jsonb(binding) order by binding.id),'[]'::jsonb)
    from public.stream_media_source_bindings binding
    where (binding.source_kind='video' and binding.source_identity='d3153000-0000-0000-0000-000000000001')
      or (binding.source_kind='program_lesson' and binding.source_identity in
        ('d3154200-0000-0000-0000-000000000001','d3154200-0000-0000-0000-000000000002'))),
  current_setting('test.vod_paid_visibility_snapshot')::jsonb->'bindings',
  'the rejected visibility change leaves all exact paid and Library bindings unchanged');
select is((select coalesce(jsonb_agg(to_jsonb(event) order by event.id),'[]'::jsonb)
    from public.stream_media_source_binding_events event
    join public.stream_media_source_bindings binding on binding.id=event.binding_id
    where (binding.source_kind='video' and binding.source_identity='d3153000-0000-0000-0000-000000000001')
      or (binding.source_kind='program_lesson' and binding.source_identity in
        ('d3154200-0000-0000-0000-000000000001','d3154200-0000-0000-0000-000000000002'))),
  current_setting('test.vod_paid_visibility_snapshot')::jsonb->'events',
  'the rejected visibility change leaves exact attachment history unchanged');
select is((select coalesce(jsonb_agg(to_jsonb(fence) order by fence.source_kind,fence.source_identity),'[]'::jsonb)
    from public.stream_media_parent_fences fence
    where (fence.source_kind='profile' and fence.source_identity='d3150000-0000-0000-0000-000000000001')
      or (fence.source_kind='video' and fence.source_identity='d3153000-0000-0000-0000-000000000001')
      or (fence.source_kind='program' and fence.source_identity='d3154000-0000-0000-0000-000000000002')),
  current_setting('test.vod_paid_visibility_snapshot')::jsonb->'fences',
  'the rejected visibility change leaves the video, owner, and Program fences unchanged');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.create_task('d3153000-0000-0000-0000-000000000001',
  'Protected media reuse','',null,array['d3150000-0000-0000-0000-000000000007']::uuid[])$$,
  '23514','Paid Program media cannot be assigned through Library, Task, or Daily Fuel',
  'the actual Task RPC cannot reuse a private paid UID');
select throws_ok($$select public.assign_member_daily_fuel_video(
  'd3150000-0000-0000-0000-000000000007','d3153000-0000-0000-0000-000000000001',
  private.current_daily_checkin_day())$$,
  '23514','Paid Program media cannot be assigned through Library, Task, or Daily Fuel',
  'the actual Daily Fuel RPC cannot reuse a private paid UID');
reset role;
update public.videos set visibility='program_only'
where id='d3153000-0000-0000-0000-000000000001' and coach_id='d3150000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000008","role":"authenticated"}';
select is((select count(*)::bigint from public.videos video
  where video.id='d3153000-0000-0000-0000-000000000001'),0::bigint,
  'a signed-in nonbuyer cannot SELECT program-only paid media');
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select throws_ok($$update public.videos set visibility='members'
  where id='d3153000-0000-0000-0000-000000000001'$$,
  '42501','Paid Program media cannot be exposed outside protected visibility',
  'service_role cannot expose a retained program-only UID to members');
select throws_ok($$update public.videos set visibility='private'
  where id='d3153000-0000-0000-0000-000000000001'$$,
  '42501','Paid Program media cannot be exposed outside protected visibility',
  'service_role cannot downgrade retained program-only media to private');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$insert into public.programs(
    id,coach_id,title,description,published,platform_owned,intro_video_id
  ) values('d3154000-0000-0000-0000-000000000007','d3150000-0000-0000-0000-000000000001',
    'Synthetic protected Program intro','',false,false,'d3153000-0000-0000-0000-000000000001')$$,
  '42501','Program-only media is limited to verified paid lessons',
  'an authenticated coach cannot reuse paid-only media as an intro on initial Program insert');
reset role;
select ok(not exists(select 1 from public.programs program
      where program.id='d3154000-0000-0000-0000-000000000007')
    and not exists(select 1 from public.stream_media_source_bindings binding
      where binding.source_kind='program_intro' and binding.source_identity='d3154000-0000-0000-0000-000000000007')
    and not exists(select 1 from public.stream_media_source_binding_events event
      join public.stream_media_source_bindings binding on binding.id=event.binding_id
      where binding.source_kind='program_intro' and binding.source_identity='d3154000-0000-0000-0000-000000000007'),
  'the rejected protected-media insert leaves no Program, source binding, or attachment event');
insert into public.program_offer_versions(
  id,program_id,offer_number,content_version_id,offer_kind,list_price_cents,currency,max_installments,
  platform_owned,seller_profile_id,connected_account_id,created_by
) select 'd3154300-0000-0000-0000-000000000001','d3154000-0000-0000-0000-000000000002',
  coalesce(max(offer.offer_number),0)+1,'d3154100-0000-0000-0000-000000000001','paid',800,'usd',2,
  false,'d3150000-0000-0000-0000-000000000001','acct_d315vodcoach','d3150000-0000-0000-0000-000000000001'
from public.program_offer_versions offer where offer.program_id='d3154000-0000-0000-0000-000000000002';
update public.program_commerce_state set current_content_version_id='d3154100-0000-0000-0000-000000000001',
  current_offer_version_id='d3154300-0000-0000-0000-000000000001'
where program_id='d3154000-0000-0000-0000-000000000002';
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.vod_paid_order',public.create_program_order_reservation(
  'd3150000-0000-0000-0000-000000000007','d3154000-0000-0000-0000-000000000002',
  'd3154300-0000-0000-0000-000000000001',2::smallint,'d315-vod-paid-order-001',null
)::text,true);
select is(public.bind_program_checkout_session(current_setting('test.vod_paid_order')::uuid,
  0,'cs_d315vodpaid001'),true,'the service binds the fixture order to one synthetic checkout session');
select is(public.record_program_installment_payment(current_setting('test.vod_paid_order')::uuid,
  1::smallint,0::bigint,'evt_d315vodstage1','pi_d315vodstage1','in_d315vodstage1','ch_d315vodstage1',
  'succeeded',400,0,'usd'),true,'the first trusted installment opens only paid stage one');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000007","role":"authenticated"}';
select is(public.get_my_stream_program_order_lesson_playback(current_setting('test.vod_paid_order')::uuid,
  'd3154200-0000-0000-0000-000000000001')->>'outcome','ready',
  'the buyer receives the exact exclusive ready video for the paid and current lesson stage');
select is(public.get_my_stream_program_order_lesson_playback(current_setting('test.vod_paid_order')::uuid,
  'd3154200-0000-0000-0000-000000000001')->>'provider_uid','synthetic-vod-library-ready-uid',
  'paid playback returns the immutable lesson UID through its exact program_lesson binding');
select is(public.get_my_stream_program_order_lesson_playback(current_setting('test.vod_paid_order')::uuid,
  'd3154200-0000-0000-0000-000000000002')->>'outcome','unavailable',
  'the locked second paid lesson stays unavailable before its installment and timeline stage');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.record_program_installment_payment(current_setting('test.vod_paid_order')::uuid,
  2::smallint,0::bigint,'evt_d315vodstage2','pi_d315vodstage2','in_d315vodstage2','ch_d315vodstage2',
  'succeeded',400,0,'usd'),true,'the second trusted installment opens the second lesson in that same immutable version');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000007","role":"authenticated"}';
select is(public.get_my_stream_program_order_lesson_playback(current_setting('test.vod_paid_order')::uuid,
  'd3154200-0000-0000-0000-000000000002')->>'outcome','unavailable',
  'the paid second lesson remains unavailable on the purchase day despite its second installment');
reset role;
select set_config('daily_content.test_day',
  (current_setting('test.vod_daily_eastern_base_date')::date+1)::text,true);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000007","role":"authenticated"}';
select is(public.get_my_stream_program_order_lesson_playback(current_setting('test.vod_paid_order')::uuid,
  'd3154200-0000-0000-0000-000000000002')->>'outcome','ready',
  'the exact second paid lesson becomes available on its next Eastern timeline day');
select is(public.get_my_stream_program_order_lesson_playback(current_setting('test.vod_paid_order')::uuid,
  'd3154200-0000-0000-0000-000000000001')->>'outcome','ready',
  'the earlier paid lesson remains available on the next timeline day');
reset role;
select set_config('daily_content.test_day',current_setting('test.vod_daily_eastern_base_date'),true);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000008","role":"authenticated"}';
select is(public.get_my_stream_program_order_lesson_playback(current_setting('test.vod_paid_order')::uuid,
  'd3154200-0000-0000-0000-000000000001')->>'outcome','unavailable',
  'a different signed-in member cannot borrow the buyer order or paid lesson UID');
reset role;

-- A free Program snapshot may expose its own exact verified video to an enrolled member.
-- The normal 310 guard rejects a free snapshot that tries to reuse program-only paid media.
insert into public.coach_members(coach_id,member_id)
values('d3150000-0000-0000-0000-000000000005','d3150000-0000-0000-0000-000000000008');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000005","role":"authenticated"}';
insert into public.programs(id,coach_id,title,description,published)
values('d3154000-0000-0000-0000-000000000003','d3150000-0000-0000-0000-000000000005',
  'Synthetic free media','','true');
reset role;
insert into public.program_content_versions(id,program_id,revision_number,revision_kind,lesson_count,created_by)
select 'd3154100-0000-0000-0000-000000000002','d3154000-0000-0000-0000-000000000003',
  coalesce(max(version.revision_number),0)+1,'free_snapshot',1,'d3150000-0000-0000-0000-000000000005'
from public.program_content_versions version where version.program_id='d3154000-0000-0000-0000-000000000003';
insert into public.program_content_version_lessons(
  id,program_id,content_version_id,lesson_ordinal,timeline_day_number,source_day_id,
  title,instructions,pillar,video_id,video_creator_id,cloudflare_uid,cloudflare_signed_urls_verified
) values('d3154200-0000-0000-0000-000000000003','d3154000-0000-0000-0000-000000000003',
  'd3154100-0000-0000-0000-000000000002',1,1,null,'Free video','', 'body',
  'd3153000-0000-0000-0000-000000000011','d3150000-0000-0000-0000-000000000005',
  'synthetic-vod-context-ready-uid',true);
insert into public.program_offer_versions(
  id,program_id,offer_number,content_version_id,offer_kind,list_price_cents,currency,max_installments,
  platform_owned,seller_profile_id,connected_account_id,created_by
) select 'd3154300-0000-0000-0000-000000000002','d3154000-0000-0000-0000-000000000003',
  coalesce(max(offer.offer_number),0)+1,'d3154100-0000-0000-0000-000000000002','free',0,'usd',1,
  false,'d3150000-0000-0000-0000-000000000005',null,'d3150000-0000-0000-0000-000000000005'
from public.program_offer_versions offer where offer.program_id='d3154000-0000-0000-0000-000000000003';
update public.program_commerce_state set current_content_version_id='d3154100-0000-0000-0000-000000000002',
  current_offer_version_id='d3154300-0000-0000-0000-000000000002'
where program_id='d3154000-0000-0000-0000-000000000003';
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000008","role":"authenticated"}';
select is((public.start_my_program_enrollment('d3154000-0000-0000-0000-000000000003')->>'existing')::boolean,
  false,'the eligible member starts the exact free snapshot through the normal enrollment RPC');
select set_config('test.vod_free_enrollment',(
  select enrollment.id::text from public.program_enrollments enrollment
  where enrollment.program_id='d3154000-0000-0000-0000-000000000003' and enrollment.member_id=auth.uid()),true);
select is(public.get_my_stream_program_enrollment_lesson_playback(
  current_setting('test.vod_free_enrollment')::uuid,'d3154200-0000-0000-0000-000000000003'
)->>'outcome','ready','the current free enrollment exposes its exact visible stage and verified video');
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000007","role":"authenticated"}';
select is(public.get_my_stream_program_order_lesson_playback(current_setting('test.vod_paid_order')::uuid,
  'd3154200-0000-0000-0000-000000000001')->>'outcome','ready',
  'a separate free media UID does not change the paid order projection');
reset role;

-- New immutable content versions advance the Program parent fence. Existing paid orders and
-- free enrollments keep their exact older lesson UID and binding snapshots.
insert into public.program_content_versions(id,program_id,revision_number,revision_kind,lesson_count,created_by)
select 'd3154100-0000-0000-0000-000000000003','d3154000-0000-0000-0000-000000000002',
  coalesce(max(version.revision_number),0)+1,'paid',1,'d3150000-0000-0000-0000-000000000001'
from public.program_content_versions version where version.program_id='d3154000-0000-0000-0000-000000000002';
insert into public.program_content_version_lessons(
  id,program_id,content_version_id,lesson_ordinal,timeline_day_number,source_day_id,
  title,instructions,pillar,video_id,video_creator_id,cloudflare_uid,cloudflare_signed_urls_verified
) values('d3154200-0000-0000-0000-000000000005','d3154000-0000-0000-0000-000000000002',
  'd3154100-0000-0000-0000-000000000003',1,1,null,'New paid version','', 'body',
  'd3153000-0000-0000-0000-000000000001','d3150000-0000-0000-0000-000000000001',
  'synthetic-vod-library-ready-uid',true);
insert into public.program_offer_versions(
  id,program_id,offer_number,content_version_id,offer_kind,list_price_cents,currency,max_installments,
  platform_owned,seller_profile_id,connected_account_id,created_by
) select 'd3154300-0000-0000-0000-000000000003','d3154000-0000-0000-0000-000000000002',
  coalesce(max(offer.offer_number),0)+1,'d3154100-0000-0000-0000-000000000003','paid',900,'usd',1,
  false,'d3150000-0000-0000-0000-000000000001','acct_d315vodcoach','d3150000-0000-0000-0000-000000000001'
from public.program_offer_versions offer where offer.program_id='d3154000-0000-0000-0000-000000000002';
update public.program_commerce_state set current_content_version_id='d3154100-0000-0000-0000-000000000003',
  current_offer_version_id='d3154300-0000-0000-0000-000000000003'
where program_id='d3154000-0000-0000-0000-000000000002';
insert into public.program_content_versions(id,program_id,revision_number,revision_kind,lesson_count,created_by)
select 'd3154100-0000-0000-0000-000000000005','d3154000-0000-0000-0000-000000000003',
  coalesce(max(version.revision_number),0)+1,'free_snapshot',1,'d3150000-0000-0000-0000-000000000005'
from public.program_content_versions version where version.program_id='d3154000-0000-0000-0000-000000000003';
insert into public.program_content_version_lessons(
  id,program_id,content_version_id,lesson_ordinal,timeline_day_number,source_day_id,
  title,instructions,pillar,video_id,video_creator_id,cloudflare_uid,cloudflare_signed_urls_verified
) values('d3154200-0000-0000-0000-000000000006','d3154000-0000-0000-0000-000000000003',
  'd3154100-0000-0000-0000-000000000005',1,1,null,'New free version','', 'body',
  'd3153000-0000-0000-0000-000000000011','d3150000-0000-0000-0000-000000000005',
  'synthetic-vod-context-ready-uid',true);
insert into public.program_offer_versions(
  id,program_id,offer_number,content_version_id,offer_kind,list_price_cents,currency,max_installments,
  platform_owned,seller_profile_id,connected_account_id,created_by
) select 'd3154300-0000-0000-0000-000000000004','d3154000-0000-0000-0000-000000000003',
  coalesce(max(offer.offer_number),0)+1,'d3154100-0000-0000-0000-000000000005','free',0,'usd',1,
  false,'d3150000-0000-0000-0000-000000000005',null,'d3150000-0000-0000-0000-000000000005'
from public.program_offer_versions offer where offer.program_id='d3154000-0000-0000-0000-000000000003';
update public.program_commerce_state set current_content_version_id='d3154100-0000-0000-0000-000000000005',
  current_offer_version_id='d3154300-0000-0000-0000-000000000004'
where program_id='d3154000-0000-0000-0000-000000000003';
select set_config('daily_content.test_day',
  (current_setting('test.vod_daily_eastern_base_date')::date+1)::text,true);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000007","role":"authenticated"}';
select is(public.get_my_stream_program_order_lesson_playback(current_setting('test.vod_paid_order')::uuid,
  'd3154200-0000-0000-0000-000000000001')->>'outcome','ready',
  'an old paid order still resolves its frozen lesson after a newer Program version is published');
select is(public.get_my_stream_program_order_lesson_playback(current_setting('test.vod_paid_order')::uuid,
  'd3154200-0000-0000-0000-000000000002')->>'outcome','ready',
  'the second exact paid lesson remains available across later Program parent revisions');
reset role;
select set_config('daily_content.test_day',current_setting('test.vod_daily_eastern_base_date'),true);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000008","role":"authenticated"}';
select is(public.get_my_stream_program_enrollment_lesson_playback(
  current_setting('test.vod_free_enrollment')::uuid,'d3154200-0000-0000-0000-000000000003'
)->>'outcome','ready','a grandfathered free enrollment keeps its exact older lesson after version replacement');
reset role;

insert into public.programs(id,coach_id,title,description,published)
values('d3154000-0000-0000-0000-000000000004','d3150000-0000-0000-0000-000000000001',
  'Synthetic forbidden UID reuse','','true');
insert into public.program_content_versions(id,program_id,revision_number,revision_kind,lesson_count,created_by)
select 'd3154100-0000-0000-0000-000000000004','d3154000-0000-0000-0000-000000000004',
  coalesce(max(version_row.revision_number),0)+1,'free_snapshot',1,
  'd3150000-0000-0000-0000-000000000001'
from public.program_content_versions version_row
where version_row.program_id='d3154000-0000-0000-0000-000000000004';
select throws_ok($$insert into public.program_content_version_lessons(
  id,program_id,content_version_id,lesson_ordinal,timeline_day_number,title,instructions,pillar,
  video_id,video_creator_id,cloudflare_uid,cloudflare_signed_urls_verified
) values('d3154200-0000-0000-0000-000000000004','d3154000-0000-0000-0000-000000000004',
  'd3154100-0000-0000-0000-000000000004',1,1,'Forbidden reuse','','body',
  'd3153000-0000-0000-0000-000000000001','d3150000-0000-0000-0000-000000000001',
  'synthetic-vod-library-ready-uid',true)$$,
  '42501',null,'the normal lifecycle guard rejects a free snapshot reusing program-only paid media');
select throws_ok($$update public.videos set cloudflare_uid='synthetic-vod-forged-replacement-uid'
  where id='d3153000-0000-0000-0000-000000000001'$$,
  '23514',null,'a Program lesson cannot silently follow a changed Library UID');

-- Static contract checks complement the actual caller fixtures above by pinning internal
-- exclusivity rules and private DTO boundaries that the transaction fixture does not mutate.
select ok(position('operation_state' in pg_get_functiondef(
    'public.get_stream_media_upload_status(uuid)'::regprocedure))>0
  and position('tus_location' in pg_get_functiondef(
    'public.get_stream_media_upload_status(uuid)'::regprocedure))=0,
  'status RPC exposes lifecycle state but not transport capability fields');
select ok(position('private.can_member_access_program' in pg_get_functiondef(
    'public.get_stream_program_intro_playback(uuid)'::regprocedure))>0,
  'Program intro playback requires the current signed-in Program audience eligibility');
select ok(position('program_order_lesson_access_for_member' in pg_get_functiondef(
    'public.get_my_stream_program_order_lesson_playback(uuid,uuid)'::regprocedure))>0
  and position('stream_app_paid_lesson_is_exclusive' in pg_get_functiondef(
    'public.get_my_stream_program_order_lesson_playback(uuid,uuid)'::regprocedure))>0,
  'paid lesson playback requires immutable order-stage access and UID exclusivity');
select ok(position('current_daily_checkin_day' in pg_get_functiondef(
    'public.get_my_stream_daily_content_video_playback(uuid,uuid)'::regprocedure))>0
  and position('video_revision_id' in pg_get_functiondef(
    'public.get_my_stream_daily_content_video_playback(uuid,uuid)'::regprocedure))>0,
  'Daily playback resolves only the current exact slot, revision, and stage');
select ok(position('bookmark.member_id=auth.uid()' in pg_get_functiondef(
    'public.get_my_stream_daily_fuel_bookmark_playback(uuid)'::regprocedure))>0
  and position('binding.owner_id=auth.uid()' in pg_get_functiondef(
    'public.get_my_stream_daily_fuel_bookmark_playback(uuid)'::regprocedure))>0,
  'bookmark playback requires the member-owned bookmark edge and exact source binding');
select ok(position('assignment.id=target_assignment_id' in pg_get_functiondef(
    'public.get_my_stream_daily_fuel_assignment_playback(uuid)'::regprocedure))>0
  and position('assignment.member_id=auth.uid()' in pg_get_functiondef(
    'public.get_my_stream_daily_fuel_assignment_playback(uuid)'::regprocedure))>0,
  'Daily Fuel playback is scoped to the caller’s exact current assignment');
select ok(position('paid_video.visibility=''program_only''' in pg_get_functiondef(
    'private.stream_app_paid_lesson_is_exclusive(uuid,uuid,uuid,text)'::regprocedure))>0
  and position('free_snapshot' in pg_get_functiondef(
    'private.stream_app_paid_lesson_is_exclusive(uuid,uuid,uuid,text)'::regprocedure))>0
  and position('intro_video' in pg_get_functiondef(
    'private.stream_app_paid_lesson_is_exclusive(uuid,uuid,uuid,text)'::regprocedure))>0
  and position('ordinary_video.visibility=''members''' in pg_get_functiondef(
    'private.stream_app_paid_lesson_is_exclusive(uuid,uuid,uuid,text)'::regprocedure))>0
  and position('post.audience<>''only_me''' in pg_get_functiondef(
    'private.stream_app_paid_lesson_is_exclusive(uuid,uuid,uuid,text)'::regprocedure))>0,
  'paid lesson playback excludes intro, free, ordinary Library, and shared community UID reuse');
select ok(position('lesson_binding.source_kind=''program_lesson''' in pg_get_functiondef(
    'private.stream_app_paid_lesson_is_exclusive(uuid,uuid,uuid,text)'::regprocedure))>0
  and position('lesson_row.cloudflare_uid' in pg_get_functiondef(
    'public.get_my_stream_program_order_lesson_playback(uuid,uuid)'::regprocedure))>0,
  'paid playback resolves the frozen lesson UID through its exact context binding');
select ok(not has_function_privilege('authenticated',
    'private.stream_app_video_projection(text,text,uuid,uuid,text)','execute')
  and position('tus_location' in pg_get_functiondef(
    'private.stream_app_video_projection(text,text,uuid,uuid,text)'::regprocedure))=0
  and position('asset.lifecycle_state=''ready_for_publication''' in pg_get_functiondef(
    'private.stream_app_video_projection(text,text,uuid,uuid,text)'::regprocedure))>0
  and position('private.can_write_post' in pg_get_functiondef(
    'public.publish_stream_community_video_submission(uuid,uuid)'::regprocedure))>0
  and position('post.removed_at is null' in pg_get_functiondef(
    'public.publish_stream_community_video_submission(uuid,uuid)'::regprocedure))>0,
  'source projections stay private and community publish rechecks visibility rights and parent removal');
select ok(position('private.stream_vod_upload_abort_inventory_digest' in pg_get_functiondef(
    'private.stream_auth_contract_current(uuid)'::regprocedure))>0
  and position('private.stream_upload_cancel_proven' in pg_get_functiondef(
    'private.stream_vod_upload_abort_inventory_digest(uuid)'::regprocedure))>0,
  'Auth readiness rechecks the cancellation receipt inventory at permit consumption');
select ok(position('private.stream_media_has_effective_reference' in pg_get_functiondef(
    'public.request_stream_media_upload_cancel(uuid,uuid)'::regprocedure))>0
  and position('private.stream_legacy_uid_unresolved' in pg_get_functiondef(
    'public.request_stream_media_upload_cancel(uuid,uuid)'::regprocedure))>0
  and position('private.stream_media_has_effective_reference' in pg_get_functiondef(
    'public.finalize_stream_media_upload_cancel(uuid,uuid,uuid,uuid)'::regprocedure))>0,
  'UID reservation and finalization recheck shared, retained, and unresolved legacy references');

-- An unknown provider create with no durable UID remains held; there is no TTL-based absence path.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000004","role":"authenticated"}';
select set_config('test.vod_unknown_prepare',public.prepare_stream_library_video_upload(
  'd3152500-0000-0000-0000-000000000001','d3153000-0000-0000-0000-000000000006',
  'Synthetic unknown create','',repeat('c',64))::text,true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.claim_stream_media_create(
  (current_setting('test.vod_unknown_prepare')::jsonb->>'operation_id')::uuid,
  'd3152500-0000-0000-0000-000000000002',
  current_setting('test.vod_unknown_prepare')::jsonb->>'request_digest'
)->>'outcome','create_authorized','unknown-create fixture first records the single durable POST claim');
select is(public.advance_stream_media_upload(
  (current_setting('test.vod_unknown_prepare')::jsonb->>'operation_id')::uuid,
  'd3152500-0000-0000-0000-000000000003','create_unknown',repeat('d',64)
)->>'outcome','advanced','a crash after provider HTTP is recorded as create_unknown');
select is(public.claim_stream_media_create(
  (current_setting('test.vod_unknown_prepare')::jsonb->>'operation_id')::uuid,
  'd3152500-0000-0000-0000-000000000002',
  current_setting('test.vod_unknown_prepare')::jsonb->>'request_digest'
)->>'create_authorized','false','an unknown prior POST cannot be recreated on replay');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(public.request_stream_media_upload_cancel(
  (current_setting('test.vod_unknown_prepare')::jsonb->>'operation_id')::uuid,
  'd3152500-0000-0000-0000-000000000004'
)->>'outcome','known_owned_unready_identity_not_proven',
  'unknown UID cannot be canceled or reconstructed from URL or TTL absence');

-- A raw legacy observation with unknown account identity blocks the UID even when a new upload
-- callback claims matching intent metadata. The raw observation is a fixture, not a binding.
reset role;
insert into public.stream_media_capture_runs(id,request_digest)
values('d3152800-0000-0000-0000-000000000001',repeat('e',64));
insert into public.stream_media_legacy_observations(
  capture_run_id,source_kind,source_identity,source_ordinal,reference_kind,
  captured_uid,uid_state,provider_account_registry_id,account_state
) values('d3152800-0000-0000-0000-000000000001','videos','synthetic-unresolved-legacy-video',0,
  'mutable_video_row','synthetic-vod-legacy-held-uid','present',null,'unknown');
select ok(private.stream_legacy_uid_unresolved(
  current_setting('test.vod_registry')::uuid,'synthetic-vod-legacy-held-uid'),
  'the synthetic legacy observation is unresolved for the registered provider account');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000005","role":"authenticated"}';
select set_config('test.vod_legacy_prepare',public.prepare_stream_library_video_upload(
  'd3152800-0000-0000-0000-000000000002','d3153000-0000-0000-0000-000000000012',
  'Synthetic legacy conflict','',repeat('f',64))::text,true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.claim_stream_media_create(
  (current_setting('test.vod_legacy_prepare')::jsonb->>'operation_id')::uuid,
  'd3152800-0000-0000-0000-000000000003',
  current_setting('test.vod_legacy_prepare')::jsonb->>'request_digest'
)->>'outcome','create_authorized','legacy conflict fixture has its normal one-time create claim');
select set_config('test.vod_legacy_expiry',(now()+interval '15 minutes')::text,true);
select is(public.record_stream_media_upload_transport(
  (current_setting('test.vod_legacy_prepare')::jsonb->>'operation_id')::uuid,
  (current_setting('test.vod_legacy_prepare')::jsonb->>'transport_request_id')::uuid,
  current_setting('test.vod_legacy_prepare')::jsonb->>'request_digest',
  'synthetic-vod-legacy-held-uid','https://upload.provider.invalid/tus/legacy-conflict',
  current_setting('test.vod_legacy_expiry')::timestamptz,7200,true,
  current_setting('test.vod_legacy_prepare')::jsonb->'metadata',repeat('1',64)
)->>'outcome','recorded','the new operation stores its exact UID and transport evidence');
select is(public.advance_stream_media_upload(
  (current_setting('test.vod_legacy_prepare')::jsonb->>'operation_id')::uuid,
  'd3152800-0000-0000-0000-000000000004','created_unverified',repeat('2',64)
)->>'outcome','advanced','legacy conflict remains unready while metadata is reconciled');
select is(public.record_stream_media_upload_observation(
  (current_setting('test.vod_legacy_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.vod_registry')::uuid,'exact_uid_get','synthetic-vod-legacy-held-uid',
  200::smallint,false,true,true,false,'d3152800-0000-0000-0000-000000000005',repeat('3',64)
)->>'outcome','recorded','the new observation cannot erase independent legacy uncertainty');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"d3150000-0000-0000-0000-000000000005","role":"authenticated"}';
select is(public.request_stream_media_upload_cancel(
  (current_setting('test.vod_legacy_prepare')::jsonb->>'operation_id')::uuid,
  'd3152800-0000-0000-0000-000000000006'
)->>'outcome','legacy_or_retained_uid_hold',
  'unresolved legacy account identity blocks destructive cleanup despite a new matching observation');
reset role;
select is((select count(*)::bigint from public.stream_media_upload_abort_manifests manifest
  where manifest.upload_operation_id=(current_setting('test.vod_legacy_prepare')::jsonb->>'operation_id')::uuid),
  0::bigint,'a legacy hold creates no cleanup-only manifest or destructive authorization');

select * from finish();
rollback;
