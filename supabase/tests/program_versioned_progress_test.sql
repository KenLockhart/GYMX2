begin;
select no_plan();

-- Isolated synthetic actor set. This suite runs after the Program foundation and Gate 2
-- migrations, and rolls all fixture rows back at the end.
insert into auth.users (id, email, raw_user_meta_data) values
  ('c1000000-0000-0000-0000-000000000002', 'g2-coach@example.test', '{"display_name":"Gate Two Coach"}'),
  ('c1000000-0000-0000-0000-000000000003', 'g2-member-one@example.test', '{"display_name":"Gate Two Member One"}'),
  ('c1000000-0000-0000-0000-000000000004', 'g2-member-two@example.test', '{"display_name":"Gate Two Member Two"}'),
  ('c1000000-0000-0000-0000-000000000005', 'g2-outsider@example.test', '{"display_name":"Gate Two Outsider"}'),
  ('c1000000-0000-0000-0000-000000000006', 'g2-admin@example.test', '{"display_name":"Gate Two Admin"}');
update public.profiles set role = 'coach'
where id = 'c1000000-0000-0000-0000-000000000002';
update public.profiles set role = 'admin'
where id = 'c1000000-0000-0000-0000-000000000006';
insert into public.platform_test_entitlements (member_id, tier, grant_reason, granted_by)
values
  ('c1000000-0000-0000-0000-000000000003', 'regular', 'Synthetic Gate 2 test', 'c1000000-0000-0000-0000-000000000002'),
  ('c1000000-0000-0000-0000-000000000004', 'regular', 'Synthetic Gate 2 test', 'c1000000-0000-0000-0000-000000000002'),
  ('c1000000-0000-0000-0000-000000000005', 'regular', 'Synthetic Gate 2 test', 'c1000000-0000-0000-0000-000000000002');
insert into public.coach_members (coach_id, member_id) values
  ('c1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000003'),
  ('c1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000004');

select ok(not has_table_privilege('authenticated', 'public.program_lesson_progress_events', 'select'),
  'members cannot read or forge the immutable event ledger directly');
select ok(not has_table_privilege('authenticated', 'public.program_lesson_progress_events', 'insert'),
  'members cannot append progress facts outside the RPC');
select ok(not has_table_privilege('authenticated', 'public.program_versioning_fences', 'select'),
  'conversion fences remain private');
select ok(not has_column_privilege('authenticated', 'public.program_enrollments', 'content_version_id', 'insert'),
  'members cannot choose an enrollment snapshot pointer');
select ok(not has_column_privilege('authenticated', 'public.program_enrollments', 'content_version_id', 'update'),
  'members cannot repin an enrollment after starting');
select ok(not has_function_privilege('authenticated', 'public.snapshot_program_free_content(uuid)', 'execute'),
  'only the trusted server can convert and pin a free Program');
select ok(has_function_privilege('service_role', 'public.snapshot_program_free_content(uuid)', 'execute'),
  'the trusted server can run the conversion RPC');
select ok(has_function_privilege('authenticated', 'public.start_my_program_enrollment(uuid)', 'execute'),
  'members retain a supported free enrollment action');
select ok(has_function_privilege('authenticated', 'public.set_my_program_lesson_state(uuid,uuid,boolean,uuid)', 'execute'),
  'members retain the idempotent progress action');
select ok(not has_function_privilege('authenticated', 'public.get_program_reminder_candidates(uuid[],date,integer,integer)', 'execute'),
  'members cannot invoke the service reminder reader');
select ok(has_function_privilege('service_role', 'public.get_program_reminder_candidates(uuid[],date,integer,integer)', 'execute'),
  'the reminder worker can use the service-scoped progress reader');

-- The coach creates a published free Program with sparse timeline days. The stable ordinal is
-- dense (1, 2, 3), while the daily unlock dates remain 1, 10, and 20.
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000002","role":"authenticated"}';
insert into public.programs (id, coach_id, title, description, published)
values ('c3000000-0000-0000-0000-000000000101', 'c1000000-0000-0000-0000-000000000002', 'Sparse Free Program', '', false);
select ok(set_config('test.g2_day_one', public.save_owned_program_day(
  'c3000000-0000-0000-0000-000000000101', null, 1::smallint, 'First lesson', 'First instructions', 'body', null
)::text, true) <> '', 'the current coach inserts the first free lesson through the lock-aware RPC');
select ok(set_config('test.g2_day_ten', public.save_owned_program_day(
  'c3000000-0000-0000-0000-000000000101', null, 10::smallint, 'Tenth day lesson', 'Second instructions', 'mind', null
)::text, true) <> '', 'the lock-aware RPC stores a sparse day ten lesson');
select ok(set_config('test.g2_day_twenty', public.save_owned_program_day(
  'c3000000-0000-0000-0000-000000000101', null, 20::smallint, 'Twentieth day lesson', 'Locked instructions', 'spirit', null
)::text, true) <> '', 'the lock-aware RPC stores a sparse day twenty lesson');
reset role;
update public.programs set published = true where id = 'c3000000-0000-0000-0000-000000000101';
select set_config('test.g2_current_version', (
  select current_content_version_id::text from public.program_commerce_state
  where program_id='c3000000-0000-0000-0000-000000000101'
), true);

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok(
  $$insert into public.program_enrollments (program_id, member_id, started_on, content_version_id)
    values ('c3000000-0000-0000-0000-000000000101', 'c1000000-0000-0000-0000-000000000003', current_date, current_setting('test.g2_current_version')::uuid)$$,
  '42501', null, 'members cannot insert a forged same-Program content pin');
select throws_ok(
  $$insert into public.program_enrollments (program_id, member_id, started_on)
    values ('c3000000-0000-0000-0000-000000000101', 'c1000000-0000-0000-0000-000000000003', current_date - 30)$$,
  '42501', null, 'members cannot backdate or bypass the enrollment RPC');
select is((public.start_my_program_enrollment('c3000000-0000-0000-0000-000000000101')->>'existing')::boolean,
  false, 'an eligible linked member starts ordinary free content through the supported path');
reset role;
update public.program_enrollments set started_on = (now() at time zone 'America/New_York')::date - 9
where program_id = 'c3000000-0000-0000-0000-000000000101'
  and member_id = 'c1000000-0000-0000-0000-000000000003';

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok(
  $$insert into public.program_day_completions (enrollment_id, day_id, member_id)
    select id, current_setting('test.g2_day_one')::uuid, 'c1000000-0000-0000-0000-000000000003'
    from public.program_enrollments where program_id='c3000000-0000-0000-0000-000000000101'$$,
  '42501', null, 'members cannot bypass progress history with a raw completion insert');
select is((public.set_my_program_lesson_state(
  'c3000000-0000-0000-0000-000000000101', current_setting('test.g2_day_one')::uuid, true,
  'c5000000-0000-0000-0000-000000000101')->>'accepted')::boolean,
  true, 'the unlocked first lesson is completed through the event RPC');
select is((public.set_my_program_lesson_state(
  'c3000000-0000-0000-0000-000000000101', current_setting('test.g2_day_ten')::uuid, true,
  'c5000000-0000-0000-0000-000000000102')->>'accepted')::boolean,
  true, 'the sparse day ten lesson is available when its timeline day has arrived');
select throws_ok(
  $$select public.set_my_program_lesson_state('c3000000-0000-0000-0000-000000000101', current_setting('test.g2_day_twenty')::uuid, true, 'c5000000-0000-0000-0000-000000000103')$$,
  '42501', null, 'day twenty remains locked even though lesson ordinals are dense');
select is((public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000101', null)->>'lesson_ceiling')::integer,
  2, 'sparse timeline dates resolve to the greatest eligible dense ordinal');
select is(public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000101', null)->'accessible_lesson_ids',
  jsonb_build_array(current_setting('test.g2_day_one')::uuid, current_setting('test.g2_day_ten')::uuid),
  'the free access projection contains only the first two sparse lessons');
select ok(not ((public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000101', null)->'required_lessons'->2) ? 'instructions'),
  'required metadata never contains the locked lesson instructions');
select is((public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000101', null)->>'current_completed_count')::integer,
  2, 'current completion count is scoped to this member and Program');
select is((select array_agg((entry.value->>'event_sequence')::integer
      order by (entry.value->>'event_sequence')::integer)
  from jsonb_array_elements(public.get_program_versioned_progress(
    'c3000000-0000-0000-0000-000000000101', null)->'history') as entry(value)),
  array[1,2]::integer[], 'event sequence increases across different lessons for one subject');
select is(public.set_my_program_lesson_state(
  'c3000000-0000-0000-0000-000000000101', current_setting('test.g2_day_one')::uuid, false,
  'c5000000-0000-0000-0000-000000000104')->>'operation_completed',
  'false', 'undo records a new authoritative operation receipt');
select is(public.set_my_program_lesson_state(
  'c3000000-0000-0000-0000-000000000101', current_setting('test.g2_day_one')::uuid, true,
  'c5000000-0000-0000-0000-000000000101')->>'operation_completed',
  'true', 'a repeated operation preserves its original completion receipt after an undo');
select is(public.set_my_program_lesson_state(
  'c3000000-0000-0000-0000-000000000101', current_setting('test.g2_day_one')::uuid, true,
  'c5000000-0000-0000-0000-000000000101')->>'current_completed',
  'false', 'a replay returns current state separately and cannot reapply the old completion');
select throws_ok(
  $$select public.set_my_program_lesson_state('c3000000-0000-0000-0000-000000000101', current_setting('test.g2_day_one')::uuid, false, 'c5000000-0000-0000-0000-000000000101')$$,
  '23505', 'Program progress operation ID was reused', 'one operation UUID cannot be reused for a different transition');
select is((select array_agg((entry.value->>'event_sequence')::integer
      order by (entry.value->>'event_sequence')::integer)
  from jsonb_array_elements(public.get_program_versioned_progress(
    'c3000000-0000-0000-0000-000000000101', null)->'history') as entry(value)),
  array[1,2,3]::integer[], 'an exact retry appends nothing and event sequence remains monotonic');
select is((public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000101', null)->>'lifetime_completed_count')::integer,
  2, 'undo and replay do not double-count lifetime completion identity');
reset role;

-- The member can read their own safe history, but another member cannot choose them as a subject.
insert into public.programs (id, coach_id, title, description, published)
values ('c3000000-0000-0000-0000-000000000104', 'c1000000-0000-0000-0000-000000000002', 'Private Unpublished Secret', '', false);
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000005","role":"authenticated"}';
select is(public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000101', 'c1000000-0000-0000-0000-000000000003'),
  null::jsonb, 'a member cannot read another member progress by supplying their UUID');
select is(public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000101', null),
  null::jsonb, 'an unlinked member cannot inspect another member-free Program by guessing its ID');
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000104', null),
  null::jsonb, 'a linked member cannot inspect unpublished Program metadata without their own enrollment or history');
reset role;

-- Conversion creates the pinned free snapshot and keeps a fence until publish or service recovery.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is(public.snapshot_program_free_content('c3000000-0000-0000-0000-000000000101') is not null,
  true, 'trusted service converts the free curriculum and pins existing enrollments');
select is((select count(*)::integer from public.program_lesson_progress_events event
  where event.subject_member_id='c1000000-0000-0000-0000-000000000003'
    and event.program_id='c3000000-0000-0000-0000-000000000101'
    and event.content_version_id=(select content_version_id from public.program_enrollments
      where program_id='c3000000-0000-0000-0000-000000000101'
        and member_id='c1000000-0000-0000-0000-000000000003')),
  1, 'conversion imports the current completion into the exact pinned snapshot');
select is((select count(*)::integer from public.program_versioning_fences
  where program_id='c3000000-0000-0000-0000-000000000101'), 1,
  'conversion remains fenced until a trusted publish or abort');
select is((select count(*)::integer from public.program_lesson_progress_events event
  where event.subject_member_id='c1000000-0000-0000-0000-000000000003'
    and event.program_id='c3000000-0000-0000-0000-000000000101'
    and event.event_sequence in (1,2,3)), 3, 'snapshot import allocates subject-wide sequence after prior history');
select is((select min(event.occurred_at) from public.program_lesson_progress_events event
  where event.subject_member_id='c1000000-0000-0000-0000-000000000003'
    and event.program_id='c3000000-0000-0000-0000-000000000101'
    and event.content_version_id=(select content_version_id from public.program_enrollments
      where program_id='c3000000-0000-0000-0000-000000000101'
        and member_id='c1000000-0000-0000-0000-000000000003')),
  (select min(completion.completed_at) from public.program_day_completions completion
   join public.program_enrollments enrollment on enrollment.id=completion.enrollment_id
   where enrollment.program_id='c3000000-0000-0000-0000-000000000101'),
  'conversion preserves original completion timestamps');
reset role;

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok(
  $$select public.start_my_program_enrollment('c3000000-0000-0000-0000-000000000101')$$,
  '55P03', null, 'new admission cannot cross the persisted conversion fence');
reset role;

-- Publish a paid revision while fenced, then release atomically. The earlier member keeps the
-- exact free snapshot pointer; a new member cannot be silently enrolled in the paid offer.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
do $$
declare
  snapshot_version uuid;
  paid_version uuid;
  paid_offer uuid;
begin
  select fence.snapshot_content_version_id into snapshot_version
  from public.program_versioning_fences fence
  where fence.program_id='c3000000-0000-0000-0000-000000000101';
  insert into public.program_content_versions (program_id, revision_number, revision_kind, lesson_count, created_by)
  select 'c3000000-0000-0000-0000-000000000101', coalesce(max(revision_number),0)+1,
    'paid', 3, 'c1000000-0000-0000-0000-000000000002'
  from public.program_content_versions where program_id='c3000000-0000-0000-0000-000000000101'
  returning id into paid_version;
  insert into public.program_content_version_lessons (
    program_id, content_version_id, lesson_ordinal, timeline_day_number, source_day_id,
    title, instructions, pillar
  )
  select lesson.program_id, paid_version, lesson.lesson_ordinal, lesson.timeline_day_number,
    lesson.source_day_id, lesson.title, lesson.instructions, lesson.pillar
  from public.program_content_version_lessons lesson
  where lesson.program_id='c3000000-0000-0000-0000-000000000101'
    and lesson.content_version_id=snapshot_version
  order by lesson.lesson_ordinal;
  insert into public.program_offer_versions (
    program_id, offer_number, content_version_id, offer_kind, list_price_cents,
    currency, max_installments, platform_owned, seller_profile_id, connected_account_id, created_by
  )
  select 'c3000000-0000-0000-0000-000000000101', coalesce(max(offer_number),0)+1,
    paid_version, 'paid', 1200, 'usd', 3, false,
    'c1000000-0000-0000-0000-000000000002', 'acct_Gate2Coach', 'c1000000-0000-0000-0000-000000000002'
  from public.program_offer_versions where program_id='c3000000-0000-0000-0000-000000000101'
  returning id into paid_offer;
  update public.program_commerce_state set current_content_version_id=paid_version,
    current_offer_version_id=paid_offer where program_id='c3000000-0000-0000-0000-000000000101';
  if not public.release_program_versioning_fence(
    'c3000000-0000-0000-0000-000000000101', snapshot_version, paid_version, paid_offer
  ) then raise exception 'fixture could not release the conversion fence'; end if;
  perform set_config('test.g2_paid_version', paid_version::text, true);
  perform set_config('test.g2_paid_offer', paid_offer::text, true);
  perform set_config('test.g2_snapshot_version', snapshot_version::text, true);
end $$;
select is((select count(*)::integer from public.program_versioning_fences
  where program_id='c3000000-0000-0000-0000-000000000101'), 0,
  'verified publication releases the fence');
reset role;

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000101', null)->>'mode'),
  'free_snapshot', 'a grandfathered member remains pinned to their free curriculum after publication');
select is((public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000101', null)->>'content_version_id'),
  current_setting('test.g2_snapshot_version'), 'the member never silently moves to the new paid version');
select is((select count(*)::integer from public.program_days
  where program_id='c3000000-0000-0000-0000-000000000101'), 0,
  'converted Program days are hidden from the member raw table path');
reset role;

delete from public.platform_test_entitlements
where member_id='c1000000-0000-0000-0000-000000000003' and tier='regular';
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000101', null)->>'access_authorized')::boolean,
  false, 'expired base membership does not grant access to the pinned free lesson');
select is(jsonb_array_length(public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000101', null)->'required_lessons'),
  3, 'the member can still see immutable safe metadata for their own pinned history');
select is(public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000101', null)->'accessible_lessons',
  '[]'::jsonb, 'expired membership removes all accessible lesson content while preserving history');
reset role;

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok(
  $$select public.start_my_program_enrollment('c3000000-0000-0000-0000-000000000101')$$,
  '42501', 'A paid Program requires a verified purchase', 'members cannot enroll for free after the paid offer is published');
reset role;

-- A separate paid Program exercises Gate 1's canonical paid predicate through the Gate 2 DTO.
insert into public.programs (id, coach_id, title, description, published)
values ('c3000000-0000-0000-0000-000000000102', 'c1000000-0000-0000-0000-000000000002', 'Paid Sparse Program', '', true);
do $$
declare paid_version uuid; paid_offer uuid;
begin
  insert into public.program_content_versions (program_id, revision_number, revision_kind, lesson_count, created_by)
  values ('c3000000-0000-0000-0000-000000000102', 2, 'paid', 3, 'c1000000-0000-0000-0000-000000000002')
  returning id into paid_version;
  insert into public.program_content_version_lessons (
    program_id, content_version_id, lesson_ordinal, timeline_day_number, title, instructions, pillar
  ) values
    ('c3000000-0000-0000-0000-000000000102', paid_version, 1, 1, 'Paid one', 'Paid one instructions', 'body'),
    ('c3000000-0000-0000-0000-000000000102', paid_version, 2, 10, 'Paid ten', 'Paid ten instructions', 'mind'),
    ('c3000000-0000-0000-0000-000000000102', paid_version, 3, 20, 'Paid twenty', 'Paid twenty instructions', 'spirit');
  insert into public.program_offer_versions (
    program_id, offer_number, content_version_id, offer_kind, list_price_cents,
    currency, max_installments, platform_owned, seller_profile_id, connected_account_id, created_by
  ) values ('c3000000-0000-0000-0000-000000000102', 2, paid_version, 'paid', 1200,
    'usd', 3, false, 'c1000000-0000-0000-0000-000000000002', 'acct_Gate2Coach', 'c1000000-0000-0000-0000-000000000002')
  returning id into paid_offer;
  update public.program_commerce_state set current_content_version_id=paid_version,
    current_offer_version_id=paid_offer where program_id='c3000000-0000-0000-0000-000000000102';
  perform set_config('test.g2_order_version', paid_version::text, true);
  perform set_config('test.g2_order_offer', paid_offer::text, true);
end $$;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is(public.create_program_order_reservation(
  'c1000000-0000-0000-0000-000000000004', 'c3000000-0000-0000-0000-000000000102',
  current_setting('test.g2_order_offer')::uuid, 3::smallint, 'gate2-paid-order-001', null
) is not null, true, 'service creates a fixed-total order from the published immutable offer');
select is(public.create_program_order_reservation(
  'c1000000-0000-0000-0000-000000000004', 'c3000000-0000-0000-0000-000000000102',
  current_setting('test.g2_order_offer')::uuid, 3::smallint, 'gate2-paid-order-001', null
), (select id from public.program_orders where idempotency_key='gate2-paid-order-001'),
  'the same trusted request key replays the original order');
select throws_ok(
  $$select public.create_program_order_reservation('c1000000-0000-0000-0000-000000000004', 'c3000000-0000-0000-0000-000000000102', current_setting('test.g2_order_offer')::uuid, 3::smallint, 'gate2-paid-order-002', null)$$,
  'P0001', 'PROGRAM_ALREADY_OWNED_OR_IN_PROGRESS', 'a distinct key cannot create a second collectible order');
select is((select array_agg(due_cents order by installment_number) from public.program_order_installments installment
  join public.program_orders orders on orders.id=installment.order_id
  where orders.idempotency_key='gate2-paid-order-001'), array[400,400,400]::integer[],
  'the three trusted installment amounts still total exactly the effective price');
select is(public.bind_program_checkout_session(
  (select id from public.program_orders where idempotency_key='gate2-paid-order-001'), 0, 'cs_test_gate2paid001'
), true, 'the service binds one exact Checkout session');
select is(public.record_program_installment_payment(
  (select id from public.program_orders where idempotency_key='gate2-paid-order-001'),
  2::smallint, 0::bigint, 'evt_gate2stage2', 'pi_gate2stage2', 'in_gate2stage2', 'ch_gate2stage2',
  'succeeded', 400, 0, 'usd'
), true, 'an out-of-order later installment is retained as financial truth');
select is((select access_started_on from public.program_order_state state
  join public.program_orders orders on orders.id=state.order_id
  where orders.idempotency_key='gate2-paid-order-001'), null::date,
  'a later installment cannot start the timeline while installment one is unpaid');
select is(public.record_program_installment_payment(
  (select id from public.program_orders where idempotency_key='gate2-paid-order-001'),
  1::smallint, 0::bigint, 'evt_gate2stage1', 'pi_gate2stage1', 'in_gate2stage1', 'ch_gate2stage1',
  'succeeded', 400, 0, 'usd'
), true, 'the first full installment begins access on trusted server time');
select is((public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000102', 'c1000000-0000-0000-0000-000000000004')->>'access_authorized')::boolean,
  true, 'an eligible buyer receives authorized paid progress only through the canonical Gate 1 predicate');
select is((public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000102', 'c1000000-0000-0000-0000-000000000004')->>'lesson_ceiling')::integer,
  1, 'paid stage one stays intersected with day one of the Eastern timeline');
select is(jsonb_array_length(public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000102', 'c1000000-0000-0000-0000-000000000004')->'accessible_lesson_ids'),
  1, 'the service projection retains the canonical paid-and-timeline-unlocked lesson ID');
select is(jsonb_array_length(public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000102', 'c1000000-0000-0000-0000-000000000004')->'accessible_lessons'),
  0, 'the service projection does not expose member lesson content');
select is(jsonb_array_length(public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000102', 'c1000000-0000-0000-0000-000000000004')->'required_lessons'),
  3, 'the buyer can see safe labels for their own entire required lesson set');
reset role;
select is(private.program_order_lesson_access_for_member(
  (select id from public.program_orders where idempotency_key='gate2-paid-order-001'),
  'c1000000-0000-0000-0000-000000000004',
  (now() at time zone 'America/New_York')::date + 9
)->>'lesson_ceiling', '2', 'future daily ceiling uses the dense ordinal for the sparse day-ten lesson');
select is(private.program_order_lesson_access_for_member(
  (select id from public.program_orders where idempotency_key='gate2-paid-order-001'),
  'c1000000-0000-0000-0000-000000000005',
  (now() at time zone 'America/New_York')::date + 9
), null::jsonb, 'a different buyer cannot borrow the order''s paid access');

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(jsonb_array_length(public.get_program_versioned_progress(
  'c3000000-0000-0000-0000-000000000102', null)->'accessible_lessons'),
  1, 'the authenticated buyer can read the currently paid-and-timeline-unlocked lesson content');
select throws_ok(
  $$select public.set_my_program_lesson_state('c3000000-0000-0000-0000-000000000102', ((public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000102', null)->'required_lessons'->1->>'id')::uuid), true, 'c5000000-0000-0000-0000-000000000105')$$,
  '42501', null, 'a paid lesson cannot be completed ahead of its current timeline or paid ceiling');
select is(public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000102', 'c1000000-0000-0000-0000-000000000003'),
  null::jsonb, 'a member cannot request another buyer''s paid progress');
reset role;

-- Staff summaries are scoped to the currently owned Program, and service activity is paged and
-- contains only completed-once identity/pillar facts, never lesson instructions or media.
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(jsonb_array_length(public.list_program_progress_summaries(
  1, 20, 'c3000000-0000-0000-0000-000000000101', null)->'rows'), 1,
  'the current coach sees a per-member summary scoped to their Program');
select is(public.list_program_progress_summaries(1, 20, 'c3000000-0000-0000-0000-000000000102', 'c1000000-0000-0000-0000-000000000003'),
  jsonb_build_object('page', 1, 'rows', '[]'::jsonb, 'has_more', false, 'page_size', 20),
  'the coach gets an empty page with no unrelated member data for another Program');
reset role;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is(jsonb_array_length(public.list_program_completed_once_activity(
  null, now() + interval '1 day', array['c1000000-0000-0000-0000-000000000003']::uuid[],
  'c3000000-0000-0000-0000-000000000101', 0, 20)->'rows'), 2,
  'service all-time activity accepts a null lower bound and returns unique lesson identities');
select is(jsonb_array_length(public.get_program_reminder_candidates(
  array['c1000000-0000-0000-0000-000000000004']::uuid[],
  (now() at time zone 'America/New_York')::date, 0, 20)->'rows'), 1,
  'service reminders select the currently eligible unfinished paid lesson');
select ok(not (public.get_program_reminder_candidates(
  array['c1000000-0000-0000-0000-000000000004']::uuid[],
  (now() at time zone 'America/New_York')::date, 0, 20)->'rows'->0 ? 'instructions'),
  'service reminder rows contain no instruction text');
reset role;

-- Deletion of the enrolled member nulls only the live owner link. Event identity remains as an
-- audit fact and cannot grant a deleted account content or a successor account history.
delete from auth.users where id='c1000000-0000-0000-0000-000000000003';
select ok((select count(*) > 0 from public.program_lesson_progress_events event
  where event.subject_member_id='c1000000-0000-0000-0000-000000000003'
    and event.program_id='c3000000-0000-0000-0000-000000000101'),
  'account deletion retains immutable per-subject event facts');
select is((select count(*)::integer from public.program_lesson_progress_events event
  where event.subject_member_id='c1000000-0000-0000-0000-000000000003'
    and event.owner_member_id is null), 4,
  'account deletion clears every live owner link without cascading history');
select ok(not exists (select 1 from public.program_enrollments enrollment
  where enrollment.member_id='c1000000-0000-0000-0000-000000000003'),
  'account deletion removes its mutable enrollment row');

-- A free Program can be hard-deleted while its immutable completion history remains available
-- only as safe self-history; this does not retain lesson instructions or access.
insert into public.programs (id, coach_id, title, description, published)
values ('c3000000-0000-0000-0000-000000000103', 'c1000000-0000-0000-0000-000000000002', 'Deleted Free Program', '', true);
insert into public.program_days (id, program_id, day_number, title, instructions, pillar)
values ('c4000000-0000-0000-0000-000000000103', 'c3000000-0000-0000-0000-000000000103', 1, 'Retained history title', 'Private instructions', 'body');
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000004","role":"authenticated"}';
select lives_ok($$select public.start_my_program_enrollment('c3000000-0000-0000-0000-000000000103')$$,
  'another active member starts the free Program');
select lives_ok($$select public.set_my_program_lesson_state('c3000000-0000-0000-0000-000000000103', 'c4000000-0000-0000-0000-000000000103', true, 'c5000000-0000-0000-0000-000000000106')$$,
  'the member creates one immutable completion fact before Program deletion');
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok($$select public.delete_owned_program('c3000000-0000-0000-0000-000000000103')$$,
  'the coach can delete a free Program with no paid order');
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000103', null)->>'mode',
  'history_only', 'deleted Program history remains detached and non-entitling');
select is(public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000103', null)->>'program_title',
  'Deleted Free Program', 'retained history uses its immutable Program title snapshot');
select is(public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000103', null)->'accessible_lessons',
  '[]'::jsonb, 'deleted Program history has no accessible lesson content');
select is(public.get_program_versioned_progress('c3000000-0000-0000-0000-000000000103', null)->'required_lessons',
  '[]'::jsonb, 'deleted Program history does not reconstruct or reveal deleted lesson content');
reset role;

select * from finish();
rollback;
