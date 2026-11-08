begin;
select plan(6);

insert into auth.users (id, email, raw_user_meta_data) values
  ('d0000000-0000-0000-0000-000000000002', 'mem-free-coach@example.test', '{"display_name":"Free Coach"}'),
  ('d0000000-0000-0000-0000-000000000003', 'mem-paid-coach@example.test', '{"display_name":"Paid Coach"}'),
  ('d0000000-0000-0000-0000-000000000004', 'mem-member@example.test', '{"display_name":"Member"}'),
  ('d0000000-0000-0000-0000-000000000005', 'mem-other@example.test', '{"display_name":"Other"}');
update public.profiles set role = 'coach'
where id in ('d0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003');
update public.profiles set join_mode = 'paid' where id = 'd0000000-0000-0000-0000-000000000003';

insert into public.coach_plans (coach_id, name, price_cents, active)
values ('d0000000-0000-0000-0000-000000000003', 'Monthly', 2900, true),
       ('d0000000-0000-0000-0000-000000000003', 'Old plan', 1900, false);
insert into public.subscriptions (member_id, coach_id, plan_name, price_cents, stripe_subscription_id, status)
values ('d0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000003', 'Monthly', 2900, 'sub_test_1', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000004","role":"authenticated"}';
select lives_ok(
  $$insert into public.coach_members (coach_id, member_id) values ('d0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000004')$$,
  'a member can join a free coach'
);
select throws_ok(
  $$insert into public.coach_members (coach_id, member_id) values ('d0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000004')$$,
  '42501',
  null,
  'a member cannot join a subscribers-only coach for free'
);
select is((select count(*)::int from public.coach_plans), 1, 'members see only active plans');
select is((select count(*)::int from public.subscriptions), 1, 'a member sees their own subscription');
select throws_ok(
  $$update public.subscriptions set status = 'active'$$,
  '42501',
  null,
  'nobody can change a subscription directly'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.subscriptions), 0, 'others cannot see someone''s subscription');
reset role;

select * from finish();
rollback;
