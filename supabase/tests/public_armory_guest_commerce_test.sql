begin;
select plan(86);

-- Synthetic accounts only. Every fixture is rolled back at the end of this test.
insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-0000-0000-000000000001', 'public-armory-coach@example.test', '{"display_name":"Coach"}'),
  ('a1000000-0000-0000-0000-000000000002', 'public-armory-regular@example.test', '{"display_name":"Regular"}'),
  ('a1000000-0000-0000-0000-000000000003', 'public-armory-premium@example.test', '{"display_name":"Premium"}'),
  ('a1000000-0000-0000-0000-000000000004', 'public-armory-outsider@example.test', '{"display_name":"Outsider"}'),
  ('a1000000-0000-0000-0000-000000000005', 'public-armory-deleted@example.test', '{"display_name":"Deleted"}');

update public.profiles
set role = 'coach'
where id = 'a1000000-0000-0000-0000-000000000001';

insert into public.platform_memberships (
  member_id, tier, stripe_subscription_id, stripe_customer_id, stripe_price_id,
  status, current_period_end, last_event_created, last_event_id
) values
  ('a1000000-0000-0000-0000-000000000002', 'regular', 'sub_public_armory_regular', 'cus_public_armory_regular', 'price_regular_test', 'active', now() + interval '30 days', 1, 'evt_public_armory_regular'),
  ('a1000000-0000-0000-0000-000000000003', 'premium', 'sub_public_armory_premium', 'cus_public_armory_premium', 'price_premium_test', 'active', now() + interval '30 days', 1, 'evt_public_armory_premium'),
  ('a1000000-0000-0000-0000-000000000004', 'regular', 'sub_public_armory_outsider', 'cus_public_armory_outsider', 'price_regular_test', 'active', now() + interval '30 days', 1, 'evt_public_armory_outsider');

insert into public.coach_members (coach_id, member_id) values
  ('a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002');

-- Five public regular catalog rows plus deliberately excluded counterexamples.
insert into public.armory_items (
  id, coach_id, kind, category, title, description, price_cents, buy_url,
  file_path, file_name, visible_to_all, shipping_cents, sizes,
  printful_variant_mappings, required_membership_tier
) values
  ('a1000000-0000-0000-0000-000000000101', 'a1000000-0000-0000-0000-000000000001', 'paid', 'ebook', 'Public paid ebook', 'Paid download', 1800, null,
   'a1000000-0000-0000-0000-000000000001/ebook.pdf', 'ebook.pdf', true, 0, array[]::text[], '[]'::jsonb, 'everyone'),
  ('a1000000-0000-0000-0000-000000000102', 'a1000000-0000-0000-0000-000000000001', 'link', 'program', 'Public program link', 'External link', 2500, 'https://shop.example.test/program',
   null, null, true, 0, array[]::text[], '[]'::jsonb, 'everyone'),
  ('a1000000-0000-0000-0000-000000000103', 'a1000000-0000-0000-0000-000000000001', 'product', 'gear', 'Mapped shirt', 'Printful-backed gear', 4500, null,
   null, null, true, 600, array['S', 'M']::text[],
   '[{"option":"S","sku":"GYM-S","sync_variant_id":"9007199254740993"},{"option":"M","sku":"GYM-M","sync_variant_id":"0000000000000000001"}]'::jsonb, 'everyone'),
  ('a1000000-0000-0000-0000-000000000104', 'a1000000-0000-0000-0000-000000000001', 'product', 'gear', 'Zero shipping shirt', 'No shipping charge', 2200, null,
   null, null, true, 0, array[]::text[], '[]'::jsonb, 'everyone'),
  ('a1000000-0000-0000-0000-000000000105', 'a1000000-0000-0000-0000-000000000001', 'paid', 'ebook', 'Coach hidden paid', 'Private paid download', 1600, null,
   'a1000000-0000-0000-0000-000000000001/private.pdf', 'private.pdf', false, 0, array[]::text[], '[]'::jsonb, 'everyone'),
  ('a1000000-0000-0000-0000-000000000106', 'a1000000-0000-0000-0000-000000000001', 'product', 'gear', 'Refundable shirt', 'Physical product', 3000, null,
   null, null, true, 500, array[]::text[], '[]'::jsonb, 'everyone'),
  ('a1000000-0000-0000-0000-000000000107', 'a1000000-0000-0000-0000-000000000001', 'download', 'ebook', 'Public free download', 'Free file', null, null,
   'a1000000-0000-0000-0000-000000000001/free.pdf', 'free.pdf', true, 0, array[]::text[], '[]'::jsonb, 'everyone'),
  ('a1000000-0000-0000-0000-000000000108', 'a1000000-0000-0000-0000-000000000001', 'link', 'supplements', 'Premium supplements', 'Premium-only listing', 1200, 'https://shop.example.test/supplements',
   null, null, true, 0, array[]::text[], '[]'::jsonb, 'premium'),
  ('a1000000-0000-0000-0000-000000000109', 'a1000000-0000-0000-0000-000000000001', 'link', 'doctor_network', 'Premium doctors', 'Premium-only listing', 1200, 'https://shop.example.test/doctors',
   null, null, true, 0, array[]::text[], '[]'::jsonb, 'premium'),
  ('a1000000-0000-0000-0000-000000000110', 'a1000000-0000-0000-0000-000000000001', 'link', 'other', 'Legacy other row', 'Not public inventory', 1200, 'https://shop.example.test/other',
   null, null, true, 0, array[]::text[], '[]'::jsonb, 'everyone'),
  ('a1000000-0000-0000-0000-000000000111', 'a1000000-0000-0000-0000-000000000001', 'paid', 'supplements', 'Premium paid guide', 'Premium-only download', 1200, null,
   'a1000000-0000-0000-0000-000000000001/supplements.pdf', 'supplements.pdf', true, 0, array[]::text[], '[]'::jsonb, 'premium'),
  ('a1000000-0000-0000-0000-000000000112', 'a1000000-0000-0000-0000-000000000001', 'preview', 'gear', 'Display-only preview', 'No checkout available', 2000, null,
   null, null, true, 0, array[]::text[], '[]'::jsonb, 'everyone');

update public.armory_items
set printful_sku = 'PREVIEW-MANUAL-REF', printful_sync_variant_id = '9007199254740993'
where id = 'a1000000-0000-0000-0000-000000000112';

-- Checkout snapshots are written only by the service role. Guest PII and file paths stay here;
-- purchases retain only a checkout_intent_id and the paid/order snapshot.
set local role service_role;
insert into public.armory_checkout_intents (
  id, item_id, member_id, guest_email, seller_id, item_title, item_kind, item_category,
  locale, price_cents, shipping_cents, fee_cents, currency, size, buyer_was_guest,
  file_path, file_name, printful_sku, printful_sync_variant_id, stripe_session_id, status
) values
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000106', null, 'guest@example.test', 'a1000000-0000-0000-0000-000000000001', 'Refundable shirt', 'product', 'gear', 'en', 3000, 500, 300, 'usd', null, true,
   null, null, null, null, 'cs_public_armory_refund_early', 'pending'),
  ('a2000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000104', 'a1000000-0000-0000-0000-000000000002', null, 'a1000000-0000-0000-0000-000000000001', 'Zero shipping shirt', 'product', 'gear', 'en', 2200, 0, 220, 'usd', null, false,
   null, null, null, null, 'cs_public_armory_zero_shipping', 'pending'),
  ('a2000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000103', 'a1000000-0000-0000-0000-000000000003', null, 'a1000000-0000-0000-0000-000000000001', 'Mapped shirt', 'product', 'gear', 'en', 4500, 600, 450, 'usd', 'S', false,
   null, null, 'GYM-S', '9007199254740993', 'cs_public_armory_variant_high', 'pending'),
  ('a2000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000103', 'a1000000-0000-0000-0000-000000000003', null, 'a1000000-0000-0000-0000-000000000001', 'Mapped shirt', 'product', 'gear', 'en', 4500, 600, 450, 'usd', 'M', false,
   null, null, 'GYM-M', '0000000000000000001', 'cs_public_armory_variant_leading_zero', 'pending'),
  ('a2000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000101', 'a1000000-0000-0000-0000-000000000005', null, 'a1000000-0000-0000-0000-000000000001', 'Public paid ebook', 'paid', 'ebook', 'en', 1800, 0, 180, 'usd', null, false,
   'a1000000-0000-0000-0000-000000000001/ebook.pdf', 'ebook.pdf', null, null, 'cs_public_armory_deleted_member', 'pending');
reset role;

-- The public projection is a fixed, intentionally small list of safe catalog fields.
select is(
  (select array_agg(column_name::text order by ordinal_position)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'public_armory_catalog'),
  array['id','coach_id','seller_label','kind','category','title','description','price_cents','buy_url','sizes','shipping_cents','image_path','made_to_order','delivery_min_weeks','delivery_max_weeks','created_at','required_membership_tier']::text[],
  'anonymous catalog exposes only the approved public projection'
);
select is(
  (select array_agg(id::text order by id::text) from public.public_armory_catalog),
  array[
    'a1000000-0000-0000-0000-000000000101',
    'a1000000-0000-0000-0000-000000000102',
    'a1000000-0000-0000-0000-000000000103',
    'a1000000-0000-0000-0000-000000000104',
    'a1000000-0000-0000-0000-000000000106',
    'a1000000-0000-0000-0000-000000000112'
  ]::text[],
  'catalog filters hidden, free-download, Premium, and legacy rows while retaining display previews'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'purchases'
      and column_name = any(array[
        'guest_email', 'guest_locale', 'locale', 'buyer_was_guest', 'guest_item_id',
        'guest_download_path', 'guest_download_name', 'stripe_payment_intent_id',
        'file_path', 'file_name', 'guest_confirmation_sent_at', 'guest_confirmation_claimed_at'
      ])
  ),
  'purchases contains no guest identity, payment-intent, or private download columns'
);
select ok(
  has_table_privilege('anon', 'public.public_armory_catalog', 'SELECT')
  and not has_table_privilege('anon', 'public.armory_items', 'SELECT')
  and not has_table_privilege('anon', 'public.armory_checkout_intents', 'SELECT')
  and not has_table_privilege('anon', 'public.purchases', 'SELECT'),
  'anonymous users can read only the public catalog projection'
);
select ok(
  not has_table_privilege('service_role', 'public.armory_items', 'SELECT')
  and (
    select bool_and(has_column_privilege('service_role', 'public.armory_items', needed.column_name, 'SELECT'))
    from unnest(array[
      'id', 'coach_id', 'kind', 'category', 'title', 'price_cents', 'file_path', 'file_name',
      'sizes', 'shipping_cents', 'visible_to_all', 'printful_sku', 'printful_sync_variant_id',
      'printful_variant_mappings', 'updated_at'
    ]::text[]) as needed(column_name)
  )
  and not has_column_privilege('service_role', 'public.armory_items', 'description', 'SELECT')
  and not has_column_privilege('anon', 'public.armory_items', 'file_path', 'SELECT'),
  'service snapshot access is limited to its required columns and remains unavailable to browser roles'
);
select ok(
  not has_table_privilege('authenticated', 'public.armory_checkout_intents', 'SELECT')
  and has_table_privilege('service_role', 'public.armory_checkout_intents', 'SELECT'),
  'checkout intents remain service-role-only'
);
select ok(
  not has_function_privilege('anon', 'public.record_armory_checkout_purchase(uuid,text,text,integer,integer,text,text,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_armory_checkout_purchase(uuid,text,text,integer,integer,text,text,text,jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.record_armory_checkout_purchase(uuid,text,text,integer,integer,text,text,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.mark_armory_payment_refunded(text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.mark_armory_payment_refunded(text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.mark_armory_payment_refunded(text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.claim_armory_guest_confirmation(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.claim_armory_guest_confirmation(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.claim_armory_guest_confirmation(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.finish_armory_guest_confirmation(uuid,boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.finish_armory_guest_confirmation(uuid,boolean)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.finish_armory_guest_confirmation(uuid,boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.bind_armory_checkout_session(uuid,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.bind_armory_checkout_session(uuid,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.bind_armory_checkout_session(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_armory_checkout_intent(uuid,uuid,uuid,text,text,text,integer,timestamptz,integer,integer,text,text,text,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.create_armory_checkout_intent(uuid,uuid,uuid,text,text,text,integer,timestamptz,integer,integer,text,text,text,text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.create_armory_checkout_intent(uuid,uuid,uuid,text,text,text,integer,timestamptz,integer,integer,text,text,text,text,text)', 'EXECUTE'),
  'payment and guest-confirmation RPCs are service-role-only'
);

set local role service_role;
select ok(
  (select length(to_jsonb(snapshot)::text) > 0
   from (
     select id, coach_id, kind, category, title, price_cents, file_path, file_name, sizes,
       shipping_cents, visible_to_all, printful_sku, printful_sync_variant_id,
       printful_variant_mappings, updated_at
     from public.armory_items
     where id = 'a1000000-0000-0000-0000-000000000101'
   ) as snapshot),
  'service role can execute the exact private item snapshot SELECT used by Checkout'
);
reset role;

set local role anon;
select is(
  (select array_agg(id::text order by id::text) from public.public_armory_catalog),
  array[
    'a1000000-0000-0000-0000-000000000101',
    'a1000000-0000-0000-0000-000000000102',
    'a1000000-0000-0000-0000-000000000103',
    'a1000000-0000-0000-0000-000000000104',
    'a1000000-0000-0000-0000-000000000106',
    'a1000000-0000-0000-0000-000000000112'
  ]::text[],
  'anonymous visitor sees eligible display previews without checkout capability'
);
select throws_ok($$select id from public.armory_items$$, '42501', null, 'anonymous users cannot query source inventory');
select throws_ok($$select id from public.armory_checkout_intents$$, '42501', null, 'anonymous users cannot query checkout snapshots');
select throws_ok($$select id from public.purchases$$, '42501', null, 'anonymous users cannot query purchases');
select throws_ok(
  $$select * from public.record_armory_checkout_purchase(null, null, null, null, null, null, null, null, null)$$,
  '42501', null, 'anonymous users cannot invoke the payment recorder'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select id from public.armory_checkout_intents$$, '42501', null, 'signed-in users cannot query private checkout snapshots');
select throws_ok($$select public.claim_armory_guest_confirmation(null::uuid)$$, '42501', null, 'signed-in users cannot claim guest notices');
select ok(exists (select 1 from public.armory_items where id = 'a1000000-0000-0000-0000-000000000105'), 'owner retains access to a private item');
select ok(exists (select 1 from public.armory_items where id = 'a1000000-0000-0000-0000-000000000110'), 'owner retains access to legacy inventory');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}';
select ok(exists (select 1 from public.armory_items where id = 'a1000000-0000-0000-0000-000000000105'), 'linked regular member retains access to coach-shared private inventory');
select ok(not exists (select 1 from public.armory_items where id = 'a1000000-0000-0000-0000-000000000108'), 'regular member cannot see Premium supplements');
select ok(not exists (select 1 from public.armory_items where id = 'a1000000-0000-0000-0000-000000000109'), 'regular member cannot see Premium doctor-network inventory');
select ok(not exists (select 1 from public.armory_items where id = 'a1000000-0000-0000-0000-000000000110'), 'regular member cannot see legacy Other inventory');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-000000000004","role":"authenticated"}';
select ok(not exists (select 1 from public.armory_items where id = 'a1000000-0000-0000-0000-000000000105'), 'unlinked regular member cannot see private coach inventory');
select ok(exists (select 1 from public.armory_items where id = 'a1000000-0000-0000-0000-000000000101'), 'regular member retains access to eligible public paid items');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select ok(exists (select 1 from public.armory_items where id = 'a1000000-0000-0000-0000-000000000108'), 'Premium member retains access to supplements');
select ok(exists (select 1 from public.armory_items where id = 'a1000000-0000-0000-0000-000000000109'), 'Premium member retains access to doctor-network inventory');
select ok(not exists (select 1 from public.armory_items where id = 'a1000000-0000-0000-0000-000000000110'), 'Premium membership does not expose legacy Other inventory');
reset role;

-- Invalid webhook identities and totals produce no ledger row.
set local role service_role;
select is(
  public.create_armory_checkout_intent(
    'a2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000101',
    null, 'guest@example.test', 'en', null, 180,
    transaction_timestamp(),
    1800, 0, 'Public paid ebook', 'paid', 'ebook',
    'a1000000-0000-0000-0000-000000000001/ebook.pdf', 'ebook.pdf'
  ),
  true, 'eligible public guest checkout creates an intent from the locked item snapshot'
);
select is(
  (select coalesce(member_id::text, '<null>') || ':' || buyer_was_guest::text || ':' || guest_email || ':' || seller_id::text || ':' || item_title || ':' || item_kind || ':' || item_category || ':' || locale || ':' || price_cents::text || ':' || shipping_cents::text || ':' || fee_cents::text || ':' || currency || ':' || coalesce(size, '<null>') || ':' || file_path || ':' || file_name || ':' || status || ':' || coalesce(stripe_session_id, '<null>') || ':' || coalesce(stripe_payment_intent_id, '<null>')
   from public.armory_checkout_intents where id = 'a2000000-0000-0000-0000-000000000002'),
  '<null>:true:guest@example.test:a1000000-0000-0000-0000-000000000001:Public paid ebook:paid:ebook:en:1800:0:180:usd:<null>:a1000000-0000-0000-0000-000000000001/ebook.pdf:ebook.pdf:pending:<null>:<null>',
  'intent preserves exact paid price, fee, guest identity, and private file snapshot'
);
select is(
  public.create_armory_checkout_intent(
    'a2000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000101',
    null, 'guest@example.test', 'en', null, 180,
    transaction_timestamp(),
    1799, 0, 'Public paid ebook', 'paid', 'ebook',
    'a1000000-0000-0000-0000-000000000001/ebook.pdf', 'ebook.pdf'
  ),
  false, 'stale item price is rejected before intent insertion'
);
select is(
  (select count(*)::int from public.armory_checkout_intents where id = 'a2000000-0000-0000-0000-000000000007'),
  0, 'rejected stale price leaves no checkout intent'
);
select is(
  public.create_armory_checkout_intent(
    'a2000000-0000-0000-0000-000000000008', 'a1000000-0000-0000-0000-000000000111',
    null, 'guest@example.test', 'en', null, 120,
    transaction_timestamp(),
    1200, 0, 'Premium paid guide', 'paid', 'supplements',
    'a1000000-0000-0000-0000-000000000001/supplements.pdf', 'supplements.pdf'
  ),
  false, 'guest cannot start checkout for Premium inventory'
);
select is(
  (select count(*)::int from public.armory_checkout_intents where id = 'a2000000-0000-0000-0000-000000000008'),
  0, 'ineligible guest checkout leaves no intent'
);
select is(
  public.create_armory_checkout_intent(
    'a2000000-0000-0000-0000-000000000011', 'a1000000-0000-0000-0000-000000000112',
    null, 'guest@example.test', 'en', null, 200,
    transaction_timestamp(),
    2000, 0, 'Display-only preview', 'preview', 'gear', null, null
  ),
  false, 'display-only preview cannot create a checkout intent'
);
reset role;
select ok(
  exists (
    select 1 from public.armory_items
    where id = 'a1000000-0000-0000-0000-000000000112'
      and printful_sku = 'PREVIEW-MANUAL-REF'
      and printful_sync_variant_id = '9007199254740993'
  )
  and not exists (select 1 from public.armory_checkout_intents where id = 'a2000000-0000-0000-0000-000000000011'),
  'preview keeps exact private manual variant references without becoming checkoutable'
);
set local role service_role;
select is(
  public.create_armory_checkout_intent(
    'a2000000-0000-0000-0000-000000000009', 'a1000000-0000-0000-0000-000000000105',
    'a1000000-0000-0000-0000-000000000002', null, 'en', null, 160,
    transaction_timestamp(),
    1600, 0, 'Coach hidden paid', 'paid', 'ebook',
    'a1000000-0000-0000-0000-000000000001/private.pdf', 'private.pdf'
  ),
  true, 'linked regular member can create a paid intent for coach-shared inventory'
);
select is(
  public.create_armory_checkout_intent(
    'a2000000-0000-0000-0000-000000000010', 'a1000000-0000-0000-0000-000000000105',
    'a1000000-0000-0000-0000-000000000004', null, 'en', null, 160,
    transaction_timestamp(),
    1600, 0, 'Coach hidden paid', 'paid', 'ebook',
    'a1000000-0000-0000-0000-000000000001/private.pdf', 'private.pdf'
  ),
  false, 'unlinked regular member cannot create a paid intent for private inventory'
);
select is(
  (select count(*)::int from public.armory_checkout_intents where id = 'a2000000-0000-0000-0000-000000000010'),
  0, 'private-inventory rejection leaves no checkout intent'
);
select is(
  public.bind_armory_checkout_session('a2000000-0000-0000-0000-000000000002', 'cs_public_armory_guest_download'),
  true, 'webhook can bind the session before checkout observes the response'
);
select is(
  public.bind_armory_checkout_session('a2000000-0000-0000-0000-000000000002', 'cs_public_armory_guest_download'),
  true, 'retry after a lost bind response succeeds for the same session'
);
select is(
  public.bind_armory_checkout_session('a2000000-0000-0000-0000-000000000002', 'cs_other_checkout_session'),
  false, 'a different session cannot replace the intent binding'
);
select is(
  (select stripe_session_id from public.armory_checkout_intents where id = 'a2000000-0000-0000-0000-000000000002'),
  'cs_public_armory_guest_download', 'mismatched session leaves the canonical binding unchanged'
);
select is(
  (select count(*)::int from public.record_armory_checkout_purchase('a2000000-0000-0000-0000-000000000002', 'cs_wrong_session', 'pi_wrong_session', 1800, 0, 'usd', 'guest@example.test', null, null)),
  0, 'a session not bound to the intent is rejected'
);
select is(
  (select count(*)::int from public.record_armory_checkout_purchase('a2000000-0000-0000-0000-000000000002', 'cs_public_armory_guest_download', 'pi_wrong_amount', 1799, 0, 'usd', 'guest@example.test', null, null)),
  0, 'a paid amount that differs from the immutable intent is rejected'
);
select is(
  (select count(*)::int from public.record_armory_checkout_purchase('a2000000-0000-0000-0000-000000000001', 'cs_public_armory_refund_early', 'pi_wrong_shipping', 3500, 499, 'usd', 'guest@example.test', 'Guest Buyer', '{"line1":"1 Main St","city":"Austin","state":"TX","postal_code":"78701","country":"US"}')),
  0, 'shipping total that differs from the product intent is rejected'
);
select is(
  (select count(*)::int from public.record_armory_checkout_purchase('a2000000-0000-0000-0000-000000000002', 'cs_public_armory_guest_download', 'pi_wrong_email', 1800, 0, 'usd', 'different@example.test', null, null)),
  0, 'a guest email that differs from the intent is rejected'
);
select is(
  (select count(*)::int from public.record_armory_checkout_purchase('a2000000-0000-0000-0000-000000000002', 'cs_public_armory_guest_download', 'pi_wrong_currency', 1800, 0, 'eur', 'guest@example.test', null, null)),
  0, 'non-USD settlement is rejected for a USD intent'
);

select is(
  (select inserted::text || ':' || refunded::text
   from public.record_armory_checkout_purchase('a2000000-0000-0000-0000-000000000002', 'cs_public_armory_guest_download', 'pi_public_armory_guest_download', 1800, 0, 'usd', 'guest@example.test', null, null)),
  'true:false', 'verified guest payment creates one non-refunded ledger row'
);
select is(
  public.claim_armory_guest_confirmation((select id from public.purchases where checkout_intent_id = 'a2000000-0000-0000-0000-000000000002')),
  true, 'eligible guest purchase can claim its confirmation once'
);
select is(
  public.claim_armory_guest_confirmation((select id from public.purchases where checkout_intent_id = 'a2000000-0000-0000-0000-000000000002')),
  false, 'duplicate guest confirmation claim is rejected while already claimed'
);

select is(
  public.mark_armory_payment_refunded('pi_public_armory_refund_early', 'ch_public_armory_refund_early')::text,
  null::text, 'refund arriving before payment records a marker without inventing a purchase'
);
select is(
  (select inserted::text || ':' || refunded::text
   from public.record_armory_checkout_purchase('a2000000-0000-0000-0000-000000000001', 'cs_public_armory_refund_early', 'pi_public_armory_refund_early', 3500, 500, 'usd', 'guest@example.test', 'Guest Buyer', '{"line1":"1 Main St","city":"Austin","state":"TX","postal_code":"78701","country":"US"}')),
  'true:true', 'late payment after an earlier refund is created already refunded'
);
select ok(
  exists (
    select 1 from public.purchases
    where checkout_intent_id = 'a2000000-0000-0000-0000-000000000001'
      and refunded_at is not null and fulfillment_status = 'cancelled'
  ),
  'refunded physical order is cancelled before it can enter shipping'
);
select is(
  (select inserted::text || ':' || refunded::text
   from public.record_armory_checkout_purchase('a2000000-0000-0000-0000-000000000001', 'cs_public_armory_refund_early', 'pi_public_armory_refund_early', 3500, 500, 'usd', 'guest@example.test', 'Guest Buyer', '{"line1":"1 Main St","city":"Austin","state":"TX","postal_code":"78701","country":"US"}')),
  'false:true', 'duplicate paid delivery preserves the cancelled refunded order'
);
select is(
  (select count(*)::int from public.purchases where checkout_intent_id = 'a2000000-0000-0000-0000-000000000001'),
  1, 'duplicate paid delivery does not create a second physical order'
);
select is(
  public.mark_armory_payment_refunded('pi_public_armory_refund_early', 'ch_public_armory_refund_early')::text,
  (select id::text from public.purchases where checkout_intent_id = 'a2000000-0000-0000-0000-000000000001'),
  'refund after settlement resolves to the linked purchase'
);

select lives_ok(
  $$select * from public.record_armory_checkout_purchase('a2000000-0000-0000-0000-000000000003', 'cs_public_armory_zero_shipping', 'pi_public_armory_zero_shipping', 2200, 0, 'usd', null, 'Regular Buyer', '{"line1":"2 Main St","city":"Denver","state":"CO","postal_code":"80202","country":"US"}')$$,
  'zero-shipping physical checkout settles'
);
select ok(
  exists (
    select 1 from public.purchases
    where checkout_intent_id = 'a2000000-0000-0000-0000-000000000003'
      and fulfillment_status = 'to_ship' and shipping_cents = 0
      and shipping_name = 'Regular Buyer' and shipping_address->>'postal_code' = '80202'
  ),
  'zero shipping still preserves the physical order destination'
);

select lives_ok(
  $$select * from public.record_armory_checkout_purchase('a2000000-0000-0000-0000-000000000004', 'cs_public_armory_variant_high', 'pi_public_armory_variant_high', 5100, 600, 'usd', null, 'Premium Buyer', '{"line1":"3 Main St","city":"Denver","state":"CO","postal_code":"80202","country":"US"}')$$,
  'high-precision Printful product settles'
);
select lives_ok(
  $$select * from public.record_armory_checkout_purchase('a2000000-0000-0000-0000-000000000005', 'cs_public_armory_variant_leading_zero', 'pi_public_armory_variant_leading_zero', 5100, 600, 'usd', null, 'Premium Buyer', '{"line1":"3 Main St","city":"Denver","state":"CO","postal_code":"80202","country":"US"}')$$,
  'leading-zero Printful product settles'
);
select is(
  (select printful_sku || ':' || printful_sync_variant_id
   from public.purchases where checkout_intent_id = 'a2000000-0000-0000-0000-000000000004'),
  'GYM-S:9007199254740993', 'large Printful text ID survives the order snapshot exactly'
);
select is(
  (select printful_sku || ':' || printful_sync_variant_id
   from public.purchases where checkout_intent_id = 'a2000000-0000-0000-0000-000000000005'),
  'GYM-M:0000000000000000001', 'leading zeroes survive the Printful order snapshot exactly'
);
reset role;
select lives_ok(
  $test$
  do $block$
  begin
    begin
      insert into public.armory_items (coach_id, kind, category, title, price_cents, sizes, printful_variant_mappings, required_membership_tier)
      values ('a1000000-0000-0000-0000-000000000001', 'product', 'gear', 'Wrong option mapping', 2000, array['S','M'], '[{"option":"XL","sku":"BAD-XL","sync_variant_id":"1"},{"option":"M","sku":"GYM-M","sync_variant_id":"2"}]'::jsonb, 'everyone');
      raise exception 'out-of-set Printful option was accepted';
    exception when check_violation then null;
    end;

    begin
      insert into public.armory_items (coach_id, kind, category, title, price_cents, sizes, printful_variant_mappings, required_membership_tier)
      values ('a1000000-0000-0000-0000-000000000001', 'product', 'gear', 'Incomplete mapping', 2000, array['S','M'], '[{"option":"S","sku":"ONLY-S","sync_variant_id":"1"}]'::jsonb, 'everyone');
      raise exception 'incomplete Printful size map was accepted';
    exception when check_violation then null;
    end;

    begin
      insert into public.armory_items (coach_id, kind, category, title, price_cents, sizes, printful_variant_mappings, required_membership_tier)
      values ('a1000000-0000-0000-0000-000000000001', 'product', 'gear', 'Numeric JSON variant', 2000, array['S'], '[{"option":"S","sku":"NUMERIC-ID","sync_variant_id":9007199254740993}]'::jsonb, 'everyone');
      raise exception 'numeric JSON Printful ID was accepted';
    exception when check_violation then null;
    end;
  end
  $block$;
  $test$,
  'invalid size maps and non-string high-precision JSON IDs are rejected'
);
select ok(
  private.valid_armory_printful_mappings(
    (select jsonb_agg(jsonb_build_object('option', 'SIZE-' || idx::text, 'sku', 'SKU-' || idx::text, 'sync_variant_id', idx::text) order by idx)
     from generate_series(1, 100) as generated(idx)),
    (select array_agg('SIZE-' || idx::text order by idx) from generate_series(1, 100) as generated(idx))
  )
  and not private.valid_armory_printful_mappings(
    (select jsonb_agg(jsonb_build_object('option', 'SIZE-' || idx::text, 'sku', 'SKU-' || idx::text, 'sync_variant_id', idx::text) order by idx)
     from generate_series(1, 101) as generated(idx)),
    (select array_agg('SIZE-' || idx::text order by idx) from generate_series(1, 101) as generated(idx))
  ),
  'Printful mapping validator accepts one hundred string mappings and rejects one hundred one'
);
set local role service_role;

reset role;
select lives_ok(
  $$delete from auth.users where id = 'a1000000-0000-0000-0000-000000000005'$$,
  'a pending checkout does not block account deletion'
);
select is(
  (select count(*)::int from public.profiles where id = 'a1000000-0000-0000-0000-000000000005'),
  0, 'deleted member profile is removed'
);
select is(
  (select coalesce(member_id::text, '<null>') || ':' || buyer_was_guest::text || ':' || coalesce(guest_email, '<null>')
   from public.armory_checkout_intents where id = 'a2000000-0000-0000-0000-000000000006'),
  '<null>:false:<null>', 'deleted member intent stays accountless and non-guest'
);
set local role service_role;
select is(
  (select inserted::text || ':' || refunded::text
   from public.record_armory_checkout_purchase('a2000000-0000-0000-0000-000000000006', 'cs_public_armory_deleted_member', 'pi_public_armory_deleted_member', 1800, 0, 'usd', null, null, null)),
  'true:false', 'settlement after deletion retains the paid ledger entry'
);
select ok(
  exists (
    select 1 from public.purchases
    where checkout_intent_id = 'a2000000-0000-0000-0000-000000000006'
      and member_id is null and item_title = 'Public paid ebook'
  ),
  'post-deletion payment remains linked to its private intent without a member account'
);
select is(
  public.claim_armory_guest_confirmation((select id from public.purchases where checkout_intent_id = 'a2000000-0000-0000-0000-000000000006')),
  false, 'deleted member purchase cannot become a guest claim'
);
select is(
  public.mark_armory_payment_refunded('pi_public_armory_deleted_member', 'ch_public_armory_deleted_member')::text,
  (select id::text from public.purchases where checkout_intent_id = 'a2000000-0000-0000-0000-000000000006'),
  'accountless paid purchase remains resolvable for refund handling'
);

-- Deleting the live catalog row must not erase the checkout intent's canonical item identity.
-- These rows are inserted after catalog projection assertions so they do not change that fixture.
reset role;
insert into public.armory_items (
  id, coach_id, kind, category, title, description, price_cents, visible_to_all,
  shipping_cents, file_path, file_name, sizes, printful_variant_mappings, required_membership_tier
) values
  ('a1000000-0000-0000-0000-000000000113', 'a1000000-0000-0000-0000-000000000001', 'paid', 'ebook', 'Delete before settlement', 'Synthetic deletion-order fixture', 1800, true,
   0, 'a1000000-0000-0000-0000-000000000001/delete-before.pdf', 'delete-before.pdf', array[]::text[], '[]'::jsonb, 'everyone'),
  ('a1000000-0000-0000-0000-000000000114', 'a1000000-0000-0000-0000-000000000001', 'paid', 'ebook', 'Delete after settlement', 'Synthetic deletion-order fixture', 2100, true,
   0, 'a1000000-0000-0000-0000-000000000001/delete-after.pdf', 'delete-after.pdf', array[]::text[], '[]'::jsonb, 'everyone');

set local role service_role;
select is(
  public.create_armory_checkout_intent(
    'a2000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000113', null,
    'delete-before@example.test', 'en', null, 180,
    transaction_timestamp(),
    1800, 0, 'Delete before settlement', 'paid', 'ebook',
    'a1000000-0000-0000-0000-000000000001/delete-before.pdf', 'delete-before.pdf'
  ),
  true, 'guest snapshot is created before deleting its catalog item'
);
select is(
  public.bind_armory_checkout_session('a2000000-0000-0000-0000-000000000007', 'cs_public_armory_delete_before'),
  true, 'delete-before intent binds its exact Checkout session'
);
reset role;
select lives_ok(
  $$delete from public.armory_items where id = 'a1000000-0000-0000-0000-000000000113'$$,
  'catalog item is deleted before its paid webhook settles'
);
set local role service_role;
select is(
  (select inserted::text || ':' || refunded::text
   from public.record_armory_checkout_purchase(
     'a2000000-0000-0000-0000-000000000007', 'cs_public_armory_delete_before',
     'pi_public_armory_delete_before', 1800, 0, 'usd', 'delete-before@example.test', null, null
   )),
  'true:false', 'payment settles after the original catalog item has been deleted'
);
select is(
  (select coalesce(item_id::text, '<null>') || ':' || checkout_intent_id::text || ':' || coalesce(member_id::text, '<null>')
   from public.purchases where checkout_intent_id = 'a2000000-0000-0000-0000-000000000007'),
  '<null>:a2000000-0000-0000-0000-000000000007:<null>', 'pre-settlement deletion keeps a null live FK and exact guest intent link'
);
select is(
  (select item_id::text || ':' || file_path || ':' || file_name || ':' || buyer_was_guest::text || ':' || guest_email
   from public.armory_checkout_intents where id = 'a2000000-0000-0000-0000-000000000007'),
  'a1000000-0000-0000-0000-000000000113:a1000000-0000-0000-0000-000000000001/delete-before.pdf:delete-before.pdf:true:delete-before@example.test',
  'pre-settlement deletion preserves original guest identity and private file snapshot'
);
select is(
  (select inserted::text || ':' || refunded::text
   from public.record_armory_checkout_purchase(
     'a2000000-0000-0000-0000-000000000007', 'cs_public_armory_delete_before',
     'pi_public_armory_delete_before', 1800, 0, 'usd', 'delete-before@example.test', null, null
   )),
  'false:false', 'replayed payment after deletion is idempotent'
);
reset role;
select ok(
  not exists (select 1 from public.armory_items where id = 'a1000000-0000-0000-0000-000000000113')
  and (select count(*) = 1 from public.purchases where checkout_intent_id = 'a2000000-0000-0000-0000-000000000007'),
  'settlement does not recreate the deleted catalog row or duplicate its purchase'
);
set local role service_role;

select is(
  public.create_armory_checkout_intent(
    'a2000000-0000-0000-0000-000000000008', 'a1000000-0000-0000-0000-000000000114',
    'a1000000-0000-0000-0000-000000000002', null, 'en', null, 210,
    transaction_timestamp(),
    2100, 0, 'Delete after settlement', 'paid', 'ebook',
    'a1000000-0000-0000-0000-000000000001/delete-after.pdf', 'delete-after.pdf'
  ),
  true, 'member snapshot is created before normal settlement'
);
select is(
  public.bind_armory_checkout_session('a2000000-0000-0000-0000-000000000008', 'cs_public_armory_delete_after'),
  true, 'delete-after intent binds its exact Checkout session'
);
select is(
  (select inserted::text || ':' || refunded::text
   from public.record_armory_checkout_purchase(
     'a2000000-0000-0000-0000-000000000008', 'cs_public_armory_delete_after',
     'pi_public_armory_delete_after', 2100, 0, 'usd', null, null, null
   )),
  'true:false', 'member payment settles while its catalog item is live'
);
select is(
  (select item_id::text || ':' || checkout_intent_id::text || ':' || member_id::text
   from public.purchases where checkout_intent_id = 'a2000000-0000-0000-0000-000000000008'),
  'a1000000-0000-0000-0000-000000000114:a2000000-0000-0000-0000-000000000008:a1000000-0000-0000-0000-000000000002',
  'pre-delete purchase references the live item and preserves the member identity'
);
reset role;
select lives_ok(
  $$delete from public.armory_items where id = 'a1000000-0000-0000-0000-000000000114'$$,
  'catalog item is deleted after paid settlement'
);
set local role service_role;
select is(
  (select coalesce(purchase.item_id::text, '<null>') || ':' || purchase.checkout_intent_id::text || ':' || purchase.member_id::text || ':' || intent.item_id::text || ':' || intent.file_path
   from public.purchases as purchase
   join public.armory_checkout_intents as intent on intent.id = purchase.checkout_intent_id
   where purchase.checkout_intent_id = 'a2000000-0000-0000-0000-000000000008'),
  '<null>:a2000000-0000-0000-0000-000000000008:a1000000-0000-0000-0000-000000000002:a1000000-0000-0000-0000-000000000114:a1000000-0000-0000-0000-000000000001/delete-after.pdf',
  'post-settlement deletion nulls only the live FK while preserving exact intent and file identity'
);
select is(
  (select inserted::text || ':' || refunded::text
   from public.record_armory_checkout_purchase(
     'a2000000-0000-0000-0000-000000000008', 'cs_public_armory_delete_after',
     'pi_public_armory_delete_after', 2100, 0, 'usd', null, null, null
   )),
  'false:false', 'replayed payment after post-settlement deletion is idempotent'
);
reset role;
select ok(
  not exists (select 1 from public.armory_items where id = 'a1000000-0000-0000-0000-000000000114')
  and (select count(*) = 1 from public.purchases where checkout_intent_id = 'a2000000-0000-0000-0000-000000000008'),
  'post-settlement replay neither recreates the deleted item nor duplicates the purchase'
);

reset role;
select * from finish();
rollback;
