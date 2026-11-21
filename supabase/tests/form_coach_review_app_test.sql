begin;
select plan(33);

-- Synthetic rollback-only fixtures. No external payment provider, storage, or notification API is called.
insert into auth.users (id, email, raw_user_meta_data) values
  ('f4300000-0000-0000-0000-000000000001', 'review-ui-coach@example.test', '{"display_name":"Review UI Coach"}'),
  ('f4300000-0000-0000-0000-000000000002', 'review-ui-member@example.test', '{"display_name":"Review UI Member"}'),
  ('f4300000-0000-0000-0000-000000000003', 'review-ui-outsider@example.test', '{"display_name":"Review UI Outsider"}'),
  ('f4300000-0000-0000-0000-000000000004', 'review-ui-admin@example.test', '{"display_name":"Review UI Admin"}');
update public.profiles set role = 'coach'
where id in ('f4300000-0000-0000-0000-000000000001', 'f4300000-0000-0000-0000-000000000003');
update public.profiles set role = 'admin' where id = 'f4300000-0000-0000-0000-000000000004';
insert into public.coach_members (coach_id, member_id)
values ('f4300000-0000-0000-0000-000000000001', 'f4300000-0000-0000-0000-000000000002');

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f4300000-0000-0000-0000-000000000004","role":"authenticated"}';
select set_config('test.review_comp_grant', public.admin_grant_feature_comp(
  'f4300000-0000-0000-0000-000000000001', 'form_coach', now() - interval '1 minute',
  now() + interval '30 days', 'Synthetic review UI funding', 'f4390000-0000-0000-0000-000000000001'
)::text, true);
select ok(current_setting('test.review_comp_grant') <> '',
  'admin creates an explicit synthetic comp through the approved grant RPC');
reset role;

select ok(has_function_privilege('authenticated', 'public.get_coach_form_coach_review_detail(uuid)', 'execute'),
  'authenticated callers can use the coach review projection');
select ok(not has_function_privilege('anon', 'public.get_coach_form_coach_review_detail(uuid)', 'execute'),
  'anonymous callers cannot use the coach review projection');
select ok(not has_function_privilege('service_role', 'public.get_coach_form_coach_review_detail(uuid)', 'execute'),
  'service_role has no alternate coach review projection grant');

insert into public.form_coach_terms_versions(version, document_path, document_sha256, created_by)
values (1, '/legal/form-coach/terms/1', repeat('a', 64), 'f4300000-0000-0000-0000-000000000004');
select set_config('test.review_template_payload', (
  select jsonb_build_object(
    'exerciseKey', 'dumbbell_curl', 'schemaVersion', 1, 'cameraView', 'side', 'arm', 'right',
    'segmentation', jsonb_build_object('metric', 'elbowAngle', 'extendedThreshold', 160, 'flexedThreshold', 50),
    'reference', jsonb_build_object('romMinAngle', 45, 'romMaxAngle', 160, 'concentricMs', 1000,
      'topPauseMs', 200, 'eccentricMs', 1500, 'elbowCurve', (
        select jsonb_agg((45 + floor((n - 1) * 115.0 / 49))::integer order by n)
        from generate_series(1, 50) n
      )),
    'tolerances', jsonb_build_object('romTopDeg', 10, 'romBottomDeg', 10, 'upperArmDriftDeg', 15,
      'torsoSwingDeg', 12, 'shrugRatio', 0.25, 'tempoPct', 30),
    'scoringWeights', jsonb_build_object('rom', 40, 'elbow', 20, 'torso', 10, 'tempo', 15, 'shoulders', 15),
    'strictness', 'standard', 'cues', '[]'::jsonb,
    'breathing', jsonb_build_object('concentric', 'exhale', 'eccentric', 'inhale', 'fullCueReps', 3, 'thenEvery', 3)
  )::text
), true);
select ok(private.form_coach_valid_template_payload('dumbbell_curl', current_setting('test.review_template_payload')::jsonb),
  'the owner-seeded review fixture uses a complete valid numeric template payload');
insert into public.form_coach_templates(id, owner_subject_id, owner_id, owner_kind, name)
values ('f4310000-0000-0000-0000-000000000001', 'f4300000-0000-0000-0000-000000000001',
  'f4300000-0000-0000-0000-000000000001', 'coach', 'Synthetic review template');
-- This complete valid version is an Owner-seeded read fixture. It does not claim the template
-- upload or publish producer flow was exercised.
insert into public.form_coach_template_versions(
  id, template_id, revision, exercise_key, schema_version, template_payload, payload_sha256,
  state, created_by, published_by, published_at
) values (
  'f4320000-0000-0000-0000-000000000001', 'f4310000-0000-0000-0000-000000000001', 1,
  'dumbbell_curl', 1, current_setting('test.review_template_payload')::jsonb,
  repeat('b', 64), 'published', 'f4300000-0000-0000-0000-000000000001',
  'f4300000-0000-0000-0000-000000000001', now()
);

insert into public.form_coach_assessments(
  id, send_request_id, send_digest, source_kind, member_subject_id, member_owner_id,
  coach_subject_id, coach_owner_id, sent_by_subject_id, sent_by_owner_id,
  payer_role, payer_subject_id, payer_owner_id, config_revision, due_at, status
) values (
  'f4330000-0000-0000-0000-000000000001', 'f4340000-0000-0000-0000-000000000001', repeat('c', 64),
  'manual', 'f4300000-0000-0000-0000-000000000002', 'f4300000-0000-0000-0000-000000000002',
  'f4300000-0000-0000-0000-000000000001', 'f4300000-0000-0000-0000-000000000001',
  'f4300000-0000-0000-0000-000000000001', 'f4300000-0000-0000-0000-000000000001',
  'coach', 'f4300000-0000-0000-0000-000000000001', 'f4300000-0000-0000-0000-000000000001',
  1, now() + interval '7 days', 'in_progress'
);
insert into public.form_coach_assessment_items(
  id, assessment_id, item_ordinal, item_key, item_title_snapshot, template_version_id,
  exercise_key, required_reps, pass_threshold, max_attempts
) values (
  'f4350000-0000-0000-0000-000000000001', 'f4330000-0000-0000-0000-000000000001',
  1, 'curl', 'Dumbbell curl', 'f4320000-0000-0000-0000-000000000001',
  'dumbbell_curl', 8, 75, 3
);
-- Owner snapshots the assessment's frozen identity, then service_role records the funded bundle
-- from the actual comp grant. No JWT actor is supplied to the service RPC.
select set_config('test.review_funding_input', (
  select jsonb_build_object('bundle_id', assessment.id, 'feature_key', assessment.feature_key,
    'payer_id', assessment.payer_subject_id, 'config_revision', assessment.config_revision,
    'due_at', assessment.due_at, 'operation_key', 'synthetic-review-ui:' || assessment.id::text)::text
  from public.form_coach_assessments assessment
  where assessment.id = 'f4330000-0000-0000-0000-000000000001'
), true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select set_config('test.review_funding_result', (
  select to_jsonb(funding)::text
  from public.record_feature_bundle_funding(
    (current_setting('test.review_funding_input')::jsonb ->> 'bundle_id')::uuid,
    current_setting('test.review_funding_input')::jsonb ->> 'feature_key',
    (current_setting('test.review_funding_input')::jsonb ->> 'payer_id')::uuid,
    (current_setting('test.review_funding_input')::jsonb ->> 'config_revision')::bigint,
    (current_setting('test.review_funding_input')::jsonb ->> 'due_at')::timestamptz,
    current_setting('test.review_funding_input')::jsonb ->> 'operation_key'
  ) as funding
), true);
select is(current_setting('test.review_funding_result')::jsonb ->> 'outcome', 'funded',
  'service records the funded bundle through the normal receipt RPC');
reset role;
select ok((select count(*) = 1 and bool_and(
  receipt.funding_source = 'comp'
  and receipt.source_id = current_setting('test.review_comp_grant')
  and receipt.credit_units_consumed = 0
  and receipt.payer_id = assessment.payer_subject_id
  and receipt.config_revision = assessment.config_revision
  and receipt.due_at = assessment.due_at
) from public.feature_bundle_funding_receipts receipt
  join public.form_coach_assessments assessment on assessment.id = receipt.bundle_id
  where assessment.id = 'f4330000-0000-0000-0000-000000000001'),
  'the immutable receipt carries the actual comp grant and assessment funding identity');
-- This Owner-seeded finished attempt is a consumer fixture for the review RPC, not a claim that
-- attempt setup/finish production flow is covered by this packet.
insert into public.form_coach_attempts(
  id, assessment_id, item_id, member_subject_id, attempt_number, state,
  lease_token, lease_expires_at, consent_terms_version, started_at, finished_at, result_digest
) values (
  'f4360000-0000-0000-0000-000000000001', 'f4330000-0000-0000-0000-000000000001',
  'f4350000-0000-0000-0000-000000000001', 'f4300000-0000-0000-0000-000000000002',
  1, 'finished', 'f4370000-0000-0000-0000-000000000001', now() + interval '1 minute',
  1, now() - interval '2 minutes', now() - interval '1 minute', repeat('d', 64)
);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f4300000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('test.review_detail_before', public.get_coach_form_coach_review_detail(
  'f4330000-0000-0000-0000-000000000001')::text, true);
select is(current_setting('test.review_detail_before')::jsonb #>> '{items,0,expected_review_sequence}', '0',
  'first review sequence is zero');
select is((current_setting('test.review_detail_before')::jsonb #>> '{items,0,can_review}')::boolean, true,
  'a linked coach can review an eligible finished attempt');
select is((current_setting('test.review_detail_before')::jsonb #>> '{items,0,can_open_retry}')::boolean, true,
  'retry capability is exposed while the existing 400 limits permit it');
select is((current_setting('test.review_detail_before')::jsonb #>> '{items,0,max_extra_attempts}')::integer, 3,
  'retry UI receives the bounded maximum extra-attempt count');
select is((public.get_form_coach_workflow_detail('f4330000-0000-0000-0000-000000000001') #> '{items,0}')
  ? 'expected_review_sequence', false,
  'the existing member and coach workflow DTO is not widened');
reset role;

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f4300000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(public.get_coach_form_coach_review_detail('f4330000-0000-0000-0000-000000000001')::text, null,
  'members cannot call the coach-only review projection');
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f4300000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(public.get_coach_form_coach_review_detail('f4330000-0000-0000-0000-000000000001')::text, null,
  'an unlinked coach receives the generic unavailable result');
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f4300000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(public.get_coach_form_coach_review_detail('f4330000-0000-0000-0000-000000000001')::text, null,
  'an admin receives no alternate assessment review read');
reset role;

-- Exercise the unchanged authenticated review RPC with one Needs Work decision and exact replay.
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f4300000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('test.review_needs_work', public.record_form_coach_review(
  'f4360000-0000-0000-0000-000000000001', 0, 'f4380000-0000-0000-0000-000000000001',
  'needs_work', 'Keep the elbow steady.', true, 60, 2::smallint)::text, true);
select is(current_setting('test.review_needs_work')::jsonb ->> 'outcome', 'recorded',
  'the existing authenticated RPC records Needs Work and opens its requested bounded retry');
select set_config('test.review_detail_after_needs_work', public.get_coach_form_coach_review_detail(
  'f4330000-0000-0000-0000-000000000001')::text, true);
select is(current_setting('test.review_detail_after_needs_work')::jsonb #>> '{items,0,expected_review_sequence}', '1',
  'review sequence and latest review advance in the same projection');
select is(current_setting('test.review_detail_after_needs_work')::jsonb #>> '{items,0,latest_review,feedback}',
  'Keep the elbow steady.', 'latest feedback is returned with the corresponding current sequence');
select is((current_setting('test.review_detail_after_needs_work')::jsonb #>> '{items,0,can_review}')::boolean, true,
  'a Needs Work item remains reviewable while the existing RPC permits another decision');
reset role;
select is((select count(*)::integer from public.form_coach_retry_windows
  where assessment_id = 'f4330000-0000-0000-0000-000000000001'), 1,
  'the actual RPC opens one retry window without a second funding receipt');
select is((select count(*)::integer from public.feature_bundle_funding_receipts
  where bundle_id = 'f4330000-0000-0000-0000-000000000001'), 1,
  'retry review preserves the single immutable assessment funding receipt');
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f4300000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((public.record_form_coach_review(
  'f4360000-0000-0000-0000-000000000001', 0, 'f4380000-0000-0000-0000-000000000001',
  'needs_work', 'Keep the elbow steady.', true, 60, 2::smallint) ->> 'outcome'),
  'already_recorded', 'the original request can be replayed exactly before sequence comparison');
select throws_ok(
  $$select public.record_form_coach_review(
    'f4360000-0000-0000-0000-000000000001', 0, 'f4380000-0000-0000-0000-000000000002',
    'learned', 'Stale sequence', false, null, null)$$,
  '40001', null, 'a distinct review with a stale expected sequence is rejected');
reset role;

-- Learned becomes terminal for new reviews. The earlier exact replay still follows the 400 RPC's
-- idempotency-first contract even after the latest sequence and capability have changed.
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f4300000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((public.record_form_coach_review(
  'f4360000-0000-0000-0000-000000000001', 1, 'f4380000-0000-0000-0000-000000000003',
  'learned', 'This movement is consistent.', false, null, null) ->> 'outcome'),
  'recorded', 'the next current-sequence review records Learned through the existing RPC');
select set_config('test.review_detail_after_learned', public.get_coach_form_coach_review_detail(
  'f4330000-0000-0000-0000-000000000001')::text, true);
select is(current_setting('test.review_detail_after_learned')::jsonb #>> '{items,0,expected_review_sequence}', '2',
  'the coherent projection reports the Learned review sequence');
select is(current_setting('test.review_detail_after_learned')::jsonb #>> '{items,0,latest_review,verdict}', 'learned',
  'the coherent projection reports the latest Learned feedback state');
select is((current_setting('test.review_detail_after_learned')::jsonb #>> '{items,0,can_review}')::boolean, false,
  'a Learned item exposes no new-review control');
select is((current_setting('test.review_detail_after_learned')::jsonb #>> '{items,0,can_open_retry}')::boolean, false,
  'a Learned item exposes no retry control');
select is((public.record_form_coach_review(
  'f4360000-0000-0000-0000-000000000001', 0, 'f4380000-0000-0000-0000-000000000001',
  'needs_work', 'Keep the elbow steady.', true, 60, 2::smallint) ->> 'outcome'),
  'already_recorded', 'exact replay remains valid after the latest review changes to Learned');
reset role;

select is((select count(*)::integer from public.form_coach_reviews
  where item_id = 'f4350000-0000-0000-0000-000000000001'), 2,
  'idempotent replay does not create another review row');

-- A feature pause removes write capability while preserving the authorized history read.
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f4300000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(public.admin_create_feature_pricing_revision(
  'form_coach', 1, 'disabled', 'member', null, 'USD', 'Form Coach', 'Synthetic pause', '', 0, 0, '[]'::jsonb),
  2::bigint, 'admin pauses the synthetic Form Coach config through the pricing RPC');
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f4300000-0000-0000-0000-000000000001","role":"authenticated"}';
select set_config('test.review_detail_paused', public.get_coach_form_coach_review_detail(
  'f4330000-0000-0000-0000-000000000001')::text, true);
select is((current_setting('test.review_detail_paused')::jsonb #>> '{items,0,can_review}')::boolean, false,
  'a disabled feature leaves history readable but removes review capability');
select is(current_setting('test.review_detail_paused')::jsonb #>> '{items,0,latest_review,verdict}', 'learned',
  'the disabled-feature projection retains the saved review history');
reset role;

select * from finish();
rollback;
