begin;
select plan(90);

select is(
  (select mode || ':' || sales_enabled::text || ':' || fulfillment_enabled::text
   from private.printful_apparel_sales_state where singleton),
  'legacy_manual:false:false',
  'Apparel-only sales and fulfillment are disabled by default'
);
select is(public.is_printful_apparel_auto_only(), false,
  'the legacy physical checkout fence remains in legacy mode before explicit cutover');
select is((select refund_policy from private.printful_apparel_sales_state where singleton), null::text,
  'no automatic refund policy is selected without user approval');
select ok(
  not has_table_privilege('anon','private.printful_apparel_orders','SELECT')
  and not has_table_privilege('authenticated','private.printful_apparel_fulfillment_outbox','SELECT')
  and not has_table_privilege('authenticated','private.printful_apparel_action_ledger','SELECT'),
  'guest/member roles cannot read private order or worker tables'
);
select ok(
  not has_function_privilege('anon','public.create_printful_apparel_checkout_intent(uuid,uuid,uuid,bigint,bigint,text,jsonb,text,text,timestamp with time zone,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.claim_printful_apparel_fulfillment_jobs(uuid,integer)','EXECUTE')
  and has_function_privilege('service_role','public.claim_printful_apparel_fulfillment_jobs(uuid,integer)','EXECUTE'),
  'checkout and worker control RPCs are service-role-only'
);
select ok(
  not has_function_privilege('anon','public.get_printful_apparel_checkout_session_state(uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_printful_apparel_checkout_session_state(uuid)','EXECUTE')
  and has_function_privilege('service_role','public.get_printful_apparel_checkout_session_state(uuid)','EXECUTE'),
  'Stripe session snapshots are not public'
);
select ok(
  not has_function_privilege('anon','public.list_printful_apparel_admin_orders()','EXECUTE')
  and not has_function_privilege('authenticated','public.list_printful_apparel_admin_orders()','EXECUTE')
  and has_function_privilege('service_role','public.list_printful_apparel_admin_orders()','EXECUTE'),
  'private apparel exception projection is service-role-only'
);
select is((select count(*)::integer from private.printful_apparel_orders), 0,
  'the isolated local target starts without order records');
select is((select count(*)::integer from private.printful_apparel_fulfillment_outbox), 0,
  'the isolated local target starts without fulfillment jobs');
select is((select count(*)::integer from public.claim_printful_apparel_fulfillment_jobs(gen_random_uuid(),120)), 0,
  'the worker cannot claim jobs while sales mode and fulfillment are disabled');
select is(public.get_printful_apparel_checkout_session_state('123e4567-e89b-42d3-a456-426614174000'), null::jsonb,
  'unknown opaque checkout IDs reveal no session state');
select is(public.record_printful_apparel_paid(
  '123e4567-e89b-42d3-a456-426614174000','cs_synthetic12345678','pi_synthetic12345678',
  'evt_synthetic12345678',5000,null,'usd','buyer@example.test',null,true),
  'not_found','a signed-event database RPC cannot settle an absent private intent');
select throws_ok(
  $$select public.create_printful_apparel_checkout_intent(null::uuid,null::uuid,null::uuid,null::bigint,null::bigint,
    'buyer@example.test','{}'::jsonb,repeat('a',64),repeat('b',64),now()+interval '1 day','{}'::jsonb)$$,
  '22023',null,'invalid checkout intent inputs fail before any write'
);

-- The remainder uses only synthetic catalog/customer/provider facts inside this
-- transaction. The final ROLLBACK leaves the isolated local target unchanged.
insert into auth.users (
  id, aud, role, email, email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) values (
  '11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated',
  'printful-admin@example.test', now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Synthetic Printful Admin"}'::jsonb
);
insert into public.profiles (id, role, display_name)
values ('11111111-1111-4111-8111-111111111111', 'admin', 'Synthetic Printful Admin')
on conflict (id) do update set role = excluded.role, display_name = excluded.display_name;

update private.printful_catalog_sync_state set
  revision = 1, last_product_count = 1, last_page_count = 1,
  last_read_started_at = now() - interval '1 minute', last_read_completed_at = now(), last_observed_at = now()
where singleton;
insert into private.printful_catalog_products (
  id, store_id, external_product_id, provider_name, ignored,
  observed_variant_count, synced_variant_count, last_seen_revision
) values (
  '22222222-2222-4222-8222-222222222222', '19050731', '492658691',
  'Synthetic Apparel Tee', false, 2, 2, 1
);
insert into private.printful_catalog_variants (
  id, store_id, product_id, external_variant_id, provider_external_id, catalog_variant_id,
  provider_name, color, size, synced, ignored, availability_status, available,
  configuration_fingerprint, configuration_complete, placement_types, option_names,
  production_cost_min_cents, production_cost_max_cents, production_cost_currency,
  production_cost_source, production_cost_raw_price, production_cost_observed_at,
  production_cost_configuration_fingerprint, production_cost_evidence_sha256,
  production_cost_reviewed_by, last_seen_revision
) values
  (
    '33333333-3333-4333-8333-333333333331', '19050731',
    '22222222-2222-4222-8222-222222222222', '5635838147', 'synthetic-red-m', '4011',
    'Synthetic Tee / Red / M', 'Red', 'M', true, false, 'active', true,
    repeat('a', 64), true, array['front'], array[]::text[],
    1844, 1844, 'USD', 'admin-reviewed-printful-ui', '$18.44', now() - interval '1 minute',
    repeat('a', 64), repeat('1', 64), '11111111-1111-4111-8111-111111111111', 1
  ),
  (
    '33333333-3333-4333-8333-333333333332', '19050731',
    '22222222-2222-4222-8222-222222222222', '5635838148', 'synthetic-blue-m', '4012',
    'Synthetic Tee / Blue / M', 'Blue', 'M', true, false, 'active', true,
    repeat('b', 64), true, array['front'], array[]::text[],
    1225, 1225, 'USD', 'admin-reviewed-printful-ui', '$12.25', now() - interval '1 minute',
    repeat('b', 64), repeat('2', 64), '11111111-1111-4111-8111-111111111111', 1
  );

create temporary table apparel_qa_refs (
  admin_id uuid not null,
  product_id uuid not null,
  red_variant_id uuid not null,
  blue_variant_id uuid not null,
  item_id uuid
) on commit drop;
insert into apparel_qa_refs (admin_id, product_id, red_variant_id, blue_variant_id)
values (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333331',
  '33333333-3333-4333-8333-333333333332'
);
update apparel_qa_refs set item_id = public.import_printful_armory_preview(product_id, admin_id);

create function pg_temp.apparel_test_address(target_email text) returns jsonb
language sql immutable
as $$
  select jsonb_build_object(
    'name', 'Synthetic Buyer', 'address1', '1 Test Way', 'address2', '',
    'city', 'Testville', 'stateCode', 'NY', 'countryCode', 'US', 'zip', '10001'
  )
$$;

create function pg_temp.apparel_test_quote(
  target_variant_id uuid,
  target_email text
) returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'currency', 'USD', 'source', 'printful-order-estimate', 'complete', true,
    'variantId', target_variant_id::text,
    'configurationFingerprint', variant.configuration_fingerprint,
    'designIdentityFingerprint', repeat('f', 64),
    'catalogRevision', sync.revision::text,
    'approvalVersion', approval.approval_version,
    'addressSha256', repeat('c', 64),
    'address', pg_temp.apparel_test_address(target_email)
      || jsonb_build_object('phone', null, 'email', target_email),
    'createdAt', now() - interval '1 minute',
    'expiresAt', now() + interval '30 minutes',
    'subtotalCents', 1844, 'discountCents', 0, 'shippingCents', 456,
    'taxCents', 100, 'vatCents', 0, 'additionalFeeCents', 0,
    'fulfillmentFeeCents', 0, 'digitizationCents', 0, 'totalCents', 2400
  )
  from private.printful_catalog_variants variant
  join private.printful_catalog_sync_state sync on sync.singleton
  join private.printful_apparel_products approval on approval.product_id = variant.product_id
  where variant.id = target_variant_id
$$;

create function pg_temp.create_apparel_test_order(
  target_order_id uuid,
  target_variant_id uuid,
  target_email text
) returns uuid
language plpgsql
as $$
declare
  refs apparel_qa_refs%rowtype;
begin
  select * into refs from apparel_qa_refs;
  return public.create_printful_apparel_checkout_intent(
    target_order_id, refs.product_id, target_variant_id,
    (select revision from private.printful_catalog_sync_state where singleton),
    (select approval_version from private.printful_apparel_products where product_id = refs.product_id),
    target_email, pg_temp.apparel_test_address(target_email), repeat('c', 64), repeat('d', 64),
    now() + interval '1 day', pg_temp.apparel_test_quote(target_variant_id, target_email)
  );
end;
$$;

select is(
  (select price_cents from private.printful_armory_drafts where item_id = (select item_id from apparel_qa_refs)),
  3844,
  'private import uses scalar Printful production cost plus the fixed $20 markup'
);
select is(
  (select count(*)::integer from public.armory_items where id = (select item_id from apparel_qa_refs)),
  0,
  'new apparel remains private until explicit preview publication'
);
select is(
  public.update_printful_armory_preview(
    (select item_id from apparel_qa_refs), (select admin_id from apparel_qa_refs),
    'Synthetic Tee', 'Synthetic apparel fixture for transactional tests.',
    (select admin_id::text || '/synthetic.webp' from apparel_qa_refs), 3844, 0, true
  ),
  true,
  'admin curation stores synthetic copy and owner-scoped image before publish'
);
select is(
  public.publish_printful_armory_preview((select item_id from apparel_qa_refs), (select admin_id from apparel_qa_refs)),
  (select item_id from apparel_qa_refs),
  'explicit publication creates the expected display-only preview'
);
select is(
  (select kind from public.armory_items where id = (select item_id from apparel_qa_refs)),
  'preview',
  'published Printful source remains a preview before separate Apparel-sale approval'
);
select is(
  public.set_printful_apparel_product_approval((select product_id from apparel_qa_refs), (select admin_id from apparel_qa_refs), true, true),
  1::bigint,
  'explicit apparel approval freezes the current product version'
);
select is(
  (select count(*)::integer from private.printful_apparel_approved_variants),
  2,
  'approval manifest binds both exact same-size color variants'
);

select is(public.begin_printful_apparel_cutover((select admin_id from apparel_qa_refs)), 0,
  'legacy physical checkout cutover starts with no open product intents');
select ok(
  public.record_printful_apparel_legacy_paid_resolution(
    null, 'cs_syntheticcutover123', 'pi_syntheticcutover123', 3844, 'usd', 'legacy_physical_without_intent'
  ) is not null,
  'a late paid legacy physical session can be durably held during cutover itself'
);
update private.printful_apparel_legacy_payment_resolutions
set status = 'closed' where stripe_session_id = 'cs_syntheticcutover123';
select is(public.finish_printful_apparel_cutover((select admin_id from apparel_qa_refs)), true,
  'admin resolution allows the cutover to finish without an ordinary physical fallback');
select is(public.set_printful_apparel_sales_enabled((select admin_id from apparel_qa_refs), true, 'admin_review'), true,
  'synthetic integration test explicitly enables the isolated target only');

select throws_ok(
  $$select public.create_printful_apparel_checkout_intent(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333331', 1, 1, 'missing-source@example.test',
    pg_temp.apparel_test_address('missing-source@example.test'), repeat('c',64), repeat('d',64), now()+interval '1 day',
    pg_temp.apparel_test_quote('33333333-3333-4333-8333-333333333331','missing-source@example.test') - 'source'
  )$$,
  'P0001', 'Complete USD quote required', 'quote without source fails closed'
);
select is((select count(*)::integer from private.printful_apparel_orders where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'), 0,
  'missing-source quote causes no order write');
select throws_ok(
  $$select public.create_printful_apparel_checkout_intent(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333331', 1, 1, 'missing-complete@example.test',
    pg_temp.apparel_test_address('missing-complete@example.test'), repeat('c',64), repeat('d',64), now()+interval '1 day',
    pg_temp.apparel_test_quote('33333333-3333-4333-8333-333333333331','missing-complete@example.test') - 'complete'
  )$$,
  'P0001', 'Complete USD quote required', 'quote without completeness attestation fails closed'
);
select is((select count(*)::integer from private.printful_apparel_orders where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'), 0,
  'missing-complete quote causes no order write');

select is(
  pg_temp.create_apparel_test_order(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    (select red_variant_id from apparel_qa_refs), 'red-buyer@example.test'
  ),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'::uuid,
  'exact opaque Red / M variant creates a valid private checkout intent'
);
select is((select status from private.printful_apparel_orders where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),
  'quoted', 'valid intent stores the immutable supplier estimate before Stripe');
select is(public.bind_printful_apparel_checkout_session('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','cs_syntheticredorder123'), true,
  'Stripe session binds once to the stable apparel order');
select is(public.record_printful_apparel_paid(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','cs_syntheticredorder123','pi_syntheticredorder123','evt_syntheticredorder123',
  3844,3000,'usd','red-buyer@example.test',
  pg_temp.apparel_test_address('red-buyer@example.test') || jsonb_build_object('phone',null,'email','red-buyer@example.test'),true
), 'queued', 'verified synthetic paid event and net facts enqueue the exact variant');
select ok(
  (select orders.status = 'queued' and outbox.status = 'queued'
   from private.printful_apparel_orders orders
   join private.printful_apparel_fulfillment_outbox outbox on outbox.order_id = orders.id
   where orders.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),
  'the paid transition updates order and outbox atomically'
);
update private.printful_apparel_fulfillment_outbox set attempts = 1000
where order_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';

create temporary table apparel_qa_claim on commit drop as
select claimed.*, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid as worker_id
from public.claim_printful_apparel_fulfillment_jobs('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',120) claimed;
copy (
  select 'APPAREL_CLAIM_ROW_JSON=' || row_to_json(claim_row)::text
  from apparel_qa_claim claim_row where order_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
) to stdout;
select is((select count(*)::integer from apparel_qa_claim), 1,
  'one paid job is claimed with a durable lease generation');
select is((select attempts from private.printful_apparel_fulfillment_outbox
  where order_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'), 1000,
  'a saturated attempt counter remains claimable and does not abort a worker tick');
select ok((select approval_version = 1 and catalog_revision = 1
    and stripe_event_id = 'evt_syntheticredorder123' and final_stripe_address_verified
  from apparel_qa_claim where order_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),
  'SQL claim projection supplies the exact runtime revisions and verified-address flag');
select is(public.record_printful_apparel_action(
  (select order_id from apparel_qa_claim),(select worker_id from apparel_qa_claim),(select lease_generation from apparel_qa_claim),
  'create-synthetic-order','create','started',null,null,repeat('a',64)
), true, 'provider create is write-ahead journaled before its external call');
select is((select status from private.printful_apparel_orders where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),
  'create_unknown', 'a crash after create start is durably reconciled rather than retried as new');
select is(public.record_printful_apparel_action(
  (select order_id from apparel_qa_claim),(select worker_id from apparel_qa_claim),(select lease_generation from apparel_qa_claim),
  'create-synthetic-order','create','started',null,null,repeat('a',64)
), false, 'duplicate create start cannot authorize a second provider side effect');
select is((select count(*)::integer from private.printful_apparel_action_ledger
  where order_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3' and action_key = 'create-synthetic-order'),
  1, 'duplicate start leaves exactly one immutable ledger record');
select is(public.record_printful_apparel_action(
  (select order_id from apparel_qa_claim),(select worker_id from apparel_qa_claim),(select lease_generation from apparel_qa_claim),
  'create-synthetic-order','create','succeeded',null,'90001',repeat('a',64)
), true, 'the recorded create result binds one synthetic provider order identity');
select is(public.update_printful_apparel_fulfillment_state(
  (select order_id from apparel_qa_claim),(select worker_id from apparel_qa_claim),(select lease_generation from apparel_qa_claim),
  'draft_created','draft_created','90001','draft','[]'::jsonb,null,now()
), true, 'verified draft readback advances the order and outbox together');
delete from apparel_qa_claim;
insert into apparel_qa_claim
select claimed.*, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
from public.claim_printful_apparel_fulfillment_jobs('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',120) claimed;
select is(public.update_printful_apparel_fulfillment_state(
  (select order_id from apparel_qa_claim),(select worker_id from apparel_qa_claim),(select lease_generation from apparel_qa_claim),
  'quote_pending','quote_pending','90001','onhold','[]'::jsonb,'provider_order_on_hold',now()
), true, 'an asynchronous supplier order enters quote-pending before acceptance');
delete from apparel_qa_claim;
insert into apparel_qa_claim
select claimed.*, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
from public.claim_printful_apparel_fulfillment_jobs('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',120) claimed;
select is(public.record_printful_apparel_post_confirm_cost_exception(
  (select order_id from apparel_qa_claim),(select worker_id from apparel_qa_claim),(select lease_generation from apparel_qa_claim),
  'provider_cost_facts_unverified'
), true, 'accepted observations from quote-pending can record a private cost exception');
select is(public.update_printful_apparel_fulfillment_state(
  (select order_id from apparel_qa_claim),(select worker_id from apparel_qa_claim),(select lease_generation from apparel_qa_claim),
  'draft_created','draft_created','90001','draft','[]'::jsonb,null,now()
), true, 'the supplier draft can resume after its asynchronous estimate resolves');
delete from apparel_qa_claim;
insert into apparel_qa_claim
select claimed.*, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
from public.claim_printful_apparel_fulfillment_jobs('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',120) claimed;
select is((select count(*)::integer from apparel_qa_claim), 1,
  'a later worker lease resumes the created draft before confirmation');
select is(public.record_printful_apparel_action(
  (select order_id from apparel_qa_claim),(select worker_id from apparel_qa_claim),(select lease_generation from apparel_qa_claim),
  'confirm-synthetic-order','confirm','started',null,'90001',repeat('b',64)
), true, 'confirm is write-ahead journaled only for the verified owned draft');
select is((select status from private.printful_apparel_orders where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),
  'confirm_unknown', 'a lost confirm response enters reconciliation state before provider call');
select is(public.record_printful_apparel_action(
  (select order_id from apparel_qa_claim),(select worker_id from apparel_qa_claim),(select lease_generation from apparel_qa_claim),
  'confirm-synthetic-order','confirm','succeeded',null,'90001',repeat('b',64)
), true, 'the same confirmed draft action can be completed once');
select is(public.record_printful_apparel_post_confirm_cost_exception(
  (select order_id from apparel_qa_claim),(select worker_id from apparel_qa_claim),(select lease_generation from apparel_qa_claim),
  'provider_cost_changed'
), true, 'an accepted provider observation can persist its cost exception before the terminal state write');
select ok((select order_status = 'confirm_unknown' and provider_cost_exception_code = 'provider_cost_facts_unverified'
  from public.list_printful_apparel_admin_orders()
  where order_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),
  'authenticated-admin status source surfaces the private hold and cost exception');
select ok((select not (to_jsonb(status_row) ?| array[
    'guest_email','address','provider_order_id','sync_variant_id','stripe_payment_intent_id',
    'stripe_session_id','customer_price_cents','stripe_paid_cents','stripe_net_revenue_cents'
  ]) from public.list_printful_apparel_admin_orders() status_row
  where order_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'),
  'admin status projection omits customer, provider, and payment details');
select is(public.update_printful_apparel_fulfillment_state(
  (select order_id from apparel_qa_claim),(select worker_id from apparel_qa_claim),(select lease_generation from apparel_qa_claim),
  'confirmed','confirmed','90001','pending','[]'::jsonb,null,now()
), true, 'accepted provider order advances to confirmed');
delete from apparel_qa_claim;
insert into apparel_qa_claim
select claimed.*, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
from public.claim_printful_apparel_fulfillment_jobs('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',120) claimed;
select is((select count(*)::integer from apparel_qa_claim), 1,
  'confirmed orders remain pollable under a fresh lease');
select is(public.record_printful_apparel_post_confirm_cost_exception(
  (select order_id from apparel_qa_claim),(select worker_id from apparel_qa_claim),(select lease_generation from apparel_qa_claim),
  'provider_cost_changed'
), true, 'a post-confirm cost discrepancy is durably recorded without a refund transition');
select is((select provider_cost_exception_code from private.printful_apparel_orders
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'), 'provider_cost_facts_unverified',
  'the cost exception remains private on the accepted order while tracking continues');
select throws_ok(
  $$select public.update_printful_apparel_fulfillment_state(
    (select order_id from apparel_qa_claim),(select worker_id from apparel_qa_claim),(select lease_generation from apparel_qa_claim),
    'confirmed','draft_created','90001','pending','[]'::jsonb,null,now())$$,
  '23514', 'Printful order identity or hold is immutable', 'order and outbox statuses cannot diverge'
);
select throws_ok(
  $$select public.update_printful_apparel_fulfillment_state(
    (select order_id from apparel_qa_claim),(select worker_id from apparel_qa_claim),(select lease_generation from apparel_qa_claim),
    'draft_created','draft_created','90001','draft','[]'::jsonb,null,now())$$,
  '23514', null, 'confirmed cannot transition backwards to a draft'
);
select throws_ok(
  $$select public.update_printful_apparel_fulfillment_state(
    (select order_id from apparel_qa_claim),(select worker_id from apparel_qa_claim),(select lease_generation from apparel_qa_claim),
    'confirmed','confirmed','90002','pending','[]'::jsonb,null,now())$$,
  '23514', null, 'provider order identity cannot be replaced after binding'
);

update private.printful_catalog_sync_state set revision = 2, last_product_count = 1, updated_at = now() where singleton;
update private.printful_catalog_products set
  observed_variant_count = 3, synced_variant_count = 3, last_seen_revision = 2, updated_at = now()
where id = (select product_id from apparel_qa_refs);
update private.printful_catalog_variants set last_seen_revision = 2, updated_at = now()
where product_id = (select product_id from apparel_qa_refs);
update private.printful_catalog_variants set
  configuration_fingerprint = repeat('c',64), production_cost_configuration_fingerprint = repeat('c',64),
  production_cost_min_cents = 1226, production_cost_max_cents = 1226,
  production_cost_raw_price = '$12.26', production_cost_evidence_sha256 = repeat('3',64), updated_at = now()
where id = (select blue_variant_id from apparel_qa_refs);
insert into private.printful_catalog_variants (
  id, store_id, product_id, external_variant_id, provider_external_id, catalog_variant_id,
  provider_name, color, size, synced, ignored, availability_status, available,
  configuration_fingerprint, configuration_complete, placement_types, option_names,
  production_cost_min_cents, production_cost_max_cents, production_cost_currency,
  production_cost_source, production_cost_raw_price, production_cost_observed_at,
  production_cost_configuration_fingerprint, production_cost_evidence_sha256,
  production_cost_reviewed_by, last_seen_revision
) values (
  '33333333-3333-4333-8333-333333333333', '19050731',
  '22222222-2222-4222-8222-222222222222', '5635838149', 'synthetic-green-m', '4013',
  'Synthetic Tee / Green / M', 'Green', 'M', true, false, 'active', true,
  repeat('e',64), true, array['front'], array[]::text[],
  1300, 1300, 'USD', 'admin-reviewed-printful-ui', '$13.00', now() - interval '1 minute',
  repeat('e',64), repeat('4',64), '11111111-1111-4111-8111-111111111111', 2
);
select is(
  public.get_printful_apparel_checkout_context(
    (select product_id from apparel_qa_refs), '33333333-3333-4333-8333-333333333333'
  ) #>> '{variant,approvedForSale}', 'false',
  'a newly observed exact variant is not implicitly added to the prior approval manifest'
);
select throws_ok(
  $$select pg_temp.create_apparel_test_order(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','33333333-3333-4333-8333-333333333333','green-buyer@example.test')$$,
  '40001', 'Selected variant is outside the approved product manifest',
  'new variants require a fresh explicit apparel approval'
);
select is(
  public.get_printful_apparel_checkout_context(
    (select product_id from apparel_qa_refs), (select blue_variant_id from apparel_qa_refs)
  ) #>> '{variant,approvedForSale}', 'false',
  'changed design and re-reviewed cost facts invalidate the old variant approval'
);

select is(
  pg_temp.create_apparel_test_order(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
    (select red_variant_id from apparel_qa_refs), 'refund-buyer@example.test'
  ), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'::uuid,
  'a second synthetic order is created for refund and late-net fencing'
);
select is(public.bind_printful_apparel_checkout_session('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5','cs_syntheticrefund123'), true,
  'refund fixture binds to its own Stripe session');
select is(public.record_printful_apparel_stripe_net(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5','pi_syntheticrefund123',3844,3845,'usd',true
), 'invalid_net_facts', 'Stripe net revenue above captured payment is rejected');
select is(public.record_printful_apparel_paid(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5','cs_syntheticrefund123','pi_syntheticrefund123','evt_syntheticrefund123',
  3844,3000,'usd','refund-buyer@example.test',
  pg_temp.apparel_test_address('refund-buyer@example.test') || jsonb_build_object('phone',null,'email','refund-buyer@example.test'),true
), 'queued', 'a valid payment and trusted net facts enqueue the test order');
select is(public.bind_printful_apparel_final_quote(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
  pg_temp.apparel_test_quote((select red_variant_id from apparel_qa_refs),'refund-buyer@example.test')
    || jsonb_build_object('createdAt',now()-interval '1 minute','expiresAt',now()+interval '5 minutes'),
  repeat('c',64)
), true, 'a valid final quote is bound before simulating a refund race');
delete from apparel_qa_claim;
insert into apparel_qa_claim
select claimed.*, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
from public.claim_printful_apparel_fulfillment_jobs('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',120) claimed;
select is((select count(*)::integer from apparel_qa_claim), 1, 'the refund-race order is leased before provider work');
select is(public.record_printful_apparel_action(
  (select order_id from apparel_qa_claim),(select worker_id from apparel_qa_claim),(select lease_generation from apparel_qa_claim),
  'refund-race-create','create','started',null,null,repeat('a',64)
), true, 'the synthetic provider draft create is durably recorded');
select is(public.record_printful_apparel_action(
  (select order_id from apparel_qa_claim),(select worker_id from apparel_qa_claim),(select lease_generation from apparel_qa_claim),
  'refund-race-create','create','succeeded',null,'90005',repeat('a',64)
), true, 'the synthetic draft identity is recorded before refund review');
select is(public.update_printful_apparel_fulfillment_state(
  (select order_id from apparel_qa_claim),(select worker_id from apparel_qa_claim),(select lease_generation from apparel_qa_claim),
  'draft_created','draft_created','90005','draft','[]'::jsonb,null,now()
), true, 'the refund-race fixture reaches a verified draft');
delete from apparel_qa_claim;
insert into apparel_qa_claim
select claimed.*, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
from public.claim_printful_apparel_fulfillment_jobs('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',120) claimed;
select is(public.hold_printful_apparel_refund(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5','cs_wrongrefund123','pi_syntheticrefund123','evt_syntheticrefund456','refund'
), false, 'a refund cannot hold an order through a mismatched Stripe session');
select is(public.hold_printful_apparel_refund(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5','cs_syntheticrefund123','pi_syntheticrefund123','evt_syntheticrefund457','refund'
), true, 'a trusted refund durably holds an already-paid leased apparel order');
select is(public.record_printful_apparel_action(
  (select order_id from apparel_qa_claim where order_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'),
  (select worker_id from apparel_qa_claim where order_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'),
  (select lease_generation from apparel_qa_claim where order_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'),
  'refund-race-confirm','confirm','started',null,'90005',repeat('b',64)
), false, 'refund arriving after the final Stripe read prevents confirm start');
select is(public.record_printful_apparel_stripe_net(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5','pi_syntheticrefund123',3844,3000,'usd',true
), 'resolution_hold', 'delayed net facts preserve the refund hold');
select is(public.bind_printful_apparel_final_quote(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
  pg_temp.apparel_test_quote((select red_variant_id from apparel_qa_refs),'refund-buyer@example.test')
    || jsonb_build_object('createdAt',now()-interval '1 minute','expiresAt',now()+interval '5 minutes'),
  repeat('c',64)
), false, 'a final supplier quote cannot revive a refund-held order');
select ok(
  (select orders.status = 'resolution_hold' and outbox.status = 'resolution_hold'
   from private.printful_apparel_orders orders
   join private.printful_apparel_fulfillment_outbox outbox on outbox.order_id = orders.id
   where orders.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'),
  'the monotonic refund hold remains on both order and outbox'
);

select is(
  pg_temp.create_apparel_test_order(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',
    (select red_variant_id from apparel_qa_refs), 'refund-before-paid@example.test'
  ), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7'::uuid,
  'out-of-order refund fixture starts with an unpaid checkout'
);
select is(public.bind_printful_apparel_checkout_session('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7','cs_syntheticprepaid123'), true,
  'the out-of-order risk fixture binds its verified Stripe session');
select is(public.hold_printful_apparel_refund(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7','cs_syntheticprepaid123','pi_syntheticprepaid123','evt_syntheticprepaid123','refund'
), true, 'refund before paid persists against the exact session and private order');
select is(public.hold_printful_apparel_refund(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7','cs_otherprepaid123','pi_syntheticprepaid123','evt_syntheticprepaid456','refund'
), false, 'risk from a different Checkout session cannot attach to the held order');
select is(public.record_printful_apparel_paid(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7','cs_syntheticprepaid123','pi_syntheticprepaid123','evt_syntheticprepaid789',
  3844,3000,'usd','refund-before-paid@example.test',
  pg_temp.apparel_test_address('refund-before-paid@example.test') || jsonb_build_object('phone',null,'email','refund-before-paid@example.test'),true
), 'resolution_hold', 'delayed paid event cannot revive a pre-payment refund hold');
select is(public.record_printful_apparel_stripe_net(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7','pi_syntheticprepaid123',3844,3000,'usd',true
), 'resolution_hold', 'delayed net event cannot revive an out-of-order refund hold');
select ok((select orders.status = 'resolution_hold' and outbox.status = 'resolution_hold'
  from private.printful_apparel_orders orders join private.printful_apparel_fulfillment_outbox outbox on outbox.order_id = orders.id
  where orders.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7'),
  'out-of-order risk remains durably held after later payment facts');

select is(
  pg_temp.create_apparel_test_order(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
    (select red_variant_id from apparel_qa_refs), 'address-buyer@example.test'
  ), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6'::uuid,
  'address-recovery fixture creates a separate private checkout intent'
);
select is(public.bind_printful_apparel_checkout_session('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6','cs_syntheticaddress123'), true,
  'address-recovery fixture binds the original checkout session');
select is(public.record_printful_apparel_paid(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6','cs_syntheticaddress123','pi_syntheticaddress123','evt_syntheticaddress123',
  3844,3000,'usd','address-buyer@example.test',null,true
), 'paid_waiting_address_quote', 'paid event with missing address is held for same-session recovery');
select is(public.record_printful_apparel_paid(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6','cs_syntheticaddress123','pi_syntheticaddress123','evt_syntheticaddress456',
  3844,3000,'usd','address-buyer@example.test',
  pg_temp.apparel_test_address('address-buyer@example.test') || jsonb_build_object('phone',null,'email','address-buyer@example.test'),true
), 'queued', 'same payment identity can recover a newly verified matching shipping address once');
select is(public.record_printful_apparel_paid(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6','cs_syntheticaddress123','pi_syntheticaddress123','evt_syntheticaddress789',
  3844,3000,'usd','address-buyer@example.test',
  pg_temp.apparel_test_address('address-buyer@example.test') || jsonb_build_object('phone',null,'email','address-buyer@example.test'),true
), 'queued', 'duplicate paid events remain idempotent after address recovery');
select ok(
  (select orders.final_stripe_address = orders.quoted_address and orders.stripe_net_revenue_cents = 3000
   from private.printful_apparel_orders orders where orders.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6'),
  'recovered payment retains the validated address and previously recorded net facts'
);

select * from finish();
rollback;
