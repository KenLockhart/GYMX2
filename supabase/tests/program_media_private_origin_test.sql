begin;
select no_plan();

-- Synthetic local facts only. The positive origin below is produced through the
-- ordinary 315 upload RPCs; this test never fabricates an asset, binding, receipt,
-- provider event, or paid-origin row directly.
insert into auth.users(id,email,raw_user_meta_data) values
  ('c6100000-0000-4000-8000-000000000001','private-origin-coach@example.test',
   '{"display_name":"Private Origin Coach"}');
update public.profiles set role='coach'
where id='c6100000-0000-4000-8000-000000000001';

select ok(not has_table_privilege('anon','private.program_media_private_origins','select')
  and not has_table_privilege('authenticated','private.program_media_private_origins','select')
  and not has_table_privilege('service_role','private.program_media_private_origins','select')
  and not has_table_privilege('service_role','private.program_media_private_origins','insert')
  and not has_table_privilege('service_role','private.program_media_private_origins','update')
  and not has_table_privilege('service_role','private.program_media_private_origins','delete'),
  'no API role can read or mutate the private-origin registry');
select ok(not has_table_privilege('service_role','private.program_media_private_origin_epoch','select')
  and not has_table_privilege('service_role','private.program_media_private_origin_epoch','insert')
  and not has_table_privilege('service_role','private.program_media_private_origin_epoch','update')
  and not has_table_privilege('service_role','private.program_media_private_origin_epoch','delete'),
  'activation epoch has no service-role table access');
select ok(has_table_privilege('postgres','private.program_media_private_origins','select')
  and (select relrowsecurity from pg_class where oid='private.program_media_private_origins'::regclass)
  and (select relrowsecurity from pg_class where oid='private.program_media_private_origin_epoch'::regclass),
  'both private-origin tables use RLS and are available only to their owner');
select ok(not has_function_privilege('authenticated',
    'private.program_media_private_origin_mark(uuid,text,uuid,text)','execute')
  and not has_function_privilege('service_role',
    'private.program_media_private_origin_mark(uuid,text,uuid,text)','execute')
  and not has_function_privilege('service_role',
    'private.program_media_private_origin_is_current(uuid,text,uuid)','execute'),
  'private origin helpers are not an API bypass');
select ok(not exists (
  select 1 from information_schema.columns column_row
  where column_row.table_schema='private' and column_row.table_name='program_media_private_origins'
    and column_row.column_name in ('registry_id','owner_id','member_id','raw_provider_uid','raw_uid',
      'operation_id','source_identity','video_id','account_id')
), 'the durable registry stores no raw UID, actor, member, operation, or source identity');
select ok(exists (select 1 from private.program_media_private_origin_epoch where singleton)
  and (select count(*)=1 from private.program_media_private_origin_epoch),
  'one immutable activation epoch is installed');
select ok(exists (select 1 from pg_trigger where tgrelid='private.program_media_private_origin_epoch'::regclass
    and tgname='program_media_private_origin_epoch_immutable' and not tgisinternal)
  and exists (select 1 from pg_trigger where tgrelid='private.program_media_private_origins'::regclass
    and tgname='program_media_private_origin_state_monotonic' and not tgisinternal),
  'epoch mutation and nonmonotonic origin changes have database guards');
select ok((select tgdeferrable and tginitdeferred from pg_trigger
  where tgrelid='public.program_content_version_lessons'::regclass
    and tgname='program_lessons_private_origin_final_check' and not tgisinternal),
  'final paid exclusivity is deferred until the complete Program publication transaction');
select ok(not exists (
  select 1 from (values
    ('stream_media_finalization_private_origin_certificate'::text,'public.stream_media_finalization_receipts'::regclass),
    ('videos_program_private_origin_exposure','public.videos'::regclass),
    ('stream_media_source_bindings_program_private_origin_exposure','public.stream_media_source_bindings'::regclass),
    ('programs_program_private_origin_exposure','public.programs'::regclass),
    ('program_days_program_private_origin_exposure','public.program_days'::regclass),
    ('tasks_program_private_origin_exposure','public.tasks'::regclass),
    ('post_media_program_private_origin_exposure','public.post_media'::regclass),
    ('daily_content_revisions_program_private_origin_exposure','public.daily_content_revisions'::regclass),
    ('daily_content_slots_program_private_origin_exposure','public.daily_content_slots'::regclass),
    ('daily_content_grants_program_private_origin_exposure','public.member_daily_content_video_grants'::regclass),
    ('daily_fuel_assignments_program_private_origin_exposure','public.member_daily_fuel_assignments'::regclass),
    ('daily_fuel_bookmarks_program_private_origin_exposure','public.member_daily_fuel_bookmarks'::regclass),
    ('program_orders_private_origin_guard','public.program_orders'::regclass)
  ) expected(trigger_name,table_id)
  where not exists (select 1 from pg_trigger trigger_row
    where trigger_row.tgrelid=expected.table_id and trigger_row.tgname=expected.trigger_name
      and not trigger_row.tgisinternal)
), 'all required exposure, paid-order, and receipt hooks are installed');

set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.private_origin_attestation',public.record_stream_provider_account_attestation(
  'c6110000-0000-4000-8000-000000000001','c6100000000000000000000000000001',
  'vod_primary',repeat('1',64))::text,true);
select set_config('test.private_origin_registry',
  current_setting('test.private_origin_attestation')::jsonb->>'registry_id',true);
select set_config('test.private_origin_path',public.record_stream_account_path_verification(
  'c6110000-0000-4000-8000-000000000002',current_setting('test.private_origin_registry')::uuid,
  'vod_primary','c6100000000000000000000000000001',200::smallint,repeat('2',64)
  )::text,true);
reset role;
select is(current_setting('test.private_origin_attestation')::jsonb->>'outcome','recorded',
  'a synthetic provider account is attested through the existing trusted boundary');
select is(current_setting('test.private_origin_path')::jsonb->>'outcome','verified',
  'the same account obtains a synthetic fresh path verification');

-- Complete the exact 315 producer chain with fake local provider observations only.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"c6100000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.private_origin_prepare',public.prepare_stream_library_video_upload(
  'c6110000-0000-4000-8000-000000000003','c6120000-0000-4000-8000-000000000001',
  'Synthetic private origin','',repeat('3',64))::text,true);
select is(current_setting('test.private_origin_prepare')::jsonb->>'outcome','reserved',
  'normal Library preparation reserves its exact post-epoch request');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.private_origin_claim',public.claim_stream_media_create(
  (current_setting('test.private_origin_prepare')::jsonb->>'operation_id')::uuid,
  'c6110000-0000-4000-8000-000000000004',
  current_setting('test.private_origin_prepare')::jsonb->>'request_digest'
  )::text,true);
select is(current_setting('test.private_origin_claim')::jsonb->>'outcome','create_authorized',
  'the ordinary one-time 315 create claim is recorded');
select set_config('test.private_origin_transport',public.record_stream_media_upload_transport(
  (current_setting('test.private_origin_prepare')::jsonb->>'operation_id')::uuid,
  (current_setting('test.private_origin_prepare')::jsonb->>'transport_request_id')::uuid,
  current_setting('test.private_origin_prepare')::jsonb->>'request_digest',
  'synthetic-private-origin-uid','https://upload.provider.invalid/tus/private-origin',
  (now()+interval '15 minutes')::timestamptz,7200,true,
  current_setting('test.private_origin_prepare')::jsonb->'metadata',repeat('4',64)
  )::text,true);
select is(current_setting('test.private_origin_transport')::jsonb->>'outcome','recorded',
  'the exact transport row is tied to the original request and create claim');
select set_config('test.private_origin_advance',public.advance_stream_media_upload(
  (current_setting('test.private_origin_prepare')::jsonb->>'operation_id')::uuid,
  'c6110000-0000-4000-8000-000000000005','created_unverified',repeat('5',64)
  )::text,true);
select set_config('test.private_origin_observation',public.record_stream_media_upload_observation(
  (current_setting('test.private_origin_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.private_origin_registry')::uuid,'exact_uid_get','synthetic-private-origin-uid',
  200::smallint,true,true,true,true,'c6110000-0000-4000-8000-000000000006',repeat('6',64)
  )::text,true);
select set_config('test.private_origin_readback',public.bind_stream_media_upload_readback(
  (current_setting('test.private_origin_prepare')::jsonb->>'operation_id')::uuid,
  'c6110000-0000-4000-8000-000000000006','c6110000-0000-4000-8000-000000000007'
  )::text,true);
select is(current_setting('test.private_origin_readback')::jsonb->>'outcome','provisional_bound',
  'the real 315 UID readback binds a provisional Library source');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"c6100000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.private_origin_commit',public.commit_stream_library_video_upload(
  (current_setting('test.private_origin_prepare')::jsonb->>'operation_id')::uuid,
  'c6110000-0000-4000-8000-000000000008'
  )::text,true);
select is(current_setting('test.private_origin_commit')::jsonb->>'outcome','ready_for_publication',
  '315 commits the ready private Library video and completed receipt');
reset role;

select ok(private.program_media_private_origin_is_current(
    current_setting('test.private_origin_registry')::uuid,'synthetic-private-origin-uid',
    'c6120000-0000-4000-8000-000000000001'),
  'only the complete post-epoch producer chain creates current protected-private eligibility');
select ok(exists (select 1 from private.program_media_private_origins origin
  where origin.uid_digest=private.program_media_private_origin_uid_digest(
      current_setting('test.private_origin_registry')::uuid,'synthetic-private-origin-uid')
    and origin.origin_state='protected_private' and origin.origin_proof_digest ~ '^[0-9a-f]{64}$'),
  'the persisted proof is hashed and scoped to the provider registry plus UID digest');
select ok(private.program_media_private_origin_chain_digest(
    current_setting('test.private_origin_registry')::uuid,'legacy-unknown-private-origin-uid',
    'c6120000-0000-4000-8000-000000000099',true) is null,
  'an absent or historical UID remains UNKNOWN and cannot become paid eligible');

-- Build an independent ordinary Library upload for the Program intro. The first UID stays
-- unused and protected for the positive 600 publication below.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"c6100000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.private_intro_prepare',public.prepare_stream_library_video_upload(
  'c6210000-0000-4000-8000-000000000001','c6220000-0000-4000-8000-000000000002',
  'Synthetic private Program intro','',repeat('7',64))::text,true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.private_intro_claim',public.claim_stream_media_create(
  (current_setting('test.private_intro_prepare')::jsonb->>'operation_id')::uuid,
  'c6210000-0000-4000-8000-000000000002',
  current_setting('test.private_intro_prepare')::jsonb->>'request_digest')::text,true);
select set_config('test.private_intro_transport',public.record_stream_media_upload_transport(
  (current_setting('test.private_intro_prepare')::jsonb->>'operation_id')::uuid,
  (current_setting('test.private_intro_prepare')::jsonb->>'transport_request_id')::uuid,
  current_setting('test.private_intro_prepare')::jsonb->>'request_digest',
  'synthetic-private-origin-intro-uid','https://upload.provider.invalid/tus/private-intro',
  (now()+interval '15 minutes')::timestamptz,7200,true,
  current_setting('test.private_intro_prepare')::jsonb->'metadata',repeat('8',64))::text,true);
select set_config('test.private_intro_advance',public.advance_stream_media_upload(
  (current_setting('test.private_intro_prepare')::jsonb->>'operation_id')::uuid,
  'c6210000-0000-4000-8000-000000000003','created_unverified',repeat('9',64))::text,true);
select set_config('test.private_intro_observation',public.record_stream_media_upload_observation(
  (current_setting('test.private_intro_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.private_origin_registry')::uuid,'exact_uid_get',
  'synthetic-private-origin-intro-uid',200::smallint,true,true,true,true,
  'c6210000-0000-4000-8000-000000000004',repeat('a',64))::text,true);
select set_config('test.private_intro_readback',public.bind_stream_media_upload_readback(
  (current_setting('test.private_intro_prepare')::jsonb->>'operation_id')::uuid,
  'c6210000-0000-4000-8000-000000000004','c6210000-0000-4000-8000-000000000005')::text,true);
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"c6100000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.private_intro_commit',public.commit_stream_library_video_upload(
  (current_setting('test.private_intro_prepare')::jsonb->>'operation_id')::uuid,
  'c6210000-0000-4000-8000-000000000006')::text,true);
reset role;
select is(current_setting('test.private_intro_commit')::jsonb->>'outcome','ready_for_publication',
  'a separate ordinary 315 Library upload supplies the Program intro');
select ok(private.program_media_private_origin_is_current(
    current_setting('test.private_origin_registry')::uuid,
    'synthetic-private-origin-intro-uid','c6220000-0000-4000-8000-000000000002'),
  'the independent intro also has its own complete post-epoch private-origin certificate');

insert into public.payout_accounts(coach_id,stripe_account_id,charges_enabled,payouts_enabled)
values('c6100000-0000-4000-8000-000000000001','acct_PrivateOriginFixture',true,false);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"c6100000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into public.programs(id,coach_id,title,description,published,intro_video_id)
values('c6130000-0000-4000-8000-000000000001','c6100000-0000-4000-8000-000000000001',
  'Private origin paid publication test','',false,'c6220000-0000-4000-8000-000000000002');
reset role;
select is((select origin.origin_state from private.program_media_private_origins origin
  where origin.uid_digest=private.program_media_private_origin_uid_digest(
      current_setting('test.private_origin_registry')::uuid,'synthetic-private-origin-intro-uid')),
  'shared','the separate Program intro UID is monotonically classified as shared');

set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.private_origin_initial_snapshot',public.get_program_authoring_draft(
  'c6130000-0000-4000-8000-000000000001','c6100000-0000-4000-8000-000000000001')::text,true);
select set_config('test.private_origin_initial_draft',public.save_program_authoring_draft(
  'c6130000-0000-4000-8000-000000000001','c6100000-0000-4000-8000-000000000001',null,0,
  (current_setting('test.private_origin_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.private_origin_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  '[{"lesson_ordinal":1,"timeline_day_number":1,"title":"Private paid lesson","instructions":"Verified origin","pillar":"body","video_id":"c6120000-0000-4000-8000-000000000001"}]'::jsonb
)::text,true);
select set_config('test.private_origin_first_publish',public.publish_program_authoring_draft(
  'c6130000-0000-4000-8000-000000000001','c6100000-0000-4000-8000-000000000001',
  (current_setting('test.private_origin_initial_draft')::jsonb->>'draft_id')::uuid,
  (current_setting('test.private_origin_initial_draft')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.private_origin_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.private_origin_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  'c6240000-0000-4000-8000-000000000001',1200,1::smallint
)::text,true);
select is(current_setting('test.private_origin_first_publish')::jsonb->>'status','published',
  'the complete 600 publication accepts one current protected-private media origin');
reset role;
set constraints program_lessons_private_origin_final_check immediate;
select ok((select count(*)=1 from public.program_content_version_lessons lesson
  join public.program_content_versions version on version.program_id=lesson.program_id
    and version.id=lesson.content_version_id
  where lesson.program_id='c6130000-0000-4000-8000-000000000001'
    and version.revision_kind='paid'
    and lesson.cloudflare_uid='synthetic-private-origin-uid'),
  'forcing the named final constraint IMMEDIATE validates the successful complete 600 publication');
set constraints program_lessons_private_origin_final_check deferred;

set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.private_origin_reuse_snapshot',public.get_program_authoring_draft(
  'c6130000-0000-4000-8000-000000000001','c6100000-0000-4000-8000-000000000001')::text,true);
select set_config('test.private_origin_reuse_draft',public.save_program_authoring_draft(
  'c6130000-0000-4000-8000-000000000001','c6100000-0000-4000-8000-000000000001',null,0,
  (current_setting('test.private_origin_reuse_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.private_origin_reuse_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  '[{"lesson_ordinal":1,"timeline_day_number":2,"title":"Same Program reuse","instructions":"Keep origin valid","pillar":"body","video_id":"c6120000-0000-4000-8000-000000000001"}]'::jsonb
)::text,true);
select set_config('test.private_origin_reuse_publish',public.publish_program_authoring_draft(
  'c6130000-0000-4000-8000-000000000001','c6100000-0000-4000-8000-000000000001',
  (current_setting('test.private_origin_reuse_draft')::jsonb->>'draft_id')::uuid,
  (current_setting('test.private_origin_reuse_draft')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.private_origin_reuse_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.private_origin_reuse_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  'c6240000-0000-4000-8000-000000000002',1500,1::smallint
)::text,true);
select is(current_setting('test.private_origin_reuse_publish')::jsonb->>'status','published',
  'a later paid revision can reuse its own Program origin while the original proof remains current');
reset role;
set constraints program_lessons_private_origin_final_check immediate;
select ok((select count(*)=2 from public.program_content_version_lessons lesson
  join public.program_content_versions version on version.program_id=lesson.program_id
    and version.id=lesson.content_version_id
  where lesson.program_id='c6130000-0000-4000-8000-000000000001'
    and version.revision_kind='paid'
    and lesson.cloudflare_uid='synthetic-private-origin-uid'),
  'the deferred final constraint also validates same-Program paid UID reuse');
set constraints program_lessons_private_origin_final_check deferred;

-- The paid Program's separate intro is a nonpaid consumer. It shares and permanently
-- disqualifies its own UID; detaching the intro does not revive it.
select is((select origin.origin_state from private.program_media_private_origins origin
  where origin.uid_digest=private.program_media_private_origin_uid_digest(
      current_setting('test.private_origin_registry')::uuid,'synthetic-private-origin-intro-uid')),
  'shared','Program intro attachment monotonically shares and disqualifies its own origin');
select ok((select origin_proof_digest is null from private.program_media_private_origins origin
  where origin.uid_digest=private.program_media_private_origin_uid_digest(
      current_setting('test.private_origin_registry')::uuid,'synthetic-private-origin-intro-uid')),
  'sharing removes positive eligibility proof material');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"c6100000-0000-4000-8000-000000000001","role":"authenticated"}';
update public.programs set intro_video_id=null
where id='c6130000-0000-4000-8000-000000000001';
reset role;
select is((select origin.origin_state from private.program_media_private_origins origin
  where origin.uid_digest=private.program_media_private_origin_uid_digest(
      current_setting('test.private_origin_registry')::uuid,'synthetic-private-origin-intro-uid')),
  'shared','detaching a consumer cannot revive a shared UID');
select ok(not private.program_media_private_origin_is_current(
    current_setting('test.private_origin_registry')::uuid,'synthetic-private-origin-intro-uid',
    'c6220000-0000-4000-8000-000000000002'),
  'a detached intro UID remains ineligible for paid reuse');

-- The older frozen 1550 validator still rejects cross-Program UID reuse before 610's deferred
-- check. Keep the attempted publication and the forced check in one exception subtransaction;
-- the expected earlier guard rolls back the attempted publication before the test continues.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"c6100000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into public.programs(id,coach_id,title,description,published,intro_video_id)
values('c6230000-0000-4000-8000-000000000002','c6100000-0000-4000-8000-000000000001',
  'Cross Program pending check','',false,'c6220000-0000-4000-8000-000000000002');
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.private_origin_negative_snapshot',public.get_program_authoring_draft(
  'c6230000-0000-4000-8000-000000000002','c6100000-0000-4000-8000-000000000001')::text,true);
select set_config('test.private_origin_negative_draft',public.save_program_authoring_draft(
  'c6230000-0000-4000-8000-000000000002','c6100000-0000-4000-8000-000000000001',null,0,
  (current_setting('test.private_origin_negative_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.private_origin_negative_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  '[{"lesson_ordinal":1,"timeline_day_number":1,"title":"Cross Program UID","instructions":"Must fail final check","pillar":"body","video_id":"c6120000-0000-4000-8000-000000000001"}]'::jsonb
)::text,true);
select set_config('test.private_origin_negative_before',(
  select state.current_content_version_id::text||':'||state.current_offer_version_id::text
  from public.program_commerce_state state where state.program_id='c6230000-0000-4000-8000-000000000002'
),true);
do $$
declare
  caught_state text;
  caught_message text;
begin
  begin
    perform public.publish_program_authoring_draft(
      'c6230000-0000-4000-8000-000000000002','c6100000-0000-4000-8000-000000000001',
      (current_setting('test.private_origin_negative_draft')::jsonb->>'draft_id')::uuid,
      (current_setting('test.private_origin_negative_draft')::jsonb->>'draft_revision')::bigint,
      (current_setting('test.private_origin_negative_snapshot')::jsonb->>'current_content_version_id')::uuid,
      (current_setting('test.private_origin_negative_snapshot')::jsonb->>'current_offer_version_id')::uuid,
      'c6240000-0000-4000-8000-000000000003',1800,1::smallint);
    execute 'set constraints program_lessons_private_origin_final_check immediate';
    perform set_config('test.private_origin_negative_failure','NO_ERROR',true);
  exception when others then
    get stacked diagnostics caught_state=returned_sqlstate,caught_message=message_text;
    perform set_config('test.private_origin_negative_failure',
      coalesce(caught_state,'<no-sqlstate>')||':'||coalesce(caught_message,'<no-message>'),true);
  end;
end;
$$;
reset role;
set constraints program_lessons_private_origin_final_check deferred;
select is(current_setting('test.private_origin_negative_failure'),
  '23514:Paid Program media cannot reuse an intro, free lesson, Task, or Daily Fuel video',
  'the frozen 1550 validator rejects cross-Program paid UID reuse before the 610 deferred guard');
select is((select state.current_content_version_id::text||':'||state.current_offer_version_id::text
  from public.program_commerce_state state where state.program_id='c6230000-0000-4000-8000-000000000002'),
  current_setting('test.private_origin_negative_before'),
  'the failed negative check rolled back Program pointer changes');
select is((select count(*) from public.program_content_version_lessons lesson
  join public.program_content_versions version on version.program_id=lesson.program_id
    and version.id=lesson.content_version_id
  where lesson.program_id='c6230000-0000-4000-8000-000000000002'
    and version.revision_kind='paid'),0::bigint,
  'the earlier 1550 rejection leaves no invalid paid lesson to retrigger at outer commit');

-- A separate fresh private UID reaches 610's actual final constraint. It uses the normal 315
-- Library producer, then adds one same-Program paid version/lesson without completing 600's
-- Program-only visibility and current-pointer publication transition.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"c6100000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.private_origin_final_prepare',public.prepare_stream_library_video_upload(
  'c6310000-0000-4000-8000-000000000001','c6320000-0000-4000-8000-000000000003',
  'Synthetic deferred-guard candidate','',repeat('d',64))::text,true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.private_origin_final_claim',public.claim_stream_media_create(
  (current_setting('test.private_origin_final_prepare')::jsonb->>'operation_id')::uuid,
  'c6310000-0000-4000-8000-000000000002',
  current_setting('test.private_origin_final_prepare')::jsonb->>'request_digest')::text,true);
select set_config('test.private_origin_final_transport',public.record_stream_media_upload_transport(
  (current_setting('test.private_origin_final_prepare')::jsonb->>'operation_id')::uuid,
  (current_setting('test.private_origin_final_prepare')::jsonb->>'transport_request_id')::uuid,
  current_setting('test.private_origin_final_prepare')::jsonb->>'request_digest',
  'synthetic-private-final-uid','https://upload.provider.invalid/tus/private-final',
  (now()+interval '15 minutes')::timestamptz,7200,true,
  current_setting('test.private_origin_final_prepare')::jsonb->'metadata',repeat('e',64))::text,true);
select set_config('test.private_origin_final_advance',public.advance_stream_media_upload(
  (current_setting('test.private_origin_final_prepare')::jsonb->>'operation_id')::uuid,
  'c6310000-0000-4000-8000-000000000003','created_unverified',repeat('f',64))::text,true);
select set_config('test.private_origin_final_observation',public.record_stream_media_upload_observation(
  (current_setting('test.private_origin_final_prepare')::jsonb->>'operation_id')::uuid,
  current_setting('test.private_origin_registry')::uuid,'exact_uid_get','synthetic-private-final-uid',
  200::smallint,true,true,true,true,'c6310000-0000-4000-8000-000000000004',repeat('1',64))::text,true);
select set_config('test.private_origin_final_readback',public.bind_stream_media_upload_readback(
  (current_setting('test.private_origin_final_prepare')::jsonb->>'operation_id')::uuid,
  'c6310000-0000-4000-8000-000000000004','c6310000-0000-4000-8000-000000000005')::text,true);
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"c6100000-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('test.private_origin_final_commit',public.commit_stream_library_video_upload(
  (current_setting('test.private_origin_final_prepare')::jsonb->>'operation_id')::uuid,
  'c6310000-0000-4000-8000-000000000006')::text,true);
reset role;
select is(current_setting('test.private_origin_final_commit')::jsonb->>'outcome','ready_for_publication',
  'the deferred-guard fixture is a fresh ordinary 315 Library upload');
select ok(private.program_media_private_origin_is_current(
    current_setting('test.private_origin_registry')::uuid,'synthetic-private-final-uid',
    'c6320000-0000-4000-8000-000000000003'),
  'the independent final-guard UID has valid canonical private-origin evidence');

select set_config('test.private_origin_final_pointer_before',(
  select state.current_content_version_id::text||':'||state.current_offer_version_id::text
  from public.program_commerce_state state where state.program_id='c6130000-0000-4000-8000-000000000001'
),true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
do $$
declare
  next_revision integer;
  caught_state text;
  caught_message text;
begin
  begin
    select coalesce(max(version.revision_number),0)+1 into next_revision
    from public.program_content_versions version
    where version.program_id='c6130000-0000-4000-8000-000000000001';
    insert into public.program_content_versions(
      id,program_id,revision_number,revision_kind,lesson_count,created_by
    ) values (
      'c6330000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000001',
      next_revision,'paid',1,'c6100000-0000-4000-8000-000000000001'
    );
    insert into public.program_content_version_lessons(
      id,program_id,content_version_id,lesson_ordinal,timeline_day_number,
      title,instructions,pillar,video_id,video_creator_id,cloudflare_uid,
      cloudflare_signed_urls_verified
    ) values (
      'c6330000-0000-4000-8000-000000000002','c6130000-0000-4000-8000-000000000001',
      'c6330000-0000-4000-8000-000000000001',1,3,'Deferred final-state probe','',
      'body','c6320000-0000-4000-8000-000000000003',
      'c6100000-0000-4000-8000-000000000001','synthetic-private-final-uid',true
    );
    execute 'set constraints program_lessons_private_origin_final_check immediate';
    perform set_config('test.private_origin_final_negative_failure','NO_ERROR',true);
  exception when others then
    get stacked diagnostics caught_state=returned_sqlstate,caught_message=message_text;
    perform set_config('test.private_origin_final_negative_failure',
      coalesce(caught_state,'<no-sqlstate>')||':'||coalesce(caught_message,'<no-message>'),true);
  end;
end;
$$;
reset role;
set constraints program_lessons_private_origin_final_check deferred;
select is(current_setting('test.private_origin_final_negative_failure'),
  '23514:Paid Program media failed its final origin or exclusivity check',
  'the separate same-Program incomplete publication reaches and fails the 610 deferred final guard');
select is((select state.current_content_version_id::text||':'||state.current_offer_version_id::text
  from public.program_commerce_state state where state.program_id='c6130000-0000-4000-8000-000000000001'),
  current_setting('test.private_origin_final_pointer_before'),
  'the incomplete final-state subtransaction leaves Program content and offer pointers unchanged');
select is((select count(*) from public.program_content_versions version
  where version.id='c6330000-0000-4000-8000-000000000001'),0::bigint,
  'the failing final constraint rolls back the new paid version');
select is((select count(*) from public.program_content_version_lessons lesson
  where lesson.id='c6330000-0000-4000-8000-000000000002'),0::bigint,
  'the failing final constraint rolls back its new paid lesson');
select is((select count(*) from public.stream_media_source_bindings binding
  where binding.source_kind='program_lesson'
    and binding.source_identity='c6330000-0000-4000-8000-000000000002'),0::bigint,
  'the failing final constraint rolls back the provisional 315 lesson binding');
select is((select count(*) from public.stream_media_source_binding_events event
  join public.stream_media_source_bindings binding on binding.id=event.binding_id
  where binding.source_kind='program_lesson'
    and binding.source_identity='c6330000-0000-4000-8000-000000000002'),0::bigint,
  'the failing final constraint leaves no source-binding events for the rolled-back lesson');

-- The canonical positive origin is exercised through the helper because 315 does not let a
-- Library UID be repurposed as a second Community upload. This directly verifies the UID helper
-- transition, without manufacturing a second asset/binding or a positive origin row.
select private.program_media_private_origin_mark_uid('synthetic-private-final-uid','shared');
select is((select origin.origin_state from private.program_media_private_origins origin
  where origin.uid_digest=private.program_media_private_origin_uid_digest(
    current_setting('test.private_origin_registry')::uuid,'synthetic-private-final-uid')),
  'shared','the UID helper transitions a fresh protected origin to shared');
select ok((select origin.origin_proof_digest is null from private.program_media_private_origins origin
  where origin.uid_digest=private.program_media_private_origin_uid_digest(
    current_setting('test.private_origin_registry')::uuid,'synthetic-private-final-uid')),
  'helper taint removes positive proof material');

set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.private_origin_cleanup_result',public.begin_stream_account_media_cleanup(
  'c6340000-0000-4000-8000-000000000001','c6100000-0000-4000-8000-000000000001',
  'c6340000-0000-4000-8000-000000000002',repeat('2',64),
  'c6340000-0000-4000-8000-000000000003',repeat('3',64))::text,true);
reset role;
select ok(current_setting('test.private_origin_cleanup_result')::jsonb->>'outcome' is not null,
  'the normal service account-cleanup entrypoint creates its tombstone and reaches the cleanup hook');
select is((select origin.origin_state from private.program_media_private_origins origin
  where origin.uid_digest=private.program_media_private_origin_uid_digest(
    current_setting('test.private_origin_registry')::uuid,'synthetic-private-final-uid')),
  'denied','account tombstone cleanup removes positive eligibility and preserves a denial tombstone');

select * from finish();
rollback;
