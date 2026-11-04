begin;
select plan(34);

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000001', 'admin2@example.test', '{"display_name":"Admin"}'),
  ('10000000-0000-0000-0000-000000000002', 'coach2@example.test', '{"display_name":"Coach"}'),
  ('10000000-0000-0000-0000-000000000003', 'rival@example.test', '{"display_name":"Rival"}'),
  ('10000000-0000-0000-0000-000000000004', 'joined@example.test', '{"display_name":"Joined"}'),
  ('10000000-0000-0000-0000-000000000005', 'outsider@example.test', '{"display_name":"Outsider"}');

update public.profiles set role = 'admin' where id = '10000000-0000-0000-0000-000000000001';
update public.profiles set role = 'coach'
where id in ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003');

insert into public.videos (id, coach_id, cloudflare_uid, title, status) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'uid-ready', 'Ready', 'ready'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'uid-processing', 'Processing', 'processing'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'uid-rival', 'Rival', 'ready');

-- Anonymous visitors
set local role anon;
select throws_ok('select id from public.videos', '42501', null, 'anonymous visitors cannot read videos');
select throws_ok('select id from public.memos', '42501', null, 'anonymous visitors cannot read Memos');
reset role;

-- A member joins a coach
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}';

select is(
  (select count(*)::int from public.videos),
  0,
  'a member sees no videos before joining a coach'
);
select lives_ok(
  $$insert into public.coach_members (coach_id, member_id)
    values ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004')$$,
  'a member can join a coach'
);
select throws_ok(
  $$insert into public.coach_members (coach_id, member_id)
    values ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004')$$,
  '42501',
  null,
  'a member cannot join someone who is not a coach'
);
select throws_ok(
  $$insert into public.coach_members (coach_id, member_id)
    values ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000005')$$,
  '42501',
  null,
  'a member cannot join a coach for someone else'
);
select is(
  (select array_agg(title order by title) from public.videos),
  array['Ready'],
  'a member sees only finished videos from coaches they joined'
);
select throws_ok(
  'select cloudflare_uid from public.videos',
  '42501',
  null,
  'a member cannot read the Cloudflare video id'
);
select throws_ok(
  $$insert into public.videos (coach_id, cloudflare_uid, title)
    values ('10000000-0000-0000-0000-000000000004', 'uid-stolen', 'Stolen')$$,
  '42501',
  null,
  'a member cannot add a video'
);
select throws_ok(
  $$select public.create_task('20000000-0000-0000-0000-000000000001', 'T', '', null,
    array['10000000-0000-0000-0000-000000000004']::uuid[])$$,
  '42501',
  'Coach access required',
  'a member cannot create a Task'
);
reset role;

-- A coach gives Tasks
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select display_name from public.profiles where id = '10000000-0000-0000-0000-000000000004'),
  'Joined',
  'a coach can read a member who joined them'
);
select is(
  (select count(*)::int from public.profiles where id = '10000000-0000-0000-0000-000000000005'),
  0,
  'a coach cannot read a member who did not join them'
);
select throws_ok(
  $$update public.videos set status = 'ready' where id = '20000000-0000-0000-0000-000000000002'$$,
  '42501',
  null,
  'a coach cannot mark their own video as ready'
);
select throws_ok(
  $$select public.create_task('20000000-0000-0000-0000-000000000003', 'T', '', null,
    array['10000000-0000-0000-0000-000000000004']::uuid[])$$,
  'P0001',
  'Choose one of your videos that has finished processing',
  'a coach cannot assign another coach''s video'
);
select throws_ok(
  $$select public.create_task('20000000-0000-0000-0000-000000000002', 'T', '', null,
    array['10000000-0000-0000-0000-000000000004']::uuid[])$$,
  'P0001',
  'Choose one of your videos that has finished processing',
  'a coach cannot assign a video still processing'
);
select throws_ok(
  $$select public.create_task('20000000-0000-0000-0000-000000000001', 'T', '', null,
    array['10000000-0000-0000-0000-000000000005']::uuid[])$$,
  'P0001',
  'Tasks can only go to members who joined you',
  'a coach cannot give a Task to a member who did not join them'
);
select throws_ok(
  $$select public.create_task('20000000-0000-0000-0000-000000000001', 'T', '', null, '{}'::uuid[])$$,
  'P0001',
  'Choose at least one member',
  'a Task needs at least one member'
);
select isnt(
  public.create_task(
    '20000000-0000-0000-0000-000000000001',
    'Squats',
    '',
    '2026-12-01',
    array['10000000-0000-0000-0000-000000000004']::uuid[]
  ),
  null,
  'a coach can give a Task to a member who joined them'
);
reset role;

-- A member completes a Task
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}';

select is(
  (select count(*)::int from public.tasks where title = 'Squats'),
  1,
  'a member can read a Task given to them'
);
select throws_ok(
  $$update public.task_assignments set completed_at = '2000-01-01'$$,
  '42501',
  null,
  'a member cannot backdate a completion'
);
select lives_ok(
  $$select public.set_assignment_completed(
    (select id from public.task_assignments), true)$$,
  'a member can complete their Task'
);
select isnt(
  (select completed_at from public.task_assignments),
  null,
  'the completion was saved'
);
reset role;

-- Other people's assignments
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}';
select is(
  (select count(*)::int from public.task_assignments),
  0,
  'an outsider cannot read someone else''s assignment'
);
select throws_ok(
  $$select public.set_assignment_completed(
    (select id from public.task_assignments), true)$$,
  'P0002',
  'Task not found',
  'an outsider cannot complete someone else''s Task'
);
reset role;

-- Memos
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}';
insert into public.memos (user_id, memo_date, body, shared_with_coaches) values
  ('10000000-0000-0000-0000-000000000004', '2026-11-03', 'Private note', false),
  ('10000000-0000-0000-0000-000000000004', '2026-11-03', 'Shared note', true);
select throws_ok(
  $$insert into public.memos (user_id, memo_date, body)
    values ('10000000-0000-0000-0000-000000000005', '2026-11-03', 'Forged')$$,
  '42501',
  null,
  'a person cannot write a Memo for someone else'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(
  (select array_agg(body) from public.memos),
  array['Shared note'],
  'a coach sees only Memos their member chose to share'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(
  (select count(*)::int from public.memos),
  0,
  'a coach the member did not join sees no Memos'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.memos),
  0,
  'an admin cannot read Memos'
);
reset role;

-- Leaving a coach
insert into public.task_assignments (task_id, member_id)
select t.id, '10000000-0000-0000-0000-000000000005' from public.tasks t where t.title = 'Squats';
insert into public.coach_members (coach_id, member_id)
values ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000005');
delete from public.coach_members where member_id = '10000000-0000-0000-0000-000000000005';
select is(
  (select count(*)::int from public.task_assignments where member_id = '10000000-0000-0000-0000-000000000005'),
  0,
  'leaving a coach clears unfinished Tasks'
);
delete from public.coach_members where member_id = '10000000-0000-0000-0000-000000000004';
select is(
  (select count(*)::int from public.task_assignments where member_id = '10000000-0000-0000-0000-000000000004'),
  1,
  'leaving a coach keeps finished Tasks'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$delete from public.videos where id = '20000000-0000-0000-0000-000000000001'$$,
  '23503',
  null,
  'a video with Tasks cannot be deleted'
);
reset role;

-- The server, using the secret key
set local role service_role;
select lives_ok(
  $$insert into public.videos (coach_id, cloudflare_uid, title)
    values ('10000000-0000-0000-0000-000000000002', 'uid-server', 'Server')$$,
  'the server can record an upload'
);
select is(
  (select cloudflare_uid from public.videos where title = 'Server'),
  'uid-server',
  'the server can read the Cloudflare video id'
);
select lives_ok(
  $$update public.videos set status = 'ready', duration_seconds = 6 where title = 'Server'$$,
  'the server can update a video''s status'
);
reset role;

select * from finish();
rollback;
