begin;
select plan(70);

-- These Owner-built rows are synthetic rollback-only facts. The suite makes no provider,
-- Storage, Stripe, Auth API, or notification calls; worker transitions use the service RPCs.
insert into auth.users(id,email,raw_user_meta_data) values
  ('f4200000-0000-4000-8000-000000000001','jobs-coach@example.test','{"display_name":"Jobs Coach"}'),
  ('f4200000-0000-4000-8000-000000000002','jobs-member@example.test','{"display_name":"Jobs Member"}'),
  ('f4200000-0000-4000-8000-000000000003','jobs-admin@example.test','{"display_name":"Jobs Admin"}');
update public.profiles set role='coach' where id='f4200000-0000-4000-8000-000000000001';
update public.profiles set role='admin' where id='f4200000-0000-4000-8000-000000000003';
insert into public.coach_members(coach_id,member_id)
values('f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000002');
insert into public.form_coach_terms_versions(version,document_path,document_sha256,created_by)
values(1,'/legal/form-coach/terms/1',repeat('a',64),'f4200000-0000-4000-8000-000000000001');
insert into public.form_coach_templates(id,owner_subject_id,owner_id,owner_kind,name)
values('f4200000-0000-4000-8000-000000000010','f4200000-0000-4000-8000-000000000001',
  'f4200000-0000-4000-8000-000000000001','coach','Synthetic Jobs Curl');
insert into public.form_coach_template_versions(
  id,template_id,revision,exercise_key,schema_version,template_payload,payload_sha256,state,
  created_by,published_by,published_at
) values(
  'f4200000-0000-4000-8000-000000000011','f4200000-0000-4000-8000-000000000010',1,
  'dumbbell_curl',1,'{}'::jsonb,repeat('b',64),'published',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',now()
);
select set_config('test.jobs_numeric_payload',jsonb_build_object(
  'rep_count',1,'average_score',84,'minimum_score',84,'maximum_score',84,
  'rom_min_angle_average',30,'rom_max_angle_average',120,'rom_average',86,
  'elbow_average',82,'torso_average',90,'tempo_average',85,'shoulders_average',84,
  'max_upper_arm_drift',24,'max_torso_swing',12,'max_shrug',0.22,
  'concentric_ms_average',950,'top_pause_ms_average',180,'eccentric_ms_average',1100,
  'curve_similarity_average',88,'elbow_drift_count',0,'torso_swing_count',0,
  'short_rom_count',0,'shoulder_shrug_count',0
)::text,true);

-- Owner-only source reconstruction mirrors the complete Form Coach inventory recorded by 420.
-- The paired snapshot below includes raw job, dispatch, and result rows for late-finish checks.
create function pg_temp.form_coach_jobs_component_inventory(target_account_id uuid)
returns jsonb language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(resource.value order by resource.value::text),'[]'::jsonb)
  from (
    select jsonb_build_object('kind','upload','id',intent.id,'state',intent.state,'bucket',intent.bucket_id,
      'path',intent.storage_path,'expected',intent.expected_sha256,'observed',intent.observed_sha256,
      'proof',intent.source_proof_digest) as value
    from public.form_coach_media_upload_intents intent where intent.owner_subject_id=target_account_id
    union all
    select jsonb_build_object('kind','asset_claim','id',asset.id,'state',asset.source_guard_state,
      'upload',asset.upload_intent_id,'sha',asset.content_sha256) from public.form_coach_template_asset_claims asset
    where asset.owner_subject_id=target_account_id
    union all
    select jsonb_build_object('kind','clip','id',clip.id,'state',clip.state,'upload',clip.upload_intent_id,
      'delete_after',clip.delete_after,'sha',clip.content_sha256) from public.form_coach_attempt_clips clip
    where clip.member_subject_id=target_account_id
    union all
    select jsonb_build_object('kind','cleanup','id',queue.id,'state',queue.state,'asset',queue.asset_id,
      'evidence',queue.evidence_digest) from public.form_coach_media_cleanup_queue queue
    join public.form_coach_media_upload_intents intent on intent.id=queue.asset_id
    where intent.owner_subject_id=target_account_id
    union all
    select jsonb_build_object('kind','attempt','id',attempt.id,'state',attempt.state,
      'result_digest',attempt.result_digest) from public.form_coach_attempts attempt
    join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
    where assessment.member_subject_id=target_account_id or assessment.coach_subject_id=target_account_id
    union all
    select jsonb_build_object('kind','program_send','id',outbox.id,'state',outbox.state,
      'outcome',outbox.last_outcome,'assessment_id',outbox.assessment_id)
    from public.form_coach_program_send_outbox outbox
    where outbox.member_subject_id=target_account_id or outbox.program_owner_subject_id=target_account_id
    union all
    select jsonb_build_object('kind','program_send_item','outbox_id',item.outbox_id,
      'ordinal',item.item_ordinal,'template_version',item.template_version_id)
    from public.form_coach_program_send_outbox_items item
    join public.form_coach_program_send_outbox outbox on outbox.id=item.outbox_id
    where outbox.member_subject_id=target_account_id or outbox.program_owner_subject_id=target_account_id
    union all
    select jsonb_build_object('kind','summary_outbox','id',outbox.id,'state',outbox.state,
      'attempt_id',outbox.attempt_id,'completed_digest',outbox.completed_digest)
    from public.form_coach_summary_outbox outbox
    join public.form_coach_attempts attempt on attempt.id=outbox.attempt_id
    join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
    where assessment.member_subject_id=target_account_id or assessment.coach_subject_id=target_account_id
    union all
    select jsonb_build_object('kind','summary_dispatch','outbox_id',dispatch.outbox_id,
      'authorized_at',dispatch.authorized_at,'dispatch_deadline',dispatch.dispatch_deadline,
      'settled_at',dispatch.settled_at,'outcome_category',dispatch.outcome_category)
    from public.form_coach_summary_dispatches dispatch
    join public.form_coach_summary_outbox outbox on outbox.id=dispatch.outbox_id
    join public.form_coach_attempts attempt on attempt.id=outbox.attempt_id
    join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
    where assessment.member_subject_id=target_account_id or assessment.coach_subject_id=target_account_id
    union all
    select jsonb_build_object('kind','notification_outbox','id',outbox.id,'state',outbox.state,
      'event_kind',outbox.event_kind,'assessment_id',outbox.assessment_id)
    from public.form_coach_notification_outbox outbox where outbox.recipient_subject_id=target_account_id
  ) resource
$$;

create function pg_temp.form_coach_jobs_rows(target_account_id uuid)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object(
    'outbox',coalesce((select jsonb_agg(jsonb_build_object('id',outbox.id,'attempt_id',outbox.attempt_id,
      'state',outbox.state,'claim_token',outbox.claim_token,'lease_expires_at',outbox.lease_expires_at,
      'attempt_count',outbox.attempt_count,'next_attempt_at',outbox.next_attempt_at,
      'completed_digest',outbox.completed_digest,'numeric_payload',outbox.numeric_payload)
      order by outbox.id)
      from public.form_coach_summary_outbox outbox
      join public.form_coach_attempts attempt on attempt.id=outbox.attempt_id
      join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
      where assessment.member_subject_id=target_account_id or assessment.coach_subject_id=target_account_id),'[]'::jsonb),
    'attempts',coalesce((select jsonb_agg(jsonb_build_object('id',attempt.id,'state',attempt.state,
      'lease_token',attempt.lease_token,'lease_expires_at',attempt.lease_expires_at,
      'finished_at',attempt.finished_at,'result_digest',attempt.result_digest) order by attempt.id)
      from public.form_coach_attempts attempt
      join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
      where assessment.member_subject_id=target_account_id or assessment.coach_subject_id=target_account_id),'[]'::jsonb),
    'results',coalesce((select jsonb_agg(jsonb_build_object('attempt_id',result.attempt_id,
      'result_digest',result.result_digest,'summary_state',result.summary_state,
      'numeric_summary',result.numeric_summary,'coach_summary',result.coach_summary) order by result.attempt_id)
      from public.form_coach_attempt_results result
      join public.form_coach_attempts attempt on attempt.id=result.attempt_id
      join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
      where assessment.member_subject_id=target_account_id or assessment.coach_subject_id=target_account_id),'[]'::jsonb),
    'dispatches',coalesce((select jsonb_agg(jsonb_build_object('id',dispatch.id,'outbox_id',dispatch.outbox_id,
      'claim_token',dispatch.claim_token,'dispatch_token',dispatch.dispatch_token,
      'authorized_at',dispatch.authorized_at,'dispatch_deadline',dispatch.dispatch_deadline,
      'settled_at',dispatch.settled_at,'outcome_category',dispatch.outcome_category,
      'result_digest',dispatch.result_digest) order by dispatch.id)
      from public.form_coach_summary_dispatches dispatch
      join public.form_coach_summary_outbox outbox on outbox.id=dispatch.outbox_id
      join public.form_coach_attempts attempt on attempt.id=outbox.attempt_id
      join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
      where assessment.member_subject_id=target_account_id or assessment.coach_subject_id=target_account_id),'[]'::jsonb)
  )
$$;

-- A ready manual coach-linked member assessment exercises the real summary service RPC path.
select is((select revision.status from public.feature_pricing_current current
  join public.feature_pricing_revisions revision on revision.feature_key=current.feature_key
    and revision.revision=current.revision where current.feature_key='form_coach'),
  'pricing_pending','the saved historical funding receipt is exercised while current pricing is pending');
insert into public.form_coach_assessments(
  id,send_request_id,send_digest,source_kind,member_subject_id,member_owner_id,
  coach_subject_id,coach_owner_id,sent_by_subject_id,sent_by_owner_id,payer_role,
  payer_subject_id,payer_owner_id,config_revision,due_at,status
) values
 ('f4200000-0000-4000-8000-000000000020','f4200000-0000-4000-8000-000000000120',repeat('c',64),
  'manual','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'member','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  1,'2027-01-01 00:00:00+00','completed'),
 ('f4200000-0000-4000-8000-000000000021','f4200000-0000-4000-8000-000000000121',repeat('d',64),
  'manual','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'member','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  1,'2027-01-01 00:00:00+00','completed'),
 ('f4200000-0000-4000-8000-000000000022','f4200000-0000-4000-8000-000000000122',repeat('e',64),
  'manual','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'member','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  1,'2027-01-01 00:00:00+00','completed'),
 ('f4200000-0000-4000-8000-000000000024','f4200000-0000-4000-8000-000000000124',repeat('9',64),
  'manual','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'member','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  1,'2027-01-01 00:00:00+00','completed');
insert into public.form_coach_assessment_items(
  id,assessment_id,item_ordinal,item_key,item_title_snapshot,template_version_id,
  exercise_key,required_reps,max_attempts
) values
 ('f4200000-0000-4000-8000-000000000030','f4200000-0000-4000-8000-000000000020',1,
  'jobs_a','Synthetic summary A','f4200000-0000-4000-8000-000000000011','dumbbell_curl',1,3),
 ('f4200000-0000-4000-8000-000000000031','f4200000-0000-4000-8000-000000000021',1,
  'jobs_b','Synthetic summary B','f4200000-0000-4000-8000-000000000011','dumbbell_curl',1,3),
 ('f4200000-0000-4000-8000-000000000032','f4200000-0000-4000-8000-000000000022',1,
  'jobs_c','Synthetic summary C','f4200000-0000-4000-8000-000000000011','dumbbell_curl',1,3),
 ('f4200000-0000-4000-8000-000000000034','f4200000-0000-4000-8000-000000000024',1,
  'jobs_d','Synthetic summary D','f4200000-0000-4000-8000-000000000011','dumbbell_curl',1,3);
insert into public.feature_bundle_funding_receipts(
  bundle_id,feature_key,payer_role,payer_id,config_revision,funding_source,source_id,
  credit_units_consumed,due_at,operation_key
) values
 ('f4200000-0000-4000-8000-000000000020','form_coach','member','f4200000-0000-4000-8000-000000000002',
  1,'comp','jobs-synthetic-comp-a',0,'2027-01-01 00:00:00+00','jobs-synthetic-operation-a'),
 ('f4200000-0000-4000-8000-000000000021','form_coach','member','f4200000-0000-4000-8000-000000000002',
  1,'comp','jobs-synthetic-comp-b',0,'2027-01-01 00:00:00+00','jobs-synthetic-operation-b'),
 ('f4200000-0000-4000-8000-000000000022','form_coach','member','f4200000-0000-4000-8000-000000000002',
  1,'comp','jobs-synthetic-comp-c',0,'2027-01-01 00:00:00+00','jobs-synthetic-operation-c'),
 ('f4200000-0000-4000-8000-000000000024','form_coach','member','f4200000-0000-4000-8000-000000000002',
  1,'comp','jobs-synthetic-comp-d',0,'2027-01-01 00:00:00+00','jobs-synthetic-operation-d');
insert into public.form_coach_attempts(
  id,assessment_id,item_id,member_subject_id,attempt_number,state,lease_token,lease_expires_at,
  consent_terms_version,started_at,finished_at,result_digest
) values
 ('f4200000-0000-4000-8000-000000000040','f4200000-0000-4000-8000-000000000020',
  'f4200000-0000-4000-8000-000000000030','f4200000-0000-4000-8000-000000000002',1,'finished',
  'f4200000-0000-4000-8000-000000000140',now()-interval '1 minute',1,now()-interval '2 minutes',now(),repeat('1',64)),
 ('f4200000-0000-4000-8000-000000000041','f4200000-0000-4000-8000-000000000021',
  'f4200000-0000-4000-8000-000000000031','f4200000-0000-4000-8000-000000000002',1,'finished',
  'f4200000-0000-4000-8000-000000000141',now()-interval '1 minute',1,now()-interval '2 minutes',now(),repeat('2',64)),
 ('f4200000-0000-4000-8000-000000000042','f4200000-0000-4000-8000-000000000022',
  'f4200000-0000-4000-8000-000000000032','f4200000-0000-4000-8000-000000000002',1,'finished',
  'f4200000-0000-4000-8000-000000000142',now()-interval '1 minute',1,now()-interval '2 minutes',now(),repeat('3',64)),
 ('f4200000-0000-4000-8000-000000000044','f4200000-0000-4000-8000-000000000024',
  'f4200000-0000-4000-8000-000000000034','f4200000-0000-4000-8000-000000000002',1,'finished',
  'f4200000-0000-4000-8000-000000000144',now()-interval '1 minute',1,now()-interval '2 minutes',now(),repeat('5',64));
insert into public.form_coach_attempt_results(attempt_id,result_digest,rep_count,average_score,numeric_summary)
select attempt_id,result_digest,1,84,current_setting('test.jobs_numeric_payload')::jsonb
from (values
 ('f4200000-0000-4000-8000-000000000040'::uuid,repeat('1',64)),
 ('f4200000-0000-4000-8000-000000000041'::uuid,repeat('2',64)),
 ('f4200000-0000-4000-8000-000000000042'::uuid,repeat('3',64)),
 ('f4200000-0000-4000-8000-000000000044'::uuid,repeat('5',64))
) fixtures(attempt_id,result_digest);
insert into public.form_coach_summary_outbox(attempt_id,prompt_version,numeric_payload,attempt_count,next_attempt_at)
values
 ('f4200000-0000-4000-8000-000000000040','attempt-summary-v1',current_setting('test.jobs_numeric_payload')::jsonb,0,now()),
 ('f4200000-0000-4000-8000-000000000041','attempt-summary-v1',current_setting('test.jobs_numeric_payload')::jsonb,5,now()-interval '2 minutes'),
 ('f4200000-0000-4000-8000-000000000042','attempt-summary-v1',current_setting('test.jobs_numeric_payload')::jsonb,0,now()-interval '1 minute'),
 ('f4200000-0000-4000-8000-000000000044','attempt-summary-v1',current_setting('test.jobs_numeric_payload')::jsonb,0,now());

select ok(not exists (
  select 1 from (values ('anon'::name),('authenticated'::name),('service_role'::name)) roles(role_name)
  where has_table_privilege(role_name,'public.form_coach_summary_dispatches','select')
     or has_table_privilege(role_name,'public.form_coach_summary_dispatches','insert')
     or has_table_privilege(role_name,'public.form_coach_summary_dispatches','update')
     or has_table_privilege(role_name,'public.form_coach_summary_dispatches','delete')
), 'the private dispatch ledger has no direct client or service-role table grants');
select ok(has_function_privilege('service_role','public.service_claim_form_coach_summary_jobs_v2(smallint,uuid)','execute')
  and has_function_privilege('service_role','public.service_authorize_form_coach_summary_dispatch(uuid,uuid)','execute')
  and has_function_privilege('service_role','public.service_finish_form_coach_summary_dispatch(uuid,uuid,uuid,text,text)','execute')
  and has_function_privilege('service_role','public.service_expire_form_coach_assessments(smallint)','execute')
  and not has_function_privilege('authenticated','public.service_authorize_form_coach_summary_dispatch(uuid,uuid)','execute')
  and not has_function_privilege('anon','public.service_finish_form_coach_summary_dispatch(uuid,uuid,uuid,text,text)','execute'),
  'only the service role receives the bounded job RPC grants');
select ok(not has_function_privilege('service_role','public.service_claim_form_coach_summary_jobs(smallint,smallint)','execute')
  and not has_function_privilege('service_role','public.service_finish_form_coach_summary_job(uuid,uuid,text,text)','execute'),
  'legacy summary claim and finish RPCs no longer bypass dispatch authorization');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select throws_ok($$select count(*) from public.form_coach_summary_dispatches$$,'42501',null,
  'the service role cannot inspect dispatch ledger rows directly');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4200000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$select public.service_authorize_form_coach_summary_dispatch(
  'f4200000-0000-4000-8000-000000000040','f4200000-0000-4000-8000-000000000140')$$,'42501',null,
  'an authenticated caller cannot request a provider dispatch grant');
reset role;

-- A retry is delayed and replay-safe. The next claim uses a new token and may complete once.
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.jobs_claim_a',(
  select to_jsonb(claimed)::text from public.service_claim_form_coach_summary_jobs_v2(
    1::smallint,'f4200000-0000-4000-8000-000000000040'::uuid) claimed
),true);
select is((current_setting('test.jobs_claim_a')::jsonb->>'attempt_id'),
  'f4200000-0000-4000-8000-000000000040','a targeted kick claims its exact finished attempt');
select set_config('test.jobs_auth_a',public.service_authorize_form_coach_summary_dispatch(
  (current_setting('test.jobs_claim_a')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.jobs_claim_a')::jsonb->>'claim_token')::uuid)::text,true);
select is(current_setting('test.jobs_auth_a')::jsonb->>'outcome','authorized',
  'a coach-linked manual member with a historical receipt receives a grant while pricing is pending');
select is(current_setting('test.jobs_auth_a')::jsonb->'numeric_payload',
  current_setting('test.jobs_numeric_payload')::jsonb,'the grant carries the exact numeric summary only');
select is(public.service_authorize_form_coach_summary_dispatch(
  (current_setting('test.jobs_claim_a')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.jobs_claim_a')::jsonb->>'claim_token')::uuid)->>'outcome',
  'already_authorized','a repeated authorization cannot create a second provider send');
reset role;
select is((select count(*)::integer from public.form_coach_summary_dispatches
  where outbox_id=(current_setting('test.jobs_claim_a')::jsonb->>'outbox_id')::uuid),1,
  'the claim has only one durable dispatch grant');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.service_finish_form_coach_summary_dispatch(
  (current_setting('test.jobs_claim_a')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.jobs_claim_a')::jsonb->>'claim_token')::uuid,
  (current_setting('test.jobs_auth_a')::jsonb->>'dispatch_token')::uuid,
  'retryable_rate_limited',null)->>'outcome','retryable_rate_limited',
  'a retryable provider result is recorded without rewriting attempt results');
select is(public.service_finish_form_coach_summary_dispatch(
  (current_setting('test.jobs_claim_a')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.jobs_claim_a')::jsonb->>'claim_token')::uuid,
  (current_setting('test.jobs_auth_a')::jsonb->>'dispatch_token')::uuid,
  'retryable_rate_limited',null)->>'outcome','already_recorded',
  'an exact terminal retry outcome replays safely');
select is((select count(*)::integer from public.service_claim_form_coach_summary_jobs_v2(
  1::smallint,'f4200000-0000-4000-8000-000000000040'::uuid)),0,
  'a retry waits until its next_attempt_at instead of draining immediately');
reset role;
select ok(private.form_coach_summary_backoff(1)=interval '30 seconds'
  and private.form_coach_summary_backoff(5)=interval '8 minutes'
  and private.form_coach_summary_backoff(2147483647)<=interval '1 hour',
  'retry backoff is capped and safe for widened attempt counts');
select ok((select next_attempt_at>clock_timestamp() and next_attempt_at<=clock_timestamp()+interval '31 seconds'
  from public.form_coach_summary_outbox where attempt_id='f4200000-0000-4000-8000-000000000040'),
  'the retry is delayed by the first capped backoff interval');
update public.form_coach_summary_outbox set next_attempt_at=clock_timestamp()-interval '1 second'
where attempt_id='f4200000-0000-4000-8000-000000000040';
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.jobs_claim_a2',(
  select to_jsonb(claimed)::text from public.service_claim_form_coach_summary_jobs_v2(
    1::smallint,'f4200000-0000-4000-8000-000000000040'::uuid) claimed
),true);
select ok(current_setting('test.jobs_claim_a2')::jsonb->>'claim_token'
  <>current_setting('test.jobs_claim_a')::jsonb->>'claim_token',
  'a delayed retry receives a fresh rotating claim token');
select set_config('test.jobs_auth_a2',public.service_authorize_form_coach_summary_dispatch(
  (current_setting('test.jobs_claim_a2')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.jobs_claim_a2')::jsonb->>'claim_token')::uuid)::text,true);
select is(public.service_finish_form_coach_summary_dispatch(
  (current_setting('test.jobs_claim_a2')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.jobs_claim_a2')::jsonb->>'claim_token')::uuid,
  (current_setting('test.jobs_auth_a2')::jsonb->>'dispatch_token')::uuid,
  'complete','Synthetic numeric summary. Keep the lowering controlled.')::text,
  '{"outcome": "complete"}'::jsonb::text,
  'a valid summary result completes the authorized dispatch');
select is(public.service_finish_form_coach_summary_dispatch(
  (current_setting('test.jobs_claim_a2')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.jobs_claim_a2')::jsonb->>'claim_token')::uuid,
  (current_setting('test.jobs_auth_a2')::jsonb->>'dispatch_token')::uuid,
  'complete','Synthetic numeric summary. Keep the lowering controlled.')::text,
  '{"outcome": "already_recorded"}'::jsonb::text,
  'an exact completed summary replay is idempotent');
reset role;
select ok((select result.summary_state='complete'
    and result.coach_summary='Synthetic numeric summary. Keep the lowering controlled.'
    and result.result_digest=attempt.result_digest
  from public.form_coach_attempt_results result
  join public.form_coach_attempts attempt on attempt.id=result.attempt_id
  where attempt.id='f4200000-0000-4000-8000-000000000040'),
  'summary completion changes only the summary projection and preserves the numeric result digest');
select is((select count(*)::integer from public.feature_bundle_funding_receipts
  where bundle_id='f4200000-0000-4000-8000-000000000020'),1,
  'summary retries and completion do not rewrite the immutable funding receipt');

-- A maxed-out oldest row is terminalized; the bounded scan proceeds to the next due row.
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.jobs_fair_claim',(
  select to_jsonb(claimed)::text from public.service_claim_form_coach_summary_jobs_v2(1::smallint,null::uuid) claimed
),true);
reset role;
select is(current_setting('test.jobs_fair_claim')::jsonb->>'attempt_id',
  'f4200000-0000-4000-8000-000000000042',
  'the bounded oldest-first scan skips a terminalized max-attempt row and claims the next due attempt');
select ok((select outbox.state='unavailable' and outbox.attempt_count=5
    and result.summary_state='unavailable'
  from public.form_coach_summary_outbox outbox
  join public.form_coach_attempt_results result on result.attempt_id=outbox.attempt_id
  where outbox.attempt_id='f4200000-0000-4000-8000-000000000041'),
  'five claims terminalize the summary without allowing a sixth provider request');

set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.jobs_auth_c',public.service_authorize_form_coach_summary_dispatch(
  (current_setting('test.jobs_fair_claim')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.jobs_fair_claim')::jsonb->>'claim_token')::uuid)::text,true);
reset role;
select is(current_setting('test.jobs_auth_c')::jsonb->>'outcome','authorized',
  'the next eligible manual member attempt receives a single dispatch grant');

-- A platform-owned Program assessment is ineligible even if its numeric rows are complete.
insert into public.programs(id,coach_id,title,published,platform_owned)
values('f4200000-0000-4000-8000-000000000050','f4200000-0000-4000-8000-000000000001',
  'Synthetic Platform Program',true,true);
insert into public.form_coach_assessments(
  id,send_request_id,send_digest,source_kind,member_subject_id,member_owner_id,
  coach_subject_id,coach_owner_id,program_id,program_owner_subject_id,program_owner_id,
  program_title_snapshot,program_rule_id,program_rule_generation,sent_by_subject_id,sent_by_owner_id,
  payer_role,payer_subject_id,payer_owner_id,config_revision,due_at,status
) values(
  'f4200000-0000-4000-8000-000000000023','f4200000-0000-4000-8000-000000000123',repeat('f',64),
  'program','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'f4200000-0000-4000-8000-000000000050','f4200000-0000-4000-8000-000000000001',
  'f4200000-0000-4000-8000-000000000001','Synthetic platform source',
  'f4200000-0000-4000-8000-000000000051','f4200000-0000-4000-8000-000000000052',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'member','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  1,'2027-01-01 00:00:00+00','completed'
);
insert into public.form_coach_assessment_items(
  id,assessment_id,item_ordinal,item_key,item_title_snapshot,template_version_id,exercise_key,required_reps
) values('f4200000-0000-4000-8000-000000000033','f4200000-0000-4000-8000-000000000023',1,
  'jobs_platform','Synthetic platform item','f4200000-0000-4000-8000-000000000011','dumbbell_curl',1);
insert into public.feature_bundle_funding_receipts(
  bundle_id,feature_key,payer_role,payer_id,config_revision,funding_source,source_id,
  credit_units_consumed,due_at,operation_key
) values('f4200000-0000-4000-8000-000000000023','form_coach','member',
  'f4200000-0000-4000-8000-000000000002',1,'comp','jobs-synthetic-platform-comp',0,
  '2027-01-01 00:00:00+00','jobs-synthetic-platform-operation');
insert into public.form_coach_attempts(
  id,assessment_id,item_id,member_subject_id,attempt_number,state,lease_token,lease_expires_at,
  consent_terms_version,started_at,finished_at,result_digest
) values('f4200000-0000-4000-8000-000000000043','f4200000-0000-4000-8000-000000000023',
  'f4200000-0000-4000-8000-000000000033','f4200000-0000-4000-8000-000000000002',1,'finished',
  'f4200000-0000-4000-8000-000000000143',now()-interval '1 minute',1,now()-interval '2 minutes',now(),repeat('4',64));
insert into public.form_coach_attempt_results(attempt_id,result_digest,rep_count,average_score,numeric_summary)
values('f4200000-0000-4000-8000-000000000043',repeat('4',64),1,84,current_setting('test.jobs_numeric_payload')::jsonb);
insert into public.form_coach_summary_outbox(attempt_id,prompt_version,numeric_payload,next_attempt_at)
values('f4200000-0000-4000-8000-000000000043','attempt-summary-v1',
  current_setting('test.jobs_numeric_payload')::jsonb,clock_timestamp()-interval '1 second');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.jobs_platform_claim',(
  select to_jsonb(claimed)::text from public.service_claim_form_coach_summary_jobs_v2(
    1::smallint,'f4200000-0000-4000-8000-000000000043'::uuid) claimed
),true);
select set_config('test.jobs_platform_auth',public.service_authorize_form_coach_summary_dispatch(
  (current_setting('test.jobs_platform_claim')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.jobs_platform_claim')::jsonb->>'claim_token')::uuid)::text,true);
reset role;
select is(current_setting('test.jobs_platform_auth')::jsonb->>'outcome','ineligible',
  'a platform-owned Program source cannot receive a summary dispatch grant');

-- A coach-owned Program can dispatch only while its current coach-member link still exists.
insert into public.programs(id,coach_id,title,published,platform_owned)
values('f4200000-0000-4000-8000-000000000051','f4200000-0000-4000-8000-000000000001',
  'Synthetic Coach Program',true,false);
insert into public.form_coach_assessments(
  id,send_request_id,send_digest,source_kind,member_subject_id,member_owner_id,
  coach_subject_id,coach_owner_id,program_id,program_owner_subject_id,program_owner_id,
  program_title_snapshot,program_rule_id,program_rule_generation,sent_by_subject_id,sent_by_owner_id,
  payer_role,payer_subject_id,payer_owner_id,config_revision,due_at,status
) values(
  'f4200000-0000-4000-8000-000000000025','f4200000-0000-4000-8000-000000000125',repeat('5',64),
  'program','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'f4200000-0000-4000-8000-000000000051','f4200000-0000-4000-8000-000000000001',
  'f4200000-0000-4000-8000-000000000001','Synthetic Coach Program',
  'f4200000-0000-4000-8000-000000000053','f4200000-0000-4000-8000-000000000054',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'member','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  1,'2027-01-01 00:00:00+00','completed'
);
insert into public.form_coach_assessment_items(
  id,assessment_id,item_ordinal,item_key,item_title_snapshot,template_version_id,exercise_key,required_reps
) values
  ('f4200000-0000-4000-8000-000000000035','f4200000-0000-4000-8000-000000000025',1,
    'jobs_program_linked','Linked Program item','f4200000-0000-4000-8000-000000000011','dumbbell_curl',1),
  ('f4200000-0000-4000-8000-000000000036','f4200000-0000-4000-8000-000000000025',2,
    'jobs_program_unlinked','Unlinked Program item','f4200000-0000-4000-8000-000000000011','dumbbell_curl',1);
insert into public.feature_bundle_funding_receipts(
  bundle_id,feature_key,payer_role,payer_id,config_revision,funding_source,source_id,
  credit_units_consumed,due_at,operation_key
) values('f4200000-0000-4000-8000-000000000025','form_coach','member',
  'f4200000-0000-4000-8000-000000000002',1,'comp','jobs-synthetic-program-comp',0,
  '2027-01-01 00:00:00+00','jobs-synthetic-program-operation');
insert into public.form_coach_attempts(
  id,assessment_id,item_id,member_subject_id,attempt_number,state,lease_token,lease_expires_at,
  consent_terms_version,started_at,finished_at,result_digest
) values
  ('f4200000-0000-4000-8000-000000000045','f4200000-0000-4000-8000-000000000025',
    'f4200000-0000-4000-8000-000000000035','f4200000-0000-4000-8000-000000000002',1,'finished',
    'f4200000-0000-4000-8000-000000000145',now()-interval '1 minute',1,now()-interval '2 minutes',now(),repeat('5',64)),
  ('f4200000-0000-4000-8000-000000000046','f4200000-0000-4000-8000-000000000025',
    'f4200000-0000-4000-8000-000000000036','f4200000-0000-4000-8000-000000000002',1,'finished',
    'f4200000-0000-4000-8000-000000000146',now()-interval '1 minute',1,now()-interval '2 minutes',now(),repeat('6',64));
insert into public.form_coach_attempt_results(attempt_id,result_digest,rep_count,average_score,numeric_summary)
values
  ('f4200000-0000-4000-8000-000000000045',repeat('5',64),1,84,current_setting('test.jobs_numeric_payload')::jsonb),
  ('f4200000-0000-4000-8000-000000000046',repeat('6',64),1,84,current_setting('test.jobs_numeric_payload')::jsonb);
insert into public.form_coach_summary_outbox(attempt_id,prompt_version,numeric_payload,next_attempt_at)
values
  ('f4200000-0000-4000-8000-000000000045','attempt-summary-v1',current_setting('test.jobs_numeric_payload')::jsonb,now()),
  ('f4200000-0000-4000-8000-000000000046','attempt-summary-v1',current_setting('test.jobs_numeric_payload')::jsonb,now());
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.jobs_program_claim',(
  select to_jsonb(claimed)::text from public.service_claim_form_coach_summary_jobs_v2(
    1::smallint,'f4200000-0000-4000-8000-000000000045'::uuid) claimed
),true);
select set_config('test.jobs_program_auth',public.service_authorize_form_coach_summary_dispatch(
  (current_setting('test.jobs_program_claim')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.jobs_program_claim')::jsonb->>'claim_token')::uuid)::text,true);
reset role;
select is(current_setting('test.jobs_program_auth')::jsonb->>'outcome','authorized',
  'a coach-owned Program member with the current link can receive a summary grant');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.service_finish_form_coach_summary_dispatch(
  (current_setting('test.jobs_program_claim')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.jobs_program_claim')::jsonb->>'claim_token')::uuid,
  (current_setting('test.jobs_program_auth')::jsonb->>'dispatch_token')::uuid,
  'complete','Synthetic Program summary.')::text,'{"outcome": "complete"}'::jsonb::text,
  'the linked Program summary can finish while eligibility is current');
reset role;
select ok((select result.summary_state='complete' and result.coach_summary='Synthetic Program summary.'
  from public.form_coach_attempt_results result
  where result.attempt_id='f4200000-0000-4000-8000-000000000045'),
  'the linked Program result stores only its authorized summary projection');
delete from public.coach_members
where coach_id='f4200000-0000-4000-8000-000000000001'
  and member_id='f4200000-0000-4000-8000-000000000002';
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.jobs_program_unlinked_claim',(
  select to_jsonb(claimed)::text from public.service_claim_form_coach_summary_jobs_v2(
    1::smallint,'f4200000-0000-4000-8000-000000000046'::uuid) claimed
),true);
select set_config('test.jobs_program_unlinked_auth',public.service_authorize_form_coach_summary_dispatch(
  (current_setting('test.jobs_program_unlinked_claim')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.jobs_program_unlinked_claim')::jsonb->>'claim_token')::uuid)::text,true);
reset role;
select is(current_setting('test.jobs_program_unlinked_auth')::jsonb->>'outcome','ineligible',
  'a claimed Program attempt is denied a grant after its coach-member link is removed');
select ok((select outbox.state='unavailable' and result.summary_state='unavailable'
    and not exists(select 1 from public.form_coach_summary_dispatches dispatch where dispatch.outbox_id=outbox.id)
  from public.form_coach_summary_outbox outbox
  join public.form_coach_attempt_results result on result.attempt_id=outbox.attempt_id
  where outbox.attempt_id='f4200000-0000-4000-8000-000000000046'),
  'the unlinked Program attempt receives no dispatch grant');
insert into public.coach_members(coach_id,member_id)
values('f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000002');

-- The globally disabled revision stops claims before they change queue or attempt counters.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4200000-0000-4000-8000-000000000003","role":"authenticated"}';
select public.admin_create_feature_pricing_revision('form_coach',1,'disabled','member',null,'USD',
  'Synthetic Form Coach','Pause summary jobs','',0,0,'[]'::jsonb);
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is((select count(*)::integer from public.service_claim_form_coach_summary_jobs_v2(
  1::smallint,'f4200000-0000-4000-8000-000000000044'::uuid)),0,
  'a globally disabled feature produces no summary claim');
reset role;
select ok((select outbox.state='pending' and outbox.attempt_count=0 and outbox.claim_token is null
    and not exists(select 1 from public.form_coach_summary_dispatches dispatch where dispatch.outbox_id=outbox.id)
  from public.form_coach_summary_outbox outbox where outbox.attempt_id='f4200000-0000-4000-8000-000000000044'),
  'disabled claim polling leaves queued work and its attempt budget untouched');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4200000-0000-4000-8000-000000000003","role":"authenticated"}';
select public.admin_create_feature_pricing_revision('form_coach',2,'pricing_pending','member',null,'USD',
  'Synthetic Form Coach','Resume summary jobs','',0,0,'[]'::jsonb);
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.jobs_disabled_race_claim',(
  select to_jsonb(claimed)::text from public.service_claim_form_coach_summary_jobs_v2(
    1::smallint,'f4200000-0000-4000-8000-000000000044'::uuid) claimed
),true);
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4200000-0000-4000-8000-000000000003","role":"authenticated"}';
select public.admin_create_feature_pricing_revision('form_coach',3,'disabled','member',null,'USD',
  'Synthetic Form Coach','Pause before dispatch authorization','',0,0,'[]'::jsonb);
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.jobs_disabled_race_auth',public.service_authorize_form_coach_summary_dispatch(
  (current_setting('test.jobs_disabled_race_claim')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.jobs_disabled_race_claim')::jsonb->>'claim_token')::uuid)::text,true);
reset role;
select is(current_setting('test.jobs_disabled_race_auth')::jsonb->>'outcome','feature_disabled',
  'a disable between claim and authorization returns no provider grant');
select ok((select outbox.state='pending' and outbox.attempt_count=0 and outbox.claim_token is null
    and result.summary_state='pending'
    and not exists(select 1 from public.form_coach_summary_dispatches dispatch where dispatch.outbox_id=outbox.id)
  from public.form_coach_summary_outbox outbox
  join public.form_coach_attempt_results result on result.attempt_id=outbox.attempt_id
  where outbox.attempt_id='f4200000-0000-4000-8000-000000000044'),
  'the disabled authorization releases its claim without spending budget or changing the result');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4200000-0000-4000-8000-000000000003","role":"authenticated"}';
select public.admin_create_feature_pricing_revision('form_coach',4,'pricing_pending','member',null,'USD',
  'Synthetic Form Coach','Resume after authorization pause','',0,0,'[]'::jsonb);
reset role;

-- A grant already sent while enabled is fenced from result persistence if pricing is then disabled.
insert into public.form_coach_assessments(
  id,send_request_id,send_digest,source_kind,member_subject_id,member_owner_id,
  coach_subject_id,coach_owner_id,sent_by_subject_id,sent_by_owner_id,payer_role,
  payer_subject_id,payer_owner_id,config_revision,due_at,status
) values(
  'f4200000-0000-4000-8000-000000000026','f4200000-0000-4000-8000-000000000126',repeat('7',64),
  'manual','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'member','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  1,'2027-01-01 00:00:00+00','completed'
);
insert into public.form_coach_assessment_items(
  id,assessment_id,item_ordinal,item_key,item_title_snapshot,template_version_id,exercise_key,required_reps
) values('f4200000-0000-4000-8000-000000000037','f4200000-0000-4000-8000-000000000026',1,
  'jobs_disabled_finish','Disabled finish','f4200000-0000-4000-8000-000000000011','dumbbell_curl',1);
insert into public.feature_bundle_funding_receipts(
  bundle_id,feature_key,payer_role,payer_id,config_revision,funding_source,source_id,
  credit_units_consumed,due_at,operation_key
) values('f4200000-0000-4000-8000-000000000026','form_coach','member',
  'f4200000-0000-4000-8000-000000000002',1,'comp','jobs-synthetic-disabled-finish-comp',0,
  '2027-01-01 00:00:00+00','jobs-synthetic-disabled-finish-operation');
insert into public.form_coach_attempts(
  id,assessment_id,item_id,member_subject_id,attempt_number,state,lease_token,lease_expires_at,
  consent_terms_version,started_at,finished_at,result_digest
) values('f4200000-0000-4000-8000-000000000047','f4200000-0000-4000-8000-000000000026',
  'f4200000-0000-4000-8000-000000000037','f4200000-0000-4000-8000-000000000002',1,'finished',
  'f4200000-0000-4000-8000-000000000147',now()-interval '1 minute',1,now()-interval '2 minutes',now(),repeat('7',64));
insert into public.form_coach_attempt_results(attempt_id,result_digest,rep_count,average_score,numeric_summary)
values('f4200000-0000-4000-8000-000000000047',repeat('7',64),1,84,current_setting('test.jobs_numeric_payload')::jsonb);
insert into public.form_coach_summary_outbox(attempt_id,prompt_version,numeric_payload,next_attempt_at)
values('f4200000-0000-4000-8000-000000000047','attempt-summary-v1',current_setting('test.jobs_numeric_payload')::jsonb,now());
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.jobs_disabled_finish_claim',(
  select to_jsonb(claimed)::text from public.service_claim_form_coach_summary_jobs_v2(
    1::smallint,'f4200000-0000-4000-8000-000000000047'::uuid) claimed
),true);
select set_config('test.jobs_disabled_finish_auth',public.service_authorize_form_coach_summary_dispatch(
  (current_setting('test.jobs_disabled_finish_claim')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.jobs_disabled_finish_claim')::jsonb->>'claim_token')::uuid)::text,true);
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4200000-0000-4000-8000-000000000003","role":"authenticated"}';
select public.admin_create_feature_pricing_revision('form_coach',5,'disabled','member',null,'USD',
  'Synthetic Form Coach','Pause before summary finish','',0,0,'[]'::jsonb);
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.service_finish_form_coach_summary_dispatch(
  (current_setting('test.jobs_disabled_finish_claim')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.jobs_disabled_finish_claim')::jsonb->>'claim_token')::uuid,
  (current_setting('test.jobs_disabled_finish_auth')::jsonb->>'dispatch_token')::uuid,
  'complete','This late summary must be discarded.')::text,
  '{"outcome": "ineligible"}'::jsonb::text,
  'a finish after global disable cannot persist the authorized summary text');
reset role;
select ok((select attempt.state='finished' and attempt.result_digest=result.result_digest
    and result.numeric_summary=current_setting('test.jobs_numeric_payload')::jsonb
    and result.summary_state='unavailable' and result.coach_summary is null
    and (select count(*) from public.feature_bundle_funding_receipts receipt
      where receipt.bundle_id=assessment.id and receipt.source_id='jobs-synthetic-disabled-finish-comp')=1
  from public.form_coach_attempts attempt
  join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
  join public.form_coach_attempt_results result on result.attempt_id=attempt.id
  where attempt.id='f4200000-0000-4000-8000-000000000047'),
  'disabled finish preserves the finished numeric result, digest, and historical receipt');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4200000-0000-4000-8000-000000000003","role":"authenticated"}';
select public.admin_create_feature_pricing_revision('form_coach',6,'pricing_pending','member',null,'USD',
  'Synthetic Form Coach','Resume after finish pause','',0,0,'[]'::jsonb);
reset role;

-- Expiry mutates only due status and skips finished results, live leases, and the latest retry window.
insert into public.form_coach_assessments(
  id,send_request_id,send_digest,source_kind,member_subject_id,member_owner_id,
  coach_subject_id,coach_owner_id,sent_by_subject_id,sent_by_owner_id,payer_role,
  payer_subject_id,payer_owner_id,config_revision,due_at,status
) values
 ('f4200000-0000-4000-8000-000000000060','f4200000-0000-4000-8000-000000000160',repeat('5',64),
  'manual','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'member','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  1,now()-interval '1 hour','sent'),
 ('f4200000-0000-4000-8000-000000000061','f4200000-0000-4000-8000-000000000161',repeat('6',64),
  'manual','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'member','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  1,now()-interval '1 hour','in_progress'),
 ('f4200000-0000-4000-8000-000000000062','f4200000-0000-4000-8000-000000000162',repeat('7',64),
  'manual','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'member','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  1,now()-interval '1 hour','in_progress'),
 ('f4200000-0000-4000-8000-000000000063','f4200000-0000-4000-8000-000000000163',repeat('8',64),
  'manual','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'member','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  1,now()-interval '1 hour','sent');
insert into public.form_coach_assessment_items(
  id,assessment_id,item_ordinal,item_key,item_title_snapshot,template_version_id,exercise_key,required_reps
) values
 ('f4200000-0000-4000-8000-000000000070','f4200000-0000-4000-8000-000000000061',1,'expiry_partial','Partial result',
  'f4200000-0000-4000-8000-000000000011','dumbbell_curl',1),
 ('f4200000-0000-4000-8000-000000000071','f4200000-0000-4000-8000-000000000062',1,'expiry_lease','Live lease',
  'f4200000-0000-4000-8000-000000000011','dumbbell_curl',1),
 ('f4200000-0000-4000-8000-000000000072','f4200000-0000-4000-8000-000000000063',1,'expiry_retry','Retry window',
  'f4200000-0000-4000-8000-000000000011','dumbbell_curl',1);
insert into public.form_coach_attempts(
  id,assessment_id,item_id,member_subject_id,attempt_number,state,lease_token,lease_expires_at,
  consent_terms_version,started_at,finished_at,result_digest
) values
 ('f4200000-0000-4000-8000-000000000080','f4200000-0000-4000-8000-000000000061',
  'f4200000-0000-4000-8000-000000000070','f4200000-0000-4000-8000-000000000002',1,'finished',
  'f4200000-0000-4000-8000-000000000180',now()-interval '1 minute',1,now()-interval '2 minutes',now(),repeat('9',64)),
 ('f4200000-0000-4000-8000-000000000081','f4200000-0000-4000-8000-000000000062',
  'f4200000-0000-4000-8000-000000000071','f4200000-0000-4000-8000-000000000002',1,'running',
  'f4200000-0000-4000-8000-000000000181',now()+interval '5 minutes',1,now()-interval '2 minutes',null,null),
 ('f4200000-0000-4000-8000-000000000082','f4200000-0000-4000-8000-000000000063',
  'f4200000-0000-4000-8000-000000000072','f4200000-0000-4000-8000-000000000002',1,'finished',
  'f4200000-0000-4000-8000-000000000182',now()-interval '1 minute',1,now()-interval '2 minutes',now(),repeat('a',64));
insert into public.form_coach_attempt_results(attempt_id,result_digest,rep_count,average_score,numeric_summary)
values('f4200000-0000-4000-8000-000000000080',repeat('9',64),1,84,
  current_setting('test.jobs_numeric_payload')::jsonb);
insert into public.form_coach_reviews(
  id,request_id,assessment_id,item_id,attempt_id,coach_subject_id,coach_owner_id,verdict,
  feedback,request_digest,review_sequence
) values('f4200000-0000-4000-8000-000000000090','f4200000-0000-4000-8000-000000000190',
  'f4200000-0000-4000-8000-000000000063','f4200000-0000-4000-8000-000000000072',
  'f4200000-0000-4000-8000-000000000082','f4200000-0000-4000-8000-000000000001',
  'f4200000-0000-4000-8000-000000000001','needs_work','Synthetic retry fixture',repeat('b',64),1);
insert into public.form_coach_retry_windows(
  id,review_id,assessment_id,item_id,opened_by_subject_id,opened_by_owner_id,
  additional_attempts,opens_at,closes_at
) values('f4200000-0000-4000-8000-000000000091','f4200000-0000-4000-8000-000000000090',
  'f4200000-0000-4000-8000-000000000063','f4200000-0000-4000-8000-000000000072',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  1,now()-interval '1 minute',now()+interval '1 day');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.service_expire_form_coach_assessments(25::smallint),1,
  'bounded expiry changes only the one due assessment with no finished work or active lease');
reset role;
select is((select status from public.form_coach_assessments where id='f4200000-0000-4000-8000-000000000060'),
  'expired','a due sent assessment with no attempts becomes expired');
select is((select status from public.form_coach_assessments where id='f4200000-0000-4000-8000-000000000061'),
  'in_progress','a finished partial result keeps its assessment open for review');
select is((select result.summary_state from public.form_coach_attempt_results result
  where result.attempt_id='f4200000-0000-4000-8000-000000000080'),
  'pending','expiry leaves the finished attempt result untouched');
select is((select status from public.form_coach_assessments where id='f4200000-0000-4000-8000-000000000062'),
  'in_progress','an unexpired running lease prevents expiry');
select is((select status from public.form_coach_assessments where id='f4200000-0000-4000-8000-000000000063'),
  'sent','the active retry window for the latest Needs Work review prevents expiry');

-- More than one candidate page of old partial submissions must not hide later eligible work.
insert into public.form_coach_assessments(
  id,send_request_id,send_digest,source_kind,member_subject_id,member_owner_id,
  coach_subject_id,coach_owner_id,sent_by_subject_id,sent_by_owner_id,payer_role,
  payer_subject_id,payer_owner_id,config_revision,due_at,status
)
select ('f4200000-0000-4000-8000-'||lpad((1000+series)::text,12,'0'))::uuid,
  ('f4200000-0000-4000-8000-'||lpad((2000+series)::text,12,'0'))::uuid,repeat('c',64),'manual',
  'f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'member','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  1,clock_timestamp()-interval '2 hours','in_progress'
from generate_series(1,100) as sample(series);
insert into public.form_coach_assessment_items(
  id,assessment_id,item_ordinal,item_key,item_title_snapshot,template_version_id,exercise_key,required_reps
)
select ('f4200000-0000-4000-8000-'||lpad((3000+series)::text,12,'0'))::uuid,
  ('f4200000-0000-4000-8000-'||lpad((1000+series)::text,12,'0'))::uuid,1,'expiry_partial_'||series,
  'Finished partial '||series,'f4200000-0000-4000-8000-000000000011','dumbbell_curl',1
from generate_series(1,100) as sample(series);
insert into public.form_coach_attempts(
  id,assessment_id,item_id,member_subject_id,attempt_number,state,lease_token,lease_expires_at,
  consent_terms_version,started_at,finished_at,result_digest
)
select ('f4200000-0000-4000-8000-'||lpad((4000+series)::text,12,'0'))::uuid,
  ('f4200000-0000-4000-8000-'||lpad((1000+series)::text,12,'0'))::uuid,
  ('f4200000-0000-4000-8000-'||lpad((3000+series)::text,12,'0'))::uuid,
  'f4200000-0000-4000-8000-000000000002',1,'finished',
  ('f4200000-0000-4000-8000-'||lpad((5000+series)::text,12,'0'))::uuid,
  clock_timestamp()-interval '1 minute',1,clock_timestamp()-interval '3 hours',
  clock_timestamp()-interval '2 hours',repeat('d',64)
from generate_series(1,100) as sample(series);
insert into public.form_coach_attempt_results(attempt_id,result_digest,rep_count,average_score,numeric_summary)
select ('f4200000-0000-4000-8000-'||lpad((4000+series)::text,12,'0'))::uuid,
  repeat('d',64),1,84,current_setting('test.jobs_numeric_payload')::jsonb
from generate_series(1,100) as sample(series);
insert into public.form_coach_assessments(
  id,send_request_id,send_digest,source_kind,member_subject_id,member_owner_id,
  coach_subject_id,coach_owner_id,sent_by_subject_id,sent_by_owner_id,payer_role,
  payer_subject_id,payer_owner_id,config_revision,due_at,status
) values(
  'f4200000-0000-4000-8000-000000009999','f4200000-0000-4000-8000-000000009998',repeat('e',64),'manual',
  'f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'f4200000-0000-4000-8000-000000000001','f4200000-0000-4000-8000-000000000001',
  'member','f4200000-0000-4000-8000-000000000002','f4200000-0000-4000-8000-000000000002',
  1,clock_timestamp()-interval '1 hour','sent'
);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.service_expire_form_coach_assessments(1::smallint),1,
  'a bounded pass filters 100 older finished partials before selecting the later eligible assessment');
select is(public.service_expire_form_coach_assessments(1::smallint),0,
  'a repeated bounded pass finds no work after the eligible row is expired');
reset role;
select is((select status from public.form_coach_assessments
  where id='f4200000-0000-4000-8000-000000009999'),'expired',
  'expiry advances past persistent partial submissions to the later due assessment');
select ok((select count(*)=100 from public.form_coach_assessments assessment
  join public.form_coach_attempts attempt on attempt.assessment_id=assessment.id and attempt.state='finished'
  join public.form_coach_attempt_results result on result.attempt_id=attempt.id
  where assessment.status='in_progress' and assessment.due_at<clock_timestamp()-interval '1 hour'
    and assessment.id::text like 'f4200000-0000-4000-8000-000000001%'
    and result.summary_state='pending'),
  'all 100 finished partial assessments and numeric results remain unchanged');

-- A live summary grant blocks Form Coach readiness. Use the normal 310 account cleanup flow for
-- this member's empty current VOD manifest, then let 330 derive billing readiness from DB facts.
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.jobs_cleanup_begin',public.begin_stream_account_media_cleanup(
  'f4200000-0000-4000-8000-000000000102','f4200000-0000-4000-8000-000000000002',
  'f4200000-0000-4000-8000-000000000101',repeat('d',64),
  'f4200000-0000-4000-8000-000000000100',repeat('c',64)
)::text,true);
select ok(current_setting('test.jobs_cleanup_begin')::jsonb->>'outcome'='reserved'
  and (current_setting('test.jobs_cleanup_begin')::jsonb->>'manifest_edges')::integer=0
  and (current_setting('test.jobs_cleanup_begin')::jsonb->>'uid_count')::integer=0,
  '310 reserves the real empty account media manifest for the synthetic member');
select set_config('test.jobs_cleanup_finalize',public.finalize_stream_media_cleanup(
  'f4200000-0000-4000-8000-000000000100','f4200000-0000-4000-8000-000000000113',repeat('f',64)
)::text,true);
select is(current_setting('test.jobs_cleanup_finalize')::jsonb->>'outcome','account_cleanup_complete',
  '310 finalizes the empty current VOD inventory through its durable cleanup RPC');
reset role;
select set_config('test.jobs_tombstone_revision',(
  select tombstone.revision::text from public.stream_media_account_tombstones tombstone
  where tombstone.id='f4200000-0000-4000-8000-000000000102'
),true);
select set_config('test.jobs_registered_components',(
  select coalesce(jsonb_agg(jsonb_build_object(
    'component_key',component.component_key,
    'component_version',component.component_version,
    'resource_set_revision',component.resource_set_revision
  ) order by component.component_key),'[]'::jsonb)::text
  from public.stream_auth_cleanup_components component where component.required_for_auth
),true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.service_record_form_coach_billing_cleanup(
  'f4200000-0000-4000-8000-000000000102',
  current_setting('test.jobs_tombstone_revision')::bigint,
  'f4200000-0000-4000-8000-000000000114'
),'recorded','330 derives billing cleanup from this tombstone revision and DB-confirmed empty financial state');
reset role;
select is((select proof.proof_state from public.stream_media_auth_component_proof_events proof
  where proof.tombstone_id='f4200000-0000-4000-8000-000000000102'
    and proof.component_key='form_coach_billing'
  order by proof.proof_sequence desc limit 1),'ready',
  'the current billing component proof is ready with no unresolved financial resources');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is((select count(*)::integer from public.service_claim_form_coach_summary_jobs_v2(
  1::smallint,'f4200000-0000-4000-8000-000000000044'::uuid)),0,
  'a deletion fence suppresses queued work before it can receive a dispatch grant');
reset role;
select ok((select outbox.state='suppressed' and not exists(
    select 1 from public.form_coach_summary_dispatches dispatch where dispatch.outbox_id=outbox.id)
  from public.form_coach_summary_outbox outbox
  where outbox.attempt_id='f4200000-0000-4000-8000-000000000044'),
  'the pre-grant suppression adds no dispatch-ledger row');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.jobs_form_coach_incomplete',public.service_record_form_coach_auth_cleanup_proof(
  'f4200000-0000-4000-8000-000000000102',current_setting('test.jobs_tombstone_revision')::bigint,'f4200000-0000-4000-8000-000000000104')::text,true);
select is((current_setting('test.jobs_form_coach_incomplete')::jsonb->>'ready')::boolean,false,
  'a still-live summary dispatch grant blocks the Form Coach cleanup proof');
select is((current_setting('test.jobs_form_coach_incomplete')::jsonb->>'unresolved_count')::integer,1,
  'cleanup identifies the one outstanding dispatch grant without claiming remote erasure');
reset role;
select is(current_setting('test.jobs_form_coach_incomplete')::jsonb->>'source_revision_digest',
  encode(extensions.digest(convert_to(pg_temp.form_coach_jobs_component_inventory(
    'f4200000-0000-4000-8000-000000000002')::text,'UTF8'),'sha256'),'hex'),
  'the incomplete proof digest matches an Owner reconstruction of the full Form Coach inventory');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.prepare_stream_auth_deletion_permit(
  'f4200000-0000-4000-8000-000000000102',current_setting('test.jobs_tombstone_revision')::bigint,'f4200000-0000-4000-8000-000000000105',
  'f4200000-0000-4000-8000-000000000106',repeat('f',64))->>'outcome',
  'required_component_proofs_incomplete','an incomplete Form Coach proof cannot authorize Auth deletion');
reset role;
select pg_sleep(13);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.jobs_form_coach_ready',public.service_record_form_coach_auth_cleanup_proof(
  'f4200000-0000-4000-8000-000000000102',current_setting('test.jobs_tombstone_revision')::bigint,'f4200000-0000-4000-8000-000000000107')::text,true);
select is((current_setting('test.jobs_form_coach_ready')::jsonb->>'ready')::boolean,true,
  'the local dispatch permission expires and the DB-derived Form Coach proof becomes ready');
reset role;
select is(current_setting('test.jobs_form_coach_ready')::jsonb->>'source_revision_digest',
  encode(extensions.digest(convert_to(pg_temp.form_coach_jobs_component_inventory(
    'f4200000-0000-4000-8000-000000000002')::text,'UTF8'),'sha256'),'hex'),
  'the ready proof digest matches the full current Form Coach inventory reconstructed by Owner');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.prepare_stream_auth_deletion_permit(
  'f4200000-0000-4000-8000-000000000102',current_setting('test.jobs_tombstone_revision')::bigint,'f4200000-0000-4000-8000-000000000105',
  'f4200000-0000-4000-8000-000000000108',repeat('1',64))->>'outcome',
  'permit_ready','a current ready proof creates one synthetic Auth permit');
reset role;
select ok(
  private.stream_auth_contract_current('f4200000-0000-4000-8000-000000000105')
  and current_setting('test.jobs_registered_components')::jsonb=coalesce((
    select jsonb_agg(jsonb_build_object(
      'component_key',snapshot.component_key,
      'component_version',snapshot.component_version,
      'resource_set_revision',snapshot.resource_set_revision
    ) order by snapshot.component_key)
    from public.stream_media_auth_permit_components snapshot
    where snapshot.permit_id='f4200000-0000-4000-8000-000000000105'
      and snapshot.validation_revision=(
        select max(latest.validation_revision) from public.stream_media_auth_permit_components latest
        where latest.permit_id='f4200000-0000-4000-8000-000000000105'
      )
  ),'[]'::jsonb),
  'the permit snapshots every currently registered cleanup component'
);
select set_config('test.jobs_tombstone_state_revision',(
  select state_revision::text from public.stream_media_account_tombstones
  where id='f4200000-0000-4000-8000-000000000102'
),true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.start_stream_auth_deletion_call(
  'f4200000-0000-4000-8000-000000000105',1,
  current_setting('test.jobs_tombstone_state_revision')::bigint,
  'f4200000-0000-4000-8000-000000000109',repeat('2',64))->>'outcome','started',
  'the current permit can begin its database-side Auth phase without an external Auth call');
select is(public.record_stream_auth_deletion_result(
  'f4200000-0000-4000-8000-000000000105',2,
  current_setting('test.jobs_tombstone_state_revision')::bigint+1,
  'unknown','f4200000-0000-4000-8000-000000000110',repeat('3',64))->>'outcome','recorded',
  'a synthetic unknown Auth result moves the same permit to its revalidation state');
select is(public.prepare_stream_auth_deletion_permit(
  'f4200000-0000-4000-8000-000000000102',current_setting('test.jobs_tombstone_revision')::bigint,'f4200000-0000-4000-8000-000000000105',
  'f4200000-0000-4000-8000-000000000111',repeat('4',64))->>'outcome','revalidated',
  'the exact same permit revalidates against the latest unchanged cleanup proof');
reset role;
select ok(private.stream_auth_contract_current('f4200000-0000-4000-8000-000000000105'),
  'the revalidated permit is current before the delayed summary finish arrives');
select set_config('test.jobs_ready_inventory_before',pg_temp.form_coach_jobs_component_inventory(
  'f4200000-0000-4000-8000-000000000002')::text,true);
select set_config('test.jobs_ready_inventory_hash_before',encode(extensions.digest(convert_to(
  pg_temp.form_coach_jobs_component_inventory('f4200000-0000-4000-8000-000000000002')::text,'UTF8'),'sha256'),'hex'),true);
select set_config('test.jobs_ready_rows_hash_before',encode(extensions.digest(convert_to(
  pg_temp.form_coach_jobs_rows('f4200000-0000-4000-8000-000000000002')::text,'UTF8'),'sha256'),'hex'),true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.service_authorize_form_coach_summary_dispatch(
  (current_setting('test.jobs_fair_claim')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.jobs_fair_claim')::jsonb->>'claim_token')::uuid)->>'outcome','stale_claim',
  'a pre-deletion claim cannot obtain a dispatch grant after the Auth proof is ready');
select is((select count(*)::integer from public.service_claim_form_coach_summary_jobs_v2(
  1::smallint,'f4200000-0000-4000-8000-000000000042'::uuid)),0,
  'a suppressed summary cannot be reclaimed after the Auth proof is ready');
select is(public.service_finish_form_coach_summary_dispatch(
  (current_setting('test.jobs_fair_claim')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.jobs_fair_claim')::jsonb->>'claim_token')::uuid,
  (current_setting('test.jobs_auth_c')::jsonb->>'dispatch_token')::uuid,
  'complete','Late output must be discarded. No result may return.')::text,
  '{"outcome": "blocked_deletion"}'::jsonb::text,
  'a late finish after the deletion fence is discarded');
reset role;
select ok(pg_temp.form_coach_jobs_component_inventory('f4200000-0000-4000-8000-000000000002')
    =current_setting('test.jobs_ready_inventory_before')::jsonb
  and encode(extensions.digest(convert_to(pg_temp.form_coach_jobs_component_inventory(
    'f4200000-0000-4000-8000-000000000002')::text,'UTF8'),'sha256'),'hex')
    =current_setting('test.jobs_ready_inventory_hash_before'),
  'Owner recomputes the full cleanup inventory and hash unchanged after post-ready auth/reclaim attempts and late finish');
select ok(encode(extensions.digest(convert_to(pg_temp.form_coach_jobs_rows(
    'f4200000-0000-4000-8000-000000000002')::text,'UTF8'),'sha256'),'hex')
    =current_setting('test.jobs_ready_rows_hash_before'),
  'Owner hashes raw outbox, attempt, numeric result, and dispatch rows unchanged after the fenced finish');
select ok(private.stream_auth_contract_current('f4200000-0000-4000-8000-000000000105'),
  'the same revalidated permit remains current after the expired dispatch returns late');

select * from finish();
rollback;
