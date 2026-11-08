begin;
select plan(5);

insert into auth.users (id, email, raw_user_meta_data) values
  ('b0000000-0000-0000-0000-000000000002', 'game-coach@example.test', '{"display_name":"Coach"}'),
  ('b0000000-0000-0000-0000-000000000004', 'game-member@example.test', '{"display_name":"Member"}');
update public.profiles set role = 'coach' where id = 'b0000000-0000-0000-0000-000000000002';
insert into public.coach_members (coach_id, member_id)
values ('b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000004');
insert into public.videos (id, coach_id, cloudflare_uid, title, status)
values ('b0000000-0000-0000-0000-0000000000f1', 'b0000000-0000-0000-0000-000000000002', 'uid-game', 'Breathwork', 'ready');

-- A coach gives a Mind Task
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok(
  $$select public.create_task('b0000000-0000-0000-0000-0000000000f1', 'Breathe', '', null,
      array['b0000000-0000-0000-0000-000000000004']::uuid[], 'mind')$$,
  'a coach can give a Task tagged with a pillar'
);
select is((select pillar::text from public.tasks where title = 'Breathe'), 'mind', 'the pillar is saved');
reset role;

-- The server awards a badge that everyone can see, but nobody can award themselves one
insert into public.user_badges (user_id, badge) values ('b0000000-0000-0000-0000-000000000004', 'first_task');
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.user_badges where user_id = 'b0000000-0000-0000-0000-000000000004'),
  1,
  'others can see a member''s badges'
);
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok(
  $$insert into public.user_badges (user_id, badge) values ('b0000000-0000-0000-0000-000000000004', 'streak_30')$$,
  '42501',
  null,
  'nobody can award themselves a badge'
);
select throws_ok(
  $$delete from public.user_badges$$,
  '42501',
  null,
  'nobody can remove badges'
);
reset role;

select * from finish();
rollback;
