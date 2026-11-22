begin;
select plan(48);

insert into auth.users(id,email,raw_user_meta_data) values
 ('98000000-0000-0000-0000-000000000001','terminal-admin@example.test','{"display_name":"Terminal Admin"}'),
 ('98000000-0000-0000-0000-000000000002','terminal-coach@example.test','{"display_name":"Terminal Coach"}'),
 ('98000000-0000-0000-0000-000000000003','terminal-member@example.test','{"display_name":"Terminal Member"}');
update public.profiles set role='admin' where id='98000000-0000-0000-0000-000000000001';
update public.profiles set role='coach' where id='98000000-0000-0000-0000-000000000002';

select ok((select relrowsecurity from pg_class where oid='public.feature_checkout_terminal_attestations'::regclass),
  'terminal evidence table has row-level security enabled');

set local role authenticated;
set local request.jwt.claims='{"sub":"98000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok(
  $$select count(*) from public.feature_checkout_terminal_attestations$$,
  '42501',null,'authenticated members cannot read terminal evidence'
);
select throws_ok(
  $$select public.record_form_coach_checkout_expired_session(
    '99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000011',
    'cs_test_denied','cus_terminal','expired','unpaid','payment','{}'::jsonb,'price_terminal',1,repeat('a',64))$$,
  '42501',null,'authenticated members cannot reconcile provider terminal evidence'
);
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"98000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.admin_create_feature_pricing_revision(
  'form_coach',1,'live','coach','per_assessment','USD','Form Coach','Terminal test','',0,0,
  '[{"price_key":"pack","amount_cents":2500,"currency":"USD","interval":null,"credits_per_pack":5,"stripe_product_id":"prod_terminal","stripe_price_id":"price_terminal"}]'::jsonb
),2::bigint,'test pricing revision uses a frozen synthetic pack Price');
reset role;

create function pg_temp.test_terminal(
  p_request_id uuid,
  p_session_id text,
  p_customer_id text default 'cus_terminal',
  p_session_status text default 'expired',
  p_payment_status text default 'unpaid',
  p_mode text default 'payment',
  p_price_id text default 'price_terminal',
  p_quantity integer default 1,
  p_digest text default repeat('a',64),
  p_metadata jsonb default null
)
returns text language plpgsql as $$
declare reservation public.feature_checkout_reservations%rowtype;
begin
  select r.* into reservation from public.feature_checkout_reservations r where r.request_id=p_request_id;
  if not found then return 'test_fixture_missing'; end if;
  return public.record_form_coach_checkout_expired_session(
    p_request_id,reservation.id,p_session_id,p_customer_id,p_session_status,p_payment_status,p_mode,
    coalesce(p_metadata,jsonb_build_object(
      'feature_namespace',reservation.feature_key,
      'feature_key',reservation.feature_key,
      'payer_id',reservation.payer_id::text,
      'reservation_id',reservation.id::text,
      'request_id',reservation.request_id::text,
      'config_revision',reservation.config_revision::text,
      'price_key',reservation.price_key,
      'pack_quantity',reservation.pack_quantity::text
    )),p_price_id,p_quantity,p_digest
  );
end;
$$;

set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';

select is((select outcome from public.reserve_feature_customer_create(
  '98000000-0000-0000-0000-000000000002','99000000-0000-0000-0000-000000000101',repeat('1',64))),
  'reserved','synthetic payer begins one customer-create attempt');
select is(public.advance_feature_customer_create(
  (select id from public.feature_customer_create_attempts where request_id='99000000-0000-0000-0000-000000000101'),
  0,'bound','cus_terminal'),'bound','customer ID is bound to the exact synthetic payer');
select is(public.advance_feature_customer_create(
  (select id from public.feature_customer_create_attempts where request_id='99000000-0000-0000-0000-000000000101'),
  1,'verified','cus_terminal'),'verified','synthetic customer mapping is verified');

select is((select outcome from public.reserve_feature_checkout(
  'form_coach','98000000-0000-0000-0000-000000000002',2,'pack',1,'99000000-0000-0000-0000-000000000201')),
  'reserved','first synthetic pack checkout reserves before provider-session binding');
select is(public.bind_feature_checkout_session(
  (select id from public.feature_checkout_reservations where request_id='99000000-0000-0000-0000-000000000201'),
  'cs_test_terminal_01','cus_terminal',null),'bound','first exact session binds to its payer and customer');
select is(pg_temp.test_terminal('99000000-0000-0000-0000-000000000201','cs_test_terminal_01'),
  'expired','exact current expired/unpaid evidence releases one bound reservation');
select is((select state from public.feature_checkout_reservations where request_id='99000000-0000-0000-0000-000000000201'),
  'expired','only the matching bound reservation enters expired state');
reset role;
reset request.jwt.claims;
select is((select evidence_digest from public.feature_checkout_terminal_attestations where request_id='99000000-0000-0000-0000-000000000201'),
  repeat('a',64),'immutable attestation records only the supplied evidence digest');
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is(pg_temp.test_terminal('99000000-0000-0000-0000-000000000201','cs_test_terminal_01'),
  'already_expired','exact same request and digest replay idempotently');
select is(pg_temp.test_terminal('99000000-0000-0000-0000-000000000201','cs_test_terminal_01',p_digest=>repeat('b',64)),
  'conflict','same terminal request cannot be replayed with a different digest');
select is((select count(*)::integer from public.feature_checkout_reservations
  where payer_id='98000000-0000-0000-0000-000000000002' and state in ('reserved','unknown','bound','cancel_required')),
  0,'expired reservation no longer blocks the next checkout request');
select throws_ok(
  $$select public.apply_feature_checkout_payment('evt_terminal_late','checkout.session.completed',
    '{"feature_namespace":"form_coach"}'::jsonb,'cs_test_terminal_01','pi_terminal_late','pi_terminal_late',
    'price_terminal',2500,'USD',1)$$,
  '55000',null,'late payment receipt is rejected after terminal expiry under the payer/row locks'
);
select is((select count(*)::integer from public.feature_payment_receipts where reservation_id=
  (select id from public.feature_checkout_reservations where request_id='99000000-0000-0000-0000-000000000201')),
  0,'late Checkout event cannot create a receipt');
select is((select count(*)::integer from public.feature_credit_lots where user_id='98000000-0000-0000-0000-000000000002'),
  0,'late Checkout event cannot grant credits');
select is((select count(*)::integer from public.feature_processed_events where event_id='evt_terminal_late'),
  0,'rejected late event rolls back its provisional event identity');
select throws_ok(
  $$update public.feature_checkout_terminal_attestations set evidence_digest=repeat('c',64)
    where request_id='99000000-0000-0000-0000-000000000201'$$,
  '42501',null,'service role cannot mutate immutable terminal attestations directly'
);
select throws_ok(
  $$update public.feature_checkout_reservations set state='bound'
    where request_id='99000000-0000-0000-0000-000000000201'$$,
  '42501',null,'attested expired reservation cannot be reopened by direct state mutation'
);
select throws_ok(
  $$update public.feature_checkout_reservations set stripe_checkout_session_id='cs_test_rebound'
    where request_id='99000000-0000-0000-0000-000000000201'$$,
  '42501',null,'attested expired reservation cannot change its provider Session binding'
);

select is((select outcome from public.reserve_feature_checkout(
  'form_coach','98000000-0000-0000-0000-000000000002',2,'pack',1,'99000000-0000-0000-0000-000000000202')),
  'reserved','second reservation is possible after verified expiry');
select is(public.bind_feature_checkout_session(
  (select id from public.feature_checkout_reservations where request_id='99000000-0000-0000-0000-000000000202'),
  'cs_test_terminal_02','cus_terminal',null),'bound','second Session binds before mismatch checks');
select throws_ok(
  $$update public.feature_checkout_reservations set state='expired'
    where request_id='99000000-0000-0000-0000-000000000202'$$,
  '42501',null,'service role cannot set expired without terminal evidence'
);
select is(pg_temp.test_terminal('99000000-0000-0000-0000-000000000202','cs_test_terminal_02',p_session_status=>'open'),
  'not_terminal','an open Session is not terminal proof');
select is((select state from public.feature_checkout_reservations where request_id='99000000-0000-0000-0000-000000000202'),
  'bound','open Session leaves reservation unresolved');
select is(pg_temp.test_terminal('99000000-0000-0000-0000-000000000202','cs_test_terminal_02',p_payment_status=>'paid'),
  'not_terminal','a paid Session cannot be expired as unpaid');
select is(pg_temp.test_terminal('99000000-0000-0000-0000-000000000202','cs_test_terminal_02',
  p_metadata=>'{}'::jsonb),'quote_mismatch','metadata must match the full immutable quote and owner');
select is(pg_temp.test_terminal('99000000-0000-0000-0000-000000000202','cs_test_terminal_02',
  p_price_id=>'price_other'),'quote_mismatch','provider Price mismatch is rejected');
select is(pg_temp.test_terminal('99000000-0000-0000-0000-000000000202','cs_test_terminal_02',
  p_quantity=>2),'quote_mismatch','provider quantity mismatch is rejected');
select is(pg_temp.test_terminal('99000000-0000-0000-0000-000000000202','cs_test_terminal_02',
  p_mode=>'subscription'),'quote_mismatch','provider mode mismatch is rejected');
select is(pg_temp.test_terminal('99000000-0000-0000-0000-000000000202','cs_test_terminal_02',
  p_customer_id=>'cus_other'),'quote_mismatch','provider customer mismatch is rejected');
reset role;
reset request.jwt.claims;
select is((select count(*)::integer from public.feature_checkout_terminal_attestations where request_id='99000000-0000-0000-0000-000000000202'),
  0,'mismatched evidence creates no attestation');
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';

select throws_ok(
  $$update public.feature_checkout_reservations set state='canceled'
    where request_id='99000000-0000-0000-0000-000000000202'$$,
  '42501',null,'unresolved Checkout cannot escape its fence as canceled');
select throws_ok(
  $$update public.feature_checkout_reservations set state='rejected'
    where request_id='99000000-0000-0000-0000-000000000202'$$,
  '42501',null,'unresolved Checkout cannot escape its fence as rejected');
select throws_ok(
  $$update public.feature_checkout_reservations set state='paid'
    where request_id='99000000-0000-0000-0000-000000000202'$$,
  '42501',null,'Checkout cannot become paid without its exact payment receipt');
select is((select outcome from public.reserve_feature_checkout(
  'form_coach','98000000-0000-0000-0000-000000000002',2,'pack',1,'99000000-0000-0000-0000-000000000203')),
  'pending_reconciliation','unsupported state changes keep the payer fence active');
select is(pg_temp.test_terminal('99000000-0000-0000-0000-000000000202','cs_test_terminal_02'),
  'expired','a valid exact provider terminal proof releases the mismatch fixture');

select is((select outcome from public.reserve_feature_checkout(
  'form_coach','98000000-0000-0000-0000-000000000002',2,'pack',1,'99000000-0000-0000-0000-000000000203')),
  'reserved','paid-state conflict fixture reserves normally');
select is(public.bind_feature_checkout_session(
  (select id from public.feature_checkout_reservations where request_id='99000000-0000-0000-0000-000000000203'),
  'cs_test_terminal_03','cus_terminal',null),'bound','paid-state conflict Session binds');
select is(public.apply_feature_checkout_payment('evt_terminal_paid','checkout.session.completed',
  '{"feature_namespace":"form_coach"}'::jsonb,'cs_test_terminal_03','pi_terminal_paid','pi_terminal_paid',
  'price_terminal',2500,'USD',1),'applied','valid positive control payment still records its receipt');
select is(pg_temp.test_terminal('99000000-0000-0000-0000-000000000203','cs_test_terminal_03'),
  'payment_exists','receipt-backed checkout cannot be terminalized');
reset role;
reset request.jwt.claims;
select is((select count(*)::integer from public.feature_checkout_terminal_attestations where request_id='99000000-0000-0000-0000-000000000203'),
  0,'paid reservation receives no terminal attestation');
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';

select is((select outcome from public.reserve_feature_checkout(
  'form_coach','98000000-0000-0000-0000-000000000002',2,'pack',1,'99000000-0000-0000-0000-000000000204')),
  'reserved','subscription contradiction fixture reserves normally');
select is(public.bind_feature_checkout_session(
  (select id from public.feature_checkout_reservations where request_id='99000000-0000-0000-0000-000000000204'),
  'cs_test_terminal_04','cus_terminal','sub_terminal_conflict'),'bound','subscription-bound Session is retained for reconciliation');
select is(pg_temp.test_terminal('99000000-0000-0000-0000-000000000204','cs_test_terminal_04'),
  'subscription_conflict','a bound Subscription identity cannot be discarded as expired/unpaid');
reset role;
reset request.jwt.claims;
select is((select count(*)::integer from public.feature_checkout_terminal_attestations where request_id='99000000-0000-0000-0000-000000000204'),
  0,'subscription contradiction leaves no terminal attestation');

reset role;
select * from finish();
rollback;
