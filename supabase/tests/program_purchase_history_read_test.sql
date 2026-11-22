begin;
select no_plan();

-- Local synthetic buyer, Program and payment facts only. No provider, Auth,
-- Storage, network or external billing calls occur in this test.
insert into auth.users(id,email,raw_user_meta_data) values
  ('63010000-0000-4000-8000-000000000001','history-coach@example.test','{"display_name":"History Coach"}'),
  ('63010000-0000-4000-8000-000000000002','history-buyer-one@example.test','{"display_name":"History Buyer One"}'),
  ('63010000-0000-4000-8000-000000000003','history-buyer-two@example.test','{"display_name":"History Buyer Two"}'),
  ('63010000-0000-4000-8000-000000000004','history-buyer-three@example.test','{"display_name":"History Buyer Three"}'),
  ('63010000-0000-4000-8000-000000000005','history-lapsed@example.test','{"display_name":"History Lapsed Buyer"}');
update public.profiles set role='coach' where id='63010000-0000-4000-8000-000000000001';
update public.profiles set role='member' where id in (
  '63010000-0000-4000-8000-000000000002','63010000-0000-4000-8000-000000000003',
  '63010000-0000-4000-8000-000000000004','63010000-0000-4000-8000-000000000005');
insert into public.platform_test_entitlements(member_id,tier,grant_reason,granted_by) values
  ('63010000-0000-4000-8000-000000000002','regular','Synthetic purchase history TAP','63010000-0000-4000-8000-000000000001'),
  ('63010000-0000-4000-8000-000000000003','regular','Synthetic purchase history TAP','63010000-0000-4000-8000-000000000001'),
  ('63010000-0000-4000-8000-000000000004','regular','Synthetic purchase history TAP','63010000-0000-4000-8000-000000000001'),
  ('63010000-0000-4000-8000-000000000005','regular','Synthetic purchase history TAP','63010000-0000-4000-8000-000000000001');
insert into public.coach_members(coach_id,member_id) values
  ('63010000-0000-4000-8000-000000000001','63010000-0000-4000-8000-000000000002'),
  ('63010000-0000-4000-8000-000000000001','63010000-0000-4000-8000-000000000003'),
  ('63010000-0000-4000-8000-000000000001','63010000-0000-4000-8000-000000000004'),
  ('63010000-0000-4000-8000-000000000001','63010000-0000-4000-8000-000000000005');

insert into public.programs(id,coach_id,title,description,published) values
  ('63030000-0000-4000-8000-000000000001','63010000-0000-4000-8000-000000000001','History fixture 1','',true),
  ('63030000-0000-4000-8000-000000000002','63010000-0000-4000-8000-000000000001','History fixture 2','',true),
  ('63030000-0000-4000-8000-000000000003','63010000-0000-4000-8000-000000000001','History fixture 3','',true),
  ('63030000-0000-4000-8000-000000000004','63010000-0000-4000-8000-000000000001','History fixture 4','',true),
  ('63030000-0000-4000-8000-000000000005','63010000-0000-4000-8000-000000000001','History fixture 5','',true),
  ('63030000-0000-4000-8000-000000000006','63010000-0000-4000-8000-000000000001','History fixture 6','',true);
insert into public.program_content_versions(id,program_id,revision_number,revision_kind,lesson_count,created_by) values
  ('63060000-0000-4000-8000-000000000001','63030000-0000-4000-8000-000000000001',2,'paid',3,'63010000-0000-4000-8000-000000000001'),
  ('63060000-0000-4000-8000-000000000002','63030000-0000-4000-8000-000000000002',2,'paid',3,'63010000-0000-4000-8000-000000000001'),
  ('63060000-0000-4000-8000-000000000003','63030000-0000-4000-8000-000000000003',2,'paid',3,'63010000-0000-4000-8000-000000000001'),
  ('63060000-0000-4000-8000-000000000004','63030000-0000-4000-8000-000000000004',2,'paid',3,'63010000-0000-4000-8000-000000000001'),
  ('63060000-0000-4000-8000-000000000005','63030000-0000-4000-8000-000000000005',2,'paid',3,'63010000-0000-4000-8000-000000000001'),
  ('63060000-0000-4000-8000-000000000006','63030000-0000-4000-8000-000000000006',2,'paid',3,'63010000-0000-4000-8000-000000000001');
insert into public.program_content_version_lessons(
  program_id,content_version_id,lesson_ordinal,timeline_day_number,title,instructions,pillar
) values
  ('63030000-0000-4000-8000-000000000001','63060000-0000-4000-8000-000000000001',1,1,'Text 1','','body'),
  ('63030000-0000-4000-8000-000000000001','63060000-0000-4000-8000-000000000001',2,2,'Text 2','','mind'),
  ('63030000-0000-4000-8000-000000000001','63060000-0000-4000-8000-000000000001',3,3,'Text 3','','spirit'),
  ('63030000-0000-4000-8000-000000000002','63060000-0000-4000-8000-000000000002',1,1,'Text 1','','body'),
  ('63030000-0000-4000-8000-000000000002','63060000-0000-4000-8000-000000000002',2,2,'Text 2','','mind'),
  ('63030000-0000-4000-8000-000000000002','63060000-0000-4000-8000-000000000002',3,3,'Text 3','','spirit'),
  ('63030000-0000-4000-8000-000000000003','63060000-0000-4000-8000-000000000003',1,1,'Text 1','','body'),
  ('63030000-0000-4000-8000-000000000003','63060000-0000-4000-8000-000000000003',2,2,'Text 2','','mind'),
  ('63030000-0000-4000-8000-000000000003','63060000-0000-4000-8000-000000000003',3,3,'Text 3','','spirit'),
  ('63030000-0000-4000-8000-000000000004','63060000-0000-4000-8000-000000000004',1,1,'Text 1','','body'),
  ('63030000-0000-4000-8000-000000000004','63060000-0000-4000-8000-000000000004',2,2,'Text 2','','mind'),
  ('63030000-0000-4000-8000-000000000004', '63060000-0000-4000-8000-000000000004',3,3,'Text 3','','spirit'),
  ('63030000-0000-4000-8000-000000000005','63060000-0000-4000-8000-000000000005',1,1,'Text 1','','body'),
  ('63030000-0000-4000-8000-000000000005','63060000-0000-4000-8000-000000000005',2,2,'Text 2','','mind'),
  ('63030000-0000-4000-8000-000000000005','63060000-0000-4000-8000-000000000005',3,3,'Text 3','','spirit'),
  ('63030000-0000-4000-8000-000000000006','63060000-0000-4000-8000-000000000006',1,1,'Text 1','','body'),
  ('63030000-0000-4000-8000-000000000006','63060000-0000-4000-8000-000000000006',2,2,'Text 2','','mind'),
  ('63030000-0000-4000-8000-000000000006','63060000-0000-4000-8000-000000000006',3,3,'Text 3','','spirit');
insert into public.program_offer_versions(
  id,program_id,offer_number,content_version_id,offer_kind,list_price_cents,currency,max_installments,
  platform_owned,seller_profile_id,connected_account_id,created_by
) values
  ('63070000-0000-4000-8000-000000000001','63030000-0000-4000-8000-000000000001',2,'63060000-0000-4000-8000-000000000001','paid',1200,'usd',3,false,'63010000-0000-4000-8000-000000000001','acct_630coach1','63010000-0000-4000-8000-000000000001'),
  ('63070000-0000-4000-8000-000000000002','63030000-0000-4000-8000-000000000002',2,'63060000-0000-4000-8000-000000000002','paid',1200,'usd',3,false,'63010000-0000-4000-8000-000000000001','acct_630coach2','63010000-0000-4000-8000-000000000001'),
  ('63070000-0000-4000-8000-000000000003','63030000-0000-4000-8000-000000000003',2,'63060000-0000-4000-8000-000000000003','paid',1200,'usd',3,false,'63010000-0000-4000-8000-000000000001','acct_630coach3','63010000-0000-4000-8000-000000000001'),
  ('63070000-0000-4000-8000-000000000004','63030000-0000-4000-8000-000000000004',2,'63060000-0000-4000-8000-000000000004','paid',1200,'usd',3,false,'63010000-0000-4000-8000-000000000001','acct_630coach4','63010000-0000-4000-8000-000000000001'),
  ('63070000-0000-4000-8000-000000000005','63030000-0000-4000-8000-000000000005',2,'63060000-0000-4000-8000-000000000005','paid',1200,'usd',3,false,'63010000-0000-4000-8000-000000000001','acct_630coach5','63010000-0000-4000-8000-000000000001'),
  ('63070000-0000-4000-8000-000000000006','63030000-0000-4000-8000-000000000006',2,'63060000-0000-4000-8000-000000000006','paid',1200,'usd',3,false,'63010000-0000-4000-8000-000000000001','acct_630coach6','63010000-0000-4000-8000-000000000001');
update public.program_commerce_state state set
  current_content_version_id=version.id,current_offer_version_id=offer.id
from public.program_content_versions version
join public.program_offer_versions offer on offer.content_version_id=version.id
where state.program_id=version.program_id and version.revision_number=2 and offer.offer_number=2;
insert into public.program_promotions(
  id,program_id,offer_version_id,code,discount_kind,discount_value,max_redemptions,created_by
) values ('63080000-0000-4000-8000-000000000001','63030000-0000-4000-8000-000000000005',
  '63070000-0000-4000-8000-000000000005','FREE100','percent',10000,10,'63010000-0000-4000-8000-000000000001');

create function pg_temp.make_purchase_history_order(
  p_buyer uuid,p_program uuid,p_offer uuid,p_installments smallint,p_request text,p_promotion text default null
) returns uuid language sql as $$
  select public.create_program_order_reservation(p_buyer,p_program,p_offer,p_installments,p_request,p_promotion)
$$;

create function pg_temp.prepare_purchase_history_checkout(
  p_order_id uuid,p_mode text,p_customer text,p_checkout text,p_payment_intent text,
  p_amount integer,p_connected_account text,p_terms_preseeded boolean default false
) returns uuid language plpgsql as $fixture$
declare
  v_result jsonb;
  v_attempt_id uuid;
  v_revision bigint;
  v_amount integer;
  v_fee integer;
  v_evidence jsonb;
begin
  if p_terms_preseeded then
    v_revision := 1;
  else
    v_result := public.prepare_program_billing_terms(p_order_id,0::bigint,repeat('1',64),'{}'::date[],false,null::smallint);
    if v_result->>'status' <> 'saved' then raise exception 'synthetic terms setup failed: %',v_result->>'status'; end if;
    v_revision := (v_result->>'revision')::bigint;
  end if;
  v_result := public.prepare_program_billing_customer(p_order_id,v_revision,'acct_630platform',false);
  if v_result->>'status' <> 'prepared' then raise exception 'synthetic customer setup failed: %',v_result->>'status'; end if;
  v_revision := (v_result->>'revision')::bigint;
  if not public.bind_program_billing_customer(p_order_id,v_revision,p_customer,
    jsonb_build_object('id',p_customer,'deleted',false,'balance',0,'livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false),
      'discountId',null,'taxExempt','none',
      'metadata',jsonb_build_object('program_order_id',p_order_id,'program_billing_purpose','program_order',
        'program_platform_account_id','acct_630platform','program_livemode','false'),
      'invoiceCreditBalance',jsonb_build_object('usd',0)),repeat('2',64)) then
    raise exception 'synthetic customer binding failed';
  end if;
  v_revision := v_revision + 1;
  v_result := public.prepare_program_checkout_attempt(p_order_id,v_revision,
    'https://gymx2.test/programs/success','https://gymx2.test/programs/cancel');
  if v_result->>'status' <> 'prepared' then raise exception 'synthetic Checkout setup failed: %',v_result->>'status'; end if;
  v_attempt_id := (v_result->>'attempt_id')::uuid;
  v_revision := (v_result->>'revision')::bigint;
  if p_mode='unknown' then
    if not public.mark_program_checkout_create_unknown(p_order_id,1::smallint) then
      raise exception 'synthetic unknown Checkout observation failed';
    end if;
    return v_attempt_id;
  end if;

  v_amount := p_amount;
  v_fee := round(v_amount * 1000 / 10000.0)::integer;
  v_evidence := jsonb_build_object(
    'id',p_checkout,'livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false),
    'customer_id',p_customer,'client_reference_id',v_attempt_id,'payment_intent_id',p_payment_intent,
    'mode','payment','currency','usd','amount_total',v_amount,
    'status',case when p_mode='paid' then 'complete' else 'expired' end,
    'payment_status',case when p_mode='paid' then 'paid' else 'unpaid' end,
    'metadata',jsonb_build_object('program_order_id',p_order_id,'program_checkout_attempt_id',v_attempt_id,
      'program_checkout_attempt_number','1','program_installment_number','1','program_billing_kind','program_sale',
      'program_platform_account_id','acct_630platform','program_livemode','false'),
    'payment_intent',case when p_mode='paid' then jsonb_build_object(
      'id',p_payment_intent,'customer_id',p_customer,'status','succeeded','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false),
      'amount',v_amount,'currency','usd','application_fee_amount',v_fee,'transfer_destination_id',p_connected_account,
      'metadata',jsonb_build_object('program_order_id',p_order_id,'program_checkout_attempt_id',v_attempt_id,
        'program_checkout_attempt_number','1','program_installment_number','1','program_billing_kind','program_sale',
        'program_platform_account_id','acct_630platform','program_livemode','false')) else null end
  );
  if not public.bind_program_billing_checkout_session(p_order_id,v_revision,1::smallint,p_checkout,p_payment_intent,
    v_evidence,repeat('3',64)) then raise exception 'synthetic Checkout binding failed for mode %',p_mode; end if;
  return v_attempt_id;
end;
$fixture$;

create function pg_temp.purchase_history_paid_cancel_inventory() returns jsonb language sql as $$
  select jsonb_build_object(
    'completeInventory',true,'orderId',current_setting('test.ph_paid_order'),
    'customerId','cus_630settled','customer',jsonb_build_object('id','cus_630settled','deleted',false,'balance',0,
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false),
      'discountId',null,'taxExempt','none',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.ph_paid_order'),
        'program_billing_purpose','program_order','program_platform_account_id','acct_630platform','program_livemode','false'),
      'invoiceCreditBalance',jsonb_build_object('usd',0)),
    'pendingInvoiceItemCount',0,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb,
    'sessions',jsonb_build_array(jsonb_build_object('id','cs_630settled','customerId','cus_630settled',
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false),
      'paymentIntentId','pi_630settled','status','complete','paymentStatus','paid',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.ph_paid_order'),
        'program_checkout_attempt_id',current_setting('test.ph_paid_attempt_id'),
        'program_platform_account_id','acct_630platform','program_livemode','false'))),
    'paymentIntents',jsonb_build_array(jsonb_build_object('id','pi_630settled','customerId','cus_630settled',
      'amount',1200,'amountReceived',1200,'currency','usd','applicationFeeAmount',120,
      'transferDestinationId','acct_630coach6','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false),'status','succeeded',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.ph_paid_order'),
        'program_billing_kind','program_sale',
        'program_checkout_attempt_id',current_setting('test.ph_paid_attempt_id'),
        'program_checkout_attempt_number','1','program_installment_number','1',
        'program_platform_account_id','acct_630platform','program_livemode','false'))),
    'invoices','[]'::jsonb,'deletedInvoices','[]'::jsonb)
$$;

create function pg_temp.purchase_history_two_installment_cancel_inventory() returns jsonb language sql as $$
  select jsonb_build_object(
    'completeInventory',true,'orderId',current_setting('test.ph_refund_order'),
    'customerId','cus_630refund','customer',jsonb_build_object('id','cus_630refund','deleted',false,'balance',0,
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false),
      'discountId',null,'taxExempt','none',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.ph_refund_order'),
        'program_billing_purpose','program_order','program_platform_account_id','acct_630platform','program_livemode','false'),
      'invoiceCreditBalance',jsonb_build_object('usd',0)),
    'pendingInvoiceItemCount',0,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb,
    'sessions',jsonb_build_array(jsonb_build_object('id','cs_630refund','customerId','cus_630refund',
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false),
      'paymentIntentId','pi_630refund_one','status','complete','paymentStatus','paid',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.ph_refund_order'),
        'program_checkout_attempt_id',current_setting('test.ph_refund_attempt_id'),
        'program_platform_account_id','acct_630platform','program_livemode','false'))),
    'paymentIntents',jsonb_build_array(
      jsonb_build_object('id','pi_630refund_one','customerId','cus_630refund','amount',600,'amountReceived',600,
        'currency','usd','applicationFeeAmount',60,'transferDestinationId','acct_630coach4','livemode',false,
        'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false),'status','succeeded',
        'metadata',jsonb_build_object('program_order_id',current_setting('test.ph_refund_order'),
          'program_billing_kind','program_sale','program_checkout_attempt_id',current_setting('test.ph_refund_attempt_id'),
          'program_checkout_attempt_number','1','program_installment_number','1',
          'program_platform_account_id','acct_630platform','program_livemode','false')),
      jsonb_build_object('id','pi_630refund_two','customerId','cus_630refund','amount',600,'amountReceived',600,
        'currency','usd','applicationFeeAmount',60,'transferDestinationId','acct_630coach4','livemode',false,
        'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false),'status','succeeded')),
    'deletedInvoices','[]'::jsonb,
    'invoices',jsonb_build_array(jsonb_build_object('id','in_630refund','customerId','cus_630refund',
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false),
      'currency','usd','autoAdvance',false,'billingReason','manual','status','paid',
      'amountPaid',600,'amountRemaining',0,
      'metadata',jsonb_build_object('program_order_id',current_setting('test.ph_refund_order'),
        'program_installment_number','2','program_platform_account_id','acct_630platform','program_livemode','false'),
      'lines',jsonb_build_array(jsonb_build_object('invoiceItemId','ii_630refund','amount',600,'livemode',false,
        'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false),
        'metadata',jsonb_build_object('program_platform_account_id','acct_630platform','program_livemode','false'))))),
    'paymentIntentIds',jsonb_build_array('pi_630refund_one','pi_630refund_two'),
    'invoiceIds',jsonb_build_array('in_630refund'))
$$;

-- Two same-transaction timestamps exercise the UUID tie-breaker. A third row is
-- inserted after page one to prove the keyset never repeats its saved cursor row.
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.ph_order_one',pg_temp.make_purchase_history_order(
  '63010000-0000-4000-8000-000000000002','63030000-0000-4000-8000-000000000001',
  '63070000-0000-4000-8000-000000000001',1::smallint,'history-buyer-one-program-one')::text,true);
select set_config('test.ph_order_two',pg_temp.make_purchase_history_order(
  '63010000-0000-4000-8000-000000000002','63030000-0000-4000-8000-000000000002',
  '63070000-0000-4000-8000-000000000002',1::smallint,'history-buyer-one-program-two')::text,true);
reset role;

select is((select count(distinct orders.created_at)::integer from public.program_orders orders
  where orders.id in (current_setting('test.ph_order_one')::uuid,current_setting('test.ph_order_two')::uuid)),
  1,'cursor fixtures share a timestamp and require the UUID tie-breaker');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"63010000-0000-4000-8000-000000000002","role":"authenticated"}';
select set_config('test.ph_page_one',public.get_my_program_purchase_history(1,null,null,null)::text,true);
select is(current_setting('test.ph_page_one')::jsonb->>'status','ready','owner receives a bounded history page');
select is(jsonb_array_length(current_setting('test.ph_page_one')::jsonb->'items'),1,'page limit is enforced');
select is(current_setting('test.ph_page_one')::jsonb->>'has_more','true','first page exposes a continuation cursor');
reset role;

set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.ph_order_three',pg_temp.make_purchase_history_order(
  '63010000-0000-4000-8000-000000000002','63030000-0000-4000-8000-000000000003',
  '63070000-0000-4000-8000-000000000003',1::smallint,'history-buyer-one-program-three')::text,true);
select set_config('test.ph_refund_order',pg_temp.make_purchase_history_order(
  '63010000-0000-4000-8000-000000000002','63030000-0000-4000-8000-000000000004',
  '63070000-0000-4000-8000-000000000004',2::smallint,'history-refund-after-settlement')::text,true);

select set_config('test.ph_free_order',pg_temp.make_purchase_history_order(
  '63010000-0000-4000-8000-000000000003','63030000-0000-4000-8000-000000000005',
  '63070000-0000-4000-8000-000000000005',0::smallint,'history-free-grant','FREE100')::text,true);
select set_config('test.ph_foreign_order',pg_temp.make_purchase_history_order(
  '63010000-0000-4000-8000-000000000003','63030000-0000-4000-8000-000000000001',
  '63070000-0000-4000-8000-000000000001',1::smallint,'history-foreign-owner')::text,true);
select set_config('test.ph_lapsed_order',pg_temp.make_purchase_history_order(
  '63010000-0000-4000-8000-000000000005','63030000-0000-4000-8000-000000000001',
  '63070000-0000-4000-8000-000000000001',1::smallint,'history-lapsed-owner')::text,true);
delete from public.platform_test_entitlements where member_id='63010000-0000-4000-8000-000000000005';

-- Billing setup and cancellation use frozen producer RPCs. The sole direct
-- billing-row seed below is the legacy, historically accepted terms exception
-- needed to project a two-installment order with a real paid-and-refunded path.
select set_config('test.ph_checkout_unknown_order',pg_temp.make_purchase_history_order(
  '63010000-0000-4000-8000-000000000002','63030000-0000-4000-8000-000000000005',
  '63070000-0000-4000-8000-000000000005',1::smallint,'history-checkout-unknown')::text,true);
select set_config('test.ph_provider_paid_order',pg_temp.make_purchase_history_order(
  '63010000-0000-4000-8000-000000000004','63030000-0000-4000-8000-000000000002',
  '63070000-0000-4000-8000-000000000002',1::smallint,'history-provider-paid-no-ledger')::text,true);
select set_config('test.ph_expired_order',pg_temp.make_purchase_history_order(
  '63010000-0000-4000-8000-000000000004','63030000-0000-4000-8000-000000000003',
  '63070000-0000-4000-8000-000000000003',1::smallint,'history-expired-unpaid')::text,true);
reset role;
insert into public.program_billing_orders (
  order_id,revision,billing_state,terms_version,terms_digest,accepted_at,accepted_total_cents,
  accepted_installment_count,disclosed_charge_dates,off_session_consent,retry_window_days,
  cancellation_stops_future_charges
) values (
  current_setting('test.ph_refund_order')::uuid,1,'terms_saved',1,repeat('6',64),
  now()-interval '45 days',1200,2,array[(now() at time zone 'America/New_York')::date],true,7,true
);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.ph_unknown_attempt_id',pg_temp.prepare_purchase_history_checkout(
  current_setting('test.ph_checkout_unknown_order')::uuid,'unknown','cus_630unknown','cs_630unknown',null,
  1200,'acct_630coach5')::text,true);
select set_config('test.ph_provider_paid_attempt_id',pg_temp.prepare_purchase_history_checkout(
  current_setting('test.ph_provider_paid_order')::uuid,'paid','cus_630paid','cs_630paid','pi_630paid',
  1200,'acct_630coach2')::text,true);
select set_config('test.ph_expired_attempt_id',pg_temp.prepare_purchase_history_checkout(
  current_setting('test.ph_expired_order')::uuid,'expired','cus_630expired','cs_630expired',null,
  1200,'acct_630coach3')::text,true);
select set_config('test.ph_refund_attempt_id',pg_temp.prepare_purchase_history_checkout(
  current_setting('test.ph_refund_order')::uuid,'paid','cus_630refund','cs_630refund','pi_630refund_one',
  600,'acct_630coach4',true)::text,true);
reset role;

-- One full normal settlement followed by a verified full refund proves refund
-- state stays explicit and never becomes a settled success in the projection.
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.ph_paid_order',pg_temp.make_purchase_history_order(
  '63010000-0000-4000-8000-000000000002','63030000-0000-4000-8000-000000000006',
  '63070000-0000-4000-8000-000000000006',1::smallint,'history-paid-then-refunded')::text,true);
select set_config('test.ph_paid_attempt_id',pg_temp.prepare_purchase_history_checkout(
  current_setting('test.ph_paid_order')::uuid,'paid','cus_630settled','cs_630settled','pi_630settled',
  1200,'acct_630coach6')::text,true);
select is((public.record_program_billing_settled_payment(current_setting('test.ph_paid_order')::uuid,0::bigint,
   'evt_630_settled',1::smallint,1::smallint,'cs_630settled',null,'pi_630settled','ch_630settled',1200,0,'usd',now(),
  'pm_630settled',jsonb_build_object(
    'checkout_session',jsonb_build_object('id','cs_630settled','customer_id','cus_630settled',
       'client_reference_id',current_setting('test.ph_paid_attempt_id'),
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false),
      'mode','payment','status','complete','payment_status','paid','amount_total',1200,'currency','usd',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.ph_paid_order'),
         'program_checkout_attempt_id',current_setting('test.ph_paid_attempt_id'),
        'program_checkout_attempt_number','1','program_installment_number','1','program_billing_kind','program_sale',
        'program_platform_account_id','acct_630platform','program_livemode','false')),
    'payment_intent',jsonb_build_object('id','pi_630settled','customer_id','cus_630settled','status','succeeded',
      'amount',1200,'amount_received',1200,'currency','usd','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false),
      'application_fee_amount',120,'transfer_destination_id','acct_630coach6','payment_method_id','pm_630settled',
      'latest_charge_id','ch_630settled','metadata',jsonb_build_object('program_order_id',current_setting('test.ph_paid_order'),
        'program_billing_kind','program_sale',
         'program_checkout_attempt_id',current_setting('test.ph_paid_attempt_id'),
        'program_checkout_attempt_number','1','program_installment_number','1',
        'program_platform_account_id','acct_630platform','program_livemode','false')),
    'payment_method',jsonb_build_object('id','pm_630settled','customer_id','cus_630settled','type','card','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false))),repeat('7',64))->>'status'),
  'settled','normal billing settlement creates the paid state used by the history projection');
reset role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"63010000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((public.request_program_billing_cancellation(current_setting('test.ph_paid_order')::uuid,
  '63090000-0000-4000-8000-000000000002')->>'status'),'cancellation_requested',
  'buyer requests cancellation through the normal owner RPC after settlement');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_paid_order')::uuid)->'item'->>'cancellation_stage'),
  'requested','history shows the durable cancellation request separately');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_paid_order')::uuid)->'item'->>'payment_stage'),
  'settled','pending cancellation preserves already settled payment progress');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_paid_order')::uuid)->'item'->>'next_due_date'),
  null,'a durable cancellation request suppresses the next collection date');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_paid_order')::uuid)->'item'->>'retry_deadline'),
  null,'a durable cancellation request suppresses the stale retry deadline');
reset role;

-- The canonical buyer cancellation advances the billing revision. Read only
-- this fixture's current value as PostgreSQL test setup, then restore service role.
select set_config('test.ph_paid_billing_revision',(
  select billing.revision::text from public.program_billing_orders billing
  where billing.order_id=current_setting('test.ph_paid_order')::uuid),true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is((public.complete_program_billing_cancellation(current_setting('test.ph_paid_order')::uuid,
  current_setting('test.ph_paid_billing_revision')::bigint,
  pg_temp.purchase_history_paid_cancel_inventory(),repeat('8',64))->>'status'),
  'canceled','server cancellation reconciles the exact synthetic paid provider inventory');
reset role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"63010000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_paid_order')::uuid)->'item'->>'cancellation_stage'),
  'completed','history preserves completed cancellation as a separate stage');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_paid_order')::uuid)->'item'->>'payment_stage'),
  'settled','completed cancellation retains the one-time settled payment before refund');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_paid_order')::uuid)->'item'->>'next_due_date'),
  null,'completed cancellation has no next collection date');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_paid_order')::uuid)->'item'->>'retry_deadline'),
  null,'completed cancellation has no retry deadline');
reset role;

set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is((public.record_program_billing_refund(current_setting('test.ph_paid_order')::uuid,1::smallint,1::bigint,
  'evt_630_settled_refund','re_630_settled_refund','pi_630settled','ch_630settled',1200,
  jsonb_build_object('event_id','evt_630_settled_refund','refund_id','re_630_settled_refund',
    'payment_intent_id','pi_630settled','charge_id','ch_630settled','amount',1200),repeat('9',64))->>'status'),
  'refund_recorded_for_review_policy','authorized billing refund producer reverses the normal settled payment');
reset role;

-- Complete a canonical two-installment lifecycle from a historical accepted
-- terms row, then refund installment one only after both settlements exist.
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is((public.record_program_billing_settled_payment(current_setting('test.ph_refund_order')::uuid,0::bigint,
  'evt_630_refund_paid_one',1::smallint,1::smallint,'cs_630refund',null,'pi_630refund_one','ch_630refund_one',
  600,0,'usd',now(),'pm_630refund',jsonb_build_object(
    'checkout_session',jsonb_build_object('id','cs_630refund','customer_id','cus_630refund',
      'client_reference_id',current_setting('test.ph_refund_attempt_id'),'livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false),
      'mode','payment','status','complete','payment_status','paid','amount_total',600,'currency','usd',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.ph_refund_order'),
        'program_checkout_attempt_id',current_setting('test.ph_refund_attempt_id'),
        'program_checkout_attempt_number','1','program_installment_number','1','program_billing_kind','program_sale',
        'program_platform_account_id','acct_630platform','program_livemode','false')),
    'payment_intent',jsonb_build_object('id','pi_630refund_one','customer_id','cus_630refund','status','succeeded',
      'amount',600,'amount_received',600,'currency','usd','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false),
      'application_fee_amount',60,'transfer_destination_id','acct_630coach4','payment_method_id','pm_630refund',
      'latest_charge_id','ch_630refund_one','metadata',jsonb_build_object(
        'program_order_id',current_setting('test.ph_refund_order'),'program_billing_kind','program_sale',
        'program_checkout_attempt_id',current_setting('test.ph_refund_attempt_id'),
        'program_checkout_attempt_number','1','program_installment_number','1',
        'program_platform_account_id','acct_630platform','program_livemode','false')),
    'payment_method',jsonb_build_object('id','pm_630refund','customer_id','cus_630refund','type','card','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false))),repeat('a',64))->>'status'),
  'settled','historical first installment settles through the normal billing producer');
reset role;

-- Read only the exact synthetic fixture revision as PostgreSQL test setup; the
-- service role continues to mutate only through the canonical producer RPCs.
select set_config('test.ph_refund_billing_revision',(
  select billing.revision::text from public.program_billing_orders billing
  where billing.order_id=current_setting('test.ph_refund_order')::uuid),true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select set_config('test.ph_refund_invoice_prepare',public.prepare_program_billing_invoice(
  current_setting('test.ph_refund_order')::uuid,current_setting('test.ph_refund_billing_revision')::bigint,
  2::smallint,(now() at time zone 'America/New_York')::date)::text,true);
select is(current_setting('test.ph_refund_invoice_prepare')::jsonb->>'status','ready',
  'service producer prepares the historical second installment at its accepted date');
select set_config('test.ph_refund_billing_revision',
  current_setting('test.ph_refund_invoice_prepare')::jsonb->>'revision',true);
select ok(public.mark_program_billing_operation_unknown(current_setting('test.ph_refund_order')::uuid,
  'invoice_create',1::smallint,2::smallint,0::smallint),'second invoice creation is durably unknown before binding');
select ok(public.bind_program_billing_invoice(current_setting('test.ph_refund_order')::uuid,
  current_setting('test.ph_refund_billing_revision')::bigint,2::smallint,'in_630refund',
  jsonb_build_object('id','in_630refund','customer_id','cus_630refund','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false),
    'currency','usd','auto_advance',false,'collection_method','charge_automatically',
    'billing_reason','manual','status','draft','amount_due',0,
    'metadata',jsonb_build_object('program_order_id',current_setting('test.ph_refund_order'),
      'program_installment_number','2','program_attempt_number','1','program_billing_kind','standalone_installment',
      'program_platform_account_id','acct_630platform','program_livemode','false')),repeat('b',64)),
  'exact draft Invoice binds for the historical second installment');
select ok(public.mark_program_billing_operation_unknown(current_setting('test.ph_refund_order')::uuid,
  'invoice_item_create',1::smallint,2::smallint,0::smallint),'second invoice item is durably unknown before binding');
select ok(public.bind_program_billing_invoice_item(current_setting('test.ph_refund_order')::uuid,
  current_setting('test.ph_refund_billing_revision')::bigint,2::smallint,'ii_630refund',
  jsonb_build_object('id','ii_630refund','invoice_id','in_630refund','customer_id','cus_630refund',
    'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false),
    'amount',600,'currency','usd','quantity',1,'discountable',false,'proration',false,'subscription_id',null,
    'discounts','[]'::jsonb,'tax_rates','[]'::jsonb,'tax_amounts','[]'::jsonb,
    'metadata',jsonb_build_object('program_order_id',current_setting('test.ph_refund_order'),
      'program_installment_number','2','program_attempt_number','1','program_billing_kind','standalone_installment_line',
      'program_platform_account_id','acct_630platform','program_livemode','false')),repeat('c',64)),
  'fixed no-discount line binds to the second installment Invoice');
select ok(public.mark_program_billing_operation_unknown(current_setting('test.ph_refund_order')::uuid,
  'invoice_finalize',1::smallint,2::smallint,0::smallint),'second invoice finalization is durably unknown before binding');
select ok(public.bind_program_billing_payment_intent(current_setting('test.ph_refund_order')::uuid,
  current_setting('test.ph_refund_billing_revision')::bigint,2::smallint,'pi_630refund_two',
  jsonb_build_object('id','pi_630refund_two','customer_id','cus_630refund','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false),
    'amount',600,'amount_received',0,'status','requires_payment_method','currency','usd',
    'application_fee_amount',60,'transfer_destination_id','acct_630coach4','payment_method_id','pm_630refund',
    'invoice',jsonb_build_object('id','in_630refund','customer_id','cus_630refund','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false),
      'auto_advance',false,'billing_reason','manual','currency','usd','default_payment_method_id','pm_630refund',
      'status','open','starting_balance',0,'ending_balance',0,'amount_shipping',0,'total',600,'subtotal',600,
      'automatic_tax_enabled',false,'discounts','[]'::jsonb,'total_discount_amounts','[]'::jsonb,
      'default_tax_rates','[]'::jsonb,'total_taxes','[]'::jsonb,
      'metadata',jsonb_build_object('program_order_id',current_setting('test.ph_refund_order'),
        'program_installment_number','2','program_attempt_number','1','program_billing_kind','standalone_installment',
        'program_platform_account_id','acct_630platform','program_livemode','false')),
    'invoice_payments',jsonb_build_array(jsonb_build_object('invoice_id','in_630refund',
      'payment_intent_id','pi_630refund_two','is_default',true,'type','payment_intent','status','open',
      'currency','usd','amount_requested',600,'livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false)))),repeat('d',64)),
  'second invoice PaymentIntent binds to exact invoice, amount and seller split');
select is((public.prepare_program_invoice_pay_attempt(current_setting('test.ph_refund_order')::uuid,
  current_setting('test.ph_refund_billing_revision')::bigint,2::smallint,'in_630refund','pi_630refund_two',
  'requires_payment_method',repeat('e',64))->>'status'),'prepared',
  'normal billing producer records explicit collection attempt for installment two');
select is((public.record_program_billing_settled_payment(current_setting('test.ph_refund_order')::uuid,0::bigint,
  'evt_630_refund_paid_two',1::smallint,2::smallint,null,'in_630refund','pi_630refund_two','ch_630refund_two',
  600,0,'usd',now(),'pm_630refund',jsonb_build_object(
    'payment_intent',jsonb_build_object('id','pi_630refund_two','customer_id','cus_630refund','status','succeeded',
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false),
      'amount',600,'amount_received',600,'currency','usd','application_fee_amount',60,
      'transfer_destination_id','acct_630coach4','payment_method_id','pm_630refund','latest_charge_id','ch_630refund_two'),
    'invoice',jsonb_build_object('id','in_630refund','customer_id','cus_630refund','status','paid','auto_advance',false,
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false),
      'currency','usd','total',600,'amount_paid',600,'amount_remaining',0,'amount_overpaid',0,'amount_shipping',0,
      'starting_balance',0,'ending_balance',0,'subtotal',600,'automatic_tax_enabled',false,'discounts','[]'::jsonb,
      'total_discount_amounts','[]'::jsonb,'default_tax_rates','[]'::jsonb,'total_taxes','[]'::jsonb,'billing_reason','manual',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.ph_refund_order'),
        'program_installment_number','2','program_attempt_number','1','program_billing_kind','standalone_installment',
        'program_platform_account_id','acct_630platform','program_livemode','false')),
    'invoice_lines',jsonb_build_array(jsonb_build_object('invoice_item_id','ii_630refund','invoice_id','in_630refund',
      'amount',600,'currency','usd','discountable',false,'quantity',1,'proration',false,'subscription_id',null,
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false),
      'discounts','[]'::jsonb,'tax_rates','[]'::jsonb,'tax_amounts','[]'::jsonb,
      'metadata',jsonb_build_object('program_order_id',current_setting('test.ph_refund_order'),
        'program_installment_number','2','program_attempt_number','1','program_billing_kind','standalone_installment_line',
        'program_platform_account_id','acct_630platform','program_livemode','false'))),
    'invoice_payments',jsonb_build_array(jsonb_build_object('invoice_id','in_630refund',
      'payment_intent_id','pi_630refund_two','is_default',true,'type','payment_intent','status','paid',
      'currency','usd','amount_requested',600,'amount_paid',600,'livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false))),
    'payment_method',jsonb_build_object('id','pm_630refund','customer_id','cus_630refund','type','card','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_630platform','livemode',false))),repeat('f',64))->>'status'),
  'settled','canonical second installment settlement completes the two-installment schedule');
reset role;

select ok((select billing.next_anchor_date is not null and exists (
  select 1 from public.program_billing_installment_invoices invoice
  where invoice.order_id=billing.order_id and invoice.installment_number=2 and invoice.retry_deadline is not null)
  from public.program_billing_orders billing where billing.order_id=current_setting('test.ph_refund_order')::uuid),
  'the synthetic settled fixture retains historical stored schedule fields for the read projection to suppress');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"63010000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_refund_order')::uuid)->'item'->>'payment_stage'),
  'settled','fully settled two-installment order remains a settled history stage');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_refund_order')::uuid)->'item'->>'cleared_installments'),
  '2','both canonically settled installments form the full contiguous prefix');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_refund_order')::uuid)->'item'->>'safety_stage'),
  'clear','fully settled historical schedule has no safety conflict');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_refund_order')::uuid)->'item'->>'next_due_date'),
  null,'fully settled billing order suppresses its stale stored next due date');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_refund_order')::uuid)->'item'->>'retry_deadline'),
  null,'fully settled billing order suppresses its stale invoice retry deadline');
reset role;

set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is((public.record_program_billing_refund(current_setting('test.ph_refund_order')::uuid,1::smallint,1::bigint,
  'evt_630_refund_first','re_630_refund_first','pi_630refund_one','ch_630refund_one',600,
  jsonb_build_object('event_id','evt_630_refund_first','refund_id','re_630_refund_first',
    'payment_intent_id','pi_630refund_one','charge_id','ch_630refund_one','amount',600),repeat('0',64))->>'status'),
  'refund_recorded_for_review_policy','canonical refund producer partially refunds the first paid installment');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"63010000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_refund_order')::uuid)->'item'->>'payment_stage'),
  'partially_refunded','the verified first-installment refund is distinct from full settlement');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_refund_order')::uuid)->'item'->>'cleared_installments'),
  '0','refunding installment one breaks the contiguous net-settled prefix at its start');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_refund_order')::uuid)->'item'->>'safety_stage'),
  'clear','canonical partial refund remains a safe explicit payment stage');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_refund_order')::uuid)->'item'->>'next_due_date'),
  null,'a refund after settled billing does not resurrect the prior next due date');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_refund_order')::uuid)->'item'->>'retry_deadline'),
  null,'a refund after settled billing does not resurrect the prior retry deadline');
reset role;

select ok((select billing.next_anchor_date is not null and exists (
  select 1 from public.program_billing_installment_invoices invoice
  where invoice.order_id=billing.order_id and invoice.installment_number=2 and invoice.retry_deadline is not null)
  from public.program_billing_orders billing where billing.order_id=current_setting('test.ph_refund_order')::uuid),
  'before cancellation, the refunded order still has stored next-anchor and invoice retry fields');
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"63010000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((public.request_program_billing_cancellation(current_setting('test.ph_refund_order')::uuid,
  '63090000-0000-4000-8000-000000000004')->>'status'),'cancellation_requested',
  'buyer cancellation uses the normal owner RPC for the historical two-installment order');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_refund_order')::uuid)->'item'->>'cancellation_stage'),
  'requested','history shows the requested cancellation separately from the partial refund');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_refund_order')::uuid)->'item'->>'payment_stage'),
  'partially_refunded','requesting cancellation preserves the verified partial-refund stage');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_refund_order')::uuid)->'item'->>'next_due_date'),
  null,'requested cancellation hides the previously stored next-anchor date');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_refund_order')::uuid)->'item'->>'retry_deadline'),
  null,'requested cancellation hides the previously stored invoice retry deadline');
reset role;

-- This exact fixture revision read is PostgreSQL test setup after the normal
-- buyer cancellation RPC; subsequent cancellation completion uses service RPC.
select set_config('test.ph_refund_cancel_revision',(
  select billing.revision::text from public.program_billing_orders billing
  where billing.order_id=current_setting('test.ph_refund_order')::uuid),true);
set local role service_role;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
select is((public.complete_program_billing_cancellation(current_setting('test.ph_refund_order')::uuid,
  current_setting('test.ph_refund_cancel_revision')::bigint,
  pg_temp.purchase_history_two_installment_cancel_inventory(),repeat('1',64))->>'status'),'canceled',
  'server cancellation reconciles the exact paid Checkout, both PaymentIntents, and paid second invoice');
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"63010000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_refund_order')::uuid)->'item'->>'cancellation_stage'),
  'completed','history shows completed cancellation after canonical reconciliation');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_refund_order')::uuid)->'item'->>'payment_stage'),
  'partially_refunded','completed cancellation preserves the partial refund status');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_refund_order')::uuid)->'item'->>'next_due_date'),
  null,'completed cancellation hides the previously stored next-anchor date');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_refund_order')::uuid)->'item'->>'retry_deadline'),
  null,'completed cancellation hides the previously stored invoice retry deadline');
reset role;

-- A newer offer and unpublished title never replace immutable order economics
-- or leak a draft title through the generic private history label.
insert into public.program_offer_versions(
  id,program_id,offer_number,content_version_id,offer_kind,list_price_cents,currency,max_installments,
  platform_owned,seller_profile_id,connected_account_id,created_by
) values ('63070000-0000-4000-8000-000000000007','63030000-0000-4000-8000-000000000001',3,
  '63060000-0000-4000-8000-000000000001','paid',2600,'usd',3,false,
  '63010000-0000-4000-8000-000000000001','acct_630coach7','63010000-0000-4000-8000-000000000001');
update public.program_commerce_state set current_offer_version_id='63070000-0000-4000-8000-000000000007'
where program_id='63030000-0000-4000-8000-000000000001';
update public.programs set title='Unpublished private edit must not appear',published=false
where id='63030000-0000-4000-8000-000000000001';

-- Permission, validation, owner isolation, keyset behavior and normalized DTO.
select ok(has_function_privilege('authenticated','public.get_my_program_purchase_history(integer,timestamptz,uuid,uuid)','execute')
  and has_function_privilege('authenticated','public.get_my_program_purchase_history_detail(uuid)','execute')
  and not has_function_privilege('anon','public.get_my_program_purchase_history(integer,timestamptz,uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.get_my_program_purchase_history(integer,timestamptz,uuid,uuid)','execute'),
  'list and detail execute only as authenticated buyers');
select ok(not has_table_privilege('authenticated','public.program_orders','select')
  and not has_table_privilege('authenticated','public.program_billing_orders','select')
  and not has_table_privilege('authenticated','public.program_order_installments','select'),
  'history RPCs do not grant direct table access');

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"63010000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((public.get_my_program_purchase_history(50,null,null,null)->>'status'),'ready','owner history returns a ready page');
select ok(not exists (
  select 1 from jsonb_array_elements(public.get_my_program_purchase_history(50,null,null,null)->'items') item
  where item->>'order_id'=current_setting('test.ph_foreign_order')),
  'another buyer order never appears in the caller list');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_foreign_order')::uuid)->>'status'),
  'not_found','foreign detail is indistinguishable from a missing order');
select is((public.get_my_program_purchase_history_detail('630a0000-0000-4000-8000-000000000099'::uuid)->>'status'),
  'not_found','unknown detail is not disclosed');
select is((public.get_my_program_purchase_history(0,null,null,null)->>'status'),'invalid_request','zero page size is rejected');
select is((public.get_my_program_purchase_history(51,null,null,null)->>'status'),'invalid_request','page size above fifty is rejected');
select is((public.get_my_program_purchase_history(10,now(),null,null)->>'status'),'invalid_request',
  'cursor timestamp and order ID must be supplied together');
select set_config('test.ph_page_two',public.get_my_program_purchase_history(
  50,(current_setting('test.ph_page_one')::jsonb->'next_cursor'->>'created_at')::timestamptz,
  (current_setting('test.ph_page_one')::jsonb->'next_cursor'->>'order_id')::uuid,null)::text,true);
select ok(not exists (
  select 1 from jsonb_array_elements(current_setting('test.ph_page_two')::jsonb->'items') item
  where item->>'order_id'=(current_setting('test.ph_page_one')::jsonb->'items'->0->>'order_id')),
  'page two does not repeat the prior cursor row after an intervening insert');
select ok(not exists (
  select 1 from jsonb_array_elements(current_setting('test.ph_page_two')::jsonb->'items') item
  where ((item->>'created_at')::timestamptz,(item->>'order_id')::uuid) >=
    ((current_setting('test.ph_page_one')::jsonb->'next_cursor'->>'created_at')::timestamptz,
     (current_setting('test.ph_page_one')::jsonb->'next_cursor'->>'order_id')::uuid)),
  'page two contains only keys strictly below its cursor');
select is(jsonb_array_length(public.get_my_program_purchase_history(50,null,null,
  '63030000-0000-4000-8000-000000000002'::uuid)->'items'),1,
  'optional Program filter selects only the buyer order for that Program');
select ok((select item->>'program_label'='Program'
    and item->>'effective_total_cents'='1200'
    and not (item ? 'title') and not (item ? 'offer_version_id')
    and item - array['order_id','program_id','program_label','created_at','currency','list_price_cents',
      'discount_cents','effective_total_cents','payment_plan','installment_count','installment_amounts_cents',
      'cleared_installments','payment_stage','cancellation_stage','safety_stage','checkout_retry_hint',
      'next_due_date','retry_deadline','has_recorded_refund']::text[] = '{}'::jsonb
  from jsonb_array_elements(public.get_my_program_purchase_history(50,null,null,null)->'items') item
  where item->>'order_id'=current_setting('test.ph_order_one')),
  'DTO uses immutable purchase economics, generic label and a closed field whitelist');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_refund_order')::uuid)->'item'->>'cleared_installments'),
  '0','refund of the first installment breaks the fully settled prefix at installment one');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_refund_order')::uuid)->'item'->>'safety_stage'),
  'clear','historically accepted terms and canonical settlement/refund facts remain consistent');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_refund_order')::uuid)->'item'->>'has_recorded_refund'),
  'true','refund status comes from the canonical billing refund producer');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_refund_order')::uuid)->'item'->>'payment_stage'),
  'partially_refunded','partial normal refund is explicit and never reported as settled');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_order_three')::uuid)->'item'->>'safety_stage'),
  'unknown','positive legacy order without accepted billing terms stays conservative');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_checkout_unknown_order')::uuid)->'item'->>'payment_stage'),
  'checkout_pending','durable unknown Checkout remains pending without exposing provider state');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_paid_order')::uuid)->'item'->>'cancellation_stage'),
  'completed','completed cancellation remains distinct from the requested paid cancellation');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_paid_order')::uuid)->'item'->>'payment_stage'),
  'refunded','a fully refunded paid order is not reported settled');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_paid_order')::uuid)->'item'->>'cleared_installments'),
  '0','full refund removes its installment from the canonical net-settled prefix');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_paid_order')::uuid)->'item'->>'safety_stage'),
  'clear','a verified normal refund is represented without treating the canonical state transition as corruption');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_order_one')::uuid)->'item'->>'program_label'),
  'Program','history never exposes a subsequently unpublished Program title');
select ok(not ((public.get_my_program_purchase_history_detail(current_setting('test.ph_order_one')::uuid)->'item') ? 'title')
  and (public.get_my_program_purchase_history_detail(current_setting('test.ph_order_one')::uuid)->'item'->>'list_price_cents')='1200',
  'unpublished title and newer offer price do not replace the original purchase snapshot');
reset role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"63010000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_free_order')::uuid)->'item'->>'payment_stage'),
  'free_grant','actual free-order owner sees the one hundred percent no-billing grant stage');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_free_order')::uuid)->'item'->>'safety_stage'),
  'clear','actual free-order owner sees a validated grant without a billing row');
reset role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"63010000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_provider_paid_order')::uuid)->'item'->>'payment_stage'),
  'payment_pending','actual provider-paid order owner sees pending without a settled ledger');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_expired_order')::uuid)->'item'->>'payment_stage'),
  'checkout_retryable','actual expired-unpaid order owner sees the persisted retry stage');
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_expired_order')::uuid)->'item'->>'checkout_retry_hint'),
  'true','actual expired-unpaid order owner sees its stored attempt hint');
reset role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"sub":"63010000-0000-4000-8000-000000000005","role":"authenticated"}';
select is((public.get_my_program_purchase_history_detail(current_setting('test.ph_lapsed_order')::uuid)->>'status'),'ready',
  'history remains available after the buyer membership entitlement lapses');
reset role;

set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"role":"authenticated"}';
select is((public.get_my_program_purchase_history(10,null,null,null)->>'status'),'auth_required',
  'authenticated database role without auth.uid receives no owner data');
reset role;
set local role anon;
set local request.jwt.claim.role='anon';
set local request.jwt.claims='{"role":"anon"}';
select throws_ok($$select public.get_my_program_purchase_history(10,null,null,null)$$,'42501',null,
  'anonymous database role cannot execute owner history');
reset role;

select * from finish();
rollback;
