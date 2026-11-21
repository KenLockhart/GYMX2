begin;
select plan(152);

-- Synthetic only. This rollback suite creates no provider objects and calls no external APIs.
insert into auth.users (id,email,raw_user_meta_data) values
  ('f4000000-0000-0000-0000-000000000001','workflow-coach-one@example.test','{"display_name":"Workflow Coach One"}'),
  ('f4000000-0000-0000-0000-000000000002','workflow-coach-two@example.test','{"display_name":"Workflow Coach Two"}'),
  ('f4000000-0000-0000-0000-000000000003','workflow-member-one@example.test','{"display_name":"Workflow Member One"}'),
  ('f4000000-0000-0000-0000-000000000004','workflow-member-two@example.test','{"display_name":"Workflow Member Two"}'),
  ('f4000000-0000-0000-0000-000000000005','workflow-outsider@example.test','{"display_name":"Workflow Outsider"}'),
  ('f4000000-0000-0000-0000-000000000006','workflow-admin@example.test','{"display_name":"Workflow Admin"}'),
  ('f4000000-0000-0000-0000-000000000007','workflow-member-three@example.test','{"display_name":"Workflow Member Three"}');
update public.profiles set role='coach' where id in (
  'f4000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000002');
update public.profiles set role='admin' where id='f4000000-0000-0000-0000-000000000006';
insert into public.platform_test_entitlements(member_id,tier,grant_reason,granted_by) values
  ('f4000000-0000-0000-0000-000000000003','regular','Synthetic Form Coach workflow','f4000000-0000-0000-0000-000000000006'),
  ('f4000000-0000-0000-0000-000000000004','regular','Synthetic Form Coach workflow','f4000000-0000-0000-0000-000000000006'),
  ('f4000000-0000-0000-0000-000000000007','regular','Synthetic Form Coach workflow','f4000000-0000-0000-0000-000000000006');
insert into public.coach_members(coach_id,member_id) values
  ('f4000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000003'),
  ('f4000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000004'),
  ('f4000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000007');

-- Raw workflow ledgers stay private even to the trusted application role; callers use typed RPCs.
select ok(not exists (
  select 1 from (values
    ('public.form_coach_assessments'::text),('public.form_coach_assessment_items'),
    ('public.form_coach_attempts'),('public.form_coach_attempt_rep_results'),
    ('public.form_coach_attempt_results'),('public.form_coach_reviews'),
    ('public.form_coach_program_send_outbox'),('public.form_coach_summary_outbox'),
    ('public.form_coach_notification_outbox'),('public.form_coach_media_upload_intents'),
    ('public.form_coach_media_cleanup_queue')
  ) relations(relation_name)
  cross join (values ('anon'::name),('authenticated'::name),('service_role'::name)) roles(role_name)
  where has_table_privilege(roles.role_name,relations.relation_name,'select')
     or has_table_privilege(roles.role_name,relations.relation_name,'insert')
     or has_table_privilege(roles.role_name,relations.relation_name,'update')
     or has_table_privilege(roles.role_name,relations.relation_name,'delete')
), 'all financial, result, outbox, and storage-path ledgers deny direct access');
select ok(not exists (
  select 1 from (values
    ('public.form_coach_media_policy_versions'::regclass),('public.form_coach_media_policy_current'::regclass),
    ('public.form_coach_terms_versions'::regclass),('public.form_coach_terms_current'::regclass),
    ('public.form_coach_member_consents'::regclass),('public.form_coach_templates'::regclass),
    ('public.form_coach_template_versions'::regclass),('public.form_coach_media_upload_intents'::regclass),
    ('public.form_coach_template_asset_claims'::regclass),('public.form_coach_program_rules'::regclass),
    ('public.form_coach_program_rule_items'::regclass),('public.form_coach_assessments'::regclass),
    ('public.form_coach_assessment_items'::regclass),('public.form_coach_attempts'::regclass),
    ('public.form_coach_attempt_requests'::regclass),('public.form_coach_attempt_rep_results'::regclass),
    ('public.form_coach_attempt_results'::regclass),('public.form_coach_reviews'::regclass),
    ('public.form_coach_retry_windows'::regclass),('public.form_coach_attempt_clips'::regclass),
    ('public.form_coach_summary_outbox'::regclass),('public.form_coach_program_send_outbox'::regclass),
    ('public.form_coach_program_send_outbox_items'::regclass),('public.form_coach_notification_outbox'::regclass),
    ('public.form_coach_media_cleanup_queue'::regclass)
  ) relations(relation_oid)
  where not (select relrowsecurity from pg_class where oid=relations.relation_oid)
), 'row-level security is enabled on every workflow table');
select ok(has_function_privilege('authenticated','public.send_form_coach_assessment(uuid,jsonb,smallint,boolean,uuid,uuid)','execute'),
  'a signed-in coach can call the manual-send contract');
select ok(not has_function_privilege('anon','public.send_form_coach_assessment(uuid,jsonb,smallint,boolean,uuid,uuid)','execute'),
  'anonymous callers cannot send an assessment');
select ok(not has_function_privilege('authenticated','public.service_claim_form_coach_program_sends(smallint,smallint)','execute')
  and has_function_privilege('service_role','public.service_claim_form_coach_program_sends(smallint,smallint)','execute')
  and not has_function_privilege('authenticated','public.service_process_form_coach_program_send(uuid,uuid)','execute')
  and has_function_privilege('service_role','public.service_process_form_coach_program_send(uuid,uuid)','execute'),
  'only service_role can claim and process typed Program outbox work');
select ok(not has_function_privilege('authenticated','public.service_record_form_coach_media_upload_outcome(uuid,text,text,bigint,numeric,text)','execute')
  and has_function_privilege('service_role','public.service_record_form_coach_media_upload_outcome(uuid,text,text,bigint,numeric,text)','execute'),
  'clients cannot assert upload or provider-verification outcomes');
select ok(not has_function_privilege('authenticated','public.service_record_form_coach_auth_cleanup_proof(uuid,bigint,uuid)','execute')
  and has_function_privilege('service_role','public.service_record_form_coach_auth_cleanup_proof(uuid,bigint,uuid)','execute'),
  'only the trusted cleanup worker can publish component readiness');

-- Build one exact allowed exercise payload; it contains a 50-point reference curve and only
-- numeric coaching criteria. Malformed JSON values must fail closed rather than throw.
select set_config('test.form_coach_payload',(
  select jsonb_build_object(
    'exerciseKey','dumbbell_curl','schemaVersion',1,'cameraView','side','arm','right',
    'segmentation',jsonb_build_object('metric','elbowAngle','extendedThreshold',160,'flexedThreshold',50),
    'reference',jsonb_build_object('romMinAngle',45,'romMaxAngle',160,'concentricMs',1000,
      'topPauseMs',200,'eccentricMs',1500,'elbowCurve',(
        select jsonb_agg((45 + floor((n-1)*115.0/49))::integer order by n) from generate_series(1,50) n)),
    'tolerances',jsonb_build_object('romTopDeg',10,'romBottomDeg',10,'upperArmDriftDeg',15,
      'torsoSwingDeg',12,'shrugRatio',0.25,'tempoPct',30),
    'scoringWeights',jsonb_build_object('rom',40,'elbow',20,'torso',10,'tempo',15,'shoulders',15),
    'strictness','standard','cues','[]'::jsonb,
    'breathing',jsonb_build_object('concentric','exhale','eccentric','inhale','fullCueReps',3,'thenEvery',3)
  )::text
),true);
select ok(private.form_coach_valid_template_payload('dumbbell_curl',current_setting('test.form_coach_payload')::jsonb),
  'the documented dumbbell-curl numeric reference shape passes validation');
select ok(not private.form_coach_valid_template_payload('dumbbell_curl',current_setting('test.form_coach_payload')::jsonb || '{"rawFrame":"forbidden"}'::jsonb),
  'raw frames and unknown template keys are rejected');
select ok(not private.form_coach_valid_template_payload('dumbbell_curl','[]'::jsonb)
  and not private.form_coach_valid_template_payload('dumbbell_curl','null'::jsonb),
  'non-object and null template payloads fail closed');
select is((select count(*)::integer from storage.buckets where id in (
  'form-coach-reference','form-coach-cues','form-coach-clips') and public is false),3,
  'all Form Coach storage buckets are private');
select ok((select count(*)=3 from storage.buckets where id in (
  'form-coach-reference','form-coach-cues','form-coach-clips') and file_size_limit=26214400),
  'the active synthetic upload cap remains the conservative 25 MiB setting');

-- Configure only synthetic feature pricing and grants. No provider binding or charge is created.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000006","role":"authenticated"}';
select is(public.admin_create_feature_pricing_revision('form_coach',1,'pricing_pending','member',null,'USD',
  'Synthetic Form Coach','Test configuration only','',0,0,'[]'::jsonb),2::bigint,
  'admin configures the explicit member-payer test revision without provider objects');
select is(public.admin_publish_form_coach_terms(1,'/legal/form-coach/terms/1',repeat('a',64)),1,
  'admin publishes an immutable synthetic terms version');
reset role;
insert into public.feature_access_grants(feature_key,user_id,grant_kind,reason,granted_by,request_id)
values
  ('form_coach','f4000000-0000-0000-0000-000000000003','comp','Synthetic Form Coach test grant','f4000000-0000-0000-0000-000000000006','f4100000-0000-0000-0000-000000000003'),
  ('form_coach','f4000000-0000-0000-0000-000000000004','comp','Synthetic Form Coach test grant','f4000000-0000-0000-0000-000000000006','f4100000-0000-0000-0000-000000000004'),
  ('form_coach','f4000000-0000-0000-0000-000000000007','comp','Synthetic Form Coach test grant','f4000000-0000-0000-0000-000000000006','f4100000-0000-0000-0000-000000000005');
select set_config('test.member_one_comp',(
  select id::text from public.feature_access_grants
  where feature_key='form_coach' and user_id='f4000000-0000-0000-0000-000000000003'
),true);

-- Create two versioned templates using synthetic source-verification attestations. The test does
-- not create or upload any media object; a future provider integration remains a separate gate.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('test.template_one',public.save_form_coach_template_draft(null,'Synthetic Curl One',current_setting('test.form_coach_payload')::jsonb)::text,true);
select set_config('test.template_two',public.save_form_coach_template_draft(null,'Synthetic Curl Two',current_setting('test.form_coach_payload')::jsonb)::text,true);
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select set_config('test.upload_one', (public.service_reserve_form_coach_media_upload(
  'f4200000-0000-0000-0000-000000000001','template_reference','f4000000-0000-0000-0000-000000000001',
  current_setting('test.template_one')::uuid,null,'reference','form-coach-reference',
  'f4000000-0000-0000-0000-000000000001/f4200000-0000-0000-0000-000000000001/f4300000-0000-0000-0000-000000000001.mp4',
  repeat('b',64),100,null)->>'upload_intent_id'),true);
select set_config('test.upload_two', (public.service_reserve_form_coach_media_upload(
  'f4200000-0000-0000-0000-000000000002','template_reference','f4000000-0000-0000-0000-000000000001',
  current_setting('test.template_two')::uuid,null,'reference','form-coach-reference',
  'f4000000-0000-0000-0000-000000000001/f4200000-0000-0000-0000-000000000002/f4300000-0000-0000-0000-000000000002.mp4',
  repeat('c',64),120,null)->>'upload_intent_id'),true);
select is(public.service_record_form_coach_media_upload_outcome('f4200000-0000-0000-0000-000000000001','verified',repeat('b',64),100,null,repeat('d',64))->>'outcome',
  'verified','service records the synthetic source-guarded reference identity');
select is(public.service_record_form_coach_media_upload_outcome('f4200000-0000-0000-0000-000000000002','verified',repeat('c',64),120,null,repeat('e',64))->>'outcome',
  'verified','the second template has its own immutable reference claim');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000001","role":"authenticated"}';
select ok(public.publish_form_coach_template_version(current_setting('test.template_one')::uuid,true),
  'coach may publish a private-verified immutable exercise version');
select ok(public.publish_form_coach_template_version(current_setting('test.template_two')::uuid,true),
  'coach can publish a second version for multi-exercise assessments');
select throws_ok(
  $$select public.save_form_coach_template_draft(null,'Bad raw pose',current_setting('test.form_coach_payload')::jsonb || '{"landmarks":[1,2]}'::jsonb)$$,
  '22023',null,'template saves reject client-supplied pose or landmark data');
reset role;

-- A one-day free coach Program is completed before a rule exists. Saving the rule must not
-- backfill or charge that historical completion; only the second member's later event is queued.
insert into public.programs(id,coach_id,title,description,published,platform_owned)
values('f4400000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','Synthetic Curl Program','',false,false);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('test.program_day',public.save_owned_program_day(
  'f4400000-0000-0000-0000-000000000001',null,1::smallint,'Curl Day','Synthetic instructions','body',null
)::text,true);
reset role;
update public.programs set published=true where id='f4400000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((public.start_my_program_enrollment('f4400000-0000-0000-0000-000000000001')->>'existing')::boolean,false,
  'linked member one starts the ordinary free Program');
select is((public.set_my_program_lesson_state('f4400000-0000-0000-0000-000000000001',
  current_setting('test.program_day')::uuid,true,'f4500000-0000-0000-0000-000000000001')->>'accepted')::boolean,true,
  'member one completes before any Form Coach rule exists');
reset role;
select is((select count(*)::integer from public.form_coach_program_send_outbox),0,
  'a completed Program does not create Form Coach work before the rule is saved');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('test.rule_id',(select rule_id::text from public.save_form_coach_program_rule(
  'f4400000-0000-0000-0000-000000000001',
  jsonb_build_array(
    jsonb_build_object('template_version_id',current_setting('test.template_one'),'required_reps',3,'pass_threshold',75,'cues_enabled',true,'max_attempts',2),
    jsonb_build_object('template_version_id',current_setting('test.template_two'),'required_reps',8,'pass_threshold',90,'cues_enabled',false,'max_attempts',3)
  ),0,true,true,5::smallint,false,false
)),true);
reset role;
select is((select count(*)::integer from public.form_coach_program_send_outbox),0,
  'saving a new auto-send rule does not backfill prior completions');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((public.set_my_program_lesson_state('f4400000-0000-0000-0000-000000000001',
  current_setting('test.program_day')::uuid,true,'f4500000-0000-0000-0000-000000000003')->>'accepted')::boolean,true,
  'repeating an already-completed lesson records idempotency without a second transition');
reset role;
select is((select count(*)::integer from public.form_coach_program_send_outbox),0,
  'a no-op completed event after rule creation does not create an auto-send job');
insert into public.program_lesson_progress_events(
  subject_member_id,owner_member_id,program_id,program_owner_id,program_title_snapshot,
  content_version_id,lesson_id,lesson_identity_id,source_enrollment_id,source_day_id,
  order_id,lesson_ordinal,timeline_day_number,lesson_title,lesson_pillar,event_sequence,
  operation_id,operation_digest,event_state,occurred_at
)
select prior.subject_member_id,prior.owner_member_id,prior.program_id,prior.program_owner_id,
  prior.program_title_snapshot,prior.content_version_id,prior.lesson_id,prior.lesson_identity_id,
  enrollment.id,current_setting('test.program_day')::uuid,null,prior.lesson_ordinal,
  prior.timeline_day_number,prior.lesson_title,prior.lesson_pillar,
  (select coalesce(max(existing.event_sequence),0)+1 from public.program_lesson_progress_events existing
    where existing.subject_member_id=prior.subject_member_id and existing.program_id=prior.program_id),
  'f4500000-0000-0000-0000-000000000004',repeat('a',32),'completed',now()
from public.program_lesson_progress_events prior
join public.program_enrollments enrollment on enrollment.program_id=prior.program_id
  and enrollment.member_id=prior.subject_member_id
where prior.subject_member_id='f4000000-0000-0000-0000-000000000003'
  and prior.program_id='f4400000-0000-0000-0000-000000000001'
order by prior.event_sequence desc limit 1;
select is((select count(*)::integer from public.form_coach_program_send_outbox),0,
  'an imported source-enrollment completion snapshot is not a new auto-send event');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((public.set_my_program_lesson_state('f4400000-0000-0000-0000-000000000001',
  current_setting('test.program_day')::uuid,false,'f4500000-0000-0000-0000-000000000008')->>'accepted')::boolean,true,
  'member one opens a new completion transition after the auto-send rule exists');
select is((public.set_my_program_lesson_state('f4400000-0000-0000-0000-000000000001',
  current_setting('test.program_day')::uuid,true,'f4500000-0000-0000-0000-000000000009')->>'accepted')::boolean,true,
  'member one queues an unfunded job for the retry fairness regression');
reset role;
select set_config('test.program_outbox_unfunded',(select outbox.id::text
  from public.form_coach_program_send_outbox outbox
  where outbox.program_id='f4400000-0000-0000-0000-000000000001'
    and outbox.member_subject_id='f4000000-0000-0000-0000-000000000003'),true);
insert into public.feature_access_grant_events(grant_id,action,actor_id)
values(current_setting('test.member_one_comp')::uuid,'revoked','f4000000-0000-0000-0000-000000000006');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((public.start_my_program_enrollment('f4400000-0000-0000-0000-000000000001')->>'existing')::boolean,false,
  'linked member two enrolls after the rule is saved');
select is((public.set_my_program_lesson_state('f4400000-0000-0000-0000-000000000001',
  current_setting('test.program_day')::uuid,true,'f4500000-0000-0000-0000-000000000002')->>'accepted')::boolean,true,
  'the later canonical completion is accepted');
select is((public.set_my_program_lesson_state('f4400000-0000-0000-0000-000000000001',
  current_setting('test.program_day')::uuid,true,'f4500000-0000-0000-0000-000000000005')->>'current_completed')::boolean,true,
  'repeating a completed event returns current state without another send');
select is((public.set_my_program_lesson_state('f4400000-0000-0000-0000-000000000001',
  current_setting('test.program_day')::uuid,false,'f4500000-0000-0000-0000-000000000006')->>'current_completed')::boolean,false,
  'undo records the new current state');
select is((public.set_my_program_lesson_state('f4400000-0000-0000-0000-000000000001',
  current_setting('test.program_day')::uuid,true,'f4500000-0000-0000-0000-000000000007')->>'current_completed')::boolean,true,
  'recompletion restores the current state');
reset role;
select is((select count(*)::integer from public.form_coach_program_send_outbox),2,
  'member one unfunded and member two funded completions each create one durable job');
select is((select count(*)::integer from public.form_coach_program_send_outbox),2,
  'complete, undo, and recomplete create only one send job per member and rule generation');
select is((select count(*)::integer from public.form_coach_program_send_outbox_items),4,
  'each send event freezes every configured exercise item');
select ok((select array_agg(required_reps order by outbox_id,item_ordinal)=array[3,8,3,8]::smallint[]
  and array_agg(pass_threshold order by outbox_id,item_ordinal)=array[75,90,75,90]::numeric[]
  and array_agg(cues_enabled order by outbox_id,item_ordinal)=array[true,false,true,false]::boolean[]
  and array_agg(max_attempts order by outbox_id,item_ordinal)=array[2,3,2,3]::smallint[]
  from public.form_coach_program_send_outbox_items),'per-item rep, threshold, cue, and attempt settings are frozen');
update public.form_coach_program_send_outbox outbox set next_attempt_at=case outbox.member_subject_id
  when 'f4000000-0000-0000-0000-000000000003' then now()-interval '2 minutes'
  when 'f4000000-0000-0000-0000-000000000004' then now()-interval '1 minute'
end
where outbox.program_id='f4400000-0000-0000-0000-000000000001'
  and outbox.member_subject_id in ('f4000000-0000-0000-0000-000000000003','f4000000-0000-0000-0000-000000000004');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$select * from public.save_form_coach_program_rule('f4400000-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object('template_version_id',current_setting('test.template_one'),'required_reps',4),
      jsonb_build_object('template_version_id',current_setting('test.template_two'))),1,true,true,5::smallint,false,false)$$,
  '55000',null,'a used rule generation cannot silently rewrite a queued item snapshot');
reset role;
select set_config('test.program_outbox_paused',(
  select outbox.id::text from public.form_coach_program_send_outbox outbox
  where outbox.program_id='f4400000-0000-0000-0000-000000000001'
    and outbox.member_subject_id='f4000000-0000-0000-0000-000000000004'),true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select set_config('test.program_claim',(
  select jsonb_build_object('outbox_id',claim.outbox_id,'program_id',claim.program_id,
    'member_subject_id',claim.member_subject_id,'claim_token',claim.claim_token)::text
  from public.service_claim_form_coach_program_sends(1::smallint,120::smallint) claim limit 1
),true);
select is((current_setting('test.program_claim')::jsonb->>'member_subject_id'),
  'f4000000-0000-0000-0000-000000000003',
  'the first bounded service claim discovers the older unfunded job through the typed RPC');
select is((public.service_process_form_coach_program_send(
  (current_setting('test.program_claim')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.program_claim')::jsonb->>'claim_token')::uuid)->>'outcome'),'awaiting_funds',
  'an unfunded Program job returns to a bounded retry time instead of occupying the head of the queue');
reset role;
select ok((select state='awaiting_funds' and next_attempt_at>now() and claim_token is null
  and lease_expires_at is null and claim_attempt_count=1
  from public.form_coach_program_send_outbox where id=current_setting('test.program_outbox_unfunded')::uuid),
  'unfunded work records a future retry and clears its lease');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select set_config('test.funding_notice_claim',(
  select jsonb_build_object('outbox_id',notice.outbox_id,'claim_token',notice.claim_token)::text
  from public.service_claim_form_coach_notifications(10::smallint,120::smallint) notice
  where notice.event_key='coach-funding:'||current_setting('test.program_outbox_unfunded') limit 1
),true);
select ok(current_setting('test.funding_notice_claim')::jsonb ? 'claim_token',
  'the coach funding notice can be claimed while the Program send waits for funding');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000006","role":"authenticated"}';
select is(public.admin_create_feature_pricing_revision('form_coach',2,'disabled','member',null,'USD',
  'Synthetic Form Coach','Paused queue test','',0,0,'[]'::jsonb),3::bigint,
  'admin can pause new Form Coach sends for a retry scheduling test');
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select set_config('test.paused_claim',(
  select jsonb_build_object('outbox_id',claim.outbox_id,'program_id',claim.program_id,
    'member_subject_id',claim.member_subject_id,'claim_token',claim.claim_token)::text
  from public.service_claim_form_coach_program_sends(1::smallint,120::smallint) claim limit 1
),true);
select is((current_setting('test.paused_claim')::jsonb->>'member_subject_id'),
  'f4000000-0000-0000-0000-000000000004',
  'the second bounded claim advances to the next eligible member');
select is((public.service_process_form_coach_program_send(
  (current_setting('test.paused_claim')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.paused_claim')::jsonb->>'claim_token')::uuid)->>'outcome'),'paused',
  'a disabled feature send is deferred with a retry time');
reset role;
select ok((select state='pending' and next_attempt_at>now() and claim_token is null
  and lease_expires_at is null and last_outcome='feature_disabled' and claim_attempt_count=1
  from public.form_coach_program_send_outbox where id=current_setting('test.program_outbox_paused')::uuid),
  'paused work records the same bounded retry contract and releases its lease');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000006","role":"authenticated"}';
select is(public.admin_create_feature_pricing_revision('form_coach',3,'pricing_pending','member',null,'USD',
  'Synthetic Form Coach','Resume queue test','',0,0,'[]'::jsonb),4::bigint,
  'admin re-enables the synthetic configuration after the pause case');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000007","role":"authenticated"}';
select is((public.start_my_program_enrollment('f4400000-0000-0000-0000-000000000001')->>'existing')::boolean,false,
  'member three enrolls to create fresh eligible work behind two deferred jobs');
select is((public.set_my_program_lesson_state('f4400000-0000-0000-0000-000000000001',
  current_setting('test.program_day')::uuid,true,'f4500000-0000-0000-0000-000000000010')->>'accepted')::boolean,true,
  'member three completes the canonical lesson after the feature is re-enabled');
reset role;
select set_config('test.program_outbox_new',(select outbox.id::text
  from public.form_coach_program_send_outbox outbox
  where outbox.program_id='f4400000-0000-0000-0000-000000000001'
    and outbox.member_subject_id='f4000000-0000-0000-0000-000000000007'),true);
select is((select count(*)::integer from public.form_coach_program_send_outbox),3,
  'the deferred unfunded and paused jobs coexist with fresh eligible work');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select set_config('test.new_claim',(
  select jsonb_build_object('outbox_id',claim.outbox_id,'program_id',claim.program_id,
    'member_subject_id',claim.member_subject_id,'claim_token',claim.claim_token)::text
  from public.service_claim_form_coach_program_sends(1::smallint,120::smallint) claim limit 1
),true);
select is((current_setting('test.new_claim')::jsonb->>'outbox_id'),current_setting('test.program_outbox_new'),
  'one-at-a-time claims skip older unfunded and paused rows whose retry times are in the future');
select is((public.service_process_form_coach_program_send(
  (current_setting('test.new_claim')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.new_claim')::jsonb->>'claim_token')::uuid)->>'outcome'),'sent',
  'fresh funded work completes while two older jobs are deferred');
reset role;
with restored as (
  insert into public.feature_access_grants(feature_key,user_id,grant_kind,reason,granted_by,request_id)
  values('form_coach','f4000000-0000-0000-0000-000000000003','comp','Restored synthetic funding for retry',
    'f4000000-0000-0000-0000-000000000006','f4100000-0000-0000-0000-000000000009')
  returning id
)
select set_config('test.member_one_restored_comp',id::text,true) from restored;
update public.form_coach_program_send_outbox set next_attempt_at=now()
where id=current_setting('test.program_outbox_unfunded')::uuid;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select set_config('test.funded_retry_claim',(
  select jsonb_build_object('outbox_id',claim.outbox_id,'claim_token',claim.claim_token)::text
  from public.service_claim_form_coach_program_sends(1::smallint,120::smallint) claim limit 1
),true);
select is((current_setting('test.funded_retry_claim')::jsonb->>'outbox_id'),current_setting('test.program_outbox_unfunded'),
  'restored payer access makes the exact unfunded job eligible again');
select is((public.service_process_form_coach_program_send(
  (current_setting('test.funded_retry_claim')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.funded_retry_claim')::jsonb->>'claim_token')::uuid)->>'outcome'),'sent',
  'the funded retry sends once and suppresses its claimed funding notice atomically');
select is(public.service_finish_form_coach_notification(
  (current_setting('test.funding_notice_claim')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.funding_notice_claim')::jsonb->>'claim_token')::uuid,'recorded'),'suppressed',
  'a stale claimed funding notice observes the terminal suppression result');
select is((public.service_process_form_coach_program_send(
  (current_setting('test.funded_retry_claim')::jsonb->>'outbox_id')::uuid,
  (current_setting('test.funded_retry_claim')::jsonb->>'claim_token')::uuid)->>'outcome'),'already_sent',
  'replaying the successful funded send does not debit or create a second assessment');
reset role;
select ok((select state='suppressed' and claim_token is null and lease_expires_at is null
  from public.form_coach_notification_outbox
  where event_key='coach-funding:'||current_setting('test.program_outbox_unfunded')),
  'success clears the claimed notification lease when suppressing the funding notice');
select ok((select count(*)=2 from public.feature_bundle_funding_receipts receipt
  where receipt.feature_key='form_coach' and receipt.bundle_id in (
    current_setting('test.program_outbox_new')::uuid,current_setting('test.program_outbox_unfunded')::uuid)),
  'both successful jobs have one immutable funding receipt and neither replay debits again');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select is((select count(*)::integer from public.service_claim_form_coach_program_sends(1::smallint,120::smallint)),0,
  'no due jobs remain; older paused work waits for its bounded retry time');
reset role;
select is((select count(*)::integer from public.form_coach_assessments where source_kind='program'),2,
  'the deferred/replayed jobs create only the two funded Program assessments');
select ok((select count(*)=4 and array_agg(required_reps order by assessment_id,item_ordinal)=array[3,8,3,8]::smallint[]
  and array_agg(max_attempts order by assessment_id,item_ordinal)=array[2,3,2,3]::smallint[]
  from public.form_coach_assessment_items),'sent assessments retain the frozen per-item configuration');

-- Manual assessments are member-owned and funding is a single immutable bundle receipt.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('test.manual_assessment',(
  public.send_form_coach_assessment('f4000000-0000-0000-0000-000000000003',
    jsonb_build_array(jsonb_build_object('template_version_id',current_setting('test.template_one'),
      'required_reps',1,'pass_threshold',99,'cues_enabled',false,'max_attempts',3)),
    7::smallint,false,'f4600000-0000-0000-0000-000000000001','f4700000-0000-0000-0000-000000000001')->>'assessment_id'
),true);
reset role;
select set_config('test.manual_item',(
  select item.id::text from public.form_coach_assessment_items item
  where item.assessment_id=current_setting('test.manual_assessment')::uuid order by item.item_ordinal limit 1
),true);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((public.start_form_coach_attempt(current_setting('test.manual_assessment')::uuid,
  current_setting('test.manual_item')::uuid,
  'f4800000-0000-0000-0000-000000000001',false)->>'outcome'),'consent_required',
  'attempts cannot start before accepting the current consent version');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(public.get_form_coach_assessment(current_setting('test.manual_assessment')::uuid),null::jsonb,
  'another member cannot inspect a private assessment by guessing its identifier');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000009999","role":"authenticated"}';
reset role;
select ok(not exists(select 1 from auth.users where id='f4000000-0000-0000-0000-000000009999')
  and not exists(select 1 from public.profiles where id='f4000000-0000-0000-0000-000000009999'),
  'profileless JWT fixture has no auth or profile row');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000009999","role":"authenticated"}';
select is(public.get_form_coach_assessment(current_setting('test.manual_assessment')::uuid),null::jsonb,
  'a profileless JWT subject receives no foreign assessment summary or feedback');
select is(public.get_my_form_coach_templates(),'[]'::jsonb,
  'a profileless JWT subject receives no template metadata');
select is(public.list_my_form_coach_assessments(1,20),
  jsonb_build_object('rows','[]'::jsonb,'page',1,'has_more',false),
  'a profileless JWT subject receives no assessment list or feedback summary');
select is(public.get_form_coach_program_rule('f4400000-0000-0000-0000-000000000001'),null::jsonb,
  'a profileless JWT subject receives no Program rule metadata');
select throws_ok($$select public.admin_get_form_coach_usage()$$,'42501',null,
  'a stale profileless JWT cannot read usage aggregates');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((public.record_form_coach_member_consent(1) is not null),true,'member accepts current terms before camera or assessment use');
select is((public.get_form_coach_assessment(current_setting('test.manual_assessment')::uuid)->>'can_attempt')::boolean,true,
  'only the exact enrolled buyer receives the permitted assessment projection');
select ok(not (public.get_form_coach_assessment(current_setting('test.manual_assessment')::uuid)::text ~* '(storage_path|audioPath|signed_url|cloudflare_uid)'),
  'member projections do not expose private storage paths or provider identifiers');

-- A lease surviving beyond due expiry cannot be renewed or resumed without its exact current retry
-- window. A separate still-unexpired lease keeps its bounded finish grace.
-- These owner-built rows are synthetic guard fixtures: their sent_at/due_at chronology does not
-- claim producer-flow eligibility or test producer send-duration constraints.
reset role;
insert into public.form_coach_assessments(
  id,send_request_id,send_digest,source_kind,member_subject_id,member_owner_id,coach_subject_id,coach_owner_id,
  sent_by_subject_id,sent_by_owner_id,payer_role,payer_subject_id,payer_owner_id,config_revision,due_at,
  allow_member_clip,status,sent_at
) values(
  'f4d00000-0000-0000-0000-000000000001','f4d00000-0000-0000-0000-000000000002',repeat('d',64),'manual',
  'f4000000-0000-0000-0000-000000000003','f4000000-0000-0000-0000-000000000003',
  'f4000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001',
  'f4000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001',
  'member','f4000000-0000-0000-0000-000000000003','f4000000-0000-0000-0000-000000000003',2,
  now()-interval '1 hour',false,'expired',now()-interval '31 days'
);
insert into public.form_coach_assessment_items(
  id,assessment_id,item_ordinal,item_key,item_title_snapshot,template_version_id,exercise_key,
  required_reps,pass_threshold,cues_enabled,max_attempts
) values
  ('f4d00000-0000-0000-0000-000000000003','f4d00000-0000-0000-0000-000000000001',1,
    'expired_no_retry','Expired no-retry Curl',current_setting('test.template_one')::uuid,'dumbbell_curl',1,75,false,1),
  ('f4d00000-0000-0000-0000-000000000006','f4d00000-0000-0000-0000-000000000001',2,
    'expired_finish_grace','Expired finish grace Curl',current_setting('test.template_one')::uuid,'dumbbell_curl',1,75,false,1);
insert into public.feature_bundle_funding_receipts(
  bundle_id,feature_key,payer_role,payer_id,config_revision,funding_source,source_id,
  credit_units_consumed,due_at,operation_key
) values(
  'f4d00000-0000-0000-0000-000000000001','form_coach','member','f4000000-0000-0000-0000-000000000003',
  2,'comp','synthetic-expired-attempt-fixture',0,now()-interval '1 hour','synthetic-expired-attempt-operation'
);
insert into public.form_coach_attempts(
  id,assessment_id,item_id,member_subject_id,attempt_number,state,lease_token,lease_expires_at,
  consent_terms_version,started_at,finished_at,result_digest
) values
  ('f4d00000-0000-0000-0000-000000000004','f4d00000-0000-0000-0000-000000000001',
    'f4d00000-0000-0000-0000-000000000003','f4000000-0000-0000-0000-000000000003',1,'running',
    'f4d00000-0000-0000-0000-000000000005',now()-interval '1 minute',1,now()-interval '2 hours',null,null),
  ('f4d00000-0000-0000-0000-000000000007','f4d00000-0000-0000-0000-000000000001',
    'f4d00000-0000-0000-0000-000000000006','f4000000-0000-0000-0000-000000000003',1,'running',
    'f4d00000-0000-0000-0000-000000000008',now()+interval '1 minute',1,now()-interval '2 hours',null,null);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((public.start_form_coach_attempt('f4d00000-0000-0000-0000-000000000001',
  'f4d00000-0000-0000-0000-000000000003','f4d00000-0000-0000-0000-000000000009',false)->>'outcome'),
  'assessment_expired','an expired lease cannot resume past due without the exact retry window');
select is(public.heartbeat_form_coach_attempt(
  'f4d00000-0000-0000-0000-000000000004','f4d00000-0000-0000-0000-000000000005'),false,
  'heartbeat cannot resurrect a lease after its lease and assessment window expire');
select is(public.heartbeat_form_coach_attempt(
  'f4d00000-0000-0000-0000-000000000007','f4d00000-0000-0000-0000-000000000008'),false,
  'an unexpired lease cannot renew after the due window closes');
reset role;

insert into public.form_coach_assessments(
  id,send_request_id,send_digest,source_kind,member_subject_id,member_owner_id,coach_subject_id,coach_owner_id,
  sent_by_subject_id,sent_by_owner_id,payer_role,payer_subject_id,payer_owner_id,config_revision,due_at,
  allow_member_clip,status,sent_at
) values(
  'f4d00000-0000-0000-0000-000000000010','f4d00000-0000-0000-0000-000000000011',repeat('e',64),'manual',
  'f4000000-0000-0000-0000-000000000003','f4000000-0000-0000-0000-000000000003',
  'f4000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001',
  'f4000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001',
  'member','f4000000-0000-0000-0000-000000000003','f4000000-0000-0000-0000-000000000003',2,
  now()+interval '30 seconds',false,'in_progress',now()-interval '31 days'
);
insert into public.form_coach_assessment_items(
  id,assessment_id,item_ordinal,item_key,item_title_snapshot,template_version_id,exercise_key,
  required_reps,pass_threshold,cues_enabled,max_attempts
) values(
  'f4d00000-0000-0000-0000-000000000012','f4d00000-0000-0000-0000-000000000010',1,
  'near_due_item','Near due Curl',current_setting('test.template_one')::uuid,'dumbbell_curl',1,75,false,1
);
insert into public.feature_bundle_funding_receipts(
  bundle_id,feature_key,payer_role,payer_id,config_revision,funding_source,source_id,
  credit_units_consumed,due_at,operation_key
) values(
  'f4d00000-0000-0000-0000-000000000010','form_coach','member','f4000000-0000-0000-0000-000000000003',
  2,'comp','synthetic-near-due-fixture',0,now()+interval '30 seconds','synthetic-near-due-operation'
);
insert into public.form_coach_attempts(
  id,assessment_id,item_id,member_subject_id,attempt_number,state,lease_token,lease_expires_at,
  consent_terms_version,started_at,finished_at,result_digest
) values(
  'f4d00000-0000-0000-0000-000000000013','f4d00000-0000-0000-0000-000000000010',
  'f4d00000-0000-0000-0000-000000000012','f4000000-0000-0000-0000-000000000003',1,'running',
  'f4d00000-0000-0000-0000-000000000014',now()+interval '2 minutes',1,now()-interval '5 minutes',null,null
);
select set_config('test.near_due_closes_at',(
  select due_at::text from public.form_coach_assessments where id='f4d00000-0000-0000-0000-000000000010'
),true);
select set_config('test.near_due_original_lease_expires_at',(
  select lease_expires_at::text from public.form_coach_attempts where id='f4d00000-0000-0000-0000-000000000013'
),true);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(public.heartbeat_form_coach_attempt(
  'f4d00000-0000-0000-0000-000000000013','f4d00000-0000-0000-0000-000000000014'),true,
  'an active due-window lease may heartbeat while that window remains open');
reset role;
select ok((select lease_expires_at=current_setting('test.near_due_original_lease_expires_at')::timestamptz
  and lease_expires_at>current_setting('test.near_due_closes_at')::timestamptz
  from public.form_coach_attempts where id='f4d00000-0000-0000-0000-000000000013'),
  'heartbeat preserves the already-issued bounded finish grace beyond the due deadline');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000003","role":"authenticated"}';
select set_config('test.attempt_one',public.start_form_coach_attempt(current_setting('test.manual_assessment')::uuid,
  current_setting('test.manual_item')::uuid,
  'f4800000-0000-0000-0000-000000000002',false)::text,true);
select is((current_setting('test.attempt_one')::jsonb->>'outcome'),'started','first attempt reserves a durable lease');
select is((public.start_form_coach_attempt(current_setting('test.manual_assessment')::uuid,
  current_setting('test.manual_item')::uuid,
  'f4800000-0000-0000-0000-000000000003',false)->>'outcome'),'attempt_in_progress',
  'a second active request cannot reserve a second concurrent slot');
reset role;

-- Synthetic rep metrics are bounded numeric facts, not raw video/landmark data. Exact completion
-- retries are immutable, and a high score never writes the coach's Learned verdict.
select set_config('test.rep_one',jsonb_build_array(jsonb_build_object(
  'rep_number',1,'score',92,'rom_min_angle',45,'rom_max_angle',160,'rom_score',90,
  'max_upper_arm_drift',5,'max_torso_swing',4,'max_shrug',0.1,'concentric_ms',900,
  'top_pause_ms',200,'eccentric_ms',1200,'curve_similarity',95,'elbow_score',94,
  'torso_score',90,'tempo_score',88,'shoulders_score',91,'faults',jsonb_build_array('clean_rep')
))::text,true);
select ok(private.form_coach_attempt_payload_valid(current_setting('test.rep_one')::jsonb),
  'the strict numeric per-rep measurement envelope accepts valid values');
select ok(not private.form_coach_attempt_payload_valid(current_setting('test.rep_one')::jsonb ||
  '[{"rep_number":2,"rawFrame":"forbidden"}]'::jsonb),
  'raw frames and undeclared metric keys are rejected');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((public.finish_form_coach_attempt('f4d00000-0000-0000-0000-000000000007',
  'f4d00000-0000-0000-0000-000000000008',current_setting('test.rep_one')::jsonb)->>'outcome'),
  'finished','a lease that was still unexpired can finish under its original bounded grace');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((public.finish_form_coach_attempt((current_setting('test.attempt_one')::jsonb->>'attempt_id')::uuid,
  (current_setting('test.attempt_one')::jsonb->>'lease_token')::uuid,current_setting('test.rep_one')::jsonb)->>'outcome'),
  'finished','the exact reserved attempt persists bounded numeric rep results');
select is((public.finish_form_coach_attempt((current_setting('test.attempt_one')::jsonb->>'attempt_id')::uuid,
  (current_setting('test.attempt_one')::jsonb->>'lease_token')::uuid,current_setting('test.rep_one')::jsonb)->>'outcome'),
  'already_finished','same digest retry returns the immutable saved result');
select throws_ok(
  $$select public.finish_form_coach_attempt((current_setting('test.attempt_one')::jsonb->>'attempt_id')::uuid,
    (current_setting('test.attempt_one')::jsonb->>'lease_token')::uuid,current_setting('test.rep_one')::jsonb || '[{"rawFrame":"no"}]'::jsonb)$$,
  '22023',null,'a changed or nonnumeric replay cannot rewrite a completed attempt');
reset role;
select ok(not exists(select 1 from public.form_coach_reviews review
  join public.form_coach_assessment_items item on item.id=review.item_id
  where item.assessment_id=current_setting('test.manual_assessment')::uuid),
  'numeric scores do not automatically assign Learned or NeedsWork');
select is((select count(*)::integer from public.feature_bundle_funding_receipts receipt
  where receipt.feature_key='form_coach' and receipt.bundle_id=current_setting('test.manual_assessment')::uuid),1,
  'all attempts in an assessment share one funding receipt');
reset role;

-- Summary workers consume numeric-only outbox entries; absent model configuration is represented
-- by a retry/unavailable result rather than rolling back the authoritative attempt.
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select set_config('test.summary_claim',(
  select jsonb_build_object('attempt_id',attempt_id,'claim_token',claim_token)::text
  from public.service_claim_form_coach_summary_jobs(10::smallint,120::smallint)
  where attempt_id=(current_setting('test.attempt_one')::jsonb->>'attempt_id')::uuid
),true);
select ok((current_setting('test.summary_claim')::jsonb ? 'claim_token'),
  'summary work is durably claimed for service-side processing');
select is((public.service_finish_form_coach_summary_job(
  (current_setting('test.summary_claim')::jsonb->>'attempt_id')::uuid,
  (current_setting('test.summary_claim')::jsonb->>'claim_token')::uuid,'unavailable',null)->>'outcome'),
  'unavailable','missing model service can finish the job as unavailable');
reset role;

-- Attempts two and three are valid before a coach verdict; the reviewer can select the best
-- completed attempt rather than being restricted to the latest. A verdict request is CAS guarded.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000003","role":"authenticated"}';
select set_config('test.attempt_two',public.start_form_coach_attempt(current_setting('test.manual_assessment')::uuid,
  current_setting('test.manual_item')::uuid,
  'f4800000-0000-0000-0000-000000000004',false)::text,true);
select is((current_setting('test.attempt_two')::jsonb->>'attempt_number')::integer,2,
  'second ordinary attempt does not require an intermediate coach review or debit');
select is((public.finish_form_coach_attempt((current_setting('test.attempt_two')::jsonb->>'attempt_id')::uuid,
  (current_setting('test.attempt_two')::jsonb->>'lease_token')::uuid,current_setting('test.rep_one')::jsonb ||
  '[{"rep_number":2,"score":85,"rom_min_angle":45,"rom_max_angle":160,"rom_score":85,"max_upper_arm_drift":6,"max_torso_swing":5,"max_shrug":0.1,"concentric_ms":950,"top_pause_ms":200,"eccentric_ms":1250,"curve_similarity":90,"elbow_score":85,"torso_score":85,"tempo_score":85,"shoulders_score":85,"faults":[]}]'::jsonb)->>'outcome'),
  'finished','second attempt finishes with synthetic numeric readings');
select set_config('test.attempt_three',public.start_form_coach_attempt(current_setting('test.manual_assessment')::uuid,
  current_setting('test.manual_item')::uuid,
  'f4800000-0000-0000-0000-000000000005',false)::text,true);
select is((current_setting('test.attempt_three')::jsonb->>'attempt_number')::integer,3,
  'third configured attempt is available without a prior verdict');
select is((public.finish_form_coach_attempt((current_setting('test.attempt_three')::jsonb->>'attempt_id')::uuid,
  (current_setting('test.attempt_three')::jsonb->>'lease_token')::uuid,current_setting('test.rep_one')::jsonb ||
  '[{"rep_number":2,"score":70,"rom_min_angle":45,"rom_max_angle":160,"rom_score":70,"max_upper_arm_drift":8,"max_torso_swing":7,"max_shrug":0.2,"concentric_ms":1100,"top_pause_ms":150,"eccentric_ms":1400,"curve_similarity":75,"elbow_score":70,"torso_score":70,"tempo_score":70,"shoulders_score":70,"faults":[]}]'::jsonb)->>'outcome'),
  'finished','third configured attempt is retained as history');
select is((public.start_form_coach_attempt(current_setting('test.manual_assessment')::uuid,
  current_setting('test.manual_item')::uuid,
  'f4800000-0000-0000-0000-000000000006',false)->>'outcome'),'attempt_limit',
  'attempt count cannot exceed the frozen per-item allowance');
reset role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('test.review_result',public.record_form_coach_review(
  (current_setting('test.attempt_one')::jsonb->>'attempt_id')::uuid,0,
  'f4900000-0000-0000-0000-000000000001','learned','Best completed attempt',false,null,null
)::text,true);
select is((current_setting('test.review_result')::jsonb->>'outcome'),'recorded',
  'coach can review an earlier finished attempt after later attempts');
select is((public.record_form_coach_review((current_setting('test.attempt_one')::jsonb->>'attempt_id')::uuid,0,
  'f4900000-0000-0000-0000-000000000001','learned','Best completed attempt',false,null,null)->>'outcome'),
  'already_recorded','exact lost-response review replay returns its original receipt before CAS');
select throws_ok(
  $$select public.record_form_coach_review((current_setting('test.attempt_one')::jsonb->>'attempt_id')::uuid,0,
    'f4900000-0000-0000-0000-000000000001','needs_work','Changed replay',false,null,null)$$,
  '23505',null,'a review request UUID cannot be reused with another decision');
select throws_ok(
  $$select public.record_form_coach_review((current_setting('test.attempt_two')::jsonb->>'attempt_id')::uuid,0,
    'f4900000-0000-0000-0000-000000000002','learned','Stale expected review sequence',false,null,null)$$,
  '40001',null,'a distinct review with stale expected sequence is rejected');
reset role;

-- NeedsWork opens a bounded retry window on the existing assessment and keeps its immutable
-- funding receipt even if the original comp source is later revoked.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('test.retry_assessment',(
  public.send_form_coach_assessment('f4000000-0000-0000-0000-000000000003',
    jsonb_build_array(jsonb_build_object('template_version_id',current_setting('test.template_two'),
      'required_reps',1,'pass_threshold',75,'cues_enabled',false,'max_attempts',1)),
    7::smallint,false,'f4600000-0000-0000-0000-000000000002','f4700000-0000-0000-0000-000000000002')->>'assessment_id'
),true);
reset role;
select set_config('test.retry_item',(
  select item.id::text from public.form_coach_assessment_items item
  where item.assessment_id=current_setting('test.retry_assessment')::uuid order by item.item_ordinal limit 1
),true);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000003","role":"authenticated"}';
select set_config('test.retry_attempt_one',public.start_form_coach_attempt(current_setting('test.retry_assessment')::uuid,
  current_setting('test.retry_item')::uuid,
  'f4800000-0000-0000-0000-000000000010',false)::text,true);
select is((public.finish_form_coach_attempt((current_setting('test.retry_attempt_one')::jsonb->>'attempt_id')::uuid,
  (current_setting('test.retry_attempt_one')::jsonb->>'lease_token')::uuid,current_setting('test.rep_one')::jsonb)->>'outcome'),
  'finished','NeedsWork test assessment records one completed attempt');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((public.record_form_coach_review((current_setting('test.retry_attempt_one')::jsonb->>'attempt_id')::uuid,
  0,'f4900000-0000-0000-0000-000000000010','needs_work','Retry with the same funded bundle',true,60,1::smallint)->>'outcome'),
  'recorded','NeedsWork opens a bounded retry without changing the original funding receipt');
reset role;
insert into public.form_coach_attempts(
  id,assessment_id,item_id,member_subject_id,attempt_number,state,lease_token,lease_expires_at,
  consent_terms_version,started_at,finished_at,result_digest
) values(
  'f4d00000-0000-0000-0000-000000000020',current_setting('test.retry_assessment')::uuid,
  current_setting('test.retry_item')::uuid,'f4000000-0000-0000-0000-000000000003',2,'running',
  'f4d00000-0000-0000-0000-000000000021',now()-interval '1 second',1,now()-interval '1 minute',null,null
);
select set_config('test.retry_closes_at',(
  select closes_at::text from public.form_coach_retry_windows
  where assessment_id=current_setting('test.retry_assessment')::uuid
    and item_id=current_setting('test.retry_item')::uuid
),true);
insert into public.feature_access_grant_events(grant_id,action,actor_id)
values(current_setting('test.member_one_restored_comp')::uuid,'revoked','f4000000-0000-0000-0000-000000000006');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(public.heartbeat_form_coach_attempt(
  'f4d00000-0000-0000-0000-000000000020','f4d00000-0000-0000-0000-000000000021'),false,
  'an expired lease cannot be revived by heartbeat even inside an active exact retry');
select set_config('test.retry_attempt_two',public.start_form_coach_attempt(current_setting('test.retry_assessment')::uuid,
  current_setting('test.retry_item')::uuid,
  'f4800000-0000-0000-0000-000000000011',false)::text,true);
select is((current_setting('test.retry_attempt_two')::jsonb->>'outcome'),'resumed',
  'an expired running attempt resumes only while its exact NeedsWork retry window is active');
select is((current_setting('test.retry_attempt_two')::jsonb->>'attempt_number')::integer,2,
  'an exhausted retry allowance resumes the existing reservation without a new slot');
select is(public.heartbeat_form_coach_attempt(
  (current_setting('test.retry_attempt_two')::jsonb->>'attempt_id')::uuid,
  (current_setting('test.retry_attempt_two')::jsonb->>'lease_token')::uuid),true,
  'a resumed attempt can heartbeat while its exact retry window remains open');
reset role;
set local request.jwt.claim.role='owner';
set local request.jwt.claims='{}';
update public.form_coach_attempts set lease_expires_at=now()-interval '1 second'
where id=(current_setting('test.retry_attempt_two')::jsonb->>'attempt_id')::uuid;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000003","role":"authenticated"}';
select set_config('test.retry_attempt_three',public.start_form_coach_attempt(
  current_setting('test.retry_assessment')::uuid,current_setting('test.retry_item')::uuid,
  'f4800000-0000-0000-0000-000000000012',false)::text,true);
select is(current_setting('test.retry_attempt_three')::jsonb->>'outcome','resumed',
  'a second authenticated resume rotates the same retry attempt after its lease expires');
select is(current_setting('test.retry_attempt_three')::jsonb->>'attempt_id',
  current_setting('test.retry_attempt_two')::jsonb->>'attempt_id',
  'resume keeps the existing attempt ID instead of allocating another slot');
select ok(current_setting('test.retry_attempt_three')::jsonb->>'lease_token'
  is distinct from current_setting('test.retry_attempt_two')::jsonb->>'lease_token',
  'resume issues a new lease token for the same attempt');
reset role;
set local request.jwt.claim.role='owner';
set local request.jwt.claims='{}';
select set_config('test.retry_lease_before_replay',(
  select lease_expires_at::text from public.form_coach_attempts
  where id=(current_setting('test.retry_attempt_three')::jsonb->>'attempt_id')::uuid
),true);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000003","role":"authenticated"}';
select set_config('test.retry_resumed_request_replay',public.start_form_coach_attempt(
  current_setting('test.retry_assessment')::uuid,current_setting('test.retry_item')::uuid,
  'f4800000-0000-0000-0000-000000000011',false)::text,true);
select is(current_setting('test.retry_resumed_request_replay')::jsonb->>'outcome','existing',
  'replaying the prior request for this attempt does not create another reservation');
select is(current_setting('test.retry_resumed_request_replay')::jsonb->>'lease_token',
  current_setting('test.retry_attempt_two')::jsonb->>'lease_token',
  'a resumed request replay returns its own now-superseded token');
reset role;
set local request.jwt.claim.role='owner';
set local request.jwt.claims='{}';
select ok((select lease_expires_at=current_setting('test.retry_lease_before_replay')::timestamptz
  from public.form_coach_attempts where id=(current_setting('test.retry_attempt_three')::jsonb->>'attempt_id')::uuid),
  'replaying a prior request never extends the newest rotated lease');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(public.heartbeat_form_coach_attempt(
  (current_setting('test.retry_attempt_three')::jsonb->>'attempt_id')::uuid,
  (current_setting('test.retry_attempt_two')::jsonb->>'lease_token')::uuid),false,
  'the superseded prior token cannot heartbeat the newest lease');
select throws_ok(
  $$select public.finish_form_coach_attempt(
    (current_setting('test.retry_attempt_three')::jsonb->>'attempt_id')::uuid,
    (current_setting('test.retry_attempt_two')::jsonb->>'lease_token')::uuid,
    current_setting('test.rep_one')::jsonb)$$,
  '40001',null,'the superseded prior token cannot finish the newest lease');
reset role;
set local request.jwt.claim.role='owner';
set local request.jwt.claims='{}';
select ok((select attempt.lease_expires_at<=current_setting('test.retry_closes_at')::timestamptz
  from public.form_coach_attempts attempt
  where attempt.id=(current_setting('test.retry_attempt_three')::jsonb->>'attempt_id')::uuid),
  'retry heartbeat never extends its lease beyond the retry-window close');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((public.finish_form_coach_attempt((current_setting('test.retry_attempt_three')::jsonb->>'attempt_id')::uuid,
  (current_setting('test.retry_attempt_three')::jsonb->>'lease_token')::uuid,current_setting('test.rep_one')::jsonb)->>'outcome'),
  'finished','retry result remains a normal immutable numeric attempt');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((public.record_form_coach_review((current_setting('test.retry_attempt_three')::jsonb->>'attempt_id')::uuid,
  1,'f4900000-0000-0000-0000-000000000011','learned','Retry completed',false,null,null)->>'outcome'),
  'recorded','coach can finish the authorized retry with a new review sequence');
reset role;
insert into public.form_coach_reviews(
  id,request_id,assessment_id,item_id,attempt_id,coach_subject_id,coach_owner_id,verdict,feedback,request_digest,
  review_sequence,created_at
) values(
  'f4d00000-0000-0000-0000-000000000040','f4900000-0000-0000-0000-000000000012',
  current_setting('test.retry_assessment')::uuid,current_setting('test.retry_item')::uuid,
  (current_setting('test.retry_attempt_three')::jsonb->>'attempt_id')::uuid,
  'f4000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001',
  'needs_work','A newer decision without a retry window',repeat('c',64),3,now()-interval '32 days'
);
-- This synthetic Owner fixture aligns the assessment state with its latest NeedsWork decision.
update public.form_coach_assessments
set status='in_progress'
where id=current_setting('test.retry_assessment')::uuid;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((public.start_form_coach_attempt(current_setting('test.retry_assessment')::uuid,
  current_setting('test.retry_item')::uuid,'f4d10000-0000-0000-0000-000000000001',false)->>'outcome'),
  'retry_window_required','an older retry window cannot survive a newer NeedsWork review without its own window');
reset role;
select ok((select count(*)=1 from public.feature_bundle_funding_receipts receipt
  where receipt.feature_key='form_coach' and receipt.bundle_id=current_setting('test.retry_assessment')::uuid)
  and (select count(*)=2 from public.form_coach_attempts attempt
    where attempt.assessment_id=current_setting('test.retry_assessment')::uuid),
  'the superseded retry decision neither charges nor creates another attempt slot');
select is((select count(*)::integer from public.feature_bundle_funding_receipts receipt
  where receipt.feature_key='form_coach' and receipt.bundle_id=current_setting('test.retry_assessment')::uuid),1,
  'NeedsWork retries do not create a second bundle charge');

-- A current NeedsWork retry window is the effective use window even after the original due date.
-- Synthetic owner fixtures keep the immutable receipt aligned with the expired assessment.
insert into public.form_coach_assessments(
  id,send_request_id,send_digest,source_kind,member_subject_id,member_owner_id,coach_subject_id,coach_owner_id,
  sent_by_subject_id,sent_by_owner_id,payer_role,payer_subject_id,payer_owner_id,config_revision,due_at,
  allow_member_clip,status,sent_at
) values(
  'f4d00000-0000-0000-0000-000000000030','f4d00000-0000-0000-0000-000000000031',repeat('f',64),'manual',
  'f4000000-0000-0000-0000-000000000003','f4000000-0000-0000-0000-000000000003',
  'f4000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001',
  'f4000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001',
  'member','f4000000-0000-0000-0000-000000000003','f4000000-0000-0000-0000-000000000003',2,
  now()-interval '1 hour',false,'expired',now()-interval '35 days'
);
insert into public.form_coach_assessment_items(
  id,assessment_id,item_ordinal,item_key,item_title_snapshot,template_version_id,exercise_key,
  required_reps,pass_threshold,cues_enabled,max_attempts
) values(
  'f4d00000-0000-0000-0000-000000000032','f4d00000-0000-0000-0000-000000000030',1,
  'past_due_retry','Past due retry Curl',current_setting('test.template_one')::uuid,'dumbbell_curl',1,75,false,1
);
insert into public.feature_bundle_funding_receipts(
  bundle_id,feature_key,payer_role,payer_id,config_revision,funding_source,source_id,
  credit_units_consumed,due_at,operation_key
) values(
  'f4d00000-0000-0000-0000-000000000030','form_coach','member','f4000000-0000-0000-0000-000000000003',
  2,'comp','synthetic-past-due-retry-fixture',0,now()-interval '1 hour','synthetic-past-due-retry-operation'
);
insert into public.form_coach_attempts(
  id,assessment_id,item_id,member_subject_id,attempt_number,state,lease_token,lease_expires_at,
  consent_terms_version,started_at,finished_at,result_digest
) values(
  'f4d00000-0000-0000-0000-000000000033','f4d00000-0000-0000-0000-000000000030',
  'f4d00000-0000-0000-0000-000000000032','f4000000-0000-0000-0000-000000000003',1,'finished',
  'f4d00000-0000-0000-0000-000000000034',now()-interval '1 hour',1,
  now()-interval '34 days',now()-interval '33 days',repeat('a',64)
);
insert into public.form_coach_reviews(
  id,request_id,assessment_id,item_id,attempt_id,coach_subject_id,coach_owner_id,verdict,feedback,request_digest,
  review_sequence,created_at
) values(
  'f4d00000-0000-0000-0000-000000000035','f4d00000-0000-0000-0000-000000000036',
  'f4d00000-0000-0000-0000-000000000030','f4d00000-0000-0000-0000-000000000032',
  'f4d00000-0000-0000-0000-000000000033','f4000000-0000-0000-0000-000000000001',
  'f4000000-0000-0000-0000-000000000001','needs_work','Synthetic past-due retry',repeat('b',64),1,now()-interval '32 days'
);
insert into public.form_coach_retry_windows(
  id,review_id,assessment_id,item_id,opened_by_subject_id,opened_by_owner_id,additional_attempts,opens_at,closes_at
) values(
  'f4d00000-0000-0000-0000-000000000037','f4d00000-0000-0000-0000-000000000035',
  'f4d00000-0000-0000-0000-000000000030','f4d00000-0000-0000-0000-000000000032',
  'f4000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001',1,
  now()-interval '5 minutes',now()+interval '1 hour'
);
insert into public.form_coach_attempts(
  id,assessment_id,item_id,member_subject_id,attempt_number,state,lease_token,lease_expires_at,
  consent_terms_version,started_at,finished_at,result_digest
) values(
  'f4d00000-0000-0000-0000-000000000038','f4d00000-0000-0000-0000-000000000030',
  'f4d00000-0000-0000-0000-000000000032','f4000000-0000-0000-0000-000000000003',2,'running',
  'f4d00000-0000-0000-0000-000000000039',now()+interval '30 seconds',1,now()-interval '2 minutes',null,null
);
select set_config('test.past_due_retry_closes_at',(
  select closes_at::text from public.form_coach_retry_windows where id='f4d00000-0000-0000-0000-000000000037'
),true);
select set_config('test.past_due_retry_due_at',(
  select due_at::text from public.form_coach_assessments where id='f4d00000-0000-0000-0000-000000000030'
),true);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(public.heartbeat_form_coach_attempt(
  'f4d00000-0000-0000-0000-000000000038','f4d00000-0000-0000-0000-000000000039'),true,
  'an open exact NeedsWork retry keeps heartbeat available after the original due date');
reset role;
select ok((select attempt.lease_expires_at>current_setting('test.past_due_retry_due_at')::timestamptz
  and attempt.lease_expires_at<=current_setting('test.past_due_retry_closes_at')::timestamptz
  from public.form_coach_attempts attempt where attempt.id='f4d00000-0000-0000-0000-000000000038'),
  'the exact retry close is effective after due and still bounds the renewed lease');
update public.form_coach_attempts set lease_expires_at=now()-interval '1 second'
where id='f4d00000-0000-0000-0000-000000000038';
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((public.start_form_coach_attempt('f4d00000-0000-0000-0000-000000000030',
  'f4d00000-0000-0000-0000-000000000032','f4d10000-0000-0000-0000-000000000002',false)->>'outcome'),
  'resumed','an expired reservation can resume within its exact retry after due expiry');
reset role;
select ok((select count(*)=1 from public.feature_bundle_funding_receipts receipt
  where receipt.feature_key='form_coach' and receipt.bundle_id='f4d00000-0000-0000-0000-000000000030')
  and (select count(*)=2 from public.form_coach_attempts attempt
    where attempt.assessment_id='f4d00000-0000-0000-0000-000000000030')
  and (select attempt.lease_expires_at<=current_setting('test.past_due_retry_closes_at')::timestamptz
    from public.form_coach_attempts attempt where attempt.id='f4d00000-0000-0000-0000-000000000038'),
  'past-due resume reuses its receipt and attempt slot within the retry deadline');

-- Move the first transitions outside the window while retaining later attempts/reviews inside it.
-- Usage remains tied to the first full-assessment transition rather than counting later activity
-- as a new submission or review.
update public.form_coach_assessments assessment set sent_at=now()-interval '31 days'
where assessment.id=current_setting('test.manual_assessment')::uuid;
update public.form_coach_attempts attempt set finished_at=now()-interval '31 days'
where attempt.id=(current_setting('test.retry_attempt_one')::jsonb->>'attempt_id')::uuid;
update public.form_coach_reviews review set created_at=now()-interval '31 days'
where review.request_id='f4900000-0000-0000-0000-000000000010';
select ok((select attempt.finished_at>now()-interval '30 days' from public.form_coach_attempts attempt
  where attempt.id=(current_setting('test.retry_attempt_two')::jsonb->>'attempt_id')::uuid),
  'a later retry attempt is still inside the rolling window');
select ok((select review.created_at>now()-interval '30 days' from public.form_coach_reviews review
  where review.request_id='f4900000-0000-0000-0000-000000000011'),
  'a later review is still inside the rolling window');

-- Count-only admin projection labels distinct assessments, not repeated attempts or review events.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000006","role":"authenticated"}';
select is((public.admin_get_form_coach_usage()->>'window_days')::integer,30,'usage metrics have an explicit rolling 30-day window');
select is((public.admin_get_form_coach_usage()->>'assessments_sent')::integer,3,
  'sent usage excludes an assessment first sent outside the rolling window');
select is((public.admin_get_form_coach_usage()->>'assessments_submitted')::integer,1,
  'submission usage uses the first full completion transition, not a later retry attempt');
select is((public.admin_get_form_coach_usage()->>'assessments_reviewed')::integer,1,
  'review usage uses the first fully reviewed transition, not a later review');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$select public.admin_get_form_coach_usage()$$,'42501',null,
  'non-admin users cannot read aggregate pricing usage');
reset role;

-- Platform-owned Program Form Checks stay fail-closed until their payer and funding policy exists.
insert into public.programs(id,coach_id,title,description,published,platform_owned)
values('f4400000-0000-0000-0000-000000000002','f4000000-0000-0000-0000-000000000006','Synthetic Platform Program','',true,true);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000006","role":"authenticated"}';
select throws_ok(
  $$select * from public.save_form_coach_program_rule('f4400000-0000-0000-0000-000000000002',
    jsonb_build_array(jsonb_build_object('template_version_id',current_setting('test.template_one'))),0,true,true,7::smallint,false,false)$$,
  '55000',null,'admin role does not implicitly become a coach payer for platform Programs');
reset role;

-- Storage authorization allows an opted-in finished attempt while the exact upload intent remains
-- reserved, then uses the callback's validated observation when the intent becomes verified.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000004","role":"authenticated"}';
select ok(public.record_form_coach_member_consent(1) is not null,
  'second synthetic member accepts the clip terms');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('test.clip_assessment',(
  public.send_form_coach_assessment('f4000000-0000-0000-0000-000000000004',
    jsonb_build_array(
      jsonb_build_object('template_version_id',current_setting('test.template_one'),'required_reps',1,'pass_threshold',75,'cues_enabled',false,'max_attempts',3),
      jsonb_build_object('template_version_id',current_setting('test.template_two'),'required_reps',1,'pass_threshold',75,'cues_enabled',false,'max_attempts',3)
    ),7::smallint,true,'f4600000-0000-0000-0000-000000000003','f4700000-0000-0000-0000-000000000003')->>'assessment_id'
),true);
reset role;
select set_config('test.clip_item_one',(
  select item.id::text from public.form_coach_assessment_items item
  where item.assessment_id=current_setting('test.clip_assessment')::uuid order by item.item_ordinal limit 1
),true);
select set_config('test.clip_item_two',(
  select item.id::text from public.form_coach_assessment_items item
  where item.assessment_id=current_setting('test.clip_assessment')::uuid order by item.item_ordinal desc limit 1
),true);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000004","role":"authenticated"}';
select set_config('test.clip_attempt_one',public.start_form_coach_attempt(current_setting('test.clip_assessment')::uuid,
  current_setting('test.clip_item_one')::uuid,'f4800000-0000-0000-0000-000000000020',true)::text,true);
select set_config('test.clip_attempt_two',public.start_form_coach_attempt(current_setting('test.clip_assessment')::uuid,
  current_setting('test.clip_item_two')::uuid,'f4800000-0000-0000-0000-000000000021',true)::text,true);
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select set_config('test.clip_upload_one',(public.service_reserve_form_coach_media_upload(
  'f4200000-0000-0000-0000-000000000010','member_clip','f4000000-0000-0000-0000-000000000004',null,
  (current_setting('test.clip_attempt_one')::jsonb->>'attempt_id')::uuid,null,'form-coach-clips',
  'f4000000-0000-0000-0000-000000000004/'||current_setting('test.clip_assessment')||'/'||
    (current_setting('test.clip_attempt_one')::jsonb->>'attempt_id')||'/f4300000-0000-0000-0000-000000000010.mp4',
  repeat('8',64),100,30)->>'upload_intent_id'),true);
select set_config('test.clip_upload_two',(public.service_reserve_form_coach_media_upload(
  'f4200000-0000-0000-0000-000000000011','member_clip','f4000000-0000-0000-0000-000000000004',null,
  (current_setting('test.clip_attempt_two')::jsonb->>'attempt_id')::uuid,null,'form-coach-clips',
  'f4000000-0000-0000-0000-000000000004/'||current_setting('test.clip_assessment')||'/'||
    (current_setting('test.clip_attempt_two')::jsonb->>'attempt_id')||'/f4300000-0000-0000-0000-000000000011.mp4',
  repeat('9',64),100,30)->>'upload_intent_id'),true);
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((public.finish_form_coach_attempt((current_setting('test.clip_attempt_one')::jsonb->>'attempt_id')::uuid,
  (current_setting('test.clip_attempt_one')::jsonb->>'lease_token')::uuid,current_setting('test.rep_one')::jsonb)->>'outcome'),
  'finished','opted-in attempt one finishes before its Storage INSERT');
select is((public.finish_form_coach_attempt((current_setting('test.clip_attempt_two')::jsonb->>'attempt_id')::uuid,
  (current_setting('test.clip_attempt_two')::jsonb->>'lease_token')::uuid,current_setting('test.rep_one')::jsonb)->>'outcome'),
  'finished','opted-in attempt two finishes before its Storage INSERT');
insert into storage.objects(bucket_id,name,owner,metadata) values
  ('form-coach-clips',
    'f4000000-0000-0000-0000-000000000004/'||current_setting('test.clip_assessment')||'/'||
      (current_setting('test.clip_attempt_one')::jsonb->>'attempt_id')||'/f4300000-0000-0000-0000-000000000010.mp4',
    'f4000000-0000-0000-0000-000000000004',jsonb_build_object('mimetype','video/mp4','size',100)),
  ('form-coach-clips',
    'f4000000-0000-0000-0000-000000000004/'||current_setting('test.clip_assessment')||'/'||
      (current_setting('test.clip_attempt_two')::jsonb->>'attempt_id')||'/f4300000-0000-0000-0000-000000000011.mp4',
    'f4000000-0000-0000-0000-000000000004',jsonb_build_object('mimetype','video/mp4','size',100));
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select is((public.service_record_form_coach_media_upload_outcome('f4200000-0000-0000-0000-000000000010',
  'uploaded',repeat('8',64),100,31.25,null)->>'outcome'),'uploaded_unverified',
  'first finished clip persists its verified upload observation');
select is((public.service_record_form_coach_media_upload_outcome('f4200000-0000-0000-0000-000000000010',
  'verified',repeat('8',64),100,31.25,repeat('a',64))->>'outcome'),'verified',
  'uploaded-to-verified transition stores the new observed duration');
select is((public.service_record_form_coach_media_upload_outcome('f4200000-0000-0000-0000-000000000011',
  'verified',repeat('9',64),100,27.5,repeat('b',64))->>'outcome'),'verified',
  'direct reserved-to-verified transition stores the new observed duration');
reset role;
select ok((select count(*)=2
  and count(*) filter (where attempt_id=(current_setting('test.clip_attempt_one')::jsonb->>'attempt_id')::uuid
    and duration_seconds=31.25)=1
  and count(*) filter (where attempt_id=(current_setting('test.clip_attempt_two')::jsonb->>'attempt_id')::uuid
    and duration_seconds=27.5)=1
  from public.form_coach_attempt_clips clip where clip.member_subject_id='f4000000-0000-0000-0000-000000000004'),
  'each verified clip row uses its callback-observed duration');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000004","role":"authenticated"}';
select ok(not private.form_coach_storage_insert_allowed('form-coach-clips',
  'f4000000-0000-0000-0000-000000000004/'||current_setting('test.clip_assessment')||'/'||
    (current_setting('test.clip_attempt_one')::jsonb->>'attempt_id')||'/f4300000-0000-0000-0000-000000000010.mp4',
  jsonb_build_object('mimetype','video/mp4','size',100)),
  'a verified and closed upload intent cannot be reused for another Storage INSERT');
select throws_ok($$insert into storage.objects(bucket_id,name,owner,metadata) values(
  'form-coach-clips',
  'f4000000-0000-0000-0000-000000000004/'||current_setting('test.clip_assessment')||'/'||
    (current_setting('test.clip_attempt_one')::jsonb->>'attempt_id')||'/f4300000-0000-0000-0000-000000000010.mp4',
  'f4000000-0000-0000-0000-000000000004',jsonb_build_object('mimetype','video/mp4','size',100))$$,
  '42501',null,'a verified closed intent is rejected by the actual Storage INSERT policy');

select set_config('test.clip_abandoned',public.start_form_coach_attempt(
  current_setting('test.clip_assessment')::uuid,current_setting('test.clip_item_one')::uuid,
  'f4800000-0000-0000-0000-000000000022',true)::text,true);
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select set_config('test.clip_abandoned_upload',(public.service_reserve_form_coach_media_upload(
  'f4200000-0000-0000-0000-000000000012','member_clip','f4000000-0000-0000-0000-000000000004',null,
  (current_setting('test.clip_abandoned')::jsonb->>'attempt_id')::uuid,null,'form-coach-clips',
  'f4000000-0000-0000-0000-000000000004/'||current_setting('test.clip_assessment')||'/'||
    (current_setting('test.clip_abandoned')::jsonb->>'attempt_id')||'/f4300000-0000-0000-0000-000000000012.mp4',
  repeat('c',64),100,30)->>'upload_intent_id'),true);
reset role;
update public.form_coach_attempts attempt set state='abandoned',abandoned_at=coalesce(attempt.abandoned_at,now())
where attempt.id=(current_setting('test.clip_abandoned')::jsonb->>'attempt_id')::uuid;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok($$insert into storage.objects(bucket_id,name,owner,metadata) values(
  'form-coach-clips',
  'f4000000-0000-0000-0000-000000000004/'||current_setting('test.clip_assessment')||'/'||
    (current_setting('test.clip_abandoned')::jsonb->>'attempt_id')||'/f4300000-0000-0000-0000-000000000012.mp4',
  'f4000000-0000-0000-0000-000000000004',jsonb_build_object('mimetype','video/mp4','size',100))$$,
  '42501',null,'an abandoned attempt cannot insert a previously reserved private clip');

select set_config('test.clip_withdrawn',public.start_form_coach_attempt(
  current_setting('test.clip_assessment')::uuid,current_setting('test.clip_item_two')::uuid,
  'f4800000-0000-0000-0000-000000000023',true)::text,true);
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select set_config('test.clip_withdrawn_upload',(public.service_reserve_form_coach_media_upload(
  'f4200000-0000-0000-0000-000000000013','member_clip','f4000000-0000-0000-0000-000000000004',null,
  (current_setting('test.clip_withdrawn')::jsonb->>'attempt_id')::uuid,null,'form-coach-clips',
  'f4000000-0000-0000-0000-000000000004/'||current_setting('test.clip_assessment')||'/'||
    (current_setting('test.clip_withdrawn')::jsonb->>'attempt_id')||'/f4300000-0000-0000-0000-000000000013.mp4',
  repeat('d',64),100,30)->>'upload_intent_id'),true);
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((public.finish_form_coach_attempt((current_setting('test.clip_withdrawn')::jsonb->>'attempt_id')::uuid,
  (current_setting('test.clip_withdrawn')::jsonb->>'lease_token')::uuid,current_setting('test.rep_one')::jsonb)->>'outcome'),
  'finished','the consent-withdrawal fixture is a finished opted-in attempt');
reset role;
delete from public.form_coach_member_consents consent
where consent.member_subject_id='f4000000-0000-0000-0000-000000000004' and consent.terms_version=1;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok($$insert into storage.objects(bucket_id,name,owner,metadata) values(
  'form-coach-clips',
  'f4000000-0000-0000-0000-000000000004/'||current_setting('test.clip_assessment')||'/'||
    (current_setting('test.clip_withdrawn')::jsonb->>'attempt_id')||'/f4300000-0000-0000-0000-000000000013.mp4',
  'f4000000-0000-0000-0000-000000000004',jsonb_build_object('mimetype','video/mp4','size',100))$$,
  '42501',null,'withdrawing consent blocks the actual Storage INSERT after attempt completion');
reset role;

-- A reserved private upload remains unresolved throughout account cleanup. A late success callback
-- is queued for deletion; only terminal cleanup evidence allows a ready component proof. Any new
-- upload attempt and Storage metadata INSERT remain blocked after the ready proof.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('test.cleanup_template',public.save_form_coach_template_draft(null,'Cleanup Draft',current_setting('test.form_coach_payload')::jsonb)::text,true);
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select set_config('test.cleanup_upload',(public.service_reserve_form_coach_media_upload(
  'f4200000-0000-0000-0000-000000000003','template_reference','f4000000-0000-0000-0000-000000000002',
  current_setting('test.cleanup_template')::uuid,null,'reference','form-coach-reference',
  'f4000000-0000-0000-0000-000000000002/f4200000-0000-0000-0000-000000000003/f4300000-0000-0000-0000-000000000003.mp4',
  repeat('f',64),100,null)->>'upload_intent_id'),true);
select set_config('test.cleanup_begin',public.begin_stream_account_media_cleanup(
  'f4900000-0000-0000-0000-000000000101','f4000000-0000-0000-0000-000000000002',
  'f4900000-0000-0000-0000-000000000102',repeat('1',64),
  'f4900000-0000-0000-0000-000000000103',repeat('2',64))::text,true);
reset role;
select ok((current_setting('test.cleanup_begin')::jsonb ? 'outcome') and exists(
  select 1 from public.stream_media_account_tombstones tombstone
  where tombstone.id='f4900000-0000-0000-0000-000000000101'
    and tombstone.account_id='f4000000-0000-0000-0000-000000000002'
    and tombstone.tombstone_state in ('closing','provider_cleanup')
), 'the synthetic deletion fence is established before proof evaluation');
select set_config('test.cleanup_revision',(select revision::text from public.stream_media_account_tombstones
  where id='f4900000-0000-0000-0000-000000000101'),true);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$insert into storage.objects(bucket_id,name,owner,metadata) values(
  'form-coach-reference',
  'f4000000-0000-0000-0000-000000000002/f4200000-0000-0000-0000-000000000003/f4300000-0000-0000-0000-000000000003.mp4',
  'f4000000-0000-0000-0000-000000000002',jsonb_build_object('size',100,'mimetype','video/mp4'))$$,
  '42501',null,'a closing tombstone blocks the actual Storage INSERT while its exact intent is still reserved');
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select is((public.service_record_form_coach_auth_cleanup_proof('f4900000-0000-0000-0000-000000000101',
  current_setting('test.cleanup_revision')::bigint,'f4900000-0000-0000-0000-000000000104')->>'ready')::boolean,false,
  'an unresolved upload reservation prevents auth deletion readiness');
select is((public.service_record_form_coach_media_upload_outcome('f4200000-0000-0000-0000-000000000003',
  'uploaded',repeat('f',64),100,null,null)->>'outcome'),'cleanup_required',
  'a late uploaded-object observation after closing is fenced into cleanup');
select set_config('test.cleanup_claim',(select jsonb_build_object('cleanup_id',cleanup_id,'claim_token',claim_token)::text
  from public.service_claim_form_coach_media_cleanup(10::smallint,120::smallint)
  where asset_id=current_setting('test.cleanup_upload')::uuid),true);
select is((public.service_finish_form_coach_media_cleanup(
  (current_setting('test.cleanup_claim')::jsonb->>'cleanup_id')::uuid,
  (current_setting('test.cleanup_claim')::jsonb->>'claim_token')::uuid,'deleted',repeat('3',64))->>'outcome'),
  'deleted','cleanup closes the immutable upload reservation using synthetic evidence only');
select is((public.service_record_form_coach_auth_cleanup_proof('f4900000-0000-0000-0000-000000000101',
  current_setting('test.cleanup_revision')::bigint,'f4900000-0000-0000-0000-000000000105')->>'ready')::boolean,true,
  'complete terminal cleanup allows the required component to publish ready');
select is((public.service_record_form_coach_media_upload_outcome('f4200000-0000-0000-0000-000000000003',
  'uploaded',repeat('f',64),100,null,null)->>'outcome'),'cleanup_active',
  'a delayed provider callback cannot resurrect an object after the ready proof');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4000000-0000-0000-0000-000000000002","role":"authenticated"}';
select ok(not private.form_coach_storage_insert_allowed('form-coach-reference',
  'f4000000-0000-0000-0000-000000000002/f4200000-0000-0000-0000-000000000003/f4300000-0000-0000-0000-000000000003.mp4',
  jsonb_build_object('size',100,'mimetype','video/mp4')),
  'old Storage metadata cannot be inserted after a ready deletion proof');
select throws_ok($$insert into storage.objects(bucket_id,name,owner,metadata) values(
  'form-coach-reference',
  'f4000000-0000-0000-0000-000000000002/f4200000-0000-0000-0000-000000000003/f4300000-0000-0000-0000-000000000003.mp4',
  'f4000000-0000-0000-0000-000000000002',jsonb_build_object('size',100,'mimetype','video/mp4'))$$,
  '42501',null,'the tombstoned account is rejected by the actual Storage INSERT policy after readiness');
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select is(public.service_reserve_form_coach_media_upload(
  'f4200000-0000-0000-0000-000000000004','template_reference','f4000000-0000-0000-0000-000000000002',
  current_setting('test.cleanup_template')::uuid,null,'reference','form-coach-reference',
  'f4000000-0000-0000-0000-000000000002/f4200000-0000-0000-0000-000000000004/f4300000-0000-0000-0000-000000000004.mp4',
  repeat('9',64),100,null)->>'outcome','account_deleting',
  'a late service reservation cannot appear after the component published ready');
reset role;

select * from finish();
rollback;
