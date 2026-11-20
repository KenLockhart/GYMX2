begin;
select no_plan();

-- Synthetic Auth actors are created only for rollback-scoped TAP RPC authorization checks.
insert into auth.users (id,email,raw_user_meta_data) values
  ('f5100000-0000-0000-0000-000000000001','app-coach-one@example.test','{"display_name":"App Coach One"}'),
  ('f5100000-0000-0000-0000-000000000002','app-coach-two@example.test','{"display_name":"App Coach Two"}'),
  ('f5100000-0000-0000-0000-000000000003','app-member-one@example.test','{"display_name":"App Member One"}'),
  ('f5100000-0000-0000-0000-000000000004','app-member-two@example.test','{"display_name":"App Member Two"}'),
  ('f5100000-0000-0000-0000-000000000005','app-admin@example.test','{"display_name":"App Admin"}');
update public.profiles set role='coach' where id in (
  'f5100000-0000-0000-0000-000000000001','f5100000-0000-0000-0000-000000000002');
update public.profiles set role='admin' where id='f5100000-0000-0000-0000-000000000005';
insert into public.coach_members(coach_id,member_id) values
  ('f5100000-0000-0000-0000-000000000001','f5100000-0000-0000-0000-000000000003'),
  ('f5100000-0000-0000-0000-000000000002','f5100000-0000-0000-0000-000000000004');
insert into public.platform_test_entitlements(member_id,tier,grant_reason,granted_by) values
  ('f5100000-0000-0000-0000-000000000003','regular','Synthetic app-contract fixture','f5100000-0000-0000-0000-000000000005'),
  ('f5100000-0000-0000-0000-000000000004','regular','Synthetic app-contract fixture','f5100000-0000-0000-0000-000000000005');

select ok(has_function_privilege('authenticated','public.list_coach_form_coach_assessments(integer,integer,text)','execute')
  and not has_function_privilege('anon','public.list_coach_form_coach_assessments(integer,integer,text)','execute')
  and not has_function_privilege('service_role','public.list_coach_form_coach_assessments(integer,integer,text)','execute'),
  'only authenticated callers can invoke the coach queue projection');
select ok(has_function_privilege('authenticated','public.get_form_coach_workflow_detail(uuid)','execute')
  and not has_function_privilege('anon','public.get_form_coach_workflow_detail(uuid)','execute')
  and not has_function_privilege('service_role','public.get_form_coach_workflow_detail(uuid)','execute'),
  'only authenticated callers can invoke the workflow detail projection');
select ok(has_function_privilege('service_role','public.service_read_form_coach_reference_asset(uuid,uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.service_read_form_coach_reference_asset(uuid,uuid,uuid)','execute')
  and not has_function_privilege('anon','public.service_read_form_coach_reference_asset(uuid,uuid,uuid)','execute'),
  'only the service role can resolve a reference path for signing');
select ok(not exists (
  select 1 from (values
    ('public.form_coach_assessments'::text),
    ('public.form_coach_assessment_items'),
    ('public.form_coach_template_versions'),
    ('public.form_coach_template_asset_claims')
  ) relation_names(relation_name)
  cross join (values ('anon'::name),('authenticated'::name),('service_role'::name)) role_names(role_name)
  where has_table_privilege(role_names.role_name,relation_names.relation_name,'select')
     or has_table_privilege(role_names.role_name,relation_names.relation_name,'insert')
     or has_table_privilege(role_names.role_name,relation_names.relation_name,'update')
     or has_table_privilege(role_names.role_name,relation_names.relation_name,'delete')
), 'the app contracts add no raw workflow table privileges');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000005","role":"authenticated"}';
select is(public.admin_create_feature_pricing_revision('form_coach',1,'pricing_pending','member',null,'USD',
  'Synthetic Form Coach','TAP fixture only','',0,0,'[]'::jsonb),2::bigint,
  'synthetic admin configures the existing pending member-payer revision');
select is(public.admin_publish_form_coach_terms(1,'/legal/form-coach/terms/1',repeat('a',64)),1,
  'synthetic admin publishes a terms version for role-bound consent checks');
reset role;

-- These comp and asset facts exist only inside this rollback test. The source-proof digest is
-- explicitly synthetic; the suite performs no Storage HTTP call and proves no real media bytes.
insert into public.feature_access_grants(feature_key,user_id,grant_kind,reason,granted_by,request_id)
values('form_coach','f5100000-0000-0000-0000-000000000003','comp',
  'Synthetic app-contract funding fixture','f5100000-0000-0000-0000-000000000005',
  'f5200000-0000-0000-0000-000000000001');

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

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('test.template_version_one',public.save_form_coach_template_draft(
  null,'Synthetic Pinned Curl',current_setting('test.form_coach_payload')::jsonb)::text,true);
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select is(public.service_reserve_form_coach_media_upload(
  'f5300000-0000-0000-0000-000000000001','template_reference','f5100000-0000-0000-0000-000000000001',
  current_setting('test.template_version_one')::uuid,null,'reference','form-coach-reference',
  'f5100000-0000-0000-0000-000000000001/'||current_setting('test.template_version_one')||
    '/f5400000-0000-0000-0000-000000000001.mp4',repeat('b',64),100,null)->>'outcome','reserved',
  'synthetic source-proof fixture reserves the original reference request');
select is(public.service_record_form_coach_media_upload_outcome(
  'f5300000-0000-0000-0000-000000000001'::uuid,
  'verified',repeat('b',64),100,null,repeat('c',64))->>'outcome','verified',
  'upload outcome lookup uses the original reserve request UUID, not the upload-intent ID');
reset role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000001","role":"authenticated"}';
select ok(public.publish_form_coach_template_version(current_setting('test.template_version_one')::uuid,true),
  'coach publishes the first private-verified version');
reset role;
select set_config('test.template_id',(
  select template_id::text from public.form_coach_template_versions
  where id=current_setting('test.template_version_one')::uuid
),true);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('test.template_version_two',public.save_form_coach_template_draft(
  current_setting('test.template_id')::uuid,'Synthetic Pinned Curl',current_setting('test.form_coach_payload')::jsonb)::text,true);
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select is(public.service_reserve_form_coach_media_upload(
  'f5300000-0000-0000-0000-000000000002','template_reference','f5100000-0000-0000-0000-000000000001',
  current_setting('test.template_version_two')::uuid,null,'reference','form-coach-reference',
  'f5100000-0000-0000-0000-000000000001/'||current_setting('test.template_version_two')||
    '/f5400000-0000-0000-0000-000000000002.mp4',repeat('d',64),120,null)->>'outcome','reserved',
  'the later version gets an independent original upload request');
select is(public.service_record_form_coach_media_upload_outcome(
  'f5300000-0000-0000-0000-000000000002'::uuid,
  'verified',repeat('d',64),120,null,repeat('e',64))->>'outcome','verified',
  'the original second reserve request is passed to outcome recording');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000001","role":"authenticated"}';
select ok(public.publish_form_coach_template_version(current_setting('test.template_version_two')::uuid,true),
  'coach publishes a second version after the first version is pinned for testing');
select set_config('test.active_assessment',(
  public.send_form_coach_assessment('f5100000-0000-0000-0000-000000000003',
    jsonb_build_array(jsonb_build_object('template_version_id',current_setting('test.template_version_one'),
      'required_reps',2,'pass_threshold',75,'cues_enabled',false,'max_attempts',2)),
    7::smallint,true,'f5500000-0000-0000-0000-000000000001','f5600000-0000-0000-0000-000000000001')->>'assessment_id'
),true);
reset role;
select set_config('test.active_item',(
  select item.id::text from public.form_coach_assessment_items item
  where item.assessment_id=current_setting('test.active_assessment')::uuid
),true);
select set_config('test.active_due_at',(
  select due_at::text from public.form_coach_assessments
  where id=current_setting('test.active_assessment')::uuid
),true);

-- A published test version with no asset claim verifies that the service resolver fails closed.
insert into public.form_coach_template_versions(
  template_id,revision,exercise_key,schema_version,template_payload,payload_sha256,state,
  created_by,published_by,published_at
) values(
  current_setting('test.template_id')::uuid,3,'dumbbell_curl',1,
  current_setting('test.form_coach_payload')::jsonb,repeat('f',64),'published',
  'f5100000-0000-0000-0000-000000000001','f5100000-0000-0000-0000-000000000001',now()
);
select set_config('test.template_version_without_asset',(
  select id::text from public.form_coach_template_versions
  where template_id=current_setting('test.template_id')::uuid and revision=3
),true);
insert into public.form_coach_assessment_items(
  assessment_id,item_ordinal,item_key,item_title_snapshot,template_version_id,exercise_key,
  required_reps,pass_threshold,cues_enabled,max_attempts
) values(
  current_setting('test.active_assessment')::uuid,2,'unverified_reference','No claim fixture',
  current_setting('test.template_version_without_asset')::uuid,'dumbbell_curl',1,75,false,1
);
select set_config('test.unverified_item',(
  select id::text from public.form_coach_assessment_items
  where assessment_id=current_setting('test.active_assessment')::uuid and item_key='unverified_reference'
),true);

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(public.get_form_coach_workflow_detail(current_setting('test.active_assessment')::uuid)->>'can_attempt',
  'false','current member consent is required before the detail projection advertises an attempt');
select is(public.get_form_coach_workflow_detail(current_setting('test.active_assessment')::uuid)->>'allow_member_clip',
  'true','member detail returns the assessment clip permission from its immutable snapshot');
select is(public.get_form_coach_workflow_detail('f5600000-0000-0000-0000-000000000099'),null::jsonb,
  'a member cannot inspect a foreign assessment identifier');
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select is(public.service_read_form_coach_reference_asset(
  'f5100000-0000-0000-0000-000000000003',current_setting('test.active_assessment')::uuid,
  current_setting('test.active_item')::uuid)->>'authorized_role','member',
  'read-only member reference viewing does not require camera-practice terms consent');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000003","role":"authenticated"}';
select ok(public.record_form_coach_member_consent(1) is not null,
  'member records current terms consent before attempt eligibility');
select is(public.get_form_coach_workflow_detail(current_setting('test.active_assessment')::uuid)->>'can_attempt',
  'true','consented eligible member receives truthful item-level attempt availability');
select is(public.get_form_coach_workflow_detail(current_setting('test.active_assessment')::uuid)
  ->'items'->0->>'can_start_new','true','an unused eligible item advertises a fresh assessment slot');
select is(public.get_form_coach_workflow_detail(current_setting('test.active_assessment')::uuid)->'member_id',
  null::jsonb,'member detail does not add another member identity field');
reset role;

-- The member exhausted the two item slots while a running lease still exists. Reference viewing is
-- read-only/local-practice access and remains available despite both conditions.
insert into public.form_coach_attempts(
  id,assessment_id,item_id,member_subject_id,attempt_number,state,lease_token,lease_expires_at,
  consent_terms_version,started_at,finished_at,result_digest
) values
  ('f5700000-0000-0000-0000-000000000002',current_setting('test.active_assessment')::uuid,
    current_setting('test.active_item')::uuid,'f5100000-0000-0000-0000-000000000003',1,'running',
    'f5800000-0000-0000-0000-000000000002',now()+interval '1 minute',1,now()-interval '1 minute',null,null),
  ('f5700000-0000-0000-0000-000000000004',current_setting('test.active_assessment')::uuid,
    current_setting('test.active_item')::uuid,'f5100000-0000-0000-0000-000000000003',2,'finished',
    'f5800000-0000-0000-0000-000000000004',now()-interval '1 day',1,now()-interval '1 day',
    now()-interval '1 day',repeat('4',64));
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(public.get_form_coach_workflow_detail(current_setting('test.active_assessment')::uuid)
  ->'items'->0->>'can_start_new','false','an active lease never advertises a fresh slot for its exact item');
select is(public.get_form_coach_workflow_detail(current_setting('test.active_assessment')::uuid)
  ->'items'->0->>'can_resume','false','an unexpired lease is not advertised as resumable');
select is(public.get_form_coach_workflow_detail(current_setting('test.active_assessment')::uuid)
  ->'items'->0->'resume_clip_opt_in','null'::jsonb,'a non-resumable item has no carried consent choice');
select is(public.get_form_coach_workflow_detail(current_setting('test.active_assessment')::uuid)
  ->'items'->1->>'can_start_new','true','an active lease on one item does not block a separate item');
reset role;

set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select is(public.service_read_form_coach_reference_asset(
  'f5100000-0000-0000-0000-000000000003',current_setting('test.active_assessment')::uuid,
  current_setting('test.active_item')::uuid)->>'authorized_role','member',
  'service signer lookup recognizes the current member through current role and base access');
select ok(public.service_read_form_coach_reference_asset(
  'f5100000-0000-0000-0000-000000000003',current_setting('test.active_assessment')::uuid,
  current_setting('test.active_item')::uuid) is not null,
  'active assessed leases do not block the independent reference-reading resource');
select is((public.service_read_form_coach_reference_asset(
  'f5100000-0000-0000-0000-000000000003',current_setting('test.active_assessment')::uuid,
  current_setting('test.active_item')::uuid)->>'authorized_until')::timestamptz,
  current_setting('test.active_due_at')::timestamptz,
  'member reference authorization expires at the current due deadline');
select is(public.service_read_form_coach_reference_asset(
  'f5100000-0000-0000-0000-000000000001',current_setting('test.active_assessment')::uuid,
  current_setting('test.active_item')::uuid)->>'template_version_id',
  current_setting('test.template_version_one'),
  'assigned coach reference reads follow the assessment pin rather than the newer published version');
select is(public.service_read_form_coach_reference_asset(
  'f5100000-0000-0000-0000-000000000001',current_setting('test.active_assessment')::uuid,
  current_setting('test.active_item')::uuid)->>'storage_path',
  'f5100000-0000-0000-0000-000000000001/'||current_setting('test.template_version_one')||
    '/f5400000-0000-0000-0000-000000000001.mp4',
  'the signing descriptor contains only the exact private reference path of the pinned version');
select is(public.service_read_form_coach_reference_asset(
  'f5100000-0000-0000-0000-000000000001',current_setting('test.active_assessment')::uuid,
  'f5600000-0000-0000-0000-000000000099'),null::jsonb,
  'unknown assessment items cannot resolve a path');
select is(public.service_read_form_coach_reference_asset(
  'f5100000-0000-0000-0000-000000000001',current_setting('test.active_assessment')::uuid,
  current_setting('test.unverified_item')::uuid),null::jsonb,
  'a published version without a verified private reference claim cannot be signed');
select is(public.service_read_form_coach_reference_asset(
  'f5100000-0000-0000-0000-000000000002',current_setting('test.active_assessment')::uuid,
  current_setting('test.active_item')::uuid),null::jsonb,
  'a different current coach cannot use a guessed assessment and item ID');
select is(public.service_read_form_coach_reference_asset(
  'f5100000-0000-0000-0000-000000000005',current_setting('test.active_assessment')::uuid,
  current_setting('test.active_item')::uuid),null::jsonb,
  'admin identity is not accepted by the app reference signer');
reset role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.get_form_coach_workflow_detail(current_setting('test.active_assessment')::uuid)->>'member_id',
  'f5100000-0000-0000-0000-000000000003','assigned coach detail includes only its linked member ID');
select is(public.get_form_coach_workflow_detail(current_setting('test.active_assessment')::uuid)->>'can_attempt',
  'false','coach detail never advertises member attempt authority');
select is(public.get_form_coach_workflow_detail(current_setting('test.active_assessment')::uuid)
  ->'items'->0->>'can_resume','false','coach history never advertises a member lease resume');
select is(public.get_form_coach_workflow_detail(current_setting('test.active_assessment')::uuid)
  ->'items'->0->'resume_clip_opt_in','null'::jsonb,'coach detail does not disclose member resume consent state');
select is((public.list_coach_form_coach_assessments(1,1,null)->'rows'->0->>'assessment_id'),
  current_setting('test.active_assessment'),'coach queue uses stable first-page ordering and returns only owned assessments');
select is((public.list_coach_form_coach_assessments(1,1,null)->>'has_more')::boolean,false,
  'coach queue has no false next page for one active row');
select is((public.list_coach_form_coach_assessments(1,50,'sent')->'rows'->0->>'allow_member_clip'),
  'true','coach status filter accepts the exact existing status and clip snapshot');
reset role;

delete from public.coach_members
where coach_id='f5100000-0000-0000-0000-000000000001'
  and member_id='f5100000-0000-0000-0000-000000000003';
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.list_coach_form_coach_assessments(1,20,null)->'rows','[]'::jsonb,
  'removing the current coach-member link removes queue access');
select is(public.get_form_coach_workflow_detail(current_setting('test.active_assessment')::uuid),null::jsonb,
  'removing the current coach-member link removes coach detail access');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000003","role":"authenticated"}';
select ok(public.get_form_coach_workflow_detail(current_setting('test.active_assessment')::uuid) is not null,
  'member history remains readable after the assigned coach link is removed');
select is(public.get_form_coach_workflow_detail(current_setting('test.active_assessment')::uuid)->>'can_attempt','false',
  'member use capability closes immediately after the assigned coach link is removed');
reset role;
insert into public.coach_members(coach_id,member_id) values
  ('f5100000-0000-0000-0000-000000000001','f5100000-0000-0000-0000-000000000003');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.list_coach_form_coach_assessments(1,20,null)->'rows','[]'::jsonb,
  'another coach sees no assessments outside its own member link');
select is(public.get_form_coach_workflow_detail(current_setting('test.active_assessment')::uuid),null::jsonb,
  'another coach receives no assessment detail');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000005","role":"authenticated"}';
select is(public.list_coach_form_coach_assessments(1,20,null)->'rows','[]'::jsonb,
  'admin is not a coach queue or payer authority');
select is(public.get_form_coach_workflow_detail(current_setting('test.active_assessment')::uuid),null::jsonb,
  'admin does not receive the app-facing detail projection');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000009999","role":"authenticated"}';
select is(public.list_coach_form_coach_assessments(1,20,null)->'rows','[]'::jsonb,
  'a profileless authenticated subject fails closed in the coach queue');
select is(public.get_form_coach_workflow_detail(current_setting('test.active_assessment')::uuid),null::jsonb,
  'a profileless authenticated subject receives no assessment detail');
reset role;

-- The second assessment and matching comp receipt are explicit expired-history fixtures. They are
-- not produced by a provider, billing event, or attempt API and roll back with this test.
insert into public.form_coach_assessments(
  id,send_request_id,send_digest,source_kind,member_subject_id,member_owner_id,coach_subject_id,coach_owner_id,
  sent_by_subject_id,sent_by_owner_id,payer_role,payer_subject_id,payer_owner_id,config_revision,due_at,
  allow_member_clip,status,sent_at
) values(
  'f5600000-0000-0000-0000-000000000002','f5500000-0000-0000-0000-000000000002',repeat('1',64),'manual',
  'f5100000-0000-0000-0000-000000000003','f5100000-0000-0000-0000-000000000003',
  'f5100000-0000-0000-0000-000000000001','f5100000-0000-0000-0000-000000000001',
  'f5100000-0000-0000-0000-000000000001','f5100000-0000-0000-0000-000000000001',
  'member','f5100000-0000-0000-0000-000000000003','f5100000-0000-0000-0000-000000000003',2,
  now()-interval '1 day',true,'expired',now()-interval '8 days'
);
insert into public.form_coach_assessment_items(
  id,assessment_id,item_ordinal,item_key,item_title_snapshot,template_version_id,exercise_key,
  required_reps,pass_threshold,cues_enabled,max_attempts
) values(
  'f5600000-0000-0000-0000-000000000004','f5600000-0000-0000-0000-000000000002',
  1,'expired_item','Expired pinned Curl',
  current_setting('test.template_version_one')::uuid,'dumbbell_curl',2,75,false,1
);
insert into public.form_coach_assessment_items(
  id,assessment_id,item_ordinal,item_key,item_title_snapshot,template_version_id,exercise_key,
  required_reps,pass_threshold,cues_enabled,max_attempts
) values(
  'f5600000-0000-0000-0000-000000000005','f5600000-0000-0000-0000-000000000002',
  2,'expired_other_item','Other expired Curl',current_setting('test.template_version_one')::uuid,
  'dumbbell_curl',2,75,false,1
);
insert into public.feature_bundle_funding_receipts(
  bundle_id,feature_key,payer_role,payer_id,config_revision,funding_source,source_id,
  credit_units_consumed,due_at,operation_key
) values(
  'f5600000-0000-0000-0000-000000000002','form_coach','member',
  'f5100000-0000-0000-0000-000000000003',2,'comp','synthetic-expired-fixture',0,
  now()-interval '1 day','synthetic-expired-fixture-operation'
);
select set_config('test.expired_item',(
  select id::text from public.form_coach_assessment_items
  where id='f5600000-0000-0000-0000-000000000004'
),true);
select set_config('test.expired_other_item','f5600000-0000-0000-0000-000000000005',true);
insert into public.form_coach_attempts(
  id,assessment_id,item_id,member_subject_id,attempt_number,state,lease_token,lease_expires_at,
  consent_terms_version,started_at,finished_at,result_digest
) values(
  'f5700000-0000-0000-0000-000000000003','f5600000-0000-0000-0000-000000000002',
  current_setting('test.expired_item')::uuid,'f5100000-0000-0000-0000-000000000003',1,'running',
  'f5800000-0000-0000-0000-000000000003',now()-interval '1 minute',1,now()-interval '2 days',null,null
);

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((public.list_coach_form_coach_assessments(1,1,null)->'rows'->0->>'assessment_id'),
  current_setting('test.active_assessment'),'coach pages remain ordered by sent time descending');
select is((public.list_coach_form_coach_assessments(1,1,null)->>'has_more')::boolean,true,
  'bounded coach pagination reports the next page');
select is((public.list_coach_form_coach_assessments(2,1,null)->'rows'->0->>'assessment_id'),
  'f5600000-0000-0000-0000-000000000002','stable pagination advances to the older expired row');
select is((public.list_coach_form_coach_assessments(1,50,'expired')->'rows'->0->>'status'),
  'expired','coach filters accept the actual persisted expired status');
select throws_ok($$select public.list_coach_form_coach_assessments(1,0,null)$$,'22023',null,
  'coach queue rejects a zero page size');
select throws_ok($$select public.list_coach_form_coach_assessments(1,20,'pending')$$,'22023',null,
  'coach queue rejects status names outside the persisted workflow enum');
reset role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(public.get_form_coach_workflow_detail('f5600000-0000-0000-0000-000000000002')->>'status','expired',
  'member retains the read-only history projection for an expired assessment');
select is(public.get_form_coach_workflow_detail('f5600000-0000-0000-0000-000000000002')->>'can_attempt','false',
  'expired lease history is read-only without an exact current retry window');
select is(public.get_form_coach_workflow_detail('f5600000-0000-0000-0000-000000000002')
  ->'items'->0->>'can_resume','false','expired running attempt cannot resume past due without an exact retry');
select ok(not ((public.get_form_coach_workflow_detail('f5600000-0000-0000-0000-000000000002')
  ->'items'->0) ? 'resume_request_id')
  and not exists (
    select 1 from jsonb_array_elements(public.get_form_coach_workflow_detail(
      'f5600000-0000-0000-0000-000000000002')->'items'->0->'attempts') attempt
    where attempt ? 'lease_token'
  ),'member resume projection returns neither a request id nor lease token');
select is(public.get_form_coach_workflow_detail('f5600000-0000-0000-0000-000000000002')
  ->'items'->0->>'can_start_new','false','resuming does not advertise a new attempt slot');
select is(public.get_form_coach_workflow_detail('f5600000-0000-0000-0000-000000000002')
  ->'items'->1->>'can_resume','false','an expired item without its own running reservation cannot resume');
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select is(public.service_read_form_coach_reference_asset(
  'f5100000-0000-0000-0000-000000000003','f5600000-0000-0000-0000-000000000002',
  current_setting('test.expired_item')::uuid),null::jsonb,
  'member signing is denied after due expiry when no exact retry window is active');
select is(public.service_read_form_coach_reference_asset(
  'f5100000-0000-0000-0000-000000000003','f5600000-0000-0000-0000-000000000002',
  current_setting('test.expired_other_item')::uuid),null::jsonb,
  'expired assessment cannot use another item reservation as a retry');
select is(public.service_read_form_coach_reference_asset(
  'f5100000-0000-0000-0000-000000000001','f5600000-0000-0000-0000-000000000002',
  current_setting('test.expired_item')::uuid)->>'template_version_id',current_setting('test.template_version_one'),
  'current assigned coach can still read the pinned reference from expired history');
reset role;

-- A genuine Needs Work record and exact open retry window keep the authorized assessment usable past
-- its original deadline without changing the frozen receipt or due date.
insert into public.form_coach_attempts(
  id,assessment_id,item_id,member_subject_id,attempt_number,state,lease_token,lease_expires_at,
  consent_terms_version,started_at,finished_at,result_digest
) values(
  'f5700000-0000-0000-0000-000000000001','f5600000-0000-0000-0000-000000000002',
  current_setting('test.expired_item')::uuid,'f5100000-0000-0000-0000-000000000003',2,'finished',
  'f5800000-0000-0000-0000-000000000001',now(),1,now()-interval '2 days',now()-interval '2 days',repeat('2',64)
);
insert into public.form_coach_attempt_results(attempt_id,result_digest,rep_count,average_score,numeric_summary)
values('f5700000-0000-0000-0000-000000000001',repeat('2',64),1,70,
  '{"rep_count":1,"average_score":70,"minimum_score":70,"maximum_score":70,
    "rom_min_angle_average":45,"rom_max_angle_average":160,"rom_average":115,
    "elbow_average":70,"torso_average":70,"tempo_average":70,"shoulders_average":70,
    "max_upper_arm_drift":0,"max_torso_swing":0,"max_shrug":0,
    "concentric_ms_average":1000,"top_pause_ms_average":0,"eccentric_ms_average":1000,
    "curve_similarity_average":70,"elbow_drift_count":0,"torso_swing_count":0,
    "short_rom_count":0,"shoulder_shrug_count":0}'::jsonb);
insert into public.form_coach_reviews(
  id,request_id,assessment_id,item_id,attempt_id,coach_subject_id,coach_owner_id,verdict,feedback,request_digest,review_sequence
) values(
  'f5900000-0000-0000-0000-000000000001','f5500000-0000-0000-0000-000000000003',
  'f5600000-0000-0000-0000-000000000002',current_setting('test.expired_item')::uuid,
  'f5700000-0000-0000-0000-000000000001','f5100000-0000-0000-0000-000000000001',
  'f5100000-0000-0000-0000-000000000001','needs_work','Synthetic retry fixture',repeat('3',64),1
);
insert into public.form_coach_retry_windows(
  id,review_id,assessment_id,item_id,opened_by_subject_id,opened_by_owner_id,additional_attempts,opens_at,closes_at
) values(
  'f5a00000-0000-0000-0000-000000000001','f5900000-0000-0000-0000-000000000001',
  'f5600000-0000-0000-0000-000000000002',current_setting('test.expired_item')::uuid,
  'f5100000-0000-0000-0000-000000000001','f5100000-0000-0000-0000-000000000001',1,
  now()-interval '1 minute',now()+interval '1 hour'
);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(public.get_form_coach_workflow_detail('f5600000-0000-0000-0000-000000000002')->>'can_attempt','true',
  'the exact Needs Work retry preserves the expired running reservation capability');
select is(public.get_form_coach_workflow_detail('f5600000-0000-0000-0000-000000000002')
  ->'items'->0->>'can_resume','true','expired lease resumes even with allowance exhausted by existing rows');
select is(public.get_form_coach_workflow_detail('f5600000-0000-0000-0000-000000000002')
  ->'items'->0->'resume_clip_opt_in','false'::jsonb,'resume carries the exact member clip-consent choice');
select ok(not ((public.get_form_coach_workflow_detail('f5600000-0000-0000-0000-000000000002')
  ->'items'->0) ? 'resume_request_id')
  and not exists (
    select 1 from jsonb_array_elements(public.get_form_coach_workflow_detail(
      'f5600000-0000-0000-0000-000000000002')->'items'->0->'attempts') attempt
    where attempt ? 'lease_token'
  ),'resumable member projection returns neither a request ID nor lease token');
select is(public.get_form_coach_workflow_detail('f5600000-0000-0000-0000-000000000002')
  ->'items'->0->>'can_start_new','false','exhausted allowance does not create a fresh retry slot');
select is(public.get_form_coach_workflow_detail('f5600000-0000-0000-0000-000000000002')
  ->'items'->1->>'can_start_new','false','a retry window on one item does not open another expired item');
reset role;
select set_config('test.retry_closes_at',(
  select closes_at::text from public.form_coach_retry_windows where id='f5a00000-0000-0000-0000-000000000001'
),true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select is((public.service_read_form_coach_reference_asset(
  'f5100000-0000-0000-0000-000000000003','f5600000-0000-0000-0000-000000000002',
  current_setting('test.expired_item')::uuid)->>'authorized_until')::timestamptz,
  current_setting('test.retry_closes_at')::timestamptz,
  'member signing after due expiry is capped by the exact open retry-window close');
select is(public.service_read_form_coach_reference_asset(
  'f5100000-0000-0000-0000-000000000003','f5600000-0000-0000-0000-000000000002',
  current_setting('test.expired_other_item')::uuid),null::jsonb,
  'the exact Needs Work retry does not authorize a sibling expired item');
reset role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000001","role":"authenticated"}';
select ok(public.archive_form_coach_template(current_setting('test.template_id')::uuid),
  'coach archives the source template while existing assessment pins remain immutable');
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select is(public.service_read_form_coach_reference_asset(
  'f5100000-0000-0000-0000-000000000001',current_setting('test.active_assessment')::uuid,
  current_setting('test.active_item')::uuid)->>'template_version_id',
  current_setting('test.template_version_one'),
  'archiving the template does not replace or hide the assessment pinned reference');
reset role;

-- Disabled feature status blocks new reference use but does not hide existing owner history.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000005","role":"authenticated"}';
select is(public.admin_create_feature_pricing_revision('form_coach',2,'disabled','member',null,'USD',
  'Synthetic Form Coach','TAP fixture disabled state','',0,0,'[]'::jsonb),3::bigint,
  'synthetic admin disables the feature using its revision compare-and-swap');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000003","role":"authenticated"}';
select ok(public.get_form_coach_workflow_detail('f5600000-0000-0000-0000-000000000002') is not null,
  'member assessment history remains available after feature disablement');
select is(public.get_form_coach_workflow_detail('f5600000-0000-0000-0000-000000000002')->>'can_attempt','false',
  'disabled feature never advertises a new attempt');
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select is(public.service_read_form_coach_reference_asset(
  'f5100000-0000-0000-0000-000000000003','f5600000-0000-0000-0000-000000000002',
  current_setting('test.expired_item')::uuid),null::jsonb,
  'disabled feature blocks new member signing even inside an earlier retry window');
reset role;

-- Re-enable only inside this rollback test so each tombstone is observed against otherwise-live
-- member access. Fixture assessments cover both supported payer roles with their real current actors.
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000005","role":"authenticated"}';
select is(public.admin_create_feature_pricing_revision('form_coach',3,'live','member','subscription','USD',
  'Synthetic Form Coach','TAP fixture re-enabled state','',0,0,
  '[{"price_key":"member_monthly_tap","amount_cents":2500,"currency":"USD","interval":"month",
    "credits_per_pack":null,"stripe_product_id":"prod_form_coach_contracts_test_member",
    "stripe_price_id":"price_form_coach_contracts_test_member"}]'::jsonb),4::bigint,
  'synthetic admin re-enables the feature only inside the rollback transaction');
reset role;

insert into public.form_coach_assessments(
  id,send_request_id,send_digest,source_kind,member_subject_id,member_owner_id,coach_subject_id,coach_owner_id,
  sent_by_subject_id,sent_by_owner_id,payer_role,payer_subject_id,payer_owner_id,config_revision,due_at,
  allow_member_clip,status,sent_at
)
select 'f5600000-0000-0000-0000-000000000006','f5500000-0000-0000-0000-000000000004',repeat('6',64),
  source_kind,member_subject_id,member_owner_id,coach_subject_id,coach_owner_id,
  sent_by_subject_id,sent_by_owner_id,'coach',coach_subject_id,coach_owner_id,config_revision,due_at,
  allow_member_clip,'sent',now()
from public.form_coach_assessments where id=current_setting('test.active_assessment')::uuid;
insert into public.form_coach_assessment_items(
  id,assessment_id,item_ordinal,item_key,item_title_snapshot,template_version_id,exercise_key,
  required_reps,pass_threshold,cues_enabled,max_attempts
)
select 'f5600000-0000-0000-0000-000000000008','f5600000-0000-0000-0000-000000000006',1,
  'coach_payer_item',item_title_snapshot,template_version_id,exercise_key,
  required_reps,pass_threshold,cues_enabled,max_attempts
from public.form_coach_assessment_items where id=current_setting('test.active_item')::uuid;
insert into public.feature_bundle_funding_receipts(
  bundle_id,feature_key,payer_role,payer_id,config_revision,funding_source,source_id,
  credit_units_consumed,due_at,operation_key
)
select assessment.id,'form_coach','coach',assessment.coach_subject_id,assessment.config_revision,'comp',
  'synthetic-coach-payer-fence',0,assessment.due_at,'synthetic-coach-payer-fence-operation'
from public.form_coach_assessments assessment where assessment.id='f5600000-0000-0000-0000-000000000006';
insert into public.form_coach_assessments(
  id,send_request_id,send_digest,source_kind,member_subject_id,member_owner_id,coach_subject_id,coach_owner_id,
  sent_by_subject_id,sent_by_owner_id,payer_role,payer_subject_id,payer_owner_id,config_revision,due_at,
  allow_member_clip,status,sent_at
)
values(
  'f5600000-0000-0000-0000-000000000007','f5500000-0000-0000-0000-000000000005',repeat('7',64),'manual',
  'f5100000-0000-0000-0000-000000000004','f5100000-0000-0000-0000-000000000004',
  'f5100000-0000-0000-0000-000000000002','f5100000-0000-0000-0000-000000000002',
  'f5100000-0000-0000-0000-000000000002','f5100000-0000-0000-0000-000000000002',
  'member','f5100000-0000-0000-0000-000000000004','f5100000-0000-0000-0000-000000000004',2,
  now()+interval '7 days',false,'sent',now()
);
insert into public.form_coach_assessment_items(
  id,assessment_id,item_ordinal,item_key,item_title_snapshot,template_version_id,exercise_key,
  required_reps,pass_threshold,cues_enabled,max_attempts
)
values(
  'f5600000-0000-0000-0000-000000000009','f5600000-0000-0000-0000-000000000007',1,
  'member_payer_item','Member payer Curl',current_setting('test.template_version_one')::uuid,
  'dumbbell_curl',2,75,false,1
);
insert into public.feature_bundle_funding_receipts(
  bundle_id,feature_key,payer_role,payer_id,config_revision,funding_source,source_id,
  credit_units_consumed,due_at,operation_key
)
values(
  'f5600000-0000-0000-0000-000000000007','form_coach','member',
  'f5100000-0000-0000-0000-000000000004',2,'comp','synthetic-member-payer-fence',0,
  now()+interval '7 days','synthetic-member-payer-fence-operation'
);
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000004","role":"authenticated"}';
select ok(public.record_form_coach_member_consent(1) is not null,
  'the second synthetic member records current consent through its authenticated RPC');
select is(public.get_form_coach_workflow_detail('f5600000-0000-0000-0000-000000000007')->>'can_attempt','true',
  'member-payer fixture is eligible before its deletion fence');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(public.get_form_coach_workflow_detail('f5600000-0000-0000-0000-000000000006')->>'can_attempt','true',
  'coach-payer fixture is eligible before its deletion fence');
reset role;

-- A current retry keeps its own close as the member reference deadline even when the original
-- assignment due date is earlier. Existing attempts are already at allowance with a live lease.
insert into public.form_coach_reviews(
  id,request_id,assessment_id,item_id,attempt_id,coach_subject_id,coach_owner_id,verdict,feedback,request_digest,
  review_sequence,created_at
) values(
  'f5900000-0000-0000-0000-000000000004','f5500000-0000-0000-0000-000000000008',
  current_setting('test.active_assessment')::uuid,current_setting('test.active_item')::uuid,
  'f5700000-0000-0000-0000-000000000004','f5100000-0000-0000-0000-000000000001',
  'f5100000-0000-0000-0000-000000000001','needs_work','Retry extends the exact reference window',repeat('5',64),1,
  now()-interval '1 day'
);
insert into public.form_coach_retry_windows(
  id,review_id,assessment_id,item_id,opened_by_subject_id,opened_by_owner_id,additional_attempts,opens_at,closes_at
) values(
  'f5a00000-0000-0000-0000-000000000002','f5900000-0000-0000-0000-000000000004',
  current_setting('test.active_assessment')::uuid,current_setting('test.active_item')::uuid,
  'f5100000-0000-0000-0000-000000000001','f5100000-0000-0000-0000-000000000001',1,
  now()-interval '1 minute',now()+interval '14 days'
);
select set_config('test.future_retry_closes_at',(
  select closes_at::text from public.form_coach_retry_windows where id='f5a00000-0000-0000-0000-000000000002'
),true);
select ok((select retry_window.closes_at>assessment.due_at
  from public.form_coach_retry_windows retry_window
  join public.form_coach_assessments assessment on assessment.id=retry_window.assessment_id
  where retry_window.id='f5a00000-0000-0000-0000-000000000002'),
  'the synthetic retry window extends beyond the still-future original due date');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select is((public.service_read_form_coach_reference_asset(
  'f5100000-0000-0000-0000-000000000003',current_setting('test.active_assessment')::uuid,
  current_setting('test.active_item')::uuid)->>'authorized_until')::timestamptz,
  current_setting('test.future_retry_closes_at')::timestamptz,
  'member reference authorization uses the exact active retry close, not the earlier due date');
select is((public.service_read_form_coach_reference_asset(
  'f5100000-0000-0000-0000-000000000003',current_setting('test.active_assessment')::uuid,
  current_setting('test.active_item')::uuid)->>'authorized_ttl_seconds')::integer,600,
  'member reference time budget remains capped at the fixed 600-second maximum');
reset role;

insert into public.stream_media_account_tombstones(id,account_id,request_id,request_digest,tombstone_state)
values('f5900000-0000-0000-0000-000000000002','f5100000-0000-0000-0000-000000000001',
  'f5500000-0000-0000-0000-000000000006',repeat('8',64),'closing');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000003","role":"authenticated"}';
select ok(public.get_form_coach_workflow_detail('f5600000-0000-0000-0000-000000000006') is not null,
  'coach/payer deletion tombstone preserves assigned member history');
select is(public.get_form_coach_workflow_detail('f5600000-0000-0000-0000-000000000006')->>'can_attempt','false',
  'coach and coach-payer tombstones both fence new use for their own identities');
reset role;
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{}';
select is(public.service_read_form_coach_reference_asset(
  'f5100000-0000-0000-0000-000000000003','f5600000-0000-0000-0000-000000000006',
  'f5600000-0000-0000-0000-000000000008'),null::jsonb,
  'coach/payer deletion tombstone blocks the exact pinned reference read');
reset role;
insert into public.stream_media_account_tombstones(id,account_id,request_id,request_digest,tombstone_state)
values('f5900000-0000-0000-0000-000000000003','f5100000-0000-0000-0000-000000000004',
  'f5500000-0000-0000-0000-000000000007',repeat('9',64),'closing');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f5100000-0000-0000-0000-000000000004","role":"authenticated"}';
select ok(public.get_form_coach_workflow_detail('f5600000-0000-0000-0000-000000000007') is not null,
  'member/actor deletion tombstone preserves the authenticated owner''s history');
select is(public.get_form_coach_workflow_detail('f5600000-0000-0000-0000-000000000007')->>'can_attempt','false',
  'member STREAM tombstone fences member and member-payer new use');
reset role;

select * from finish();
rollback;
