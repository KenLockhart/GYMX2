begin;
select no_plan();

select ok(has_function_privilege('service_role',
    'public.discard_program_authoring_draft(uuid,uuid,uuid,bigint,uuid,uuid)','execute')
  and not has_function_privilege('anon',
    'public.discard_program_authoring_draft(uuid,uuid,uuid,bigint,uuid,uuid)','execute')
  and not has_function_privilege('authenticated',
    'public.discard_program_authoring_draft(uuid,uuid,uuid,bigint,uuid,uuid)','execute'),
  'draft recovery is executable only by the server service role');
select ok(not has_table_privilege('service_role','private.program_authoring_drafts','select')
  and not has_table_privilege('service_role','private.program_authoring_drafts','insert')
  and not has_table_privilege('service_role','private.program_authoring_drafts','update')
  and not has_table_privilege('service_role','private.program_authoring_drafts','delete')
  and not has_table_privilege('service_role','private.program_authoring_draft_lessons','select')
  and not has_table_privilege('service_role','private.program_authoring_draft_lessons','insert')
  and not has_table_privilege('service_role','private.program_authoring_draft_lessons','update')
  and not has_table_privilege('service_role','private.program_authoring_draft_lessons','delete')
  and not has_table_privilege('authenticated','private.program_authoring_drafts','select'),
  'draft recovery adds no direct private-table access');
select ok((select procedure_row.prosecdef from pg_proc procedure_row
    where procedure_row.oid=to_regprocedure('public.discard_program_authoring_draft(uuid,uuid,uuid,bigint,uuid,uuid)')),
  'draft recovery performs its narrow delete inside a security-definer function');

insert into auth.users(id,email,raw_user_meta_data) values
  ('a6050000-0000-4000-8000-000000000001','draft-owner@example.test','{"display_name":"Draft Owner"}'),
  ('a6050000-0000-4000-8000-000000000002','draft-outsider@example.test','{"display_name":"Draft Outsider"}');
update public.profiles set role='coach'
where id in ('a6050000-0000-4000-8000-000000000001','a6050000-0000-4000-8000-000000000002');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"a6050000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into public.programs(id,coach_id,title,description,published)
values('a6050000-0000-4000-8000-000000000003','a6050000-0000-4000-8000-000000000001',
  'Draft Recovery Fixture','',false);
reset role;

set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.recovery_initial_snapshot',public.get_program_authoring_draft(
  'a6050000-0000-4000-8000-000000000003','a6050000-0000-4000-8000-000000000001')::text,true);
select set_config('test.recovery_first_draft',public.save_program_authoring_draft(
  'a6050000-0000-4000-8000-000000000003','a6050000-0000-4000-8000-000000000001',null,0,
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  '[{"lesson_ordinal":1,"timeline_day_number":1,"title":"Saved candidate","instructions":"Keep this text until discard","pillar":"body","video_id":null}]'::jsonb
)::text,true);
select is(current_setting('test.recovery_first_draft')::jsonb->>'status','saved',
  'the owner creates a normal saved draft through the existing authoring RPC');
reset role;

select set_config('test.recovery_before',(
  select state.current_content_version_id::text||':'||state.current_offer_version_id::text||':'||
    (select count(*)::text from public.program_content_versions version where version.program_id=state.program_id)||':'||
    (select count(*)::text from public.program_offer_versions offer where offer.program_id=state.program_id)||':'||
    (select count(*)::text from private.program_authoring_receipts receipt where receipt.program_id=state.program_id)
  from public.program_commerce_state state where state.program_id='a6050000-0000-4000-8000-000000000003'
),true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.recovery_discarded',public.discard_program_authoring_draft(
  'a6050000-0000-4000-8000-000000000003','a6050000-0000-4000-8000-000000000001',
  (current_setting('test.recovery_first_draft')::jsonb->>'draft_id')::uuid,
  (current_setting('test.recovery_first_draft')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid
)::text,true);
select is(current_setting('test.recovery_discarded')::jsonb->>'status','discarded',
  'the exact owner draft revision can be discarded');
select is(current_setting('test.recovery_discarded')::jsonb->>'draft_id',
  current_setting('test.recovery_first_draft')::jsonb->>'draft_id',
  'discard returns only the exact target draft identity');
reset role;
select ok(not exists (select 1 from private.program_authoring_drafts draft
    where draft.program_id='a6050000-0000-4000-8000-000000000003')
  and not exists (select 1 from private.program_authoring_draft_lessons lesson
    where lesson.program_id='a6050000-0000-4000-8000-000000000003'),
  'deleting the exact draft header removes only its cascaded candidate lessons');
select is((select state.current_content_version_id::text||':'||state.current_offer_version_id::text||':'||
    (select count(*)::text from public.program_content_versions version where version.program_id=state.program_id)||':'||
    (select count(*)::text from public.program_offer_versions offer where offer.program_id=state.program_id)||':'||
    (select count(*)::text from private.program_authoring_receipts receipt where receipt.program_id=state.program_id)
  from public.program_commerce_state state where state.program_id='a6050000-0000-4000-8000-000000000003'),
  current_setting('test.recovery_before'),
  'discard leaves published content, offers, and immutable receipts unchanged');

set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.recovery_absent_retry',public.discard_program_authoring_draft(
  'a6050000-0000-4000-8000-000000000003','a6050000-0000-4000-8000-000000000001',
  (current_setting('test.recovery_first_draft')::jsonb->>'draft_id')::uuid,
  (current_setting('test.recovery_first_draft')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid
)::text,true);
select is(current_setting('test.recovery_absent_retry')::jsonb->>'status','already_absent',
  'retry after a lost delete reply succeeds only after rechecking the exact owner and current-version fences');
select set_config('test.recovery_replacement',public.save_program_authoring_draft(
  'a6050000-0000-4000-8000-000000000003','a6050000-0000-4000-8000-000000000001',null,0,
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid,
  '[{"lesson_ordinal":1,"timeline_day_number":1,"title":"Replacement draft","instructions":"Preserve this replacement","pillar":"mind","video_id":"a6050000-0000-4000-8000-000000000099"}]'::jsonb
)::text,true);
select is(current_setting('test.recovery_replacement')::jsonb->>'status','saved',
  'a replacement draft receives a different immutable candidate identity');
select set_config('test.recovery_old_target_conflict',public.discard_program_authoring_draft(
  'a6050000-0000-4000-8000-000000000003','a6050000-0000-4000-8000-000000000001',
  (current_setting('test.recovery_first_draft')::jsonb->>'draft_id')::uuid,
  (current_setting('test.recovery_first_draft')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid
)::text,true);
select is(current_setting('test.recovery_old_target_conflict')::jsonb->>'status','conflict',
  'an old target cannot delete a different replacement draft');
reset role;
select ok(exists (select 1 from private.program_authoring_drafts draft
    where draft.program_id='a6050000-0000-4000-8000-000000000003'
      and draft.draft_id=(current_setting('test.recovery_replacement')::jsonb->>'draft_id')::uuid
      and draft.revision=(current_setting('test.recovery_replacement')::jsonb->>'draft_revision')::bigint)
  and exists (select 1 from private.program_authoring_draft_lessons lesson
    where lesson.program_id='a6050000-0000-4000-8000-000000000003'
      and lesson.draft_id=(current_setting('test.recovery_replacement')::jsonb->>'draft_id')::uuid
      and lesson.title='Replacement draft'
      and lesson.video_id='a6050000-0000-4000-8000-000000000099'),
  'replacement header and authored lesson survive the stale target retry');

set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.recovery_revision_conflict',public.discard_program_authoring_draft(
  'a6050000-0000-4000-8000-000000000003','a6050000-0000-4000-8000-000000000001',
  (current_setting('test.recovery_replacement')::jsonb->>'draft_id')::uuid,
  (current_setting('test.recovery_replacement')::jsonb->>'draft_revision')::bigint+1,
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid
)::text,true);
select is(current_setting('test.recovery_revision_conflict')::jsonb->>'status','conflict',
  'an incorrect target revision cannot delete the current draft');
select throws_ok($$select public.discard_program_authoring_draft(
  'a6050000-0000-4000-8000-000000000003','a6050000-0000-4000-8000-000000000001',
  (current_setting('test.recovery_replacement')::jsonb->>'draft_id')::uuid,
  (current_setting('test.recovery_replacement')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  'a6050000-0000-4000-8000-000000000099')$$,
  '40001',null,'a stale current offer pointer rejects recovery');
select throws_ok($$select public.discard_program_authoring_draft(
  'a6050000-0000-4000-8000-000000000003','a6050000-0000-4000-8000-000000000001',
  (current_setting('test.recovery_replacement')::jsonb->>'draft_id')::uuid,
  (current_setting('test.recovery_replacement')::jsonb->>'draft_revision')::bigint,
  'a6050000-0000-4000-8000-000000000098',
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid)$$,
  '40001',null,'a stale current content pointer rejects recovery');
reset role;
select ok(exists (select 1 from private.program_authoring_drafts draft
    where draft.program_id='a6050000-0000-4000-8000-000000000003'
      and draft.draft_id=(current_setting('test.recovery_replacement')::jsonb->>'draft_id')::uuid
      and draft.revision=(current_setting('test.recovery_replacement')::jsonb->>'draft_revision')::bigint)
  and exists (select 1 from private.program_authoring_draft_lessons lesson
    where lesson.program_id='a6050000-0000-4000-8000-000000000003'
      and lesson.draft_id=(current_setting('test.recovery_replacement')::jsonb->>'draft_id')::uuid
      and lesson.title='Replacement draft'),
  'a stale content pointer leaves the exact draft and its authored lesson unchanged');
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select throws_ok($$select public.discard_program_authoring_draft(
  'a6050000-0000-4000-8000-000000000003','a6050000-0000-4000-8000-000000000002',
  (current_setting('test.recovery_replacement')::jsonb->>'draft_id')::uuid,
  (current_setting('test.recovery_replacement')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid)$$,
  '42501','Program authoring actor no longer manages this Program',
  'another coach cannot discard this Program draft');
reset role;
select ok(exists (select 1 from private.program_authoring_drafts draft
    where draft.program_id='a6050000-0000-4000-8000-000000000003'
      and draft.draft_id=(current_setting('test.recovery_replacement')::jsonb->>'draft_id')::uuid),
  'stale pointers and another actor leave the current draft intact');

update public.profiles set role='member'
where id='a6050000-0000-4000-8000-000000000001';
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select throws_ok($$select public.discard_program_authoring_draft(
  'a6050000-0000-4000-8000-000000000003','a6050000-0000-4000-8000-000000000001',
  (current_setting('test.recovery_first_draft')::jsonb->>'draft_id')::uuid,
  (current_setting('test.recovery_first_draft')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid)$$,
  '42501','Program authoring actor no longer manages this Program',
  'even a retry for an absent draft requires fresh current ownership and role checks');
select throws_ok($$select public.discard_program_authoring_draft(
  'a6050000-0000-4000-8000-000000000003','a6050000-0000-4000-8000-000000000001',
  (current_setting('test.recovery_replacement')::jsonb->>'draft_id')::uuid,
  (current_setting('test.recovery_replacement')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid)$$,
  '42501','Program authoring actor no longer manages this Program',
  'an owner who lost the coach role cannot discard a saved draft');
reset role;
update public.profiles set role='coach'
where id='a6050000-0000-4000-8000-000000000001';
select ok(exists (select 1 from private.program_authoring_drafts draft
    where draft.program_id='a6050000-0000-4000-8000-000000000003'
      and draft.draft_id=(current_setting('test.recovery_replacement')::jsonb->>'draft_id')::uuid),
  'role-loss rejection leaves the draft available after actor state is restored');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"a6050000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$select public.discard_program_authoring_draft(
  'a6050000-0000-4000-8000-000000000003','a6050000-0000-4000-8000-000000000001',
  (current_setting('test.recovery_replacement')::jsonb->>'draft_id')::uuid,
  (current_setting('test.recovery_replacement')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid)$$,
  '42501',null,'authenticated cannot execute the private-draft recovery RPC directly');
reset role;

set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.recovery_unresolved_video_discard',public.discard_program_authoring_draft(
  'a6050000-0000-4000-8000-000000000003','a6050000-0000-4000-8000-000000000001',
  (current_setting('test.recovery_replacement')::jsonb->>'draft_id')::uuid,
  (current_setting('test.recovery_replacement')::jsonb->>'draft_revision')::bigint,
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_content_version_id')::uuid,
  (current_setting('test.recovery_initial_snapshot')::jsonb->>'current_offer_version_id')::uuid
)::text,true);
select is(current_setting('test.recovery_unresolved_video_discard')::jsonb->>'status','discarded',
  'an owner can discard a draft that retains an unresolved optional video selection');
reset role;
select ok(not exists (select 1 from private.program_authoring_drafts draft
    where draft.program_id='a6050000-0000-4000-8000-000000000003')
  and not exists (select 1 from public.videos video
    where video.id='a6050000-0000-4000-8000-000000000099'),
  'discard removes only the draft and does not create or mutate a media record');

select * from finish();
rollback;
