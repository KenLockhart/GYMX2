begin;
select plan(7);

insert into auth.users (id, email, raw_user_meta_data) values
  ('d1000000-0000-0000-0000-000000000002', 'live-coach@example.test', '{"display_name":"Coach"}'),
  ('d1000000-0000-0000-0000-000000000004', 'live-member@example.test', '{"display_name":"Member"}'),
  ('d1000000-0000-0000-0000-000000000005', 'live-other@example.test', '{"display_name":"Other"}');
update public.profiles set role = 'coach' where id = 'd1000000-0000-0000-0000-000000000002';
insert into public.coach_members (coach_id, member_id)
values ('d1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000004');
insert into public.calendar_sessions (id, coach_id, title, starts_at, ends_at)
values ('d1000000-0000-0000-0000-0000000000c1', 'd1000000-0000-0000-0000-000000000002', 'HIIT', now(), now() + interval '1 hour');
insert into public.session_invites (session_id, member_id)
values ('d1000000-0000-0000-0000-0000000000c1', 'd1000000-0000-0000-0000-000000000004');
insert into public.session_live (session_id, input_uid, playback_url)
values ('d1000000-0000-0000-0000-0000000000c1', 'test-input', 'https://example.test/play');

set local role authenticated;
set local request.jwt.claims = '{"sub":"d1000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok(
  $$insert into public.live_chat_messages (session_id, sender_id, body) values ('d1000000-0000-0000-0000-0000000000c1', 'd1000000-0000-0000-0000-000000000004', 'early')$$,
  '42501', null, 'chat is closed until the coach goes live'
);
select throws_ok(
  $$update public.session_live set live_started_at = now()$$,
  '42501', null, 'members cannot start the live room'
);
reset role;

update public.session_live set live_started_at = now() where session_id = 'd1000000-0000-0000-0000-0000000000c1';

set local role authenticated;
set local request.jwt.claims = '{"sub":"d1000000-0000-0000-0000-000000000004","role":"authenticated"}';
select lives_ok(
  $$insert into public.live_chat_messages (session_id, sender_id, body) values ('d1000000-0000-0000-0000-0000000000c1', 'd1000000-0000-0000-0000-000000000004', 'Let''s go')$$,
  'invited members chat while live'
);
select lives_ok(
  $$insert into public.session_attendance (session_id, member_id) values ('d1000000-0000-0000-0000-0000000000c1', 'd1000000-0000-0000-0000-000000000004')$$,
  'invited members check in while live'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"d1000000-0000-0000-0000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.session_live), 0, 'others cannot see the live room');
select is((select count(*)::int from public.live_chat_messages), 0, 'or its chat');
select throws_ok(
  $$insert into public.session_attendance (session_id, member_id) values ('d1000000-0000-0000-0000-0000000000c1', 'd1000000-0000-0000-0000-000000000005')$$,
  '42501', null, 'people who were not invited cannot check in'
);
reset role;

select * from finish();
rollback;
