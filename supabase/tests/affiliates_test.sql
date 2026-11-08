begin;
select plan(8);

insert into auth.users (id, email, raw_user_meta_data) values
  ('c0000000-0000-0000-0000-000000000001', 'aff-admin@example.test', '{"display_name":"Admin"}'),
  ('c0000000-0000-0000-0000-000000000002', 'aff-partner@example.test', '{"display_name":"Partner"}'),
  ('c0000000-0000-0000-0000-000000000003', 'aff-other@example.test', '{"display_name":"Other"}'),
  ('c0000000-0000-0000-0000-000000000004', 'aff-buyer@example.test', '{"display_name":"Buyer"}');
update public.profiles set role = 'admin' where id = 'c0000000-0000-0000-0000-000000000001';

-- The server records an affiliate, a referral and a commission
insert into public.affiliates (user_id, code, status) values ('c0000000-0000-0000-0000-000000000002', 'partner', 'approved');
insert into public.referrals (referred_user_id, affiliate_id, expires_at)
values ('c0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000002', now() + interval '12 months');
insert into public.commissions (affiliate_id, kind, referred_user_id, description, base_cents, rate, amount_cents, available_at)
values ('c0000000-0000-0000-0000-000000000002', 'signup', 'c0000000-0000-0000-0000-000000000004', 'Sign-up bonus', 0, '$5.00 flat', 500, now());

select throws_ok(
  $$insert into public.commissions (affiliate_id, kind, referred_user_id, description, base_cents, rate, amount_cents, available_at)
    values ('c0000000-0000-0000-0000-000000000002', 'signup', 'c0000000-0000-0000-0000-000000000004', 'Again', 0, 'x', 500, now())$$,
  '23505',
  null,
  'a referred person earns only one sign-up bonus'
);
select throws_ok(
  $$insert into public.affiliates (user_id, code) values ('c0000000-0000-0000-0000-000000000003', 'Bad Code!')$$,
  '23514',
  null,
  'link codes must be simple'
);

-- The affiliate sees their own numbers
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.commissions), 1, 'an affiliate sees their commissions');
select is((select count(*)::int from public.referrals), 1, 'an affiliate sees their referrals');
select throws_ok(
  $$update public.affiliates set sale_percent = 90$$,
  '42501',
  null,
  'an affiliate cannot change their own rates'
);
reset role;

-- Others see nothing; admins see everything
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.commissions), 0, 'someone else cannot see the commissions');
select is((select count(*)::int from public.affiliate_settings), 1, 'anyone signed in can read the program terms');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.affiliates), 1, 'an admin sees every affiliate');
reset role;

select * from finish();
rollback;
