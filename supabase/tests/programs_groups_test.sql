begin;
select plan(14);

insert into auth.users (id, email, raw_user_meta_data) values
  ('f0000000-0000-0000-0000-000000000002', 'pg-coach@example.test', '{"display_name":"Coach"}'),
  ('f0000000-0000-0000-0000-000000000003', 'pg-coach2@example.test', '{"display_name":"Coach Two"}'),
  ('f0000000-0000-0000-0000-000000000004', 'pg-member@example.test', '{"display_name":"Member"}'),
  ('f0000000-0000-0000-0000-000000000005', 'pg-other@example.test', '{"display_name":"Other"}');
update public.profiles set role = 'coach'
where id in ('f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000003');
insert into public.coach_members (coach_id, member_id)
values ('f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000004');
insert into public.platform_test_entitlements (member_id, tier, grant_reason, granted_by)
values
  ('f0000000-0000-0000-0000-000000000004', 'regular', 'Synthetic Program access test', 'f0000000-0000-0000-0000-000000000002'),
  ('f0000000-0000-0000-0000-000000000005', 'regular', 'Synthetic Program access test', 'f0000000-0000-0000-0000-000000000002');

-- The coach builds a two-day program.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-000000000002","role":"authenticated"}';
insert into public.programs (id, coach_id, title) values ('f0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-000000000002', 'Strong Start');
select set_config('test.groups_day_one', public.save_owned_program_day('f0000000-0000-0000-0000-0000000000a1', null, 1::smallint, 'Day one', '', 'body', null)::text, true);
select set_config('test.groups_day_two', public.save_owned_program_day('f0000000-0000-0000-0000-0000000000a1', null, 2::smallint, 'Day two', '', 'mind', null)::text, true);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.programs), 0, 'members cannot see draft programs');
reset role;

update public.programs set published = true where id = 'f0000000-0000-0000-0000-0000000000a1';

set local role authenticated;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.program_days), 2, 'a joined member sees published program days');
select throws_ok(
  $$insert into public.program_enrollments (program_id, member_id, started_on) values ('f0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-000000000004', current_date - 30)$$,
  '42501', null, 'members cannot bypass the enrollment RPC or backdate a start'
);
select lives_ok(
  $$select public.start_my_program_enrollment('f0000000-0000-0000-0000-0000000000a1')$$,
  'members start a free Program through the server-managed RPC'
);
select throws_ok(
  $$insert into public.program_day_completions (enrollment_id, day_id, member_id) select id, current_setting('test.groups_day_one')::uuid, 'f0000000-0000-0000-0000-000000000004' from public.program_enrollments where program_id = 'f0000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'members cannot bypass the completion RPC'
);
select lives_ok(
  $$select public.set_my_program_lesson_state('f0000000-0000-0000-0000-0000000000a1', current_setting('test.groups_day_one')::uuid, true, 'f0000000-0000-0000-0000-0000000000e1')$$,
  'day one can be completed on the first day through the RPC'
);
select throws_ok(
  $$select public.set_my_program_lesson_state('f0000000-0000-0000-0000-0000000000a1', current_setting('test.groups_day_two')::uuid, true, 'f0000000-0000-0000-0000-0000000000e2')$$,
  '42501', null, 'day two stays locked until tomorrow'
);
select throws_ok(
  $$insert into public.program_days (program_id, day_number, title, pillar) values ('f0000000-0000-0000-0000-0000000000a1', 3, 'Mine', 'body')$$,
  '42501', null, 'members cannot add days to a coach''s program'
);
-- Group chat.
select lives_ok(
  $$insert into public.group_messages (coach_id, sender_id, body) values ('f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000004', 'Hi team')$$,
  'a member posts in their coach''s group'
);
select throws_ok(
  $$insert into public.group_messages (coach_id, sender_id, body) values ('f0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000004', 'Hello?')$$,
  '42501', null, 'members cannot post in groups of coaches they did not join'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.group_messages), 0, 'outsiders cannot read a group');
select is((select count(*)::int from public.programs), 0, 'outsiders cannot see the program');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.program_day_completions), 1, 'the coach sees members'' progress');
delete from public.group_messages where coach_id = 'f0000000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.group_messages), 0, 'the coach can remove posts in their group');
reset role;

select * from finish();
rollback;
