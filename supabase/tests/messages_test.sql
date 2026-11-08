begin;
select plan(18);

insert into auth.users (id, email, raw_user_meta_data) values
  ('40000000-0000-0000-0000-000000000001', 'msg-admin@example.test', '{"display_name":"Admin"}'),
  ('40000000-0000-0000-0000-000000000002', 'msg-coach@example.test', '{"display_name":"Coach"}'),
  ('40000000-0000-0000-0000-000000000003', 'msg-rival@example.test', '{"display_name":"Rival"}'),
  ('40000000-0000-0000-0000-000000000004', 'msg-joined@example.test', '{"display_name":"Joined"}'),
  ('40000000-0000-0000-0000-000000000005', 'msg-outsider@example.test', '{"display_name":"Outsider"}');

update public.profiles set role = 'admin' where id = '40000000-0000-0000-0000-000000000001';
update public.profiles set role = 'coach'
where id in ('40000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000003');

insert into public.coach_members (coach_id, member_id) values
  ('40000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000004');

-- Anonymous visitors
set local role anon;
select throws_ok('select id from public.messages', '42501', null, 'anonymous visitors cannot read messages');
reset role;

-- The member writes to their coach
set local role authenticated;
set local request.jwt.claims = '{"sub":"40000000-0000-0000-0000-000000000004","role":"authenticated"}';
select isnt(
  public.send_message('40000000-0000-0000-0000-000000000002', '  Hi coach  '),
  null,
  'a member can message a coach they joined'
);
select is((select body from public.messages), 'Hi coach', 'the message is saved without extra spaces');
select throws_ok(
  $$select public.send_message('40000000-0000-0000-0000-000000000003', 'Hello')$$,
  'P0001',
  'You can only message your coaches and your members',
  'a member cannot message a coach they did not join'
);
select throws_ok(
  $$select public.send_message('40000000-0000-0000-0000-000000000002', '   ')$$,
  'P0001',
  'Write a message first',
  'an empty message is refused'
);
select throws_ok(
  $$insert into public.messages (coach_id, member_id, sender_id, body)
    values ('40000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000004',
            '40000000-0000-0000-0000-000000000004', 'Forged')$$,
  '42501',
  null,
  'a member cannot write a message directly'
);
reset role;

-- The coach reads and replies
set local role authenticated;
set local request.jwt.claims = '{"sub":"40000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.messages where read_at is null), 1, 'the coach sees one unread message');
select lives_ok(
  $$select public.mark_conversation_read('40000000-0000-0000-0000-000000000004')$$,
  'the coach can mark the conversation read'
);
select is((select count(*)::int from public.messages where read_at is null), 0, 'the message is now read');
select throws_ok(
  $$update public.messages set body = 'Edited'$$,
  '42501',
  null,
  'nobody can edit a message directly'
);
select isnt(
  public.send_message('40000000-0000-0000-0000-000000000004', 'Welcome!'),
  null,
  'a coach can reply to their member'
);
select throws_ok(
  $$select public.send_message('40000000-0000-0000-0000-000000000005', 'Hello')$$,
  'P0001',
  'You can only message your coaches and your members',
  'a coach cannot message someone who did not join them'
);
reset role;

-- Marking read only touches messages from the other person
set local role authenticated;
set local request.jwt.claims = '{"sub":"40000000-0000-0000-0000-000000000004","role":"authenticated"}';
select lives_ok(
  $$select public.mark_conversation_read('40000000-0000-0000-0000-000000000002')$$,
  'the member can mark the coach''s reply read'
);
select is(
  (select count(*)::int from public.messages where read_at is not null),
  2,
  'both messages are read, each by the person who received it'
);
reset role;

-- Nobody else can see the conversation
set local role authenticated;
set local request.jwt.claims = '{"sub":"40000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.messages), 0, 'another coach cannot read the conversation');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"40000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.messages), 2, 'an admin can review the conversation');
select throws_ok(
  $$select public.send_message('40000000-0000-0000-0000-000000000004', 'Admin here')$$,
  'P0001',
  'You can only message your coaches and your members',
  'an admin cannot send messages in someone else''s conversation'
);
reset role;

-- History stays after leaving, but no new messages
set local role authenticated;
set local request.jwt.claims = '{"sub":"40000000-0000-0000-0000-000000000004","role":"authenticated"}';
delete from public.coach_members where coach_id = '40000000-0000-0000-0000-000000000002';
select throws_ok(
  $$select public.send_message('40000000-0000-0000-0000-000000000002', 'Still there?')$$,
  'P0001',
  'You can only message your coaches and your members',
  'a member who left cannot keep messaging the coach'
);
reset role;

select * from finish();
rollback;
