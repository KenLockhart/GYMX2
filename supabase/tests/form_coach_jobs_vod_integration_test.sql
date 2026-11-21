-- DEPENDENCY: run only after 20261119031500_stream_media_app_contracts.sql is accepted and applied.
-- This companion exercises the real 315 VOD-upload-abort proof with the 420 Form Coach grant.
-- The standalone form_coach_jobs_test.sql intentionally has no dependency on 315.
-- Assessment/template/receipt rows below are synthetic owner fixtures for the 420 job/Auth contract;
-- they do not exercise the normal Form Coach template or funding producer.
begin;
select plan(18);

insert into auth.users(id,email,raw_user_meta_data) values
  ('f4210000-0000-4000-8000-000000000001','jobs-vod-coach@example.test','{"display_name":"Jobs VOD Coach"}'),
  ('f4210000-0000-4000-8000-000000000002','jobs-vod-member@example.test','{"display_name":"Jobs VOD Member"}');
update public.profiles set role='coach' where id='f4210000-0000-4000-8000-000000000001';
insert into public.coach_members(coach_id,member_id)
values('f4210000-0000-4000-8000-000000000001','f4210000-0000-4000-8000-000000000002');
insert into public.form_coach_terms_versions(version,document_path,document_sha256,created_by)
values(1,'/legal/form-coach/terms/1',repeat('a',64),'f4210000-0000-4000-8000-000000000001');
insert into public.form_coach_templates(id,owner_subject_id,owner_id,owner_kind,name)
values('f4210000-0000-4000-8000-000000000010','f4210000-0000-4000-8000-000000000001',
  'f4210000-0000-4000-8000-000000000001','coach','Synthetic VOD Jobs Curl');
insert into public.form_coach_template_versions(
  id,template_id,revision,exercise_key,schema_version,template_payload,payload_sha256,state,
  created_by,published_by,published_at
) values(
  'f4210000-0000-4000-8000-000000000011','f4210000-0000-4000-8000-000000000010',1,
  'dumbbell_curl',1,'{}'::jsonb,repeat('b',64),'published',
  'f4210000-0000-4000-8000-000000000001','f4210000-0000-4000-8000-000000000001',now()
);
select set_config('test.jobs_vod_numeric_payload',jsonb_build_object(
  'rep_count',1,'average_score',84,'minimum_score',84,'maximum_score',84,
  'rom_min_angle_average',30,'rom_max_angle_average',120,'rom_average',86,
  'elbow_average',82,'torso_average',90,'tempo_average',85,'shoulders_average',84,
  'max_upper_arm_drift',24,'max_torso_swing',12,'max_shrug',0.22,
  'concentric_ms_average',950,'top_pause_ms_average',180,'eccentric_ms_average',1100,
  'curve_similarity_average',88,'elbow_drift_count',0,'torso_swing_count',0,
  'short_rom_count',0,'shoulder_shrug_count',0
)::text,true);
insert into public.form_coach_assessments(
  id,send_request_id,send_digest,source_kind,member_subject_id,member_owner_id,
  coach_subject_id,coach_owner_id,sent_by_subject_id,sent_by_owner_id,payer_role,
  payer_subject_id,payer_owner_id,config_revision,due_at,status
) values(
  'f4210000-0000-4000-8000-000000000020','f4210000-0000-4000-8000-000000000120',repeat('c',64),
  'manual','f4210000-0000-4000-8000-000000000002','f4210000-0000-4000-8000-000000000002',
  'f4210000-0000-4000-8000-000000000001','f4210000-0000-4000-8000-000000000001',
  'f4210000-0000-4000-8000-000000000001','f4210000-0000-4000-8000-000000000001',
  'member','f4210000-0000-4000-8000-000000000002','f4210000-0000-4000-8000-000000000002',
  1,'2027-01-01 00:00:00+00','completed'
);
insert into public.form_coach_assessment_items(
  id,assessment_id,item_ordinal,item_key,item_title_snapshot,template_version_id,exercise_key,required_reps
) values('f4210000-0000-4000-8000-000000000030','f4210000-0000-4000-8000-000000000020',1,
  'jobs_vod_item','Synthetic VOD integration item','f4210000-0000-4000-8000-000000000011','dumbbell_curl',1);
insert into public.feature_bundle_funding_receipts(
  bundle_id,feature_key,payer_role,payer_id,config_revision,funding_source,source_id,
  credit_units_consumed,due_at,operation_key
) values('f4210000-0000-4000-8000-000000000020','form_coach','member',
  'f4210000-0000-4000-8000-000000000002',1,'comp','jobs-vod-synthetic-comp',0,
  '2027-01-01 00:00:00+00','jobs-vod-synthetic-operation');
insert into public.form_coach_attempts(
  id,assessment_id,item_id,member_subject_id,attempt_number,state,lease_token,lease_expires_at,
  consent_terms_version,started_at,finished_at,result_digest
) values('f4210000-0000-4000-8000-000000000040','f4210000-0000-4000-8000-000000000020',
  'f4210000-0000-4000-8000-000000000030','f4210000-0000-4000-8000-000000000002',1,'finished',
  'f4210000-0000-4000-8000-000000000140',now()-interval '1 minute',1,now()-interval '2 minutes',now(),repeat('1',64));
insert into public.form_coach_attempt_results(attempt_id,result_digest,rep_count,average_score,numeric_summary)
values('f4210000-0000-4000-8000-000000000040',repeat('1',64),1,84,
  current_setting('test.jobs_vod_numeric_payload')::jsonb);
insert into public.form_coach_summary_outbox(attempt_id,prompt_version,numeric_payload,next_attempt_at)
values('f4210000-0000-4000-8000-000000000040','attempt-summary-v1',
  current_setting('test.jobs_vod_numeric_payload')::jsonb,now());

set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.jobs_vod_claim',(
  select to_jsonb(claimed)::text from public.service_claim_form_coach_summary_jobs_v2(
    1::smallint,'f4210000-0000-4000-8000-000000000040'::uuid) claimed
),true);
select set_config('test.jobs_vod_auth',public.service_authorize_form_coach_summary_dispatch(
  (current_setting('test.jobs_vod_claim')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.jobs_vod_claim')::jsonb->>'claim_token')::uuid)::text,true);
reset role;
select is(current_setting('test.jobs_vod_auth')::jsonb->>'outcome','authorized',
  'a valid manual member result receives one numeric-only dispatch grant');

insert into public.stream_media_operations(
  id,request_id,operation_kind,actor_id,owner_id,source_kind,source_identity,
  parent_kind,parent_identity,expected_source_revision,operation_digest
) values(
  'f4210000-0000-4000-8000-000000000100','f4210000-0000-4000-8000-000000000101',
  'account_cleanup','f4210000-0000-4000-8000-000000000002','f4210000-0000-4000-8000-000000000002',
  'account','f4210000-0000-4000-8000-000000000002','account','f4210000-0000-4000-8000-000000000002',1,repeat('c',64));
insert into public.stream_media_operation_states(operation_id,operation_state)
values('f4210000-0000-4000-8000-000000000100','completed');
insert into public.stream_media_account_tombstones(
  id,account_id,request_id,request_digest,tombstone_state,source_revision_digest,revision
) values('f4210000-0000-4000-8000-000000000102','f4210000-0000-4000-8000-000000000002',
  'f4210000-0000-4000-8000-000000000101',repeat('d',64),'provider_cleanup',repeat('e',64),1);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is((select count(*)::integer from public.service_claim_form_coach_summary_jobs_v2(
  1::smallint,'f4210000-0000-4000-8000-000000000040'::uuid)),0,
  'an unexpired dispatch claim cannot be claimed a second time');
select is(public.record_stream_vod_upload_abort_component_proof(
  'f4210000-0000-4000-8000-000000000102',1,'f4210000-0000-4000-8000-000000000103')->>'outcome',
  'recorded','the 315 VOD upload-abort inventory is recorded through its real service API');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.jobs_vod_billing_cleanup',public.service_record_form_coach_billing_cleanup(
  'f4210000-0000-4000-8000-000000000102',1::bigint,'f4210000-0000-4000-8000-000000000112'
)::text,true);
reset role;
select is((select proof.proof_state::text from public.stream_media_auth_component_proof_events proof
  where proof.tombstone_id='f4210000-0000-4000-8000-000000000102'
    and proof.component_key='form_coach_billing'
  order by proof.proof_sequence desc limit 1),'ready',
  'the actual 330 billing cleanup RPC records the required empty-ledger component proof');
select set_config('test.jobs_vod_incomplete',public.service_record_form_coach_auth_cleanup_proof(
  'f4210000-0000-4000-8000-000000000102',1,'f4210000-0000-4000-8000-000000000104')::text,true);
select is((current_setting('test.jobs_vod_incomplete')::jsonb->>'ready')::boolean,false,
  'the live 420 summary grant blocks the combined Form Coach cleanup proof');
select is((current_setting('test.jobs_vod_incomplete')::jsonb->>'unresolved_count')::integer,1,
  'the combined proof identifies the single live local dispatch grant');
select is(public.prepare_stream_auth_deletion_permit(
  'f4210000-0000-4000-8000-000000000102',1,'f4210000-0000-4000-8000-000000000105',
  'f4210000-0000-4000-8000-000000000106',repeat('f',64))->>'outcome',
  'required_component_proofs_incomplete','a live dispatch grant blocks the cross-migration Auth permit');
reset role;
select pg_sleep(13);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.jobs_vod_ready',public.service_record_form_coach_auth_cleanup_proof(
  'f4210000-0000-4000-8000-000000000102',1,'f4210000-0000-4000-8000-000000000107')::text,true);
select is((current_setting('test.jobs_vod_ready')::jsonb->>'ready')::boolean,true,
  'the expired local permission permits the complete Form Coach inventory proof to become ready');
select is(public.prepare_stream_auth_deletion_permit(
  'f4210000-0000-4000-8000-000000000102',1,'f4210000-0000-4000-8000-000000000105',
  'f4210000-0000-4000-8000-000000000108',repeat('1',64))->>'outcome',
  'permit_ready','the current 315 and 420 component proofs authorize one synthetic permit');
reset role;
select ok(private.stream_auth_contract_current('f4210000-0000-4000-8000-000000000105'),
  'the permit is current under the 315-integrated shared Auth contract');
select set_config('test.jobs_vod_tombstone_state_revision',(
  select state_revision::text from public.stream_media_account_tombstones
  where id='f4210000-0000-4000-8000-000000000102'
),true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.start_stream_auth_deletion_call(
  'f4210000-0000-4000-8000-000000000105',1,
  current_setting('test.jobs_vod_tombstone_state_revision')::bigint,
  'f4210000-0000-4000-8000-000000000109',repeat('2',64))->>'outcome','started',
  'the synthetic Auth call transition uses only database workflow RPCs');
select is(public.record_stream_auth_deletion_result(
  'f4210000-0000-4000-8000-000000000105',2,
  current_setting('test.jobs_vod_tombstone_state_revision')::bigint+1,
  'unknown','f4210000-0000-4000-8000-000000000110',repeat('3',64))->>'outcome','recorded',
  'the synthetic unknown Auth result puts the same permit into revalidation');
select is(public.prepare_stream_auth_deletion_permit(
  'f4210000-0000-4000-8000-000000000102',1,'f4210000-0000-4000-8000-000000000105',
  'f4210000-0000-4000-8000-000000000111',repeat('4',64))->>'outcome','revalidated',
  'the same permit revalidates with both component proofs current');
reset role;
select ok(private.stream_auth_contract_current('f4210000-0000-4000-8000-000000000105'),
  'the revalidated permit remains current before the late summary finish');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.service_authorize_form_coach_summary_dispatch(
  (current_setting('test.jobs_vod_claim')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.jobs_vod_claim')::jsonb->>'claim_token')::uuid)->>'outcome','stale_claim',
  'the deleted account cannot authorize another summary dispatch after the ready proof');
select is((select count(*)::integer from public.service_claim_form_coach_summary_jobs_v2(
  1::smallint,'f4210000-0000-4000-8000-000000000040'::uuid)),0,
  'the deleted account cannot reclaim summary work after the ready proof');
select is(public.service_finish_form_coach_summary_dispatch(
  (current_setting('test.jobs_vod_claim')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.jobs_vod_claim')::jsonb->>'claim_token')::uuid,
  (current_setting('test.jobs_vod_auth')::jsonb->>'dispatch_token')::uuid,
  'complete','Late VOD-integrated output must be discarded.')::text,
  '{"outcome": "blocked_deletion"}'::jsonb::text,
  'a late 420 summary finish is fenced after the 315-integrated Auth permit is ready');
reset role;
select ok(private.stream_auth_contract_current('f4210000-0000-4000-8000-000000000105'),
  'the actual 315 VOD and 420 Form Coach proofs remain current after late output is discarded');

select * from finish();
rollback;
