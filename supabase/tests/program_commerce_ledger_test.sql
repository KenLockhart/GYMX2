begin;
select no_plan();

-- Additional isolated buyers let the test exercise separate orders without weakening the
-- Gate 1 one-order-per-buyer/program fence.
insert into auth.users (id, email, raw_user_meta_data) values
  ('e1000000-0000-0000-0000-000000000007', 'ledger-member-7@example.test', '{"display_name":"Ledger Member 7"}'),
  ('e1000000-0000-0000-0000-000000000008', 'ledger-member-8@example.test', '{"display_name":"Ledger Member 8"}'),
  ('e1000000-0000-0000-0000-000000000009', 'ledger-member-9@example.test', '{"display_name":"Ledger Member 9"}'),
  ('e1000000-0000-0000-0000-000000000010', 'ledger-member-10@example.test', '{"display_name":"Ledger Member 10"}'),
  ('e1000000-0000-0000-0000-000000000011', 'ledger-member-11@example.test', '{"display_name":"Ledger Member 11"}'),
  ('e1000000-0000-0000-0000-000000000012', 'ledger-member-12@example.test', '{"display_name":"Ledger Member 12"}');

select ok(not has_table_privilege('anon', 'public.program_orders', 'select'), 'anonymous visitors cannot read Program orders');
select ok(not has_table_privilege('authenticated', 'public.program_orders', 'select'), 'members cannot read the private order ledger directly');
select ok(not has_table_privilege('authenticated', 'public.program_order_installments', 'insert'), 'members cannot create payment rows');
select ok(not has_table_privilege('authenticated', 'public.program_promotion_reservations', 'select'), 'promotion reservations remain private');
select ok(has_table_privilege('service_role', 'public.program_orders', 'insert'), 'trusted server role can create immutable orders');
select ok(not has_function_privilege('authenticated', 'public.create_program_order_reservation(uuid,uuid,uuid,smallint,text,text)', 'execute'), 'clients cannot create order reservations');
select ok(has_function_privilege('service_role', 'public.create_program_order_reservation(uuid,uuid,uuid,smallint,text,text)', 'execute'), 'server role can create order reservations');
select ok(not has_function_privilege('authenticated', 'public.record_program_installment_payment(uuid,smallint,bigint,text,text,text,text,text,integer,integer,text)', 'execute'), 'clients cannot write payment snapshots');
select ok(not has_function_privilege('authenticated', 'public.record_program_refund_marker(uuid,smallint,bigint,text,text,text,text,integer)', 'execute'), 'clients cannot write refund markers');
select ok(has_function_privilege('authenticated', 'public.get_my_program_order_summaries()', 'execute'), 'buyers can access their safe billing summary after plan expiry');
select ok(has_function_privilege('authenticated', 'public.get_my_program_order_lesson_access(uuid)', 'execute'), 'member access goes through the single order entitlement predicate');
select ok(not has_function_privilege('authenticated', 'private.program_order_lesson_access_for_member(uuid,uuid,date)', 'execute'), 'members cannot choose an access date or another member for the internal predicate');

insert into public.platform_test_entitlements (member_id, tier, grant_reason, granted_by)
values
  ('e1000000-0000-0000-0000-000000000003', 'regular', 'Synthetic Program ledger test', 'e1000000-0000-0000-0000-000000000002'),
  ('e1000000-0000-0000-0000-000000000005', 'regular', 'Synthetic Program ledger test', 'e1000000-0000-0000-0000-000000000002'),
  ('e1000000-0000-0000-0000-000000000007', 'regular', 'Synthetic Program ledger test', 'e1000000-0000-0000-0000-000000000002'),
  ('e1000000-0000-0000-0000-000000000008', 'regular', 'Synthetic Program ledger test', 'e1000000-0000-0000-0000-000000000002'),
  ('e1000000-0000-0000-0000-000000000009', 'regular', 'Synthetic Program ledger test', 'e1000000-0000-0000-0000-000000000002'),
  ('e1000000-0000-0000-0000-000000000010', 'regular', 'Synthetic Program ledger test', 'e1000000-0000-0000-0000-000000000002'),
  ('e1000000-0000-0000-0000-000000000011', 'regular', 'Synthetic Program ledger test', 'e1000000-0000-0000-0000-000000000002'),
  ('e1000000-0000-0000-0000-000000000012', 'regular', 'Synthetic Program ledger test', 'e1000000-0000-0000-0000-000000000002');
update public.profiles set role = 'member'
where id in (
  'e1000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000008',
  'e1000000-0000-0000-0000-000000000009', 'e1000000-0000-0000-0000-000000000010',
  'e1000000-0000-0000-0000-000000000011', 'e1000000-0000-0000-0000-000000000012'
);
insert into public.coach_members (coach_id, member_id) values
  ('e1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000005'),
  ('e1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000007'),
  ('e1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000008'),
  ('e1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000009'),
  ('e1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000010'),
  ('e1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000011'),
  ('e1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000012')
on conflict (coach_id, member_id) do nothing;

insert into public.programs (id, coach_id, title, description, published)
values ('e3000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000002', 'Ledger test program', '', true);
insert into public.program_content_versions (id, program_id, revision_number, revision_kind, lesson_count, created_by)
values ('e6000000-0000-0000-0000-000000000010', 'e3000000-0000-0000-0000-000000000005', 2, 'paid', 3, 'e1000000-0000-0000-0000-000000000002');
insert into public.program_content_version_lessons (
  program_id, content_version_id, lesson_ordinal, timeline_day_number, title, instructions, pillar
) values
  ('e3000000-0000-0000-0000-000000000005', 'e6000000-0000-0000-0000-000000000010', 1, 1, 'Ledger one', '', 'body'),
  ('e3000000-0000-0000-0000-000000000005', 'e6000000-0000-0000-0000-000000000010', 2, 2, 'Ledger two', '', 'mind'),
  ('e3000000-0000-0000-0000-000000000005', 'e6000000-0000-0000-0000-000000000010', 3, 3, 'Ledger three', '', 'spirit');
insert into public.program_offer_versions (
  id, program_id, offer_number, content_version_id, offer_kind, list_price_cents,
  currency, max_installments, platform_owned, seller_profile_id, connected_account_id, created_by
) values (
  'e7000000-0000-0000-0000-000000000010', 'e3000000-0000-0000-0000-000000000005', 2,
  'e6000000-0000-0000-0000-000000000010', 'paid', 1200, 'usd', 3, false,
  'e1000000-0000-0000-0000-000000000002', 'acct_ledgercoach1', 'e1000000-0000-0000-0000-000000000002'
);
update public.program_commerce_state
set current_content_version_id = 'e6000000-0000-0000-0000-000000000010',
    current_offer_version_id = 'e7000000-0000-0000-0000-000000000010'
where program_id = 'e3000000-0000-0000-0000-000000000005';
insert into public.program_promotions (
  id, program_id, offer_version_id, code, discount_kind, discount_value, max_redemptions, created_by
) values
  ('e8000000-0000-0000-0000-000000000010', 'e3000000-0000-0000-0000-000000000005', 'e7000000-0000-0000-0000-000000000010', 'CAP1', 'fixed', 100, 1, 'e1000000-0000-0000-0000-000000000002'),
  ('e8000000-0000-0000-0000-000000000011', 'e3000000-0000-0000-0000-000000000005', 'e7000000-0000-0000-0000-000000000010', 'FREE100', 'percent', 10000, 1, 'e1000000-0000-0000-0000-000000000002'),
  ('e8000000-0000-0000-0000-000000000012', 'e3000000-0000-0000-0000-000000000005', 'e7000000-0000-0000-0000-000000000010', 'PCT25', 'percent', 2500, 10, 'e1000000-0000-0000-0000-000000000002');

set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';

select ok(public.create_program_order_reservation(
  'e1000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-000000000005',
  'e7000000-0000-0000-0000-000000000010', 3::smallint, 'stage-order-request-001', null
) is not null, 'eligible linked member receives a server-calculated fixed-total order');
select is((select installment_amounts_cents from public.program_orders where idempotency_key = 'stage-order-request-001'), array[400,400,400]::integer[], 'server assigns installments whose sum equals the immutable total');
select is((select sum(due_cents)::integer from public.program_order_installments i join public.program_orders o on o.id = i.order_id where o.idempotency_key = 'stage-order-request-001'), 1200, 'installment terms sum to the fixed total');
select is((select access_started_on from public.program_order_state s join public.program_orders o on o.id = s.order_id where o.idempotency_key = 'stage-order-request-001'), null::date, 'an uncompleted Checkout intent does not start the access timeline');
do $$ begin
  perform set_config('test.stage_order_id', (select id::text from public.program_orders where idempotency_key = 'stage-order-request-001'), true);
  perform set_config('test.first_lesson_json', (
    select jsonb_build_array(lesson.id)::text from public.program_content_version_lessons lesson
    where lesson.program_id = 'e3000000-0000-0000-0000-000000000005'
      and lesson.content_version_id = 'e6000000-0000-0000-0000-000000000010'
      and lesson.lesson_ordinal = 1
  ), true);
end $$;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(public.get_my_program_order_lesson_access(current_setting('test.stage_order_id')::uuid), null::jsonb, 'unpaid order has no canonical lesson access before the trusted start date');
select is((select fully_funded from public.get_my_program_order_summaries() where order_id = current_setting('test.stage_order_id')::uuid), false, 'unpaid safe summary reports not fully funded');
reset role;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is(public.create_program_order_reservation(
  'e1000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-000000000005',
  'e7000000-0000-0000-0000-000000000010', 3::smallint, 'stage-order-request-001', null
), (select id from public.program_orders where idempotency_key = 'stage-order-request-001'), 'same buyer request key returns its original order');
select is((select count(*)::integer from public.program_orders where idempotency_key = 'stage-order-request-001'), 1, 'idempotent order creation never creates a duplicate');
select throws_ok(
  $$select public.create_program_order_reservation('e1000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-000000000005', 'e7000000-0000-0000-0000-000000000010', 3::smallint, 'second-stage-request-01', null)$$,
  'P0001', 'PROGRAM_ALREADY_OWNED_OR_IN_PROGRESS', 'a different request key cannot create a second collectible order for the same buyer and Program'
);
select throws_ok(
  $$select public.create_program_order_reservation('e1000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000005', 'e7000000-0000-0000-0000-000000000010', 1::smallint, 'coach-order-request-01', null)$$,
  '42501', null, 'a coach cannot buy a Program through the member order path'
);
select throws_ok(
  $$select public.create_program_order_reservation('e1000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-000000000005', 'e7000000-0000-0000-0000-000000000010', 2::smallint, 'stage-order-request-001', null)$$,
  '23505', null, 'reusing an order idempotency key with different terms is rejected'
);

select ok(public.record_program_installment_payment(
  (select id from public.program_orders where idempotency_key = 'stage-order-request-001'),
  3::smallint, 0::bigint, 'evt_program_stage_3', 'pi_program_stage_3', 'in_program_stage_3', 'ch_program_stage_3', 'succeeded', 400, 0, 'usd'
), 'out-of-order later installment is recorded as financial truth');
select is((select access_started_on from public.program_order_state s join public.program_orders o on o.id = s.order_id where o.idempotency_key = 'stage-order-request-001'), null::date, 'an out-of-order later payment cannot start the access timeline');
select is((select net_settled_cents from public.program_order_installments i join public.program_orders o on o.id = i.order_id where o.idempotency_key = 'stage-order-request-001' and i.installment_number = 3), 400, 'the late installment payment remains in the ledger');
select ok(public.record_program_installment_payment(
  (select id from public.program_orders where idempotency_key = 'stage-order-request-001'),
  1::smallint, 0::bigint, 'evt_program_stage_1', 'pi_program_stage_1', 'in_program_stage_1', 'ch_program_stage_1', 'succeeded', 400, 0, 'usd'
), 'first full installment is accepted at expected revision zero');
select is((select access_started_on from public.program_order_state s join public.program_orders o on o.id = s.order_id where o.idempotency_key = 'stage-order-request-001'), (now() at time zone 'America/New_York')::date, 'first cleared installment sets the daily timeline using server time');

do $$ begin
  perform set_config('test.stage_order_id', (select id::text from public.program_orders where idempotency_key = 'stage-order-request-001'), true);
end $$;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((public.get_my_program_order_lesson_access(current_setting('test.stage_order_id')::uuid)->>'paid_lesson_ceiling')::integer, 1, 'only the first contiguous paid stage clears');
select is(public.get_my_program_order_lesson_access(current_setting('test.stage_order_id')::uuid)->>'fully_funded', 'false', 'part-paid canonical access remains not fully funded');
select is((public.get_my_program_order_lesson_access(current_setting('test.stage_order_id')::uuid)->>'lesson_ceiling')::integer, 1, 'the paid stage remains intersected with the ordinary daily timeline');
select is((select fully_funded from public.get_my_program_order_summaries() where order_id = current_setting('test.stage_order_id')::uuid), false, 'part-paid safe summary reports not fully funded');
select is(public.get_my_program_order_lesson_access(current_setting('test.stage_order_id')::uuid)->>'lesson_ids',
  current_setting('test.first_lesson_json'),
  'only the exact immutable lesson ID in the open stage is returned');
select throws_ok('select * from public.program_orders', '42501', null, 'members cannot read other order identities or payment-provider fields');
select throws_ok(
  $$select public.create_program_order_reservation('e1000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-000000000005', 'e7000000-0000-0000-0000-000000000010', 1::smallint, 'client-order-request-01', null)$$,
  '42501', null, 'authenticated clients cannot create a financial reservation'
);
reset role;

set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select ok(not public.record_program_installment_payment(
  current_setting('test.stage_order_id')::uuid,
  2::smallint, 0::bigint, 'evt_program_reused_pi_ordinal', 'pi_program_stage_1', null, null, 'requires_payment_method', 0, 0, 'usd'
), 'one PaymentIntent cannot fund a different installment ordinal');
select ok(not public.record_program_installment_payment(
  current_setting('test.stage_order_id')::uuid,
  1::smallint, 1::bigint, 'evt_program_replacement_pi', 'pi_program_stage_1_replacement', 'in_program_stage_1_replacement', 'ch_program_stage_1_replacement', 'succeeded', 400, 0, 'usd'
), 'a second PaymentIntent cannot replace the immutable claim for a paid installment');
select is((select count(*)::integer from public.program_payment_intent_claims where order_id = current_setting('test.stage_order_id')::uuid and installment_number = 1), 1, 'rejected PaymentIntent replacement leaves the canonical claim unchanged');
select is((select net_settled_cents from public.program_order_installments where order_id = current_setting('test.stage_order_id')::uuid and installment_number = 1), 400, 'rejected PaymentIntent replacement cannot change accepted balance');
select ok(not exists (select 1 from public.program_payment_events where provider_event_id = 'evt_program_replacement_pi'), 'rejected PaymentIntent replacement leaves no accepted event');
select ok(not exists (select 1 from public.program_provider_object_claims where object_id in ('in_program_stage_1_replacement', 'ch_program_stage_1_replacement')), 'rejected PaymentIntent replacement leaves no provider aliases');
select ok(not public.record_program_installment_payment(
  current_setting('test.stage_order_id')::uuid,
  1::smallint, 0::bigint, 'evt_program_stale_1', 'pi_program_stale_1', null, null, 'succeeded', 400, 0, 'usd'
), 'stale payment snapshots fail CAS without changing settled state');
select ok(public.record_program_installment_payment(
  current_setting('test.stage_order_id')::uuid,
  2::smallint, 0::bigint, 'evt_program_stage_2', 'pi_program_stage_2', 'in_program_stage_2', 'ch_program_stage_2', 'succeeded', 400, 0, 'usd'
), 'the missing contiguous installment can settle');
select ok(public.record_program_installment_payment(
  current_setting('test.stage_order_id')::uuid,
  2::smallint, 1::bigint, 'evt_program_stage_2', 'pi_program_stage_2', 'in_program_stage_2', 'ch_program_stage_2', 'succeeded', 400, 0, 'usd'
), 'an exact event replay is idempotently acknowledged');
select ok(not public.record_program_installment_payment(
  current_setting('test.stage_order_id')::uuid,
  2::smallint, 1::bigint, 'evt_program_stage_2', 'pi_program_stage_2', 'in_program_stage_2', 'ch_program_stage_2', 'succeeded', 401, 0, 'usd'
), 'an event ID replay with changed amount is rejected');
select is((select billing_state from public.program_order_state s join public.program_orders o on o.id = s.order_id where o.idempotency_key = 'stage-order-request-001'), 'paid', 'order state becomes paid only after all installment net amounts clear');
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(public.get_my_program_order_lesson_access(current_setting('test.stage_order_id')::uuid)->>'paid_lesson_ceiling', '3', 'full net settlement lifts the payment-stage cap');
select is(public.get_my_program_order_lesson_access(current_setting('test.stage_order_id')::uuid)->>'fully_funded', 'true', 'fully paid canonical access reports funded');
select is((select fully_funded from public.get_my_program_order_summaries() where order_id = current_setting('test.stage_order_id')::uuid), true, 'fully paid safe summary reports funded');
reset role;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';

select ok(public.create_program_order_reservation(
  'e1000000-0000-0000-0000-000000000005', 'e3000000-0000-0000-0000-000000000005',
  'e7000000-0000-0000-0000-000000000010', 1::smallint, 'refund-order-request-01', null
) is not null, 'refund-order fixture is created');
select ok(not public.record_program_installment_payment(
  (select id from public.program_orders where idempotency_key = 'refund-order-request-01'),
  1::smallint, 0::bigint, 'evt_program_reused_pi_order', 'pi_program_stage_1', null, null, 'succeeded', 1200, 0, 'usd'
), 'one PaymentIntent cannot fund a second order');
select ok(not public.record_program_installment_payment(
  (select id from public.program_orders where idempotency_key = 'refund-order-request-01'),
  1::smallint, 0::bigint, 'evt_program_reused_invoice', 'pi_program_refund_order', 'in_program_stage_1', null, 'succeeded', 1200, 0, 'usd'
), 'an invoice alias cannot be reassigned to a different PaymentIntent or order');
select ok(public.record_program_refund_marker(
  (select id from public.program_orders where idempotency_key = 'refund-order-request-01'),
  1::smallint, 0::bigint, 'evt_program_refund_first', 're_program_partial_1', 'pi_program_refund_order', 'ch_program_refund_1', 600
), 'refund-first marker is recorded before the paid snapshot');
select ok(public.record_program_refund_marker(
  (select id from public.program_orders where idempotency_key = 'refund-order-request-01'),
  1::smallint, 0::bigint, 'evt_program_refund_first', 're_program_partial_1', 'pi_program_refund_order', 'ch_program_refund_1', 600
), 'an exact refund event replay is idempotently acknowledged');
select ok(not public.record_program_refund_marker(
  (select id from public.program_orders where idempotency_key = 'refund-order-request-01'),
  1::smallint, 1::bigint, 'evt_program_refund_replacement_pi', 're_program_refund_replacement_pi', 'pi_program_refund_replacement', 'ch_program_refund_replacement', 100
), 'refund-first installment cannot be rebound to a second PaymentIntent');
select is((select count(*)::integer from public.program_payment_intent_claims where order_id = (select id from public.program_orders where idempotency_key = 'refund-order-request-01') and installment_number = 1), 1, 'rejected refund-first replacement leaves its original PaymentIntent claim');
select is((select count(*)::integer from public.program_refund_markers where order_id = (select id from public.program_orders where idempotency_key = 'refund-order-request-01') and installment_number = 1), 1, 'rejected refund-first replacement leaves its refund balance unchanged');
select ok(not exists (select 1 from public.program_payment_events where provider_event_id = 'evt_program_refund_replacement_pi'), 'rejected refund-first replacement leaves no accepted event');
select ok(not exists (select 1 from public.program_provider_object_claims where object_id = 'ch_program_refund_replacement'), 'rejected refund-first replacement leaves no charge alias');
select ok(not public.record_program_refund_marker(
  (select id from public.program_orders where idempotency_key = 'refund-order-request-01'),
  1::smallint, 1::bigint, 'evt_program_refund_charge_conflict', 're_program_charge_conflict', 'pi_program_refund_order', 'ch_program_stage_1', 100
), 'a charge claimed by another order cannot be reused for a refund');
select ok(not public.record_program_installment_payment(
  (select id from public.program_orders where idempotency_key = 'refund-order-request-01'),
  1::smallint, 0::bigint, 'evt_program_paid_stale', 'pi_program_refund_order', null, 'ch_program_refund_1', 'succeeded', 1200, 0, 'usd'
), 'the stale paid snapshot loses CAS to the refund marker');
select ok(public.record_program_installment_payment(
  (select id from public.program_orders where idempotency_key = 'refund-order-request-01'),
  1::smallint, 1::bigint, 'evt_program_paid_after_refund', 'pi_program_refund_order', null, 'ch_program_refund_1', 'succeeded', 1200, 0, 'usd'
), 'the current paid snapshot is retained after the refund marker');
select is((select net_settled_cents from public.program_order_installments i join public.program_orders o on o.id = i.order_id where o.idempotency_key = 'refund-order-request-01'), 600, 'refund-first amount remains deducted from later paid state');
select is((select access_started_on from public.program_order_state s join public.program_orders o on o.id = s.order_id where o.idempotency_key = 'refund-order-request-01'), null::date, 'a partially refunded first payment never starts access');

select ok(public.create_program_order_reservation(
  'e1000000-0000-0000-0000-000000000007', 'e3000000-0000-0000-0000-000000000005',
  'e7000000-0000-0000-0000-000000000010', 0::smallint, 'free-grant-request-001', 'FREE100'
) is not null, 'a 100 percent promotion creates a no-charge audited grant');
select is((select count(*)::integer from public.program_order_installments i join public.program_orders o on o.id = i.order_id where o.idempotency_key = 'free-grant-request-001'), 0, 'zero-total grants create no payment installments');
select is((select state.access_started_on is not null and state.billing_state = 'free_grant' from public.program_order_state state join public.program_orders o on o.id = state.order_id where o.idempotency_key = 'free-grant-request-001'), true, 'zero-total redemption starts its timeline atomically');
select is((select count(*)::integer from public.program_promotion_redemptions redemption join public.program_orders orders on orders.id = redemption.order_id where orders.idempotency_key = 'free-grant-request-001'), 1, 'zero-total promotion use is recorded once');
do $$ begin
  perform set_config('test.free_order_id', (select id::text from public.program_orders where idempotency_key = 'free-grant-request-001'), true);
end $$;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000007","role":"authenticated"}';
select is(public.get_my_program_order_lesson_access(current_setting('test.free_order_id')::uuid)->>'paid_lesson_ceiling', '3', 'verified 100 percent promotion grants the full paid ceiling without a charge');
select is(public.get_my_program_order_lesson_access(current_setting('test.free_order_id')::uuid)->>'fully_funded', 'true', 'zero-total grant public access reports fully funded');
select is((select fully_funded from public.get_my_program_order_summaries() where order_id = current_setting('test.free_order_id')::uuid), true, 'zero-total grant safe summary reports fully funded');
reset role;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';

select ok(public.create_program_order_reservation(
  'e1000000-0000-0000-0000-000000000008', 'e3000000-0000-0000-0000-000000000005',
  'e7000000-0000-0000-0000-000000000010', 1::smallint, 'promo-cap-order-001', 'CAP1'
) is not null, 'first promo order atomically holds a global quota slot');
select is((select discount_cents from public.program_orders where idempotency_key = 'promo-cap-order-001'), 100, 'partial fixed promotion discount is snapshotted');
select is((select effective_total_cents from public.program_orders where idempotency_key = 'promo-cap-order-001'), 1100, 'partial fixed promotion leaves the correct fixed total');
do $$ begin
  perform set_config('test.other_order_id', (select id::text from public.program_orders where idempotency_key = 'promo-cap-order-001'), true);
end $$;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(public.get_my_program_order_lesson_access(current_setting('test.other_order_id')::uuid), null::jsonb, 'a buyer cannot use another member’s order ID');
reset role;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select throws_ok(
  $$select public.create_program_order_reservation('e1000000-0000-0000-0000-000000000008', 'e3000000-0000-0000-0000-000000000005', 'e7000000-0000-0000-0000-000000000010', 1::smallint, 'promo-member-repeat-01', 'CAP1')$$,
  'P0001', 'PROGRAM_ALREADY_OWNED_OR_IN_PROGRESS', 'one member cannot create another collectible order for the same Program'
);
select throws_ok(
  $$select public.create_program_order_reservation('e1000000-0000-0000-0000-000000000009', 'e3000000-0000-0000-0000-000000000005', 'e7000000-0000-0000-0000-000000000010', 1::smallint, 'promo-cap-overflow-01', 'CAP1')$$,
  '23505', null, 'global promotion quota includes open reservations'
);
select ok(public.bind_program_checkout_session(
  (select id from public.program_orders where idempotency_key = 'promo-cap-order-001'), 0::bigint, 'cs_test_program_cap1'
), 'test-mode Checkout Session IDs with underscore segments bind idempotently');
select ok(not public.release_program_promotion_reservation(
  (select id from public.program_orders where idempotency_key = 'promo-cap-order-001'), 1::bigint, 'cs_test_program_other', 'expired'
), 'a different Session cannot release the reserved promo quota');
select ok(not public.release_program_promotion_reservation(
  (select id from public.program_orders where idempotency_key = 'promo-cap-order-001'), 1::bigint, 'cs_test_program_cap1', 'timeout'
), 'a local timeout is not terminal-provider evidence');
select ok(public.release_program_promotion_reservation(
  (select id from public.program_orders where idempotency_key = 'promo-cap-order-001'), 1::bigint, 'cs_test_program_cap1', 'expired'
), 'only exact verified terminal unpaid Session state releases the reservation');
select is((select state from public.program_promotion_reservations reservation join public.program_orders orders on orders.id = reservation.order_id where orders.idempotency_key = 'promo-cap-order-001'), 'released', 'expired reservation remains auditable and releases its quota');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'program_promotion_reservations' and column_name in ('expires_at', 'ttl')), 'local TTL cannot release a promotion reservation');
select ok(public.create_program_order_reservation(
  'e1000000-0000-0000-0000-000000000010', 'e3000000-0000-0000-0000-000000000005',
  'e7000000-0000-0000-0000-000000000010', 1::smallint, 'promo-cap-retry-001', 'CAP1'
) is not null, 'a different buyer may reserve released quota after verified expiry');
select ok(public.bind_program_checkout_session(
  (select id from public.program_orders where idempotency_key = 'promo-cap-retry-001'), 0::bigint, 'cs_live_program_retry_1'
), 'live-mode Checkout Session IDs with underscore segments bind');
select is((select checkout_session_id from public.program_order_state state join public.program_orders orders on orders.id = state.order_id where orders.idempotency_key = 'promo-cap-retry-001'), 'cs_live_program_retry_1', 'live Session ID remains the exact bound value');

select ok(public.create_program_order_reservation(
  'e1000000-0000-0000-0000-000000000012', 'e3000000-0000-0000-0000-000000000005',
  'e7000000-0000-0000-0000-000000000010', 1::smallint, 'promo-percent-order-001', 'PCT25'
) is not null, 'partial percentage promotion creates a bounded order');
select is((select discount_cents from public.program_orders where idempotency_key = 'promo-percent-order-001'), 300, 'partial percentage promotion applies its exact discount');
select is((select effective_total_cents from public.program_orders where idempotency_key = 'promo-percent-order-001'), 900, 'partial percentage promotion preserves the discounted fixed total');

select throws_ok(
  $$update public.program_orders set discount_cents = 1 where idempotency_key = 'stage-order-request-001'$$,
  '55000', null, 'immutable order quote cannot be edited after creation'
);
select throws_ok(
  $$update public.program_order_installments set due_cents = 1 where order_id = current_setting('test.stage_order_id')::uuid and installment_number = 1$$,
  '55000', null, 'immutable installment due amount cannot be edited'
);

select ok(public.create_program_order_reservation(
  'e1000000-0000-0000-0000-000000000011', 'e3000000-0000-0000-0000-000000000005',
  'e7000000-0000-0000-0000-000000000010', 1::smallint, 'delete-fence-order-001', null
) is not null, 'deletion fence fixture order is created');
insert into public.platform_membership_deletion_locks (member_id)
values ('e1000000-0000-0000-0000-000000000011') on conflict (member_id) do nothing;
select throws_ok(
  $$select public.create_program_order_reservation('e1000000-0000-0000-0000-000000000011', 'e3000000-0000-0000-0000-000000000005', 'e7000000-0000-0000-0000-000000000010', 1::smallint, 'delete-fence-order-001', null)$$,
  '55000', 'Program order is blocked while account deletion is pending', 'a deletion tombstone blocks even an exact order-key replay from starting a new checkout'
);
select ok(not public.bind_program_checkout_session(
  (select id from public.program_orders where idempotency_key = 'delete-fence-order-001'), 0::bigint, 'cs_program_deleted_member'
), 'the shared membership deletion tombstone blocks a late Session bind');
select ok(public.record_program_installment_payment(
  (select id from public.program_orders where idempotency_key = 'delete-fence-order-001'),
  1::smallint, 0::bigint, 'evt_deleted_member_paid', 'pi_program_deleted_member', null, null, 'succeeded', 1200, 0, 'usd'
), 'a verified late payment remains auditable after deletion while its access stays fenced');
do $$ begin
  perform set_config('test.deleted_order_id', (select id::text from public.program_orders where idempotency_key = 'delete-fence-order-001'), true);
end $$;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000011","role":"authenticated"}';
select is(public.get_my_program_order_lesson_access(current_setting('test.deleted_order_id')::uuid), null::jsonb, 'the deletion tombstone prevents access after a late verified settlement');

reset role;
delete from public.platform_membership_deletion_locks where member_id = 'e1000000-0000-0000-0000-000000000011';
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
update public.platform_test_entitlements set revoked_at = now()
where member_id = 'e1000000-0000-0000-0000-000000000003' and revoked_at is null;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(public.get_my_program_order_lesson_access(current_setting('test.stage_order_id')::uuid), null::jsonb, 'expired membership removes new paid lesson access');
select ok((select count(*)::integer > 0 from public.get_my_program_order_summaries()), 'own billing summary remains available after membership expires');
select is((select count(*)::integer from public.get_my_program_order_summaries() where order_id = current_setting('test.other_order_id')::uuid), 0, 'billing summary never exposes another member’s order');
select * from finish();
rollback;
