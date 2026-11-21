begin;
select no_plan();

-- Rollback-scoped local fixture: create the Gate 1 order and billing intent through
-- the normal RPCs. The synthetic Customer/Session IDs below exercise SQL contracts
-- only; the test performs no Stripe, Auth, Storage or other provider request.
insert into auth.users (id,email,raw_user_meta_data) values
  ('f9800000-0000-4000-8000-000000000001','checkout-app-coach@example.test','{"display_name":"Checkout App Coach"}'),
  ('f9800000-0000-4000-8000-000000000002','checkout-app-buyer@example.test','{"display_name":"Checkout App Buyer"}'),
  ('f9800000-0000-4000-8000-000000000003','checkout-app-outsider@example.test','{"display_name":"Checkout App Outsider"}');
update public.profiles set role='coach' where id='f9800000-0000-4000-8000-000000000001';
update public.profiles set role='member' where id in (
  'f9800000-0000-4000-8000-000000000002','f9800000-0000-4000-8000-000000000003');
insert into public.platform_test_entitlements(member_id,tier,grant_reason,granted_by) values
  ('f9800000-0000-4000-8000-000000000002','regular','Synthetic Checkout app contract','f9800000-0000-4000-8000-000000000001'),
  ('f9800000-0000-4000-8000-000000000003','regular','Synthetic Checkout app contract','f9800000-0000-4000-8000-000000000001');
insert into public.coach_members(coach_id,member_id) values
  ('f9800000-0000-4000-8000-000000000001','f9800000-0000-4000-8000-000000000002');
insert into public.programs(id,coach_id,title,description,published)
values('f9900000-0000-4000-8000-000000000001','f9800000-0000-4000-8000-000000000001','Checkout app contract fixture','',true);
insert into public.program_content_versions(id,program_id,revision_number,revision_kind,lesson_count,created_by)
select 'f9a00000-0000-4000-8000-000000000001','f9900000-0000-4000-8000-000000000001',
  coalesce(max(version.revision_number),0)+1,'paid',1,'f9800000-0000-4000-8000-000000000001'
from public.program_content_versions version where version.program_id='f9900000-0000-4000-8000-000000000001';
insert into public.program_content_version_lessons(
  program_id,content_version_id,lesson_ordinal,timeline_day_number,title,instructions,pillar,
  video_id,video_creator_id,cloudflare_uid,cloudflare_signed_urls_verified
) values ('f9900000-0000-4000-8000-000000000001','f9a00000-0000-4000-8000-000000000001',
  1,1,'Checkout app contract lesson','','body',null,null,null,false);
insert into public.program_offer_versions(
  id,program_id,offer_number,content_version_id,offer_kind,list_price_cents,currency,max_installments,
  platform_owned,seller_profile_id,connected_account_id,created_by
)
select 'f9b00000-0000-4000-8000-000000000001','f9900000-0000-4000-8000-000000000001',
  coalesce(max(offer.offer_number),0)+1,'f9a00000-0000-4000-8000-000000000001','paid',12000,'usd',1,
  false,'f9800000-0000-4000-8000-000000000001','acct_checkoutappcoach','f9800000-0000-4000-8000-000000000001'
from public.program_offer_versions offer where offer.program_id='f9900000-0000-4000-8000-000000000001';
update public.program_commerce_state set current_content_version_id='f9a00000-0000-4000-8000-000000000001',
  current_offer_version_id='f9b00000-0000-4000-8000-000000000001'
where program_id='f9900000-0000-4000-8000-000000000001';

set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.checkout_app_order_id',public.create_program_order_reservation(
  'f9800000-0000-4000-8000-000000000002','f9900000-0000-4000-8000-000000000001',
  'f9b00000-0000-4000-8000-000000000001',1::smallint,'checkout-app-order-1',null
)::text,true);
select is((public.prepare_program_billing_terms(current_setting('test.checkout_app_order_id')::uuid,
  0::bigint,repeat('a',64),array[]::date[],false,null::smallint)->>'status'),
  'saved','normal billing terms RPC saves the synthetic fixed one-time quote');
select is((public.prepare_program_billing_customer(current_setting('test.checkout_app_order_id')::uuid,
  1::bigint,'acct_checkoutapp',false)->>'status'),
  'prepared','normal Customer RPC persists the provider scope and create intent');
select ok(public.bind_program_billing_customer(current_setting('test.checkout_app_order_id')::uuid,
  2::bigint,'cus_checkoutapp',jsonb_build_object(
    'id','cus_checkoutapp','deleted',false,'balance',0,'discountId',null,'taxExempt','none',
    'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_checkoutapp','livemode',false),
    'metadata',jsonb_build_object('program_order_id',current_setting('test.checkout_app_order_id'),
      'program_billing_purpose','program_order','program_platform_account_id','acct_checkoutapp','program_livemode','false'),
    'invoiceCreditBalance',jsonb_build_object('usd',0)
  ),repeat('b',64)),'normal Customer bind RPC accepts only the persisted order and provider scope');
select set_config('test.checkout_app_prepare',public.prepare_program_checkout_attempt(
  current_setting('test.checkout_app_order_id')::uuid,3::bigint,
  'https://gymx2.test/programs/return?checkout=success','https://gymx2.test/programs/return?checkout=cancel'
)::text,true);
select is(current_setting('test.checkout_app_prepare')::jsonb->>'status','prepared',
  'normal Checkout prepare RPC creates the immutable first attempt');
select set_config('test.checkout_app_attempt_id',current_setting('test.checkout_app_prepare')::jsonb->>'attempt_id',true);

select has_table('public','program_billing_checkout_app_audits',
  'Checkout audit table is present');
select ok(to_regprocedure('public.get_program_checkout_snapshot(uuid,uuid,bigint)') is not null,
  'Scoped snapshot RPC has the expected signature');
select ok(to_regprocedure('public.record_program_checkout_app_audit(uuid,text,smallint,text,text,text,text,text)') is not null,
  'Checkout audit RPC has the expected signature');

select is(public.get_program_checkout_snapshot(current_setting('test.checkout_app_order_id')::uuid,
  'f9800000-0000-4000-8000-000000000002',4::bigint)->>'status','ready',
  'eligible owner gets the exact current billing snapshot');
select is(public.get_program_checkout_snapshot(current_setting('test.checkout_app_order_id')::uuid,
  'f9800000-0000-4000-8000-000000000002',4::bigint)->>'effective_total_cents','12000',
  'snapshot quote comes from the immutable Gate 1 order');
select is(public.get_program_checkout_snapshot(current_setting('test.checkout_app_order_id')::uuid,
  'f9800000-0000-4000-8000-000000000002',4::bigint)->'provider_scope'->>'platform_account_id','acct_checkoutapp',
  'snapshot provider scope comes from persisted billing state');
select is(public.get_program_checkout_snapshot(current_setting('test.checkout_app_order_id')::uuid,
  'f9800000-0000-4000-8000-000000000002',4::bigint)->'consent'->>'digest',repeat('a',64),
  'snapshot terms digest is the actually accepted consent');
select is(jsonb_array_length(public.get_program_checkout_snapshot(current_setting('test.checkout_app_order_id')::uuid,
  'f9800000-0000-4000-8000-000000000002',4::bigint)->'attempts'),1,
  'snapshot contains exactly the persisted Checkout attempt');
select is(public.get_program_checkout_snapshot(current_setting('test.checkout_app_order_id')::uuid,
  'f9800000-0000-4000-8000-000000000002',4::bigint)->'attempts'->0->>'attempt_id',
  current_setting('test.checkout_app_attempt_id'),'snapshot returns the exact persisted attempt identity');
select is(public.get_program_checkout_snapshot(current_setting('test.checkout_app_order_id')::uuid,
  'f9800000-0000-4000-8000-000000000002',4::bigint)->'attempts'->0->>'explicit_retry_request_id',null,
  'the initial attempt has no synthetic retry request');
select is(public.get_program_checkout_snapshot(current_setting('test.checkout_app_order_id')::uuid,
  'f9800000-0000-4000-8000-000000000002',4::bigint)->'attempts'->0->>'retry_proof_digest',null,
  'the initial attempt has no synthetic retry proof');
select is(public.get_program_checkout_snapshot(current_setting('test.checkout_app_order_id')::uuid,
  'f9800000-0000-4000-8000-000000000002',3::bigint)->>'status','stale_revision',
  'snapshot refuses an outdated billing revision');
select is(public.get_program_checkout_snapshot(current_setting('test.checkout_app_order_id')::uuid,
  'f9800000-0000-4000-8000-000000000003',4::bigint)->>'status','not_found',
  'snapshot does not reveal another buyer’s order');

select is(public.record_program_checkout_app_audit(current_setting('test.checkout_app_order_id')::uuid,
  'checkout_create',1::smallint,'unknown','provider_request_unknown',repeat('c',64),null,null),false,
  'unknown audit is rejected while the existing operation is still intent');
select ok(public.mark_program_checkout_create_unknown(current_setting('test.checkout_app_order_id')::uuid,1::smallint),
  'existing Gate 4 RPC marks the provider create outcome unknown before audit');
select is(public.record_program_checkout_app_audit(current_setting('test.checkout_app_order_id')::uuid,
  'checkout_create',2::smallint,'unknown','provider_request_unknown',repeat('c',64),null,null),false,
  'audit rejects a checkout attempt without a matching operation');
select is(public.record_program_checkout_app_audit(current_setting('test.checkout_app_order_id')::uuid,
  'customer_create',1::smallint,'conflict','program_customer_inventory_mismatch',repeat('c',64),null,null),false,
  'audit rejects an operation-kind and attempt-number mismatch');
select is(public.record_program_checkout_app_audit(current_setting('test.checkout_app_order_id')::uuid,
  'checkout_create',1::smallint,'unknown','provider_request_unknown',repeat('c',64),null,null),true,
  'audit appends unknown evidence only for the exact existing unknown operation');
reset role;
select set_config('test.checkout_billing_before_audit',(
  select jsonb_build_object('revision',billing.revision,'billing_state',billing.billing_state)::text
  from public.program_billing_orders billing where billing.order_id=current_setting('test.checkout_app_order_id')::uuid
),true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.record_program_checkout_app_audit(current_setting('test.checkout_app_order_id')::uuid,
  'checkout_create',1::smallint,'observed','checkout_session_observed',repeat('d',64),'cs_checkoutapp','open'),true,
  'pre-bind Session observation is appended against the existing Checkout operation');
select is(public.record_program_checkout_app_audit(current_setting('test.checkout_app_order_id')::uuid,
  'checkout_create',1::smallint,'conflict','checkout_attempt_inventory_mismatch',repeat('e',64),null,null),true,
  'allowed Checkout conflict evidence is appended without a billing-state transition');
reset role;
select is((select jsonb_build_object('revision',billing.revision,'billing_state',billing.billing_state)
  from public.program_billing_orders billing where billing.order_id=current_setting('test.checkout_app_order_id')::uuid),
  current_setting('test.checkout_billing_before_audit')::jsonb,
  'unknown, observation and conflict audit rows do not change billing revision or state');
select is((select count(*)::integer from public.program_billing_checkout_app_audits audit
  where audit.order_id=current_setting('test.checkout_app_order_id')::uuid),3,
  'audit RPC persisted the exact three allowed observations');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"f9800000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(public.request_program_checkout_retry(current_setting('test.checkout_app_order_id')::uuid,
  'f9c00000-0000-4000-8000-000000000001')->>'status','requested',
  'authenticated buyer records an explicit retry through the existing buyer RPC');
select throws_ok($$select public.get_program_checkout_snapshot(
  current_setting('test.checkout_app_order_id')::uuid,'f9800000-0000-4000-8000-000000000002',4::bigint)$$,
  '42501',null,'authenticated users cannot call the service snapshot RPC');
reset role;
set local role anon;
set local request.jwt.claim.role='anon';
set local request.jwt.claims='{"role":"anon"}';
select throws_ok($$select public.record_program_checkout_app_audit(
  current_setting('test.checkout_app_order_id')::uuid,'checkout_create',1::smallint,
  'conflict','checkout_attempt_inventory_mismatch',repeat('e',64),null,null)$$,
  '42501',null,'anonymous users cannot invoke the audit RPC');
reset role;

-- Exercise a real Gate 4 buyer-request/terminal-proof retry using the same
-- valid bound expired Session and canceled zero-paid PI contract as Gate 4.
select set_config('test.checkout_app_retry_billing_revision',(
  select billing.revision::text from public.program_billing_orders billing
  where billing.order_id=current_setting('test.checkout_app_order_id')::uuid
),true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select ok(public.bind_program_billing_checkout_session(current_setting('test.checkout_app_order_id')::uuid,
  current_setting('test.checkout_app_retry_billing_revision')::bigint,1::smallint,
  'cs_checkoutapp_expired','pi_checkoutapp_expired',
  jsonb_build_object('id','cs_checkoutapp_expired','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_checkoutapp','livemode',false),
    'customer_id','cus_checkoutapp','client_reference_id',current_setting('test.checkout_app_attempt_id'),
    'payment_intent_id','pi_checkoutapp_expired','mode','payment','currency','usd','amount_total',12000,
    'status','expired','payment_status','unpaid',
    'metadata',jsonb_build_object('program_order_id',current_setting('test.checkout_app_order_id'),
      'program_checkout_attempt_id',current_setting('test.checkout_app_attempt_id'),
      'program_checkout_attempt_number','1','program_installment_number','1','program_billing_kind','program_sale',
      'program_platform_account_id','acct_checkoutapp','program_livemode','false'),
    'payment_intent',jsonb_build_object('livemode',false,'customer_id','cus_checkoutapp','amount',12000,
      'currency','usd','application_fee_amount',1200,'transfer_destination_id','acct_checkoutappcoach',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.checkout_app_order_id'),
        'program_checkout_attempt_id',current_setting('test.checkout_app_attempt_id'),
        'program_checkout_attempt_number','1','program_installment_number','1','program_billing_kind','program_sale',
        'program_platform_account_id','acct_checkoutapp','program_livemode','false'))),repeat('e',64)),
  'the normal binder persists a complete synthetic expired Session and canceled PI before retry proof');
reset role;
select set_config('test.checkout_app_retry_billing_revision',(
  select billing.revision::text from public.program_billing_orders billing
  where billing.order_id=current_setting('test.checkout_app_order_id')::uuid
),true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.checkout_app_advance',public.advance_program_checkout_attempt(
  current_setting('test.checkout_app_order_id')::uuid,
  current_setting('test.checkout_app_retry_billing_revision')::bigint,
  'f9c00000-0000-4000-8000-000000000001',
  jsonb_build_object('completeInventory',true,'orderId',current_setting('test.checkout_app_order_id'),
    'customerId','cus_checkoutapp','priorAttemptNumber',1,'pendingInvoiceItemCount',0,
    'sessionIds',jsonb_build_array('cs_checkoutapp_expired'),
    'paymentIntentIds',jsonb_build_array('pi_checkoutapp_expired'),
    'invoiceIds','[]'::jsonb,'subscriptionIds','[]'::jsonb,'scheduleIds','[]'::jsonb,
    'attempts',jsonb_build_array(jsonb_build_object('attemptNumber',1,
      'attemptId',current_setting('test.checkout_app_attempt_id'),'sessionId','cs_checkoutapp_expired',
      'paymentIntentId','pi_checkoutapp_expired','paymentIntentStatus','canceled',
      'sessionStatus','expired','sessionPaymentStatus','unpaid','amountCents',12000,
      'amountReceivedCents',0,'currency','usd','customerId','cus_checkoutapp'))),repeat('f',64)
)::text,true);
select is(current_setting('test.checkout_app_advance')::jsonb->>'status','prepared',
  'the service advance accepts only the exact persisted buyer request and terminal provider proof');
select is(current_setting('test.checkout_app_advance')::jsonb->>'attempt_number','2',
  'the verified retry appends attempt two');
select set_config('test.checkout_app_retry_attempt_id',
  current_setting('test.checkout_app_advance')::jsonb->>'attempt_id',true);
reset role;
select set_config('test.checkout_app_retry_billing_revision',(
  select billing.revision::text from public.program_billing_orders billing
  where billing.order_id=current_setting('test.checkout_app_order_id')::uuid
),true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.checkout_app_retry_snapshot',public.get_program_checkout_snapshot(
  current_setting('test.checkout_app_order_id')::uuid,'f9800000-0000-4000-8000-000000000002',
  current_setting('test.checkout_app_retry_billing_revision')::bigint
)::text,true);
select is(current_setting('test.checkout_app_retry_snapshot')::jsonb->>'status','ready',
  'the current-revision snapshot remains available after exact retry advancement');
select is(current_setting('test.checkout_app_retry_snapshot')::jsonb->'attempts'->1->>'attempt_id',
  current_setting('test.checkout_app_retry_attempt_id'),'snapshot returns the database-created retry attempt UUID');
select is(current_setting('test.checkout_app_retry_snapshot')::jsonb->'attempts'->1->>'explicit_retry_request_id',
  'f9c00000-0000-4000-8000-000000000001','snapshot hydrates the exact applied buyer retry request');
select is(current_setting('test.checkout_app_retry_snapshot')::jsonb->'attempts'->1->>'retry_proof_digest',repeat('f',64),
  'snapshot hydrates the exact proof digest recorded by the 500 advance RPC');
select is(jsonb_typeof(current_setting('test.checkout_app_retry_snapshot')::jsonb->'attempts'->1->'checkout_session_id'),
  'null','the new attempt has no Session until its own provider create/bind completes');
select is(jsonb_typeof(current_setting('test.checkout_app_retry_snapshot')::jsonb->'attempts'->1->'payment_intent_id'),
  'null','the new attempt has no PaymentIntent until its own provider create/bind completes');
reset role;
select is((select request.request_state from public.program_billing_retry_requests request
  where request.order_id=current_setting('test.checkout_app_order_id')::uuid
    and request.request_id='f9c00000-0000-4000-8000-000000000001'),'applied',
  'the snapshot request is the buyer row actually applied by the trusted advance');
select is((select request.requested_by from public.program_billing_retry_requests request
  where request.order_id=current_setting('test.checkout_app_order_id')::uuid
    and request.request_id='f9c00000-0000-4000-8000-000000000001'),
  'f9800000-0000-4000-8000-000000000002'::uuid,'the applied retry provenance remains bound to the order buyer');
select is((select request.prior_attempt_number from public.program_billing_retry_requests request
  where request.order_id=current_setting('test.checkout_app_order_id')::uuid
    and request.request_id='f9c00000-0000-4000-8000-000000000001'),1::smallint,
  'the persisted retry request references exactly the prior attempt');
select is((select request.proof_digest from public.program_billing_retry_requests request
  where request.order_id=current_setting('test.checkout_app_order_id')::uuid
    and request.request_id='f9c00000-0000-4000-8000-000000000001'),repeat('f',64),
  'the persisted buyer request has the same terminal proof digest as attempt two');

update public.profiles set role='coach' where id='f9800000-0000-4000-8000-000000000002';
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is(public.get_program_checkout_snapshot(current_setting('test.checkout_app_order_id')::uuid,
  'f9800000-0000-4000-8000-000000000002',current_setting('test.checkout_app_retry_billing_revision')::bigint)->>'status','buyer_or_program_ineligible',
  'snapshot fails closed when the persisted profile is no longer a member');
reset role;

select ok(
  has_function_privilege('service_role','public.get_program_checkout_snapshot(uuid,uuid,bigint)','execute')
    and not has_function_privilege('authenticated','public.get_program_checkout_snapshot(uuid,uuid,bigint)','execute')
    and not has_function_privilege('anon','public.get_program_checkout_snapshot(uuid,uuid,bigint)','execute'),
  'Only the server service role can read a scoped Checkout snapshot'
);
select ok(
  has_function_privilege('service_role','public.record_program_checkout_app_audit(uuid,text,smallint,text,text,text,text,text)','execute')
    and not has_function_privilege('authenticated','public.record_program_checkout_app_audit(uuid,text,smallint,text,text,text,text,text)','execute')
    and not has_function_privilege('anon','public.record_program_checkout_app_audit(uuid,text,smallint,text,text,text,text,text)','execute'),
  'Only the server service role can append Checkout audit evidence'
);
select ok(
  not has_table_privilege('service_role','public.program_billing_checkout_app_audits','select')
    and not has_table_privilege('service_role','public.program_billing_checkout_app_audits','insert')
    and not has_table_privilege('service_role','public.program_billing_checkout_app_audits','update')
    and not has_table_privilege('service_role','public.program_billing_checkout_app_audits','delete')
    and not has_table_privilege('authenticated','public.program_billing_checkout_app_audits','select'),
  'The audit table has no direct app or service-role access'
);
select ok(
  (select procedure.prosecdef and procedure.proconfig @> array['search_path=""']
   from pg_catalog.pg_proc procedure
   where procedure.oid = 'public.get_program_checkout_snapshot(uuid,uuid,bigint)'::regprocedure),
  'Snapshot RPC is a security definer with an empty search path'
);
select ok(
  (select procedure.prosecdef and procedure.proconfig @> array['search_path=""']
   from pg_catalog.pg_proc procedure
   where procedure.oid = 'public.record_program_checkout_app_audit(uuid,text,smallint,text,text,text,text,text)'::regprocedure),
  'Audit RPC is a security definer with an empty search path'
);
select ok(exists (
  select 1 from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgrelid = 'public.program_billing_checkout_app_audits'::regclass
    and trigger_row.tgname = 'program_billing_checkout_app_audits_immutable'
    and not trigger_row.tgisinternal
), 'Checkout audit rows have an immutability trigger');
select throws_ok($$update public.program_billing_checkout_app_audits
  set provider_status='complete'
  where order_id=current_setting('test.checkout_app_order_id')::uuid and event_kind='observed'$$,
  '55000',null,'audit rows reject updates even from the local database owner');

select * from finish();
rollback;
