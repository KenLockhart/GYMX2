begin;
select plan(12);

insert into auth.users (id, email, raw_user_meta_data) values
  ('f0000000-0000-0000-0000-000000000002', 'pg-coach@example.test', '{"display_name":"Coach"}'),
  ('f0000000-0000-0000-0000-000000000003', 'pg-coach2@example.test', '{"display_name":"Coach Two"}'),
  ('f0000000-0000-0000-0000-000000000004', 'pg-member@example.test', '{"display_name":"Member"}'),
  ('f0000000-0000-0000-0000-000000000005', 'pg-other@example.test', '{"display_name":"Other"}');
update public.profiles set role = 'coach'
where id in ('f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000003');
insert into public.coach_members (coach_id, member_id)
values ('f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000004');

-- The coach builds a two-day program.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-000000000002","role":"authenticated"}';
insert into public.programs (id, coach_id, title) values ('f0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-000000000002', 'Strong Start');
insert into public.program_days (id, program_id, day_number, title, pillar) values
  ('f0000000-0000-0000-0000-0000000000d1', 'f0000000-0000-0000-0000-0000000000a1', 1, 'Day one', 'body'),
  ('f0000000-0000-0000-0000-0000000000d2', 'f0000000-0000-0000-0000-0000000000a1', 2, 'Day two', 'mind');
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
  '42501', null, 'members cannot backdate a start to unlock days early'
);
insert into public.program_enrollments (id, program_id, member_id, started_on)
values ('f0000000-0000-0000-0000-0000000000e1', 'f0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-000000000004', (now() at time zone 'America/New_York')::date);
select lives_ok(
  $$insert into public.program_day_completions (enrollment_id, day_id, member_id) values ('f0000000-0000-0000-0000-0000000000e1', 'f0000000-0000-0000-0000-0000000000d1', 'f0000000-0000-0000-0000-000000000004')$$,
  'day one can be completed on the first day'
);
select throws_ok(
  $$insert into public.program_day_completions (enrollment_id, day_id, member_id) values ('f0000000-0000-0000-0000-0000000000e1', 'f0000000-0000-0000-0000-0000000000d2', 'f0000000-0000-0000-0000-000000000004')$$,
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
