begin;
select plan(12);

insert into auth.users (id, email, raw_user_meta_data) values
  ('80000000-0000-0000-0000-000000000001', 'gear-admin@example.test', '{"display_name":"Admin"}'),
  ('80000000-0000-0000-0000-000000000002', 'gear-coach@example.test', '{"display_name":"Coach"}'),
  ('80000000-0000-0000-0000-000000000003', 'gear-rival@example.test', '{"display_name":"Rival"}'),
  ('80000000-0000-0000-0000-000000000004', 'gear-buyer@example.test', '{"display_name":"Buyer"}');

update public.profiles set role = 'admin' where id = '80000000-0000-0000-0000-000000000001';
update public.profiles set role = 'coach'
where id in ('80000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000003');

-- A coach lists a shirt
set local role authenticated;
set local request.jwt.claims = '{"sub":"80000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok(
  $$insert into public.armory_items (coach_id, kind, category, title, price_cents, shipping_cents, sizes, visible_to_all)
    values ('80000000-0000-0000-0000-000000000002', 'product', 'gear', 'Shirt', 4995, 599,
            array['S', 'M', 'L'], true)$$,
  'a coach can list gear with sizes and a shipping fee'
);
select throws_ok(
  $$insert into public.armory_items (coach_id, kind, title, shipping_cents)
    values ('80000000-0000-0000-0000-000000000002', 'product', 'No price', 500)$$,
  '23514',
  null,
  'gear needs a price'
);
select throws_ok(
  $$insert into public.armory_items (coach_id, kind, title, price_cents, file_path, file_name)
    values ('80000000-0000-0000-0000-000000000002', 'product', 'With file', 1000,
            '80000000-0000-0000-0000-000000000002/x.png', 'x.png')$$,
  '23514',
  null,
  'gear has no download file'
);
select throws_ok(
  $$insert into public.armory_items (coach_id, kind, title, price_cents, sizes)
    values ('80000000-0000-0000-0000-000000000002', 'product', 'Blank size', 1000, array['M', ''])$$,
  '23514',
  null,
  'sizes cannot be blank'
);
select throws_ok(
  $$insert into public.armory_items (coach_id, kind, category, title, price_cents, file_path, file_name)
    values ('80000000-0000-0000-0000-000000000002', 'paid', 'gear', 'Shirt file', 1000,
            '80000000-0000-0000-0000-000000000002/shirt.png', 'shirt.png')$$,
  '23514',
  null,
  'gear can never be sold as a download'
);
reset role;

-- The server records an order after Stripe confirms payment
insert into public.purchases (item_id, member_id, seller_id, item_title, amount_cents, fee_cents, stripe_session_id,
                              size, shipping_cents, shipping_name, shipping_address, fulfillment_status)
values ((select id from public.armory_items where title = 'Shirt'), '80000000-0000-0000-0000-000000000004',
        '80000000-0000-0000-0000-000000000002', 'Shirt', 5594, 500, 'cs_gear_1',
        'M', 599, 'Buyer Person', '{"line1":"1 Main St","city":"Atlanta","state":"GA","postal_code":"30301","country":"US"}',
        'to_ship');

-- The buyer can see their order but not mark it shipped
set local role authenticated;
set local request.jwt.claims = '{"sub":"80000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select size from public.purchases), 'M', 'the buyer sees the size they ordered');
select throws_ok(
  $$select public.mark_order_shipped((select id from public.purchases), 'TRACK1')$$,
  'P0002',
  'Order not found',
  'a buyer cannot mark their own order shipped'
);
reset role;

-- Another coach cannot see or ship it
set local role authenticated;
set local request.jwt.claims = '{"sub":"80000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.purchases), 0, 'another coach cannot see the order or address');
reset role;

-- The seller ships it
set local role authenticated;
set local request.jwt.claims = '{"sub":"80000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(
  (select shipping_address->>'city' from public.purchases),
  'Atlanta',
  'the seller sees where to ship'
);
select lives_ok(
  $$select public.mark_order_shipped((select id from public.purchases), ' 1Z999AA10123456784 ')$$,
  'the seller can mark the order shipped'
);
select is(
  (select fulfillment_status || ':' || tracking_number from public.purchases),
  'shipped:1Z999AA10123456784',
  'the order shows as shipped with its tracking number'
);
select throws_ok(
  $$update public.purchases set fulfillment_status = 'to_ship'$$,
  '42501',
  null,
  'a seller cannot change an order directly'
);
reset role;

select * from finish();
rollback;
