begin;
select plan(22);

insert into auth.users (id, email, raw_user_meta_data) values
  ('e1800000-0000-0000-0000-000000000001', 'today-member@example.test', '{"display_name":"Today Member"}'),
  ('e1800000-0000-0000-0000-000000000002', 'today-coach@example.test', '{"display_name":"Today Coach"}');
update public.profiles set role = 'coach' where id = 'e1800000-0000-0000-0000-000000000002';
insert into public.habits (id, user_id, name, pillar) values
  ('e1800000-0000-0000-0000-0000000000a1', 'e1800000-0000-0000-0000-000000000001', 'Meditate', 'mind'),
  ('e1800000-0000-0000-0000-0000000000a2', 'e1800000-0000-0000-0000-000000000002', 'Coach walk', 'body');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1800000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
  $$insert into public.habit_logs (habit_id, user_id, day) values ('e1800000-0000-0000-0000-0000000000a1', auth.uid(), private.current_daily_checkin_day())$$,
  'member can check off a habit today'
);
select throws_ok(
  $$insert into public.habit_logs (habit_id, user_id, day) values ('e1800000-0000-0000-0000-0000000000a1', auth.uid(), private.current_daily_checkin_day() - 1)$$,
  '42501', null, 'member cannot backdate a habit check-in'
);
select throws_ok(
  $$insert into public.habit_logs (habit_id, user_id, day) values ('e1800000-0000-0000-0000-0000000000a1', auth.uid(), private.current_daily_checkin_day() + 1)$$,
  '42501', null, 'member cannot future-date a habit check-in'
);
select lives_ok(
  $$insert into public.body_logs (user_id, day, weight_lb) values (auth.uid(), private.current_daily_checkin_day(), 180)$$,
  'member can save a body log today'
);
select throws_ok(
  $$insert into public.body_logs (user_id, day, weight_lb) values (auth.uid(), private.current_daily_checkin_day() - 1, 181)$$,
  '42501', null, 'member cannot backdate a body log'
);
select throws_ok(
  $$insert into public.body_logs (user_id, day, weight_lb) values (auth.uid(), private.current_daily_checkin_day() + 1, 181)$$,
  '42501', null, 'member cannot future-date a body log'
);
select lives_ok(
  $$insert into public.nutrition_logs (user_id, day, protein_g) values (auth.uid(), private.current_daily_checkin_day(), 150)$$,
  'member can save a nutrition log today'
);
select throws_ok(
  $$insert into public.nutrition_logs (user_id, day, protein_g) values (auth.uid(), private.current_daily_checkin_day() - 1, 151)$$,
  '42501', null, 'member cannot backdate a nutrition log'
);
select throws_ok(
  $$insert into public.nutrition_logs (user_id, day, protein_g) values (auth.uid(), private.current_daily_checkin_day() + 1, 151)$$,
  '42501', null, 'member cannot future-date a nutrition log'
);
select lives_ok(
  $$insert into public.progress_photos (user_id, day, pose, path) values (auth.uid(), private.current_daily_checkin_day(), 'front', auth.uid()::text || '/today.jpg')$$,
  'member can add a progress photo today'
);
select throws_ok(
  $$insert into public.progress_photos (user_id, day, pose, path) values (auth.uid(), private.current_daily_checkin_day() - 1, 'front', auth.uid()::text || '/past.jpg')$$,
  '42501', null, 'member cannot backdate a progress photo'
);
select throws_ok(
  $$insert into public.progress_photos (user_id, day, pose, path) values (auth.uid(), private.current_daily_checkin_day() + 1, 'front', auth.uid()::text || '/future.jpg')$$,
  '42501', null, 'member cannot future-date a progress photo'
);
reset role;

-- Seed historical rows as the test owner to prove they remain visible but read only.
insert into public.habit_logs (habit_id, user_id, day)
values ('e1800000-0000-0000-0000-0000000000a1', 'e1800000-0000-0000-0000-000000000001', private.current_daily_checkin_day() - 1);
insert into public.body_logs (user_id, day, weight_lb)
values ('e1800000-0000-0000-0000-000000000001', private.current_daily_checkin_day() - 1, 179);
insert into public.nutrition_logs (user_id, day, protein_g)
values ('e1800000-0000-0000-0000-000000000001', private.current_daily_checkin_day() - 1, 149);
insert into public.progress_photos (user_id, day, pose, path)
values ('e1800000-0000-0000-0000-000000000001', private.current_daily_checkin_day() - 1, 'side', 'e1800000-0000-0000-0000-000000000001/past-existing.jpg');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1800000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.habit_logs where day < private.current_daily_checkin_day()), 1, 'member can still read historical habit check-ins');
select is((select count(*)::int from public.body_logs where day < private.current_daily_checkin_day()), 1, 'member can still read historical body logs');
select is((select count(*)::int from public.nutrition_logs where day < private.current_daily_checkin_day()), 1, 'member can still read historical nutrition logs');
select is((select count(*)::int from public.progress_photos where day < private.current_daily_checkin_day()), 1, 'member can still read historical progress photos');
with changed as (
  update public.body_logs set weight_lb = 178
  where user_id = auth.uid() and day < private.current_daily_checkin_day()
  returning 1
)
select is((select count(*)::int from changed), 0, 'member cannot edit a historical body log');
with changed as (
  update public.nutrition_logs set protein_g = 148
  where user_id = auth.uid() and day < private.current_daily_checkin_day()
  returning 1
)
select is((select count(*)::int from changed), 0, 'member cannot edit a historical nutrition log');
with removed as (
  delete from public.body_logs
  where user_id = auth.uid() and day < private.current_daily_checkin_day()
  returning 1
)
select is((select count(*)::int from removed), 0, 'member cannot delete a historical body log');
with removed as (
  delete from public.habit_logs
  where user_id = auth.uid() and day < private.current_daily_checkin_day()
  returning 1
)
select is((select count(*)::int from removed), 0, 'member cannot delete a historical habit check-in');
with removed as (
  delete from public.progress_photos
  where user_id = auth.uid() and day < private.current_daily_checkin_day()
  returning 1
)
select is((select count(*)::int from removed), 0, 'member cannot delete a historical progress photo');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1800000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok(
  $$insert into public.habit_logs (habit_id, user_id, day) values ('e1800000-0000-0000-0000-0000000000a2', auth.uid(), private.current_daily_checkin_day() - 8)$$,
  'coach keeps the existing broad database write policy'
);
reset role;

select * from finish();
rollback;
