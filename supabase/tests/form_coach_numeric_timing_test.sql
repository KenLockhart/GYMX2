begin;
select plan(17);

-- Synthetic Owner-seeded facts drive the real authenticated finish RPC. No provider object or
-- external service is created or contacted; every row is rolled back at the end of this TAP file.
insert into auth.users (id,email,raw_user_meta_data) values
  ('f4250000-0000-0000-0000-000000000001','numeric-coach@example.test','{"display_name":"Numeric Coach"}'),
  ('f4250000-0000-0000-0000-000000000002','numeric-member@example.test','{"display_name":"Numeric Member"}');
update public.profiles set role='coach' where id='f4250000-0000-0000-0000-000000000001';

insert into public.form_coach_terms_versions(version,document_path,document_sha256,created_by)
values(1,'/legal/form-coach/terms/1',repeat('a',64),'f4250000-0000-0000-0000-000000000001');
insert into public.form_coach_templates(id,owner_subject_id,owner_id,owner_kind,name)
values('f4250000-0000-0000-0000-000000000003','f4250000-0000-0000-0000-000000000001',
  'f4250000-0000-0000-0000-000000000001','coach','Synthetic numeric timing template');
insert into public.form_coach_template_versions(
  id,template_id,revision,exercise_key,schema_version,template_payload,payload_sha256,state,
  created_by,published_by,published_at
) values(
  'f4250000-0000-0000-0000-000000000004','f4250000-0000-0000-0000-000000000003',1,
  'dumbbell_curl',1,'{}'::jsonb,repeat('b',64),'published',
  'f4250000-0000-0000-0000-000000000001','f4250000-0000-0000-0000-000000000001',now()
);
insert into public.form_coach_assessments(
  id,send_request_id,send_digest,source_kind,member_subject_id,member_owner_id,coach_subject_id,
  coach_owner_id,sent_by_subject_id,sent_by_owner_id,payer_role,payer_subject_id,payer_owner_id,
  config_revision,due_at,allow_member_clip,status,sent_at
) values(
  'f4250000-0000-0000-0000-000000000005','f4250000-0000-0000-0000-000000000006',repeat('c',64),
  'manual','f4250000-0000-0000-0000-000000000002','f4250000-0000-0000-0000-000000000002',
  'f4250000-0000-0000-0000-000000000001','f4250000-0000-0000-0000-000000000001',
  'f4250000-0000-0000-0000-000000000001','f4250000-0000-0000-0000-000000000001',
  'member','f4250000-0000-0000-0000-000000000002','f4250000-0000-0000-0000-000000000002',
  1,now()+interval '5 minutes',false,'in_progress',now()
);
insert into public.form_coach_assessment_items(
  id,assessment_id,item_ordinal,item_key,item_title_snapshot,template_version_id,exercise_key,
  required_reps,pass_threshold,cues_enabled,max_attempts
) values(
  'f4250000-0000-0000-0000-000000000007','f4250000-0000-0000-0000-000000000005',1,
  'numeric_timing','Synthetic curl', 'f4250000-0000-0000-0000-000000000004',
  'dumbbell_curl',1,75,false,1
);
insert into public.form_coach_attempts(
  id,assessment_id,item_id,member_subject_id,attempt_number,state,lease_token,lease_expires_at,
  consent_terms_version,started_at
) values(
  'f4250000-0000-0000-0000-000000000008','f4250000-0000-0000-0000-000000000005',
  'f4250000-0000-0000-0000-000000000007','f4250000-0000-0000-0000-000000000002',
  1,'running','f4250000-0000-0000-0000-000000000009',now()+interval '5 minutes',1,now()
);

select set_config('test.fast_rep',jsonb_build_array(jsonb_build_object(
  'rep_number',1,'score',70,'rom_min_angle',45,'rom_max_angle',160,'rom_score',72,
  'max_upper_arm_drift',20,'max_torso_swing',4,'max_shrug',0.1,
  'concentric_ms',80,'top_pause_ms',0,'eccentric_ms',520,'curve_similarity',90,
  'elbow_score',50,'torso_score',90,'tempo_score',55,'shoulders_score',88,
  'faults',jsonb_build_array('eccentric_too_fast')
))::text,true);
select set_config('test.normal_rep',jsonb_set(jsonb_set(current_setting('test.fast_rep')::jsonb,
  '{0,concentric_ms}','900'::jsonb),'{0,eccentric_ms}','1200'::jsonb)::text,true);

select ok(not private.form_coach_attempt_payload_valid_v400(current_setting('test.fast_rep')::jsonb),
  'the preserved pre-425 validator demonstrates why a measured 80 ms phase was rejected');
select ok(private.form_coach_attempt_payload_valid(current_setting('test.fast_rep')::jsonb),
  'the current strict validator accepts an 80 ms phase when total rep duration is 600 ms');
select ok(private.form_coach_attempt_payload_valid(current_setting('test.normal_rep')::jsonb),
  'ordinary phase measurements remain valid');
select ok(not private.form_coach_attempt_payload_valid(jsonb_set(current_setting('test.fast_rep')::jsonb,
  '{0,concentric_ms}','0'::jsonb)), 'zero-length phases remain invalid');
select ok(not private.form_coach_attempt_payload_valid(jsonb_set(current_setting('test.fast_rep')::jsonb,
  '{0,eccentric_ms}','-1'::jsonb)), 'negative phases remain invalid');
select ok(not private.form_coach_attempt_payload_valid(jsonb_set(current_setting('test.fast_rep')::jsonb,
  '{0,concentric_ms}','1.5'::jsonb)), 'fractional phase durations remain invalid');
select ok(not private.form_coach_attempt_payload_valid(jsonb_set(current_setting('test.fast_rep')::jsonb,
  '{0,eccentric_ms}','519'::jsonb)), 'a total duration below 600 ms remains invalid');
select ok(not private.form_coach_attempt_payload_valid(jsonb_set(current_setting('test.fast_rep')::jsonb,
  '{0,eccentric_ms}','14921'::jsonb)), 'a total duration above 15000 ms remains invalid');
select ok(not private.form_coach_attempt_payload_valid(jsonb_set(current_setting('test.fast_rep')::jsonb,
  '{0,concentric_ms}','15001'::jsonb)), 'individual phase upper bounds remain unchanged');
select ok(not private.form_coach_attempt_payload_valid(current_setting('test.fast_rep')::jsonb #- '{0,max_shrug}'),
  'missing numeric fields remain invalid');
select ok(not private.form_coach_attempt_payload_valid(current_setting('test.fast_rep')::jsonb ||
  '[{"rawFrame":"forbidden"}]'::jsonb), 'raw media and undeclared fields remain invalid');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4250000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((public.finish_form_coach_attempt('f4250000-0000-0000-0000-000000000008',
  'f4250000-0000-0000-0000-000000000009',current_setting('test.fast_rep')::jsonb)->>'outcome'),
  'finished','the real authenticated finish RPC stores the fast-phase synthetic result');
reset role;

select is((select concentric_ms from public.form_coach_attempt_rep_results
  where attempt_id='f4250000-0000-0000-0000-000000000008' and rep_number=1),80,
  'the stored concentric duration remains exactly 80 measured milliseconds');
select is((select eccentric_ms from public.form_coach_attempt_rep_results
  where attempt_id='f4250000-0000-0000-0000-000000000008' and rep_number=1),520,
  'the stored eccentric duration remains exactly 520 measured milliseconds');
select ok((select 'eccentric_too_fast'=any(faults) and concentric_ms+top_pause_ms+eccentric_ms=600
  from public.form_coach_attempt_rep_results
  where attempt_id='f4250000-0000-0000-0000-000000000008' and rep_number=1),
  'the measured fast-eccentric fault and complete 600 ms rep are preserved');
select ok((select result.rep_count=1 and (result.numeric_summary->>'concentric_ms_average')::numeric=80
  from public.form_coach_attempt_results result
  where result.attempt_id='f4250000-0000-0000-0000-000000000008'),
  'the saved attempt summary retains the fast phase without changing the rep count');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f4250000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((public.finish_form_coach_attempt('f4250000-0000-0000-0000-000000000008',
  'f4250000-0000-0000-0000-000000000009',current_setting('test.fast_rep')::jsonb)->>'outcome'),
  'already_finished','an exact fast-result replay remains idempotent');
reset role;

select * from finish();
rollback;
