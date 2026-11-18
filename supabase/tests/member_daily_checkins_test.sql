begin;
select plan(29);

insert into auth.users (id, email, raw_user_meta_data) values
  ('d1000000-0000-0000-0000-000000000001', 'daily-admin@example.test', '{"display_name":"Admin"}'),
  ('d1000000-0000-0000-0000-000000000002', 'daily-coach@example.test', '{"display_name":"Coach"}'),
  ('d1000000-0000-0000-0000-000000000003', 'daily-other-coach@example.test', '{"display_name":"Other Coach"}'),
  ('d1000000-0000-0000-0000-000000000004', 'daily-member@example.test', '{"display_name":"Member"}'),
  ('d1000000-0000-0000-0000-000000000005', 'daily-other@example.test', '{"display_name":"Other Member"}'),
  ('d1000000-0000-0000-0000-000000000006', 'daily-former@example.test', '{"display_name":"Former Member"}');

update public.profiles set role = 'admin'
where id = 'd1000000-0000-0000-0000-000000000001';
update public.profiles set role = 'coach'
where id in ('d1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000003');
insert into public.coach_members (coach_id, member_id) values
  ('d1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000004'),
  ('d1000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000005');

-- Seed rows visible only to their own member and linked coach.
insert into public.member_daily_checkins (member_id, day, energy, sleep, stress, motivation) values
  ('d1000000-0000-0000-0000-000000000005', private.current_daily_checkin_day(), 3, 3, 3, 3),
  ('d1000000-0000-0000-0000-000000000006', private.current_daily_checkin_day(), 2, 2, 4, 2);

-- The member inserts and edits only today's row through the RPC, without UPDATE on identity/date.
set local role authenticated;
set local request.jwt.claims = '{"sub":"d1000000-0000-0000-0000-000000000004","role":"authenticated"}';
select lives_ok(
  $$select public.save_member_daily_checkin(private.current_daily_checkin_day(), 4, 3, 2, 5)$$,
  'a member saves today’s wellbeing scores'
);
select lives_ok(
  $$select public.save_member_daily_checkin(private.current_daily_checkin_day(), 5, 4, 1, 3)$$,
  'the same member can edit the same day through the RPC'
);
select is(
  (select count(*)::int from public.member_daily_checkins
   where member_id = 'd1000000-0000-0000-0000-000000000004'),
  1,
  'same-day edits keep one row'
);
select is(
  (select energy::int from public.member_daily_checkins
   where member_id = 'd1000000-0000-0000-0000-000000000004'),
  5,
  'same-day edit replaces the score'
);
select throws_ok(
  $$select public.save_member_daily_checkin(private.current_daily_checkin_day() - 1, 1, 1, 1, 1)$$,
  'P0001', 'Daily check-in day changed',
  'a stale page cannot submit answers for the new day'
);
select is(
  (select energy::int from public.member_daily_checkins
   where member_id = 'd1000000-0000-0000-0000-000000000004'),
  5,
  'a stale-day submission leaves today’s saved row unchanged'
);
select throws_ok(
  $$update public.member_daily_checkins
    set member_id = 'd1000000-0000-0000-0000-000000000005'
    where member_id = 'd1000000-0000-0000-0000-000000000004'$$,
  '42501', null,
  'a member has no UPDATE privilege on member_id'
);
select throws_ok(
  $$update public.member_daily_checkins
    set day = private.current_daily_checkin_day() + 1
    where member_id = 'd1000000-0000-0000-0000-000000000004'$$,
  '42501', null,
  'a member has no UPDATE privilege on day'
);
select lives_ok(
  $query$do $block$
    declare changed_rows integer;
    begin
      update public.member_daily_checkins set energy = 1
      where member_id = 'd1000000-0000-0000-0000-000000000004'
        and day = private.current_daily_checkin_day() - 1;
      get diagnostics changed_rows = row_count;
      if changed_rows <> 0 then
        raise exception 'expected past-day update to affect zero rows';
      end if;
    end;
  $block$;$query$,
  'a member cannot update a past daily row'
);
select throws_ok(
  $$insert into public.member_daily_checkins (member_id, day, energy, sleep, stress, motivation)
    values ('d1000000-0000-0000-0000-000000000004', private.current_daily_checkin_day() + 1, 1, 1, 1, 1)$$,
  '42501', null,
  'a member cannot insert a future day'
);
select is(
  (select count(*)::int from public.member_daily_checkins
   where member_id = 'd1000000-0000-0000-0000-000000000004'),
  1,
  'a member can read their own daily check-in'
);
select is(
  (select count(*)::int from public.member_daily_checkins
   where member_id = 'd1000000-0000-0000-0000-000000000005'),
  0,
  'a member cannot read another member’s daily check-in'
);
select throws_ok(
  $$insert into public.member_daily_checkins (member_id, day, energy, sleep, stress, motivation)
    values ('d1000000-0000-0000-0000-000000000005', private.current_daily_checkin_day(), 1, 1, 1, 1)$$,
  '42501', null,
  'a member cannot insert a row for someone else'
);
select throws_ok(
  $$insert into public.member_daily_checkins (member_id, day, energy, sleep, stress, motivation)
    values ('d1000000-0000-0000-0000-000000000004', private.current_daily_checkin_day() - 1, 1, 1, 1, 1)$$,
  '42501', null,
  'a member cannot insert a past day'
);
select throws_ok(
  $$select public.save_member_daily_checkin(private.current_daily_checkin_day(), 6, 3, 2, 5)$$,
  '23514', null,
  'scores outside one to five are rejected by the table constraint'
);
reset role;

-- Only currently connected coaches can read the member’s answers.
set local role authenticated;
set local request.jwt.claims = '{"sub":"d1000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.member_daily_checkins
   where member_id = 'd1000000-0000-0000-0000-000000000004'),
  1,
  'a linked coach can read their member’s daily check-in'
);
select is(
  (select count(*)::int from public.member_daily_checkins
   where member_id = 'd1000000-0000-0000-0000-000000000005'),
  0,
  'a coach cannot read another coach’s member'
);
select throws_ok(
  $$select public.save_member_daily_checkin(private.current_daily_checkin_day(), 4, 4, 2, 4)$$,
  '42501', null,
  'a coach cannot save a member daily check-in'
);
reset role;

-- A member who leaves a coach no longer shares daily wellbeing answers with them.
set local role authenticated;
set local request.jwt.claims = '{"sub":"d1000000-0000-0000-0000-000000000004","role":"authenticated"}';
delete from public.coach_members
where coach_id = 'd1000000-0000-0000-0000-000000000002'
  and member_id = 'd1000000-0000-0000-0000-000000000004';
select is(
  (select count(*)::int from public.coach_members
   where coach_id = 'd1000000-0000-0000-0000-000000000002'
     and member_id = 'd1000000-0000-0000-0000-000000000004'),
  0,
  'a member can disconnect from their coach'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"d1000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.member_daily_checkins
   where member_id = 'd1000000-0000-0000-0000-000000000004'),
  0,
  'a former coach cannot read daily check-ins after the member disconnects'
);
reset role;

-- An unrelated member can see only their own row; their coach sees only that linked row.
set local role authenticated;
set local request.jwt.claims = '{"sub":"d1000000-0000-0000-0000-000000000005","role":"authenticated"}';
select is(
  (select count(*)::int from public.member_daily_checkins
   where member_id = 'd1000000-0000-0000-0000-000000000005'),
  1,
  'another member can read their own daily check-in'
);
select is(
  (select count(*)::int from public.member_daily_checkins
   where member_id = 'd1000000-0000-0000-0000-000000000004'),
  0,
  'another member cannot see the first member’s row'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"d1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(
  (select count(*)::int from public.member_daily_checkins
   where member_id = 'd1000000-0000-0000-0000-000000000005'),
  1,
  'a second linked coach can read their own member’s row'
);
select is(
  (select count(*)::int from public.member_daily_checkins
   where member_id = 'd1000000-0000-0000-0000-000000000004'),
  0,
  'a second coach cannot read an unrelated member’s row'
);
reset role;

-- Even with an old coach_members row, a person who is no longer a coach cannot read it.
update public.profiles set role = 'member'
where id = 'd1000000-0000-0000-0000-000000000003';
set local role authenticated;
set local request.jwt.claims = '{"sub":"d1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(
  (select count(*)::int from public.member_daily_checkins
   where member_id = 'd1000000-0000-0000-0000-000000000005'),
  0,
  'a coach whose role changed cannot read a former member’s daily check-in'
);
reset role;

-- Administrators have no policy, even though they can read many other account records.
set local role authenticated;
set local request.jwt.claims = '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.member_daily_checkins),
  0,
  'administrators cannot read daily wellbeing check-ins'
);
reset role;

-- A role-changed former member cannot use the own-row policy after becoming a coach.
update public.profiles set role = 'coach'
where id = 'd1000000-0000-0000-0000-000000000006';
set local role authenticated;
set local request.jwt.claims = '{"sub":"d1000000-0000-0000-0000-000000000006","role":"authenticated"}';
select is(
  (select count(*)::int from public.member_daily_checkins
   where member_id = 'd1000000-0000-0000-0000-000000000006'),
  0,
  'a former member with a coach role cannot read their old member row'
);
select throws_ok(
  $$select public.save_member_daily_checkin(private.current_daily_checkin_day(), 4, 4, 2, 4)$$,
  '42501', null,
  'a former member with a coach role cannot write a daily check-in'
);
reset role;

set local role anon;
select throws_ok(
  'select id from public.member_daily_checkins',
  '42501', null,
  'anonymous visitors cannot read daily check-ins'
);
reset role;

select * from finish();
rollback;
