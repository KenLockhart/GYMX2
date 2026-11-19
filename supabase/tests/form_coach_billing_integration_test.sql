begin;
select plan(155);

insert into auth.users(id,email,raw_user_meta_data) values
 ('91000000-0000-0000-0000-000000000011','fc-billing-admin@example.test','{"display_name":"Billing Admin"}'),
 ('91000000-0000-0000-0000-000000000012','fc-billing-coach-a@example.test','{"display_name":"Coach A"}'),
 ('91000000-0000-0000-0000-000000000013','fc-billing-coach-b@example.test','{"display_name":"Coach B"}'),
 ('91000000-0000-0000-0000-000000000014','fc-billing-coach-c@example.test','{"display_name":"Coach C"}'),
 ('91000000-0000-0000-0000-000000000015','fc-billing-coach-d@example.test','{"display_name":"Coach D"}'),
 ('91000000-0000-0000-0000-000000000016','fc-billing-coach-e@example.test','{"display_name":"Coach E"}'),
 ('91000000-0000-0000-0000-000000000017','fc-billing-member@example.test','{"display_name":"Member"}'),
 ('91000000-0000-0000-0000-000000000018','fc-billing-coach-f@example.test','{"display_name":"Coach F"}'),
 ('91000000-0000-0000-0000-000000000019','fc-billing-coach-g@example.test','{"display_name":"Coach G"}');
update public.profiles set role='admin' where id='91000000-0000-0000-0000-000000000011';
update public.profiles set role='coach' where id in
 ('91000000-0000-0000-0000-000000000012','91000000-0000-0000-0000-000000000013',
  '91000000-0000-0000-0000-000000000014','91000000-0000-0000-0000-000000000015',
  '91000000-0000-0000-0000-000000000016','91000000-0000-0000-0000-000000000018',
  '91000000-0000-0000-0000-000000000019');

select is((select revision from public.feature_pricing_current where feature_key='form_coach'),1::bigint,'Phase 1A pending seed remains current');
select is((select count(*)::integer from public.feature_payer_customer_mappings),0,'migration creates no payer customer bindings');
select is((select count(*)::integer from public.feature_pricing_sync_requests),0,'migration creates no provider pricing jobs');
select is((select count(*)::integer from public.feature_subscription_invoice_current),0,'migration creates no invoice facts');
select is((select count(*)::integer from public.feature_trial_claims),0,'migration grants no trial claims');
select is((select count(*)::integer from public.feature_credit_lots where lot_kind='assessment_trial'),0,'migration grants no assessment trial units');
select is((select count(*)::integer from public.feature_access_grants),0,'migration auto-comps no account');
select ok((select relrowsecurity from pg_class where oid='public.feature_subscription_invoice_current'::regclass),'invoice facts have row-level security enabled');
select ok((select relrowsecurity from pg_class where oid='public.feature_subscription_contract_versions'::regclass),'contract history has row-level security enabled');

set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-0000-0000-000000000017","role":"authenticated"}';
select throws_ok(
 $$select * from public.admin_reserve_feature_pricing_sync(1,'92000000-0000-0000-0000-000000000101','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}'::jsonb)$$,
 '42501',null,'member cannot reserve admin pricing changes'
);
select throws_ok(
 $$select public.reserve_feature_customer_create('91000000-0000-0000-0000-000000000012','92000000-0000-0000-0000-000000000102','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,
 '42501',null,'member cannot create a service-owned customer reservation'
);
select throws_ok(
 $$select * from public.record_feature_subscription_invoice('evt_forbidden','invoice.paid','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','in_forbidden','sub_forbidden','91000000-0000-0000-0000-000000000012',1,'paid','USD',1,1,now(),now()+interval '1 day',null,null,null,0)$$,
 '42501',null,'member cannot write subscription invoice facts'
);
select throws_ok(
 $$select count(*) from public.feature_subscription_invoice_current$$,
 '42501',null,'member cannot read processor invoice rows directly'
);
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-0000-0000-000000000011","role":"authenticated"}';
select throws_ok(
 $$select * from public.admin_reserve_feature_pricing_sync(null,'92000000-0000-0000-0000-000000000103','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}'::jsonb)$$,
 '22023',null,'null pricing-sync expected revision is rejected'
);
select throws_ok(
 $$select * from public.admin_reserve_feature_pricing_sync(1,'92000000-0000-0000-0000-000000000103','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}'::jsonb)$$,
 '22023',null,'incomplete pricing-sync payload is rejected before reservation'
);
select is(public.admin_create_feature_pricing_revision(
 'form_coach',1,'live','coach','subscription','USD','Form Coach','Billing test','',7,2,
 '[{"price_key":"monthly_v2","amount_cents":9000,"currency":"USD","interval":"month","credits_per_pack":null,"stripe_product_id":"prod_fc_v2","stripe_price_id":"price_fc_v2"}]'::jsonb
),2::bigint,'admin configures a synthetic subscription quote for local fixtures');
reset role;

set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
insert into public.feature_subscriptions(stripe_subscription_id,feature_key,payer_role,payer_id,config_revision,price_key,
 stripe_customer_id,status,current_period_end)
values('sub_fc_move','form_coach','coach','91000000-0000-0000-0000-000000000012',2,'monthly_v2','cus_fc_move','active',now()+interval '60 days');
select is((select count(*)::integer from public.feature_subscription_contract_versions where stripe_subscription_id='sub_fc_move'),1,'legacy subscription receives one immutable contract version');
select is((select contract_version from public.feature_subscription_contract_current where stripe_subscription_id='sub_fc_move'),1,'contract pointer starts at version one');

select is((select outcome from public.reserve_feature_checkout('form_coach','91000000-0000-0000-0000-000000000018',2,'monthly_v2',1,'92000000-0000-0000-0000-000000000140')),
 'reserved','invoice-first ordering reserves a real immutable Checkout quote');
select is(public.bind_feature_checkout_session((select id from public.feature_checkout_reservations where request_id='92000000-0000-0000-0000-000000000140'),
 'cs_fc_invoice_first','cus_fc_invoice_first','sub_fc_invoice_first'),'bound','invoice-first Checkout binds its IDs while subscription mapping waits for the positive receipt');
select is(public.record_feature_subscription_invoice('evt_fc_invoice_first_paid','invoice.paid',repeat('1',64),'in_fc_invoice_first',
 'sub_fc_invoice_first','91000000-0000-0000-0000-000000000018',1,'paid','USD',9000,9000,now()-interval '1 day',
 now()+interval '30 days','pi_fc_invoice_first','ch_fc_invoice_first',null,0),'retryable_unmatched_subscription',
 'invoice event arriving before the positive Checkout receipt remains retryable without an internal subscription mapping');
select is(public.apply_feature_subscription_state_cas('evt_fc_invoice_first_active','customer.subscription.updated','sub_fc_invoice_first',0,
 'active',now()+interval '30 days',false),'unmatched_subscription','subscription state event arriving before the payment receipt remains retryable');
select is(public.apply_feature_checkout_payment('evt_fc_invoice_first_checkout','checkout.session.completed','{"feature_namespace":"form_coach"}'::jsonb,
 'cs_fc_invoice_first','cs_fc_invoice_first','pi_fc_invoice_first','price_fc_v2',9000,'USD',1),'applied',
 'actual payment receipt creates the durable subscription mapping after the unmatched events');
select is(public.apply_feature_subscription_state_cas('evt_fc_invoice_first_active','customer.subscription.updated','sub_fc_invoice_first',0,
 'active',now()+interval '30 days',false),'applied','the same subscription-state event reconciles after the receipt creates the mapping');
select is(public.record_feature_subscription_invoice('evt_fc_invoice_first_paid','invoice.paid',repeat('1',64),'in_fc_invoice_first',
 'sub_fc_invoice_first','91000000-0000-0000-0000-000000000018',1,'paid','USD',9000,9000,now()-interval '1 day',
 now()+interval '30 days','pi_fc_invoice_first','ch_fc_invoice_first',null,0),'applied',
 'the same invoice event reconciles after the receipt and subscription mapping exist');
select is((select count(*)::integer from public.feature_subscription_checkout_access_proofs where subscription_id='sub_fc_invoice_first'),1,
 'invoice-first payment produces one verified paid-through proof');
select is((select paid_through from public.feature_subscription_checkout_access_proofs where subscription_id='sub_fc_invoice_first'),
 (select period_end from public.feature_subscription_invoice_current where invoice_id='in_fc_invoice_first'),
 'invoice-first proof uses the settled invoice period end');
select is(public.apply_feature_subscription_state_cas('evt_fc_invoice_first_renewal_snapshot','customer.subscription.updated','sub_fc_invoice_first',1,
 'active',now()+interval '90 days',false),'applied','later raw provider period snapshot can advance without payment proof');
select is((select verified_paid_through from public.feature_subscription_access_current where subscription_id='sub_fc_invoice_first'),
 (select period_end from public.feature_subscription_invoice_current where invoice_id='in_fc_invoice_first'),
 'unpaid period extension cannot extend verified subscription access');
select is((select outcome from public.record_feature_bundle_funding('93000000-0000-0000-0000-000000000181','form_coach',
 '91000000-0000-0000-0000-000000000018',2,'2099-01-01T00:00:00Z','fc-invoice-only-refund-existing')),'funded',
 'verified Checkout funding proof can initially fund a bundle');
select is(public.record_feature_subscription_refund('evt_fc_invoice_only_stale','refund.updated',repeat('3',64),'re_fc_invoice_only_stale',
 'in_fc_invoice_first',null,null,'91000000-0000-0000-0000-000000000018',500,'USD',999),'cas_stale',
 'invoice-only refund marker survives a stale invoice compare-and-swap');
select is((select refund_state from public.feature_subscription_invoice_current where invoice_id='in_fc_invoice_first'),
 'none','stale invoice-only marker does not falsely advance the invoice refund projection');
select is((select access_through from public.feature_subscription_access_current where subscription_id='sub_fc_invoice_first'),
 null::timestamptz,'durable invoice-only refund marker suppresses Checkout access proof before retry');
select is((select outcome from public.record_feature_bundle_funding('93000000-0000-0000-0000-000000000181','form_coach',
 '91000000-0000-0000-0000-000000000018',2,'2099-01-01T00:00:00Z','fc-invoice-only-refund-existing')),'already_funded',
 'already-funded bundle remains immutable after the refund marker');
select is((select outcome from public.record_feature_bundle_funding('93000000-0000-0000-0000-000000000182','form_coach',
 '91000000-0000-0000-0000-000000000018',2,'2099-01-01T00:00:00Z','fc-invoice-only-refund-new')),'unfunded',
 'new bundle cannot reuse Checkout proof blocked by the invoice-only refund marker');

select is((select outcome from public.reserve_feature_checkout('form_coach','91000000-0000-0000-0000-000000000019',2,'monthly_v2',1,'92000000-0000-0000-0000-000000000145')),
 'reserved','receipt-first ordering reserves an independent immutable Checkout quote');
select is(public.bind_feature_checkout_session((select id from public.feature_checkout_reservations where request_id='92000000-0000-0000-0000-000000000145'),
 'cs_fc_receipt_first','cus_fc_receipt_first','sub_fc_receipt_first'),'bound','receipt-first Checkout IDs bind independently');
select is(public.apply_feature_checkout_payment('evt_fc_receipt_first_checkout','checkout.session.completed','{"feature_namespace":"form_coach"}'::jsonb,
 'cs_fc_receipt_first','cs_fc_receipt_first','pi_fc_receipt_first','price_fc_v2',9000,'USD',1),'applied',
 'Checkout receipt may arrive before its initial invoice snapshot');
select is(public.apply_feature_subscription_state_cas('evt_fc_receipt_first_active','customer.subscription.updated','sub_fc_receipt_first',0,
 'active',now()+interval '30 days',false),'applied','subscription state reconciles after the receipt creates its internal subscription mapping');
select is(public.apply_feature_subscription_state_cas('evt_fc_receipt_first_late_period','customer.subscription.updated','sub_fc_receipt_first',1,
 'active',now()+interval '90 days',false),'applied','raw subscription period may advance while invoice capture is delayed');
select is((select access_through from public.feature_subscription_access_current where subscription_id='sub_fc_receipt_first'),
 null::timestamptz,'receipt plus a later raw provider period does not grant access without a settled invoice period');
select is(public.record_feature_subscription_invoice('evt_fc_receipt_first_paid','invoice.paid',repeat('2',64),'in_fc_receipt_first',
 'sub_fc_receipt_first','91000000-0000-0000-0000-000000000019',1,'paid','USD',9000,9000,now()-interval '1 day',
 now()+interval '30 days','pi_fc_receipt_first','ch_fc_receipt_first',null,0),'applied',
 'delayed initial settled invoice reconciles after the receipt and an unverified raw period extension');
select is((select paid_through from public.feature_subscription_checkout_access_proofs where subscription_id='sub_fc_receipt_first'),
 (select period_end from public.feature_subscription_invoice_current where invoice_id='in_fc_receipt_first'),
 'receipt-first proof uses the exact settled invoice period, not the later provider period');
select is((select outcome from public.record_feature_bundle_funding('93000000-0000-0000-0000-000000000183','form_coach',
 '91000000-0000-0000-0000-000000000019',2,'2099-01-01T00:00:00Z','fc-charge-only-refund-existing')),'funded',
 'verified invoice proof can initially fund a second bundle');
select is(public.record_feature_subscription_refund('evt_fc_charge_only_stale','refund.updated',repeat('4',64),'re_fc_charge_only_stale',
 null,null,'ch_fc_receipt_first',null,500,'USD',999),'cas_stale',
 'charge-only refund marker resolves the invoice but remains retryable after stale CAS');
select is((select refund_state from public.feature_subscription_invoice_current where invoice_id='in_fc_receipt_first'),
 'none','stale charge-only marker does not falsely advance the invoice refund projection');
select is((select access_through from public.feature_subscription_access_current where subscription_id='sub_fc_receipt_first'),
 null::timestamptz,'durable charge-only refund marker suppresses the Checkout proof before retry');
select is((select outcome from public.record_feature_bundle_funding('93000000-0000-0000-0000-000000000183','form_coach',
 '91000000-0000-0000-0000-000000000019',2,'2099-01-01T00:00:00Z','fc-charge-only-refund-existing')),'already_funded',
 'already-funded bundle remains usable after the charge-only refund marker');
select is((select outcome from public.record_feature_bundle_funding('93000000-0000-0000-0000-000000000184','form_coach',
 '91000000-0000-0000-0000-000000000019',2,'2099-01-01T00:00:00Z','fc-charge-only-refund-new')),'unfunded',
 'new bundle cannot reuse Checkout proof blocked by the charge-only refund marker');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-0000-0000-000000000011","role":"authenticated"}';
select is((select outcome from public.admin_reserve_feature_pricing_sync(
 2,'92000000-0000-0000-0000-000000000110',repeat('b',64),
 '{"status":"live","payer":"coach","billing_model":"subscription","currency":"USD","display_name":"Form Coach","description":"Billing test","marketing_copy":"","trial_days":7,"trial_assessments":2,"price_options":[{"price_key":"monthly_v3","amount_cents":9500,"currency":"USD","interval":"month","credits_per_pack":null}]}'::jsonb
)),'reserved','admin reserves the immutable v3 candidate at current revision');
select is((select outcome from public.admin_reserve_feature_pricing_sync(
 1,'92000000-0000-0000-0000-000000000111',repeat('c',64),
 '{"status":"pricing_pending","payer":"coach","billing_model":null,"currency":"USD","display_name":"Form Coach","description":"","marketing_copy":"","trial_days":0,"trial_assessments":0,"price_options":[]}'::jsonb
)),'cas_stale','stale pricing request cannot reserve an older revision');
select throws_ok(
 $$select * from public.admin_reserve_feature_pricing_sync(2,'92000000-0000-0000-0000-000000000112',repeat('d',64),'{"status":"live","payer":"coach","billing_model":"subscription","currency":"USD","display_name":"Form Coach","description":"","marketing_copy":"","trial_days":999,"trial_assessments":0,"price_options":[{"price_key":"bad","amount_cents":1,"currency":"USD","interval":"month"}]}'::jsonb)$$,
 '22023',null,'trial day limit rejects values above 365');
reset role;

set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is((select outcome from public.reserve_feature_pricing_sync_object('92000000-0000-0000-0000-000000000110','product',null,'form-coach-price-sync:92000000-0000-0000-0000-000000000110:product',repeat('e',64))),'reserved','product create is durably reserved before external work');
select is((select outcome from public.reserve_feature_pricing_sync_object('92000000-0000-0000-0000-000000000110','price','monthly_v3','form-coach-price-sync:92000000-0000-0000-0000-000000000110:monthly_v3',repeat('f',64))),'reserved','price create is durably reserved with an immutable payload digest');
select is(public.advance_feature_pricing_sync_object((select id from public.feature_pricing_sync_objects where request_id='92000000-0000-0000-0000-000000000110' and object_kind='product'),0,'bound','prod_fc_shared',null),'bound','product provider ID is bound by CAS');
select is(public.advance_feature_pricing_sync_object((select id from public.feature_pricing_sync_objects where request_id='92000000-0000-0000-0000-000000000110' and object_kind='product'),1,'verified','prod_fc_shared',repeat('e',64)),'verified','product metadata digest is verified');
select is(public.advance_feature_pricing_sync_object((select id from public.feature_pricing_sync_objects where request_id='92000000-0000-0000-0000-000000000110' and object_kind='price'),0,'bound','price_fc_v3',null),'bound','price provider ID is bound by CAS');
select throws_ok(
 $$select public.advance_feature_pricing_sync_object((select id from public.feature_pricing_sync_objects where request_id='92000000-0000-0000-0000-000000000110' and object_kind='price'),1,'failed','price_fc_v3',null)$$,
 '22023',null,'a bound price remains reconcilable and cannot discard its provider ID');
select is(public.advance_feature_pricing_sync_object((select id from public.feature_pricing_sync_objects where request_id='92000000-0000-0000-0000-000000000110' and object_kind='price'),1,'verified','price_fc_v3',repeat('f',64)),'verified','price metadata digest is verified');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-0000-0000-000000000011","role":"authenticated"}';
select is((select outcome from public.admin_publish_feature_pricing_sync('92000000-0000-0000-0000-000000000110',2)),'applied','revision publishes only after its Product and Price are verified');
select is((select revision from public.feature_public_pricing where feature_key='form_coach' limit 1),3::bigint,'publish advances the current revision once');
select is((select outcome from public.admin_reserve_feature_pricing_sync(
 3,'92000000-0000-0000-0000-000000000120',repeat('a',64),
 '{"status":"live","payer":"member","billing_model":"subscription","currency":"USD","display_name":"Form Coach","description":"Billing test","marketing_copy":"","trial_days":0,"trial_assessments":0,"price_options":[{"price_key":"monthly_v4","amount_cents":9800,"currency":"USD","interval":"month","credits_per_pack":null}]}'::jsonb
)),'reserved','a later revision reserves its own candidate');
reset role;

set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is((select outcome from public.reserve_feature_pricing_sync_object('92000000-0000-0000-0000-000000000120','product',null,'form-coach-price-sync:92000000-0000-0000-0000-000000000120:product',repeat('e',64))),'reserved','same immutable Product can be reserved for a later revision');
select is((select outcome from public.reserve_feature_pricing_sync_object('92000000-0000-0000-0000-000000000120','price','monthly_v4','form-coach-price-sync:92000000-0000-0000-0000-000000000120:monthly_v4',repeat('a',64))),'reserved','new revision reserves a distinct immutable Price');
select is(public.advance_feature_pricing_sync_object((select id from public.feature_pricing_sync_objects where request_id='92000000-0000-0000-0000-000000000120' and object_kind='product'),0,'bound','prod_fc_shared',null),'bound','Product identity may be reused only with the same digest');
select is(public.advance_feature_pricing_sync_object((select id from public.feature_pricing_sync_objects where request_id='92000000-0000-0000-0000-000000000120' and object_kind='product'),1,'verified','prod_fc_shared',repeat('e',64)),'verified','reused Product verifies against its original immutable identity');
select is(public.advance_feature_pricing_sync_object((select id from public.feature_pricing_sync_objects where request_id='92000000-0000-0000-0000-000000000120' and object_kind='price'),0,'bound','price_fc_v4',null),'bound','new Price binds to its reservation');
select is(public.advance_feature_pricing_sync_object((select id from public.feature_pricing_sync_objects where request_id='92000000-0000-0000-0000-000000000120' and object_kind='price'),1,'verified','price_fc_v4',repeat('a',64)),'verified','new Price verifies against its immutable digest');
select throws_ok(
 $$select public.advance_feature_pricing_sync_object((select id from public.feature_pricing_sync_objects where request_id='92000000-0000-0000-0000-000000000120' and object_kind='product'),2,'bound','prod_fc_conflict',null)$$,
 '22023',null,'a verified provider object cannot transition backward');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-0000-0000-000000000011","role":"authenticated"}';
select is((select outcome from public.admin_publish_feature_pricing_sync('92000000-0000-0000-0000-000000000120',3)),'applied','second revision publishes after verified object reuse');
select throws_ok(
 $$select * from public.admin_reserve_feature_contract_move('92000000-0000-0000-0000-000000000130','sub_fc_move',1,1,0,4,'monthly_v4','none',true,repeat('1',64))$$,
 '22023',null,'existing subscription cannot be moved to a different payer role');
select throws_ok(
 $$select * from public.admin_reserve_feature_contract_move('92000000-0000-0000-0000-000000000131','sub_fc_move',1,1,0,4,'monthly_v4','create_prorations',false,repeat('2',64))$$,
 '22023',null,'unconfirmed migration is rejected'
);
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-0000-0000-000000000011","role":"authenticated"}';
select is(public.admin_create_feature_pricing_revision(
 'form_coach',4,'live','coach','subscription','USD','Form Coach','Billing test','',7,2,
 '[{"price_key":"monthly_v5","amount_cents":9900,"currency":"USD","interval":"month","credits_per_pack":null,"stripe_product_id":"prod_fc_shared","stripe_price_id":"price_fc_v5"}]'::jsonb
),5::bigint,'new coach-payer revision preserves a separately confirmed migration target');
select is((select outcome from public.admin_reserve_feature_contract_move(
 '92000000-0000-0000-0000-000000000132','sub_fc_move',1,1,0,5,'monthly_v5','create_prorations',true,repeat('3',64)
)),'reserved','admin records explicit subscriber migration intent and proration choice');
select is((select outcome from public.admin_reserve_feature_contract_move(
 '92000000-0000-0000-0000-000000000133','sub_fc_move',1,2,0,5,'monthly_v5','none',true,repeat('4',64)
)),'cas_stale','contract move rejects a stale pointer revision');
select throws_ok(
 $$select * from public.admin_reserve_feature_contract_move('92000000-0000-0000-0000-000000000134','sub_fc_move',1,1,0,5,'monthly_v5','none',false,repeat('4',64))$$,
 '22023',null,'unconfirmed contract migration is rejected'
);
reset role;

set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is((select outcome from public.apply_feature_contract_move('92000000-0000-0000-0000-000000000132',1,0,'cus_fc_move','price_fc_v5','active')),'applied','service applies the explicitly confirmed move after provider verification');
select is((select contract_version from public.feature_subscription_contract_current where stripe_subscription_id='sub_fc_move'),2,'active pointer advances to a new immutable contract version');
select is((select config_revision from public.feature_subscriptions where stripe_subscription_id='sub_fc_move'),2::bigint,'original subscription quote row remains unchanged after migration');
select is((select config_revision from public.feature_subscription_contract_versions where stripe_subscription_id='sub_fc_move' and contract_version=2),5::bigint,'new contract version records the new verified revision');
reset role;

set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is(public.record_feature_subscription_invoice('evt_fc_wrong_currency','invoice.paid',repeat('b',64),'in_fc_wrong_currency','sub_fc_move',
 '91000000-0000-0000-0000-000000000012',2,'paid','EUR',9900,9900,now()-interval '1 day',now()+interval '10 days',
 'pi_fc_wrong_currency','ch_fc_wrong_currency',null,0),'mismatch_invoice_currency','invoice currency must match its immutable subscription contract');
select is(public.record_feature_subscription_invoice('evt_fc_invoice_a','invoice.paid',repeat('5',64),'in_fc_invoice_a','sub_fc_move',
 '91000000-0000-0000-0000-000000000012',2,'paid','USD',9900,9900,now()-interval '1 day',now()+interval '10 days',
 'pi_fc_invoice_a','ch_fc_invoice_a',null,1),'cas_stale','stale invoice projection revision is retained for retry');
select is(public.record_feature_subscription_invoice('evt_fc_invoice_a','invoice.paid',repeat('5',64),'in_fc_invoice_a','sub_fc_move',
 '91000000-0000-0000-0000-000000000012',2,'paid','USD',9900,9900,now()-interval '1 day',now()+interval '10 days',
 'pi_fc_invoice_a','ch_fc_invoice_a',null,0),'applied','same invoice event retries successfully against the current invoice revision');
select is(public.record_feature_subscription_invoice('evt_fc_invoice_a','invoice.paid',repeat('5',64),'in_fc_invoice_a','sub_fc_move',
 '91000000-0000-0000-0000-000000000012',2,'paid','USD',9900,9900,now()-interval '1 day',now()+interval '10 days',
 'pi_fc_invoice_a','ch_fc_invoice_a',null,1),'duplicate_event','applied invoice event remains idempotent');
select is((select access_through from public.feature_subscription_access_current where subscription_id='sub_fc_move'),
 (select period_end from public.feature_subscription_invoice_current where invoice_id='in_fc_invoice_a'),
 'paid access is capped at the verified invoice period');
select is(public.apply_feature_subscription_state_cas('evt_fc_extend','customer.subscription.updated','sub_fc_move',0,'active',now()+interval '90 days',false),'applied','provider period can be refreshed without paid invoice evidence');
select ok((select access_through < provider_period_end and access_through<=verified_paid_through
  from public.feature_subscription_access_current where subscription_id='sub_fc_move'),
 'advancing the provider period alone does not extend paid access');
select is(public.record_feature_subscription_refund('evt_fc_refund_stale','charge.refunded',repeat('0',64),'re_fc_refund_a','in_fc_invoice_a',
 'pi_fc_invoice_a','ch_fc_invoice_a','91000000-0000-0000-0000-000000000012',9900,'USD',2),'cas_stale','stale refund projection revision remains retryable');
select is(public.record_feature_subscription_refund('evt_fc_refund_stale','charge.refunded',repeat('0',64),'re_fc_refund_a','in_fc_invoice_a',
 'pi_fc_invoice_a','ch_fc_invoice_a','91000000-0000-0000-0000-000000000012',9900,'USD',1),'refunded','same refund event converges after a fresh invoice revision');
select is(public.record_feature_subscription_refund('evt_fc_refund_stale','charge.refunded',repeat('0',64),'re_fc_refund_a','in_fc_invoice_a',
 'pi_fc_invoice_a','ch_fc_invoice_a','91000000-0000-0000-0000-000000000012',9900,'USD',1),'duplicate_event','applied refund event cannot be counted twice');
select is((select access_through from public.feature_subscription_access_current where subscription_id='sub_fc_move'),null::timestamptz,
 'fully refunded subscription invoice no longer extends new funding proof');

select is(public.record_feature_subscription_refund('evt_fc_refund_first','charge.refunded',repeat('6',64),'re_fc_first',null,
 'pi_fc_invoice_b','ch_fc_invoice_b',null,300,'USD',0),'unmatched_refund','refund-before-invoice is durably retained without guessed owner');
select is(public.record_feature_subscription_refund('evt_fc_refund_invoice_only','refund.updated',repeat('9',64),'re_fc_invoice_only','in_fc_invoice_b',
 null,null,null,100,'USD',0),'unmatched_refund','invoice-only refund marker waits for its invoice before owner reconciliation');
select is(public.record_feature_subscription_invoice('evt_fc_invoice_b','invoice.paid',repeat('7',64),'in_fc_invoice_b','sub_fc_move',
 '91000000-0000-0000-0000-000000000012',2,'paid','USD',1000,1000,now()-interval '1 day',now()+interval '20 days',
 'pi_fc_invoice_b','ch_fc_invoice_b',null,0),'manual_review','invoice retry binds refund-first markers and requires review for partial refund');
select is((select payer_id from public.feature_subscription_refund_events where refund_id='re_fc_first'),
 '91000000-0000-0000-0000-000000000012'::uuid,'refund-first marker binds to the verified payer on invoice reconciliation');
select is((select invoice_id from public.feature_subscription_refund_events where refund_id='re_fc_first'),
 'in_fc_invoice_b','refund-first marker binds to the exact invoice on reconciliation');
select is(public.record_feature_subscription_refund('evt_fc_refund_rest','charge.refunded',repeat('8',64),'re_fc_rest','in_fc_invoice_b',
 'pi_fc_invoice_b','ch_fc_invoice_b','91000000-0000-0000-0000-000000000012',600,'USD',1),'refunded','full verified refund removes new subscription funding proof without erasing bundle history');
select is((select refund_state from public.feature_subscription_invoice_current where invoice_id='in_fc_invoice_b'),
 'fully_refunded','invoice projection records the final refund state');
select is(public.record_feature_subscription_refund('evt_fc_refund_rest','charge.refunded',repeat('8',64),'re_fc_rest','in_fc_invoice_b',
 'pi_fc_invoice_b','ch_fc_invoice_b','91000000-0000-0000-0000-000000000012',700,'USD',1),'duplicate_event','same completed refund event cannot change the projection twice');
select is(public.record_feature_subscription_refund('evt_fc_refund_updated','refund.updated',repeat('a',64),'re_fc_rest','in_fc_invoice_b',
 'pi_fc_invoice_b','ch_fc_invoice_b','91000000-0000-0000-0000-000000000012',600,'USD',2),'refunded','a second provider event for one refund is recorded without double-counting its amount');
select is(public.record_feature_subscription_refund('evt_fc_refund_mismatch','charge.refunded',repeat('9',64),'re_fc_over','in_fc_invoice_b',
 'pi_fc_invoice_b','ch_fc_invoice_b','91000000-0000-0000-0000-000000000012',2000,'USD',3),'mismatch_refund_total','refund totals above settled amount are rejected rather than capped');
reset role;

set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
insert into public.feature_subscriptions(stripe_subscription_id,feature_key,payer_role,payer_id,config_revision,price_key,
 stripe_customer_id,status,current_period_end)
values('sub_fc_zero','form_coach','coach','91000000-0000-0000-0000-000000000014',5,'monthly_v5','cus_fc_zero','active',now()+interval '30 days');
insert into public.feature_subscriptions(stripe_subscription_id,feature_key,payer_role,payer_id,config_revision,price_key,
 stripe_customer_id,status,current_period_end)
values('sub_fc_trial','form_coach','coach','91000000-0000-0000-0000-000000000013',5,'monthly_v5','cus_fc_trial','trialing',now()+interval '30 days');
insert into public.feature_subscriptions(stripe_subscription_id,feature_key,payer_role,payer_id,config_revision,price_key,
 stripe_customer_id,status,current_period_end)
values('sub_fc_trial_stale','form_coach','coach','91000000-0000-0000-0000-000000000016',5,'monthly_v5','cus_fc_trial_stale','trialing',now()+interval '30 days');
select throws_ok(
 $$select * from public.record_feature_trial_claim('92000000-0000-0000-0000-000000000165','91000000-0000-0000-0000-000000000016',2,'trial_days','subscription','sub_fc_trial_stale','sub_fc_trial_stale',now(),now()+interval '7 days',0,repeat('c',64))$$,
 '22023',null,'time-trial claim must use the immutable revision bound to its subscription');
insert into public.feature_trial_access_grants(feature_key,user_id,starts_at,expires_at,source,source_id)
values('form_coach','91000000-0000-0000-0000-000000000016',now(),now()+interval '7 days','subscription_trial','sub_fc_trial_stale');
select is(public.apply_feature_subscription_state_cas('evt_fc_trial_grant_without_claim','customer.subscription.updated','sub_fc_trial_stale',0,
 'active',now()+interval '30 days',false),'applied','unclaimed legacy trial grant is evaluated only against the current subscription snapshot');
select is((select access_through from public.feature_subscription_access_current where subscription_id='sub_fc_trial_stale'),
 null::timestamptz,'a subscription-derived trial grant without immutable claim proof grants no feature access');
select is(public.record_feature_subscription_invoice('evt_fc_zero_only','invoice.paid',repeat('a',64),'in_fc_zero_only','sub_fc_zero',
 '91000000-0000-0000-0000-000000000014',1,'paid','USD',0,0,now(),now()+interval '7 days',null,null,null,0),'applied','zero-dollar invoice is recorded without assuming trial access');
select is((select access_through from public.feature_subscription_access_current where subscription_id='sub_fc_zero'),null::timestamptz,'zero-dollar invoice alone creates no paid or trial access');
select is((select outcome from public.record_feature_trial_claim('92000000-0000-0000-0000-000000000160',
 '91000000-0000-0000-0000-000000000013',5,'trial_days','subscription','sub_fc_trial','sub_fc_trial',
 now(),now()+interval '7 days',0,repeat('b',64))),'claimed','service records one bounded trial claim against a verified trialing subscription');
select is((select outcome from public.record_feature_trial_claim('92000000-0000-0000-0000-000000000160',
 '91000000-0000-0000-0000-000000000013',5,'trial_days','subscription','sub_fc_trial','sub_fc_trial',
 (select starts_at from public.feature_trial_claims where request_id='92000000-0000-0000-0000-000000000160'),
 (select expires_at from public.feature_trial_claims where request_id='92000000-0000-0000-0000-000000000160'),0,repeat('b',64))),'already_claimed','same trial claim retries idempotently');
select is((select outcome from public.record_feature_trial_claim('92000000-0000-0000-0000-000000000161',
 '91000000-0000-0000-0000-000000000013',2,'trial_days','subscription','sub_fc_trial','sub_fc_trial',
 (select starts_at from public.feature_trial_claims where request_id='92000000-0000-0000-0000-000000000160'),
 (select expires_at from public.feature_trial_claims where request_id='92000000-0000-0000-0000-000000000160'),0,repeat('c',64))),'already_claimed','trial uniqueness spans pricing revisions');
select ok((select access_through=expires_at from public.feature_subscription_access_current a
 join public.feature_trial_claims c on c.stripe_subscription_id=a.subscription_id
 where a.subscription_id='sub_fc_trial' and c.request_id='92000000-0000-0000-0000-000000000160'),
 'verified time trial access ends at its immutable claim expiry');
select is((select outcome from public.record_feature_bundle_funding('93000000-0000-0000-0000-000000000160','form_coach',
 '91000000-0000-0000-0000-000000000013',5,now()+interval '40 days','fc-trial-funded-bundle')),'funded',
 'current verified subscription trial funds one bundle without a credit debit');
select is(public.apply_feature_subscription_state_cas('evt_fc_trial_short_period','customer.subscription.updated','sub_fc_trial',0,
 'trialing',now()+interval '1 day',false),'applied','fresh provider snapshot may shorten the current trial period');
select ok((select access_through<=now()+interval '2 days' from public.feature_subscription_access_current
 where subscription_id='sub_fc_trial'),'trial access is capped by the shortened current subscription period');
select is(public.apply_feature_subscription_state_cas('evt_fc_trial_canceled','customer.subscription.updated','sub_fc_trial',1,
 'canceled',now()+interval '30 days',false),'applied','cancellation removes subscription-derived trial access');
select is((select access_through from public.feature_subscription_access_current where subscription_id='sub_fc_trial'),
 null::timestamptz,'canceled trial subscription has no access despite a future provider period');
select is((select outcome from public.record_feature_bundle_funding('93000000-0000-0000-0000-000000000160','form_coach',
 '91000000-0000-0000-0000-000000000013',5,now()+interval '40 days','fc-trial-funded-bundle')),'already_funded',
 'an immutable funded bundle remains usable through its own due date after subscription cancellation');
select is((select outcome from public.record_feature_bundle_funding('93000000-0000-0000-0000-000000000161','form_coach',
 '91000000-0000-0000-0000-000000000013',5,now()+interval '40 days','fc-trial-no-new-bundle')),'unfunded',
 'a subscription-derived trial grant cannot fund a new bundle after cancellation');
select is(public.record_feature_subscription_invoice('evt_fc_trial_invoice','invoice.paid',repeat('d',64),'in_fc_trial','sub_fc_trial',
 '91000000-0000-0000-0000-000000000013',1,'paid','USD',0,0,
 (select starts_at from public.feature_trial_claims where request_id='92000000-0000-0000-0000-000000000160'),
 (select expires_at from public.feature_trial_claims where request_id='92000000-0000-0000-0000-000000000160'),null,null,
 (select id from public.feature_trial_claims where request_id='92000000-0000-0000-0000-000000000160'),0),'applied','zero invoice links only to the separately verified trial grant');
select is((select count(*)::integer from public.feature_credit_lots where user_id='91000000-0000-0000-0000-000000000013'),0,'time trial does not debit or mint assessment credits');
select is((select outcome from public.record_feature_trial_claim('92000000-0000-0000-0000-000000000162',
 '91000000-0000-0000-0000-000000000015',5,'trial_assessments','assessment_trial','trial-offer-v5',null,
 now(),null,2,repeat('e',64))),'claimed','finite assessment trial records its configured count as explicit provenance');
select is((select sum(granted_units)::integer from public.feature_credit_lots where user_id='91000000-0000-0000-0000-000000000015' and lot_kind='assessment_trial'),2,'finite trial grants only its configured number of assessment units');
reset role;

set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is((select outcome from public.reserve_feature_customer_create('91000000-0000-0000-0000-000000000012','92000000-0000-0000-0000-000000000140',repeat('b',64))),'reserved','customer creation is reserved before provider work');
select is((select outcome from public.reserve_feature_customer_create('91000000-0000-0000-0000-000000000012','92000000-0000-0000-0000-000000000140',repeat('b',64))),'existing','customer reservation retry uses the same request identity');
select is(public.advance_feature_customer_create((select id from public.feature_customer_create_attempts where request_id='92000000-0000-0000-0000-000000000140'),0,'unknown',null),'unknown','uncertain customer create remains reserved for reconciliation');
select is(public.advance_feature_customer_create((select id from public.feature_customer_create_attempts where request_id='92000000-0000-0000-0000-000000000140'),1,'bound','cus_fc_owner_a'),'bound','customer binding records exact provider result by CAS');
select is(public.advance_feature_customer_create((select id from public.feature_customer_create_attempts where request_id='92000000-0000-0000-0000-000000000140'),2,'verified','cus_fc_owner_a'),'verified','verified customer mapping is immutable and payer-owned');
select is((select outcome from public.reserve_feature_customer_create('91000000-0000-0000-0000-000000000012','92000000-0000-0000-0000-000000000141',repeat('c',64))),'reused','same payer reuses its verified Form Coach customer');
select is((select stripe_customer_id from public.feature_payer_customer_mappings where payer_id='91000000-0000-0000-0000-000000000012'),'cus_fc_owner_a','payer mapping retains the exact verified owner');
select throws_ok(
 $$update public.feature_payer_customer_mappings set payer_id='91000000-0000-0000-0000-000000000015' where payer_id='91000000-0000-0000-0000-000000000012'$$,
 '42501',null,'verified payer-to-customer ownership cannot be edited');
select throws_ok(
 $$delete from public.feature_payer_customer_mappings where payer_id='91000000-0000-0000-0000-000000000012'$$,
 '42501',null,'verified payer-to-customer binding cannot be deleted');
select is((select outcome from public.reserve_feature_customer_create('91000000-0000-0000-0000-000000000015','92000000-0000-0000-0000-000000000142',repeat('d',64))),'reserved','another payer gets a distinct customer reservation');
select throws_ok(
 $$select public.advance_feature_customer_create((select id from public.feature_customer_create_attempts where request_id='92000000-0000-0000-0000-000000000142'),0,'bound','cus_fc_owner_a')$$,
 '23505',null,'a customer ID already owned by one payer cannot bind to another payer'
);
insert into public.feature_provider_objects(feature_key,object_type,object_id,payer_id)
values('form_coach','customer','cus_fc_legacy_same','91000000-0000-0000-0000-000000000014');
select is((select outcome from public.reserve_feature_customer_create('91000000-0000-0000-0000-000000000014','92000000-0000-0000-0000-000000000146',repeat('a',64))),
 'legacy_bound','new mapping layer reconciles the same payer’s legacy Form Coach customer');
select is(public.advance_feature_customer_create((select id from public.feature_customer_create_attempts where request_id='92000000-0000-0000-0000-000000000146'),0,'verified','cus_fc_legacy_same'),
 'verified','same-owner legacy customer receives the immutable payer mapping');
select is((select stripe_customer_id from public.feature_payer_customer_mappings where payer_id='91000000-0000-0000-0000-000000000014'),
 'cus_fc_legacy_same','legacy customer ownership is represented by the new mapping');
select throws_ok(
 $$select public.advance_feature_customer_create((select id from public.feature_customer_create_attempts where request_id='92000000-0000-0000-0000-000000000142'),0,'bound','cus_fc_legacy_same')$$,
 '23505',null,'different payer cannot claim a legacy customer owned by another payer'
);
select is((select state from public.feature_customer_create_attempts where request_id='92000000-0000-0000-0000-000000000142'),
 'reserved','rejected legacy ownership leaves the create reservation unpoisoned');
select is((select stripe_customer_id from public.feature_customer_create_attempts where request_id='92000000-0000-0000-0000-000000000142'),
 null::text,'rejected legacy ownership does not retain the conflicting provider ID');
select is((select outcome from public.reserve_feature_customer_create('91000000-0000-0000-0000-000000000016','92000000-0000-0000-0000-000000000143',repeat('e',64))),'reserved','late-create deletion test starts from an unresolved reservation');
insert into public.platform_membership_deletion_locks(member_id) values('91000000-0000-0000-0000-000000000016');
select is(public.advance_feature_customer_create((select id from public.feature_customer_create_attempts where request_id='92000000-0000-0000-0000-000000000143'),0,'bound','cus_fc_late_delete'),'cancel_required','ordinary late bound response after tombstone is recorded for cancellation');
select is((select stripe_customer_id from public.feature_customer_create_attempts where request_id='92000000-0000-0000-0000-000000000143'),
 'cus_fc_late_delete','late bound customer ID is retained for cancellation reconciliation');
select is((select outcome from public.reserve_feature_customer_create('91000000-0000-0000-0000-000000000016','92000000-0000-0000-0000-000000000144',repeat('f',64))),'blocked_deletion','persistent deletion tombstone blocks new customer attempts');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-0000-0000-000000000011","role":"authenticated"}';
select is(public.admin_create_feature_pricing_revision(
 'form_coach',5,'pricing_pending','coach',null,'USD','Form Coach','Billing paused','',0,0,'[]'::jsonb
),6::bigint,'pricing_pending revision closes new billing without deleting old contract history');
select is(public.admin_grant_feature_comp('91000000-0000-0000-0000-000000000015','form_coach',now(),now()+interval '7 days','explicit pending-state test comp','92000000-0000-0000-0000-000000000150') is not null,true,'admin can explicitly comp during pricing pending');
reset role;

set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is((select outcome from public.record_feature_trial_claim('92000000-0000-0000-0000-000000000163',
 '91000000-0000-0000-0000-000000000014',5,'trial_assessments','assessment_trial','trial-offer-v5',null,
 now(),null,2,repeat('f',64))),'feature_unavailable','pricing pending blocks new trial claims');
select is((select outcome from public.record_feature_bundle_funding('93000000-0000-0000-0000-000000000150','form_coach',
 '91000000-0000-0000-0000-000000000015',5,'2099-01-01T00:00:00Z','fc-1b-pending-comp')),'funded','explicit comp funds a new bundle while pricing is pending');
select is((select funding_source from public.feature_bundle_funding_receipts where operation_key='fc-1b-pending-comp'),'comp','pending-state comp receipt preserves its source without a debit');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-0000-0000-000000000011","role":"authenticated"}';
select is(public.admin_create_feature_pricing_revision(
 'form_coach',6,'disabled','coach',null,'USD','Form Coach','Billing disabled','',0,0,'[]'::jsonb
),7::bigint,'disabled revision is an explicit hard stop');
reset role;

set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is((select outcome from public.record_feature_bundle_funding('93000000-0000-0000-0000-000000000150','form_coach',
 '91000000-0000-0000-0000-000000000015',5,'2099-01-01T00:00:00Z','fc-1b-pending-comp')),'blocked_disabled','disabled feature blocks even an already funded bundle from new use');
select is((select count(*)::integer from public.feature_bundle_funding_receipts where operation_key='fc-1b-pending-comp'),1,'disabled state keeps the immutable funding receipt');
select is((select count(*)::integer from public.feature_trial_claims),2,'blocked billing states do not create additional trial claims');
select is((select count(*)::integer from public.feature_subscription_contract_versions where stripe_subscription_id='sub_fc_move'),2,'billing state changes preserve both original and migrated subscription contracts');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-0000-0000-000000000012","role":"authenticated"}';
select is((select count(*)::integer from public.feature_my_invoice_history),2,'owner history projection exposes only the payer invoice summaries');
select ok(not exists(select 1 from information_schema.columns where table_schema='public'
 and table_name in ('feature_my_invoice_history','feature_my_subscription_contracts','feature_my_subscription_access')
 and column_name in ('stripe_customer_id','stripe_subscription_id','stripe_price_id','payment_intent_id','charge_id','invoice_id')),
 'owner billing views omit raw processor identifiers');
select throws_ok(
 $$update public.feature_subscription_contract_versions set amount_cents=1 where stripe_subscription_id='sub_fc_move'$$,
 '42501',null,'authenticated owners cannot mutate immutable contract history'
);
reset role;

select * from finish();
rollback;
