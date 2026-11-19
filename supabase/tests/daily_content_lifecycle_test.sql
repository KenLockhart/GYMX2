begin;
select no_plan();

set local daily_content.test_day = '2026-11-18';
create or replace function private.current_daily_checkin_day()
returns date
language sql
stable
set search_path = ''
as $$
  select current_setting('daily_content.test_day')::date;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('86000000-0000-0000-0000-000000000001', 'daily-lifecycle-coach-a@example.test', '{"display_name":"Lifecycle Coach A"}'),
  ('86000000-0000-0000-0000-000000000002', 'daily-lifecycle-coach-b@example.test', '{"display_name":"Lifecycle Coach B"}'),
  ('86000000-0000-0000-0000-000000000003', 'daily-lifecycle-coach-c@example.test', '{"display_name":"Lifecycle Coach C"}'),
  ('86000000-0000-0000-0000-000000000004', 'daily-lifecycle-member-a@example.test', '{"display_name":"Lifecycle Member A"}'),
  ('86000000-0000-0000-0000-000000000005', 'daily-lifecycle-member-b@example.test', '{"display_name":"Lifecycle Member B"}');

update public.profiles set role = 'coach'
where id in (
  '86000000-0000-0000-0000-000000000001',
  '86000000-0000-0000-0000-000000000002',
  '86000000-0000-0000-0000-000000000003'
);

insert into public.videos (id, coach_id, cloudflare_uid, title, status, visibility) values
  ('86000000-0000-0000-0000-000000000011', '86000000-0000-0000-0000-000000000001', 'dcl-lifecycle-future', 'Lifecycle future video', 'ready', 'members'),
  ('86000000-0000-0000-0000-000000000012', '86000000-0000-0000-0000-000000000001', 'dcl-lifecycle-saved', 'Lifecycle saved source', 'ready', 'private'),
  ('86000000-0000-0000-0000-000000000013', '86000000-0000-0000-0000-000000000001', 'dcl-lifecycle-replacement', 'Lifecycle replacement', 'ready', 'members'),
  ('86000000-0000-0000-0000-000000000014', '86000000-0000-0000-0000-000000000002', 'dcl-lifecycle-coach-b', 'Lifecycle latest coach B', 'ready', 'members'),
  ('86000000-0000-0000-0000-000000000015', '86000000-0000-0000-0000-000000000003', 'dcl-lifecycle-coach-c', 'Lifecycle latest coach C', 'ready', 'members');

insert into public.coach_members (coach_id, member_id) values
  ('86000000-0000-0000-0000-000000000001', '86000000-0000-0000-0000-000000000004'),
  ('86000000-0000-0000-0000-000000000001', '86000000-0000-0000-0000-000000000005'),
  ('86000000-0000-0000-0000-000000000002', '86000000-0000-0000-0000-000000000005'),
  ('86000000-0000-0000-0000-000000000003', '86000000-0000-0000-0000-000000000005');
update public.coach_members
set created_at = case coach_id
  when '86000000-0000-0000-0000-000000000001' then '2026-11-18 09:00:00+00'::timestamptz
  else '2026-11-18 10:00:00+00'::timestamptz
end
where member_id = '86000000-0000-0000-0000-000000000005';

-- The future scheduled slot is invisible before its Eastern publication day.
set local role authenticated;
set local request.jwt.claims = '{"sub":"86000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
  $$select * from public.save_daily_content_item(null, 'video', 'Lifecycle future item', '86000000-0000-0000-0000-000000000011', null, null, null)$$,
  'coach can create a future video item'
);
select lives_ok(
  $$select public.publish_daily_content_slot(
    (select id from public.daily_content_items where owner_id = auth.uid() and title = 'Lifecycle future item'),
    (select id from public.daily_content_revisions where title_snapshot = 'Lifecycle future item'),
    private.current_daily_checkin_day() + 1
  )$$,
  'coach can schedule a video for the next day'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"86000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(
  (select video_id::text from public.resolve_member_daily_content()),
  null::text,
  'a next-day scheduled video is not selected today'
);
reset role;

set local daily_content.test_day = '2026-11-19';
set local role authenticated;
set local request.jwt.claims = '{"sub":"86000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(
  (select video_id::text from public.resolve_member_daily_content()),
  '86000000-0000-0000-0000-000000000011',
  'the scheduled video becomes eligible on its Eastern publication day'
);
reset role;

-- Return to the publication day and prepare three coaches; newest connection wins,
-- with ascending coach UUID as the deterministic tie break for equal timestamps.
set local daily_content.test_day = '2026-11-18';
set local role authenticated;
set local request.jwt.claims = '{"sub":"86000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
  $$select * from public.save_daily_content_item(null, 'video', 'Lifecycle saved original', '86000000-0000-0000-0000-000000000012', null, null, null)$$,
  'coach can create the video that the member will save'
);
select lives_ok(
  $$select public.publish_daily_content_slot(
    (select id from public.daily_content_items where owner_id = auth.uid() and title = 'Lifecycle saved original'),
    (select id from public.daily_content_revisions where title_snapshot = 'Lifecycle saved original'),
    private.current_daily_checkin_day()
  )$$,
  'coach publishes the original saved video for today'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"86000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok(
  $$select * from public.save_daily_content_item(null, 'video', 'Lifecycle tied coach B item', '86000000-0000-0000-0000-000000000014', null, null, null)$$,
  'the first tied coach can create today’s video'
);
select lives_ok(
  $$select public.publish_daily_content_slot(
    (select id from public.daily_content_items where owner_id = auth.uid() and title = 'Lifecycle tied coach B item'),
    (select id from public.daily_content_revisions where title_snapshot = 'Lifecycle tied coach B item'),
    private.current_daily_checkin_day()
  )$$,
  'the first tied coach publishes today’s video'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"86000000-0000-0000-0000-000000000003","role":"authenticated"}';
select lives_ok(
  $$select * from public.save_daily_content_item(null, 'video', 'Lifecycle tied coach C item', '86000000-0000-0000-0000-000000000015', null, null, null)$$,
  'the second tied coach can create today’s video'
);
select lives_ok(
  $$select public.publish_daily_content_slot(
    (select id from public.daily_content_items where owner_id = auth.uid() and title = 'Lifecycle tied coach C item'),
    (select id from public.daily_content_revisions where title_snapshot = 'Lifecycle tied coach C item'),
    private.current_daily_checkin_day()
  )$$,
  'the second tied coach publishes today’s video'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"86000000-0000-0000-0000-000000000005","role":"authenticated"}';
select is(
  (select video_id::text from public.resolve_member_daily_content()),
  '86000000-0000-0000-0000-000000000014',
  'the newest current coach wins and the lowest coach UUID wins an equal-time tie'
);
reset role;

-- The grant binds the exact slot/revision/video even after the slot is replaced.
set local role authenticated;
set local request.jwt.claims = '{"sub":"86000000-0000-0000-0000-000000000004","role":"authenticated"}';
select lives_ok(
  $$select public.set_member_daily_fuel_bookmark('86000000-0000-0000-0000-000000000012', true)$$,
  'member saves the exact current coach video'
);
reset role;

select is(
  (select count(*)::int from public.member_daily_content_video_grants
   where member_id = '86000000-0000-0000-0000-000000000004'
     and day = '2026-11-18' and video_id = '86000000-0000-0000-0000-000000000012'
     and revision_id = (select id from public.daily_content_revisions where title_snapshot = 'Lifecycle saved original')),
  1,
  'the saved grant captures the exact original video revision'
);
select is(
  (select count(*)::int from public.member_daily_fuel_bookmarks
   where member_id = '86000000-0000-0000-0000-000000000004'
     and video_id = '86000000-0000-0000-0000-000000000012'),
  1,
  'the exact video has its own bookmark'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"86000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
  $$select * from public.save_daily_content_item(
    (select id from public.daily_content_items where owner_id = auth.uid() and title = 'Lifecycle saved original'),
    'video', 'Lifecycle saved replacement', '86000000-0000-0000-0000-000000000013', null, null, null
  )$$,
  'coach can replace the current slot with a new immutable video revision'
);
select lives_ok(
  $$select public.publish_daily_content_slot(
    (select id from public.daily_content_items where owner_id = auth.uid() and title = 'Lifecycle saved replacement'),
    (select id from public.daily_content_revisions where title_snapshot = 'Lifecycle saved replacement'),
    private.current_daily_checkin_day()
  )$$,
  'the coach replaces the published slot revision'
);
reset role;

select is(
  (select revision_id::text from public.daily_content_slots
   where coach_id = '86000000-0000-0000-0000-000000000001'
     and day = '2026-11-18' and content_kind = 'video' and status = 'published'),
  (select id::text from public.daily_content_revisions where title_snapshot = 'Lifecycle saved replacement'),
  'the live slot now points to the replacement revision'
);
select is(
  (select revision_id::text from public.member_daily_content_video_grants
   where member_id = '86000000-0000-0000-0000-000000000004'
     and day = '2026-11-18' and video_id = '86000000-0000-0000-0000-000000000012'),
  (select id::text from public.daily_content_revisions where title_snapshot = 'Lifecycle saved original'),
  'the saved grant keeps the original revision after the live slot is replaced'
);
select is(
  (select video_id::text from public.member_daily_content_video_grants
   where member_id = '86000000-0000-0000-0000-000000000004'
     and day = '2026-11-18' and video_id = '86000000-0000-0000-0000-000000000012'),
  '86000000-0000-0000-0000-000000000012',
  'the saved grant remains bound to the original exact video'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"86000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(
  (select video_id::text from public.resolve_member_daily_content()),
  '86000000-0000-0000-0000-000000000013',
  'the member sees the replacement as current while the original grant remains separate'
);
reset role;

set local daily_content.test_day = '2026-11-19';
delete from public.coach_members
where coach_id = '86000000-0000-0000-0000-000000000001'
  and member_id = '86000000-0000-0000-0000-000000000004';

set local role authenticated;
set local request.jwt.claims = '{"sub":"86000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(
  (select video_id::text from public.resolve_member_daily_content()),
  null::text,
  'unlinking removes the coach’s current content from member resolution'
);
select is(
  (select count(*)::int from public.member_daily_content_video_grants
   where member_id = auth.uid() and day = '2026-11-18'
     and video_id = '86000000-0000-0000-0000-000000000012'),
  1,
  'the member’s exact saved grant survives the day rollover and coach unlink'
);
select is(
  (select count(*)::int from public.member_daily_fuel_bookmarks
   where member_id = auth.uid() and video_id = '86000000-0000-0000-0000-000000000012'),
  1,
  'the saved bookmark also survives the day rollover and coach unlink'
);
select is(
  public.set_member_daily_fuel_bookmark('86000000-0000-0000-0000-000000000012', false),
  false,
  'member can unsave the old exact video without a current coach assignment'
);
select is(
  (select count(*)::int from public.member_daily_content_video_grants
   where member_id = auth.uid() and video_id = '86000000-0000-0000-0000-000000000012'),
  0,
  'unsaving removes the exact Daily Content grant'
);
select is(
  (select count(*)::int from public.member_daily_fuel_bookmarks
   where member_id = auth.uid() and video_id = '86000000-0000-0000-0000-000000000012'),
  0,
  'unsaving removes the member bookmark'
);
reset role;

select * from finish();
rollback;
