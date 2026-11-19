begin;
select plan(16);

insert into auth.users (id, email, raw_user_meta_data) values
  ('e1000000-0000-0000-0000-000000000001', 'program-admin@example.test', '{"display_name":"Program Admin"}'),
  ('e1000000-0000-0000-0000-000000000002', 'program-coach@example.test', '{"display_name":"Program Coach"}'),
  ('e1000000-0000-0000-0000-000000000003', 'program-rival@example.test', '{"display_name":"Program Rival"}'),
  ('e1000000-0000-0000-0000-000000000004', 'program-member@example.test', '{"display_name":"Program Member"}'),
  ('e1000000-0000-0000-0000-000000000005', 'program-no-access@example.test', '{"display_name":"No Program Access"}');

update public.profiles set role = 'admin'
where id = 'e1000000-0000-0000-0000-000000000001';
update public.profiles set role = 'coach'
where id in (
  'e1000000-0000-0000-0000-000000000002',
  'e1000000-0000-0000-0000-000000000003'
);

insert into public.platform_test_entitlements (member_id, tier, grant_reason, granted_by)
values (
  'e1000000-0000-0000-0000-000000000004',
  'regular',
  'Programs intro access test',
  'e1000000-0000-0000-0000-000000000001'
);

insert into public.videos (id, coach_id, cloudflare_uid, title, description, status, visibility) values
  ('e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'admin-intro-ready', 'Admin intro', 'Intro description', 'ready', 'private'),
  ('e2000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'coach-intro-ready', 'Coach intro', '', 'ready', 'private'),
  ('e2000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000003', 'rival-video-ready', 'Rival video', '', 'ready', 'private'),
  ('e2000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 'admin-intro-processing', 'Processing intro', '', 'processing', 'private');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
  $$insert into public.programs (id, coach_id, title, description, published, platform_owned, intro_video_id)
    values ('e3000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'GYMX2 Program', '', true, true, 'e2000000-0000-0000-0000-000000000001')$$,
  'an admin can create a platform-owned program with their ready intro video'
);
select throws_ok(
  $$insert into public.programs (id, coach_id, title, published, platform_owned)
    values ('e3000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'Incorrect owner mode', true, false)$$,
  '42501', null, 'an admin cannot create a coach-owned program'
);
reset role;

insert into public.programs (id, coach_id, title, description, published)
values (
  'e3000000-0000-0000-0000-000000000003',
  'e1000000-0000-0000-0000-000000000002',
  'Legacy free program',
  'No billing fields were added to legacy Programs.',
  true
);
insert into public.program_days (id, program_id, day_number, title, instructions, pillar)
values
  ('e4000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 1, 'Platform day', '', 'body'),
  ('e4000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000003', 1, 'Legacy day', '', 'mind');

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$insert into public.programs (id, coach_id, title, published, platform_owned)
    values ('e3000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000002', 'Coach platform attempt', true, true)$$,
  '42501', null, 'a coach cannot create a platform-owned program'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(
  (select count(*)::int from public.programs where id = 'e3000000-0000-0000-0000-000000000001'),
  1,
  'an entitled signed-in member can view a published platform-owned program'
);
select is(
  (select count(*)::int from public.program_days where program_id = 'e3000000-0000-0000-0000-000000000001'),
  1,
  'the member can read program days after RLS allows the program'
);
select is(
  (select count(*)::int from public.videos where id = 'e2000000-0000-0000-0000-000000000001'),
  0,
  'the program preview does not grant direct access to a private Library video'
);
select is(
  (select intro_video_id from public.programs where id = 'e3000000-0000-0000-0000-000000000001'),
  'e2000000-0000-0000-0000-000000000001'::uuid,
  'the member can see which single intro is attached to the visible program'
);
select lives_ok(
  $$insert into public.program_enrollments (program_id, member_id, started_on)
    values ('e3000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000004', (now() at time zone 'America/New_York')::date)$$,
  'the member can start the platform-owned program'
);
select is(
  (select count(*)::int from public.programs where id = 'e3000000-0000-0000-0000-000000000003'),
  0,
  'a member cannot see a coach program before joining that coach'
);
select lives_ok(
  $$insert into public.coach_members (coach_id, member_id)
    values ('e1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000004')$$,
  'a member can join the coach as before'
);
select is(
  (select count(*)::int from public.programs where id = 'e3000000-0000-0000-0000-000000000003'),
  1,
  'an existing published free coach program remains available after joining'
);
select lives_ok(
  $$insert into public.program_enrollments (program_id, member_id, started_on)
    values ('e3000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000004', (now() at time zone 'America/New_York')::date)$$,
  'the existing direct-start path still works for a free program'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000005","role":"authenticated"}';
select is(
  (select count(*)::int from public.programs where id = 'e3000000-0000-0000-0000-000000000001'),
  0,
  'a signed-in member without Programs entitlement cannot see a platform-owned program'
);
reset role;

select throws_ok(
  $$insert into public.programs (id, coach_id, title, published, platform_owned, intro_video_id)
    values ('e3000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000001', 'Wrong owner intro', true, true, 'e2000000-0000-0000-0000-000000000003')$$,
  '23514', 'Choose a ready video that belongs to this program creator',
  'the database rejects an intro owned by another creator'
);
select throws_ok(
  $$insert into public.programs (id, coach_id, title, published, platform_owned, intro_video_id)
    values ('e3000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000001', 'Not ready intro', true, true, 'e2000000-0000-0000-0000-000000000004')$$,
  '23514', 'Choose a ready video that belongs to this program creator',
  'the database rejects an intro that has not finished processing'
);
select is(
  (select platform_owned is false and intro_video_id is null from public.programs where id = 'e3000000-0000-0000-0000-000000000003'),
  true,
  'legacy free programs keep their default ownership and empty intro'
);

select * from finish();
rollback;
