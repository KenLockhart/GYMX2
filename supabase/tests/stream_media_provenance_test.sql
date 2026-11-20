begin;
select no_plan();

-- Only synthetic identities and media markers are used. This suite is rollback-only and
-- exercises the inert provenance ledger after migrations 1550, 1560, and Gate 2.
insert into auth.users (id, email, raw_user_meta_data) values
  ('f1000000-0000-0000-0000-000000000001', 'stream-provenance-coach@example.test', '{"display_name":"Synthetic Coach"}'),
  ('f1000000-0000-0000-0000-000000000002', 'stream-provenance-member@example.test', '{"display_name":"Synthetic Member"}'),
  ('f1000000-0000-0000-0000-000000000003', 'stream-provenance-legacy-coach@example.test', '{"display_name":"Synthetic Legacy Coach"}');
update public.profiles set role = 'coach'
where id in (
  'f1000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000003'
);

insert into public.videos (id, coach_id, cloudflare_uid, title, description)
values (
  'f3000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000003',
  ' legacy UID / invalid-format! ',
  'Synthetic legacy video',
  ''
);
insert into public.videos (
  id, coach_id, cloudflare_uid, title, description, status, visibility
) values
  (
    'f3000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000001',
    'synthetic-paid-stream-uid', 'Synthetic paid fixture', '', 'ready', 'private'
  ),
  (
    'f3000000-0000-0000-0000-000000000003',
    'f1000000-0000-0000-0000-000000000001',
    'synthetic-free-stream-uid', 'Synthetic free fixture', '', 'ready', 'private'
  );

-- Build a real synthetic free/current/pinned/paid Program reference graph so capture coverage
-- assertions exercise each join rather than assuming an empty baseline.
insert into public.programs (id, coach_id, title, description, published, platform_owned)
values (
  'f7000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000001',
  'Synthetic provenance Program', '', true, false
);
insert into public.program_content_versions (
  id, program_id, revision_number, revision_kind, lesson_count, created_by
) values ('f7100000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 2, 'current', 1, 'f1000000-0000-0000-0000-000000000001');
insert into public.program_content_versions (
  id, program_id, revision_number, revision_kind, lesson_count, created_by
) values ('f7100000-0000-0000-0000-000000000002', 'f7000000-0000-0000-0000-000000000001', 3, 'free_snapshot', 1, 'f1000000-0000-0000-0000-000000000001');
insert into public.program_content_versions (
  id, program_id, revision_number, revision_kind, lesson_count, created_by
) values ('f7100000-0000-0000-0000-000000000003', 'f7000000-0000-0000-0000-000000000001', 4, 'paid', 1, 'f1000000-0000-0000-0000-000000000001');
insert into public.program_content_version_lessons (
  id, program_id, content_version_id, lesson_ordinal, timeline_day_number,
  title, instructions, pillar, video_id, video_creator_id, cloudflare_uid,
  cloudflare_signed_urls_verified
) values
  (
    'f7300000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001',
    'f7100000-0000-0000-0000-000000000001', 1, 1,
    'Synthetic current lesson', '', 'body', 'f3000000-0000-0000-0000-000000000003',
    'f1000000-0000-0000-0000-000000000001', 'synthetic-free-stream-uid', false
  ),
  (
    'f7300000-0000-0000-0000-000000000002', 'f7000000-0000-0000-0000-000000000001',
    'f7100000-0000-0000-0000-000000000002', 1, 1,
    'Synthetic pinned free lesson', '', 'body', 'f3000000-0000-0000-0000-000000000003',
    'f1000000-0000-0000-0000-000000000001', 'synthetic-free-stream-uid', false
  ),
  (
    'f7300000-0000-0000-0000-000000000003', 'f7000000-0000-0000-0000-000000000001',
    'f7100000-0000-0000-0000-000000000003', 1, 1,
    'Synthetic paid lesson', '', 'body', 'f3000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000001', 'synthetic-paid-stream-uid', true
  );
insert into public.program_offer_versions (
  id, program_id, offer_number, content_version_id, offer_kind, list_price_cents,
  currency, max_installments, platform_owned, seller_profile_id, connected_account_id, created_by
) values (
  'f7200000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 2,
  'f7100000-0000-0000-0000-000000000001', 'free', 0, 'usd', 1, false,
  'f1000000-0000-0000-0000-000000000001', null, 'f1000000-0000-0000-0000-000000000001'
);
insert into public.program_offer_versions (
  id, program_id, offer_number, content_version_id, offer_kind, list_price_cents,
  currency, max_installments, platform_owned, seller_profile_id, connected_account_id, created_by
) values (
  'f7200000-0000-0000-0000-000000000002', 'f7000000-0000-0000-0000-000000000001', 3,
  'f7100000-0000-0000-0000-000000000002', 'free', 0, 'usd', 1, false,
  'f1000000-0000-0000-0000-000000000001', null, 'f1000000-0000-0000-0000-000000000001'
);
insert into public.program_offer_versions (
  id, program_id, offer_number, content_version_id, offer_kind, list_price_cents,
  currency, max_installments, platform_owned, seller_profile_id, connected_account_id, created_by
) values (
  'f7200000-0000-0000-0000-000000000003', 'f7000000-0000-0000-0000-000000000001', 4,
  'f7100000-0000-0000-0000-000000000003', 'paid', 100, 'usd', 1, false,
  'f1000000-0000-0000-0000-000000000001', 'acct_synthetic', 'f1000000-0000-0000-0000-000000000001'
);
update public.program_commerce_state
set current_content_version_id = 'f7100000-0000-0000-0000-000000000001',
    current_offer_version_id = 'f7200000-0000-0000-0000-000000000001'
where program_id = 'f7000000-0000-0000-0000-000000000001';
insert into public.program_enrollments (
  id, program_id, member_id, started_on, content_version_id
) values (
  'f7400000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000002', current_date, 'f7100000-0000-0000-0000-000000000002'
);
insert into public.program_orders (
  id, idempotency_key, buyer_id, program_id, offer_version_id, content_version_id,
  lesson_count, seller_profile_id, platform_owned, connected_account_id,
  application_fee_basis_points, currency, list_price_cents, discount_cents,
  effective_total_cents, payment_plan, installment_count, installment_amounts_cents
) values (
  'f7500000-0000-0000-0000-000000000001', 'synthetic-media-order',
  'f1000000-0000-0000-0000-000000000002', 'f7000000-0000-0000-0000-000000000001',
  'f7200000-0000-0000-0000-000000000003', 'f7100000-0000-0000-0000-000000000003',
  1, 'f1000000-0000-0000-0000-000000000001', false, 'acct_synthetic',
  1000, 'usd', 100, 0, 100, 'pay_in_full', 1, array[100]
);
insert into public.posts (id, author_id, kind, body, audience)
values (
  'f4000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000002',
  'general', '', 'everyone'
);
insert into public.post_media (id, post_id, kind, video_uid, position)
values (
  'f5000000-0000-0000-0000-000000000001',
  'f4000000-0000-0000-0000-000000000001',
  'video', 'same-uid-across-accounts', 0
);

select ok(not has_table_privilege('anon', 'public.stream_provider_account_registry', 'select'),
  'anonymous clients cannot read provider account identities');
select is((select count(*)::integer from public.stream_provider_account_registry), 0,
  'the migration does not seed or infer a provider account');
select ok(not has_table_privilege('authenticated', 'public.stream_media_upload_intents', 'select'),
  'authenticated clients cannot read upload intents');
select ok(not has_table_privilege('service_role', 'public.stream_media_upload_intents', 'insert'),
  'service clients cannot bypass intent RPC validation with direct table inserts');
select ok(not has_table_privilege('service_role', 'public.stream_media_legacy_observations', 'update'),
  'service clients cannot rewrite legacy observations');
select ok(not exists (
  select 1
  from (values
    ('public.stream_provider_account_registry'::regclass),
    ('public.stream_provider_account_attestations'::regclass),
    ('public.stream_media_upload_intents'::regclass),
    ('public.stream_provider_object_observations'::regclass),
    ('public.stream_source_binding_observations'::regclass),
    ('public.stream_media_capture_runs'::regclass),
    ('public.stream_media_legacy_observations'::regclass)
  ) as tables(table_id)
  where not (select relation.relrowsecurity from pg_class relation where relation.oid = tables.table_id)
), 'row-level security is enabled for every provenance evidence table');
select ok(not exists (
  select 1
  from (values
    ('anon'::name, 'public.stream_provider_account_registry'::text),
    ('anon', 'public.stream_provider_account_attestations'),
    ('anon', 'public.stream_media_upload_intents'),
    ('anon', 'public.stream_provider_object_observations'),
    ('anon', 'public.stream_source_binding_observations'),
    ('anon', 'public.stream_media_capture_runs'),
    ('anon', 'public.stream_media_legacy_observations'),
    ('authenticated', 'public.stream_provider_account_registry'),
    ('authenticated', 'public.stream_provider_account_attestations'),
    ('authenticated', 'public.stream_media_upload_intents'),
    ('authenticated', 'public.stream_provider_object_observations'),
    ('authenticated', 'public.stream_source_binding_observations'),
    ('authenticated', 'public.stream_media_capture_runs'),
    ('authenticated', 'public.stream_media_legacy_observations'),
    ('service_role', 'public.stream_provider_account_registry'),
    ('service_role', 'public.stream_provider_account_attestations'),
    ('service_role', 'public.stream_media_upload_intents'),
    ('service_role', 'public.stream_provider_object_observations'),
    ('service_role', 'public.stream_source_binding_observations'),
    ('service_role', 'public.stream_media_capture_runs'),
    ('service_role', 'public.stream_media_legacy_observations')
  ) as grants(role_name, table_name)
  where has_table_privilege(grants.role_name, grants.table_name, 'select')
     or has_table_privilege(grants.role_name, grants.table_name, 'insert')
     or has_table_privilege(grants.role_name, grants.table_name, 'update')
     or has_table_privilege(grants.role_name, grants.table_name, 'delete')
), 'all evidence tables deny direct data access even to the service role');
select ok(not exists (
  select 1
  from (values
    ('public.record_stream_provider_account_attestation(uuid,text,text,text)'::text),
    ('public.record_stream_media_upload_intent(uuid,uuid,uuid,text,text,uuid,bigint,uuid,uuid,text)'),
    ('public.record_stream_provider_object_observation(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text)'),
    ('public.record_stream_source_binding_observation(uuid,uuid,uuid,uuid,text)'),
    ('public.capture_legacy_stream_media(uuid,text)')
  ) as rpc_signatures(signature)
  where has_function_privilege('anon', rpc_signatures.signature, 'execute')
     or has_function_privilege('authenticated', rpc_signatures.signature, 'execute')
     or not has_function_privilege('service_role', rpc_signatures.signature, 'execute')
), 'each service RPC is executable only by the trusted service role');
select ok(has_function_privilege('service_role', 'public.record_stream_provider_account_attestation(uuid,text,text,text)', 'execute'),
  'only the trusted service role receives account-attestation RPC access');
select ok(not has_function_privilege('authenticated', 'public.record_stream_provider_account_attestation(uuid,text,text,text)', 'execute'),
  'authenticated users cannot bootstrap provider account identities');
select ok(not has_function_privilege('authenticated', 'public.record_stream_provider_object_observation(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text)', 'execute'),
  'authenticated users cannot forge provider object observations');
select ok(has_function_privilege('service_role', 'public.record_stream_media_upload_intent(uuid,uuid,uuid,text,text,uuid,bigint,uuid,uuid,text)', 'execute'),
  'the trusted service can record immutable upload intent identity');
select ok(not has_function_privilege('anon', 'public.capture_legacy_stream_media(uuid,text)', 'execute'),
  'anonymous callers cannot capture internal legacy media references');
select ok(not has_function_privilege('authenticated', 'public.capture_legacy_stream_media(uuid,text)', 'execute'),
  'authenticated callers cannot inspect the legacy media inventory');
select ok(has_function_privilege('service_role', 'public.capture_legacy_stream_media(uuid,text)', 'execute'),
  'the trusted service can create a bounded non-authoritative capture');
select ok(not exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'stream_media_upload_intents'
    and column_name ilike '%url%'
), 'upload intent rows never store raw upload URLs');
select ok(not exists (
  select 1 from pg_constraint constraint_row
  where constraint_row.contype = 'f'
    and constraint_row.conrelid = 'public.stream_media_legacy_observations'::regclass
    and constraint_row.confrelid in (
      'public.videos'::regclass, 'public.posts'::regclass, 'public.post_media'::regclass,
      'public.programs'::regclass, 'public.program_enrollments'::regclass,
      'public.program_content_versions'::regclass, 'public.program_content_version_lessons'::regclass,
      'public.program_offer_versions'::regclass, 'public.program_orders'::regclass
    )
), 'legacy observations have no cascading foreign keys to mutable sources');

set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('test.stream_capture_result', public.capture_legacy_stream_media(
  'f6000000-0000-0000-0000-000000000001', repeat('1', 64)
)::text, true);
select is(current_setting('test.stream_capture_result')::jsonb->>'outcome', 'captured',
  'legacy capture is recorded once as a bounded observation run');
select is(current_setting('test.stream_capture_result')::jsonb->>'coverage', 'unguarded_incomplete',
  'capture reports the known unguarded writer coverage');
select is(current_setting('test.stream_capture_result')::jsonb->>'authoritative', 'false',
  'capture explicitly remains non-authoritative');
select ok(not (current_setting('test.stream_capture_result')::jsonb ? 'safe_to_delete')
  and not (current_setting('test.stream_capture_result')::jsonb ? 'delete_allowed'),
  'capture returns no deletion authorization');
select is(public.capture_legacy_stream_media(
  'f6000000-0000-0000-0000-000000000001', repeat('1', 64)
)->>'outcome', 'already_captured', 'an exact capture retry returns the same immutable run');
select is(public.capture_legacy_stream_media(
  'f6000000-0000-0000-0000-000000000001', repeat('2', 64)
)->>'outcome', 'identity_mismatch', 'a capture ID cannot be replayed with a different digest');
select set_config('test.stream_account_one', public.record_stream_provider_account_attestation(
  'f6100000-0000-0000-0000-000000000001', repeat('a', 32), 'vod_primary', repeat('a', 64)
)->>'registry_id', true);
select is(public.record_stream_provider_account_attestation(
  'f6100000-0000-0000-0000-000000000001', repeat('a', 32), 'vod_primary', repeat('a', 64)
)->>'outcome', 'already_recorded', 'an exact account-attestation retry is idempotent');
select is(public.record_stream_provider_account_attestation(
  'f6100000-0000-0000-0000-000000000001', repeat('a', 32), 'vod_primary', repeat('a', 64)
)->>'attestation_kind', 'trusted_service_account_binding_report',
  'account registration stores a service report without claiming HTTP verification');
select is(public.record_stream_provider_account_attestation(
  'f6100000-0000-0000-0000-000000000001', repeat('b', 32), 'vod_primary', repeat('a', 64)
)->>'outcome', 'identity_mismatch', 'a request cannot be rebound to another account');
select is(public.record_stream_provider_account_attestation(
  'f6100000-0000-0000-0000-000000000002', repeat('a', 32), 'vod_secondary', repeat('a', 64)
)->>'outcome', 'identity_mismatch', 'one provider account cannot be silently assigned to a second credential slot');
select set_config('test.stream_account_two', public.record_stream_provider_account_attestation(
  'f6100000-0000-0000-0000-000000000003', repeat('b', 32), 'vod_secondary', repeat('b', 64)
)->>'registry_id', true);
select is(public.record_stream_provider_account_attestation(
  'f6100000-0000-0000-0000-000000000004', repeat('c', 32), 'vod_secondary', repeat('c', 64)
)->>'outcome', 'identity_mismatch', 'a fixed credential slot cannot be rebound to a different account');

select set_config('test.stream_intent_one', public.record_stream_media_upload_intent(
  'f6200000-0000-0000-0000-000000000001', 'f6210000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000001', 'library_video', 'video',
  'f6300000-0000-0000-0000-000000000001', 7,
  current_setting('test.stream_account_one')::uuid,
  'f6400000-0000-0000-0000-000000000001', repeat('c', 64)
)->>'intent_id', true);
select is(public.record_stream_media_upload_intent(
  'f6200000-0000-0000-0000-000000000001', 'f6210000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000001', 'library_video', 'video',
  'f6300000-0000-0000-0000-000000000001', 7,
  current_setting('test.stream_account_one')::uuid,
  'f6400000-0000-0000-0000-000000000001', repeat('c', 64)
)->>'outcome', 'same_intent', 'an exact upload intent retry returns the same immutable identity');
select is(public.record_stream_media_upload_intent(
  'f6200000-0000-0000-0000-000000000001', 'f6210000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000001', 'library_video', 'video',
  'f6300000-0000-0000-0000-000000000001', 7,
  current_setting('test.stream_account_one')::uuid,
  'f6400000-0000-0000-0000-000000000001', repeat('c', 64)
)->>'source_guard_state', 'pending_source_guard',
  'recording an intent does not authorize HTTP upload or prove ownership');
select is(public.record_stream_media_upload_intent(
  'f6200000-0000-0000-0000-000000000001', 'f6210000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000001', 'library_video', 'video',
  'f6300000-0000-0000-0000-000000000002', 7,
  current_setting('test.stream_account_one')::uuid,
  'f6400000-0000-0000-0000-000000000001', repeat('c', 64)
)->>'outcome', 'identity_mismatch', 'an intent cannot be rebound to a different source UUID');
select is(public.record_stream_media_upload_intent(
  'f6200000-0000-0000-0000-000000000002', 'f6210000-0000-0000-0000-000000000002',
  'f1000000-0000-0000-0000-000000000001', 'library_video', 'video',
  'f6300000-0000-0000-0000-000000000002', 7,
  current_setting('test.stream_account_one')::uuid,
  'f6400000-0000-0000-0000-000000000001', repeat('c', 64)
)->>'outcome', 'identity_mismatch', 'an upload marker cannot be reused for a new intent');
select throws_ok(
  $$select public.record_stream_media_upload_intent(
    'f6200000-0000-0000-0000-000000000003', 'f6210000-0000-0000-0000-000000000003',
    'f1000000-0000-0000-0000-000000000001', 'library_video', 'video',
    'f6300000-0000-0000-0000-000000000003', 7,
    current_setting('test.stream_account_one')::uuid,
    'f6400000-0000-0000-0000-000000000003', null
  )$$,
  '22023', null, 'an intent without its normalized request digest is rejected');

select set_config('test.stream_intent_two', public.record_stream_media_upload_intent(
  'f6200000-0000-0000-0000-000000000004', 'f6210000-0000-0000-0000-000000000004',
  'f1000000-0000-0000-0000-000000000001', 'library_video', 'video',
  'f6300000-0000-0000-0000-000000000004', 1,
  current_setting('test.stream_account_two')::uuid,
  'f6400000-0000-0000-0000-000000000004', repeat('d', 64)
)->>'intent_id', true);
select set_config('test.stream_provider_observation_one', public.record_stream_provider_object_observation(
  'f6500000-0000-0000-0000-000000000001', 'f6510000-0000-0000-0000-000000000001',
  current_setting('test.stream_intent_one')::uuid,
  current_setting('test.stream_account_one')::uuid, repeat('a', 32),
  'same-uid-across-accounts', 'retrieve_report', 'reported_present', 'reported_true',
  'reported_match', repeat('e', 64)
)->>'observation_id', true);
select set_config('test.stream_provider_observation_two', public.record_stream_provider_object_observation(
  'f6500000-0000-0000-0000-000000000002', 'f6510000-0000-0000-0000-000000000002',
  current_setting('test.stream_intent_two')::uuid,
  current_setting('test.stream_account_two')::uuid, repeat('b', 32),
  'same-uid-across-accounts', 'retrieve_report', 'reported_present', 'reported_true',
  'reported_match', repeat('f', 64)
)->>'observation_id', true);
reset role;
select is((
  select count(*)::integer from public.stream_provider_object_observations observation
  where observation.provider_uid = 'same-uid-across-accounts'
), 2, 'the same raw UID is recorded separately for each explicit provider account');
select is((
  select count(distinct observation.provider_account_registry_id)::integer
  from public.stream_provider_object_observations observation
  where observation.provider_uid = 'same-uid-across-accounts'
), 2, 'account-scoped observations never merge by UID alone');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.record_stream_provider_object_observation(
  'f6500000-0000-0000-0000-000000000001', 'f6510000-0000-0000-0000-000000000001',
  current_setting('test.stream_intent_one')::uuid,
  current_setting('test.stream_account_one')::uuid, repeat('a', 32),
  'same-uid-across-accounts', 'retrieve_report', 'reported_present', 'reported_true',
  'reported_match', repeat('e', 64)
)->>'outcome', 'already_recorded', 'provider observation retries are exact and idempotent');
select throws_ok(
  $$select public.record_stream_provider_object_observation(
    'f6500000-0000-0000-0000-000000000003', 'f6510000-0000-0000-0000-000000000003',
    current_setting('test.stream_intent_one')::uuid,
    current_setting('test.stream_account_one')::uuid, repeat('a', 32),
    'same-uid-across-accounts', 'verified', 'reported_present', 'reported_true',
    'reported_match', repeat('e', 64)
  )$$,
  '22023', null, 'provider evidence cannot transition directly to a verified asset state');
select is(public.record_stream_provider_object_observation(
  'f6500000-0000-0000-0000-000000000001', 'f6510000-0000-0000-0000-000000000001',
  current_setting('test.stream_intent_one')::uuid,
  current_setting('test.stream_account_two')::uuid, repeat('b', 32),
  'same-uid-across-accounts', 'retrieve_report', 'reported_present', 'reported_true',
  'reported_match', repeat('e', 64)
)->>'outcome', 'identity_mismatch', 'an observation cannot be rebound to a different account');
select ok(not (public.record_stream_provider_object_observation(
  'f6500000-0000-0000-0000-000000000003', 'f6510000-0000-0000-0000-000000000003',
  current_setting('test.stream_intent_one')::uuid,
  current_setting('test.stream_account_one')::uuid, repeat('a', 32),
  'uid-that-is-not-validated', 'retrieve_report', 'reported_present', 'reported_true',
  'reported_match', repeat('e', 64)
) ? 'safe_to_delete'), 'provider reports do not return deletion authorization');

select is(public.record_stream_source_binding_observation(
  'f6600000-0000-0000-0000-000000000001', 'f6610000-0000-0000-0000-000000000001',
  current_setting('test.stream_intent_one')::uuid,
  current_setting('test.stream_provider_observation_one')::uuid, repeat('9', 64)
)->>'binding_state', 'pending_source_guard',
  'an exact provider/source observation stays pending until source writers are guarded');
select is(public.record_stream_source_binding_observation(
  'f6600000-0000-0000-0000-000000000001', 'f6610000-0000-0000-0000-000000000001',
  current_setting('test.stream_intent_one')::uuid,
  current_setting('test.stream_provider_observation_one')::uuid, repeat('9', 64)
)->>'outcome', 'already_recorded', 'source-binding observations have exact idempotent replay');
select ok(not (public.record_stream_source_binding_observation(
  'f6600000-0000-0000-0000-000000000001', 'f6610000-0000-0000-0000-000000000001',
  current_setting('test.stream_intent_one')::uuid,
  current_setting('test.stream_provider_observation_one')::uuid, repeat('9', 64)
) ? 'safe_to_delete'), 'source-binding observations never return deletion permission');
select is(public.record_stream_source_binding_observation(
  'f6600000-0000-0000-0000-000000000002', 'f6610000-0000-0000-0000-000000000002',
  current_setting('test.stream_intent_one')::uuid,
  current_setting('test.stream_provider_observation_two')::uuid, repeat('9', 64)
)->>'outcome', 'identity_mismatch', 'provider evidence from another account cannot bind to this intent');
select throws_ok(
  $$select public.record_stream_source_binding_observation(
    'f6600000-0000-0000-0000-000000000003', 'f6610000-0000-0000-0000-000000000003',
    current_setting('test.stream_intent_one')::uuid,
    current_setting('test.stream_provider_observation_one')::uuid, 'not-a-sha256-digest'
  )$$,
  '22023', null, 'source-binding evidence requires an explicit digest');
select is(public.record_stream_source_binding_observation(
  'f6600000-0000-0000-0000-000000000004', 'f6610000-0000-0000-0000-000000000004',
  current_setting('test.stream_intent_one')::uuid,
  'f6500000-0000-0000-0000-000000000099', repeat('9', 64)
)->>'outcome', 'evidence_missing', 'source binding cannot be created without a provider observation');
reset role;

select is((
  select count(*)::integer from public.stream_media_legacy_observations observation
  where observation.capture_run_id = 'f6000000-0000-0000-0000-000000000001'
    and observation.source_kind = 'videos'
    and observation.source_identity = 'f3000000-0000-0000-0000-000000000001'
    and observation.captured_uid = ' legacy UID / invalid-format! '
    and observation.account_state = 'unknown'
    and observation.provider_account_registry_id is null
), 1, 'capture preserves malformed legacy UID text and leaves its account explicitly unknown');
select is((
  select count(*)::integer from public.stream_media_legacy_observations observation
  where observation.capture_run_id = 'f6000000-0000-0000-0000-000000000001'
    and observation.source_kind = 'post_media'
    and observation.source_identity = 'f5000000-0000-0000-0000-000000000001'
    and observation.captured_uid = 'same-uid-across-accounts'
    and observation.account_state = 'unknown'
), 1, 'legacy post UID observation remains distinct from account-scoped provider reports');
select is((
  select count(*)::integer from public.stream_media_legacy_observations observation
  where observation.capture_run_id = 'f6000000-0000-0000-0000-000000000001'
    and observation.source_kind = 'program_content_version_lessons'
    and observation.source_identity = 'f7300000-0000-0000-0000-000000000001'
    and observation.reference_kind = 'current_program_lesson'
    and observation.captured_uid = 'synthetic-free-stream-uid'
), 1, 'capture records the current Program lesson reference');
select is((
  select count(*)::integer from public.stream_media_legacy_observations observation
  where observation.capture_run_id = 'f6000000-0000-0000-0000-000000000001'
    and observation.source_kind = 'program_content_version_lessons'
    and observation.source_identity = 'f7300000-0000-0000-0000-000000000002'
    and observation.reference_kind = 'free_snapshot_lesson'
    and observation.captured_uid = 'synthetic-free-stream-uid'
), 1, 'capture records the immutable free snapshot lesson');
select is((
  select count(*)::integer from public.stream_media_legacy_observations observation
  where observation.capture_run_id = 'f6000000-0000-0000-0000-000000000001'
    and observation.source_kind = 'program_content_version_lessons'
    and observation.source_identity = 'f7300000-0000-0000-0000-000000000003'
    and observation.reference_kind = 'paid_program_lesson'
    and observation.captured_uid = 'synthetic-paid-stream-uid'
), 1, 'capture records the paid Program lesson reference');
select is((
  select count(*)::integer from public.stream_media_legacy_observations observation
  where observation.capture_run_id = 'f6000000-0000-0000-0000-000000000001'
    and observation.source_kind = 'pinned_free_enrollment_lessons'
    and observation.source_identity = 'f7400000-0000-0000-0000-000000000001:f7300000-0000-0000-0000-000000000002'
    and observation.reference_kind = 'pinned_free_enrollment'
    and observation.captured_uid = 'synthetic-free-stream-uid'
), 1, 'capture records the enrollment-pinned free snapshot reference');
select is((
  select count(*)::integer from public.stream_media_legacy_observations observation
  where observation.capture_run_id = 'f6000000-0000-0000-0000-000000000001'
    and observation.source_kind = 'program_offer_lessons'
    and observation.source_identity = 'f7200000-0000-0000-0000-000000000003:f7300000-0000-0000-0000-000000000003'
    and observation.reference_kind = 'program_offer_reference'
    and observation.captured_uid = 'synthetic-paid-stream-uid'
), 1, 'capture records an immutable offer lesson reference');
select is((
  select count(*)::integer from public.stream_media_legacy_observations observation
  where observation.capture_run_id = 'f6000000-0000-0000-0000-000000000001'
    and observation.source_kind = 'program_order_lessons'
    and observation.source_identity = 'f7500000-0000-0000-0000-000000000001:f7300000-0000-0000-0000-000000000003'
    and observation.reference_kind = 'program_order_reference'
    and observation.captured_uid = 'synthetic-paid-stream-uid'
), 1, 'capture records a paid order lesson reference');
select throws_ok(
  $$update public.stream_source_binding_observations
    set binding_state = 'verified'
    where id = 'f6600000-0000-0000-0000-000000000001'$$,
  '55000', null, 'the source guard phase cannot be bypassed by changing a binding observation');
select throws_ok(
  $$update public.stream_provider_account_registry
    set provider_account_id = repeat('c', 32)
    where id = current_setting('test.stream_account_one')::uuid$$,
  '55000', null, 'provider account identity is append-only and cannot be rebound');
select ok(position(
  'version.revision_kind = ''paid''' in pg_get_functiondef(
    'private.program_paid_media_uid_is_retained(text)'::regprocedure
  )
) > 0, 'the existing paid cross-Program reuse predicate remains paid-only and unchanged');
select ok(not has_function_privilege('authenticated', 'private.program_paid_media_uid_is_retained(text)', 'execute'),
  'existing paid-media helper remains service-scoped');

delete from public.profiles where id = 'f1000000-0000-0000-0000-000000000003';
delete from public.profiles where id = 'f1000000-0000-0000-0000-000000000002';
select is((select count(*)::integer from public.videos where id = 'f3000000-0000-0000-0000-000000000001'),
  0, 'synthetic source video was removed by its profile cascade');
select is((select count(*)::integer from public.post_media where id = 'f5000000-0000-0000-0000-000000000001'),
  0, 'synthetic post media was removed by its post cascade');
select is((
  select count(*)::integer from public.stream_media_legacy_observations observation
  where observation.capture_run_id = 'f6000000-0000-0000-0000-000000000001'
    and observation.source_identity in (
      'f3000000-0000-0000-0000-000000000001',
      'f5000000-0000-0000-0000-000000000001'
    )
), 2, 'capture observations survive the source profile and post cascades');
select is((select count(*)::integer from public.program_enrollments where id = 'f7400000-0000-0000-0000-000000000001'),
  0, 'the source enrollment fixture was removed by its member profile cascade');
select is((
  select count(*)::integer from public.stream_media_legacy_observations observation
  where observation.capture_run_id = 'f6000000-0000-0000-0000-000000000001'
    and observation.source_kind = 'pinned_free_enrollment_lessons'
    and observation.source_identity = 'f7400000-0000-0000-0000-000000000001:f7300000-0000-0000-0000-000000000002'
    and observation.captured_uid = 'synthetic-free-stream-uid'
), 1, 'pinned retention evidence survives deletion of the enrollment source');

select * from finish();
rollback;
