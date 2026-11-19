begin;
select plan(29);

insert into auth.users (id, email, raw_user_meta_data) values
  ('84000000-0000-0000-0000-000000000001', 'fuel-admin@example.test', '{"display_name":"Fuel Admin"}'),
  ('84000000-0000-0000-0000-000000000002', 'fuel-coach-a@example.test', '{"display_name":"Coach A"}'),
  ('84000000-0000-0000-0000-000000000003', 'fuel-coach-b@example.test', '{"display_name":"Coach B"}'),
  ('84000000-0000-0000-0000-000000000004', 'fuel-member-a@example.test', '{"display_name":"Member A"}'),
  ('84000000-0000-0000-0000-000000000005', 'fuel-member-b@example.test', '{"display_name":"Member B"}');

update public.profiles set role = 'admin'
where id = '84000000-0000-0000-0000-000000000001';
update public.profiles set role = 'coach'
where id in ('84000000-0000-0000-0000-000000000002', '84000000-0000-0000-0000-000000000003');
insert into public.coach_members (coach_id, member_id) values
  ('84000000-0000-0000-0000-000000000002', '84000000-0000-0000-0000-000000000004');

insert into public.videos (id, coach_id, cloudflare_uid, title, status, visibility)
values
  ('84000000-0000-0000-0000-000000000011', '84000000-0000-0000-0000-000000000002', 'fuel-ready-a', 'Ready video A', 'ready', 'private'),
  ('84000000-0000-0000-0000-000000000012', '84000000-0000-0000-0000-000000000003', 'fuel-ready-b', 'Ready video B', 'ready', 'members'),
  ('84000000-0000-0000-0000-000000000013', '84000000-0000-0000-0000-000000000002', 'fuel-uploading', 'Unready video', 'processing', 'members'),
  ('84000000-0000-0000-0000-000000000014', '84000000-0000-0000-0000-000000000002', 'fuel-program-only', 'Program-only video', 'ready', 'members');

set local role authenticated;
set local request.jwt.claims = '{"sub":"84000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok(
  $$select public.assign_member_daily_fuel_video(
    '84000000-0000-0000-0000-000000000004',
    '84000000-0000-0000-0000-000000000011',
    private.current_daily_checkin_day()
  )$$,
  'a coach can feature their ready video for their connected member'
);
select throws_ok(
  $$select public.assign_member_daily_fuel_video(
    '84000000-0000-0000-0000-000000000005',
    '84000000-0000-0000-0000-000000000011',
    private.current_daily_checkin_day()
  )$$,
  '42501', 'A current coach-member connection is required',
  'a coach cannot feature a video for an unconnected member'
);
select throws_ok(
  $$select public.assign_member_daily_fuel_video(
    '84000000-0000-0000-0000-000000000004',
    '84000000-0000-0000-0000-000000000012',
    private.current_daily_checkin_day()
  )$$,
  '42501', 'Coaches can feature only their own videos',
  'a coach cannot feature another coach’s video'
);
select throws_ok(
  $$select public.assign_member_daily_fuel_video(
    '84000000-0000-0000-0000-000000000004',
    '84000000-0000-0000-0000-000000000013',
    private.current_daily_checkin_day()
  )$$,
  '22023', 'A ready video is required',
  'a processing video cannot be featured'
);
select throws_ok(
  $$select public.assign_member_daily_fuel_video(
    '84000000-0000-0000-0000-000000000004',
    '84000000-0000-0000-0000-000000000011',
    private.current_daily_checkin_day() - 1
  )$$,
  'P0001', 'Daily Fuel day changed',
  'a stale page cannot assign for yesterday'
);
reset role;
do $$
declare
  visibility_constraint text;
begin
  select conname into visibility_constraint
  from pg_constraint
  where conrelid = 'public.videos'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%visibility%'
  order by conname
  limit 1;
  if visibility_constraint is null then
    raise exception 'Expected a visibility check constraint on public.videos';
  end if;
  execute format('alter table public.videos drop constraint %I', visibility_constraint);
end $$;
update public.videos set visibility = 'program_only'
where id = '84000000-0000-0000-0000-000000000014';
set local role authenticated;
set local request.jwt.claims = '{"sub":"84000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$select public.assign_member_daily_fuel_video(
    '84000000-0000-0000-0000-000000000004',
    '84000000-0000-0000-0000-000000000014',
    private.current_daily_checkin_day()
  )$$,
  '42501', 'Only member-visible videos can be featured',
  'a non-member visibility cannot be featured through the assignment RPC'
);
reset role;
update public.videos set visibility = 'members'
where id = '84000000-0000-0000-0000-000000000014';
set local request.jwt.claims = '{"sub":"84000000-0000-0000-0000-000000000099","role":"authenticated"}';
select throws_ok(
  $$select public.assign_member_daily_fuel_video(
    '84000000-0000-0000-0000-000000000004',
    '84000000-0000-0000-0000-000000000011',
    private.current_daily_checkin_day()
  )$$,
  '42501', 'Coach or admin access required',
  'an authenticated subject without a profile cannot assign Daily Fuel'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"84000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(
  (select count(*)::int from public.member_daily_fuel_assignments where member_id = auth.uid()),
  1,
  'a member reads their own assignment'
);
select is(
  (select count(*)::int from public.member_daily_fuel_assignments where member_id = '84000000-0000-0000-0000-000000000005'),
  0,
  'a member cannot read another member’s assignment'
);
select throws_ok(
  $$insert into public.member_daily_fuel_assignments (member_id, coach_id, video_id, day)
    values (auth.uid(), '84000000-0000-0000-0000-000000000002', '84000000-0000-0000-0000-000000000011', private.current_daily_checkin_day())$$,
  '42501', null,
  'members cannot write assignments directly'
);
select is(
  has_table_privilege('authenticated', 'public.member_daily_fuel_assignments', 'INSERT'),
  false,
  'authenticated users have no assignment insert grant'
);
select lives_ok(
  $$select public.set_member_daily_fuel_bookmark('84000000-0000-0000-0000-000000000011', true)$$,
  'a member can save a video that was featured for them'
);
select throws_ok(
  $$select public.set_member_daily_fuel_bookmark('84000000-0000-0000-0000-000000000012', true)$$,
  '42501', 'Only a featured video can be saved',
  'a member cannot save an unrelated private video'
);
select is(
  (select count(*)::int from public.member_daily_fuel_bookmarks where member_id = auth.uid()),
  1,
  'the member sees their own bookmark'
);
select is(
  (select count(*)::int from public.member_daily_fuel_bookmarks where member_id = '84000000-0000-0000-0000-000000000005'),
  0,
  'the member cannot read another person’s bookmark'
);
select throws_ok(
  $$insert into public.member_daily_fuel_bookmarks (member_id, video_id)
    values (auth.uid(), '84000000-0000-0000-0000-000000000012')$$,
  '42501', null,
  'members cannot bypass the featured-video bookmark RPC'
);
select lives_ok(
  $$select public.set_member_daily_affirmation(private.current_daily_checkin_day(), true)$$,
  'a member saves today’s affirmation'
);
select is(
  (select count(*)::int from public.member_daily_affirmations where member_id = auth.uid()),
  1,
  'the member can read their own affirmation row'
);
select throws_ok(
  $$select public.set_member_daily_affirmation(private.current_daily_checkin_day() - 1, true)$$,
  'P0001', 'Daily Fuel day changed',
  'a member cannot save an affirmation for a past day'
);
select throws_ok(
  $$select public.set_member_daily_affirmation(private.current_daily_checkin_day() + 1, true)$$,
  'P0001', 'Daily Fuel day changed',
  'a member cannot save an affirmation for a future day'
);
select lives_ok(
  $$select public.set_member_daily_affirmation(private.current_daily_checkin_day(), false)$$,
  'the member can turn off today’s affirmation'
);
select is(
  (select count(*)::int from public.member_daily_affirmations where member_id = auth.uid()),
  0,
  'turning off removes only today’s affirmation row'
);
select throws_ok(
  $$insert into public.member_daily_affirmations (member_id, day)
    values (auth.uid(), private.current_daily_checkin_day())$$,
  '42501', null,
  'members cannot write affirmations directly'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"84000000-0000-0000-0000-000000000005","role":"authenticated"}';
select is(
  (select count(*)::int from public.member_daily_fuel_assignments),
  0,
  'a second member sees only their own assignment rows'
);
select is(
  (select count(*)::int from public.member_daily_fuel_bookmarks),
  0,
  'a second member sees no other member bookmarks'
);
select is(
  (select count(*)::int from public.member_daily_affirmations),
  0,
  'a second member sees no other member affirmations'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"84000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
  $$select public.assign_member_daily_fuel_video(
    '84000000-0000-0000-0000-000000000004',
    '84000000-0000-0000-0000-000000000012',
    private.current_daily_checkin_day()
  )$$,
  'an admin can feature a ready video for any member'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"84000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$select public.assign_member_daily_fuel_video(
    '84000000-0000-0000-0000-000000000004',
    '84000000-0000-0000-0000-000000000011',
    private.current_daily_checkin_day()
  )$$,
  '42501', 'Another coach already featured today’s video',
  'a coach cannot replace an admin override made with another coach’s video'
);
reset role;
select is(
  (select video_id::text from public.member_daily_fuel_assignments
   where member_id = '84000000-0000-0000-0000-000000000004'
     and day = private.current_daily_checkin_day()),
  '84000000-0000-0000-0000-000000000012',
  'a rejected coach overwrite leaves the admin assignment intact'
);
reset role;

select * from finish();
rollback;
