begin;
select plan(28);

select ok((select prosecdef from pg_proc where oid =
  'public.service_fence_feature_pricing_sync_failure(uuid,uuid,text,text,bigint,bigint)'::regprocedure),
  'failure fence runs as a security definer');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid =
  'public.service_fence_feature_pricing_sync_failure(uuid,uuid,text,text,bigint,bigint)'::regprocedure),
  'failure fence fixes an empty search path');
select ok(not has_function_privilege('anon',
  'public.service_fence_feature_pricing_sync_failure(uuid,uuid,text,text,bigint,bigint)', 'EXECUTE'),
  'anonymous role cannot execute the failure fence');
select ok(not has_function_privilege('authenticated',
  'public.service_fence_feature_pricing_sync_failure(uuid,uuid,text,text,bigint,bigint)', 'EXECUTE'),
  'authenticated role cannot execute the failure fence');
select ok(has_function_privilege('service_role',
  'public.service_fence_feature_pricing_sync_failure(uuid,uuid,text,text,bigint,bigint)', 'EXECUTE'),
  'service role can execute the failure fence');

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select public.service_fence_feature_pricing_sync_failure('92100000-0000-0000-0000-000000000001','91100000-0000-0000-0000-000000000001','form_coach',repeat('a',64),1,0)$$,
  '42501', null, 'anonymous caller is rejected');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"91100000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$select public.service_fence_feature_pricing_sync_failure('92100000-0000-0000-0000-000000000001','91100000-0000-0000-0000-000000000001','form_coach',repeat('a',64),1,0)$$,
  '42501', null, 'authenticated caller is rejected');
reset role;

insert into auth.users(id, email, raw_user_meta_data)
values ('91100000-0000-0000-0000-000000000001', 'pricing-fence-admin@example.test', '{"display_name":"Pricing Fence Admin"}');
update public.profiles set role = 'admin' where id = '91100000-0000-0000-0000-000000000001';

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
insert into public.feature_pricing_revisions(feature_key, revision, status, payer, billing_model, currency, display_name)
values ('form_coach', 2, 'pricing_pending', 'coach', null, 'USD', 'Fence fixture revision');

insert into public.feature_pricing_sync_requests
  (request_id, feature_key, expected_revision, requested_by, request_digest, candidate_payload, state, state_revision, published_revision)
values
 ('92100000-0000-0000-0000-000000000001', 'form_coach', 1, '91100000-0000-0000-0000-000000000001', repeat('a',64), '{"status":"live"}', 'reserved', 0, null),
 ('92100000-0000-0000-0000-000000000002', 'form_coach', 1, '91100000-0000-0000-0000-000000000001', repeat('b',64), '{"status":"live"}', 'unknown', 1, null),
 ('92100000-0000-0000-0000-000000000003', 'form_coach', 1, '91100000-0000-0000-0000-000000000001', repeat('c',64), '{"status":"live"}', 'verified', 4, null),
 ('92100000-0000-0000-0000-000000000004', 'form_coach', 1, '91100000-0000-0000-0000-000000000001', repeat('d',64), '{"status":"live"}', 'reserved', 0, null),
 ('92100000-0000-0000-0000-000000000005', 'form_coach', 2, '91100000-0000-0000-0000-000000000001', repeat('e',64), '{"status":"live"}', 'reserved', 0, null),
 ('92100000-0000-0000-0000-000000000006', 'form_coach', 1, '91100000-0000-0000-0000-000000000001', repeat('f',64), '{"status":"live"}', 'cas_applied', 8, 1);

insert into public.feature_pricing_sync_objects
  (request_id, object_kind, price_key, idempotency_key, payload_digest, state, provider_object_id, verified_payload_digest, state_revision)
values
 ('92100000-0000-0000-0000-000000000003', 'product', null,
  'form-coach-price-sync:92100000-0000-0000-0000-000000000003:product', repeat('1',64),
  'verified', 'prod_fence_preserved', repeat('1',64), 2);

select is(public.service_fence_feature_pricing_sync_failure(
  '92100000-0000-0000-0000-000000000001', '91100000-0000-0000-0000-000000000001', 'form_coach', repeat('a',64), 1, 0),
  'failed', 'reserved request is durably fenced after definitive mismatch');
select is((select state || ':' || state_revision::text from public.feature_pricing_sync_requests
  where request_id = '92100000-0000-0000-0000-000000000001'),
  'failed:1', 'failure fence advances state exactly once');
select is(public.service_fence_feature_pricing_sync_failure(
  '92100000-0000-0000-0000-000000000001', '91100000-0000-0000-0000-000000000001', 'form_coach', repeat('a',64), 1, 0),
  'already_failed', 'exact lost-response retry is idempotent');
select is(public.service_fence_feature_pricing_sync_failure(
  '92100000-0000-0000-0000-000000000001', '91100000-0000-0000-0000-000000000099', 'form_coach', repeat('a',64), 1, 0),
  'identity_mismatch', 'request owner mismatch cannot fence another admin request');
select is(public.service_fence_feature_pricing_sync_failure(
  '92100000-0000-0000-0000-000000000002', '91100000-0000-0000-0000-000000000001', 'form_coach', repeat('9',64), 1, 1),
  'identity_mismatch', 'request digest mismatch cannot fence a request');
select is((select state || ':' || state_revision::text from public.feature_pricing_sync_requests
  where request_id = '92100000-0000-0000-0000-000000000002'),
  'unknown:1', 'identity mismatch leaves the parent request unchanged');
select is(public.service_fence_feature_pricing_sync_failure(
  '92100000-0000-0000-0000-000000000002', '91100000-0000-0000-0000-000000000001', 'form_coach', repeat('b',64), 1, 1),
  'failed', 'unknown request can be fenced by exact state revision');
select is(public.service_fence_feature_pricing_sync_failure(
  '92100000-0000-0000-0000-000000000003', '91100000-0000-0000-0000-000000000001', 'form_coach', repeat('c',64), 1, 4),
  'failed', 'verified request can be fenced through the guarded verified-to-failed transition');
select is((select state || ':' || provider_object_id || ':' || verified_payload_digest || ':' || state_revision::text
  from public.feature_pricing_sync_objects where request_id = '92100000-0000-0000-0000-000000000003'),
  'verified:prod_fence_preserved:' || repeat('1',64) || ':2', 'fencing the parent preserves its child provider binding and verification');
select is(public.service_fence_feature_pricing_sync_failure(
  '92100000-0000-0000-0000-000000000004', '91100000-0000-0000-0000-000000000001', 'form_coach', repeat('d',64), 1, 9),
  'cas_stale', 'stale parent state revision does not fence a request');
select is((select state || ':' || state_revision::text from public.feature_pricing_sync_requests
  where request_id = '92100000-0000-0000-0000-000000000004'),
  'reserved:0', 'state-revision CAS miss leaves request available for reconciliation');
select is(public.service_fence_feature_pricing_sync_failure(
  '92100000-0000-0000-0000-000000000005', '91100000-0000-0000-0000-000000000001', 'form_coach', repeat('e',64), 2, 0),
  'cas_stale', 'a request for a noncurrent config revision is not fenced as a current mismatch');
select is((select state || ':' || state_revision::text from public.feature_pricing_sync_requests
  where request_id = '92100000-0000-0000-0000-000000000005'),
  'reserved:0', 'current-revision CAS miss leaves request unchanged');
select is(public.service_fence_feature_pricing_sync_failure(
  '92100000-0000-0000-0000-000000000099', '91100000-0000-0000-0000-000000000001', 'form_coach', repeat('0',64), 1, 0),
  'missing', 'unknown request returns a finite missing outcome');
select is(public.service_fence_feature_pricing_sync_failure(
  '92100000-0000-0000-0000-000000000006', '91100000-0000-0000-0000-000000000001', 'form_coach', repeat('f',64), 1, 8),
  'already_published', 'published request cannot be reported as failed');
select is((select state || ':' || state_revision::text || ':' || published_revision::text
  from public.feature_pricing_sync_requests where request_id = '92100000-0000-0000-0000-000000000006'),
  'cas_applied:8:1', 'published request identity and revision remain unchanged');
select is((select outcome from public.reserve_feature_pricing_sync_object(
  '92100000-0000-0000-0000-000000000001', 'product', null,
  'form-coach-price-sync:92100000-0000-0000-0000-000000000001:product', repeat('2',64))),
  'request_unavailable', 'a fenced request cannot reserve another provider object');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"91100000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select outcome from public.admin_publish_feature_pricing_sync(
  '92100000-0000-0000-0000-000000000001', 1)),
  'failed', 'publish refuses a request fenced after definitive mismatch');
reset role;
select is((select revision from public.feature_pricing_current where feature_key = 'form_coach'),
  1::bigint, 'failed request did not create or activate a pricing revision');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  $$select public.service_fence_feature_pricing_sync_failure('92100000-0000-0000-0000-000000000004','91100000-0000-0000-0000-000000000001','other_feature',repeat('d',64),1,0)$$,
  '22023', null, 'unsupported feature identity is rejected');
select throws_ok(
  $$select public.service_fence_feature_pricing_sync_failure('92100000-0000-0000-0000-000000000004','91100000-0000-0000-0000-000000000001','form_coach','bad-digest',1,0)$$,
  '22023', null, 'malformed request digest is rejected');

select * from finish();
rollback;
