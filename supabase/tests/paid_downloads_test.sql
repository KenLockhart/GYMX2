begin;
select plan(12);

insert into auth.users (id, email, raw_user_meta_data) values
  ('60000000-0000-0000-0000-000000000001', 'pay-admin@example.test', '{"display_name":"Admin"}'),
  ('60000000-0000-0000-0000-000000000002', 'pay-coach@example.test', '{"display_name":"Coach"}'),
  ('60000000-0000-0000-0000-000000000003', 'pay-rival@example.test', '{"display_name":"Rival"}'),
  ('60000000-0000-0000-0000-000000000004', 'pay-buyer@example.test', '{"display_name":"Buyer"}'),
  ('60000000-0000-0000-0000-000000000005', 'pay-other@example.test', '{"display_name":"Other"}');

update public.profiles set role = 'admin' where id = '60000000-0000-0000-0000-000000000001';
update public.profiles set role = 'coach'
where id in ('60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000003');

insert into public.coach_members (coach_id, member_id) values
  ('60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000004'),
  ('60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000005');

-- The server records a coach's Stripe account and a completed sale
insert into public.payout_accounts (coach_id, stripe_account_id, charges_enabled, payouts_enabled)
values ('60000000-0000-0000-0000-000000000002', 'acct_test123', true, true);

-- A coach lists a paid ebook
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok(
  $$insert into public.armory_items (coach_id, kind, title, price_cents, file_path, file_name)
    values ('60000000-0000-0000-0000-000000000002', 'paid', 'Program',
            1999, '60000000-0000-0000-0000-000000000002/program.pdf', 'program.pdf')$$,
  'a coach can list a paid download'
);
select throws_ok(
  $$insert into public.armory_items (coach_id, kind, title, price_cents, file_path, file_name)
    values ('60000000-0000-0000-0000-000000000002', 'paid', 'Too cheap', 50,
            '60000000-0000-0000-0000-000000000002/cheap.pdf', 'cheap.pdf')$$,
  '23514',
  null,
  'a paid download costs at least $1'
);
select throws_ok(
  $$insert into public.armory_items (coach_id, kind, title, file_path, file_name)
    values ('60000000-0000-0000-0000-000000000002', 'paid', 'No price',
            '60000000-0000-0000-0000-000000000002/free.pdf', 'free.pdf')$$,
  '23514',
  null,
  'a paid download needs a price'
);
select is(
  (select stripe_account_id from public.payout_accounts),
  'acct_test123',
  'a coach can see their own payout account'
);
select throws_ok(
  $$update public.payout_accounts set charges_enabled = true$$,
  '42501',
  null,
  'a coach cannot change their payout status themselves'
);
reset role;

insert into public.purchases (item_id, member_id, seller_id, item_title, amount_cents, fee_cents, stripe_session_id)
values ((select id from public.armory_items where title = 'Program'), '60000000-0000-0000-0000-000000000004',
        '60000000-0000-0000-0000-000000000002', 'Program', 1999, 200, 'cs_test_1');

-- The buyer
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.purchases), 1, 'a buyer sees their purchase');
select throws_ok(
  $$insert into public.purchases (item_id, member_id, seller_id, item_title, amount_cents, fee_cents, stripe_session_id)
    values ((select id from public.armory_items where title = 'Program'), '60000000-0000-0000-0000-000000000004',
            '60000000-0000-0000-0000-000000000002', 'Program', 0, 0, 'cs_fake')$$,
  '42501',
  null,
  'a member cannot record a purchase themselves'
);
select is((select count(*)::int from public.payout_accounts), 0, 'a member cannot see coaches'' payout accounts');
reset role;

-- Another member who didn't buy
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-0000-0000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.purchases), 0, 'someone else cannot see the purchase');
reset role;

-- The seller and other coaches
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select sum(amount_cents - fee_cents)::int from public.purchases), 1799, 'the seller sees their sale and earnings');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.purchases), 0, 'another coach cannot see the sale');
reset role;

-- Admins see all sales
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.purchases), 1, 'an admin sees every sale');
reset role;

select * from finish();
rollback;
