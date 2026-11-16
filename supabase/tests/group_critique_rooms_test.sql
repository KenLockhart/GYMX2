begin;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('82000000-0000-0000-0000-000000000001', 'group-coach@example.test', '{"display_name":"Coach"}'),
  ('82000000-0000-0000-0000-000000000002', 'group-rival-coach@example.test', '{"display_name":"Rival coach"}'),
  ('82000000-0000-0000-0000-000000000003', 'group-admin@example.test', '{"display_name":"Admin"}');

insert into auth.users (id, email, raw_user_meta_data)
select ('82000000-0000-0000-0000-' || lpad((100 + n)::text, 12, '0'))::uuid,
  'group-member-' || n || '@example.test', jsonb_build_object('display_name', 'Member ' || n)
from generate_series(1, 31) n;

update public.profiles set role = 'coach'
where id in ('82000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000002');
update public.profiles set role = 'admin' where id = '82000000-0000-0000-0000-000000000003';

insert into public.calendar_sessions (id, coach_id, title, starts_at, ends_at) values
  ('82000000-0000-0000-0000-000000000201', '82000000-0000-0000-0000-000000000001', 'Group cap and lifecycle', now() - interval '10 minutes', now() + interval '30 minutes'),
  ('82000000-0000-0000-0000-000000000202', '82000000-0000-0000-0000-000000000001', 'Legacy broadcast blocker', now() - interval '10 minutes', now() + interval '30 minutes'),
  ('82000000-0000-0000-0000-000000000203', '82000000-0000-0000-0000-000000000001', 'Unknown meeting create', now() - interval '10 minutes', now() + interval '30 minutes'),
  ('82000000-0000-0000-0000-000000000204', '82000000-0000-0000-0000-000000000001', 'Unknown participant create', now() - interval '10 minutes', now() + interval '30 minutes'),
  ('82000000-0000-0000-0000-000000000205', '82000000-0000-0000-0000-000000000001', 'Group readiness gate', now() - interval '10 minutes', now() + interval '30 minutes'),
  ('82000000-0000-0000-0000-000000000206', '82000000-0000-0000-0000-000000000001', 'Deleted session cleanup', now() - interval '10 minutes', now() + interval '30 minutes'),
  ('82000000-0000-0000-0000-000000000207', '82000000-0000-0000-0000-000000000001', 'Stale removed marker', now() - interval '10 minutes', now() + interval '30 minutes');
insert into public.calendar_sessions (id, coach_id, title, starts_at, ends_at, live_mode)
values ('82000000-0000-0000-0000-000000000208', '82000000-0000-0000-0000-000000000001',
  'Legacy private roster over cap', now() - interval '10 minutes', now() + interval '30 minutes', 'one_on_one');

insert into public.session_invites (session_id, member_id)
select '82000000-0000-0000-0000-000000000201',
  ('82000000-0000-0000-0000-' || lpad((100 + n)::text, 12, '0'))::uuid
from generate_series(1, 30) n;
insert into public.session_invites (session_id, member_id) values
  ('82000000-0000-0000-0000-000000000203', '82000000-0000-0000-0000-000000000131'),
  ('82000000-0000-0000-0000-000000000204', '82000000-0000-0000-0000-000000000131'),
  ('82000000-0000-0000-0000-000000000206', '82000000-0000-0000-0000-000000000131'),
  ('82000000-0000-0000-0000-000000000207', '82000000-0000-0000-0000-000000000131');
insert into public.coach_members (coach_id, member_id) values
  ('82000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000129'),
  ('82000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000130'),
  ('82000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000131');
insert into public.session_live (session_id, input_uid, playback_url)
values ('82000000-0000-0000-0000-000000000202', 'old-stream-input', 'https://example.test/old-stream');

create temporary table group_critique_test_data (
  label text primary key,
  session_id uuid,
  generation bigint,
  actor_id uuid,
  room_state text,
  join_expires_at timestamptz,
  lease_token uuid,
  old_lease_token uuid,
  provider_meeting_id text,
  provider_meeting_tag text,
  provider_participant_id text,
  provider_participant_tag text,
  preset text,
  can_publish_audio boolean,
  can_publish_video boolean,
  muted boolean,
  token_expires_at timestamptz,
  participant_epoch bigint,
  provision_required boolean,
  idempotency_key uuid,
  cleanup_job_id uuid,
  cleanup_action text
);
grant select, insert, update, delete on table pg_temp.group_critique_test_data to authenticated, service_role;

select ok(not public.group_critique_provider_bound(), 'group RealtimeKit starts unbound');
select ok(not public.group_critique_provider_ready(), 'group RealtimeKit is unavailable before binding and heartbeat');
select ok(not public.private_live_ready(), 'private live remains independently unavailable before its binding');

set local role service_role;
select is(public.bind_group_critique_provider('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app'), true,
  'service binds the isolated group RealtimeKit account and app');
select lives_ok($$select public.record_group_critique_cleanup_heartbeat()$$,
  'service records group cleanup heartbeat');
select is(public.group_critique_provider_ready(), true, 'group provider readiness uses its own fresh heartbeat');
select is(public.bind_private_live_account('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), true,
  'private live binds the same account independently');
select lives_ok($$select public.record_private_live_cleanup_heartbeat()$$,
  'service records the private live heartbeat independently');
select is(public.private_live_ready(), true, 'private live becomes ready with its own heartbeat');
reset role;

update public.private_live_runtime set last_cleanup_at = now() - interval '4 minutes' where id is true;
select ok(not public.private_live_ready(), 'stale private heartbeat closes private live');
select is(public.group_critique_provider_ready(), true,
  'stale private heartbeat does not affect group RealtimeKit readiness');
update public.private_live_runtime set last_cleanup_at = now() where id is true;

select is((select count(*)::integer from public.session_invites
  where session_id = '82000000-0000-0000-0000-000000000201'), 30,
  'fixture has the full 30-member invitation cap');
select lives_ok($$insert into public.session_invites (session_id, member_id)
  values ('82000000-0000-0000-0000-000000000201', '82000000-0000-0000-0000-000000000101')
  on conflict do nothing$$, 'duplicate existing invite is idempotent at capacity');
select throws_ok($$insert into public.session_invites (session_id, member_id)
  values ('82000000-0000-0000-0000-000000000201', '82000000-0000-0000-0000-000000000131')$$,
  'P0001', 'A session can have at most 30 invited members', '31st invite is rejected');
select is((select count(*)::integer from public.session_invites
  where session_id = '82000000-0000-0000-0000-000000000201'), 30,
  'rejected 31st invite leaves the roster at 30');

-- Simulate a private session created before the group cap existed, with a legacy 31-person roster.
alter table public.session_invites disable trigger session_invites_group_critique_guard;
insert into public.session_invites (session_id, member_id)
select '82000000-0000-0000-0000-000000000208',
  ('82000000-0000-0000-0000-' || lpad((100 + n)::text, 12, '0'))::uuid
from generate_series(1, 31) n;
alter table public.session_invites enable trigger session_invites_group_critique_guard;
select is((select count(*)::integer from public.session_invites
  where session_id = '82000000-0000-0000-0000-000000000208'), 31,
  'fixture represents a grandfathered private roster above the new cap');
set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.set_session_live_mode(
  '82000000-0000-0000-0000-000000000208', 'broadcast', null)$$,
  'P0001', 'A session can have at most 30 invited members',
  'private session with a legacy 31-member roster cannot switch to broadcast');
select is((select live_mode from public.calendar_sessions
  where id = '82000000-0000-0000-0000-000000000208'), 'one_on_one',
  'failed mode switch preserves the private session mode');
reset role;
delete from public.session_invites
where session_id = '82000000-0000-0000-0000-000000000208'
  and member_id = '82000000-0000-0000-0000-000000000131';
set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.set_session_live_mode(
  '82000000-0000-0000-0000-000000000208', 'broadcast', null)$$,
  'private session switches to broadcast after trimming its roster to 30');
select is((select live_mode from public.calendar_sessions
  where id = '82000000-0000-0000-0000-000000000208'), 'broadcast',
  'session mode changes only after the invite cap is satisfied');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select * from public.open_group_critique_room('82000000-0000-0000-0000-000000000202')$$,
  'P0001', 'Remove the existing broadcast input before opening group critique',
  'legacy Stream broadcast blocks new group room without changing Stream data');
insert into pg_temp.group_critique_test_data (label, session_id, generation, room_state, join_expires_at)
select 'main_room', '82000000-0000-0000-0000-000000000201', generation, state, join_expires_at
from public.open_group_critique_room('82000000-0000-0000-0000-000000000201');
select is((select room_state from pg_temp.group_critique_test_data where label = 'main_room'), 'provisioning',
  'coach opens a group room for 30 invitees plus the coach');
select is((select join_expires_at from pg_temp.group_critique_test_data where label = 'main_room'),
  (select ends_at + interval '60 minutes' from public.calendar_sessions where id = '82000000-0000-0000-0000-000000000201'),
  'room token expiry is bounded by the session end plus 60 minutes');
select is((select count(*)::integer from public.read_group_critique_room('82000000-0000-0000-0000-000000000201', null)),
  30, 'coach reads exactly the 30 current invited member rows');
select is((select count(*)::integer from public.group_critique_members
  where session_id = '82000000-0000-0000-0000-000000000201'), 30,
  'room snapshots only current invited members');
select is(public.offer_group_critique_cameras('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000101'), 1, 'coach can offer cameras to one invitee');
set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000102","role":"authenticated"}';
select throws_ok($$select * from public.accept_group_critique_offer(
  '82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'), true, true)$$,
  'P0001', 'The coach has not offered camera access', 'member cannot accept before receiving an offer');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.offer_group_critique_cameras('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000131')$$,
  'P0001', 'Choose a current invited member', 'coach cannot offer camera access to a non-invitee');
select throws_ok($$select * from public.open_group_critique_room('82000000-0000-0000-0000-000000000201')$$,
  'P0001', null, 'coach cannot create a second active room for the same session');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000102","role":"authenticated"}';
select is((select count(*)::integer from public.read_group_critique_room('82000000-0000-0000-0000-000000000201', null)),
  1, 'invited member reads only their own group room row');
select is((select member_id from public.read_group_critique_room('82000000-0000-0000-0000-000000000201', null)),
  '82000000-0000-0000-0000-000000000102'::uuid, 'member snapshot identifies only the caller');
select is((select count(*)::integer from public.group_critique_members), 1,
  'member RLS hides other members consent rows');
select throws_ok($$select * from public.accept_group_critique_offer(
  '82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'), true, true)$$,
  'P0001', 'The coach has not offered camera access', 'member cannot accept before a coach offer');
select throws_ok($$select provider_meeting_id from public.group_critique_provider_rooms$$,
  '42501', null, 'member cannot read provider meeting IDs directly');
select throws_ok($$select * from public.group_critique_cleanup_jobs$$,
  '42501', null, 'member cannot read cleanup jobs directly');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000131","role":"authenticated"}';
select is((select count(*)::integer from public.read_group_critique_room('82000000-0000-0000-0000-000000000201', null)),
  0, 'non-invited member cannot read the group room or roster');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::integer from public.read_group_critique_room('82000000-0000-0000-0000-000000000201', null)),
  0, 'another coach cannot read a rival coach room');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$select * from public.read_group_critique_room('82000000-0000-0000-0000-000000000201', null)$$,
  '42501', 'Session participant access required', 'admin role does not bypass member privacy');
reset role;
set local role anon;
select throws_ok($$select * from public.read_group_critique_room('82000000-0000-0000-0000-000000000201', null)$$,
  '42501', null, 'anonymous users cannot read group room metadata');
reset role;

set local role service_role;
insert into pg_temp.group_critique_test_data (
  label, session_id, generation, lease_token, provider_meeting_id, provider_meeting_tag, idempotency_key
)
select 'main_meeting_claim', '82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  lease_token, provider_meeting_id, provider_meeting_tag, idempotency_key
from public.claim_group_critique_meeting('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'));
select is((select provider_meeting_id from pg_temp.group_critique_test_data where label = 'main_meeting_claim'),
  null::text, 'new meeting claim starts without a provider ID');
select is((select provider_meeting_tag from pg_temp.group_critique_test_data where label = 'main_meeting_claim'),
  'gymx2-group:' || (select idempotency_key::text from pg_temp.group_critique_test_data where label = 'main_meeting_claim'),
  'meeting claim returns a stable reconciliation tag');
select is(public.complete_group_critique_meeting('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  (select lease_token from pg_temp.group_critique_test_data where label = 'main_meeting_claim'),
  'meeting-main-test'), true, 'service completes the meeting create lease');
reset role;
select is((select state from public.group_critique_rooms where session_id = '82000000-0000-0000-0000-000000000201'),
  'open', 'room opens only after confirmed meeting creation');

set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.set_group_critique_mute('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'), null, true),
  true, 'coach can set the room default to all muted');
select is(public.set_group_critique_mute('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000101', false), true,
  'coach can unmute one member after muting everyone');
select is((select all_members_muted from public.group_critique_rooms where session_id = '82000000-0000-0000-0000-000000000201'),
  true, 'selected unmute leaves the room default muted for later joins');
select is((select coach_muted from public.group_critique_members
  where session_id = '82000000-0000-0000-0000-000000000201' and member_id = '82000000-0000-0000-0000-000000000101'),
  false, 'selected member has independent unmuted state');
select is((select coach_muted from public.group_critique_members
  where session_id = '82000000-0000-0000-0000-000000000201' and member_id = '82000000-0000-0000-0000-000000000102'),
  true, 'other members remain muted after a selected unmute');
reset role;

delete from public.group_critique_members
where session_id = '82000000-0000-0000-0000-000000000201'
  and generation = (select generation from pg_temp.group_critique_test_data where label = 'main_room')
  and member_id = '82000000-0000-0000-0000-000000000130';
set local role service_role;
insert into pg_temp.group_critique_test_data (
  label, session_id, generation, actor_id, lease_token, provider_meeting_id,
  provider_participant_id, preset, can_publish_audio, can_publish_video, muted,
  token_expires_at, participant_epoch, provision_required, idempotency_key, provider_participant_tag
)
select 'late_muted_observer', '82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000130', lease_token, provider_meeting_id,
  provider_participant_id, preset, can_publish_audio, can_publish_video, muted,
  token_expires_at, participant_epoch, provision_required, idempotency_key, provider_participant_tag
from public.claim_group_critique_participant('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000130');
select is((select preset from pg_temp.group_critique_test_data where label = 'late_muted_observer'),
  'not_allowed', 'new invitee starts with an observer preset before consent');
select is((select muted from pg_temp.group_critique_test_data where label = 'late_muted_observer'),
  true, 'late materialized participant inherits the all-muted room default');
select is(public.complete_group_critique_participant('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000130',
  (select lease_token from pg_temp.group_critique_test_data where label = 'late_muted_observer'),
  'participant-late-observer',
  (select provider_participant_tag from pg_temp.group_critique_test_data where label = 'late_muted_observer')),
  true, 'service completes late observer provisioning');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.offer_group_critique_cameras('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'), null),
  30, 'coach can offer camera access to all 30 current invitees');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000102","role":"authenticated"}';
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000101","role":"authenticated"}';
select throws_ok($$select * from public.accept_group_critique_offer(
  '82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'), true, false)$$,
  '22023', 'Accept camera and microphone together, or decline the offer',
  'camera and microphone consent is atomic');
reset role;

set local role service_role;
insert into pg_temp.group_critique_test_data (
  label, session_id, generation, actor_id, lease_token, provider_meeting_id, provider_participant_id,
  preset, can_publish_audio, can_publish_video, muted, token_expires_at, participant_epoch,
  provision_required, idempotency_key, provider_participant_tag
)
select 'm1_observer_claim', '82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000101', lease_token, provider_meeting_id, provider_participant_id,
  preset, can_publish_audio, can_publish_video, muted, token_expires_at, participant_epoch,
  provision_required, idempotency_key, provider_participant_tag
from public.claim_group_critique_participant('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000101');
select is((select preset from pg_temp.group_critique_test_data where label = 'm1_observer_claim'),
  'not_allowed', 'pre-consent participant receives observer preset');
select is((select can_publish_audio or can_publish_video from pg_temp.group_critique_test_data where label = 'm1_observer_claim'),
  false, 'pre-consent participant cannot publish either media track');
select is((select muted from pg_temp.group_critique_test_data where label = 'm1_observer_claim'),
  false, 'selected member mute state is independent of room default');
select is(public.complete_group_critique_participant('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000101',
  (select lease_token from pg_temp.group_critique_test_data where label = 'm1_observer_claim'),
  'participant-m1-observer',
  (select provider_participant_tag from pg_temp.group_critique_test_data where label = 'm1_observer_claim')),
  true, 'service records pre-consent observer identity');
insert into pg_temp.group_critique_test_data (
  label, session_id, generation, actor_id, provider_meeting_id, provider_participant_id,
  preset, can_publish_audio, can_publish_video, muted, token_expires_at, participant_epoch,
  provision_required, idempotency_key, provider_participant_tag
)
select 'm1_observer_reuse', '82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000101', provider_meeting_id, provider_participant_id,
  preset, can_publish_audio, can_publish_video, muted, token_expires_at, participant_epoch,
  provision_required, idempotency_key, provider_participant_tag
from public.claim_group_critique_participant('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000101');
select is((select provision_required from pg_temp.group_critique_test_data where label = 'm1_observer_reuse'),
  false, 'ready participant identity is reused only for the matching observer epoch');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000101","role":"authenticated"}';
insert into pg_temp.group_critique_test_data (label, session_id, generation, participant_epoch)
select 'm1_acceptance', '82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'), participant_epoch
from public.accept_group_critique_offer('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'), true, true);
select is((select participant_epoch from pg_temp.group_critique_test_data where label = 'm1_acceptance'),
  1::bigint, 'explicit media consent increments the participant epoch');
select is((select camera_allowed and microphone_allowed from public.group_critique_members
  where session_id = '82000000-0000-0000-0000-000000000201' and member_id = '82000000-0000-0000-0000-000000000101'),
  true, 'acceptance enables both consent flags together');
reset role;

set local role service_role;
select is((select count(*)::integer from public.claim_group_critique_participant(
  '82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000101')), 0,
  'join remains blocked while the old observer identity is being revoked');
select throws_ok($$select * from public.claim_group_critique_cleanup(
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'group-critique-test-app', 20,
  '82000000-0000-0000-0000-000000000201', '82000000-0000-0000-0000-000000000101')$$,
  '42501', 'Cleanup account or app does not match the bound provider', 'cleanup rejects a different Cloudflare account');
select throws_ok($$select * from public.claim_group_critique_cleanup(
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'wrong-group-app', 20,
  '82000000-0000-0000-0000-000000000201', '82000000-0000-0000-0000-000000000101')$$,
  '42501', 'Cleanup account or app does not match the bound provider', 'cleanup rejects a different RealtimeKit app');
insert into pg_temp.group_critique_test_data (
  label, session_id, generation, actor_id, cleanup_job_id, cleanup_action, lease_token, provider_meeting_id,
  provider_participant_id, provider_participant_tag
)
select 'm1_observer_cleanup_old', session_id, generation, '82000000-0000-0000-0000-000000000101',
  job_id, action, lease_token, provider_meeting_id, provider_participant_id, provider_participant_tag
from public.claim_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app', 20,
  '82000000-0000-0000-0000-000000000201', '82000000-0000-0000-0000-000000000101');
select is((select cleanup_action from pg_temp.group_critique_test_data where label = 'm1_observer_cleanup_old'),
  'delete_participant', 'consent transition queues exact old participant deletion');
select is((select provider_participant_id from pg_temp.group_critique_test_data where label = 'm1_observer_cleanup_old'),
  'participant-m1-observer', 'cleanup targets only the old observer participant ID');
reset role;
update public.group_critique_cleanup_jobs set lease_expires_at = now() - interval '1 second'
where job_id = (select cleanup_job_id from pg_temp.group_critique_test_data where label = 'm1_observer_cleanup_old');
set local role service_role;
insert into pg_temp.group_critique_test_data (label, session_id, generation, actor_id, cleanup_job_id,
  cleanup_action, old_lease_token, lease_token, provider_meeting_id, provider_participant_id, provider_participant_tag)
select 'm1_observer_cleanup_new', session_id, generation, '82000000-0000-0000-0000-000000000101',
  job_id, action, (select lease_token from pg_temp.group_critique_test_data where label = 'm1_observer_cleanup_old'),
  lease_token, provider_meeting_id, provider_participant_id, provider_participant_tag
from public.claim_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app', 20,
  '82000000-0000-0000-0000-000000000201', '82000000-0000-0000-0000-000000000101');
select is((select cleanup_job_id from pg_temp.group_critique_test_data where label = 'm1_observer_cleanup_new'),
  (select cleanup_job_id from pg_temp.group_critique_test_data where label = 'm1_observer_cleanup_old'),
  'expired cleanup lease is reclaimed for the same exact job');
select is(public.complete_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app',
  (select cleanup_job_id from pg_temp.group_critique_test_data where label = 'm1_observer_cleanup_old'),
  (select lease_token from pg_temp.group_critique_test_data where label = 'm1_observer_cleanup_old'), true),
  false, 'stale cleanup lease cannot complete a reclaimed job');
select is(public.complete_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app',
  (select cleanup_job_id from pg_temp.group_critique_test_data where label = 'm1_observer_cleanup_new'),
  (select lease_token from pg_temp.group_critique_test_data where label = 'm1_observer_cleanup_new'), true),
  true, 'current cleanup lease confirms old observer removal');
reset role;

set local role service_role;
insert into pg_temp.group_critique_test_data (
  label, session_id, generation, actor_id, lease_token, provider_meeting_id, provider_participant_id,
  preset, can_publish_audio, can_publish_video, muted, token_expires_at, participant_epoch,
  provision_required, idempotency_key, provider_participant_tag
)
select 'm1_publisher_claim', '82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000101', lease_token, provider_meeting_id, provider_participant_id,
  preset, can_publish_audio, can_publish_video, muted, token_expires_at, participant_epoch,
  provision_required, idempotency_key, provider_participant_tag
from public.claim_group_critique_participant('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000101');
select is((select preset from pg_temp.group_critique_test_data where label = 'm1_publisher_claim'),
  'can_request', 'accepted member receives stage-request preset after old identity deletion');
select is((select can_publish_audio and can_publish_video from pg_temp.group_critique_test_data where label = 'm1_publisher_claim'),
  true, 'publisher capability is enabled only after explicit consent');
select is((select participant_epoch from pg_temp.group_critique_test_data where label = 'm1_publisher_claim'),
  1::bigint, 'publisher claim uses the current accepted epoch');
select is((select muted from pg_temp.group_critique_test_data where label = 'm1_publisher_claim'),
  false, 'selected unmute survives publisher provisioning');
select is((select token_expires_at from pg_temp.group_critique_test_data where label = 'm1_publisher_claim'),
  (select join_expires_at from pg_temp.group_critique_test_data where label = 'main_room'),
  'provider credentials expire no later than the room join deadline');
select is(public.complete_group_critique_participant('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000101',
  (select lease_token from pg_temp.group_critique_test_data where label = 'm1_publisher_claim'),
  'participant-m1-publisher',
  (select provider_participant_tag from pg_temp.group_critique_test_data where label = 'm1_publisher_claim')),
  true, 'service completes consented publisher provisioning');
insert into pg_temp.group_critique_test_data (label, session_id, generation, actor_id, provider_meeting_id,
  provider_participant_id, preset, can_publish_audio, can_publish_video, muted, token_expires_at, participant_epoch)
select 'm1_authorized', '82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000101', provider_meeting_id, provider_participant_id,
  preset, can_publish_audio, can_publish_video, muted, token_expires_at, participant_epoch
from public.authorize_group_critique_join('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000101', 1);
select is((select provider_participant_id from pg_temp.group_critique_test_data where label = 'm1_authorized'),
  'participant-m1-publisher', 'final join authorization returns only the current publisher identity');
select is((select preset from public.claim_group_critique_participant('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000001')), 'host', 'coach receives host moderation preset');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000102","role":"authenticated"}';
insert into pg_temp.group_critique_test_data (label, session_id, generation, participant_epoch)
select 'm2_acceptance', '82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'), participant_epoch
from public.accept_group_critique_offer('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'), true, true);
select is((select camera_allowed and microphone_allowed from public.group_critique_members
  where session_id = '82000000-0000-0000-0000-000000000201' and member_id = '82000000-0000-0000-0000-000000000102'),
  true, 'member can accept the all-member camera offer');
select is((select coach_muted from public.group_critique_members
  where session_id = '82000000-0000-0000-0000-000000000201' and member_id = '82000000-0000-0000-0000-000000000102'),
  true, 'mute state does not erase member media consent');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.set_group_critique_mute('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'), null, false),
  true, 'coach can clear the bulk mute default');
select is((select all_members_muted from public.group_critique_rooms where session_id = '82000000-0000-0000-0000-000000000201'),
  false, 'bulk unmute changes the room default');
select is((select bool_and(not coach_muted) from public.group_critique_members
  where session_id = '82000000-0000-0000-0000-000000000201'), true,
  'bulk unmute clears all current member mute states');
select is(public.set_group_critique_mute('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000102', true), true, 'coach can mute one member after bulk unmute');
select is((select coach_muted from public.group_critique_members
  where session_id = '82000000-0000-0000-0000-000000000201' and member_id = '82000000-0000-0000-0000-000000000102'),
  true, 'selected mute applies only to that member');
select is((select coach_muted from public.group_critique_members
  where session_id = '82000000-0000-0000-0000-000000000201' and member_id = '82000000-0000-0000-0000-000000000101'),
  false, 'another accepted member stays unmuted');
reset role;

set local role service_role;
insert into pg_temp.group_critique_test_data (
  label, session_id, generation, actor_id, lease_token, provider_meeting_id, provider_participant_id,
  preset, can_publish_audio, can_publish_video, muted, token_expires_at, participant_epoch,
  provision_required, idempotency_key, provider_participant_tag
)
select 'm2_publisher', '82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000102', lease_token, provider_meeting_id, provider_participant_id,
  preset, can_publish_audio, can_publish_video, muted, token_expires_at, participant_epoch,
  provision_required, idempotency_key, provider_participant_tag
from public.claim_group_critique_participant('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000102');
select is((select muted from pg_temp.group_critique_test_data where label = 'm2_publisher'),
  true, 'muted accepted member remains muted at publisher credential issuance');
select is(public.complete_group_critique_participant('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000102',
  (select lease_token from pg_temp.group_critique_test_data where label = 'm2_publisher'),
  'participant-m2-publisher',
  (select provider_participant_tag from pg_temp.group_critique_test_data where label = 'm2_publisher')),
  true, 'service completes the second publisher identity');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000101","role":"authenticated"}';
select is(public.decline_group_critique_offer('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room')),
  true, 'member can withdraw media consent');
select is((select camera_allowed or microphone_allowed from public.group_critique_members
  where session_id = '82000000-0000-0000-0000-000000000201' and member_id = '82000000-0000-0000-0000-000000000101'),
  false, 'withdrawal clears both media consent flags');
select is((select offered_at from public.group_critique_members
  where session_id = '82000000-0000-0000-0000-000000000201' and member_id = '82000000-0000-0000-0000-000000000101'),
  null::timestamptz, 'withdrawal clears the old offer until the coach offers again');
select throws_ok($$select * from public.accept_group_critique_offer(
  '82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'), true, true)$$,
  'P0001', 'The coach has not offered camera access', 'withdrawn offer cannot be accepted again without a fresh coach offer');
reset role;

set local role service_role;
insert into pg_temp.group_critique_test_data (label, session_id, generation, actor_id, cleanup_job_id,
  cleanup_action, lease_token, provider_meeting_id, provider_participant_id, provider_participant_tag)
select 'm1_decline_cleanup', session_id, generation, '82000000-0000-0000-0000-000000000101',
  job_id, action, lease_token, provider_meeting_id, provider_participant_id, provider_participant_tag
from public.claim_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app', 20,
  '82000000-0000-0000-0000-000000000201', '82000000-0000-0000-0000-000000000101');
select is((select cleanup_action from pg_temp.group_critique_test_data where label = 'm1_decline_cleanup'),
  'delete_participant', 'withdrawal queues removal of the existing publisher');
select is(public.complete_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app',
  (select cleanup_job_id from pg_temp.group_critique_test_data where label = 'm1_decline_cleanup'),
  (select lease_token from pg_temp.group_critique_test_data where label = 'm1_decline_cleanup'), true),
  true, 'withdrawn publisher removal is confirmed');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.offer_group_critique_cameras('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000101'), 1, 'coach can issue a fresh offer after withdrawal cleanup');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000101","role":"authenticated"}';
insert into pg_temp.group_critique_test_data (label, session_id, generation, participant_epoch)
select 'm1_reaccepted', '82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'), participant_epoch
from public.accept_group_critique_offer('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'), true, true);
select is((select participant_epoch from pg_temp.group_critique_test_data where label = 'm1_reaccepted'),
  3::bigint, 'fresh offer permits acceptance in a new participant epoch');
reset role;

set local role service_role;
insert into pg_temp.group_critique_test_data (
  label, session_id, generation, actor_id, lease_token, provider_meeting_id, provider_participant_id,
  preset, can_publish_audio, can_publish_video, muted, token_expires_at, participant_epoch,
  provision_required, idempotency_key, provider_participant_tag
)
select 'm1_stale_publisher', '82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000101', lease_token, provider_meeting_id, provider_participant_id,
  preset, can_publish_audio, can_publish_video, muted, token_expires_at, participant_epoch,
  provision_required, idempotency_key, provider_participant_tag
from public.claim_group_critique_participant('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000101');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000101","role":"authenticated"}';
select is(public.decline_group_critique_offer('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room')),
  true, 'withdrawal can race an in-flight participant create');
reset role;
set local role service_role;
select is(public.complete_group_critique_participant('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000101',
  (select lease_token from pg_temp.group_critique_test_data where label = 'm1_stale_publisher'),
  'participant-m1-stale-publisher',
  (select provider_participant_tag from pg_temp.group_critique_test_data where label = 'm1_stale_publisher')),
  false, 'late participant callback is rejected after consent withdrawal');
reset role;
select is((select provider_participant_id from public.group_critique_cleanup_jobs
  where session_id = '82000000-0000-0000-0000-000000000201'
    and provider_participant_id = 'participant-m1-stale-publisher' and action = 'delete_participant'),
  'participant-m1-stale-publisher', 'stale callback queues exact provider participant deletion');
select is((select provider_participant_tag from public.group_critique_cleanup_jobs
  where session_id = '82000000-0000-0000-0000-000000000201'
    and provider_participant_id = 'participant-m1-stale-publisher' and action = 'delete_participant'),
  (select provider_participant_tag from pg_temp.group_critique_test_data where label = 'm1_stale_publisher'),
  'stale callback cleanup is bound to its exact opaque tag');
set local role service_role;
insert into pg_temp.group_critique_test_data (label, session_id, generation, actor_id, cleanup_job_id,
  cleanup_action, lease_token, provider_meeting_id, provider_participant_id, provider_participant_tag)
select 'm1_stale_cleanup', session_id, generation, '82000000-0000-0000-0000-000000000101',
  job_id, action, lease_token, provider_meeting_id, provider_participant_id, provider_participant_tag
from public.claim_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app', 20,
  '82000000-0000-0000-0000-000000000201', '82000000-0000-0000-0000-000000000101');
select is((select cleanup_action from pg_temp.group_critique_test_data where label = 'm1_stale_cleanup'),
  'delete_participant', 'cleanup worker claims exact stale callback deletion');
select is(public.complete_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app',
  (select cleanup_job_id from pg_temp.group_critique_test_data where label = 'm1_stale_cleanup'),
  (select lease_token from pg_temp.group_critique_test_data where label = 'm1_stale_cleanup'), true),
  true, 'exact stale callback deletion is confirmed');
reset role;

-- A coach membership unlink removes one active invitee and leaves its cleanup job durable.
delete from public.coach_members
where coach_id = '82000000-0000-0000-0000-000000000001'
  and member_id = '82000000-0000-0000-0000-000000000130';
select is((select membership_state from public.group_critique_members
  where session_id = '82000000-0000-0000-0000-000000000201'
    and member_id = '82000000-0000-0000-0000-000000000130'),
  'removed', 'coach membership unlink marks removed invitee before detaching roster');
select is((select count(*)::integer from public.group_critique_cleanup_jobs
  where session_id = '82000000-0000-0000-0000-000000000201'
    and actor_id = '82000000-0000-0000-0000-000000000130' and state <> 'complete'),
  1, 'invitee removal queues exact provider cleanup');
delete from public.session_invites
where session_id = '82000000-0000-0000-0000-000000000201'
  and member_id = '82000000-0000-0000-0000-000000000130';
select is((select count(*)::integer from public.session_invites
  where session_id = '82000000-0000-0000-0000-000000000201'
    and member_id = '82000000-0000-0000-0000-000000000130'), 0,
  'revoked invite may be removed while provider cleanup remains queued');
select is((select count(*)::integer from public.group_critique_cleanup_jobs
  where session_id = '82000000-0000-0000-0000-000000000201'
    and actor_id = '82000000-0000-0000-0000-000000000130' and state <> 'complete'),
  1, 'deleting invite does not cascade away the provider cleanup marker');
set local role service_role;
insert into pg_temp.group_critique_test_data (label, session_id, generation, actor_id, cleanup_job_id,
  cleanup_action, lease_token, provider_meeting_id, provider_participant_id, provider_participant_tag)
select 'm30_cleanup', session_id, generation, '82000000-0000-0000-0000-000000000130',
  job_id, action, lease_token, provider_meeting_id, provider_participant_id, provider_participant_tag
from public.claim_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app', 20,
  '82000000-0000-0000-0000-000000000201', '82000000-0000-0000-0000-000000000130');
select is((select cleanup_action from pg_temp.group_critique_test_data where label = 'm30_cleanup'),
  'delete_participant', 'cleanup survives invite removal and remains actor-scoped');
select is(public.complete_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app',
  (select cleanup_job_id from pg_temp.group_critique_test_data where label = 'm30_cleanup'),
  (select lease_token from pg_temp.group_critique_test_data where label = 'm30_cleanup'), true),
  true, 'removed invitee cleanup confirms after invite deletion');
reset role;

-- Profile deletion also retains the participant deletion after profile/invite cascades.
set local role service_role;
insert into pg_temp.group_critique_test_data (
  label, session_id, generation, actor_id, lease_token, provider_meeting_id, provider_participant_id,
  preset, can_publish_audio, can_publish_video, muted, token_expires_at, participant_epoch,
  provision_required, idempotency_key, provider_participant_tag
)
select 'm29_observer', '82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000129', lease_token, provider_meeting_id, provider_participant_id,
  preset, can_publish_audio, can_publish_video, muted, token_expires_at, participant_epoch,
  provision_required, idempotency_key, provider_participant_tag
from public.claim_group_critique_participant('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000129');
select is((select preset from pg_temp.group_critique_test_data where label = 'm29_observer'),
  'not_allowed', 'non-consenting account has an observer identity before account deletion');
select is(public.complete_group_critique_participant('82000000-0000-0000-0000-000000000201',
  (select generation from pg_temp.group_critique_test_data where label = 'main_room'),
  '82000000-0000-0000-0000-000000000129',
  (select lease_token from pg_temp.group_critique_test_data where label = 'm29_observer'),
  'participant-m29-observer',
  (select provider_participant_tag from pg_temp.group_critique_test_data where label = 'm29_observer')),
  true, 'service records account-deleted member observer identity');
reset role;
delete from auth.users where id = '82000000-0000-0000-0000-000000000129';
select is((select count(*)::integer from public.group_critique_cleanup_jobs
  where session_id = '82000000-0000-0000-0000-000000000201'
    and actor_id = '82000000-0000-0000-0000-000000000129' and state <> 'complete'),
  1, 'account deletion preserves its provider cleanup job without a profile FK');
set local role service_role;
insert into pg_temp.group_critique_test_data (label, session_id, generation, actor_id, cleanup_job_id,
  cleanup_action, lease_token, provider_meeting_id, provider_participant_id, provider_participant_tag)
select 'm29_cleanup', session_id, generation, '82000000-0000-0000-0000-000000000129',
  job_id, action, lease_token, provider_meeting_id, provider_participant_id, provider_participant_tag
from public.claim_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app', 20,
  '82000000-0000-0000-0000-000000000201', '82000000-0000-0000-0000-000000000129');
select is((select cleanup_action from pg_temp.group_critique_test_data where label = 'm29_cleanup'),
  'delete_participant', 'cleanup can be claimed after participant account deletion');
select is(public.complete_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app',
  (select cleanup_job_id from pg_temp.group_critique_test_data where label = 'm29_cleanup'),
  (select lease_token from pg_temp.group_critique_test_data where label = 'm29_cleanup'), true),
  true, 'account-deleted participant cleanup is confirmed');
reset role;

-- Session deletion cascades app-visible rows, but exact provider cleanup survives.
set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into pg_temp.group_critique_test_data (label, session_id, generation, room_state, join_expires_at)
select 'deleted_session_room', '82000000-0000-0000-0000-000000000206', generation, state, join_expires_at
from public.open_group_critique_room('82000000-0000-0000-0000-000000000206');
reset role;
set local role service_role;
insert into pg_temp.group_critique_test_data (label, session_id, generation, lease_token, idempotency_key, provider_meeting_tag)
select 'deleted_session_meeting_claim', '82000000-0000-0000-0000-000000000206',
  (select generation from pg_temp.group_critique_test_data where label = 'deleted_session_room'),
  lease_token, idempotency_key, provider_meeting_tag
from public.claim_group_critique_meeting('82000000-0000-0000-0000-000000000206',
  (select generation from pg_temp.group_critique_test_data where label = 'deleted_session_room'));
select is(public.complete_group_critique_meeting('82000000-0000-0000-0000-000000000206',
  (select generation from pg_temp.group_critique_test_data where label = 'deleted_session_room'),
  (select lease_token from pg_temp.group_critique_test_data where label = 'deleted_session_meeting_claim'),
  'meeting-deleted-session-test'), true, 'second room meeting is confirmed before session deletion');
insert into pg_temp.group_critique_test_data (
  label, session_id, generation, actor_id, lease_token, provider_meeting_id, provider_participant_id,
  preset, can_publish_audio, can_publish_video, muted, token_expires_at, participant_epoch,
  provision_required, idempotency_key, provider_participant_tag
)
select 'deleted_session_observer', '82000000-0000-0000-0000-000000000206',
  (select generation from pg_temp.group_critique_test_data where label = 'deleted_session_room'),
  '82000000-0000-0000-0000-000000000131', lease_token, provider_meeting_id, provider_participant_id,
  preset, can_publish_audio, can_publish_video, muted, token_expires_at, participant_epoch,
  provision_required, idempotency_key, provider_participant_tag
from public.claim_group_critique_participant('82000000-0000-0000-0000-000000000206',
  (select generation from pg_temp.group_critique_test_data where label = 'deleted_session_room'),
  '82000000-0000-0000-0000-000000000131');
select is(public.complete_group_critique_participant('82000000-0000-0000-0000-000000000206',
  (select generation from pg_temp.group_critique_test_data where label = 'deleted_session_room'),
  '82000000-0000-0000-0000-000000000131',
  (select lease_token from pg_temp.group_critique_test_data where label = 'deleted_session_observer'),
  'participant-deleted-session-test',
  (select provider_participant_tag from pg_temp.group_critique_test_data where label = 'deleted_session_observer')),
  true, 'participant identity is ready before session deletion');
reset role;
delete from public.calendar_sessions where id = '82000000-0000-0000-0000-000000000206';
select is((select count(*)::integer from public.group_critique_rooms
  where session_id = '82000000-0000-0000-0000-000000000206'), 0,
  'deleted session removes auth-visible room row');
select is((select count(*)::integer from public.group_critique_cleanup_jobs
  where session_id = '82000000-0000-0000-0000-000000000206' and state <> 'complete'), 2,
  'session deletion preserves exact participant and meeting cleanup jobs');
set local role service_role;
insert into pg_temp.group_critique_test_data (label, session_id, generation, actor_id, cleanup_job_id,
  cleanup_action, lease_token, provider_meeting_id, provider_participant_id, provider_participant_tag)
select 'deleted_session_cleanup_priority', session_id, generation, null::uuid, job_id, action, lease_token,
  provider_meeting_id, provider_participant_id, provider_participant_tag
from public.claim_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app', 1,
  '82000000-0000-0000-0000-000000000206', null);
select is((select cleanup_action from pg_temp.group_critique_test_data
  where label = 'deleted_session_cleanup_priority'), 'end_meeting',
  'single-job cleanup batch prioritizes room deactivation over participant deletes');
reset role;
select ok(exists (select 1 from public.group_critique_cleanup_jobs
  where session_id = '82000000-0000-0000-0000-000000000206'
    and action = 'delete_participant' and state = 'pending'),
  'participant deletion remains pending while end-meeting is prioritized');
set local role service_role;
select is(public.complete_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app',
  (select cleanup_job_id from pg_temp.group_critique_test_data where label = 'deleted_session_cleanup_priority'),
  (select lease_token from pg_temp.group_critique_test_data where label = 'deleted_session_cleanup_priority'), true),
  true, 'deleted-session meeting cleanup is confirmed');
reset role;
select is((select count(*)::integer from public.group_critique_cleanup_jobs
  where session_id = '82000000-0000-0000-0000-000000000206' and state <> 'complete'), 0,
  'confirmed inactive meeting retires pending participant jobs after session deletion');

-- A lost provider meeting response is reconciled by its stable meeting tag.
set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into pg_temp.group_critique_test_data (label, session_id, generation, room_state, join_expires_at)
select 'unknown_meeting_room', '82000000-0000-0000-0000-000000000203', generation, state, join_expires_at
from public.open_group_critique_room('82000000-0000-0000-0000-000000000203');
reset role;
set local role service_role;
insert into pg_temp.group_critique_test_data (label, session_id, generation, lease_token, idempotency_key, provider_meeting_tag)
select 'unknown_meeting_claim', '82000000-0000-0000-0000-000000000203',
  (select generation from pg_temp.group_critique_test_data where label = 'unknown_meeting_room'),
  lease_token, idempotency_key, provider_meeting_tag
from public.claim_group_critique_meeting('82000000-0000-0000-0000-000000000203',
  (select generation from pg_temp.group_critique_test_data where label = 'unknown_meeting_room'));
reset role;
update public.group_critique_provider_rooms set provision_lease_expires_at = now() - interval '3 minutes'
where session_id = '82000000-0000-0000-0000-000000000203';
set local role service_role;
insert into pg_temp.group_critique_test_data (label, session_id, generation, cleanup_job_id,
  cleanup_action, lease_token, provider_meeting_tag)
select 'unknown_meeting_reconcile', session_id, generation, job_id, action, lease_token, provider_meeting_tag
from public.claim_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app', 20,
  '82000000-0000-0000-0000-000000000203', null);
select is((select cleanup_action from pg_temp.group_critique_test_data where label = 'unknown_meeting_reconcile'),
  'reconcile_meeting', 'expired lost meeting response queues tag reconciliation');
select is((select provider_meeting_tag from pg_temp.group_critique_test_data where label = 'unknown_meeting_reconcile'),
  (select provider_meeting_tag from pg_temp.group_critique_test_data where label = 'unknown_meeting_claim'),
  'meeting reconciliation is scoped to the exact opaque tag');
select is(public.complete_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app',
  (select cleanup_job_id from pg_temp.group_critique_test_data where label = 'unknown_meeting_reconcile'),
  (select lease_token from pg_temp.group_critique_test_data where label = 'unknown_meeting_reconcile'), true),
  true, 'confirmed absence reconciliation retires lost meeting creation');
reset role;
select is((select state from public.group_critique_rooms where session_id = '82000000-0000-0000-0000-000000000203'),
  'ended', 'room with no reconciled provider meeting finalizes after confirmation');
reset role;

-- A room end waits for confirmed meeting inactivity when a publisher create response is lost.
set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into pg_temp.group_critique_test_data (label, session_id, generation, room_state, join_expires_at)
select 'unknown_participant_room', '82000000-0000-0000-0000-000000000204', generation, state, join_expires_at
from public.open_group_critique_room('82000000-0000-0000-0000-000000000204');
select is(public.offer_group_critique_cameras('82000000-0000-0000-0000-000000000204',
  (select generation from pg_temp.group_critique_test_data where label = 'unknown_participant_room'),
  '82000000-0000-0000-0000-000000000131'), 1, 'coach offers the invited member in the cleanup test room');
reset role;
set local role service_role;
insert into pg_temp.group_critique_test_data (label, session_id, generation, lease_token, provider_meeting_id)
select 'unknown_participant_meeting_claim', '82000000-0000-0000-0000-000000000204',
  (select generation from pg_temp.group_critique_test_data where label = 'unknown_participant_room'),
  lease_token, provider_meeting_id
from public.claim_group_critique_meeting('82000000-0000-0000-0000-000000000204',
  (select generation from pg_temp.group_critique_test_data where label = 'unknown_participant_room'));
select is(public.complete_group_critique_meeting('82000000-0000-0000-0000-000000000204',
  (select generation from pg_temp.group_critique_test_data where label = 'unknown_participant_room'),
  (select lease_token from pg_temp.group_critique_test_data where label = 'unknown_participant_meeting_claim'),
  'meeting-unknown-participant-test'), true, 'cleanup test room meeting is confirmed');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000131","role":"authenticated"}';
select lives_ok($$select public.accept_group_critique_offer('82000000-0000-0000-0000-000000000204',
  (select generation from pg_temp.group_critique_test_data where label = 'unknown_participant_room'), true, true)$$,
  'member accepts media consent before test publisher create');
reset role;
set local role service_role;
insert into pg_temp.group_critique_test_data (
  label, session_id, generation, actor_id, lease_token, provider_meeting_id, provider_participant_id,
  preset, can_publish_audio, can_publish_video, muted, participant_epoch, provision_required,
  idempotency_key, provider_participant_tag
)
select 'unknown_participant_claim', '82000000-0000-0000-0000-000000000204',
  (select generation from pg_temp.group_critique_test_data where label = 'unknown_participant_room'),
  '82000000-0000-0000-0000-000000000131', lease_token, provider_meeting_id, provider_participant_id,
  preset, can_publish_audio, can_publish_video, muted, participant_epoch, provision_required,
  idempotency_key, provider_participant_tag
from public.claim_group_critique_participant('82000000-0000-0000-0000-000000000204',
  (select generation from pg_temp.group_critique_test_data where label = 'unknown_participant_room'),
  '82000000-0000-0000-0000-000000000131');
select is((select preset from pg_temp.group_critique_test_data where label = 'unknown_participant_claim'),
  'can_request', 'accepted cleanup-test publisher receives the consented stage preset');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.end_group_critique_room('82000000-0000-0000-0000-000000000204',
  (select generation from pg_temp.group_critique_test_data where label = 'unknown_participant_room')),
  true, 'coach can end the room while participant creation is unresolved');
select is((select state from public.group_critique_rooms where session_id = '82000000-0000-0000-0000-000000000204'),
  'ending', 'room does not report ended before provider meeting is confirmed inactive');
reset role;
set local role service_role;
insert into pg_temp.group_critique_test_data (label, session_id, generation, cleanup_job_id,
  cleanup_action, lease_token, provider_meeting_id)
select 'unknown_participant_end', session_id, generation, job_id, action, lease_token, provider_meeting_id
from public.claim_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app', 20,
  '82000000-0000-0000-0000-000000000204', null);
select is((select cleanup_action from pg_temp.group_critique_test_data where label = 'unknown_participant_end'),
  'end_meeting', 'end-room cleanup uses confirmed meeting deactivation for unknown participant ID');
select is((select provider_participant_id from pg_temp.group_critique_test_data where label = 'unknown_participant_end'),
  null::text, 'unknown participant is not guessed or given a fabricated provider ID');
select is(public.complete_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app',
  (select cleanup_job_id from pg_temp.group_critique_test_data where label = 'unknown_participant_end'),
  (select lease_token from pg_temp.group_critique_test_data where label = 'unknown_participant_end'), true),
  true, 'confirmed inactive meeting removes unknown participant marker');
reset role;
select is((select state from public.group_critique_rooms where session_id = '82000000-0000-0000-0000-000000000204'),
  'ended', 'room finalizes only after confirmed meeting deactivation');
select is((select state from public.group_critique_provider_participants
  where session_id = '82000000-0000-0000-0000-000000000204'
    and actor_id = '82000000-0000-0000-0000-000000000131'), 'removed',
  'meeting deactivation retires the unknown participant incarnation');
reset role;

-- A removed marker from a prior generation must not authorize deleting an active invite.
set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into pg_temp.group_critique_test_data (label, session_id, generation, room_state, join_expires_at)
select 'stale_marker_gen1_room', '82000000-0000-0000-0000-000000000207', generation, state, join_expires_at
from public.open_group_critique_room('82000000-0000-0000-0000-000000000207');
reset role;
set local role service_role;
insert into pg_temp.group_critique_test_data (label, session_id, generation, lease_token, provider_meeting_id)
select 'stale_marker_gen1_meeting', '82000000-0000-0000-0000-000000000207',
  (select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen1_room'),
  lease_token, provider_meeting_id
from public.claim_group_critique_meeting('82000000-0000-0000-0000-000000000207',
  (select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen1_room'));
select is(public.complete_group_critique_meeting('82000000-0000-0000-0000-000000000207',
  (select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen1_room'),
  (select lease_token from pg_temp.group_critique_test_data where label = 'stale_marker_gen1_meeting'),
  'meeting-stale-marker-gen1'), true, 'first room generation is provisioned');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.offer_group_critique_cameras('82000000-0000-0000-0000-000000000207',
  (select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen1_room'),
  '82000000-0000-0000-0000-000000000131'), 1, 'first generation offers the member media access');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000131","role":"authenticated"}';
select is((select participant_epoch from public.accept_group_critique_offer(
  '82000000-0000-0000-0000-000000000207',
  (select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen1_room'), true, true)),
  1::bigint, 'member accepts the first generation offer');
reset role;
set local role service_role;
insert into pg_temp.group_critique_test_data (label, session_id, generation, actor_id, lease_token,
  provider_meeting_id, provider_participant_id, preset, participant_epoch, provider_participant_tag)
select 'stale_marker_gen1_member', '82000000-0000-0000-0000-000000000207',
  (select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen1_room'),
  '82000000-0000-0000-0000-000000000131', lease_token, provider_meeting_id, provider_participant_id,
  preset, participant_epoch, provider_participant_tag
from public.claim_group_critique_participant('82000000-0000-0000-0000-000000000207',
  (select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen1_room'),
  '82000000-0000-0000-0000-000000000131');
select is(public.complete_group_critique_participant('82000000-0000-0000-0000-000000000207',
  (select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen1_room'),
  '82000000-0000-0000-0000-000000000131',
  (select lease_token from pg_temp.group_critique_test_data where label = 'stale_marker_gen1_member'),
  'participant-stale-marker-gen1',
  (select provider_participant_tag from pg_temp.group_critique_test_data where label = 'stale_marker_gen1_member')),
  true, 'first generation publisher identity is recorded');
reset role;
delete from public.coach_members where coach_id = '82000000-0000-0000-0000-000000000001'
  and member_id = '82000000-0000-0000-0000-000000000131';
select is((select membership_state from public.group_critique_members
  where session_id = '82000000-0000-0000-0000-000000000207'
    and generation = (select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen1_room')
    and member_id = '82000000-0000-0000-0000-000000000131'), 'removed',
  'first-generation membership removal leaves a historical removed marker');
delete from public.session_invites where session_id = '82000000-0000-0000-0000-000000000207'
  and member_id = '82000000-0000-0000-0000-000000000131';
set local role service_role;
insert into pg_temp.group_critique_test_data (label, session_id, generation, cleanup_job_id,
  cleanup_action, lease_token, provider_meeting_id, provider_participant_id, provider_participant_tag)
select 'stale_marker_gen1_cleanup', session_id, generation, job_id, action, lease_token,
  provider_meeting_id, provider_participant_id, provider_participant_tag
from public.claim_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app', 20,
  '82000000-0000-0000-0000-000000000207', '82000000-0000-0000-0000-000000000131');
select is(public.complete_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app',
  (select cleanup_job_id from pg_temp.group_critique_test_data where label = 'stale_marker_gen1_cleanup'),
  (select lease_token from pg_temp.group_critique_test_data where label = 'stale_marker_gen1_cleanup'), true),
  true, 'first generation participant deletion is confirmed');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.end_group_critique_room('82000000-0000-0000-0000-000000000207',
  (select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen1_room')),
  true, 'first generation room is ended');
reset role;
set local role service_role;
insert into pg_temp.group_critique_test_data (label, session_id, generation, cleanup_job_id,
  cleanup_action, lease_token, provider_meeting_id)
select 'stale_marker_gen1_end', session_id, generation, job_id, action, lease_token, provider_meeting_id
from public.claim_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app', 20,
  '82000000-0000-0000-0000-000000000207', null);
select is(public.complete_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app',
  (select cleanup_job_id from pg_temp.group_critique_test_data where label = 'stale_marker_gen1_end'),
  (select lease_token from pg_temp.group_critique_test_data where label = 'stale_marker_gen1_end'), true),
  true, 'first generation provider meeting is confirmed inactive');
reset role;

insert into public.coach_members (coach_id, member_id)
values ('82000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000131');
insert into public.session_invites (session_id, member_id)
values ('82000000-0000-0000-0000-000000000207', '82000000-0000-0000-0000-000000000131');
set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into pg_temp.group_critique_test_data (label, session_id, generation, room_state, join_expires_at)
select 'stale_marker_gen2_room', '82000000-0000-0000-0000-000000000207', generation, state, join_expires_at
from public.open_group_critique_room('82000000-0000-0000-0000-000000000207');
select is((select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen2_room'),
  (select generation + 1 from pg_temp.group_critique_test_data where label = 'stale_marker_gen1_room'),
  'reopened session advances to a new generation');
reset role;
set local role service_role;
insert into pg_temp.group_critique_test_data (label, session_id, generation, lease_token, provider_meeting_id)
select 'stale_marker_gen2_meeting', '82000000-0000-0000-0000-000000000207',
  (select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen2_room'),
  lease_token, provider_meeting_id
from public.claim_group_critique_meeting('82000000-0000-0000-0000-000000000207',
  (select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen2_room'));
select is(public.complete_group_critique_meeting('82000000-0000-0000-0000-000000000207',
  (select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen2_room'),
  (select lease_token from pg_temp.group_critique_test_data where label = 'stale_marker_gen2_meeting'),
  'meeting-stale-marker-gen2'), true, 'second room generation is provisioned');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.offer_group_critique_cameras('82000000-0000-0000-0000-000000000207',
  (select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen2_room'),
  '82000000-0000-0000-0000-000000000131'), 1, 'second generation offers the re-invited member');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000131","role":"authenticated"}';
select is((select participant_epoch from public.accept_group_critique_offer(
  '82000000-0000-0000-0000-000000000207',
  (select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen2_room'), true, true)),
  1::bigint, 're-invited member consents in the second generation');
reset role;
set local role service_role;
insert into pg_temp.group_critique_test_data (label, session_id, generation, actor_id, lease_token,
  provider_meeting_id, provider_participant_id, preset, participant_epoch, provider_participant_tag)
select 'stale_marker_gen2_member', '82000000-0000-0000-0000-000000000207',
  (select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen2_room'),
  '82000000-0000-0000-0000-000000000131', lease_token, provider_meeting_id, provider_participant_id,
  preset, participant_epoch, provider_participant_tag
from public.claim_group_critique_participant('82000000-0000-0000-0000-000000000207',
  (select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen2_room'),
  '82000000-0000-0000-0000-000000000131');
select is(public.complete_group_critique_participant('82000000-0000-0000-0000-000000000207',
  (select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen2_room'),
  '82000000-0000-0000-0000-000000000131',
  (select lease_token from pg_temp.group_critique_test_data where label = 'stale_marker_gen2_member'),
  'participant-stale-marker-gen2',
  (select provider_participant_tag from pg_temp.group_critique_test_data where label = 'stale_marker_gen2_member')),
  true, 'second generation publisher identity is recorded');
reset role;
select throws_ok($$delete from public.session_invites
  where session_id = '82000000-0000-0000-0000-000000000207'
    and member_id = '82000000-0000-0000-0000-000000000131'$$,
  'P0001', 'Invitations cannot be removed until the group participant is revoked',
  'old removed marker cannot authorize deleting a live second-generation invite');
set local role service_role;
select is((select count(*)::integer from public.authorize_group_critique_join(
  '82000000-0000-0000-0000-000000000207',
  (select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen2_room'),
  '82000000-0000-0000-0000-000000000131',
  (select participant_epoch from pg_temp.group_critique_test_data where label = 'stale_marker_gen2_member'))),
  1, 'rejected invite deletion leaves current-generation authorization intact');
reset role;
delete from public.coach_members where coach_id = '82000000-0000-0000-0000-000000000001'
  and member_id = '82000000-0000-0000-0000-000000000131';
select is((select state from public.group_critique_provider_participants
  where session_id = '82000000-0000-0000-0000-000000000207'
    and generation = (select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen2_room')
    and actor_id = '82000000-0000-0000-0000-000000000131'), 'remove_pending',
  'current-generation membership removal marks its participant pending');
select is((select provider_participant_id from public.group_critique_cleanup_jobs
  where session_id = '82000000-0000-0000-0000-000000000207'
    and generation = (select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen2_room')
    and actor_id = '82000000-0000-0000-0000-000000000131'
    and action = 'delete_participant' and state <> 'complete'),
  'participant-stale-marker-gen2',
  'current-generation revocation queues the exact live participant ID');
set local role service_role;
select is((select count(*)::integer from public.authorize_group_critique_join(
  '82000000-0000-0000-0000-000000000207',
  (select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen2_room'),
  '82000000-0000-0000-0000-000000000131',
  (select participant_epoch from pg_temp.group_critique_test_data where label = 'stale_marker_gen2_member'))),
  0, 'current-generation revocation removes final join authorization');
reset role;
delete from public.session_invites where session_id = '82000000-0000-0000-0000-000000000207'
  and member_id = '82000000-0000-0000-0000-000000000131';

set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.end_group_critique_room('82000000-0000-0000-0000-000000000207',
  (select generation from pg_temp.group_critique_test_data where label = 'stale_marker_gen2_room')),
  true, 'second generation room is ended after member revocation');
reset role;
set local role service_role;
insert into pg_temp.group_critique_test_data (label, session_id, generation, cleanup_job_id,
  cleanup_action, lease_token, provider_meeting_id)
select 'stale_marker_gen2_end', session_id, generation, job_id, action, lease_token, provider_meeting_id
from public.claim_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app', 1,
  '82000000-0000-0000-0000-000000000207', null);
select is((select cleanup_action from pg_temp.group_critique_test_data where label = 'stale_marker_gen2_end'),
  'end_meeting', 'second-generation end cleanup prioritizes meeting revocation');
select is(public.complete_group_critique_cleanup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'group-critique-test-app',
  (select cleanup_job_id from pg_temp.group_critique_test_data where label = 'stale_marker_gen2_end'),
  (select lease_token from pg_temp.group_critique_test_data where label = 'stale_marker_gen2_end'), true),
  true, 'second generation room cleanup is confirmed');
reset role;

update public.group_critique_runtime set last_cleanup_at = now() - interval '4 minutes' where id is true;
update public.private_live_runtime set last_cleanup_at = now() where id is true;
select ok(not public.group_critique_provider_ready(), 'stale group heartbeat independently closes group readiness');
select is(public.private_live_ready(), true, 'fresh private heartbeat keeps private live ready');
set local role authenticated;
set local request.jwt.claims = '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select * from public.open_group_critique_room('82000000-0000-0000-0000-000000000205')$$,
  'P0001', 'Group critique cleanup is not ready', 'stale group heartbeat prevents a new group room');
reset role;

reset role;
select * from finish();
rollback;
