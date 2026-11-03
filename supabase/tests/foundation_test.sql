begin;
select plan(17);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'admin@example.test', '{"display_name":"Admin"}'),
  ('00000000-0000-0000-0000-000000000002', 'member@example.test', '{"display_name":"Member","role":"admin"}'),
  ('00000000-0000-0000-0000-000000000003', 'coach@example.test', '{"display_name":"Coach","coach_requested":"true"}'),
  ('00000000-0000-0000-0000-000000000004', 'other@example.test', '{"display_name":"Other"}');

select is(
  (select role from public.profiles where id = '00000000-0000-0000-0000-000000000002'),
  'member'::public.user_role,
  'sign-up metadata cannot grant a role'
);
select is(
  (select coach_requested from public.profiles where id = '00000000-0000-0000-0000-000000000003'),
  true,
  'sign-up records a coach request'
);

-- Leave one admin regardless of data already in the database; rollback restores it.
update public.profiles set role = 'member' where role = 'admin';
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000001';
update public.profiles set role = 'coach', coach_requested = false where id = '00000000-0000-0000-0000-000000000003';

set local role anon;
select throws_ok(
  'select * from public.profiles',
  '42501',
  null,
  'anonymous visitors cannot read profiles'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000002'$$,
  '42501',
  null,
  'a member cannot change their own role'
);
select lives_ok(
  $$update public.profiles set display_name = 'Renamed' where id = '00000000-0000-0000-0000-000000000002'$$,
  'a member can edit their own profile'
);
select throws_ok(
  $$update public.profiles set instagram_url = 'http://insecure.example' where id = '00000000-0000-0000-0000-000000000002'$$,
  '23514',
  null,
  'social links must use https'
);
update public.profiles set display_name = 'Hacked' where id = '00000000-0000-0000-0000-000000000004';
select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-000000000004'),
  0,
  'a member cannot read another member'
);
select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-000000000003'),
  1,
  'a member can read a coach'
);
select throws_ok(
  'select * from public.admin_list_users()',
  '42501',
  'Admin access required',
  'a member cannot list users'
);
select throws_ok(
  $$select public.admin_set_user_role('00000000-0000-0000-0000-000000000002', 'admin')$$,
  '42501',
  'Admin access required',
  'a member cannot call the role change function'
);
reset role;

select is(
  (select display_name from public.profiles where id = '00000000-0000-0000-0000-000000000004'),
  'Other',
  'a member update cannot change another member'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok(
  'select * from public.admin_list_users()',
  '42501',
  'Admin access required',
  'a coach cannot list users'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.admin_list_users() where id::text like '00000000-0000-0000-0000-%'),
  4,
  'an admin can list users'
);
select lives_ok(
  $$select public.admin_set_user_role('00000000-0000-0000-0000-000000000004', 'coach')$$,
  'an admin can promote a user'
);
select throws_ok(
  $$select public.admin_set_user_role('00000000-0000-0000-0000-000000000001', 'member')$$,
  'P0001',
  'GYMX2 must keep at least one admin',
  'the last admin cannot be demoted'
);
select throws_ok(
  $$select public.admin_set_user_role('00000000-0000-0000-0000-00000000dead', 'coach')$$,
  'P0002',
  'User not found',
  'an unknown user is rejected'
);
reset role;

select is(
  (select role from public.profiles where id = '00000000-0000-0000-0000-000000000004'),
  'coach'::public.user_role,
  'the promotion was saved'
);

select * from finish();
rollback;
