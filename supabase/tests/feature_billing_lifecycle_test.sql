begin;
select plan(138);

insert into auth.users(id,email,raw_user_meta_data) values
 ('95000000-0000-0000-0000-000000000001','fc-lifecycle-admin@example.test','{"display_name":"Lifecycle Admin"}'),
 ('95000000-0000-0000-0000-000000000002','fc-lifecycle-open@example.test','{"display_name":"Open Invoice Coach"}'),
 ('95000000-0000-0000-0000-000000000003','fc-lifecycle-paid@example.test','{"display_name":"Paid Invoice Coach"}'),
 ('95000000-0000-0000-0000-000000000004','fc-lifecycle-trial@example.test','{"display_name":"Trial Coach"}'),
 ('95000000-0000-0000-0000-000000000005','fc-lifecycle-deleting@example.test','{"display_name":"Deleting Trial Coach"}'),
 ('95000000-0000-0000-0000-000000000006','fc-lifecycle-assessment@example.test','{"display_name":"Assessment Trial Coach"}'),
 ('95000000-0000-0000-0000-000000000007','fc-lifecycle-pack@example.test','{"display_name":"Pack Coach"}'),
 ('95000000-0000-0000-0000-000000000008','fc-lifecycle-partial@example.test','{"display_name":"Partial Refund Coach"}'),
 ('95000000-0000-0000-0000-000000000009','fc-lifecycle-blocked-replay@example.test','{"display_name":"Blocked Replay Coach"}');
update public.profiles set role='admin' where id='95000000-0000-0000-0000-000000000001';
update public.profiles set role='coach' where id in
 ('95000000-0000-0000-0000-000000000002','95000000-0000-0000-0000-000000000003',
  '95000000-0000-0000-0000-000000000004','95000000-0000-0000-0000-000000000005',
  '95000000-0000-0000-0000-000000000006','95000000-0000-0000-0000-000000000007',
  '95000000-0000-0000-0000-000000000008','95000000-0000-0000-0000-000000000009');

set local role authenticated;
set local request.jwt.claims='{"sub":"95000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.admin_create_feature_pricing_revision(
 'form_coach',1,'live','coach','subscription','USD','Form Coach','Lifecycle test','',7,2,
 '[{"price_key":"monthly_lifecycle","amount_cents":2500,"currency":"USD","interval":"month","credits_per_pack":null,"stripe_product_id":"prod_lifecycle","stripe_price_id":"price_lifecycle"}]'::jsonb
),2::bigint,'creates a synthetic immutable subscription quote');
reset role;

set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
insert into public.feature_subscriptions(stripe_subscription_id,feature_key,payer_role,payer_id,config_revision,price_key,
 stripe_customer_id,status,current_period_end)
values
 ('sub_lifecycle_open','form_coach','coach','95000000-0000-0000-0000-000000000002',2,'monthly_lifecycle','cus_lifecycle_open','canceled',now()+interval '30 days'),
 ('sub_lifecycle_paid','form_coach','coach','95000000-0000-0000-0000-000000000003',2,'monthly_lifecycle','cus_lifecycle_paid','canceled',now()+interval '30 days');
select is((select count(*)::integer from public.feature_subscription_contract_versions
 where stripe_subscription_id in ('sub_lifecycle_open','sub_lifecycle_paid')),2,
 'each synthetic subscription receives its immutable pricing contract');
select is(public.record_feature_subscription_invoice(
 'evt_lifecycle_open','invoice.payment_failed',repeat('a',64),'in_lifecycle_open','sub_lifecycle_open',
 '95000000-0000-0000-0000-000000000002',1,'open','USD',2500,0,now()-interval '1 day',now()+interval '29 days',
 'pi_lifecycle_open','ch_lifecycle_open',null,0),'applied','records the current open invoice for the first coach');
select is(public.record_feature_subscription_invoice(
 'evt_lifecycle_paid','invoice.paid',repeat('b',64),'in_lifecycle_paid','sub_lifecycle_paid',
 '95000000-0000-0000-0000-000000000003',1,'paid','USD',2500,2500,now()-interval '1 day',now()+interval '29 days',
 'pi_lifecycle_paid','ch_lifecycle_paid',null,0),'applied','records the current paid invoice for the second coach');
select is(public.service_record_form_coach_invoice_snapshot(
 '96000000-0000-0000-0000-000000000001','evt_lifecycle_snapshot_paid','invoice.paid',
 'in_lifecycle_paid','sub_lifecycle_paid','95000000-0000-0000-0000-000000000003',1,'paid','USD',2500,2500,
 now()-interval '1 day',now()+interval '29 days','pi_lifecycle_paid','ch_lifecycle_paid',null,1,
 repeat('c',64),repeat('d',64)),'applied','records an authoritative current paid snapshot against the frozen invoice revision');
select is(public.service_record_form_coach_invoice_snapshot(
 '96000000-0000-0000-0000-000000000060','evt_lifecycle_snapshot_paid','invoice.paid',
 'in_lifecycle_paid','sub_lifecycle_paid','95000000-0000-0000-0000-000000000003',1,'paid','USD',2500,2500,
 now()-interval '1 day',now()+interval '29 days','pi_lifecycle_paid','ch_lifecycle_paid',null,2,
 repeat('c',64),repeat('d',64)),'duplicate_event','a fresh request for the already-applied Stripe event is recognized as a duplicate');
select is(public.service_read_form_coach_invoice_current_head(
 'in_lifecycle_paid','sub_lifecycle_paid','95000000-0000-0000-0000-000000000003',1)->>'last_event_id',
 'fc_invoice_snapshot:96000000-0000-0000-0000-000000000001',
 'the current invoice projection returns its original applied head after duplicate delivery');
select is((public.service_read_form_coach_invoice_current_head(
 'in_lifecycle_paid','sub_lifecycle_paid','95000000-0000-0000-0000-000000000003',1)->>'state_revision')::integer,2,
 'the duplicate replay reads the actual current revision instead of incrementing it');
reset role;

set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is(public.service_record_form_coach_invoice_snapshot(
 '96000000-0000-0000-0000-000000000002','evt_lifecycle_failed_current_paid','invoice.payment_failed',
 'in_lifecycle_open','sub_lifecycle_open','95000000-0000-0000-0000-000000000002',1,'paid','USD',2500,2500,
 now()-interval '1 day',now()+interval '29 days','pi_lifecycle_open','ch_lifecycle_open',null,1,
 repeat('1',64),repeat('2',64)),'applied','a failed Stripe event can reconcile to a freshly retrieved paid invoice');
reset role;
select is((select source_kind from public.feature_billing_event_identity where event_id='evt_lifecycle_failed_current_paid'),
 'stripe_event','the original failed Stripe event retains its actual source identity');
select is((select source_kind from public.feature_billing_event_identity where event_id='fc_invoice_snapshot:96000000-0000-0000-0000-000000000002'),
 'snapshot_reconciliation','the retrieved paid state gets a distinct internal reconciliation identity');
select is((select actual_event_type from public.feature_invoice_snapshot_attempts where request_id='96000000-0000-0000-0000-000000000002'),
 'invoice.payment_failed','snapshot audit preserves the actual event type instead of fabricating invoice.paid');
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is(public.service_record_form_coach_invoice_snapshot(
 '96000000-0000-0000-0000-000000000003','evt_lifecycle_stale_snapshot','invoice.paid',
 'in_lifecycle_open','sub_lifecycle_open','95000000-0000-0000-0000-000000000002',1,'open','USD',2500,0,
 now()-interval '1 day',now()+interval '29 days','pi_lifecycle_open','ch_lifecycle_open',null,1,
 repeat('3',64),repeat('4',64)),'stale','a snapshot read against the previous invoice revision cannot overwrite newer state');
select is(public.service_record_form_coach_invoice_snapshot(
 '96000000-0000-0000-0000-000000000004','evt_lifecycle_paid_current_open','invoice.paid',
 'in_lifecycle_open','sub_lifecycle_open','95000000-0000-0000-0000-000000000002',1,'open','USD',2500,0,
 now()-interval '1 day',now()+interval '29 days','pi_lifecycle_open','ch_lifecycle_open',null,2,
 repeat('5',64),repeat('6',64)),'applied','a paid event reconciles to the current open state without granting paid access');
select is(public.service_record_form_coach_invoice_snapshot(
 '96000000-0000-0000-0000-000000000004','evt_lifecycle_paid_current_open','invoice.paid',
 'in_lifecycle_open','sub_lifecycle_open','95000000-0000-0000-0000-000000000002',1,'open','USD',2500,0,
 now()-interval '1 day',now()+interval '29 days','pi_lifecycle_open','ch_lifecycle_open',null,2,
 repeat('5',64),repeat('6',64)),'applied','an exact invoice snapshot request replays idempotently');
select throws_ok(
 $$select public.service_record_form_coach_invoice_snapshot(
 '96000000-0000-0000-0000-000000000004','evt_lifecycle_paid_current_open','invoice.paid',
 'in_lifecycle_open','sub_lifecycle_open','95000000-0000-0000-0000-000000000002',1,'paid','USD',2500,2500,
 now()-interval '1 day',now()+interval '29 days','pi_lifecycle_open','ch_lifecycle_open',null,2,
 repeat('5',64),repeat('6',64))$$,
 '23505',null,'an invoice snapshot request cannot be replayed with changed current evidence');
reset role;

create function pg_temp.lifecycle_paid_invoice_evidence()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'subscriptionId','sub_lifecycle_paid','customerId','cus_lifecycle_paid','status','paid','currency','USD',
    'amountDueCents',2500,'amountPaidCents',2500,
    'expectedRevision',(select state_revision from public.feature_subscription_invoice_current where invoice_id='in_lifecycle_paid'),
    'currentEventId',(select last_event_id from public.feature_subscription_invoice_current where invoice_id='in_lifecycle_paid'),
    'invoiceCount',(select count(*) from public.feature_subscription_invoice_current where subscription_id='sub_lifecycle_paid' and payer_id='95000000-0000-0000-0000-000000000003'),
    'outstandingInvoiceCount',0,
    'paymentIntentCount',(select count(*) from public.feature_billing_provider_aliases where subscription_id='sub_lifecycle_paid' and payer_id='95000000-0000-0000-0000-000000000003' and object_kind='payment_intent'),
    'activePaymentIntentCount',0,
    'chargeCount',(select count(*) from public.feature_billing_provider_aliases where subscription_id='sub_lifecycle_paid' and payer_id='95000000-0000-0000-0000-000000000003' and object_kind='charge'),
    'invoicePaymentCount',1,
    'invoicePaymentInventoryDigest',repeat('a',64),
    'invoiceIdsDigest',(select encode(sha256(convert_to(coalesce(string_agg(i.invoice_id,chr(10) order by i.invoice_id),''),'UTF8')),'hex')
      from public.feature_subscription_invoice_current i where i.subscription_id='sub_lifecycle_paid' and i.payer_id='95000000-0000-0000-0000-000000000003' and i.feature_key='form_coach'),
    'paymentIntentIdsDigest',(select encode(sha256(convert_to(coalesce(string_agg(a.object_id,chr(10) order by a.object_id),''),'UTF8')),'hex')
      from public.feature_billing_provider_aliases a where a.subscription_id='sub_lifecycle_paid' and a.payer_id='95000000-0000-0000-0000-000000000003' and a.object_kind='payment_intent'),
    'chargeIdsDigest',(select encode(sha256(convert_to(coalesce(string_agg(a.object_id,chr(10) order by a.object_id),''),'UTF8')),'hex')
      from public.feature_billing_provider_aliases a where a.subscription_id='sub_lifecycle_paid' and a.payer_id='95000000-0000-0000-0000-000000000003' and a.object_kind='charge'),
    'invoiceInventoryDigest',repeat('b',64),'paymentIntentInventoryDigest',repeat('c',64),'chargeInventoryDigest',repeat('d',64)
  );
$$;

set local role authenticated;
set local request.jwt.claims='{"sub":"95000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$select public.service_record_form_coach_billing_conflict(
 'evt_lifecycle_conflict_paid','invoice.payment_failed','in_lifecycle_paid',null,'95000000-0000-0000-0000-000000000003',
 'payment_after_terminal',repeat('e',64))$$,
 '42501',null,'authenticated callers cannot create billing contradiction records');
reset role;

set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is(public.service_record_form_coach_billing_conflict(
 'evt_lifecycle_conflict_paid','invoice.payment_failed','in_lifecycle_paid',null,'95000000-0000-0000-0000-000000000003',
 'payment_after_terminal',repeat('e',64)),'recorded','service persists an invoice contradiction before reconciliation');
select is(public.service_resolve_form_coach_billing_conflicts(
 '96000000-0000-0000-0000-000000000005','95000000-0000-0000-0000-000000000003','invoice','in_lifecycle_paid',
 (select state_revision from public.feature_subscription_invoice_current where invoice_id='in_lifecycle_paid'),now(),
 pg_temp.lifecycle_paid_invoice_evidence(),repeat('f',64)),'incomplete',
 'provider evidence observed at the conflict timestamp is stale and cannot close it');
select is(public.service_resolve_form_coach_billing_conflicts(
 '96000000-0000-0000-0000-000000000063','95000000-0000-0000-0000-000000000003','invoice','in_lifecycle_paid',
 (select state_revision from public.feature_subscription_invoice_current where invoice_id='in_lifecycle_paid'),now()+interval '1 second',
 jsonb_set(pg_temp.lifecycle_paid_invoice_evidence(),'{currentEventId}',
   to_jsonb('fc_invoice_snapshot:96000000-0000-0000-0000-000000000060'::text)),repeat('2',64)),
 'stale','a duplicate request ID that never became the projection head cannot resolve a conflict');
select is(public.service_resolve_form_coach_billing_conflicts(
 '96000000-0000-0000-0000-000000000006','95000000-0000-0000-0000-000000000003','invoice','in_lifecycle_paid',
 (select state_revision from public.feature_subscription_invoice_current where invoice_id='in_lifecycle_paid'),now()+interval '1 second',
 pg_temp.lifecycle_paid_invoice_evidence(),repeat('f',64)),'recorded',
 'a fresh exact paid invoice snapshot resolves the contradiction without changing receipt identity');
select is(public.service_resolve_form_coach_billing_conflicts(
 '96000000-0000-0000-0000-000000000006','95000000-0000-0000-0000-000000000003','invoice','in_lifecycle_paid',
 (select state_revision from public.feature_subscription_invoice_current where invoice_id='in_lifecycle_paid'),now()+interval '1 second',
 pg_temp.lifecycle_paid_invoice_evidence(),repeat('f',64)),'already_resolved',
 'an exact conflict resolution replays idempotently');
select is(public.service_record_form_coach_billing_conflict(
 'evt_lifecycle_duplicate_replay_conflict','invoice.payment_failed','in_lifecycle_paid',null,
 '95000000-0000-0000-0000-000000000003','payment_after_terminal',repeat('a',64)),
 'recorded','records a conflict to resolve after duplicate invoice delivery');
select is(public.service_resolve_form_coach_billing_conflicts(
 '96000000-0000-0000-0000-000000000061','95000000-0000-0000-0000-000000000003','invoice','in_lifecycle_paid',
 (select state_revision from public.feature_subscription_invoice_current where invoice_id='in_lifecycle_paid'),now()+interval '2 seconds',
 pg_temp.lifecycle_paid_invoice_evidence(),repeat('f',64)),'recorded',
 'duplicate delivery resolves against the actual current projection head');
select is(public.service_resolve_form_coach_billing_conflicts(
 '96000000-0000-0000-0000-000000000006','95000000-0000-0000-0000-000000000003','invoice','in_lifecycle_paid',
 (select state_revision from public.feature_subscription_invoice_current where invoice_id='in_lifecycle_paid'),now()+interval '1 second',
 pg_temp.lifecycle_paid_invoice_evidence(),repeat('0',64)),'conflict',
 'an idempotency key cannot be replayed with changed evidence identity');
reset role;

insert into public.feature_subscriptions(stripe_subscription_id,feature_key,payer_role,payer_id,config_revision,price_key,
 stripe_customer_id,status,current_period_end)
values('sub_lifecycle_partial','form_coach','coach','95000000-0000-0000-0000-000000000008',2,
 'monthly_lifecycle','cus_lifecycle_partial','canceled',now()+interval '30 days');
insert into public.feature_subscriptions(stripe_subscription_id,feature_key,payer_role,payer_id,config_revision,price_key,
 stripe_customer_id,status,current_period_end)
values('sub_lifecycle_blocked_replay','form_coach','coach','95000000-0000-0000-0000-000000000009',2,
 'monthly_lifecycle','cus_lifecycle_blocked_replay','canceled',now()+interval '30 days');
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is(public.service_record_form_coach_invoice_snapshot(
 '96000000-0000-0000-0000-000000000041','evt_lifecycle_partial_initial','invoice.paid',
 'in_lifecycle_partial','sub_lifecycle_partial','95000000-0000-0000-0000-000000000008',1,'paid','USD',2500,2500,
 now()-interval '1 day',now()+interval '29 days','pi_lifecycle_partial','ch_lifecycle_partial',null,0,
 repeat('7',64),repeat('8',64)),'applied','creates a paid invoice snapshot for partial-refund lifecycle coverage');
select is(public.record_feature_subscription_refund(
 'evt_lifecycle_partial_refund','charge.refunded',repeat('9',64),'re_lifecycle_partial','in_lifecycle_partial',
 'pi_lifecycle_partial','ch_lifecycle_partial','95000000-0000-0000-0000-000000000008',500,'USD',1),
 'manual_review','the provider refund RPC persists a partial refund for the exact invoice');
select is(public.service_record_form_coach_invoice_snapshot(
 '96000000-0000-0000-0000-000000000042','evt_lifecycle_partial_snapshot','invoice.paid',
 'in_lifecycle_partial','sub_lifecycle_partial','95000000-0000-0000-0000-000000000008',1,'paid','USD',2500,2500,
 now()-interval '1 day',now()+interval '29 days','pi_lifecycle_partial','ch_lifecycle_partial',null,2,
 repeat('a',64),repeat('b',64)),'manual_review','partial-refund review remains durable while invoice event application succeeds');
select is((select state from public.feature_subscription_invoice_event_state where event_id='evt_lifecycle_partial_snapshot'),
 'applied','the actual invoice event is not transitioned from applied into a forbidden review state');
reset role;
select is((select outcome from public.feature_invoice_snapshot_attempts where request_id='96000000-0000-0000-0000-000000000042'),
 'manual_review','snapshot attempt retains the required human-review outcome');
insert into public.stream_media_account_tombstones(id,account_id,request_id,request_digest,tombstone_state)
values('97000000-0000-0000-0000-000000000004','95000000-0000-0000-0000-000000000008',
 '97000000-0000-0000-0000-000000000014',repeat('1',64),'closing');
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is(public.service_record_form_coach_billing_cleanup(
 '97000000-0000-0000-0000-000000000004',1,'97000000-0000-0000-0000-000000000024'),
 'recorded','partial-refund review can be represented in the cleanup component projection');
reset role;
select is((select proof_state from public.stream_media_auth_component_proof_events
 where tombstone_id='97000000-0000-0000-0000-000000000004' and component_key='form_coach_billing'),
 'incomplete','partial invoice refund review blocks a ready financial cleanup proof');

insert into public.stream_media_account_tombstones(id,account_id,request_id,request_digest,tombstone_state)
values
 ('97000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000002','97000000-0000-0000-0000-000000000011',repeat('e',64),'closing'),
 ('97000000-0000-0000-0000-000000000002','95000000-0000-0000-0000-000000000003','97000000-0000-0000-0000-000000000012',repeat('f',64),'closing'),
 ('97000000-0000-0000-0000-000000000005','95000000-0000-0000-0000-000000000009','97000000-0000-0000-0000-000000000015',repeat('9',64),'closing');

set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is(public.service_record_form_coach_billing_cleanup(
 '97000000-0000-0000-0000-000000000001',1,'97000000-0000-0000-0000-000000000021'),
 'recorded','records billing cleanup proof for the first tombstone');
reset role;
select is((select proof_state from public.stream_media_auth_component_proof_events
 where tombstone_id='97000000-0000-0000-0000-000000000001' and component_key='form_coach_billing'),
 'incomplete','an open invoice prevents a ready account-deletion proof');

set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is(public.service_record_form_coach_invoice_snapshot(
 '96000000-0000-0000-0000-000000000043','evt_lifecycle_open_void','invoice.voided',
 'in_lifecycle_open','sub_lifecycle_open','95000000-0000-0000-0000-000000000002',1,'void','USD',0,0,
 now()-interval '1 day',now()+interval '29 days',null,null,null,3,
 repeat('c',64),repeat('d',64)),'applied','an already-bound open invoice can become void under an account tombstone');
select is((select status from public.feature_subscription_invoice_current where invoice_id='in_lifecycle_open'),'void',
 'the deletion-time snapshot updates only the existing invoice identity');
select is(public.service_record_form_coach_billing_cleanup(
 '97000000-0000-0000-0000-000000000001',1,'97000000-0000-0000-0000-000000000025'),'recorded',
 'cleanup can be retried after the current open invoice is verified void');
reset role;
select is((select proof_state from public.stream_media_auth_component_proof_events
 where tombstone_id='97000000-0000-0000-0000-000000000001' and component_key='form_coach_billing'
 order by proof_sequence desc limit 1),'ready','an applied terminal snapshot clears the open invoice cleanup blocker');

set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is(public.service_record_form_coach_billing_cleanup(
 '97000000-0000-0000-0000-000000000002',1,'97000000-0000-0000-0000-000000000022'),
 'recorded','records billing cleanup proof for the second tombstone');
reset role;
select is((select proof_state from public.stream_media_auth_component_proof_events
 where tombstone_id='97000000-0000-0000-0000-000000000002' and component_key='form_coach_billing'),
 'ready','a current paid snapshot with matching applied revision is terminal');
select is((select count(*)::integer from public.feature_invoice_snapshot_attempts
 where invoice_id='in_lifecycle_paid' and actual_event_id='evt_lifecycle_snapshot_paid'
   and actual_event_type='invoice.paid' and outcome='applied'),
 1,'the cleanup proof relies on the applied current-snapshot attempt, not a client assertion');
select is((select count(*)::integer from public.feature_subscription_invoice_current
 where payer_id in ('95000000-0000-0000-0000-000000000002','95000000-0000-0000-0000-000000000003')),
 2,'the rollback fixture leaves both scoped invoice facts present during assertions');

create function pg_temp.register_lifecycle_trial(
  p_request_id uuid,p_session_id text,p_customer_id text,p_subscription_id text,p_invoice_id text,
  p_session_digest text,p_invoice_digest text
) returns text language plpgsql security definer set search_path = '' as $$
declare r public.feature_checkout_reservations%rowtype; trial_start_value timestamptz; trial_end_value timestamptz; metadata_value jsonb;
begin
  select * into r from public.feature_checkout_reservations x where x.request_id=p_request_id and x.feature_key='form_coach';
  if not found then return 'fixture_missing'; end if;
  trial_start_value:=date_trunc('second',clock_timestamp());
  trial_end_value:=trial_start_value+make_interval(days=>r.trial_days);
  metadata_value:=jsonb_build_object('feature_namespace','form_coach','feature_key','form_coach',
    'payer_id',r.payer_id::text,'reservation_id',r.id::text,'request_id',r.request_id::text,
    'config_revision',r.config_revision::text,'price_key',r.price_key,'pack_quantity',r.pack_quantity::text);
  return public.service_register_form_coach_trial_checkout(
    r.request_id,p_session_id,p_customer_id,p_subscription_id,p_invoice_id,'complete','no_payment_required','subscription',r.currency,
    0,0,metadata_value,r.stripe_price_id,r.stripe_product_id,r.pack_quantity,'trialing',trial_start_value,trial_end_value,trial_end_value,
    'paid',r.currency,0,0,trial_start_value-interval '1 hour',trial_end_value+interval '1 hour',p_session_digest,p_invoice_digest);
end $$;

create function pg_temp.retirement_identity(p_payer_id uuid,p_customer_id text,p_attempt_id uuid,p_account_id text,p_livemode boolean)
returns text language sql immutable as $$
  select encode(sha256(convert_to('form_coach:'||p_payer_id::text||':'||p_customer_id||':'||p_attempt_id::text||':'||p_account_id||':'||p_livemode::text,'UTF8')),'hex');
$$;
create function pg_temp.retirement_request(p_request_id uuid,p_identity_digest text,p_inventory_digest text,p_tombstone_id uuid,p_tombstone_revision bigint)
returns text language sql immutable as $$
  select encode(sha256(convert_to(p_request_id::text||':'||p_identity_digest||':'||p_inventory_digest||':'||p_tombstone_id::text||':'||p_tombstone_revision::text,'UTF8')),'hex');
$$;
create function pg_temp.retirement_inventory(p_customer_id text,p_account_id text,p_livemode boolean,
  p_complete boolean default true,p_collectible_invoice_count integer default 0)
returns jsonb language sql immutable as $$
  select jsonb_build_object('complete',p_complete,'hasMore',not p_complete,'customerId',p_customer_id,'stripeAccountId',p_account_id,
    'livemode',p_livemode,'checkoutSessionCount',1,'subscriptionCount',1,'invoiceCount',1,
    'invoicePaymentCount',0,'paymentIntentCount',0,'chargeCount',0,'refundCount',0,
    'activeCheckoutSessionCount',0,'activeSubscriptionCount',0,'collectibleInvoiceCount',p_collectible_invoice_count,
    'activePaymentIntentCount',0,'unresolvedRefundCount',0,'unresolvedCreateCount',0,
    'resourceIdsDigest',encode(sha256(convert_to('cs_lifecycle_delete_trial|sub_lifecycle_delete_trial|in_lifecycle_delete_trial','UTF8')),'hex'));
$$;
create function pg_temp.reserve_lifecycle_retirement(p_request_id uuid,p_tombstone_id uuid,p_payer_id uuid,
  p_complete boolean default true,p_collectible_invoice_count integer default 0)
returns text language plpgsql security definer set search_path = '' as $$
declare attempt_id_value uuid; customer_id_value text:='cus_lifecycle_delete_trial'; account_id_value text:='acct_lifecycle_synthetic';
  metadata_value jsonb; inventory_value jsonb; identity_value text; inventory_digest_value text; request_digest_value text;
begin
  select m.create_attempt_id into attempt_id_value from public.feature_payer_customer_mappings m
    where m.feature_key='form_coach' and m.payer_id=p_payer_id and m.stripe_customer_id=customer_id_value;
  metadata_value:=jsonb_build_object('feature_namespace','form_coach','feature_key','form_coach',
    'payer_id',p_payer_id::text,'customer_create_attempt_id',attempt_id_value::text);
  inventory_value:=pg_temp.retirement_inventory(customer_id_value,account_id_value,false,p_complete,p_collectible_invoice_count);
  identity_value:=pg_temp.retirement_identity(p_payer_id,customer_id_value,attempt_id_value,account_id_value,false);
  inventory_digest_value:=encode(sha256(convert_to(inventory_value::text,'UTF8')),'hex');
  request_digest_value:=pg_temp.retirement_request(p_request_id,identity_value,inventory_digest_value,p_tombstone_id,1);
  return public.service_reserve_form_coach_customer_retirement(p_request_id,p_payer_id,customer_id_value,attempt_id_value,
    p_tombstone_id,1,account_id_value,false,metadata_value,inventory_value,identity_value,inventory_digest_value,request_digest_value);
end $$;
create function pg_temp.record_lifecycle_retirement(p_request_id uuid,p_payer_id uuid,p_tombstone_id uuid,p_http_status integer,p_deleted boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare attempt_id_value uuid; inventory_value jsonb; inventory_digest_value text;
begin
  select i.create_attempt_id,i.inventory_summary into attempt_id_value,inventory_value
    from public.feature_form_coach_customer_retirement_intents i where i.request_id=p_request_id;
  if not found then return 'missing_intent'; end if;
  inventory_digest_value:=encode(sha256(convert_to(inventory_value::text,'UTF8')),'hex');
  return public.service_record_form_coach_customer_retirement(p_request_id,p_payer_id,'cus_lifecycle_delete_trial',attempt_id_value,
    p_tombstone_id,1,'acct_lifecycle_synthetic',false,inventory_digest_value,p_http_status,p_deleted,
    current_setting('test.form_coach_retirement_observed_at')::timestamptz,repeat('d',64));
end $$;
create function pg_temp.record_lifecycle_retirement_revalidation(
  p_request_id uuid,p_tombstone_revision bigint,p_livemode boolean,p_observed_at timestamptz,p_digest text
) returns text language plpgsql security definer set search_path = '' as $$
declare intent public.feature_form_coach_customer_retirement_intents%rowtype;
begin
  select * into intent from public.feature_form_coach_customer_retirement_intents i
   where i.request_id='97000000-0000-0000-0000-000000000031';
  if not found then return 'missing_intent'; end if;
  return public.service_record_form_coach_customer_retirement_revalidation(
    p_request_id,intent.request_id,intent.payer_id,intent.customer_id,intent.create_attempt_id,
    intent.tombstone_id,p_tombstone_revision,intent.stripe_account_id,p_livemode,intent.inventory_digest,
    200,intent.customer_id,true,p_observed_at,p_digest);
end $$;

select ok(not has_function_privilege('authenticated','public.service_claim_form_coach_assessment_trial(uuid,uuid)','EXECUTE'),
 'assessment trial claim RPC is not executable by authenticated clients');
select ok(has_function_privilege('service_role','public.service_claim_form_coach_assessment_trial(uuid,uuid)','EXECUTE'),
 'assessment trial claim RPC is executable by service role');
select ok(not has_table_privilege('authenticated','public.feature_checkout_trial_registrations','SELECT'),
 'trial registration evidence is not directly readable by authenticated clients');
select ok(not has_table_privilege('service_role','public.feature_checkout_trial_registrations','SELECT'),
 'webhook service reads trial registration through its narrow projection, not the table');
select ok(not has_table_privilege('service_role','public.feature_checkout_trial_terminal_attestations','SELECT'),
 'webhook service reads trial terminal evidence through its narrow projection, not the table');
select ok(not has_table_privilege('service_role','public.feature_invoice_snapshot_attempts','SELECT'),
 'invoice snapshot history has no direct service-role SELECT grant');
select ok(not has_table_privilege('service_role','public.feature_form_coach_customer_retirement_proofs','SELECT'),
 'retirement proofs are accessed only through the security-definer service API');
select ok(not has_function_privilege('authenticated','public.service_read_form_coach_trial_registration(text)','EXECUTE'),
 'authenticated callers cannot read trial registration projections');
select ok(has_function_privilege('service_role','public.service_read_form_coach_trial_registration(text)','EXECUTE'),
 'webhook service can read only the bound trial registration projection');
select ok(not has_function_privilege('authenticated','public.service_read_form_coach_invoice_current_head(text,text,uuid,integer)','EXECUTE'),
 'authenticated callers cannot read the current invoice head projection');
select ok(has_function_privilege('service_role','public.service_read_form_coach_invoice_current_head(text,text,uuid,integer)','EXECUTE'),
 'webhook service can read the narrow current invoice head projection');
select ok((
  select strpos(pg_get_functiondef(p.oid),'private.form_coach_try_account_lock')
       < strpos(pg_get_functiondef(p.oid),'form-coach-alias:invoice:')
     and strpos(pg_get_functiondef(p.oid),'form-coach-alias:charge:')
       < strpos(pg_get_functiondef(p.oid),'private.form_coach_try_payer_lock')
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='service_record_form_coach_invoice_snapshot'
), 'invoice snapshot acquires account TRY, provider aliases, then payer0 in refund-compatible order');
select ok(not has_function_privilege('authenticated','public.service_has_form_coach_trial_terminal_binding(text,text)','EXECUTE'),
 'authenticated callers cannot query terminal binding projections');
select ok(has_function_privilege('service_role','public.service_has_form_coach_trial_terminal_binding(text,text)','EXECUTE'),
 'webhook service can query the narrow terminal binding projection');
select ok(not has_function_privilege('authenticated','public.service_reserve_form_coach_customer_retirement(uuid,uuid,text,uuid,uuid,bigint,text,boolean,jsonb,jsonb,text,text,text)','EXECUTE'),
 'authenticated callers cannot create retirement intents');
select ok(not has_function_privilege('authenticated','public.service_record_form_coach_customer_retirement(uuid,uuid,text,uuid,uuid,bigint,text,boolean,text,integer,boolean,timestamp with time zone,text)','EXECUTE'),
 'authenticated callers cannot attest customer deletion');
select ok(has_function_privilege('service_role','public.service_record_form_coach_customer_retirement(uuid,uuid,text,uuid,uuid,bigint,text,boolean,text,integer,boolean,timestamp with time zone,text)','EXECUTE'),
 'service role can record exact customer retirement proof');
set local role authenticated;
set local request.jwt.claims='{"sub":"95000000-0000-0000-0000-000000000006","role":"authenticated"}';
select throws_ok($$select public.service_read_form_coach_invoice_current_head(
 'in_lifecycle_paid','sub_lifecycle_paid','95000000-0000-0000-0000-000000000003',1)$$,
 '42501',null,'authenticated callers cannot invoke the invoice head projection');
select throws_ok($$select * from public.service_claim_form_coach_assessment_trial('96000000-0000-0000-0000-000000000060','95000000-0000-0000-0000-000000000006')$$,
 '42501',null,'authenticated caller cannot invoke the assessment trial grant RPC');
select throws_ok($$select pg_temp.reserve_lifecycle_retirement(
 '97000000-0000-0000-0000-000000000031','97000000-0000-0000-0000-000000000003','95000000-0000-0000-0000-000000000005')$$,
 '42501',null,'authenticated callers cannot reserve customer retirement through the service RPC');
select throws_ok($$select public.service_record_form_coach_customer_retirement(
 '97000000-0000-0000-0000-000000000031','95000000-0000-0000-0000-000000000005','cus_lifecycle_delete_trial',
 '96000000-0000-0000-0000-000000000051','97000000-0000-0000-0000-000000000003',1,'acct_lifecycle_synthetic',false,
 repeat('a',64),200,true,now(),repeat('d',64))$$,
 '42501',null,'authenticated callers cannot attest provider customer deletion');
reset role;

set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is((select outcome from public.service_claim_form_coach_assessment_trial(
 '96000000-0000-0000-0000-000000000060','95000000-0000-0000-0000-000000000006')),'claimed',
 'service claim creates the configured finite assessment trial');
select is((select outcome from public.service_claim_form_coach_assessment_trial(
 '96000000-0000-0000-0000-000000000060','95000000-0000-0000-0000-000000000006')),'already_claimed',
 'the same assessment-trial request is idempotent');
select is((select sum(granted_units)::integer from public.feature_credit_lots
 where user_id='95000000-0000-0000-0000-000000000006' and lot_kind='assessment_trial'),2,
 'assessment trial mints only the configured two units');
select is((select count(*)::integer from public.feature_payment_receipts where payer_id='95000000-0000-0000-0000-000000000006'),0,
 'assessment trial creates no positive payment receipt');

select is((select outcome from public.reserve_feature_customer_create(
 '95000000-0000-0000-0000-000000000004','96000000-0000-0000-0000-000000000041',repeat('1',64))),'reserved',
 'time-trial customer creation reserves a stable customer attempt');
select is(public.advance_feature_customer_create((select id from public.feature_customer_create_attempts where request_id='96000000-0000-0000-0000-000000000041'),0,'bound','cus_lifecycle_trial'),'bound',
 'time-trial customer binding is persisted before registration');
select is(public.advance_feature_customer_create((select id from public.feature_customer_create_attempts where request_id='96000000-0000-0000-0000-000000000041'),1,'verified','cus_lifecycle_trial'),'verified',
 'time-trial customer mapping is verified against its create attempt');
select is((select outcome from public.reserve_feature_checkout('form_coach','95000000-0000-0000-0000-000000000004',2,'monthly_lifecycle',1,
 '96000000-0000-0000-0000-000000000042')),'reserved','time trial reserves the immutable subscription quote');
select is(public.bind_feature_checkout_session((select id from public.feature_checkout_reservations where request_id='96000000-0000-0000-0000-000000000042'),
 'cs_lifecycle_trial','cus_lifecycle_trial','sub_lifecycle_trial'),'bound','time-trial checkout binds exact session, customer and subscription IDs');
select is(pg_temp.register_lifecycle_trial('96000000-0000-0000-0000-000000000042','cs_lifecycle_trial','cus_lifecycle_trial',
 'sub_lifecycle_trial','in_lifecycle_trial',repeat('2',64),repeat('3',64)),'registered',
 'exact zero-payment provider evidence registers the immutable time trial');
select is(pg_temp.register_lifecycle_trial('96000000-0000-0000-0000-000000000042','cs_lifecycle_trial','cus_lifecycle_trial',
 'sub_lifecycle_trial','in_lifecycle_trial',repeat('2',64),repeat('3',64)),'already_registered',
 'time-trial registration replays idempotently');
select is(public.service_read_form_coach_trial_registration('sub_lifecycle_trial')->>'request_id',
 '96000000-0000-0000-0000-000000000042','service projection returns only the exact registration request identity');
select is(public.service_has_form_coach_trial_terminal_binding('cs_lifecycle_trial','sub_lifecycle_trial'),false,
 'service terminal projection is false before terminal evidence exists');
select is((select status from public.feature_subscriptions where stripe_subscription_id='sub_lifecycle_trial'),'trialing',
 'registration initializes the subscription contract as a trial without payment');
select is((select count(*)::integer from public.feature_subscription_contract_versions
 where stripe_subscription_id='sub_lifecycle_trial' and contract_version=1),1,
 'zero-payment trial initializes an immutable subscription contract version');
select is((select count(*)::integer from public.feature_trial_claims where request_id='96000000-0000-0000-0000-000000000042'),1,
 'zero-payment registration creates exactly one bounded trial claim');
select is((select count(*)::integer from public.feature_trial_access_grants
 where user_id='95000000-0000-0000-0000-000000000004' and source_id='sub_lifecycle_trial'),1,
 'time-trial claim grants only its exact subscription access');
select is((select count(*)::integer from public.feature_payment_receipts where reservation_id=(
 select id from public.feature_checkout_reservations where request_id='96000000-0000-0000-0000-000000000042')),0,
 'zero-payment subscription trial creates no positive payment receipt');

select is((select outcome from public.reserve_feature_customer_create(
 '95000000-0000-0000-0000-000000000005','96000000-0000-0000-0000-000000000051',repeat('4',64))),'reserved',
 'deletion-case trial reserves a customer before the account tombstone');
select is(public.advance_feature_customer_create((select id from public.feature_customer_create_attempts where request_id='96000000-0000-0000-0000-000000000051'),0,'bound','cus_lifecycle_delete_trial'),'bound',
 'deletion-case customer binds to the exact verified ID');
select is(public.advance_feature_customer_create((select id from public.feature_customer_create_attempts where request_id='96000000-0000-0000-0000-000000000051'),1,'verified','cus_lifecycle_delete_trial'),'verified',
 'deletion-case customer mapping is verified before deletion starts');
select is((select outcome from public.reserve_feature_checkout('form_coach','95000000-0000-0000-0000-000000000005',2,'monthly_lifecycle',1,
 '96000000-0000-0000-0000-000000000052')),'reserved','deletion-case time trial reserves its frozen quote before deletion');
select is(public.bind_feature_checkout_session((select id from public.feature_checkout_reservations where request_id='96000000-0000-0000-0000-000000000052'),
 'cs_lifecycle_delete_trial','cus_lifecycle_delete_trial','sub_lifecycle_delete_trial'),'bound',
 'deletion-case provider IDs are bound before the tombstone');
reset role;

insert into public.stream_media_account_tombstones(id,account_id,request_id,request_digest,tombstone_state)
values('97000000-0000-0000-0000-000000000003','95000000-0000-0000-0000-000000000005',
 '97000000-0000-0000-0000-000000000013',repeat('7',64),'closing');
update public.feature_checkout_reservations set state='cancel_required'
 where request_id='96000000-0000-0000-0000-000000000052' and state='bound';
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is(pg_temp.register_lifecycle_trial('96000000-0000-0000-0000-000000000052','cs_lifecycle_delete_trial',
 'cus_lifecycle_delete_trial','sub_lifecycle_delete_trial','in_lifecycle_delete_trial',repeat('8',64),repeat('9',64)),
 'blocked_deletion','tombstone records the exact trial provider binding but grants no access');
select is((select status from public.feature_subscriptions where stripe_subscription_id='sub_lifecycle_delete_trial'),
 'blocked_deletion','tombstoned trial subscription remains blocked until exact provider terminal proof');
select is((select count(*)::integer from public.feature_trial_claims where request_id='96000000-0000-0000-0000-000000000052')+
 (select count(*)::integer from public.feature_trial_access_grants where user_id='95000000-0000-0000-0000-000000000005')+
 (select count(*)::integer from public.feature_payment_receipts where reservation_id=(
   select id from public.feature_checkout_reservations where request_id='96000000-0000-0000-0000-000000000052')),0,
 'tombstoned registration creates no trial claim, access grant or payment receipt');
select is(public.service_record_form_coach_invoice_snapshot(
 '96000000-0000-0000-0000-000000000053','evt_lifecycle_blocked_trial_invoice','invoice.paid',
 'in_lifecycle_delete_trial','sub_lifecycle_delete_trial','95000000-0000-0000-0000-000000000005',1,'paid','USD',0,0,
 now()-interval '1 hour',now()+interval '8 days',null,null,null,0,repeat('a',64),repeat('b',64)),
 'blocked_deletion','zero-dollar trial invoice received during deletion is retained as blocked evidence');
select is(public.service_record_form_coach_invoice_snapshot(
 '96000000-0000-0000-0000-000000000068','evt_lifecycle_prior_terminal_replay','invoice.paid',
 'in_lifecycle_blocked_replay','sub_lifecycle_blocked_replay','95000000-0000-0000-0000-000000000009',1,'paid','USD',0,0,
 now()-interval '1 hour',now()+interval '8 days',null,null,null,0,repeat('c',64),repeat('d',64)),
 'blocked_deletion','a first zero-dollar snapshot remains blocked during account deletion');
select is(public.service_record_form_coach_invoice_snapshot(
 '96000000-0000-0000-0000-000000000069','evt_lifecycle_prior_terminal_replay','invoice.paid',
 'in_lifecycle_blocked_replay','sub_lifecycle_blocked_replay','95000000-0000-0000-0000-000000000009',1,'paid','USD',0,0,
 now()-interval '1 hour',now()+interval '8 days',null,null,null,0,repeat('c',64),repeat('d',64)),
 'manual_review','a later request cannot reinterpret a prior terminal blocked event');
select is((select outcome from public.service_claim_form_coach_assessment_trial(
 '96000000-0000-0000-0000-000000000054','95000000-0000-0000-0000-000000000005')),'blocked_deletion',
 'account tombstone blocks a new assessment-trial claim');
select is(public.service_record_form_coach_trial_terminal(
 '96000000-0000-0000-0000-000000000052',(select id from public.feature_checkout_reservations where request_id='96000000-0000-0000-0000-000000000052'),
 'cs_lifecycle_delete_trial','cus_lifecycle_delete_trial','sub_lifecycle_delete_trial',0,'complete','no_payment_required','canceled',1,0,repeat('c',64)),
 'not_terminal','unresolved invoice inventory prevents trial terminalization');
select is(public.service_record_form_coach_trial_terminal(
 '96000000-0000-0000-0000-000000000052',(select id from public.feature_checkout_reservations where request_id='96000000-0000-0000-0000-000000000052'),
 'cs_lifecycle_delete_trial','cus_lifecycle_delete_trial','sub_lifecycle_delete_trial',0,'complete','no_payment_required','canceled',0,0,repeat('c',64)),
 'canceled','exact current complete non-payment session and canceled subscription evidence closes the trial');
select is(public.service_record_form_coach_trial_terminal(
 '96000000-0000-0000-0000-000000000052',(select id from public.feature_checkout_reservations where request_id='96000000-0000-0000-0000-000000000052'),
 'cs_lifecycle_delete_trial','cus_lifecycle_delete_trial','sub_lifecycle_delete_trial',1,'complete','no_payment_required','canceled',0,0,repeat('c',64)),
 'already_canceled','exact terminal evidence replays idempotently after cancellation');
select is(public.service_has_form_coach_trial_terminal_binding('cs_lifecycle_delete_trial','sub_lifecycle_delete_trial'),true,
 'service terminal projection sees the exact attested trial binding');
select is((select status from public.feature_subscriptions where stripe_subscription_id='sub_lifecycle_delete_trial'),'canceled',
 'terminal evidence advances the blocked subscription using its expected revision');
select is((select state from public.feature_checkout_reservations where request_id='96000000-0000-0000-0000-000000000052'),'canceled',
 'terminal evidence releases only the exact deletion-case reservation');
select is((select count(*)::integer from public.feature_payment_receipts where reservation_id=(
 select id from public.feature_checkout_reservations where request_id='96000000-0000-0000-0000-000000000052'))+
 (select count(*)::integer from public.feature_trial_access_grants where user_id='95000000-0000-0000-0000-000000000005'),0,
 'terminal cleanup does not manufacture a paid receipt or restore trial access');

select is(pg_temp.reserve_lifecycle_retirement('97000000-0000-0000-0000-000000000031',
 '97000000-0000-0000-0000-000000000003','95000000-0000-0000-0000-000000000005',false,0),
 'inventory_incomplete','an incomplete provider page cannot reserve customer deletion');
select is(pg_temp.reserve_lifecycle_retirement('97000000-0000-0000-0000-000000000031',
 '97000000-0000-0000-0000-000000000003','95000000-0000-0000-0000-000000000005',true,1),
 'inventory_incomplete','a collectible invoice prevents customer deletion reservation');
select is(pg_temp.reserve_lifecycle_retirement('97000000-0000-0000-0000-000000000031',
 '97000000-0000-0000-0000-000000000003','95000000-0000-0000-0000-000000000005'),'reserved',
 'customer retirement persists the exact complete inventory intent before provider DELETE');
select is(pg_temp.reserve_lifecycle_retirement('97000000-0000-0000-0000-000000000031',
 '97000000-0000-0000-0000-000000000003','95000000-0000-0000-0000-000000000005'),'already_reserved',
 'same retirement request replays without creating another intent');
select is(pg_temp.reserve_lifecycle_retirement('97000000-0000-0000-0000-000000000032',
 '97000000-0000-0000-0000-000000000003','95000000-0000-0000-0000-000000000005'),'retirement_pending',
 'a different request cannot create a second pending retirement for the same mapping');
select is(public.service_record_form_coach_billing_cleanup(
 '97000000-0000-0000-0000-000000000003',1,'97000000-0000-0000-0000-000000000034'),'recorded',
 'unproven customer deletion remains blocked during cleanup');
reset role;
select is((select proof_state from public.stream_media_auth_component_proof_events
 where tombstone_id='97000000-0000-0000-0000-000000000003' and component_key='form_coach_billing'),'incomplete',
 'a reserved intent without verified provider deletion cannot complete cleanup');
select set_config('test.form_coach_retirement_observed_at',(clock_timestamp())::text,true);
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is(pg_temp.record_lifecycle_retirement('97000000-0000-0000-0000-000000000031',
 '95000000-0000-0000-0000-000000000005','97000000-0000-0000-0000-000000000003',404,true),'not_deleted',
 'provider 404 is never accepted as customer-deletion proof');
reset role;
select is((select count(*)::integer from public.feature_form_coach_customer_retirement_proofs
 where request_id='97000000-0000-0000-0000-000000000031'),0,
 'a provider 404 persists no retirement proof');
select set_config('test.form_coach_retirement_observed_at',(clock_timestamp())::text,true);
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is(pg_temp.record_lifecycle_retirement('97000000-0000-0000-0000-000000000031',
 '95000000-0000-0000-0000-000000000005','97000000-0000-0000-0000-000000000003',200,true),'recorded',
 'only exact HTTP 200 deleted-customer evidence records retirement proof');
select is(pg_temp.record_lifecycle_retirement('97000000-0000-0000-0000-000000000031',
 '95000000-0000-0000-0000-000000000005','97000000-0000-0000-0000-000000000003',200,true),'already_recorded',
 'exact provider deletion proof replays idempotently');
select is((select count(*)::integer from public.feature_payer_customer_mappings
 where payer_id='95000000-0000-0000-0000-000000000005' and stripe_customer_id='cus_lifecycle_delete_trial'),1,
 'retirement retains the immutable payer/customer mapping');
reset role;
update public.stream_media_account_tombstones set revision=2,state_revision=state_revision+1,
 tombstone_state='provider_cleanup',updated_at=clock_timestamp()
 where id='97000000-0000-0000-0000-000000000003' and account_id='95000000-0000-0000-0000-000000000005';
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is(public.service_record_form_coach_billing_cleanup(
 '97000000-0000-0000-0000-000000000003',2,'97000000-0000-0000-0000-000000000033'),'recorded',
 'an old retirement proof alone does not authorize the newer tombstone revision');
reset role;
select is((select proof_state from public.stream_media_auth_component_proof_events
 where tombstone_id='97000000-0000-0000-0000-000000000003' and component_key='form_coach_billing'
 order by proof_sequence desc limit 1),'incomplete','cleanup remains incomplete until customer deletion is freshly revalidated');
select set_config('test.form_coach_revalidation_observed_at',
 (clock_timestamp()+interval '10 seconds')::text,true);
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is(pg_temp.record_lifecycle_retirement_revalidation('97000000-0000-0000-0000-000000000035',2,
 false,current_setting('test.form_coach_revalidation_observed_at')::timestamptz,repeat('e',64)),'recorded',
 'a fresh deleted-customer retrieve records a separate proof for the newer tombstone revision');
select is(pg_temp.record_lifecycle_retirement_revalidation('97000000-0000-0000-0000-000000000035',2,
 false,current_setting('test.form_coach_revalidation_observed_at')::timestamptz,repeat('e',64)),'already_recorded',
 'exact revalidation request replays idempotently without repeating provider DELETE');
select is(pg_temp.record_lifecycle_retirement_revalidation('97000000-0000-0000-0000-000000000036',2,
 false,current_setting('test.form_coach_revalidation_observed_at')::timestamptz,repeat('f',64)),'conflict',
 'a second request cannot create another revalidation for the same retirement and tombstone revision');
select is(pg_temp.record_lifecycle_retirement_revalidation('97000000-0000-0000-0000-000000000037',1,
 false,current_setting('test.form_coach_revalidation_observed_at')::timestamptz,repeat('f',64)),'stale',
 'a revalidation cannot reuse the original proof tombstone revision');
select is(pg_temp.record_lifecycle_retirement_revalidation('97000000-0000-0000-0000-000000000039',2,
 true,current_setting('test.form_coach_revalidation_observed_at')::timestamptz,repeat('a',64)),'identity_mismatch',
 'a revalidation cannot cross from test mode into live mode for the same immutable Customer intent');
reset role;
select is((select tombstone_revision from public.feature_form_coach_customer_retirement_proofs
 where request_id='97000000-0000-0000-0000-000000000031'),1::bigint,
 'revalidation leaves the original immutable customer-retirement fact unchanged');
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is(public.service_record_form_coach_billing_cleanup(
 '97000000-0000-0000-0000-000000000003',2,'97000000-0000-0000-0000-000000000038'),'recorded',
 'terminal trial and fresh customer revalidation can complete billing proof at the current tombstone revision');
reset role;
select is((select proof_state from public.stream_media_auth_component_proof_events
 where tombstone_id='97000000-0000-0000-0000-000000000003' and component_key='form_coach_billing'
 order by proof_sequence desc limit 1),'ready',
 'cleanup uses the exact current-revision revalidation while retaining the original provider deletion fact');

-- End-to-end synthetic pack purchase and refund RPC coverage. These are
-- service-role-only calls and never contact Stripe.
set local role authenticated;
set local request.jwt.claims='{"sub":"95000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.admin_create_feature_pricing_revision(
 'form_coach',2,'live','coach','per_assessment','USD','Assessment Pack','Lifecycle test','',0,0,
 '[{"price_key":"assessment_lifecycle","amount_cents":2500,"currency":"USD","interval":null,"credits_per_pack":5,"stripe_product_id":"prod_pack_lifecycle","stripe_price_id":"price_pack_lifecycle"}]'::jsonb
),3::bigint,'creates an immutable assessment-pack quote for refund-path coverage');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"95000000-0000-0000-0000-000000000007","role":"authenticated"}';
select throws_ok($$select public.service_record_form_coach_pack_refund_event(
 'evt_pack_acl','charge.refunded','re_pack_acl','00000000-0000-0000-0000-000000000001',
 '95000000-0000-0000-0000-000000000007','cus_lifecycle_pack','pi_pack_acl','ch_pack_acl',2500,'USD',1,
 'applied',null,repeat('1',64),2500,repeat('2',64),now())$$,
 '42501',null,'authenticated callers cannot invoke the service-only pack refund adapter');
reset role;
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is((select outcome from public.reserve_feature_checkout('form_coach','95000000-0000-0000-0000-000000000007',3,
 'assessment_lifecycle',1,'96000000-0000-0000-0000-000000000061')),'reserved','reserves a synthetic full-refund pack purchase');
select is(public.bind_feature_checkout_session((select id from public.feature_checkout_reservations
 where request_id='96000000-0000-0000-0000-000000000061'),'cs_pack_lifecycle_full','cus_lifecycle_pack',null),'bound',
 'binds the exact full-refund pack Checkout session');
select is(public.apply_feature_checkout_payment('evt_pack_lifecycle_full','checkout.session.completed',
 jsonb_build_object('feature_namespace','form_coach','feature_key','form_coach'),
 'cs_pack_lifecycle_full','pi_pack_lifecycle_full','pi_pack_lifecycle_full','price_pack_lifecycle',2500,'USD',1),
 'applied','a verified synthetic pack payment creates its receipt and credit lot');
select is(public.service_record_form_coach_pack_refund_event(
 'evt_pack_lifecycle_full_refund','charge.refunded','re_pack_lifecycle_full',
 (select id from public.feature_payment_receipts where stripe_checkout_session_id='cs_pack_lifecycle_full'),
 '95000000-0000-0000-0000-000000000007','cus_lifecycle_pack','pi_pack_lifecycle_full','ch_pack_lifecycle_full',
 2500,'USD',1,'applied',null,repeat('2',64),2500,repeat('3',64),now()),'applied',
 'a full refund is applied through the exact originating pack receipt');
select is((select remaining_units::integer from public.feature_credit_lots
 where source_receipt_id=(select id from public.feature_payment_receipts where stripe_checkout_session_id='cs_pack_lifecycle_full')
   and pack_unit_index=1),0,'full refund removes only the refunded originating pack units');
select is((select outcome from public.reserve_feature_checkout('form_coach','95000000-0000-0000-0000-000000000007',3,
 'assessment_lifecycle',1,'96000000-0000-0000-0000-000000000062')),'reserved','reserves an independent partial-refund pack purchase');
select is(public.bind_feature_checkout_session((select id from public.feature_checkout_reservations
 where request_id='96000000-0000-0000-0000-000000000062'),'cs_pack_lifecycle_partial','cus_lifecycle_pack',null),'bound',
 'binds the exact partial-refund pack Checkout session');
select is(public.apply_feature_checkout_payment('evt_pack_lifecycle_partial','checkout.session.completed',
 jsonb_build_object('feature_namespace','form_coach','feature_key','form_coach'),
 'cs_pack_lifecycle_partial','pi_pack_lifecycle_partial','pi_pack_lifecycle_partial','price_pack_lifecycle',2500,'USD',1),
 'applied','creates an independent credit lot for partial-refund review');
select is(public.service_record_form_coach_pack_refund_event(
 'evt_pack_lifecycle_partial_refund','charge.refunded','re_pack_lifecycle_partial',
 (select id from public.feature_payment_receipts where stripe_checkout_session_id='cs_pack_lifecycle_partial'),
 '95000000-0000-0000-0000-000000000007','cus_lifecycle_pack','pi_pack_lifecycle_partial','ch_pack_lifecycle_partial',
 1200,'USD',1,'manual_review','partial_or_ambiguous_amount',repeat('3',64),1200,repeat('4',64),now()),'manual_review',
 'partial refund is durably reviewed rather than converted into guessed units');
select is(public.service_record_form_coach_pack_refund_event(
 'evt_pack_lifecycle_partial_refund','charge.refunded','re_pack_lifecycle_partial',
 (select id from public.feature_payment_receipts where stripe_checkout_session_id='cs_pack_lifecycle_partial'),
 '95000000-0000-0000-0000-000000000007','cus_lifecycle_pack','pi_pack_lifecycle_partial','ch_pack_lifecycle_partial',
 1200,'USD',1,'manual_review','partial_or_ambiguous_amount',repeat('3',64),1200,repeat('4',64),now()+interval '1 second'),
 'already_manual_review','an unchanged delivery replay is idempotent even when observed later');
select is(public.service_record_form_coach_pack_refund_event(
 'evt_pack_lifecycle_partial_refund','charge.refunded','re_pack_lifecycle_partial',
 (select id from public.feature_payment_receipts where stripe_checkout_session_id='cs_pack_lifecycle_partial'),
 '95000000-0000-0000-0000-000000000007','cus_lifecycle_pack','pi_pack_lifecycle_partial','ch_pack_lifecycle_partial',
 1200,'USD',1,'manual_review','partial_or_ambiguous_amount',repeat('3',64),2000,repeat('5',64),now()+interval '2 seconds'),
 'already_manual_review','a replay after later refunds records a new observation without conflicting with immutable refund identity');
reset role;
select is((select count(*)::integer from public.feature_form_coach_pack_refund_observations
 where event_id='evt_pack_lifecycle_partial_refund' and refund_id='re_pack_lifecycle_partial'),2,
 'cumulative provider observations are append-only and distinct from the stable refund event identity');
select is((select max(cumulative_refunded_cents) from public.feature_form_coach_pack_refund_observations
 where event_id='evt_pack_lifecycle_partial_refund' and refund_id='re_pack_lifecycle_partial'),2000::bigint,
 'the latest cumulative refund total is retained separately from the original refund amount');
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is((select remaining_units::integer from public.feature_credit_lots
 where source_receipt_id=(select id from public.feature_payment_receipts where stripe_checkout_session_id='cs_pack_lifecycle_partial')
   and pack_unit_index=1),5,'partial review preserves the originating credit lot unchanged');
reset role;

select * from finish();
rollback;
