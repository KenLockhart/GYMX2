begin;
select plan(26);

insert into auth.users (id, email, raw_user_meta_data) values
  ('30000000-0000-0000-0000-000000000001', 'cal-admin@example.test', '{"display_name":"Admin"}'),
  ('30000000-0000-0000-0000-000000000002', 'cal-coach@example.test', '{"display_name":"Coach"}'),
  ('30000000-0000-0000-0000-000000000003', 'cal-rival@example.test', '{"display_name":"Rival"}'),
  ('30000000-0000-0000-0000-000000000004', 'cal-joined@example.test', '{"display_name":"Joined"}'),
  ('30000000-0000-0000-0000-000000000005', 'cal-outsider@example.test', '{"display_name":"Outsider"}'),
  ('30000000-0000-0000-0000-000000000006', 'cal-second@example.test', '{"display_name":"Second"}');

update public.profiles set role = 'admin' where id = '30000000-0000-0000-0000-000000000001';
update public.profiles set role = 'coach'
where id in ('30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003');

insert into public.coach_members (coach_id, member_id) values
  ('30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000004'),
  ('30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000006');

-- Anonymous visitors
set local role anon;
select throws_ok('select id from public.calendar_sessions', '42501', null, 'anonymous visitors cannot read sessions');
select throws_ok('select member_id from public.session_invites', '42501', null, 'anonymous visitors cannot read invites');
reset role;

-- A member cannot schedule
set local role authenticated;
set local request.jwt.claims = '{"sub":"30000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok(
  $$select public.create_session('Run', '', '', '', now() + interval '1 day', now() + interval '1 day 1 hour',
    array['30000000-0000-0000-0000-000000000006']::uuid[])$$,
  '42501',
  'Coach access required',
  'a member cannot schedule a session'
);
select throws_ok(
  $$insert into public.calendar_sessions (coach_id, title, starts_at, ends_at)
    values ('30000000-0000-0000-0000-000000000004', 'Forged', now() + interval '1 day', now() + interval '1 day 1 hour')$$,
  '42501',
  null,
  'a member cannot write a session directly'
);
reset role;

-- A coach schedules
set local role authenticated;
set local request.jwt.claims = '{"sub":"30000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$select public.create_session('Run', '', '', '', now() + interval '1 day', now() + interval '1 day',
    array['30000000-0000-0000-0000-000000000004']::uuid[])$$,
  'P0001',
  'The session must end after it starts',
  'a session must end after it starts'
);
select throws_ok(
  $$select public.create_session('Run', '', '', '', now() + interval '1 day', now() + interval '3 days',
    array['30000000-0000-0000-0000-000000000004']::uuid[])$$,
  'P0001',
  'A session can last up to 24 hours',
  'a session cannot run longer than a day'
);
select throws_ok(
  $$select public.create_session('Run', '', '', '', now() - interval '1 hour', now() + interval '1 hour',
    array['30000000-0000-0000-0000-000000000004']::uuid[])$$,
  'P0001',
  'Choose a start time in the future',
  'a new session cannot start in the past'
);
select throws_ok(
  $$select public.create_session('Run', '', '', '', now() + interval '1 day', now() + interval '1 day 1 hour',
    '{}'::uuid[])$$,
  'P0001',
  'Invite at least one member',
  'a session needs at least one member'
);
select throws_ok(
  $$select public.create_session('Run', '', '', '', now() + interval '1 day', now() + interval '1 day 1 hour',
    array['30000000-0000-0000-0000-000000000005']::uuid[])$$,
  'P0001',
  'You can only invite members who joined you',
  'a coach cannot invite a member who did not join them'
);
select throws_ok(
  $$select public.create_session('Run', '', '', 'http://insecure.example', now() + interval '1 day',
    now() + interval '1 day 1 hour', array['30000000-0000-0000-0000-000000000004']::uuid[])$$,
  '23514',
  null,
  'a meeting link must use https'
);
select isnt(
  public.create_session(
    'Morning run',
    'Bring water',
    'Main park',
    'https://meet.example.com/run',
    now() + interval '1 day',
    now() + interval '1 day 1 hour',
    array['30000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000006']::uuid[]
  ),
  null,
  'a coach can schedule a session for members who joined them'
);
select is(
  (select count(*)::int from public.session_invites),
  2,
  'the coach can see both invites'
);
reset role;

-- The invited member replies
set local role authenticated;
set local request.jwt.claims = '{"sub":"30000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(
  (select title from public.calendar_sessions),
  'Morning run',
  'an invited member can read the session'
);
select is(
  (select count(*)::int from public.session_invites),
  1,
  'a member only sees their own invite'
);
select throws_ok(
  $$update public.session_invites set response = 'going'$$,
  '42501',
  null,
  'a member cannot change an invite directly'
);
select lives_ok(
  $$select public.respond_to_session((select id from public.calendar_sessions), 'going')$$,
  'a member can reply Going'
);
select is(
  (select response::text from public.session_invites),
  'going',
  'the reply was saved'
);
reset role;

-- Outsiders and other coaches
set local role authenticated;
set local request.jwt.claims = '{"sub":"30000000-0000-0000-0000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.calendar_sessions), 0, 'an outsider cannot see the session');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"30000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.calendar_sessions), 0, 'another coach cannot see the session');
select throws_ok(
  $$select public.update_session(
    (select id from public.calendar_sessions limit 1), 'Hijacked', '', '', '',
    now() + interval '2 days', now() + interval '2 days 1 hour',
    array['30000000-0000-0000-0000-000000000004']::uuid[])$$,
  'P0001',
  'You can only invite members who joined you',
  'another coach cannot edit the session or reach its members'
);
reset role;

-- Admins can see everything
set local role authenticated;
set local request.jwt.claims = '{"sub":"30000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.calendar_sessions), 1, 'an admin can see every session');
reset role;

-- The coach edits: dropping a member removes their invite, moving the time resets replies
set local role authenticated;
set local request.jwt.claims = '{"sub":"30000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok(
  $$select public.update_session(
    (select id from public.calendar_sessions), 'Morning run', 'Bring water', 'Main park', '',
    (select starts_at from public.calendar_sessions), (select ends_at from public.calendar_sessions),
    array['30000000-0000-0000-0000-000000000004']::uuid[])$$,
  'a coach can change the guest list'
);
select is(
  (select array_agg(response::text) from public.session_invites),
  array['going'],
  'a kept member keeps their reply when the time does not change'
);
select lives_ok(
  $$select public.update_session(
    (select id from public.calendar_sessions), 'Morning run', '', 'Main park', '',
    now() + interval '2 days', now() + interval '2 days 1 hour',
    array['30000000-0000-0000-0000-000000000004']::uuid[])$$,
  'a coach can move the session'
);
select is(
  (select response::text from public.session_invites),
  'pending',
  'moving the session asks members to reply again'
);
reset role;

-- Leaving the coach removes upcoming invites
set local role authenticated;
set local request.jwt.claims = '{"sub":"30000000-0000-0000-0000-000000000004","role":"authenticated"}';
delete from public.coach_members where coach_id = '30000000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.calendar_sessions), 0, 'a member who leaves loses upcoming sessions');
reset role;

select * from finish();
rollback;
