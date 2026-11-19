begin;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('e1500000-0000-0000-0000-000000000001', 'intake-coach-one@example.test', '{"display_name":"Coach One"}'),
  ('e1500000-0000-0000-0000-000000000002', 'intake-coach-two@example.test', '{"display_name":"Coach Two"}'),
  ('e1500000-0000-0000-0000-000000000003', 'intake-coach-three@example.test', '{"display_name":"Coach Three"}'),
  ('e1500000-0000-0000-0000-000000000004', 'intake-member-one@example.test', '{"display_name":"Member One"}'),
  ('e1500000-0000-0000-0000-000000000005', 'intake-member-two@example.test', '{"display_name":"Member Two"}'),
  ('e1500000-0000-0000-0000-000000000006', 'intake-admin@example.test', '{"display_name":"Admin"}'),
  ('e1500000-0000-0000-0000-000000000007', 'intake-outsider@example.test', '{"display_name":"Outsider"}');

update public.profiles set role = 'coach'
where id in (
  'e1500000-0000-0000-0000-000000000001',
  'e1500000-0000-0000-0000-000000000002',
  'e1500000-0000-0000-0000-000000000003'
);
update public.profiles set role = 'admin' where id = 'e1500000-0000-0000-0000-000000000006';

insert into public.coach_members (coach_id, member_id) values
  ('e1500000-0000-0000-0000-000000000001', 'e1500000-0000-0000-0000-000000000004'),
  ('e1500000-0000-0000-0000-000000000002', 'e1500000-0000-0000-0000-000000000004'),
  ('e1500000-0000-0000-0000-000000000003', 'e1500000-0000-0000-0000-000000000004'),
  ('e1500000-0000-0000-0000-000000000001', 'e1500000-0000-0000-0000-000000000005'),
  ('e1500000-0000-0000-0000-000000000002', 'e1500000-0000-0000-0000-000000000005');

insert into public.calendar_sessions (id, coach_id, title, starts_at, ends_at, created_at) values
  ('e1500000-0000-0000-0001-000000000000', 'e1500000-0000-0000-0000-000000000001', 'Pending first', now() + interval '23 hours', now() + interval '24 hours', now() - interval '10 minutes'),
  ('e1500000-0000-0000-0001-000000000001', 'e1500000-0000-0000-0000-000000000001', 'First confirmed', now() + interval '24 hours', now() + interval '25 hours', now() - interval '9 minutes'),
  ('e1500000-0000-0000-0001-000000000002', 'e1500000-0000-0000-0000-000000000001', 'Second same coach', now() + interval '48 hours', now() + interval '49 hours', now() - interval '8 minutes'),
  ('e1500000-0000-0000-0001-000000000003', 'e1500000-0000-0000-0000-000000000002', 'New coach booking', now() + interval '36 hours', now() + interval '37 hours', now() - interval '7 minutes'),
  ('e1500000-0000-0000-0001-000000000004', 'e1500000-0000-0000-0000-000000000003', 'Declined booking', now() + interval '24 hours', now() + interval '25 hours', now() - interval '6 minutes'),
  ('e1500000-0000-0000-0001-000000000005', 'e1500000-0000-0000-0000-000000000002', 'Member two due', now() + interval '24 hours', now() + interval '25 hours', now() - interval '5 minutes'),
  ('e1500000-0000-0000-0001-000000000006', 'e1500000-0000-0000-0000-000000000001', 'Intro calendar row', now() + interval '72 hours', now() + interval '73 hours', now() - interval '4 minutes');

insert into public.session_invites (session_id, member_id) values
  ('e1500000-0000-0000-0001-000000000000', 'e1500000-0000-0000-0000-000000000004'),
  ('e1500000-0000-0000-0001-000000000001', 'e1500000-0000-0000-0000-000000000004'),
  ('e1500000-0000-0000-0001-000000000002', 'e1500000-0000-0000-0000-000000000004'),
  ('e1500000-0000-0000-0001-000000000003', 'e1500000-0000-0000-0000-000000000004'),
  ('e1500000-0000-0000-0001-000000000004', 'e1500000-0000-0000-0000-000000000004'),
  ('e1500000-0000-0000-0001-000000000005', 'e1500000-0000-0000-0000-000000000005'),
  ('e1500000-0000-0000-0001-000000000006', 'e1500000-0000-0000-0000-000000000004');

insert into public.session_live (session_id, input_uid, playback_url, live_started_at)
select id, 'intake-test-' || right(id::text, 12), 'https://playback.example/' || right(id::text, 12), now()
from public.calendar_sessions
where id between 'e1500000-0000-0000-0001-000000000000'::uuid
  and 'e1500000-0000-0000-0001-000000000006'::uuid;

insert into public.coach_intro_slots (id, coach_id, starts_at, minutes, format) values
  ('e1500000-0000-0000-0002-000000000001', 'e1500000-0000-0000-0000-000000000001', now() + interval '72 hours', 30, 'online');
insert into public.coach_intro_bookings (id, slot_id, coach_id, member_id, session_id)
values (
  'e1500000-0000-0000-0003-000000000001',
  'e1500000-0000-0000-0002-000000000001',
  'e1500000-0000-0000-0000-000000000001',
  'e1500000-0000-0000-0000-000000000004',
  'e1500000-0000-0000-0001-000000000006'
);

select is(
  (select count(*)::int from private.member_confirmed_intake_bookings('e1500000-0000-0000-0000-000000000004') where session_id = 'e1500000-0000-0000-0001-000000000006'),
  1,
  'intro booking and its calendar row are deduplicated'
);
select is(
  (select booking_source from private.member_confirmed_intake_bookings('e1500000-0000-0000-0000-000000000004') where session_id = 'e1500000-0000-0000-0001-000000000006'),
  'intro',
  'the deduplicated intro keeps its booking identity'
);

-- The member confirms normal sessions through the same RPC used by the application.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e1500000-0000-0000-0000-000000000004","role":"authenticated"}';
select public.respond_to_session('e1500000-0000-0000-0001-000000000001', 'going');
select public.respond_to_session('e1500000-0000-0000-0001-000000000002', 'going');
select public.respond_to_session('e1500000-0000-0000-0001-000000000003', 'going');
select public.respond_to_session('e1500000-0000-0000-0001-000000000004', 'not_going');
select public.respond_to_session('e1500000-0000-0000-0001-000000000006', 'going');
select is(
  (select count(*)::int from public.my_pending_intake_bookings()),
  2,
  'only confirmed bookings produce one prompt per coach'
);
select is(
  (select booking_id from public.my_pending_intake_bookings() where coach_id = 'e1500000-0000-0000-0000-000000000001'),
  'e1500000-0000-0000-0001-000000000001'::uuid,
  'the first confirmed booking wins over pending and later bookings'
);
select is(
  (select count(*)::int from public.session_live where session_id in (
    'e1500000-0000-0000-0001-000000000000',
    'e1500000-0000-0000-0001-000000000001',
    'e1500000-0000-0000-0001-000000000002',
    'e1500000-0000-0000-0001-000000000003',
    'e1500000-0000-0000-0001-000000000004',
    'e1500000-0000-0000-0001-000000000006'
  )),
  0,
  'a member cannot read broadcast playback for pending, not-going, same-coach or new-coach invites before consent'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1500000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.session_live where session_id in (
    'e1500000-0000-0000-0001-000000000001',
    'e1500000-0000-0000-0001-000000000002',
    'e1500000-0000-0000-0001-000000000006'
  )),
  3,
  'the session coach keeps broadcast playback access'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"e1500000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$select public.my_pending_intake_bookings()$$,
  '42501',
  null,
  'a coach cannot query a member pending-booking list'
);
reset role;

-- Minimal synthetic complete answers. This setting stays inside the rollback-only test transaction.
do $$ begin
  perform set_config('test.member_intake_answers', '{"age":52,"sex":"male","height_in":73,"current_weight_lbs":257,"highest_adult_weight_lbs":320,"exercise_clearance":"yes","injuries":[{"body_part":"ankle_right","restriction":"no_weight_bearing","duration":"6_to_24_months"}],"training_location":"commercial_gym","training_days_per_week":3,"session_minutes":45,"work_type":"desk","sleep_hours":7.5,"sugary_drinks_per_day":"0","eating_pattern":["regular_meals"],"activity_level":"light","dietary_style":"no_preference","batch_cooking":"once_weekly","meals_per_day":"3","plan_style":"in_between","checkin_preference":"none","stress_level":4,"main_why":"health"}', true);
end $$;

-- Anonymous callers get neither table data nor function-level access.
set local role anon;
select throws_ok($$select id from public.member_intakes$$, '42501', null, 'anonymous users cannot read intakes');
select throws_ok($$select public.my_pending_intake_bookings()$$, '42501', null, 'anonymous users cannot query intake booking state');
reset role;

-- The member can save a draft, but coaches and administrators cannot read it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e1500000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(
  public.save_member_intake_draft(current_setting('test.member_intake_answers')::jsonb, 8) is not null,
  true,
  'the member can save their own intake draft'
);
select is((select count(*)::int from public.member_intakes), 1, 'a retrying draft save keeps one current intake row');
do $$ begin
  perform set_config('test.member_intake_id', (select id::text from public.member_intakes where member_id = 'e1500000-0000-0000-0000-000000000004'), true);
end $$;
select is((select count(*)::int from public.member_intake_injuries), 1, 'injuries are normalized for the owner');
select throws_ok(
  $$insert into public.member_intakes(member_id, status, answers) values ('e1500000-0000-0000-0000-000000000004', 'completed', '{}'::jsonb)$$,
  '42501', null, 'members cannot write a forged completed row directly'
);
select throws_ok(
  $$insert into public.intake_coach_access(intake_id, coach_id, booking_id) values (current_setting('test.member_intake_id')::uuid, 'e1500000-0000-0000-0000-000000000003', 'e1500000-0000-0000-0001-000000000004')$$,
  '42501', null, 'members cannot create a coach grant directly'
);
select throws_ok(
  $$select public.save_member_intake_draft(jsonb_set(current_setting('test.member_intake_answers')::jsonb, '{status}', '"completed"'), 1)$$,
  '22023', null, 'draft writes reject forged status fields'
);
select throws_ok(
  $$select public.complete_member_intake(current_setting('test.member_intake_answers')::jsonb, 'e1500000-0000-0000-0000-000000000001', 'e1500000-0000-0000-0001-000000000001', false)$$,
  '22023', null, 'completion requires explicit final consent'
);
select throws_ok(
  $$select public.complete_member_intake(current_setting('test.member_intake_answers')::jsonb, 'e1500000-0000-0000-0000-000000000001', 'e1500000-0000-0000-0001-000000000002', true)$$,
  'P0001', null, 'the member cannot bind consent to a later same-coach booking'
);
select throws_ok(
  $$select public.complete_member_intake(current_setting('test.member_intake_answers')::jsonb, 'e1500000-0000-0000-0000-000000000003', 'e1500000-0000-0000-0001-000000000004', true)$$,
  'P0001', null, 'a declined booking cannot grant coach access'
);
do $$ begin
  perform set_config(
    'test.member_intake_id',
    public.complete_member_intake(
    current_setting('test.member_intake_answers')::jsonb,
    'e1500000-0000-0000-0000-000000000001',
    'e1500000-0000-0000-0001-000000000001',
    true
    )::text,
    true
  );
end $$;
select ok(current_setting('test.member_intake_id') <> '', 'valid explicit consent completes and shares with the booked coach');
select is(
  public.complete_member_intake(
    current_setting('test.member_intake_answers')::jsonb,
    'e1500000-0000-0000-0000-000000000001',
    'e1500000-0000-0000-0001-000000000001',
    true
  )::text,
  current_setting('test.member_intake_id'),
  'a repeated completion reuses the same intake row'
);
select is((select count(*)::int from public.intake_coach_access), 1, 'a repeated completion does not duplicate or broaden grants');
select is((select count(*)::int from public.member_intake_history), 0, 'a same-answer completion retry does not add a history snapshot');
select is((select count(*)::int from public.member_intakes), 1, 'the owner can read their completed intake');
select is(
  (select count(*)::int from public.session_live where session_id in (
    'e1500000-0000-0000-0001-000000000001',
    'e1500000-0000-0000-0001-000000000002',
    'e1500000-0000-0000-0001-000000000006'
  )),
  3,
  'explicit consent for one coach unlocks that coach’s session playback rows'
);
select is(
  (select count(*)::int from public.session_live where session_id = 'e1500000-0000-0000-0001-000000000003'),
  0,
  'consent for one coach does not unlock another coach’s playback row'
);
reset role;

-- Coach/member/admin isolation and direct writes.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e1500000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.member_intakes where member_id = 'e1500000-0000-0000-0000-000000000004'), 1, 'the explicitly granted coach can read submitted answers');
select is((select count(*)::int from public.member_intake_injuries), 1, 'the same grant includes injury details');
select throws_ok($$update public.member_intakes set status='completed'$$, '42501', null, 'a coach cannot alter a member intake');
select throws_ok($$select public.complete_member_intake('{}'::jsonb, null, null, true)$$, '42501', null, 'a coach cannot complete intake for a member');
select is(public.coach_member_intake_status('e1500000-0000-0000-0000-000000000004'), 'complete', 'coach status requires and recognizes the explicit grant');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1500000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.member_intakes), 0, 'a different booked coach cannot read without member consent');
select is((select count(*)::int from public.member_intake_injuries), 0, 'a different coach cannot read injuries without consent');
select is(public.coach_member_intake_status('e1500000-0000-0000-0000-000000000004'), 'pending', 'a new coach sees only a pending status');
select is(
  (select count(*)::int from public.session_live where session_id = 'e1500000-0000-0000-0001-000000000003'),
  1,
  'the new coach retains access to their own broadcast room before the member shares intake'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1500000-0000-0000-0000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.member_intakes), 0, 'another member cannot read completed answers');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1500000-0000-0000-0000-000000000006","role":"authenticated"}';
select is((select count(*)::int from public.member_intakes), 0, 'administrators do not receive health-data access');
select is((select count(*)::int from public.member_intake_history), 0, 'administrators cannot read intake history');
select is((select count(*)::int from public.session_live), 7, 'administrators retain live-room access');
reset role;

-- Editing creates an owner-only draft and preserves the last submitted snapshot for the old coach.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e1500000-0000-0000-0000-000000000004","role":"authenticated"}';
select public.save_member_intake_draft(
  jsonb_set(current_setting('test.member_intake_answers')::jsonb, '{main_why}', '"private draft edit"'),
  8
);
select is((select status from public.member_intakes), 'draft', 'an edited completed intake becomes a draft');
select is((select count(*)::int from public.member_intake_history), 1, 'the prior submission is archived before editing');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1500000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.member_intakes), 0, 'the previous coach cannot query an unsubmitted draft');
select is((select answers ->> 'main_why' from public.member_intake_history limit 1), 'health', 'the previous coach sees only the last submitted snapshot');
select is(
  (select count(*)::int from public.session_live where session_id in (
    'e1500000-0000-0000-0001-000000000001',
    'e1500000-0000-0000-0001-000000000002'
  )),
  2,
  'editing does not revoke playback for a previously submitted history and explicit grant'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1500000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.member_intakes), 0, 'a new coach cannot query another coach shared draft');
select is((select count(*)::int from public.member_intake_history), 0, 'a new coach cannot read history before consent');
reset role;

-- A second coach gets access only after the member reviews and resubmits with that exact booking.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e1500000-0000-0000-0000-000000000004","role":"authenticated"}';
select ok(
  public.complete_member_intake(
    jsonb_set(current_setting('test.member_intake_answers')::jsonb, '{main_why}', '"reviewed for new coach"'),
    'e1500000-0000-0000-0000-000000000002',
    'e1500000-0000-0000-0001-000000000003',
    true
  ) is not null,
  'the member can explicitly share a reviewed submission with a new coach'
);
select is((select count(*)::int from public.my_pending_intake_bookings()), 0, 'an already-consented coach does not require repeated intake');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1500000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select answers ->> 'main_why' from public.member_intakes where member_id = 'e1500000-0000-0000-0000-000000000004'), 'reviewed for new coach', 'the new coach reads the explicitly submitted version');
select is(public.coach_member_intake_status('e1500000-0000-0000-0000-000000000004'), 'complete', 'new coach status changes only after consent');
select is(
  (select count(*)::int from public.session_live where session_id = 'e1500000-0000-0000-0001-000000000003'),
  1,
  'a newly consented coach can read the linked broadcast playback row'
);
select throws_ok($$select public.coach_session_intake_status('e1500000-0000-0000-0001-000000000001')$$, 'P0002', null, 'a coach cannot inspect another coach session intake roster');
reset role;

-- A member can own drafts without making them coach-visible. A deletion cascades every intake row.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e1500000-0000-0000-0000-000000000005","role":"authenticated"}';
select ok(public.save_member_intake_draft(
  jsonb_build_object('current_weight_lbs', 180, 'injuries', jsonb_build_array(jsonb_build_object(
    'body_part','knee_left','restriction','no_impact','duration','under_6_months'
  ))),
  3
) is not null, 'a second member can save a separate draft');
select throws_ok(
  $$select public.complete_member_intake(current_setting('test.member_intake_answers')::jsonb, null, null, true)$$,
  'P0001', null, 'a member cannot complete or share without a valid booked coach'
);
do $$ begin
  perform set_config('test.member_two_intake_id', (select id::text from public.member_intakes where member_id = 'e1500000-0000-0000-0000-000000000005'), true);
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1500000-0000-0000-0000-000000000005","role":"authenticated"}';
select public.respond_to_session('e1500000-0000-0000-0001-000000000005', 'going');
reset role;

-- Reminder functions are service-only, only return booking metadata, and release failed sends for retry.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e1500000-0000-0000-0000-000000000005","role":"authenticated"}';
select throws_ok($$select public.list_member_intake_reminder_candidates()$$, '42501', null, 'members cannot enumerate reminder recipients');
reset role;

set local role service_role;
set local request.jwt.claims = '{"sub":"e1500000-0000-0000-0000-000000000000","role":"service_role"}';
select is(
  (select count(*)::int from public.list_member_intake_reminder_candidates() where member_id = 'e1500000-0000-0000-0000-000000000005' and session_id = 'e1500000-0000-0000-0001-000000000005' and reminder_phase = '24h'),
  1,
  'service candidate rows contain only due bookings lacking a coach grant'
);
select is(public.claim_member_intake_reminder(
  'e1500000-0000-0000-0001-000000000005',
  'e1500000-0000-0000-0000-000000000005',
  '24h',
  'e1500000-0000-0000-0004-000000000001'
), true, 'the first reminder worker claims the session');
do $$ begin
  perform set_config(
    'test.reminder_first_attempt_at',
    (select first_attempt_at::text from public.member_intake_reminder_claims
      where session_id = 'e1500000-0000-0000-0001-000000000005'
        and member_id = 'e1500000-0000-0000-0000-000000000005'
        and reminder_phase = '24h'),
    true
  );
end $$;
select is(public.claim_member_intake_reminder(
  'e1500000-0000-0000-0001-000000000005',
  'e1500000-0000-0000-0000-000000000005',
  '24h',
  'e1500000-0000-0000-0004-000000000002'
), false, 'a concurrent worker cannot claim an active lease');
select is(public.complete_member_intake_reminder(
  'e1500000-0000-0000-0001-000000000005',
  'e1500000-0000-0000-0000-000000000005',
  '24h',
  'e1500000-0000-0000-0004-000000000001',
  false
), true, 'provider failure releases the claim for retry');
select is(
  (select count(*)::int from public.list_member_intake_reminder_candidates() where member_id = 'e1500000-0000-0000-0000-000000000005'),
  1,
  'failed delivery remains eligible for a retry'
);
select is(public.claim_member_intake_reminder(
  'e1500000-0000-0000-0001-000000000005',
  'e1500000-0000-0000-0000-000000000005',
  '24h',
  'e1500000-0000-0000-0004-000000000003'
), true, 'a later worker can claim a released retry');
select is(
  (select first_attempt_at::text from public.member_intake_reminder_claims
    where session_id = 'e1500000-0000-0000-0001-000000000005'
      and member_id = 'e1500000-0000-0000-0000-000000000005'
      and reminder_phase = '24h'),
  current_setting('test.reminder_first_attempt_at'),
  'a retry preserves the original provider-attempt timestamp'
);
select is(public.complete_member_intake_reminder(
  'e1500000-0000-0000-0001-000000000005',
  'e1500000-0000-0000-0000-000000000005',
  '24h',
  'e1500000-0000-0000-0004-000000000003',
  true
), true, 'a successful delivery is recorded');
select is(public.claim_member_intake_reminder(
  'e1500000-0000-0000-0001-000000000005',
  'e1500000-0000-0000-0000-000000000005',
  '24h',
  'e1500000-0000-0000-0004-000000000004'
), false, 'a sent reminder is not duplicated');
select is(
  (select count(*)::int from public.list_member_intake_reminder_candidates() where member_id = 'e1500000-0000-0000-0000-000000000005'),
  0,
  'a sent reminder leaves the candidate queue'
);
update public.member_intake_reminder_claims
set state = 'sending', lease_token = 'e1500000-0000-0000-0004-000000000003',
  lease_until = now() - interval '1 minute', first_attempt_at = now() - interval '24 hours',
  sent_at = null
where session_id = 'e1500000-0000-0000-0001-000000000005'
  and member_id = 'e1500000-0000-0000-0000-000000000005'
  and reminder_phase = '24h';
select is(
  (select count(*)::int from public.list_member_intake_reminder_candidates() where member_id = 'e1500000-0000-0000-0000-000000000005'),
  0,
  'an ambiguous provider attempt older than the idempotency window is not retried'
);
select is(public.claim_member_intake_reminder(
  'e1500000-0000-0000-0001-000000000005',
  'e1500000-0000-0000-0000-000000000005',
  '24h',
  'e1500000-0000-0000-0004-000000000004'
), false, 'a stale uncertain delivery cannot receive a new lease after key expiry');
reset role;

delete from auth.users where id = 'e1500000-0000-0000-0000-000000000005';
select is((select count(*)::int from public.member_intakes where member_id = 'e1500000-0000-0000-0000-000000000005'), 0, 'account deletion removes the member draft');
select is((select count(*)::int from public.member_intake_injuries where intake_id = current_setting('test.member_two_intake_id')::uuid), 0, 'account deletion cascades normalized injury rows');
select is((select count(*)::int from public.member_intake_reminder_claims where member_id = 'e1500000-0000-0000-0000-000000000005'), 0, 'account deletion cascades reminder claims');

delete from auth.users where id = 'e1500000-0000-0000-0000-000000000004';
select is((select count(*)::int from public.member_intakes where member_id = 'e1500000-0000-0000-0000-000000000004'), 0, 'account deletion removes completed intake and drafts');
select is((select count(*)::int from public.member_intake_history where member_id = 'e1500000-0000-0000-0000-000000000004'), 0, 'account deletion cascades intake history');
select is((select count(*)::int from public.intake_coach_access where intake_id = current_setting('test.member_intake_id')::uuid), 0, 'account deletion revokes coach access');

select * from finish();
rollback;
