begin;
select plan(5);

insert into auth.users (id, email, raw_user_meta_data) values
  ('90000000-0000-0000-0000-000000000002', 'refund-coach@example.test', '{"display_name":"Coach"}'),
  ('90000000-0000-0000-0000-000000000004', 'refund-buyer@example.test', '{"display_name":"Buyer"}');
update public.profiles set role = 'coach' where id = '90000000-0000-0000-0000-000000000002';

insert into public.armory_items (id, coach_id, kind, category, title, price_cents, shipping_cents)
values ('90000000-0000-0000-0000-0000000000a1', '90000000-0000-0000-0000-000000000002', 'product', 'gear', 'Tee', 3000, 500);
insert into public.purchases (id, item_id, member_id, seller_id, item_title, amount_cents, fee_cents, stripe_session_id,
                              shipping_cents, fulfillment_status)
values ('90000000-0000-0000-0000-0000000000b1', '90000000-0000-0000-0000-0000000000a1',
        '90000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-000000000002',
        'Tee', 3500, 300, 'cs_refund_1', 500, 'to_ship');

-- The server records the refund and cancels the unshipped order
set local role service_role;
select lives_ok(
  $$update public.purchases set refunded_at = now(), fulfillment_status = 'cancelled'
    where id = '90000000-0000-0000-0000-0000000000b1'$$,
  'the server can record a refund and cancel the order'
);
reset role;
select is(
  (select fulfillment_status from public.purchases where id = '90000000-0000-0000-0000-0000000000b1'),
  'cancelled',
  'the refunded order is cancelled'
);

-- Nobody else can record a refund
set local role authenticated;
set local request.jwt.claims = '{"sub":"90000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$update public.purchases set refunded_at = null$$,
  '42501',
  null,
  'a seller cannot change refund records directly'
);
select throws_ok(
  $$select public.mark_order_shipped('90000000-0000-0000-0000-0000000000b1', 'TRACK')$$,
  'P0002',
  'Order not found',
  'a refunded order cannot be marked shipped'
);
reset role;

select throws_ok(
  $$update public.purchases set fulfillment_status = 'lost' where id = '90000000-0000-0000-0000-0000000000b1'$$,
  '23514',
  null,
  'only known order statuses are allowed'
);

select * from finish();
rollback;
