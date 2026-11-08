begin;
select plan(7);

insert into auth.users (id, email, raw_user_meta_data) values
  ('e0000000-0000-0000-0000-000000000001', 'trk-admin@example.test', '{"display_name":"Admin"}'),
  ('e0000000-0000-0000-0000-000000000002', 'trk-coach@example.test', '{"display_name":"Coach"}'),
  ('e0000000-0000-0000-0000-000000000004', 'trk-member@example.test', '{"display_name":"Member"}'),
  ('e0000000-0000-0000-0000-000000000005', 'trk-other@example.test', '{"display_name":"Other"}');
update public.profiles set role = 'admin' where id = 'e0000000-0000-0000-0000-000000000001';
update public.profiles set role = 'coach' where id = 'e0000000-0000-0000-0000-000000000002';
insert into public.coach_members (coach_id, member_id)
values ('e0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000004');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-000000000004","role":"authenticated"}';
insert into public.habits (id, user_id, name, pillar)
values ('e0000000-0000-0000-0000-0000000000a1', 'e0000000-0000-0000-0000-000000000004', 'Meditate', 'mind');
select lives_ok(
  $$insert into public.habit_logs (habit_id, user_id, day) values ('e0000000-0000-0000-0000-0000000000a1', 'e0000000-0000-0000-0000-000000000004', current_date)$$,
  'a member checks off their own habit'
);
insert into public.body_logs (user_id, day, weight_lb) values ('e0000000-0000-0000-0000-000000000004', current_date, 180.4);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-000000000005","role":"authenticated"}';
select throws_ok(
  $$insert into public.habit_logs (habit_id, user_id, day) values ('e0000000-0000-0000-0000-0000000000a1', 'e0000000-0000-0000-0000-000000000005', current_date - 1)$$,
  '42501',
  null,
  'nobody can check off someone else''s habit'
);
select is((select count(*)::int from public.body_logs), 0, 'others cannot see a member''s body log');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.body_logs), 0, 'their coach cannot see it until they share');
reset role;

update public.profiles set share_tracking = true where id = 'e0000000-0000-0000-0000-000000000004';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.body_logs), 1, 'their coach can see it once they share');
select is((select count(*)::int from public.habit_logs), 1, 'and their habit check-ins');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.body_logs), 0, 'admins cannot see members'' health tracking');
reset role;

select * from finish();
rollback;
