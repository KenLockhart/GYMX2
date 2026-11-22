begin;
select plan(126);

insert into auth.users(id,email,raw_user_meta_data) values
 ('91000000-0000-0000-0000-000000000001','form-admin@example.test','{"display_name":"Form Coach Admin"}'),
 ('91000000-0000-0000-0000-000000000002','form-coach@example.test','{"display_name":"Form Coach Payer"}'),
 ('91000000-0000-0000-0000-000000000003','form-member@example.test','{"display_name":"Form Coach Recipient"}'),
 ('91000000-0000-0000-0000-000000000004','form-other-coach@example.test','{"display_name":"Another Coach"}');
update public.profiles set role='admin' where id='91000000-0000-0000-0000-000000000001';
update public.profiles set role='coach' where id='91000000-0000-0000-0000-000000000002';
update public.profiles set role='coach' where id='91000000-0000-0000-0000-000000000004';

select is((select count(*)::integer from public.feature_pricing_revisions where feature_key='form_coach'),1,'seed creates one Form Coach pricing revision');
select is((select status from public.feature_pricing_revisions where feature_key='form_coach' and revision=1),'pricing_pending','default status is pricing pending');
select is((select payer from public.feature_pricing_revisions where feature_key='form_coach' and revision=1),'coach','default payer is coach');
select is((select display_name from public.feature_pricing_revisions where feature_key='form_coach' and revision=1),'Form Coach','seed freezes the safe display name');
select is((select trial_assessments from public.feature_pricing_revisions where feature_key='form_coach' and revision=1),0,'seed configures no free assessment credits');
select is((select count(*)::integer from public.feature_pricing_options where feature_key='form_coach'),0,'default has no Stripe price options');
select is((select count(*)::integer from public.feature_credit_lots where feature_key='form_coach'),0,'seed creates no finite trial or purchased credits');
select is((select count(*)::integer from public.feature_access_grants where feature_key='form_coach'),0,'migration does not auto-comp any account');
select is((select status from public.feature_public_pricing where feature_key='form_coach'),'pricing_pending','public projection exposes only safe pending state');
select is((select display_name from public.feature_public_pricing where feature_key='form_coach'),'Form Coach','safe pricing projection exposes revisioned display metadata');

set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok(
 $$select public.admin_create_feature_pricing_revision('form_coach',1,'pricing_pending','coach',null,'USD','Form Coach','','',0,0,'[]'::jsonb)$$,
 '42501',null,'member cannot create a pricing revision'
);
select throws_ok(
 $$insert into public.feature_credit_lots(feature_key,user_id,lot_kind,granted_units,remaining_units) values('form_coach',auth.uid(),'assessment_trial',1,1)$$,
 '42501',null,'member cannot grant their own credits'
);
select throws_ok(
 $$select * from public.reserve_feature_checkout('form_coach','91000000-0000-0000-0000-000000000003',1,'pack_3',1,'92000000-0000-0000-0000-000000000001')$$,
 '42501',null,'member cannot call service checkout reservation'
);
select throws_ok(
 $$select public.admin_grant_feature_comp('91000000-0000-0000-0000-000000000003','form_coach',now(),now()+interval '1 day','forged comp','92000000-0000-0000-0000-000000000002')$$,
 '42501',null,'member cannot create a comp grant'
);
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.admin_create_feature_pricing_revision(
 'form_coach',1,'live','coach','per_assessment','USD','Form Coach','Private movement feedback.','Test marketing copy.',0,2,
 '[{"price_key":"pack_3","amount_cents":1500,"currency":"USD","interval":null,"credits_per_pack":3,"stripe_product_id":"prod_fc_test","stripe_price_id":"price_fc_pack_3"}]'::jsonb
),2::bigint,'admin publishes next pricing revision with a provider price binding');
reset role;
set local role service_role;
select is((select trial_assessments from public.feature_pricing_revisions where feature_key='form_coach' and revision=2),2,'assessment trial quantity is frozen on its pricing revision');
select is((select count(*)::integer from public.feature_credit_lots where feature_key='form_coach'),0,'configuring trials does not auto-grant credits to accounts');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
 $$select public.admin_create_feature_pricing_revision('form_coach',1,'pricing_pending','coach',null,'USD','Form Coach','','',0,0,'[]'::jsonb)$$,
 '40001',null,'stale admin revision compare-and-swap is rejected'
);
select throws_ok(
 $$select public.admin_create_feature_pricing_revision('form_coach',null,'pricing_pending','coach',null,'USD','Form Coach','','',0,0,'[]'::jsonb)$$,
 '22023',null,'null expected revision is rejected before the CAS comparison'
);
select throws_ok(
 $$select public.admin_create_feature_pricing_revision('form_coach',0,'pricing_pending','coach',null,'USD','Form Coach','','',0,0,'[]'::jsonb)$$,
 '22023',null,'nonpositive expected revision is rejected'
);
select throws_ok(
 $$select public.admin_create_feature_pricing_revision('form_coach',9223372036854775807,'pricing_pending','coach',null,'USD','Form Coach','','',0,0,'[]'::jsonb)$$,
 '22023',null,'unsupported maximum expected revision is rejected before overflow'
);
reset role;
set local role service_role;
select is((select revision from public.feature_pricing_current where feature_key='form_coach'),2::bigint,'invalid CAS inputs leave the current revision unchanged');
select is((select count(*)::integer from public.feature_pricing_revisions where feature_key='form_coach'),2,'invalid CAS inputs add no pricing history');
reset role;

set local role service_role;
select is((select outcome from public.reserve_feature_checkout('form_coach','91000000-0000-0000-0000-000000000002',2,'pack_3',2,'92000000-0000-0000-0000-000000000010')),'reserved','service reserves a two-pack quote');
select is((select total_amount_cents::integer from public.feature_checkout_reservations where request_id='92000000-0000-0000-0000-000000000010'),3000,'quote freezes price times pack quantity');
select is((select quoted_credits::integer from public.feature_checkout_reservations where request_id='92000000-0000-0000-0000-000000000010'),6,'quote freezes credits times pack quantity');
select throws_ok(
 $$update public.feature_checkout_reservations set total_amount_cents=1 where request_id='92000000-0000-0000-0000-000000000010'$$,
 '42501',null,'checkout quote snapshot cannot be edited'
);
select is(public.mark_feature_checkout_unknown((select id from public.feature_checkout_reservations where request_id='92000000-0000-0000-0000-000000000010')),'unknown','uncertain provider create stays reserved as unknown');
select is((select outcome from public.reserve_feature_checkout('form_coach','91000000-0000-0000-0000-000000000002',2,'pack_3',2,'92000000-0000-0000-0000-000000000011')),'pending_reconciliation','unknown reservation prevents a second checkout');
select is(public.apply_feature_checkout_payment('evt_fc_paid_1','checkout.session.completed','{"feature_namespace":"form_coach"}'::jsonb,
 'cs_fc_test_1','pi_fc_test_1','pi_fc_test_1','price_fc_pack_3',3000,'USD',2),'unmatched_reservation','signed payment event arriving before session binding is retained for retry');
select is(public.bind_feature_checkout_session((select id from public.feature_checkout_reservations where request_id='92000000-0000-0000-0000-000000000010'),'cs_fc_test_1','cus_fc_test_1',null),'bound','provider session binds to the immutable reservation');
select is(public.apply_feature_checkout_payment('evt_fc_paid_1','checkout.session.completed','{"feature_namespace":"form_coach"}'::jsonb,
 'cs_fc_test_1','pi_fc_test_1','pi_fc_test_1','price_fc_pack_3',3000,'USD',2),'applied','same unmatched payment event retries successfully after binding');
select is(public.feature_stripe_namespace('{}'::jsonb,'cs_fc_test_1'),'form_coach','stored session mapping routes event to feature namespace');
select is(public.feature_stripe_namespace('{"feature_namespace":"form_coach"}'::jsonb,'unmapped_fc'),'form_coach','signed metadata can identify feature namespace');
select is(public.feature_stripe_namespace('{"feature_namespace":"platform_membership"}'::jsonb,'unrelated_object'),null,'generic membership namespace is not claimed');
select is(public.apply_feature_checkout_payment('evt_fc_paid_replay','checkout.session.completed','{"feature_namespace":"form_coach"}'::jsonb,
 'cs_fc_test_1','pi_fc_test_1','pi_fc_test_1','price_fc_pack_3',3000,'USD',2),'already_applied','a second signed event for a paid session does not mint another receipt');
select is(public.apply_feature_checkout_payment('evt_fc_paid_1','checkout.session.completed','{"feature_namespace":"form_coach"}'::jsonb,
 'cs_fc_test_1','pi_fc_test_1','pi_fc_test_1','price_fc_pack_3',3000,'USD',2),'duplicate_event','duplicate provider event does not apply twice');
select is(public.apply_feature_checkout_payment('evt_fc_paid_1','checkout.session.completed','{"feature_namespace":"form_coach"}'::jsonb,
 'cs_fc_other','pi_fc_other','pi_fc_other','price_fc_pack_3',3000,'USD',2),'event_id_mismatch','a reused event ID cannot be rebound to a different object');
select is((select total_credits::integer from public.feature_payment_receipts where stripe_checkout_session_id='cs_fc_test_1'),6,'payment receipt records exact quoted credits');
select is((select count(*)::integer from public.feature_credit_lots where source_receipt_id=(select id from public.feature_payment_receipts where stripe_checkout_session_id='cs_fc_test_1')),2,'each purchased pack unit has its own refund lot');
select is((select sum(remaining_units)::integer from public.feature_credit_lots where source_receipt_id=(select id from public.feature_payment_receipts where stripe_checkout_session_id='cs_fc_test_1')),6,'receipt funds exact pack credits');
select is((select outcome from public.reserve_feature_checkout('form_coach','91000000-0000-0000-0000-000000000002',2,'pack_3',1,'92000000-0000-0000-0000-000000000012')),'reserved','a verified paid pack does not block a later credit-pack purchase');
update public.feature_checkout_reservations set state='canceled' where request_id='92000000-0000-0000-0000-000000000012';
select is((select outcome from public.apply_feature_pack_refund((select id from public.feature_payment_receipts where stripe_checkout_session_id='cs_fc_test_1'),'re_fc_test_1',1)),'applied','pack refund is applied to the originating purchase');
select is((select sum(removed_credit_units)::integer from public.feature_pack_refund_units),3::integer,'refund removes only that pack unit credit balance');
select is((select sum(remaining_units)::integer from public.feature_credit_lots where source_receipt_id=(select id from public.feature_payment_receipts where stripe_checkout_session_id='cs_fc_test_1')),3,'consumed/refunded credits cannot create negative balance');
select is((select outcome from public.apply_feature_pack_refund((select id from public.feature_payment_receipts where stripe_checkout_session_id='cs_fc_test_1'),'re_fc_test_1',1)),'duplicate_refund','same refund ID is idempotent');
select throws_ok(
 $$select * from public.apply_feature_pack_refund((select id from public.feature_payment_receipts where stripe_checkout_session_id='cs_fc_test_1'),'re_fc_test_1',2)$$,
 '23505',null,'a refund ID cannot be reused with a different quantity'
);
select is((select outcome from public.record_feature_bundle_funding('93000000-0000-0000-0000-000000000001','form_coach','91000000-0000-0000-0000-000000000002',2,'2026-11-27T00:00:00Z','bundle-op-1')),'funded','coach payer funds bundle from a pack at send');
select is((select funding_source from public.feature_bundle_funding_receipts where bundle_id='93000000-0000-0000-0000-000000000001'),'pack','bundle funding receipt records its source');
select is((select sum(remaining_units)::integer from public.feature_credit_lots where user_id='91000000-0000-0000-0000-000000000002' and lot_kind='pack'),2,'bundle consumes exactly one credit');
select is((select outcome from public.record_feature_bundle_funding('93000000-0000-0000-0000-000000000001','form_coach','91000000-0000-0000-0000-000000000002',2,'2026-11-27T00:00:00Z','bundle-op-1')),'already_funded','same bundle operation does not debit twice');
select is((select sum(remaining_units)::integer from public.feature_credit_lots where user_id='91000000-0000-0000-0000-000000000002' and lot_kind='pack'),2,'idempotent bundle retry keeps balance unchanged');
select throws_ok(
 $$select * from public.record_feature_bundle_funding('93000000-0000-0000-0000-000000000001','form_coach','91000000-0000-0000-0000-000000000003',2,'2026-11-27T00:00:00Z','bundle-op-payer-transfer')$$,
 '23505',null,'an existing bundle receipt cannot transfer its frozen payer'
);

reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.admin_create_feature_pricing_revision('form_coach',2,'live','coach','subscription','USD','Form Coach','Private movement feedback.','Test subscription copy.',0,0,
 '[{"price_key":"monthly","amount_cents":9000,"currency":"USD","interval":"month","credits_per_pack":null,"stripe_product_id":"prod_fc_monthly_v1","stripe_price_id":"price_fc_monthly_v1"}]'::jsonb),3::bigint,'subscription billing model uses a new immutable revision');
reset role;
set local role service_role;
select is((select outcome from public.reserve_feature_checkout('form_coach','91000000-0000-0000-0000-000000000002',3,'monthly',1,'92000000-0000-0000-0000-000000000040')),'reserved','service reserves a subscription quote');
select is(public.bind_feature_checkout_session((select id from public.feature_checkout_reservations where request_id='92000000-0000-0000-0000-000000000040'),'cs_fc_sub_1',null,null),'bound','initial subscription session binding may arrive without customer or subscription IDs');
select is(public.apply_feature_checkout_payment('evt_fc_sub_checkout','checkout.session.completed','{"feature_namespace":"form_coach"}'::jsonb,
 'cs_fc_sub_1','pi_fc_sub_1','pi_fc_sub_1','price_fc_monthly_v1',9000,'USD',1),'awaiting_provider_binding','subscription payment stays retryable until both provider bindings arrive');
select is((select state from public.feature_checkout_reservations where request_id='92000000-0000-0000-0000-000000000040'),'bound','missing subscription IDs do not mark a checkout paid');
select is((select count(*)::integer from public.feature_payment_receipts where stripe_checkout_session_id='cs_fc_sub_1'),0,'missing subscription IDs do not create a payment receipt');
select is(public.apply_feature_subscription_state_cas('evt_fc_sub_activate','customer.subscription.created','sub_fc_test_1',0,'active',now()+interval '30 days',false),'unmatched_subscription','subscription event arriving before receipt mapping is retained for retry');
select is(public.bind_feature_checkout_session((select id from public.feature_checkout_reservations where request_id='92000000-0000-0000-0000-000000000040'),'cs_fc_sub_1','cus_fc_test_1','sub_fc_test_1'),'bound','same payer may reuse its customer binding across pricing revisions');
select is(public.bind_feature_checkout_session((select id from public.feature_checkout_reservations where request_id='92000000-0000-0000-0000-000000000040'),'cs_fc_sub_1','cus_fc_test_1','sub_fc_test_1'),'bound','duplicate same-session enrichment is idempotent');
select throws_ok(
 $$select public.bind_feature_checkout_session((select id from public.feature_checkout_reservations where request_id='92000000-0000-0000-0000-000000000040'),'cs_fc_sub_1','cus_fc_conflict','sub_fc_test_1')$$,
 '23505',null,'late enrichment rejects a conflicting customer identity'
);
select throws_ok(
 $$select public.bind_feature_checkout_session((select id from public.feature_checkout_reservations where request_id='92000000-0000-0000-0000-000000000040'),'cs_fc_sub_1','cus_fc_test_1','sub_fc_conflict')$$,
 '23505',null,'late enrichment rejects a conflicting subscription identity'
);
select is(public.apply_feature_checkout_payment('evt_fc_sub_checkout','checkout.session.completed','{"feature_namespace":"form_coach"}'::jsonb,
 'cs_fc_sub_1','pi_fc_sub_1','pi_fc_sub_1','price_fc_monthly_v1',9000,'USD',1),'applied','same payment event retries successfully after late provider enrichment');
select is((select status from public.feature_subscriptions where stripe_subscription_id='sub_fc_test_1'),'pending_reconcile','checkout creates a subscription that must be reconciled');
select is((select count(*)::integer from public.feature_payment_receipts where stripe_checkout_session_id='cs_fc_sub_1'),1,'late enrichment retry creates exactly one payment receipt');
select is((select count(*)::integer from public.feature_subscriptions where stripe_subscription_id='sub_fc_test_1'),1,'late enrichment retry creates exactly one reconciliation row');
select is((select outcome from public.reserve_feature_checkout('form_coach','91000000-0000-0000-0000-000000000002',3,'monthly',1,'92000000-0000-0000-0000-000000000041')),'subscription_exists','pending reconciliation blocks a second subscription checkout');
select is(public.apply_feature_subscription_state_cas('evt_fc_sub_activate','customer.subscription.created','sub_fc_test_1',0,'active',now()+interval '30 days',false),'applied','current subscription state activates through revision CAS');
select is((select outcome from public.reserve_feature_checkout('form_coach','91000000-0000-0000-0000-000000000002',3,'monthly',1,'92000000-0000-0000-0000-000000000042')),'subscription_exists','active subscription blocks another checkout even after payment completes');
select throws_ok(
 $$insert into public.feature_subscriptions(stripe_subscription_id,feature_key,payer_role,payer_id,config_revision,price_key,stripe_customer_id,status,current_period_end) values('sub_fc_duplicate','form_coach','coach','91000000-0000-0000-0000-000000000002',3,'monthly','cus_fc_test_1','active',now()+interval '30 days')$$,
 '23505',null,'partial unique index blocks a second collectible subscription row for the payer'
);
select is((select outcome from public.reserve_feature_checkout('form_coach','91000000-0000-0000-0000-000000000004',3,'monthly',1,'92000000-0000-0000-0000-000000000048')),'reserved','a different coach can reserve their own subscription');
select throws_ok(
 $$select public.bind_feature_checkout_session((select id from public.feature_checkout_reservations where request_id='92000000-0000-0000-0000-000000000048'),'cs_fc_wrong_owner','cus_fc_test_1','sub_fc_wrong_owner')$$,
 '23505',null,'a provider customer binding cannot move to another payer'
);
update public.feature_checkout_reservations set state='canceled' where request_id='92000000-0000-0000-0000-000000000048';
select is((select funding_source from public.record_feature_bundle_funding('93000000-0000-0000-0000-000000000002','form_coach','91000000-0000-0000-0000-000000000002',3,now()+interval '7 days','bundle-op-sub')),'subscription','active subscription funds without a credit debit');
select is((select sum(remaining_units)::integer from public.feature_credit_lots where user_id='91000000-0000-0000-0000-000000000002' and lot_kind='pack'),2,'subscription funding leaves purchased pack credits intact');
select is(public.feature_stripe_namespace('{}'::jsonb,'sub_fc_test_1'),'form_coach','subscription mapping routes namespaced events');
select is(public.apply_feature_subscription_state_cas('evt_fc_sub_1','customer.subscription.updated','sub_fc_test_1',1,'past_due',now()+interval '30 days',false),'applied','subscription state updates with expected revision CAS');
select is(public.apply_feature_subscription_state_cas('evt_fc_sub_2','customer.subscription.updated','sub_fc_test_1',1,'active',now()+interval '40 days',false),'stale_revision','stale subscription event cannot overwrite reconciled state');
select is(public.apply_feature_subscription_state_cas('evt_fc_sub_2','customer.subscription.updated','sub_fc_test_1',2,'past_due',now()+interval '30 days',false),'applied','same stale event can retry after current provider state is reconciled');
select is(public.apply_feature_subscription_state_cas('evt_fc_sub_cancel','customer.subscription.deleted','sub_fc_test_1',3,'canceled',now()+interval '30 days',false),'applied','verified terminal cancellation releases the subscription slot');
select is((select outcome from public.reserve_feature_checkout('form_coach','91000000-0000-0000-0000-000000000002',3,'monthly',1,'92000000-0000-0000-0000-000000000043')),'reserved','a new subscription checkout is allowed after terminal cancellation');
update public.feature_checkout_reservations set state='canceled' where request_id='92000000-0000-0000-0000-000000000043';
select is((select outcome from public.reserve_feature_checkout('form_coach','91000000-0000-0000-0000-000000000002',3,'monthly',1,'92000000-0000-0000-0000-000000000044')),'reserved','legacy reconciliation scenario reserves after cancellation');
select is(public.bind_feature_checkout_session((select id from public.feature_checkout_reservations where request_id='92000000-0000-0000-0000-000000000044'),'cs_fc_legacy',null,'sub_fc_legacy'),'bound','legacy paid checkout initially lacks its customer binding');
insert into public.feature_processed_events(event_id,event_type,feature_key,object_id,processing_state)
values('evt_fc_legacy_paid','checkout.session.completed','form_coach','cs_fc_legacy','applied');
insert into public.feature_payment_receipts(feature_key,reservation_id,request_id,payer_role,payer_id,config_revision,price_key,
 stripe_product_id,stripe_price_id,stripe_checkout_session_id,payment_object_id,payment_intent_id,stripe_subscription_id,
 pack_quantity,credits_per_pack,total_credits,amount_cents,currency,disposition,event_id)
select r.feature_key,r.id,r.request_id,r.payer_role,r.payer_id,r.config_revision,r.price_key,r.stripe_product_id,r.stripe_price_id,
 r.stripe_checkout_session_id,'pi_fc_legacy','pi_fc_legacy','sub_fc_legacy',r.pack_quantity,r.credits_per_pack,r.quoted_credits,
 r.total_amount_cents,r.currency,'applied','evt_fc_legacy_paid'
from public.feature_checkout_reservations r where r.request_id='92000000-0000-0000-0000-000000000044';
insert into public.feature_subscriptions(stripe_subscription_id,feature_key,payer_role,payer_id,config_revision,price_key,
 stripe_customer_id,status,current_period_end)
values('sub_fc_legacy','form_coach','coach','91000000-0000-0000-0000-000000000002',3,'monthly','','pending_reconcile',now());
update public.feature_checkout_reservations set state='paid' where request_id='92000000-0000-0000-0000-000000000044';
select is(public.apply_feature_subscription_state_cas('evt_fc_legacy_sub','customer.subscription.created','sub_fc_legacy',0,'active',now()+interval '30 days',false),'awaiting_provider_binding','legacy subscription state stays retryable while its customer binding is missing');
select is(public.bind_feature_checkout_session((select id from public.feature_checkout_reservations where request_id='92000000-0000-0000-0000-000000000044'),'cs_fc_legacy','cus_fc_legacy','sub_fc_legacy'),'paid','late provider binding repairs a subscription row for an already-paid legacy receipt');
select is((select stripe_customer_id from public.feature_subscriptions where stripe_subscription_id='sub_fc_legacy'),'cus_fc_legacy','legacy receipt reconciliation uses the late verified customer ID');
select is(public.apply_feature_subscription_state_cas('evt_fc_legacy_sub','customer.subscription.created','sub_fc_legacy',1,'active',now()+interval '30 days',false),'applied','same early subscription event retries after late binding repair');
select is(public.apply_feature_subscription_state_cas('evt_fc_legacy_cancel','customer.subscription.deleted','sub_fc_legacy',2,'canceled',now()+interval '30 days',false),'applied','legacy subscription slot also releases after verified cancellation');
select is((select outcome from public.reserve_feature_checkout('form_coach','91000000-0000-0000-0000-000000000002',3,'monthly',1,'92000000-0000-0000-0000-000000000045')),'reserved','second legacy scenario reserves after verified cancellation');
select is(public.bind_feature_checkout_session((select id from public.feature_checkout_reservations where request_id='92000000-0000-0000-0000-000000000045'),'cs_fc_missingmap',null,null),'bound','legacy subscription session can be initially unbound');
select is(public.apply_feature_checkout_payment('evt_fc_missingmap_paid','checkout.session.completed','{"feature_namespace":"form_coach"}'::jsonb,
 'cs_fc_missingmap','pi_fc_missingmap','pi_fc_missingmap','price_fc_monthly_v1',9000,'USD',1),'awaiting_provider_binding','new handler leaves a missing-binding payment retryable');
insert into public.feature_payment_receipts(feature_key,reservation_id,request_id,payer_role,payer_id,config_revision,price_key,
 stripe_product_id,stripe_price_id,stripe_checkout_session_id,payment_object_id,payment_intent_id,stripe_subscription_id,
 pack_quantity,credits_per_pack,total_credits,amount_cents,currency,disposition,event_id)
select r.feature_key,r.id,r.request_id,r.payer_role,r.payer_id,r.config_revision,r.price_key,r.stripe_product_id,r.stripe_price_id,
 r.stripe_checkout_session_id,'pi_fc_missingmap','pi_fc_missingmap',null,r.pack_quantity,r.credits_per_pack,r.quoted_credits,
 r.total_amount_cents,r.currency,'applied','evt_fc_missingmap_paid'
from public.feature_checkout_reservations r where r.request_id='92000000-0000-0000-0000-000000000045';
update public.feature_checkout_reservations set state='paid' where request_id='92000000-0000-0000-0000-000000000045';
select is((select outcome from public.reserve_feature_checkout('form_coach','91000000-0000-0000-0000-000000000002',3,'monthly',1,'92000000-0000-0000-0000-000000000046')),'pending_reconciliation','paid legacy checkout with missing subscription mapping blocks a duplicate subscription');
select is(public.bind_feature_checkout_session((select id from public.feature_checkout_reservations where request_id='92000000-0000-0000-0000-000000000045'),'cs_fc_missingmap','cus_fc_missingmap','sub_fc_missingmap'),'paid','late verified IDs repair the already-paid legacy checkout');
select is(public.apply_feature_checkout_payment('evt_fc_missingmap_paid','checkout.session.completed','{"feature_namespace":"form_coach"}'::jsonb,
 'cs_fc_missingmap','pi_fc_missingmap','pi_fc_missingmap','price_fc_monthly_v1',9000,'USD',1),'already_applied','the same payment event retries safely after a legacy receipt is enriched');
select is((select count(*)::integer from public.feature_payment_receipts where stripe_checkout_session_id='cs_fc_missingmap'),1,'legacy payment retry preserves exactly one immutable receipt');
select is(public.apply_feature_subscription_state_cas('evt_fc_missingmap_cancel','customer.subscription.deleted','sub_fc_missingmap',0,'canceled',now()+interval '30 days',false),'applied','legacy subscription slot releases only after verified cancellation');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.admin_create_feature_pricing_revision('form_coach',3,'pricing_pending','member',null,'USD','Form Coach','','',0,0,'[]'::jsonb),4::bigint,'pending revision can change payer without rewriting prior quotes');
reset role;
set local role service_role;
select is((select payer_role || ':' || config_revision::text from public.feature_checkout_reservations where request_id='92000000-0000-0000-0000-000000000010'),'coach:2','payer and revision remain frozen on the earlier quote');
select is((select outcome from public.record_feature_bundle_funding('93000000-0000-0000-0000-000000000003','form_coach','91000000-0000-0000-0000-000000000002',2,now()+interval '7 days','bundle-op-pending')),'unfunded','pending status blocks new pack and subscription use without comp');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.admin_grant_feature_comp('91000000-0000-0000-0000-000000000003','form_coach',now()-interval '1 minute',now()+interval '1 day','Approved local pgTAP grant','92000000-0000-0000-0000-000000000020')$$,'admin can create an explicit comp grant');
reset role;
set local role service_role;
select is((select count(*)::integer from public.feature_access_grants where user_id='91000000-0000-0000-0000-000000000003' and feature_key='form_coach'),1,'comp grant is recorded without auto-comp seed');
select is((select outcome from public.record_feature_bundle_funding('93000000-0000-0000-0000-000000000004','form_coach','91000000-0000-0000-0000-000000000003',4,now()+interval '7 days','bundle-op-comp')),'funded','explicit comp funds a pending-price bundle');
select is((select credit_units_consumed from public.feature_bundle_funding_receipts where bundle_id='93000000-0000-0000-0000-000000000004'),0,'comp funding creates no credit debit');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.admin_create_feature_pricing_revision('form_coach',4,'live','coach','subscription','USD','Form Coach','Private movement feedback.','New subscription copy.',0,0,
 '[{"price_key":"monthly","amount_cents":9000,"currency":"USD","interval":"month","credits_per_pack":null,"stripe_product_id":"prod_fc_monthly","stripe_price_id":"price_fc_monthly"}]'::jsonb),5::bigint,'new live model is a new revision');
reset role;
set local role service_role;
select is((select sum(remaining_units)::integer from public.feature_credit_lots where user_id='91000000-0000-0000-0000-000000000002' and lot_kind='pack'),2,'unused pack credits survive the billing-model change');
select is((select count(*)::integer from public.feature_subscriptions where stripe_subscription_id='sub_fc_test_1' and config_revision=3 and price_key='monthly'),1,'grandfathered subscription record remains while pricing is pending');
select is((select funding_source from public.record_feature_bundle_funding('93000000-0000-0000-0000-000000000005','form_coach','91000000-0000-0000-0000-000000000002',5,now()+interval '7 days','bundle-op-grandfathered-pack')),'pack','grandfathered pack can fund when pricing returns live');
select is((select sum(remaining_units)::integer from public.feature_credit_lots where user_id='91000000-0000-0000-0000-000000000002' and lot_kind='pack'),1,'grandfathered pack consumes only one credit');
insert into public.feature_bundle_funding_receipts(id,bundle_id,feature_key,payer_role,payer_id,config_revision,
 funding_source,source_id,credit_units_consumed,due_at,operation_key,funded_at)
values('94000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000007','form_coach','coach',
 '91000000-0000-0000-0000-000000000002',5,'pack','synthetic-expired-lot',1,'2026-11-18T00:00:00Z','bundle-op-expired','2026-11-17T00:00:00Z');
select is((select outcome from public.record_feature_bundle_funding('93000000-0000-4000-8000-000000000007','form_coach',
 '91000000-0000-0000-0000-000000000002',5,'2026-11-18T00:00:00Z','bundle-op-expired')),
 'expired_existing','expired immutable funding is identified without issuing a new authorization');
select is((select sum(remaining_units)::integer from public.feature_credit_lots where user_id='91000000-0000-0000-0000-000000000002' and lot_kind='pack'),1,'expired funding retry consumes no second credit');
select is((select outcome from public.reserve_feature_checkout('form_coach','91000000-0000-0000-0000-000000000002',5,'monthly',1,'92000000-0000-0000-0000-000000000030')),'reserved','live subscription quote reserves for checkout');
select is(public.mark_feature_checkout_unknown((select id from public.feature_checkout_reservations where request_id='92000000-0000-0000-0000-000000000030')),'unknown','uncertain subscription create remains reserved');
select lives_ok($$select public.lock_platform_membership_account_for_deletion('91000000-0000-0000-0000-000000000002')$$,'existing account deletion RPC creates the persistent tombstone');
select is(public.bind_feature_checkout_session((select id from public.feature_checkout_reservations where request_id='92000000-0000-0000-0000-000000000030'),'cs_fc_late','cus_fc_late','sub_fc_late'),'cancel_required','late binding after tombstone is retained for cancellation');
select is(public.apply_feature_checkout_payment('evt_fc_late','checkout.session.completed','{"feature_namespace":"form_coach"}'::jsonb,
 'cs_fc_late','pi_fc_late','pi_fc_late','price_fc_monthly',9000,'USD',1),'blocked_deletion','late paid event cannot restore access after deletion lock');
select is((select disposition from public.feature_payment_receipts where stripe_checkout_session_id='cs_fc_late'),'blocked_deletion','late payment is retained only as a blocked audit receipt');
select is((select count(*)::integer from public.feature_credit_lots where source_receipt_id=(select id from public.feature_payment_receipts where stripe_checkout_session_id='cs_fc_late')),0,'late blocked payment mints no credit lots');
select is((select outcome from public.reserve_feature_checkout('form_coach','91000000-0000-0000-0000-000000000002',5,'monthly',1,'92000000-0000-0000-0000-000000000031')),'account_deleting','tombstone blocks a new checkout reservation');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.admin_create_feature_pricing_revision('form_coach',5,'disabled','coach','subscription','USD','Form Coach','Private movement feedback.','Disabled but retained copy.',0,0,
 '[{"price_key":"monthly","amount_cents":9000,"currency":"USD","interval":"month","credits_per_pack":null,"stripe_product_id":"prod_fc_monthly","stripe_price_id":"price_fc_monthly"}]'::jsonb),6::bigint,'disabled status is a new immutable revision');
reset role;
set local role service_role;
select is((select outcome from public.record_feature_bundle_funding('93000000-0000-0000-0000-000000000006','form_coach','91000000-0000-0000-0000-000000000002',5,now()+interval '7 days','bundle-op-disabled')),'blocked_disabled','disabled status blocks new attempts despite funded history');
select is((select count(*)::integer from public.feature_payment_receipts where payer_id='91000000-0000-0000-0000-000000000002'),5,'paid and blocked receipt history remains after disable');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"91000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::integer from public.feature_my_billing_summary where user_id<>auth.uid()),0,'owner summary does not expose another account');
select is((select count(*)::integer from public.feature_my_payment_receipts),5,'owner can read safe payment history');
select throws_ok($$select stripe_price_id from public.feature_my_payment_receipts$$,'42703',null,'safe receipt projection omits processor identifiers');
select throws_ok($$select * from public.feature_payment_receipts$$,'42501',null,'owner cannot read provider-bearing receipt table directly');
reset role;

select * from finish();
rollback;
