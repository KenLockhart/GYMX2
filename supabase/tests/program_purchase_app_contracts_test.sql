begin;
select no_plan();

-- Local synthetic identities and text-only Program fixtures. No provider or Auth HTTP calls occur.
insert into auth.users(id,email,raw_user_meta_data) values
  ('62010000-0000-4000-8000-000000000001','purchase-coach@example.test','{"display_name":"Purchase Coach"}'),
  ('62010000-0000-4000-8000-000000000002','purchase-buyer-1@example.test','{"display_name":"Purchase Buyer 1"}'),
  ('62010000-0000-4000-8000-000000000003','purchase-buyer-2@example.test','{"display_name":"Purchase Buyer 2"}'),
  ('62010000-0000-4000-8000-000000000004','purchase-buyer-3@example.test','{"display_name":"Purchase Buyer 3"}'),
  ('62010000-0000-4000-8000-000000000005','purchase-unlinked@example.test','{"display_name":"Purchase Unlinked Buyer"}'),
  ('62010000-0000-4000-8000-000000000006','purchase-no-tier@example.test','{"display_name":"Purchase No Tier"}'),
  ('62010000-0000-4000-8000-000000000007','purchase-rollback@example.test','{"display_name":"Purchase Rollback Buyer"}'),
  ('62010000-0000-4000-8000-000000000008','purchase-installment@example.test','{"display_name":"Purchase Installment Buyer"}');
update public.profiles set role='coach' where id='62010000-0000-4000-8000-000000000001';
update public.profiles set role='member' where id in (
  '62010000-0000-4000-8000-000000000002','62010000-0000-4000-8000-000000000003',
  '62010000-0000-4000-8000-000000000004','62010000-0000-4000-8000-000000000005',
  '62010000-0000-4000-8000-000000000006','62010000-0000-4000-8000-000000000007',
  '62010000-0000-4000-8000-000000000008');
insert into public.platform_test_entitlements(member_id,tier,grant_reason,granted_by) values
  ('62010000-0000-4000-8000-000000000002','regular','Synthetic purchase contracts TAP','62010000-0000-4000-8000-000000000001'),
  ('62010000-0000-4000-8000-000000000003','regular','Synthetic purchase contracts TAP','62010000-0000-4000-8000-000000000001'),
  ('62010000-0000-4000-8000-000000000004','regular','Synthetic purchase contracts TAP','62010000-0000-4000-8000-000000000001'),
  ('62010000-0000-4000-8000-000000000005','regular','Synthetic purchase contracts TAP','62010000-0000-4000-8000-000000000001'),
  ('62010000-0000-4000-8000-000000000007','regular','Synthetic purchase contracts TAP','62010000-0000-4000-8000-000000000001'),
  ('62010000-0000-4000-8000-000000000008','regular','Synthetic purchase contracts TAP','62010000-0000-4000-8000-000000000001');
insert into public.coach_members(coach_id,member_id) values
  ('62010000-0000-4000-8000-000000000001','62010000-0000-4000-8000-000000000002'),
  ('62010000-0000-4000-8000-000000000001','62010000-0000-4000-8000-000000000003'),
  ('62010000-0000-4000-8000-000000000001','62010000-0000-4000-8000-000000000004'),
  ('62010000-0000-4000-8000-000000000001','62010000-0000-4000-8000-000000000007'),
  ('62010000-0000-4000-8000-000000000001','62010000-0000-4000-8000-000000000008');

insert into public.programs(id,coach_id,title,description,published)
values('62030000-0000-4000-8000-000000000001','62010000-0000-4000-8000-000000000001','Purchase contracts fixture','',true);
insert into public.program_content_versions(id,program_id,revision_number,revision_kind,lesson_count,created_by)
values('62060000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001',2,'paid',3,
  '62010000-0000-4000-8000-000000000001');
insert into public.program_content_version_lessons(
  program_id,content_version_id,lesson_ordinal,timeline_day_number,title,instructions,pillar
) values
  ('62030000-0000-4000-8000-000000000001','62060000-0000-4000-8000-000000000001',1,1,'Text lesson 1','','body'),
  ('62030000-0000-4000-8000-000000000001','62060000-0000-4000-8000-000000000001',2,2,'Text lesson 2','','mind'),
  ('62030000-0000-4000-8000-000000000001','62060000-0000-4000-8000-000000000001',3,3,'Text lesson 3','','spirit');
insert into public.program_offer_versions(
  id,program_id,offer_number,content_version_id,offer_kind,list_price_cents,currency,max_installments,
  platform_owned,seller_profile_id,connected_account_id,created_by
) values(
  '62070000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001',2,
  '62060000-0000-4000-8000-000000000001','paid',1200,'usd',3,false,
  '62010000-0000-4000-8000-000000000001','acct_purchasecoach1','62010000-0000-4000-8000-000000000001');
update public.program_commerce_state set
  current_content_version_id='62060000-0000-4000-8000-000000000001',
  current_offer_version_id='62070000-0000-4000-8000-000000000001'
where program_id='62030000-0000-4000-8000-000000000001';
insert into public.program_promotions(
  id,program_id,offer_version_id,code,discount_kind,discount_value,max_redemptions,created_by
) values
  ('62080000-0000-4000-8000-000000000001','62030000-0000-4000-8000-000000000001',
   '62070000-0000-4000-8000-000000000001','ONEUSE','fixed',200,1,'62010000-0000-4000-8000-000000000001'),
  ('62080000-0000-4000-8000-000000000002','62030000-0000-4000-8000-000000000001',
   '62070000-0000-4000-8000-000000000001','FREE100','percent',10000,10,'62010000-0000-4000-8000-000000000001'),
  ('62080000-0000-4000-8000-000000000003','62030000-0000-4000-8000-000000000001',
   '62070000-0000-4000-8000-000000000001','ROLLBACK','fixed',200,1,'62010000-0000-4000-8000-000000000001'),
  ('62080000-0000-4000-8000-000000000004','62030000-0000-4000-8000-000000000001',
   '62070000-0000-4000-8000-000000000001','ONECENT','fixed',1199,10,'62010000-0000-4000-8000-000000000001'),
  ('62080000-0000-4000-8000-000000000005','62030000-0000-4000-8000-000000000001',
   '62070000-0000-4000-8000-000000000001','FORTYNINE','fixed',1151,10,'62010000-0000-4000-8000-000000000001'),
  ('62080000-0000-4000-8000-000000000006','62030000-0000-4000-8000-000000000001',
   '62070000-0000-4000-8000-000000000001','FIFTY','fixed',1150,10,'62010000-0000-4000-8000-000000000001');

create function pg_temp.purchase_dates(p_value jsonb)
returns date[] language sql as $$
  select coalesce(array_agg(item.value::date order by item.ordinality),'{}'::date[])
  from jsonb_array_elements_text(p_value) with ordinality as item(value,ordinality)
$$;

select ok(has_function_privilege('authenticated','public.get_my_program_purchase_quote(uuid,smallint,text)','execute')
  and not has_function_privilege('anon','public.get_my_program_purchase_quote(uuid,smallint,text)','execute')
  and not has_function_privilege('service_role','public.get_my_program_purchase_quote(uuid,smallint,text)','execute'),
  'quote is callable only through the authenticated buyer identity');
select ok(has_function_privilege('authenticated','public.get_my_program_purchase_request(uuid)','execute')
  and has_function_privilege('authenticated','public.get_my_program_purchase_context(uuid)','execute')
  and not has_function_privilege('anon','public.get_my_program_purchase_context(uuid)','execute'),
  'purchase recovery and context are buyer-authenticated reads');
select ok(has_function_privilege('service_role','public.confirm_program_purchase(uuid,uuid,uuid,smallint,uuid,text,text,date[],boolean,boolean)','execute')
  and not has_function_privilege('authenticated','public.confirm_program_purchase(uuid,uuid,uuid,smallint,uuid,text,text,date[],boolean,boolean)','execute')
  and not has_function_privilege('anon','public.confirm_program_purchase(uuid,uuid,uuid,smallint,uuid,text,text,date[],boolean,boolean)','execute'),
  'atomic confirmation is available only to the trusted server role');
select ok(not has_function_privilege('service_role','private.program_purchase_charge_dates(date,smallint)','execute')
  and not has_function_privilege('authenticated','private.program_purchase_quote_payload(uuid,uuid,uuid,smallint,text,integer,integer,integer,text,smallint,integer[],smallint,text,date,date[])','execute'),
  'internal quote and calendar helpers have no app-role execute grant');
select ok(not has_table_privilege('authenticated','public.program_orders','select')
  and not has_table_privilege('authenticated','public.program_promotion_reservations','select')
  and not has_table_privilege('service_role','public.program_billing_orders','select'),
  'the new app contracts do not grant direct order, promo or billing table access');

select is(private.program_purchase_charge_dates('2027-01-29',3::smallint),array['2027-02-28'::date,'2027-03-31'::date],
  'Jan 29 anchors February to month end and subsequent charges stay at month end');
select is(private.program_purchase_charge_dates('2027-01-30',3::smallint),array['2027-02-28'::date,'2027-03-31'::date],
  'Jan 30 clamps to Feb 28 and then follows the end-of-month anchor');
select is(private.program_purchase_charge_dates('2027-01-31',3::smallint),array['2027-02-28'::date,'2027-03-31'::date],
  'Jan 31 uses the frozen month-end schedule');
select is(private.program_purchase_charge_dates('2028-01-29',3::smallint),array['2028-02-29'::date,'2028-03-31'::date],
  'leap-year February month-end remains the anchor');
select is(private.program_purchase_charge_dates('2027-01-31',1::smallint),'{}'::date[],
  'pay-in-full has no future installment dates');

-- Authenticated quotes bind the caller, offer, normalized promotion and complete price math.
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"62010000-0000-4000-8000-000000000002","role":"authenticated"}';
select set_config('test.purchase.b1_promo_quote',public.get_my_program_purchase_quote(
  '62030000-0000-4000-8000-000000000001',1::smallint,' oneuse ')::text,true);
select is(current_setting('test.purchase.b1_promo_quote')::jsonb->>'status','ready',
  'linked Regular buyer receives a current paid offer quote');
select is(current_setting('test.purchase.b1_promo_quote')::jsonb->>'promotion_code','ONEUSE',
  'quote normalizes the promotion code');
select is(current_setting('test.purchase.b1_promo_quote')::jsonb->>'effective_total_cents','1000',
  'fixed promotion discount is derived from the immutable offer');
select is(current_setting('test.purchase.b1_promo_quote')::jsonb->>'payment_plan','pay_in_full',
  'one installment selects pay-in-full');
select is(current_setting('test.purchase.b1_promo_quote')::jsonb->'installment_amounts_cents','[1000]'::jsonb,
  'quote returns the server-computed single charge amount');
select set_config('test.purchase.b1_installment_quote',public.get_my_program_purchase_quote(
  '62030000-0000-4000-8000-000000000001',3::smallint,'ONEUSE')::text,true);
select is(current_setting('test.purchase.b1_installment_quote')::jsonb->'installment_amounts_cents','[333,333,334]'::jsonb,
  'three-installment quote preserves the last-payment remainder');
select is(jsonb_array_length(current_setting('test.purchase.b1_installment_quote')::jsonb->'charge_dates'),2,
  'installment quote carries each future New York calendar payment date');
select ok((current_setting('test.purchase.b1_installment_quote')::jsonb->>'quote_digest') ~ '^[0-9a-f]{64}$',
  'quote supplies an opaque canonical digest for the consent screen');

set local request.jwt.claims = '{"sub":"62010000-0000-4000-8000-000000000008","role":"authenticated"}';
select is(public.get_my_program_purchase_quote('62030000-0000-4000-8000-000000000001',1::smallint,'ONECENT')->>'status',
  'charge_below_minimum','one-cent positive total is not quoted as pay-in-full');
select is(public.get_my_program_purchase_quote('62030000-0000-4000-8000-000000000001',1::smallint,'FORTYNINE')->>'status',
  'charge_below_minimum','forty-nine-cent positive total is not quoted as pay-in-full');
select set_config('test.purchase.b8_fifty_cent_quote',public.get_my_program_purchase_quote(
  '62030000-0000-4000-8000-000000000001',1::smallint,'FIFTY')::text,true);
select is(current_setting('test.purchase.b8_fifty_cent_quote')::jsonb->>'status','ready',
  'fifty cents is the minimum accepted pay-in-full total');
select is(current_setting('test.purchase.b8_fifty_cent_quote')::jsonb->'installment_amounts_cents','[50]'::jsonb,
  'minimum total is disclosed as its exact single charge');
select set_config('test.purchase.b2_stale_promo_quote',public.get_my_program_purchase_quote(
  '62030000-0000-4000-8000-000000000001',3::smallint,'ONEUSE')::text,true);
select is(current_setting('test.purchase.b2_stale_promo_quote')::jsonb->>'status','ready',
  'quote reads promotion capacity without reserving a redemption');
set local request.jwt.claims = '{"sub":"62010000-0000-4000-8000-000000000003","role":"authenticated"}';
select set_config('test.purchase.b2_free_quote',public.get_my_program_purchase_quote(
  '62030000-0000-4000-8000-000000000001',0::smallint,'FREE100')::text,true);
select is(current_setting('test.purchase.b2_free_quote')::jsonb->>'payment_plan','free',
  'one hundred percent promotion is quoted as a zero-total grant');
select is(current_setting('test.purchase.b2_free_quote')::jsonb->'installment_amounts_cents','[]'::jsonb,
  'zero-total grant does not disclose a charge');
set local request.jwt.claims = '{"sub":"62010000-0000-4000-8000-000000000005","role":"authenticated"}';
select is(public.get_my_program_purchase_quote('62030000-0000-4000-8000-000000000001',1::smallint,null)->>'status',
  'buyer_ineligible','a signed-in Regular buyer without the Program coach link cannot receive a quote');
set local request.jwt.claims = '{"sub":"62010000-0000-4000-8000-000000000006","role":"authenticated"}';
select is(public.get_my_program_purchase_quote('62030000-0000-4000-8000-000000000001',1::smallint,null)->>'status',
  'buyer_ineligible','a linked-role member without an active Regular tier cannot receive a quote');
set local request.jwt.claims = '{"sub":"62010000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(public.get_my_program_purchase_quote('62030000-0000-4000-8000-000000000001',1::smallint,'MISSING')->>'status',
  'promotion_unavailable','unknown promotion codes do not reveal or reserve capacity');
reset role;

set local role anon;
set local request.jwt.claim.role = 'anon';
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.get_my_program_purchase_quote(
  '62030000-0000-4000-8000-000000000001',1::smallint,null)$$,
  '42501',null,'anonymous callers cannot read purchase quotes');
reset role;

-- The existing reservation primitive can be used to exercise the safe pre-consent owner context.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('test.purchase.preterms_order',public.create_program_order_reservation(
  '62010000-0000-4000-8000-000000000004','62030000-0000-4000-8000-000000000001',
  '62070000-0000-4000-8000-000000000001',1::smallint,'620a0000-0000-4000-8000-000000000004',null
)::text,true);
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"62010000-0000-4000-8000-000000000004","role":"authenticated"}';
select set_config('test.purchase.preterms_context',public.get_my_program_purchase_context(
  current_setting('test.purchase.preterms_order')::uuid)::text,true);
select is(current_setting('test.purchase.preterms_context')::jsonb->>'billing_revision','0',
  'owner can safely recover immutable order economics before terms are accepted');
select is(current_setting('test.purchase.preterms_context')::jsonb->'terms','null'::jsonb,
  'pre-consent context has no fabricated billing terms');
select set_config('test.purchase.preterms_request',public.get_my_program_purchase_request(
  '620a0000-0000-4000-8000-000000000004')::text,true);
select is(current_setting('test.purchase.preterms_request')::jsonb->>'status','found',
  'request recovery is keyed by the exact owner UUID and stored idempotency key');
reset role;

-- Confirmation consumes the same quote and request key in one transaction.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('test.purchase.b1_confirm',public.confirm_program_purchase(
  '62010000-0000-4000-8000-000000000002','62030000-0000-4000-8000-000000000001',
  (current_setting('test.purchase.b1_promo_quote')::jsonb->>'offer_version_id')::uuid,
  1::smallint,'620a0000-0000-4000-8000-000000000001','ONEUSE',
  current_setting('test.purchase.b1_promo_quote')::jsonb->>'quote_digest',
  pg_temp.purchase_dates(current_setting('test.purchase.b1_promo_quote')::jsonb->'charge_dates'),true,false
)::text,true);
select is(current_setting('test.purchase.b1_confirm')::jsonb->>'status','confirmed',
  'confirmation creates the order and accepted terms through one atomic server RPC');
select set_config('test.purchase.b1_order',current_setting('test.purchase.b1_confirm')::jsonb->>'order_id',true);
reset role;
select is((select count(*)::integer from public.program_orders order_row
  where order_row.id=current_setting('test.purchase.b1_order')::uuid),1,
  'the consent confirmation owns exactly one immutable order');
select is((select revision::integer from public.program_billing_orders billing
  where billing.order_id=current_setting('test.purchase.b1_order')::uuid),1,
  'the same transaction saved the first immutable billing terms revision');
select is((select count(*)::integer from public.program_promotion_reservations reservation
  where reservation.promotion_id='62080000-0000-4000-8000-000000000001'
    and reservation.order_id=current_setting('test.purchase.b1_order')::uuid and reservation.state='reserved'),1,
  'the fixed promotion reservation is linked to the confirmed order');
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"62010000-0000-4000-8000-000000000002","role":"authenticated"}';
select set_config('test.purchase.b1_saved_context',public.get_my_program_purchase_context(
  current_setting('test.purchase.b1_order')::uuid)::text,true);
select is(current_setting('test.purchase.b1_saved_context')::jsonb->>'billing_revision','1',
  'owned context returns the accepted billing revision');
select ok(not (current_setting('test.purchase.b1_saved_context')::jsonb ? 'stripe_customer_id')
  and not (current_setting('test.purchase.b1_saved_context')::jsonb ? 'payment_intent_id')
  and not (current_setting('test.purchase.b1_saved_context')::jsonb ? 'checkout_url'),
  'owner context discloses saved economics and terms without provider identifiers or URLs');
reset role;

-- A previously read promotion quote is advisory: final locked reservation rejects a consumed quota.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is((public.confirm_program_purchase(
  '62010000-0000-4000-8000-000000000008','62030000-0000-4000-8000-000000000001',
  (current_setting('test.purchase.b2_stale_promo_quote')::jsonb->>'offer_version_id')::uuid,
  3::smallint,'620a0000-0000-4000-8000-000000000003','ONEUSE',
  current_setting('test.purchase.b2_stale_promo_quote')::jsonb->>'quote_digest',
  pg_temp.purchase_dates(current_setting('test.purchase.b2_stale_promo_quote')::jsonb->'charge_dates'),false,true
)->>'status'),'consent_required','missing billing consent is rejected before any order or promotion reservation');
select is((public.confirm_program_purchase(
  '62010000-0000-4000-8000-000000000008','62030000-0000-4000-8000-000000000001',
  (current_setting('test.purchase.b2_stale_promo_quote')::jsonb->>'offer_version_id')::uuid,
  3::smallint,'620a0000-0000-4000-8000-000000000003','ONEUSE',
  current_setting('test.purchase.b2_stale_promo_quote')::jsonb->>'quote_digest',
  pg_temp.purchase_dates(current_setting('test.purchase.b2_stale_promo_quote')::jsonb->'charge_dates'),true,false
)->>'status'),'off_session_consent_required','installment confirmation cannot proceed without off-session consent');
select throws_ok($$select public.confirm_program_purchase(
  '62010000-0000-4000-8000-000000000008','62030000-0000-4000-8000-000000000001',
  (current_setting('test.purchase.b2_stale_promo_quote')::jsonb->>'offer_version_id')::uuid,
  3::smallint,'620a0000-0000-4000-8000-000000000003','ONEUSE',
  current_setting('test.purchase.b2_stale_promo_quote')::jsonb->>'quote_digest',
  pg_temp.purchase_dates(current_setting('test.purchase.b2_stale_promo_quote')::jsonb->'charge_dates'),true,true
)$$,'23505',null,'locked confirmation rejects an advisory quote after its one-use promotion is consumed');
reset role;
select is((select count(*)::integer from public.program_orders order_row
  where order_row.buyer_id='62010000-0000-4000-8000-000000000008'),0,
  'failed promotion quota confirmation leaves no new order');
select is((select count(*)::integer from public.program_promotion_reservations reservation
  where reservation.promotion_id='62080000-0000-4000-8000-000000000001'),1,
  'failed promotion quota confirmation leaves the existing reservation unchanged');

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"62010000-0000-4000-8000-000000000008","role":"authenticated"}';
select set_config('test.purchase.b2_installment_quote',public.get_my_program_purchase_quote(
  '62030000-0000-4000-8000-000000000001',3::smallint,null)::text,true);
select is(current_setting('test.purchase.b2_installment_quote')::jsonb->>'status','ready',
  'buyer can refresh an offer quote after the competing promotion reservation');
reset role;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('test.purchase.b2_installment_confirm',public.confirm_program_purchase(
  '62010000-0000-4000-8000-000000000008','62030000-0000-4000-8000-000000000001',
  (current_setting('test.purchase.b2_installment_quote')::jsonb->>'offer_version_id')::uuid,
  3::smallint,'620a0000-0000-4000-8000-000000000008',null,
  current_setting('test.purchase.b2_installment_quote')::jsonb->>'quote_digest',
  pg_temp.purchase_dates(current_setting('test.purchase.b2_installment_quote')::jsonb->'charge_dates'),true,true
)::text,true);
select is(current_setting('test.purchase.b2_installment_confirm')::jsonb->>'status','confirmed',
  'explicit off-session consent confirms a current installment schedule');
select set_config('test.purchase.b2_installment_order',current_setting('test.purchase.b2_installment_confirm')::jsonb->>'order_id',true);
reset role;
select is((select installment_count::integer from public.program_orders order_row
  where order_row.id=current_setting('test.purchase.b2_installment_order')::uuid),3,
  'confirmed installment count is the immutable choice submitted with consent');
select is((select installment_amounts_cents from public.program_orders order_row
  where order_row.id=current_setting('test.purchase.b2_installment_order')::uuid),array[400,400,400],
  'immutable order installments use the canonical even split');
select ok((select billing.off_session_consent and billing.retry_window_days=7
  and billing.disclosed_charge_dates=pg_temp.purchase_dates(
    current_setting('test.purchase.b2_installment_quote')::jsonb->'charge_dates')
  from public.program_billing_orders billing
  where billing.order_id=current_setting('test.purchase.b2_installment_order')::uuid),
  'saved installment consent preserves the exact schedule and seven-day retry window');

-- Free grants use existing 1560 grant semantics and do not write a billing/provider row.
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
create function public.program_purchase_test_fence_free_grant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.buyer_id='62010000-0000-4000-8000-000000000003'
     and new.promotion_id='62080000-0000-4000-8000-000000000002' then
    insert into public.platform_membership_deletion_locks(member_id) values(new.buyer_id);
  end if;
  return new;
end;
$$;
create trigger zzz_program_purchase_test_fence_free_grant
after insert on public.program_orders
for each row execute function public.program_purchase_test_fence_free_grant();
set local role service_role;
select is((public.confirm_program_purchase(
  '62010000-0000-4000-8000-000000000003','62030000-0000-4000-8000-000000000001',
  (current_setting('test.purchase.b2_free_quote')::jsonb->>'offer_version_id')::uuid,
  0::smallint,'620a0000-0000-4000-8000-000000000013','FREE100',
  current_setting('test.purchase.b2_free_quote')::jsonb->>'quote_digest','{}'::date[],false,false
)->>'status'),'account_fenced','new account fence after quote prevents a zero-total grant');
reset role;
drop trigger zzz_program_purchase_test_fence_free_grant on public.program_orders;
drop function public.program_purchase_test_fence_free_grant();
select is((select count(*)::integer from public.program_orders order_row
  where order_row.buyer_id='62010000-0000-4000-8000-000000000003'),0,
  'fenced free-grant attempt rolls back the order and request key');
select is((select count(*)::integer from public.program_promotion_reservations reservation
  where reservation.promotion_id='62080000-0000-4000-8000-000000000002'),0,
  'fenced free-grant attempt releases its promotion quota');
select is((select count(*)::integer from public.platform_membership_deletion_locks fence
  where fence.member_id='62010000-0000-4000-8000-000000000003'),0,
  'the trigger-created fence is rolled back with the failed purchase subtransaction');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('test.purchase.b2_free_confirm',public.confirm_program_purchase(
  '62010000-0000-4000-8000-000000000003','62030000-0000-4000-8000-000000000001',
  (current_setting('test.purchase.b2_free_quote')::jsonb->>'offer_version_id')::uuid,
  0::smallint,'620a0000-0000-4000-8000-000000000013','FREE100',
  current_setting('test.purchase.b2_free_quote')::jsonb->>'quote_digest','{}'::date[],false,false
)::text,true);
select is(current_setting('test.purchase.b2_free_confirm')::jsonb->>'status','grant_created',
  'one hundred percent promotion creates an existing no-charge access grant');
select set_config('test.purchase.b2_free_order',current_setting('test.purchase.b2_free_confirm')::jsonb->>'order_id',true);
select is((public.confirm_program_purchase(
  '62010000-0000-4000-8000-000000000003','62030000-0000-4000-8000-000000000001',
  (current_setting('test.purchase.b2_free_quote')::jsonb->>'offer_version_id')::uuid,
  0::smallint,'620a0000-0000-4000-8000-000000000013','FREE100',
  current_setting('test.purchase.b2_free_quote')::jsonb->>'quote_digest','{}'::date[],false,false
)->>'status'),'already_granted','lost-response replay returns the saved zero-total grant before current quote checks');
reset role;
select is((select count(*)::integer from public.program_orders order_row
  where order_row.id=current_setting('test.purchase.b2_free_order')::uuid),1,
  'exact zero-total replay creates no second order');
select is((select count(*)::integer from public.program_promotion_redemptions redemption
  where redemption.order_id=current_setting('test.purchase.b2_free_order')::uuid),1,
  'exact zero-total replay does not duplicate the promotion redemption');
select is((select billing_state from public.program_order_state state
  where state.order_id=current_setting('test.purchase.b2_free_order')::uuid),'free_grant',
  'zero-total grant retains the existing free-grant lifecycle state');
select is((select count(*)::integer from public.program_billing_orders billing
  where billing.order_id=current_setting('test.purchase.b2_free_order')::uuid),0,
  'zero-total grant creates no billing-terms or provider row');
select is((select state from public.program_promotion_reservations reservation
  where reservation.order_id=current_setting('test.purchase.b2_free_order')::uuid),'redeemed',
  'zero-total promotion is recorded through the existing redemption ledger');

-- A server-side terms failure must roll the new reservation and promotion quota back together.
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"62010000-0000-4000-8000-000000000007","role":"authenticated"}';
select set_config('test.purchase.rollback_quote',public.get_my_program_purchase_quote(
  '62030000-0000-4000-8000-000000000001',1::smallint,'ROLLBACK')::text,true);
select is(current_setting('test.purchase.rollback_quote')::jsonb->>'status','ready',
  'rollback fixture begins with a valid current quote and available promotion');
reset role;
create function public.program_purchase_test_fail_terms_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'synthetic local consent persistence failure' using errcode = 'PZ002';
end;
$$;
create trigger zzz_program_purchase_test_fail_terms
after insert on public.program_billing_orders
for each row execute function public.program_purchase_test_fail_terms_insert();
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('test.purchase.rollback_confirm',public.confirm_program_purchase(
  '62010000-0000-4000-8000-000000000007','62030000-0000-4000-8000-000000000001',
  (current_setting('test.purchase.rollback_quote')::jsonb->>'offer_version_id')::uuid,
  1::smallint,'620a0000-0000-4000-8000-000000000007','ROLLBACK',
  current_setting('test.purchase.rollback_quote')::jsonb->>'quote_digest',
  pg_temp.purchase_dates(current_setting('test.purchase.rollback_quote')::jsonb->'charge_dates'),true,false
)::text,true);
select is(current_setting('test.purchase.rollback_confirm')::jsonb->>'status','purchase_unavailable',
  'terms persistence failure is returned without a partial purchase');
reset role;
drop trigger zzz_program_purchase_test_fail_terms on public.program_billing_orders;
drop function public.program_purchase_test_fail_terms_insert();
select is((select count(*)::integer from public.program_orders order_row
  where order_row.buyer_id='62010000-0000-4000-8000-000000000007'),0,
  'failed terms persistence rolls back the newly reserved order');
select is((select count(*)::integer from public.program_promotion_reservations reservation
  where reservation.promotion_id='62080000-0000-4000-8000-000000000003'),0,
  'failed terms persistence returns the promotion quota in the same transaction');

-- A changed calendar payload after the reservation lock also rolls the transaction back.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is((public.confirm_program_purchase(
  '62010000-0000-4000-8000-000000000007','62030000-0000-4000-8000-000000000001',
  (current_setting('test.purchase.rollback_quote')::jsonb->>'offer_version_id')::uuid,
  1::smallint,'620a0000-0000-4000-8000-000000000007','ROLLBACK',
  current_setting('test.purchase.rollback_quote')::jsonb->>'quote_digest',array['2099-01-01'::date],true,false
)->>'status'),'quote_changed','changed future-date payload is rejected inside atomic confirmation');
reset role;
select is((select count(*)::integer from public.program_orders order_row
  where order_row.buyer_id='62010000-0000-4000-8000-000000000007'),0,
  'changed future dates leave no order after the buyer and Program locks');
select is((select count(*)::integer from public.program_promotion_reservations reservation
  where reservation.promotion_id='62080000-0000-4000-8000-000000000003'),0,
  'changed future dates release the same transaction promotion quota');

-- A stale quote digest after reservation is another atomic rollback; the same request can then retry.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is((public.confirm_program_purchase(
  '62010000-0000-4000-8000-000000000007','62030000-0000-4000-8000-000000000001',
  (current_setting('test.purchase.rollback_quote')::jsonb->>'offer_version_id')::uuid,
  1::smallint,'620a0000-0000-4000-8000-000000000007','ROLLBACK',repeat('f',64),
  pg_temp.purchase_dates(current_setting('test.purchase.rollback_quote')::jsonb->'charge_dates'),true,false
)->>'status'),'quote_changed','quote digest mismatch is detected after reservation but before consent writes');
reset role;
select is((select count(*)::integer from public.program_orders order_row
  where order_row.buyer_id='62010000-0000-4000-8000-000000000007'),0,
  'stale quote mismatch leaves no order or request key behind');
select is((select count(*)::integer from public.program_promotion_reservations reservation
  where reservation.promotion_id='62080000-0000-4000-8000-000000000003'),0,
  'stale quote mismatch also rolls back its promotion quota');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('test.purchase.rollback_retry',public.confirm_program_purchase(
  '62010000-0000-4000-8000-000000000007','62030000-0000-4000-8000-000000000001',
  (current_setting('test.purchase.rollback_quote')::jsonb->>'offer_version_id')::uuid,
  1::smallint,'620a0000-0000-4000-8000-000000000007','ROLLBACK',
  current_setting('test.purchase.rollback_quote')::jsonb->>'quote_digest',
  pg_temp.purchase_dates(current_setting('test.purchase.rollback_quote')::jsonb->'charge_dates'),true,false
)::text,true);
select is(current_setting('test.purchase.rollback_retry')::jsonb->>'status','confirmed',
  'same exact idempotency UUID can retry after the failed transaction rolled back');
reset role;

-- Saved terms remain recoverable by their owner after eligibility and the current offer change.
insert into public.program_offer_versions(
  id,program_id,offer_number,content_version_id,offer_kind,list_price_cents,currency,max_installments,
  platform_owned,seller_profile_id,connected_account_id,created_by
) values(
  '62070000-0000-4000-8000-000000000002','62030000-0000-4000-8000-000000000001',3,
  '62060000-0000-4000-8000-000000000001','paid',1500,'usd',3,false,
  '62010000-0000-4000-8000-000000000001','acct_purchasecoach1','62010000-0000-4000-8000-000000000001');
update public.program_commerce_state set current_offer_version_id='62070000-0000-4000-8000-000000000002'
where program_id='62030000-0000-4000-8000-000000000001';
update public.platform_test_entitlements set revoked_at=now(),revoked_by='62010000-0000-4000-8000-000000000001'
where member_id='62010000-0000-4000-8000-000000000002' and revoked_at is null;
delete from public.coach_members where coach_id='62010000-0000-4000-8000-000000000001'
  and member_id='62010000-0000-4000-8000-000000000002';
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('test.purchase.b1_replay',public.confirm_program_purchase(
  '62010000-0000-4000-8000-000000000002','62030000-0000-4000-8000-000000000001',
  (current_setting('test.purchase.b1_promo_quote')::jsonb->>'offer_version_id')::uuid,
  1::smallint,'620a0000-0000-4000-8000-000000000001','ONEUSE',
  current_setting('test.purchase.b1_promo_quote')::jsonb->>'quote_digest','{}'::date[],true,false
)::text,true);
select is(current_setting('test.purchase.b1_replay')::jsonb->>'status','already_confirmed',
  'exact request replay recovers saved consent after current membership, link and offer eligibility change');
select is(current_setting('test.purchase.b1_replay')::jsonb->>'billing_revision','1',
  'exact replay returns the original saved terms revision without resetting it');
select is((public.confirm_program_purchase(
  '62010000-0000-4000-8000-000000000002','62030000-0000-4000-8000-000000000001',
  (current_setting('test.purchase.b1_promo_quote')::jsonb->>'offer_version_id')::uuid,
  2::smallint,'620a0000-0000-4000-8000-000000000001','ONEUSE',
  current_setting('test.purchase.b1_promo_quote')::jsonb->>'quote_digest','{}'::date[],true,true
)->>'status'),'request_conflict','same UUID with changed installment count cannot create or replace purchase terms');
reset role;
select is((select count(*)::integer from public.program_orders order_row
  where order_row.buyer_id='62010000-0000-4000-8000-000000000002'),1,
  'conflicting replay leaves the original buyer order unchanged');
select is((select revision::integer from public.program_billing_orders billing
  where billing.order_id=current_setting('test.purchase.b1_order')::uuid),1,
  'conflicting replay leaves accepted billing revision unchanged');

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"62010000-0000-4000-8000-000000000002","role":"authenticated"}';
select set_config('test.purchase.b1_request_read',public.get_my_program_purchase_request(
  '620a0000-0000-4000-8000-000000000001')::text,true);
select is(current_setting('test.purchase.b1_request_read')::jsonb->>'status','found',
  'request recovery remains available to the same buyer after membership expiration');
select is(public.get_my_program_purchase_context(current_setting('test.purchase.b1_order')::uuid)->>'status','ready',
  'owner can read the original terms context after current offer and membership changes');
set local request.jwt.claims = '{"sub":"62010000-0000-4000-8000-000000000003","role":"authenticated"}';
select is(public.get_my_program_purchase_request('620a0000-0000-4000-8000-000000000001')->>'status','not_found',
  'another signed-in buyer cannot discover an owned request UUID');
select is(public.get_my_program_purchase_context(current_setting('test.purchase.b1_order')::uuid)->>'status','not_found',
  'another signed-in buyer cannot read immutable order economics or consent');
reset role;

select * from finish();
rollback;
