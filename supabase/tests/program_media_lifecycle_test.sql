begin;
select no_plan();

-- All identities and provider-like values are synthetic. Provider observations below are test
-- fixtures passed to the service RPCs; this suite makes no HTTP/provider request and rolls back.
insert into auth.users (id, email, raw_user_meta_data) values
  ('c3100000-0000-0000-0000-000000000001', 'gate3-coach@example.test', '{"display_name":"Gate 3 Coach"}'),
  ('c3100000-0000-0000-0000-000000000002', 'gate3-member@example.test', '{"display_name":"Gate 3 Member"}'),
  ('c3100000-0000-0000-0000-000000000003', 'gate3-legacy-coach@example.test', '{"display_name":"Gate 3 Legacy Coach"}'),
  ('c3100000-0000-0000-0000-000000000004', 'gate3-retention-coach@example.test', '{"display_name":"Gate 3 Retention Coach"}'),
  ('c3100000-0000-0000-0000-000000000005', 'gate3-unknown-upload-coach@example.test', '{"display_name":"Gate 3 Unknown Upload Coach"}'),
  ('c3100000-0000-0000-0000-000000000006', 'gate3-pre-http-coach@example.test', '{"display_name":"Gate 3 Pre-HTTP Coach"}'),
  ('c3100000-0000-0000-0000-000000000007', 'gate3-failed-only-coach@example.test', '{"display_name":"Gate 3 Failed-Only Coach"}'),
  ('c3100000-0000-0000-0000-000000000008', 'gate3-no-legacy-coach@example.test', '{"display_name":"Gate 3 No Legacy Coach"}'),
  ('c3100000-0000-0000-0000-000000000009', 'gate3-terminal-cleanup-coach@example.test', '{"display_name":"Gate 3 Terminal Cleanup Coach"}'),
  ('c3100000-0000-0000-0000-000000000010', 'gate3-admin-proxy@example.test', '{"display_name":"Gate 3 Admin Proxy"}'),
  ('c3100000-0000-0000-0000-000000000011', 'gate3-provisional-cleanup-coach@example.test', '{"display_name":"Gate 3 Provisional Cleanup Coach"}'),
  ('c3100000-0000-0000-0000-000000000012', 'gate3-provisional-source-coach@example.test', '{"display_name":"Gate 3 Provisional Source Coach"}');
update public.profiles set role = 'coach'
where id in ('c3100000-0000-0000-0000-000000000001', 'c3100000-0000-0000-0000-000000000003',
  'c3100000-0000-0000-0000-000000000004','c3100000-0000-0000-0000-000000000005',
  'c3100000-0000-0000-0000-000000000006','c3100000-0000-0000-0000-000000000007',
  'c3100000-0000-0000-0000-000000000008','c3100000-0000-0000-0000-000000000009',
  'c3100000-0000-0000-0000-000000000011','c3100000-0000-0000-0000-000000000012');
update public.profiles set role='admin' where id='c3100000-0000-0000-0000-000000000010';
insert into public.coach_members (coach_id, member_id)
values ('c3100000-0000-0000-0000-000000000001', 'c3100000-0000-0000-0000-000000000002');

select ok(not has_table_privilege('anon', 'public.stream_media_operations', 'select'),
  'anonymous clients cannot inspect media operation identities');
select ok(not has_table_privilege('authenticated', 'public.stream_media_auth_deletion_permits', 'select'),
  'authenticated clients cannot inspect account deletion permits');
select ok(not has_table_privilege('service_role', 'public.stream_media_manifest_edges', 'insert'),
  'the service role cannot bypass manifest RPC validation with direct inserts');
select ok(not has_table_privilege('service_role', 'public.stream_media_operation_uid_state', 'update'),
  'the service role cannot fabricate provider UID outcomes with direct updates');
select ok(has_function_privilege('authenticated',
  'public.reserve_stream_media_cleanup(uuid,uuid,text,text,uuid,bigint,text)', 'execute'),
  'authenticated owners keep the existing Daily Content cleanup reservation RPC');
select ok(not has_function_privilege('authenticated',
  'public.begin_stream_account_media_cleanup(uuid,uuid,uuid,text,uuid,text)', 'execute'),
  'account-wide cleanup remains service-only');
select ok(not has_function_privilege('authenticated',
  'public.prepare_stream_auth_deletion_permit(uuid,bigint,uuid,uuid,text)', 'execute'),
  'Auth deletion permits remain service-only');
select ok(not has_table_privilege('authenticated','public.stream_media_account_tombstones','select'),
  'account tombstones are not exposed to authenticated clients');
select ok(not has_function_privilege('authenticated',
  'public.record_stream_auth_cleanup_component_proof(uuid,bigint,text,bigint,bigint,text,text,text,uuid)', 'execute'),
  'component cleanup proofs remain service-only');
select ok(has_function_privilege('service_role',
  'public.record_stream_auth_cleanup_component_proof(uuid,bigint,text,bigint,bigint,text,text,text,uuid)', 'execute'),
  'registered feature services may submit their cleanup proof');
select ok(not exists (
  select 1 from (values
    ('videos_stream_media_lifecycle_guard'::text, 'public.videos'::regclass),
    ('post_media_stream_media_lifecycle_guard', 'public.post_media'::regclass),
    ('programs_intro_stream_media_lifecycle_guard', 'public.programs'::regclass),
    ('program_days_stream_media_lifecycle_guard', 'public.program_days'::regclass),
    ('program_lessons_stream_media_lifecycle_guard', 'public.program_content_version_lessons'::regclass),
    ('daily_content_revisions_stream_media_lifecycle_guard', 'public.daily_content_revisions'::regclass),
    ('daily_content_slots_stream_media_lifecycle_guard', 'public.daily_content_slots'::regclass),
    ('daily_content_grants_stream_media_lifecycle_guard', 'public.member_daily_content_video_grants'::regclass),
    ('tasks_stream_media_lifecycle_guard', 'public.tasks'::regclass),
    ('daily_fuel_assignments_stream_media_lifecycle_guard', 'public.member_daily_fuel_assignments'::regclass),
    ('daily_fuel_bookmarks_stream_media_lifecycle_guard', 'public.member_daily_fuel_bookmarks'::regclass),
    ('programs_stream_market_retention_guard', 'public.programs'::regclass),
    ('program_commerce_state_stream_market_retention_guard', 'public.program_commerce_state'::regclass),
    ('program_enrollments_stream_pin_retention_guard', 'public.program_enrollments'::regclass),
    ('program_orders_stream_retention_guard', 'public.program_orders'::regclass),
    ('program_order_state_stream_retention_guard', 'public.program_order_state'::regclass),
    ('program_payment_events_stream_retention_guard', 'public.program_payment_events'::regclass),
    ('task_assignments_stream_account_edge_guard', 'public.task_assignments'::regclass),
    ('daily_content_items_stream_media_status_guard', 'public.daily_content_items'::regclass),
    ('daily_content_items_stream_media_delete_guard', 'public.daily_content_items'::regclass),
    ('profiles_stream_media_delete_guard', 'public.profiles'::regclass)
  ) expected(trigger_name, table_id)
  where not exists (
    select 1 from pg_trigger trigger_row
    where trigger_row.tgrelid = expected.table_id
      and trigger_row.tgname = expected.trigger_name and not trigger_row.tgisinternal
  )
), 'all supported media source writers and account cascade have lifecycle guards');
select ok(position('stream_uid_blocks_new_media_reference' in pg_get_functiondef(
  'private.stream_set_retention_obligation(uuid,text,text,text,bigint,text,boolean,uuid,text,uuid,text)'::regprocedure)) > 0,
  'durable offer, order, and free-pin writes share the UID-state fence');
select ok(position('40001' in pg_get_functiondef(
    'private.stream_set_retention_obligation(uuid,text,text,text,bigint,text,boolean,uuid,text,uuid,text)'::regprocedure)) > 0
  and position('stream_require_read_committed' in pg_get_functiondef(
    'private.stream_set_retention_obligation(uuid,text,text,text,bigint,text,boolean,uuid,text,uuid,text)'::regprocedure))
    < position('stream_try_uid_lock' in pg_get_functiondef(
      'private.stream_set_retention_obligation(uuid,text,text,text,bigint,text,boolean,uuid,text,uuid,text)'::regprocedure))
  and position('stream_try_uid_lock' in pg_get_functiondef(
    'private.stream_set_retention_obligation(uuid,text,text,text,bigint,text,boolean,uuid,text,uuid,text)'::regprocedure))
    < position('stream_uid_blocks_new_media_reference' in pg_get_functiondef(
      'private.stream_set_retention_obligation(uuid,text,text,text,bigint,text,boolean,uuid,text,uuid,text)'::regprocedure)),
  'retention writes require READ COMMITTED and a nonblocking UID fence before durable-state checks');
select ok(position('stream_uid_blocks_new_media_reference' in pg_get_functiondef(
  'private.guard_stream_task_assignment_account_edge()'::regprocedure)) > 0
  and position('stream_try_uid_lock' in pg_get_functiondef(
    'private.guard_stream_task_assignment_account_edge()'::regprocedure))
    < position('stream_uid_blocks_new_media_reference' in pg_get_functiondef(
      'private.guard_stream_task_assignment_account_edge()'::regprocedure)),
  'task assignment account edges check durable UID state under the UID lock');
select ok(position('stream_set_retention_obligation' in pg_get_functiondef(
    'private.guard_program_enrollment_media_retention()'::regprocedure)) > 0
  and position('sync_program_market_retention' in pg_get_functiondef(
    'private.guard_program_market_retention_write()'::regprocedure)) > 0
  and position('sync_program_order_retention' in pg_get_functiondef(
    'private.guard_program_order_media_retention()'::regprocedure)) > 0,
  'enrollment, offer, order, and payment triggers route live obligations through the fenced writer');
select ok(position('stream_try_lock_accounts' in pg_get_functiondef(
    'private.guard_program_enrollment_media_retention()'::regprocedure))
      < position('try_lock_program_media_versions' in pg_get_functiondef(
        'private.guard_program_enrollment_media_retention()'::regprocedure))
  and position('try_lock_program_media_versions' in pg_get_functiondef(
    'private.guard_program_enrollment_media_retention()'::regprocedure))
      < position('stream_set_retention_obligation' in pg_get_functiondef(
        'private.guard_program_enrollment_media_retention()'::regprocedure))
  and position('stream_try_lock_accounts' in pg_get_functiondef(
    'private.guard_program_order_media_retention()'::regprocedure))
      < position('try_lock_program_media_versions' in pg_get_functiondef(
        'private.guard_program_order_media_retention()'::regprocedure))
  and position('try_lock_program_media_versions' in pg_get_functiondef(
    'private.guard_program_order_media_retention()'::regprocedure))
      < position('sync_program_order_retention' in pg_get_functiondef(
        'private.guard_program_order_media_retention()'::regprocedure))
  and position('stream_try_lock_accounts' in pg_get_functiondef(
    'private.guard_program_market_retention_write()'::regprocedure))
      < position('sync_program_market_retention' in pg_get_functiondef(
        'private.guard_program_market_retention_write()'::regprocedure)),
  'Program account and version locks precede UID-fenced obligation updates');
select ok(position('binding.source_kind <> ''program_lesson''' in pg_get_functiondef(
  'private.stream_media_has_effective_reference(uuid,text,uuid)'::regprocedure)) > 0,
  'historical Program lesson bindings are not permanent effective references');
select ok(position('order by item.account_id' in pg_get_functiondef(
    'private.stream_lock_accounts(uuid[])'::regprocedure)) > 0
  and position('order by item.account_id::text' in pg_get_functiondef(
    'private.stream_lock_accounts(uuid[])'::regprocedure)) = 0
  and position('order by item.account_id' in pg_get_functiondef(
    'private.stream_try_lock_accounts(uuid[])'::regprocedure)) > 0,
  'account lock helpers use the same selected UUID order for deterministic locking');
select ok(position('order by offer_id,lesson_id' in pg_get_functiondef(
    'private.sync_program_market_retention(uuid)'::regprocedure)) > 0,
  'market retention ordering uses selected DISTINCT outputs');
select ok(position('target_expected_tombstone_state_revision' in pg_get_functiondef(
    'public.start_stream_auth_deletion_call(uuid,bigint,bigint,uuid,text)'::regprocedure)) > 0
  and position('target_tombstone_state_revision' in pg_get_functiondef(
    'public.start_stream_auth_deletion_call(uuid,bigint,bigint,uuid,text)'::regprocedure)) = 0,
  'Auth deletion start reads its declared tombstone revision argument');

set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('test.g3_registry_id', public.record_stream_provider_account_attestation(
  'c3110000-0000-0000-0000-000000000001', repeat('a', 32), 'vod_primary', repeat('1', 64)
)->>'registry_id', true);
select is(public.record_stream_account_path_verification(
  'c3110000-0000-0000-0000-000000000002', current_setting('test.g3_registry_id')::uuid,
  'vod_primary', repeat('a', 32), 200::smallint, repeat('2', 64)
)->>'outcome', 'verified', 'synthetic service fixture verifies the explicit account path');

-- Ingress must reject both a NULL JWT role and an authenticated caller for another account.
set local role authenticated;
set local request.jwt.claim.role = '';
set local request.jwt.claims = '{}';
select ok(not private.stream_media_account_ingress_allowed('c3100000-0000-0000-0000-000000000004'),
  'NULL auth.role cannot bypass both ingress role checks');
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000002","role":"authenticated"}';
select ok(not private.stream_media_account_ingress_allowed('c3100000-0000-0000-0000-000000000004'),
  'authenticated ingress cannot target a different account UUID');
reset role;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';

-- The helper exercises the real pre-HTTP intent, parent fence, operation, exact-UID readback,
-- provisional binding, and source-finalization RPC sequence with synthetic provider evidence.
reset role;
create function pg_temp.make_ready_stream_test_video(
  target_video_id uuid, target_owner_id uuid, target_uid text, target_registry_id uuid,
  target_parent_revision bigint,target_source_kind text default 'video',
  target_parent_kind text default 'profile',target_parent_identity text default null
) returns jsonb language plpgsql as $test$
declare
  intent_id uuid := gen_random_uuid();
  intent_request uuid := gen_random_uuid();
  context_request uuid := gen_random_uuid();
  operation_id uuid := gen_random_uuid();
  operation_request uuid := gen_random_uuid();
  transition_request uuid := gen_random_uuid();
  create_request uuid := gen_random_uuid();
  observation_request uuid := gen_random_uuid();
  binding_request uuid := gen_random_uuid();
  finalize_request uuid := gen_random_uuid();
  marker_id uuid := gen_random_uuid();
  source_purpose text;
  parent_identity text;
  binding_id uuid;
  binding_replay jsonb;
  result jsonb;
begin
  if target_source_kind not in ('video','post_media') then
    return jsonb_build_object('outcome','fixture_failed','phase','source_kind','detail','unsupported');
  end if;
  source_purpose := case when target_source_kind='video' then 'library_video' else 'community_video' end;
  parent_identity := coalesce(target_parent_identity,target_owner_id::text);
  result := public.record_stream_media_upload_intent(
    intent_id,intent_request,target_owner_id,source_purpose,target_source_kind,target_video_id,
    0,target_registry_id,marker_id,repeat('3',64));
  if result->>'outcome'<>'recorded' then return jsonb_build_object('outcome','fixture_failed','phase','intent','detail',result->>'outcome'); end if;
  result := public.record_stream_upload_context(
    context_request,intent_id,target_parent_kind,parent_identity,target_owner_id,
    target_parent_revision,repeat('4',64));
  if result->>'outcome'<>'context_recorded' then return jsonb_build_object('outcome','fixture_failed','phase','context','detail',result->>'outcome'); end if;
  result := public.reserve_stream_media_upload(operation_id,operation_request,intent_id,repeat('5',64));
  if result->>'outcome'<>'reserved' then return jsonb_build_object('outcome','fixture_failed','phase','reserve','detail',result->>'outcome'); end if;
  result := public.advance_stream_media_upload(operation_id,gen_random_uuid(),'create_started',repeat('6',64));
  if result->>'outcome'<>'advanced' then return jsonb_build_object('outcome','fixture_failed','phase','create_started','detail',result->>'outcome'); end if;
  result := public.advance_stream_media_upload(operation_id,transition_request,'created_unverified',repeat('7',64));
  if result->>'outcome'<>'advanced' then return jsonb_build_object('outcome','fixture_failed','phase','created_unverified','detail',result->>'outcome'); end if;
  result := public.record_stream_media_upload_observation(
    operation_id,target_registry_id,'exact_uid_get',target_uid,200::smallint,true,true,true,true,
    observation_request,repeat('8',64));
  if result->>'outcome'<>'recorded' then return jsonb_build_object('outcome','fixture_failed','phase','observation','detail',result->>'outcome'); end if;
  result := public.bind_stream_media_upload_readback(operation_id,observation_request,binding_request);
  if result->>'outcome'<>'provisional_bound' then return jsonb_build_object('outcome','fixture_failed','phase','binding','detail',result->>'outcome'); end if;
  binding_id := (result->>'binding_id')::uuid;
  binding_replay := public.bind_stream_media_upload_readback(operation_id,observation_request,gen_random_uuid());
  if binding_replay->>'outcome'<>'already_bound' then
    return jsonb_build_object('outcome','fixture_failed','phase','binding_replay','detail',binding_replay->>'outcome'); end if;
  perform set_config('app.stream_media_operation_id',operation_id::text,true);
  if target_source_kind='video' then
    insert into public.videos (
      id,coach_id,cloudflare_uid,title,description,status,visibility,stream_provider_account_registry_id
    ) values (target_video_id,target_owner_id,target_uid,'Synthetic Gate 3 video','',
      'uploading','private',target_registry_id);
  else
    insert into public.post_media(id,post_id,kind,video_uid,position)
    values (target_video_id,target_parent_identity::uuid,'video',target_uid,0);
  end if;
  result := public.finalize_stream_media_upload(operation_id,finalize_request,repeat('9',64));
  perform set_config('app.stream_media_operation_id','',true);
  perform set_config('app.stream_media_legacy_resolution_event_id','',true);
  perform set_config('test.g3_upload_operation_id',operation_id::text,true);
  perform set_config('test.g3_upload_finalize_request',finalize_request::text,true);
  perform set_config('test.g3_upload_observation_request',observation_request::text,true);
  perform set_config('test.g3_upload_binding_id',binding_id::text,true);
  perform set_config('test.g3_upload_intent_id',intent_id::text,true);
  return result || jsonb_build_object('binding_replay_outcome',binding_replay->>'outcome');
end;
$test$;

-- This invoker-only fixture creates immutable history without changing current commerce state or
-- installing a Program conversion fence. The normal version, lesson, offer, and media triggers run.
create function pg_temp.make_unpublished_free_history(
  target_program_id uuid,target_day_id uuid,target_video_id uuid
)
returns table(created_content_version_id uuid,created_offer_version_id uuid)
language plpgsql
as $fixture$
declare
  v_program_owner uuid;
  v_platform_owned boolean;
  v_version_number integer;
  v_offer_number integer;
  v_content_version_id uuid;
  v_offer_version_id uuid;
  v_day public.program_days%rowtype;
  v_video public.videos%rowtype;
begin
  select program.coach_id,program.platform_owned into v_program_owner,v_platform_owned
  from public.programs program where program.id=target_program_id;
  if not found then raise exception 'Historical fixture Program is missing'; end if;
  select day.* into v_day from public.program_days day
  where day.id=target_day_id and day.program_id=target_program_id;
  if not found or v_day.video_id is distinct from target_video_id then
    raise exception 'Historical fixture day does not reference the requested video';
  end if;
  select video.* into v_video from public.videos video
  where video.id=target_video_id and video.status='ready';
  if not found or v_video.coach_id is distinct from v_program_owner
    or v_video.cloudflare_uid is null then
    raise exception 'Historical fixture video is not a ready Program-owner video';
  end if;

  select coalesce(max(version.revision_number),0)+1 into v_version_number
  from public.program_content_versions version where version.program_id=target_program_id;
  insert into public.program_content_versions(
    program_id,revision_number,revision_kind,lesson_count,created_by
  ) values(target_program_id,v_version_number,'free_snapshot',1,v_program_owner)
  returning id into v_content_version_id;
  insert into public.program_content_version_lessons(
    program_id,content_version_id,lesson_ordinal,timeline_day_number,source_day_id,
    title,instructions,pillar,video_id,video_creator_id,cloudflare_uid,cloudflare_signed_urls_verified
  ) values(
    target_program_id,v_content_version_id,1,v_day.day_number,v_day.id,
    v_day.title,v_day.instructions,v_day.pillar,v_video.id,v_video.coach_id,v_video.cloudflare_uid,false
  );

  select coalesce(max(offer.offer_number),0)+1 into v_offer_number
  from public.program_offer_versions offer where offer.program_id=target_program_id;
  insert into public.program_offer_versions(
    program_id,offer_number,content_version_id,offer_kind,list_price_cents,currency,max_installments,
    platform_owned,seller_profile_id,connected_account_id,created_by
  ) values(
    target_program_id,v_offer_number,v_content_version_id,'free',0,'usd',1,
    v_platform_owned,v_program_owner,null,v_program_owner
  ) returning id into v_offer_version_id;

  return query select v_content_version_id,v_offer_version_id;
end;
$fixture$;

-- Direct Program and Daily provider uploads are not supported by a working source producer.
-- Owners/admins continue to attach already verified Library assets through guarded writers.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.record_stream_media_upload_intent(
  'c3a00000-0000-0000-0000-000000000001','c3a00000-0000-0000-0000-000000000011',
  'c3100000-0000-0000-0000-000000000010','program_lesson_video','program_lesson',
  'c3a10000-0000-0000-0000-000000000001',0,current_setting('test.g3_registry_id')::uuid,
  'c3a20000-0000-0000-0000-000000000001',repeat('a',64)
)->>'outcome','recorded','a Program direct-upload intent is accepted only as preflight evidence');
select is(public.record_stream_upload_context(
  'c3a00000-0000-0000-0000-000000000012','c3a00000-0000-0000-0000-000000000001',
  'program','c3700000-0000-0000-0000-000000000099','c3100000-0000-0000-0000-000000000004',
  1,repeat('b',64)
)->>'outcome','unsupported_direct_upload','admin-proxy Program context is rejected before any provider operation');
select is(public.record_stream_media_upload_intent(
  'c3a00000-0000-0000-0000-000000000002','c3a00000-0000-0000-0000-000000000021',
  'c3100000-0000-0000-0000-000000000010','program_intro_video','program_intro',
  'c3a10000-0000-0000-0000-000000000002',0,current_setting('test.g3_registry_id')::uuid,
  'c3a20000-0000-0000-0000-000000000002',repeat('c',64)
)->>'outcome','recorded','a Program intro intent is captured before the unsupported context is rejected');
select is(public.record_stream_upload_context(
  'c3a00000-0000-0000-0000-000000000022','c3a00000-0000-0000-0000-000000000002',
  'program','c3700000-0000-0000-0000-000000000098','c3100000-0000-0000-0000-000000000004',
  1,repeat('d',64)
)->>'outcome','unsupported_direct_upload','Program intro direct context is rejected before provider work');
select is(public.record_stream_media_upload_intent(
  'c3a00000-0000-0000-0000-000000000003','c3a00000-0000-0000-0000-000000000031',
  'c3100000-0000-0000-0000-000000000010','daily_content_video','daily_content_revision',
  'c3a10000-0000-0000-0000-000000000003',0,current_setting('test.g3_registry_id')::uuid,
  'c3a20000-0000-0000-0000-000000000003',repeat('e',64)
)->>'outcome','recorded','a Daily direct-upload intent is captured before the unsupported context is rejected');
select is(public.record_stream_upload_context(
  'c3a00000-0000-0000-0000-000000000032','c3a00000-0000-0000-0000-000000000003',
  'daily_content_item','c3720000-0000-0000-0000-000000000099','c3100000-0000-0000-0000-000000000004',
  1,repeat('f',64)
)->>'outcome','unsupported_direct_upload','Daily direct context is rejected before provider work');
reset role;
insert into public.stream_media_upload_contexts(
  intent_id,parent_kind,parent_identity,owner_id,source_revision,context_digest,request_id
) values
  ('c3a00000-0000-0000-0000-000000000001','program','c3700000-0000-0000-0000-000000000099',
   'c3100000-0000-0000-0000-000000000004',1,repeat('b',64),'c3a00000-0000-0000-0000-000000000013'),
  ('c3a00000-0000-0000-0000-000000000002','program','c3700000-0000-0000-0000-000000000098',
   'c3100000-0000-0000-0000-000000000004',1,repeat('d',64),'c3a00000-0000-0000-0000-000000000023'),
  ('c3a00000-0000-0000-0000-000000000003','daily_content_item','c3720000-0000-0000-0000-000000000099',
   'c3100000-0000-0000-0000-000000000004',1,repeat('f',64),'c3a00000-0000-0000-0000-000000000033');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.reserve_stream_media_upload(
  'c3a30000-0000-0000-0000-000000000001','c3a30000-0000-0000-0000-000000000011',
  'c3a00000-0000-0000-0000-000000000001',repeat('1',64)
)->>'outcome','unsupported_direct_upload','reserve repeats the gate for a historical Program context');
select is(public.reserve_stream_media_upload(
  'c3a30000-0000-0000-0000-000000000002','c3a30000-0000-0000-0000-000000000021',
  'c3a00000-0000-0000-0000-000000000002',repeat('2',64)
)->>'outcome','unsupported_direct_upload','reserve repeats the gate for a historical Program intro context');
select is(public.reserve_stream_media_upload(
  'c3a30000-0000-0000-0000-000000000003','c3a30000-0000-0000-0000-000000000031',
  'c3a00000-0000-0000-0000-000000000003',repeat('3',64)
)->>'outcome','unsupported_direct_upload','reserve repeats the gate for a historical Daily context');
reset role;
select ok(not exists(select 1 from public.stream_media_operations operation
  where operation.id in ('c3a30000-0000-0000-0000-000000000001',
    'c3a30000-0000-0000-0000-000000000002','c3a30000-0000-0000-0000-000000000003')),
  'unsupported direct contexts never create provider operations');

-- Community videos use the supported owner-owned post_media pipeline and receive the same
-- atomic source-owner/asset-owner account edges as private Library videos. The schema forbids
-- mixing photo and video rows on one post, so seed the neighboring cleanup photo on its own
-- same-owner post and add its media row as the authenticated owner in a later statement.
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000004","role":"authenticated"}';
reset role;
insert into public.posts(id,author_id,kind,body,audience)
values ('c3a40000-0000-0000-0000-000000000001','c3100000-0000-0000-0000-000000000004',
  'general','','only_me');
insert into public.posts(id,author_id,kind,body,audience)
values ('c3a40000-0000-0000-0000-000000000002','c3100000-0000-0000-0000-000000000004',
  'general','','only_me');
set local role authenticated;
insert into public.post_media(id,post_id,kind,path,position)
values ('c3a50000-0000-0000-0000-000000000002','c3a40000-0000-0000-0000-000000000002',
  'photo','c3100000-0000-0000-0000-000000000004/post-cleanup-image.jpg',1);
reset role;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('test.g3_post_upload_result',pg_temp.make_ready_stream_test_video(
  'c3a50000-0000-0000-0000-000000000001','c3100000-0000-0000-0000-000000000004',
  'stream-g3-post-media-uid',current_setting('test.g3_registry_id')::uuid,1,
  'post_media','post','c3a40000-0000-0000-0000-000000000001'
)::text,true);
select is(current_setting('test.g3_post_upload_result')::jsonb->>'outcome',
  'ready_for_publication','the owner-owned post_media pipeline completes exact readback finalization');
select is(current_setting('test.g3_post_upload_result')::jsonb->>'binding_replay_outcome',
  'already_bound','post_media binding replay remains idempotent');
reset role;
select ok(exists(
  select 1 from public.stream_media_source_bindings binding
  where binding.id=current_setting('test.g3_upload_binding_id')::uuid
    and binding.source_kind='post_media'
    and exists(select 1 from public.stream_media_source_account_edges edge
      where edge.binding_id=binding.id and edge.account_id='c3100000-0000-0000-0000-000000000004'
        and edge.relation_kind='source_owner')
    and exists(select 1 from public.stream_media_source_account_edges edge
      where edge.binding_id=binding.id and edge.account_id='c3100000-0000-0000-0000-000000000004'
        and edge.relation_kind='asset_owner')
), 'post_media binding creation records exact owner account edges before cleanup inventory');
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000004","role":"authenticated"}';
select set_config('app.stream_media_operation_id','',true);
select throws_ok($$delete from public.post_media where id='c3a50000-0000-0000-0000-000000000001'$$,
  '55000',null,'an owner cannot locally delete a video post_media row without durable cleanup authorization');
reset role;
select ok((select binding.binding_state='ready_for_publication'
  from public.stream_media_source_bindings binding
  where binding.id=current_setting('test.g3_upload_binding_id')::uuid),
  'a rejected local delete leaves its exact video binding unchanged');
select ok(exists(select 1 from public.post_media media
  where media.id='c3a50000-0000-0000-0000-000000000001')
  and exists(select 1 from public.post_media media
    where media.id='c3a50000-0000-0000-0000-000000000002' and media.kind='photo')
  and not exists(select 1 from public.stream_media_operations operation
    where operation.operation_kind='source_mutation' and operation.parent_kind='post'
      and operation.parent_identity='c3a40000-0000-0000-0000-000000000001'),
  'the rejected local video delete leaves its video, neighboring photo, and mutation ledger unchanged');
select set_config('test.g3_post_cleanup_revision',(
  select fence.source_revision::text from public.stream_media_parent_fences fence
  where fence.source_kind='post' and fence.source_identity='c3a40000-0000-0000-0000-000000000001'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.reserve_stream_media_cleanup(
  'c3a51000-0000-0000-0000-000000000001','c3a51000-0000-0000-0000-000000000002',
  'post','c3a40000-0000-0000-0000-000000000001','c3100000-0000-0000-0000-000000000004',
  current_setting('test.g3_post_cleanup_revision')::bigint,repeat('a',64)
)->>'outcome','reserved','the service reserves the exact parent post cleanup manifest');
select is(public.start_stream_media_uid_delete(
  'c3a51000-0000-0000-0000-000000000001',current_setting('test.g3_registry_id')::uuid,
  'stream-g3-post-media-uid','c3a51000-0000-0000-0000-000000000003',repeat('b',64)
)->>'outcome','delete_started','parent cleanup starts deletion for the exact video post_media UID');
select is(public.record_stream_media_uid_delete_result(
  'c3a51000-0000-0000-0000-000000000001',current_setting('test.g3_registry_id')::uuid,
  'stream-g3-post-media-uid','deleted_confirmed',204::smallint,404::smallint,
  'c3a51000-0000-0000-0000-000000000004',repeat('c',64)
)->>'outcome','recorded','parent cleanup records exact DELETE and GET absence evidence');
select is(public.finalize_stream_media_cleanup(
  'c3a51000-0000-0000-0000-000000000001','c3a51000-0000-0000-0000-000000000005',repeat('d',64)
)->>'outcome','completed','the exact parent cleanup can delete its post_media source under its manifest');
reset role;
select ok(not exists(select 1 from public.post_media media
  where media.id='c3a50000-0000-0000-0000-000000000001')
  and (select binding.binding_state='detached'
    from public.stream_media_source_bindings binding
    where binding.id=current_setting('test.g3_upload_binding_id')::uuid),
  'parent cleanup removes the row and preserves its detached media evidence');
select ok(private.stream_upload_cleanup_proven(
  current_setting('test.g3_upload_intent_id')::uuid,'c3100000-0000-0000-0000-000000000004'),
  'exact post cleanup manifest and terminal result prove the post_media upload is drained');

-- This fresh private Library upload is not passed through the legacy resolver. Its exact bind
-- edges alone must make it visible to owner account-cleanup inventory.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('test.g3_no_legacy_upload_result',pg_temp.make_ready_stream_test_video(
  'c3200000-0000-0000-0000-000000000010','c3100000-0000-0000-0000-000000000008',
  'stream-g3-no-legacy-uid',current_setting('test.g3_registry_id')::uuid,1
)::text,true);
select is(current_setting('test.g3_no_legacy_upload_result')::jsonb->>'outcome',
  'ready_for_publication','a fresh Library upload is ready without legacy inventory capture');
select is(current_setting('test.g3_no_legacy_upload_result')::jsonb->>'binding_replay_outcome',
  'already_bound','the fresh Library readback binding replays idempotently');
reset role;
select ok(exists(
  select 1 from public.stream_media_source_bindings binding
  join public.stream_media_assets asset on asset.id=binding.asset_id
    and asset.upload_intent_id=current_setting('test.g3_upload_intent_id')::uuid
  where binding.id=current_setting('test.g3_upload_binding_id')::uuid
    and binding.source_kind='video' and binding.source_identity='c3200000-0000-0000-0000-000000000010'
    and binding.registry_id=current_setting('test.g3_registry_id')::uuid
    and binding.raw_provider_uid='stream-g3-no-legacy-uid'
    and exists(select 1 from public.stream_media_source_account_edges edge
      where edge.binding_id=binding.id and edge.account_id='c3100000-0000-0000-0000-000000000008'
        and edge.relation_kind='source_owner')
    and exists(select 1 from public.stream_media_source_account_edges edge
      where edge.binding_id=binding.id and edge.account_id='c3100000-0000-0000-0000-000000000008'
        and edge.relation_kind='asset_owner')
), 'private Library readback atomically records the current exact source-owner and asset-owner edges');
select throws_ok($$delete from public.stream_media_source_account_edges
  where binding_id=current_setting('test.g3_upload_binding_id')::uuid
    and account_id='c3100000-0000-0000-0000-000000000008' and relation_kind='source_owner'$$,
  '55000',null,'bound source-account edges cannot be removed to hide an upload from account inventory');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.begin_stream_account_media_cleanup(
  'c3a60000-0000-0000-0000-000000000001','c3100000-0000-0000-0000-000000000008',
  'c3a60000-0000-0000-0000-000000000002',repeat('a',64),
  'c3a60000-0000-0000-0000-000000000003',repeat('b',64)
)->>'outcome','reserved','account cleanup inventories the fresh private upload without a legacy resolver');
reset role;
select ok(exists(
  select 1 from public.stream_media_operations operation
  join public.stream_media_manifest_edges manifest on manifest.operation_id=operation.id
  join public.stream_media_source_bindings binding on binding.id=manifest.binding_id
  where operation.id='c3a60000-0000-0000-0000-000000000003'
    and operation.operation_kind='account_cleanup'
    and binding.id=current_setting('test.g3_upload_binding_id')::uuid
    and manifest.registry_id=current_setting('test.g3_registry_id')::uuid
    and manifest.raw_provider_uid='stream-g3-no-legacy-uid'
), 'the exact just-bound Library UID is present in the owner cleanup manifest');

-- An ordinary owner deletion may detach this private Library binding only after an exact
-- terminal provider result and finalization receipt. Account inventory then drains that upload.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('test.g3_terminal_upload_result',pg_temp.make_ready_stream_test_video(
  'c3200000-0000-0000-0000-000000000012','c3100000-0000-0000-0000-000000000009',
  'stream-g3-terminal-cleanup-uid',current_setting('test.g3_registry_id')::uuid,1
)::text,true);
select is(current_setting('test.g3_terminal_upload_result')::jsonb->>'outcome',
  'ready_for_publication','the terminal-cleanup fixture begins as a verified private Library upload');
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000009","role":"authenticated"}';
select ok(public.reserve_daily_content_video_delete('c3200000-0000-0000-0000-000000000012'),
  'the matching Library owner reserves ordinary video cleanup');
select set_config('test.g3_terminal_cleanup_op',current_setting('app.stream_media_operation_id'),true);
select set_config('app.stream_media_operation_id','',true);
reset role;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.start_stream_media_uid_delete(
  current_setting('test.g3_terminal_cleanup_op')::uuid,current_setting('test.g3_registry_id')::uuid,
  'stream-g3-terminal-cleanup-uid','c3a70000-0000-0000-0000-000000000001',repeat('c',64)
)->>'outcome','delete_started','the owner cleanup starts deletion for the exact reserved UID');
select is(public.record_stream_media_uid_delete_result(
  current_setting('test.g3_terminal_cleanup_op')::uuid,current_setting('test.g3_registry_id')::uuid,
  'stream-g3-terminal-cleanup-uid','deleted_confirmed',204::smallint,404::smallint,
  'c3a70000-0000-0000-0000-000000000002',repeat('d',64)
)->>'outcome','recorded','exact DELETE success plus exact GET absence creates durable terminal evidence');
select is(public.finalize_stream_media_cleanup(
  current_setting('test.g3_terminal_cleanup_op')::uuid,'c3a70000-0000-0000-0000-000000000003',repeat('e',64)
)->>'outcome','completed','ordinary Library cleanup detaches only after terminal UID proof');
reset role;
select ok((select binding.binding_state='detached'
  from public.stream_media_source_bindings binding
  where binding.id=current_setting('test.g3_upload_binding_id')::uuid),
  'ordinary cleanup leaves the exact upload binding detached');
select ok(private.stream_upload_cleanup_proven(
  current_setting('test.g3_upload_intent_id')::uuid,'c3100000-0000-0000-0000-000000000009'),
  'the exact manifest, UID event, binding detach, and completed receipt prove upload cleanup');
select ok(not private.stream_upload_cleanup_proven(
  current_setting('test.g3_upload_intent_id')::uuid,'c3100000-0000-0000-0000-000000000008'),
  'terminal proof is bound to the actual source and asset owner');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.begin_stream_account_media_cleanup(
  'c3a80000-0000-0000-0000-000000000001','c3100000-0000-0000-0000-000000000009',
  'c3a80000-0000-0000-0000-000000000002',repeat('a',64),
  'c3a80000-0000-0000-0000-000000000003',repeat('b',64)
)->>'outcome','reserved','owner account cleanup drains a completed upload only with exact ordinary-cleanup proof');
reset role;
select is((select count(*)::integer from public.stream_media_manifest_edges edge
  where edge.operation_id='c3a80000-0000-0000-0000-000000000003'),0,
  'a previously detached and exactly deleted upload contributes no UID to the new account manifest');

-- A failed local request after the provider call may have started stays unresolved. Account
-- inventory must continue to see it even after a caller attempts the old unsafe transition.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.record_stream_media_upload_intent(
  'c3900000-0000-0000-0000-000000000001','c3900000-0000-0000-0000-000000000002',
  'c3100000-0000-0000-0000-000000000005','library_video','video',
  'c3200000-0000-0000-0000-000000000099',0,current_setting('test.g3_registry_id')::uuid,
  'c3910000-0000-0000-0000-000000000001',repeat('3',64)
)->>'outcome','recorded','the unresolved upload fixture records its intent before any provider call');
select is(public.record_stream_upload_context(
  'c3900000-0000-0000-0000-000000000003','c3900000-0000-0000-0000-000000000001',
  'profile','c3100000-0000-0000-0000-000000000005','c3100000-0000-0000-0000-000000000005',1,repeat('4',64)
)->>'outcome','context_recorded','the unresolved upload fixture captures its exact owner context');
select is(public.reserve_stream_media_upload(
  'c3900000-0000-0000-0000-000000000004','c3900000-0000-0000-0000-000000000005',
  'c3900000-0000-0000-0000-000000000001',repeat('5',64)
)->>'outcome','reserved','the unresolved upload fixture reserves before provider work');
select is(public.advance_stream_media_upload(
  'c3900000-0000-0000-0000-000000000004','c3900000-0000-0000-0000-000000000006',
  'create_started',repeat('6',64)
)->>'outcome','advanced','the unresolved upload fixture records that provider work may start');
select is(public.advance_stream_media_upload(
  'c3900000-0000-0000-0000-000000000004','c3900000-0000-0000-0000-000000000007',
  'failed',repeat('7',64)
)->>'outcome','reconciliation_required','a started provider create cannot be hidden as failed');
reset role;
select ok(exists(
  select 1 from public.stream_media_operations operation
  join public.stream_media_operation_states state on state.operation_id=operation.id
  join public.stream_media_parent_fences fence
    on fence.source_kind=operation.parent_kind and fence.source_identity=operation.parent_identity
  where operation.id='c3900000-0000-0000-0000-000000000004'
    and state.operation_state='create_started'
    and fence.owner_id=operation.owner_id and fence.source_revision=operation.expected_source_revision
    and fence.fence_state='closing' and fence.active_operation_id=operation.id
), 'a failed transition after create_started leaves its parent fence closing');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.advance_stream_media_upload(
  'c3900000-0000-0000-0000-000000000004','c3900000-0000-0000-0000-000000000008',
  'create_unknown',repeat('8',64)
)->>'outcome','advanced','a lost create response remains explicitly unknown');
select is(public.advance_stream_media_upload(
  'c3900000-0000-0000-0000-000000000004','c3900000-0000-0000-0000-000000000009',
  'failed',repeat('9',64)
)->>'outcome','reconciliation_required','an unknown create cannot be hidden as failed');
reset role;
select ok(exists(
  select 1 from public.stream_media_operations operation
  join public.stream_media_operation_states state on state.operation_id=operation.id
  join public.stream_media_parent_fences fence
    on fence.source_kind=operation.parent_kind and fence.source_identity=operation.parent_identity
  where operation.id='c3900000-0000-0000-0000-000000000004'
    and state.operation_state='create_unknown'
    and fence.owner_id=operation.owner_id and fence.source_revision=operation.expected_source_revision
    and fence.fence_state='closing' and fence.active_operation_id=operation.id
), 'a failed transition after create_unknown leaves its parent fence closing');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.record_stream_media_upload_intent(
  'c3900000-0000-0000-0000-000000000010','c3900000-0000-0000-0000-000000000011',
  'c3100000-0000-0000-0000-000000000006','library_video','video',
  'c3200000-0000-0000-0000-000000000098',0,current_setting('test.g3_registry_id')::uuid,
  'c3910000-0000-0000-0000-000000000002',repeat('a',64)
)->>'outcome','recorded','the pre-HTTP failure control records its own upload intent');
select is(public.record_stream_upload_context(
  'c3900000-0000-0000-0000-000000000012','c3900000-0000-0000-0000-000000000010',
  'profile','c3100000-0000-0000-0000-000000000006','c3100000-0000-0000-0000-000000000006',1,repeat('b',64)
)->>'outcome','context_recorded','the pre-HTTP failure control captures owner context');
select is(public.reserve_stream_media_upload(
  'c3900000-0000-0000-0000-000000000013','c3900000-0000-0000-0000-000000000014',
  'c3900000-0000-0000-0000-000000000010',repeat('c',64)
)->>'outcome','reserved','the pre-HTTP failure control reserves before external work');
select is(public.advance_stream_media_upload(
  'c3900000-0000-0000-0000-000000000013','c3900000-0000-0000-0000-000000000015',
  'failed',repeat('d',64)
)->>'outcome','advanced','a pre-HTTP reservation can safely reach terminal failure');
reset role;
select ok(not exists(select 1 from public.stream_media_operation_states state
  where state.operation_id='c3900000-0000-0000-0000-000000000013'
    and state.operation_state in ('reserved','create_started','create_unknown','created_unverified')),
  'failed pre-HTTP uploads do not remain unresolved for account inventory');
select ok(exists(
  select 1 from public.stream_media_operations operation
  join public.stream_media_operation_states state on state.operation_id=operation.id
  join public.stream_media_parent_fences fence
    on fence.source_kind=operation.parent_kind and fence.source_identity=operation.parent_identity
  where operation.id='c3900000-0000-0000-0000-000000000013'
    and state.operation_state='failed'
    and fence.owner_id=operation.owner_id and fence.source_revision=operation.expected_source_revision
    and fence.fence_state='open' and fence.active_operation_id is null
), 'a reserved pre-HTTP failure releases only its own parent fence without advancing source revision');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.record_stream_media_upload_intent(
  'c3900000-0000-0000-0000-000000000016','c3900000-0000-0000-0000-000000000017',
  'c3100000-0000-0000-0000-000000000006','library_video','video',
  'c3200000-0000-0000-0000-000000000097',0,current_setting('test.g3_registry_id')::uuid,
  'c3910000-0000-0000-0000-000000000010',repeat('e',64)
)->>'outcome','recorded','a fresh retry records a new upload intent for the same parent');
select is(public.record_stream_upload_context(
  'c3900000-0000-0000-0000-000000000018','c3900000-0000-0000-0000-000000000016',
  'profile','c3100000-0000-0000-0000-000000000006','c3100000-0000-0000-0000-000000000006',1,repeat('f',64)
)->>'outcome','context_recorded','the same parent accepts a fresh context after pre-HTTP failure');
select is(public.reserve_stream_media_upload(
  'c3900000-0000-0000-0000-000000000019','c3900000-0000-0000-0000-000000000020',
  'c3900000-0000-0000-0000-000000000016',repeat('1',64)
)->>'outcome','reserved','the same parent accepts a new reservation after pre-HTTP failure');
reset role;
select set_config('test.g3_retry_fence_revision',(
  select fence.source_revision::text from public.stream_media_parent_fences fence
  where fence.source_kind='profile' and fence.source_identity='c3100000-0000-0000-0000-000000000006'),true);
select set_config('test.g3_retry_fence_state_revision',(
  select fence.state_revision::text from public.stream_media_parent_fences fence
  where fence.source_kind='profile' and fence.source_identity='c3100000-0000-0000-0000-000000000006'),true);
select set_config('test.g3_retry_operation_state_revision',(
  select state.state_revision::text from public.stream_media_operation_states state
  where state.operation_id='c3900000-0000-0000-0000-000000000019'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.advance_stream_media_upload(
  'c3900000-0000-0000-0000-000000000013','c3900000-0000-0000-0000-000000000015',
  'failed',repeat('d',64)
)->>'outcome','already_recorded','an exact old failure replay is idempotent after a newer reservation');
reset role;
select ok(exists(
  select 1 from public.stream_media_operations operation
  join public.stream_media_operation_states state on state.operation_id=operation.id
  join public.stream_media_parent_fences fence
    on fence.source_kind=operation.parent_kind and fence.source_identity=operation.parent_identity
  where operation.id='c3900000-0000-0000-0000-000000000019'
    and state.operation_state='reserved'
    and state.state_revision=current_setting('test.g3_retry_operation_state_revision')::bigint
    and fence.owner_id=operation.owner_id
    and fence.source_revision=current_setting('test.g3_retry_fence_revision')::bigint
    and fence.state_revision=current_setting('test.g3_retry_fence_state_revision')::bigint
    and fence.fence_state='closing' and fence.active_operation_id=operation.id
), 'replaying the old failure leaves the newer reservation and its closing fence unchanged');

-- Owner-only fence corruption exercises typed mismatch returns; each failed transition leaves
-- the operation and the deliberately mismatched fence exactly as the fixture set them.
update public.stream_media_parent_fences set owner_id='c3100000-0000-0000-0000-000000000005'
where source_kind='profile' and source_identity='c3100000-0000-0000-0000-000000000006';
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.advance_stream_media_upload(
  'c3900000-0000-0000-0000-000000000019','c3900000-0000-0000-0000-000000000021',
  'failed',repeat('2',64)
)->>'outcome','parent_fence_mismatch','failure refuses a parent fence owned by another account');
reset role;
select ok(exists(
  select 1 from public.stream_media_operations operation
  join public.stream_media_operation_states state on state.operation_id=operation.id
  join public.stream_media_parent_fences fence
    on fence.source_kind=operation.parent_kind and fence.source_identity=operation.parent_identity
  where operation.id='c3900000-0000-0000-0000-000000000019'
    and state.operation_state='reserved'
    and state.state_revision=current_setting('test.g3_retry_operation_state_revision')::bigint
    and fence.owner_id='c3100000-0000-0000-0000-000000000005'
    and fence.source_revision=current_setting('test.g3_retry_fence_revision')::bigint
    and fence.state_revision=current_setting('test.g3_retry_fence_state_revision')::bigint
    and fence.fence_state='closing' and fence.active_operation_id=operation.id
    and not exists (select 1 from public.stream_media_operation_events event
      where event.operation_id=operation.id and event.request_id='c3900000-0000-0000-0000-000000000021')
), 'owner mismatch leaves both the reserved state and corrupted fence unchanged');
update public.stream_media_parent_fences set owner_id='c3100000-0000-0000-0000-000000000006'
where source_kind='profile' and source_identity='c3100000-0000-0000-0000-000000000006';

update public.stream_media_parent_fences set source_revision=source_revision+1
where source_kind='profile' and source_identity='c3100000-0000-0000-0000-000000000006';
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.advance_stream_media_upload(
  'c3900000-0000-0000-0000-000000000019','c3900000-0000-0000-0000-000000000022',
  'failed',repeat('3',64)
)->>'outcome','parent_fence_mismatch','failure refuses a parent fence at another source revision');
reset role;
select ok(exists(
  select 1 from public.stream_media_operations operation
  join public.stream_media_operation_states state on state.operation_id=operation.id
  join public.stream_media_parent_fences fence
    on fence.source_kind=operation.parent_kind and fence.source_identity=operation.parent_identity
  where operation.id='c3900000-0000-0000-0000-000000000019'
    and state.operation_state='reserved'
    and state.state_revision=current_setting('test.g3_retry_operation_state_revision')::bigint
    and fence.owner_id=operation.owner_id
    and fence.source_revision=current_setting('test.g3_retry_fence_revision')::bigint+1
    and fence.state_revision=current_setting('test.g3_retry_fence_state_revision')::bigint
    and fence.fence_state='closing' and fence.active_operation_id=operation.id
    and not exists (select 1 from public.stream_media_operation_events event
      where event.operation_id=operation.id and event.request_id='c3900000-0000-0000-0000-000000000022')
), 'revision mismatch leaves both the reserved state and corrupted fence unchanged');
update public.stream_media_parent_fences set source_revision=current_setting('test.g3_retry_fence_revision')::bigint
where source_kind='profile' and source_identity='c3100000-0000-0000-0000-000000000006';

update public.stream_media_parent_fences set active_operation_id='c3900000-0000-0000-0000-000000000099'
where source_kind='profile' and source_identity='c3100000-0000-0000-0000-000000000006';
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.advance_stream_media_upload(
  'c3900000-0000-0000-0000-000000000019','c3900000-0000-0000-0000-000000000023',
  'failed',repeat('4',64)
)->>'outcome','parent_fence_mismatch','failure refuses a parent fence assigned to another operation');
reset role;
select ok(exists(
  select 1 from public.stream_media_operations operation
  join public.stream_media_operation_states state on state.operation_id=operation.id
  join public.stream_media_parent_fences fence
    on fence.source_kind=operation.parent_kind and fence.source_identity=operation.parent_identity
  where operation.id='c3900000-0000-0000-0000-000000000019'
    and state.operation_state='reserved'
    and state.state_revision=current_setting('test.g3_retry_operation_state_revision')::bigint
    and fence.owner_id=operation.owner_id
    and fence.source_revision=current_setting('test.g3_retry_fence_revision')::bigint
    and fence.state_revision=current_setting('test.g3_retry_fence_state_revision')::bigint
    and fence.fence_state='closing'
    and fence.active_operation_id='c3900000-0000-0000-0000-000000000099'
    and not exists (select 1 from public.stream_media_operation_events event
      where event.operation_id=operation.id and event.request_id='c3900000-0000-0000-0000-000000000023')
), 'active-operation mismatch leaves both the reserved state and corrupted fence unchanged');
update public.stream_media_parent_fences set active_operation_id='c3900000-0000-0000-0000-000000000019'
where source_kind='profile' and source_identity='c3100000-0000-0000-0000-000000000006';
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.advance_stream_media_upload(
  'c3900000-0000-0000-0000-000000000019','c3900000-0000-0000-0000-000000000024',
  'failed',repeat('5',64)
)->>'outcome','advanced','the exact reserved retry can fail before external work');
reset role;
select ok(exists(
  select 1 from public.stream_media_operations operation
  join public.stream_media_operation_states state on state.operation_id=operation.id
  join public.stream_media_parent_fences fence
    on fence.source_kind=operation.parent_kind and fence.source_identity=operation.parent_identity
  where operation.id='c3900000-0000-0000-0000-000000000019'
    and state.operation_state='failed'
    and fence.owner_id=operation.owner_id
    and fence.source_revision=current_setting('test.g3_retry_fence_revision')::bigint
    and fence.state_revision=current_setting('test.g3_retry_fence_state_revision')::bigint+1
    and fence.fence_state='open' and fence.active_operation_id is null
), 'the retry failure reopens its exact parent while preserving source revision');

-- A separate owner with only a definitively failed pre-HTTP upload can proceed to account cleanup.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.record_stream_media_upload_intent(
  'c3900000-0000-0000-0000-000000000030','c3900000-0000-0000-0000-000000000031',
  'c3100000-0000-0000-0000-000000000007','library_video','video',
  'c3200000-0000-0000-0000-000000000096',0,current_setting('test.g3_registry_id')::uuid,
  'c3910000-0000-0000-0000-000000000011',repeat('6',64)
)->>'outcome','recorded','the failed-only account fixture records a pre-HTTP upload intent');
select is(public.record_stream_upload_context(
  'c3900000-0000-0000-0000-000000000032','c3900000-0000-0000-0000-000000000030',
  'profile','c3100000-0000-0000-0000-000000000007','c3100000-0000-0000-0000-000000000007',1,repeat('7',64)
)->>'outcome','context_recorded','the failed-only account fixture captures its owner context');
select is(public.reserve_stream_media_upload(
  'c3900000-0000-0000-0000-000000000033','c3900000-0000-0000-0000-000000000034',
  'c3900000-0000-0000-0000-000000000030',repeat('8',64)
)->>'outcome','reserved','the failed-only account fixture reserves before external work');
select is(public.advance_stream_media_upload(
  'c3900000-0000-0000-0000-000000000033','c3900000-0000-0000-0000-000000000035',
  'failed',repeat('9',64)
)->>'outcome','advanced','the failed-only account fixture terminates before external work');
select is(public.begin_stream_account_media_cleanup(
  'c3800000-0000-0000-0000-000000000008','c3100000-0000-0000-0000-000000000007',
  'c3820000-0000-0000-0000-000000000008',repeat('a',64),
  'c3810000-0000-0000-0000-000000000008',repeat('b',64)
)->>'outcome','reserved','account cleanup proceeds when its only upload attempt definitively failed before HTTP');
reset role;

set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.begin_stream_account_media_cleanup(
  'c3800000-0000-0000-0000-000000000009','c3100000-0000-0000-0000-000000000005',
  'c3820000-0000-0000-0000-000000000009',repeat('a',64),
  'c3810000-0000-0000-0000-000000000009',repeat('b',64)
)->>'outcome','upload_reconciliation_required',
  'account cleanup keeps a possibly created upload unresolved after a failed-transition attempt');
reset role;
select is((select state.operation_state from public.stream_media_operation_states state
  where state.operation_id='c3900000-0000-0000-0000-000000000004'),
  'create_unknown','the failed-transition attempts leave the durable upload state unknown');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.advance_stream_media_upload(
  'c3900000-0000-0000-0000-000000000004','c3900000-0000-0000-0000-000000000036',
  'created_unverified',repeat('a',64)
)->>'outcome','advanced','an unknown create can record an unverified provider result');
select is(public.advance_stream_media_upload(
  'c3900000-0000-0000-0000-000000000004','c3900000-0000-0000-0000-000000000037',
  'failed',repeat('b',64)
)->>'outcome','reconciliation_required','a created but unverified asset cannot be hidden as failed');
reset role;
select ok(exists(
  select 1 from public.stream_media_operations operation
  join public.stream_media_operation_states state on state.operation_id=operation.id
  join public.stream_media_parent_fences fence
    on fence.source_kind=operation.parent_kind and fence.source_identity=operation.parent_identity
  where operation.id='c3900000-0000-0000-0000-000000000004'
    and state.operation_state='created_unverified'
    and fence.owner_id=operation.owner_id and fence.source_revision=operation.expected_source_revision
    and fence.fence_state='closing' and fence.active_operation_id=operation.id
), 'a failed transition after created_unverified leaves its parent fence closing');

select set_config('test.g3_main_parent_revision',coalesce((
  select fence.source_revision::text from public.stream_media_parent_fences fence
  where fence.source_kind='profile' and fence.source_identity='c3100000-0000-0000-0000-000000000001'
),'1'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(pg_temp.make_ready_stream_test_video(
  'c3200000-0000-0000-0000-000000000001','c3100000-0000-0000-0000-000000000001',
  'stream-g3-main-uid',current_setting('test.g3_registry_id')::uuid,
  current_setting('test.g3_main_parent_revision')::bigint
)->>'outcome', 'ready_for_publication', 'the synthetic main video reaches ready only after exact UID readback and source finalization');
reset role;
select is((select binding.binding_state from public.stream_media_source_bindings binding
  where binding.source_kind='video' and binding.source_identity='c3200000-0000-0000-0000-000000000001'
  order by binding.created_at desc limit 1), 'ready_for_publication',
  'the owner library video has a separate ready source binding');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.finalize_stream_media_upload(
  current_setting('test.g3_upload_operation_id')::uuid,
  current_setting('test.g3_upload_finalize_request')::uuid,repeat('9',64)
)->>'outcome','ready_for_publication',
  'upload finalization replays the exact stored response after a lost success response');
select is(public.finalize_stream_media_upload(
  current_setting('test.g3_upload_operation_id')::uuid,
  current_setting('test.g3_upload_finalize_request')::uuid,repeat('0',64)
)->>'outcome','identity_mismatch','an upload finalization request cannot be replayed with a changed digest');
reset role;

-- Add one exact verified lesson with an active binding before the legacy inventory is captured.
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.programs(id,coach_id,title,description,published)
values ('c3700000-0000-0000-0000-000000000005','c3100000-0000-0000-0000-000000000001',
  'Legacy active binding control','',false);
reset role;
with inserted as (
  insert into public.program_content_versions(program_id,revision_number,revision_kind,lesson_count,created_by)
  values ('c3700000-0000-0000-0000-000000000005',(
    select coalesce(max(version.revision_number),0)+1
    from public.program_content_versions version
    where version.program_id='c3700000-0000-0000-0000-000000000005'
  ),'free_snapshot',1,'c3100000-0000-0000-0000-000000000001')
  returning id
)
select set_config('test.g3_legacy_active_version_id',inserted.id::text,true) from inserted;
with inserted as (
  insert into public.program_content_version_lessons(
    program_id,content_version_id,lesson_ordinal,timeline_day_number,source_day_id,
    title,instructions,pillar,video_id,video_creator_id,cloudflare_uid,cloudflare_signed_urls_verified
  )
  select 'c3700000-0000-0000-0000-000000000005',
    current_setting('test.g3_legacy_active_version_id')::uuid,1,1,null,
    'Legacy active lesson','','body',video.id,video.coach_id,video.cloudflare_uid,true
  from public.videos video where video.id='c3200000-0000-0000-0000-000000000001'
    and video.status='ready' and video.visibility='private'
  returning id
)
select set_config('test.g3_legacy_active_lesson_id',inserted.id::text,true) from inserted;

-- This frozen lesson keeps its older unsigned snapshot flag; exact legacy provider evidence
-- may still resolve its current asset without rewriting immutable lesson history.
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.programs(id,coach_id,title,description,published)
values ('c3700000-0000-0000-0000-000000000006','c3100000-0000-0000-0000-000000000001',
  'Legacy frozen source control','',false);
reset role;
with inserted as (
  insert into public.program_content_versions(program_id,revision_number,revision_kind,lesson_count,created_by)
  values ('c3700000-0000-0000-0000-000000000006',(
    select coalesce(max(version.revision_number),0)+1
    from public.program_content_versions version
    where version.program_id='c3700000-0000-0000-0000-000000000006'
  ),'free_snapshot',1,'c3100000-0000-0000-0000-000000000001')
  returning id
)
select set_config('test.g3_legacy_ready_version_id',inserted.id::text,true) from inserted;
with inserted as (
  insert into public.program_content_version_lessons(
    program_id,content_version_id,lesson_ordinal,timeline_day_number,source_day_id,
    title,instructions,pillar,video_id,video_creator_id,cloudflare_uid,cloudflare_signed_urls_verified
  )
  select 'c3700000-0000-0000-0000-000000000006',
    current_setting('test.g3_legacy_ready_version_id')::uuid,1,1,null,
    'Legacy frozen lesson','','body',video.id,video.coach_id,video.cloudflare_uid,false
  from public.videos video where video.id='c3200000-0000-0000-0000-000000000001'
    and video.status='ready' and video.visibility='private'
  returning id
)
select set_config('test.g3_legacy_ready_lesson_id',inserted.id::text,true) from inserted;
insert into public.stream_media_source_bindings(
  id,registry_id,raw_provider_uid,asset_id,source_kind,source_identity,parent_kind,parent_identity,
  source_revision,owner_id,binding_state,evidence_digest,created_at
)
select 'c3930000-0000-0000-0000-000000000003'::uuid,binding.registry_id,binding.raw_provider_uid,
  binding.asset_id,binding.source_kind,binding.source_identity,binding.parent_kind,binding.parent_identity,
  binding.source_revision+1,binding.owner_id,'legacy_unverified',repeat('3',64),clock_timestamp()
from public.stream_media_source_bindings binding
where binding.source_kind='program_lesson'
  and binding.source_identity=current_setting('test.g3_legacy_ready_lesson_id')
  and binding.binding_state='active'
order by binding.created_at desc limit 1;
insert into public.stream_media_source_binding_events(
  binding_id,event_kind,source_revision,request_id,evidence_digest
)
select binding.id,'attached',binding.source_revision,
  'c3940000-0000-0000-0000-000000000003',binding.evidence_digest
from public.stream_media_source_bindings binding
where binding.id='c3930000-0000-0000-0000-000000000003';
insert into public.stream_media_source_account_edges(binding_id,account_id,relation_kind)
values ('c3930000-0000-0000-0000-000000000003','c3100000-0000-0000-0000-000000000001','source_owner');

set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.capture_legacy_stream_media(
  'c3960000-0000-0000-0000-000000000010',repeat('c',64)
)->>'coverage','unguarded_incomplete','legacy capture keeps account ownership unknown until an exact reconciliation');
reset role;
select set_config('test.g3_legacy_observation_id',(
  select observation.id::text from public.stream_media_legacy_observations observation
  where observation.capture_run_id='c3960000-0000-0000-0000-000000000010'
    and observation.source_kind='videos'
    and observation.source_identity='c3200000-0000-0000-0000-000000000001'
    and observation.captured_uid='stream-g3-main-uid'
),true);
select set_config('test.g3_legacy_active_observation_id',(
  select observation.id::text from public.stream_media_legacy_observations observation
  where observation.capture_run_id='c3960000-0000-0000-0000-000000000010'
    and observation.source_kind='program_content_version_lessons'
    and observation.source_identity=current_setting('test.g3_legacy_active_lesson_id')
    and observation.captured_uid='stream-g3-main-uid'
),true);
select set_config('test.g3_legacy_ready_observation_id',(
  select observation.id::text from public.stream_media_legacy_observations observation
  where observation.capture_run_id='c3960000-0000-0000-0000-000000000010'
    and observation.source_kind='program_content_version_lessons'
    and observation.source_identity=current_setting('test.g3_legacy_ready_lesson_id')
    and observation.captured_uid='stream-g3-main-uid'
),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.resolve_legacy_stream_media_observation(
  current_setting('test.g3_legacy_observation_id')::uuid,
  current_setting('test.g3_registry_id')::uuid,
  'c3960000-0000-0000-0000-000000000011',200::smallint,true,true,repeat('d',64)
)->>'outcome','ready_for_publication',
  'legacy ownership is resolved only for the exact current video and verified account');
reset role;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.resolve_legacy_stream_media_observation(
  current_setting('test.g3_legacy_active_observation_id')::uuid,
  current_setting('test.g3_registry_id')::uuid,
  'c3960000-0000-0000-0000-000000000012',200::smallint,true,true,repeat('e',64)
)->>'outcome','active','legacy resolution preserves an existing active Program lesson binding');
reset role;
select ok(exists(
  select 1 from public.stream_media_source_bindings binding
  join public.stream_media_assets asset on asset.id=binding.asset_id
    and asset.registry_id=binding.registry_id and asset.raw_provider_uid=binding.raw_provider_uid
  where binding.source_kind='program_lesson'
    and binding.source_identity=current_setting('test.g3_legacy_active_lesson_id')
    and binding.registry_id=current_setting('test.g3_registry_id')::uuid
    and binding.raw_provider_uid='stream-g3-main-uid' and binding.binding_state='active'
    and asset.lifecycle_state='ready_for_publication'
    and asset.signed_urls_verified and asset.ready_to_stream_verified
), 'active legacy binding retains its exact verified asset in the ready lifecycle state');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.resolve_legacy_stream_media_observation(
  current_setting('test.g3_legacy_ready_observation_id')::uuid,
  current_setting('test.g3_registry_id')::uuid,
  'c3960000-0000-0000-0000-000000000013',200::smallint,true,true,repeat('f',64)
)->>'outcome','ready_for_publication',
  'exact legacy readback resolves the frozen lesson asset without rewriting its unsigned snapshot');
reset role;
select ok(exists(
  select 1 from public.stream_media_source_bindings binding
  join public.stream_media_assets asset on asset.id=binding.asset_id
    and asset.registry_id=binding.registry_id and asset.raw_provider_uid=binding.raw_provider_uid
  where binding.id='c3930000-0000-0000-0000-000000000003'
    and binding.binding_state='ready_for_publication'
    and asset.lifecycle_state='ready_for_publication'
    and asset.signed_urls_verified and asset.ready_to_stream_verified
    and not private.stream_upload_source_exists(binding.source_kind,binding.source_identity,
      binding.owner_id,binding.registry_id,binding.raw_provider_uid)
), 'ready frozen lesson remains account-cleanup eligible when its current mutable Library check is unavailable');
select ok(not private.stream_legacy_uid_unresolved(
  current_setting('test.g3_registry_id')::uuid,'stream-g3-main-uid'),
  'the exact append-only reconciliations resolve every captured main UID observation');
reset role;

-- Existing authenticated Program and Daily Fuel writer contracts remain usable. The title-only
-- edit is ordinary content work; the repeated assignment is the existing Fuel upsert path.
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.programs (id,coach_id,title,description,published)
values ('c3700000-0000-0000-0000-000000000001','c3100000-0000-0000-0000-000000000001','Gate 3 media Program','',false);
select set_config('test.g3_day_id', public.save_owned_program_day(
  'c3700000-0000-0000-0000-000000000001',null,1::smallint,'First title','First notes','body',
  'c3200000-0000-0000-0000-000000000001'
)::text,true);
reset role;
select is((select count(*)::integer from public.stream_media_source_bindings binding
  where binding.source_kind='program_day' and binding.source_identity=current_setting('test.g3_day_id')
    and binding.binding_state='active'),1,'the existing free Program day save RPC attaches a guarded source edge');
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.save_owned_program_day(
  'c3700000-0000-0000-0000-000000000001',current_setting('test.g3_day_id')::uuid,
  1::smallint,'Retitled day','Updated notes','mind','c3200000-0000-0000-0000-000000000001'
),current_setting('test.g3_day_id')::uuid,
  'title-only Program day edits preserve the existing media binding');
select set_config('test.g3_fuel_assignment', public.assign_member_daily_fuel_video(
  'c3100000-0000-0000-0000-000000000002','c3200000-0000-0000-0000-000000000001',
  private.current_daily_checkin_day()
)::text,true);
select is(public.assign_member_daily_fuel_video(
  'c3100000-0000-0000-0000-000000000002','c3200000-0000-0000-0000-000000000001',
  private.current_daily_checkin_day()
)::text,current_setting('test.g3_fuel_assignment'),
  'repeating the existing Daily Fuel upsert returns the same assignment identity');
reset role;
select is((select count(*)::integer from public.stream_media_source_bindings binding
  where binding.source_kind='daily_fuel_assignment'
    and binding.source_identity=current_setting('test.g3_fuel_assignment')
    and binding.binding_state='active'),1,'the Fuel upsert retains exactly one active guarded source edge');

-- Clearing a Program day reference creates a local, manifest-backed detach. It never calls the
-- provider or marks the UID deleted; Fuel and the library source still refer to the same asset.
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.save_owned_program_day(
  'c3700000-0000-0000-0000-000000000001',current_setting('test.g3_day_id')::uuid,
  1::smallint,'Retitled day','Updated notes','mind',null
),current_setting('test.g3_day_id')::uuid,'the existing Program day writer can detach its media reference');
select set_config('app.stream_media_operation_id','',true);
reset role;
select is((select binding.binding_state from public.stream_media_source_bindings binding
  where binding.source_kind='program_day' and binding.source_identity=current_setting('test.g3_day_id')
  order by binding.created_at desc limit 1),'detached','Program detach changes the local source binding state');
select is((select state.operation_state from public.stream_media_operations operation
  join public.stream_media_operation_states state on state.operation_id=operation.id
  where operation.operation_kind='source_mutation' and operation.source_kind='program_day'
    and operation.source_identity=current_setting('test.g3_day_id')
  order by operation.created_at desc limit 1),'completed','local detach completes its own source mutation operation');
select ok(not exists (
  select 1 from public.stream_media_operation_uid_events event
  join public.stream_media_operations operation on operation.id=event.operation_id
  where operation.operation_kind='source_mutation' and operation.source_kind='program_day'
    and operation.source_identity=current_setting('test.g3_day_id')
    and event.outcome in ('deleted_confirmed','already_absent_confirmed')
), 'local detach never manufactures a provider deletion result');

-- A sealed, unpublished lesson is history only. Its library video can reserve deletion, and a
-- later market activation or free pin must fail after that durable reservation has started.
select set_config('test.g3_retention_parent_revision',coalesce((
  select fence.source_revision::text from public.stream_media_parent_fences fence
  where fence.source_kind='profile' and fence.source_identity='c3100000-0000-0000-0000-000000000004'
),'1'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(pg_temp.make_ready_stream_test_video(
  'c3200000-0000-0000-0000-000000000007','c3100000-0000-0000-0000-000000000004',
  'stream-g3-unused-draft-uid',current_setting('test.g3_registry_id')::uuid,
  current_setting('test.g3_retention_parent_revision')::bigint
)->>'outcome','ready_for_publication','the unused-history fixture starts with a verified library video');
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000004","role":"authenticated"}';
insert into public.programs (id,coach_id,title,description,published)
values ('c3700000-0000-0000-0000-000000000003','c3100000-0000-0000-0000-000000000004','Unused sealed history','',false);
select set_config('test.g3_draft_day_id',public.save_owned_program_day(
  'c3700000-0000-0000-0000-000000000003',null,1::smallint,'Draft lesson','','body',
  'c3200000-0000-0000-0000-000000000007'
)::text,true);
reset role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('test.g3_draft_version_id',history.created_content_version_id::text,true),
  set_config('test.g3_draft_offer_id',history.created_offer_version_id::text,true)
from pg_temp.make_unpublished_free_history(
  'c3700000-0000-0000-0000-000000000003',current_setting('test.g3_draft_day_id')::uuid,
  'c3200000-0000-0000-0000-000000000007'
) history;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(public.save_owned_program_day(
  'c3700000-0000-0000-0000-000000000003',current_setting('test.g3_draft_day_id')::uuid,
  1::smallint,'Draft lesson','','body',null
),current_setting('test.g3_draft_day_id')::uuid,
  'the mutable Program day detaches before unused sealed history becomes current');
select set_config('app.stream_media_operation_id','',true);
reset role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
update public.program_commerce_state set current_content_version_id=current_setting('test.g3_draft_version_id')::uuid,
  current_offer_version_id=current_setting('test.g3_draft_offer_id')::uuid,updated_at=now()
where program_id='c3700000-0000-0000-0000-000000000003';
insert into public.program_enrollments(id,program_id,member_id,started_on,content_version_id)
values ('c3710000-0000-0000-0000-000000000002','c3700000-0000-0000-0000-000000000003',
  'c3100000-0000-0000-0000-000000000002',current_date,null);
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000004","role":"authenticated"}';
select ok(public.reserve_daily_content_video_delete('c3200000-0000-0000-0000-000000000007'),
  'an unused sealed lesson alone does not block ordinary Library cleanup');
select set_config('test.g3_draft_cleanup_op',current_setting('app.stream_media_operation_id'),true);
select set_config('app.stream_media_operation_id','',true);
reset role;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.start_stream_media_uid_delete(
  current_setting('test.g3_draft_cleanup_op')::uuid,current_setting('test.g3_registry_id')::uuid,
  'stream-g3-unused-draft-uid','c3830000-0000-0000-0000-000000000020',repeat('7',64)
)->>'outcome','delete_started','the same TAP transaction records the delete-started state; committed races use separate two-PID tests');
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok($$update public.programs set published=true
  where id='c3700000-0000-0000-0000-000000000003'$$,
  '55000',null,'market activation cannot create a new obligation after provider deletion starts');
reset role;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$update public.program_enrollments
  set content_version_id=current_setting('test.g3_draft_version_id')::uuid
  where id='c3710000-0000-0000-0000-000000000002' and content_version_id is null$$,
  '55000',null,'a new free pin cannot be added after provider deletion starts');
reset role;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000004","role":"authenticated"}';
select ok(not (select program.published from public.programs program
  where program.id='c3700000-0000-0000-0000-000000000003')
  and exists(select 1 from public.program_enrollments enrollment
    where enrollment.id='c3710000-0000-0000-0000-000000000002'
      and enrollment.content_version_id is null),
  'rejected late market and enrollment writes leave no live obligation behind');

-- A second Program exercises the lifecycle writers that create durable content obligations.
-- A free snapshot enrollment remains pinned when the Program is unpublished; only the current
-- offer obligation is released by unpublishing it.
select set_config('test.g3_retention_parent_revision',coalesce((
  select fence.source_revision::text from public.stream_media_parent_fences fence
  where fence.source_kind='profile' and fence.source_identity='c3100000-0000-0000-0000-000000000004'
),'1'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(pg_temp.make_ready_stream_test_video(
  'c3200000-0000-0000-0000-000000000003','c3100000-0000-0000-0000-000000000004',
  'stream-g3-pinned-free-uid',current_setting('test.g3_registry_id')::uuid,
  current_setting('test.g3_retention_parent_revision')::bigint
)->>'outcome','ready_for_publication','the retention fixture uses the normal verified upload protocol');
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000004","role":"authenticated"}';
insert into public.programs (id,coach_id,title,description,published)
values ('c3700000-0000-0000-0000-000000000002','c3100000-0000-0000-0000-000000000004','Pinned free retention','',false);
select set_config('test.g3_retention_day_id',public.save_owned_program_day(
  'c3700000-0000-0000-0000-000000000002',null,1::smallint,'Pinned lesson','','body',
  'c3200000-0000-0000-0000-000000000003'
)::text,true);
reset role;
insert into public.program_enrollments(id,program_id,member_id,started_on)
values ('c3710000-0000-0000-0000-000000000001','c3700000-0000-0000-0000-000000000002',
  'c3100000-0000-0000-0000-000000000002',current_date);
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('test.g3_retention_version_id',history.created_content_version_id::text,true),
  set_config('test.g3_retention_offer_id',history.created_offer_version_id::text,true)
from pg_temp.make_unpublished_free_history(
  'c3700000-0000-0000-0000-000000000002',current_setting('test.g3_retention_day_id')::uuid,
  'c3200000-0000-0000-0000-000000000003'
) history;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(public.save_owned_program_day(
  'c3700000-0000-0000-0000-000000000002',current_setting('test.g3_retention_day_id')::uuid,
  1::smallint,'Pinned lesson','','body',null
),current_setting('test.g3_retention_day_id')::uuid,
  'the mutable Program day detaches before its historical free pin is created');
select set_config('app.stream_media_operation_id','',true);
reset role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
update public.program_commerce_state set current_content_version_id=current_setting('test.g3_retention_version_id')::uuid,
  current_offer_version_id=current_setting('test.g3_retention_offer_id')::uuid,updated_at=now()
where program_id='c3700000-0000-0000-0000-000000000002';
set local role service_role;
update public.program_enrollments set content_version_id=current_setting('test.g3_retention_version_id')::uuid
where id='c3710000-0000-0000-0000-000000000001';
reset role;
select set_config('test.g3_retention_lesson_id',(
  select lesson.id::text from public.program_content_version_lessons lesson
  where lesson.program_id='c3700000-0000-0000-0000-000000000002'
    and lesson.content_version_id=current_setting('test.g3_retention_version_id')::uuid
    and lesson.cloudflare_uid='stream-g3-pinned-free-uid'
),true);
select ok(exists(
  select 1 from public.stream_media_retention_obligations obligation
  where obligation.source_kind='program_enrollment'
    and obligation.source_identity='c3710000-0000-0000-0000-000000000001:'||current_setting('test.g3_retention_lesson_id')
    and obligation.obligation_kind='pinned_free_enrollment'
    and obligation.obligation_state='active'
), 'a free snapshot enrollment creates a durable media pin');
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000004","role":"authenticated"}';
update public.programs set published=true where id='c3700000-0000-0000-0000-000000000002';
reset role;
select ok(exists(
  select 1 from public.stream_media_retention_obligations obligation
  where obligation.source_kind='program_offer'
    and obligation.source_identity=current_setting('test.g3_retention_offer_id')||':'||current_setting('test.g3_retention_lesson_id')
    and obligation.obligation_kind='marketed_offer' and obligation.obligation_state='active'
), 'publishing a current free offer retains its referenced media');
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000004","role":"authenticated"}';
update public.programs set published=false where id='c3700000-0000-0000-0000-000000000002';
reset role;
select ok(not exists(
  select 1 from public.stream_media_retention_obligations obligation
  where obligation.source_kind='program_offer'
    and obligation.source_identity=current_setting('test.g3_retention_offer_id')||':'||current_setting('test.g3_retention_lesson_id')
    and obligation.obligation_kind='marketed_offer' and obligation.obligation_state='active'
), 'unpublishing releases only the current marketed-offer obligation');
select ok(exists(
  select 1 from public.stream_media_retention_obligations obligation
  where obligation.source_kind='program_enrollment'
    and obligation.source_identity='c3710000-0000-0000-0000-000000000001:'||current_setting('test.g3_retention_lesson_id')
    and obligation.obligation_kind='pinned_free_enrollment'
    and obligation.obligation_state='active'
), 'unpublishing does not release the member’s immutable free-snapshot pin');
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok($$select public.reserve_daily_content_video_delete('c3200000-0000-0000-0000-000000000003')$$,
  '23503',null,'a true free-snapshot pin keeps ordinary Library cleanup blocked after unpublishing');
reset role;

-- A current marketed offer is a separate effective reference from the sealed lesson history.
select set_config('test.g3_market_parent_revision',coalesce((
  select fence.source_revision::text from public.stream_media_parent_fences fence
  where fence.source_kind='profile' and fence.source_identity='c3100000-0000-0000-0000-000000000004'
),'1'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(pg_temp.make_ready_stream_test_video(
  'c3200000-0000-0000-0000-000000000008','c3100000-0000-0000-0000-000000000004',
  'stream-g3-marketed-offer-uid',current_setting('test.g3_registry_id')::uuid,
  current_setting('test.g3_market_parent_revision')::bigint
)->>'outcome','ready_for_publication','the marketed-offer control starts with a verified library video');
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000004","role":"authenticated"}';
insert into public.programs (id,coach_id,title,description,published)
values ('c3700000-0000-0000-0000-000000000004','c3100000-0000-0000-0000-000000000004','Marketed offer control','',false);
select set_config('test.g3_market_day_id',public.save_owned_program_day(
  'c3700000-0000-0000-0000-000000000004',null,1::smallint,'Market lesson','','body',
  'c3200000-0000-0000-0000-000000000008'
)::text,true);
reset role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('test.g3_market_version_id',history.created_content_version_id::text,true),
  set_config('test.g3_market_offer_id',history.created_offer_version_id::text,true)
from pg_temp.make_unpublished_free_history(
  'c3700000-0000-0000-0000-000000000004',current_setting('test.g3_market_day_id')::uuid,
  'c3200000-0000-0000-0000-000000000008'
) history;
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(public.save_owned_program_day(
  'c3700000-0000-0000-0000-000000000004',current_setting('test.g3_market_day_id')::uuid,
  1::smallint,'Market lesson','','body',null
),current_setting('test.g3_market_day_id')::uuid,'the current offer control clears its mutable day source');
select set_config('app.stream_media_operation_id','',true);
reset role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
update public.program_commerce_state set current_content_version_id=current_setting('test.g3_market_version_id')::uuid,
  current_offer_version_id=current_setting('test.g3_market_offer_id')::uuid,updated_at=now()
where program_id='c3700000-0000-0000-0000-000000000004';
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000004","role":"authenticated"}';
update public.programs set published=true where id='c3700000-0000-0000-0000-000000000004';
select throws_ok($$select public.reserve_daily_content_video_delete('c3200000-0000-0000-0000-000000000008')$$,
  '23503',null,'a currently marketed offer prevents library deletion');
update public.programs set published=false where id='c3700000-0000-0000-0000-000000000004';
select ok(public.reserve_daily_content_video_delete('c3200000-0000-0000-0000-000000000008'),
  'after the offer is withdrawn, unused sealed lesson history alone permits Library cleanup');
select set_config('app.stream_media_operation_id','',true);
reset role;

select set_config('test.g3_main_parent_revision',coalesce((
  select fence.source_revision::text from public.stream_media_parent_fences fence
  where fence.source_kind='profile' and fence.source_identity='c3100000-0000-0000-0000-000000000001'
),'1'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('test.g3_absence_fixture_result',pg_temp.make_ready_stream_test_video(
  'c3200000-0000-0000-0000-000000000006','c3100000-0000-0000-0000-000000000001',
  'stream-g3-absence-control-uid',current_setting('test.g3_registry_id')::uuid,
  current_setting('test.g3_main_parent_revision')::bigint
 )::text,true);
select is(current_setting('test.g3_absence_fixture_result')::jsonb->>'outcome',
  'ready_for_publication','a second unreferenced UID is available for the already-absent positive control');
select diag('second unreferenced UID fixture result: ' || current_setting('test.g3_absence_fixture_result'))
where current_setting('test.g3_absence_fixture_result')::jsonb->>'outcome'
  is distinct from 'ready_for_publication';
reset role;

-- Keep a real service-finalized sibling, then add an Owner-only corrupt ready edge whose
-- asset_id points at a different UID. Constraints and lifecycle triggers remain enabled.
select set_config('test.g3_corrupt_parent_revision',coalesce((
  select fence.source_revision::text from public.stream_media_parent_fences fence
  where fence.source_kind='profile' and fence.source_identity='c3100000-0000-0000-0000-000000000006'
),'1'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('test.g3_corrupt_ready_fixture_result',pg_temp.make_ready_stream_test_video(
  'c3200000-0000-0000-0000-000000000009','c3100000-0000-0000-0000-000000000006',
  'stream-g3-ready-sibling-uid',current_setting('test.g3_registry_id')::uuid,
  current_setting('test.g3_corrupt_parent_revision')::bigint
 )::text,true);
select is(current_setting('test.g3_corrupt_ready_fixture_result')::jsonb->>'outcome',
  'ready_for_publication','a private ready video supplies the valid sibling for a corrupted binding control');
select diag('corrupt-ready sibling fixture result: ' || current_setting('test.g3_corrupt_ready_fixture_result'))
where current_setting('test.g3_corrupt_ready_fixture_result')::jsonb->>'outcome'
  is distinct from 'ready_for_publication';
reset role;
insert into public.stream_media_source_bindings(
  id,registry_id,raw_provider_uid,asset_id,source_kind,source_identity,parent_kind,parent_identity,
  source_revision,owner_id,binding_state,evidence_digest
)
select 'c3930000-0000-0000-0000-000000000001'::uuid,valid_binding.registry_id,
  valid_binding.raw_provider_uid,wrong_asset_binding.asset_id,valid_binding.source_kind,
  valid_binding.source_identity,valid_binding.parent_kind,valid_binding.parent_identity,
  valid_binding.source_revision+1,valid_binding.owner_id,'ready_for_publication',repeat('f',64)
from public.stream_media_source_bindings valid_binding
join public.stream_media_source_bindings wrong_asset_binding
  on wrong_asset_binding.source_kind='video'
    and wrong_asset_binding.source_identity='c3200000-0000-0000-0000-000000000001'
    and wrong_asset_binding.registry_id=valid_binding.registry_id
    and wrong_asset_binding.binding_state='ready_for_publication'
where valid_binding.source_kind='video'
  and valid_binding.source_identity='c3200000-0000-0000-0000-000000000009'
  and valid_binding.binding_state='ready_for_publication'
  and wrong_asset_binding.asset_id is distinct from valid_binding.asset_id
limit 1;
insert into public.stream_media_source_binding_events(
  binding_id,event_kind,source_revision,request_id,evidence_digest
)
select binding.id,'attached',binding.source_revision,
  'c3940000-0000-0000-0000-000000000001',binding.evidence_digest
from public.stream_media_source_bindings binding
where binding.id='c3930000-0000-0000-0000-000000000001';
insert into public.stream_media_source_account_edges(binding_id,account_id,relation_kind)
values ('c3930000-0000-0000-0000-000000000001','c3100000-0000-0000-0000-000000000006','source_owner');
select ok(exists(
  select 1 from public.stream_media_source_bindings invalid_binding
  join public.stream_media_source_bindings valid_sibling
    on valid_sibling.source_kind=invalid_binding.source_kind
      and valid_sibling.source_identity=invalid_binding.source_identity
      and valid_sibling.registry_id=invalid_binding.registry_id
      and valid_sibling.raw_provider_uid=invalid_binding.raw_provider_uid
      and valid_sibling.owner_id=invalid_binding.owner_id
      and valid_sibling.binding_state='ready_for_publication'
      and valid_sibling.id<>invalid_binding.id
  join public.stream_media_assets exact_asset on exact_asset.id=valid_sibling.asset_id
    and exact_asset.registry_id=valid_sibling.registry_id
    and exact_asset.raw_provider_uid=valid_sibling.raw_provider_uid
    and exact_asset.lifecycle_state='ready_for_publication'
    and exact_asset.signed_urls_verified and exact_asset.ready_to_stream_verified
  join public.stream_media_assets wrong_asset on wrong_asset.id=invalid_binding.asset_id
    and wrong_asset.lifecycle_state='ready_for_publication'
    and wrong_asset.signed_urls_verified and wrong_asset.ready_to_stream_verified
  where invalid_binding.id='c3930000-0000-0000-0000-000000000001'
    and invalid_binding.binding_state='ready_for_publication'
    and invalid_binding.asset_id is distinct from valid_sibling.asset_id
    and wrong_asset.registry_id=invalid_binding.registry_id
    and wrong_asset.raw_provider_uid is distinct from invalid_binding.raw_provider_uid
    and private.stream_source_binding_ready(invalid_binding.source_kind,
      invalid_binding.source_identity,invalid_binding.owner_id,
      invalid_binding.registry_id,invalid_binding.raw_provider_uid)
    and private.stream_upload_source_exists(invalid_binding.source_kind,
      invalid_binding.source_identity,invalid_binding.owner_id,
      invalid_binding.registry_id,invalid_binding.raw_provider_uid)
), 'a valid sibling satisfies existential readiness while the current ready binding points at another UID asset');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.begin_stream_account_media_cleanup(
  'c3800000-0000-0000-0000-000000000006','c3100000-0000-0000-0000-000000000006',
  'c3820000-0000-0000-0000-000000000006',repeat('a',64),
  'c3810000-0000-0000-0000-000000000006',repeat('b',64)
)->>'outcome','unresolved_media_identity',
  'account cleanup rejects the corrupted ready edge instead of trusting its valid sibling');
reset role;

-- This second owner fixture has an exact asset tuple but points at a different Library video.
insert into public.stream_media_source_bindings(
  id,registry_id,raw_provider_uid,asset_id,source_kind,source_identity,parent_kind,parent_identity,
  source_revision,owner_id,binding_state,evidence_digest
)
select 'c3930000-0000-0000-0000-000000000002'::uuid,valid_binding.registry_id,
  valid_binding.raw_provider_uid,valid_binding.asset_id,'video',
  'c3200000-0000-0000-0000-000000000001','profile','c3990000-0000-0000-0000-000000000002',
  valid_binding.source_revision+1,'c3990000-0000-0000-0000-000000000002',
  'ready_for_publication',repeat('e',64)
from public.stream_media_source_bindings valid_binding
where valid_binding.source_kind='video'
  and valid_binding.source_identity='c3200000-0000-0000-0000-000000000009'
  and valid_binding.binding_state='ready_for_publication'
limit 1;
insert into public.stream_media_source_binding_events(
  binding_id,event_kind,source_revision,request_id,evidence_digest
)
select binding.id,'attached',binding.source_revision,
  'c3940000-0000-0000-0000-000000000002',binding.evidence_digest
from public.stream_media_source_bindings binding
where binding.id='c3930000-0000-0000-0000-000000000002';
insert into public.stream_media_source_account_edges(binding_id,account_id,relation_kind)
values ('c3930000-0000-0000-0000-000000000002','c3990000-0000-0000-0000-000000000002','source_owner');
select ok(exists(
  select 1 from public.stream_media_source_bindings invalid_binding
  join public.stream_media_assets asset on asset.id=invalid_binding.asset_id
    and asset.registry_id=invalid_binding.registry_id
    and asset.raw_provider_uid=invalid_binding.raw_provider_uid
    and asset.lifecycle_state='ready_for_publication'
    and asset.signed_urls_verified and asset.ready_to_stream_verified
  where invalid_binding.id='c3930000-0000-0000-0000-000000000002'
    and not private.stream_upload_source_exists(invalid_binding.source_kind,
      invalid_binding.source_identity,invalid_binding.owner_id,
      invalid_binding.registry_id,invalid_binding.raw_provider_uid)
), 'source mismatch fixture keeps an exact ready asset but fails the exact Library identity check');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.begin_stream_account_media_cleanup(
  'c3800000-0000-0000-0000-000000000007','c3990000-0000-0000-0000-000000000002',
  'c3820000-0000-0000-0000-000000000007',repeat('c',64),
  'c3810000-0000-0000-0000-000000000007',repeat('d',64)
)->>'outcome','unresolved_media_identity',
  'account cleanup blocks an exact asset tuple whose Library video identity does not match');
reset role;

set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('test.g3_tombstone_id','c3800000-0000-0000-0000-000000000001',true);
select set_config('test.g3_account_op','c3810000-0000-0000-0000-000000000001',true);
select is(public.begin_stream_account_media_cleanup(
  current_setting('test.g3_tombstone_id')::uuid,'c3100000-0000-0000-0000-000000000001',
  'c3820000-0000-0000-0000-000000000001',repeat('a',64),
  current_setting('test.g3_account_op')::uuid,repeat('b',64)
)->>'outcome','reserved','account cleanup reserves the full current owner manifest atomically');
reset role;
select ok(exists(
  select 1
  from public.stream_media_manifest_edges edge
  join public.stream_media_source_bindings binding on binding.id=edge.binding_id
  join public.stream_media_assets asset on asset.id=binding.asset_id
    and asset.registry_id=binding.registry_id and asset.raw_provider_uid=binding.raw_provider_uid
  join public.videos video on video.id::text=binding.source_identity
  join public.stream_media_operation_uid_state uid_state
    on uid_state.operation_id=edge.operation_id and uid_state.registry_id=edge.registry_id
      and uid_state.raw_provider_uid=edge.raw_provider_uid
  where edge.operation_id=current_setting('test.g3_account_op')::uuid
    and binding.source_kind='video'
    and binding.source_identity='c3200000-0000-0000-0000-000000000001'
    and binding.owner_id='c3100000-0000-0000-0000-000000000001'
    and binding.registry_id=current_setting('test.g3_registry_id')::uuid
    and binding.raw_provider_uid='stream-g3-main-uid'
    and binding.binding_state='ready_for_publication'
    and video.coach_id=binding.owner_id
    and video.stream_provider_account_registry_id=binding.registry_id
    and video.cloudflare_uid=binding.raw_provider_uid
    and video.status='ready' and video.visibility='private'
    and asset.lifecycle_state='ready_for_publication'
    and asset.signed_urls_verified and asset.ready_to_stream_verified
    and uid_state.uid_state='reserved'
)
and exists(
  select 1 from public.stream_media_manifest_edges edge
  join public.stream_media_source_bindings binding on binding.id=edge.binding_id
  join public.stream_media_assets asset on asset.id=binding.asset_id
    and asset.registry_id=binding.registry_id and asset.raw_provider_uid=binding.raw_provider_uid
  join public.stream_media_operation_uid_state uid_state
    on uid_state.operation_id=edge.operation_id and uid_state.registry_id=edge.registry_id
      and uid_state.raw_provider_uid=edge.raw_provider_uid
  where edge.operation_id=current_setting('test.g3_account_op')::uuid
    and binding.id='c3930000-0000-0000-0000-000000000003'
    and binding.source_kind='program_lesson'
    and binding.source_identity=current_setting('test.g3_legacy_ready_lesson_id')
    and binding.binding_state='ready_for_publication'
    and asset.lifecycle_state='ready_for_publication'
    and asset.signed_urls_verified and asset.ready_to_stream_verified
    and not private.stream_upload_source_exists(binding.source_kind,binding.source_identity,
      binding.owner_id,binding.registry_id,binding.raw_provider_uid)
    and uid_state.uid_state='reserved'
), 'cleanup reserves the exact private ready upload and frozen legacy lesson without rewriting history');
select is((select count(*)::integer from public.stream_media_manifest_edges edge
  where edge.operation_id=current_setting('test.g3_account_op')::uuid),
  (select count(distinct binding.id)::integer from public.stream_media_source_account_edges account_edge
    join public.stream_media_source_bindings binding on binding.id=account_edge.binding_id
    where account_edge.account_id='c3100000-0000-0000-0000-000000000001'
      and binding.registry_id is not null and binding.binding_state<>'detached'),
  'the account manifest covers every current bound source edge without duplicate UID work');
select is((select count(*)::integer from public.stream_media_operation_uid_state uid_state
  where uid_state.operation_id=current_setting('test.g3_account_op')::uuid),2,
  'the shared Program sources deduplicate while an independent video keeps its own UID outcome');

-- A current account tombstone blocks a newly attached Program-day source before it can be
-- published. The existing title-only edit and same-video Fuel upsert above remain supported.
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$select public.save_owned_program_day('c3700000-0000-0000-0000-000000000001',
    current_setting('test.g3_day_id')::uuid,1::smallint,'Blocked attach','', 'body',
    'c3200000-0000-0000-0000-000000000001')$$,
  '55000',null,'a fenced account cannot add a Program source during account cleanup'
);
select ok(not private.stream_media_account_ingress_allowed('c3100000-0000-0000-0000-000000000001'),
  'Storage ingress rejects the account as soon as its durable tombstone exists');
reset role;

set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.start_stream_media_uid_delete(
  current_setting('test.g3_account_op')::uuid,
  current_setting('test.g3_registry_id')::uuid,'stream-g3-main-uid',
  'c3830000-0000-0000-0000-000000000001',repeat('c',64)
)->>'outcome','delete_started','provider deletion starts only against the reserved exact UID manifest');
select is(public.record_stream_media_uid_delete_result(
  current_setting('test.g3_account_op')::uuid,
  current_setting('test.g3_registry_id')::uuid,'stream-g3-main-uid',
  'deleted_confirmed',204::smallint,null::smallint,
  'c3830000-0000-0000-0000-000000000010',repeat('1',64)
)->>'outcome','absence_not_confirmed','a successful DELETE with a missing exact GET status is not proof');
select is(public.record_stream_media_uid_delete_result(
  current_setting('test.g3_account_op')::uuid,
  current_setting('test.g3_registry_id')::uuid,'stream-g3-main-uid',
  'deleted_confirmed',null::smallint,404::smallint,
  'c3830000-0000-0000-0000-000000000011',repeat('2',64)
)->>'outcome','absence_not_confirmed','a missing DELETE status cannot prove provider deletion');
select is(public.record_stream_media_uid_delete_result(
  current_setting('test.g3_account_op')::uuid,
  current_setting('test.g3_registry_id')::uuid,'stream-g3-main-uid',
  'deleted_confirmed',null::smallint,null::smallint,
  'c3830000-0000-0000-0000-000000000012',repeat('3',64)
)->>'outcome','absence_not_confirmed','missing DELETE and GET statuses cannot prove provider deletion');
select is(public.record_stream_media_uid_delete_result(
  current_setting('test.g3_account_op')::uuid,
  current_setting('test.g3_registry_id')::uuid,'stream-g3-main-uid',
  'already_absent_confirmed',null::smallint,null::smallint,
  'c3830000-0000-0000-0000-000000000013',repeat('4',64)
)->>'outcome','absence_not_confirmed','missing exact GET status cannot prove an already absent UID');
reset role;
select is((select uid_state.uid_state from public.stream_media_operation_uid_state uid_state
  where uid_state.operation_id=current_setting('test.g3_account_op')::uuid
    and uid_state.registry_id=current_setting('test.g3_registry_id')::uuid
    and uid_state.raw_provider_uid='stream-g3-main-uid'),
  'delete_started','invalid nullable absence evidence leaves the UID state unchanged');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.record_stream_media_uid_delete_result(
  current_setting('test.g3_account_op')::uuid,
  current_setting('test.g3_registry_id')::uuid,'stream-g3-main-uid',
  'deleted_confirmed',204::smallint,404::smallint,
  'c3830000-0000-0000-0000-000000000002',repeat('d',64)
)->>'outcome','recorded','synthetic deletion evidence requires success plus exact UID absence');
select is(public.start_stream_media_uid_delete(
  current_setting('test.g3_account_op')::uuid,
  current_setting('test.g3_registry_id')::uuid,'stream-g3-absence-control-uid',
  'c3830000-0000-0000-0000-000000000014',repeat('5',64)
)->>'outcome','delete_started','the independent UID also needs its own delete start record');
select is(public.record_stream_media_uid_delete_result(
  current_setting('test.g3_account_op')::uuid,
  current_setting('test.g3_registry_id')::uuid,'stream-g3-absence-control-uid',
  'already_absent_confirmed',null::smallint,404::smallint,
  'c3830000-0000-0000-0000-000000000015',repeat('6',64)
)->>'outcome','recorded','an exact GET 404 with no DELETE request is valid already-absent evidence');
select is(public.finalize_stream_media_cleanup(
  current_setting('test.g3_account_op')::uuid,
  'c3830000-0000-0000-0000-000000000003',repeat('e',64)
)->>'outcome','account_cleanup_complete','account cleanup finalizes only after every manifest UID is terminal');
select set_config('app.stream_media_operation_id','',true);
select is(public.finalize_stream_media_cleanup(
  current_setting('test.g3_account_op')::uuid,
  'c3830000-0000-0000-0000-000000000003',repeat('e',64)
)->>'outcome','account_cleanup_complete',
  'account cleanup finalization replays its exact durable response');
select is(public.finalize_stream_media_cleanup(
  current_setting('test.g3_account_op')::uuid,
  'c3830000-0000-0000-0000-000000000003',repeat('0',64)
)->>'outcome','identity_mismatch',
  'account cleanup finalization rejects a changed digest for the same request ID');
reset role;
select is((select count(*)::integer from public.stream_media_operation_uid_state uid_state
  where uid_state.operation_id=current_setting('test.g3_account_op')::uuid
    and uid_state.uid_state='deleted_confirmed'),1,
  'the manifest retains the confirmed provider outcome as durable evidence');
select is((select count(*)::integer from public.stream_media_operation_uid_state uid_state
  where uid_state.operation_id=current_setting('test.g3_account_op')::uuid
    and uid_state.uid_state='already_absent_confirmed'),1,
  'the manifest also retains the exact already-absent outcome');
reset role;

-- A required workflow component is registered as a synthetic integration fixture. Its exact
-- proof revision is snapshotted into one durable Auth permit and must be refreshed after UNKNOWN.
insert into public.stream_auth_cleanup_components(
  component_key,component_version,resource_set_revision,required_for_auth
) values ('test_workflow',1,1,true);
select set_config('test.g3_tombstone_revision',(
  select tombstone.revision::text from public.stream_media_account_tombstones tombstone
  where tombstone.id=current_setting('test.g3_tombstone_id')::uuid),true);
select set_config('test.g3_source_digest',(
  select tombstone.source_revision_digest from public.stream_media_account_tombstones tombstone
  where tombstone.id=current_setting('test.g3_tombstone_id')::uuid),true);

set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.prepare_stream_auth_deletion_permit(
  current_setting('test.g3_tombstone_id')::uuid,current_setting('test.g3_tombstone_revision')::bigint,
  'c3900000-0000-0000-0000-000000000001','c3910000-0000-0000-0000-000000000001',repeat('f',64)
)->>'outcome','required_component_proofs_incomplete',
  'missing required workflow proof fails closed before a permit is created');
select is(public.record_stream_auth_cleanup_component_proof(
  current_setting('test.g3_tombstone_id')::uuid,current_setting('test.g3_tombstone_revision')::bigint,
  'test_workflow',1,1,'incomplete',current_setting('test.g3_source_digest'),repeat('1',64),
  'c3920000-0000-0000-0000-000000000001'
)->>'outcome','recorded','an incomplete workflow proof is recorded as an explicit non-ready result');
select is(public.prepare_stream_auth_deletion_permit(
  current_setting('test.g3_tombstone_id')::uuid,current_setting('test.g3_tombstone_revision')::bigint,
  'c3900000-0000-0000-0000-000000000001','c3910000-0000-0000-0000-000000000002',repeat('f',64)
)->>'outcome','required_component_proofs_incomplete','an incomplete component cannot authorize Auth deletion');
select is(public.record_stream_auth_cleanup_component_proof(
  current_setting('test.g3_tombstone_id')::uuid,current_setting('test.g3_tombstone_revision')::bigint,
  'test_workflow',1,1,'ready',current_setting('test.g3_source_digest'),repeat('2',64),
  'c3920000-0000-0000-0000-000000000002'
)->>'outcome','recorded','the required component can append a ready proof for the same tombstone revision');
select is(public.prepare_stream_auth_deletion_permit(
  current_setting('test.g3_tombstone_id')::uuid,current_setting('test.g3_tombstone_revision')::bigint,
  'c3900000-0000-0000-0000-000000000001','c3910000-0000-0000-0000-000000000003',repeat('f',64)
)->>'outcome','permit_ready','the exact current VOD and workflow proof set creates a permit');
reset role;
select is((select count(*)::integer from public.stream_media_auth_permit_components snapshot
  where snapshot.permit_id='c3900000-0000-0000-0000-000000000001'
    and snapshot.validation_revision=1),2,
  'the permit snapshots every required component including VOD and workflow');

select set_config('test.g3_permit_revision',(
  select permit.revision::text from public.stream_media_auth_deletion_permits permit
  where permit.id='c3900000-0000-0000-0000-000000000001'),true);
select set_config('test.g3_tombstone_state_revision',(
  select tombstone.state_revision::text from public.stream_media_account_tombstones tombstone
  where tombstone.id=current_setting('test.g3_tombstone_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.start_stream_auth_deletion_call(
  'c3900000-0000-0000-0000-000000000001',
  current_setting('test.g3_permit_revision')::bigint,
  current_setting('test.g3_tombstone_state_revision')::bigint,
  'c3930000-0000-0000-0000-000000000001',repeat('3',64)
)->>'outcome','started','the current permit starts a durable Auth call');
reset role;
select set_config('test.g3_permit_revision',(
  select permit.revision::text from public.stream_media_auth_deletion_permits permit
  where permit.id='c3900000-0000-0000-0000-000000000001'),true);
select set_config('test.g3_tombstone_state_revision',(
  select tombstone.state_revision::text from public.stream_media_account_tombstones tombstone
  where tombstone.id=current_setting('test.g3_tombstone_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.record_stream_auth_deletion_result(
  'c3900000-0000-0000-0000-000000000001',
  current_setting('test.g3_permit_revision')::bigint,
  current_setting('test.g3_tombstone_state_revision')::bigint,
  'unknown','c3940000-0000-0000-0000-000000000001',repeat('4',64)
)->>'outcome','recorded','an ambiguous Auth response retains the tombstone and permit');
reset role;
update public.stream_auth_cleanup_components
set component_version=2,resource_set_revision=2,updated_at=now()
where component_key='test_workflow';
select set_config('test.g3_permit_revision',(
  select permit.revision::text from public.stream_media_auth_deletion_permits permit
  where permit.id='c3900000-0000-0000-0000-000000000001'),true);
select set_config('test.g3_tombstone_state_revision',(
  select tombstone.state_revision::text from public.stream_media_account_tombstones tombstone
  where tombstone.id=current_setting('test.g3_tombstone_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.start_stream_auth_deletion_call(
  'c3900000-0000-0000-0000-000000000001',
  current_setting('test.g3_permit_revision')::bigint,
  current_setting('test.g3_tombstone_state_revision')::bigint,
  'c3930000-0000-0000-0000-000000000002',repeat('5',64)
)->>'outcome','component_proofs_stale','a changed required resource-set revision blocks retry under the old proof snapshot');
reset role;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.record_stream_auth_cleanup_component_proof(
  current_setting('test.g3_tombstone_id')::uuid,current_setting('test.g3_tombstone_revision')::bigint,
  'test_workflow',2,2,'ready',current_setting('test.g3_source_digest'),repeat('6',64),
  'c3920000-0000-0000-0000-000000000003'
)->>'outcome','recorded','a new exact workflow resource-set proof can replace the stale latest proof');
select is(public.prepare_stream_auth_deletion_permit(
  current_setting('test.g3_tombstone_id')::uuid,current_setting('test.g3_tombstone_revision')::bigint,
  'c3900000-0000-0000-0000-000000000001','c3910000-0000-0000-0000-000000000004',repeat('7',64)
)->>'outcome','revalidated','UNKNOWN revalidates the same permit instead of creating a replacement');
reset role;
select is((select count(*)::integer from public.stream_media_auth_permit_components snapshot
  where snapshot.permit_id='c3900000-0000-0000-0000-000000000001'
    and snapshot.validation_revision=2 and snapshot.component_key='test_workflow'
    and snapshot.component_version=2 and snapshot.resource_set_revision=2),1,
  'same-permit revalidation snapshots the new exact component revision');
select set_config('test.g3_permit_revision',(
  select permit.revision::text from public.stream_media_auth_deletion_permits permit
  where permit.id='c3900000-0000-0000-0000-000000000001'),true);
select set_config('test.g3_tombstone_state_revision',(
  select tombstone.state_revision::text from public.stream_media_account_tombstones tombstone
  where tombstone.id=current_setting('test.g3_tombstone_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.start_stream_auth_deletion_call(
  'c3900000-0000-0000-0000-000000000001',
  current_setting('test.g3_permit_revision')::bigint,
  current_setting('test.g3_tombstone_state_revision')::bigint,
  'c3930000-0000-0000-0000-000000000003',repeat('8',64)
)->>'outcome','started','the unchanged permit id can resume after fresh component validation');
reset role;
-- The TAP owner stands in for Auth's parent-row deletion. This local SQL fixture does not
-- grant service_role profile privileges or call the Auth API.
select set_config('app.stream_media_operation_id','',true);
select set_config('request.jwt.claim.sub','',true);
select lives_ok($$delete from auth.users where id='c3100000-0000-0000-0000-000000000001'$$,
  'the Auth parent delete cascades the profile under the started durable permit');
select ok(not exists(select 1 from auth.users where id='c3100000-0000-0000-0000-000000000001'),
  'the permitted synthetic Auth parent row is gone');
select set_config('test.g3_permit_revision',(
  select permit.revision::text from public.stream_media_auth_deletion_permits permit
  where permit.id='c3900000-0000-0000-0000-000000000001'),true);
select set_config('test.g3_tombstone_state_revision',(
  select tombstone.state_revision::text from public.stream_media_account_tombstones tombstone
  where tombstone.id=current_setting('test.g3_tombstone_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.record_stream_auth_deletion_result(
  'c3900000-0000-0000-0000-000000000001',
  current_setting('test.g3_permit_revision')::bigint,
  current_setting('test.g3_tombstone_state_revision')::bigint,
  'confirmed','c3940000-0000-0000-0000-000000000002',repeat('9',64)
)->>'outcome','recorded','a confirmed Auth result is durably recorded');
reset role;
select set_config('test.g3_permit_revision',(
  select permit.revision::text from public.stream_media_auth_deletion_permits permit
  where permit.id='c3900000-0000-0000-0000-000000000001'),true);
select set_config('test.g3_tombstone_state_revision',(
  select tombstone.state_revision::text from public.stream_media_account_tombstones tombstone
  where tombstone.id=current_setting('test.g3_tombstone_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.complete_stream_auth_deletion(
  'c3900000-0000-0000-0000-000000000001',
  current_setting('test.g3_permit_revision')::bigint,
  current_setting('test.g3_tombstone_state_revision')::bigint,
  'c3950000-0000-0000-0000-000000000001',repeat('a',64)
)->>'outcome','completed','the permit reaches terminal completion only after confirmation');
reset role;
select ok(exists (
  select 1 from public.stream_media_source_bindings binding
  join public.stream_media_source_account_edges account_edge on account_edge.binding_id=binding.id
  where account_edge.account_id='c3100000-0000-0000-0000-000000000001'
    and binding.binding_state='detached'
), 'account cascade preserves detached media identity evidence after mutable source rows disappear');
reset role;

-- A second synthetic coach exercises the irreversible-delete reservation flag and unknown legacy
-- UID block. The flag can be set only through the existing reservation RPC and cannot be cleared.
select set_config('test.g3_legacy_parent_revision',coalesce((
  select fence.source_revision::text from public.stream_media_parent_fences fence
  where fence.source_kind='profile' and fence.source_identity='c3100000-0000-0000-0000-000000000003'
),'1'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(pg_temp.make_ready_stream_test_video(
  'c3200000-0000-0000-0000-000000000002','c3100000-0000-0000-0000-000000000003',
  'stream-g3-legacy-uid',current_setting('test.g3_registry_id')::uuid,
  current_setting('test.g3_legacy_parent_revision')::bigint
)->>'outcome','ready_for_publication','a second synthetic owner receives a distinct ready UID');
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000003","role":"authenticated"}';
select ok(public.reserve_daily_content_video_delete('c3200000-0000-0000-0000-000000000002'),
  'the existing owner-facing Daily Content reservation creates an exact video cleanup manifest');
select set_config('app.stream_media_operation_id','',true);
reset role;
select ok((select video.daily_content_deletion_pending from public.videos video
  where video.id='c3200000-0000-0000-0000-000000000002'),
  'the deletion-pending flag is set by the manifest-backed reservation');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$update public.videos set daily_content_deletion_pending=false
  where id='c3200000-0000-0000-0000-000000000002'$$,
  '55000',null,'an active deletion reservation cannot be cleared by a later source mutation');
select is(public.capture_legacy_stream_media(
  'c3960000-0000-0000-0000-000000000001',repeat('b',64)
)->>'coverage','unguarded_incomplete','legacy capture remains explicitly incomplete after the writer guards');
select is(public.begin_stream_account_media_cleanup(
  'c3970000-0000-0000-0000-000000000001','c3100000-0000-0000-0000-000000000003',
  'c3980000-0000-0000-0000-000000000001',repeat('c',64),
  'c3990000-0000-0000-0000-000000000001',repeat('d',64)
)->>'outcome','account_unverified_or_legacy_candidate',
  'a later unknown-account observation matching the raw UID blocks account cleanup');
reset role;
select is((select count(*)::integer from public.stream_media_operations operation
  where operation.id='c3990000-0000-0000-0000-000000000001'),0,
  'unknown legacy UID rejection leaves no partial account cleanup operation or manifest');
-- The owner simulates Auth's parent delete so this exercises the profile cascade guard itself.
select set_config('app.stream_media_operation_id','',true);
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$delete from auth.users where id='c3100000-0000-0000-0000-000000000003'$$,
  '55000',null,'a profile cascade cannot proceed without a current Auth deletion permit');
select ok(exists(select 1 from auth.users where id='c3100000-0000-0000-0000-000000000003'),
  'the rejected Auth parent delete leaves the synthetic user intact');

-- Exercise the real owner RPCs so the status trigger's UID-set query is prepared at runtime.
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000004","role":"authenticated"}';
select set_config('test.g3_daily_quote_item_id',(
  select saved.item_id::text from public.save_daily_content_item(
    null,'quote','Lifecycle trigger quote',null,'A quote used to exercise item status changes.',null,null
  ) saved
),true);
select ok(current_setting('test.g3_daily_quote_item_id')<>'',
  'the owner RPC creates a Daily Content quote fixture');
select is(public.archive_daily_content_item(current_setting('test.g3_daily_quote_item_id')::uuid),true,
  'the matching owner archives the quote through the supported RPC');
select is((select item.status from public.daily_content_items item
  where item.id=current_setting('test.g3_daily_quote_item_id')::uuid),'archived',
  'the owner reads back the raw archived item state');
reset role;
-- Read the internal fence as owner, then pass its value into the service-role fixture RPC.
select set_config('test.g3_retained_parent_revision',coalesce((
  select fence.source_revision::text from public.stream_media_parent_fences fence
  where fence.source_kind='profile' and fence.source_identity='c3100000-0000-0000-0000-000000000011'
),'1'),true);
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
set local role service_role;

-- Add a distinct owner-owned UID with a real current free offer. Its market obligation remains
-- retained while the separate provisional upload below is conclusively absent.
select set_config('test.g3_provisional_retained_upload_result',pg_temp.make_ready_stream_test_video(
  'c3200000-0000-0000-0000-000000000016','c3100000-0000-0000-0000-000000000011',
  'stream-g3-provisional-retained-control-uid',current_setting('test.g3_registry_id')::uuid,
  current_setting('test.g3_retained_parent_revision')::bigint
)::text,true);
select is(current_setting('test.g3_provisional_retained_upload_result')::jsonb->>'outcome',
  'ready_for_publication','the separate owner Library UID is created through exact readback finalization');
select diag('provisional retained-control upload: ' || current_setting('test.g3_provisional_retained_upload_result'))
where current_setting('test.g3_provisional_retained_upload_result')::jsonb->>'outcome'
  is distinct from 'ready_for_publication';
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000011","role":"authenticated"}';
insert into public.programs(id,coach_id,title,description,published)
values ('c3700000-0000-0000-0000-000000000007','c3100000-0000-0000-0000-000000000011',
  'Provisional aggregate retention control','',false);
select set_config('test.g3_provisional_retained_day_id',public.save_owned_program_day(
  'c3700000-0000-0000-0000-000000000007',null,1::smallint,'Retained control lesson','','body',
  'c3200000-0000-0000-0000-000000000016'
)::text,true);
reset role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('test.g3_provisional_retained_version_id',history.created_content_version_id::text,true),
  set_config('test.g3_provisional_retained_offer_id',history.created_offer_version_id::text,true)
from pg_temp.make_unpublished_free_history(
  'c3700000-0000-0000-0000-000000000007',
  current_setting('test.g3_provisional_retained_day_id')::uuid,
  'c3200000-0000-0000-0000-000000000016'
) history;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000011","role":"authenticated"}';
select is(public.save_owned_program_day(
  'c3700000-0000-0000-0000-000000000007',current_setting('test.g3_provisional_retained_day_id')::uuid,
  1::smallint,'Retained control lesson','','body',null
),current_setting('test.g3_provisional_retained_day_id')::uuid,
  'the mutable Program day detaches before the immutable free offer is activated');
select set_config('app.stream_media_operation_id','',true);
reset role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
update public.program_commerce_state set
  current_content_version_id=current_setting('test.g3_provisional_retained_version_id')::uuid,
  current_offer_version_id=current_setting('test.g3_provisional_retained_offer_id')::uuid,updated_at=now()
where program_id='c3700000-0000-0000-0000-000000000007';
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"c3100000-0000-0000-0000-000000000011","role":"authenticated"}';
update public.programs set published=true where id='c3700000-0000-0000-0000-000000000007';
reset role;
select ok(exists(
  select 1 from public.stream_media_retention_obligations obligation
  join public.program_content_version_lessons lesson
    on lesson.id::text=split_part(obligation.source_identity,':',2)
  where obligation.source_kind='program_offer'
    and obligation.source_identity=current_setting('test.g3_provisional_retained_offer_id')||':'||lesson.id::text
    and lesson.content_version_id=current_setting('test.g3_provisional_retained_version_id')::uuid
    and lesson.cloudflare_uid='stream-g3-provisional-retained-control-uid'
    and obligation.registry_id=current_setting('test.g3_registry_id')::uuid
    and obligation.raw_provider_uid=lesson.cloudflare_uid
    and obligation.obligation_kind='marketed_offer' and obligation.obligation_state='active'
), 'the distinct owner UID has an exact active free-offer retention obligation');

-- A verified provider create may crash after exact UID bind but before its source-row INSERT.
-- Account cleanup can drain this exact provisional identity without inventing upload completion.
-- Its internal parent fence is fixture input, so capture it as owner before service-role RPCs.
select set_config('test.g3_provisional_parent_revision',(
  select fence.source_revision::text from public.stream_media_parent_fences fence
  where fence.source_kind='profile' and fence.source_identity='c3100000-0000-0000-0000-000000000011'
),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('app.stream_media_operation_id','',true);
select is(public.record_stream_media_upload_intent(
  'c3b12000-0000-0000-0000-000000000001','c3b12000-0000-0000-0000-000000000002',
  'c3100000-0000-0000-0000-000000000011','library_video','video',
  'c3200000-0000-0000-0000-000000000013',0,current_setting('test.g3_registry_id')::uuid,
  'c3b12000-0000-0000-0000-000000000003',repeat('3',64)
)->>'outcome','recorded','the crash fixture records a normal owner-owned Library intent');
select is(public.record_stream_upload_context(
  'c3b12000-0000-0000-0000-000000000004','c3b12000-0000-0000-0000-000000000001',
  'profile','c3100000-0000-0000-0000-000000000011',
  'c3100000-0000-0000-0000-000000000011',
  current_setting('test.g3_provisional_parent_revision')::bigint,repeat('4',64)
)->>'outcome','context_recorded','the owner intent receives its exact current profile fence');
select is(public.reserve_stream_media_upload(
  'c3b12000-0000-0000-0000-000000000005','c3b12000-0000-0000-0000-000000000006',
  'c3b12000-0000-0000-0000-000000000001',repeat('5',64)
)->>'outcome','reserved','the crash fixture reserves the exact upload operation');
select is(public.advance_stream_media_upload(
  'c3b12000-0000-0000-0000-000000000005','c3b12000-0000-0000-0000-000000000007',
  'create_started',repeat('6',64)
)->>'outcome','advanced','the provider create is durably marked as started');
select is(public.advance_stream_media_upload(
  'c3b12000-0000-0000-0000-000000000005','c3b12000-0000-0000-0000-000000000008',
  'created_unverified',repeat('7',64)
)->>'outcome','advanced','the provider create reply remains unverified until exact GET evidence');
select is(public.record_stream_media_upload_observation(
  'c3b12000-0000-0000-0000-000000000005',current_setting('test.g3_registry_id')::uuid,
  'exact_uid_get','stream-g3-provisional-account-cleanup-uid',200::smallint,true,true,true,true,
  'c3b12000-0000-0000-0000-000000000009',repeat('8',64)
)->>'outcome','recorded','the synthetic exact GET confirms UID, markers, signed URLs, and readiness');
select set_config('test.g3_provisional_bind_result',public.bind_stream_media_upload_readback(
  'c3b12000-0000-0000-0000-000000000005','c3b12000-0000-0000-0000-000000000009',
  'c3b12000-0000-0000-0000-000000000010'
)::text,true);
select is(current_setting('test.g3_provisional_bind_result')::jsonb->>'outcome','provisional_bound',
  'the exact readback binds the provider identity without finalizing or inserting a source row');
select set_config('test.g3_provisional_intent_id','c3b12000-0000-0000-0000-000000000001',true);
select set_config('test.g3_provisional_binding_id',
  current_setting('test.g3_provisional_bind_result')::jsonb->>'binding_id',true);
reset role;
select ok(not exists(select 1 from public.videos video
    where video.id='c3200000-0000-0000-0000-000000000013')
  and (select binding.binding_state='provisional_bound'
    from public.stream_media_source_bindings binding
    where binding.id=current_setting('test.g3_provisional_binding_id')::uuid),
  'the crash fixture preserves a provisional binding with no mutable Library source row');
select ok(private.stream_provisional_upload_account_cleanup_eligible(
    current_setting('test.g3_provisional_binding_id')::uuid,
    'c3100000-0000-0000-0000-000000000011')
  and not private.stream_upload_cleanup_proven(
    current_setting('test.g3_provisional_intent_id')::uuid,'c3100000-0000-0000-0000-000000000011'),
  'only the exact provisional proof qualifies, without claiming a completed upload receipt');
select ok(private.stream_upload_operation_matches(
    'c3b12000-0000-0000-0000-000000000005','video','c3200000-0000-0000-0000-000000000013',
    'c3100000-0000-0000-0000-000000000011',current_setting('test.g3_registry_id')::uuid,
    'stream-g3-provisional-account-cleanup-uid'),
  'the exact provisional upload operation remains valid for its original source callback');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.begin_stream_account_media_cleanup(
  'c3b11000-0000-0000-0000-000000000001','c3100000-0000-0000-0000-000000000011',
  'c3b11000-0000-0000-0000-000000000002',repeat('a',64),
  'c3b11000-0000-0000-0000-000000000003',repeat('b',64)
)->>'outcome','reserved','account cleanup reserves the exact crash-bound UID without a source row');
select set_config('app.stream_media_operation_id','c3b12000-0000-0000-0000-000000000005',true);
select throws_ok($$insert into public.videos(
    id,coach_id,cloudflare_uid,title,description,status,visibility,stream_provider_account_registry_id
  ) values ('c3200000-0000-0000-0000-000000000013','c3100000-0000-0000-0000-000000000011',
    'stream-g3-provisional-account-cleanup-uid','Late source','',
    'uploading','private',current_setting('test.g3_registry_id')::uuid)$$,
  '55000',null,'a permanent account tombstone blocks the exact late callback before UID deletion');
select set_config('app.stream_media_operation_id','',true);
reset role;
select ok(exists(select 1 from public.stream_media_operation_uid_state state
    where state.operation_id='c3b11000-0000-0000-0000-000000000003'
      and state.registry_id=current_setting('test.g3_registry_id')::uuid
      and state.raw_provider_uid='stream-g3-provisional-account-cleanup-uid'
      and state.uid_state='reserved')
  and exists(select 1 from public.stream_media_operation_uid_state state
    where state.operation_id='c3b11000-0000-0000-0000-000000000003'
      and state.registry_id=current_setting('test.g3_registry_id')::uuid
      and state.raw_provider_uid='stream-g3-provisional-retained-control-uid'
      and state.uid_state='retained_attached'),
  'the account manifest separates the provisional UID from its unrelated retained UID');
select ok(exists(select 1 from public.stream_media_manifest_edges manifest
    join public.stream_media_source_bindings binding on binding.id=manifest.binding_id
    join public.stream_media_upload_contexts context on context.intent_id=current_setting('test.g3_provisional_intent_id')::uuid
    where manifest.operation_id='c3b11000-0000-0000-0000-000000000003'
      and manifest.binding_id=current_setting('test.g3_provisional_binding_id')::uuid
      and manifest.source_revision=context.source_revision
      and binding.source_revision=context.source_revision
      and manifest.raw_provider_uid='stream-g3-provisional-account-cleanup-uid'),
  'the crash-bound manifest preserves the original context revision and exact binding ID');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.start_stream_media_uid_delete(
  'c3b11000-0000-0000-0000-000000000003',current_setting('test.g3_registry_id')::uuid,
  'stream-g3-provisional-account-cleanup-uid','c3b11000-0000-0000-0000-000000000004',repeat('c',64)
)->>'outcome','delete_started','the account manifest starts deletion only for its exact UID');
select is(public.record_stream_media_uid_delete_result(
  'c3b11000-0000-0000-0000-000000000003',current_setting('test.g3_registry_id')::uuid,
  'stream-g3-provisional-account-cleanup-uid','delete_unknown',503::smallint,200::smallint,
  'c3b11000-0000-0000-0000-000000000005',repeat('d',64)
)->>'outcome','recorded','an ambiguous provider result remains unresolved');
select is(public.finalize_stream_media_cleanup(
  'c3b11000-0000-0000-0000-000000000003','c3b11000-0000-0000-0000-000000000006',repeat('e',64)
)->>'outcome','uid_outcomes_incomplete','unknown provider state cannot finalize the account manifest');
select is(public.prepare_stream_auth_deletion_permit(
  'c3b11000-0000-0000-0000-000000000001',1,
  'c3b11000-0000-0000-0000-000000000007','c3b11000-0000-0000-0000-000000000008',repeat('f',64)
)->>'outcome','account_cleanup_incomplete','unknown provider state cannot authorize Auth deletion');
select is(public.start_stream_media_uid_delete(
  'c3b11000-0000-0000-0000-000000000003',current_setting('test.g3_registry_id')::uuid,
  'stream-g3-provisional-account-cleanup-uid','c3b11000-0000-0000-0000-000000000009',repeat('1',64)
)->>'outcome','delete_started','the same UID can be retried after an unknown result');
select is(public.record_stream_media_uid_delete_result(
  'c3b11000-0000-0000-0000-000000000003',current_setting('test.g3_registry_id')::uuid,
  'stream-g3-provisional-account-cleanup-uid','already_absent_confirmed',null::smallint,404::smallint,
  'c3b11000-0000-0000-0000-000000000010',repeat('2',64)
)->>'outcome','recorded','only the exact UID GET 404 records terminal absence');
select is(public.finalize_stream_media_cleanup(
  'c3b11000-0000-0000-0000-000000000003','c3b11000-0000-0000-0000-000000000011',repeat('3',64)
)->>'outcome','account_cleanup_complete','account cleanup finalizes with exact provider absence evidence');
reset role;
select is((select receipt.response->>'state'
    from public.stream_media_finalization_receipts receipt
    where receipt.operation_id='c3b11000-0000-0000-0000-000000000003'
      and receipt.request_id='c3b11000-0000-0000-0000-000000000011'),
  'retained','one terminal provisional UID coexists with an unrelated retained UID');
select ok((select state.operation_state='provisional_bound'
    from public.stream_media_operations operation
    join public.stream_media_operation_states state on state.operation_id=operation.id
    where operation.id='c3b12000-0000-0000-0000-000000000005')
  and (select binding.binding_state='detached'
    from public.stream_media_source_bindings binding
    where binding.id=current_setting('test.g3_provisional_binding_id')::uuid)
  and not private.stream_upload_cleanup_proven(
    current_setting('test.g3_provisional_intent_id')::uuid,'c3100000-0000-0000-0000-000000000011')
  and private.stream_provisional_upload_cleanup_proven(
    current_setting('test.g3_provisional_intent_id')::uuid,'c3100000-0000-0000-0000-000000000011'),
  'account cleanup proves the exact provisional operation by original-revision terminal facts only');
-- Read private proof metadata and the internal tombstone digest as owner for the following RPC.
select set_config('test.g3_provisional_component_version',(
  select component.component_version::text from public.stream_auth_cleanup_components component
  where component.component_key='test_workflow'),true);
select set_config('test.g3_provisional_resource_set_revision',(
  select component.resource_set_revision::text from public.stream_auth_cleanup_components component
  where component.component_key='test_workflow'),true);
select set_config('test.g3_provisional_tombstone_digest',(
  select tombstone.source_revision_digest from public.stream_media_account_tombstones tombstone
  where tombstone.id='c3b11000-0000-0000-0000-000000000001'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.prepare_stream_auth_deletion_permit(
  'c3b11000-0000-0000-0000-000000000001',2,
  'c3b11000-0000-0000-0000-000000000007','c3b11000-0000-0000-0000-000000000012',repeat('4',64)
)->>'outcome','required_component_proofs_incomplete',
  'terminal provisional cleanup still cannot bypass required Auth component proofs');
select is(public.record_stream_auth_cleanup_component_proof(
  'c3b11000-0000-0000-0000-000000000001',2,'test_workflow',
  current_setting('test.g3_provisional_component_version')::bigint,
  current_setting('test.g3_provisional_resource_set_revision')::bigint,
  'ready',current_setting('test.g3_provisional_tombstone_digest'),repeat('5',64),
  'c3b11000-0000-0000-0000-000000000013'
)->>'outcome','recorded','the current workflow component proof is recorded for this tombstone');
select is(public.prepare_stream_auth_deletion_permit(
  'c3b11000-0000-0000-0000-000000000001',2,
  'c3b11000-0000-0000-0000-000000000007','c3b11000-0000-0000-0000-000000000014',repeat('6',64)
)->>'outcome','permit_ready','the exact terminal account manifest and current component set permit Auth deletion');
select is(public.finalize_stream_media_upload(
  'c3b12000-0000-0000-0000-000000000005','c3b12000-0000-0000-0000-000000000012',repeat('7',64)
)->>'outcome','provisional_binding_missing',
  'the preserved provisional upload cannot be finalized into a source after account cleanup');
reset role;
select ok(not exists(select 1 from public.videos video
    where video.id='c3200000-0000-0000-0000-000000000013'),
  'the tombstoned account has no late mutable source row');

-- Exercise Auth start, the actual profile cascade, and only then the confirmed result/completion.
-- This TAP transaction does not model a committed cross-request boundary; separate QA covers it.
select set_config('test.g3_provisional_permit_revision',(
  select permit.revision::text from public.stream_media_auth_deletion_permits permit
  where permit.id='c3b11000-0000-0000-0000-000000000007'),true);
select set_config('test.g3_provisional_tombstone_state_revision',(
  select tombstone.state_revision::text from public.stream_media_account_tombstones tombstone
  where tombstone.id='c3b11000-0000-0000-0000-000000000001'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.start_stream_auth_deletion_call(
  'c3b11000-0000-0000-0000-000000000007',
  current_setting('test.g3_provisional_permit_revision')::bigint,
  current_setting('test.g3_provisional_tombstone_state_revision')::bigint,
  'c3b11000-0000-0000-0000-000000000015',repeat('8',64)
)->>'outcome','started','the retained aggregate permit starts the Auth deletion call');
reset role;
select set_config('app.stream_media_operation_id','',true);
select set_config('request.jwt.claim.sub','',true);
select lives_ok($$delete from auth.users where id='c3100000-0000-0000-0000-000000000011'$$,
  'the Auth parent delete cascades the source-absent provisional profile under its started permit');
select ok(not exists(select 1 from auth.users where id='c3100000-0000-0000-0000-000000000011'),
  'the permitted source-absent synthetic Auth parent row is gone');
reset role;
select set_config('test.g3_provisional_permit_revision',(
  select permit.revision::text from public.stream_media_auth_deletion_permits permit
  where permit.id='c3b11000-0000-0000-0000-000000000007'),true);
select set_config('test.g3_provisional_tombstone_state_revision',(
  select tombstone.state_revision::text from public.stream_media_account_tombstones tombstone
  where tombstone.id='c3b11000-0000-0000-0000-000000000001'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('app.stream_media_operation_id','',true);
select is(public.record_stream_auth_deletion_result(
  'c3b11000-0000-0000-0000-000000000007',
  current_setting('test.g3_provisional_permit_revision')::bigint,
  current_setting('test.g3_provisional_tombstone_state_revision')::bigint,
  'confirmed','c3b11000-0000-0000-0000-000000000016',repeat('9',64)
)->>'outcome','recorded','Auth confirmation is recorded after the actual profile cascade');
reset role;
select set_config('test.g3_provisional_permit_revision',(
  select permit.revision::text from public.stream_media_auth_deletion_permits permit
  where permit.id='c3b11000-0000-0000-0000-000000000007'),true);
select set_config('test.g3_provisional_tombstone_state_revision',(
  select tombstone.state_revision::text from public.stream_media_account_tombstones tombstone
  where tombstone.id='c3b11000-0000-0000-0000-000000000001'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.complete_stream_auth_deletion(
  'c3b11000-0000-0000-0000-000000000007',
  current_setting('test.g3_provisional_permit_revision')::bigint,
  current_setting('test.g3_provisional_tombstone_state_revision')::bigint,
  'c3b11000-0000-0000-0000-000000000017',repeat('a',64)
)->>'outcome','completed','the same provisional Auth permit completes after cascade and confirmation');
reset role;
select ok(not exists(select 1 from public.profiles profile
    where profile.id='c3100000-0000-0000-0000-000000000011')
  and (select tombstone.tombstone_state='completed'
    from public.stream_media_account_tombstones tombstone
    where tombstone.id='c3b11000-0000-0000-0000-000000000001'),
  'the source-absent provisional account has a completed durable tombstone after deletion');

-- The same crash can happen after the exact source INSERT but before upload finalization.
-- A matching uploading row is eligible; a different identity cannot borrow the provisional UID.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('app.stream_media_operation_id','',true);
select is(public.record_stream_media_upload_intent(
  'c3b22000-0000-0000-0000-000000000001','c3b22000-0000-0000-0000-000000000002',
  'c3100000-0000-0000-0000-000000000012','library_video','video',
  'c3200000-0000-0000-0000-000000000014',0,current_setting('test.g3_registry_id')::uuid,
  'c3b22000-0000-0000-0000-000000000003',repeat('8',64)
)->>'outcome','recorded','the source-present crash fixture records a normal Library intent');
select is(public.record_stream_upload_context(
  'c3b22000-0000-0000-0000-000000000004','c3b22000-0000-0000-0000-000000000001',
  'profile','c3100000-0000-0000-0000-000000000012',
  'c3100000-0000-0000-0000-000000000012',1,repeat('9',64)
)->>'outcome','context_recorded','the second upload receives its exact owner profile fence');
select is(public.reserve_stream_media_upload(
  'c3b22000-0000-0000-0000-000000000010','c3b22000-0000-0000-0000-000000000005',
  'c3b22000-0000-0000-0000-000000000001',repeat('a',64)
)->>'outcome','reserved','the source-present crash fixture reserves its operation');
select is(public.advance_stream_media_upload(
  'c3b22000-0000-0000-0000-000000000010','c3b22000-0000-0000-0000-000000000006',
  'create_started',repeat('b',64)
)->>'outcome','advanced','the source-present provider create starts');
select is(public.advance_stream_media_upload(
  'c3b22000-0000-0000-0000-000000000010','c3b22000-0000-0000-0000-000000000007',
  'created_unverified',repeat('c',64)
)->>'outcome','advanced','the source-present create reply remains unverified');
select is(public.record_stream_media_upload_observation(
  'c3b22000-0000-0000-0000-000000000010',current_setting('test.g3_registry_id')::uuid,
  'exact_uid_get','stream-g3-provisional-source-row-uid',200::smallint,true,true,true,true,
  'c3b22000-0000-0000-0000-000000000008',repeat('d',64)
)->>'outcome','recorded','the source-present fixture has exact signed and ready readback evidence');
select set_config('test.g3_source_present_bind_result',public.bind_stream_media_upload_readback(
  'c3b22000-0000-0000-0000-000000000010','c3b22000-0000-0000-0000-000000000008',
  'c3b22000-0000-0000-0000-000000000009'
)::text,true);
select is(current_setting('test.g3_source_present_bind_result')::jsonb->>'outcome','provisional_bound',
  'the source-present crash fixture binds its exact provider readback');
select set_config('app.stream_media_operation_id','c3b22000-0000-0000-0000-000000000010',true);
insert into public.videos(
  id,coach_id,cloudflare_uid,title,description,status,visibility,stream_provider_account_registry_id
) values (
  'c3200000-0000-0000-0000-000000000014','c3100000-0000-0000-0000-000000000012',
  'stream-g3-provisional-source-row-uid','Synthetic provisional source','',
  'uploading','private',current_setting('test.g3_registry_id')::uuid
);
select set_config('app.stream_media_operation_id','',true);
select set_config('test.g3_source_present_binding_id',
  current_setting('test.g3_source_present_bind_result')::jsonb->>'binding_id',true);
reset role;
select ok(exists(select 1 from public.videos video
    where video.id='c3200000-0000-0000-0000-000000000014'
      and video.coach_id='c3100000-0000-0000-0000-000000000012'
      and video.cloudflare_uid='stream-g3-provisional-source-row-uid'
      and video.stream_provider_account_registry_id=current_setting('test.g3_registry_id')::uuid
      and video.status::text='uploading')
  and private.stream_provisional_upload_account_cleanup_eligible(
    current_setting('test.g3_source_present_binding_id')::uuid,
    'c3100000-0000-0000-0000-000000000012')
  and not private.stream_provisional_upload_account_cleanup_eligible(
    current_setting('test.g3_source_present_binding_id')::uuid,
    'c3100000-0000-0000-0000-000000000011'),
  'a matching owner, UID, registry, and uploading source row is eligible before finalization');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('app.stream_media_operation_id','c3b22000-0000-0000-0000-000000000004',true);
select throws_ok($$insert into public.videos(
    id,coach_id,cloudflare_uid,title,description,status,visibility,stream_provider_account_registry_id
  ) values ('c3200000-0000-0000-0000-000000000015','c3100000-0000-0000-0000-000000000012',
    'stream-g3-mismatched-provisional-source-uid','Mismatched source','',
    'uploading','private',current_setting('test.g3_registry_id')::uuid)$$,
  '42501',null,'a different source identity cannot claim the provisional upload UID');
select set_config('app.stream_media_operation_id','',true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.begin_stream_account_media_cleanup(
  'c3b21000-0000-0000-0000-000000000001','c3100000-0000-0000-0000-000000000012',
  'c3b21000-0000-0000-0000-000000000002',repeat('e',64),
  'c3b21000-0000-0000-0000-000000000003',repeat('f',64)
)->>'outcome','reserved','account cleanup accepts the exact provisional upload with its source row already inserted');
reset role;
select ok(exists(select 1 from public.stream_media_manifest_edges manifest
    join public.stream_media_source_bindings binding on binding.id=manifest.binding_id
    where manifest.operation_id='c3b21000-0000-0000-0000-000000000003'
      and manifest.binding_id=current_setting('test.g3_source_present_binding_id')::uuid
      and manifest.registry_id=current_setting('test.g3_registry_id')::uuid
      and manifest.raw_provider_uid='stream-g3-provisional-source-row-uid'
      and binding.source_identity='c3200000-0000-0000-0000-000000000014'),
  'the exact source-present provisional binding remains in the account manifest');

set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.start_stream_media_uid_delete(
  'c3b21000-0000-0000-0000-000000000003',current_setting('test.g3_registry_id')::uuid,
  'stream-g3-provisional-source-row-uid','c3b21000-0000-0000-0000-000000000004',repeat('1',64)
)->>'outcome','delete_started','source-present provisional cleanup starts the exact provider UID');
select is(public.record_stream_media_uid_delete_result(
  'c3b21000-0000-0000-0000-000000000003',current_setting('test.g3_registry_id')::uuid,
  'stream-g3-provisional-source-row-uid','deleted_confirmed',204::smallint,404::smallint,
  'c3b21000-0000-0000-0000-000000000005',repeat('2',64)
)->>'outcome','recorded','source-present provisional cleanup records exact delete and GET evidence');
select is(public.finalize_stream_media_cleanup(
  'c3b21000-0000-0000-0000-000000000003','c3b21000-0000-0000-0000-000000000006',repeat('3',64)
)->>'outcome','account_cleanup_complete','source-present provisional account cleanup reaches a durable terminal receipt');
reset role;
select ok(private.stream_provisional_upload_cleanup_proven(
    'c3b22000-0000-0000-0000-000000000001','c3100000-0000-0000-0000-000000000012')
  and exists(select 1 from public.videos video
    where video.id='c3200000-0000-0000-0000-000000000014'
      and video.status::text='uploading'),
  'source-present provisional proof stays exact after account finalization and before profile cascade');
select set_config('test.g3_source_present_component_version',(
  select component.component_version::text from public.stream_auth_cleanup_components component
  where component.component_key='test_workflow'),true);
select set_config('test.g3_source_present_resource_set_revision',(
  select component.resource_set_revision::text from public.stream_auth_cleanup_components component
  where component.component_key='test_workflow'),true);
select set_config('test.g3_source_present_tombstone_digest',(
  select tombstone.source_revision_digest from public.stream_media_account_tombstones tombstone
  where tombstone.id='c3b21000-0000-0000-0000-000000000001'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.prepare_stream_auth_deletion_permit(
  'c3b21000-0000-0000-0000-000000000001',2,
  'c3b21000-0000-0000-0000-000000000007','c3b21000-0000-0000-0000-000000000008',repeat('4',64)
)->>'outcome','required_component_proofs_incomplete',
  'source-present provisional cleanup cannot skip its required Auth component proof');
select is(public.record_stream_auth_cleanup_component_proof(
  'c3b21000-0000-0000-0000-000000000001',2,'test_workflow',
  current_setting('test.g3_source_present_component_version')::bigint,
  current_setting('test.g3_source_present_resource_set_revision')::bigint,
  'ready',current_setting('test.g3_source_present_tombstone_digest'),repeat('5',64),
  'c3b21000-0000-0000-0000-000000000009'
)->>'outcome','recorded','the current workflow proof is recorded for the source-present tombstone');
select is(public.prepare_stream_auth_deletion_permit(
  'c3b21000-0000-0000-0000-000000000001',2,
  'c3b21000-0000-0000-0000-000000000007','c3b21000-0000-0000-0000-000000000010',repeat('6',64)
)->>'outcome','permit_ready','exact source-present terminal evidence plus current components permits Auth deletion');
reset role;
select set_config('test.g3_source_present_permit_revision',(
  select permit.revision::text from public.stream_media_auth_deletion_permits permit
  where permit.id='c3b21000-0000-0000-0000-000000000007'),true);
select set_config('test.g3_source_present_tombstone_state_revision',(
  select tombstone.state_revision::text from public.stream_media_account_tombstones tombstone
  where tombstone.id='c3b21000-0000-0000-0000-000000000001'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.start_stream_auth_deletion_call(
  'c3b21000-0000-0000-0000-000000000007',
  current_setting('test.g3_source_present_permit_revision')::bigint,
  current_setting('test.g3_source_present_tombstone_state_revision')::bigint,
  'c3b21000-0000-0000-0000-000000000011',repeat('7',64)
)->>'outcome','started','the source-present provisional permit starts its Auth call');
reset role;
select set_config('app.stream_media_operation_id','',true);
select set_config('request.jwt.claim.sub','',true);
select lives_ok($$delete from auth.users where id='c3100000-0000-0000-0000-000000000012'$$,
  'the Auth parent delete cascades the source-present uploading profile under its started permit');
select ok(not exists(select 1 from auth.users where id='c3100000-0000-0000-0000-000000000012'),
  'the permitted source-present synthetic Auth parent row is gone');
reset role;
select set_config('test.g3_source_present_permit_revision',(
  select permit.revision::text from public.stream_media_auth_deletion_permits permit
  where permit.id='c3b21000-0000-0000-0000-000000000007'),true);
select set_config('test.g3_source_present_tombstone_state_revision',(
  select tombstone.state_revision::text from public.stream_media_account_tombstones tombstone
  where tombstone.id='c3b21000-0000-0000-0000-000000000001'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('app.stream_media_operation_id','',true);
select is(public.record_stream_auth_deletion_result(
  'c3b21000-0000-0000-0000-000000000007',
  current_setting('test.g3_source_present_permit_revision')::bigint,
  current_setting('test.g3_source_present_tombstone_state_revision')::bigint,
  'confirmed','c3b21000-0000-0000-0000-000000000012',repeat('8',64)
)->>'outcome','recorded','source-present Auth confirmation follows the actual profile cascade');
reset role;
select set_config('test.g3_source_present_permit_revision',(
  select permit.revision::text from public.stream_media_auth_deletion_permits permit
  where permit.id='c3b21000-0000-0000-0000-000000000007'),true);
select set_config('test.g3_source_present_tombstone_state_revision',(
  select tombstone.state_revision::text from public.stream_media_account_tombstones tombstone
  where tombstone.id='c3b21000-0000-0000-0000-000000000001'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.complete_stream_auth_deletion(
  'c3b21000-0000-0000-0000-000000000007',
  current_setting('test.g3_source_present_permit_revision')::bigint,
  current_setting('test.g3_source_present_tombstone_state_revision')::bigint,
  'c3b21000-0000-0000-0000-000000000013',repeat('9',64)
)->>'outcome','completed','the source-present provisional permit completes after cascade and confirmation');
reset role;
select ok(not exists(select 1 from public.profiles profile
    where profile.id='c3100000-0000-0000-0000-000000000012')
  and not exists(select 1 from public.videos video
    where video.id='c3200000-0000-0000-0000-000000000014')
  and (select tombstone.tombstone_state='completed'
    from public.stream_media_account_tombstones tombstone
    where tombstone.id='c3b21000-0000-0000-0000-000000000001')
  and private.stream_provisional_upload_cleanup_proven(
    'c3b22000-0000-0000-0000-000000000001','c3100000-0000-0000-0000-000000000012'),
  'source-present provisional history stays proven after its real profile and video cascade');

reset role;
select * from finish();
rollback;
