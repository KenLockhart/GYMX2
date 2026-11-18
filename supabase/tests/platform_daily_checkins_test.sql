begin;
select plan(17);

insert into auth.users (id, email, raw_user_meta_data) values
  ('62000000-0000-0000-0000-000000000001', 'daily-unpaid@example.test', '{"display_name":"Daily unpaid"}'),
  ('62000000-0000-0000-0000-000000000002', 'daily-regular@example.test', '{"display_name":"Daily regular"}'),
  ('62000000-0000-0000-0000-000000000003', 'daily-premium@example.test', '{"display_name":"Daily premium"}'),
  ('62000000-0000-0000-0000-000000000004', 'daily-expired@example.test', '{"display_name":"Daily expired"}'),
  ('62000000-0000-0000-0000-000000000005', 'daily-revoked@example.test', '{"display_name":"Daily revoked"}'),
  ('62000000-0000-0000-0000-000000000006', 'daily-manual@example.test', '{"display_name":"Daily manual"}'),
  ('62000000-0000-0000-0000-000000000007', 'daily-coach@example.test', '{"display_name":"Daily coach"}'),
  ('62000000-0000-0000-0000-000000000008', 'daily-other@example.test', '{"display_name":"Daily other member"}');
update public.profiles set role = 'coach' where id = '62000000-0000-0000-0000-000000000007';

insert into public.platform_memberships (
  member_id, tier, stripe_subscription_id, stripe_customer_id, stripe_price_id,
  status, current_period_end
) values
  ('62000000-0000-0000-0000-000000000002', 'regular', 'sub_daily_regular', 'cus_daily_regular', 'price_regular_test', 'active', now() + interval '30 days'),
  ('62000000-0000-0000-0000-000000000003', 'premium', 'sub_daily_premium', 'cus_daily_premium', 'price_premium_test', 'active', now() + interval '30 days'),
  ('62000000-0000-0000-0000-000000000004', 'premium', 'sub_daily_expired', 'cus_daily_expired', 'price_premium_test', 'active', now() - interval '1 day');
insert into public.platform_test_entitlements (
  member_id, tier, grant_reason, granted_by, revoked_at
) values (
  '62000000-0000-0000-0000-000000000005', 'premium',
  'Revoked daily check-in test fixture', '62000000-0000-0000-0000-000000000001', now()
);
insert into public.platform_test_entitlements (
  member_id, tier, grant_reason, granted_by
) values (
  '62000000-0000-0000-0000-000000000006', 'premium',
  'Active daily check-in manual test fixture', '00000000-0000-0000-0000-000000000000'
);

insert into public.coach_members (coach_id, member_id)
values
  ('62000000-0000-0000-0000-000000000007', '62000000-0000-0000-0000-000000000002'),
  ('62000000-0000-0000-0000-000000000007', '62000000-0000-0000-0000-000000000004');

-- Seed own history for an unpaid member and a linked-coach visible row. SELECT stays independent
-- from entitlement state, while the new INSERT/UPDATE gates require a current paid/test tier.
insert into public.member_daily_checkins (member_id, day, energy, sleep, stress, motivation)
values
  ('62000000-0000-0000-0000-000000000001', private.current_daily_checkin_day(), 2, 3, 4, 2),
  ('62000000-0000-0000-0000-000000000002', private.current_daily_checkin_day(), 3, 3, 2, 4),
  ('62000000-0000-0000-0000-000000000004', private.current_daily_checkin_day(), 4, 3, 2, 2),
  ('62000000-0000-0000-0000-000000000008', private.current_daily_checkin_day(), 1, 2, 3, 4);

set local role authenticated;
set local request.jwt.claims = '{"sub":"62000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$select public.save_member_daily_checkin((select private.current_daily_checkin_day()), 3, 3, 3, 3)$$,
  '42501', null, 'an unpaid member cannot save through the RPC'
);
select throws_ok(
  $$insert into public.member_daily_checkins (member_id, day, energy, sleep, stress, motivation)
    values (auth.uid(), (select private.current_daily_checkin_day()), 3, 3, 3, 3)$$,
  '42501', null, 'an unpaid member cannot write directly to the table'
);
select lives_ok(
  $$update public.member_daily_checkins set energy = 5 where member_id = auth.uid() and day = (select private.current_daily_checkin_day())$$,
  'RLS permits the harmless no-row update statement for an unpaid member'
);
select is((select energy::int from public.member_daily_checkins where member_id = auth.uid()), 2, 'unpaid members retain readable history without changing it');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"62000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok(
  $$select public.save_member_daily_checkin((select private.current_daily_checkin_day()), 5, 4, 2, 5)$$,
  'an active Regular member can save through the RPC'
);
select lives_ok(
  $$update public.member_daily_checkins set energy = 4 where member_id = auth.uid() and day = (select private.current_daily_checkin_day())$$,
  'an active Regular member can update today directly'
);
select is((select count(*)::int from public.member_daily_checkins where member_id = auth.uid()), 1, 'the daily RPC preserves one row per member and day');
select throws_ok(
  $$insert into public.member_daily_checkins (member_id, day, energy, sleep, stress, motivation)
    values (auth.uid(), (select private.current_daily_checkin_day() - 1), 3, 3, 3, 3)$$,
  '42501', null, 'a paid member still cannot insert a prior-day check-in'
);
select throws_ok(
  $$insert into public.member_daily_checkins (member_id, day, energy, sleep, stress, motivation)
    values ('62000000-0000-0000-0000-000000000008', (select private.current_daily_checkin_day()), 3, 3, 3, 3)$$,
  '42501', null, 'a paid member still cannot insert for another account'
);
select ok(
  not has_column_privilege('authenticated', 'public.member_daily_checkins', 'member_id', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.member_daily_checkins', 'day', 'UPDATE')
    and has_column_privilege('authenticated', 'public.member_daily_checkins', 'energy', 'UPDATE'),
  'paid members retain answer-only update column grants'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"62000000-0000-0000-0000-000000000003","role":"authenticated"}';
select lives_ok(
  $$select public.save_member_daily_checkin((select private.current_daily_checkin_day()), 2, 5, 1, 4)$$,
  'an active Premium member can save through the RPC'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"62000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok(
  $$select public.save_member_daily_checkin((select private.current_daily_checkin_day()), 3, 3, 3, 3)$$,
  '42501', null, 'an expired subscription cannot write'
);
select is((select count(*)::int from public.member_daily_checkins where member_id = auth.uid()), 1, 'an expired member still sees their own history');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"62000000-0000-0000-0000-000000000005","role":"authenticated"}';
select throws_ok(
  $$select public.save_member_daily_checkin((select private.current_daily_checkin_day()), 3, 3, 3, 3)$$,
  '42501', null, 'a revoked manual entitlement cannot write'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"62000000-0000-0000-0000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.save_member_daily_checkin((select private.current_daily_checkin_day()), 4, 4, 2, 4)$$,
  'an active manual Premium test entitlement can write'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"62000000-0000-0000-0000-000000000007","role":"authenticated"}';
select is((select count(*)::int from public.member_daily_checkins where member_id = '62000000-0000-0000-0000-000000000002'), 1, 'a linked coach can still read a paid member history');
select is((select count(*)::int from public.member_daily_checkins where member_id = '62000000-0000-0000-0000-000000000008'), 0, 'a coach cannot read an unlinked member history');
reset role;

select * from finish();
rollback;
