begin;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('85000000-0000-0000-0000-000000000001', 'daily-admin@example.test', '{"display_name":"Daily Admin"}'),
  ('85000000-0000-0000-0000-000000000002', 'daily-coach-a@example.test', '{"display_name":"Coach A"}'),
  ('85000000-0000-0000-0000-000000000003', 'daily-coach-b@example.test', '{"display_name":"Coach B"}'),
  ('85000000-0000-0000-0000-000000000004', 'daily-member-a@example.test', '{"display_name":"Member A"}'),
  ('85000000-0000-0000-0000-000000000005', 'daily-member-b@example.test', '{"display_name":"Member B"}');
update public.profiles set role = 'admin' where id = '85000000-0000-0000-0000-000000000001';
update public.profiles set role = 'coach'
where id in ('85000000-0000-0000-0000-000000000002', '85000000-0000-0000-0000-000000000003');
insert into public.coach_members (coach_id, member_id) values
  ('85000000-0000-0000-0000-000000000002', '85000000-0000-0000-0000-000000000004');
insert into public.videos (id, coach_id, cloudflare_uid, title, status, visibility)
values
  ('85000000-0000-0000-0000-000000000011', '85000000-0000-0000-0000-000000000002', 'daily-a', 'Coach video', 'ready', 'private'),
  ('85000000-0000-0000-0000-000000000012', '85000000-0000-0000-0000-000000000003', 'daily-b', 'Foreign coach video', 'ready', 'members'),
  ('85000000-0000-0000-0000-000000000013', '85000000-0000-0000-0000-000000000001', 'daily-admin', 'Admin video', 'ready', 'private'),
  ('85000000-0000-0000-0000-000000000014', '85000000-0000-0000-0000-000000000002', 'daily-pending', 'Pending video', 'processing', 'members'),
  ('85000000-0000-0000-0000-000000000015', '85000000-0000-0000-0000-000000000002', 'daily-delete', 'Unreferenced video', 'ready', 'members'),
  ('85000000-0000-0000-0000-000000000017', '85000000-0000-0000-0000-000000000002', 'daily-assigned', 'Assigned video', 'ready', 'members'),
  ('85000000-0000-0000-0000-000000000018', '85000000-0000-0000-0000-000000000002', 'daily-program-only', 'Program-only video', 'ready', 'members');

select is(
  has_column_privilege('authenticated', 'public.videos', 'daily_content_deletion_pending', 'UPDATE'),
  false,
  'authenticated users cannot update the provider deletion reservation column'
);

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select * from public.resolve_member_daily_content()$$,
  '42501', null, 'anonymous callers cannot resolve member Daily Content'
);
select is(has_function_privilege('anon', 'public.save_daily_content_item(uuid,text,text,uuid,text,text,text)', 'EXECUTE'), false,
  'anonymous callers cannot execute staff mutations');
reset role;

create temporary table daily_content_video_visibility_check as
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.videos'::regclass and contype = 'c'
  and pg_get_constraintdef(oid) ilike '%visibility%';
do $$
declare row record;
begin
  select * into row from daily_content_video_visibility_check order by conname limit 1;
  if row.conname is null then raise exception 'Expected videos visibility check'; end if;
  execute format('alter table public.videos drop constraint %I', row.conname);
end $$;
update public.videos set visibility = 'program_only'
where id = '85000000-0000-0000-0000-000000000018';

set local role authenticated;
set local request.jwt.claims = '{"sub":"85000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok(
  $$select * from public.save_daily_content_item(null, 'video', 'Coach reusable video', '85000000-0000-0000-0000-000000000011', null, null, null)$$,
  'a coach can save their ready private video as reusable Daily Content'
);
select lives_ok(
  $$select * from public.save_daily_content_item(null, 'quote', 'Coach quote', null, 'A little progress still moves you forward.', 'Coach A', null)$$,
  'a coach can save bounded quote text and attribution'
);
select lives_ok(
  $$select * from public.save_daily_content_item(null, 'affirmation', 'Coach affirmation', null, null, null, 'I can take one useful step today.')$$,
  'a coach can save bounded affirmation text'
);
select throws_ok(
  $$select * from public.save_daily_content_item(null, 'video', 'Foreign video', '85000000-0000-0000-0000-000000000012', null, null, null)$$,
  '42501', 'Daily Content can use only your own video', 'a coach cannot reuse another coach’s video'
);
select throws_ok(
  $$select * from public.save_daily_content_item(null, 'video', 'Processing video', '85000000-0000-0000-0000-000000000014', null, null, null)$$,
  '22023', 'A ready video is required', 'an unready video cannot enter Daily Content'
);
select throws_ok(
  $$select * from public.save_daily_content_item(null, 'video', 'Program-only video', '85000000-0000-0000-0000-000000000018', null, null, null)$$,
  '42501', 'This video visibility is not supported for Daily Content',
  'a future program-only video cannot be saved into Daily Content'
);
reset role;
update public.videos set visibility = 'members'
where id = '85000000-0000-0000-0000-000000000018';
do $$
declare row record;
begin
  select * into row from daily_content_video_visibility_check order by conname limit 1;
  execute format('alter table public.videos add constraint %I %s', row.conname, row.definition);
end $$;
drop table daily_content_video_visibility_check;
set local role authenticated;
set local request.jwt.claims = '{"sub":"85000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok(
  $$select public.publish_daily_content_slot(
    (select id from public.daily_content_items where owner_id = auth.uid() and title = 'Coach reusable video'),
    (select id from public.daily_content_revisions where title_snapshot = 'Coach reusable video'),
    private.current_daily_checkin_day()
  )$$,
  'a coach can publish their video for today'
);
select lives_ok(
  $$select public.publish_daily_content_slot(
    (select id from public.daily_content_items where owner_id = auth.uid() and title = 'Coach quote'),
    (select id from public.daily_content_revisions where title_snapshot = 'Coach quote'),
    private.current_daily_checkin_day()
  )$$,
  'a coach can publish a quote for today'
);
select lives_ok(
  $$select public.publish_daily_content_slot(
    (select id from public.daily_content_items where owner_id = auth.uid() and title = 'Coach affirmation'),
    (select id from public.daily_content_revisions where title_snapshot = 'Coach affirmation'),
    private.current_daily_checkin_day()
  )$$,
  'a coach can publish an affirmation for today'
);
select throws_ok(
  $$select public.publish_daily_content_slot(
    (select id from public.daily_content_items where owner_id = auth.uid() and title = 'Coach quote'),
    (select id from public.daily_content_revisions where title_snapshot = 'Coach quote'),
    private.current_daily_checkin_day() - 1
  )$$,
  '22023', 'Choose today or a date within the next year', 'staff cannot publish in the past'
);
select throws_ok(
  $$insert into public.daily_content_items (owner_id, owner_role, kind, title)
    values (auth.uid(), 'coach', 'quote', 'Direct insert')$$,
  '42501', null, 'staff cannot bypass the item save RPC'
);
select is(has_table_privilege('authenticated', 'public.daily_content_items', 'INSERT'), false,
  'authenticated users have no direct content insert privilege');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"85000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
  $$select * from public.save_daily_content_item(null, 'video', 'Global video', '85000000-0000-0000-0000-000000000013', null, null, null)$$,
  'an admin can save only their own video for the global fallback'
);
select lives_ok(
  $$select * from public.save_daily_content_item(null, 'quote', 'Global quote', null, 'Keep showing up.', 'Daily Team', null)$$,
  'an admin can author global quote text'
);
select lives_ok(
  $$select * from public.save_daily_content_item(null, 'affirmation', 'Global affirmation', null, null, null, 'I am allowed to grow at my own pace.')$$,
  'an admin can author global affirmation text'
);
select lives_ok(
  $$select public.publish_daily_content_slot(
    (select id from public.daily_content_items where owner_id = auth.uid() and title = 'Global video'),
    (select id from public.daily_content_revisions where title_snapshot = 'Global video'),
    private.current_daily_checkin_day()
  )$$,
  'an admin can publish a global fallback video'
);
select lives_ok(
  $$select public.publish_daily_content_slot(
    (select id from public.daily_content_items where owner_id = auth.uid() and title = 'Global quote'),
    (select id from public.daily_content_revisions where title_snapshot = 'Global quote'),
    private.current_daily_checkin_day()
  )$$,
  'an admin can publish a global quote fallback'
);
select lives_ok(
  $$select public.publish_daily_content_slot(
    (select id from public.daily_content_items where owner_id = auth.uid() and title = 'Global affirmation'),
    (select id from public.daily_content_revisions where title_snapshot = 'Global affirmation'),
    private.current_daily_checkin_day()
  )$$,
  'an admin can publish a global affirmation fallback'
);
select lives_ok(
  $$select public.publish_daily_content_slot(
    (select id from public.daily_content_items where owner_id = auth.uid() and title = 'Global video'),
    (select id from public.daily_content_revisions where title_snapshot = 'Global video'),
    private.current_daily_checkin_day() + 1
  )$$,
  'staff can schedule content for a future Eastern day'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"85000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(
  (select video_source from public.resolve_member_daily_content()), 'coach',
  'a member sees their current coach video before admin fallback'
);
select is(
  (select video_id::text from public.resolve_member_daily_content()), '85000000-0000-0000-0000-000000000011',
  'the resolver returns the exact current coach video'
);
select is(
  (select quote_text from public.resolve_member_daily_content()), 'A little progress still moves you forward.',
  'a coach quote takes precedence over the admin quote'
);
select is(
  (select affirmation_text from public.resolve_member_daily_content()), 'I can take one useful step today.',
  'a coach affirmation takes precedence over the admin fallback'
);
select is(
  (select count(*)::int from public.daily_content_items), 0,
  'a member cannot directly read staff content rows'
);
select lives_ok(
  $$select public.set_member_daily_fuel_bookmark('85000000-0000-0000-0000-000000000011', true)$$,
  'a member can save the exact resolved coach video'
);
select is(
  (select count(*)::int from public.member_daily_content_video_grants where member_id = auth.uid() and video_id = '85000000-0000-0000-0000-000000000011'),
  1,
  'saving a new Daily Content video records its exact member grant'
);
select throws_ok(
  $$select public.set_member_daily_content_acknowledgment(private.current_daily_checkin_day(), '85000000-0000-0000-0000-000000000011', true)$$,
  'P0001', 'This affirmation is no longer current', 'a member cannot acknowledge a video revision as affirmation'
);
select lives_ok(
  $$select public.set_member_daily_content_acknowledgment(
    private.current_daily_checkin_day(),
    (select affirmation_revision_id from public.resolve_member_daily_content()), true
  )$$,
  'a member can acknowledge the exact current affirmation revision'
);
select is((select affirmation_acknowledged from public.resolve_member_daily_content()), true,
  'the current revision is shown acknowledged');
select throws_ok(
  $$select public.set_member_daily_content_acknowledgment(private.current_daily_checkin_day() - 1, '85000000-0000-0000-0000-000000000099', true)$$,
  'P0001', 'Daily Content day changed', 'stale member affirmation writes are rejected'
);
select throws_ok(
  $$select public.set_member_daily_content_acknowledgment(private.current_daily_checkin_day() + 1, '85000000-0000-0000-0000-000000000099', true)$$,
  'P0001', 'Daily Content day changed', 'future member affirmation writes are rejected'
);
select is(
  (select count(*)::int from public.member_daily_content_video_grants where member_id = '85000000-0000-0000-0000-000000000005'),
  0,
  'a member cannot read another member’s saved grants'
);
select throws_ok(
  $$insert into public.member_daily_content_video_grants (member_id, day, video_id) values (auth.uid(), private.current_daily_checkin_day(), '85000000-0000-0000-0000-000000000012')$$,
  '42501', null, 'members cannot directly create Daily Content grants'
);
reset role;

-- A profile-less authenticated JWT must not gain staff RPC access through NULL role comparisons.
set local role authenticated;
set local request.jwt.claims = '{"sub":"85000000-0000-0000-0000-000000000099","role":"authenticated"}';
select throws_ok(
  $$select public.reserve_daily_content_video_delete('85000000-0000-0000-0000-000000000017')$$,
  '42501', 'Staff access required', 'a caller without a profile cannot reserve a video for deletion'
);
select throws_ok(
  $$select * from public.save_daily_content_item(null, 'quote', 'No profile', null, 'Text', null, null)$$,
  '42501', 'Staff access required', 'a caller without a profile cannot create Daily Content'
);
select throws_ok(
  $$select public.archive_daily_content_item((select id from public.daily_content_items where title = 'Coach quote'))$$,
  '42501', 'Staff access required', 'a caller without a profile cannot archive Daily Content'
);
select throws_ok(
  $$select public.publish_daily_content_slot(
    (select id from public.daily_content_items where title = 'Coach quote'),
    (select id from public.daily_content_revisions where title_snapshot = 'Coach quote'),
    private.current_daily_checkin_day()
  )$$,
  '42501', 'Staff access required', 'a caller without a profile cannot publish Daily Content'
);
select throws_ok(
  $$select public.cancel_daily_content_slot((select id from public.daily_content_slots where content_kind = 'quote' and coach_id = '85000000-0000-0000-0000-000000000002'))$$,
  '42501', 'Staff access required', 'a caller without a profile cannot cancel Daily Content'
);
select throws_ok(
  $$select public.set_member_daily_fuel_bookmark('85000000-0000-0000-0000-000000000017', true)$$,
  '42501', 'Member access required', 'a caller without a profile cannot create a member bookmark'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"85000000-0000-0000-0000-000000000005","role":"authenticated"}';
select is((select video_source from public.resolve_member_daily_content()), 'admin',
  'a member without a linked coach receives the admin fallback');
select is((select video_id::text from public.resolve_member_daily_content()), '85000000-0000-0000-0000-000000000013',
  'the admin fallback signs only its admin-owned video');
select is((select quote_text from public.resolve_member_daily_content()), 'Keep showing up.',
  'the admin quote appears when there is no selected coach slot');
select lives_ok(
  $$select public.set_member_daily_fuel_bookmark('85000000-0000-0000-0000-000000000013', true)$$,
  'a member can save the exact global fallback video'
);
select throws_ok(
  $$select public.set_member_daily_fuel_bookmark('85000000-0000-0000-0000-000000000012', true)$$,
  '42501', 'Only today’s featured video can be saved', 'a member cannot save another coach’s video'
);
select is(
  (select count(*)::int from public.member_daily_content_video_grants where member_id = auth.uid() and video_id = '85000000-0000-0000-0000-000000000013'),
  1,
  'the global fallback save grants only that member and video'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"85000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.daily_content_items), 0,
  'another coach cannot read coach A’s items');
select throws_ok(
  $$select * from public.save_daily_content_item('85000000-0000-0000-0000-000000000002', 'quote', 'Hijack', null, 'No', null, null)$$,
  '42501', 'Daily Content item was not found', 'another coach cannot revise an item they do not own'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"85000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$select * from public.save_daily_content_item(null, 'video', 'Coach private reuse', '85000000-0000-0000-0000-000000000011', null, null, null)$$,
  '42501', 'Daily Content can use only your own video', 'admin cannot republish a coach private video globally'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"85000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok(
  $$select public.assign_member_daily_fuel_video('85000000-0000-0000-0000-000000000004', '85000000-0000-0000-0000-000000000011', private.current_daily_checkin_day())$$,
  'legacy explicit assignment can be set for a linked member'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"85000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select video_source from public.resolve_member_daily_content()), 'legacy',
  'legacy explicit member assignment overrides a coach Daily Content video');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"85000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$select public.reserve_daily_content_video_delete('85000000-0000-0000-0000-000000000011')$$,
  '23503', 'Video is used by Daily Content or is still saved by a member',
  'a referenced Daily Content video cannot be deleted from the provider'
);
select throws_ok(
  $$delete from public.videos where id = '85000000-0000-0000-0000-000000000011'$$,
  '23503', 'Video is used by Daily Content or is still saved by a member',
  'the database blocks direct deletion of a referenced video'
);
reset role;

-- A new affirmation revision must not inherit acknowledgment from the prior revision.
set local role authenticated;
set local request.jwt.claims = '{"sub":"85000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok(
  $$select * from public.save_daily_content_item(
    (select id from public.daily_content_items where owner_id = auth.uid() and title = 'Coach affirmation'),
    'affirmation', 'Coach affirmation updated', null, null, null, 'I can choose a new step today.'
  )$$,
  'editing affirmation content creates a new immutable revision'
);
select lives_ok(
  $$select public.publish_daily_content_slot(
    (select id from public.daily_content_items where owner_id = auth.uid() and title = 'Coach affirmation updated'),
    (select id from public.daily_content_revisions where title_snapshot = 'Coach affirmation updated'),
    private.current_daily_checkin_day()
  )$$,
  'the coach can publish the new affirmation revision'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"85000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select affirmation_acknowledged from public.resolve_member_daily_content()), false,
  'the new affirmation revision starts unacknowledged');
select is(
  (select count(*)::int from public.member_daily_content_acknowledgments where member_id = auth.uid()),
  1,
  'acknowledgment history retains the prior revision'
);
select lives_ok(
  $$select public.set_member_daily_fuel_bookmark('85000000-0000-0000-0000-000000000011', false)$$,
  'a member can remove a saved Daily Content grant'
);
select is(
  (select count(*)::int from public.member_daily_content_video_grants where member_id = auth.uid() and video_id = '85000000-0000-0000-0000-000000000011'),
  0,
  'removing the bookmark revokes its exact content grant'
);
reset role;

-- Deletion reservations make provider deletion retryable and prevent a new publication racing it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"85000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok(
  $$select public.reserve_daily_content_video_delete('85000000-0000-0000-0000-000000000015')$$,
  'an unused video can be reserved for safe provider deletion'
);
select throws_ok(
  $$update public.videos set daily_content_deletion_pending = false where id = '85000000-0000-0000-0000-000000000015'$$,
  '42501', null, 'a member of staff cannot clear the deletion reservation directly'
);
select throws_ok(
  $$select * from public.save_daily_content_item(null, 'video', 'Racing save', '85000000-0000-0000-0000-000000000015', null, null, null)$$,
  '55000', 'This video is being deleted and cannot be published',
  'new Daily Content cannot reference a video while deletion is pending'
);
select throws_ok(
  $$select public.assign_member_daily_fuel_video('85000000-0000-0000-0000-000000000004', '85000000-0000-0000-0000-000000000015', private.current_daily_checkin_day())$$,
  '55000', 'This video is being deleted and cannot be assigned',
  'a current assignment cannot race a reserved provider deletion'
);
select lives_ok(
  $$delete from public.videos where id = '85000000-0000-0000-0000-000000000015'$$,
  'the authenticated owner can delete only after reserving and clearing references'
);
select lives_ok(
  $$select public.assign_member_daily_fuel_video(
    '85000000-0000-0000-0000-000000000004',
    '85000000-0000-0000-0000-000000000017',
    private.current_daily_checkin_day()
  )$$,
  'an owner can explicitly assign a current ready video to a linked member'
);
select throws_ok(
  $$select public.reserve_daily_content_video_delete('85000000-0000-0000-0000-000000000017')$$,
  '23503', 'Video is assigned in Daily Fuel',
  'the deletion reservation blocks a video still assigned for today'
);
select throws_ok(
  $$delete from public.videos where id = '85000000-0000-0000-0000-000000000017'$$,
  '23503', 'Video is assigned in Daily Fuel',
  'the direct-delete trigger also blocks a current Daily Fuel assignment'
);
reset role;

-- Video privacy deletion tombstones archived revisions without blocking owner-account cleanup.
insert into public.videos (id, coach_id, cloudflare_uid, title, status, visibility)
values ('85000000-0000-0000-0000-000000000016', '85000000-0000-0000-0000-000000000002', 'daily-tombstone', 'Tombstone test video', 'ready', 'private');
set local role authenticated;
set local request.jwt.claims = '{"sub":"85000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$update public.videos set daily_content_deletion_pending = true where id = '85000000-0000-0000-0000-000000000016'$$,
  '42501', null, 'the authenticated owner cannot create a deletion reservation directly'
);
select lives_ok(
  $$select * from public.save_daily_content_item(null, 'video', 'Tombstone history', '85000000-0000-0000-0000-000000000016', null, null, null)$$,
  'the owner can create video history before privacy deletion'
);
select lives_ok(
  $$select public.publish_daily_content_slot(
    (select id from public.daily_content_items where owner_id = auth.uid() and title = 'Tombstone history'),
    (select id from public.daily_content_revisions where title_snapshot = 'Tombstone history'),
    private.current_daily_checkin_day()
  )$$,
  'the owner can publish the tombstone fixture before archiving it'
);
select lives_ok(
  $$select public.cancel_daily_content_slot((select id from public.daily_content_slots where item_id = (select id from public.daily_content_items where title = 'Tombstone history')))$$,
  'the owner can cancel its publication before deleting the video'
);
select lives_ok(
  $$select public.archive_daily_content_item((select id from public.daily_content_items where title = 'Tombstone history'))$$,
  'the owner can archive its content item before deleting the video'
);
select throws_ok(
  $$update public.videos set daily_content_deletion_pending = true where id = '85000000-0000-0000-0000-000000000016'$$,
  '42501', null, 'authenticated owners cannot create a deletion reservation by direct update'
);
select lives_ok(
  $$select public.reserve_daily_content_video_delete('85000000-0000-0000-0000-000000000016')$$,
  'an archived video with no active grants can be reserved for privacy deletion'
);
select lives_ok(
  $$delete from public.videos where id = '85000000-0000-0000-0000-000000000016'$$,
  'privacy deletion can remove the provider video while retaining archived history'
);
select is(
  (select video_id from public.daily_content_revisions where title_snapshot = 'Tombstone history'),
  null::uuid,
  'video deletion leaves a null video tombstone in the immutable revision'
);
select is(
  (select count(*)::int from public.daily_content_items where title = 'Tombstone history' and status = 'archived'),
  1,
  'video deletion retains the archived content record'
);
reset role;

-- Removing an author profile cascades its owned items/revisions/slots rather than blocking account deletion.
set local role authenticated;
set local request.jwt.claims = '{"sub":"85000000-0000-0000-0000-000000000003","role":"authenticated"}';
select lives_ok(
  $$select * from public.save_daily_content_item(null, 'quote', 'Account removal content', null, 'Temporary author text.', null, null)$$,
  'the second coach can create owned content before account deletion'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"85000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok(
  $$select public.assign_member_daily_fuel_video('85000000-0000-0000-0000-000000000004', '85000000-0000-0000-0000-000000000011', private.current_daily_checkin_day())$$,
  'the coach can assign its published clip before account cleanup'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"85000000-0000-0000-0000-000000000004","role":"authenticated"}';
select lives_ok(
  $$select public.set_member_daily_fuel_bookmark('85000000-0000-0000-0000-000000000011', true)$$,
  'the member can save the published clip before coach account cleanup'
);
reset role;

-- The Auth Admin API's profile/video cascade may execute without a PostgREST JWT.
set local request.jwt.claims = '{}';
select throws_ok(
  $$delete from public.videos where id = '85000000-0000-0000-0000-000000000018'$$,
  '42501', 'Reserve video deletion through the Library action first',
  'a direct no-JWT video delete is denied outside an account cascade'
);
select lives_ok(
  $$delete from auth.users where id = '85000000-0000-0000-0000-000000000003'$$,
  'author account deletion is not blocked by owned Daily Content'
);
select is(
  (select count(*)::int from public.daily_content_items where owner_id = '85000000-0000-0000-0000-000000000003'),
  0,
  'account deletion removes its owned reusable content'
);
select lives_ok(
  $$delete from auth.users where id = '85000000-0000-0000-0000-000000000002'$$,
  'a no-JWT Auth cascade can remove a coach with published and member-saved content'
);
select is(
  (select count(*)::int from public.videos where id = '85000000-0000-0000-0000-000000000011'),
  0,
  'the account cascade removes the member-saved video'
);
select is(
  (select count(*)::int from public.daily_content_items where owner_id = '85000000-0000-0000-0000-000000000002'),
  0,
  'the account cascade removes active and archived coach content'
);
reset role;

select * from finish();
rollback;
