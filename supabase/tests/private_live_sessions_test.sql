begin;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('71000000-0000-0000-0000-000000000001', 'private-coach@example.test', '{"display_name":"Coach"}'),
  ('71000000-0000-0000-0000-000000000002', 'private-rival@example.test', '{"display_name":"Rival coach"}'),
  ('71000000-0000-0000-0000-000000000003', 'private-member@example.test', '{"display_name":"Member"}'),
  ('71000000-0000-0000-0000-000000000004', 'private-second@example.test', '{"display_name":"Second member"}'),
  ('71000000-0000-0000-0000-000000000005', 'private-admin@example.test', '{"display_name":"Admin"}'),
  ('71000000-0000-0000-0000-000000000006', 'private-third@example.test', '{"display_name":"Third member"}'),
  ('71000000-0000-0000-0000-000000000007', 'private-replacement@example.test', '{"display_name":"Replacement member"}');

update public.profiles set role = 'coach'
where id in ('71000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002');
update public.profiles set role = 'admin' where id = '71000000-0000-0000-0000-000000000005';

insert into public.calendar_sessions (id, coach_id, title, starts_at, ends_at) values
  ('71000000-0000-0000-0000-000000000101', '71000000-0000-0000-0000-000000000001', 'Pending invite', now() + interval '20 minutes', now() + interval '80 minutes'),
  ('71000000-0000-0000-0000-000000000102', '71000000-0000-0000-0000-000000000001', 'Group invite', now() + interval '20 minutes', now() + interval '80 minutes'),
  ('71000000-0000-0000-0000-000000000103', '71000000-0000-0000-0000-000000000001', 'Broadcast already exists', now() + interval '20 minutes', now() + interval '80 minutes'),
  ('71000000-0000-0000-0000-000000000104', '71000000-0000-0000-0000-000000000001', 'Membership unlink', now() + interval '20 minutes', now() + interval '80 minutes'),
  ('71000000-0000-0000-0000-000000000105', '71000000-0000-0000-0000-000000000001', 'Member account deletion', now() + interval '20 minutes', now() + interval '80 minutes'),
  ('71000000-0000-0000-0000-000000000106', '71000000-0000-0000-0000-000000000001', 'Stale provision', now() + interval '20 minutes', now() + interval '80 minutes');

insert into public.session_invites (session_id, member_id) values
  ('71000000-0000-0000-0000-000000000101', '71000000-0000-0000-0000-000000000003'),
  ('71000000-0000-0000-0000-000000000102', '71000000-0000-0000-0000-000000000003'),
  ('71000000-0000-0000-0000-000000000102', '71000000-0000-0000-0000-000000000004'),
  ('71000000-0000-0000-0000-000000000103', '71000000-0000-0000-0000-000000000003'),
  ('71000000-0000-0000-0000-000000000104', '71000000-0000-0000-0000-000000000003'),
  ('71000000-0000-0000-0000-000000000105', '71000000-0000-0000-0000-000000000004'),
  ('71000000-0000-0000-0000-000000000106', '71000000-0000-0000-0000-000000000006');

insert into public.session_live (session_id, input_uid, playback_url)
values ('71000000-0000-0000-0000-000000000103', 'existing-broadcast-input', 'https://example.test/broadcast');

create temporary table private_live_test_data (
  label text primary key,
  session_id uuid,
  grant_id uuid,
  generation bigint,
  direction text,
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_tag text,
  input_uid text,
  playback_id text,
  cleanup_id uuid
);
grant select, insert, update, delete on table pg_temp.private_live_test_data to authenticated, service_role;
create temporary table private_live_heartbeat_before (last_cleanup_at timestamptz);

select is(
  (select live_mode from public.calendar_sessions where id = '71000000-0000-0000-0000-000000000101'),
  'broadcast',
  'existing sessions default to broadcast'
);
select ok(not public.private_live_ready(), 'private live is unavailable before account binding and heartbeat');
select throws_ok(
  $$select public.record_private_live_cleanup_heartbeat()$$,
  'P0001', 'Private live provider account is not bound',
  'heartbeat cannot start before a provider account is bound'
);

set local role anon;
select throws_ok(
  $$select public.private_live_ready()$$,
  '42501', null,
  'anonymous users cannot check private runtime readiness'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$select public.bind_private_live_account('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,
  '42501', null,
  'authenticated coaches cannot bind a provider account'
);
select throws_ok(
  $$select public.record_private_live_cleanup_heartbeat()$$,
  '42501', null,
  'authenticated coaches cannot advance the cleanup heartbeat'
);
reset role;

set local role service_role;
select is(
  public.bind_private_live_account('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  true,
  'service role binds the initial Cloudflare account'
);
select is(
  public.private_live_account_matches('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  true,
  'the bound account matches'
);
select is(
  public.private_live_account_matches('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
  false,
  'a different account does not match'
);
select is(
  public.bind_private_live_account('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
  false,
  'account binding cannot be rotated through the RPC'
);
select throws_ok(
  $$select cloudflare_account_id from public.private_live_runtime$$,
  '42501', null,
  'service role cannot bypass immutable account binding with direct table reads'
);
select lives_ok(
  $$select public.record_private_live_cleanup_heartbeat()$$,
  'service role records the initial successful cleanup heartbeat'
);
reset role;
select ok(public.private_live_ready(), 'bound account and fresh heartbeat enable private live');
insert into pg_temp.private_live_heartbeat_before
select last_cleanup_at from public.private_live_runtime where id is true;

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}';
select ok(not exists (
  select 1 from public.coach_members
  where coach_id = '71000000-0000-0000-0000-000000000001'
    and member_id = '71000000-0000-0000-0000-000000000003'
), 'pending invited intro member has no coach_members row');
select throws_ok(
  $$select public.set_session_live_mode('71000000-0000-0000-0000-000000000101', 'one_on_one', '71000000-0000-0000-0000-000000000004')$$,
  'P0001', 'A private session needs exactly one invitation for the chosen member',
  'a non-invitee cannot be chosen'
);
select lives_ok(
  $$insert into pg_temp.private_live_test_data (label, session_id, grant_id)
    values ('offer_a', '71000000-0000-0000-0000-000000000101',
      public.set_session_live_mode('71000000-0000-0000-0000-000000000101', 'one_on_one', '71000000-0000-0000-0000-000000000003'))$$,
  'coach offers a private session to the sole pending invite without a coach_members row'
);
select is(
  (select response::text from public.session_invites where session_id = '71000000-0000-0000-0000-000000000101'),
  'pending',
  'offering does not require calendar RSVP'
);
select throws_ok(
  $$select public.set_session_live_mode('71000000-0000-0000-0000-000000000102', 'one_on_one', '71000000-0000-0000-0000-000000000003')$$,
  'P0001', 'A private session needs exactly one invitation for the chosen member',
  'group sessions cannot grant a private camera path'
);
select throws_ok(
  $$select public.set_session_live_mode('71000000-0000-0000-0000-000000000103', 'one_on_one', '71000000-0000-0000-0000-000000000003')$$,
  'P0001', 'Remove the previous broadcast input before making this session private',
  'an existing broadcast input blocks conversion to private'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(
  public.accept_private_session_grant(
    '71000000-0000-0000-0000-000000000101',
    (select grant_id from pg_temp.private_live_test_data where label = 'offer_a'), false
  ),
  true,
  'chosen member accepts without RSVPing and leaves camera consent off'
);
select ok(not private.session_is_live('71000000-0000-0000-0000-000000000101'), 'acceptance alone does not open chat');
select throws_ok(
  $$update public.private_session_grants set member_camera_allowed = true where session_id = '71000000-0000-0000-0000-000000000101'$$,
  '42501', null,
  'participants cannot directly change private grant consent'
);
select throws_ok(
  $$select public.accept_private_session_grant(
    '71000000-0000-0000-0000-000000000101',
    (select grant_id from pg_temp.private_live_test_data where label = 'offer_a'), true
  )$$,
  'P0001', 'Revoke this grant before changing camera consent',
  'camera consent cannot be replayed or changed after acceptance'
);
select is(
  (select count(*)::integer from public.private_session_grants),
  1,
  'chosen member can read the private grant'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*)::integer from public.private_session_grants), 0, 'other members cannot read the grant');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::integer from public.private_session_grants), 0, 'other coaches cannot read the grant');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000005","role":"authenticated"}';
select is((select count(*)::integer from public.private_session_grants), 0, 'admins cannot read the private grant');
select throws_ok(
  $$delete from public.private_session_grants where session_id = '71000000-0000-0000-0000-000000000101'$$,
  '42501', null,
  'admins cannot delete private grants directly'
);
select throws_ok(
  $$select * from public.private_live_provider_state$$,
  '42501', null,
  'admins cannot read provider identifiers'
);
reset role;
set local role anon;
select throws_ok(
  $$select grant_id from public.private_session_grants$$,
  '42501', null,
  'anonymous users cannot read private grants'
);
reset role;

set local role service_role;
select throws_ok(
  $$select public.claim_private_live_provision('71000000-0000-0000-0000-000000000101',
    (select grant_id from pg_temp.private_live_test_data where label = 'offer_a'),
    '71000000-0000-0000-0000-000000000003')$$,
  '42501', null,
  'member camera provisioning is refused without explicit camera consent'
);
select throws_ok(
  $$select * from public.claim_private_live_cleanup_batch('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 10)$$,
  '42501', 'Cleanup account does not match the bound provider account',
  'cleanup claims cannot target a different Cloudflare account'
);
select throws_ok(
  $$insert into public.private_live_provider_state (session_id, grant_id, generation, direction, provider_tag, state)
    values ('71000000-0000-0000-0000-000000000101',
      (select grant_id from pg_temp.private_live_test_data where label = 'offer_a'), 1, 'coach', 'direct-write', 'ready')$$,
  '42501', null,
  'service role cannot bypass provider lifecycle RPCs with direct writes'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
  $$insert into pg_temp.private_live_test_data (label, session_id, grant_id)
    values ('offer_d', '71000000-0000-0000-0000-000000000104',
      public.set_session_live_mode('71000000-0000-0000-0000-000000000104', 'one_on_one', '71000000-0000-0000-0000-000000000003'))$$,
  'coach can offer the exact invited member session'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(
  public.accept_private_session_grant(
    '71000000-0000-0000-0000-000000000104',
    (select grant_id from pg_temp.private_live_test_data where label = 'offer_d'), true
  ),
  true,
  'member explicitly opts into camera and microphone'
);
select lives_ok(
  $$select public.respond_to_session('71000000-0000-0000-0000-000000000104', 'going')$$,
  'calendar RSVP changes remain allowed while private access is active'
);
reset role;

set local role service_role;
select throws_ok(
  $$select * from public.claim_private_live_provision('71000000-0000-0000-0000-000000000104',
    (select grant_id from pg_temp.private_live_test_data where label = 'offer_d'),
    '71000000-0000-0000-0000-000000000003')$$,
  'P0001', 'Private session is outside its active live window or is no longer valid',
  'member camera cannot start before the coach starts'
);
select lives_ok(
  $$insert into pg_temp.private_live_test_data
      (label, session_id, grant_id, direction, generation, lease_token, lease_expires_at, provider_tag)
    select 'd_coach', session_id, grant_id, direction, generation, lease_token, lease_expires_at, provider_tag
    from public.claim_private_live_provision('71000000-0000-0000-0000-000000000104',
      (select grant_id from pg_temp.private_live_test_data where label = 'offer_d'),
      '71000000-0000-0000-0000-000000000001')$$,
  'coach service claims a leased coach-direction provider input'
);
select is(
  public.complete_private_live_provision(
    '71000000-0000-0000-0000-000000000104',
    (select grant_id from pg_temp.private_live_test_data where label = 'offer_d'),
    'coach', 1, (select lease_token from pg_temp.private_live_test_data where label = 'd_coach'),
    'coach-input-d', 'coach-playback-d'
  ),
  true,
  'current coach provision completion is accepted'
);
select is(
  public.mark_private_live_started(
    '71000000-0000-0000-0000-000000000104',
    (select grant_id from pg_temp.private_live_test_data where label = 'offer_d'),
    'coach', 1, (select lease_token from pg_temp.private_live_test_data where label = 'd_coach'),
    '71000000-0000-0000-0000-000000000001'
  ),
  true,
  'coach direction is marked live'
);
select is(
  public.mark_private_live_started(
    '71000000-0000-0000-0000-000000000104',
    (select grant_id from pg_temp.private_live_test_data where label = 'offer_d'),
    'coach', 1, (select lease_token from pg_temp.private_live_test_data where label = 'd_coach'),
    '71000000-0000-0000-0000-000000000001'
  ),
  true,
  'coach live start is idempotent'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000003","role":"authenticated"}';
select ok(private.session_is_live('71000000-0000-0000-0000-000000000104'), 'chat opens only after coach direction is live');
reset role;

set local role service_role;
select lives_ok(
  $$insert into pg_temp.private_live_test_data
      (label, session_id, grant_id, direction, generation, lease_token, lease_expires_at, provider_tag)
    select 'd_member', session_id, grant_id, direction, generation, lease_token, lease_expires_at, provider_tag
    from public.claim_private_live_provision('71000000-0000-0000-0000-000000000104',
      (select grant_id from pg_temp.private_live_test_data where label = 'offer_d'),
      '71000000-0000-0000-0000-000000000003')$$,
  'member camera claims a separate member-direction input after coach starts'
);
select is(
  public.complete_private_live_provision(
    '71000000-0000-0000-0000-000000000104',
    (select grant_id from pg_temp.private_live_test_data where label = 'offer_d'),
    'member', 1, (select lease_token from pg_temp.private_live_test_data where label = 'd_member'),
    'member-input-d', 'member-playback-d'
  ),
  true,
  'current member-direction completion is accepted'
);
select is(
  public.mark_private_live_started(
    '71000000-0000-0000-0000-000000000104',
    (select grant_id from pg_temp.private_live_test_data where label = 'offer_d'),
    'member', 1, (select lease_token from pg_temp.private_live_test_data where label = 'd_member'),
    '71000000-0000-0000-0000-000000000003'
  ),
  true,
  'member direction is marked live'
);
select is(
  (select input_uid from public.authorize_private_live_publish(
    '71000000-0000-0000-0000-000000000104',
    (select grant_id from pg_temp.private_live_test_data where label = 'offer_d'), 1,
    '71000000-0000-0000-0000-000000000001')),
  'coach-input-d',
  'coach publish authorization returns only the coach input'
);
select is(
  (select input_uid from public.authorize_private_live_publish(
    '71000000-0000-0000-0000-000000000104',
    (select grant_id from pg_temp.private_live_test_data where label = 'offer_d'), 1,
    '71000000-0000-0000-0000-000000000003')),
  'member-input-d',
  'member publish authorization returns only the opted-in member input'
);
select is(
  (select playback_id from public.authorize_private_live_playback(
    '71000000-0000-0000-0000-000000000104',
    (select grant_id from pg_temp.private_live_test_data where label = 'offer_d'), 1,
    '71000000-0000-0000-0000-000000000003', 'coach')),
  'coach-playback-d',
  'chosen member can view the coach direction'
);
select is(
  (select count(*)::integer from public.authorize_private_live_playback(
    '71000000-0000-0000-0000-000000000104',
    (select grant_id from pg_temp.private_live_test_data where label = 'offer_d'), 1,
    '71000000-0000-0000-0000-000000000003', 'member')),
  0,
  'chosen member cannot view their own return input'
);
select is(
  (select playback_id from public.authorize_private_live_playback(
    '71000000-0000-0000-0000-000000000104',
    (select grant_id from pg_temp.private_live_test_data where label = 'offer_d'), 1,
    '71000000-0000-0000-0000-000000000001', 'member')),
  'member-playback-d',
  'coach can view the opted-in member return direction'
);
select is(
  (select count(*)::integer from public.authorize_private_live_playback(
    '71000000-0000-0000-0000-000000000104',
    (select grant_id from pg_temp.private_live_test_data where label = 'offer_d'), 1,
    '71000000-0000-0000-0000-000000000006', 'coach')),
  0,
  'other members cannot view a private playback'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.authorize_private_live_playback(uuid,uuid,bigint,uuid,text)',
    'EXECUTE'
  ),
  'authenticated participants cannot call service-only playback authorization directly'
);
reset role;

insert into public.coach_members (coach_id, member_id)
values ('71000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000003');
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$select public.update_session('71000000-0000-0000-0000-000000000104', 'Changed', '', '', '',
    now() + interval '21 minutes', now() + interval '81 minutes', array['71000000-0000-0000-0000-000000000003']::uuid[])$$,
  'P0001', 'Private live access must be revoked and provider cleanup confirmed first',
  'legacy session time updates cannot bypass private provider cleanup'
);
reset role;
set local role postgres;
select throws_ok(
  $$update public.session_invites set member_id = '71000000-0000-0000-0000-000000000004'
    where session_id = '71000000-0000-0000-0000-000000000104'$$,
  'P0001', 'Private session invites cannot change until provider cleanup is confirmed',
  'invite identity cannot change while private provider state is active'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000003","role":"authenticated"}';
select lives_ok(
  $$delete from public.coach_members where coach_id = '71000000-0000-0000-0000-000000000001'
    and member_id = '71000000-0000-0000-0000-000000000003'$$,
  'leaving the coach queues cleanup before legacy upcoming-invite deletion'
);
reset role;
select is(
  (select state from public.private_session_grants where session_id = '71000000-0000-0000-0000-000000000104'),
  'revoking',
  'unlink revokes access before provider deletion is confirmed'
);
select is(
  (select count(*)::integer from public.private_live_cleanup_jobs where session_id = '71000000-0000-0000-0000-000000000104' and state <> 'complete'),
  2,
  'unlink preserves one cleanup job for each private direction'
);
select is(
  (select count(*)::integer from public.session_invites where session_id = '71000000-0000-0000-0000-000000000104'),
  0,
  'legacy upcoming-invite cleanup succeeds after the before-delete revoke trigger'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$select public.set_session_live_mode('71000000-0000-0000-0000-000000000104', 'broadcast', null)$$,
  'P0001', 'Private provider cleanup must be confirmed before switching to broadcast',
  'session cannot return to broadcast while provider deletion is pending'
);
reset role;

set local role service_role;
select lives_ok(
  $$insert into pg_temp.private_live_test_data
      (label, cleanup_id, session_id, grant_id, generation, direction, lease_token, input_uid, provider_tag)
    select 'd_cleanup_' || direction, cleanup_id, session_id, grant_id, generation, direction, lease_token, input_uid, provider_tag
    from public.claim_private_live_cleanup_batch('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 10)$$,
  'service claims cleanup work for both directions'
);
select is((select count(*)::integer from pg_temp.private_live_test_data where label like 'd_cleanup_%'), 2, 'both direction cleanup leases are returned');
select is(
  public.complete_private_live_cleanup(
    (select cleanup_id from pg_temp.private_live_test_data where label like 'd_cleanup_%' limit 1),
    '71000000-0000-0000-0000-000000000104', 1,
    (select direction from pg_temp.private_live_test_data where label like 'd_cleanup_%' limit 1),
    (select lease_token from pg_temp.private_live_test_data where label like 'd_cleanup_%' limit 1),
    true, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  ),
  false,
  'wrong-account 404 cannot confirm cleanup'
);
select is(
  (select count(*)::integer from public.claim_private_live_cleanup_batch('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 10)),
  0,
  'already claimed jobs are not returned to an overlapping cleanup worker'
);
select throws_ok(
  $$select public.record_private_live_cleanup_heartbeat()$$,
  'P0001', 'Private live cleanup queue is not empty',
  'an empty interim poll cannot refresh heartbeat while claimed cleanup remains'
);
reset role;
select is(
  (select last_cleanup_at from public.private_live_runtime),
  (select last_cleanup_at from pg_temp.private_live_heartbeat_before),
  'failed cleanup leaves the previous heartbeat unchanged'
);
set local role service_role;
select is(
  (select bool_and(not public.complete_private_live_cleanup(
    cleanup_id, session_id, generation, direction, lease_token, false,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )) from pg_temp.private_live_test_data where label like 'd_cleanup_%'),
  true,
  'failed provider deletes do not finalize revocation'
);
reset role;
select is(
  (select state from public.private_session_grants where session_id = '71000000-0000-0000-0000-000000000104'),
  'revoking',
  'grant stays revoking until both provider directions are confirmed deleted'
);
update public.private_live_cleanup_jobs
set available_at = now() - interval '1 second'
where session_id = '71000000-0000-0000-0000-000000000104' and state = 'pending';
delete from pg_temp.private_live_test_data where label like 'd_cleanup_%';

set local role service_role;
select lives_ok(
  $$insert into pg_temp.private_live_test_data
      (label, cleanup_id, session_id, grant_id, generation, direction, lease_token, input_uid, provider_tag)
    select 'd_cleanup_retry_' || direction, cleanup_id, session_id, grant_id, generation, direction, lease_token, input_uid, provider_tag
    from public.claim_private_live_cleanup_batch('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 10)$$,
  'service can retry failed provider deletes'
);
select is(
  (select bool_and(public.complete_private_live_cleanup(
    cleanup_id, session_id, generation, direction, lease_token, true,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )) from pg_temp.private_live_test_data where label like 'd_cleanup_retry_%'),
  true,
  'confirmed provider deletes complete the cleanup leases'
);
reset role;
select is(
  (select state from public.private_session_grants where session_id = '71000000-0000-0000-0000-000000000104'),
  'revoked',
  'the grant retires only after all provider directions are deleted'
);
set local role service_role;
select lives_ok(
  $$select public.record_private_live_cleanup_heartbeat()$$,
  'heartbeat resumes after cleanup queue is empty'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
  $$select public.set_session_live_mode('71000000-0000-0000-0000-000000000104', 'broadcast', null)$$,
  'session can return to broadcast after confirmed cleanup'
);
reset role;
insert into public.session_invites (session_id, member_id)
values ('71000000-0000-0000-0000-000000000104', '71000000-0000-0000-0000-000000000004');
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
  $$insert into pg_temp.private_live_test_data (label, session_id, grant_id)
    values ('offer_d_replacement', '71000000-0000-0000-0000-000000000104',
      public.set_session_live_mode('71000000-0000-0000-0000-000000000104', 'one_on_one', '71000000-0000-0000-0000-000000000004'))$$,
  'replacement invitee can receive a new private generation'
);
reset role;
select is(
  (select generation from public.private_session_grants where grant_id = (select grant_id from pg_temp.private_live_test_data where label = 'offer_d_replacement')),
  2::bigint,
  'new generation increases after provider state and cleanup history'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
  $$insert into pg_temp.private_live_test_data (label, session_id, grant_id)
    values ('offer_e', '71000000-0000-0000-0000-000000000105',
      public.set_session_live_mode('71000000-0000-0000-0000-000000000105', 'one_on_one', '71000000-0000-0000-0000-000000000004'))$$,
  'coach offers member account deletion test'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(
  public.accept_private_session_grant('71000000-0000-0000-0000-000000000105',
    (select grant_id from pg_temp.private_live_test_data where label = 'offer_e'), true),
  true,
  'member explicitly accepts before account deletion'
);
reset role;
set local role service_role;
select lives_ok(
  $$insert into pg_temp.private_live_test_data
      (label, session_id, grant_id, direction, generation, lease_token, lease_expires_at, provider_tag)
    select 'e_coach', session_id, grant_id, direction, generation, lease_token, lease_expires_at, provider_tag
    from public.claim_private_live_provision('71000000-0000-0000-0000-000000000105',
      (select grant_id from pg_temp.private_live_test_data where label = 'offer_e'),
      '71000000-0000-0000-0000-000000000001')$$,
  'coach input is provisioned before selected-member account deletion'
);
select is(
  public.complete_private_live_provision('71000000-0000-0000-0000-000000000105',
    (select grant_id from pg_temp.private_live_test_data where label = 'offer_e'), 'coach', 1,
    (select lease_token from pg_temp.private_live_test_data where label = 'e_coach'),
    'e-coach-input', 'e-coach-playback'),
  true,
  'current coach provider input is recorded'
);
select is(
  public.mark_private_live_started('71000000-0000-0000-0000-000000000105',
    (select grant_id from pg_temp.private_live_test_data where label = 'offer_e'), 'coach', 1,
    (select lease_token from pg_temp.private_live_test_data where label = 'e_coach'),
    '71000000-0000-0000-0000-000000000001'),
  true,
  'coach stream is live before selected-member account deletion'
);
reset role;
delete from auth.users where id = '71000000-0000-0000-0000-000000000004';
select is(
  (select count(*)::integer from public.private_live_cleanup_jobs where session_id = '71000000-0000-0000-0000-000000000105' and state <> 'complete'),
  1,
  'account deletion preserves provider cleanup without grant or profile foreign keys'
);
select is(
  (select state from public.private_live_provider_state where session_id = '71000000-0000-0000-0000-000000000105' and direction = 'coach'),
  'cleanup_pending',
  'account deletion immediately blocks the old provider direction'
);
set local role service_role;
select lives_ok(
  $$insert into pg_temp.private_live_test_data
      (label, cleanup_id, session_id, grant_id, generation, direction, lease_token, input_uid, provider_tag)
    select 'e_cleanup', cleanup_id, session_id, grant_id, generation, direction, lease_token, input_uid, provider_tag
    from public.claim_private_live_cleanup_batch('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 10)$$,
  'cleanup worker can process deletion after participant account is gone'
);
select is(
  public.complete_private_live_cleanup(
    (select cleanup_id from pg_temp.private_live_test_data where label = 'e_cleanup'),
    '71000000-0000-0000-0000-000000000105', 1, 'coach',
    (select lease_token from pg_temp.private_live_test_data where label = 'e_cleanup'),
    true, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  ),
  true,
  'confirmed deletion completes after participant rows cascade'
);
reset role;
insert into public.session_invites (session_id, member_id)
values ('71000000-0000-0000-0000-000000000105', '71000000-0000-0000-0000-000000000007');
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
  $$insert into pg_temp.private_live_test_data (label, session_id, grant_id)
    values ('offer_e_replacement', '71000000-0000-0000-0000-000000000105',
      public.set_session_live_mode('71000000-0000-0000-0000-000000000105', 'one_on_one', '71000000-0000-0000-0000-000000000007'))$$,
  'replacement member can be invited after account cleanup'
);
reset role;
select is(
  (select generation from public.private_session_grants where grant_id = (select grant_id from pg_temp.private_live_test_data where label = 'offer_e_replacement')),
  2::bigint,
  'member deletion does not recycle a durable provider generation'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
  $$insert into pg_temp.private_live_test_data (label, session_id, grant_id)
    values ('offer_f', '71000000-0000-0000-0000-000000000106',
      public.set_session_live_mode('71000000-0000-0000-0000-000000000106', 'one_on_one', '71000000-0000-0000-0000-000000000006'))$$,
  'coach offers stale-provision race test'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000006","role":"authenticated"}';
select is(
  public.accept_private_session_grant('71000000-0000-0000-0000-000000000106',
    (select grant_id from pg_temp.private_live_test_data where label = 'offer_f'), true),
  true,
  'third member accepts camera consent'
);
reset role;
set local role service_role;
select lives_ok(
  $$insert into pg_temp.private_live_test_data
      (label, session_id, grant_id, direction, generation, lease_token, lease_expires_at, provider_tag)
    select 'f_old_lease', session_id, grant_id, direction, generation, lease_token, lease_expires_at, provider_tag
    from public.claim_private_live_provision('71000000-0000-0000-0000-000000000106',
      (select grant_id from pg_temp.private_live_test_data where label = 'offer_f'),
      '71000000-0000-0000-0000-000000000001')$$,
  'first coach provision lease is claimed'
);
reset role;
update public.private_live_provider_state
set provision_lease_expires_at = now() - interval '1 second'
where session_id = '71000000-0000-0000-0000-000000000106' and direction = 'coach';
set local role service_role;
select lives_ok(
  $$insert into pg_temp.private_live_test_data
      (label, session_id, grant_id, direction, generation, lease_token, lease_expires_at, provider_tag)
    select 'f_new_lease', session_id, grant_id, direction, generation, lease_token, lease_expires_at, provider_tag
    from public.claim_private_live_provision('71000000-0000-0000-0000-000000000106',
      (select grant_id from pg_temp.private_live_test_data where label = 'offer_f'),
      '71000000-0000-0000-0000-000000000001')$$,
  'expired same-generation lease is replaced atomically'
);
select is(
  public.complete_private_live_provision('71000000-0000-0000-0000-000000000106',
    (select grant_id from pg_temp.private_live_test_data where label = 'offer_f'), 'coach', 1,
    (select lease_token from pg_temp.private_live_test_data where label = 'f_new_lease'),
    'f-current-input', 'f-current-playback'),
  true,
  'new lease completion is accepted'
);
select is(
  public.mark_private_live_started('71000000-0000-0000-0000-000000000106',
    (select grant_id from pg_temp.private_live_test_data where label = 'offer_f'), 'coach', 1,
    (select lease_token from pg_temp.private_live_test_data where label = 'f_new_lease'),
    '71000000-0000-0000-0000-000000000001'),
  true,
  'new provider direction starts live'
);
select is(
  public.complete_private_live_provision('71000000-0000-0000-0000-000000000106',
    (select grant_id from pg_temp.private_live_test_data where label = 'offer_f'), 'coach', 1,
    (select lease_token from pg_temp.private_live_test_data where label = 'f_old_lease'),
    'f-stale-input', 'f-stale-playback'),
  false,
  'late old-lease completion is denied and queued for exact-UID cleanup'
);
reset role;
select is(
  (select input_uid from public.private_live_provider_state where session_id = '71000000-0000-0000-0000-000000000106' and direction = 'coach'),
  'f-current-input',
  'stale completion does not overwrite the newer live input'
);
select is(
  (select input_uid from public.private_live_cleanup_jobs where session_id = '71000000-0000-0000-0000-000000000106'),
  'f-stale-input',
  'stale cleanup records only the obsolete input UID'
);
set local role service_role;
select lives_ok(
  $$insert into pg_temp.private_live_test_data
      (label, cleanup_id, session_id, grant_id, generation, direction, lease_token, input_uid, provider_tag)
    select 'f_cleanup', cleanup_id, session_id, grant_id, generation, direction, lease_token, input_uid, provider_tag
    from public.claim_private_live_cleanup_batch('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 10)$$,
  'cleanup worker claims the stale input by exact UID'
);
select is(
  public.complete_private_live_cleanup(
    (select cleanup_id from pg_temp.private_live_test_data where label = 'f_cleanup'),
    '71000000-0000-0000-0000-000000000106', 1, 'coach',
    (select lease_token from pg_temp.private_live_test_data where label = 'f_cleanup'),
    true, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  ),
  true,
  'stale input deletion is confirmed'
);
reset role;
select is(
  (select state from public.private_live_provider_state where session_id = '71000000-0000-0000-0000-000000000106' and direction = 'coach'),
  'live',
  'deleting stale input does not retire the newer live provider row'
);
reset role;

update public.private_live_runtime set last_cleanup_at = now() - interval '4 minutes' where id is true;
select ok(not public.private_live_ready(), 'stale heartbeat closes readiness');
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$select public.set_session_live_mode('71000000-0000-0000-0000-000000000102', 'one_on_one', '71000000-0000-0000-0000-000000000003')$$,
  'P0001', 'Private live cleanup is not ready',
  'stale scheduler heartbeat prevents a new private offer'
);
reset role;

select * from finish();
rollback;
